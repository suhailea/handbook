---
title: "Transactions & Data Integrity"
outline: deep
---

# Transactions & Data Integrity

> **Interview weight:** 🔥🔥🔥 — Isolation levels, lost updates, and "how would you handle a double-charge" are standard senior-level questions.
> **Node version:** Node 22+. Transaction APIs shown for `pg`, Prisma 5+, and Drizzle 0.30+.
> **Prereqs:** [Connection Pooling](./01-connection-pooling) · [ORMs & Query Builders](./02-orms-query-builders)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you're transferring money between two bank accounts — take $100 from Alice, give $100 to Bob. Two separate operations. What if the system crashes after taking from Alice but before giving to Bob? Alice is out $100, Bob got nothing, and the bank just ate the money. That's what a **transaction** prevents.

A transaction is a promise from the database: "Either both things happen, or neither does." It's like putting both operations inside a protective bubble. While you're inside the bubble, you're working on a draft — nothing is final. If everything goes well, you pop the bubble and the changes become real (that's **COMMIT**). If anything goes wrong, the bubble dissolves and it's as if you never started (that's **ROLLBACK**).

But there's a subtlety most people miss. What happens when two people are transferring money at the exact same time? Can they see each other's half-finished work? This is where **isolation levels** come in. Think of it like office cubicles with different wall heights:

- **READ UNCOMMITTED** — no walls. You can see everyone's messy desk, including papers they haven't finished writing.
- **READ COMMITTED** — short walls. You can only see documents that are finished and signed. But if you look twice, the document might have changed between looks.
- **REPEATABLE READ** — tall walls. Once you've read a document, your copy is frozen — nobody can change what you already saw. But new documents might appear on the shared table.
- **SERIALIZABLE** — private rooms. It's as if every transaction ran completely alone, one after another. Maximum safety, maximum waiting.

Most applications live at READ COMMITTED (PostgreSQL's default) and handle the rare conflict with explicit locking or retry logic rather than paying the performance cost of SERIALIZABLE everywhere.
:::

## ⚙️ Under the Hood

### ACID — What Each Letter Actually Means

| Property | What It Guarantees | How PostgreSQL Implements It |
|---|---|---|
| **Atomicity** | All statements in a transaction succeed or all are rolled back | Write-Ahead Log (WAL) — changes logged before applied; on crash, WAL is replayed or discarded |
| **Consistency** | Constraints (FK, UNIQUE, CHECK, NOT NULL) are enforced at commit | Constraint checks deferred or immediate; violations abort the transaction |
| **Isolation** | Concurrent transactions don't see each other's uncommitted changes (degree varies by level) | MVCC (Multi-Version Concurrency Control) — each transaction sees a snapshot of data |
| **Durability** | Once committed, data survives crashes | WAL is fsync'd to disk before commit returns; replicas provide redundancy |

### MVCC: How PostgreSQL Does Isolation

PostgreSQL doesn't lock rows for reads. Instead, every row version has `xmin` (transaction ID that created it) and `xmax` (transaction ID that deleted/updated it). A transaction can only see row versions where `xmin` is committed and `xmax` is not yet committed (from that transaction's perspective). This is why readers don't block writers and writers don't block readers — they see different versions of the same row.

### Isolation Levels in Practice

```typescript
// run: node --experimental-strip-types isolation-demo.ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });

// Setting isolation level — must be the first statement in a transaction
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");

  // All queries here see a consistent snapshot from the moment BEGIN executed
  const balanceA = await client.query("SELECT balance FROM accounts WHERE id = 1");
  const balanceB = await client.query("SELECT balance FROM accounts WHERE id = 2");

  // Even if another transaction modifies account 1 and commits,
  // our reads of account 1 will still return the original value

  await client.query("COMMIT");
} finally {
  client.release();
}
```

**The four anomalies and which levels prevent them:**

| Anomaly | READ UNCOMMITTED | READ COMMITTED | REPEATABLE READ | SERIALIZABLE |
|---|---|---|---|---|
| **Dirty Read** — seeing uncommitted changes | Possible | Prevented | Prevented | Prevented |
| **Non-Repeatable Read** — same query, different result | Possible | Possible | Prevented | Prevented |
| **Phantom Read** — new rows appear in range query | Possible | Possible | Prevented* | Prevented |
| **Serialization Anomaly** — result differs from any serial execution | Possible | Possible | Possible | Prevented |

*PostgreSQL's REPEATABLE READ actually prevents phantoms too (it's implemented as Snapshot Isolation), which is stricter than the SQL standard requires.

**Concrete anomaly example — Non-Repeatable Read at READ COMMITTED:**

```
Transaction A (READ COMMITTED)          Transaction B
─────────────────────────────            ────────────
BEGIN;
SELECT balance FROM accounts
  WHERE id = 1;
  → 1000                                BEGIN;
                                         UPDATE accounts SET balance = 500
                                           WHERE id = 1;
                                         COMMIT;
SELECT balance FROM accounts
  WHERE id = 1;
  → 500  ← different result!
COMMIT;
```

At REPEATABLE READ, the second `SELECT` in Transaction A would still return `1000` — it sees the snapshot from when A began.

### Transactions in Prisma

Prisma provides two transaction modes:

```typescript
// run: node --experimental-strip-types prisma-transactions.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 1. Sequential transactions — batch operations that must all succeed
const [alice, bob] = await prisma.$transaction([
  prisma.account.update({
    where: { id: 1 },
    data: { balance: { decrement: 100 } },
  }),
  prisma.account.update({
    where: { id: 2 },
    data: { balance: { increment: 100 } },
  }),
]);
// Both updates in one DB transaction. If either fails, both roll back.

// 2. Interactive transactions — when you need to read before writing
const transfer = await prisma.$transaction(async (tx) => {
  // tx is a transactional PrismaClient — all queries go through one transaction
  const sender = await tx.account.findUniqueOrThrow({ where: { id: 1 } });

  if (sender.balance < 100) {
    throw new Error("Insufficient funds"); // triggers ROLLBACK
  }

  const [updatedSender, updatedReceiver] = await Promise.all([
    tx.account.update({
      where: { id: 1 },
      data: { balance: { decrement: 100 } },
    }),
    tx.account.update({
      where: { id: 2 },
      data: { balance: { increment: 100 } },
    }),
  ]);

  return { updatedSender, updatedReceiver };
}, {
  isolationLevel: "RepeatableRead", // Prisma supports setting isolation level
  maxWait: 5000,  // max time to wait for a connection (ms)
  timeout: 10000, // max time the transaction can run (ms)
});

await prisma.$disconnect();
```

### Transactions in Drizzle

```typescript
// run: node --experimental-strip-types drizzle-transactions.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, sql } from "drizzle-orm";
import pg from "pg";
import { accounts } from "./schema.js";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });
const db = drizzle(pool);

// Drizzle transaction — tx is a scoped db instance
const result = await db.transaction(async (tx) => {
  const [sender] = await tx
    .select()
    .from(accounts)
    .where(eq(accounts.id, 1));

  if (sender.balance < 100) {
    tx.rollback(); // explicitly abort
    return; // TypeScript: tx.rollback() throws, but this satisfies the type checker
  }

  await tx.update(accounts)
    .set({ balance: sql`${accounts.balance} - 100` })
    .where(eq(accounts.id, 1));

  await tx.update(accounts)
    .set({ balance: sql`${accounts.balance} + 100` })
    .where(eq(accounts.id, 2));

  return { success: true };
}, {
  isolationLevel: "repeatable read",
});

await pool.end();
```

### Transactions with Raw `pg`

```typescript
// run: node --experimental-strip-types pg-transactions.ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });

// CRITICAL: transactions require a dedicated connection (not pool.query())
const client = await pool.connect();
try {
  await client.query("BEGIN");

  const { rows: [sender] } = await client.query(
    "SELECT balance FROM accounts WHERE id = $1 FOR UPDATE", // pessimistic lock
    [1]
  );

  if (sender.balance < 100) {
    await client.query("ROLLBACK");
    throw new Error("Insufficient funds");
  }

  await client.query(
    "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
    [100, 1]
  );
  await client.query(
    "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
    [100, 2]
  );

  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release(); // ALWAYS release back to pool
}

await pool.end();
```

### Optimistic vs Pessimistic Locking

**Pessimistic locking** — "I'll lock this row so nobody else can touch it while I'm working":

```sql
-- SELECT FOR UPDATE acquires a row-level exclusive lock
-- Other transactions trying to read FOR UPDATE or UPDATE this row will BLOCK
SELECT * FROM accounts WHERE id = 1 FOR UPDATE;
-- ... do work ...
UPDATE accounts SET balance = balance - 100 WHERE id = 1;
COMMIT; -- lock released
```

Variants: `FOR NO KEY UPDATE` (less restrictive — allows FK checks), `FOR SHARE` (shared lock — multiple readers, no writers), `NOWAIT` (fail immediately instead of blocking), `SKIP LOCKED` (skip locked rows — great for job queues).

**Optimistic locking** — "I'll assume no one else is modifying this, but I'll check before committing":

```typescript
// run: node --experimental-strip-types optimistic-lock.ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });

async function updateWithOptimisticLock(
  accountId: number,
  adjustment: number,
  maxRetries = 3,
): Promise<void> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { rows: [account] } = await pool.query(
      "SELECT balance, version FROM accounts WHERE id = $1",
      [accountId],
    );

    const newBalance = account.balance + adjustment;

    // UPDATE only succeeds if version hasn't changed since we read it
    const { rowCount } = await pool.query(
      `UPDATE accounts
       SET balance = $1, version = version + 1
       WHERE id = $2 AND version = $3`,
      [newBalance, accountId, account.version],
    );

    if (rowCount === 1) return; // success — no concurrent modification

    // rowCount === 0 means someone else updated the row — retry
    console.warn(`Optimistic lock conflict on attempt ${attempt + 1}, retrying...`);
  }

  throw new Error(`Failed to update account ${accountId} after ${maxRetries} retries`);
}

await pool.end();
```

**When to use which:**

| Factor | Pessimistic (SELECT FOR UPDATE) | Optimistic (version column) |
|---|---|---|
| **Conflict frequency** | High — many concurrent writes to same rows | Low — conflicts are rare |
| **Hold duration** | Short transactions only — long locks kill throughput | No locks held, so duration doesn't matter |
| **Implementation** | Database handles it (simpler code) | Application handles it (retry logic needed) |
| **Failure mode** | Deadlocks possible | Starvation possible (infinite retries) |
| **Best for** | Banking, inventory decrements | CMS content editing, profile updates |

### Advisory Locks in PostgreSQL

Advisory locks are application-defined locks that PostgreSQL tracks but doesn't tie to any table or row:

```typescript
// run: node --experimental-strip-types advisory-lock.ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });

// Use case: ensure only one instance runs a migration at a time
const MIGRATION_LOCK_ID = 12345; // arbitrary integer

const client = await pool.connect();
try {
  // pg_try_advisory_lock returns true if lock acquired, false if already held
  const { rows: [{ pg_try_advisory_lock: acquired }] } = await client.query(
    "SELECT pg_try_advisory_lock($1)",
    [MIGRATION_LOCK_ID],
  );

  if (!acquired) {
    console.log("Another instance is running migrations, skipping");
    return;
  }

  // ... run migrations safely ...
  console.log("Running migrations...");

  // Release the lock (also released automatically when connection closes)
  await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
} finally {
  client.release();
}

await pool.end();
```

### Idempotency Keys with Transactions

For APIs where clients might retry (payment endpoints, webhook handlers), idempotency keys prevent double-processing:

```typescript
// run: node --experimental-strip-types idempotency.ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });

async function processPayment(
  idempotencyKey: string,
  fromAccountId: number,
  toAccountId: number,
  amount: number,
): Promise<{ status: "created" | "duplicate" }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Try to insert the idempotency key — unique constraint prevents duplicates
    const { rowCount } = await client.query(
      `INSERT INTO idempotency_keys (key, created_at)
       VALUES ($1, NOW())
       ON CONFLICT (key) DO NOTHING`,
      [idempotencyKey],
    );

    if (rowCount === 0) {
      // Key already exists — this is a duplicate request
      await client.query("ROLLBACK");
      return { status: "duplicate" };
    }

    // First time seeing this key — process the payment
    await client.query(
      "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
      [amount, fromAccountId],
    );
    await client.query(
      "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
      [amount, toAccountId],
    );

    await client.query("COMMIT");
    return { status: "created" };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

await pool.end();
```

The idempotency key insert and the payment operations are in the same transaction — if the payment fails, the key is rolled back too, allowing a legitimate retry.

### Deadlock Detection

A deadlock occurs when two transactions each hold a lock the other needs:

```
Transaction A                    Transaction B
────────────                     ────────────
BEGIN;                           BEGIN;
UPDATE accounts SET ...          UPDATE accounts SET ...
  WHERE id = 1;                    WHERE id = 2;
  -- holds lock on row 1           -- holds lock on row 2
UPDATE accounts SET ...          UPDATE accounts SET ...
  WHERE id = 2;                    WHERE id = 1;
  -- BLOCKED waiting for row 2     -- BLOCKED waiting for row 1
  -- DEADLOCK!
```

PostgreSQL detects deadlocks automatically (via a wait-for graph checked every `deadlock_timeout`, default 1s) and aborts one transaction with `ERROR: deadlock detected`. Prevention strategies:

1. **Always lock rows in a consistent order** — sort by primary key before locking
2. **Keep transactions short** — less time holding locks means less chance of deadlock
3. **Use `NOWAIT` or `SET lock_timeout`** — fail fast rather than waiting indefinitely

```typescript
// Deadlock prevention: sort IDs before locking
async function transferFunds(
  fromId: number,
  toId: number,
  amount: number,
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock in consistent order to prevent deadlocks
    const [firstId, secondId] = fromId < toId ? [fromId, toId] : [toId, fromId];

    await client.query(
      "SELECT id FROM accounts WHERE id IN ($1, $2) ORDER BY id FOR UPDATE",
      [firstId, secondId],
    );

    await client.query(
      "UPDATE accounts SET balance = balance - $1 WHERE id = $2",
      [amount, fromId],
    );
    await client.query(
      "UPDATE accounts SET balance = balance + $1 WHERE id = $2",
      [amount, toId],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
```

### Distributed Transactions: Why to Avoid Them

In a microservices architecture, a single business operation might span multiple databases. Two-phase commit (2PC) across databases is:

- **Slow** — coordinator must wait for all participants
- **Fragile** — if the coordinator crashes between prepare and commit, participants are stuck holding locks
- **Not supported** by most managed databases (RDS, PlanetScale, Neon)

Use **sagas** instead — a sequence of local transactions with compensating actions for rollback. See [Sagas & Distributed Transactions](/system-design/microservices/02-sagas).

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. The Long Transaction That Holds the World**
*Symptom:* Gradually increasing response times across the entire service. `pg_stat_activity` shows a transaction that's been `idle in transaction` for 10 minutes.
*Root cause:* A code path opens a transaction, does an HTTP call to an external service mid-transaction (waiting for a webhook callback, an LLM response, etc.), and holds the database connection the entire time. Every row it touched is locked; other transactions that need those rows queue up.
*Fix:* Never do I/O to external services inside a transaction. Structure the code as: read data, release transaction, call external service, open new transaction for the write. If you need atomicity across the external call, use the saga/outbox pattern.

**2. Serialization Failures Nobody Handles**
*Symptom:* At REPEATABLE READ or SERIALIZABLE, users intermittently see `ERROR: could not serialize access due to concurrent update`. The application treats this as a 500 error and gives up.
*Root cause:* These isolation levels detect conflicts that would violate the snapshot. The database aborts one transaction and expects the application to **retry**. Most codebases don't have retry logic.
*Fix:* Wrap transactions in a retry loop that catches serialization errors (PostgreSQL error code `40001`) and retries with a fresh transaction. Limit retries (3-5 attempts) with jittered backoff.

**3. Deadlocks During Bulk Updates**
*Symptom:* Nightly batch job that updates thousands of rows intermittently fails with `ERROR: deadlock detected`. Retrying the entire batch is slow.
*Root cause:* The batch updates rows in different orders across concurrent workers/processes.
*Fix:* Sort the batch by primary key before processing. Or: break into smaller batches that each acquire locks in PK order. `SKIP LOCKED` can help if the batch items are independent.

**4. Lost Updates at READ COMMITTED**
*Symptom:* Two users edit the same record "simultaneously." Both read version 5 of the document. User A saves, creating version 6. User B saves, also creating "version 6" — overwriting A's changes.
*Root cause:* READ COMMITTED allows both transactions to read the same row, and the second `UPDATE` simply overwrites the first. There's no conflict detection.
*Fix:* Use optimistic locking (version column). User B's `UPDATE ... WHERE version = 5` returns `rowCount = 0` because A already incremented it to 6. The application detects this and asks B to re-read and re-apply their changes.
:::

## 🎯 Checkpoint

::: details Question 1 — Isolation Level Selection
**Q:** Your e-commerce platform allows users to add items to a shared wishlist. Multiple users can add/remove items concurrently. Which isolation level do you choose, and do you need explicit locking? Why?

**A:** READ COMMITTED (PostgreSQL default) is sufficient. Wishlist operations are independent — user A adding an item doesn't conflict with user B adding a different item. Even if they add the same item, INSERT with ON CONFLICT DO NOTHING handles the duplicate gracefully. You don't need explicit locking because there's no read-then-write pattern on the same row. Stronger isolation (REPEATABLE READ) would add overhead without preventing any anomaly that actually matters here. The key insight: isolation level should match the consistency requirement of the specific operation, not be a global setting. Payment transfers need stronger guarantees than wishlist modifications.
:::

::: details Question 2 — Optimistic vs Pessimistic
**Q:** You're building an inventory system where items have limited stock (e.g., concert tickets). Two users try to buy the last ticket at the same moment. Compare the optimistic and pessimistic approaches. Which would you choose and why?

**A:** **Pessimistic (SELECT FOR UPDATE):** Transaction A reads `stock = 1 FOR UPDATE`, locking the row. Transaction B blocks waiting for the lock. A decrements to 0 and commits. B now reads `stock = 0` and rejects the purchase. Zero overselling risk. Downside: B waits (latency), and if A's transaction is slow, throughput drops.

**Optimistic (version column):** Both A and B read `stock = 1, version = 5`. A does `UPDATE SET stock = 0, version = 6 WHERE id = X AND version = 5` — succeeds. B tries the same `WHERE version = 5` — rowCount = 0, retry. B re-reads, sees `stock = 0`, rejects. Same correctness, but B does extra work (retry).

**For concert tickets: pessimistic.** Conflict probability is *high* (many people buying the last few tickets simultaneously). Optimistic locking would cause massive retry storms. Pessimistic locking is also simpler to reason about for inventory — the "hold the row while I decide" model maps naturally to "reserve the ticket while I process payment." Use `FOR UPDATE NOWAIT` or `FOR UPDATE SKIP LOCKED` to fail fast instead of blocking.
:::

::: details Question 3 — Deadlock Prevention
**Q:** Your transfer function updates account A then account B. Another concurrent transfer updates B then A. How does PostgreSQL detect this deadlock, and what's the standard prevention technique?

**A:** PostgreSQL maintains a wait-for graph: an edge from transaction X to transaction Y means "X is waiting for a lock that Y holds." Every `deadlock_timeout` interval (default 1s), it checks for cycles in this graph. A cycle means deadlock. PostgreSQL aborts the transaction that's easiest to roll back (least work done), returning error code `40P01`. The standard prevention: **always acquire locks in a deterministic order.** Sort the account IDs — if transferring between accounts 7 and 3, always lock 3 first, then 7, regardless of who is the sender. This makes cycles in the wait-for graph impossible because every transaction acquires locks in the same global order.
:::

## Key Mental Models

- **A transaction is a draft, not a command** — nothing is final until COMMIT. Think of it as writing in pencil with an eraser (ROLLBACK) always in your other hand.
- **Isolation level is the answer to "what can concurrent transactions see?"** — READ COMMITTED sees committed snapshots (which can change between reads); REPEATABLE READ freezes the snapshot; SERIALIZABLE pretends you're alone.
- **Pessimistic locking prevents conflicts; optimistic locking detects them** — choose based on how often conflicts actually happen. High conflict = pessimistic. Low conflict = optimistic.
- **Never do I/O inside a transaction** — external HTTP calls, file operations, or message publishing inside a transaction hold locks and connections for unpredictable durations. Read, commit, then do I/O.
- **Deadlocks are prevented by ordering, not by hoping** — always acquire locks in a consistent, deterministic order (typically ascending primary key).

## Related

- [Connection Pooling](./01-connection-pooling) — Transactions require manual connection checkout; forgetting to release causes pool exhaustion
- [Sagas & Distributed Transactions](/system-design/microservices/02-sagas) — When a transaction spans multiple services
- [ORMs & Query Builders](./02-orms-query-builders) — Transaction API differences across Prisma, Drizzle, raw pg
- [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage) — Request-scoped transaction propagation
- [Delivery Semantics](/system-design/queues/03-delivery-semantics) — Idempotency keys tie to exactly-once processing
