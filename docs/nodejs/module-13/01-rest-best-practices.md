---
title: "REST API Best Practices"
outline: deep
---

# REST API Best Practices

| Interview weight | Node version | Prerequisites |
|---|---|---|
| :fire::fire::fire: | All (examples target Node 22+) | [HTTP, Keep-Alive & Pooling](/nodejs/module-05/02-http-keep-alive), [Error Doctrine](/nodejs/module-03/06-error-doctrine) |

## 🗣️ In Plain English

::: tip In Plain English
Think of a REST API as a well-organized library. Every book (resource) has a shelf (URL path), and the library has strict rules about how you interact with it. You do not shout the title of a book you want — you walk to the right shelf, pull the book, and bring it to the desk.

The shelf labels are always nouns, never verbs. You do not have a shelf called "get-books" — you have a shelf called "books," and the action you take (browsing, adding, replacing, removing) is determined by *how* you approach it, not *where* you go. In HTTP terms, the URL is the noun and the method (GET, POST, PUT, DELETE) is the verb.

When something goes wrong, the library does not just say "error." It gives you a specific slip: "Book not found on this shelf" (404), "You need a library card first" (401), "That book is checked out and conflicts with your hold" (409). Each slip follows the same format so you always know where to look for the details.

A good library also helps you avoid wasted trips. If you fetched a catalog yesterday and nothing has changed, the librarian hands you a small tag (an ETag). Next time you visit, you show the tag. If the catalog is unchanged, the librarian says "nothing new" and saves you the time of reading it again. If someone else has updated the catalog since your last visit and you try to make changes based on your stale copy, the librarian stops you: "Someone else already changed this — check the latest version first." That is optimistic concurrency.

The rules are simple individually, but following them consistently is what separates APIs that developers love from APIs that developers dread.
:::

## ⚙️ Under the Hood

### Resource Naming

Resources are plural nouns in kebab-case. Nest sub-resources under their parent:

```
GET    /users
GET    /users/42
GET    /users/42/orders
POST   /users/42/orders
GET    /users/42/orders/7
DELETE /users/42/orders/7
```

Avoid verbs in URLs. Instead of `POST /users/42/activate`, prefer `PATCH /users/42` with `{ "status": "active" }` — or, if the action genuinely does not map to a resource update, use a "controller" resource: `POST /users/42/activations`.

### HTTP Methods and Their Semantics

| Method | Semantics | Idempotent | Safe | Has Body (request) | Has Body (response) |
|--------|-----------|------------|------|---------------------|---------------------|
| `GET` | Read a resource | Yes | Yes | No | Yes |
| `POST` | Create a new resource / trigger action | **No** | No | Yes | Yes |
| `PUT` | Replace a resource entirely | Yes | No | Yes | Yes |
| `PATCH` | Partial update | **No** (spec) / Yes (in practice when deterministic) | No | Yes | Yes |
| `DELETE` | Remove a resource | Yes | No | Rarely | Optional |

**Idempotent** means repeating the same request produces the same server state. `PUT /users/42 { name: "Alice" }` applied twice still results in the name being "Alice." `POST /orders` applied twice creates two orders.

### Status Codes That Matter

```ts
// run: node --experimental-strip-types status-demo.ts

import { createServer, IncomingMessage, ServerResponse } from 'node:http';

const STATUS = {
  // Success
  OK:         200,  // GET succeeded, body contains resource
  CREATED:    201,  // POST succeeded, resource created — return Location header
  NO_CONTENT: 204,  // DELETE succeeded, no body to return

  // Client errors
  BAD_REQUEST:          400,  // Malformed syntax, invalid JSON
  UNAUTHORIZED:         401,  // Missing or invalid credentials (should be "unauthenticated")
  FORBIDDEN:            403,  // Authenticated but not allowed
  NOT_FOUND:            404,  // Resource does not exist
  CONFLICT:             409,  // State conflict (duplicate email, version mismatch)
  UNPROCESSABLE_ENTITY: 422,  // Valid syntax but semantic errors (validation failures)
  TOO_MANY_REQUESTS:    429,  // Rate limited — include Retry-After header

  // Server errors
  INTERNAL_SERVER_ERROR: 500,  // Bug, unexpected crash
  SERVICE_UNAVAILABLE:   503,  // Overloaded / maintenance — include Retry-After
} as const;

// 400 vs 422: use 400 for "I cannot parse what you sent" (malformed JSON),
// 422 for "I understand the structure but the values are wrong" (email invalid).
// Many APIs use 400 for both — pick one convention and stick with it.
```

### Error Response Format — RFC 7807 Problem Details

Rather than inventing your own error shape, use the RFC 7807 standard. It gives every consumer a predictable structure:

```ts
// run: node --experimental-strip-types problem-details.ts

interface ProblemDetails {
  type: string;        // URI identifying the error type (acts as error code)
  title: string;       // Short human-readable summary
  status: number;      // HTTP status code (duplicated for convenience)
  detail?: string;     // Longer human-readable explanation for this specific occurrence
  instance?: string;   // URI identifying this specific occurrence (e.g., request ID)
  // Extensions — add your own fields:
  errors?: FieldError[];  // Per-field validation errors
}

interface FieldError {
  field: string;
  message: string;
  code: string;
}

function problemResponse(
  res: import('node:http').ServerResponse,
  problem: ProblemDetails,
): void {
  res.writeHead(problem.status, {
    'Content-Type': 'application/problem+json',
  });
  res.end(JSON.stringify(problem));
}

// Usage:
// problemResponse(res, {
//   type: 'https://api.example.com/errors/validation',
//   title: 'Validation Failed',
//   status: 422,
//   detail: 'The request body contains invalid fields.',
//   instance: `/errors/${requestId}`,
//   errors: [
//     { field: 'email', message: 'Must be a valid email', code: 'INVALID_EMAIL' },
//   ],
// });
```

The `Content-Type` header **must** be `application/problem+json`. Clients can check this to know they are receiving a structured error, not a generic JSON blob.

### ETags and Conditional Requests

ETags enable two things: **cache validation** (avoid re-transferring unchanged data) and **optimistic concurrency** (prevent lost updates).

```ts
// run: node --experimental-strip-types etag-demo.ts

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

interface User {
  id: number;
  name: string;
  version: number;
}

const users = new Map<number, User>([
  [1, { id: 1, name: 'Alice', version: 1 }],
]);

function computeETag(data: unknown): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .slice(0, 16);
  return `"${hash}"`;  // ETags must be quoted strings
}

const server = createServer((req, res) => {
  const user = users.get(1)!;

  if (req.method === 'GET') {
    const etag = computeETag(user);

    // Cache validation: If-None-Match
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);  // Not Modified — no body needed
      res.end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag });
    res.end(JSON.stringify(user));
    return;
  }

  if (req.method === 'PUT') {
    // Optimistic concurrency: If-Match
    const currentETag = computeETag(user);
    const clientETag = req.headers['if-match'];

    if (clientETag && clientETag !== currentETag) {
      res.writeHead(409, { 'Content-Type': 'application/problem+json' });
      res.end(JSON.stringify({
        type: 'https://api.example.com/errors/conflict',
        title: 'Conflict',
        status: 409,
        detail: 'Resource has been modified since your last read. Re-fetch and retry.',
      }));
      return;
    }

    // ... apply update, bump version, respond with new ETag
  }
});

server.listen(3000);
```

### Content Negotiation and Versioning

Two main versioning approaches, each with trade-offs:

| Strategy | Example | Pros | Cons |
|----------|---------|------|------|
| URL path | `/v1/users` | Visible, easy to route, cache-friendly | URL changes on version bump; hard to share links across versions |
| Header | `Accept: application/vnd.api.v2+json` or `Accept-Version: 2` | Clean URLs, same resource identity | Invisible in browser, harder to test with curl, CDN config more complex |
| Query param | `/users?version=2` | Easy to add | Pollutes query string, caching complications |

Most production APIs use **URL path versioning** because it is unambiguous, works with every HTTP client, and CDNs cache it without custom rules. Version when you make breaking changes only — adding a field is not breaking; removing or renaming one is.

### Rate Limit Headers

Include these headers so clients can self-throttle instead of hammering your API and getting 429s:

```
X-RateLimit-Limit: 100        # Max requests per window
X-RateLimit-Remaining: 42     # Requests left in current window
X-RateLimit-Reset: 1720000000 # Unix timestamp when the window resets
Retry-After: 30               # Seconds to wait (on 429 responses)
```

The emerging standard uses `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (without the `X-` prefix), per the IETF draft RFC.

### Request ID Propagation

Every request should carry a unique ID for tracing. Generate one if the client does not send it; echo it back in the response:

```ts
// run: node --experimental-strip-types request-id.ts

import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();

  // Store in response headers for client correlation
  res.setHeader('X-Request-Id', requestId);

  // Use in all log lines for this request
  console.log(JSON.stringify({
    requestId,
    method: req.method,
    url: req.url,
    timestamp: new Date().toISOString(),
  }));

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});

server.listen(3000);
```

Tie this to [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage) so the request ID is available in every function without threading it as a parameter.

### HATEOAS

HATEOAS (Hypermedia As The Engine Of Application State) means your API responses include links to related actions:

```json
{
  "id": 42,
  "name": "Alice",
  "links": {
    "self": "/users/42",
    "orders": "/users/42/orders",
    "deactivate": "/users/42/deactivation"
  }
}
```

In theory, the client discovers available actions at runtime instead of hardcoding URLs. In practice, almost no one implements it fully — frontend clients already know the API contract from OpenAPI specs or SDK generation. It is worth knowing for interviews and for understanding REST's original academic definition (Roy Fielding's dissertation), but do not feel guilty about skipping it in your API.

### Partial Responses and Bulk Operations

**Field selection** reduces payload size when clients only need specific fields:

```
GET /users/42?fields=id,name,email
```

Implement by projecting the response object before serialization. In databases, push this down to the query level (`SELECT id, name, email` instead of `SELECT *`).

**Bulk operations** avoid chatty N+1 HTTP round-trips:

```ts
// Option 1: Batch endpoint
// POST /users/batch
// Body: [{ name: "Alice" }, { name: "Bob" }]
// Response: [{ id: 1, name: "Alice" }, { id: 2, name: "Bob" }]

// Option 2: Bulk action with mixed operations (more complex)
// POST /batch
// Body: [
//   { method: "POST", path: "/users", body: { name: "Alice" } },
//   { method: "DELETE", path: "/users/99" }
// ]
// Response: [ { status: 201, body: {...} }, { status: 204 } ]
```

Option 1 is simpler and covers 90% of use cases. Option 2 (Google-style batch) is powerful but adds significant complexity — you are essentially building an HTTP server inside your HTTP server.

### OpenAPI / Swagger

Document your API with an OpenAPI 3.1 spec. The spec serves as the single source of truth for:
- Client SDK generation (openapi-generator, orval)
- Request/response validation middleware
- Interactive documentation (Swagger UI, Redoc)
- Contract testing between teams

In NestJS, `@nestjs/swagger` generates the spec from decorators automatically. In Express, write the spec manually or use `tsoa` to generate it from TypeScript types.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Inconsistent error formats across endpoints.** One endpoint returns `{ error: "Not found" }`, another returns `{ message: "Not found", code: 404 }`, a third returns a plain string. Every frontend developer writes a different error parser. Fix: adopt RFC 7807 in a global error handler and enforce it from day one.

**2. Missing or wrong status codes.** Returning 200 for everything and embedding the real status in the body (`{ status: "error", code: 404 }`) breaks HTTP caching, CDN behavior, monitoring dashboards, and every HTTP client's error-handling flow. Returning 500 for validation errors triggers PagerDuty alerts for non-bugs.

**3. Lost updates from missing optimistic concurrency.** Two admins open the same user profile, both edit different fields, both save. The second save silently overwrites the first admin's changes. Without ETags and `If-Match`, you will not detect this until a customer complains that their data reverted. This is especially dangerous in admin panels and CMS systems.

**4. No request ID in production logs.** A user reports "I got an error." Without a request ID, you grep logs by timestamp, user ID, and prayer. With a request ID echoed in the error response, the user (or your frontend error tracker) can hand you the exact string, and you find the full trace in seconds.
:::

## 🎯 Checkpoint

::: details Question 1 — Idempotency semantics
**Q:** A client sends `PUT /users/42 { name: "Alice" }` twice due to a network retry. Then it sends `POST /orders { item: "Widget" }` twice for the same reason. What is the difference in outcome, and how would you make the POST idempotent?

**A:** The PUT is idempotent by definition — both requests set the user's name to "Alice," resulting in the same server state regardless of how many times it is applied. The POST is not idempotent — each request creates a new order, resulting in two orders for the same widget. To make POST idempotent, use an **idempotency key**: the client sends a unique key in a header (e.g., `Idempotency-Key: abc-123`). The server stores this key alongside the response. If it sees the same key again, it returns the stored response instead of creating a new resource. Stripe popularized this pattern. The key should be stored with a TTL (e.g., 24 hours) to avoid unbounded storage.
:::

::: details Question 2 — 400 vs 422
**Q:** When should you return 400 Bad Request versus 422 Unprocessable Entity?

**A:** 400 means the request is syntactically malformed — the server cannot parse it at all. Examples: invalid JSON (`{ name: "Alice" ` — missing closing brace), wrong Content-Type, missing required headers. 422 means the request is syntactically valid (it parses as JSON, matches the expected structure) but semantically wrong — the values fail business validation. Examples: email field contains "not-an-email," age is -5, referenced foreign key does not exist. In practice, many APIs (including GitHub's) use 400 for both. The important thing is consistency within your API. If you distinguish them, 400 means "I could not understand you" and 422 means "I understood you but cannot do what you asked."
:::

::: details Question 3 — ETag-based optimistic concurrency
**Q:** Explain the full request flow for optimistic concurrency using ETags. What happens when there is a conflict?

**A:** (1) Client GETs the resource. The response includes an `ETag` header (e.g., `"a1b2c3"`), which is a fingerprint of the resource's current state — typically a hash of the body or a version counter. (2) Client sends `PUT /resource` with `If-Match: "a1b2c3"` header. (3) Server computes the current ETag of the resource. If it matches `"a1b2c3"`, no one else has modified it — the server applies the update and returns 200 with the new ETag. (4) If the current ETag does not match (another client modified the resource between the GET and PUT), the server returns 409 Conflict (or 412 Precondition Failed, per the HTTP spec — 412 is more correct, 409 is more commonly used for this). The client must re-fetch, re-apply its changes on top of the new state, and retry. This prevents lost updates without pessimistic locking.
:::

## Key Mental Models

- **URLs are nouns, methods are verbs.** The resource identity lives in the path; the action lives in the HTTP method. This separation is what makes REST caching, routing, and tooling work.
- **Status codes are a contract with the infrastructure.** CDNs, load balancers, monitoring, and client HTTP libraries all key off status codes. Returning 200 for errors breaks everything downstream.
- **RFC 7807 is your error format until you have a better reason.** A standard, typed error format means every consumer parses errors the same way. Do not invent your own shape.
- **ETags are cheap insurance against lost updates.** The cost of computing a hash is negligible compared to the cost of silently overwriting another user's changes.
- **Request IDs are the thread that connects distributed logs.** Generate one per request, propagate it through every service call, and return it to the client.

## Related

- [API Versioning & Pagination](./02-versioning-pagination) — versioning strategies and pagination patterns
- [Request Validation & Error Handling](./03-validation-error-handling) — implementing validation and error responses
- [HTTP, Keep-Alive & Pooling](/nodejs/module-05/02-http-keep-alive) — the transport layer underneath your API
- [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage) — request-scoped context for request ID propagation
- [Error Doctrine](/nodejs/module-03/06-error-doctrine) — operational vs programmer errors at the runtime level
