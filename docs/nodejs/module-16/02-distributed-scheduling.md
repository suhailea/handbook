---
title: "Distributed Scheduling & Locking"
outline: deep
---

# Distributed Scheduling & Locking

| Interview weight | Node version | Prerequisites |
|---|---|---|
| 🔥🔥🔥 | Node 22+ | [Scheduling Fundamentals](./01-scheduling-fundamentals), [Delivery Semantics](/system-design/queues/03-delivery-semantics) |

## 🗣️ In Plain English

::: tip In Plain English
Imagine three janitors share responsibility for cleaning the same office building every night. There is one cleaning checklist pinned to the front door. The rule is simple: whoever arrives first takes the checklist off the door and starts cleaning. The other two see the missing checklist and go home -- the work is covered.

But what if two janitors arrive at the exact same second? They both reach for the checklist at the same time. Without a rule for this, both grab it, both clean the building, and the company pays double for no reason.

The fix is a lock box on the door. The checklist goes inside, and the lock has a single key. The first janitor to turn the key gets the checklist. The second one finds the lock already turned and walks away. That lock box is what engineers call a **distributed lock**.

Now, there is a subtlety. What if the janitor who took the checklist has a heart attack mid-cleaning and never returns the key? The lock stays locked forever, and nobody can clean the building again. So the lock box has a timer -- if the key is not returned within two hours, the lock resets automatically. That timer is the **lock TTL (time to live)**.

But this creates its own problem: what if the janitor is just slow, not dead? They are still cleaning at hour two when the lock resets. A second janitor arrives, finds the lock open, grabs the checklist, and starts cleaning too. Now two people are cleaning simultaneously -- exactly what the lock was supposed to prevent. This is the **lock-expired-but-job-still-running** problem, and it is one of the hardest edge cases in distributed systems.

The practical answer most teams use is simpler than locks: just use a job queue like BullMQ. The queue guarantees that each job is delivered to exactly one worker. No lock management, no TTL headaches. You only need raw distributed locks for cases where a queue does not fit -- like leader election or exclusive access to a shared resource.
:::

## ⚙️ Under the Hood

### The Duplicate Execution Problem

When you deploy N replicas of an application, each running the same cron schedule, you get N executions of every scheduled job. This is not a bug in the scheduler -- it is working exactly as designed. Each process has its own `node-cron` instance, its own `setInterval`, its own clock. They have no awareness of each other.

### Redis Distributed Lock (SET NX EX)

The simplest distributed lock uses a single Redis command:

```ts
// run: npx tsx redis-lock.ts
// requires: Redis running on localhost:6379

import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const LOCK_KEY = 'lock:daily-report';
const LOCK_TTL = 300; // seconds — must be longer than the job takes

// Generate a unique value so only the lock owner can release it
const lockValue = `${process.pid}-${Date.now()}`;

async function acquireLock(): Promise<boolean> {
  // SET key value NX EX ttl — atomic: only sets if key does not exist
  const result = await redis.set(LOCK_KEY, lockValue, {
    NX: true,  // Only set if Not eXists
    EX: LOCK_TTL,
  });
  return result === 'OK';
}

async function releaseLock(): Promise<void> {
  // Only delete if we still own the lock (Lua script for atomicity)
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;
  await redis.eval(script, {
    keys: [LOCK_KEY],
    arguments: [lockValue],
  });
}

// --- Usage in a cron handler ---
async function cronHandler(): Promise<void> {
  const acquired = await acquireLock();
  if (!acquired) {
    console.log('Another replica holds the lock, skipping');
    return;
  }

  try {
    console.log('Lock acquired, running job...');
    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 5000));
    console.log('Job completed');
  } finally {
    await releaseLock();
    console.log('Lock released');
  }
}

await cronHandler();
await redis.disconnect();
```

**Why the Lua script for release?** Without it, there is a race condition:
1. Replica A checks `GET lock:daily-report` -- gets its own value.
2. Between the GET and the DEL, the lock expires (TTL elapses).
3. Replica B acquires the lock with a new value.
4. Replica A's DEL deletes Replica B's lock.

The Lua script makes the check-and-delete atomic -- Redis executes Lua scripts without interleaving other commands.

### The Redlock Algorithm

A single Redis instance is a single point of failure. If Redis goes down, no lock can be acquired or released. The Redlock algorithm (proposed by Redis creator Salvatore Sanfilippo) uses N independent Redis instances (typically 5):

1. Record the current time.
2. Try to acquire the lock on all N instances with the same key, value, and TTL.
3. The lock is considered acquired only if you succeed on a **majority** (N/2 + 1) of instances, AND the total time spent acquiring is less than the TTL.
4. If acquired, the effective TTL is the original TTL minus the time spent acquiring.
5. If not acquired (failed on too many instances or took too long), release the lock on ALL instances.

```ts
// run: npx tsx redlock-demo.ts
// requires: npm install redlock ioredis

import Redlock from 'redlock';
import Redis from 'ioredis';

// In production, these would be independent Redis instances
const redisInstances = [
  new Redis({ host: 'redis-1', port: 6379 }),
  new Redis({ host: 'redis-2', port: 6379 }),
  new Redis({ host: 'redis-3', port: 6379 }),
];

const redlock = new Redlock(redisInstances, {
  driftFactor: 0.01,  // clock drift compensation
  retryCount: 3,
  retryDelay: 200,     // ms between retries
  retryJitter: 100,    // random jitter added to retry delay
});

async function runExclusiveJob(): Promise<void> {
  let lock: Awaited<ReturnType<typeof redlock.acquire>> | undefined;

  try {
    lock = await redlock.acquire(['lock:daily-report'], 30_000); // 30s TTL
    console.log('Redlock acquired, running job...');

    // Extend the lock if the job takes longer than expected
    // This is the solution to the "lock expired but job still running" problem
    const extensionInterval = setInterval(async () => {
      try {
        lock = await lock!.extend(30_000);
        console.log('Lock extended');
      } catch {
        console.error('Failed to extend lock — another process may take over');
        clearInterval(extensionInterval);
      }
    }, 20_000); // extend every 20s (before the 30s TTL expires)

    // Simulate work
    await new Promise((resolve) => setTimeout(resolve, 25_000));
    clearInterval(extensionInterval);

    console.log('Job completed');
  } catch (err) {
    console.log('Could not acquire lock:', (err as Error).message);
  } finally {
    if (lock) {
      await lock.release();
      console.log('Lock released');
    }
  }
}

await runExclusiveJob();

// Cleanup
for (const r of redisInstances) await r.quit();
```

**Controversy:** Martin Kleppmann published a critique of Redlock arguing that it is unsafe under certain timing assumptions (GC pauses, clock skew). Redis's Antirez responded defending it. In practice, Redlock is widely used but should not be relied upon for absolute correctness in financial systems. For those, use a consensus system like ZooKeeper or etcd.

### Leader Election Pattern

Instead of locking per-job, elect one replica as the "leader" that runs all scheduled jobs. Other replicas are followers that only do request handling.

```ts
// run: npx tsx leader-election.ts
// requires: Redis running on localhost:6379

import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

const LEADER_KEY = 'scheduler:leader';
const LEADER_TTL = 10; // seconds — short TTL, renewed frequently
const instanceId = `${process.pid}-${Date.now()}`;
let isLeader = false;
let renewalInterval: ReturnType<typeof setInterval> | undefined;

async function tryBecomeLeader(): Promise<boolean> {
  const result = await redis.set(LEADER_KEY, instanceId, {
    NX: true,
    EX: LEADER_TTL,
  });
  return result === 'OK';
}

async function renewLeadership(): Promise<boolean> {
  const script = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      redis.call("EXPIRE", KEYS[1], ARGV[2])
      return 1
    else
      return 0
    end
  `;
  const result = await redis.eval(script, {
    keys: [LEADER_KEY],
    arguments: [instanceId, String(LEADER_TTL)],
  });
  return result === 1;
}

async function leaderLoop(): Promise<void> {
  if (!isLeader) {
    isLeader = await tryBecomeLeader();
    if (isLeader) {
      console.log(`[${instanceId}] Became leader`);
      // Start renewal heartbeat
      renewalInterval = setInterval(async () => {
        const renewed = await renewLeadership();
        if (!renewed) {
          console.log(`[${instanceId}] Lost leadership`);
          isLeader = false;
          clearInterval(renewalInterval);
        }
      }, (LEADER_TTL * 1000) / 3); // Renew at 1/3 of TTL
    }
  }
}

// Check leadership every 5 seconds
setInterval(leaderLoop, 5000);
await leaderLoop(); // immediate first check

// Only the leader runs scheduled tasks
setInterval(() => {
  if (isLeader) {
    console.log(`[${instanceId}] Running scheduled task (I am the leader)`);
  }
}, 10_000);

// Graceful shutdown: release leadership
process.on('SIGTERM', async () => {
  if (isLeader) {
    const script = `
      if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, {
      keys: [LEADER_KEY],
      arguments: [instanceId],
    });
    console.log(`[${instanceId}] Released leadership`);
  }
  clearInterval(renewalInterval);
  await redis.disconnect();
  process.exit(0);
});
```

### BullMQ as a Distributed Scheduler

BullMQ sidesteps the locking problem entirely. When you add a repeatable job, BullMQ creates job instances on schedule and places them in a Redis list. Workers compete for jobs using `BRPOPLPUSH` (blocking pop + push to processing list) -- this is atomic, so exactly one worker gets each job. No explicit locking needed.

```ts
// run: npx tsx bullmq-distributed.ts
// requires: Redis running on localhost:6379

import { Queue, Worker } from 'bullmq';

const connection = { host: 'localhost', port: 6379 };

// This is safe to call from every replica — upsertJobScheduler is idempotent
const queue = new Queue('distributed-cron', { connection });

await queue.upsertJobScheduler(
  'hourly-sync',
  { pattern: '0 * * * *' },
  {
    name: 'sync-external-data',
    data: { source: 'partner-api' },
  }
);

// Every replica runs a worker — BullMQ handles deduplication
const worker = new Worker('distributed-cron', async (job) => {
  console.log(`[PID ${process.pid}] Processing ${job.name} (${job.id})`);
  // Only ONE worker across all replicas processes this job
}, { connection, concurrency: 5 });

console.log(`Worker started on PID ${process.pid}`);
```

### Advisory Locks in PostgreSQL

When Redis is not available but PostgreSQL is, you can use advisory locks:

```ts
// run: npx tsx pg-advisory-lock.ts
// requires: PostgreSQL

import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Advisory lock IDs are bigints — use a consistent hash of the job name
const LOCK_ID = 123456789; // hash('daily-report')

async function withAdvisoryLock(
  lockId: number,
  fn: () => Promise<void>
): Promise<boolean> {
  const client = await pool.connect();
  try {
    // pg_try_advisory_lock returns true if lock acquired, false otherwise
    // Session-level lock: held until explicitly released or session ends
    const { rows } = await client.query(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [lockId]
    );

    if (!rows[0].acquired) {
      console.log('Lock held by another process, skipping');
      return false;
    }

    try {
      await fn();
      return true;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
    }
  } finally {
    client.release();
  }
}

await withAdvisoryLock(LOCK_ID, async () => {
  console.log('Running exclusive job with PG advisory lock');
});

await pool.end();
```

### Idempotent Cron Handlers

Even with locking, network partitions and edge cases can cause a job to run twice. The defense-in-depth strategy is to make every handler idempotent: running it twice with the same input produces the same result.

```ts
// run: npx tsx idempotent-handler.ts

import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

async function idempotentDailyReport(date: string): Promise<void> {
  const idempotencyKey = `report:generated:${date}`;

  // Check if already processed
  const alreadyDone = await redis.get(idempotencyKey);
  if (alreadyDone) {
    console.log(`Report for ${date} already generated, skipping`);
    return;
  }

  // Generate the report
  console.log(`Generating report for ${date}...`);
  // ... actual report generation ...

  // Mark as done — with a TTL so old keys are cleaned up
  await redis.set(idempotencyKey, new Date().toISOString(), { EX: 86400 * 7 }); // 7 days
  console.log(`Report for ${date} generated and marked`);
}

const today = new Date().toISOString().slice(0, 10);
await idempotentDailyReport(today);
await idempotentDailyReport(today); // second call is a no-op

await redis.disconnect();
```

### Monitoring Scheduled Jobs

Production scheduled jobs need observability. Track these metrics:

```ts
// run: npx tsx cron-monitoring.ts

import { Queue } from 'bullmq';

const connection = { host: 'localhost', port: 6379 };
const queue = new Queue('scheduled-tasks', { connection });

// Get all repeatable jobs and their next run times
const repeatableJobs = await queue.getJobSchedulers();

for (const job of repeatableJobs) {
  console.log({
    name: job.name,
    id: job.id,
    pattern: job.pattern,
    next: job.next ? new Date(job.next).toISOString() : 'unknown',
  });
}

// Get job counts for alerting
const counts = await queue.getJobCounts(
  'active', 'completed', 'failed', 'delayed', 'waiting'
);

console.log('Job counts:', counts);

// Alert if failed count is growing
if (counts.failed > 10) {
  console.error('ALERT: More than 10 failed scheduled jobs');
}

await queue.close();
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Lock TTL too short — the "phantom second execution."** Your cron job usually takes 30 seconds, so you set a lock TTL of 60 seconds. One day, the database is slow, and the job takes 90 seconds. At second 60, the lock expires. Another replica acquires the lock and starts the same job. Now two replicas are writing to the same table simultaneously. Symptom: duplicate records, constraint violations, or corrupted aggregates. Fix: set TTL generously (3-5x expected duration), and implement lock extension for long-running jobs.

**2. Leader election without fencing tokens.** Replica A is the leader. A GC pause freezes it for 12 seconds. The leadership TTL expires. Replica B becomes the leader and starts processing. Replica A resumes, still believing it is the leader (it has not checked yet). Both run the same job. This is the "split brain" problem. Fix: use fencing tokens (monotonically increasing IDs) -- when writing to a database or external system, include the token. The system rejects writes with outdated tokens.

**3. Redlock under network partition.** With 5 Redis instances, if a network partition isolates 2 of them, a client on the minority side can still acquire a lock (if it reaches 3 instances on its side). But a client on the majority side can also acquire the lock if the partitioned instances include some that the first client reached. This is the theoretical weakness Kleppmann identified. In practice, this is rare, but for safety-critical operations, use a CP system (etcd, ZooKeeper) instead of Redis.

**4. Advisory lock leak in PostgreSQL.** Session-level advisory locks are released when the connection closes. But if you use a connection pool, the connection is returned to the pool, not closed. The lock stays held. The next time the cron fires, every connection in the pool might already hold a lock. Symptom: the job never runs again. Fix: use `pg_try_advisory_xact_lock` (transaction-scoped) instead of `pg_try_advisory_lock` (session-scoped), or explicitly release the lock in a `finally` block.
:::

## 🎯 Checkpoint

::: details Question 1 — Lock safety
**Q:** You use `SET lock:job NX EX 120` in Redis to guard a cron job. The job normally takes 30 seconds. Explain a scenario where this lock fails to prevent duplicate execution, and how you would fix it.

**A:** Scenario: The job starts and acquires the lock. A full GC pause (or a slow downstream API) causes the job to take 150 seconds instead of 30. At second 120, the lock expires via TTL. Another replica acquires the lock and starts the same job. Both replicas are now executing simultaneously from second 120 to second 150.

Fix: Implement lock extension. Start a background interval that renews the lock (extends the TTL) every `TTL/3` seconds. If the job is still running at second 80, it extends the lock to second 200. If it is still running at second 160, it extends again. The extension uses a Lua script that only extends if the current holder still owns the lock (check the value matches). If extension fails (another process took the lock), the job should abort gracefully.

Additionally, make the handler idempotent as defense-in-depth, so even if duplicates occur, the result is correct.
:::

::: details Question 2 — BullMQ vs raw locks
**Q:** When would you choose a raw Redis distributed lock over BullMQ for scheduling?

**A:** BullMQ is the better choice in the vast majority of scheduling scenarios because it handles deduplication, retries, backoff, monitoring, and job persistence out of the box. Choose raw Redis locks only when:

1. **The task is not a discrete job but exclusive access to a resource** -- e.g., only one replica should serve as the WebSocket connection manager for a specific tenant.
2. **You need leader election** -- one replica must be the "coordinator" for a category of work, not just one job.
3. **BullMQ is not in your stack** and adding it (plus Redis) is not justified for a single cron job.
4. **Sub-second coordination** where BullMQ's polling interval (default 5 seconds) adds unacceptable latency.

The key insight is that BullMQ and distributed locks solve different problems. BullMQ answers "ensure this job runs exactly once." Locks answer "ensure only one process accesses this resource at a time." Scheduling happens to overlap with both.
:::

::: details Question 3 — Idempotency design
**Q:** Your cron job sends a monthly invoice email to each customer. How do you make this idempotent so that a duplicate execution does not result in customers receiving two invoices?

**A:** Create a compound idempotency key: `invoice:sent:{customerId}:{yearMonth}`. Before sending, check Redis (or a database column) for this key. If present, skip. If absent, send the email and set the key atomically. Use a database transaction: insert an `invoices_sent` record and enqueue the email in the same transaction (outbox pattern). If the transaction commits, the email will be sent by the queue worker. If the job runs again, the `INSERT` fails on a unique constraint (`customer_id, year_month`), and the handler skips gracefully. This is more robust than a Redis key alone because the "sent" record and the "work done" record are in the same database, linked by a transaction.
:::

## Key Mental Models

- **Without coordination, N replicas means N executions.** In-process cron has no concept of "the cluster." Coordination must come from outside -- Redis, a database, or a queue.
- **Locks are time-limited by necessity, and that limit creates a new failure mode.** Too short, and the lock expires mid-job. Too long, and a crashed holder blocks everyone. Lock extension is the standard mitigation.
- **BullMQ eliminates the locking problem for job scheduling** by using Redis's atomic pop operations. Prefer it over raw locks for scheduled tasks.
- **Idempotency is defense-in-depth.** Even the best locking scheme can fail under extreme conditions (GC pauses, network partitions). If the handler is idempotent, duplicates are annoying but not harmful.
- **Advisory locks in PostgreSQL are bound to the connection, not the transaction.** Use `pg_try_advisory_xact_lock` to avoid leaks in connection-pooled environments.

## Related

- [Scheduling Fundamentals](./01-scheduling-fundamentals) — cron syntax, node-cron vs BullMQ basics
- [Delivery Semantics](/system-design/queues/03-delivery-semantics) — at-most-once, at-least-once, and exactly-once guarantees
- [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq) — the queue system that makes distributed scheduling simple
- [Distributed Failure Modes](/system-design/microservices/03-failure-modes) — the broader context of partial failure and split brain
