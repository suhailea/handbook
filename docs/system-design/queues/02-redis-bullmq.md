---
title: Redis Queues & BullMQ
outline: deep
---

# Redis Queues & BullMQ

<Badge type="tip" text="Interview Weight: High" /> <Badge type="info" text="Prereqs: Redis basics, Node.js async patterns, Why Queues Exist" />

## In Plain English

::: tip In Plain English
Think of a post office. Letters arrive throughout the day and get sorted into bins. Postal workers grab letters from the bins and deliver them on their routes. If a letter can't be delivered, it goes back into a "retry" bin with a note about when to try again. If it fails too many times, it ends up in the dead letter office. A supervisor watches the whole operation, tracking how many letters are waiting, how many are out for delivery, and how many were successfully delivered.

Redis is the post office building. It's fast, it's always open, and it has great infrastructure for sorting things. BullMQ is the management system that organizes the entire operation --- it decides which bin a letter goes in, assigns postal workers, handles retries, schedules future deliveries, and reports on the whole operation.

Redis gives you the raw building blocks: lists to hold messages in order, sorted sets to schedule things for later, and streams for more advanced fan-out patterns. But managing a job queue involves much more than pushing and popping from a list. You need reliable delivery (what if a worker crashes mid-delivery?), retries with backoff, priority handling, rate limiting, delayed jobs, repeatable schedules, and visibility into what's happening.

BullMQ wraps all of this into a clean TypeScript API. You create a Queue (the bin where jobs arrive), a Worker (the postal worker who processes them), and optionally attach events, schedulers, and dashboards. Under the hood, BullMQ uses Lua scripts to make Redis operations atomic --- ensuring that a job is never lost, never double-processed (under normal conditions), and always tracked through its full lifecycle.

The result is a production-grade job queue that runs on infrastructure you probably already have (Redis), with the reliability guarantees your system needs.
:::

## Under the Hood

### Redis Data Structures for Queues

Redis offers several primitives that can serve as queue backends. Each has different trade-offs.

#### Lists (LPUSH / BRPOP)

The simplest queue: push to the left, blocking-pop from the right.

```typescript
// ts-node --esm redis-list-queue.ts
import { createClient } from "redis";

const redis = createClient({ url: "redis://127.0.0.1:6379" });
await redis.connect();

const QUEUE_KEY = "simple-queue";

// Producer: push jobs to the list
async function enqueue(data: Record<string, unknown>): Promise<void> {
  await redis.lPush(QUEUE_KEY, JSON.stringify(data));
  console.log(`Enqueued: ${JSON.stringify(data)}`);
}

// Consumer: blocking pop (waits up to 5 seconds for a message)
async function dequeue(): Promise<Record<string, unknown> | null> {
  const result = await redis.brPop(QUEUE_KEY, 5);
  if (!result) return null;
  const data = JSON.parse(result.element) as Record<string, unknown>;
  console.log(`Dequeued: ${JSON.stringify(data)}`);
  return data;
}

// Demo
await enqueue({ task: "send-email", to: "alice@example.com" });
await enqueue({ task: "send-email", to: "bob@example.com" });
const job1 = await dequeue();
const job2 = await dequeue();
const job3 = await dequeue(); // null after 5s timeout

await redis.quit();
```

**Problem:** If the consumer crashes after BRPOP but before processing, the message is lost. BRPOP removes the message from the list atomically.

#### The BRPOPLPUSH Pattern (Reliable Queue)

Atomically pop from one list and push to another "processing" list. If the consumer crashes, the message is still in the processing list and can be recovered.

```typescript
// ts-node --esm redis-reliable-queue.ts
import { createClient } from "redis";

const redis = createClient({ url: "redis://127.0.0.1:6379" });
await redis.connect();

const WAITING = "queue:waiting";
const PROCESSING = "queue:processing";

// Producer
await redis.lPush(WAITING, JSON.stringify({ id: "job-1", task: "resize-image" }));

// Consumer: atomically move from waiting to processing
// Note: BRPOPLPUSH is deprecated in Redis 7+; use BLMOVE instead.
const raw = await redis.blMove(WAITING, PROCESSING, "RIGHT", "LEFT", 5);

if (raw) {
  const job = JSON.parse(raw) as { id: string; task: string };
  console.log(`Processing: ${job.id}`);

  try {
    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Success: remove from processing list
    await redis.lRem(PROCESSING, 1, raw);
    console.log(`Completed: ${job.id}`);
  } catch {
    // Failure: message stays in PROCESSING for recovery
    console.error(`Failed: ${job.id} (still in processing list for recovery)`);
  }
}

await redis.quit();
```

#### Redis Streams (XADD / XREADGROUP)

Streams are Redis's purpose-built log data structure. They support consumer groups, acknowledgment, and message replay.

```typescript
// ts-node --esm redis-stream-queue.ts
import { createClient } from "redis";

const redis = createClient({ url: "redis://127.0.0.1:6379" });
await redis.connect();

const STREAM = "events-stream";
const GROUP = "workers";
const CONSUMER = "worker-1";

// Create consumer group (ignore error if already exists)
try {
  await redis.xGroupCreate(STREAM, GROUP, "0", { MKSTREAM: true });
} catch {
  // Group already exists
}

// Producer: add messages to the stream
await redis.xAdd(STREAM, "*", { event: "user.signup", userId: "u-123" });
await redis.xAdd(STREAM, "*", { event: "user.signup", userId: "u-456" });

// Consumer: read from the group
const messages = await redis.xReadGroup(GROUP, CONSUMER, [
  { key: STREAM, id: ">" }, // ">" means only new, undelivered messages
], { COUNT: 10, BLOCK: 2000 });

if (messages) {
  for (const stream of messages) {
    for (const msg of stream.messages) {
      console.log(`Processing ${msg.id}:`, msg.message);
      // Acknowledge after successful processing
      await redis.xAck(STREAM, GROUP, msg.id);
      console.log(`Acknowledged ${msg.id}`);
    }
  }
}

await redis.quit();
```

### Redis Data Structures Compared

| Feature | Lists (LPUSH/BRPOP) | Lists (BLMOVE) | Streams (XADD/XREADGROUP) |
|---|---|---|---|
| **Ordering** | FIFO | FIFO | FIFO per stream |
| **Reliability** | At-most-once | At-least-once | At-least-once (with XACK) |
| **Consumer groups** | No | No | Yes (built-in) |
| **Message replay** | No (consumed = removed) | No | Yes (messages persist) |
| **Backlog visibility** | LLEN only | LLEN on both lists | XINFO, XPENDING, XLEN |
| **Memory efficiency** | Good | Good | Moderate (messages persist) |
| **Complexity** | Very low | Low | Medium |
| **Best for** | Simple fire-and-forget | Reliable single-consumer | Multi-consumer, audit trail |

### BullMQ Architecture

BullMQ builds on top of Redis Lists and Sorted Sets (not Streams) to provide a full-featured job queue. Here are its core components.

```
                         ┌──────────────────┐
                         │     Redis         │
                         │  ┌────────────┐   │
  Queue (producer)  ───► │  │ wait list   │   │ ───► Worker (consumer)
                         │  │ active list │   │
                         │  │ delayed set │   │
                         │  │ completed   │   │
                         │  │ failed      │   │
                         │  └────────────┘   │
                         └──────────────────┘
                                 ▲
                                 │
                          QueueEvents (listener)
```

| Component | Role |
|---|---|
| **Queue** | Producer-side API. Adds jobs to the waiting list. |
| **Worker** | Consumer-side. Pulls jobs from waiting, moves to active, processes, moves to completed or failed. |
| **QueueEvents** | Event listener. Subscribes to Redis keyspace notifications to emit `completed`, `failed`, `progress` events. |
| **FlowProducer** | Creates parent-child job dependencies (job A waits for jobs B and C to complete). |

### Job Lifecycle in BullMQ

```
                         ┌─────────┐
                         │ delayed  │ ◄── job has a delay option
                         └────┬────┘
                              │ (delay expires)
                              ▼
  add() ──► ┌─────────┐    ┌─────────┐    ┌───────────┐
             │ waiting  │──►│ active   │──►│ completed  │
             └─────────┘    └────┬────┘    └───────────┘
                                 │
                                 │ (processing fails)
                                 ▼
                            ┌─────────┐    ┌───────────┐
                            │  failed  │──►│   DLQ      │
                            └─────────┘    └───────────┘
                           (retry if attempts remain)
```

**States:**
1. **Waiting** --- job is in the queue, ready to be picked up.
2. **Delayed** --- job has a `delay` option; it moves to waiting when the delay expires.
3. **Active** --- a worker has claimed the job and is processing it.
4. **Completed** --- the worker finished successfully.
5. **Failed** --- the worker threw an error. If retries remain, the job returns to waiting (with backoff delay).

### BullMQ in Practice

```typescript
// ts-node --esm bullmq-demo.ts
import { Queue, Worker, QueueEvents } from "bullmq";

const connection = { host: "127.0.0.1", port: 6379 };

// --- Producer ---
const imageQueue = new Queue("image-processing", { connection });

// Add jobs with various options
await imageQueue.add(
  "thumbnail",                          // job name
  { imageId: "img-001", width: 256 },   // job data
  {
    attempts: 3,                         // max retry attempts
    backoff: { type: "exponential", delay: 2_000 },
    priority: 1,                         // lower number = higher priority
    removeOnComplete: { count: 1_000 },  // keep last 1K completed jobs
    removeOnFail: { count: 5_000 },      // keep last 5K failed jobs
  },
);

// Delayed job: process in 30 seconds
await imageQueue.add(
  "thumbnail",
  { imageId: "img-002", width: 512 },
  { delay: 30_000 },
);

console.log("Jobs enqueued");

// --- Consumer ---
const worker = new Worker(
  "image-processing",
  async (job) => {
    console.log(`[worker] Processing ${job.name} for ${job.data.imageId} (attempt ${job.attemptsMade + 1})`);

    // Report progress
    await job.updateProgress(10);

    // Simulate image processing
    await new Promise((resolve) => setTimeout(resolve, 200));

    await job.updateProgress(100);

    return { thumbnailUrl: `/thumbnails/${job.data.imageId}_${job.data.width}.webp` };
  },
  {
    connection,
    concurrency: 5,   // process 5 jobs in parallel per worker
    limiter: {
      max: 100,        // max 100 jobs
      duration: 60_000, // per 60 seconds (rate limiting)
    },
  },
);

// --- Event Listener ---
const queueEvents = new QueueEvents("image-processing", { connection });

queueEvents.on("completed", ({ jobId, returnvalue }) => {
  console.log(`[event] Job ${jobId} completed:`, returnvalue);
});

queueEvents.on("failed", ({ jobId, failedReason }) => {
  console.error(`[event] Job ${jobId} failed: ${failedReason}`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  await worker.close();
  await queueEvents.close();
  await imageQueue.close();
  process.exit(0);
});
```

### Rate Limiting and Concurrency

BullMQ provides two independent throttling mechanisms:

| Mechanism | Scope | How It Works |
|---|---|---|
| **`concurrency`** | Per worker instance | Limits how many jobs a single worker processes simultaneously. Set to 1 for strictly serial processing. |
| **`limiter`** | Global (across all workers) | Rate limits via a token bucket in Redis. `{ max: 100, duration: 60_000 }` means 100 jobs per minute across all workers. |

Use concurrency for CPU-bound tasks (e.g., image processing --- don't overwhelm the machine). Use the limiter for API rate limits (e.g., Stripe allows 100 requests/second).

### Monitoring with Bull Board

Bull Board gives you a web dashboard for inspecting queue state.

```typescript
// ts-node --esm bull-board-server.ts
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter.js";
import { ExpressAdapter } from "@bull-board/express";
import express from "express";
import { Queue } from "bullmq";

const connection = { host: "127.0.0.1", port: 6379 };

const imageQueue = new Queue("image-processing", { connection });
const emailQueue = new Queue("email-sending", { connection });

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [
    new BullMQAdapter(imageQueue),
    new BullMQAdapter(emailQueue),
  ],
  serverAdapter,
});

const app = express();
app.use("/admin/queues", serverAdapter.getRouter());

app.listen(3000, () => {
  console.log("Bull Board running at http://localhost:3000/admin/queues");
});
```

The dashboard shows: waiting/active/completed/failed/delayed counts, individual job data and stack traces, retry/promote/remove actions, and queue throughput graphs.

### Kafka vs Simple Queues (BullMQ / RabbitMQ)

| Feature | BullMQ / RabbitMQ | Apache Kafka |
|---|---|---|
| **Model** | Job queue (task distribution) | Distributed log (event streaming) |
| **Message lifetime** | Removed after processing | Retained for a configurable period (days/weeks) |
| **Consumer groups** | Workers compete for jobs (one job = one consumer) | Consumer groups read independently; each gets every message |
| **Ordering** | FIFO within a single queue | Ordering guaranteed within a partition |
| **Replay** | No (once consumed, gone) | Yes (consumers can seek to any offset) |
| **Throughput** | ~10K-50K msg/s | ~1M+ msg/s |
| **Partitioning** | Manual (multiple queues) | Built-in (partition by key) |
| **Delayed/scheduled jobs** | Built-in | Not native (use external scheduler) |
| **Operational complexity** | Low (Redis or RabbitMQ) | High (ZooKeeper/KRaft, broker clusters) |
| **Best for** | Background jobs, task queues, workflows | Event sourcing, analytics pipelines, inter-service event bus |

**Rule of thumb:** If you're distributing **tasks** (send this email, process this image), use BullMQ or RabbitMQ. If you're distributing **events** that multiple consumers need to independently read and replay, use Kafka.

### Redis Streams vs Redis Lists for Queues

| Aspect | Redis Lists | Redis Streams |
|---|---|---|
| **Consumer groups** | DIY (no built-in support) | Native (`XREADGROUP`) |
| **Acknowledgment** | DIY (`BLMOVE` + `LREM`) | Native (`XACK`) |
| **Message persistence** | Message removed on pop | Messages persist until `XTRIM` |
| **Backlog inspection** | `LRANGE` (read without consuming) | `XPENDING` (see claimed-but-unacked) |
| **Memory** | Lower (messages are transient) | Higher (messages persist) |
| **BullMQ uses** | Yes (primary mechanism) | No (BullMQ uses Lists + Sorted Sets) |

## Where It Bites (Production Lens)

::: warning Where It Bites

**Redis out-of-memory kills your queue.** Redis is an in-memory store. If your queue grows unbounded (producers outpace consumers for too long), Redis hits its `maxmemory` limit. With `noeviction` policy (the default for queue workloads), writes start failing and your producers crash. With an eviction policy, Redis silently drops queue data. **Symptom:** `OOM command not allowed` errors, or mysteriously missing jobs. **Root cause:** no `removeOnComplete`/`removeOnFail` settings in BullMQ, or sustained producer-consumer imbalance. **Diagnosis:** monitor Redis memory usage and queue depth. Always set `removeOnComplete` and `removeOnFail` in BullMQ. Set Redis `maxmemory-policy` to `noeviction` and alert on memory usage at 80%.

**Stalled jobs from long-running workers.** BullMQ uses a lock (via a Redis key with TTL) to mark a job as "active." If your worker takes longer than the lock duration (default 30 seconds), BullMQ considers the job stalled and may reassign it to another worker. Now you have two workers processing the same job. **Symptom:** duplicate processing, data corruption, or jobs mysteriously restarting. **Root cause:** the `lockDuration` is too short for the actual processing time. **Diagnosis:** set `lockDuration` in the Worker options to be comfortably longer than your worst-case processing time. For very long jobs, call `job.extendLock()` periodically.

**Redis connection drops silently.** A brief network partition between your worker and Redis causes the connection to drop. BullMQ reconnects, but jobs that were "active" during the partition are now orphaned --- the worker thinks it's still processing, but Redis has already marked them stalled. **Symptom:** jobs appear stuck in "active" state, workers seem healthy but aren't completing work. **Root cause:** no connection health monitoring or reconnection handling. **Diagnosis:** listen for `worker.on('error')` events. Monitor the `active` count in your dashboard. Set up stalled-job checking intervals (`stalledInterval` option).

:::

## Checkpoint

::: details Question 1 --- Reliable Delivery
**Q:** Why does BullMQ use the BRPOPLPUSH/BLMOVE pattern instead of simple BRPOP? What failure mode does it prevent?

**A:** Simple BRPOP atomically removes the message from the list and returns it to the consumer. If the consumer crashes after receiving the message but before processing it, the message is permanently lost --- it's gone from Redis and was never processed. BLMOVE (the modern replacement for BRPOPLPUSH) atomically pops from the waiting list and pushes to a processing list in a single Redis operation. If the consumer crashes, the message is still in the processing list. A separate recovery process (BullMQ's stalled-job checker) periodically scans the processing list for jobs that haven't been completed within the lock duration and moves them back to the waiting list. This gives you at-least-once delivery instead of at-most-once.
:::

::: details Question 2 --- Rate Limiting vs Concurrency
**Q:** You have 4 BullMQ worker instances, each with `concurrency: 10`, and a global `limiter: { max: 50, duration: 1000 }`. What is the maximum number of jobs being processed at any instant? What is the maximum throughput per second?

**A:** The maximum number of jobs being processed at any instant is 40 (4 workers times 10 concurrency each). However, the global rate limiter caps throughput at 50 jobs per second across all workers. So while up to 40 jobs can be in-flight simultaneously, the rate at which new jobs are picked up is throttled to 50/s. If each job takes 200ms, the effective throughput would be limited by the rate limiter (50/s), not the concurrency (which could theoretically sustain 200/s). The two mechanisms are independent: concurrency limits parallelism per worker, while the limiter limits the global rate of job acquisition.
:::

## Design It

::: details Scenario --- Image Thumbnail Queue

**Problem:** Design a job queue that processes image thumbnails. Requirements: at-least-once delivery, priority support (paid users' images first), retry with exponential backoff (max 5 attempts), and a monitoring dashboard. The system handles ~500 uploads/minute during peak. Each thumbnail generation takes 1-3 seconds.

**Worked Solution:**

**Step 1: Capacity planning.** Peak load is ~8.3 jobs/second. Each job takes 1-3 seconds (assume 2s average). A single worker with concurrency 5 handles ~2.5 jobs/second. We need at least 4 worker instances to keep up, plus headroom. Plan for 6 workers.

**Step 2: Queue configuration.**

```typescript
// ts-node --esm thumbnail-queue.ts
import { Queue, Worker, QueueEvents } from "bullmq";

const connection = { host: "127.0.0.1", port: 6379 };

// --- Queue Setup ---
const thumbnailQueue = new Queue("thumbnails", {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 3_000, // 3s, 6s, 12s, 24s, 48s
    },
    removeOnComplete: { age: 24 * 3600, count: 10_000 }, // keep 24h or 10K
    removeOnFail: { age: 7 * 24 * 3600, count: 50_000 },  // keep 7d or 50K
  },
});

// --- Producer: called from upload endpoint ---
interface ThumbnailJobData {
  imageId: string;
  userId: string;
  isPaidUser: boolean;
  sizes: number[];
  sourceUrl: string;
}

async function queueThumbnail(data: ThumbnailJobData): Promise<string> {
  const job = await thumbnailQueue.add("generate", data, {
    priority: data.isPaidUser ? 1 : 10, // lower number = higher priority
    jobId: `thumb-${data.imageId}`,      // deduplicate by image ID
  });
  return job.id!;
}
```

**Step 3: Worker with proper error handling.**

```typescript
// ts-node --esm thumbnail-worker.ts
import { Worker, Job } from "bullmq";

interface ThumbnailJobData {
  imageId: string;
  userId: string;
  isPaidUser: boolean;
  sizes: number[];
  sourceUrl: string;
}

const worker = new Worker<ThumbnailJobData>(
  "thumbnails",
  async (job: Job<ThumbnailJobData>) => {
    const { imageId, sizes, sourceUrl } = job.data;

    for (let i = 0; i < sizes.length; i++) {
      const size = sizes[i];
      console.log(`[${imageId}] Generating ${size}px thumbnail...`);

      // Simulate thumbnail generation (Sharp in production)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Report progress
      const progress = Math.round(((i + 1) / sizes.length) * 100);
      await job.updateProgress(progress);
    }

    // Extend lock for long-running jobs
    await job.extendLock(job.id!, 30_000);

    return {
      imageId,
      thumbnails: sizes.map((s) => `/thumbnails/${imageId}_${s}.webp`),
    };
  },
  {
    connection: { host: "127.0.0.1", port: 6379 },
    concurrency: 5,
    lockDuration: 60_000,    // 60s lock (jobs can take up to 3s * multiple sizes)
    stalledInterval: 30_000, // check for stalled jobs every 30s
  },
);

worker.on("completed", (job) => {
  console.log(`[completed] ${job.data.imageId} by ${job.data.userId}`);
});

worker.on("failed", (job, err) => {
  console.error(`[failed] ${job?.data.imageId}: ${err.message} (attempt ${job?.attemptsMade}/${job?.opts.attempts})`);
});

worker.on("stalled", (jobId) => {
  console.warn(`[stalled] Job ${jobId} was stalled and will be reprocessed`);
});
```

**Step 4: Monitoring dashboard.**

```typescript
// ts-node --esm thumbnail-dashboard.ts
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter.js";
import { ExpressAdapter } from "@bull-board/express";
import express from "express";
import { Queue } from "bullmq";

const connection = { host: "127.0.0.1", port: 6379 };
const thumbnailQueue = new Queue("thumbnails", { connection });

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
  queues: [new BullMQAdapter(thumbnailQueue)],
  serverAdapter,
});

const app = express();
app.use("/admin/queues", serverAdapter.getRouter());
app.listen(3000, () => console.log("Dashboard: http://localhost:3000/admin/queues"));
```

**Step 5: At-least-once guarantee.** BullMQ achieves this through BLMOVE (atomic move from waiting to active list) combined with the stalled-job checker. If a worker crashes, the job stays in the active list. The stalled checker moves it back to waiting after the lock expires. The `attempts: 5` setting ensures the job is retried up to 5 times before moving to the failed state.

**Step 6: Priority behavior.** BullMQ implements priority using a sorted set in Redis. Jobs with lower priority numbers are dequeued first. Paid users (priority 1) always get processed before free users (priority 10) when the queue has a backlog. During low-load periods, both are processed immediately.

:::

## Key Mental Models

- **Redis is the engine, BullMQ is the transmission.** Redis provides fast data structures; BullMQ adds reliability, retries, scheduling, and lifecycle management on top.
- **BLMOVE is what makes Redis queues reliable.** The atomic pop-and-push prevents message loss during consumer crashes --- this is the single most important pattern for reliable queues.
- **Concurrency controls parallelism; the limiter controls rate.** Don't confuse the two. Concurrency limits how many jobs one worker handles simultaneously. The limiter caps how fast all workers collectively acquire new jobs.
- **Kafka and BullMQ solve different problems.** BullMQ distributes tasks (one consumer per job). Kafka distributes events (every consumer group sees every event). Pick the right tool for the job.
- **Monitor completed AND failed job cleanup.** Without `removeOnComplete` and `removeOnFail`, completed and failed jobs accumulate in Redis forever, eventually exhausting memory.

## Related

- [Why Queues Exist](./01-why-queues) --- foundational concepts for when and why to use queues
- [Delivery Semantics & Idempotency](./03-delivery-semantics) --- at-least-once, exactly-once, idempotency keys, and the outbox pattern
- [Redis-Backed Job Queue (Capstone)](/nodejs/module-10/02-job-queue) --- hands-on project building a production job queue
