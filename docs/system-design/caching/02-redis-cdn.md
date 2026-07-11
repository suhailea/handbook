---
title: Redis, CDN & Invalidation
outline: deep
---

# Redis, CDN & Invalidation

**Interview weight:** :fire::fire::fire: | **Prerequisites:** [Cache-Aside, Write-Through & Stampede](./01-patterns) | **Relevant to:** any service with a read-heavy API or static asset delivery

## :speaking_head: In Plain English

::: tip In Plain English
Think of a library system with three levels.

The **first level** is your desk. You keep the two or three books you're actively reading right there — instant access, zero walking. That's your **application-level in-memory cache** (a `Map` in your Node process). It's blazing fast but tiny, and each desk (each process) has its own copy.

The **second level** is the library's front counter. All the frequently requested books are shelved right behind the librarian. You walk up, ask for a title, and the librarian grabs it in seconds. That's **Redis** — a shared, fast, key-value store that every desk (every process, every pod) can access. It's not as fast as your desk, but it holds far more and everyone sees the same books.

The **third level** is the network of branch libraries spread across the city. If someone in the east side keeps requesting the same popular novel, the eastern branch stocks its own copies. Readers don't need to travel downtown. That's a **CDN** (Content Delivery Network) — copies of your content placed geographically close to users. The CDN doesn't know your business logic; it just stores and serves whatever you told it to cache, based on rules you set in HTTP headers.

**Invalidation** — the hard part — is telling all three levels "this book has been revised, throw away the old edition." Your desk is easy (you're right there). Redis is one command away (`DEL`). But the CDN? You've shipped copies to 200 branch libraries. Recall takes time and coordination. This is why CDN invalidation is measured in seconds-to-minutes, not milliseconds, and why many systems use **versioned URLs** (a new edition gets a new ISBN) instead of trying to recall the old one.
:::

## :gear: Under the Hood

### Redis Data Structures for Caching

Redis is not just a key-value store that holds strings. Each data structure has specific caching use cases.

#### Strings — The Default

Most caching uses `SET key value EX ttl`. Strings store up to 512 MB per key.

```typescript
// run: npx tsx redis-string-cache.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

interface Product {
  id: string;
  name: string;
  price: number;
  inventory: number;
}

// Cache a serialized object
const product: Product = { id: 'p1', name: 'Widget', price: 29.99, inventory: 150 };
await redis.set('product:p1', JSON.stringify(product), { EX: 3600 });

// Retrieve and parse
const cached = await redis.get('product:p1');
if (cached) {
  const parsed: Product = JSON.parse(cached);
  console.log(parsed.name); // Widget
}

// Atomic counter — no serialize/deserialize overhead
await redis.set('page:views:/home', '0');
await redis.incr('page:views:/home');       // 1
await redis.incrBy('page:views:/home', 10); // 11
```

**When to use:** single values, serialized objects, counters. For counters, use `INCR`/`INCRBY` instead of GET-modify-SET to avoid race conditions.

#### Hashes — Partial Updates Without Full Serialization

```typescript
// run: npx tsx redis-hash-cache.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// Store user session as a hash — update fields independently
await redis.hSet('session:abc123', {
  userId: '42',
  role: 'admin',
  lastActivity: Date.now().toString(),
  cartItemCount: '3',
});
await redis.expire('session:abc123', 1800); // 30 min

// Update just one field (no need to read-modify-write the whole object)
await redis.hSet('session:abc123', 'lastActivity', Date.now().toString());
await redis.hIncrBy('session:abc123', 'cartItemCount', 1);

// Read specific fields
const role = await redis.hGet('session:abc123', 'role');
console.log(role); // 'admin'

// Read all fields
const session = await redis.hGetAll('session:abc123');
console.log(session);
```

**When to use:** objects where you frequently update individual fields (sessions, user preferences, feature flags). Hashes use less memory than equivalent string keys for small objects (Redis uses a compact ziplist encoding for hashes with fewer than ~128 fields).

#### Sorted Sets — Leaderboards, Top-N, Time-Series Windows

```typescript
// run: npx tsx redis-sorted-set-cache.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// Trending articles — score = view count
await redis.zAdd('trending:articles', [
  { score: 1500, value: 'article:101' },
  { score: 3200, value: 'article:202' },
  { score: 800,  value: 'article:303' },
]);

// Top 10 articles (highest score first)
const top10 = await redis.zRangeWithScores('trending:articles', 0, 9, { REV: true });
console.log(top10);
// [{ value: 'article:202', score: 3200 }, { value: 'article:101', score: 1500 }, ...]

// Increment score atomically
await redis.zIncrBy('trending:articles', 1, 'article:303');

// Sliding window rate limiting (see rate-limiting page for full version)
const now = Date.now();
await redis.zAdd('ratelimit:user:42', [{ score: now, value: `${now}:${Math.random()}` }]);
await redis.zRemRangeByScore('ratelimit:user:42', 0, now - 60_000); // Remove entries > 1 min old
const count = await redis.zCard('ratelimit:user:42');
console.log(`Requests in last 60s: ${count}`);
```

**When to use:** leaderboards, trending/top-N queries, sliding window counters, priority queues.

### Redis Eviction Policies

When Redis reaches `maxmemory`, it must decide which keys to remove. The policy is set via `maxmemory-policy` in `redis.conf`.

| Policy | Behavior | Best for |
|---|---|---|
| `noeviction` | Returns error on write when full | When data loss is unacceptable (sessions) |
| `allkeys-lru` | Evicts least-recently-used key from *all* keys | General-purpose cache |
| `volatile-lru` | Evicts LRU key from keys *with a TTL set* | Mix of cache (TTL) and persistent (no TTL) data |
| `allkeys-lfu` | Evicts least-*frequently*-used key *(Redis 4.0+)* | Workloads with clear hot/cold split |
| `volatile-ttl` | Evicts keys with the shortest remaining TTL | When you want TTL to act as a priority |
| `allkeys-random` | Evicts random key | When all keys are equally important |

**The critical insight:** `allkeys-lru` is the right default for a pure cache. If you're using Redis for both caching *and* persistent data (session store, job queue), use `volatile-lru` and make sure cache keys always have a TTL, while persistent keys don't. Otherwise, eviction might delete a job from your queue to make room for a cache entry.

Redis LRU is approximate — it samples `maxmemory-samples` keys (default 5) and evicts the oldest among those. Increasing the sample size to 10 gives near-exact LRU at minimal CPU cost.

### CDN vs Application-Level Caching

| Dimension | Application Cache (Redis) | CDN (CloudFront, Cloudflare, Fastly) |
|---|---|---|
| **Location** | Same region as your servers | Edge nodes worldwide |
| **Latency** | 0.5-2ms (in-region Redis) | Eliminates network round-trip to origin |
| **Content type** | Any serialized data | HTTP responses (static assets, API responses) |
| **Cache key** | Your choice (any string) | URL + Vary headers |
| **Invalidation** | Instant (`DEL key`) | Seconds to minutes (propagation delay) |
| **Logic** | Full application logic | Header-driven rules, limited edge compute |
| **Cost** | Per-GB memory (expensive) | Per-GB transfer (cheaper for static content) |

### Cache-Control Headers

The browser and CDN both obey `Cache-Control` headers.

```typescript
// run: npx tsx cache-headers.ts
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  if (req.url === '/api/config') {
    // Public, cacheable by CDN and browsers for 5 minutes.
    // stale-while-revalidate: serve stale for 60s while revalidating in background.
    res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ theme: 'dark', features: ['chat', 'search'] }));
    return;
  }

  if (req.url === '/api/me') {
    // Private — only browser cache, never CDN. Contains user-specific data.
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ id: 42, name: 'Alice' }));
    return;
  }

  if (req.url?.startsWith('/assets/')) {
    // Immutable static assets with content-hash in filename.
    // Cache forever — the filename changes when content changes.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end('/* bundled JS */');
    return;
  }

  // No caching for dynamic, user-specific, or sensitive endpoints.
  res.setHeader('Cache-Control', 'no-store');
  res.end('ok');
});

server.listen(3000, () => console.log('Listening on :3000'));
```

**Key directives:**

| Directive | Meaning |
|---|---|
| `public` | CDN and browser may cache |
| `private` | Only browser may cache (user-specific data) |
| `max-age=N` | Fresh for N seconds |
| `s-maxage=N` | CDN-specific max-age (overrides `max-age` for CDN) |
| `no-store` | Don't cache at all |
| `no-cache` | Cache it, but **revalidate** with origin before every use |
| `stale-while-revalidate=N` | Serve stale for N seconds while refreshing in background |
| `immutable` | Content will never change at this URL (used with hashed filenames) |

### Tag-Based Invalidation

When a product changes, you might need to invalidate:
- `product:42` (the product itself)
- `category:electronics` (listing that includes the product)
- `search:widget` (search results that match the product)
- `homepage:featured` (the homepage carousel)

Tracking these relationships manually is error-prone. **Tag-based invalidation** solves this.

```typescript
// run: npx tsx tag-invalidation.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// When caching, also record which tags this key belongs to
async function setWithTags(
  key: string,
  value: string,
  ttl: number,
  tags: string[],
): Promise<void> {
  const multi = redis.multi();
  multi.set(key, value, { EX: ttl });
  for (const tag of tags) {
    multi.sAdd(`tag:${tag}`, key);    // Tag → set of keys
    multi.expire(`tag:${tag}`, ttl + 60); // Tag set lives slightly longer
  }
  await multi.exec();
}

// Invalidate all keys associated with a tag
async function invalidateByTag(tag: string): Promise<number> {
  const keys = await redis.sMembers(`tag:${tag}`);
  if (keys.length === 0) return 0;

  const multi = redis.multi();
  for (const key of keys) {
    multi.del(key);
  }
  multi.del(`tag:${tag}`);
  await multi.exec();

  return keys.length;
}

// Usage
await setWithTags('product:42', '{"name":"Widget"}', 3600, ['products', 'category:electronics']);
await setWithTags('category:electronics', '[...]', 3600, ['categories', 'category:electronics']);

// Product updated — invalidate everything tagged 'category:electronics'
const invalidated = await invalidateByTag('category:electronics');
console.log(`Invalidated ${invalidated} keys`);
```

### Multi-Layer Caching Architecture

```
  Browser ─────▶ CDN ─────▶ Load Balancer ─────▶ App (in-process Map)
                                                        │
                                                        ▼
                                                     Redis
                                                        │
                                                        ▼
                                                    Database
```

Read path: check each layer from left to right. The first hit serves the response. Each miss populates the layer for the next request.

```typescript
// run: npx tsx multi-layer.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// Layer 1: In-process LRU (tiny, per-pod, microsecond access)
class LRUCache {
  private cache = new Map<string, { value: string; expires: number }>();
  constructor(private maxSize: number) {}

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry || entry.expires < Date.now()) {
      this.cache.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: string, ttlMs: number): void {
    if (this.cache.size >= this.maxSize) {
      // Evict oldest (first key in Map insertion order)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expires: Date.now() + ttlMs });
  }
}

const l1 = new LRUCache(1000);

async function multiLayerGet(
  key: string,
  fetchFromDb: () => Promise<string>,
): Promise<string> {
  // Layer 1: in-process
  const fromL1 = l1.get(key);
  if (fromL1 !== null) return fromL1;

  // Layer 2: Redis
  const fromRedis = await redis.get(key);
  if (fromRedis !== null) {
    l1.set(key, fromRedis, 10_000); // L1 TTL: 10s (short, to limit staleness)
    return fromRedis;
  }

  // Layer 3: Database
  const fromDb = await fetchFromDb();
  await redis.set(key, fromDb, { EX: 300 });    // L2 TTL: 5 min
  l1.set(key, fromDb, 10_000);                    // L1 TTL: 10s
  return fromDb;
}
```

**L1 TTL must be short** (5-30 seconds). Because each pod has its own L1, there's no way to invalidate it across pods without a pub/sub mechanism. A short L1 TTL bounds the staleness window.

## :collision: Where It Bites (Production Lens)

::: warning Where It Bites

**1. Redis `noeviction` + no monitoring = write failures.** Your Redis instance hits `maxmemory`. With `noeviction` policy, every `SET` command returns an `OOM` error. If your application doesn't handle this error, it either crashes or serves errors to every user. **Symptom:** sudden spike in 500 errors; Redis logs show `OOM command not allowed`. **Diagnosis:** `redis-cli info memory` shows `used_memory` at or above `maxmemory`. **Fix:** switch to `allkeys-lru` for cache workloads; alert when memory usage exceeds 80%.

**2. CDN caching a `Set-Cookie` response.** Your API response includes `Set-Cookie` but you accidentally set `Cache-Control: public`. The CDN caches the response, including the cookie. Every subsequent user gets the first user's session cookie. **Symptom:** users are logged in as someone else. **Root cause:** `public` cache + user-specific headers. **Fix:** never set `public` on responses containing `Set-Cookie` or `Authorization` headers. Use `private` or `no-store` for authenticated endpoints. CDN providers like Cloudflare strip `Set-Cookie` on `public` responses, but don't rely on vendor-specific behavior.

**3. In-process cache divergence across pods.** You have 10 pods, each with its own L1 `Map` cache. A product price changes. You invalidate Redis and the database, but each pod's L1 still holds the old price for up to its TTL. For 10 seconds, some users see the old price and some see the new price. If someone adds the item to their cart from a pod with the old price, you have a pricing dispute. **Symptom:** intermittent price discrepancies reported by users. **Fix:** keep L1 TTL very short (5-10s), or use Redis Pub/Sub to broadcast invalidation events to all pods so they can clear their L1.

**4. `Vary` header misconfiguration.** You set `Vary: *` on an API response. The CDN interprets this as "every request is unique" and never caches anything. Or worse: you forget `Vary: Accept-Encoding` and the CDN caches a gzip response and serves it to a client that only accepts plain text. **Symptom:** either zero CDN hit ratio (check CDN analytics) or garbled responses for some clients. **Fix:** set `Vary` to exactly the headers that affect the response body (`Accept-Encoding`, `Accept-Language`). Never use `Vary: *` unless you intentionally want no CDN caching.
:::

## :dart: Checkpoint

::: details Question 1 — Eviction policy choice
**Q:** Your Redis instance stores both cache data (product listings) and persistent data (user sessions that must survive restarts). Which eviction policy should you use, and what rule must every cache key follow?

**A:** Use `volatile-lru` (or `volatile-lfu`). This policy only evicts keys that have a TTL set. **Every cache key must have a TTL**, and persistent keys (sessions) must **not** have a TTL (or use a very long one managed by application logic, not eviction). This way, when Redis runs low on memory, it evicts cache entries first, leaving sessions intact. Alternatively — and often better — separate the two concerns entirely: use one Redis instance for caching (with `allkeys-lru`) and another for session storage (with `noeviction` and proper capacity planning). Mixing cache and persistent workloads in one instance is a common source of outages.
:::

::: details Question 2 — CDN + API caching
**Q:** You want to cache a public API response at the CDN edge for 5 minutes, but your application also caches it in Redis for 10 minutes. A data update occurs. You invalidate the Redis cache instantly. What happens at the CDN layer, and how do you handle it?

**A:** The CDN continues serving the stale response for up to 5 minutes because CDN invalidation requires an explicit purge API call — it doesn't know about your Redis `DEL`. You have three options: (1) **Reduce CDN `max-age`** and rely on `stale-while-revalidate` for performance — the CDN revalidates frequently, reducing the staleness window. (2) **Use the CDN purge API** on write — send a purge request for the affected URL(s) when data changes. This adds latency to the write path and complexity (you need to know which URLs are affected), but gives near-instant invalidation. (3) **Use versioned URLs** (`/api/products?v=17`) — the client always requests the latest version, and the CDN caches each version separately. This requires the client to know the current version number (often via a lightweight "version check" endpoint that is not cached). Option 1 is simplest and works for most cases; option 2 is necessary for data that must be consistent within seconds.
:::

::: details Question 3 — Multi-layer staleness
**Q:** In a three-layer cache (L1 in-process, L2 Redis, L3 database), a write updates the database and deletes the Redis key. Describe the staleness scenarios that can still occur and how to bound them.

**A:** Two scenarios: (1) **L1 staleness** — each pod's in-process cache still holds the old value until its L1 TTL expires. With 10 pods and a 10-second L1 TTL, any given request has up to a 10-second window of serving stale data. To bound this, keep L1 TTL short (5-10s) or use Redis Pub/Sub to broadcast invalidation (`PUBLISH cache:invalidate "product:42"`) so pods can proactively clear their L1. (2) **Race between delete and re-cache** — between the Redis `DEL` and the next cache miss that repopulates, another read might hit the database, get the old value (if the database replication lag hasn't propagated the write to the read replica yet), and re-cache stale data. This is the **delete-read-replica race**. Mitigations: read from the primary for a short window after writes, use write-through instead of delete-on-write, or accept the staleness as bounded by the next TTL cycle.
:::

## :building_construction: Design It

**Scenario:** Design caching for a news site. Breaking news must be visible within 30 seconds. Regular articles can tolerate 5 minutes of staleness. The site serves 50,000 req/s globally.

::: details Worked Solution

**Layer 1: CDN (global edge)**

- **Breaking news articles:** `Cache-Control: public, s-maxage=10, stale-while-revalidate=20`. The CDN caches for 10 seconds; during seconds 10-30, it serves stale while revalidating in the background. Worst case: 30 seconds of staleness.
- **Regular articles:** `Cache-Control: public, s-maxage=300, stale-while-revalidate=60`. Cached for 5 minutes at the edge.
- **Article lists / homepage:** `Cache-Control: public, s-maxage=30, stale-while-revalidate=30`. Updated frequently enough that breaking news appears on the homepage within 60 seconds.
- **User-specific data (saved articles, preferences):** `Cache-Control: private, no-store`.

**Layer 2: Redis (app-level, in-region)**

```typescript
// run: npx tsx news-cache.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

interface Article {
  id: string;
  title: string;
  isBreaking: boolean;
  content: string;
  publishedAt: string;
}

async function cacheArticle(article: Article): Promise<void> {
  const ttl = article.isBreaking ? 15 : 300; // 15s for breaking, 5min for regular
  const key = `article:${article.id}`;

  await redis.set(key, JSON.stringify(article), { EX: ttl });

  // Tag-based: when "breaking" list changes, invalidate listing caches
  if (article.isBreaking) {
    await redis.sAdd('tag:breaking', key);
    await redis.del('listing:homepage');
    await redis.del('listing:breaking');
  }
}

async function getArticle(id: string): Promise<Article | null> {
  const cached = await redis.get(`article:${id}`);
  if (cached) return JSON.parse(cached) as Article;
  return null; // caller fetches from DB and calls cacheArticle
}
```

**Layer 3: Database (PostgreSQL)**

- Read replicas for article reads. Primary for writes.
- Breaking news writes go to primary; a `NOTIFY` trigger on the articles table pushes to a listener that invalidates Redis and issues CDN purge requests.

**Breaking news flow:**
1. Editor publishes breaking article → write to DB primary.
2. DB trigger fires → app listener receives notification.
3. Listener: `DEL article:X`, `DEL listing:homepage`, `DEL listing:breaking` in Redis.
4. Listener: CDN purge API call for `/articles/X`, `/`, `/breaking`.
5. Next request: cache miss → fetch from DB → populate Redis → serve with short `s-maxage`.

**Cost optimization:**
- At 50,000 req/s, most traffic is served from CDN (>95% for articles). Only ~2,500 req/s reach the origin.
- Redis handles ~2,000 req/s of origin traffic (cache hits). Database sees ~500 req/s.
- Breaking news purges add ~10 CDN API calls per breaking article. At most a few per hour.

**Why not websockets for breaking news?** For a read-heavy news site, HTTP caching at the CDN is far more cost-effective than maintaining 50,000 websocket connections. The 30-second staleness SLA is easily met with short `s-maxage` + `stale-while-revalidate`.
:::

## Key Mental Models

- **Redis is your shared L2; in-process cache is your private L1; CDN is your global L0.** Each layer trades consistency for speed. Know which layer you're optimizing.
- **Eviction policy is your safety net, not your strategy.** Set TTLs deliberately. Rely on eviction only for unexpected memory pressure.
- **`Cache-Control` is a contract with intermediaries.** Every CDN, proxy, and browser obeys it. A wrong header leaks private data or kills performance. Audit it.
- **Tag-based invalidation scales where key-by-key invalidation doesn't.** If changing one entity means invalidating twenty cache keys, track the relationship explicitly.
- **Immutable URLs + long TTL is the strongest caching pattern.** Content-hash in the filename means the URL changes when content changes. No invalidation needed. Use it for every static asset.

## Related

- [Cache-Aside, Write-Through & Stampede](./01-patterns) — caching patterns and stampede protection
- [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq) — Redis as a queue backing store, not just a cache
- [Rate Limiting Algorithms](/system-design/scaling/02-rate-limiting) — rate limiting with Redis sorted sets and Lua scripts
- [Load Balancing & Streaming](/system-design/load-balancing/03-streaming-sse) — CDN/nginx interactions with SSE streaming
