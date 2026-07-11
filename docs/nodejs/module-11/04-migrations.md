---
title: "Migrations & Schema Management"
outline: deep
---

# Migrations & Schema Management

> **Interview weight:** 🔥🔥 — Interviewers rarely ask migration trivia, but "how would you add a column to a 100M-row table without downtime?" is a classic.
> **Node version:** Node 22+. Prisma Migrate 5+, Drizzle Kit 0.22+, Knex 3+.
> **Prereqs:** [ORMs & Query Builders](./02-orms-query-builders) · [Transactions](./03-transactions)

## 🗣️ In Plain English

::: tip In Plain English
Think of your database schema as the blueprint of a building. When the building is first constructed, you follow the blueprint exactly. But over time, tenants need changes — knock down a wall here, add a bathroom there, rewire the electrical.

A **migration** is a written work order for a building change. It says exactly what to do ("add a wall between rooms 3 and 4, using drywall, 8 feet tall") and how to undo it ("remove the wall, patch the floor"). Every change gets its own numbered work order, and they must be applied in order. You can't install plumbing for a bathroom that hasn't been built yet.

The power of migrations is **reproducibility**. When you build a second location (staging, a colleague's laptop, production), you hand them the stack of work orders and say "apply these in sequence." They end up with an identical building — no guessing, no "I think we added that column last March."

The dangerous part is changing a building while people are still inside it. You can't just rip out the staircase and replace it — people are using it. This is the **zero-downtime migration** problem. The solution is the **expand-contract** pattern: first, build the new staircase *next to* the old one. Then redirect foot traffic to the new staircase. Then, once nobody is using the old one, tear it down. Three separate work orders, three separate deployments, but nobody ever loses access to a staircase.

The worst migrations are the ones that seem safe but aren't. Renaming a column feels harmless, but it's actually "destroy the old staircase and build a new one in one step" — any code that references the old name will crash the moment the migration runs, before the new code is deployed.
:::

## ⚙️ Under the Hood

### Why Migrations Exist

Without migrations, schema changes are communicated through Slack messages ("hey, can you add a `status` column to `orders`?"), manual SQL scripts run ad-hoc, and environments drift. Migrations solve this by making schema changes:

1. **Version-controlled** — stored in git alongside application code
2. **Ordered** — each migration has a sequence number or timestamp
3. **Idempotent** — a migration tracking table records which have been applied
4. **Reversible** (optionally) — `down` functions undo what `up` did

### Prisma Migrate

Prisma uses a **declarative** approach: you describe the desired state in `schema.prisma`, and Prisma generates the SQL diff.

```prisma
// prisma/schema.prisma — add a "status" field to Post
model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  status    String   @default("draft")  // ← NEW FIELD
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
```

```bash
# Generate migration SQL from schema diff
npx prisma migrate dev --name add-post-status

# This creates: prisma/migrations/20240115120000_add_post_status/migration.sql
# Contents:
# ALTER TABLE "Post" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';
```

```bash
# Apply migrations in production (no interactive prompts)
npx prisma migrate deploy
```

Prisma Migrate internals:

1. Reads the current `schema.prisma`
2. Compares against the **migration history** (the `_prisma_migrations` table + the `migrations/` folder)
3. Generates a SQL diff
4. Wraps the migration in a transaction (for databases that support transactional DDL — PostgreSQL does, MySQL does not for many ALTER TABLE operations)
5. Records the migration in `_prisma_migrations` with a checksum

### Drizzle Kit

Drizzle uses a **code-first** approach: your TypeScript schema IS the source of truth.

```typescript
// schema.ts — add a "status" column
import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  published: boolean("published").default(false).notNull(),
  status: text("status").default("draft").notNull(), // ← NEW FIELD
  authorId: integer("author_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

```bash
# Generate migration from schema diff
npx drizzle-kit generate

# Creates: drizzle/0001_add_status.sql
# Contents:
# ALTER TABLE "posts" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;
```

```bash
# Apply migrations
npx drizzle-kit migrate
```

Drizzle Kit diffs the TypeScript schema against a snapshot of the previous schema state (stored in `drizzle/meta/`). It generates plain SQL files that you can review, edit, and commit.

### Manual Migration Files (Knex / node-pg-migrate)

For teams that want full control over migration SQL:

```typescript
// run: npx knex migrate:make add_post_status
// migrations/20240115120000_add_post_status.ts

import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("posts", (table) => {
    table.string("status").notNull().defaultTo("draft");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("posts", (table) => {
    table.dropColumn("status");
  });
}
```

```bash
# Apply
npx knex migrate:latest

# Rollback last batch
npx knex migrate:rollback
```

### Up/Down vs Forward-Only Migrations

**Up/Down** — every migration has a reverse. Sounds safe, but:

- `down` functions are rarely tested
- Some changes are irreversible (dropping a column with data — the `down` can recreate the column but not the data)
- Complex migrations have complex `down` functions that introduce their own bugs

**Forward-only** — no `down` function. If something goes wrong, you write a *new* migration to fix it. This is simpler and what most production-oriented teams use. Prisma Migrate and Drizzle Kit both lean forward-only.

### Zero-Downtime Migrations: The Expand-Contract Pattern

The core problem: your application code and database schema must stay compatible during deploys. With rolling deploys, old and new code versions run simultaneously. A schema change that breaks the old code causes errors until the rollout completes.

**The pattern — three phases:**

#### Phase 1: Expand (add new, keep old)

```sql
-- Migration 1: Add the new column alongside the old one
ALTER TABLE users ADD COLUMN full_name TEXT;

-- Backfill from existing data
UPDATE users SET full_name = first_name || ' ' || last_name;
```

Deploy code that writes to BOTH `full_name` AND `first_name`/`last_name`. Reads from `full_name` with fallback to old columns.

#### Phase 2: Migrate reads

```typescript
// Code now reads from full_name exclusively
// Still writes to both for safety
const name = user.full_name ?? `${user.first_name} ${user.last_name}`;
```

Deploy this code fully. Verify all reads use the new column.

#### Phase 3: Contract (remove old)

```sql
-- Migration 2: Drop old columns (only after ALL code uses new column)
ALTER TABLE users DROP COLUMN first_name;
ALTER TABLE users DROP COLUMN last_name;
```

### Dangerous Migrations

| Migration | Why It's Dangerous | Safe Alternative |
|---|---|---|
| **Rename column** | Old code references old name, crashes instantly | Expand-contract: add new column, backfill, switch reads, drop old |
| **Drop NOT NULL** | `ALTER TABLE ... ALTER COLUMN ... DROP NOT NULL` — takes `ACCESS EXCLUSIVE` lock on large tables in some databases | Generally fast in PostgreSQL but test on a copy of production first |
| **Add NOT NULL without default** | Existing rows violate the constraint immediately | Add with DEFAULT first, then backfill NULLs, then add NOT NULL |
| **Add unique constraint on large table** | Creates an index, scans entire table while holding lock | `CREATE UNIQUE INDEX CONCURRENTLY`, then `ALTER TABLE ADD CONSTRAINT ... USING INDEX` |
| **Change column type** | Full table rewrite | Add new column with new type, backfill, switch reads, drop old |
| **Add index on large table** | Regular `CREATE INDEX` locks the table for writes | `CREATE INDEX CONCURRENTLY` (PostgreSQL) — slower but non-blocking |

#### Concurrent Index Creation

```sql
-- BAD: locks the table for the entire index build (minutes on large tables)
CREATE INDEX idx_posts_author ON posts (author_id);

-- GOOD: allows reads and writes during index creation
CREATE INDEX CONCURRENTLY idx_posts_author ON posts (author_id);
```

`CONCURRENTLY` takes 2-3x longer but doesn't block writes. Note: it cannot run inside a transaction, which means migration tools that wrap everything in a transaction need special handling (Prisma doesn't support this natively — you'd use `prisma.$executeRawUnsafe` or run it outside the migration).

### Migration Locking

When multiple application instances start simultaneously (Kubernetes rolling deploy), multiple instances might try to run migrations concurrently. This can cause duplicate columns, failed constraints, or corrupted state.

Solutions:

```typescript
// run: node --experimental-strip-types migration-lock.ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });
const MIGRATION_LOCK_ID = 73649; // arbitrary stable integer

async function runMigrationsWithLock(): Promise<void> {
  const client = await pool.connect();
  try {
    // Advisory lock — only one process can hold this at a time
    const { rows: [{ pg_try_advisory_lock: acquired }] } = await client.query(
      "SELECT pg_try_advisory_lock($1)",
      [MIGRATION_LOCK_ID],
    );

    if (!acquired) {
      console.log("Another instance is running migrations — skipping");
      return;
    }

    try {
      // Run your actual migrations here
      console.log("Running migrations...");
      // await knex.migrate.latest();
      // await prisma.$executeRawUnsafe(migrationSQL);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]);
    }
  } finally {
    client.release();
  }
}

await pool.end();
```

Prisma and Knex both use advisory locks internally for this purpose.

### Seeding

Seeds populate the database with initial or test data:

```typescript
// run: node --experimental-strip-types seed.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function seed(): Promise<void> {
  // Upsert to make seeding idempotent
  await prisma.user.upsert({
    where: { email: "admin@example.com" },
    update: {},
    create: {
      email: "admin@example.com",
      name: "Admin",
      posts: {
        create: [
          { title: "Welcome", content: "First post", published: true },
        ],
      },
    },
  });

  console.log("Seeding complete");
}

seed()
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Configure in `package.json` for Prisma:

```json
{
  "prisma": {
    "seed": "node --experimental-strip-types prisma/seed.ts"
  }
}
```

### Rollback Strategies

When a migration goes wrong in production:

1. **Forward-fix** (preferred) — write and deploy a new migration that corrects the problem. Faster than rolling back and re-deploying old code.
2. **Restore from backup** — nuclear option. Loses all data written after the backup. Only for catastrophic schema corruption.
3. **Down migration** — if you have one, and it's tested, and the data loss is acceptable. Rare in practice.

The safest approach: **make migrations backward-compatible** so they can be rolled back by deploying old code without a schema rollback. This is why expand-contract works — the schema supports both old and new code at every intermediate step.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. The 30-Minute Lock**
*Symptom:* Deploying a migration that adds a NOT NULL column with a DEFAULT to a 200M-row table. In PostgreSQL 10 and earlier, this rewrites the entire table while holding an `ACCESS EXCLUSIVE` lock. All queries queue up. Health checks fail. Pods restart in a cascade.
*Root cause:* Before PostgreSQL 11, `ADD COLUMN ... DEFAULT` required a full table rewrite. Since PostgreSQL 11, the default is stored in the catalog and existing rows are filled lazily — the ALTER is instant. But many teams don't know this or are on older versions.
*Fix:* Verify your PostgreSQL version. On 11+, `ADD COLUMN ... DEFAULT` is safe. On older versions, add the column as nullable, backfill in batches, then add the NOT NULL constraint.

**2. Migration Drift**
*Symptom:* `prisma migrate deploy` fails in staging: "Migration `20240115_add_status` has already been applied but the migration file has been modified." Or Drizzle Kit generates a migration that tries to add a column that already exists.
*Root cause:* Someone manually ran ALTER TABLE in production ("just this once, it's urgent"), or a developer modified a migration file after it was applied.
*Fix:* Never modify applied migrations — write a new one. Never ALTER production manually — if urgent, write the migration, commit, deploy. Use `prisma migrate diff` or `drizzle-kit introspect` in CI to detect drift between the migration state and the actual database.

**3. Concurrent Migration Race**
*Symptom:* Two Kubernetes pods start simultaneously during a rolling deploy. Both try to run migrations. One fails with `ERROR: column "status" of relation "posts" already exists`. Depending on timing, the migration tracking table may or may not record the migration as applied.
*Root cause:* No migration locking. The ORM's built-in locking may not be configured or may use a mechanism that doesn't work with your connection pooler (PgBouncer in transaction mode breaks advisory locks that span multiple statements).
*Fix:* Run migrations as a separate Kubernetes Job or init container, not as part of the application startup. This ensures exactly one migration runner.

**4. Irreversible Migration in the Wrong Direction**
*Symptom:* Migration drops a column. Deploy proceeds. Users report missing data. Team tries to rollback. The `down` migration recreates the column — but the data is gone.
*Root cause:* `down` functions can restore schema but not data. Dropping a column is a destructive operation disguised as a routine migration.
*Fix:* Never drop columns in the same migration that removes their usage from code. Phase 1: remove code references, deploy. Phase 2: verify the column is unused in queries (check `pg_stat_user_tables` or query logs). Phase 3: drop the column. Keep a backup window between phases.
:::

## 🎯 Checkpoint

::: details Question 1 — Zero-Downtime Column Rename
**Q:** You need to rename the `email` column to `email_address` on a users table with 50M rows. The column is referenced throughout the application. Describe the migration plan that avoids any downtime.

**A:** This requires three deployments using expand-contract:

**Deploy 1 — Expand:** Migration adds `email_address` column. Backfill: `UPDATE users SET email_address = email` (in batches of 10K to avoid long locks). Application code now writes to BOTH columns on every insert/update. Reads still from `email`. Add a database trigger: `CREATE TRIGGER sync_email BEFORE INSERT OR UPDATE ON users FOR EACH ROW EXECUTE FUNCTION sync_email_columns()` — this ensures any write to either column keeps both in sync, covering edge cases during the transition.

**Deploy 2 — Migrate reads:** Application code reads from `email_address` exclusively. Still writes to both. Verify via query logs that no query references the old `email` column.

**Deploy 3 — Contract:** Migration drops the `email` column and the sync trigger. The `email_address` column now has the unique constraint, index, and any foreign key references that were on `email` (these were added in Deploy 1).

The key insight: at every intermediate state, both old and new application code work correctly. The database schema is always compatible with whatever code version is running.
:::

::: details Question 2 — CREATE INDEX CONCURRENTLY
**Q:** Why can't `CREATE INDEX CONCURRENTLY` run inside a transaction? What does this mean for migration tools that wrap migrations in transactions?

**A:** `CREATE INDEX CONCURRENTLY` works by scanning the table in two passes. The first pass builds the index from a snapshot. The second pass incorporates any rows that changed during the first pass. Between passes, it waits for all transactions that started before the first pass to complete. This multi-phase approach is fundamentally incompatible with running inside a single transaction — the index must be visible to concurrent transactions between passes to detect conflicts. In a transaction, nothing is visible to other transactions until commit. For migration tools: Prisma Migrate wraps migrations in transactions and doesn't support `CONCURRENTLY` natively. You'd need to run it separately using `prisma.$executeRawUnsafe()` outside a transaction, or use a separate migration script. Knex allows `knex.raw("CREATE INDEX CONCURRENTLY ...")` but you must set `{ transaction: false }` on the migration.
:::

## Key Mental Models

- **Migrations are version control for your database** — just as you wouldn't manually edit files on a production server, don't manually ALTER production databases.
- **Schema and code must be compatible at every intermediate step** — during a rolling deploy, old and new code run simultaneously. The expand-contract pattern ensures compatibility throughout.
- **Destructive changes need multiple deployments** — rename a column in three deploys (add new, switch reads, drop old), never one.
- **Test migrations on production-sized data** — a migration that takes 10ms on 1K rows might take 30 minutes on 100M rows. `ALTER TABLE` performance is not linear.
- **Run migrations separately from application startup** — use a Kubernetes Job, a CI pipeline step, or a dedicated init container. Never race migrations against each other.

## Related

- [ORMs & Query Builders](./02-orms-query-builders) — Each ORM has its own migration tool and philosophy
- [Transactions](./03-transactions) — Migrations themselves run in transactions (usually); advisory locks prevent concurrent runs
- [Query Optimization](./05-query-optimization) — Adding indexes is a migration concern; CONCURRENTLY is critical for large tables
