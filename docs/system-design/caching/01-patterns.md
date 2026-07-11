---
title: Cache-Aside, Write-Through & Stampede
outline: deep
---

# Cache-Aside, Write-Through & Stampede

**Interview weight:** :fire::fire::fire: | **Prerequisites:** [Redis, CDN & Invalidation](./02-redis-cdn), basic database knowledge | **Relevant to:** every backend that reads more than it writes

## :speaking_head: In Plain English

::: tip In Plain English
Imagine a busy restaurant kitchen. The chef doesn't cook every dish from scratch each time someone orders it. Instead, there's a steam table near the front — pre-cooked portions sitting ready to serve. That steam table is your **cache**.

**Cache-aside** is the simplest arrangement: the waiter checks the steam table first. If the dish is there, great — serve it immediately. If not, the waiter walks back to the kitchen, the chef cooks it, the waiter puts a portion on the steam table *and* serves the customer. Next time someone orders the same dish, it's already waiting. The kitchen (your database) only gets bothered when the steam table misses.

**Write-through** is a different workflow: every time the chef finishes a new dish — whether someone ordered it or not — a copy goes straight onto the steam table. The steam table is always in sync with the kitchen, but it takes more effort to keep it updated.

**Write-behind** (also called write-back) is the risky cousin: the waiter puts the new dish on the steam table *first* and tells the kitchen to update its records later. Faster for the customer, but if the steam table catches fire before the kitchen gets the memo, the order is lost.

Now, the real danger: the **stampede**. The dish on the steam table goes stale (its TTL expires). At that exact moment, fifty customers order it. All fifty waiters rush to the kitchen at once, each asking the chef to cook the same dish from scratch. The kitchen is overwhelmed — the chef can only cook so fast. This is the **thundering herd** or **cache stampede**, and it can take down your database.

The fix? Only let *one* waiter go to the kitchen. The others wait at the steam table for the dish to appear. That's **single-flight** or **lock-based** stampede protection.
:::

## :gear: Under the Hood

### Cache-Aside (Lazy Loading)

The application sits between the cache and the database. It owns the read/write logic.

```
     ┌───────────┐
     │  Client    │
     └─────┬─────┘
           │ 1. GET /user/42
     ┌─────▼─────┐
     │   App      │──── 2. cache.get("user:42")
     └─────┬─────┘         │
           │          ┌────▼────┐
           │          │  Cache  │  → HIT? Return.
           │          └────┬────┘  → MISS? ↓
           │               │
     ┌─────▼─────┐         │
     │ Database   │◄────────┘ 3. SELECT * FROM users WHERE id=42
     └─────┬─────┘
           │ 4. cache.set("user:42", result, { EX: 300 })
           ▼
       Response
```

```typescript
// run: npx tsx cache-aside.ts
import { createClient } from 'redis';

interface User {
  id: number;
  name: string;
  email: string;
}

const redis = createClient();
await redis.connect();

const TTL_SECONDS = 300; // 5 minutes

async function getUserCacheAside(
  userId: number,
  fetchFromDb: (id: number) => Promise<User | null>,
): Promise<User | null> {
  const cacheKey = `user:${userId}`;

  // Step 1: Try cache
  const cached = await redis.get(cacheKey);
  if (cached !== null) {
    return JSON.parse(cached) as User;
  }

  // Step 2: Cache miss — hit the database
  const user = await fetchFromDb(userId);
  if (user === null) {
    // Cache the absence too (negative caching), short TTL
    await redis.set(cacheKey, JSON.stringify(null), { EX: 30 });
    return null;
  }

  // Step 3: Populate cache
  await redis.set(cacheKey, JSON.stringify(user), { EX: TTL_SECONDS });

  return user;
}
```

**Characteristics of cache-aside:**

| Property | Behavior |
|---|---|
| Cache population | Lazy — only on first read |
| Staleness | Possible; bounded by TTL |
| Write path | App writes to DB directly; must invalidate/update cache |
| Cache failure | App falls through to DB (graceful degradation) |
| Best for | Read-heavy workloads with tolerable staleness |

### Write-Through

Every write goes to cache *and* database atomically (from the application's perspective). The cache is always warm for recently written data.

```typescript
// run: npx tsx write-through.ts
async function updateUserWriteThrough(
  userId: number,
  updates: Partial<User>,
  saveToDb: (id: number, data: Partial<User>) => Promise<User>,
): Promise<User> {
  // Step 1: Write to database
  const updatedUser = await saveToDb(userId, updates);

  // Step 2: Write to cache (same transaction boundary ideally)
  const cacheKey = `user:${userId}`;
  await redis.set(cacheKey, JSON.stringify(updatedUser), { EX: TTL_SECONDS });

  return updatedUser;
}
```

**The problem:** write-through adds latency to every write (two writes instead of one) and populates the cache with data that may never be read. In a write-heavy system with infrequent reads, you're paying for cache storage you don't use.

### Write-Behind (Write-Back)

The application writes to the cache first, and a background process flushes dirty entries to the database asynchronously.

```
  App ──write──▶ Cache ──async flush──▶ Database
                   │
             immediate ACK
```

**Danger:** if the cache node dies before the flush, data is lost. Write-behind is appropriate only when:
- The data can be recomputed or is non-critical (analytics counters, session activity timestamps).
- The cache layer has persistence (Redis AOF, for example) — though even Redis AOF can lose the last second of writes.

### Cache Invalidation

The two hard problems in computer science: cache invalidation, naming things, and off-by-one errors.

**Strategies:**

| Strategy | Mechanism | Consistency | Complexity |
|---|---|---|---|
| TTL expiry | Key expires after N seconds | Eventual (up to TTL) | Low |
| Explicit delete | `DEL user:42` on write | Strong (if no race) | Medium |
| Write-through | Update cache on every write | Strong | Medium |
| Pub/Sub invalidation | DB change event → cache delete | Near-real-time | High |
| Versioned keys | `user:42:v7` — new version = new key | Strong | Medium |

**The race condition in explicit delete:**

```
  T1: UPDATE users SET name='Alice' WHERE id=42
  T2: SELECT * FROM users WHERE id=42  → gets old value 'Bob'
  T1: DEL user:42
  T2: SET user:42 = { name: 'Bob' }   ← stale data re-cached!
```

Mitigation: delete-after-write with a short delay, or use write-through so T1 sets the cache itself.

### Cache Stampede (Thundering Herd)

When a popular cache key expires, many concurrent requests discover the miss simultaneously and all hit the database.

**Impact math:** if 1,000 requests/second hit a key with a 60-second TTL, at the moment of expiry you get ~1,000 concurrent DB queries for the same row. A single-row SELECT might take 5ms under normal load, but 1,000 concurrent copies can saturate connection pools, trigger timeouts, and cascade into full outage.

#### Protection 1: TTL Jitter

Never set the same TTL for all keys. Add random jitter so expirations spread out.

```typescript
// run: npx tsx jitter.ts
function ttlWithJitter(baseTtl: number, jitterPercent = 0.1): number {
  const jitter = baseTtl * jitterPercent * (Math.random() * 2 - 1);
  return Math.max(1, Math.round(baseTtl + jitter));
}

// Base TTL: 300s. Actual TTL: 270–330s.
const ttl = ttlWithJitter(300);
console.log(`TTL with jitter: ${ttl}s`);
```

Jitter prevents mass-expiry of keys set around the same time, but doesn't help when a *single* popular key expires.

#### Protection 2: Single-Flight (Coalescing / Mutex Lock)

Only one request fetches from the database; all others wait for that result.

```typescript
// run: npx tsx single-flight.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const inFlight = new Map<string, Promise<string | null>>();

async function getWithSingleFlight(
  key: string,
  fetchFn: () => Promise<string>,
  ttl: number,
): Promise<string> {
  // Check cache
  const cached = await redis.get(key);
  if (cached !== null) return cached;

  // Check if someone is already fetching
  const existing = inFlight.get(key);
  if (existing) {
    const result = await existing;
    return result ?? '';
  }

  // This request wins — it fetches
  const fetchPromise = (async () => {
    const value = await fetchFn();
    await redis.set(key, value, { EX: ttl });
    return value;
  })();

  inFlight.set(key, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    inFlight.delete(key);
  }
}
```

**Limitation:** this works within a single process. In a horizontally-scaled deployment with N pods, you need a *distributed* lock.

#### Protection 3: Distributed Lock (Redis-based)

```typescript
// run: npx tsx distributed-lock.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

async function getWithDistributedLock(
  key: string,
  fetchFn: () => Promise<string>,
  ttl: number,
): Promise<string> {
  const cached = await redis.get(key);
  if (cached !== null) return cached;

  const lockKey = `lock:${key}`;
  const lockTtl = 5; // seconds — must be longer than fetchFn execution time

  // Try to acquire lock (SET NX EX)
  const acquired = await redis.set(lockKey, '1', { NX: true, EX: lockTtl });

  if (acquired) {
    try {
      // Double-check after acquiring lock
      const rechecked = await redis.get(key);
      if (rechecked !== null) return rechecked;

      const value = await fetchFn();
      await redis.set(key, value, { EX: ttl });
      return value;
    } finally {
      await redis.del(lockKey);
    }
  }

  // Another process holds the lock — wait and retry
  await new Promise((resolve) => setTimeout(resolve, 50));
  return getWithDistributedLock(key, fetchFn, ttl);
}
```

#### Protection 4: Probabilistic Early Expiration (XFetch)

Recompute the value *before* it expires. Each request has a small probability of triggering a refresh, increasing as TTL approaches zero.

```typescript
// run: npx tsx xfetch.ts
function shouldRecompute(
  currentTtl: number,
  computeTime: number,
  beta = 1,
): boolean {
  // XFetch algorithm: probability increases as TTL decreases
  const random = -beta * computeTime * Math.log(Math.random());
  return random >= currentTtl;
}

// If 45s remain on a 60s TTL and compute takes 0.5s:
// P(recompute) ≈ 1% — most requests skip it.
// If 2s remain: P(recompute) ≈ 22% — someone will likely refresh.
```

### TTL Strategy Summary

| Approach | Protects against | Trade-off |
|---|---|---|
| Jitter | Mass expiry of many keys | Doesn't help single hot keys |
| Single-flight (in-process) | Stampede within one process | No cross-process protection |
| Distributed lock | Stampede across all pods | Extra Redis round-trip; lock contention |
| XFetch / probabilistic | Stampede on hot keys | May trigger unnecessary recomputes |
| Short negative-cache TTL | DB hammered by non-existent keys | Delays visibility of new records |

## :collision: Where It Bites (Production Lens)

::: warning Where It Bites

**1. Stampede after deploy-time cache flush.** A well-meaning engineer runs `FLUSHDB` in staging, but the environment variable pointed to production Redis. Every cached value disappears. The entire read workload hits the database at once. Symptom: database connection pool exhaustion within seconds, `ECONNREFUSED` or timeout errors cascading through every service. **Diagnosis:** check Redis `dbsize` (suddenly zero) and database active connections (maxed). **Fix:** never `FLUSHDB` in production; use key-prefix-based invalidation. Implement a circuit breaker on the DB read path.

**2. Stale cache after write (no invalidation).** A user updates their profile. The write goes to the database, but nobody deletes the cache key. The user refreshes and sees old data. They update again, thinking the first save failed. Now you have two conflicting writes. **Symptom:** support tickets saying "my changes aren't saving." **Root cause:** cache-aside without invalidation on the write path. **Fix:** always invalidate (or write-through) on mutation. Use `DEL`, not `SET` with the new value, to avoid the race condition described above — let the next read repopulate.

**3. Negative caching gone wrong.** A key doesn't exist in the database. You cache the null result with a 5-minute TTL. The record is created 10 seconds later. For the next 4 minutes 50 seconds, all reads return "not found." **Symptom:** newly created resources appear to not exist. **Fix:** use short TTLs for negative cache entries (5-30 seconds) and explicitly invalidate on creation.

**4. Stampede on cold start / new feature launch.** You deploy a new feature that queries a table with no cached data. Zero cache hits from the start. If the feature is behind a feature flag that you flip for all users simultaneously, every user's first request hammers the database. **Symptom:** latency spike correlated exactly with feature flag activation. **Fix:** cache warming — pre-populate the cache before flipping the flag, or use a gradual rollout.
:::

## :dart: Checkpoint

::: details Question 1 — Cache-aside vs write-through consistency
**Q:** In a cache-aside system, a user updates their email. Immediately after, they refresh the page. Under what conditions will they see the old email, and how do you prevent it?

**A:** In pure cache-aside, the application writes to the database but does not update the cache. The stale cached value is served until its TTL expires. To prevent this, you must **invalidate the cache on write** — either `DEL user:42` (letting the next read repopulate) or use write-through to update the cache in the same operation. The `DEL` approach is simpler but has a small race window: another request could read the old value from the DB and re-cache it between the write and the delete. To close this window, you can use write-through (SET the new value in cache during the write path) or add a short delay before the delete. In practice, the race window is measured in milliseconds and rarely causes user-visible issues, but at high traffic on hot keys it becomes real.
:::

::: details Question 2 — Single-flight limitations
**Q:** Your single-flight implementation deduplicates within one Node.js process. You have 20 pods behind a load balancer. A hot key expires. How many database queries will you see, and how do you reduce it further?

**A:** Up to **20 queries** — one per pod — because each pod's in-process Map is independent. To reduce this to one, you need a **distributed lock** (e.g., `SET lock:key NX EX 5` in Redis). The winning pod fetches from the database and populates the cache; the other 19 pods spin-wait on the cache key appearing. The trade-off is an extra Redis round-trip for the lock check, but this is much cheaper than 19 redundant database queries. You can combine both layers: in-process single-flight deduplicates within a pod, and the distributed lock deduplicates across pods.
:::

::: details Question 3 — XFetch vs lock-based protection
**Q:** Explain why probabilistic early recomputation (XFetch) avoids the need for a lock, and identify a scenario where it performs worse than lock-based stampede protection.

**A:** XFetch avoids locks because it triggers recomputation *before* the key expires. Requests check a probability function that increases as TTL decreases. On average, exactly one request triggers the recompute while the old value is still being served to everyone else — no contention, no waiting. However, XFetch performs worse when the **compute time is highly variable or very long** (e.g., a complex aggregation that sometimes takes 30 seconds). The probability function uses the expected compute time as a parameter; if the actual compute takes 10x longer, the recompute may not finish before the real TTL expires, and you get a stampede anyway. Lock-based protection guarantees exactly one fetch regardless of compute duration. XFetch also triggers unnecessary recomputes for keys that nobody will read again — it doesn't know whether the key is "hot."
:::

## :building_construction: Design It

**Scenario:** Your most popular API endpoint serves product catalog data cached with a 60-second TTL. At expiry, 1,000 concurrent requests hit the database. Average DB query time is 50ms, but under load it degrades to 2 seconds, causing timeouts. Fix this.

::: details Worked Solution

**Step 1: Add TTL jitter** to prevent synchronized expiry across multiple product keys. Use 60s +/- 10% (54-66s). This helps with mass expiry but doesn't solve the single hot-key problem.

**Step 2: Implement distributed single-flight** using a Redis lock:
```typescript
// run: npx tsx catalog-cache.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

async function getCatalogProduct(productId: string): Promise<string> {
  const cacheKey = `product:${productId}`;
  const lockKey = `lock:${cacheKey}`;

  // Try cache
  const cached = await redis.get(cacheKey);
  if (cached !== null) return cached;

  // Try to acquire lock
  const acquired = await redis.set(lockKey, '1', { NX: true, EX: 5 });

  if (acquired) {
    try {
      // Double-check cache (another process may have just populated it)
      const rechecked = await redis.get(cacheKey);
      if (rechecked !== null) return rechecked;

      const product = await fetchProductFromDb(productId);
      const ttl = 60 + Math.round((Math.random() - 0.5) * 12); // 54-66s
      await redis.set(cacheKey, JSON.stringify(product), { EX: ttl });
      return JSON.stringify(product);
    } finally {
      await redis.del(lockKey);
    }
  }

  // Wait and retry (with bounded retries)
  let retries = 0;
  while (retries < 50) {
    await new Promise((r) => setTimeout(r, 100));
    const result = await redis.get(cacheKey);
    if (result !== null) return result;
    retries++;
  }

  // Fallback: fetch directly (circuit breaker should protect DB here)
  return JSON.stringify(await fetchProductFromDb(productId));
}

async function fetchProductFromDb(id: string): Promise<object> {
  // Simulated DB query
  return { id, name: 'Widget', price: 9.99 };
}
```

**Step 3: Add XFetch for the top-100 hottest products** (tracked via a Redis sorted set of access counts). For these keys, start probabilistic refresh when TTL drops below 15 seconds. This avoids even the lock contention for the most popular items.

**Step 4: Serve stale on lock contention.** If the lock is held and the retry loop times out, serve the last known value (stored in a separate key `stale:product:42` with a longer TTL) rather than hitting the database. This is called **stale-while-revalidate** and trades a small window of staleness for guaranteed availability.

**Result:** database sees at most 1 query per product per TTL window, regardless of request volume. Lock contention is bounded. Hot keys refresh before expiry.
:::

## Key Mental Models

- **Cache-aside is the default.** It's the simplest, degrades gracefully when the cache dies, and only caches data that's actually read. Start here.
- **Every cache is a lie with a timer.** The TTL is how long you're willing to accept a potentially wrong answer. Choose it deliberately.
- **Stampede is a multiplier, not a spike.** It takes your normal read load and concentrates it into a single instant. Protection is not optional for hot keys.
- **Invalidation is harder than caching.** Getting data *into* the cache is trivial. Knowing *when to remove it* requires understanding every write path.
- **Jitter is the cheapest fix in caching.** One line of code prevents coordinated expiry. Always add it.

## Related

- [Redis, CDN & Invalidation](./02-redis-cdn) — Redis-specific data structures, eviction policies, and CDN caching
- [Rate Limiting](/system-design/scaling/02-rate-limiting) — token bucket implementation also uses Redis extensively
- [Queues & Delivery Semantics](/system-design/queues/03-delivery-semantics) — at-least-once patterns relate to cache-aside's "fetch on miss"
