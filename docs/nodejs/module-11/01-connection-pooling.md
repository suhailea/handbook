---
title: "Connection Pooling & Management"
outline: deep
---

# Connection Pooling & Management

> **Interview weight:** 🔥🔥🔥 — Pool exhaustion is a top-5 production database incident. Understanding why it happens is essential.
> **Node version:** All examples target Node 22+. Native `pg` pool has been stable for years; Prisma and Drizzle abstract pool config.
> **Prereqs:** [TCP with node:net](/nodejs/module-05/01-tcp-net) · [The libuv Threadpool](/nodejs/module-02/04-threadpool)

## 🗣️ In Plain English

::: tip In Plain English
Imagine a restaurant where every customer who walks in needs a personal waiter for their entire meal. The waiter greets them, takes orders, brings food, clears plates, and says goodbye. Hiring a new waiter for every single customer would be absurd — the interview, onboarding, and training time (TCP handshake, TLS negotiation, authentication, protocol negotiation) would mean most customers wait forever just to sit down.

Instead, the restaurant keeps a team of waiters on staff — a **pool**. When a customer arrives, a free waiter is assigned immediately. When the meal is done, the waiter doesn't quit — they go back to the break room and wait for the next customer. The manager decides how many waiters to keep on staff (the pool size). Too few and customers queue up at the door. Too many and waiters stand around idle, taking up space and costing salary (each database connection consumes memory on the server — typically 5-10 MB in PostgreSQL).

The pool also handles problems. If a waiter has been standing in the break room for an hour with no customers (idle timeout), the manager sends them home. If a customer has been waiting at the door for too long (acquire timeout), they're told "sorry, we're full" rather than waiting forever. And if a waiter suddenly collapses (connection drops), the manager removes them from the roster and hires a replacement.

In serverless environments (like AWS Lambda), the challenge changes. Imagine your restaurant only opens when a customer walks by and closes the moment they leave. You can't keep waiters on staff between openings — you need an external staffing agency (PgBouncer, RDS Proxy) that keeps the waiters and dispatches them to whichever pop-up restaurant branch needs one.
:::

## ⚙️ Under the Hood

### Why Connections Are Expensive

Every database connection involves:

1. **TCP three-way handshake** — SYN, SYN-ACK, ACK (~1 RTT, 0.5-2ms in the same AZ, 50-200ms cross-region)
2. **TLS negotiation** — another 1-2 RTTs if using SSL (you should be)
3. **Authentication** — PostgreSQL's `AuthenticationSASL` (SCRAM-SHA-256) involves multiple message rounds
4. **Protocol startup** — server sends parameter status messages, backend key data, ready-for-query
5. **Server-side memory allocation** — PostgreSQL allocates per-connection memory (~5-10 MB for work_mem, temp_buffers, catalog caches)

A single connection setup costs 5-50ms. For a service handling 1,000 requests/second where each request needs a database query, opening a fresh connection per request would consume 5-50 seconds of cumulative connection overhead every second — obviously unsustainable.

### How a Connection Pool Works

```
┌─────────────────────────────────────────────────┐
│                  Application                     │
│                                                  │
│  request 1 ─┐                                    │
│  request 2 ─┤    ┌─────────────┐                 │
│  request 3 ─┼───▶│  Pool Queue │                 │
│  request 4 ─┤    └──────┬──────┘                 │
│  request 5 ─┘           │                        │
│                         ▼                        │
│              ┌───────────────────┐               │
│              │   Idle Connections │               │
│              │  ┌───┐ ┌───┐ ┌───┐│               │
│              │  │ C1│ │ C2│ │ C3││──────────────▶│  PostgreSQL
│              │  └───┘ └───┘ └───┘│               │  (max_connections)
│              │   min ≤ n ≤ max   │               │
│              └───────────────────┘               │
└─────────────────────────────────────────────────┘
```

A pool maintains a set of pre-established connections and manages their lifecycle:

| Parameter | What It Controls | Typical Default |
|---|---|---|
| `min` | Minimum connections kept alive even when idle | 0-2 |
| `max` | Maximum simultaneous connections | 10-20 |
| `idleTimeoutMillis` | How long an unused connection sits before being destroyed | 10,000-30,000ms |
| `connectionTimeoutMillis` | How long to wait when acquiring a connection before throwing | 30,000ms |
| `maxUses` | Connections recycled after N queries (prevents server-side leaks) | Infinity |

### Pool Sizing: The Formula

The widely-cited formula from PostgreSQL's wiki:

```
connections = (core_count * 2) + effective_spindle_count
```

For a 4-core machine with SSDs (spindle count ~ 1):

```
connections = (4 * 2) + 1 = 9
```

This is the **database server's** optimal total. Your application pool size must account for:

- How many application instances connect to the same database
- Other connections (admin tools, migration runners, monitoring)

If you have 3 Node.js instances, each should get `floor(9 / 3) = 3` connections, leaving headroom for ops.

**Why small pools are faster:** With too many connections, PostgreSQL's shared buffer contention and context switching between backend processes degrades throughput. A pool of 10 well-utilized connections often outperforms a pool of 100 mostly-idle ones.

### Connection Pooling with `pg` (node-postgres)

```typescript
// run: node --experimental-strip-types pool-pg.ts
import pg from "pg";

const pool = new pg.Pool({
  host: "localhost",
  port: 5432,
  database: "myapp",
  user: "myapp",
  password: "secret",
  max: 10,                      // max connections in pool
  min: 2,                       // keep at least 2 alive
  idleTimeoutMillis: 30_000,    // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail acquire after 5s
  maxUses: 7_500,               // recycle connection after 7500 queries
});

// Event listeners for pool diagnostics
pool.on("connect", (client) => {
  console.log("New connection established");
});

pool.on("acquire", (client) => {
  console.log("Connection acquired from pool");
});

pool.on("remove", (client) => {
  console.log("Connection removed from pool");
});

pool.on("error", (err) => {
  // Unexpected error on idle client — the pool removes it automatically
  console.error("Idle client error:", err.message);
});

// Option 1: Auto-release (preferred for single queries)
const result = await pool.query("SELECT NOW() AS current_time");
console.log(result.rows[0].current_time);

// Option 2: Manual checkout (needed for transactions)
const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("INSERT INTO orders (item) VALUES ($1)", ["widget"]);
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release(); // CRITICAL: always release back to pool
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  await pool.end(); // waits for active queries, then destroys all connections
  process.exit(0);
});
```

**Critical mistake:** forgetting `client.release()` in the `finally` block. The connection stays checked out, and eventually all connections are "in use" despite being abandoned. This is the most common cause of pool exhaustion.

### Connection Pooling with Prisma

Prisma manages its own connection pool internally via its query engine (a Rust binary that runs as a sidecar process):

```typescript
// run: node --experimental-strip-types pool-prisma.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      // Pool config is in the connection string
      url: "postgresql://user:pass@localhost:5432/myapp?connection_limit=10&pool_timeout=5",
    },
  },
  log: [
    { level: "query", emit: "event" },
    { level: "warn", emit: "stdout" },
  ],
});

// Monitor query performance
prisma.$on("query", (e) => {
  if (e.duration > 100) {
    console.warn(`Slow query (${e.duration}ms): ${e.query}`);
  }
});

// Prisma auto-manages connection acquisition and release
const users = await prisma.user.findMany({
  where: { active: true },
  take: 50,
});

// Graceful shutdown
await prisma.$disconnect();
```

Prisma's pool parameters in the connection string:

| Parameter | Meaning |
|---|---|
| `connection_limit` | Maximum connections (default: `num_cpus * 2 + 1`) |
| `pool_timeout` | Seconds to wait for a connection (default: 10) |
| `connect_timeout` | Seconds for initial connection to DB (default: 5) |

### Connection Pooling with Drizzle

Drizzle delegates pooling to the underlying driver — it is a thin query layer, not a connection manager:

```typescript
// run: node --experimental-strip-types pool-drizzle.ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

// You own the pool — Drizzle just uses it
const pool = new pg.Pool({
  connectionString: "postgresql://user:pass@localhost:5432/myapp",
  max: 10,
  idleTimeoutMillis: 30_000,
});

const db = drizzle(pool);

// Queries go through the pool transparently
// const users = await db.select().from(usersTable).where(eq(usersTable.active, true));

// Shutdown: close your own pool
await pool.end();
```

This design gives you full control over pool behavior — and full responsibility for it.

### Pool Exhaustion: The Most Common Database Incident

Pool exhaustion happens when all connections are checked out and the acquire queue times out. The sequence:

1. A code path acquires a connection but doesn't release it (leak)
2. Or: a query takes 30 seconds due to a missing index, holding the connection
3. Or: a sudden traffic spike exceeds `max` connections
4. New requests wait in the acquire queue
5. After `connectionTimeoutMillis`, they get `Error: Timeout acquiring connection from pool`
6. HTTP requests start returning 503s, health checks fail, pods restart — cascading failure

**Detecting leaks** — monitor these pool metrics:

```typescript
// run: node --experimental-strip-types pool-metrics.ts
import pg from "pg";

const pool = new pg.Pool({ max: 10 });

setInterval(() => {
  console.log({
    total: pool.totalCount,      // total connections (idle + in-use)
    idle: pool.idleCount,        // connections sitting in pool
    waiting: pool.waitingCount,  // requests queued for a connection
  });
  // Alert if waiting > 0 persistently — you're running out
  // Alert if total == max and idle == 0 — fully saturated
}, 5_000);
```

### External Connection Pooling: PgBouncer

When you have many application instances (or serverless functions), each running their own pool, the total connection count at the database can explode:

```
10 pods × 10 connections/pod = 100 connections
```

But your RDS instance might only handle 150 `max_connections`. Enter PgBouncer — an external, lightweight connection pooler that sits between your app and PostgreSQL:

```
App Pool (10) ──┐
App Pool (10) ──┼──▶ PgBouncer (20 server connections) ──▶ PostgreSQL
App Pool (10) ──┘
```

PgBouncer modes:

| Mode | Behavior | Use Case |
|---|---|---|
| **Session** | One PgBouncer connection maps to one server connection for the entire client session | Least benefit, most compatible |
| **Transaction** | Connection returned to PgBouncer pool after each transaction | Best default — breaks `SET` commands and prepared statements between transactions |
| **Statement** | Connection returned after each statement | Most aggressive — breaks multi-statement transactions entirely |

### Serverless Connection Management

In Lambda/Cloud Functions, each cold start may create new connections, and there's no predictable lifecycle for cleanup:

```typescript
// BAD: new client per invocation — connection leak guaranteed
export const handler = async () => {
  const prisma = new PrismaClient();
  const data = await prisma.user.findMany();
  // prisma is garbage collected... maybe... eventually
  return { statusCode: 200, body: JSON.stringify(data) };
};

// BETTER: reuse across warm invocations
const prisma = new PrismaClient();

export const handler = async () => {
  const data = await prisma.user.findMany();
  return { statusCode: 200, body: JSON.stringify(data) };
};
```

But even the "better" pattern can overwhelm the database when hundreds of Lambda instances spin up during a traffic spike. Solutions:

- **RDS Proxy** / **PgBouncer** — external pooler absorbs the connection churn
- **Prisma Accelerate** / **Neon connection pooler** — managed pooling services
- **Reduce `connection_limit` to 1-2** per Lambda instance — limit blast radius

### Health Checks and Reconnection

Connections can die silently (network partition, database restart, firewall timeout). A robust pool needs:

```typescript
// run: node --experimental-strip-types pool-health.ts
import pg from "pg";

const pool = new pg.Pool({
  max: 10,
  // Verify connection is alive before handing it out
  // pg doesn't have built-in validation, but you can do:
});

// Periodic health check: catches dead connections before they cause query failures
async function healthCheck(): Promise<boolean> {
  try {
    const result = await pool.query("SELECT 1");
    return result.rows.length === 1;
  } catch {
    return false;
  }
}

// Use in HTTP health endpoint
// GET /health → 200 if healthCheck() passes, 503 otherwise
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. The Silent Connection Leak**
*Symptom:* Over hours, response times gradually climb. Pool metrics show `idle: 0`, `waiting: N` growing. Eventually, `Error: Timeout acquiring connection from pool` and 503s.
*Root cause:* A code path calls `pool.connect()` but doesn't call `client.release()` in a `finally` block. Every request through that path permanently removes a connection from the pool. At 1 req/sec through the leaky path, a pool of 10 is exhausted in 10 seconds.
*Fix:* Always use `pool.query()` for single queries (auto-releases). For transactions requiring manual checkout, wrap in try/finally. Add pool metric monitoring and alert when `waitingCount > 0` for more than 30 seconds.

**2. Long-Running Query Holds All Connections**
*Symptom:* A nightly analytics query runs a full table scan on a 50M-row table. It takes 45 seconds and holds a connection the entire time. During this window, the pool is one connection smaller. If multiple analytics queries fire simultaneously (e.g., a cron job running in parallel), the pool is fully blocked and web traffic gets 503s.
*Root cause:* Mixing OLTP (fast web queries) and OLAP (slow analytics) on the same pool.
*Fix:* Use a separate pool (or separate connection string via a read replica) for analytics/reporting queries. Set `statement_timeout` on the OLTP pool: `await client.query("SET statement_timeout = '5s'")`.

**3. Serverless Connection Stampede**
*Symptom:* Lambda concurrency spikes from 10 to 200 during a traffic burst. Each instance opens 5 connections. Database hits `max_connections` (1000) and starts rejecting: `FATAL: too many connections for role "myapp"`. All functions fail simultaneously.
*Root cause:* No external pooler. Each Lambda manages its own connections with no global coordination.
*Fix:* Deploy RDS Proxy or PgBouncer. In the interim, set Lambda's `connection_limit=1` and cap Lambda concurrency via reserved concurrency.

**4. Connection Timeout vs Query Timeout Confusion**
*Symptom:* Developers set `connectionTimeoutMillis: 60000` thinking it limits query runtime. Queries still run for 10 minutes, holding connections.
*Root cause:* `connectionTimeoutMillis` only controls how long to wait when *acquiring* a connection from the pool. It does not limit query execution time. Those are separate: `statement_timeout` at the PostgreSQL level, or `query_timeout` in the driver.
*Fix:* Set both: acquire timeout (5s) + statement timeout (10s for OLTP, 5min for background jobs, separate pools).
:::

## 🎯 Checkpoint

::: details Question 1 — Pool Sizing Under Load
**Q:** You have a PostgreSQL RDS instance with 4 vCPUs and SSD storage, serving 6 Node.js pods. Each pod runs its own `pg.Pool`. What `max` should each pod use, and why?

**A:** The database's optimal total connections are `(4 * 2) + 1 = 9` (per the PostgreSQL sizing formula). With 6 pods, each should use `max: 1` (6 total, leaving 3 for admin/monitoring). In practice, you'd want slightly more headroom — `max: 2` per pod (12 total) is reasonable if `max_connections` is set to at least 20. The key insight is that pool size is constrained by the *database server's* capacity, not the application's desire. Adding more connections beyond the optimal point actually *decreases* throughput due to context switching and lock contention in PostgreSQL's process-per-connection model.
:::

::: details Question 2 — Leak Detection
**Q:** Your pool has `max: 10`. Monitoring shows `totalCount: 10`, `idleCount: 0`, `waitingCount: 47`. The database shows only 3 connections actively running queries. What's happening and how do you find the leak?

**A:** 7 connections are checked out by application code but not actively querying — they were acquired via `pool.connect()` and never released (no `client.release()` in a `finally` block). The remaining 3 are legitimately executing queries. To find the leak: (1) search the codebase for `pool.connect()` calls and verify every one has a matching `release()` in a `finally` block; (2) add instrumentation that logs a stack trace on `acquire` and matches it with `release` — any acquire without a release within N seconds is a leak candidate; (3) in `pg`, you can monkey-patch `connect()` to capture the call stack and set a timeout that logs if `release()` isn't called within 30 seconds.
:::

::: details Question 3 — PgBouncer Transaction Mode
**Q:** After deploying PgBouncer in transaction mode, your application starts throwing `ERROR: prepared statement "s1" does not exist`. What's going on?

**A:** In transaction mode, PgBouncer returns the server connection to its pool after each transaction completes. The next query from the same client may land on a different PostgreSQL backend process. Prepared statements are scoped to a specific backend process — they don't follow the client across connections. When the client tries to execute a prepared statement that was created on a different backend, PostgreSQL reports it as nonexistent. Fix: disable prepared statements in your driver (in `node-postgres`: `{ prepared: false }` or use Prisma's `pgbouncer=true` connection string parameter which disables prepared statements automatically), or switch PgBouncer to session mode (losing most pooling benefit).
:::

## Key Mental Models

- **Connections are expensive resources, not free handles** — every open connection costs 5-10 MB of database server RAM, a process slot, and kernel resources. Treat connections like threads: pool them, size them carefully, monitor them.
- **Pool size is limited by the database, not the application** — your app might want 100 connections, but if the database performs best with 20, more connections make things *slower*, not faster.
- **Every `connect()` must have a `release()`** — treat database connection checkout like malloc/free. The `finally` block is not optional. Better yet, use APIs that auto-release (`pool.query()`, ORM abstractions).
- **Serverless breaks the pooling model** — when you don't control instance lifecycle, you need an external pooler (PgBouncer, RDS Proxy) to sit between ephemeral compute and the database.
- **Monitor `waitingCount`, not just error rates** — a pool at capacity with growing queue depth is a leading indicator. By the time you see timeout errors, users have been suffering for minutes.

## Related

- [TCP with node:net](/nodejs/module-05/01-tcp-net) — Database connections are TCP connections under the hood
- [The libuv Threadpool](/nodejs/module-02/04-threadpool) — Some drivers delegate DNS resolution or TLS to the threadpool
- [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown) — Must drain pool connections before exit
- [Transactions & Data Integrity](./03-transactions) — Transactions require manual connection checkout
- [ORMs & Query Builders](./02-orms-query-builders) — ORMs abstract pool management with varying degrees of control
