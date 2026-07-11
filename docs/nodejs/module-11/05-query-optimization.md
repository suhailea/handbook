---
title: "Query Optimization & N+1"
outline: deep
---

# Query Optimization & N+1

> **Interview weight:** 🔥🔥🔥 — "What's the N+1 problem and how do you solve it?" is asked in nearly every backend interview. EXPLAIN ANALYZE is a senior-level differentiator.
> **Node version:** Node 22+. Examples use Prisma 5+, Drizzle 0.30+, and raw `pg`.
> **Prereqs:** [ORMs & Query Builders](./02-orms-query-builders) · [Connection Pooling](./01-connection-pooling)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you're a librarian and someone asks for "all books by authors who live in London." The wrong way to answer: go to the author catalog, find all London authors (one trip), then walk back to the shelves *individually* for each author to find their books. If there are 100 London authors, you make 101 trips — one to the catalog plus one per author. That's the **N+1 problem**: one query for the parent data, then N queries for the children.

The right way: go to the catalog, find the London authors, then make *one* trip to the shelves with the complete list of author IDs and pull all their books in a single sweep. One trip + one trip = 2 total, regardless of how many authors there are. That's what a JOIN or eager loading does.

Now, about finding books *quickly* once you're at the shelves. If books are piled randomly on the floor, you have to look at every single one (**full table scan**). If they're organized alphabetically by author (**index**), you can jump straight to the right shelf. Different organizational systems work better for different questions: alphabetical by title helps "find this specific book," but a genre-sorted catalog (**GIN index**) helps "find all mystery novels." Choosing the right index is like choosing the right filing system — it only helps if it matches the questions you actually ask.

The database has a planning department (**query planner**) that looks at every question you ask and decides the fastest strategy — scan the pile, use the filing system, or combine multiple strategies. You can ask the planner to show its work: that's **EXPLAIN ANALYZE**. It's like asking the librarian "don't just find the books — tell me *how* you found them and how long each step took."
:::

## ⚙️ Under the Hood

### The N+1 Problem: Concrete Example

```typescript
// run: node --experimental-strip-types n-plus-1-demo.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({ log: [{ level: "query", emit: "event" }] });

let queryCount = 0;
prisma.$on("query", () => { queryCount++; });

// ❌ N+1 — 1 query for authors + N queries for posts
queryCount = 0;
const authors = await prisma.user.findMany(); // Query 1: SELECT * FROM users
for (const author of authors) {
  const posts = await prisma.post.findMany({  // Query 2..N+1: SELECT * FROM posts WHERE author_id = ?
    where: { authorId: author.id },
  });
  console.log(`${author.name}: ${posts.length} posts`);
}
console.log(`N+1 approach: ${queryCount} queries`); // 101 queries for 100 authors

// ✅ Fixed — 1 query with JOIN (eager loading)
queryCount = 0;
const authorsWithPosts = await prisma.user.findMany({
  include: { posts: true }, // Query 1: SELECT + JOIN (or 2 queries with IN)
});
for (const author of authorsWithPosts) {
  console.log(`${author.name}: ${author.posts.length} posts`);
}
console.log(`Eager loading: ${queryCount} queries`); // 2 queries regardless of author count

await prisma.$disconnect();
```

**Why ORMs make this easy to create:** The innocent-looking `author.posts` access in a loop doesn't *look* like a database query. ORMs abstract the query behind property access or method calls, making it invisible that each iteration fires a network round-trip.

### Solutions to N+1

#### 1. Eager Loading (Prisma `include` / Drizzle `with`)

```typescript
// Prisma — include loads relations in one or two queries
const users = await prisma.user.findMany({
  include: {
    posts: {
      where: { published: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    },
  },
});

// Drizzle — relational queries with "with"
const users = await db.query.users.findMany({
  with: {
    posts: {
      where: eq(posts.published, true),
      orderBy: desc(posts.createdAt),
      limit: 5,
    },
  },
});
```

Prisma typically generates two queries: one for users, one for posts `WHERE author_id IN (...)`. Drizzle's relational queries work similarly.

#### 2. Explicit JOINs

```typescript
// Drizzle — explicit JOIN gives you full control
const results = await db
  .select({
    userName: users.name,
    postTitle: posts.title,
    postDate: posts.createdAt,
  })
  .from(users)
  .innerJoin(posts, eq(posts.authorId, users.id))
  .where(eq(posts.published, true))
  .orderBy(desc(posts.createdAt));

// Raw SQL — sometimes the clearest option
const results = await pool.query(`
  SELECT u.name, p.title, p.created_at
  FROM users u
  INNER JOIN posts p ON p.author_id = u.id
  WHERE p.published = true
  ORDER BY p.created_at DESC
`);
```

#### 3. DataLoader Pattern (GraphQL)

In GraphQL, resolvers execute per-field, making N+1 the default behavior. DataLoader batches individual loads into a single query:

```typescript
// run: node --experimental-strip-types dataloader-demo.ts
import DataLoader from "dataloader";
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });

// DataLoader batches individual findById calls into one IN query
const userLoader = new DataLoader<number, { id: number; name: string }>(
  async (userIds) => {
    // This runs ONCE per tick with ALL requested IDs
    const { rows } = await pool.query(
      "SELECT id, name FROM users WHERE id = ANY($1)",
      [userIds],
    );

    // DataLoader requires results in the same order as the input IDs
    const userMap = new Map(rows.map((r) => [r.id, r]));
    return userIds.map((id) => userMap.get(id) ?? new Error(`User ${id} not found`));
  },
);

// In a GraphQL resolver, these calls happen across many fields:
const user1 = await userLoader.load(1); // ┐
const user2 = await userLoader.load(2); // ├─ All batched into: SELECT ... WHERE id IN (1,2,3)
const user3 = await userLoader.load(3); // ┘

// Second load of same ID is cached (per-request)
const user1Again = await userLoader.load(1); // served from cache, no query

await pool.end();
```

DataLoader relies on microtask scheduling: all `.load()` calls in the same tick are collected and dispatched as one batch query on the next microtask.

### EXPLAIN ANALYZE: Reading Query Plans

```sql
EXPLAIN ANALYZE SELECT * FROM posts WHERE author_id = 42 AND published = true;
```

```
Seq Scan on posts  (cost=0.00..1234.00 rows=50 width=120) (actual time=0.015..45.123 rows=47 loops=1)
  Filter: ((author_id = 42) AND (published = true))
  Rows Removed by Filter: 99953
Planning Time: 0.089 ms
Execution Time: 45.234 ms
```

**Reading the output:**

| Field | Meaning |
|---|---|
| `Seq Scan` | Full table scan — reading every row. Usually bad for large tables. |
| `cost=0.00..1234.00` | Estimated startup cost..total cost (in arbitrary units) |
| `rows=50` | Estimated row count the planner expects |
| `actual time=0.015..45.123` | Real time in ms (startup..total) |
| `rows=47` | Actual rows returned |
| `Rows Removed by Filter: 99953` | Rows read but discarded — a sign you need an index |
| `loops=1` | How many times this node was executed |

**After adding an index:**

```sql
CREATE INDEX idx_posts_author_published ON posts (author_id, published);
EXPLAIN ANALYZE SELECT * FROM posts WHERE author_id = 42 AND published = true;
```

```
Index Scan using idx_posts_author_published on posts  (cost=0.42..8.44 rows=50 width=120) (actual time=0.028..0.156 rows=47 loops=1)
  Index Cond: ((author_id = 42) AND (published = true))
Planning Time: 0.102 ms
Execution Time: 0.198 ms
```

From 45ms to 0.2ms — a 225x improvement. The `Rows Removed by Filter` line disappeared because the index delivers only matching rows.

**Scan types from best to worst (generally):**

| Scan Type | What It Does | When It's Used |
|---|---|---|
| **Index Only Scan** | Reads data from the index alone, never touches the table | All queried columns are in the index (covering index) |
| **Index Scan** | Uses index to find row locations, then fetches rows from table | Selective query on indexed column |
| **Bitmap Index Scan** | Builds a bitmap of matching pages, then fetches them | Multiple index conditions OR'ed together, or moderate selectivity |
| **Seq Scan** | Reads every row in the table | No useful index, or query returns most of the table anyway |

### Index Types in PostgreSQL

| Index Type | Data Structure | Best For | Example |
|---|---|---|---|
| **B-tree** (default) | Balanced tree | Equality (`=`), range (`<`, `>`, `BETWEEN`), sorting, prefix `LIKE 'foo%'` | `CREATE INDEX ON users (email)` |
| **Hash** | Hash table | Equality only (no range). Rarely better than B-tree since PG 10. | `CREATE INDEX ON users USING hash (email)` |
| **GIN** | Generalized Inverted Index | Array containment, JSONB operators, full-text search (`tsvector`) | `CREATE INDEX ON posts USING gin (tags)` |
| **GiST** | Generalized Search Tree | Geometric data, range types, full-text search (ranking) | `CREATE INDEX ON events USING gist (date_range)` |
| **BRIN** | Block Range INdex | Naturally ordered data (timestamps, auto-increment IDs) in large tables | `CREATE INDEX ON logs USING brin (created_at)` |

#### Covering Indexes (Index Only Scans)

A covering index includes all columns a query needs, so PostgreSQL never reads the table:

```sql
-- Query: SELECT email, name FROM users WHERE email = 'alice@example.com'

-- Regular index — requires table lookup for "name"
CREATE INDEX idx_users_email ON users (email);

-- Covering index — includes "name", enabling Index Only Scan
CREATE INDEX idx_users_email_covering ON users (email) INCLUDE (name);
```

#### Partial Indexes

Index only rows that match a condition — smaller, faster, more cache-friendly:

```sql
-- Only index published posts (maybe 10% of total)
CREATE INDEX idx_posts_published ON posts (author_id, created_at) WHERE published = true;

-- Only index active users
CREATE INDEX idx_users_active ON users (email) WHERE active = true;
```

### Pagination: Offset vs Cursor

#### Offset Pagination (Simple but Broken at Scale)

```sql
-- Page 1
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 0;
-- Page 2
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 20;
-- Page 500
SELECT * FROM posts ORDER BY created_at DESC LIMIT 20 OFFSET 9980;
-- ↑ PostgreSQL must scan and discard 9,980 rows to find the 20 you want
```

**Problems:**
1. **Performance degrades linearly** — OFFSET 100000 reads 100K rows
2. **Inconsistent results** — if a new row is inserted between page requests, you'll see a duplicate or miss a row

#### Cursor Pagination (Keyset Pagination)

```typescript
// run: node --experimental-strip-types cursor-pagination.ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });

interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
}

async function getPostsPage(
  cursor: string | null,
  pageSize: number = 20,
): Promise<PaginatedResult<{ id: number; title: string; createdAt: Date }>> {
  let query: string;
  let params: unknown[];

  if (cursor) {
    // Decode cursor: "timestamp,id" — use both for uniqueness
    const [timestamp, id] = cursor.split(",");
    query = `
      SELECT id, title, created_at
      FROM posts
      WHERE (created_at, id) < ($1::timestamptz, $2::int)
      ORDER BY created_at DESC, id DESC
      LIMIT $3
    `;
    params = [timestamp, parseInt(id, 10), pageSize + 1]; // fetch one extra to check if there's more
  } else {
    query = `
      SELECT id, title, created_at
      FROM posts
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `;
    params = [pageSize + 1];
  }

  const { rows } = await pool.query(query, params);

  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore
    ? `${lastItem.created_at.toISOString()},${lastItem.id}`
    : null;

  return { items, nextCursor };
}

// Usage:
// const page1 = await getPostsPage(null);
// const page2 = await getPostsPage(page1.nextCursor);

await pool.end();
```

**Why cursor pagination is better at scale:**

| Factor | Offset | Cursor (Keyset) |
|---|---|---|
| **Performance** | O(offset + limit) — reads skipped rows | O(limit) — seeks directly via index |
| **Consistency** | Gaps/duplicates on concurrent inserts | Stable — cursor points to a specific row |
| **Limitation** | Can jump to arbitrary page | Cannot jump to page N (only next/previous) |
| **Index required** | On ORDER BY column | On ORDER BY column(s) |

### Slow Query Logging and Statement Timeout

```sql
-- PostgreSQL configuration (postgresql.conf or ALTER SYSTEM)
-- Log queries that take more than 200ms
ALTER SYSTEM SET log_min_duration_statement = 200;

-- Set a hard timeout for OLTP queries — kill anything over 10 seconds
ALTER SYSTEM SET statement_timeout = '10s';
SELECT pg_reload_conf();
```

Per-connection timeout (from application):

```typescript
// run: node --experimental-strip-types statement-timeout.ts
import pg from "pg";

const pool = new pg.Pool({ connectionString: "postgresql://localhost:5432/myapp" });

// Set statement timeout per query
const client = await pool.connect();
try {
  await client.query("SET statement_timeout = '5s'");

  // This query will be killed if it takes more than 5 seconds
  const result = await client.query("SELECT * FROM very_large_table WHERE unindexed_column = 'foo'");
} catch (err: unknown) {
  if (err instanceof Error && err.message.includes("canceling statement due to statement timeout")) {
    console.error("Query took too long — check for missing indexes");
  }
  throw err;
} finally {
  // Reset timeout before returning to pool
  await client.query("SET statement_timeout = '0'");
  client.release();
}

await pool.end();
```

### Prepared Statements and Query Plan Caching

PostgreSQL caches query plans for prepared statements. After 5 executions with generic plans, it compares generic vs custom plan costs and picks the better one:

```typescript
// node-postgres uses prepared statements by default
// Each unique query text gets a named prepared statement
const result1 = await pool.query("SELECT * FROM users WHERE id = $1", [1]);
// First call: PARSE + BIND + EXECUTE
const result2 = await pool.query("SELECT * FROM users WHERE id = $1", [2]);
// Second call: just BIND + EXECUTE (plan reused)
```

**Important caveat with PgBouncer:** In transaction mode, prepared statements are tied to a specific PostgreSQL backend. If PgBouncer routes subsequent queries to a different backend, the prepared statement doesn't exist there. Disable prepared statements when using PgBouncer (see [Connection Pooling](./01-connection-pooling)).

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. The Hidden N+1 in a Serializer**
*Symptom:* An API endpoint that returns a list of 50 items takes 2 seconds. The database CPU graph shows spikes of 50+ queries per request.
*Root cause:* The data serialization layer (e.g., a NestJS `@Serializer()` or a GraphQL resolver) accesses a relation on each item. The ORM lazily loads the relation, firing a query per item. The N+1 is invisible in the handler code — it's in the serialization layer.
*Fix:* Enable query logging in development (`prisma.$on("query", ...)` or Drizzle's `logger: true`). Review query counts per endpoint. Fix with eager loading (`include`) or a DataLoader for GraphQL.

**2. The Missing Index That Grows Over Time**
*Symptom:* An endpoint works fine for months, then gradually gets slower. `p99` latency climbs from 50ms to 2s over 6 months.
*Root cause:* A query filters on a column without an index. At 10K rows, the Seq Scan takes 5ms (fast enough to ignore). At 5M rows, it takes 2s. The query planner correctly chose a Seq Scan when the table was small (faster than index overhead). As the table grew, it became untenable.
*Fix:* Set up slow query logging (`log_min_duration_statement = 200`). Review weekly. When a query appears, run `EXPLAIN ANALYZE`, identify the Seq Scan, add the appropriate index. Proactively index columns used in WHERE, JOIN, and ORDER BY on tables expected to grow.

**3. OFFSET Pagination in an Infinite Scroll**
*Symptom:* Infinite scroll works great on page 1-10. By page 100, the API takes 5 seconds. By page 500, it times out.
*Root cause:* `LIMIT 20 OFFSET 10000` reads and discards 10,000 rows before returning 20. Each subsequent page is slower than the last.
*Fix:* Switch to cursor-based pagination. The API returns a `nextCursor` token; the client passes it back. The query uses an index seek (`WHERE (created_at, id) < ($1, $2)`) instead of scanning and discarding rows.

**4. Index Bloat After Bulk Deletes**
*Symptom:* You deleted 80% of rows from a table, but queries didn't get faster. The table is 10GB on disk but only has 2GB of live data.
*Root cause:* PostgreSQL's MVCC doesn't immediately reclaim space from deleted rows (they're "dead tuples"). Autovacuum eventually marks the space as reusable, but the index retains its structure. B-tree indexes can become bloated — full of pointers to dead rows.
*Fix:* Run `VACUUM (VERBOSE) tablename` to reclaim dead tuple space. For severe bloat, `REINDEX CONCURRENTLY` rebuilds the index without blocking writes. Monitor `pg_stat_user_tables.n_dead_tup` and ensure autovacuum is running frequently enough for your workload.
:::

## 🎯 Checkpoint

::: details Question 1 — N+1 Detection
**Q:** You inherit a NestJS API that serves a "list all courses with instructor names" endpoint. It returns 200 courses with `instructorName` populated. The endpoint takes 3.5 seconds. How do you diagnose whether it has an N+1 problem, and how do you fix it?

**A:** **Diagnose:** Enable query logging on Prisma (`log: ["query"]`) or add database-level logging (`log_min_duration_statement = 0` temporarily). Hit the endpoint. If you see 1 `SELECT ... FROM courses` followed by 200 `SELECT ... FROM instructors WHERE id = ?`, that's N+1. The count of queries will be `1 + N` where N is the number of courses.

**Fix:** In Prisma, change `prisma.course.findMany()` to `prisma.course.findMany({ include: { instructor: { select: { name: true } } } })`. Prisma will generate either a JOIN or an `IN` query: `SELECT * FROM instructors WHERE id IN (1, 2, 3, ...)`. Total queries drop from 201 to 2. In Drizzle, use `db.query.courses.findMany({ with: { instructor: true } })` or an explicit `innerJoin`. Expected latency improvement: from 3.5s to ~50ms (eliminating 199 round trips at ~17ms each).
:::

::: details Question 2 — EXPLAIN ANALYZE Interpretation
**Q:** You run `EXPLAIN ANALYZE` and see this plan:
```
Hash Join  (cost=1.23..456.78 rows=1000 width=80) (actual time=0.045..120.567 rows=980 loops=1)
  Hash Cond: (posts.author_id = users.id)
  -> Seq Scan on posts  (cost=0.00..350.00 rows=10000 width=60) (actual time=0.010..85.234 rows=10000 loops=1)
  -> Hash  (cost=1.10..1.10 rows=10 width=20) (actual time=0.030..0.031 rows=10 loops=1)
       -> Seq Scan on users  (cost=0.00..1.10 rows=10 width=20) (actual time=0.005..0.015 rows=10 loops=1)
```
Is this plan efficient? Would you add any indexes?

**A:** For the current data sizes, this plan is reasonable. The Seq Scan on `users` (10 rows) is correct — an index scan would be slower for a table this small. The Seq Scan on `posts` (10,000 rows) is where optimization might be needed. If this query runs frequently and the `posts` table will grow: add `CREATE INDEX ON posts (author_id)`. This would turn the Seq Scan into an Index Scan or enable a Nested Loop + Index Scan join strategy. However, at only 10,000 rows and 120ms total, this might be acceptable. The `rows=10000` in the Seq Scan with only `rows=980` output from the Hash Join means 90% of posts rows are discarded — a strong signal that an index on `author_id` would help, especially as the table grows. Check whether this is a hot path (called frequently) before optimizing — premature index creation adds write overhead.
:::

::: details Question 3 — Index Selection
**Q:** Your application has a `transactions` table with 500M rows. Common queries: (1) `WHERE user_id = ? AND created_at > ?` (2) `WHERE status = 'pending'` (only 0.1% of rows are pending) (3) full-text search on `description`. What indexes would you create?

**A:** Three indexes for three access patterns:

1. **Composite B-tree:** `CREATE INDEX ON transactions (user_id, created_at)` — column order matters: `user_id` first (equality) then `created_at` (range). This lets the planner seek to the user, then range-scan within that user's transactions chronologically. Reverse order would work for the range filter but couldn't seek to a specific user efficiently.

2. **Partial B-tree:** `CREATE INDEX ON transactions (status, created_at) WHERE status = 'pending'` — a partial index covering only the 0.1% of rows that are pending. This index is ~1000x smaller than a full index on `status`, fits entirely in memory, and is extremely fast. The planner uses it when the query's WHERE clause matches the index's condition.

3. **GIN for full-text search:** `ALTER TABLE transactions ADD COLUMN description_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', description)) STORED; CREATE INDEX ON transactions USING gin (description_tsv);` — GIN indexes are designed for full-text search. The generated column pre-computes the tsvector so it's not recalculated on every query.

The key principle: each index serves a specific query pattern. Don't index columns "just in case" — each index slows writes (INSERT/UPDATE must maintain it) and consumes disk and memory.
:::

## Key Mental Models

- **N+1 is the #1 ORM performance problem** — if you're loading a list and accessing a relation in a loop, you probably have it. Enable query logging in development and count queries per endpoint.
- **EXPLAIN ANALYZE is your X-ray machine** — don't guess why a query is slow. Ask PostgreSQL to show its work. Look for Seq Scans on large tables and "Rows Removed by Filter" to find missing indexes.
- **Indexes are a write-time investment for read-time speed** — every index slows inserts and updates. Create them for columns in WHERE, JOIN ON, and ORDER BY clauses of frequently-run queries.
- **Cursor pagination is the only pagination that scales** — OFFSET reads and discards rows. Cursor seeks directly via an index. The performance difference goes from invisible to catastrophic as data grows.
- **Partial indexes are an underused superpower** — if only 0.1% of rows match a common query predicate, index only those rows. The index is smaller, faster, and more cache-friendly.

## Related

- [ORMs & Query Builders](./02-orms-query-builders) — ORMs abstract queries; understanding the SQL they generate is critical for optimization
- [Connection Pooling](./01-connection-pooling) — Slow queries hold connections longer, contributing to pool exhaustion
- [Caching Patterns](/system-design/caching/01-patterns) — Cache results of expensive queries to avoid hitting the database
- [Transactions](./03-transactions) — Long transactions with poor query plans compound lock contention
