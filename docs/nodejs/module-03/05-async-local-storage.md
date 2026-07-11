---
title: "AsyncLocalStorage & async_hooks"
outline: deep
---

# AsyncLocalStorage & async_hooks

| Interview weight | Node version | Prerequisites |
|---|---|---|
| :fire::fire::fire: Critical for production Node.js | `AsyncLocalStorage` stable since Node 16; `async_hooks` since Node 8 | [Event Loop](/js-core/04-event-loop), [Promise Internals](./01-promise-internals) |

## :speaking_head: In Plain English

::: tip In Plain English
Imagine a hospital where multiple patients are being treated simultaneously by the same team of doctors. Each patient has a clipboard that follows them everywhere — from reception to X-ray to the operating room. Any doctor who picks up that patient at the next station can glance at the clipboard and instantly know their allergies, blood type, and history. The clipboard is not attached to a specific doctor (they handle many patients). It is attached to the *patient's journey* through the hospital.

Now translate that to a Node.js server. Your server handles hundreds of requests on a single thread. When a request arrives, it carries data — a user ID, a correlation ID for logging, a tenant identifier. That request bounces through middleware, database calls, queue publishes, and file writes. Each of those steps is an asynchronous operation. Without a clipboard, every function in the chain would need an extra argument: "here is the context for this request." That pollutes every function signature in your codebase, couples unrelated layers together, and makes refactoring painful.

`AsyncLocalStorage` is the clipboard. You attach data to a request at the front door (`als.run()`), and any code that executes inside that async chain can read the clipboard (`als.getStore()`) without it being passed explicitly. When the request finishes, the clipboard is discarded. Other concurrent requests each carry their own clipboard, completely isolated.

Under the hood, Node tracks every asynchronous operation with a unique ID and a pointer to the operation that created it. `AsyncLocalStorage` piggybacks on this tracking to propagate your clipboard from parent to child across `await` boundaries, timers, I/O callbacks, and promise chains. It is the standard mechanism behind OpenTelemetry trace propagation, structured logging with request correlation IDs, and tenant-scoped data in multi-tenant applications.

If you have ever used Java's `ThreadLocal`, `AsyncLocalStorage` solves the same problem but for an async, single-threaded runtime where "thread-per-request" does not apply.
:::

## :gear: Under the Hood

### The problem: concurrent requests, shared thread

In a traditional thread-per-request model (Java, .NET), each request runs in its own thread. You can store request-scoped data in a `ThreadLocal`. In Node.js, all requests share one thread. You need a different mechanism to scope data to an async call chain.

### `AsyncLocalStorage` API

```typescript
// run: node --experimental-strip-types als-basics.ts
import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  requestId: string;
  userId: string;
  tenantId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

// Simulate an incoming request
function handleRequest(requestId: string, userId: string, tenantId: string): void {
  const ctx: RequestContext = { requestId, userId, tenantId };

  als.run(ctx, async () => {
    console.log("1. handler:", als.getStore()?.requestId);

    await queryDatabase();
    await publishEvent();

    console.log("4. handler done:", als.getStore()?.requestId);
  });
}

async function queryDatabase(): Promise<void> {
  // No context argument needed — read it from ALS
  const ctx = als.getStore();
  console.log("2. queryDatabase for tenant:", ctx?.tenantId);
}

async function publishEvent(): Promise<void> {
  const ctx = als.getStore();
  console.log("3. publishEvent, correlationId:", ctx?.requestId);
}

// Two concurrent requests — each sees its own context
handleRequest("req-001", "user-42", "acme");
handleRequest("req-002", "user-99", "globex");
```

**Output (order between requests may interleave, but each sees its own context):**
```
1. handler: req-001
1. handler: req-002
2. queryDatabase for tenant: acme
2. queryDatabase for tenant: globex
3. publishEvent, correlationId: req-001
3. publishEvent, correlationId: req-002
4. handler done: req-001
4. handler done: req-002
```

### Core API surface

| Method | Description |
|---|---|
| `new AsyncLocalStorage<T>()` | Create a new store instance |
| `als.run(store, callback, ...args)` | Execute `callback` with `store` as the active context. Returns `callback`'s return value. |
| `als.getStore()` | Retrieve the current store. Returns `undefined` if called outside any `run()`. |
| `als.enterWith(store)` | Sets `store` for the remainder of the current async context. **Dangerous** — does not scope to a callback, easy to leak. Prefer `run()`. |
| `als.disable()` | Disables the store and clears context for all subsequent operations. Rarely used. |

### `enterWith` vs `run`

```typescript
// run: node --experimental-strip-types enter-with-danger.ts
import { AsyncLocalStorage } from "node:async_hooks";

const als = new AsyncLocalStorage<string>();

// SAFE: run() scopes the store to the callback
als.run("scoped-value", () => {
  console.log("inside run:", als.getStore()); // "scoped-value"
});
console.log("after run:", als.getStore()); // undefined — clean

// DANGEROUS: enterWith sets the store for the rest of this async context
async function dangerousExample(): Promise<void> {
  als.enterWith("leaked-value");
  console.log("after enterWith:", als.getStore()); // "leaked-value"
  await new Promise((r) => setTimeout(r, 10));
  console.log("still set:", als.getStore()); // "leaked-value"
}

dangerousExample();
```

**Rule of thumb:** always use `als.run()`. Reserve `enterWith()` for rare cases where you cannot wrap a callback (e.g., integrating with a framework that controls the call flow).

### How it works: `async_hooks` and the async ID chain

`AsyncLocalStorage` is built on top of Node's `async_hooks` module. Every asynchronous operation in Node is assigned:

- **`asyncId`** — a unique numeric identifier for this operation
- **`triggerAsyncId`** — the `asyncId` of the operation that created this one (the parent)

This forms a chain: `HTTP request -> DB query -> timer -> file write`. When you call `als.run(store, fn)`, Node associates `store` with the current `asyncId`. When a child async operation is created inside `fn`, it inherits the `triggerAsyncId` pointing back to the parent, and `AsyncLocalStorage` propagates the store through this chain.

```typescript
// run: node --experimental-strip-types async-hooks-raw.ts
import { createHook, executionAsyncId, triggerAsyncId } from "node:async_hooks";
import { writeSync } from "node:fs";

// Use writeSync because console.log is async and would create infinite loops
function log(msg: string): void {
  writeSync(1, msg + "\n");
}

const hook = createHook({
  init(asyncId: number, type: string, triggerAsyncId: number): void {
    log(`INIT  asyncId=${asyncId}  type=${type}  trigger=${triggerAsyncId}`);
  },
  before(asyncId: number): void {
    log(`BEFORE asyncId=${asyncId}`);
  },
  after(asyncId: number): void {
    log(`AFTER  asyncId=${asyncId}`);
  },
  destroy(asyncId: number): void {
    log(`DESTROY asyncId=${asyncId}`);
  },
});

hook.enable();

setTimeout(() => {
  log(`Timer callback running. asyncId=${executionAsyncId()} trigger=${triggerAsyncId()}`);
}, 10);

// Disable after a short delay to avoid excessive output
setTimeout(() => hook.disable(), 100);
```

### `async_hooks` lifecycle

| Hook | When it fires | Typical use |
|---|---|---|
| `init(asyncId, type, triggerAsyncId)` | An async resource is created (setTimeout, Promise, I/O) | Establish parent-child relationships |
| `before(asyncId)` | Just before the async resource's callback runs | Restore context |
| `after(asyncId)` | Just after the callback completes | Clean up context |
| `destroy(asyncId)` | The resource is garbage collected | Free associated metadata |
| `promiseResolve(asyncId)` | A promise is resolved (not settled) | Track promise lifecycle |

### Performance cost of `async_hooks`

Enabling raw `async_hooks` has measurable overhead — benchmarks show **8-15% throughput reduction** in HTTP-heavy workloads because every async operation triggers hook callbacks.

`AsyncLocalStorage` is **significantly cheaper** than raw `async_hooks`. Since Node 16.4, the V8 team and Node collaborators optimized ALS to use a faster propagation mechanism (`PromiseHook` API) that avoids the full `init`/`before`/`after`/`destroy` overhead. In Node 20+, ALS overhead is typically **under 2%** for most workloads.

| Mechanism | Relative overhead | When to use |
|---|---|---|
| Raw `async_hooks` (all hooks) | ~8-15% | Diagnostics tooling, APM agents |
| `AsyncLocalStorage` (Node 20+) | ~1-2% | Application-level context propagation |
| No async tracking | Baseline | When you don't need context |

### Where context is preserved (and where it breaks)

| Mechanism | Context preserved? | Notes |
|---|---|---|
| `await` / native Promises | Yes | Core propagation path |
| `setTimeout` / `setInterval` | Yes | Tracked by async_hooks |
| `setImmediate` | Yes | Tracked by async_hooks |
| `queueMicrotask` | Yes | Runs in same async context |
| `EventEmitter` listeners | Yes | Since Node 14 |
| `process.nextTick` | Yes | Microtask-like |
| Old-style C++ addons | **No** | May create async resources without notifying async_hooks |
| Manual `setTimeout` in native code | **No** | Native code may bypass Node's timer tracking |
| Some connection pool libraries | **Maybe** | Depends on whether they reuse callbacks across contexts |

### Fixing broken context with `AsyncResource.bind`

```typescript
// run: node --experimental-strip-types async-resource-bind.ts
import { AsyncLocalStorage, AsyncResource } from "node:async_hooks";

const als = new AsyncLocalStorage<string>();

function thirdPartyLibWithCallback(cb: () => void): void {
  // Simulates a native addon that breaks context
  // by scheduling the callback outside the async chain
  const detached = cb; // In reality, this would go through C++ land
  queueMicrotask(detached);
}

als.run("my-request-id", () => {
  // Without bind — context might be lost
  thirdPartyLibWithCallback(() => {
    console.log("without bind:", als.getStore()); // might be undefined
  });

  // With bind — context is captured and restored
  const boundCb = AsyncResource.bind(() => {
    console.log("with bind:", als.getStore()); // "my-request-id"
  });
  thirdPartyLibWithCallback(boundCb);
});
```

### Real-world pattern: request correlation ID middleware

```typescript
// run: node --experimental-strip-types correlation-middleware.ts
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

interface RequestContext {
  correlationId: string;
  startTime: number;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// Logger that automatically includes correlation ID
function log(message: string): void {
  const ctx = requestContext.getStore();
  const prefix = ctx ? `[${ctx.correlationId}]` : "[no-ctx]";
  console.log(`${prefix} ${message}`);
}

// Middleware: wrap every request in ALS
const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  const ctx: RequestContext = {
    correlationId: (req.headers["x-correlation-id"] as string) ?? randomUUID(),
    startTime: Date.now(),
  };

  requestContext.run(ctx, () => {
    log(`${req.method} ${req.url}`);
    handleRequest(req, res);
  });
});

async function handleRequest(_req: IncomingMessage, res: ServerResponse): Promise<void> {
  log("querying database...");
  await simulateDbQuery();
  log("sending response");

  const ctx = requestContext.getStore()!;
  const duration = Date.now() - ctx.startTime;
  log(`completed in ${duration}ms`);

  res.writeHead(200, {
    "x-correlation-id": ctx.correlationId,
    "content-type": "application/json",
  });
  res.end(JSON.stringify({ ok: true }));
}

async function simulateDbQuery(): Promise<void> {
  log("inside db layer — context is automatically available");
  await new Promise((r) => setTimeout(r, 50));
}

server.listen(3000, () => console.log("Listening on :3000"));
// Try: curl -H "x-correlation-id: test-123" http://localhost:3000
```

### Comparison: AsyncLocalStorage vs NestJS REQUEST scope

| Aspect | `AsyncLocalStorage` | NestJS `Scope.REQUEST` |
|---|---|---|
| Mechanism | Context propagated through async chain | New provider instance per request via DI |
| Performance | ~1-2% overhead | Rebuilds DI subtree per request; much heavier |
| Coupling | Zero coupling to DI framework | Tightly coupled to NestJS DI |
| Transitive impact | None — other providers unaffected | All providers depending on a REQUEST-scoped provider also become request-scoped |
| Use case | Logging, tracing, tenant isolation | When you genuinely need a new service instance per request |

**Recommendation:** Use `AsyncLocalStorage` for read-only context (correlation IDs, tenant info, user identity). Reserve `Scope.REQUEST` for cases where you need stateful per-request service instances.

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. Context is `undefined` in event listeners registered before `als.run()`**
- **Symptom:** `als.getStore()` returns `undefined` inside an EventEmitter callback even though the emitter is used inside `run()`.
- **Root cause:** The listener was registered *outside* the `als.run()` scope. The context is captured at listener registration time, not at emit time.
- **Diagnosis:** Ensure listeners are registered inside the `run()` callback, or use `AsyncResource.bind()` to capture context explicitly.

**2. `enterWith()` leaks context across unrelated operations**
- **Symptom:** A request handler's context bleeds into a subsequent request on the same async chain (e.g., in a long-lived WebSocket handler).
- **Root cause:** `enterWith()` sets context for the entire remaining lifetime of the current async scope, with no automatic cleanup.
- **Diagnosis:** Replace `enterWith()` with `run()`. If `enterWith()` is unavoidable, audit every code path that continues after it.

**3. Connection pool reuses a callback across request boundaries**
- **Symptom:** Logs show the wrong correlation ID for some database queries — the ID belongs to a previous request.
- **Root cause:** The connection pool caches a callback or connection object that was created in one request's async context and reuses it in another.
- **Diagnosis:** Check whether your database driver properly supports `AsyncLocalStorage`. Popular drivers (pg, mysql2, ioredis) generally do. If not, wrap the callback with `AsyncResource.bind()`.

**4. Raw `async_hooks` tank throughput in production**
- **Symptom:** Deploying an APM agent that uses raw `async_hooks` causes a 10-15% drop in requests per second.
- **Root cause:** Every `init`/`before`/`after`/`destroy` hook fires for every async operation, including internal Node I/O.
- **Diagnosis:** Use `AsyncLocalStorage` instead of raw hooks when possible. If you must use `async_hooks`, enable only the hooks you need and keep callbacks minimal.
:::

## :dart: Checkpoint

::: details Question 1 — Context propagation
**Q:** You call `als.run({ userId: "42" }, handler)` and inside `handler` you `await fetch(...)`. Inside the `.then()` callback of the fetch, will `als.getStore()` return the store? Why or why not?

**A:** Yes. Native promises (and therefore `fetch`, which returns a native promise) propagate async context. When the `.then()` callback executes, Node restores the `AsyncLocalStorage` store that was active when the promise was created. This works because `AsyncLocalStorage` hooks into the `PromiseHook` API in V8, which tracks promise creation and resolution across the async chain.
:::

::: details Question 2 — enterWith vs run
**Q:** A colleague uses `als.enterWith(ctx)` at the top of an Express middleware. What is the risk, and what should they use instead?

**A:** `enterWith()` sets the store for the *entire remaining* async context, with no scoped cleanup. If the middleware's async context is shared (e.g., a long-lived connection or a middleware chain that processes multiple requests on the same async root), the context can leak to unrelated requests. They should use `als.run(ctx, next)` instead, which scopes the store to the `next()` callback and its children, and automatically cleans up when the callback completes.
:::

::: details Question 3 — Performance
**Q:** Your team wants to add raw `async_hooks` to track all async operations for a custom profiler in production. What is your recommendation?

**A:** Advise against enabling all four raw `async_hooks` callbacks in production. Benchmarks show 8-15% throughput reduction because hooks fire for every async operation including internal Node I/O. Instead, use `AsyncLocalStorage` (which uses an optimized code path with ~1-2% overhead on Node 20+) for context propagation, and limit raw `async_hooks` to development/staging profiling or use the Node.js diagnostics channel API as a lower-overhead alternative.
:::

## Key Mental Models

- **ALS is ThreadLocal for async runtimes.** It scopes data to an async call chain, not a thread.
- **`run()` is a boundary.** Everything inside it — including deeply nested awaits and callbacks — sees the store. Everything outside does not.
- **Context flows parent-to-child.** Each async operation inherits context from the operation that created it, via `triggerAsyncId`.
- **`AsyncLocalStorage` is cheap; raw `async_hooks` are not.** ALS uses an optimized V8 path (~1-2% overhead). Raw hooks fire on every async operation (~8-15%).
- **When context breaks, `AsyncResource.bind()` is the escape hatch.** It captures the current context and restores it when the bound function is called.

## Related

- [Error Doctrine](./06-error-doctrine) — error handling patterns that complement request-scoped context
- [Async Iteration vs EventEmitter](./04-async-iteration-vs-eventemitter) — alternative async patterns and how they interact with context
- [Provider Scopes & CLS](/frameworks/nestjs/03-provider-scopes) — NestJS-specific request scoping vs AsyncLocalStorage
- [OpenTelemetry](/nodejs/module-09/03-opentelemetry) — trace context propagation built on AsyncLocalStorage
- [Structured Logging](/nodejs/module-09/02-structured-logging) — automatic correlation IDs via ALS
