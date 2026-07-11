---
title: Webhook Delivery System
outline: deep
---

# Webhook Delivery System

## The Problem

Design a reliable webhook delivery system for a SaaS platform. When events occur in the platform (e.g., payment completed, order shipped, user created), the system must deliver HTTP POST notifications to customer-registered endpoints. The system must:

- Deliver webhooks reliably (at-least-once delivery)
- Retry failed deliveries with exponential backoff and jitter
- Sign payloads with HMAC so receivers can verify authenticity
- Monitor delivery health per endpoint
- Move permanently failing deliveries to a dead letter queue
- Provide a dashboard for customers to inspect delivery history and manually retry

## Clarifying Questions

| Question | Assumed answer |
|---|---|
| How many events per day? | ~5 million events |
| How many registered webhook endpoints? | ~20,000 endpoints across ~5,000 tenants |
| Average events per endpoint per day? | ~250 |
| Acceptable delivery latency? | First attempt within 30 seconds of event |
| Maximum retry attempts? | 8 retries over ~24 hours |
| Payload size? | 1-50 KB JSON |
| What constitutes successful delivery? | HTTP 2xx response within 30 seconds |
| Should we support endpoint-specific event filtering? | Yes (e.g., "only send `payment.completed` events") |

## High-Level Architecture

```
  ┌──────────────────────────────────────────────────────┐
  │              Event Sources                           │
  │  (API handlers, background jobs, database triggers)  │
  └──────────────────────┬───────────────────────────────┘
                         │ Publish event
                         ▼
  ┌──────────────────────────────────────────────────────┐
  │                  Event Bus                           │
  │            (Redis Streams / Kafka)                   │
  └──────────────────────┬───────────────────────────────┘
                         │
              ┌──────────▼──────────┐
              │   Dispatcher        │
              │   Service           │
              │                     │
              │  - Look up subs     │
              │  - Filter events    │
              │  - Enqueue delivery │
              └──────────┬──────────┘
                         │
                         ▼
  ┌──────────────────────────────────────────────────────┐
  │              Delivery Queue (Redis)                  │
  │                                                      │
  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
  │  │ waiting  │  │ active   │  │ delayed  │           │
  │  │ (sorted  │  │ (sorted  │  │ (sorted  │           │
  │  │  set)    │  │  set)    │  │  set)    │           │
  │  └──────────┘  └──────────┘  └──────────┘           │
  │  ┌──────────┐  ┌──────────────────────┐             │
  │  │  DLQ     │  │  delivery:{id} hash  │             │
  │  └──────────┘  └──────────────────────┘             │
  └──────────────────────┬───────────────────────────────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
        ┌─────▼────┐ ┌──▼──────┐ ┌─▼────────┐
        │ Worker 1 │ │Worker 2 │ │ Worker N  │
        │          │ │         │ │           │
        │ HTTP POST│ │ HTTP    │ │ HTTP POST │
        │ + HMAC   │ │ POST    │ │ + HMAC    │
        └──────────┘ └─────────┘ └───────────┘
                         │
              ┌──────────▼──────────┐
              │   Customer          │
              │   Endpoints         │
              │                     │
              │  https://acme.com/  │
              │    webhooks         │
              └─────────────────────┘
```

## Detailed Design

### Component 1: Event Schema and Subscription Model

```typescript
// run: npx tsx webhook-models.ts

interface WebhookEvent {
  id: string;              // Unique event ID (idempotency key for receivers)
  type: string;            // e.g., "payment.completed", "order.shipped"
  tenantId: string;        // Which tenant triggered the event
  payload: unknown;        // Event-specific data
  occurredAt: string;      // ISO 8601 timestamp
  version: string;         // Event schema version (e.g., "2024-01-01")
}

interface WebhookEndpoint {
  id: string;
  tenantId: string;
  url: string;             // HTTPS endpoint URL
  secret: string;          // HMAC signing secret (generated, never stored in plaintext)
  eventTypes: string[];    // Subscribed event types (["*"] for all)
  isActive: boolean;
  createdAt: string;
  metadata: Record<string, string>; // Customer-defined labels
}

interface DeliveryAttempt {
  id: string;
  eventId: string;
  endpointId: string;
  attempt: number;         // 1-based attempt counter
  status: 'pending' | 'success' | 'failed' | 'dead_letter';
  requestTimestamp: string;
  responseStatus: number | null;
  responseBody: string | null;  // First 1KB only
  responseTimeMs: number | null;
  error: string | null;    // Network error, timeout, etc.
  nextRetryAt: string | null;
}

// Event ID: sortable, collision-resistant
function generateEventId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `evt_${timestamp}_${random}`;
}

console.log(generateEventId()); // evt_lx1abc_de4f5g6h
```

### Component 2: HMAC Signature Verification

Sign every webhook payload so receivers can verify it came from your platform.

```typescript
// run: npx tsx webhook-signing.ts
import { createHmac, timingSafeEqual } from 'node:crypto';

interface SignedWebhookHeaders {
  'webhook-id': string;
  'webhook-timestamp': string;
  'webhook-signature': string;
}

function signWebhookPayload(
  eventId: string,
  timestamp: number,
  body: string,
  secret: string,
): SignedWebhookHeaders {
  // Sign: "{event_id}.{timestamp}.{body}"
  const signaturePayload = `${eventId}.${timestamp}.${body}`;

  const signature = createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('base64');

  return {
    'webhook-id': eventId,
    'webhook-timestamp': timestamp.toString(),
    'webhook-signature': `v1,${signature}`,
  };
}

// Receiver-side verification
function verifyWebhookSignature(
  eventId: string,
  timestamp: string,
  body: string,
  signatureHeader: string,
  secret: string,
): boolean {
  // Check timestamp freshness (prevent replay attacks)
  const ts = parseInt(timestamp, 10);
  const age = Math.abs(Date.now() / 1000 - ts);
  if (age > 300) {
    // Older than 5 minutes — reject (replay attack or clock skew)
    return false;
  }

  // Reconstruct expected signature
  const signaturePayload = `${eventId}.${timestamp}.${body}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(signaturePayload)
    .digest('base64');

  // Extract the actual signature (after "v1,")
  const actualSignature = signatureHeader.replace('v1,', '');

  // Timing-safe comparison to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(expectedSignature),
      Buffer.from(actualSignature),
    );
  } catch {
    return false; // Different lengths
  }
}

// Test
const body = JSON.stringify({ type: 'payment.completed', amount: 99.99 });
const headers = signWebhookPayload('evt_abc123', Math.floor(Date.now() / 1000), body, 'whsec_test123');
console.log('Signature headers:', headers);

const valid = verifyWebhookSignature(
  headers['webhook-id'],
  headers['webhook-timestamp'],
  body,
  headers['webhook-signature'],
  'whsec_test123',
);
console.log('Signature valid:', valid); // true
```

**Why HMAC, not JWTs?** Webhooks are simple HTTP POST requests. HMAC is computationally cheaper, produces smaller headers, and doesn't require JSON parsing or base64 decoding of a structured token. The receiver only needs to verify that the payload was signed by someone who knows the shared secret.

### Component 3: Dispatcher — Fan-Out from Events to Deliveries

When an event occurs, find all matching subscriptions and create delivery jobs.

```typescript
// run: npx tsx dispatcher.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

async function dispatchEvent(event: WebhookEvent): Promise<string[]> {
  // Look up all active endpoints for this tenant that subscribe to this event type
  const endpoints = await getMatchingEndpoints(event.tenantId, event.type);

  const deliveryIds: string[] = [];

  for (const endpoint of endpoints) {
    const deliveryId = generateDeliveryId();
    const delivery: DeliveryAttempt = {
      id: deliveryId,
      eventId: event.id,
      endpointId: endpoint.id,
      attempt: 0,
      status: 'pending',
      requestTimestamp: new Date().toISOString(),
      responseStatus: null,
      responseBody: null,
      responseTimeMs: null,
      error: null,
      nextRetryAt: null,
    };

    // Store delivery record and enqueue
    const multi = redis.multi();
    multi.set(`delivery:${deliveryId}`, JSON.stringify({
      delivery,
      event,
      endpoint: { id: endpoint.id, url: endpoint.url, secret: endpoint.secret },
    }));
    // Score = timestamp for FIFO ordering
    multi.zAdd('webhook:waiting', [{ score: Date.now(), value: deliveryId }]);
    await multi.exec();

    deliveryIds.push(deliveryId);
  }

  return deliveryIds;
}

// Simplified — in production, this queries a database
async function getMatchingEndpoints(
  tenantId: string,
  eventType: string,
): Promise<WebhookEndpoint[]> {
  // SELECT * FROM webhook_endpoints
  // WHERE tenant_id = $1 AND is_active = true
  // AND (event_types @> $2 OR event_types = '["*"]')
  return []; // placeholder
}

function generateDeliveryId(): string {
  return `dlv_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
}

// Type references
interface WebhookEvent {
  id: string; type: string; tenantId: string; payload: unknown;
  occurredAt: string; version: string;
}
interface WebhookEndpoint {
  id: string; tenantId: string; url: string; secret: string;
  eventTypes: string[]; isActive: boolean; createdAt: string;
  metadata: Record<string, string>;
}
interface DeliveryAttempt {
  id: string; eventId: string; endpointId: string; attempt: number;
  status: string; requestTimestamp: string; responseStatus: number | null;
  responseBody: string | null; responseTimeMs: number | null;
  error: string | null; nextRetryAt: string | null;
}
```

### Component 4: Delivery Worker — HTTP POST with Retries

The worker picks up delivery jobs, makes the HTTP request, and handles success/failure.

```typescript
// run: npx tsx delivery-worker.ts
import { createClient } from 'redis';
import { createHmac } from 'node:crypto';

const redis = createClient();
await redis.connect();

const RETRY_SCHEDULE_SECONDS = [
  0,       // Attempt 1: immediate
  30,      // Attempt 2: 30s
  120,     // Attempt 3: 2 min
  600,     // Attempt 4: 10 min
  1800,    // Attempt 5: 30 min
  3600,    // Attempt 6: 1 hour
  14400,   // Attempt 7: 4 hours
  43200,   // Attempt 8: 12 hours
];
const MAX_ATTEMPTS = RETRY_SCHEDULE_SECONDS.length;

async function processDelivery(deliveryId: string): Promise<void> {
  const raw = await redis.get(`delivery:${deliveryId}`);
  if (!raw) return;

  const data = JSON.parse(raw) as {
    delivery: {
      id: string; eventId: string; endpointId: string;
      attempt: number; status: string;
      responseStatus: number | null; responseBody: string | null;
      responseTimeMs: number | null; error: string | null;
      nextRetryAt: string | null; requestTimestamp: string;
    };
    event: { id: string; type: string; payload: unknown; occurredAt: string; version: string };
    endpoint: { id: string; url: string; secret: string };
  };

  const { delivery, event, endpoint } = data;
  delivery.attempt += 1;
  delivery.requestTimestamp = new Date().toISOString();

  // Build request body
  const body = JSON.stringify({
    id: event.id,
    type: event.type,
    data: event.payload,
    created_at: event.occurredAt,
    api_version: event.version,
  });

  // Sign the payload
  const timestamp = Math.floor(Date.now() / 1000);
  const signaturePayload = `${event.id}.${timestamp}.${body}`;
  const signature = createHmac('sha256', endpoint.secret)
    .update(signaturePayload)
    .digest('base64');

  const startTime = Date.now();

  try {
    // Make the HTTP request with a 30-second timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MyPlatform-Webhooks/1.0',
        'webhook-id': event.id,
        'webhook-timestamp': timestamp.toString(),
        'webhook-signature': `v1,${signature}`,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    delivery.responseTimeMs = Date.now() - startTime;
    delivery.responseStatus = response.status;

    // Capture first 1KB of response body for debugging
    const responseText = await response.text();
    delivery.responseBody = responseText.substring(0, 1024);

    if (response.ok) {
      // Success
      delivery.status = 'success';
      await redis.zRem('webhook:active', deliveryId);
      await saveDeliveryRecord(delivery);
      await updateEndpointHealth(endpoint.id, true);
      console.log(`Delivery ${deliveryId} succeeded (${delivery.responseTimeMs}ms)`);
      return;
    }

    // Non-2xx response — treat as failure
    delivery.error = `HTTP ${response.status}`;
  } catch (error) {
    delivery.responseTimeMs = Date.now() - startTime;
    delivery.error = error instanceof Error ? error.message : 'Unknown error';

    if (error instanceof Error && error.name === 'AbortError') {
      delivery.error = 'Timeout (30s)';
    }
  }

  // Failed — retry or DLQ
  await redis.zRem('webhook:active', deliveryId);
  await updateEndpointHealth(endpoint.id, false);

  if (delivery.attempt >= MAX_ATTEMPTS) {
    delivery.status = 'dead_letter';
    await redis.zAdd('webhook:dead_letter', [{ score: Date.now(), value: deliveryId }]);
    console.error(`Delivery ${deliveryId} moved to DLQ after ${delivery.attempt} attempts`);
  } else {
    // Schedule retry with jitter
    const baseDelay = RETRY_SCHEDULE_SECONDS[delivery.attempt] * 1000;
    const jitter = Math.random() * baseDelay * 0.2; // +/- 20% jitter
    const retryAt = Date.now() + baseDelay + jitter;

    delivery.status = 'pending';
    delivery.nextRetryAt = new Date(retryAt).toISOString();
    await redis.zAdd('webhook:delayed', [{ score: retryAt, value: deliveryId }]);
    console.log(`Delivery ${deliveryId} retry #${delivery.attempt + 1} at ` +
      `${new Date(retryAt).toISOString()}`);
  }

  data.delivery = delivery;
  await redis.set(`delivery:${deliveryId}`, JSON.stringify(data));
}

async function saveDeliveryRecord(
  delivery: Record<string, unknown>,
): Promise<void> {
  // In production: INSERT INTO delivery_attempts ...
  // Keep for 30 days for customer dashboard
}

async function updateEndpointHealth(
  endpointId: string,
  success: boolean,
): Promise<void> {
  // Track rolling success rate
  const key = `endpoint:health:${endpointId}`;
  const field = success ? 'successes' : 'failures';
  await redis.hIncrBy(key, field, 1);
  await redis.expire(key, 86400); // Reset daily
}
```

**Retry schedule rationale:** the schedule ramps up from 30 seconds to 12 hours across 8 attempts, covering a ~24-hour window. This handles transient failures (30s retry catches brief outages), extended maintenance windows (1-4 hour retries), and gives the endpoint operator time to fix issues before the delivery is abandoned.

### Component 5: Endpoint Health Monitoring

Track delivery success rates per endpoint. Auto-disable endpoints that are consistently failing.

```typescript
// run: npx tsx endpoint-health.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

interface EndpointHealth {
  endpointId: string;
  successCount: number;
  failureCount: number;
  successRate: number;
  isHealthy: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
}

async function getEndpointHealth(endpointId: string): Promise<EndpointHealth> {
  const key = `endpoint:health:${endpointId}`;
  const data = await redis.hGetAll(key);

  const successes = parseInt(data['successes'] ?? '0', 10);
  const failures = parseInt(data['failures'] ?? '0', 10);
  const total = successes + failures;
  const successRate = total > 0 ? successes / total : 1;

  return {
    endpointId,
    successCount: successes,
    failureCount: failures,
    successRate,
    isHealthy: successRate > 0.05 || total < 10, // Unhealthy if <5% success after 10+ attempts
    lastSuccessAt: data['last_success'] ?? null,
    lastFailureAt: data['last_failure'] ?? null,
  };
}

// Auto-disable endpoints with sustained failure
async function checkAndDisableUnhealthyEndpoints(): Promise<void> {
  // In production: query all endpoints, check health
  // If success rate < 5% over 100+ attempts in 24h, auto-disable
  // Send notification to tenant: "Your webhook endpoint X has been disabled
  //   due to sustained failures. Last error: ..."
  // Provide a re-enable button in the dashboard
}

// Periodic health check (separate from delivery)
async function pingEndpoint(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MyPlatform-Webhooks/1.0 (health-check)',
      },
      body: JSON.stringify({ type: 'webhook.health_check', test: true }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}
```

### Component 6: Customer Dashboard API

Provide endpoints for customers to view delivery history and manually retry.

```typescript
// run: npx tsx dashboard-api.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// GET /api/webhooks/deliveries?endpoint_id=ep_123&status=failed&limit=50
async function listDeliveries(
  tenantId: string,
  filters: { endpointId?: string; status?: string; limit?: number },
): Promise<object[]> {
  // In production: query PostgreSQL with tenant isolation
  // SELECT * FROM delivery_attempts
  // WHERE tenant_id = $1
  // AND ($2::text IS NULL OR endpoint_id = $2)
  // AND ($3::text IS NULL OR status = $3)
  // ORDER BY created_at DESC
  // LIMIT $4
  return [];
}

// POST /api/webhooks/deliveries/:id/retry
async function retryDelivery(
  tenantId: string,
  deliveryId: string,
): Promise<{ success: boolean; message: string }> {
  const raw = await redis.get(`delivery:${deliveryId}`);
  if (!raw) {
    return { success: false, message: 'Delivery not found' };
  }

  const data = JSON.parse(raw);

  // Verify tenant ownership
  if (data.event.tenantId !== tenantId) {
    return { success: false, message: 'Not authorized' };
  }

  // Only allow retry of failed/dead_letter deliveries
  if (!['failed', 'dead_letter'].includes(data.delivery.status)) {
    return { success: false, message: `Cannot retry delivery in status: ${data.delivery.status}` };
  }

  // Reset delivery state
  data.delivery.status = 'pending';
  data.delivery.attempt = 0; // Reset attempt counter for manual retry
  data.delivery.error = null;
  data.delivery.nextRetryAt = null;

  // Re-enqueue
  await redis.set(`delivery:${deliveryId}`, JSON.stringify(data));
  await redis.zRem('webhook:dead_letter', deliveryId);
  await redis.zAdd('webhook:waiting', [{ score: Date.now(), value: deliveryId }]);

  return { success: true, message: 'Delivery re-queued for retry' };
}

// POST /api/webhooks/deliveries/retry-all?endpoint_id=ep_123
async function retryAllFailed(
  tenantId: string,
  endpointId: string,
): Promise<{ retriedCount: number }> {
  // Find all DLQ deliveries for this endpoint
  const dlqMembers = await redis.zRange('webhook:dead_letter', 0, -1);
  let retriedCount = 0;

  for (const deliveryId of dlqMembers) {
    const raw = await redis.get(`delivery:${deliveryId}`);
    if (!raw) continue;

    const data = JSON.parse(raw);
    if (data.event.tenantId !== tenantId) continue;
    if (data.endpoint.id !== endpointId) continue;

    const result = await retryDelivery(tenantId, deliveryId);
    if (result.success) retriedCount++;
  }

  return { retriedCount };
}
```

### Security Considerations

```typescript
// run: npx tsx webhook-security.ts

// 1. SSRF Protection: validate endpoint URLs before registration
function isValidWebhookUrl(url: string): { valid: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // Must be HTTPS
  if (parsed.protocol !== 'https:') {
    return { valid: false, reason: 'Only HTTPS endpoints are accepted' };
  }

  // Block private/internal IPs
  const hostname = parsed.hostname;
  const blocked = [
    /^localhost$/i,
    /^127\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[01])\./,
    /^192\.168\./,
    /^169\.254\./,        // Link-local
    /^0\./,               // Current network
    /^\[::1\]$/,          // IPv6 loopback
    /^\[fc/i,             // IPv6 private
    /^\[fd/i,             // IPv6 private
    /\.internal$/i,       // Internal domains
    /\.local$/i,          // mDNS
  ];

  for (const pattern of blocked) {
    if (pattern.test(hostname)) {
      return { valid: false, reason: 'Internal/private endpoints are not allowed' };
    }
  }

  // Block non-standard ports
  if (parsed.port && !['443', ''].includes(parsed.port)) {
    return { valid: false, reason: 'Only port 443 is accepted' };
  }

  return { valid: true };
}

// 2. DNS rebinding protection: resolve DNS at delivery time and check IP
// 3. Response body size limit: only read first 1KB (prevent memory attacks)
// 4. Follow redirects cautiously: max 3 redirects, re-check each target URL
// 5. Rate limit registration: max 10 endpoints per tenant

console.log(isValidWebhookUrl('https://example.com/webhooks'));    // { valid: true }
console.log(isValidWebhookUrl('http://example.com/webhooks'));     // { valid: false, ... }
console.log(isValidWebhookUrl('https://localhost:8080/hook'));     // { valid: false, ... }
console.log(isValidWebhookUrl('https://10.0.0.1/internal'));       // { valid: false, ... }
```

## Trade-offs & Alternatives

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Queue backend | Redis (sorted sets) | PostgreSQL (SKIP LOCKED) | Redis handles high throughput; PG is simpler for smaller scale |
| Signing | HMAC-SHA256 | Ed25519 asymmetric | HMAC is simpler; asymmetric is better if receivers shouldn't have the signing key |
| Retry schedule | Fixed backoff table | Exponential formula | Table is explicit and easy to reason about; formula is more flexible |
| Event delivery | At-least-once | At-most-once | Duplicate delivery + idempotency key is safer than silent loss |
| Storage | Redis (hot) + PostgreSQL (history) | Redis only | History must survive restarts; Redis for hot path, PG for durability |

**At 10x scale (50M events/day):**
- Partition delivery queues by tenant or event type to reduce contention.
- Use Kafka instead of Redis Streams for event bus (built-in partitioning, replication, long retention).
- Workers per-region: if endpoints are globally distributed, run delivery workers close to the target region to reduce latency.

**At 100x scale (500M events/day):**
- Dedicated delivery clusters per major tenant (isolation).
- Edge delivery: use CDN edge workers for initial delivery attempt (Cloudflare Workers, Lambda@Edge).
- Batch delivery: allow endpoints to opt into batch mode (receive N events in one request) to reduce HTTP overhead.

## Key Takeaways

- **At-least-once delivery is the only viable guarantee.** Exactly-once is impossible across network boundaries. Receivers must be idempotent — the event ID serves as the idempotency key.
- **HMAC signing is non-negotiable.** Without it, anyone who discovers the endpoint URL can forge webhook deliveries. Always include the event ID and timestamp in the signed payload to prevent replay attacks.
- **Retry backoff must be aggressive enough to span outages.** A 5-minute retry window is useless when an endpoint is down for maintenance for 2 hours. 8 retries over 24 hours covers most real-world outage windows.
- **Endpoint health monitoring prevents wasted resources.** An endpoint that returns 500 on every request for a week will accumulate thousands of DLQ entries and consume worker capacity. Auto-disable and notify the tenant.
- **SSRF protection is critical.** Webhooks make HTTP requests to user-supplied URLs. Without URL validation and IP blocking, an attacker can use your webhook system to scan internal networks or access metadata services (e.g., AWS `169.254.169.254`).
