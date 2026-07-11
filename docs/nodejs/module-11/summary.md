---
title: "Module 11 Summary — Database Patterns"
outline: deep
---

# Module 11 Summary — Database Patterns

## Mental Models to Keep

**Connection Pooling**
- Connections are expensive TCP sessions with authentication overhead — pool them, don't create-per-request
- Pool size is constrained by the *database*, not the application: `connections = (cores * 2) + spindles`
- Every `connect()` must have a `release()` in a `finally` block — or use auto-releasing APIs
- Serverless breaks the pooling model — use an external pooler (PgBouncer, RDS Proxy)
- Monitor `waitingCount` as a leading indicator; timeout errors are already too late

**ORMs & Query Builders**
- ORMs trade control for convenience — know which side of the trade you're on for each query
- The escape hatch (`$queryRaw`, `sql\`\``) is a feature, not a failure — use it for complex SQL without guilt
- Type safety at the query boundary is the primary value proposition of modern ORMs
- Enable query logging and read the generated SQL — you're responsible for what the ORM produces
- Prisma runs a Rust sidecar with its own pool; Drizzle is a thin layer over your pool

**Transactions & Data Integrity**
- A transaction is a draft — nothing is final until COMMIT
- Isolation level answers "what can concurrent transactions see?" — READ COMMITTED (PostgreSQL default) is right for most workloads
- Pessimistic locking prevents conflicts; optimistic locking detects them — choose based on conflict frequency
- Never do I/O (HTTP calls, message publishing) inside a transaction — it holds locks and connections for unpredictable durations
- Deadlocks are prevented by locking rows in consistent order, not by hoping

**Migrations & Schema Management**
- Migrations are version control for your database — never ALTER production manually
- Destructive changes (rename, drop) need multiple deployments: expand, migrate reads, contract
- Test migrations on production-sized data — 10ms on 1K rows can be 30 minutes on 100M rows
- `CREATE INDEX CONCURRENTLY` for large tables — regular `CREATE INDEX` locks writes
- Run migrations separately from application startup (Kubernetes Job, CI step)

**Query Optimization & N+1**
- N+1 is the #1 ORM performance problem — enable query logging, count queries per endpoint
- EXPLAIN ANALYZE is your X-ray machine — look for Seq Scans and "Rows Removed by Filter"
- Indexes are a write-time investment for read-time speed — create for WHERE, JOIN, ORDER BY on hot paths
- Cursor pagination is the only pagination that scales — OFFSET degrades linearly
- Partial indexes index only the rows that matter — orders of magnitude smaller and faster

---

## Self-Assessment Checklist

### Connection Pooling

- [ ] I can explain why database connections are expensive (TCP + TLS + auth + server memory)
- [ ] I can size a pool using the PostgreSQL formula and account for multiple application instances
- [ ] I understand the difference between `connectionTimeoutMillis` (acquire) and `statement_timeout` (query)
- [ ] I can diagnose pool exhaustion from metrics (`totalCount`, `idleCount`, `waitingCount`)
- [ ] I can explain when and why to use PgBouncer or RDS Proxy
- [ ] I know the connection management challenges specific to serverless environments

### ORMs & Query Builders

- [ ] I can describe the tradeoffs across the spectrum: raw SQL, query builder, ORM
- [ ] I can write equivalent queries in Prisma, Drizzle, and raw `pg`
- [ ] I know when to use the escape hatch and can articulate why it's appropriate
- [ ] I understand Prisma's architecture (Rust query engine) vs Drizzle's (thin TypeScript layer)
- [ ] I can identify N+1 queries in ORM-generated code and fix them with eager loading

### Transactions & Data Integrity

- [ ] I can explain each ACID property and how PostgreSQL implements it
- [ ] I can describe the four anomalies (dirty read, non-repeatable read, phantom, serialization anomaly) with concrete examples
- [ ] I can implement transactions in Prisma (`$transaction`), Drizzle (`db.transaction`), and raw `pg` (`BEGIN/COMMIT/ROLLBACK`)
- [ ] I can choose between optimistic and pessimistic locking based on the use case
- [ ] I can implement idempotency keys using transactions
- [ ] I can explain how PostgreSQL detects deadlocks and how to prevent them

### Migrations & Schema Management

- [ ] I can create migrations with Prisma Migrate and Drizzle Kit
- [ ] I can plan a zero-downtime column rename using expand-contract
- [ ] I know which `ALTER TABLE` operations are dangerous on large tables and their safe alternatives
- [ ] I can explain migration locking and why concurrent migration runs are dangerous
- [ ] I understand forward-only vs up/down migration strategies

### Query Optimization & N+1

- [ ] I can detect N+1 queries using query logging and fix them with eager loading or JOINs
- [ ] I can read an EXPLAIN ANALYZE output and identify the bottleneck (Seq Scan, missing index, high Rows Removed)
- [ ] I know when to use each index type (B-tree, GIN, GiST, BRIN) and can create covering and partial indexes
- [ ] I can implement cursor-based pagination and explain why it outperforms OFFSET
- [ ] I can configure slow query logging and statement timeouts
- [ ] I understand the DataLoader pattern for GraphQL N+1 prevention
