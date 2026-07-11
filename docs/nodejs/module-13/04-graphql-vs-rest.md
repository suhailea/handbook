---
title: "GraphQL vs REST: When to Use Which"
outline: deep
---

# GraphQL vs REST: When to Use Which

| Interview weight | Node version | Prerequisites |
|---|---|---|
| :fire::fire: | Node 22+ | [REST Best Practices](./01-rest-best-practices), [Promise Internals](/nodejs/module-03/01-promise-internals) |

## 🗣️ In Plain English

::: tip In Plain English
Imagine two kinds of restaurants. In the first — a traditional restaurant — the menu has fixed dishes. You order "Dish 7" and the kitchen brings you exactly what the chef decided Dish 7 contains. If you only wanted the salad that comes with it, too bad — you get the whole plate. If you wanted the salad *plus* the dessert from Dish 12, you make two orders and wait twice.

In the second restaurant, there is no fixed menu. Instead, you get a form where you check exactly what you want: "Caesar salad from the appetizers, grilled chicken from the mains, nothing else." The kitchen assembles your custom plate in one trip. Need something different tomorrow? Just fill out a different form. No new menu item needed.

REST is the first restaurant. Each endpoint is a fixed dish — `/users/42` returns a predefined shape. GraphQL is the second restaurant. There is one counter (`/graphql`) and you describe exactly what data you need in a query language.

GraphQL shines when different clients need different slices of the same data. A mobile app might need just the user's name and avatar, while the admin dashboard needs their billing history and role. With REST, you either over-fetch (send everything to everyone) or build custom endpoints for each client. With GraphQL, each client writes its own query.

But the custom restaurant has a hidden cost. Every form has to be routed to the right section of the kitchen. If you order the salad, the chicken, and the chef's recommendation for each, the kitchen might end up making three separate trips to the pantry for ingredients that are all on the same shelf — that is the N+1 problem. And because every order is unique, the kitchen cannot pre-make popular dishes and keep them warm — caching is much harder.

There is no universal winner. REST is simpler, better cached, and better understood. GraphQL is more flexible and eliminates over-fetching. The right choice depends on how many different clients you have and how varied their data needs are.
:::

## ⚙️ Under the Hood

### GraphQL Mental Model

GraphQL has three core concepts:

1. **Schema (type system)** — defines the shape of your data and the operations available
2. **Resolvers** — functions that fetch the data for each field in the schema
3. **Single endpoint** — all queries and mutations go to `POST /graphql`

```ts
// Conceptual schema (SDL — Schema Definition Language)
// type User {
//   id: ID!
//   name: String!
//   email: String!
//   orders: [Order!]!    <-- each field can have its own resolver
// }
//
// type Order {
//   id: ID!
//   total: Float!
//   items: [OrderItem!]!
// }
//
// type Query {
//   user(id: ID!): User
//   users(first: Int, after: String): UserConnection!
// }
//
// type Mutation {
//   createUser(input: CreateUserInput!): User!
// }
```

The client sends a query specifying exactly which fields it wants:

```graphql
query {
  user(id: "42") {
    name
    orders {
      total
    }
  }
}
```

The server returns exactly those fields — nothing more, nothing less.

### When GraphQL Shines

| Scenario | Why GraphQL helps |
|----------|-------------------|
| Multiple clients (web, mobile, TV, third-party) | Each client queries for exactly the fields it needs — no over-fetching, no custom endpoints per client |
| BFF (Backend for Frontend) | GraphQL acts as a natural aggregation layer, composing data from multiple microservices |
| Rapidly evolving frontend | Adding a field to the schema does not require a new endpoint or API version |
| Deeply nested/related data | One query can traverse relationships (`user → orders → items → product`) without multiple HTTP round-trips |

### When REST Is Better

| Scenario | Why REST wins |
|----------|---------------|
| Simple CRUD with stable clients | REST's fixed structure is simpler to implement, document, and maintain |
| Public APIs | REST is universally understood; GraphQL requires client tooling and learning |
| CDN-heavy caching | GET requests with stable URLs are trivially cacheable; GraphQL POST requests are not (without persisted queries) |
| File uploads/downloads | REST handles multipart and streaming natively; GraphQL needs workarounds |
| Fewer moving parts | No schema, no resolvers, no query parser — just routes and handlers |

### The N+1 Problem

The N+1 problem is GraphQL's most infamous performance trap. It happens because resolvers execute independently for each field:

```ts
// run: node --experimental-strip-types n-plus-1-demo.ts

// Simulating what happens when GraphQL resolves a list of users with their orders

interface User { id: number; name: string }
interface Order { id: number; userId: number; total: number }

// Simulated database calls with logging
async function fetchUsers(): Promise<User[]> {
  console.log('DB QUERY: SELECT * FROM users');  // 1 query
  return [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
    { id: 3, name: 'Charlie' },
  ];
}

async function fetchOrdersByUserId(userId: number): Promise<Order[]> {
  console.log(`DB QUERY: SELECT * FROM orders WHERE user_id = ${userId}`);  // N queries
  return [{ id: userId * 10, userId, total: 99.99 }];
}

// GraphQL resolvers (conceptual):
// Query.users → fetchUsers()                     → 1 query
// User.orders → fetchOrdersByUserId(user.id)     → called once PER user
//
// For 3 users: 1 + 3 = 4 queries
// For 1000 users: 1 + 1000 = 1001 queries  ← N+1

// Execute the N+1 pattern
const users = await fetchUsers();
const usersWithOrders = await Promise.all(
  users.map(async (user) => ({
    ...user,
    orders: await fetchOrdersByUserId(user.id),
  })),
);
console.log(`Total queries: 1 + ${users.length} = ${1 + users.length}`);
```

### DataLoader — The Solution to N+1

DataLoader batches and deduplicates database calls within a single tick of the event loop:

```ts
// run: node --experimental-strip-types dataloader-demo.ts
// requires: npm install dataloader

import DataLoader from 'dataloader';

interface Order { id: number; userId: number; total: number }

// The batch function receives ALL keys collected in one tick
// and must return results in the SAME ORDER as the keys
async function batchFetchOrders(userIds: readonly number[]): Promise<Order[][]> {
  console.log(`DB QUERY: SELECT * FROM orders WHERE user_id IN (${userIds.join(',')})`);
  // ONE query instead of N

  // Simulate: return orders grouped by userId, in input order
  const ordersByUser = new Map<number, Order[]>();
  for (const id of userIds) {
    ordersByUser.set(id, [{ id: id * 10, userId: id, total: 99.99 }]);
  }

  // CRITICAL: return in the same order as input keys
  return userIds.map((id) => ordersByUser.get(id) ?? []);
}

// Create a loader — one per request (not shared across requests!)
const orderLoader = new DataLoader(batchFetchOrders);

// These three calls happen in the same tick:
const [aliceOrders, bobOrders, charlieOrders] = await Promise.all([
  orderLoader.load(1),   // Batched
  orderLoader.load(2),   // Batched
  orderLoader.load(3),   // Batched
]);
// Result: ONE query with IN (1,2,3) instead of three separate queries

// Deduplication: if the same key is requested twice, it's fetched once
const [a, b] = await Promise.all([
  orderLoader.load(1),
  orderLoader.load(1),  // Returns cached result from the same batch
]);
console.log(a === b);  // true — same reference

// IMPORTANT: create a new DataLoader per request
// DataLoader caches results for the lifetime of the instance
// Sharing across requests means stale data
```

**How DataLoader works internally:**
1. Each `.load(key)` call enqueues the key and returns a Promise
2. DataLoader schedules a microtask (via `process.nextTick`) to flush the queue
3. In the next microtask, all collected keys are passed to the batch function as a single array
4. The batch function's return array is mapped back to the individual promises

This ties directly to the [event loop microtask queue](/nodejs/module-02/02-nexttick-vs-queuemicrotask) — DataLoader exploits the fact that `Promise.all` schedules its callbacks synchronously, allowing all keys to be collected before the batch fires.

### GraphQL Over HTTP

```ts
// The standard transport:
// POST /graphql
// Content-Type: application/json
// Body: { "query": "...", "variables": { ... }, "operationName": "..." }

// GET is allowed for queries (not mutations) — enables CDN caching:
// GET /graphql?query={user(id:"42"){name}}&variables={}

// Persisted queries (for CDN caching and security):
// Instead of sending the full query text, send a hash:
// POST /graphql
// Body: { "extensions": { "persistedQuery": { "sha256Hash": "abc123..." } } }
// The server looks up the query by hash from a registry
```

### Schema-First vs Code-First

| Approach | Description | Pros | Cons |
|----------|-------------|------|------|
| **Schema-first** | Write `.graphql` SDL files, then implement resolvers to match | Schema is the contract; readable; language-agnostic | Types defined twice (SDL + TS); can drift |
| **Code-first** | Write TypeScript classes/decorators, schema is generated | Single source of truth; TS type safety | Schema less readable; tied to a framework |

NestJS `@nestjs/graphql` supports both. Code-first with decorators:

```ts
// NestJS code-first example (conceptual)
// requires: @nestjs/graphql @nestjs/apollo @apollo/server graphql

// @ObjectType()
// class User {
//   @Field(() => ID)
//   id!: string;
//
//   @Field()
//   name!: string;
//
//   @Field(() => [Order])
//   orders!: Order[];
// }
//
// @Resolver(() => User)
// class UserResolver {
//   @Query(() => User, { nullable: true })
//   async user(@Args('id', { type: () => ID }) id: string) {
//     return this.userService.findById(id);
//   }
//
//   @ResolveField(() => [Order])
//   async orders(
//     @Parent() user: User,
//     @Context('orderLoader') loader: DataLoader<string, Order[]>,
//   ) {
//     return loader.load(user.id);  // Batched via DataLoader
//   }
// }
```

### Security Concerns

GraphQL exposes a powerful query language to clients. Without limits, attackers can craft expensive queries:

```ts
// run: node --experimental-strip-types graphql-security.ts

// 1. Query depth limiting
// Prevents deeply nested queries that cause exponential resolver calls:
// query { user { friends { friends { friends { friends { ... } } } } } }
// Limit: reject queries deeper than N levels (typically 5-10)

// 2. Query complexity analysis
// Assign a cost to each field. Reject queries exceeding a total cost budget.
// Example costs:
// - Scalar field: 1
// - Object field: 2
// - List field: cost × estimated list size
// query { users(first: 100) { orders { items { ... } } } }
// Cost: 100 users × 10 orders × 5 items = 5000 — over budget

// 3. Disable introspection in production
// Introspection queries (__schema, __type) expose your entire API surface.
// In development: essential for tooling (GraphiQL, codegen).
// In production: disable unless you have a public API.

// Apollo Server example:
// new ApolloServer({
//   schema,
//   introspection: process.env.NODE_ENV !== 'production',
//   plugins: [
//     ApolloServerPluginLandingPageDisabled(),  // No playground in production
//   ],
// });

// 4. Rate limiting by query complexity, not just request count
// A simple GET /users costs 1 unit. A GraphQL query that fetches
// 1000 users with all their orders costs 10,000 units.
// Rate limit by estimated cost, not by number of HTTP requests.

// 5. Persisted queries (allowlist)
// In the strictest setup, only pre-registered queries are allowed.
// The client sends a hash; the server looks it up.
// Unknown queries are rejected — no arbitrary query execution.

console.log('GraphQL security: depth limiting, complexity analysis, no introspection in prod');
```

### Subscriptions vs SSE

GraphQL subscriptions provide real-time data via WebSockets (or SSE):

```
subscription {
  orderCreated(userId: "42") {
    id
    total
    status
  }
}
```

- **WebSocket subscriptions** (via `graphql-ws` protocol): bidirectional, complex setup, stateful connections
- **SSE (Server-Sent Events)**: simpler, HTTP-native, works through proxies and CDNs more easily, unidirectional

For most use cases — dashboards, notifications, live feeds — SSE is simpler and sufficient. Use WebSocket subscriptions when you need bidirectional communication or when your frontend framework (e.g., Apollo Client) expects it.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. N+1 queries without DataLoader.** A seemingly simple query like `{ users { orders { items } } }` generates 1 + N + N*M database queries. With 100 users averaging 5 orders each, that is 601 queries for one HTTP request. Latency spikes, database connection pool exhausts, and the API becomes unusable. DataLoader is not optional — it is required infrastructure for any GraphQL server touching a database.

**2. Malicious query depth.** Without depth limiting, an attacker sends `{ a { b { c { d { e { ... } } } } } }` nested 50 levels deep. Each level triggers resolvers that may fan out. The server consumes all available memory or CPU before it can respond. Unlike REST, where the server controls what it returns, GraphQL lets the client dictate the query shape. Always set depth and complexity limits.

**3. Introspection enabled in production.** The `__schema` query returns your entire type system — every type, every field, every argument. Attackers use this to map your API surface, discover hidden fields (like `isAdmin`), and craft targeted exploits. Disable introspection in production unless your API is intentionally public and documented.

**4. Shared DataLoader across requests.** DataLoader caches results for the lifetime of the instance. If you share one DataLoader across requests (instead of creating one per request), User A sees data cached from User B's request — a data leak. In NestJS, this means DataLoader instances should be REQUEST-scoped or created fresh in a per-request context.
:::

## 🎯 Checkpoint

::: details Question 1 — N+1 and DataLoader
**Q:** Explain the N+1 problem in GraphQL. How does DataLoader solve it, and what event loop mechanism does it rely on?

**A:** The N+1 problem occurs because GraphQL resolvers execute independently. When resolving a list of N parent objects, the child resolver runs N times — once per parent — each making its own database query. For `{ users { orders } }` with 100 users, that is 1 query for users + 100 queries for orders = 101 total.

DataLoader solves this by batching: instead of executing immediately, each `.load(key)` call enqueues the key and returns a Promise. DataLoader schedules a flush via `process.nextTick` (a microtask). By the time the microtask runs, all 100 user IDs have been collected. The batch function receives all 100 keys at once and executes a single `SELECT * FROM orders WHERE user_id IN (...)` query. The results are mapped back to the individual promises.

This relies on the event loop's microtask queue: all `.load()` calls from `Promise.all` resolve synchronously within the same tick, so they are all queued before the `nextTick` callback fires. If the resolvers were spread across different ticks (e.g., due to intermediate `await`s), batching would be less effective — DataLoader would fire multiple smaller batches instead of one large one.
:::

::: details Question 2 — When to choose REST
**Q:** Your team is building a public API for third-party developers. The API serves a single web client and a mobile app built by your team, plus an unknown number of external integrators. Should you use GraphQL or REST, and why?

**A:** REST is the better choice for the public-facing API. Reasons: (1) REST is universally understood — external developers can use curl, Postman, or any HTTP client without learning a query language. GraphQL requires client libraries, schema understanding, and query composition. (2) REST endpoints are individually cacheable at the CDN layer using standard HTTP caching (ETags, Cache-Control). GraphQL POST requests require persisted queries for caching, adding complexity. (3) REST has well-established rate limiting (per endpoint), while GraphQL rate limiting requires complexity analysis per query. (4) REST errors are tied to specific endpoints, making monitoring and debugging simpler.

For the internal web and mobile apps, you could layer a GraphQL BFF (Backend for Frontend) on top of the REST API. The BFF consumes the stable REST endpoints and exposes a flexible GraphQL schema that each client queries for exactly the fields it needs. This gives internal clients the flexibility of GraphQL without exposing its complexity to external integrators.
:::

## Key Mental Models

- **REST fixes the response shape; GraphQL lets the client choose.** This is the core trade-off. Fixed shapes are simpler to cache, monitor, and document. Flexible shapes eliminate over-fetching and reduce round-trips.
- **DataLoader is not optional.** Any GraphQL server that touches a database without DataLoader has an N+1 problem. Create one instance per request to avoid cross-request data leaks.
- **GraphQL shifts complexity from the API layer to the infrastructure layer.** You get simpler client code but need depth limiting, complexity analysis, persisted queries, and per-request DataLoader instances.
- **Caching is REST's superpower.** `GET /users/42` with an ETag is trivially cacheable by every layer of infrastructure. `POST /graphql` with an arbitrary query body is not.
- **Choose based on client diversity, not technology fashion.** One client with stable needs? REST. Five clients with different data requirements? GraphQL (or a GraphQL BFF over REST).

## Related

- [REST Best Practices](./01-rest-best-practices) — the conventions GraphQL replaces or complements
- [Promise Internals](/nodejs/module-03/01-promise-internals) — the microtask scheduling that DataLoader exploits
- [Async Iteration vs EventEmitter](/nodejs/module-03/04-async-iteration-vs-eventemitter) — push vs pull models relevant to subscriptions vs SSE
