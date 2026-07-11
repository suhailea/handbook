---
title: Horizontal vs Vertical Scaling
outline: deep
---

# Horizontal vs Vertical Scaling

**Interview weight:** :fire::fire::fire: | **Prerequisites:** basic infrastructure knowledge | **Relevant to:** every production system at growth stage

## :speaking_head: In Plain English

::: tip In Plain English
You run a pizza shop with one oven. Business is booming. You have two options.

**Option A: Buy a bigger oven.** A commercial oven that handles ten times the pizzas. Expensive, but your kitchen workflow doesn't change. One oven, one set of controls, one temperature to monitor. This is **vertical scaling** — making your single machine more powerful (more CPU, more RAM, faster disks).

**Option B: Open more shops.** Each shop has a normal oven. A central phone line takes orders and routes them to whichever shop is least busy. Now you need to solve new problems: every shop needs the same menu and recipes (same code), no shop can keep a customer's "usual order" in its head because the next call might go to a different shop (statelessness), and if one shop runs out of mozzarella, it can't borrow from another shop's fridge easily (shared state). This is **horizontal scaling** — adding more machines.

Most real systems use both. You start by buying the biggest reasonable oven (vertical) because it's simpler. When you hit the physical limit of what one oven can do — or when you need to keep serving pizzas even if one oven breaks — you open more shops (horizontal).

The critical rule for horizontal scaling: **no shop can assume the same customer will come back to it.** Every request must carry everything the shop needs to serve it, or there must be a shared notebook (a database or Redis) that all shops can read. This is what engineers mean by "stateless services."
:::

## :gear: Under the Hood

### Vertical Scaling

Adding resources to a single node: bigger EC2 instance, more RAM, faster NVMe, upgrading from 4 to 64 CPU cores.

**When it works well:**
- Databases (PostgreSQL, MySQL) — sharding is painful; a bigger box delays it.
- Stateful workloads (in-memory caches, ML model inference).
- Early-stage products where engineering time >> server cost.

**Hard limits:**

| Resource | Practical ceiling (2024 cloud) |
|---|---|
| CPU cores | 192-448 vCPUs (AWS `u-24tb1.metal`, `c7i.metal-48xl`) |
| RAM | 24 TB (AWS high-memory instances) |
| Network | 200 Gbps (ENA) |
| Disk IOPS | ~400,000 (io2 Block Express) |

Beyond these, you *must* scale horizontally. Even before these limits, vertical scaling has diminishing returns: doubling the instance size rarely doubles throughput due to shared-resource contention (memory bus, L3 cache, kernel lock contention).

**Cost curve:** vertical scaling follows a superlinear cost curve. A machine with 2x the CPU often costs 2.5-3x the price. Horizontal scaling follows a near-linear cost curve (2x machines ≈ 2x cost), but with higher operational overhead.

### Horizontal Scaling

Adding more machines (nodes, pods, instances) running the same application, behind a load balancer.

#### The Statelessness Requirement

A horizontally-scaled service must be **stateless** — no request can depend on which instance handles it, because the load balancer may send consecutive requests from the same client to different instances.

What must be externalized:

| In-process state | Externalized to |
|---|---|
| User sessions | Redis, database, or JWT (client-side) |
| File uploads (temp files) | Object storage (S3, GCS) |
| In-memory caches | Redis (shared L2) |
| Background job state | Redis/database-backed queue |
| WebSocket connections | Redis Pub/Sub for cross-pod messaging |

```typescript
// run: npx tsx stateless-session.ts
import { createServer } from 'node:http';
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// BAD: in-process session store — fails with multiple pods
// const sessions = new Map<string, object>();

// GOOD: Redis-backed session lookup
const server = createServer(async (req, res) => {
  const sessionId = req.headers.cookie
    ?.split(';')
    .find((c) => c.trim().startsWith('sid='))
    ?.split('=')[1];

  if (!sessionId) {
    res.writeHead(401);
    res.end('No session');
    return;
  }

  // Any pod can serve this — session lives in Redis
  const session = await redis.get(`session:${sessionId}`);
  if (!session) {
    res.writeHead(401);
    res.end('Invalid session');
    return;
  }

  const user = JSON.parse(session);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: `Hello ${user.name}` }));
});

server.listen(3000);
```

#### Session Management Strategies

| Strategy | Mechanism | Trade-offs |
|---|---|---|
| **Sticky sessions** | Load balancer routes same client to same pod (cookie/IP hash) | Breaks on pod restart; uneven load distribution; doesn't scale |
| **Centralized session store** | Redis/Memcached holds session data | Extra hop per request (~1ms); Redis becomes SPOF if not clustered |
| **JWT (client-side)** | Signed token in cookie/header; no server-side lookup | Can't revoke without a blocklist; token size grows with claims |
| **Hybrid (JWT + Redis)** | JWT for identity/claims; Redis for revocation check | Best of both; slight complexity |

### Database Scaling

The database is usually the hardest component to scale horizontally.

#### Read Replicas

```
  Writes ──▶ Primary ──replication──▶ Replica 1
                                  ──▶ Replica 2
                                  ──▶ Replica 3

  Reads ──▶ Load balancer ──▶ Any replica (or primary)
```

- **Replication lag:** replicas are eventually consistent. Writes to the primary take milliseconds to propagate. A user who writes and immediately reads may not see their own write if the read hits a lagging replica.
- **Read-your-own-writes consistency:** route reads from the same user to the primary for a few seconds after a write, then fall back to replicas.

```typescript
// run: npx tsx read-routing.ts

// Simplified read/write routing
function getConnectionPool(
  operation: 'read' | 'write',
  userId: string,
  recentWriters: Map<string, number>,
): string {
  if (operation === 'write') {
    // Record that this user recently wrote
    recentWriters.set(userId, Date.now());
    return 'primary';
  }

  // Read — check if user wrote in the last 5 seconds
  const lastWrite = recentWriters.get(userId);
  if (lastWrite && Date.now() - lastWrite < 5000) {
    return 'primary'; // Read from primary for consistency
  }

  return 'replica'; // Safe to read from replica
}

const recentWriters = new Map<string, number>();
console.log(getConnectionPool('write', 'user-42', recentWriters)); // 'primary'
console.log(getConnectionPool('read', 'user-42', recentWriters));  // 'primary' (recent write)
```

#### Sharding (Horizontal Partitioning)

Split data across multiple database instances by a shard key.

```
  Shard key: user_id % 4

  user_id 1  ──▶ Shard 0  (users 0, 4, 8, 12, ...)
  user_id 2  ──▶ Shard 1  (users 1, 5, 9, 13, ...)
  user_id 5  ──▶ Shard 1
  user_id 10 ──▶ Shard 2  (users 2, 6, 10, 14, ...)
  user_id 15 ──▶ Shard 3  (users 3, 7, 11, 15, ...)
```

**Shard key selection is critical:**
- Must distribute data evenly (avoid hot shards).
- Queries that span multiple shards (cross-shard joins) are expensive or impossible.
- Re-sharding (adding a shard) requires data migration.

**Consistent hashing** mitigates re-sharding pain: instead of `key % N`, use a hash ring where adding a node only moves `~1/N` of keys, not all of them.

### Kubernetes HPA (Horizontal Pod Autoscaler)

K8s automates horizontal scaling by watching metrics and adjusting replica counts.

```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-server
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-server
  minReplicas: 3
  maxReplicas: 50
  metrics:
    # Scale based on CPU usage
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    # Scale based on custom metric: event loop utilization
    - type: Pods
      pods:
        metric:
          name: nodejs_eventloop_utilization
        target:
          type: AverageValue
          averageValue: "0.7"   # Scale up when ELU > 70%
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 30   # React quickly to load spikes
      policies:
        - type: Pods
          value: 5                      # Add at most 5 pods per 30s
          periodSeconds: 30
    scaleDown:
      stabilizationWindowSeconds: 300  # Wait 5 min before scaling down
      policies:
        - type: Pods
          value: 2                      # Remove at most 2 pods per 5 min
          periodSeconds: 300
```

**Key HPA concepts:**
- **Stabilization window:** prevents flapping (rapid scale up/down). Asymmetric is best: scale up fast, scale down slow.
- **Custom metrics:** CPU is a poor signal for Node.js (single-threaded; CPU may be low while the event loop is saturated). Event loop utilization (ELU) is a better signal.
- **Pod readiness:** new pods need time to start (download image, run init containers, warm caches). HPA doesn't help if pods take 2 minutes to become ready and the traffic spike is 30 seconds.

### Cost Trade-offs

| Factor | Vertical | Horizontal |
|---|---|---|
| **Hardware cost** | Superlinear (2x power ≈ 2.5x cost) | Near-linear (2x nodes ≈ 2x cost) |
| **Ops complexity** | Low (one machine) | High (networking, service discovery, state externalization) |
| **Downtime risk** | SPOF unless paired with standby | Survives individual node failures |
| **Scaling ceiling** | Hard physical limits | Practically unlimited (with good architecture) |
| **Scaling speed** | Minutes (change instance type, restart) | Seconds (add pods) |
| **DB compatibility** | Excellent (no code changes) | Requires sharding/replication design |

## :collision: Where It Bites (Production Lens)

::: warning Where It Bites

**1. "Stateless" service that secretly has state.** Your API stores uploaded files to `/tmp` during processing and references them in subsequent requests. Works fine with one pod. With three pods behind a load balancer, the second request lands on a different pod — `/tmp/upload-abc.csv` doesn't exist. **Symptom:** intermittent "file not found" errors; works when you test locally, fails in production. **Diagnosis:** check if the error correlates with load balancer routing. **Fix:** upload to S3/GCS immediately, pass the object URL between steps.

**2. HPA scaling too slow for traffic spikes.** Your pod takes 45 seconds to start (heavy NestJS DI container, DB connection pool warmup, cache priming). HPA detects high CPU, schedules new pods, but the spike passes before they're ready. Meanwhile, existing pods are overwhelmed. **Symptom:** latency spikes every day at the same time (e.g., marketing email blast). **Fix:** pre-scale before known events (`kubectl scale`); reduce pod startup time (lazy-load modules, connection pool lazy init); keep a higher `minReplicas` baseline; use KEDA for event-driven scaling.

**3. Database connection pool exhaustion after horizontal scaling.** Each pod opens 20 database connections. You scale from 5 to 30 pods. That's 600 connections. PostgreSQL's default `max_connections` is 100. **Symptom:** `FATAL: too many connections for role "app"`. **Fix:** use a connection pooler like PgBouncer between the application and PostgreSQL. PgBouncer multiplexes hundreds of application connections onto a small number of real database connections. Set `max_connections` in PostgreSQL to 200-300, and let PgBouncer handle the fan-in.

**4. Read replica lag causing stale reads.** You scale reads to replicas but don't implement read-your-own-writes routing. Users update their profile, immediately see the old data, update again (thinking the first save failed), and now have duplicate or conflicting changes. **Symptom:** support tickets about "changes not saving" that resolve themselves after a few seconds. **Diagnosis:** check replication lag (`pg_stat_replication` in PostgreSQL). **Fix:** route reads to the primary for N seconds after a write for the same user, where N > your observed p99 replication lag.
:::

## :dart: Checkpoint

::: details Question 1 — Statelessness audit
**Q:** You're reviewing a Node.js service for horizontal scaling readiness. The service uses: (a) `express-session` with `MemoryStore`, (b) a `Map` for rate limiting counters, (c) `node:fs` to read a config file at startup. Which of these prevents horizontal scaling, and how do you fix each?

**A:** **(a) `MemoryStore`** — prevents scaling. Sessions are lost when the pod restarts and are invisible to other pods. Fix: switch to `connect-redis` or a database-backed session store. **(b) In-memory `Map` for rate limiting** — prevents scaling. Each pod tracks counters independently, so a user gets N times the allowed rate across N pods. Fix: use Redis with atomic `INCR` and `EXPIRE` (or a sliding window via sorted sets). **(c) Reading a config file at startup** — this is **fine**. The config file is baked into the container image (or mounted via ConfigMap). It's read once, it's the same across pods, and it doesn't change at runtime. This is not "state" in the scaling sense — it's configuration. The key test is: does the data change during the process lifetime, and does it need to be shared across pods? If no to both, it's not a scaling problem.
:::

::: details Question 2 — Database scaling decision
**Q:** Your PostgreSQL database handles 10,000 reads/sec and 500 writes/sec. Read latency is climbing. You have two options: (1) add 3 read replicas, or (2) shard the database into 4 shards by `user_id`. Which do you choose and why?

**A:** **Add read replicas.** The workload is read-heavy (20:1 read:write ratio), and read replicas directly address the bottleneck without the enormous complexity of sharding. Sharding is appropriate when the *write* volume exceeds what a single primary can handle, or when the dataset is too large to fit on one machine. At 500 writes/sec, a well-configured PostgreSQL primary can handle this comfortably (PostgreSQL can sustain thousands of writes/sec on modern hardware). Sharding introduces cross-shard query complexity, makes transactions across users difficult (e.g., "transfer money from user A to user B" now spans two shards), and makes schema migrations operational nightmares. The rule: exhaust vertical scaling and read replicas before sharding. Shard only when you must.
:::

::: details Question 3 — HPA metric selection
**Q:** Why is CPU utilization a poor autoscaling signal for a Node.js API server, and what metric would you use instead?

**A:** Node.js is single-threaded for JavaScript execution. An event loop can be fully saturated (100% busy, requests queuing, latency climbing) while OS-level CPU usage shows only ~12% on an 8-core machine (1/8 cores busy). HPA watching CPU at a 60% threshold would never trigger a scale-up even though the service is overloaded. **Event loop utilization (ELU)** is the correct metric. ELU measures the fraction of time the event loop spent doing actual work vs. waiting for I/O. An ELU of 0.7 means the loop is 70% busy — above 0.8, latency starts rising nonlinearly. Expose ELU via `perf_hooks.monitorEventLoopUtilization()`, publish it as a Prometheus metric, and configure HPA to scale when ELU exceeds 0.7. You can also use **p99 response latency** as a secondary signal, which captures degradation regardless of the cause.
:::

## :building_construction: Design It

**Scenario:** Your API handles 500 req/s. A partnership deal will bring 5,000 req/s within 3 months. Walk through your scaling plan.

::: details Worked Solution

**Phase 1: Measure first (Week 1)**

Before scaling anything, identify the bottleneck.

```bash
# Current state (hypothetical):
# - 2 pods, each handling 250 req/s
# - Event loop utilization: 0.65 (getting warm)
# - PostgreSQL CPU: 45%
# - Redis memory: 2GB of 8GB
# - p99 latency: 120ms (acceptable)
```

The bottleneck is likely the application tier (ELU approaching 0.8) followed by the database.

**Phase 2: Horizontal app scaling (Week 2-3)**

1. **Audit for statefulness:** check for in-process caches, file storage, session stores. Externalize to Redis.
2. **Set up HPA:**
   ```yaml
   minReplicas: 5
   maxReplicas: 30
   metric: nodejs_eventloop_utilization, target 0.6
   ```
3. **Reduce pod startup time** to under 10 seconds: lazy-load rarely-used modules, connect to DB/Redis asynchronously, defer cache warming.
4. **Deploy PgBouncer** between app and PostgreSQL. Configure 30 max connections per pod, PgBouncer pools to 100 real connections.

**Phase 3: Database scaling (Week 4-6)**

1. **Add 2 read replicas.** Route reads through a read-replica-aware connection pool.
2. **Implement read-your-own-writes:** track recent writes per user in Redis, route those users' reads to primary for 5 seconds.
3. **Add connection pooling:** PgBouncer in `transaction` mode. App sees 30 connections per pod; PgBouncer multiplexes to 100 real connections across 20 pods.

**Phase 4: Caching (Week 6-8)**

1. **Add Redis caching** for the top-20 heaviest queries (identified via slow query log). Cache-aside with 60s TTL + jitter.
2. **CDN for static responses** (public API docs, OpenAPI spec, static assets). `Cache-Control: public, max-age=3600, immutable` for hashed assets.
3. Target: 60% of reads served from cache, reducing DB load from 5,000 reads/s to ~2,000.

**Phase 5: Load testing (Week 9-10)**

1. Run load tests at 6,000 req/s (20% headroom above target).
2. Verify HPA scales correctly, pod startup time is acceptable, no connection pool exhaustion, no cache stampedes.
3. Monitor ELU, p99 latency, DB connections, Redis memory, error rate.

**Phase 6: Production readiness (Week 11-12)**

1. Set up alerts: ELU > 0.8, p99 > 500ms, error rate > 1%, DB connections > 80%.
2. Document runbooks for: manual scaling, cache flush recovery, database failover.
3. Pre-scale to 10 pods for launch day. Monitor closely for the first 48 hours.

**Cost estimate:**
- Before: 2 pods + 1 DB = ~$500/month
- After: 10-20 pods + 1 primary + 2 replicas + PgBouncer + Redis = ~$2,500-4,000/month
- Cost per request drops from $0.001 to $0.0001 due to caching and efficiency gains.
:::

## Key Mental Models

- **Scale vertically first, horizontally when you must.** Vertical is simpler, cheaper in engineering time, and has no distributed-systems overhead. Switch to horizontal when you hit hardware limits or need fault tolerance.
- **Statelessness is not optional for horizontal scaling.** If your service stores anything in process memory that a subsequent request depends on, you cannot add more instances behind a load balancer.
- **The database is the last thing to scale horizontally.** Read replicas first, sharding only when writes or data volume force it. Every shard boundary makes your application harder to reason about.
- **Scale-up fast, scale-down slow.** Traffic spikes are sudden; the cost of over-provisioning for a few minutes is far less than the cost of an outage.
- **Measure before you scale.** The bottleneck is almost never where you think it is. Profile first, optimize second, scale third.

## Related

- [Rate Limiting Algorithms](./02-rate-limiting) — distributed rate limiting across horizontally-scaled pods
- [Load Balancing](/system-design/load-balancing/) — how traffic is distributed across instances
- [Caching Patterns](/system-design/caching/01-patterns) — reduce load before scaling
- [Queues](/system-design/queues/) — decouple work to handle traffic spikes without scaling the API tier
