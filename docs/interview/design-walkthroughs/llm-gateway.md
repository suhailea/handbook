---
title: LLM Gateway
outline: deep
---

# LLM Gateway

## The Problem

Design a production-grade LLM gateway that sits between your application's tenants and multiple LLM providers (OpenAI, Anthropic, Google). The system must:

- **Stream** responses token-by-token to clients via SSE (Server-Sent Events)
- Abstract over multiple providers behind a unified API
- Enforce per-tenant rate limiting (token bucket) and usage quotas
- Support request coalescing for identical prompts within a short window
- Propagate client abort signals end-to-end (client disconnects -> provider request cancelled)
- Track cost, latency, and token usage via OpenTelemetry
- Handle provider failures with automatic fallback

## Clarifying Questions

| Question | Assumed answer |
|---|---|
| How many tenants? | ~5,000 active tenants |
| Peak concurrent requests? | ~2,000 concurrent streaming requests |
| Average response time? | 5-30 seconds (streaming, token-by-token) |
| Request coalescing scope? | Same tenant, same model, same prompt (exact match), within 10s window |
| Provider SLA? | OpenAI ~99.5%, Anthropic ~99.5%. Gateway target: 99.9% via fallback |
| Cost tracking granularity? | Per-request, aggregated per-tenant per-day for billing |
| Maximum context size? | Up to 200K tokens input, 8K tokens output |

## High-Level Architecture

```
  ┌───────────────────────────────────────────────────────────┐
  │                        Clients                            │
  │  (Web apps, mobile, internal services)                    │
  └──────────────────────┬────────────────────────────────────┘
                         │ SSE / HTTP POST
                         ▼
  ┌──────────────────────────────────────────────────────────┐
  │                   Load Balancer                          │
  │            (L7, with SSE support)                        │
  └──────────────────────┬───────────────────────────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
  │ Gateway Pod │ │ Gateway Pod │ │ Gateway Pod │
  │             │ │             │ │             │
  │ ┌─────────┐ │ │             │ │             │
  │ │Coalesce │ │ │             │ │             │
  │ │  Cache  │ │ │             │ │             │
  │ └─────────┘ │ │             │ │             │
  └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
         │               │               │
         └───────────────┼───────────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │ Redis  │ │  OTel  │ │ Cost   │
         │ (rate  │ │Collctr │ │  DB    │
         │ limits)│ │        │ │        │
         └────────┘ └────────┘ └────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
  │   OpenAI    │ │  Anthropic  │ │   Google     │
  │   API       │ │   API       │ │   API        │
  └─────────────┘ └─────────────┘ └─────────────┘
```

## Detailed Design

### Component 1: Unified Provider Abstraction

Each provider has its own API format. The gateway normalizes to a common interface.

```typescript
// run: npx tsx provider-abstraction.ts

interface GatewayRequest {
  tenantId: string;
  model: string;             // e.g., "gpt-4o", "claude-sonnet-4-20250514", "gemini-pro"
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  stream: boolean;
  signal?: AbortSignal;      // For abort propagation
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface StreamChunk {
  type: 'token' | 'done' | 'error';
  content?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

interface LLMProvider {
  name: string;
  models: string[];
  stream(request: GatewayRequest): AsyncGenerator<StreamChunk>;
  estimateCost(inputTokens: number, outputTokens: number, model: string): number;
}

// Provider registry
const providers = new Map<string, LLMProvider>();

function resolveProvider(model: string): LLMProvider {
  for (const [, provider] of providers) {
    if (provider.models.includes(model)) {
      return provider;
    }
  }
  throw new Error(`No provider found for model: ${model}`);
}

// Model to fallback chain
const FALLBACK_CHAINS: Record<string, string[]> = {
  'gpt-4o':            ['gpt-4o', 'claude-sonnet-4-20250514'],
  'claude-sonnet-4-20250514':   ['claude-sonnet-4-20250514', 'gpt-4o'],
  'gemini-pro':        ['gemini-pro', 'gpt-4o', 'claude-sonnet-4-20250514'],
};
```

### Component 2: Streaming Proxy with Abort Propagation

The core of the gateway: proxy SSE from the provider to the client, with full abort propagation.

```typescript
// run: npx tsx streaming-proxy.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

async function handleStreamingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  gatewayReq: GatewayRequest,
): Promise<void> {
  // Set up SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // Disable nginx buffering
  });

  // Create an AbortController that cancels when the client disconnects
  const controller = new AbortController();
  const { signal } = controller;

  // Client disconnect → abort upstream request
  req.on('close', () => {
    if (!res.writableEnded) {
      controller.abort();
      console.log(`Client disconnected, aborting upstream for tenant ${gatewayReq.tenantId}`);
    }
  });

  // Resolve provider with fallback
  const fallbackChain = FALLBACK_CHAINS[gatewayReq.model] ?? [gatewayReq.model];
  let lastError: Error | null = null;

  for (const model of fallbackChain) {
    if (signal.aborted) break;

    try {
      const provider = resolveProvider(model);
      const requestWithSignal = { ...gatewayReq, model, signal };

      let totalOutputTokens = 0;

      for await (const chunk of provider.stream(requestWithSignal)) {
        if (signal.aborted) break;

        switch (chunk.type) {
          case 'token':
            totalOutputTokens++;
            res.write(`data: ${JSON.stringify({ token: chunk.content })}\n\n`);
            break;

          case 'done':
            res.write(`data: ${JSON.stringify({
              done: true,
              usage: chunk.usage,
              model,
              provider: provider.name,
            })}\n\n`);
            res.end();
            return; // Success — exit fallback loop

          case 'error':
            throw new Error(chunk.error);
        }
      }

      return; // Stream completed normally
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only try fallback for provider errors, not client aborts
      if (signal.aborted) break;

      console.warn(`Provider ${model} failed, trying next: ${lastError.message}`);
    }
  }

  // All providers failed
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({
      error: true,
      message: lastError?.message ?? 'All providers failed',
    })}\n\n`);
    res.end();
  }
}

// Types needed for compilation (defined in component 1)
interface GatewayRequest {
  tenantId: string;
  model: string;
  messages: { role: string; content: string }[];
  maxTokens?: number;
  temperature?: number;
  stream: boolean;
  signal?: AbortSignal;
}

interface StreamChunk {
  type: 'token' | 'done' | 'error';
  content?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

interface LLMProvider {
  name: string;
  models: string[];
  stream(request: GatewayRequest): AsyncGenerator<StreamChunk>;
  estimateCost(inputTokens: number, outputTokens: number, model: string): number;
}

const FALLBACK_CHAINS: Record<string, string[]> = {};

function resolveProvider(_model: string): LLMProvider {
  throw new Error('Not implemented');
}
```

**Abort propagation chain:**
```
  Client disconnects
       │
       ▼
  req.on('close') fires
       │
       ▼
  AbortController.abort()
       │
       ▼
  AbortSignal passed to provider SDK
       │
       ▼
  Provider HTTP request cancelled (TCP RST or graceful close)
       │
       ▼
  No more tokens billed
```

This is critical for cost control. Without abort propagation, a disconnected client's request continues running at the provider, consuming tokens that nobody will read.

### Component 3: Per-Tenant Rate Limiting

Token bucket per tenant, checked before forwarding to the provider.

```typescript
// run: npx tsx tenant-rate-limit.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

interface TenantLimits {
  requestsPerMinute: number;
  requestsBurst: number;
  tokensPerDay: number;
}

const TENANT_TIERS: Record<string, TenantLimits> = {
  free:       { requestsPerMinute: 10,    requestsBurst: 3,   tokensPerDay: 50_000 },
  starter:    { requestsPerMinute: 60,    requestsBurst: 15,  tokensPerDay: 500_000 },
  pro:        { requestsPerMinute: 300,   requestsBurst: 50,  tokensPerDay: 5_000_000 },
  enterprise: { requestsPerMinute: 1_000, requestsBurst: 200, tokensPerDay: 50_000_000 },
};

const RATE_LIMIT_LUA = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  local data = redis.call('HMGET', key, 'tokens', 'ts')
  local tokens = tonumber(data[1]) or capacity
  local last_ts = tonumber(data[2]) or now

  local elapsed = math.max(0, now - last_ts)
  tokens = math.min(capacity, tokens + (elapsed * refill_rate / 1000))

  if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tostring(tokens), 'ts', tostring(now))
    redis.call('EXPIRE', key, 120)
    return { 1, math.floor(tokens) }
  else
    local retry_ms = math.ceil((1 - tokens) / refill_rate * 1000)
    return { 0, retry_ms }
  end
`;

// Daily token quota check (separate from request rate)
const QUOTA_CHECK_LUA = `
  local key = KEYS[1]
  local limit = tonumber(ARGV[1])
  local tokens_used = tonumber(ARGV[2])

  local current = tonumber(redis.call('GET', key) or '0')
  if current + tokens_used > limit then
    return { 0, limit - current }  -- rejected, remaining
  end
  return { 1, limit - current - tokens_used }  -- allowed, remaining
`;

async function checkTenantLimits(
  tenantId: string,
  tier: string,
  estimatedTokens: number,
): Promise<{ allowed: boolean; reason?: string; retryAfterMs?: number }> {
  const limits = TENANT_TIERS[tier] ?? TENANT_TIERS['free'];

  // Check 1: Request rate limit (token bucket)
  const rateResult = (await redis.eval(RATE_LIMIT_LUA, {
    keys: [`rl:req:${tenantId}`],
    arguments: [
      limits.requestsBurst.toString(),
      (limits.requestsPerMinute / 60).toString(),
      Date.now().toString(),
    ],
  })) as number[];

  if (rateResult[0] === 0) {
    return {
      allowed: false,
      reason: 'Request rate limit exceeded',
      retryAfterMs: rateResult[1],
    };
  }

  // Check 2: Daily token quota
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const quotaResult = (await redis.eval(QUOTA_CHECK_LUA, {
    keys: [`quota:${tenantId}:${today}`],
    arguments: [limits.tokensPerDay.toString(), estimatedTokens.toString()],
  })) as number[];

  if (quotaResult[0] === 0) {
    return {
      allowed: false,
      reason: 'Daily token quota exceeded',
    };
  }

  return { allowed: true };
}

// After successful completion, record actual token usage
async function recordTokenUsage(
  tenantId: string,
  inputTokens: number,
  outputTokens: number,
): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const totalTokens = inputTokens + outputTokens;

  await redis.incrBy(`quota:${tenantId}:${today}`, totalTokens);
  await redis.expire(`quota:${tenantId}:${today}`, 172_800); // 48h TTL
}
```

### Component 4: Request Coalescing

When multiple tenants (or requests from the same tenant) send the exact same prompt within a short window, reuse the response.

```typescript
// run: npx tsx request-coalescing.ts
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

interface CoalesceEntry {
  emitter: EventEmitter;
  tokens: string[];
  done: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

class RequestCoalescer {
  private cache = new Map<string, CoalesceEntry>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private windowMs = 10_000) {
    this.cleanupInterval = setInterval(() => this.cleanup(), 30_000);
  }

  // Generate a cache key from the request (model + messages hash)
  private makeKey(model: string, messages: { role: string; content: string }[]): string {
    const hash = createHash('sha256')
      .update(JSON.stringify({ model, messages }))
      .digest('hex')
      .substring(0, 16);
    return `coalesce:${hash}`;
  }

  // Returns an existing stream if one is in flight, or null if this is the first request
  tryCoalesce(
    model: string,
    messages: { role: string; content: string }[],
  ): AsyncGenerator<string> | null {
    const key = this.makeKey(model, messages);
    const existing = this.cache.get(key);

    if (!existing || existing.done) return null;

    // Attach to existing stream — replay tokens already received, then follow live
    return this.replayAndFollow(existing);
  }

  // Register a new in-flight request
  register(
    model: string,
    messages: { role: string; content: string }[],
  ): {
    key: string;
    addToken: (token: string) => void;
    complete: (usage: { inputTokens: number; outputTokens: number }) => void;
  } {
    const key = this.makeKey(model, messages);
    const entry: CoalesceEntry = {
      emitter: new EventEmitter(),
      tokens: [],
      done: false,
    };
    this.cache.set(key, entry);

    // Auto-expire
    setTimeout(() => this.cache.delete(key), this.windowMs);

    return {
      key,
      addToken: (token: string) => {
        entry.tokens.push(token);
        entry.emitter.emit('token', token);
      },
      complete: (usage) => {
        entry.done = true;
        entry.usage = usage;
        entry.emitter.emit('done', usage);
      },
    };
  }

  private async *replayAndFollow(entry: CoalesceEntry): AsyncGenerator<string> {
    // Replay buffered tokens
    for (const token of entry.tokens) {
      yield token;
    }

    if (entry.done) return;

    // Follow live tokens
    let tokenIndex = entry.tokens.length;
    while (!entry.done) {
      await new Promise<void>((resolve) => {
        const onToken = () => resolve();
        const onDone = () => resolve();
        entry.emitter.once('token', onToken);
        entry.emitter.once('done', onDone);
      });

      // Yield any new tokens since we last checked
      while (tokenIndex < entry.tokens.length) {
        yield entry.tokens[tokenIndex++];
      }
    }
  }

  private cleanup(): void {
    // Remove completed entries older than windowMs
    // (handled by setTimeout in register, but cleanup catches edge cases)
  }

  stop(): void {
    clearInterval(this.cleanupInterval);
  }
}
```

**Coalescing trade-offs:**
- Only safe for deterministic or temperature-0 requests. At temperature > 0, responses should differ.
- Privacy: never coalesce across tenants if prompts contain tenant-specific data.
- In practice, coalescing is most valuable for system prompts + common user queries (e.g., "summarize this public document" from multiple users).

### Component 5: Cost Tracking with OpenTelemetry

```typescript
// run: npx tsx cost-tracking.ts
import { trace, metrics, type Span } from '@opentelemetry/api';

const tracer = trace.getTracer('llm-gateway');
const meter = metrics.getMeter('llm-gateway');

// Metrics
const requestCounter = meter.createCounter('llm.requests.total', {
  description: 'Total LLM requests',
});
const tokenCounter = meter.createCounter('llm.tokens.total', {
  description: 'Total tokens processed',
});
const costCounter = meter.createCounter('llm.cost.usd', {
  description: 'Total cost in USD',
});
const latencyHistogram = meter.createHistogram('llm.request.duration_ms', {
  description: 'Request duration in milliseconds',
});
const ttftHistogram = meter.createHistogram('llm.time_to_first_token_ms', {
  description: 'Time to first token in milliseconds',
});

// Cost per 1K tokens (simplified, varies by model)
const COST_PER_1K_TOKENS: Record<string, { input: number; output: number }> = {
  'gpt-4o':           { input: 0.0025, output: 0.01 },
  'gpt-4o-mini':      { input: 0.00015, output: 0.0006 },
  'claude-sonnet-4-20250514':  { input: 0.003, output: 0.015 },
  'claude-haiku':     { input: 0.00025, output: 0.00125 },
};

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = COST_PER_1K_TOKENS[model];
  if (!pricing) return 0;
  return (inputTokens / 1000) * pricing.input +
         (outputTokens / 1000) * pricing.output;
}

interface RequestTelemetry {
  tenantId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  ttftMs: number;
  success: boolean;
  cached: boolean;
}

function recordRequestTelemetry(telemetry: RequestTelemetry): void {
  const labels = {
    tenant_id: telemetry.tenantId,
    model: telemetry.model,
    provider: telemetry.provider,
    success: String(telemetry.success),
    cached: String(telemetry.cached),
  };

  requestCounter.add(1, labels);
  tokenCounter.add(telemetry.inputTokens, { ...labels, direction: 'input' });
  tokenCounter.add(telemetry.outputTokens, { ...labels, direction: 'output' });
  latencyHistogram.record(telemetry.durationMs, labels);
  ttftHistogram.record(telemetry.ttftMs, labels);

  const cost = calculateCost(telemetry.model, telemetry.inputTokens, telemetry.outputTokens);
  costCounter.add(cost, labels);
}

// Span for tracing a complete request
function createRequestSpan(
  tenantId: string,
  model: string,
): Span {
  return tracer.startSpan('llm.request', {
    attributes: {
      'llm.tenant_id': tenantId,
      'llm.model': model,
      'llm.stream': true,
    },
  });
}
```

**Key metrics to alert on:**
- `llm.time_to_first_token_ms` p99 > 5s (provider degradation)
- `llm.requests.total` with `success=false` > 5% (provider outage, trigger fallback)
- `llm.cost.usd` per tenant per day approaching quota (proactive notification)
- `llm.tokens.total` rate spike (potential abuse or prompt injection attack)

### Component 6: Full Request Handler (Putting It Together)

```typescript
// run: npx tsx gateway-handler.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

async function handleLLMRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  // 1. Parse and validate request
  const body = await readBody(req);
  const tenantId = req.headers['x-tenant-id'] as string;
  if (!tenantId || !body.model || !body.messages) {
    res.writeHead(400);
    res.end(JSON.stringify({ error: 'Missing required fields' }));
    return;
  }

  // 2. Check rate limits
  const tier = 'pro'; // Look up from tenant config
  const limitCheck = await checkTenantLimits(tenantId, tier, estimateInputTokens(body));
  if (!limitCheck.allowed) {
    res.writeHead(429, {
      'Retry-After': limitCheck.retryAfterMs
        ? Math.ceil(limitCheck.retryAfterMs / 1000).toString()
        : '60',
    });
    res.end(JSON.stringify({ error: limitCheck.reason }));
    return;
  }

  // 3. Check coalescing cache
  const coalesced = coalescer.tryCoalesce(body.model, body.messages);
  if (coalesced) {
    // Serve from in-flight request
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    for await (const token of coalesced) {
      res.write(`data: ${JSON.stringify({ token })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ done: true, cached: true })}\n\n`);
    res.end();
    return;
  }

  // 4. Register for coalescing and stream from provider
  const coalescingHandle = coalescer.register(body.model, body.messages);
  const startTime = Date.now();
  let firstTokenTime = 0;

  // 5. Set up abort propagation
  const controller = new AbortController();
  req.on('close', () => controller.abort());

  // 6. Stream response (with provider fallback)
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });

  // ... (provider streaming logic as in Component 2)
  // On each token: coalescingHandle.addToken(token), res.write(...)
  // On completion: coalescingHandle.complete(usage), recordRequestTelemetry(...)
  // On error: try fallback chain

  res.end();
}

// Helpers (simplified)
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function estimateInputTokens(body: Record<string, unknown>): number {
  // Rough estimate: 4 chars per token
  const text = JSON.stringify(body.messages);
  return Math.ceil(text.length / 4);
}

// Placeholder references to previously defined components
declare function checkTenantLimits(
  tenantId: string, tier: string, tokens: number
): Promise<{ allowed: boolean; reason?: string; retryAfterMs?: number }>;

const coalescer = {
  tryCoalesce: (_m: string, _msgs: unknown[]): AsyncGenerator<string> | null => null,
  register: (_m: string, _msgs: unknown[]) => ({
    key: '',
    addToken: (_t: string) => {},
    complete: (_u: unknown) => {},
  }),
};
```

## Trade-offs & Alternatives

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Streaming protocol | SSE | WebSockets | SSE is simpler, HTTP-native, works through all proxies, sufficient for server→client |
| Rate limiting | Token bucket (Redis) | Fixed window | Token bucket allows configurable burst separate from sustained rate |
| Coalescing | In-process with hash key | Redis-based (cross-pod) | In-process is simpler; cross-pod coalescing rarely hits same prompt on different pods |
| Provider failover | Sequential fallback chain | Parallel hedging | Sequential is cheaper (no duplicate API calls); hedging wastes tokens |
| Cost tracking | OTel + async flush | Synchronous DB write | Never block the streaming path for billing |

**At 10x scale (20,000 concurrent streams):**
- Each SSE connection holds an HTTP connection open for 5-30 seconds. 20,000 concurrent connections is well within Node.js capability (100K+ is achievable with proper tuning).
- Redis becomes the bottleneck for rate limiting. Shard by tenant ID hash.
- Add a request queue with admission control: if all workers are at capacity, queue new requests rather than failing immediately. Show a "position in queue" via SSE.

**At 100x scale (200,000 concurrent streams):**
- Consider gRPC streaming between gateway pods and provider proxies for lower overhead.
- Edge-based admission control: reject or queue requests at the CDN layer before they reach the gateway.
- Implement semantic caching: use embedding similarity to serve cached responses for semantically similar (not just identical) prompts.

## Key Takeaways

- **Abort propagation is a cost control mechanism, not just a UX feature.** Every second of un-cancelled streaming costs money. Wire `req.on('close')` → `AbortController` → provider request cancellation.
- **SSE streaming requires `X-Accel-Buffering: no` in nginx.** Without it, nginx buffers the entire response before forwarding, defeating the purpose of streaming. This is the most common deployment issue.
- **Provider fallback is table stakes.** LLM providers have meaningful downtime. A gateway without fallback inherits the worst reliability of any single provider. With fallback, you can achieve higher availability than any provider alone.
- **Rate limiting for LLM gateways has two dimensions:** request rate (requests/minute) and token quota (tokens/day). Both must be enforced independently because a single request can consume vastly different token counts.
- **Cost tracking must be per-request, not just per-tenant aggregate.** You need per-request granularity to debug cost anomalies, detect abuse patterns, and provide transparent billing.
