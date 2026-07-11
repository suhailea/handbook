---
title: "Module 16 — Cron Jobs & Scheduling"
outline: deep
---

# Module 16 — Cron Jobs & Scheduling

Every backend system eventually needs work that happens on a schedule: cleaning up expired sessions at midnight, sending weekly digest emails, syncing data from a third-party API every five minutes, or generating daily reports. This module covers how to schedule recurring work in Node.js -- from simple in-process timers to production-grade distributed scheduling -- and extends into the external service integrations (email, file storage, webhooks) that scheduled jobs commonly trigger.

The core tension in scheduling is reliability: a `setInterval` inside your app process disappears when that process restarts. A cron expression attached to a BullMQ repeatable job survives restarts and scales across replicas. Understanding when each approach is appropriate -- and what breaks when you get it wrong -- is what separates toy schedulers from production ones.

## Pages

- [Scheduling Fundamentals](./01-scheduling-fundamentals) — cron expression syntax, node-cron vs BullMQ repeatable jobs, in-process vs external schedulers, timezone handling, missed runs
- [Distributed Scheduling & Locking](./02-distributed-scheduling) — duplicate execution problem, Redis distributed locks, leader election, idempotent handlers, lock TTL edge cases
- [Email, File Storage & External APIs](./03-email-external-services) — email as a queue job, S3 operations, external API resilience, webhook consumption, payment integration patterns
- [Module 16 Summary](./summary)
