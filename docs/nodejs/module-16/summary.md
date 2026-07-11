---
title: "Module 16 Summary"
outline: deep
---

# Module 16 — Cron Jobs & Scheduling: Summary

Module 16 covers how to schedule recurring work reliably, coordinate scheduled execution across replicas, and integrate with external services (email, file storage, third-party APIs) that scheduled jobs commonly invoke.

## Mental Models Gained

- **In-process cron is a convenience tool, not a production scheduler.** `node-cron` and `setInterval` die with the process, have no coordination, and silently lose missed runs. Use them only for non-critical, single-instance tasks during development.
- **BullMQ repeatable jobs are the production answer to scheduling.** The schedule lives in Redis, survives restarts, deduplicates across replicas, and provides retries, backoff, and monitoring out of the box.
- **Without coordination, N replicas means N executions.** In-process schedulers have no concept of "the cluster." Distributed locks, leader election, or a queue system must provide the coordination layer.
- **Locks are time-limited, and that limit is itself a failure mode.** TTL too short: the lock expires while the job is still running, causing duplicates. TTL too long: a crashed holder blocks all replicas. Lock extension is the standard mitigation.
- **Idempotency is defense-in-depth.** Even with perfect locking, network partitions and GC pauses can cause duplicate execution. If every handler is idempotent, duplicates are harmless.
- **External work belongs in a queue, not in a request handler.** Emails, file uploads, API calls, and webhook processing should be enqueued and handled by background workers. This keeps request latency low and makes retries automatic.
- **Presigned URLs push file transfer work to the client.** Your server generates a signed URL; the client uploads directly to S3. This avoids proxying large files through your Node.js process.
- **Circuit breakers prevent cascading failures from dead dependencies.** Without them, retry storms against a failing external API consume worker threads and heap, starving the rest of your system.

## Self-Assessment Checklist

### 16.1 — Scheduling Fundamentals
- [ ] Can you write a cron expression for a specific schedule and explain each field?
- [ ] Can you explain the difference between `node-cron` and BullMQ repeatable jobs?
- [ ] Do you know why scheduling in UTC is important and what DST does to timezone-aware cron?
- [ ] Can you describe the "missed run" problem and how to detect it?

### 16.2 — Distributed Scheduling & Locking
- [ ] Can you implement a Redis distributed lock using `SET NX EX` and a Lua release script?
- [ ] Can you explain the "lock expired but job still running" problem and how lock extension solves it?
- [ ] Do you know when to use BullMQ vs raw distributed locks for scheduling?
- [ ] Can you explain the difference between session-level and transaction-level advisory locks in PostgreSQL?

### 16.3 — Email, File Storage & External APIs
- [ ] Can you explain why emails should never be sent inline in an HTTP handler?
- [ ] Can you design an email system using BullMQ with separate queues for transactional and marketing emails?
- [ ] Can you implement a webhook handler with signature verification, idempotent processing, and async queue processing?
- [ ] Can you explain how circuit breakers prevent cascading failures from external API outages?

## What's Next

[Module 17 — DevOps & Deployment](/nodejs/module-17/) takes the application you have been building across all previous modules and packages it for production: Docker containers, CI/CD pipelines, configuration management, and health check monitoring.
