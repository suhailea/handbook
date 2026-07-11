---
title: "Module 11 — Database Patterns"
outline: deep
---

# Module 11 — Database Patterns

Production database patterns for Node.js — connection management, query optimization, migrations, and transactions.

Understanding how your application talks to the database is often the difference between a service that hums along at scale and one that melts under load. This module covers the full lifecycle: how connections are managed and pooled, how ORMs and query builders abstract (and sometimes obscure) SQL, how transactions guarantee data integrity, how migrations evolve your schema safely, and how to diagnose and fix the query performance problems that inevitably emerge.

Every topic is taught twice: first as a plain-English mental model, then as a deep technical dive with runnable TypeScript examples targeting PostgreSQL with Prisma and Drizzle — the two modern TS-first database tools.

## Topics

- [Connection Pooling & Management](./01-connection-pooling) — Why pooling exists, how pools work, sizing formulas, pool exhaustion, PgBouncer, serverless considerations
- [ORMs & Query Builders](./02-orms-query-builders) — The spectrum from raw SQL to full ORM, Prisma vs Drizzle vs TypeORM vs Knex, escape hatches
- [Transactions & Data Integrity](./03-transactions) — ACID, isolation levels, locking strategies, deadlocks, idempotency keys
- [Migrations & Schema Management](./04-migrations) — Migration strategies, zero-downtime schema changes, expand-contract pattern, rollbacks
- [Query Optimization & N+1](./05-query-optimization) — The N+1 problem, EXPLAIN ANALYZE, index types, pagination strategies, slow query diagnosis
- [Summary](./summary)

## Prerequisites

- [TCP with node:net](/nodejs/module-05/01-tcp-net) — Connections are TCP under the hood
- [The libuv Threadpool](/nodejs/module-02/04-threadpool) — Some database drivers use the threadpool
- [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage) — Used for request-scoped transactions
- [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure) — Relevant for large result sets
