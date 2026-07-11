---
title: Delivery Semantics & Idempotency
outline: deep
---

# Delivery Semantics & Idempotency

<Badge type="tip" text="Interview Weight: Very High" /> <Badge type="info" text="Prereqs: Why Queues Exist, database transactions, distributed systems basics" />

## In Plain English

::: tip In Plain English
Imagine you're sending important letters through the mail. There are three philosophies your postal service could follow.

**At-most-once:** The post office takes your letter and throws it in the general direction of the recipient. If it arrives, great. If it lands in a puddle, oh well. Fast and cheap, but you might lose mail. This is like a UDP packet or a fire-and-forget log event.

**At-least-once:** The post office delivers your letter and waits for the recipient to sign for it. If they don't sign, the post office delivers a copy. And another copy. The letter will definitely arrive, but the recipient might end up with three identical copies. This is how most production queues work.

**Exactly-once:** The post office guarantees the letter arrives exactly one time, no more, no less. Sounds perfect, right? But think about what it takes: the post office needs to track every letter ever sent, coordinate with the recipient to confirm they only opened it once, and handle the case where the delivery truck crashes halfway through the confirmation. In the real world of distributed systems, this is nearly impossible to guarantee perfectly.

Here's the practical insight that matters: instead of trying to achieve exactly-once delivery (which is essentially a myth in distributed systems), you combine at-least-once delivery with **idempotent processing**. The post office delivers duplicates, but the recipient is smart enough to recognize "I already processed this letter" and ignores the copies. The system behaves as if delivery happened exactly once, even though duplicates were sent.

This is why idempotency is one of the most important concepts in distributed systems. It's not about preventing duplicate delivery --- that's impractical. It's about making duplicate delivery harmless.

An **idempotency key** is how the recipient knows "I've seen this before." Each letter gets a unique stamp. The recipient keeps a log of stamps they've already processed. When a duplicate arrives, they check the log, find the stamp, and say "already handled" --- returning the same result without doing the work again.
:::

## Under the Hood

### The Three Delivery Semantics

| Semantic | How It Works | Guarantees | Risk | Use Case |
|---|---|---|---|---|
| **At-most-once** | ACK before processing. If processing fails, the message is already gone. | No duplicates | Message loss | Logging, metrics, non-critical analytics |
| **At-least-once** | ACK after processing. If ACK fails (crash, network), the message is redelivered. | No loss | Duplicate processing | Payments, emails, webhooks, most production work |
| **Exactly-once** | ACK + deduplication. Requires coordination between producer, broker, and consumer. | No loss, no duplicates | Extreme complexity, performance cost | Financial ledgers, inventory counts (but see caveats below) |

### Why "Exactly-Once" Is Mostly a Lie

In a distributed system, three things can fail independently: the producer, the broker (queue), and the consumer. Consider at-least-once delivery:

1. Consumer processes the message successfully.
2. Consumer sends ACK to the broker.
3. The network between consumer and broker drops.
4. Broker never receives the ACK.
5. Broker redelivers the message to another consumer.
6. The message is processed twice.

To achieve true exactly-once, you'd need a distributed transaction across the consumer's processing AND the broker's acknowledgment. This is a two-phase commit, which is slow, fragile, and doesn't scale.

**Kafka's "exactly-once"** is really "effectively-once." It works by combining:
- **Idempotent producers** (each message has a sequence number; duplicates are rejected by the broker).
- **Transactional consumers** (consume, process, and produce are wrapped in a Kafka transaction).

This only works within the Kafka ecosystem. The moment you interact with an external system (a database, an HTTP API), you're back to at-least-once.

### Idempotency Keys: Design and Implementation

An idempotency key is a unique identifier for a logical operation. The server uses it to detect and reject duplicate requests.

#### The Flow

```
Client                          Server
  │                               │
  │  POST /charge                 │
  │  Idempotency-Key: pay_abc123  │
  │ ─────────────────────────────►│
  │                               │── Check: seen "pay_abc123"?
  │                               │   NO → process charge, store result with key
  │  200 OK { charged: true }     │
  │ ◄─────────────────────────────│
  │                               │
  │  (network timeout, client     │
  │   retries same request)       │
  │                               │
  │  POST /charge                 │
  │  Idempotency-Key: pay_abc123  │
  │ ─────────────────────────────►│
  │                               │── Check: seen "pay_abc123"?
  │                               │   YES → return cached result
  │  200 OK { charged: true }     │
  │ ◄─────────────────────────────│
  │                               │
  (No duplicate charge!)
```

#### Implementation with Redis

```typescript
// ts-node --esm idempotency-redis.ts
import { createClient } from "redis";

const redis = createClient({ url: "redis://127.0.0.1:6379" });
await redis.connect();

interface IdempotencyResult {
  status: "new" | "duplicate";
  cachedResponse?: unknown;
}

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours

async function checkIdempotency(key: string): Promise<IdempotencyResult> {
  const cached = await redis.get(`idempotency:${key}`);
  if (cached) {
    return { status: "duplicate", cachedResponse: JSON.parse(cached) };
  }
  return { status: "new" };
}

async function storeIdempotencyResult(key: string, result: unknown): Promise<void> {
  await redis.setEx(
    `idempotency:${key}`,
    IDEMPOTENCY_TTL,
    JSON.stringify(result),
  );
}

// --- Simulate a charge endpoint ---
async function handleCharge(
  idempotencyKey: string,
  amount: number,
  userId: string,
): Promise<{ status: number; body: unknown }> {
  // Step 1: Check for duplicate
  const check = await checkIdempotency(idempotencyKey);
  if (check.status === "duplicate") {
    console.log(`[duplicate] Key ${idempotencyKey} already processed`);
    return { status: 200, body: check.cachedResponse };
  }

  // Step 2: Process the charge (simulate Stripe call)
  console.log(`[processing] Charging $${amount} for user ${userId}`);
  const result = {
    chargeId: `ch_${crypto.randomUUID().slice(0, 8)}`,
    amount,
    userId,
    status: "succeeded",
    timestamp: new Date().toISOString(),
  };

  // Step 3: Store the result for future duplicate checks
  await storeIdempotencyResult(idempotencyKey, result);

  return { status: 201, body: result };
}

// --- Demo ---
const key = `charge_user123_order456`;

const first = await handleCharge(key, 99.99, "user123");
console.log("First call:", first);

const duplicate = await handleCharge(key, 99.99, "user123");
console.log("Duplicate call:", duplicate);
// Same response, no double charge

await redis.quit();
```

#### Implementation with Database Unique Constraint

```typescript
// ts-node --esm idempotency-db.ts

// Schema (PostgreSQL):
// CREATE TABLE idempotency_keys (
//   key         VARCHAR(255) PRIMARY KEY,
//   response    JSONB NOT NULL,
//   created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
// );
// CREATE INDEX idx_idempotency_created ON idempotency_keys(created_at);

// Pseudo-code (assumes a db client like pg or Drizzle):
async function handleChargeWithDb(
  idempotencyKey: string,
  amount: number,
  userId: string,
): Promise<{ status: number; body: unknown }> {
  // Use a transaction to make check-and-insert atomic
  // return await db.transaction(async (tx) => {
  //   const existing = await tx.query(
  //     "SELECT response FROM idempotency_keys WHERE key = $1",
  //     [idempotencyKey]
  //   );
  //
  //   if (existing.rows.length > 0) {
  //     return { status: 200, body: existing.rows[0].response };
  //   }
  //
  //   // Process the charge
  //   const result = await processCharge(amount, userId);
  //
  //   // Store idempotency record (unique constraint prevents races)
  //   await tx.query(
  //     "INSERT INTO idempotency_keys (key, response) VALUES ($1, $2)",
  //     [idempotencyKey, JSON.stringify(result)]
  //   );
  //
  //   return { status: 201, body: result };
  // });

  console.log("See SQL comments above for the full pattern");
  return { status: 200, body: {} };
}
```

#### Key Design: Deterministic vs Random

| Strategy | Example | Pros | Cons |
|---|---|---|---|
| **Deterministic** | `charge_{userId}_{orderId}` | Naturally deduplicates retries of the same logical operation | Requires careful design to capture the right scope |
| **Random (UUID)** | `550e8400-e29b-41d4-a716-446655440000` | Simple to generate | Client must store and resend the same key on retry |
| **Hybrid** | `{userId}_{action}_{timestamp_bucket}` | Good dedup scope, human-readable | Timestamp bucket granularity matters |

**Best practice:** Use deterministic keys. The key should represent the **logical operation**, not the request. `charge_user123_order456` is the same operation whether the client sends it once or five times.

### The Transactional Outbox Pattern

#### The Problem

You need to do two things atomically:
1. Update your database (e.g., mark an order as "paid").
2. Publish a message to a queue (e.g., "process this order").

If you do the database write first and the queue publish fails, your database says "paid" but no message was sent. If you do the queue publish first and the database write fails, a message was sent for an order that was never updated.

Two-phase commit (2PC) between the database and the queue is theoretically possible but practically terrible: slow, fragile, and most queue systems don't support it.

#### The Solution: Outbox Table

Write both the business data and the outgoing message in the **same database transaction**. A separate relay process reads the outbox and publishes to the queue.

```
  ┌──────────────────────────────────────┐
  │          Single DB Transaction       │
  │                                      │
  │  1. UPDATE orders SET status='paid'  │
  │  2. INSERT INTO outbox (payload)     │
  │                                      │
  └──────────────────────────────────────┘
                    │
                    ▼
  ┌──────────────────────────────────────┐
  │         Outbox Relay Process         │
  │                                      │
  │  Poll outbox table every N seconds   │
  │  Publish each row to the queue       │
  │  Mark row as published               │
  │                                      │
  └──────────────────────────────────────┘
                    │
                    ▼
              [ Message Queue ]
                    │
                    ▼
              [ Consumer ]
```

```typescript
// ts-node --esm outbox-pattern.ts

// --- Schema ---
// CREATE TABLE orders (
//   id          UUID PRIMARY KEY,
//   user_id     VARCHAR(255) NOT NULL,
//   amount      DECIMAL(10,2) NOT NULL,
//   status      VARCHAR(50) NOT NULL DEFAULT 'pending'
// );
//
// CREATE TABLE outbox (
//   id          BIGSERIAL PRIMARY KEY,
//   aggregate   VARCHAR(100) NOT NULL,  -- e.g., "order"
//   event_type  VARCHAR(100) NOT NULL,  -- e.g., "order.paid"
//   payload     JSONB NOT NULL,
//   created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
//   published   BOOLEAN NOT NULL DEFAULT FALSE
// );
// CREATE INDEX idx_outbox_unpublished ON outbox(published, created_at)
//   WHERE published = FALSE;

// --- Business logic (inside a DB transaction) ---
interface OrderPaidEvent {
  orderId: string;
  userId: string;
  amount: number;
  paidAt: string;
}

function buildOutboxInsert(event: OrderPaidEvent): {
  aggregate: string;
  eventType: string;
  payload: string;
} {
  return {
    aggregate: "order",
    eventType: "order.paid",
    payload: JSON.stringify(event),
  };
}

// Pseudo-code for the transaction:
// await db.transaction(async (tx) => {
//   await tx.query(
//     "UPDATE orders SET status = 'paid' WHERE id = $1",
//     [orderId]
//   );
//   const outbox = buildOutboxInsert({
//     orderId, userId, amount, paidAt: new Date().toISOString()
//   });
//   await tx.query(
//     "INSERT INTO outbox (aggregate, event_type, payload) VALUES ($1, $2, $3)",
//     [outbox.aggregate, outbox.eventType, outbox.payload]
//   );
// });

// --- Relay process (runs on a cron/interval) ---
// async function publishOutbox() {
//   const rows = await db.query(
//     "SELECT * FROM outbox WHERE published = FALSE ORDER BY created_at LIMIT 100"
//   );
//   for (const row of rows) {
//     await queue.add(row.event_type, JSON.parse(row.payload));
//     await db.query("UPDATE outbox SET published = TRUE WHERE id = $1", [row.id]);
//   }
// }

console.log("See SQL schema and pseudo-code above for the outbox pattern.");
console.log("Key guarantee: business write + outbox insert are atomic (same transaction).");
console.log("Relay delivers at-least-once from outbox to queue.");
```

**Guarantees:**
- The business write and outbox insert are atomic (same transaction).
- The relay provides at-least-once delivery from DB to queue (if the relay crashes after publishing but before marking as published, it will republish on restart).
- Consumers must be idempotent (because at-least-once).

### Dead Letter Queues (DLQs)

A DLQ is where messages go to die --- or more accurately, where messages go after exhausting all retry attempts. They're not discarded; they're quarantined for investigation.

```typescript
// ts-node --esm dlq-handling.ts
import { Queue, Worker } from "bullmq";

const connection = { host: "127.0.0.1", port: 6379 };

const mainQueue = new Queue("payments", { connection });
const dlq = new Queue("payments-dlq", { connection });

// Worker that moves failed jobs to DLQ after max retries
const worker = new Worker(
  "payments",
  async (job) => {
    console.log(`Processing payment ${job.data.orderId} (attempt ${job.attemptsMade + 1})`);

    // Simulate a job that sometimes fails
    if (job.data.amount > 10_000) {
      throw new Error("Amount exceeds processing limit");
    }

    // Normal processing
    return { status: "charged", orderId: job.data.orderId };
  },
  {
    connection,
    concurrency: 5,
  },
);

// Listen for final failures (all retries exhausted)
worker.on("failed", async (job, err) => {
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    // Move to DLQ with full context
    await dlq.add("failed-payment", {
      originalJobId: job.id,
      originalData: job.data,
      error: err.message,
      failedAt: new Date().toISOString(),
      attempts: job.attemptsMade,
    });
    console.log(`[DLQ] Payment ${job.data.orderId} moved to DLQ after ${job.attemptsMade} attempts`);
  }
});

// --- DLQ monitoring and replay ---
async function inspectDlq(): Promise<void> {
  const failed = await dlq.getJobs(["waiting", "active", "completed", "failed"]);
  console.log(`DLQ contains ${failed.length} jobs:`);
  for (const job of failed.slice(0, 5)) {
    console.log(`  - ${job.data.originalJobId}: ${job.data.error}`);
  }
}

async function replayDlq(): Promise<number> {
  const jobs = await dlq.getJobs(["waiting"]);
  let replayed = 0;
  for (const job of jobs) {
    await mainQueue.add("payment", job.data.originalData, {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
    });
    await job.remove();
    replayed++;
  }
  console.log(`Replayed ${replayed} jobs from DLQ back to main queue`);
  return replayed;
}

// Demo
await mainQueue.add("payment", { orderId: "ord-001", amount: 50_000 }, { attempts: 1 });
```

**DLQ best practices:**
- Always have a DLQ. Never silently drop messages after max retries.
- Include full context in DLQ entries: original data, error message, attempt count, timestamps.
- Monitor DLQ depth. A growing DLQ means something is systematically broken.
- Build a replay mechanism. After fixing the bug, you need to reprocess the DLQ.

### Poison Messages

A poison message is a message that always fails processing, no matter how many times you retry. Examples: malformed JSON, references a deleted record, triggers a bug in the consumer code.

**Detection:** Track retry count. If a message has been retried N times (e.g., 5), it's likely poisoned.

**Isolation:** Move it to the DLQ immediately. Don't let it block other messages or consume retry resources.

**Investigation:** Log the full message payload and error stack trace. The DLQ entry should have enough context to reproduce the failure.

**Prevention:** Validate message schemas before processing. Reject obviously invalid messages immediately without counting them as processing failures.

### Exponential Backoff with Jitter

When a consumer fails, you don't retry immediately --- you wait, and you wait longer with each failure. But if 100 consumers all failed at the same time (e.g., the downstream service went down), they'd all retry at the same intervals, creating a **thundering herd** that hammers the recovering service.

**The formula:**

```
delay = min(base * 2^attempt + random(0, jitter), maxDelay)
```

```typescript
// ts-node --esm backoff-jitter.ts

function calculateBackoff(
  attempt: number,
  base = 1_000,
  maxDelay = 60_000,
  jitter = 1_000,
): number {
  const exponential = base * Math.pow(2, attempt);
  const randomJitter = Math.floor(Math.random() * jitter);
  return Math.min(exponential + randomJitter, maxDelay);
}

// Simulate retry delays for 8 attempts
console.log("Attempt | Delay (ms) | Delay (human)");
console.log("--------|------------|-------------");
for (let i = 0; i < 8; i++) {
  const delay = calculateBackoff(i);
  const human = delay >= 1_000 ? `${(delay / 1_000).toFixed(1)}s` : `${delay}ms`;
  console.log(`   ${i}    |   ${delay.toString().padStart(6)} |  ${human}`);
}

// Sample output (jitter makes it vary):
// Attempt | Delay (ms) | Delay (human)
// --------|------------|-------------
//    0    |     1423  |  1.4s
//    1    |     2891  |  2.9s
//    2    |     4312  |  4.3s
//    3    |     8756  |  8.8s
//    4    |    16234  |  16.2s
//    5    |    32567  |  32.6s
//    6    |    60000  |  60.0s    (capped at maxDelay)
//    7    |    60000  |  60.0s    (capped at maxDelay)
```

**Why jitter matters:** Without jitter, 1,000 failed consumers all retry at exactly 2s, then 4s, then 8s --- creating synchronized spikes. With jitter, retries are spread across a time window, smoothing the load on the downstream service.

### Consumer Acknowledgment Patterns

| Pattern | When to ACK | Trade-off |
|---|---|---|
| **ACK-after-process** | After successful processing | At-least-once. Safe. May reprocess on crash. Most common. |
| **ACK-before-process** | Before processing starts | At-most-once. Fast. May lose messages on crash. |
| **NACK / Reject** | When processing fails deliberately | Message returns to queue (or goes to DLQ). Useful for "I can't handle this right now." |
| **Visibility timeout** | ACK implicitly by time | Message becomes invisible for N seconds. If not ACK'd within the timeout, it reappears. Used by SQS. |

**ACK-after-process** is the right default for almost everything. The cost of duplicate processing (which idempotency handles) is almost always lower than the cost of lost messages.

```typescript
// ts-node --esm ack-patterns.ts
import { Worker } from "bullmq";

const connection = { host: "127.0.0.1", port: 6379 };

// ACK-after-process (BullMQ default)
// The job is only marked "completed" when the handler returns successfully.
// If the handler throws, the job is marked "failed" and retried.
const worker = new Worker(
  "orders",
  async (job) => {
    // If we crash HERE, the job is still "active" and will be
    // recovered by the stalled-job checker → at-least-once delivery.

    const result = await processOrder(job.data);

    // Returning successfully = implicit ACK.
    // BullMQ moves the job from "active" to "completed."
    return result;
  },
  { connection, concurrency: 5 },
);

async function processOrder(data: unknown): Promise<{ processed: boolean }> {
  // Simulate processing
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { processed: true };
}
```

## Where It Bites (Production Lens)

::: warning Where It Bites

**Idempotency key TTL too short.** You set idempotency keys to expire after 1 hour. A retry arrives 2 hours later (maybe from a client with aggressive retry logic or a replayed request from a support tool). The key has expired, so the server treats it as a new request and processes the charge again. **Symptom:** duplicate charges appearing hours or days after the original. **Root cause:** TTL shorter than the maximum possible retry window. **Diagnosis:** set the TTL to match the longest possible retry interval plus a safety margin. For payments, 24-48 hours is typical. For truly critical operations, use a database with no TTL.

**Outbox relay falls behind.** The relay process polls the outbox every 5 seconds, but during a spike, 10,000 rows accumulate. The relay can only publish 100 per cycle, creating a growing backlog. The outbox table bloats, queries slow down, and message delivery latency climbs from seconds to minutes. **Symptom:** increasing delay between outbox `created_at` and actual queue publish time. **Root cause:** fixed batch size and polling interval don't scale with load. **Diagnosis:** make batch size dynamic, add parallel relay workers, partition the outbox by aggregate type, and monitor the unpublished row count.

**No DLQ monitoring.** You set up a DLQ, but nobody watches it. Over weeks, thousands of failed messages accumulate silently. Each one represents a customer who didn't get their email, a payment that wasn't reconciled, or a webhook that was never delivered. **Symptom:** customer complaints about missing functionality, data inconsistencies discovered during audits. **Root cause:** DLQ exists but has no alerts, no dashboard, no runbook. **Diagnosis:** alert when DLQ depth exceeds zero (or a small threshold). Review and drain the DLQ daily. Build a replay tool so you can reprocess after fixing bugs.

**Race condition in idempotency check.** Two identical requests arrive within milliseconds. Both check Redis, both see "no existing key," both start processing, both write the result. The operation runs twice. **Symptom:** occasional duplicate processing despite having idempotency keys. **Root cause:** the check-and-set is not atomic. **Diagnosis:** use Redis `SET key value NX EX ttl` (set-if-not-exists) or a database `INSERT ... ON CONFLICT DO NOTHING` to make the check-and-claim atomic. If the SET fails, it's a duplicate.

:::

## Checkpoint

::: details Question 1 --- Delivery Semantics
**Q:** Your queue consumer processes a payment, successfully charges the customer's card, and then crashes before sending the ACK to the broker. What happens next? What delivery semantic is this, and how do you prevent the customer from being charged twice?

**A:** The broker never received the ACK, so it considers the message undelivered. After a timeout (or when the stalled-job checker runs), the broker redelivers the message to another consumer. That consumer processes the payment again, potentially charging the customer a second time. This is **at-least-once delivery** in action --- the message is guaranteed to be processed, but may be processed more than once. To prevent the double charge, the payment processing must be **idempotent**. Before calling the payment provider, generate a deterministic idempotency key (e.g., `charge_{orderId}`) and pass it to the payment API (Stripe, for instance, accepts an `idempotency_key` parameter). If the payment provider has already processed a charge with that key, it returns the original result instead of charging again.
:::

::: details Question 2 --- Outbox Pattern
**Q:** Why can't you simply write to the database and then publish to the queue in sequence (without the outbox pattern)? What specific failure mode does the outbox prevent?

**A:** If you write to the database and then publish to the queue as two separate operations, there is a window between them where a failure can leave the system inconsistent. Specifically: (1) The database write succeeds --- the order is marked "paid." (2) The application crashes (or the network drops) before the queue publish executes. Now your database says the order is paid, but no message was ever sent to the fulfillment queue. The order is stuck: paid but never fulfilled. The outbox pattern prevents this by writing the outgoing message into an outbox table within the **same database transaction** as the business write. Either both succeed or both fail --- there's no inconsistency window. The relay process then reads the outbox and publishes to the queue, providing at-least-once delivery from the outbox to the queue.
:::

## Design It

::: details Scenario --- Preventing Duplicate Payment Charges

**Problem:** Your payment service processes charges via a queue. A bug in the consumer code caused it to crash after charging but before acknowledging. The queue redelivered the messages, resulting in 10,000 duplicate charges. Design a system that prevents this from ever happening again.

**Worked Solution:**

**Step 1: Root cause analysis.** The system uses at-least-once delivery (correct for payments). The consumer charges the card, then ACKs. When the consumer crashes between charge and ACK, the message is redelivered and the card is charged again. The missing piece is **idempotent processing**.

**Step 2: Idempotency key design.** Each payment job needs a deterministic key that uniquely identifies the logical operation. Use `charge_{orderId}_{amount}_{currency}`. This ensures that the same order can never be charged twice, regardless of how many times the message is delivered.

**Step 3: Implementation with atomic locking.**

```typescript
// ts-node --esm idempotent-payment-worker.ts
import { Queue, Worker } from "bullmq";
import { createClient } from "redis";

const connection = { host: "127.0.0.1", port: 6379 };
const redis = createClient({ url: "redis://127.0.0.1:6379" });
await redis.connect();

interface PaymentJob {
  orderId: string;
  userId: string;
  amount: number;
  currency: string;
}

interface ChargeResult {
  chargeId: string;
  status: "succeeded" | "failed";
  orderId: string;
  amount: number;
}

const IDEMPOTENCY_TTL = 7 * 24 * 60 * 60; // 7 days

async function processPaymentIdempotently(data: PaymentJob): Promise<ChargeResult> {
  const idempotencyKey = `charge:${data.orderId}:${data.amount}:${data.currency}`;

  // Step A: Atomic claim — SET NX (set-if-not-exists)
  // This prevents the race condition where two workers both check and both proceed.
  const claimed = await redis.set(
    `lock:${idempotencyKey}`,
    "processing",
    { NX: true, EX: 300 }, // 5-minute lock for processing time
  );

  if (!claimed) {
    // Another worker is processing this, or it's already done.
    // Check if a result exists.
    const cached = await redis.get(`result:${idempotencyKey}`);
    if (cached) {
      console.log(`[idempotent] Returning cached result for ${data.orderId}`);
      return JSON.parse(cached) as ChargeResult;
    }
    // Still processing by another worker — reject and let the queue retry later
    throw new Error("Payment is being processed by another worker, retry later");
  }

  try {
    // Step B: Process the payment (call Stripe, etc.)
    console.log(`[processing] Charging $${data.amount} for order ${data.orderId}`);
    const result: ChargeResult = {
      chargeId: `ch_${crypto.randomUUID().slice(0, 8)}`,
      status: "succeeded",
      orderId: data.orderId,
      amount: data.amount,
    };

    // Simulate payment API call
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Step C: Store the result for future duplicate checks
    await redis.setEx(
      `result:${idempotencyKey}`,
      IDEMPOTENCY_TTL,
      JSON.stringify(result),
    );

    return result;
  } catch (err) {
    // If processing fails, release the lock so a retry can claim it
    await redis.del(`lock:${idempotencyKey}`);
    throw err;
  }
}

// --- Queue and Worker setup ---
const paymentQueue = new Queue("payments", { connection });

const worker = new Worker<PaymentJob>(
  "payments",
  async (job) => {
    return await processPaymentIdempotently(job.data);
  },
  {
    connection,
    concurrency: 10,
  },
);

worker.on("completed", (job, result) => {
  console.log(`[done] Order ${(result as ChargeResult).orderId}: ${(result as ChargeResult).chargeId}`);
});

worker.on("failed", (job, err) => {
  console.error(`[failed] ${job?.data.orderId}: ${err.message}`);
});

// Demo: enqueue the same payment three times (simulating redelivery)
const paymentData: PaymentJob = {
  orderId: "ord-789",
  userId: "user-123",
  amount: 49.99,
  currency: "USD",
};

await paymentQueue.add("charge", paymentData);
await paymentQueue.add("charge", paymentData); // duplicate
await paymentQueue.add("charge", paymentData); // duplicate

// Only one charge is actually processed. The other two return the cached result.
```

**Step 4: Defense in depth.**

The idempotency key in Redis is the primary defense. Add a secondary defense at the payment provider level:

```typescript
// Pass the idempotency key to Stripe (pseudo-code)
// const charge = await stripe.charges.create(
//   { amount: data.amount, currency: data.currency, source: token },
//   { idempotencyKey: `charge_${data.orderId}` }
// );
// Stripe itself will reject duplicate charges with the same idempotency key.
```

**Step 5: Monitoring and alerting.**

- Track the ratio of "new" vs "duplicate" idempotency checks. A sudden spike in duplicates indicates a consumer stability issue.
- Alert on DLQ depth for the payment queue.
- Log every idempotency cache hit with the original charge ID for audit trails.

**Step 6: Handling the existing 10,000 duplicates.**

This is a business problem, not just a technical one. You need to:
1. Identify all duplicate charges by grouping by idempotency key (orderId + amount).
2. For each group, keep the first charge and refund the rest.
3. Notify affected customers proactively.
4. Run the refund process through the same idempotent queue to avoid double-refunding.

**Key insight:** At-least-once delivery is the correct choice for payments. The solution is not to change the delivery semantic --- it's to make the consumer idempotent so that duplicates are harmless.

:::

## Key Mental Models

- **Exactly-once delivery is a spectrum, not a boolean.** In practice, you achieve "effectively-once" by combining at-least-once delivery with idempotent consumers. The delivery layer sends duplicates; the processing layer ignores them.
- **Idempotency keys are API contracts.** The key must be deterministic, scoped to the logical operation (not the request), and the check must be atomic (SET NX, not GET-then-SET).
- **The outbox pattern trades polling for atomicity.** You can't atomically write to a database and a queue. But you can atomically write to a database and an outbox table. The relay closes the gap.
- **Dead letter queues are not optional.** Every queue needs a DLQ, every DLQ needs monitoring, and every DLQ needs a replay mechanism. An unmonitored DLQ is a silent data-loss pipeline.
- **Backoff without jitter is a thundering herd waiting to happen.** Always add randomness to retry delays. The formula is simple: `min(base * 2^attempt + random_jitter, max_delay)`.

## Related

- [Why Queues Exist](./01-why-queues) --- foundational concepts for when and why to use queues
- [Redis Queues & BullMQ](./02-redis-bullmq) --- implementing queues with Redis and BullMQ
- [Distributed Failure Modes](/system-design/microservices/03-failure-modes) --- broader patterns for handling failures in distributed systems
