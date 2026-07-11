---
title: "Redis-Backed Job Queue"
outline: deep
---

# Redis-Backed Job Queue

> **Interview weight:** Very High -- job queues appear in almost every system-design interview. Understanding the internals separates senior from mid-level answers.
> **Node version notes:** Examples target Node 22+. Uses `ioredis` for Redis interaction.
> **Prerequisites:** Redis basics (strings, lists, sorted sets, hashes), async/await, error handling.

## 🗣️ In Plain English

::: tip In Plain English
Imagine a post office with a single counter and a back room full of mail carriers.

Customers (your application code) drop letters (jobs) into the outgoing mail slot. Each letter goes into a bin sorted by destination (the queue). Mail carriers (workers) take letters from the bin one at a time, deliver them, and come back for the next one.

But mail delivery can fail. The carrier might find nobody home. So the post office has a rule: when a carrier picks up a letter, it moves from the "outgoing" bin to an "in-progress" tray. If the carrier comes back and says "delivered," the letter is removed from the tray. If the carrier does not come back within an hour, the supervisor assumes something went wrong and puts the letter back in the outgoing bin. That is **reliable delivery** -- the letter is always accounted for.

Some letters are more important. A bill due today goes ahead of a birthday card due next week. That is **priority scheduling**.

Some letters keep bouncing back -- wrong address, building demolished. After three attempts the supervisor moves the letter to a "dead letter" drawer for a human to inspect. That is the **dead letter queue**.

The post office can also schedule future delivery. "Mail this on December 1st" means the letter sits in a date-sorted drawer (a Redis sorted set) until its time arrives, then it moves into the outgoing bin automatically.

Finally, the post office must not overwhelm the carriers. If there are five carriers, only five letters are in transit at once. That is **concurrency control**. If you hire more carriers (scale workers), you increase throughput without changing the bin structure.

This is exactly what BullMQ does, and in this capstone you build a simplified version from scratch to understand every piece.
:::

## ⚙️ Under the Hood

### Architecture Overview

```
┌──────────────┐        ┌──────────┐        ┌──────────────┐
│  Producer     │──ADD──▶│  Redis    │◀──POP──│   Worker(s)  │
│  app.enqueue()│        │          │        │  process(job) │
└──────────────┘        │  Lists   │        └──────┬───────┘
                        │  Sets    │               │
                        │  Hashes  │         ack / fail
                        │  ZSets   │               │
                        └──────────┘        ┌──────▼───────┐
                                            │  Retry / DLQ  │
                                            └──────────────┘
```

### Redis Data Structures

| Structure | Key Pattern | Purpose |
|-----------|-------------|---------|
| List | `queue:{name}:waiting` | FIFO queue of job IDs |
| List | `queue:{name}:active` | Jobs currently being processed |
| Sorted Set | `queue:{name}:delayed` | Jobs scheduled for future, scored by timestamp |
| Set | `queue:{name}:dead` | Dead letter queue |
| Hash | `job:{id}` | Full job data (payload, attempts, status, timestamps) |

### 1. Job and Queue Types

```typescript
// types.ts
interface Job {
  id: string;
  queue: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  status: "waiting" | "active" | "delayed" | "completed" | "failed" | "dead";
  createdAt: number;
  processAt: number;   // 0 = immediate, otherwise Unix ms
  lastError?: string;
  backoff: number;     // base backoff in ms
}

type JobProcessor = (job: Job) => Promise<void>;

interface QueueOptions {
  name: string;
  maxAttempts?: number;   // default 3
  backoffBase?: number;   // default 1000ms
  concurrency?: number;   // default 1
}
```

### 2. Producer — Enqueuing Jobs

```typescript
// producer.ts
import { randomUUID } from "node:crypto";
import Redis from "ioredis";

const redis = new Redis();

async function enqueue(
  queueName: string,
  payload: unknown,
  options: { delay?: number; maxAttempts?: number } = {}
): Promise<string> {
  const id = randomUUID();
  const now = Date.now();
  const processAt = options.delay ? now + options.delay : 0;

  const job: Record<string, string> = {
    id,
    queue: queueName,
    payload: JSON.stringify(payload),
    attempts: "0",
    maxAttempts: String(options.maxAttempts ?? 3),
    status: processAt ? "delayed" : "waiting",
    createdAt: String(now),
    processAt: String(processAt),
    backoff: "1000",
  };

  // Store job data as a hash
  await redis.hset(`job:${id}`, job);

  if (processAt) {
    // Delayed: add to sorted set scored by execution time
    await redis.zadd(`queue:${queueName}:delayed`, processAt, id);
  } else {
    // Immediate: push to waiting list
    await redis.lpush(`queue:${queueName}:waiting`, id);
  }

  return id;
}

export { enqueue };
```

### 3. Reliable Dequeue — The BRPOPLPUSH Pattern

This is the critical piece. We atomically pop from `waiting` and push to `active` so the job is never "lost" between the two lists.

```typescript
// worker.ts
import Redis from "ioredis";

const redis = new Redis();
// Separate connection for blocking commands (BRPOPLPUSH blocks the connection)
const blockingRedis = new Redis();

async function dequeue(queueName: string, timeoutSec = 5): Promise<string | null> {
  // BRPOPLPUSH: blocking pop from waiting, atomic push to active
  // If waiting is empty, blocks for up to timeoutSec seconds
  const jobId = await blockingRedis.brpoplpush(
    `queue:${queueName}:waiting`,
    `queue:${queueName}:active`,
    timeoutSec
  );

  if (jobId) {
    await redis.hset(`job:${jobId}`, "status", "active");
  }

  return jobId;
}
```

**Why BRPOPLPUSH?** Without it, you would `RPOP` then `LPUSH` -- two commands. If the process crashes between them, the job ID is lost (popped from waiting but never added to active). `BRPOPLPUSH` is atomic: the job is always in exactly one list. The `B` prefix means it blocks, so the worker does not spin-poll.

> Note: Redis 6.2+ deprecates `BRPOPLPUSH` in favor of `BLMOVE`. Use `BLMOVE source destination RIGHT LEFT timeout` for the same semantics.

### 4. Processing and Acknowledgment

```typescript
async function processJob(
  queueName: string,
  jobId: string,
  processor: (job: Job) => Promise<void>
): Promise<void> {
  const raw = await redis.hgetall(`job:${jobId}`);
  if (!raw.id) return; // Job was already cleaned up

  const job: Job = {
    id: raw.id,
    queue: raw.queue,
    payload: JSON.parse(raw.payload),
    attempts: Number(raw.attempts) + 1,
    maxAttempts: Number(raw.maxAttempts),
    status: "active",
    createdAt: Number(raw.createdAt),
    processAt: Number(raw.processAt),
    backoff: Number(raw.backoff),
    lastError: raw.lastError,
  };

  try {
    await processor(job);
    await ack(queueName, jobId);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    await fail(queueName, jobId, job.attempts, job.maxAttempts, job.backoff, error);
  }
}

async function ack(queueName: string, jobId: string): Promise<void> {
  // Remove from active list, mark completed
  await redis.lrem(`queue:${queueName}:active`, 1, jobId);
  await redis.hset(`job:${jobId}`, "status", "completed");
}
```

### 5. Retry with Exponential Backoff

```typescript
async function fail(
  queueName: string,
  jobId: string,
  attempts: number,
  maxAttempts: number,
  backoffBase: number,
  error: Error
): Promise<void> {
  // Remove from active list
  await redis.lrem(`queue:${queueName}:active`, 1, jobId);

  // Update attempt count and error
  await redis.hset(`job:${jobId}`, {
    attempts: String(attempts),
    lastError: error.message,
  });

  if (attempts >= maxAttempts) {
    // Exhausted retries → dead letter queue
    await redis.sadd(`queue:${queueName}:dead`, jobId);
    await redis.hset(`job:${jobId}`, "status", "dead");
    console.error(`Job ${jobId} moved to DLQ after ${attempts} attempts: ${error.message}`);
    return;
  }

  // Exponential backoff: 1s, 2s, 4s, 8s, ... capped at 5 minutes
  const delay = Math.min(backoffBase * Math.pow(2, attempts - 1), 300_000);
  const processAt = Date.now() + delay;

  // Schedule retry as a delayed job
  await redis.zadd(`queue:${queueName}:delayed`, processAt, jobId);
  await redis.hset(`job:${jobId}`, {
    status: "delayed",
    processAt: String(processAt),
  });

  console.log(`Job ${jobId} retry #${attempts} in ${delay}ms`);
}
```

### 6. Delayed Job Promoter

A background loop that moves delayed jobs whose time has arrived into the waiting queue.

```typescript
async function promoteDelayed(queueName: string): Promise<number> {
  const now = Date.now();

  // Get all delayed jobs whose score (processAt) <= now
  const ready = await redis.zrangebyscore(
    `queue:${queueName}:delayed`,
    0,
    now
  );

  if (ready.length === 0) return 0;

  const pipeline = redis.pipeline();
  for (const jobId of ready) {
    pipeline.zrem(`queue:${queueName}:delayed`, jobId);
    pipeline.lpush(`queue:${queueName}:waiting`, jobId);
    pipeline.hset(`job:${jobId}`, "status", "waiting");
  }
  await pipeline.exec();

  return ready.length;
}

// Run promoter every second
function startPromoter(queueName: string): NodeJS.Timeout {
  return setInterval(() => promoteDelayed(queueName), 1000);
}
```

### 7. Worker with Concurrency Control

```typescript
import type { Job } from "./types.ts";

interface WorkerOptions {
  queueName: string;
  concurrency: number;
  processor: (job: Job) => Promise<void>;
}

async function startWorker(opts: WorkerOptions): Promise<void> {
  const { queueName, concurrency, processor } = opts;
  let running = 0;
  let shuttingDown = false;

  // Start delayed job promoter
  const promoter = startPromoter(queueName);

  console.log(`Worker started: queue=${queueName}, concurrency=${concurrency}`);

  while (!shuttingDown) {
    // Wait if at concurrency limit
    if (running >= concurrency) {
      await new Promise((r) => setTimeout(r, 100));
      continue;
    }

    const jobId = await dequeue(queueName, 2);
    if (!jobId) continue; // Timeout, loop again

    running++;
    // Fire and forget -- runs concurrently
    processJob(queueName, jobId, processor)
      .finally(() => { running--; });
  }

  clearInterval(promoter);
}

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, draining...");
  // In production: set shuttingDown = true, wait for running === 0
});

export { startWorker };
```

### 8. Putting It All Together

```typescript
// demo.ts
import { enqueue } from "./producer.ts";
import { startWorker } from "./worker.ts";

// Enqueue some jobs
await enqueue("emails", { to: "ada@example.com", subject: "Hello" });
await enqueue("emails", { to: "bob@example.com", subject: "Delayed" }, { delay: 5000 });
await enqueue("emails", { to: "bad@example.com", subject: "Will Fail" });

// Start worker
await startWorker({
  queueName: "emails",
  concurrency: 3,
  async processor(job) {
    const payload = job.payload as { to: string; subject: string };
    if (payload.to === "bad@example.com") {
      throw new Error("Invalid recipient");
    }
    console.log(`Sent email to ${payload.to}: ${payload.subject}`);
  },
});
```

```bash
# Requires Redis running locally
# docker run -d -p 6379:6379 redis:7
node --experimental-strip-types demo.ts
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Stale active jobs after worker crash.**
If a worker crashes while processing, the job stays in the `active` list forever. BullMQ solves this with a "stalled job checker" -- a periodic scan that moves jobs from `active` back to `waiting` if the worker has not sent a heartbeat within a threshold. Without this, jobs silently disappear.

**2. Non-atomic promote-and-enqueue.**
Our `promoteDelayed` uses a pipeline but not a Lua script. If two workers run the promoter simultaneously, both might read the same delayed job and push it to waiting twice, causing duplicate processing. BullMQ uses Lua scripts for atomicity. In production, either use Lua or ensure only one promoter runs (leader election).

**3. Unbounded job data in Redis.**
If you never clean up completed jobs, Redis memory grows forever. BullMQ has `removeOnComplete` and `removeOnFail` options with configurable retention counts. Always set a TTL or a cleanup job.

**4. Backoff jitter prevents thundering herd.**
Our backoff is deterministic -- all failed jobs retry at exactly the same intervals. In production, add random jitter: `delay * (0.5 + Math.random())`. Without jitter, a downstream outage that fails 10,000 jobs causes 10,000 retries hitting the downstream at the exact same millisecond.
:::

## 🎯 Checkpoint

::: details Question 1 — Why two Redis connections?
**Q:** Why does the worker use a separate Redis connection for `BRPOPLPUSH`?

**A:** `BRPOPLPUSH` (and `BLMOVE`) is a blocking command -- it holds the connection until a job appears or the timeout expires. During that time, no other commands can be sent on that connection. If you used the same connection for both blocking pops and regular `HGET`/`HSET` commands, the regular commands would queue behind the blocking call and stall. BullMQ uses at least two connections per worker for this reason.
:::

::: details Question 2 — At-least-once vs exactly-once
**Q:** Does this queue provide at-least-once or exactly-once delivery? How would you get exactly-once?

**A:** At-least-once. A job can be processed more than once if the worker completes the work but crashes before calling `ack()`. The job stays in `active`, gets promoted back to `waiting` by the stalled checker, and is processed again. Exactly-once delivery is impossible in a distributed system (this is a consequence of the Two Generals Problem). You approximate it by making processors **idempotent** -- designing them so that processing the same job twice produces the same result as processing it once (e.g., using upserts instead of inserts).
:::

::: details Question 3 — Priority queues
**Q:** How would you add job priority to this design?

**A:** Replace the `waiting` list with a sorted set scored by priority. Use `BZPOPMIN` (Redis 5.0+) instead of `BRPOPLPUSH` to atomically dequeue the highest-priority job. Alternatively, maintain multiple lists (`waiting:high`, `waiting:low`) and check them in priority order -- simpler but less granular. BullMQ uses the sorted-set approach.
:::

## Key Mental Models

| Model | One-liner |
|-------|-----------|
| **Atomic dequeue** | `BRPOPLPUSH` / `BLMOVE` ensures a job is never in zero lists. |
| **Sorted sets are time machines** | Score by timestamp to implement delayed jobs, rate limiting, or scheduling. |
| **Retry = delayed re-enqueue** | Failed jobs go back to the delayed sorted set with exponential backoff. |
| **Dead letters are a pressure valve** | After N retries, stop wasting resources and let a human decide. |
| **Idempotency, not exactly-once** | Design processors to tolerate duplicates; the queue cannot prevent them. |

## Related

- [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq) -- the production library that implements these patterns
- [Delivery Semantics](/system-design/queues/03-delivery-semantics) -- at-most-once, at-least-once, and the myth of exactly-once
