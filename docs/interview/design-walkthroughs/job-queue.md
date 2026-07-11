---
title: Job Queue
outline: deep
---

# Job Queue

## The Problem

Design a Redis-backed distributed job queue. The system must:

- Accept jobs from producers and process them asynchronously via workers
- Guarantee at-least-once delivery (no job is silently lost)
- Support job priorities (urgent jobs processed before normal ones)
- Retry failed jobs with exponential backoff
- Move permanently failing jobs to a dead letter queue (DLQ)
- Scale workers horizontally
- Provide visibility into queue depth, processing times, and failure rates

## Clarifying Questions

| Question | Assumed answer |
|---|---|
| Expected throughput? | ~10,000 jobs/minute sustained, bursts to 50,000/minute |
| Average job processing time? | 2-30 seconds (image processing, email sending, webhook delivery) |
| How many distinct job types? | ~20 types, each with its own handler |
| Ordering guarantees? | Best-effort FIFO per priority level; strict ordering not required |
| Maximum retry count? | 5 retries, then dead letter |
| Are jobs idempotent? | Assumed yes (required for at-least-once semantics) |
| Persistence requirements? | Jobs must survive Redis restarts (AOF persistence) |

## High-Level Architecture

```
  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
  │  API Server  │    │  API Server  │    │  Cron Service │
  │  (Producer)  │    │  (Producer)  │    │  (Producer)   │
  └──────┬───────┘    └──────┬───────┘    └──────┬────────┘
         │                   │                    │
         └───────────────────┼────────────────────┘
                             │  LPUSH / ZADD
                             ▼
                   ┌─────────────────────┐
                   │       Redis         │
                   │                     │
                   │  ┌───────────────┐  │
                   │  │ waiting queue │  │ ← List or Sorted Set
                   │  ├───────────────┤  │
                   │  │ active  set   │  │ ← Processing jobs
                   │  ├───────────────┤  │
                   │  │ delayed set   │  │ ← Scheduled / retry backoff
                   │  ├───────────────┤  │
                   │  │ completed set │  │ ← Successful (trimmed)
                   │  ├───────────────┤  │
                   │  │ failed / DLQ  │  │ ← Permanently failed
                   │  └───────────────┘  │
                   │  ┌───────────────┐  │
                   │  │ job:{id} hash │  │ ← Job payload + metadata
                   │  └───────────────┘  │
                   └─────────┬───────────┘
                             │  BRPOPLPUSH / BZPOPMIN
              ┌──────────────┼──────────────┐
              │              │              │
        ┌─────▼─────┐ ┌─────▼─────┐ ┌─────▼─────┐
        │  Worker 1  │ │  Worker 2  │ │  Worker N  │
        │            │ │            │ │            │
        │ Handler    │ │ Handler    │ │ Handler    │
        │ Registry   │ │ Registry   │ │ Registry   │
        └────────────┘ └────────────┘ └────────────┘
```

**Job lifecycle state machine:**

```
  CREATED → WAITING → ACTIVE → COMPLETED
                ↑        │
                │        ▼
              DELAYED ← FAILED (retry < max)
                         │
                         ▼ (retry >= max)
                    DEAD_LETTER
```

## Detailed Design

### Component 1: Job Data Model

Each job is stored as a Redis hash with a unique ID.

```typescript
// run: npx tsx job-model.ts

interface Job<T = unknown> {
  id: string;
  type: string;                // Handler to invoke (e.g., 'send-email', 'process-image')
  payload: T;                  // Arbitrary JSON data
  priority: number;            // 0 = normal, 1 = high, 2 = urgent
  status: 'waiting' | 'active' | 'completed' | 'failed' | 'dead_letter';
  attempts: number;            // How many times this job has been attempted
  maxAttempts: number;         // Max retries before DLQ
  createdAt: number;           // Unix timestamp ms
  processedAt: number | null;  // When last attempt started
  completedAt: number | null;
  failedReason: string | null;
  nextRetryAt: number | null;  // Scheduled retry time
}

function createJobId(): string {
  // Time-sortable unique ID
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

console.log(createJobId()); // e.g., "lx1a2b3c-d4e5f6"
```

### Component 2: Producer — Adding Jobs

```typescript
// run: npx tsx producer.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const ADD_JOB_LUA = `
  local jobId = ARGV[1]
  local jobData = ARGV[2]
  local priority = tonumber(ARGV[3])
  local delayMs = tonumber(ARGV[4])
  local now = tonumber(ARGV[5])

  -- Store job data as a hash
  redis.call('SET', 'job:' .. jobId, jobData)

  if delayMs > 0 then
    -- Delayed job: add to delayed sorted set (score = execute-at timestamp)
    redis.call('ZADD', 'queue:delayed', now + delayMs, jobId)
  else
    -- Immediate job: add to waiting sorted set (score = priority * 1e13 + timestamp)
    -- Lower score = higher priority + earlier time = processed first
    local score = (10 - priority) * 1e13 + now
    redis.call('ZADD', 'queue:waiting', score, jobId)
  end

  return jobId
`;

interface AddJobOptions {
  type: string;
  payload: unknown;
  priority?: number;   // 0-2, default 0
  delayMs?: number;    // Delay before processing
  maxAttempts?: number;
}

async function addJob(options: AddJobOptions): Promise<string> {
  const jobId = createJobId();
  const job = {
    id: jobId,
    type: options.type,
    payload: options.payload,
    priority: options.priority ?? 0,
    status: options.delayMs ? 'delayed' : 'waiting',
    attempts: 0,
    maxAttempts: options.maxAttempts ?? 5,
    createdAt: Date.now(),
    processedAt: null,
    completedAt: null,
    failedReason: null,
    nextRetryAt: null,
  };

  await redis.eval(ADD_JOB_LUA, {
    arguments: [
      jobId,
      JSON.stringify(job),
      (options.priority ?? 0).toString(),
      (options.delayMs ?? 0).toString(),
      Date.now().toString(),
    ],
  });

  return jobId;
}

function createJobId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
}

// Usage
const emailJobId = await addJob({
  type: 'send-email',
  payload: { to: 'user@example.com', template: 'welcome' },
  priority: 1, // high
});
console.log(`Created job: ${emailJobId}`);

const imageJobId = await addJob({
  type: 'process-image',
  payload: { url: 'https://example.com/photo.jpg', resize: [800, 600] },
  delayMs: 30_000, // Process in 30 seconds
});
console.log(`Created delayed job: ${imageJobId}`);
```

**Priority via sorted sets:** the score combines priority and timestamp. Priority 2 (urgent) gets score `8e13 + timestamp`, priority 0 (normal) gets `10e13 + timestamp`. `BZPOPMIN` always takes the lowest score, so urgent jobs are dequeued first. Within the same priority, earlier jobs go first (lower timestamp).

### Component 3: Worker — Processing Jobs

The worker loop: fetch a job, move it to the active set, process it, then move it to completed or failed.

```typescript
// run: npx tsx worker.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

// Separate client for blocking operations (BZPOPMIN blocks the connection)
const blockingRedis = createClient();
await blockingRedis.connect();

type JobHandler = (payload: unknown) => Promise<void>;

const handlers = new Map<string, JobHandler>();

// Register handlers
handlers.set('send-email', async (payload) => {
  const { to, template } = payload as { to: string; template: string };
  console.log(`Sending ${template} email to ${to}`);
  // await emailService.send(to, template);
});

handlers.set('process-image', async (payload) => {
  const { url, resize } = payload as { url: string; resize: number[] };
  console.log(`Processing image ${url} to ${resize.join('x')}`);
  // await imageService.resize(url, resize);
});

// Fetch job atomically: pop from waiting, add to active
const FETCH_JOB_LUA = `
  local result = redis.call('ZPOPMIN', 'queue:waiting')
  if #result == 0 then return nil end

  local jobId = result[1]
  local now = ARGV[1]

  -- Move to active set (score = started-at timestamp for stale detection)
  redis.call('ZADD', 'queue:active', now, jobId)

  -- Update job status
  local jobData = redis.call('GET', 'job:' .. jobId)
  if jobData then
    local job = cjson.decode(jobData)
    job.status = 'active'
    job.attempts = job.attempts + 1
    job.processedAt = tonumber(now)
    redis.call('SET', 'job:' .. jobId, cjson.encode(job))
  end

  return { jobId, jobData }
`;

async function processNextJob(): Promise<boolean> {
  // Block for up to 5 seconds waiting for a job
  const result = await blockingRedis.zPopMin('queue:waiting');
  if (!result) return false;

  const jobId = result.value;
  const now = Date.now();

  // Move to active set
  await redis.zAdd('queue:active', [{ score: now, value: jobId }]);

  // Load job data
  const rawJob = await redis.get(`job:${jobId}`);
  if (!rawJob) {
    await redis.zRem('queue:active', jobId);
    return true;
  }

  const job = JSON.parse(rawJob);
  job.status = 'active';
  job.attempts += 1;
  job.processedAt = now;
  await redis.set(`job:${jobId}`, JSON.stringify(job));

  // Find handler
  const handler = handlers.get(job.type);
  if (!handler) {
    console.error(`No handler for job type: ${job.type}`);
    await moveToFailed(jobId, job, `Unknown job type: ${job.type}`);
    return true;
  }

  try {
    // Process with timeout
    const timeout = 60_000; // 60 second timeout per job
    await Promise.race([
      handler(job.payload),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Job timeout')), timeout),
      ),
    ]);

    await moveToCompleted(jobId, job);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await moveToFailed(jobId, job, message);
  }

  return true;
}

async function moveToCompleted(jobId: string, job: Record<string, unknown>): Promise<void> {
  job.status = 'completed';
  job.completedAt = Date.now();

  const multi = redis.multi();
  multi.zRem('queue:active', jobId);
  multi.set(`job:${jobId}`, JSON.stringify(job));
  // Keep completed jobs for 24h for debugging
  multi.expire(`job:${jobId}`, 86_400);
  await multi.exec();

  console.log(`Job ${jobId} completed`);
}

async function moveToFailed(
  jobId: string,
  job: Record<string, unknown>,
  reason: string,
): Promise<void> {
  await redis.zRem('queue:active', jobId);
  job.failedReason = reason;

  if ((job.attempts as number) >= (job.maxAttempts as number)) {
    // Dead letter
    job.status = 'dead_letter';
    await redis.zAdd('queue:dead_letter', [{ score: Date.now(), value: jobId }]);
    await redis.set(`job:${jobId}`, JSON.stringify(job));
    console.error(`Job ${jobId} moved to DLQ after ${job.attempts} attempts: ${reason}`);
    return;
  }

  // Retry with exponential backoff + jitter
  const attempt = job.attempts as number;
  const baseDelay = 1000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s, 32s
  const jitter = Math.random() * baseDelay * 0.3; // +/- 30% jitter
  const retryAt = Date.now() + baseDelay + jitter;

  job.status = 'delayed';
  job.nextRetryAt = retryAt;
  await redis.zAdd('queue:delayed', [{ score: retryAt, value: jobId }]);
  await redis.set(`job:${jobId}`, JSON.stringify(job));

  console.log(`Job ${jobId} will retry at ${new Date(retryAt).toISOString()} (attempt ${attempt})`);
}

// Worker loop
async function startWorker(workerId: string): Promise<void> {
  console.log(`Worker ${workerId} started`);

  while (true) {
    try {
      const hadJob = await processNextJob();
      if (!hadJob) {
        // No job available — wait briefly before polling again
        await new Promise((r) => setTimeout(r, 1000));
      }
    } catch (error) {
      console.error(`Worker ${workerId} error:`, error);
      await new Promise((r) => setTimeout(r, 5000)); // Back off on error
    }
  }
}
```

### Component 4: Delayed Job Promoter

A background loop that moves delayed/retry jobs to the waiting queue when their time arrives.

```typescript
// run: npx tsx delayed-promoter.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const PROMOTE_DELAYED_LUA = `
  local now = tonumber(ARGV[1])
  local jobs = redis.call('ZRANGEBYSCORE', 'queue:delayed', 0, now, 'LIMIT', 0, 100)

  if #jobs == 0 then return 0 end

  for _, jobId in ipairs(jobs) do
    -- Read job to get priority
    local jobData = redis.call('GET', 'job:' .. jobId)
    if jobData then
      local job = cjson.decode(jobData)
      local priority = job.priority or 0
      local score = (10 - priority) * 1e13 + now

      redis.call('ZADD', 'queue:waiting', score, jobId)
      job.status = 'waiting'
      redis.call('SET', 'job:' .. jobId, cjson.encode(job))
    end

    redis.call('ZREM', 'queue:delayed', jobId)
  end

  return #jobs
`;

async function promoteDelayedJobs(): Promise<void> {
  while (true) {
    try {
      const promoted = (await redis.eval(PROMOTE_DELAYED_LUA, {
        arguments: [Date.now().toString()],
      })) as number;

      if (promoted > 0) {
        console.log(`Promoted ${promoted} delayed jobs`);
      }
    } catch (error) {
      console.error('Delayed promoter error:', error);
    }

    await new Promise((r) => setTimeout(r, 1000)); // Check every second
  }
}
```

### Component 5: Stale Job Recovery

If a worker crashes while processing a job, the job stays in the `active` set forever. A recovery process detects stale active jobs and re-queues them.

```typescript
// run: npx tsx stale-recovery.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

async function recoverStaleJobs(staleThresholdMs = 120_000): Promise<void> {
  const cutoff = Date.now() - staleThresholdMs;

  // Find active jobs older than threshold
  const staleJobs = await redis.zRangeByScore('queue:active', 0, cutoff);

  for (const jobId of staleJobs) {
    const rawJob = await redis.get(`job:${jobId}`);
    if (!rawJob) {
      await redis.zRem('queue:active', jobId);
      continue;
    }

    const job = JSON.parse(rawJob);
    console.warn(`Recovering stale job ${jobId} (type: ${job.type}, ` +
      `started: ${new Date(job.processedAt).toISOString()})`);

    // Treat as a failure — apply retry logic
    await redis.zRem('queue:active', jobId);

    if (job.attempts >= job.maxAttempts) {
      job.status = 'dead_letter';
      job.failedReason = 'Worker crash / timeout (stale recovery)';
      await redis.zAdd('queue:dead_letter', [{ score: Date.now(), value: jobId }]);
    } else {
      // Re-queue with backoff
      const retryAt = Date.now() + 5000; // Short delay for crash recovery
      job.status = 'delayed';
      job.nextRetryAt = retryAt;
      await redis.zAdd('queue:delayed', [{ score: retryAt, value: jobId }]);
    }

    await redis.set(`job:${jobId}`, JSON.stringify(job));
  }
}

// Run every 30 seconds
setInterval(() => recoverStaleJobs(), 30_000);
```

**Stale threshold must be longer than the longest expected job.** If a job legitimately takes 90 seconds, the stale threshold must be >90 seconds, or the recovery process will re-queue jobs that are still running — causing duplicate processing. This is why idempotency is required.

### Component 6: Monitoring

```typescript
// run: npx tsx queue-monitor.ts
import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

interface QueueStats {
  waiting: number;
  active: number;
  delayed: number;
  deadLetter: number;
  oldestWaitingAge: number | null; // ms
}

async function getQueueStats(): Promise<QueueStats> {
  const [waiting, active, delayed, deadLetter, oldestWaiting] = await Promise.all([
    redis.zCard('queue:waiting'),
    redis.zCard('queue:active'),
    redis.zCard('queue:delayed'),
    redis.zCard('queue:dead_letter'),
    redis.zRange('queue:waiting', 0, 0, { REV: false }), // Oldest job
  ]);

  let oldestWaitingAge: number | null = null;
  if (oldestWaiting.length > 0) {
    const score = await redis.zScore('queue:waiting', oldestWaiting[0]);
    if (score) {
      // Score encodes priority + timestamp; extract timestamp
      const timestamp = score % 1e13;
      oldestWaitingAge = Date.now() - timestamp;
    }
  }

  return { waiting, active, delayed, deadLetter, oldestWaitingAge };
}

// Alert conditions
async function checkAlerts(): Promise<void> {
  const stats = await getQueueStats();

  if (stats.waiting > 10_000) {
    console.warn(`ALERT: Queue depth high: ${stats.waiting} waiting jobs`);
  }
  if (stats.oldestWaitingAge && stats.oldestWaitingAge > 60_000) {
    console.warn(`ALERT: Oldest job waiting for ${Math.round(stats.oldestWaitingAge / 1000)}s`);
  }
  if (stats.deadLetter > 100) {
    console.warn(`ALERT: ${stats.deadLetter} jobs in dead letter queue`);
  }

  console.log('Queue stats:', stats);
}

await checkAlerts();
```

## Trade-offs & Alternatives

| Decision | Chosen | Alternative | Why |
|---|---|---|---|
| Backing store | Redis | PostgreSQL (SKIP LOCKED) | Redis is faster, purpose-built for queue patterns; PG is simpler if you already have it |
| Priority | Sorted set (score-based) | Multiple lists per priority | Sorted set handles arbitrary priority levels; lists need one per level |
| Reliability | ZPOPMIN + active set | BRPOPLPUSH (list-based) | Sorted sets enable priority; BRPOPLPUSH only works with lists |
| Retry scheduling | Delayed sorted set | Application-level timer | Redis-based scheduling survives worker restarts |
| Stale detection | Timestamp in active set | Worker heartbeats | Simpler; heartbeats are more accurate but add complexity |

**Why not just use BullMQ?** In production, you should. BullMQ solves all of the above plus: rate limiting per queue, job dependencies, repeatable jobs, sandboxed workers, and a battle-tested stale job recovery system. Understanding the internals (which mirror this design closely) lets you debug BullMQ when things go wrong and make informed configuration choices.

**At 10x scale:**
- Shard queues by job type: `queue:waiting:send-email`, `queue:waiting:process-image`. Each shard can be on a different Redis instance.
- Worker pools per job type with independent concurrency limits.
- Consider Redis Streams (`XREADGROUP`) instead of sorted sets for better consumer group semantics and automatic acknowledgment.

**At 100x scale:**
- Redis reaches its limits. Consider Kafka for the queue transport (partitioned by key, replicated, persistent) with Redis only for job metadata.
- Separate "hot" (real-time) and "cold" (batch) queues with different SLAs.

## Key Takeaways

- **At-least-once delivery requires an "active" tracking set.** Without it, a worker crash between dequeue and completion silently drops the job. The active set + stale recovery loop closes this gap.
- **Exponential backoff with jitter is non-negotiable for retries.** Without backoff, a failing downstream service gets hammered on every retry interval. Without jitter, all retried jobs arrive at the same time (a mini-stampede).
- **Idempotency is a precondition, not an optimization.** At-least-once delivery means a job may run twice. If the handler isn't idempotent (e.g., double-charging a credit card), the queue guarantees make things worse, not better.
- **Dead letter queues are your safety net.** Jobs that fail permanently must go somewhere visible, not silently vanish. Monitor DLQ depth. Provide a way to inspect and manually retry DLQ jobs.
- **Monitor queue depth and oldest job age.** Depth tells you if workers can keep up. Age tells you if specific jobs are stuck. Both are leading indicators of problems.
