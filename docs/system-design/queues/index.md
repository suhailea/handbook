---
title: Message Queues
outline: deep
---

# Message Queues

Asynchronous messaging is the backbone of resilient distributed systems. This section covers why queues exist, how to implement them with Redis and BullMQ, and the delivery guarantees that matter in production.

## Pages

- [Why Queues Exist](/system-design/queues/01-why-queues) — temporal decoupling and load leveling
- [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq) — implementation with Redis-backed queues
- [Delivery Semantics & Idempotency](/system-design/queues/03-delivery-semantics) — at-most-once, at-least-once, and the exactly-once myth
