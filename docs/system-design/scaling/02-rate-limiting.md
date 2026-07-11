---
title: Rate Limiting Algorithms
outline: deep
---

# Rate Limiting Algorithms

**Interview weight:** :fire::fire::fire: | **Prerequisites:** basic Redis knowledge, [Horizontal vs Vertical Scaling](./01-horizontal-vertical) | **Relevant to:** any public-facing API, multi-tenant SaaS, LLM gateways

## :speaking_head: In Plain English

::: tip In Plain English
Imagine a nightclub with a bouncer at the door. The club holds 200 people safely. The bouncer's job is simple: count how many are inside, and if it's full, tell the next person in line to wait or come back later.

But there are different ways the bouncer can count.

**Fixed window:** the bouncer has a clicker counter and resets it at the top of every hour. If 200 people enter between 8:00 and 8:59, the 201st is turned away. Problem: 150 people might arrive at 8:55 and another 150 at 9:05. That's 300 people in 10 minutes — well over capacity — but the bouncer sees two separate hours, each under 200. This is the **boundary problem**.

**Sliding window:** the bouncer doesn't reset at fixed times. Instead, he looks at the last 60 minutes from *right now*. It doesn't matter where the hour boundary falls — the count always covers the most recent window. More accurate, but the bouncer has to remember exactly when each person entered.

**Token bucket:** forget counting people. Instead, the club has a jar of tokens at the door. A token appears in the jar every 18 seconds (that's about 200 per hour). Each person takes a token to enter. No token, no entry. The jar can hold, say, 20 tokens — so if the club was quiet for a while, up to 20 people can enter in a burst. After that, they enter one at a time, as tokens appear.

The token bucket is elegant because it naturally allows **bursts** (the jar accumulates tokens during quiet periods) while still enforcing an **average rate** (tokens appear at a fixed pace). This is why it's the most popular algorithm for API rate limiting.
:::

## :gear: Under the Hood

### Algorithm 1: Fixed Window Counter

Divide time into fixed-size windows (e.g., 1-minute intervals). Count requests per window. Reject when the count exceeds the limit.

```
  Window: 10:00:00 – 10:00:59    Window: 10:01:00 – 10:01:59
  ┌────────────────────────┐    ┌────────────────────────┐
  │ ████████████ 95/100    │    │ ██ 12/100              │
  └────────────────────────┘    └────────────────────────┘
```

```typescript
// run: npx tsx fixed-window.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds)
}

async function fixedWindowRateLimit(
  key: string,
  limit: number,
  windowSizeSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSizeSeconds);
  const windowKey = `ratelimit:${key}:${windowStart}`;
  const resetAt = windowStart + windowSizeSeconds;

  const current = await redis.incr(windowKey);

  // Set expiry only on first request in the window
  if (current === 1) {
    await redis.expire(windowKey, windowSizeSeconds);
  }

  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
    resetAt,
  };
}

// Test
const result = await fixedWindowRateLimit('user:42', 100, 60);
console.log(result);
// { allowed: true, remaining: 99, resetAt: 1720000020 }
```

**Problem: boundary burst.** A client sends 100 requests at 10:00:59 and another 100 at 10:01:00. Both windows see exactly 100 (at the limit), but the server processed 200 requests in 2 seconds.

### Algorithm 2: Sliding Window Log

Store the timestamp of every request. To check the limit, count timestamps within the last `windowSize` seconds.

```typescript
// run: npx tsx sliding-window-log.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

async function slidingWindowLog(
  key: string,
  limit: number,
  windowSizeMs: number,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowStart = now - windowSizeMs;
  const windowKey = `ratelimit:swl:${key}`;

  // Use a Redis sorted set: score = timestamp, member = unique request ID
  const multi = redis.multi();
  multi.zRemRangeByScore(windowKey, 0, windowStart);         // Remove expired entries
  multi.zAdd(windowKey, [{ score: now, value: `${now}:${Math.random()}` }]);
  multi.zCard(windowKey);                                      // Count entries in window
  multi.expire(windowKey, Math.ceil(windowSizeMs / 1000) + 1); // Cleanup TTL

  const results = await multi.exec();
  const count = results[2] as number;

  if (count > limit) {
    // Over limit — remove the entry we just added
    await redis.zRemRangeByScore(windowKey, now, now);
    return {
      allowed: false,
      remaining: 0,
      resetAt: Math.ceil((windowStart + windowSizeMs) / 1000),
    };
  }

  return {
    allowed: true,
    remaining: limit - count,
    resetAt: Math.ceil((now + windowSizeMs) / 1000),
  };
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}
```

**Trade-off:** precise, no boundary problem. But memory scales with request volume — if the limit is 10,000 req/min, each user's sorted set stores 10,000 entries. For high-volume APIs, this is expensive.

### Algorithm 3: Sliding Window Counter

A hybrid: use two fixed windows and interpolate. Much less memory than the log approach, nearly as accurate.

```
  Previous window: 70 requests    Current window: 30 requests (40% elapsed)
  ┌────────────────┐┌────────────────┐
  │ ████████ 70    ││ ███ 30         │
  └────────────────┘└────────────────┘
                     ↑ we are here (40% into current window)

  Weighted count = 30 + 70 * (1 - 0.4) = 30 + 42 = 72
```

```typescript
// run: npx tsx sliding-window-counter.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

async function slidingWindowCounter(
  key: string,
  limit: number,
  windowSizeSeconds: number,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const currentWindowStart = now - (now % windowSizeSeconds);
  const previousWindowStart = currentWindowStart - windowSizeSeconds;
  const elapsedRatio = (now - currentWindowStart) / windowSizeSeconds;

  const currentKey = `ratelimit:swc:${key}:${currentWindowStart}`;
  const previousKey = `ratelimit:swc:${key}:${previousWindowStart}`;

  // Get both window counts
  const [previousCount, currentCount] = await Promise.all([
    redis.get(previousKey).then((v) => parseInt(v ?? '0', 10)),
    redis.get(currentKey).then((v) => parseInt(v ?? '0', 10)),
  ]);

  // Weighted count: full current + fraction of previous
  const weightedCount = currentCount + previousCount * (1 - elapsedRatio);

  if (weightedCount >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: currentWindowStart + windowSizeSeconds,
    };
  }

  // Increment current window
  const multi = redis.multi();
  multi.incr(currentKey);
  multi.expire(currentKey, windowSizeSeconds * 2); // Keep for 2 windows
  await multi.exec();

  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(limit - weightedCount - 1)),
    resetAt: currentWindowStart + windowSizeSeconds,
  };
}
```

**Trade-off:** only 2 keys per user (current + previous window). Memory is constant regardless of request volume. Accuracy is approximate (error bounded by the fraction of the previous window that's included).

### Algorithm 4: Token Bucket

The most widely used algorithm. Models a bucket that refills with tokens at a fixed rate. Each request consumes one token. The bucket has a maximum capacity that allows bursts.

```
  Bucket capacity: 10 tokens
  Refill rate: 2 tokens/second

  t=0:  [■■■■■■■■■■] 10/10  → request → [■■■■■■■■■ ] 9/10
  t=0.5:[■■■■■■■■■■] 10/10  → (refilled 1, capped at 10)
  t=0.5:                     → 5 burst requests → [■■■■■ ] 5/10
  t=1.0:[■■■■■■ ] 6/10      → (refilled 1 more)
```

```typescript
// run: npx tsx token-bucket.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

interface TokenBucketResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number | null;
}

// Lua script for atomic token bucket — runs entirely on Redis server
const TOKEN_BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])   -- tokens per second
  local now = tonumber(ARGV[3])            -- current time in ms
  local requested = tonumber(ARGV[4])      -- tokens to consume (usually 1)

  local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens = tonumber(bucket[1])
  local last_refill = tonumber(bucket[2])

  -- Initialize bucket if it doesn't exist
  if tokens == nil then
    tokens = capacity
    last_refill = now
  end

  -- Calculate tokens to add since last refill
  local elapsed_ms = now - last_refill
  local new_tokens = elapsed_ms * refill_rate / 1000
  tokens = math.min(capacity, tokens + new_tokens)

  local allowed = 0
  local retry_after_ms = 0

  if tokens >= requested then
    tokens = tokens - requested
    allowed = 1
  else
    -- How long until enough tokens accumulate?
    local deficit = requested - tokens
    retry_after_ms = math.ceil(deficit / refill_rate * 1000)
  end

  -- Save state
  redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
  redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)

  return { allowed, math.floor(tokens), retry_after_ms }
`;

async function tokenBucket(
  key: string,
  capacity: number,
  refillRatePerSecond: number,
  tokensToConsume = 1,
): Promise<TokenBucketResult> {
  const now = Date.now();
  const result = await redis.eval(TOKEN_BUCKET_SCRIPT, {
    keys: [`ratelimit:tb:${key}`],
    arguments: [
      capacity.toString(),
      refillRatePerSecond.toString(),
      now.toString(),
      tokensToConsume.toString(),
    ],
  }) as number[];

  return {
    allowed: result[0] === 1,
    remaining: result[1],
    retryAfterMs: result[0] === 1 ? null : result[2],
  };
}

// Test: 100 req/min = 1.67 req/s, burst up to 10
const r = await tokenBucket('apikey:abc123', 10, 100 / 60);
console.log(r);
```

**Why a Lua script?** The read-compute-write must be atomic. Without Lua, two concurrent requests could read the same token count, both decide there's capacity, and both consume a token — allowing 2 requests when only 1 should have been allowed. Redis executes Lua scripts atomically (single-threaded).

### Algorithm Comparison

| Algorithm | Memory per key | Boundary problem | Burst support | Accuracy | Complexity |
|---|---|---|---|---|---|
| Fixed window | O(1) | Yes | No | Low | Low |
| Sliding window log | O(N) requests | No | No | Exact | Medium |
| Sliding window counter | O(1) | Minimal | No | Good (~99.7%) | Medium |
| Token bucket | O(1) | No | Yes (capacity) | Exact | Medium |

### Rate Limiting Headers

Standard headers to include in responses (following the IETF draft `RateLimit` fields):

```typescript
// run: npx tsx rate-limit-headers.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: number; // Unix timestamp (seconds)
  retryAfterMs: number | null;
}

function setRateLimitHeaders(res: ServerResponse, info: RateLimitInfo): void {
  res.setHeader('RateLimit-Limit', info.limit);
  res.setHeader('RateLimit-Remaining', info.remaining);
  res.setHeader('RateLimit-Reset', info.resetAt);

  if (info.retryAfterMs !== null) {
    res.setHeader('Retry-After', Math.ceil(info.retryAfterMs / 1000));
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Extract API key from header
  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey) {
    res.writeHead(401);
    res.end('Missing API key');
    return;
  }

  // Check rate limit (would call tokenBucket or similar here)
  const rateLimitInfo: RateLimitInfo = {
    limit: 100,
    remaining: 42,
    resetAt: Math.floor(Date.now() / 1000) + 60,
    retryAfterMs: null,
  };

  setRateLimitHeaders(res, rateLimitInfo);

  if (!rateLimitInfo.remaining && rateLimitInfo.retryAfterMs) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Too Many Requests',
      retryAfter: Math.ceil(rateLimitInfo.retryAfterMs / 1000),
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'ok' }));
});

server.listen(3000);
```

### Complete Node.js + Redis Rate Limiter Middleware

Putting it all together: a production-grade rate limiter using the token bucket algorithm.

```typescript
// run: npx tsx rate-limiter-middleware.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const BUCKET_SCRIPT = `
  local key = KEYS[1]
  local capacity = tonumber(ARGV[1])
  local refill_rate = tonumber(ARGV[2])
  local now = tonumber(ARGV[3])

  local bucket = redis.call('HMGET', key, 'tokens', 'last_refill')
  local tokens = tonumber(bucket[1]) or capacity
  local last_refill = tonumber(bucket[2]) or now

  local elapsed_ms = math.max(0, now - last_refill)
  tokens = math.min(capacity, tokens + elapsed_ms * refill_rate / 1000)

  if tokens >= 1 then
    tokens = tokens - 1
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)
    return { 1, math.floor(tokens), 0 }
  else
    local retry_ms = math.ceil((1 - tokens) / refill_rate * 1000)
    redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
    redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 60)
    return { 0, 0, retry_ms }
  end
`;

interface RateLimitConfig {
  capacity: number;           // Max burst size
  refillRatePerSecond: number; // Sustained rate
}

// Tier-based limits
const TIERS: Record<string, RateLimitConfig> = {
  free:       { capacity: 10,  refillRatePerSecond: 1 },    // 60/min, burst 10
  pro:        { capacity: 50,  refillRatePerSecond: 10 },   // 600/min, burst 50
  enterprise: { capacity: 200, refillRatePerSecond: 100 },  // 6000/min, burst 200
};

async function rateLimitMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const apiKey = req.headers['x-api-key'] as string | undefined ?? 'anonymous';
  const tier = req.headers['x-tier'] as string | undefined ?? 'free';
  const config = TIERS[tier] ?? TIERS['free'];

  const result = await redis.eval(BUCKET_SCRIPT, {
    keys: [`ratelimit:${apiKey}`],
    arguments: [
      config.capacity.toString(),
      config.refillRatePerSecond.toString(),
      Date.now().toString(),
    ],
  }) as number[];

  const [allowed, remaining, retryAfterMs] = result;

  res.setHeader('RateLimit-Limit', config.capacity);
  res.setHeader('RateLimit-Remaining', remaining);
  res.setHeader('RateLimit-Reset', Math.floor(Date.now() / 1000) + Math.ceil(config.capacity / config.refillRatePerSecond));

  if (!allowed) {
    res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Too Many Requests',
      retryAfterSeconds: Math.ceil(retryAfterMs / 1000),
    }));
    return false;
  }

  return true;
}

// Server
const server = createServer(async (req, res) => {
  const allowed = await rateLimitMiddleware(req, res);
  if (!allowed) return;

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Hello, rate-limited world' }));
});

server.listen(3000, () => console.log('Rate-limited server on :3000'));
```

## :collision: Where It Bites (Production Lens)

::: warning Where It Bites

**1. Rate limiter becomes a single point of failure.** Your rate limiter runs on a single Redis instance. Redis goes down. Every request gets rejected (if you fail-closed) or every request is allowed (if you fail-open). **Symptom:** either all users get 429 errors or your backend gets hammered with unlimited traffic. **Diagnosis:** check Redis connectivity. **Fix:** decide on a fail-open policy with a fallback in-process rate limiter. In-process limiters don't coordinate across pods, but they provide *some* protection. Redis Sentinel or Cluster for HA.

**2. Clock skew in distributed rate limiting.** Each pod uses its own system clock to generate timestamps for the token bucket. If Pod A's clock is 2 seconds ahead of Pod B, they disagree on how many tokens have been refilled. **Symptom:** inconsistent rate limiting — some requests are allowed when they shouldn't be, and vice versa. **Fix:** the Lua script approach avoids this because Redis uses its own single clock. Never use the application server's clock in rate limit calculations — pass `Date.now()` only if Redis doesn't have its own time source, and even then, clock skew between app servers and Redis is typically <1ms in the same data center.

**3. Key-space explosion with per-endpoint rate limits.** You rate limit per user per endpoint: `ratelimit:user:42:/api/products`, `ratelimit:user:42:/api/orders`, etc. With 100,000 users and 50 endpoints, that's 5 million Redis keys. Each token bucket hash uses ~200 bytes. Total: ~1 GB just for rate limiting. **Symptom:** Redis memory creeping up; eviction starts affecting other cached data. **Fix:** consolidate — limit per user globally, not per endpoint. Or use shorter TTLs on rate limit keys so they expire quickly for inactive users. Consider a hierarchical approach: global rate limit + per-endpoint soft limits enforced in application code.

**4. Rate limiting by IP in a proxied environment.** You use `req.socket.remoteAddress` as the rate limit key. But your service is behind Cloudflare or an AWS ALB. Every request has the same remote address — the proxy's IP. One misbehaving user rate-limits *everyone*. **Symptom:** legitimate users getting 429 errors they didn't earn. **Fix:** use `X-Forwarded-For` (last trusted entry) or the CDN's specific header (e.g., `CF-Connecting-IP` for Cloudflare). But validate the header chain — don't trust `X-Forwarded-For` from an untrusted source, as it can be spoofed.
:::

## :dart: Checkpoint

::: details Question 1 — Token bucket vs sliding window
**Q:** A client sends 100 requests in the first second and then stops. With a token bucket (capacity=20, rate=100/min) vs a sliding window counter (limit=100/min), how does each algorithm handle this burst?

**A:** **Token bucket:** the bucket starts with 20 tokens (the capacity). The first 20 requests succeed immediately (consuming all tokens). Requests 21-100 are rejected. After the burst, the bucket refills at ~1.67 tokens/second. After ~48 seconds, the bucket is full again (20 tokens). Over one minute, the client gets exactly 20 requests through — well under the 100/min rate. The token bucket enforces the **burst limit** (capacity) separately from the **sustained rate** (refill rate). **Sliding window counter:** the window tracks 100 requests/minute. All 100 requests in the first second succeed because the window hasn't reached the limit yet. The 101st request (even a minute later) would be the one to potentially hit the limit. The sliding window has no concept of burst — it allows the full minute's budget to be consumed in one second. This is why token bucket is preferred when you need to control burst behavior. The capacity parameter gives you an explicit knob for burst size.
:::

::: details Question 2 — Redis failure mode
**Q:** Your rate limiter uses Redis. Redis becomes unreachable. Should you fail open (allow all requests) or fail closed (reject all requests)? Justify your choice for two different systems: (a) a payment API and (b) a public content API.

**A:** **(a) Payment API: fail closed** (reject requests). The cost of processing unlimited payment requests is financial loss, fraud, and potential compliance violations. It's better to temporarily return 503 and have users retry than to process unbounded transactions. However, implement a short grace period: if Redis is down for <5 seconds, allow requests at a reduced rate using an in-process fallback limiter. **(b) Public content API: fail open** (allow requests). The cost of rejecting legitimate read traffic is lost revenue and poor user experience. Unlimited reads are unlikely to damage the system (the database is protected by caching). Log the failure, alert the on-call team, and rely on other protections (connection limits, firewall rules) to prevent abuse during the outage. In general: fail closed when the *consequence of not limiting* is worse than the *consequence of rejecting legitimate traffic*.
:::

::: details Question 3 — Distributed consistency
**Q:** You have 10 pods, each running an in-process token bucket (no Redis). The limit is 100 req/min per API key. What effective limit does a client actually experience, and how do you fix it?

**A:** The client experiences an effective limit of **up to 1,000 req/min** (100 per pod x 10 pods), assuming the load balancer distributes requests evenly. If the distribution is uneven (sticky sessions or hash-based routing), the effective limit varies between 100 (all requests hit one pod) and 1,000 (evenly spread). **Fix:** centralize the token bucket state in Redis. All pods read from and write to the same Redis key, so the limit is enforced globally. The Lua script approach ensures atomicity even under concurrent access from multiple pods. If Redis latency is a concern, use a hybrid: local in-process rate limiter as a first pass (at a fraction of the global limit, e.g., 15 per pod), and only check Redis if the local limiter passes. This reduces Redis round-trips by ~85% while keeping accuracy.
:::

## :building_construction: Design It

**Scenario:** Design a rate limiter for a SaaS API: 100 req/min per API key, with the ability to burst up to 20 extra requests.

::: details Worked Solution

**Requirements decomposed:**
- Sustained rate: 100 requests per minute (~1.67/second)
- Burst: 20 extra requests (total instantaneous capacity: 20 tokens)
- After a burst of 20, new requests are allowed at 1.67/second
- Distributed: must work across N pods behind a load balancer
- Low latency: rate limit check must be <5ms p99

**Algorithm choice: Token Bucket**
- Capacity = 20 (the burst budget)
- Refill rate = 100/60 = 1.667 tokens/second
- When the bucket is full and a burst of 20 hits, all 20 succeed. Then the client is limited to ~1.67 req/s until the bucket refills.

**Architecture:**

```
  Client ──▶ Load Balancer ──▶ Pod 1 ─┐
                              Pod 2 ─┤──▶ Redis (token bucket state)
                              Pod N ─┘
```

**Lua script (same as above):** ensures atomicity. Key: `ratelimit:tb:{apiKey}`. Hash fields: `tokens` (float), `last_refill` (timestamp ms).

**Failure handling:**
- Redis down: fall back to in-process token bucket with capacity=2, rate=10/min (conservative per-pod limit). Log and alert.
- Redis slow (>10ms): use the in-process result for this request, async-update Redis. Accept slight inaccuracy over latency.

**Response:**
```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
RateLimit-Limit: 20
RateLimit-Remaining: 0
RateLimit-Reset: 1720000080
Retry-After: 12

{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Retry in 12 seconds.",
  "retryAfterSeconds": 12
}
```

**Monitoring:**
- Track `rate_limit_allowed_total` and `rate_limit_rejected_total` per API key (Prometheus counters).
- Alert if rejection rate > 10% globally (indicates either abuse or too-tight limits).
- Dashboard: top-10 most-limited API keys, Redis latency percentiles, fallback activation count.

**Scaling to 10x:**
- At 10x traffic, Redis handles 10x more `EVAL` commands. Redis can handle ~100K ops/sec on a single instance.
- If Redis becomes the bottleneck: shard rate limit keys across multiple Redis instances (hash the API key to select a shard).
- Consider moving to Redis Cluster with hash tags: `ratelimit:tb:{apiKey}` where `{apiKey}` is the hash tag, ensuring all operations for one key hit the same shard.
:::

## Key Mental Models

- **Token bucket is the default choice.** It's the only algorithm that gives you independent control over sustained rate and burst size. Start here unless you have a reason not to.
- **Rate limiting must be centralized for distributed systems.** In-process limiters give you N times the intended limit across N pods. Use Redis (or a similar shared store) for the source of truth.
- **Lua scripts on Redis are your atomicity mechanism.** Without them, read-check-write races let requests slip through. Lua scripts execute atomically on the Redis server.
- **Fail-open vs fail-closed is a business decision, not a technical one.** The right choice depends on what's worse: rejecting legitimate traffic or allowing unlimited traffic. Make this decision explicitly and document it.
- **Rate limit headers are not optional.** Clients need `RateLimit-Remaining` and `Retry-After` to implement backoff correctly. Without them, clients hammer your server in tight retry loops, making the overload worse.

## Related

- [Horizontal vs Vertical Scaling](./01-horizontal-vertical) — rate limiting is a key component of scaling strategy
- [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq) — Redis Lua scripts used similarly for queue operations
- [Cache-Aside & Stampede](/system-design/caching/01-patterns) — stampede protection uses similar locking patterns
- [Rate Limiter Design Walkthrough](/interview/design-walkthroughs/rate-limiter) — full interview-style design exercise
