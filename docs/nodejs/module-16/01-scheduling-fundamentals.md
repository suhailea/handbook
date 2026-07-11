---
title: "Scheduling Fundamentals"
outline: deep
---

# Scheduling Fundamentals

| Interview weight | Node version | Prerequisites |
|---|---|---|
| 🔥🔥 | Node 22+ | [Process Lifecycle](/nodejs/module-01/02-process-lifecycle), [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq) |

## 🗣️ In Plain English

::: tip In Plain English
Think of a scheduled job like a building's sprinkler system test. The building manager does not stand in the basement every Tuesday at 2 AM waiting to flip a switch. Instead, there is a timer on the wall -- programmed once -- that triggers the test automatically. The manager goes home, sleeps, and the test runs itself.

But here is the thing: that timer is bolted to a specific wall in a specific building. If the building loses power, the timer stops. When power comes back, the timer does not say "oh, I missed Tuesday's test, let me run it now." It just resumes ticking forward. Tuesday's test is simply gone.

That is exactly what happens with in-process scheduling in Node.js. You set up a timer (a cron job) inside your application. It works beautifully -- until the process restarts, the server reboots, or a deployment rolls out at the exact moment the job was supposed to fire. The timer vanishes with the process, and the missed run is lost.

The smarter approach is like a shared calendar system. Instead of a timer on one wall, you put the schedule in a central calendar (like Redis) that all the buildings can see. Any building can check the calendar and say "it is Tuesday 2 AM and nobody has run the test yet -- I will do it." If one building was down, another picks it up. The schedule survives because it lives outside any single building.

That is the difference between `node-cron` (the wall timer) and BullMQ repeatable jobs (the shared calendar). Both use the same scheduling language -- cron expressions -- but they differ fundamentally in where the schedule lives and what happens when things go wrong.
:::

## ⚙️ Under the Hood

### Cron Expression Syntax

A cron expression is a string of five (or six) space-separated fields that define when a job should run:

```
┌───────────── minute (0-59)
│ ┌───────────── hour (0-23)
│ │ ┌───────────── day of month (1-31)
│ │ │ ┌───────────── month (1-12)
│ │ │ │ ┌───────────── day of week (0-7, both 0 and 7 = Sunday)
│ │ │ │ │
* * * * *
```

| Expression | Meaning |
|---|---|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour, on the hour |
| `0 0 * * *` | Midnight every day |
| `0 9 * * 1` | 9 AM every Monday |
| `*/5 * * * *` | Every 5 minutes |
| `0 0 1 * *` | Midnight on the 1st of each month |
| `0 0 * * 1-5` | Midnight, weekdays only |
| `0 8,17 * * *` | 8 AM and 5 PM daily |

**Gotchas:**
- Day-of-week numbering: 0 = Sunday in standard cron, but some libraries use 1 = Monday (ISO). Always check your library's docs.
- The sixth field (seconds) is non-standard. `node-cron` supports it; many tools do not.
- `*` in day-of-month AND day-of-week means the union, not the intersection. `0 0 15 * 5` means "the 15th OR any Friday," not "the 15th if it is a Friday."

### In-Process Scheduling with node-cron

`node-cron` is a lightweight library that evaluates cron expressions and calls a callback on match. It uses `setTimeout` internally -- no external dependencies.

```ts
// run: npx tsx scheduling-basic.ts

import cron from 'node-cron';

// Run every 30 seconds (6-field expression, non-standard)
const task = cron.schedule('*/30 * * * * *', () => {
  console.log(`[${new Date().toISOString()}] Cleanup running...`);
  // Perform cleanup logic here
}, {
  scheduled: true,
  timezone: 'UTC', // Always use UTC for server-side cron
});

// Graceful shutdown
process.on('SIGTERM', () => {
  task.stop();
  console.log('Cron task stopped');
  process.exit(0);
});

console.log('Scheduler started');
```

**How it works internally:** `node-cron` calculates the number of milliseconds until the next matching time, then calls `setTimeout` for that duration. When the timeout fires, it runs your callback and schedules the next one. This is entirely in-process -- no persistence, no state, no recovery.

### BullMQ Repeatable Jobs: The Production Answer

BullMQ stores the schedule in Redis. When you add a repeatable job, BullMQ records the cron expression and the next execution time in a Redis sorted set. A worker process picks up the job when its scheduled time arrives. If the process was down, the job is still in Redis, and the next available worker handles it.

```ts
// run: npx tsx bullmq-repeatable.ts
// requires: Redis running on localhost:6379

import { Queue, Worker } from 'bullmq';

const connection = { host: 'localhost', port: 6379 };

// --- Producer: define the repeatable job ---
const queue = new Queue('scheduled-tasks', { connection });

await queue.upsertJobScheduler(
  'daily-report',           // unique scheduler ID
  { pattern: '0 0 * * *' }, // cron: midnight daily, UTC
  {
    name: 'generate-report',
    data: { type: 'daily-summary' },
    opts: {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  }
);

console.log('Repeatable job registered');

// --- Consumer: process the job ---
const worker = new Worker('scheduled-tasks', async (job) => {
  console.log(`[${new Date().toISOString()}] Processing: ${job.name}`);
  console.log('Data:', job.data);

  // Your actual work here: generate report, send emails, etc.
}, { connection });

worker.on('completed', (job) => {
  console.log(`Job ${job?.id} completed`);
});

worker.on('failed', (job, err) => {
  console.error(`Job ${job?.id} failed:`, err.message);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  await worker.close();
  await queue.close();
  process.exit(0);
});
```

**Key differences from node-cron:**

| Aspect | node-cron | BullMQ Repeatable |
|---|---|---|
| Schedule storage | In-process memory | Redis |
| Survives restart | No | Yes |
| Multiple replicas | Each replica fires independently | Only one worker picks up each job |
| Retry on failure | Manual | Built-in (attempts, backoff) |
| Missed runs | Lost | Next scheduled run fires normally |
| Monitoring | None | BullMQ Dashboard, Bull Board |
| Dependencies | None | Redis |

### External Schedulers: K8s CronJob

Kubernetes CronJob creates a new Pod on schedule. The Pod runs to completion, then terminates. This is the simplest model for jobs that do not need sub-minute precision.

```yaml
# k8s-cronjob.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: daily-report
spec:
  schedule: "0 0 * * *"    # midnight UTC
  timeZone: "UTC"           # K8s 1.27+
  concurrencyPolicy: Forbid # don't start a new run if the previous is still going
  startingDeadlineSeconds: 200  # if missed by > 200s, skip this run
  successfulJobsHistoryLimit: 3
  failedJobsHistoryLimit: 3
  jobTemplate:
    spec:
      backoffLimit: 2
      template:
        spec:
          restartPolicy: OnFailure
          containers:
            - name: report
              image: myapp:latest
              command: ["node", "--experimental-strip-types", "generate-report.ts"]
              env:
                - name: DATABASE_URL
                  valueFrom:
                    secretKeyRef:
                      name: db-credentials
                      key: url
```

**When to use which:**

| Use case | Recommended approach |
|---|---|
| Quick local dev timer | `node-cron` or `setInterval` |
| Production recurring job (needs retry, monitoring) | BullMQ repeatable jobs |
| Heavy batch job (separate resource budget) | K8s CronJob |
| Sub-second precision | `setInterval` with drift correction |

### Timezone Handling

**The rule: store and execute in UTC. Convert for display only.**

```ts
// run: npx tsx timezone-demo.ts

// BAD: scheduling in local time
// cron.schedule('0 9 * * *', handler, { timezone: 'Asia/Kolkata' });
// This breaks when DST rules change or the server moves regions.

// GOOD: calculate the UTC equivalent
// 9 AM IST = 3:30 AM UTC
// cron.schedule('30 3 * * *', handler, { timezone: 'UTC' });

// For user-facing schedules, convert at the edge:
const userTimezone = 'Asia/Kolkata';
const nextRunUtc = new Date('2026-07-12T03:30:00Z');

const displayTime = nextRunUtc.toLocaleString('en-IN', {
  timeZone: userTimezone,
  dateStyle: 'medium',
  timeStyle: 'short',
});

console.log(`Next run: ${displayTime}`); // "12 Jul 2026, 9:00 am"
```

BullMQ repeatable jobs operate in UTC by default. If you pass a `tz` option in the repeat config, BullMQ converts internally, but the job still fires based on the UTC clock. Be aware that DST transitions can cause a job to fire twice or not at all if you use a timezone with DST shifts.

### The "Missed Run" Problem

What happens when a scheduled job was supposed to fire at 2 AM, but the server was down from 1:50 AM to 2:15 AM?

- **node-cron:** The run is silently lost. When the process starts back up, the next tick resumes from "now."
- **BullMQ:** The next scheduled instance is created based on the pattern. If the missed window already passed, BullMQ does not retroactively create the job -- but the next one fires on time.
- **K8s CronJob:** `startingDeadlineSeconds` controls this. If the Pod could not be created within that window, the run is missed. K8s tracks missed runs and can create the job late if still within the deadline.

For jobs where missing a run is unacceptable (e.g., billing reconciliation), the pattern is:

```ts
// run: npx tsx missed-run-check.ts

import { createClient } from 'redis';

const redis = createClient();
await redis.connect();

async function ensureDailyJobRan(jobName: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10); // "2026-07-11"
  const key = `job:last-run:${jobName}`;
  const lastRun = await redis.get(key);

  if (lastRun === today) {
    console.log(`${jobName} already ran today, skipping`);
    return;
  }

  console.log(`${jobName} has not run today, executing now...`);
  // Run the job
  await executeJob(jobName);
  await redis.set(key, today);
}

async function executeJob(name: string): Promise<void> {
  console.log(`Executing ${name} at ${new Date().toISOString()}`);
  // actual job logic
}

// Call this from a startup hook or a frequent health check
await ensureDailyJobRan('billing-reconciliation');
await redis.disconnect();
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. node-cron in a multi-replica deployment.** You deploy three replicas behind a load balancer, each running `node-cron` with the same schedule. At midnight, all three fire simultaneously. Your "daily email" goes out three times. Fix: use BullMQ (only one worker picks up each job) or add distributed locking (covered in the next page).

**2. Timezone confusion causes double or skipped runs.** A developer schedules a job at `0 0 * * *` with timezone `America/New_York`. On the first Sunday of November (DST fall-back), 2 AM happens twice. The cron fires twice. On the second Sunday of March (DST spring-forward), 2 AM never happens. The cron skips. Symptom: duplicate entries in the database one day, missing entries another. Fix: schedule in UTC.

**3. Long-running cron handler overlaps with the next tick.** A job scheduled every minute takes 90 seconds to complete. The next cron tick fires while the previous is still running. Two instances of the same job compete for the same resources. Symptom: database deadlocks, duplicate records, or corrupted state. Fix: use BullMQ with `concurrency: 1`, or guard with a Redis lock, or use K8s `concurrencyPolicy: Forbid`.

**4. Graceful shutdown kills a mid-flight cron job.** The process receives SIGTERM during job execution. If you call `process.exit()` immediately, the job is half-done. Fix: track in-flight jobs, wait for completion (with a timeout), then exit. BullMQ handles this with `worker.close()` which waits for the current job to finish.
:::

## 🎯 Checkpoint

::: details Question 1 — Cron in replicas
**Q:** You have a NestJS application deployed as 4 Kubernetes pods, each running a `node-cron` task that sends a daily summary email at midnight. Users report receiving 4 emails. How do you fix this without removing cron from the application?

**A:** There are three approaches, in order of preference:

1. **Replace node-cron with BullMQ repeatable jobs.** Register the repeatable job once (idempotent via `upsertJobScheduler`). All 4 pods run workers, but BullMQ guarantees only one worker picks up each job instance. This is the cleanest solution.

2. **Add a distributed lock.** Each pod's cron handler first tries to acquire a Redis lock (`SET daily-email NX EX 300`). Only the pod that acquires the lock runs the job. The others skip silently. This works but adds lock management complexity.

3. **Leader election.** Use a Redis-based or K8s-native leader election so only one pod considers itself the "scheduler." Only the leader runs cron tasks. If the leader dies, another pod takes over. This is more complex but generalizes well.

The root cause is that `node-cron` has no coordination mechanism -- it runs purely in-process, unaware of other replicas. Any solution must introduce external coordination (Redis, K8s API, or a queue system).
:::

::: details Question 2 — Missed run detection
**Q:** Your billing reconciliation job runs at 2 AM UTC via a K8s CronJob. One night, the cluster's control plane was upgrading from 1:55 AM to 2:10 AM, and the CronJob could not be scheduled. The `startingDeadlineSeconds` was set to 60. What happened, and how would you prevent billing discrepancies?

**A:** The CronJob was supposed to create a Pod at 2:00 AM. The control plane was unavailable. By the time it recovered at 2:10 AM, the `startingDeadlineSeconds` of 60 seconds had passed (the deadline was 2:01 AM). Kubernetes considered the run missed and did not create the Pod. The billing reconciliation simply did not run that night.

To prevent this: (1) Increase `startingDeadlineSeconds` to a larger value (e.g., 3600 for one hour) so late starts are still attempted. (2) Implement a "catch-up" check: when the job runs, it should check the last successful run timestamp (stored in Redis or the database). If more than 24 hours have passed, it processes all missed periods. (3) Add monitoring: alert if the `job:last-run` key is older than expected. The job should be idempotent so that running it twice for the same period produces the same result.
:::

::: details Question 3 — Cron expression edge case
**Q:** What does the cron expression `0 0 31 * *` do? How often does it actually fire?

**A:** It fires at midnight on the 31st of every month. But not every month has 31 days. It fires in January (31 days), March (31), May (31), July (31), August (31), October (31), and December (31) -- seven times per year. In months with fewer than 31 days (February, April, June, September, November), the cron simply does not trigger because day 31 does not exist. This is a common mistake when trying to schedule "end of month" jobs. The correct approach for end-of-month is to schedule daily (or on the last few days) and check programmatically: `if (new Date().getDate() === new Date(year, month + 1, 0).getDate())`.
:::

## Key Mental Models

- **In-process cron is a convenience, not a guarantee.** It dies with the process and has no coordination. Use it only for non-critical, single-instance tasks.
- **BullMQ repeatable jobs are cron expressions backed by Redis persistence.** The schedule survives restarts, only one worker picks up each job, and retries are built in.
- **Always schedule in UTC.** Timezone-aware scheduling invites DST bugs that manifest twice a year and are nearly impossible to debug after the fact.
- **A missed run is silent by default.** No scheduler will shout "I missed one!" unless you build detection yourself (last-run timestamps, monitoring alerts).
- **Overlap is the hidden killer.** A job that takes longer than its interval creates concurrent instances. Always guard against overlap with locking, concurrency limits, or idempotency.

## Related

- [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq) — the queue system that powers reliable repeatable jobs
- [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown) — how to drain in-flight cron jobs before the process exits
- [Distributed Scheduling & Locking](./02-distributed-scheduling) — solving the multi-replica duplicate execution problem
- [Process Lifecycle](/nodejs/module-01/02-process-lifecycle) — why in-process timers vanish on restart
