---
title: Distributed Failure Modes
outline: deep
---

# Distributed Failure Modes

<Badge type="danger" text="High interview weight" /> <Badge type="warning" text="Prereqs: Microservices basics, HTTP" />

## 🗣️ In Plain English

::: tip In Plain English
Imagine an office building with many departments. In a small company (a monolith), everyone is in one room. If the lights go out, everyone is affected equally — but at least you can see the problem and fix it in one place.

Now imagine each department moves to its own building across town (microservices). The accounting building might lose power while engineering is fine. The network connecting them might go down. A delivery truck might block the road between two buildings. Problems become **partial** — some parts work while others don't, and the tricky part is that the working parts might not even realize the broken parts are down until they try to communicate.

This is the fundamental challenge of distributed systems: **partial failure**. In a monolith, a function call either works or throws an exception instantly. In a distributed system, a network call can succeed, fail, or — worst of all — *hang indefinitely*. You don't know if the other service is down, slow, or if the network ate your request. This ambiguity is what makes distributed failure so dangerous.

The good news is that we have well-tested patterns for handling this. **Timeouts** ensure you don't wait forever. **Circuit breakers** stop you from repeatedly calling a service that's clearly down. **Bulkheads** prevent a failure in one area from draining resources everywhere else. **Retries with backoff** let you recover from transient glitches without making things worse.

The common thread across all these patterns is the same principle: **plan for failure as a normal operating condition, not an exception**. In a distributed system, something is always failing somewhere. The system's resilience comes not from preventing failures (impossible), but from containing them and degrading gracefully.
:::

## ⚙️ Under the Hood

### Partial Failure: The Fundamental Challenge

In a distributed system, three things can happen when Service A calls Service B:

1. **Success:** B responds with a valid result.
2. **Failure:** B responds with an error (4xx, 5xx).
3. **Ambiguity:** B doesn't respond at all. Did B receive the request? Did it process it? Did the response get lost on the way back? A doesn't know.

Case 3 is the killer. With a local function call, you get a result or an exception — there's no middle ground. Over a network, the middle ground is the default. This is why **every network call must have a timeout**.

### Timeouts as Contracts

A timeout is not just a safety net — it's a contract between services. It says: "I will wait this long for your response, and no longer."

**Timeout types:**

| Type | What it bounds | Example |
|---|---|---|
| **Connection timeout** | Time to establish a TCP connection | 1-3 seconds |
| **Read/response timeout** | Time to receive a response after sending the request | 500ms-5s depending on operation |
| **Idle timeout** | Time a connection can sit unused before being closed | 30-60 seconds |

**Timeout budgeting:**

If your API has a 2-second SLA to the end user, you must budget that time across the call chain:

```
User → API Gateway (50ms) → OrderService (100ms processing)
                                → PaymentService (800ms timeout)
                                → InventoryService (600ms timeout)
                            ← Response assembly (50ms)
                        ← Network overhead (200ms buffer)
Total budget: 50 + 100 + max(800, 600) + 50 + 200 = 1200ms ✓
```

If PaymentService and InventoryService are called in parallel, you use the max. If sequential, you use the sum — and 800 + 600 = 1400ms doesn't fit in a 2-second budget. This forces you to either parallelize or tighten individual timeouts.

**The no-timeout antipattern:** A service that doesn't set a timeout will wait indefinitely. If the downstream is slow, the calling service's threads/connections accumulate and are never released. Under load, this exhausts the calling service's resources and it goes down too. This is the primary mechanism behind cascading failures.

### Circuit Breaker Pattern

A circuit breaker wraps calls to an external service and monitors for failures. It has three states:

```
         ┌──────────────────────────┐
         │                          │
         ▼                          │
    ┌─────────┐   failure threshold  ┌──────┐
    │ CLOSED  │ ──────────────────► │ OPEN │
    │ (normal)│                      │(fail)│
    └─────────┘                      └──────┘
         ▲                              │
         │   probe succeeds             │ cooldown expires
         │                              ▼
    ┌──────────┐                   ┌──────────┐
    │ CLOSED   │ ◄──────────────── │HALF-OPEN │
    └──────────┘   probe fails     │ (testing)│
                   ──────────────► └──────────┘
                   back to OPEN
```

**CLOSED (normal operation):** Requests pass through. The breaker counts failures. If failures exceed a threshold (e.g., 5 failures in 30 seconds, or error rate > 50%), the circuit **opens**.

**OPEN (failing fast):** All requests fail immediately without calling the downstream service. No resources are wasted. A fallback response is returned (cached data, default value, or a friendly error). After a cooldown period (e.g., 30 seconds), the circuit transitions to half-open.

**HALF-OPEN (probing):** The breaker allows a single request through. If it succeeds, the circuit **closes** and normal traffic resumes. If it fails, the circuit **opens** again and the cooldown resets.

**Implementation considerations:**

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;      // e.g., 5
  failureWindow: number;         // e.g., 30_000 ms
  cooldownPeriod: number;        // e.g., 30_000 ms
  halfOpenMaxAttempts: number;   // e.g., 1
  monitoredErrors: Array<(error: unknown) => boolean>; // which errors count
}
```

Not all errors should trip the breaker. A 400 Bad Request is a client error — the downstream is healthy, the request was bad. A 503 Service Unavailable or a timeout should trip it. Configure `monitoredErrors` carefully.

**Libraries:** [opossum](https://github.com/nodeshift/opossum) for Node.js, Resilience4j for Java, Polly for .NET.

### Bulkhead Pattern

Named after ship compartments that prevent a leak from sinking the whole vessel. In software, a bulkhead isolates resources so that one failing dependency can't consume all resources.

**Thread pool bulkhead:** Assign a dedicated connection pool to each downstream service. If the Payment Service pool (10 connections) is exhausted, the Inventory Service pool (10 connections) is unaffected.

```
Service A
├── PaymentService pool:    [10 connections] ← saturated, all waiting
├── InventoryService pool:  [10 connections] ← healthy, working normally
└── UserService pool:       [10 connections] ← healthy, working normally
```

Without bulkheads, a single shared pool of 30 connections could be fully consumed by a slow Payment Service, starving Inventory and User calls.

**Semaphore bulkhead:** Limit the number of concurrent requests to a dependency using a semaphore. Lighter than a thread pool but doesn't provide queueing.

**Partition by criticality:** Critical paths (checkout) and non-critical paths (recommendations) should have separate resource pools. A slow recommendation engine should never affect checkout.

### Retry Storms: When Retries Make Things Worse

Retries are essential for transient failures (network blip, brief GC pause). But naive retries amplify load on a struggling service:

```
Service C is slow → B retries 3x → A retries 3x on each B attempt
Result: 1 user request becomes 3 × 3 = 9 requests to C
With 1000 concurrent users: 9,000 requests to C instead of 1,000
```

**Mitigation strategies:**

1. **Exponential backoff:** Wait 100ms, 200ms, 400ms, 800ms between retries. Spreads retry load over time.

2. **Jitter:** Add randomness to the backoff. Without jitter, 1,000 clients that all fail at the same time will all retry at the same time (100ms later), creating a synchronized thundering herd. With jitter: `delay = baseDelay * 2^attempt + random(0, baseDelay)`.

3. **Retry budget:** Limit total retries across the system. "Retry at most 10% of requests in any 10-second window." If you've retried 10% of requests and they're all failing, more retries won't help — the dependency is down.

4. **Limit retry depth:** Only retry at one layer. If B retries calls to C, A should *not* also retry calls to B. The outermost caller sets the retry policy; inner callers fail fast.

5. **Idempotency:** Only retry operations that are safe to repeat. `GET /orders/123` is idempotent. `POST /payments` might not be — unless you use an idempotency key.

```typescript
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  maxRetries = 3,
  baseDelay = 100,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(2_000), // always set a timeout
      });
      if (response.status < 500) return response; // don't retry 4xx
      throw new Error(`Server error: ${response.status}`);
    } catch (error) {
      if (attempt === maxRetries) throw error;
      const delay = baseDelay * 2 ** attempt + Math.random() * baseDelay;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Unreachable');
}
```

### Health Checks and Readiness Probes

In container orchestration (Kubernetes), two types of health checks determine a service's fate:

**Liveness probe:** "Is the process alive and not deadlocked?" If this fails, the container is killed and restarted. Keep it simple — return 200 if the event loop is responsive.

**Readiness probe:** "Can this instance accept traffic?" If this fails, the instance is removed from the load balancer but not killed. Use this to check dependencies:

```typescript
// GET /health/ready
app.get('/health/ready', async (req, res) => {
  try {
    await db.query('SELECT 1');           // database reachable?
    await redis.ping();                    // cache reachable?
    res.status(200).json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'not ready' });
  }
});

// GET /health/live — keep it simple
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});
```

**Startup probe:** For services with slow initialization (loading ML models, warming caches). Prevents liveness probes from killing a container that's still starting up.

**Common mistake:** Making the liveness probe check downstream dependencies. If the database is down, the liveness probe fails, Kubernetes restarts the container, the new container also can't reach the database, it gets restarted again — restart loop. The database being down is a *readiness* concern, not a liveness concern.

### Graceful Degradation Strategies

Design every feature with a fallback for when its dependency is unavailable:

| Feature | Primary Source | Fallback |
|---|---|---|
| Product recommendations | RecommendationService (ML) | Static "popular items" list |
| Pricing | PricingService (dynamic) | Last-known cached price + "prices may vary" warning |
| User avatar | UserService | Default avatar placeholder |
| Search autocomplete | SearchService (Elasticsearch) | Disable autocomplete, show basic search |
| Review scores | ReviewService | Hide review section entirely |

**Degradation hierarchy:**
1. **Full functionality** — everything works
2. **Stale data** — serve cached/slightly-outdated data
3. **Reduced functionality** — hide the feature, show a simplified version
4. **Informative error** — tell the user what's wrong and when to retry
5. **Complete failure** — last resort, should be rare if you design the layers above

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Gray failures.** The service isn't down — it's slow. A complete outage is easy to detect (connection refused). A service responding in 8 seconds instead of 80ms is much harder to detect and much more damaging. The circuit breaker needs to treat slow responses (exceeding timeout) as failures, not just errors.

**Retry storms during deploys.** A rolling deployment takes instances out of the pool temporarily. If the remaining instances are near capacity, the extra load from retries (targeting the remaining instances) can cascade into a full outage. Use retry budgets and ensure sufficient headroom before deploying.

**Health check that lies.** A readiness probe returns 200, but the service is actually serving errors because its internal state is corrupted (e.g., stale config, expired certificate). Health checks should verify that the service can actually process a representative request, not just that the HTTP server is responding.

**Circuit breaker that never closes.** If the half-open probe always fails because the single probe request happens to hit an error, the circuit stays open indefinitely — even after the downstream has recovered. Solutions: send multiple probes in half-open state, or use a gradual ramp-up (send 10%, then 25%, then 50% of traffic).
:::

## 🎯 Checkpoint

::: details Question 1 — Timeout Budgeting
**Q:** Your API has a 3-second SLA. It calls Service B (which takes 200ms of processing and calls Service C). What's the maximum timeout Service B should set for its call to Service C?

**A:** Working backward: 3,000ms SLA minus network overhead (budget ~200ms for request/response network hops) minus B's processing time (200ms) minus response assembly (~100ms) = approximately 2,500ms maximum for B's call to C. In practice, you'd set it lower (e.g., 2,000ms) to leave a safety buffer. The key insight is that timeout budgets must be planned top-down from the end-user SLA, not set independently per service.
:::

::: details Question 2 — Circuit Breaker States
**Q:** A circuit breaker is in the OPEN state. What happens when a new request comes in, and why is this better than letting the request through?

**A:** The request fails immediately with a fallback response (cached data, default value, or a descriptive error). No network call is made to the downstream service. This is better because: (1) the caller gets a fast response instead of waiting for a timeout, (2) the struggling downstream service doesn't receive additional load that would slow its recovery, and (3) system resources (connections, threads) aren't wasted on calls that will almost certainly fail.
:::

::: details Question 3 — Liveness vs Readiness
**Q:** Your Node.js service depends on a PostgreSQL database. Should the database connection check be in the liveness probe or the readiness probe? What happens if you choose wrong?

**A:** The readiness probe. If you put the database check in the liveness probe and the database goes down, Kubernetes will kill and restart the container. But the new container also can't reach the database, so it fails the liveness check too, and Kubernetes restarts it again — creating an infinite restart loop that wastes resources and adds startup load. With the readiness probe, the container stays alive but is removed from the load balancer. When the database recovers, the readiness probe passes and the container is added back to the pool without any restart.
:::

## 🏗️ Design It

**Scenario:** Your recommendation service is down. Your product page shows recommendations. How do you prevent the product page from failing too?

::: details Worked Solution
**The problem:** The product page calls the RecommendationService to show "You might also like" products. If RecommendationService is down and the product page waits for it synchronously without protection, the product page either times out (slow user experience) or errors out entirely (broken page). Users can't view or buy any product — a non-critical feature takes down a critical page.

**Layered solution:**

**Layer 1 — Aggressive timeout (first line of defense)**
Set a 300ms timeout on the call to RecommendationService. Recommendations are a "nice to have" — they should never contribute more than 300ms to page load time.

```typescript
async function getRecommendations(productId: string): Promise<Product[]> {
  try {
    const response = await fetch(
      `http://recommendation-service/products/${productId}/similar`,
      { signal: AbortSignal.timeout(300) },
    );
    if (!response.ok) throw new Error(`Status: ${response.status}`);
    return await response.json() as Product[];
  } catch {
    return getFallbackRecommendations(productId);
  }
}
```

**Layer 2 — Circuit breaker (stop calling a dead service)**
After 5 failures in 30 seconds, stop calling RecommendationService entirely. Serve fallbacks immediately without even attempting the network call. Probe every 30 seconds to check recovery.

**Layer 3 — Fallback hierarchy**
```
1. Fresh recommendations from RecommendationService (primary)
2. Cached recommendations for this product (Redis, last successful response)
3. Cached "popular products" in this category (precomputed daily)
4. Static "bestsellers" list (hardcoded, updated weekly)
5. Hide the recommendations section entirely
```

Each fallback is progressively less personalized but always available. The product page renders with whatever level of recommendations is available.

**Layer 4 — Bulkhead isolation**
The RecommendationService call gets its own connection pool (5 connections max). Even if all 5 are hanging, the product page's connections for ProductService, PricingService, and ReviewService are unaffected.

**Layer 5 — Async loading (UI-level resilience)**
Render the product page without recommendations. Load recommendations asynchronously via a separate API call from the frontend. If it fails, the section shows "Loading recommendations..." briefly and then disappears.

```
Product Page (renders in 400ms)
├── Product details ← critical, sync
├── Price ← critical, sync
├── Reviews ← important, sync with circuit breaker
└── Recommendations ← non-critical, async with fallback
```

**Monitoring and alerting:**
- Alert when the circuit breaker opens (the team should investigate).
- Track the fallback rate: "50% of product pages are showing cached recommendations" — useful for understanding user experience impact.
- Track recommendation click-through rate by source (live vs. cached vs. static) to quantify the business impact of degradation.

**Key principle:** The product page is the revenue-generating surface. No non-critical feature should ever take it down. Design the page so that every section can independently degrade, from "real-time personalized" down to "hidden," without affecting the core experience of viewing and purchasing a product.
:::

## Key Mental Models

- **Partial failure is the norm, not the exception.** Design every inter-service call assuming the other side might not respond.
- **A missing timeout is a latent outage.** Every network call must have a timeout. No exceptions.
- **Circuit breakers protect the caller AND the callee.** They prevent resource exhaustion in the caller and reduce load on a struggling callee, giving it room to recover.
- **Retries help transient failures but amplify sustained failures.** Use exponential backoff, jitter, and retry budgets to prevent retries from becoming a denial-of-service attack on your own infrastructure.
- **Liveness means "am I alive?" — readiness means "can I serve traffic?"** Never check downstream dependencies in the liveness probe.

## Related

- [Sync vs Async Communication](./01-communication)
- [Sagas & Distributed Transactions](./02-sagas)
- [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown)
