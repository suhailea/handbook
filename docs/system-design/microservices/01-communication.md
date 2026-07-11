---
title: Sync vs Async Communication
outline: deep
---

# Sync vs Async Communication

<Badge type="danger" text="High interview weight" /> <Badge type="warning" text="Prereqs: HTTP basics, REST APIs" />

## 🗣️ In Plain English

::: tip In Plain English
Imagine a restaurant kitchen. In a **synchronous** kitchen, the head chef shouts an order to the grill station and *stands there waiting* for the steak to finish before moving on. If the grill station is backed up or the grill breaks, the head chef is stuck — and every order behind that one piles up. One broken station can freeze the entire kitchen.

In an **asynchronous** kitchen, the head chef writes the order on a ticket and clips it to a rail. The grill cook picks it up whenever they're ready. The head chef immediately moves on to the next order. If the grill station falls behind, the tickets accumulate on the rail, but the rest of the kitchen keeps moving. When the grill comes back, it burns through the backlog.

This is the fundamental choice you face when microservices talk to each other. Synchronous communication (one service calls another and waits for a reply) is simple and intuitive — it works like a function call across the network. But it creates an invisible chain: if any link in the chain slows down or breaks, everything upstream feels the pain.

Asynchronous communication (one service drops a message onto a broker and moves on) breaks that chain. The sender doesn't need the receiver to be alive right now. The trade-off is complexity: you lose the immediate response, you have to handle messages that arrive out of order, and debugging becomes harder because there's no single request thread to follow.

Most real systems use both. A user clicking "Place Order" might get a synchronous HTTP response ("Order received!"), while the actual payment processing, inventory deduction, and email notification happen asynchronously behind the scenes. The art is knowing which conversations need to be phone calls (sync) and which can be letters (async).

Before you even reach this decision, though, there's a more fundamental question: do you need microservices at all?
:::

## ⚙️ Under the Hood

### The Monolith-First Doctrine

Martin Fowler's "monolith-first" principle is pragmatic advice, not nostalgia. Microservices impose distributed-systems costs (network latency, partial failure, operational complexity) from day one. A monolith lets you discover the real domain boundaries through experience rather than guesswork.

**When to stay monolithic:**
- Team is fewer than ~20 engineers
- Domain boundaries are unclear or shifting
- You don't yet have CI/CD, observability, or container orchestration in place
- Deployment cadence is acceptable as-is

**When to extract services:**
- A module has a distinctly different scaling profile (e.g., image processing vs. CRUD API)
- Independent deployment of a component would meaningfully accelerate a team
- A module's failure should be isolated from the rest of the system
- A component needs a different technology stack

### Synchronous Communication: REST vs gRPC

| Dimension | REST (HTTP/JSON) | gRPC (HTTP/2 + Protobuf) |
|---|---|---|
| **Encoding** | JSON (text, self-describing) | Protobuf (binary, schema-required) |
| **Contract** | OpenAPI spec (optional) | `.proto` file (mandatory) |
| **Streaming** | SSE or WebSocket (bolt-on) | Bidirectional streaming (native) |
| **Browser support** | Universal | Requires gRPC-Web proxy |
| **Payload size** | Larger (~2-10x) | Smaller, faster serialization |
| **Tooling** | Massive ecosystem | Codegen from proto, smaller ecosystem |
| **Human readability** | Excellent (curl-friendly) | Poor (binary on the wire) |
| **Best for** | Public APIs, BFFs, simple CRUD | Internal service-to-service, high-throughput RPCs |

**REST is the default for external and edge APIs.** It's human-readable, universally supported, and the tooling is unmatched. For internal service-to-service calls where latency and bandwidth matter, gRPC shines — especially for streaming use cases like real-time feeds or bidirectional communication.

### The Synchronous Pitfalls

#### 1. Cascading Failures

When Service A calls B, which calls C synchronously, A's fate is bound to C's health. If C's p99 latency spikes from 50ms to 5 seconds, B's threads/connections saturate waiting for C, then A's threads/connections saturate waiting for B. A single slow dependency can bring down an entire call chain.

```
A → B → C (down)
     ↑
     A is now also effectively down
```

#### 2. Tight Coupling

Synchronous calls create temporal coupling (both services must be alive simultaneously) and often behavioral coupling (the caller encodes assumptions about the response shape). Deploying C independently becomes risky because A and B depend on C's exact contract.

#### 3. Fan-Out Amplification

If Service A calls 4 services in parallel and each has 99.5% availability, the probability that *all four* respond is 0.995^4 = 98.0%. Add a fifth and you're at 97.5%. The more sync dependencies, the lower your composite availability.

### Asynchronous Communication via Message Brokers

A message broker (RabbitMQ, Apache Kafka, Amazon SQS, Redis Streams) sits between producer and consumer. The producer publishes a message and moves on. The consumer processes it at its own pace.

**Two primary patterns:**

#### Point-to-Point (Queue)
One message, one consumer. Used for task distribution.
```
OrderService → [payment-queue] → PaymentService
```

#### Pub/Sub (Topic)
One message, many consumers. Used for event broadcasting.
```
OrderService → [order-placed topic] → PaymentService
                                    → InventoryService
                                    → NotificationService
```

**Async advantages:**
- **Temporal decoupling:** Consumer can be down; messages wait in the broker.
- **Load leveling:** Spikes in traffic are absorbed by the queue, and consumers drain at a steady rate.
- **Independent scaling:** Scale consumers independently based on queue depth.

**Async costs:**
- **Eventual consistency:** The system is not immediately consistent after the producer publishes.
- **Debugging difficulty:** No single request ID traces a synchronous path; you need distributed tracing (correlation IDs).
- **Message ordering:** Most brokers offer ordering only within a partition/queue, not globally.
- **Exactly-once is hard:** You must design for at-least-once delivery and make consumers idempotent.

### API Gateway & BFF Patterns

#### API Gateway
A single entry point for all external traffic. It handles cross-cutting concerns:
- **Routing:** Maps `/api/orders/*` to the Order Service, `/api/users/*` to the User Service.
- **Authentication:** Validates JWTs or API keys before requests reach services.
- **Rate limiting:** Applies per-client quotas.
- **Request aggregation:** Combines responses from multiple services into one response for the client.
- **Protocol translation:** Accepts REST from the client, forwards as gRPC to internal services.

Tools: Kong, AWS API Gateway, Envoy, NGINX.

#### Backend for Frontend (BFF)
A specialized API gateway per client type. A mobile BFF returns compact payloads; a web BFF returns richer data. Each BFF is owned by the frontend team that consumes it.

```
Mobile App → Mobile BFF → OrderService, UserService
Web App    → Web BFF    → OrderService, UserService, RecommendationService
```

This prevents a "one-size-fits-all" API from becoming bloated or forcing mobile clients to over-fetch.

### Service Discovery

When services scale horizontally, their IP addresses change. Service discovery solves "how does Service A find Service B?"

**Client-side discovery:** The client queries a service registry (Consul, etcd, Eureka) and picks an instance. Simple but pushes load-balancing logic into every client.

**Server-side discovery:** The client sends requests to a load balancer (or DNS entry), which queries the registry and routes to an available instance. Simpler for clients; Kubernetes does this natively via kube-dns and Services.

**DNS-based:** The simplest form. A DNS name resolves to the set of healthy instances. Works well but has TTL caching issues — clients may route to stale addresses.

In practice, **Kubernetes Services + kube-dns** handle service discovery for most teams today. The Service abstraction provides a stable DNS name and virtual IP that routes to healthy pods automatically.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Cascading timeout chains.** Service A sets a 5-second timeout on calls to B. Service B sets a 5-second timeout on calls to C. If C is slow, A's effective timeout is 10 seconds (B waits 5s for C, A waits 5s for B — but B's 5s timer started *after* its own processing). You must budget timeouts: if A has a 3-second SLA, and B needs 200ms of processing, B's call to C can have at most ~2.5 seconds.

**Broker becomes a SPOF.** Switching from sync to async doesn't eliminate failure — it moves it. If your message broker goes down and you have no redundancy, every async flow stops. Run brokers in clustered mode, and have dead-letter queues for messages that fail processing.

**Event schema evolution.** When `OrderPlaced` events flow to 6 consumers and you add a required field, every consumer must be updated. Use a schema registry (Confluent Schema Registry, AWS Glue) and design for backward compatibility — new fields should always be optional.

**API gateway as bottleneck.** A single centralized gateway handling all traffic becomes a scaling and reliability concern. Deploy it as a horizontally scaled stateless tier, and avoid putting business logic in the gateway layer.
:::

## 🎯 Checkpoint

::: details Question 1 — Sync vs Async Trade-off
**Q:** You have a checkout flow that must validate the user's credit card and return a success/failure result. Should communication between the checkout service and payment service be synchronous or asynchronous? Why?

**A:** Synchronous, because the user is waiting for an immediate response. The checkout flow cannot return "Order placed!" without knowing whether payment succeeded. Async is appropriate for downstream work that doesn't affect the user's immediate response — like sending a confirmation email or updating analytics. The key heuristic: if the caller *needs the result to continue*, use sync. If the caller can proceed without the result, use async.
:::

::: details Question 2 — Fan-Out Availability
**Q:** Service A synchronously calls Services B, C, and D in parallel. Each has 99.9% availability. What is A's effective availability due to these dependencies alone?

**A:** 0.999 × 0.999 × 0.999 = 99.7%. Every synchronous dependency multiplies against your availability. This is why high-fanout synchronous architectures struggle to meet aggressive SLAs. To improve, you can add circuit breakers, fallback responses, or convert non-critical calls to async.
:::

::: details Question 3 — gRPC vs REST
**Q:** When would you choose gRPC over REST for an internal service-to-service call?

**A:** When you need high throughput with low latency (Protobuf is 2-10x smaller and faster to serialize than JSON), when you need bidirectional streaming (e.g., real-time event feeds), or when strong contract enforcement via `.proto` files is valuable across many teams. REST remains better for public-facing APIs, browser clients without a gRPC-Web proxy, and situations where human readability (curl debugging) matters.
:::

## 🏗️ Design It

**Scenario:** You have 5 services. Service A calls B, which calls C synchronously. C goes down. What happens and how do you fix it?

::: details Worked Solution
**What happens (the failure cascade):**

1. **C goes down.** It stops responding or responds extremely slowly.
2. **B's connection pool saturates.** Every request to C hangs until timeout (e.g., 5 seconds). B's thread/connection pool fills with pending requests to C.
3. **B stops accepting new requests.** Even requests that don't need C are blocked because B's resources are exhausted.
4. **A's connection pool saturates.** A is waiting on B, which is waiting on C. A is now effectively down.
5. **Users see errors or infinite spinners.** The entire chain has failed because of one downstream service.

**How to fix it — layered defenses:**

**Layer 1 — Circuit breaker on B's calls to C.**
After N consecutive failures (e.g., 5), B "opens the circuit" and stops calling C entirely. Instead, it returns a fallback response or a fast error. After a cooldown period, B sends a single probe request to C (half-open state). If it succeeds, the circuit closes and normal traffic resumes.

**Layer 2 — Timeouts with budgets.**
B sets an aggressive timeout on calls to C (e.g., 500ms, not 5 seconds). A sets a timeout on calls to B (e.g., 1 second). This prevents resource exhaustion even if the circuit breaker hasn't tripped yet.

**Layer 3 — Bulkhead isolation.**
B allocates a separate connection pool for calls to C, limited to (say) 10 connections. Even if all 10 are stuck, B's remaining capacity serves other requests that don't depend on C.

**Layer 4 — Async where possible.**
If B's call to C isn't needed for the immediate response (e.g., C provides analytics enrichment), convert it to async. B publishes an event to a queue; C processes it when it recovers. B returns a response to A without waiting.

**Layer 5 — Graceful degradation.**
Design A and B to function in a degraded mode when C is unavailable. If C provides recommendations, show "popular items" as a static fallback. If C provides pricing, use a cached last-known price with a "prices may be outdated" warning.

**Architecture after fixes:**
```
A → B → [circuit breaker] → C
         ↓ (fallback)
         cached/default response

    B → [message queue] → C  (for non-critical work)
```
:::

## Key Mental Models

- **Sync = phone call, async = letter.** Use sync when you need an immediate answer; use async when you can wait.
- **Every sync dependency multiplies against your availability.** Fan-out kills uptime unless you add circuit breakers and fallbacks.
- **Start with a monolith.** Extract services only when you can articulate the specific benefit (independent scaling, independent deployment, fault isolation).
- **The broker is not magic.** Moving to async trades one set of problems (temporal coupling) for another (eventual consistency, message ordering, idempotency).
- **Budget your timeouts.** If your SLA is 2 seconds, every downstream call must fit within that budget, including retries.

## Related

- [Sagas & Distributed Transactions](./02-sagas)
- [Distributed Failure Modes](./03-failure-modes)
- [Why Queues Exist](/system-design/queues/01-why-queues)
