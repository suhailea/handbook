---
title: Rate Limiting Middleware
outline: deep
---

# Rate Limiting Middleware

Interview weight: 🔥🔥🔥 | Node 22+ | Prerequisites: [Rate Limiting Algorithms](/system-design/scaling/02-rate-limiting), [The Middleware Stack](/frameworks/express/01-middleware-stack)

## 🗣️ In Plain English

::: tip In Plain English
Imagine a popular food truck that can serve 100 meals per hour. If 500 people show up at once, the truck cannot serve them all — food quality drops, wait times explode, and eventually the generator overheats and the truck shuts down entirely. The solution is a line manager who counts: "You are person number 101 this hour — come back in 45 minutes." The line manager does not cook food. They just stand at the entrance and count.

Rate limiting is that line manager for your API. It counts how many requests each client has made in a time window. If a client exceeds the allowed number, the server immediately responds with "429 Too Many Requests" and tells the client exactly when to come back (the `Retry-After` header). The request never reaches your database, your business logic, or your downstream services — it is stopped at the door.

The complication comes when you have multiple food trucks (multiple servers). Each truck has its own line manager, but a customer can walk to a different truck. If each line manager counts independently, a customer gets 100 meals per truck instead of 100 total. To fix this, all the line managers share a single notebook (Redis) where they record every customer visit. Now it does not matter which truck you walk to — your count follows you.
:::

## ⚙️ Under the Hood

### Basic Rate Limiting with express-rate-limit

```typescript
// run: npx tsx basic-rate-limit.ts
import express from 'express';
import rateLimit from 'express-rate-limit';

const app = express();

// Trust proxy if behind nginx/ALB (so req.ip is the real client IP)
app.set('trust proxy', 1);

// Global rate limiter: 100 requests per 15-minute window
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // limit each IP to 100 requests per window
  standardHeaders: 'draft-7', // RateLimit-* headers (IETF draft)
  legacyHeaders: false,       // Disable X-RateLimit-* headers

  // Custom response
  message: {
    error: 'Too many requests',
    retryAfter: 'See Retry-After header',
  },

  // Custom key generator: default is req.ip
  keyGenerator: (req) => {
    // Use authenticated user ID if available, fall back to IP
    return (req as any).userId ?? req.ip ?? 'unknown';
  },

  // Skip rate limiting for internal services
  skip: (req) => {
    const internalToken = req.headers['x-internal-service-token'];
    return internalToken === process.env.INTERNAL_SERVICE_TOKEN;
  },
});

app.use(globalLimiter);

// Stricter limiter for auth endpoints (prevent brute force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,  // Only 5 login attempts per 15 minutes
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again later.' },
  keyGenerator: (req) => {
    // Key by IP + email combination to prevent credential stuffing
    const email = req.body?.email ?? 'unknown';
    return `${req.ip}:${email}`;
  },
});

app.use(express.json());
app.post('/auth/login', authLimiter, (_req, res) => {
  res.json({ token: 'jwt-here' });
});

app.get('/api/data', (_req, res) => {
  res.json({ data: 'protected by global limiter' });
});

app.listen(3000, () => console.log('Listening on :3000'));
```

**Response headers (draft-7 standard):**
```
HTTP/1.1 429 Too Many Requests
Retry-After: 900
RateLimit-Limit: 100
RateLimit-Remaining: 0
RateLimit-Reset: 1720000000
```

### Redis-Backed Distributed Rate Limiting

The in-memory store in `express-rate-limit` resets on server restart and does not share state across instances. For production, use Redis.

```typescript
// run: npx tsx redis-rate-limit.ts
import express from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST ?? '127.0.0.1',
  port: Number(process.env.REDIS_PORT ?? 6379),
  enableOfflineQueue: false, // Fail fast if Redis is down
});

const app = express();
app.set('trust proxy', 1);

// Redis-backed limiter
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60,             // 60 requests per minute

  // Redis store for distributed state
  store: new RedisStore({
    // Use ioredis client
    sendCommand: (...args: string[]) => redis.call(...args) as any,
    prefix: 'rl:', // Key prefix in Redis: rl:<ip>
  }),

  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

app.use(limiter);

app.get('/api/resource', (_req, res) => {
  res.json({ ok: true });
});

app.listen(3000);
```

**How the Redis store works internally:**

Each request increments a Redis key `rl:<clientId>` with `INCR` and sets an expiry with `PEXPIRE` equal to `windowMs`. This is a fixed-window counter. The key structure:

```
rl:192.168.1.1 → 42  (TTL: 35 seconds remaining)
```

When the count exceeds `max`, the middleware responds with 429 without calling `next()`.

### Sliding Window vs Fixed Window

```typescript
// run: npx tsx sliding-window.ts
import Redis from 'ioredis';

const redis = new Redis();

/**
 * Sliding window rate limiter using Redis sorted sets.
 * More accurate than fixed window — no burst at window boundary.
 */
async function slidingWindowRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number,
): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const now = Date.now();
  const windowStart = now - windowMs;

  const pipeline = redis.pipeline();

  // Remove entries outside the window
  pipeline.zremrangebyscore(key, 0, windowStart);

  // Count entries in the current window
  pipeline.zcard(key);

  // Add current request (score = timestamp, member = unique ID)
  pipeline.zadd(key, now.toString(), `${now}:${Math.random()}`);

  // Set TTL on the key (cleanup)
  pipeline.pexpire(key, windowMs);

  const results = await pipeline.exec();
  const currentCount = (results?.[1]?.[1] as number) ?? 0;

  if (currentCount >= maxRequests) {
    // Get the oldest entry to calculate reset time
    const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
    const resetMs = oldest.length >= 2
      ? Number(oldest[1]) + windowMs - now
      : windowMs;

    return { allowed: false, remaining: 0, resetMs };
  }

  return {
    allowed: true,
    remaining: maxRequests - currentCount - 1,
    resetMs: windowMs,
  };
}

// Demo
async function demo(): Promise<void> {
  const key = 'sliding:user:123';
  await redis.del(key);

  for (let i = 0; i < 7; i++) {
    const result = await slidingWindowRateLimit(key, 5, 60_000);
    console.log(`Request ${i + 1}:`, result);
  }

  await redis.quit();
}

demo().catch(console.error);
```

**Fixed window problem:** If your window is 1 minute and a client sends 100 requests at second 59, then 100 more at second 61, they get 200 requests in 2 seconds even though the limit is 100/minute. The sliding window tracks individual request timestamps, so every request is counted against a rolling window. The trade-off is higher Redis memory usage (one sorted set entry per request vs one counter).

### Per-Route Strategy Pattern

```typescript
// run: npx tsx per-route-limits.ts
import express from 'express';
import rateLimit from 'express-rate-limit';

const app = express();
app.set('trust proxy', 1);
app.use(express.json());

// Factory for creating route-specific limiters
function createLimiter(config: {
  windowMs: number;
  max: number;
  keyPrefix: string;
  keyGenerator?: (req: express.Request) => string;
}) {
  return rateLimit({
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: config.keyGenerator ?? ((req) => `${config.keyPrefix}:${req.ip}`),
  });
}

// Tier 1: Auth endpoints — very strict
const authLimiter = createLimiter({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyPrefix: 'auth',
});

// Tier 2: Write operations — moderate
const writeLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 30,
  keyPrefix: 'write',
});

// Tier 3: Read operations — generous
const readLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 200,
  keyPrefix: 'read',
});

// API key-based limits (higher tier for paying customers)
const apiKeyLimiter = createLimiter({
  windowMs: 60 * 1000,
  max: 1000,
  keyPrefix: 'apikey',
  keyGenerator: (req) => {
    const apiKey = req.headers['x-api-key'] as string;
    return apiKey ? `apikey:${apiKey}` : `ip:${req.ip}`;
  },
});

// Apply per route
app.post('/auth/login', authLimiter, (_req, res) => res.json({ ok: true }));
app.post('/auth/register', authLimiter, (_req, res) => res.json({ ok: true }));
app.post('/api/orders', writeLimiter, (_req, res) => res.json({ ok: true }));
app.put('/api/orders/:id', writeLimiter, (_req, res) => res.json({ ok: true }));
app.get('/api/products', readLimiter, (_req, res) => res.json({ ok: true }));
app.get('/api/v2/*', apiKeyLimiter, (_req, res) => res.json({ ok: true }));

app.listen(3000);
```

### Rate Limiting in NestJS

```typescript
// run: conceptual — NestJS application context required
import { Module } from '@nestjs/common';
import { ThrottlerModule, ThrottlerGuard, SkipThrottle, Throttle } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        name: 'short',
        ttl: 1000,   // 1 second
        limit: 3,    // 3 requests per second
      },
      {
        name: 'medium',
        ttl: 10000,  // 10 seconds
        limit: 20,   // 20 requests per 10 seconds
      },
      {
        name: 'long',
        ttl: 60000,  // 1 minute
        limit: 100,  // 100 requests per minute
      },
    ]),
  ],
  providers: [
    {
      // Apply throttling globally
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}

// In a controller:
// @SkipThrottle()  // Skip throttling for this entire controller
// @SkipThrottle({ short: true }) // Skip only the 'short' throttle

// @Throttle({ short: { ttl: 1000, limit: 1 } })  // Override for this route
// @Post('login')
// login() { ... }
```

NestJS `ThrottlerModule` uses an in-memory store by default. For distributed setups, use `@nestjs/throttler` with a Redis storage adapter. The throttler supports multiple named rate limits applied simultaneously — a request must pass *all* of them.

### 429 Response with Retry-After

The `Retry-After` header is critical for well-behaved clients. It tells them exactly when to retry, preventing thundering herd effects where all throttled clients retry simultaneously.

```typescript
// Retry-After can be:
// 1. Seconds until retry is allowed
//    Retry-After: 120
//
// 2. HTTP-date when retry is allowed
//    Retry-After: Sat, 12 Jul 2026 14:30:00 GMT

// express-rate-limit sets this automatically when standardHeaders is enabled.
// For custom middleware:
function rateLimitResponse(res: express.Response, retryAfterSeconds: number): void {
  res.set('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    error: 'Too Many Requests',
    message: `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`,
    retryAfter: retryAfterSeconds,
  });
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. `trust proxy` not set — all users share one IP.**
Behind a load balancer or nginx, `req.ip` defaults to the proxy's IP (e.g., `10.0.0.1`) unless `trust proxy` is configured. Every user shares the same rate-limit bucket. Symptom: legitimate users get 429s while attackers from different IPs are unaffected. Fix: `app.set('trust proxy', 1)` (trust one proxy hop) or set to the number of proxy layers.

**2. Redis failure = open or closed?**
When Redis is unreachable, the rate limiter must decide: allow all requests (fail open) or reject all requests (fail closed). The default `rate-limit-redis` behavior depends on `enableOfflineQueue` in the Redis client. With `enableOfflineQueue: true`, requests queue until Redis recovers (causing timeouts). With `enableOfflineQueue: false` and no error handling, the limiter crashes. Design for this: catch Redis errors and fail open (allow requests) with an alert, rather than blocking all traffic during a Redis outage.

**3. Fixed-window boundary burst.**
Using a fixed 1-minute window with a 100-request limit: a client sends 100 requests at second 59, then 100 more at second 61. They get 200 requests in 2 seconds. If your downstream cannot handle 200x burst, use a sliding window. The trade-off is 3-5x more Redis memory per key.

**4. Rate limiting applied after expensive middleware.**
If your rate-limit middleware runs *after* body parsing, authentication, and database-backed authorization, a rate-limited request has already consumed significant resources. Apply rate limiting as early as possible in the middleware chain — ideally right after `trust proxy` and before body parsing.
:::

## 🎯 Checkpoint

::: details Question 1 — IP vs user-based rate limiting
**Q:** When should you rate-limit by IP address vs by authenticated user ID? What attack does each approach mitigate, and what is the weakness of each?

**A:** **IP-based** limits mitigate DDoS and brute-force attacks from unauthenticated sources (login endpoints, registration). Weakness: users behind a shared IP (corporate NAT, university network) share a bucket — one aggressive user throttles everyone. Also, attackers with botnets rotate IPs trivially. **User-based** limits mitigate abuse by authenticated users (API scraping, resource exhaustion). Weakness: they require authentication to have already succeeded, so they cannot protect the login endpoint itself. Best practice: use IP-based limits for unauthenticated endpoints and user-based limits for authenticated ones. For high-value APIs, combine both: a generous IP limit AND a per-user limit.
:::

::: details Question 2 — Fail open vs fail closed
**Q:** Your Redis-backed rate limiter loses connection to Redis during a traffic spike. Should you fail open (allow all requests) or fail closed (reject all requests)? Justify your answer.

**A:** **Fail open** is correct for most API rate limiters. The purpose of rate limiting is to protect against abuse, but a Redis outage is typically brief (seconds to minutes). Failing closed turns a Redis problem into a total API outage — every legitimate user gets 429s, which is worse than the temporary loss of rate limiting. The exception: if your downstream services will literally crash without rate limiting (e.g., a database that cannot handle more than N connections), fail closed with a 503 Service Unavailable is safer. In practice: fail open, fire a high-severity alert, and rely on other layers (nginx `limit_req`, cloud WAF) as backup during the Redis recovery window.
:::

## Key Mental Models

- **Rate limiting is access control, not business logic.** Apply it at the earliest possible middleware layer, before body parsing or authentication.
- **Distributed systems need distributed state.** In-memory counters do not work across multiple server instances — use Redis or a shared store.
- **Fixed window is simple but bursty at boundaries.** Sliding window is more accurate but costs more memory. Token bucket is best for smoothing but most complex to implement.
- **429 + Retry-After is a contract.** Well-behaved clients respect it; without it, throttled clients retry immediately, making the overload worse.
- **Always design for Redis failure.** Your rate limiter should degrade gracefully (fail open + alert), not cascade into a full outage.

## Related

- [Rate Limiting Algorithms](/system-design/scaling/02-rate-limiting) — the algorithmic foundations (token bucket, sliding window, leaky bucket)
- [HTTP Hardening & LLM Threats](/nodejs/module-08/04-http-hardening) — server-side request limits and decompression bombs
- [The Middleware Stack](/frameworks/express/01-middleware-stack) — middleware ordering in Express
