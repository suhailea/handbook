---
title: Rate Limiter
outline: deep
---

# Rate Limiter

## The Problem

Design a distributed rate limiter for a multi-tenant SaaS API platform. The system must:

- Enforce per-tenant request limits (e.g., 1,000 req/min for free tier, 10,000 req/min for paid)
- Allow controlled bursts above the sustained rate
- Work across a horizontally-scaled fleet of API servers
- Add minimal latency to the request path (<5ms p99)
- Degrade gracefully when the rate limiting infrastructure fails
- Return informative headers so clients can implement proper backoff

## Clarifying Questions

| Question | Assumed answer |
|---|---|
| How many tenants? | ~50,000 active API keys |
| What's the peak request rate? | ~100,000 req/s across all tenants |
| Is per-endpoint limiting needed? | No — global per-tenant only (per-endpoint is an optimization for later) |
| What happens on rate limit failure (Redis down)? | Fail open with a conservative in-process fallback |
| Are there different tier limits? | Yes: free (100/min), pro (1,000/min), enterprise (10,000/min) |
| Do we need analytics on rate limit events? | Yes — track allowed/rejected counts for billing and abuse detection |

## High-Level Architecture

```
                          ┌──────────────┐
                          │   Clients    │
                          └──────┬───────┘
                                 │
                          ┌──────▼───────┐
                          │ Load Balancer │
                          └──────┬───────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
        ┌─────▼─────┐    ┌─────▼─────┐      ┌─────▼─────┐
        │  API Pod 1 │    │  API Pod 2 │      │  API Pod N │
        │            │    │            │      │            │
        │ ┌────────┐ │    │ ┌────────┐ │      │ ┌────────┐ │
        │ │Local RL│ │    │ │Local RL│ │      │ │Local RL│ │
        │ └───┬────┘ │    │ └───┬────┘ │      │ └───┬────┘ │
        └─────┼──────┘    └─────┼──────┘      └─────┼──────┘
              │                 │                    │
              └─────────────────┼────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Redis (Primary)     │
                    │   Token Bucket State  │
                    │                       │
                    │   Sentinel / Cluster  │
                    └───────────────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Analytics Pipeline  │
                    │   (async, non-blocking)│
                    └───────────────────────┘
```

**Flow for every request:**
1. Pod receives request, extracts API key from header.
2. Looks up tenant tier from a local cache (backed by a config DB, refreshed every 60s).
3. Executes token bucket check via Redis Lua script (~1ms).
4. Sets rate limit response headers.
5. If rejected: returns 429 with `Retry-After`. If allowed: forwards to handler.
6. Async: emits rate limit event to analytics pipeline.

## Detailed Design

### Component 1: Token Bucket on Redis

The core algorithm. Each tenant gets a Redis hash key storing bucket state.

```typescript
// run: npx tsx rate-limiter-core.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// Lua script — executed atomically on Redis
const TOKEN_BUCKET_LUA = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])
  local now_ms = tonumber(ARGV[3])
  local cost = tonumber(ARGV[4])

  -- Read current state
  local data = redis.call('HMGET', key, 'tokens', 'ts')
  local tokens = tonumber(data[1])
  local last_ts = tonumber(data[2])

  -- Initialize on first request
  if tokens == nil then
    tokens = capacity
    last_ts = now_ms
  end

  -- Refill based on elapsed time
  local elapsed = math.max(0, now_ms - last_ts)
  tokens = math.min(capacity, tokens + (elapsed * refill_rate / 1000))

  -- Attempt to consume
  local allowed = 0
  local retry_after_ms = 0

  if tokens >= cost then
    tokens = tokens - cost
    allowed = 1
  else
    retry_after_ms = math.ceil((cost - tokens) / refill_rate * 1000)
  end

  -- Persist state
  redis.call('HMSET', key, 'tokens', tostring(tokens), 'ts', tostring(now_ms))
  redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 120)

  return { allowed, math.floor(tokens), retry_after_ms }
`;

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

async function checkRateLimit(
  tenantId: string,
  capacity: number,
  refillRate: number,
  cost = 1,
): Promise<RateLimitResult> {
  const result = (await redis.eval(TOKEN_BUCKET_LUA, {
    keys: [`rl:${tenantId}`],
    arguments: [
      capacity.toString(),
      refillRate.toString(),
      Date.now().toString(),
      cost.toString(),
    ],
  })) as number[];

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterMs: result[2],
  };
}
```

**Why token bucket over sliding window?**
- Independent burst and rate control (capacity vs refill rate).
- O(1) memory per tenant (one hash key with 2 fields).
- No cleanup of expired entries needed (unlike sliding window log).

### Component 2: Tier Configuration

```typescript
// run: npx tsx tier-config.ts

interface TierConfig {
  capacity: number;          // Max burst
  refillRatePerSecond: number; // Sustained rate
}

const TIERS: Record<string, TierConfig> = {
  free:       { capacity: 20,   refillRatePerSecond: 100 / 60 },      // 100/min, burst 20
  pro:        { capacity: 100,  refillRatePerSecond: 1_000 / 60 },    // 1,000/min, burst 100
  enterprise: { capacity: 500,  refillRatePerSecond: 10_000 / 60 },   // 10,000/min, burst 500
};

// Tenant → tier mapping, cached in-process, refreshed from DB every 60s
class TierCache {
  private cache = new Map<string, string>();
  private lastRefresh = 0;

  async getTier(tenantId: string): Promise<string> {
    if (Date.now() - this.lastRefresh > 60_000) {
      await this.refresh();
    }
    return this.cache.get(tenantId) ?? 'free';
  }

  private async refresh(): Promise<void> {
    // In production: SELECT tenant_id, tier FROM tenants
    // Simulated:
    this.cache.set('tenant-abc', 'pro');
    this.cache.set('tenant-xyz', 'enterprise');
    this.lastRefresh = Date.now();
  }
}
```

### Component 3: Fallback In-Process Limiter

When Redis is unreachable, fall back to a per-pod limiter with conservative limits.

```typescript
// run: npx tsx fallback-limiter.ts

class InProcessTokenBucket {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  check(
    key: string,
    capacity: number,
    refillRate: number,
  ): { allowed: boolean; remaining: number } {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: capacity, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(capacity, bucket.tokens + (elapsed * refillRate) / 1000);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: Math.floor(bucket.tokens) };
    }

    return { allowed: false, remaining: 0 };
  }

  // Periodic cleanup of stale entries
  cleanup(maxAgeMs = 300_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastRefill < cutoff) {
        this.buckets.delete(key);
      }
    }
  }
}
```

**Important:** the in-process fallback uses `1/N` of the global limit (where N = pod count) to avoid exceeding the total allowed rate across all pods. This is imprecise — pods may have uneven load — but it's better than no limiting at all.

### Component 4: Response Headers and HTTP Integration

```typescript
// run: npx tsx rate-limit-handler.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

function extractApiKey(req: IncomingMessage): string | null {
  return (req.headers['x-api-key'] as string) ?? null;
}

function sendRateLimitResponse(
  res: ServerResponse,
  limit: number,
  remaining: number,
  resetEpoch: number,
  retryAfterSeconds?: number,
): void {
  // IETF draft RateLimit headers
  res.setHeader('RateLimit-Limit', limit);
  res.setHeader('RateLimit-Remaining', remaining);
  res.setHeader('RateLimit-Reset', resetEpoch);

  if (retryAfterSeconds !== undefined) {
    res.setHeader('Retry-After', retryAfterSeconds);
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'rate_limit_exceeded',
      message: `Rate limit exceeded. Retry in ${retryAfterSeconds} seconds.`,
      retryAfter: retryAfterSeconds,
      docs: 'https://docs.example.com/rate-limits',
    }));
    return;
  }

  // Don't end the response — let the handler continue
}

const server = createServer(async (req, res) => {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'missing_api_key' }));
    return;
  }

  // Rate limit check would go here (Redis token bucket)
  // For demonstration, simulating an allowed request:
  sendRateLimitResponse(res, 100, 87, Math.floor(Date.now() / 1000) + 60);

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: 'your response' }));
});

server.listen(3000);
```

### Component 5: Analytics Pipeline

Rate limit events are emitted asynchronously — never block the request path for analytics.

```typescript
// run: npx tsx rate-limit-analytics.ts

interface RateLimitEvent {
  tenantId: string;
  timestamp: number;
  allowed: boolean;
  remaining: number;
  endpoint: string;
  ip: string;
}

class RateLimitAnalytics {
  private buffer: RateLimitEvent[] = [];
  private flushInterval: ReturnType<typeof setInterval>;

  constructor(private flushFn: (events: RateLimitEvent[]) => Promise<void>) {
    // Flush every 5 seconds
    this.flushInterval = setInterval(() => this.flush(), 5_000);
  }

  record(event: RateLimitEvent): void {
    this.buffer.push(event);
    // Flush immediately if buffer is large
    if (this.buffer.length >= 1000) {
      this.flush();
    }
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    try {
      await this.flushFn(batch);
    } catch {
      // Log but don't retry — analytics loss is acceptable
      console.error(`Failed to flush ${batch.length} rate limit events`);
    }
  }

  stop(): void {
    clearInterval(this.flushInterval);
    this.flush(); // Final flush
  }
}

// Usage: pipe to Kafka, ClickHouse, or a Redis stream
const analytics = new RateLimitAnalytics(async (events) => {
  console.log(`Flushed ${events.length} events`);
  // await kafka.send({ topic: 'rate-limit-events', messages: events.map(...) })
});
```

## Trade-offs & Alternatives

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Algorithm | Token bucket | Sliding window counter | Token bucket gives explicit burst control |
| State store | Redis | In-memory + gossip | Redis is battle-tested, atomic via Lua; gossip adds convergence lag |
| Failure mode | Fail open + fallback | Fail closed | SaaS API availability > strict enforcement during outages |
| Granularity | Per-tenant global | Per-tenant per-endpoint | Simpler; per-endpoint adds key-space bloat |
| Analytics | Async buffer → Kafka | Synchronous logging | Never block request path for observability |

**At 10x scale (1M req/s):**
- Single Redis instance handles ~100K-300K ops/s. At 1M req/s, shard across 4-8 Redis instances using consistent hashing on tenant ID.
- Consider a two-tier approach: local in-process limiter catches 80% of rejections (for heavily-abusing tenants), Redis handles the precise global check for the remaining 20%.
- Pre-compute burst tokens for predictable traffic patterns (e.g., known batch job schedules from enterprise tenants).

**At 100x scale (10M req/s):**
- Redis Cluster with 16+ shards. Each shard handles ~625K ops/s.
- Edge rate limiting: push rate limit checks to CDN edge (Cloudflare Workers, AWS CloudFront Functions) for DDoS-level traffic. Only requests that pass edge checks reach the API pods.
- Consider dedicated rate limiting services (e.g., Envoy's built-in rate limiter with gRPC backend) to remove the concern from application code entirely.

## Key Takeaways

- **Token bucket is the standard** for API rate limiting because it separates burst capacity from sustained rate — the two knobs operators actually want to tune.
- **Redis Lua scripts give you distributed atomicity** without the complexity of distributed locks or consensus protocols. One script, one round-trip, guaranteed atomic execution.
- **Fail-open with a conservative fallback** is the right default for SaaS APIs. The cost of a brief period of over-admission is almost always lower than the cost of rejecting legitimate paying customers.
- **Rate limit headers are part of the API contract.** `Retry-After` lets well-behaved clients back off correctly. Without it, clients retry immediately in tight loops, making overload worse.
- **Analytics are non-negotiable** but must never block the request path. Buffer and flush asynchronously. Losing a few analytics events is acceptable; adding 50ms to every request is not.
