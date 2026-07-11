---
title: "ORMs & Query Builders"
outline: deep
---

# ORMs & Query Builders

> **Interview weight:** 🔥🔥 — Interviewers rarely quiz ORM APIs, but they love asking *when to bypass the ORM* and why.
> **Node version:** Node 22+. Prisma 5+, Drizzle 0.30+, Knex 3+.
> **Prereqs:** [Connection Pooling](./01-connection-pooling) · [Query Optimization](./05-query-optimization)

## 🗣️ In Plain English

::: tip In Plain English
Think of talking to a database like ordering food in a foreign country. You have a spectrum of options:

**Raw SQL** is like speaking the local language fluently. You say exactly what you mean, the kitchen understands perfectly, and you get precisely what you ordered. But you need to know the language, and if you misspell something, nobody corrects you until the dish arrives wrong (or not at all).

A **query builder** is like having a phrase book. You look up "I want chicken, grilled, with rice" and the book constructs the sentence for you in the local language. You can peek at what it produced and tweak it. You get most of the precision of speaking directly, with guardrails that prevent grammatical errors. But you still need to understand the menu — the phrase book doesn't decide what to order for you.

An **ORM** (Object-Relational Mapper) is like having a translator who also manages the restaurant experience. You say "get me the chicken dish" in English, and they handle everything — talking to the waiter, substituting ingredients, remembering your allergies. It's wonderful for routine orders. But when you want something unusual ("Can you ask the chef to sous-vide the chicken at exactly 63 degrees for 90 minutes?"), your translator may not know how to express that. Worse, they might translate it into something that sounds reasonable but isn't what you meant.

The critical skill is knowing when to speak through the translator and when to lean over and talk to the kitchen directly. Every good ORM provides an **escape hatch** — a way to drop down to raw SQL when the abstraction gets in the way. Senior engineers reach for it without guilt when the ORM generates a terrible query plan for a performance-critical path.
:::

## ⚙️ Under the Hood

### The Abstraction Spectrum

```
Raw SQL  ←──  Query Builder  ←──  ORM (Data Mapper)  ←──  ORM (Active Record)
More control                                                   More convenience
More SQL knowledge needed                              Less SQL knowledge needed
Faster at scale                                       Potentially slower at scale
No type safety*                                          Full type safety
```

*Raw SQL can have type safety with tagged template libraries like `sql` in Drizzle or `$queryRaw` with Prisma's typed results.

### Prisma: Schema-First, Generated Client

Prisma uses a declarative schema file (`.prisma`) as the source of truth. A code generator produces a fully typed TypeScript client.

**Schema definition:**

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        Int      @id @default(autoincrement())
  email     String   @unique
  name      String?
  posts     Post[]
  createdAt DateTime @default(now())
}

model Post {
  id        Int      @id @default(autoincrement())
  title     String
  content   String?
  published Boolean  @default(false)
  author    User     @relation(fields: [authorId], references: [id])
  authorId  Int
  createdAt DateTime @default(now())
}
```

**Generated client usage:**

```typescript
// run: node --experimental-strip-types prisma-demo.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Type-safe queries — IDE autocompletes field names, return types are inferred
const user = await prisma.user.create({
  data: {
    email: "alice@example.com",
    name: "Alice",
    posts: {
      create: [
        { title: "First Post", content: "Hello world", published: true },
        { title: "Draft", content: "Work in progress" },
      ],
    },
  },
  include: { posts: true }, // eager load relations
});

// Filtering with full type safety
const publishedPosts = await prisma.post.findMany({
  where: {
    published: true,
    author: {
      email: { endsWith: "@example.com" },
    },
  },
  orderBy: { createdAt: "desc" },
  take: 10,
});

// The escape hatch — raw SQL when Prisma's API can't express what you need
const result = await prisma.$queryRaw<Array<{ email: string; post_count: bigint }>>`
  SELECT u.email, COUNT(p.id) AS post_count
  FROM "User" u
  LEFT JOIN "Post" p ON p."authorId" = u.id
  WHERE p.published = true
  GROUP BY u.email
  HAVING COUNT(p.id) > 5
  ORDER BY post_count DESC
`;

await prisma.$disconnect();
```

**Prisma's architecture:** The Prisma Client is a thin TypeScript layer that communicates with a Rust-based **Query Engine** (runs as a sidecar binary or WASM module). The Query Engine handles connection pooling, query planning, and protocol communication. This means Prisma's pool is separate from `pg.Pool` — you can't share connections between Prisma and raw `pg`.

### Drizzle: TypeScript-First, No Code Generation

Drizzle defines the schema directly in TypeScript. No `.prisma` file, no code generation step, no sidecar binary.

**Schema definition:**

```typescript
// schema.ts
import { pgTable, serial, text, boolean, integer, timestamp } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content"),
  published: boolean("published").default(false).notNull(),
  authorId: integer("author_id").references(() => users.id).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

**Query API — SQL-like, fully typed:**

```typescript
// run: node --experimental-strip-types drizzle-demo.ts
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, desc, and, sql, gt } from "drizzle-orm";
import pg from "pg";
import { users, posts } from "./schema.js";

const pool = new pg.Pool({ connectionString: "postgresql://user:pass@localhost:5432/myapp" });
const db = drizzle(pool, { schema: { users, posts } });

// Insert with returning
const [newUser] = await db.insert(users)
  .values({ email: "alice@example.com", name: "Alice" })
  .returning();

// Select with joins — reads like SQL, types inferred
const publishedPosts = await db
  .select({
    title: posts.title,
    authorEmail: users.email,
  })
  .from(posts)
  .innerJoin(users, eq(posts.authorId, users.id))
  .where(and(
    eq(posts.published, true),
    gt(posts.createdAt, new Date("2024-01-01")),
  ))
  .orderBy(desc(posts.createdAt))
  .limit(10);

// Relational queries (Prisma-like include)
const usersWithPosts = await db.query.users.findMany({
  with: {
    posts: {
      where: eq(posts.published, true),
    },
  },
});

// Escape hatch — raw SQL with the sql`` template tag
const heavyAuthors = await db.execute<{ email: string; post_count: number }>(sql`
  SELECT u.email, COUNT(p.id)::int AS post_count
  FROM users u
  LEFT JOIN posts p ON p.author_id = u.id
  WHERE p.published = true
  GROUP BY u.email
  HAVING COUNT(p.id) > 5
  ORDER BY post_count DESC
`);

await pool.end();
```

**Key architectural difference from Prisma:** Drizzle runs entirely in the Node.js process — no sidecar, no code generation. The TypeScript schema IS the source of truth. This means faster startup (no engine boot), smaller bundle, and you bring your own connection pool.

### Knex: Pure Query Builder

Knex doesn't map objects — it builds SQL strings with a fluent API:

```typescript
// run: node --experimental-strip-types knex-demo.ts
import knex from "knex";

const db = knex({
  client: "pg",
  connection: "postgresql://user:pass@localhost:5432/myapp",
  pool: { min: 2, max: 10 },
});

// Query builder — returns plain objects, no model instances
const publishedPosts = await db("posts")
  .join("users", "posts.author_id", "users.id")
  .where("posts.published", true)
  .select("posts.title", "users.email as author_email")
  .orderBy("posts.created_at", "desc")
  .limit(10);

// Raw queries for complex SQL
const result = await db.raw(`
  SELECT u.email, COUNT(p.id) AS post_count
  FROM users u
  LEFT JOIN posts p ON p.author_id = u.id
  GROUP BY u.email
  HAVING COUNT(p.id) > ?
`, [5]);

await db.destroy();
```

Knex provides **no type safety on query results** by default — results are `any[]`. You'd need manual type assertions or a wrapper like `knex-types`.

### Comparison Table

| Feature | Prisma | Drizzle | TypeORM | Knex |
|---|---|---|---|---|
| **Paradigm** | Schema-first ORM | TS-first ORM/QB | Decorator ORM | Query builder |
| **Type safety** | Full (generated) | Full (inferred) | Partial (decorators) | None by default |
| **Code generation** | Required (`prisma generate`) | None | None | None |
| **Schema definition** | `.prisma` file | TypeScript | TypeScript decorators | JS migration files |
| **Query API style** | Method chaining, custom | SQL-like | Repository/QueryBuilder | SQL-like |
| **Raw SQL escape** | `$queryRaw` | `sql\`\`` | `query()` | `raw()` |
| **Migrations** | `prisma migrate` | `drizzle-kit` | Built-in | Built-in |
| **Connection pool** | Internal (Rust engine) | BYO (pg.Pool) | Internal (driver) | Internal (driver) |
| **Runtime overhead** | Sidecar binary (~20MB) | Near-zero | Moderate (metadata) | Near-zero |
| **Learning curve** | Low (Prisma-specific) | Low (SQL knowledge) | Medium (decorators + patterns) | Low (SQL knowledge) |
| **Best for** | Rapid development, CRUD-heavy | SQL-aware teams, performance | Existing TypeORM codebases | Simple needs, no ORM wanted |

### When to Use Raw SQL

Drop to raw SQL when:

1. **Complex aggregations** — window functions, CTEs, recursive queries
2. **Performance-critical paths** — you need to control the exact query plan
3. **Database-specific features** — PostgreSQL's `jsonb` operators, full-text search with `tsvector`, advisory locks
4. **Bulk operations** — `INSERT ... ON CONFLICT`, `COPY`, batch updates with `CASE`
5. **The ORM generates bad queries** — check with query logging, then write the SQL yourself

The escape hatch is not a failure — it's the ORM working as designed:

```typescript
// Prisma escape hatch with full type safety
const result = await prisma.$queryRaw<Array<{
  user_id: number;
  total_revenue: number;
}>>`
  WITH monthly_orders AS (
    SELECT user_id, SUM(amount) as total
    FROM orders
    WHERE created_at >= NOW() - INTERVAL '30 days'
    GROUP BY user_id
  )
  SELECT user_id, total as total_revenue
  FROM monthly_orders
  WHERE total > ${minRevenue}
  ORDER BY total DESC
`;
```

### The N+1 Problem (Introduction)

ORMs make it dangerously easy to write N+1 queries. This is covered in depth in [Query Optimization](./05-query-optimization), but here's the pattern:

```typescript
// N+1 — fires 1 query for users, then N queries for posts
const allUsers = await prisma.user.findMany();
for (const user of allUsers) {
  const posts = await prisma.post.findMany({
    where: { authorId: user.id },
  });
  console.log(`${user.name}: ${posts.length} posts`);
}

// Fixed — single query with eager loading
const usersWithPosts = await prisma.user.findMany({
  include: { posts: true },
});
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Prisma's Implicit SELECT ***
*Symptom:* Response payloads are 10x larger than needed. Database I/O is high despite simple queries.
*Root cause:* `prisma.user.findMany()` selects ALL columns by default, including that 50KB `bio` text field and the `avatarBlob` you forgot you added. Unlike SQL where you explicitly list columns, Prisma's default is `SELECT *`.
*Fix:* Use `select` to explicitly pick fields: `prisma.user.findMany({ select: { id: true, email: true } })`. In Drizzle, `db.select({ id: users.id, email: users.email }).from(users)` — it mirrors SQL's column selection naturally.

**2. ORM Migration Drift**
*Symptom:* `prisma migrate deploy` fails in staging with "migration already applied" but the schema doesn't match. Or Drizzle Kit generates a migration that drops a column that still has data.
*Root cause:* Someone manually altered the database schema (added an index, renamed a column) without creating a migration file. The migration tool's view of the schema diverges from reality.
*Fix:* Never touch production schemas manually. Use `prisma migrate diff` or `drizzle-kit introspect` to detect drift. In CI, run a schema diff check that fails if the ORM's expected schema doesn't match the actual database.

**3. TypeORM's Lazy Relations Fire Queries You Don't See**
*Symptom:* A simple endpoint that should do 2 queries does 47. Latency is 800ms for what should be 20ms.
*Root cause:* TypeORM's `lazy: true` relations fetch data on property access via getters. Serializing an entity to JSON triggers every lazy relation, each firing a separate query.
*Fix:* Avoid lazy relations. Use explicit `relations: ["posts"]` in `find()` options, or switch to Prisma/Drizzle where eager loading is explicit and there are no hidden query traps.

**4. Connection Pool Mismatch with Prisma**
*Symptom:* You configured `pg.Pool({ max: 20 })` but Prisma still limits to 9 connections. Or you try to share a pool between Prisma and raw `pg` queries and they interfere.
*Root cause:* Prisma runs its own Rust-based query engine with its own pool. The `connection_limit` parameter in the Prisma connection string controls Prisma's pool — it's completely separate from any `pg.Pool` you create. They cannot share connections.
*Fix:* Size Prisma's pool via the connection string (`?connection_limit=10`) and create a separate `pg.Pool` for raw queries if needed. Account for both pools when calculating total connections against the database's `max_connections`.
:::

## 🎯 Checkpoint

::: details Question 1 — When to Bypass the ORM
**Q:** You're building an analytics dashboard that needs to show "top 10 users by revenue in the last 30 days, with month-over-month growth percentage." The query involves a CTE, window functions, and date arithmetic. Should you use the ORM or raw SQL? Why?

**A:** Use raw SQL (via the ORM's escape hatch like `$queryRaw` or `sql\`\``). CTEs and window functions are either unsupported or awkwardly expressed in most ORMs. Attempting to force the ORM to generate this query typically results in (a) unreadable application code that's harder to maintain than the SQL itself, (b) suboptimal query plans because the ORM can't optimize across CTE boundaries, and (c) lost type safety anyway since you'll be doing manual type assertions on computed fields like "growth percentage." The escape hatch preserves the ORM's connection management and parameterization while letting you write the SQL that PostgreSQL's query planner can optimize directly.
:::

::: details Question 2 — Prisma vs Drizzle Architecture
**Q:** Why does Prisma require a code generation step (`prisma generate`) while Drizzle does not? What are the practical implications of this difference?

**A:** Prisma's type safety comes from a custom schema language (`.prisma` files) that is not TypeScript. The generator reads this schema and produces TypeScript types + a client class. This means: (1) adding a field requires re-running `prisma generate` before TypeScript sees it; (2) the generated client is a ~20MB binary (the Rust query engine); (3) CI pipelines need a `prisma generate` step. Drizzle defines schemas directly in TypeScript using `pgTable()` calls — TypeScript's own type inference derives the query result types from the schema definition at compile time, no generation step needed. Practical implications: Drizzle has faster dev iteration (change schema, types update instantly), smaller deployment artifacts, and no sidecar process. Prisma has a more polished migration story and a more approachable API for developers less comfortable with SQL.
:::

## Key Mental Models

- **ORMs trade control for convenience** — this is a conscious tradeoff, not a free lunch. Know which side of the trade you're on for each query.
- **The escape hatch is a feature, not a failure** — reaching for `$queryRaw` or `sql\`\`` for complex queries is the intended design. Fighting the ORM to avoid raw SQL is the real anti-pattern.
- **Type safety at the query boundary is the primary value** — the most dangerous bugs in database code are type mismatches and missing columns. An ORM that catches these at compile time pays for itself.
- **Your ORM's SQL is still SQL** — enable query logging, read the generated queries, check their plans. The ORM is a code generator, and you are responsible for what it generates.
- **Pick based on your team's SQL comfort** — teams fluent in SQL gravitate to Drizzle/Knex. Teams that want to avoid SQL entirely gravitate to Prisma. Neither choice is wrong if you understand the tradeoffs.

## Related

- [Connection Pooling](./01-connection-pooling) — ORMs manage pools differently; Prisma's is internal, Drizzle delegates to you
- [Transactions](./03-transactions) — Transaction APIs vary significantly between ORMs
- [Query Optimization & N+1](./05-query-optimization) — ORMs can generate N+1 queries; learn to detect and fix them
- [Migrations & Schema Management](./04-migrations) — Each ORM has its own migration tool and philosophy
