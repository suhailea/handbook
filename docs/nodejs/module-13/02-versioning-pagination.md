---
title: "API Versioning & Pagination"
outline: deep
---

# API Versioning & Pagination

| Interview weight | Node version | Prerequisites |
|---|---|---|
| :fire::fire::fire: | All (examples target Node 22+) | [REST Best Practices](./01-rest-best-practices) |

## 🗣️ In Plain English

::: tip In Plain English
Imagine you run a newspaper. Every morning, thousands of readers expect the paper to look the same — same sections, same layout. One day you decide to redesign the sports section. You cannot just change it overnight — readers who depend on the old layout would be lost. So you run both versions for a while: the old sports section in the regular paper, the new one in a special edition. You announce when the old one will stop. That is API versioning.

Now imagine a reader asks for "all the articles you have ever published." You cannot dump ten million articles on their doorstep. Instead, you hand them a stack of twenty articles and a bookmark. When they want more, they bring the bookmark back and you give them the next twenty, starting from exactly where they left off. That is cursor-based pagination.

There is a simpler approach — the reader says "give me page 7" — but it has a nasty problem. If new articles are published while they are reading, the pages shift. Article number 140 that was on page 7 is now on page 8, so they either see it twice or miss it entirely. Worse, figuring out where page 7 starts requires the database to count through all preceding articles, which gets slower and slower as the total grows.

The bookmark approach avoids both problems. It says "give me everything after this specific article," which the database can answer instantly using an index, and new articles at the top do not shift the position of older ones. The trade-off is that you cannot jump to "page 47" directly — you can only move forward (or backward) from where you are.
:::

## ⚙️ Under the Hood

### Versioning Strategies

| Strategy | URL example | Header example | Trade-offs |
|----------|-------------|----------------|------------|
| **URL path** | `GET /v2/users` | n/a | Most common. Obvious, easy to route, CDN-friendly. Downside: every version is a "different resource" semantically, and you may end up maintaining parallel route trees. |
| **Custom header** | `GET /users` | `Accept-Version: 2` | Clean URLs, same resource identity. Harder to test (curl needs `-H`), CDNs need custom vary rules, invisible in browser. |
| **Accept header (media type)** | `GET /users` | `Accept: application/vnd.myapi.v2+json` | Purest REST — the version is the representation format. Complex to implement and parse. GitHub uses this approach. |
| **Query param** | `GET /users?version=2` | n/a | Easy to bolt on. Pollutes the query string, awkward caching. Rarely recommended. |

**Recommendation:** use URL path versioning (`/v1/`, `/v2/`) unless you have a strong reason not to. It is the most widely understood, easiest to debug, and works with every tool out of the box.

### When to Version

Only version on **breaking changes**:
- Removing or renaming a field
- Changing a field's type (string to number)
- Changing the meaning of a status code or error format
- Removing an endpoint

**Not breaking** (no new version needed):
- Adding a new field to a response
- Adding a new optional query parameter
- Adding a new endpoint
- Adding a new enum value (if clients handle unknown values gracefully)

### Deprecation Workflow

```ts
// run: node --experimental-strip-types deprecation-headers.ts

import { createServer } from 'node:http';

const server = createServer((req, res) => {
  if (req.url?.startsWith('/v1/')) {
    // Signal that v1 is deprecated and when it will be removed
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', 'Sat, 01 Mar 2027 00:00:00 GMT');
    res.setHeader('Link', '</v2/users>; rel="successor-version"');
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ id: 1, name: 'Alice' }));
});

server.listen(3000);
```

The `Sunset` header (RFC 8594) tells clients when the endpoint will stop working. The `Link` header with `rel="successor-version"` points them to the replacement.

### Offset-Based Pagination

```ts
// run: node --experimental-strip-types offset-pagination.ts

// The simple approach: OFFSET + LIMIT
// SQL: SELECT * FROM users ORDER BY id LIMIT 20 OFFSET 40

interface OffsetPage<T> {
  data: T[];
  meta: {
    total: number;   // Total count of all records
    page: number;    // Current page number
    perPage: number; // Items per page
    totalPages: number;
  };
}

function buildOffsetResponse<T>(
  data: T[],
  total: number,
  page: number,
  perPage: number,
): OffsetPage<T> {
  return {
    data,
    meta: {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    },
  };
}

// Problems with offset pagination at scale:
// 1. COUNT(*) is expensive on large tables (full table scan in PostgreSQL)
// 2. OFFSET N scans and discards N rows — page 10,000 is very slow
// 3. Phantom reads: if a row is inserted before the current offset,
//    the next page contains a duplicate; if deleted, a row is skipped
```

### Cursor-Based (Keyset) Pagination

```ts
// run: node --experimental-strip-types cursor-pagination.ts

// SQL: SELECT * FROM users WHERE id > :cursor ORDER BY id ASC LIMIT 20
// The cursor is the last seen value of the sort column (usually the PK)

interface CursorPage<T> {
  data: T[];
  meta: {
    nextCursor: string | null;  // null means no more pages
    hasMore: boolean;
  };
}

// Encode the cursor as base64 to make it opaque to the client
function encodeCursor(value: string | number): string {
  return Buffer.from(String(value)).toString('base64url');
}

function decodeCursor(cursor: string): string {
  return Buffer.from(cursor, 'base64url').toString('utf-8');
}

// Example: building cursor pagination for a users list sorted by id
interface User {
  id: number;
  name: string;
  createdAt: Date;
}

function buildCursorResponse(users: User[], limit: number): CursorPage<User> {
  const hasMore = users.length > limit;
  const data = hasMore ? users.slice(0, limit) : users;
  const lastItem = data.at(-1);

  return {
    data,
    meta: {
      nextCursor: lastItem ? encodeCursor(lastItem.id) : null,
      hasMore,
    },
  };
}

// Key insight: fetch limit + 1 rows. If you get limit + 1 back,
// there are more pages. Return only `limit` rows to the client.
// This avoids a separate COUNT query entirely.
```

### Multi-Column Cursor Pagination

When sorting by a non-unique column (e.g., `created_at`), you need a compound cursor to break ties:

```ts
// run: node --experimental-strip-types compound-cursor.ts

// SQL for sorting by created_at DESC with id as tiebreaker:
// SELECT * FROM users
// WHERE (created_at, id) < (:cursor_date, :cursor_id)
// ORDER BY created_at DESC, id DESC
// LIMIT 21

interface CompoundCursor {
  createdAt: string;  // ISO date string
  id: number;
}

function encodeCompoundCursor(cursor: CompoundCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCompoundCursor(encoded: string): CompoundCursor {
  return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8'));
}

// The WHERE clause uses row-value comparison (PostgreSQL supports this):
// WHERE (created_at, id) < ($1, $2)
// This is equivalent to:
// WHERE created_at < $1 OR (created_at = $1 AND id < $2)
// Both use the composite index (created_at DESC, id DESC) efficiently.
```

### Relay-Style Cursor Pagination

The Relay specification (common in GraphQL but usable in REST) standardizes the cursor format:

```ts
// run: node --experimental-strip-types relay-pagination.ts

interface Edge<T> {
  node: T;
  cursor: string;  // Opaque cursor for this specific node
}

interface PageInfo {
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  startCursor: string | null;
  endCursor: string | null;
}

interface Connection<T> {
  edges: Edge<T>[];
  pageInfo: PageInfo;
  totalCount?: number;  // Optional — expensive to compute
}

// Request: GET /users?first=20&after=abc123
// Response:
// {
//   "edges": [
//     { "node": { "id": 21, "name": "Alice" }, "cursor": "..." },
//     { "node": { "id": 22, "name": "Bob" }, "cursor": "..." }
//   ],
//   "pageInfo": {
//     "hasNextPage": true,
//     "hasPreviousPage": true,
//     "startCursor": "...",
//     "endCursor": "..."
//   }
// }

// Parameters:
// first/after  — forward pagination (first N items after this cursor)
// last/before  — backward pagination (last N items before this cursor)
```

### Total Count Alternatives

Exact `COUNT(*)` is expensive on large PostgreSQL tables (requires a sequential scan due to MVCC). Alternatives:

```ts
// 1. Skip total count — just return hasMore
// Most UIs only need "Load More" or infinite scroll anyway

// 2. Estimated count from PostgreSQL statistics
// SELECT reltuples::bigint FROM pg_class WHERE relname = 'users';
// Fast but approximate — updated by ANALYZE, can be stale

// 3. Cache the count with a short TTL
// Acceptable when the exact number does not matter (e.g., "~12,400 results")

// 4. Count up to a cap
// SELECT COUNT(*) FROM (SELECT 1 FROM users LIMIT 10001) t;
// Returns exact count up to 10,000, then shows "10,000+"
```

### Sorting and Filtering Patterns

```
GET /users?sort=created_at:desc,name:asc&filter[status]=active&filter[role]=admin
```

Parse into structured query parameters:

```ts
// run: node --experimental-strip-types sort-filter.ts

interface SortField {
  field: string;
  direction: 'asc' | 'desc';
}

interface QueryParams {
  sort: SortField[];
  filters: Record<string, string>;
  cursor?: string;
  limit: number;
}

const ALLOWED_SORT_FIELDS = new Set(['created_at', 'name', 'email']);
const ALLOWED_FILTER_FIELDS = new Set(['status', 'role', 'created_after']);
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

function parseQueryParams(url: URL): QueryParams {
  // Parse sort: "created_at:desc,name:asc"
  const sortParam = url.searchParams.get('sort') ?? 'created_at:desc';
  const sort = sortParam.split(',').map((s) => {
    const [field, dir] = s.split(':');
    if (!ALLOWED_SORT_FIELDS.has(field)) {
      throw new Error(`Invalid sort field: ${field}`);
    }
    return {
      field,
      direction: (dir === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc',
    };
  });

  // Parse filters: "filter[status]=active&filter[role]=admin"
  const filters: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    const match = key.match(/^filter\[(\w+)]$/);
    if (match) {
      const filterField = match[1];
      if (!ALLOWED_FILTER_FIELDS.has(filterField)) {
        throw new Error(`Invalid filter field: ${filterField}`);
      }
      filters[filterField] = value;
    }
  }

  // Parse limit with bounds
  const rawLimit = Number(url.searchParams.get('limit') ?? DEFAULT_LIMIT);
  const limit = Math.min(Math.max(1, rawLimit), MAX_LIMIT);

  return {
    sort,
    filters,
    cursor: url.searchParams.get('after') ?? undefined,
    limit,
  };
}

// Critical: ALWAYS whitelist sort and filter fields.
// Allowing arbitrary column names enables SQL injection even with
// parameterized queries (column names cannot be parameterized).
```

### Deep Pagination Protection

```ts
// Offset-based: enforce a maximum offset
const MAX_OFFSET = 10_000;

function validateOffset(offset: number): void {
  if (offset > MAX_OFFSET) {
    throw Object.assign(new Error(
      `Offset cannot exceed ${MAX_OFFSET}. Use cursor-based pagination for deep result sets.`
    ), { status: 400 });
  }
}

// Even with cursor pagination, enforce a max page size
// to prevent clients from requesting limit=1000000
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Offset pagination on a million-row table.** A client requests `?page=50000&perPage=20`. PostgreSQL executes `OFFSET 999980` which means it scans and discards 999,980 rows before returning 20. The query takes 8 seconds, the connection pool fills up, and your API times out for everyone. The fix: cursor-based pagination with an indexed sort column, plus a hard cap on offset if you must support offset pagination.

**2. Phantom reads with offset pagination.** A user browses page 1, then page 2. Between the two requests, a new record is inserted at the top. The item that was last on page 1 shifts to position 21 and appears again as the first item on page 2. For financial transaction lists or audit logs, this is a compliance risk — the user thinks they saw everything but either missed a record or double-processed one.

**3. Breaking API changes without versioning.** You rename a response field from `userName` to `name`. Every client that reads `userName` breaks silently (the field is `undefined` and the app shows "Hello undefined" or crashes). Without versioning, your only options are: ship a backwards-compatible change (keep both fields), or coordinate a simultaneous release with every consumer — which is impossible with public APIs and unreliable even internally.

**4. Forgetting to whitelist sort/filter fields.** A sort parameter like `?sort=password:asc` could leak information through ordering, even without returning the field. A filter like `?filter[is_admin]=true` on an endpoint that should not expose this field is an authorization bypass. Always validate against an explicit allowlist of sortable/filterable fields.
:::

## 🎯 Checkpoint

::: details Question 1 — Cursor vs offset
**Q:** You have a table with 50 million rows. A client requests the 100,000th page of results using offset pagination (`?page=100000&perPage=20`). Explain what happens at the database level and how cursor pagination solves it.

**A:** With offset pagination, the database executes `SELECT * FROM t ORDER BY id LIMIT 20 OFFSET 1999980`. Even with an index on `id`, the database must traverse the B-tree index to find row 1,999,981, scanning past (or skipping) 1,999,980 entries. In PostgreSQL, the planner may switch to a sequential scan if the offset is large enough that the index lookup cost exceeds a full table scan. The query could take tens of seconds.

With cursor pagination (`WHERE id > :last_seen_id ORDER BY id LIMIT 20`), the database performs a single index seek to the cursor value and reads exactly 20 rows forward. This is O(log N + limit) regardless of how deep into the dataset you are. The trade-off is that the client cannot jump to an arbitrary page — it must paginate sequentially. For most UI patterns (infinite scroll, "Load More"), this is not a limitation. For admin panels that need page jumping, provide a search/filter to narrow results rather than deep offset pagination.
:::

::: details Question 2 — Compound cursors
**Q:** You are paginating users sorted by `created_at DESC`. Two users were created at the exact same timestamp. How does cursor pagination handle this, and what goes wrong if your cursor only contains `created_at`?

**A:** If the cursor only contains `created_at`, the `WHERE created_at < :cursor` clause skips both records that share the timestamp — you either get duplicates or miss records. The fix is a compound cursor that includes a unique tiebreaker, typically the primary key: `WHERE (created_at, id) < (:cursor_date, :cursor_id) ORDER BY created_at DESC, id DESC`. This row-value comparison uses the composite index efficiently. The cursor encodes both values (e.g., as a base64-encoded JSON object). PostgreSQL supports tuple comparison natively, which maps directly to a composite B-tree index scan.
:::

::: details Question 3 — Sunset header
**Q:** What is the Sunset header, and how does it differ from the Deprecation header?

**A:** The `Deprecation` header (proposed RFC) signals that an endpoint is deprecated — it still works, but clients should migrate. The `Sunset` header (RFC 8594) specifies the exact date and time when the endpoint will stop working. They serve different purposes and are used together: `Deprecation: true` tells the client "start migrating," while `Sunset: Sat, 01 Mar 2027 00:00:00 GMT` tells them the deadline. A well-behaved client (or API gateway) can parse the Sunset date and trigger alerts when it approaches. After the sunset date, the server should return 410 Gone.
:::

## Key Mental Models

- **Cursor pagination is O(log N + limit); offset pagination is O(N + limit).** For any dataset that could grow large, cursor wins. The trade-off is sequential-only access.
- **The cursor is opaque to the client.** Encode it (base64) so clients cannot depend on its structure. You can change the cursor format without breaking clients.
- **Version on breaking changes only.** Adding fields is not breaking. Removing, renaming, or changing types is. If you version too eagerly, you drown in maintenance.
- **Whitelist sort and filter fields explicitly.** Allowing arbitrary field names is an information-disclosure and injection vector even with parameterized queries.
- **Total count is a feature with a cost.** Question whether you need it before paying for `COUNT(*)` on every paginated request.

## Related

- [REST Best Practices](./01-rest-best-practices) — the conventions that pagination builds on
- [Request Validation & Error Handling](./03-validation-error-handling) — validating pagination parameters
