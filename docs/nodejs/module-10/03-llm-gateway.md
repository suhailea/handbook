---
title: "Production LLM Gateway"
outline: deep
---

# Production LLM Gateway

<span class="badge interview-hot">Interview 🔥🔥🔥</span> <span class="badge">Capstone project</span> <span class="badge">Node 22+</span>

**Prerequisites:** [SSE & LLM Token Streaming](/nodejs/module-04/04-sse-streaming) · [AbortController & AbortSignal](/nodejs/module-03/03-abort-controller) · [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you run a concierge desk at a luxury hotel. Guests come to you with questions, and you phone an expert (an expensive consultant) who answers slowly, one sentence at a time, while you relay each sentence to the guest in real time.

Several problems emerge as your hotel gets popular:

First, you need **speed limits**. If one guest calls the consultant fifty times a minute, they hog the phone line and drain your budget. You introduce a token system: each guest gets a fixed number of tokens per minute. When they're out, they wait.

Second, you notice **duplicate calls**. Three guests ask the exact same question within seconds. Instead of phoning the consultant three times, you phone once and relay the same answer to all three guests simultaneously. That is **request coalescing** — one upstream call, many downstream responses.

Third, you need **graceful cancellation**. A guest walks away mid-answer. You don't want the consultant to keep talking (and billing you) for nobody. You hang up the phone the moment the guest leaves.

Fourth, you want **accounting**. How long did each call take? How many sentences did the consultant produce? Which guests are your heaviest users? You keep a detailed logbook — that is **observability**.

A production LLM gateway does all four of these things: rate limiting, request coalescing, end-to-end abort propagation, and telemetry — while streaming tokens from the AI provider to the client with proper backpressure handling. It is the place where streams, HTTP, cancellation, rate limiting, and observability all meet.
:::

## ⚙️ Under the Hood

This capstone ties together concepts from across the handbook. We will build a gateway in stages, each addressing one concern.

### Architecture overview

```
Client (browser/API consumer)
  │
  │  POST /v1/chat/completions  (OpenAI-compatible)
  ▼
┌──────────────────────────────────┐
│        LLM Gateway (Node)        │
│                                  │
│  1. Rate limiter (token bucket)  │
│  2. Request coalescer            │
│  3. Upstream proxy (SSE)         │
│  4. Abort propagation            │
│  5. OTel instrumentation         │
└──────────────────────────────────┘
  │
  │  POST /v1/chat/completions  (stream: true)
  ▼
  LLM Provider (OpenAI, Anthropic, etc.)
```

### Stage 1: Token-bucket rate limiter

The token bucket is the most common rate-limiting algorithm for API gateways. It allows bursts while enforcing a long-term rate:

```typescript
// rate-limiter.ts

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class TokenBucketRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly maxTokens: number,    // bucket capacity
    private readonly refillRate: number,   // tokens added per second
  ) {}

  /** Returns true if the request is allowed, false if rate-limited */
  tryConsume(key: string, cost: number = 1): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1_000;
    bucket.tokens = Math.min(this.maxTokens, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return true;
    }

    return false;
  }

  /** Seconds until `cost` tokens are available */
  retryAfter(key: string, cost: number = 1): number {
    const bucket = this.buckets.get(key);
    if (!bucket) return 0;
    const deficit = cost - bucket.tokens;
    if (deficit <= 0) return 0;
    return Math.ceil(deficit / this.refillRate);
  }

  /** Periodic cleanup of stale buckets */
  cleanup(maxAgeMs: number = 600_000): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAgeMs) {
        this.buckets.delete(key);
      }
    }
  }
}
// run: node --experimental-strip-types rate-limiter.ts
```

In production, you would back this with Redis (`EVALSHA` a Lua script) for distributed rate limiting. The in-memory version works for single-instance gateways.

### Stage 2: Request coalescer

When multiple clients send identical prompts within a short window, the coalescer ensures only one upstream request is made. Subsequent identical requests "join" the in-flight stream:

```typescript
// coalescer.ts
import { createHash } from 'node:crypto';

interface InFlightRequest {
  /** Subscribers waiting for chunks */
  subscribers: Array<(chunk: string) => void>;
  /** Called when the stream ends */
  onEnd: Array<() => void>;
  /** Called on error */
  onError: Array<(err: Error) => void>;
}

export class RequestCoalescer {
  private inflight = new Map<string, InFlightRequest>();

  /** Generate a cache key from the request payload */
  static computeKey(body: {
    model: string;
    messages: Array<{ role: string; content: string }>;
  }): string {
    // Hash model + messages for deduplication
    // Temperature, top_p, etc. affect output — include if present
    const payload = JSON.stringify({ model: body.model, messages: body.messages });
    return createHash('sha256').update(payload).digest('hex').slice(0, 16);
  }

  /**
   * Returns null if this request should be proxied upstream (first caller).
   * Returns a promise if this request should join an existing stream.
   */
  join(
    key: string,
    onChunk: (chunk: string) => void,
    onEnd: () => void,
    onError: (err: Error) => void,
  ): boolean {
    const existing = this.inflight.get(key);

    if (existing) {
      // Join existing stream
      existing.subscribers.push(onChunk);
      existing.onEnd.push(onEnd);
      existing.onError.push(onError);
      return true; // joined — caller should NOT make an upstream request
    }

    // First caller — create the entry
    this.inflight.set(key, {
      subscribers: [onChunk],
      onEnd: [onEnd],
      onError: [onError],
    });
    return false; // caller IS responsible for the upstream request
  }

  /** Broadcast a chunk to all subscribers */
  broadcast(key: string, chunk: string): void {
    const entry = this.inflight.get(key);
    if (!entry) return;
    for (const sub of entry.subscribers) {
      sub(chunk);
    }
  }

  /** Signal stream completion */
  complete(key: string): void {
    const entry = this.inflight.get(key);
    if (!entry) return;
    for (const cb of entry.onEnd) cb();
    this.inflight.delete(key);
  }

  /** Signal stream error */
  error(key: string, err: Error): void {
    const entry = this.inflight.get(key);
    if (!entry) return;
    for (const cb of entry.onError) cb(err);
    this.inflight.delete(key);
  }

  /** Remove a specific subscriber (client disconnect) */
  unsubscribe(
    key: string,
    onChunk: (chunk: string) => void,
  ): void {
    const entry = this.inflight.get(key);
    if (!entry) return;

    const idx = entry.subscribers.indexOf(onChunk);
    if (idx !== -1) {
      entry.subscribers.splice(idx, 1);
      entry.onEnd.splice(idx, 1);
      entry.onError.splice(idx, 1);
    }

    // If no subscribers left, the upstream request can be aborted
    // (handled by the gateway via the abort controller)
  }

  subscriberCount(key: string): number {
    return this.inflight.get(key)?.subscribers.length ?? 0;
  }
}
// run: node --experimental-strip-types coalescer.ts
```

### Stage 3: The gateway server

Now we wire everything together — rate limiting, coalescing, upstream streaming, abort propagation, and backpressure:

```typescript
// llm-gateway.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { TokenBucketRateLimiter } from './rate-limiter.ts';
import { RequestCoalescer } from './coalescer.ts';

// --- Configuration ---
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? 'https://api.openai.com';
const LLM_API_KEY = process.env.LLM_API_KEY ?? '';
const PORT = parseInt(process.env.PORT ?? '3000', 10);

// 20 requests/min, burst of 5
const rateLimiter = new TokenBucketRateLimiter(5, 20 / 60);
const coalescer = new RequestCoalescer();

// Periodic bucket cleanup
setInterval(() => rateLimiter.cleanup(), 60_000);

interface ChatCompletionRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
}

// --- Helpers ---

function getClientKey(req: IncomingMessage): string {
  // Use X-Forwarded-For behind a proxy, otherwise remote address
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

function writeSSE(res: ServerResponse, data: string): boolean {
  return res.write(`data: ${data}\n\n`);
}

// --- Upstream streaming ---

async function streamFromUpstream(
  chatReq: ChatCompletionRequest,
  coalescerKey: string,
  signal: AbortSignal,
): Promise<void> {
  const upstreamRes = await fetch(`${LLM_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({ ...chatReq, stream: true }),
    signal,
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    coalescer.error(
      coalescerKey,
      new Error(`Upstream error: ${upstreamRes.status} ${upstreamRes.statusText}`),
    );
    return;
  }

  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });

      // Parse SSE lines and broadcast each data payload
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          coalescer.broadcast(coalescerKey, data);
        }
      }
    }
    coalescer.complete(coalescerKey);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      coalescer.complete(coalescerKey);
    } else {
      coalescer.error(coalescerKey, err instanceof Error ? err : new Error(String(err)));
    }
  }
}

// --- Request handler ---

async function handleChatRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // 1. Rate limiting
  const clientKey = getClientKey(req);
  if (!rateLimiter.tryConsume(clientKey)) {
    const retryAfter = rateLimiter.retryAfter(clientKey);
    res.writeHead(429, {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfter),
    });
    res.end(JSON.stringify({
      error: { message: 'Rate limit exceeded', type: 'rate_limit_error' },
    }));
    return;
  }

  // 2. Parse request body
  let chatReq: ChatCompletionRequest;
  try {
    chatReq = JSON.parse(await readBody(req));
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Invalid JSON' } }));
    return;
  }

  // Force streaming — this gateway always streams
  chatReq.stream = true;

  // 3. SSE response headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // 4. Abort controller for end-to-end cancellation
  const ac = new AbortController();

  // 5. Request coalescing
  const coalescerKey = RequestCoalescer.computeKey(chatReq);

  // Chunk handler with backpressure
  const onChunk = (chunk: string): void => {
    const canContinue = writeSSE(res, chunk);
    if (!canContinue) {
      // Slow client — we could pause, but SSE is fire-and-forget for coalesced streams.
      // In a single-subscriber scenario, we'd await 'drain'.
      // For coalesced streams, we accept minor buffering.
    }
  };

  const onEnd = (): void => {
    writeSSE(res, '[DONE]');
    res.end();
  };

  const onError = (err: Error): void => {
    writeSSE(res, JSON.stringify({ error: { message: err.message } }));
    writeSSE(res, '[DONE]');
    res.end();
  };

  const joined = coalescer.join(coalescerKey, onChunk, onEnd, onError);

  // 6. Disconnect detection
  req.on('close', () => {
    coalescer.unsubscribe(coalescerKey, onChunk);

    // If no subscribers remain, abort the upstream request
    if (coalescer.subscriberCount(coalescerKey) === 0) {
      ac.abort();
    }
  });

  // 7. If we're the first subscriber, make the upstream request
  if (!joined) {
    // Heartbeat while waiting for upstream
    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': heartbeat\n\n');
    }, 15_000);

    try {
      await streamFromUpstream(chatReq, coalescerKey, ac.signal);
    } finally {
      clearInterval(heartbeat);
    }
  }
}

// --- Server ---

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/v1/chat/completions') {
    try {
      await handleChatRequest(req, res);
    } catch (err: unknown) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: { message: 'Internal server error' },
        }));
      }
    }
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  res.writeHead(404).end('Not found');
});

server.headersTimeout = 10_000;
server.requestTimeout = 600_000;  // 10 minutes — LLM responses can be long
server.keepAliveTimeout = 65_000;

server.listen(PORT, () => {
  console.log(`LLM Gateway listening on :${PORT}`);
});
// run: LLM_API_KEY=sk-... node --experimental-strip-types llm-gateway.ts
```

### Stage 4: OpenTelemetry instrumentation

Add tracing and metrics to every stage of the gateway. This uses the OpenTelemetry SDK:

```typescript
// otel-setup.ts
// npm install @opentelemetry/sdk-node @opentelemetry/api
//             @opentelemetry/sdk-trace-node @opentelemetry/sdk-metrics
//             @opentelemetry/exporter-trace-otlp-http
//             @opentelemetry/instrumentation-http

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { Resource } from '@opentelemetry/resources';

const sdk = new NodeSDK({
  resource: new Resource({ 'service.name': 'llm-gateway' }),
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [new HttpInstrumentation()],
});

sdk.start();

process.on('SIGTERM', async () => {
  await sdk.shutdown();
  process.exit(0);
});

export { sdk };
// run: node --experimental-strip-types otel-setup.ts
```

Then instrument the gateway's hot path with custom spans:

```typescript
// instrumented-handler.ts (sketch — integrates with the gateway above)
import { trace, type Span, SpanStatusCode, metrics } from '@opentelemetry/api';

const tracer = trace.getTracer('llm-gateway');
const meter = metrics.getMeter('llm-gateway');

// Metrics
const requestCounter = meter.createCounter('llm.requests.total', {
  description: 'Total LLM proxy requests',
});
const tokenCounter = meter.createCounter('llm.tokens.streamed', {
  description: 'Total tokens streamed to clients',
});
const latencyHistogram = meter.createHistogram('llm.request.duration_ms', {
  description: 'End-to-end request duration in ms',
});
const rateLimitCounter = meter.createCounter('llm.rate_limited.total', {
  description: 'Requests rejected by rate limiter',
});

async function handleWithTelemetry(
  req: { model: string; clientKey: string },
  process: () => Promise<{ tokenCount: number }>,
): Promise<void> {
  const span: Span = tracer.startSpan('llm.proxy', {
    attributes: {
      'llm.model': req.model,
      'llm.client': req.clientKey,
    },
  });

  const start = performance.now();
  requestCounter.add(1, { model: req.model });

  try {
    const result = await process();
    tokenCounter.add(result.tokenCount, { model: req.model });
    span.setStatus({ code: SpanStatusCode.OK });
  } catch (err: unknown) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : 'unknown',
    });
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    throw err;
  } finally {
    const duration = performance.now() - start;
    latencyHistogram.record(duration, { model: req.model });
    span.setAttribute('llm.duration_ms', duration);
    span.end();
  }
}
// run: node --experimental-strip-types instrumented-handler.ts
```

### Key metrics for an LLM gateway

| Metric | Type | Why it matters |
|--------|------|----------------|
| `llm.requests.total` | Counter | Traffic volume by model |
| `llm.tokens.streamed` | Counter | Cost tracking (tokens = money) |
| `llm.request.duration_ms` | Histogram | Latency SLO monitoring (p50, p95, p99) |
| `llm.rate_limited.total` | Counter | Detect if limits are too aggressive |
| `llm.coalesced.total` | Counter | Measure deduplication savings |
| `llm.aborted.total` | Counter | Track client disconnects |
| `llm.upstream.errors` | Counter | Detect provider degradation |
| `process.eventloop.utilization` | Gauge | Ensure the gateway isn't CPU-bound |

### End-to-end abort flow

The abort chain through the entire system:

```
Client closes tab
  → TCP FIN arrives at Node
    → req 'close' event fires
      → coalescer.unsubscribe() removes this subscriber
        → if subscriberCount === 0:
          → ac.abort() called
            → AbortSignal transitions to aborted
              → fetch() rejects with AbortError
                → upstream TCP socket destroyed
                  → LLM provider stops generating tokens
```

Every link in this chain is necessary. If any link is missing:
- Missing `req.on('close')`: the gateway never learns the client left.
- Missing `ac.abort()`: the upstream fetch continues, burning tokens.
- Missing `signal` in `fetch()`: the abort has no effect on the upstream.
- Missing coalescer subscriber tracking: the gateway aborts even though other clients are still listening.

### Production hardening checklist

```typescript
// production-config.ts — additional concerns for a real deployment

// 1. Request body size limit (prevent abuse)
const MAX_BODY_SIZE = 1024 * 1024; // 1MB

// 2. Request validation
function validateRequest(body: unknown): body is ChatCompletionRequest {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Record<string, unknown>;
  if (typeof b.model !== 'string') return false;
  if (!Array.isArray(b.messages)) return false;
  if (b.messages.length === 0) return false;
  if (b.messages.length > 100) return false; // prevent absurd context windows
  return true;
}

// 3. Allowed models (prevent users from requesting expensive models)
const ALLOWED_MODELS = new Set([
  'gpt-4o',
  'gpt-4o-mini',
  'claude-sonnet-4-20250514',
]);

// 4. Per-model rate limits
const MODEL_COSTS: Record<string, number> = {
  'gpt-4o': 3,        // costs 3 tokens per request
  'gpt-4o-mini': 1,   // costs 1 token per request
};

// 5. Graceful shutdown
function setupGracefulShutdown(server: import('node:http').Server): void {
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down gracefully...');

    // Stop accepting new connections
    server.close(() => {
      console.log('All connections drained');
      process.exit(0);
    });

    // Force exit after 30 seconds
    setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 30_000).unref();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
// run: node --experimental-strip-types production-config.ts
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Coalescing with non-deterministic models.** You coalesce requests by hashing model + messages, but the model has `temperature > 0`. Two users expect different random outputs but get the same one. This can be acceptable (cost savings outweigh personalization) or a bug (users notice identical responses). Fix: only coalesce when `temperature === 0` or when the use case explicitly allows it (e.g., embeddings, which are deterministic).

**2. Token bucket drift across instances.** Your in-memory rate limiter works perfectly on one pod. With three pods behind a load balancer, each pod has its own bucket — a user gets 3x the allowed rate. Fix: use Redis-backed rate limiting with an atomic Lua script (`redis.call('DECRBY', key, cost)`) or use a sliding-window counter in Redis.

**3. Upstream timeout kills long completions.** Your `requestTimeout` is 60 seconds, but GPT-4 generating a long code block takes 90 seconds. The gateway kills the connection mid-stream. The client gets a truncated response. Fix: set `requestTimeout` on the gateway to match the maximum expected LLM response time (e.g., 10 minutes for very long completions). Use a separate, short timeout for the *upstream connection* phase only.

**4. Memory leak from abandoned coalescer entries.** A network error kills the upstream fetch, but the `catch` block doesn't call `coalescer.error()`. The inflight map entry is never cleaned up. Subscribers wait forever, and the map grows. Fix: always clean up in `finally` blocks; add a TTL-based sweep that removes entries older than the maximum expected response time.
:::

## 🎯 Checkpoint

::: details Question 1 — Abort chain completeness
**Q:** A client disconnects during an LLM stream. The upstream request is NOT aborted and continues to completion. Name three possible places where the abort chain is broken.

**A:** (1) The `req.on('close')` handler is not registered — the server never detects the disconnect. (2) The handler calls `ac.abort()`, but the `AbortSignal` was not passed to `fetch()` — the upstream request has no signal to listen to. (3) The handler calls `ac.abort()`, the signal was passed to `fetch()`, but the coalescer still has other subscribers — `ac.abort()` is correctly gated behind `subscriberCount === 0`, and in this case there are other active subscribers, so the upstream request correctly continues. This last case is *not* a bug — it's the correct behavior for coalesced requests. The actual bugs are (1) and (2). A subtler case: (4) the upstream LLM API does not respect connection closure — even when the TCP socket is destroyed, some providers continue processing and charge for the full completion. In this case, the gateway did everything right, but the provider's behavior prevents true cancellation.
:::

::: details Question 2 — Rate limiting under load balancing
**Q:** Your LLM gateway runs on 4 pods behind a round-robin load balancer. Each pod has an in-memory token bucket allowing 60 requests/minute per API key. What is the actual rate limit a user experiences? How do you fix this?

**A:** With round-robin distribution, each pod sees roughly 1/4 of a user's requests and applies its own 60 req/min limit independently. The user can make approximately 240 requests/minute (60 per pod x 4 pods). Fix: move the rate-limiting state to a shared store (Redis). Use an atomic Lua script that decrements the token count and sets expiry in a single operation, avoiding race conditions. Example: `EVALSHA <sha> 1 ratelimit:<api_key> <max_tokens> <refill_rate> <now>`. Alternatively, use a sliding-window log in Redis (a sorted set with timestamps as scores), which is more accurate but more expensive per operation. A third option is to use a dedicated rate-limiting service (e.g., Envoy's rate-limit service) at the load balancer layer.
:::

::: details Question 3 — Coalescing correctness
**Q:** When is request coalescing safe for LLM completions, and when is it dangerous?

**A:** Coalescing is safe when: (1) the model and full input (messages, system prompt) are identical, AND (2) the output is deterministic (`temperature = 0`, or embeddings/classifications). It is also safe when users explicitly accept shared responses (e.g., a cached FAQ bot). Coalescing is dangerous when: (1) `temperature > 0` and users expect unique creative responses, (2) the request includes user-specific context that should produce personalized output (even with `temperature = 0`, function calling and tool use may produce different results based on timing), (3) the response has side effects (tool calls, function execution) that should not be duplicated across users. A safe middle ground: coalesce only the network call but maintain per-user response streams, and use a cryptographic hash of the complete request body (including all parameters) as the coalescing key. If any parameter differs, a separate upstream request is made.
:::

## Key Mental Models

- **An LLM gateway is a streaming reverse proxy with economics.** Every token costs money. Cancellation, coalescing, and rate limiting are not features — they are cost controls.
- **The abort chain is only as strong as its weakest link.** `req.on('close')` to `AbortController` to `fetch(signal)` — skip any link and you burn money on tokens nobody reads.
- **Coalescing is a cache for in-flight requests.** It works like single-flight in Go: the first identical request fires; subsequent ones ride along. But it requires determinism to be correct.
- **Rate limiting must be centralized for distributed deployments.** In-memory buckets give N-times the intended rate across N pods. Redis (or an external rate-limit service) is mandatory.
- **Observability is not optional for cost-bearing proxies.** Track tokens, latency, and abort rates. The metrics tell you whether your gateway is saving or wasting money.

## Related

- [SSE & LLM Token Streaming](/nodejs/module-04/04-sse-streaming) — the SSE protocol and token streaming fundamentals this gateway builds on
- [AbortController & AbortSignal](/nodejs/module-03/03-abort-controller) — the cooperative cancellation mechanism powering the abort chain
- [Rate Limiting](/system-design/scaling/02-rate-limiting) — token bucket and sliding window algorithms in depth
- [OpenTelemetry](/nodejs/module-09/03-opentelemetry) — instrumentation, auto-hooking via async_hooks, and exporter configuration
- [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure) — why `res.write()` returns false and how to handle it
