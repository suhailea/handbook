---
title: Error Middleware & Async Errors
outline: deep
---

# Error Middleware & Async Errors

<Badge type="tip" text="Interview: High" /> <Badge type="warning" text="Prereqs: Middleware Stack, Promises, async/await" />

## 🗣️ In Plain English

::: tip In Plain English
Remember the assembly line from the middleware stack page? Now picture a second conveyor belt running parallel to the main one -- call it the "problems lane." On the main belt, each station does its job and waves the item forward. But when a station discovers something wrong -- a cracked part, a missing label, an unauthorized shipment -- it does not pass the item forward on the main belt. Instead, it lifts the item off the main belt and drops it onto the problems lane.

The problems lane has its own specialized stations. The first station handles minor cosmetic defects: it slaps a "400 Bad Request" sticker on the item and ships it back. The second station handles items with no clearance sticker: "401 Unauthorized, return to sender." The final station at the end of the problems lane is the catch-all: anything that reaches it gets a generic "500 Internal Server Error" label and goes out the door.

Here is the catch in Express 4: the mechanism that detects defective items only works if the station notices the problem immediately -- while it is physically holding the item. If the station starts an asynchronous process (sends the item to a back room for testing) and the problem is discovered later, the main belt never finds out. The item just vanishes. Nobody flags it, nobody ships it back, and the customer waits forever. This is the async error problem, and it is one of the most common sources of hung requests in Express applications.

Express 5 fixes this by watching the back room. If an async process throws, Express 5 catches the error and puts the item on the problems lane automatically. But vast amounts of production Express code still runs on version 4, so understanding both behaviors is essential.

The problems lane only works if you install it at the very end of the main belt. If you bolt it on in the middle, items that fail at later stations fly off the belt with no one to catch them.
:::

## ⚙️ Under the Hood

### The 4-arity error middleware signature

Express distinguishes error middleware from regular middleware by **function arity** -- the number of declared parameters. Error middleware must declare exactly four parameters:

```typescript
import type { Request, Response, NextFunction } from "express";

const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  console.error(err.message);
  res.status(500).json({ error: "Internal Server Error" });
};
```

If you omit any parameter (even if unused), Express treats the function as regular middleware and never routes errors to it. This is one of the few places in JavaScript where the `.length` property of a function matters at runtime.

```typescript
// WRONG — 3 parameters, Express treats this as regular middleware
const broken = (err: Error, _req: Request, res: Response): void => {
  res.status(500).json({ error: err.message }); // never called for errors
};

// CORRECT — 4 parameters, Express recognizes this as error middleware
const working = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  res.status(500).json({ error: err.message });
};
```

### Error propagation through the chain

When you call `next(err)` or throw synchronously inside a middleware, Express **skips every regular middleware** and jumps to the next error middleware in the stack.

```typescript
import express, { Request, Response, NextFunction } from "express";

const app = express();

// Regular middleware — skipped when an error is propagating
app.use((_req: Request, _res: Response, next: NextFunction): void => {
  console.log("middleware 1 — will be skipped on error path");
  next();
});

// Route that triggers an error
app.get("/boom", (_req: Request, _res: Response, next: NextFunction): void => {
  next(new Error("Something broke"));
});

// Regular middleware — also skipped
app.use((_req: Request, _res: Response, next: NextFunction): void => {
  console.log("middleware 2 — also skipped on error path");
  next();
});

// Error middleware — Express jumps directly here
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    console.error("Caught:", err.message);
    res.status(500).json({ error: err.message });
  },
);

app.listen(3000);
// Run: npx tsx 02-error-propagation.ts
// Test: curl http://localhost:3000/boom
```

A synchronous `throw` inside a non-async handler is also caught by Express:

```typescript
app.get("/throw", (_req: Request, _res: Response): void => {
  throw new Error("sync throw"); // Express catches this, calls next(err)
});
```

### Why Express 4 struggles with async errors

Express 4 wraps handler invocations in a `try/catch`. This works for synchronous throws but **fails for promise rejections**:

```typescript
// Express 4 internal dispatch (simplified)
function dispatch(handler: Function, req: Request, res: Response, next: NextFunction): void {
  try {
    handler(req, res, next);
    // If handler is async, it returns a Promise.
    // The try/catch does NOT await that Promise.
    // A rejection floats away — unhandled.
  } catch (err) {
    next(err); // only catches synchronous throws
  }
}
```

This means the following code **hangs** in Express 4:

```typescript
import express, { Request, Response, NextFunction } from "express";

const app = express();

// Express 4: this rejection is NEVER caught
app.get("/danger", async (_req: Request, _res: Response) => {
  const data = await someDbCall(); // throws an error
  _res.json(data);
});

// This error middleware never fires for the async rejection above
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    res.status(500).json({ error: err.message });
  },
);

async function someDbCall(): Promise<never> {
  throw new Error("DB connection refused");
}

app.listen(3000);
// Run: npx tsx 02-async-problem.ts
// In Express 4: curl hangs, then "unhandled rejection" in server logs
```

### The wrapper pattern for Express 4

The standard fix is a higher-order function that catches rejections and forwards them to `next()`:

```typescript
import express, { Request, Response, NextFunction, RequestHandler } from "express";

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

const asyncHandler =
  (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

const app = express();

app.get(
  "/safe",
  asyncHandler(async (req: Request, res: Response) => {
    const data = await someDbCall(); // rejection is now caught
    res.json(data);
  }),
);

app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    console.error("Caught async error:", err.message);
    res.status(500).json({ error: err.message });
  },
);

async function someDbCall(): Promise<never> {
  throw new Error("DB connection refused");
}

app.listen(3000);
// Run: npx tsx 02-async-wrapper.ts
// Test: curl http://localhost:3000/safe → { "error": "DB connection refused" }
```

Libraries like `express-async-errors` monkey-patch Express to do this automatically, but the explicit wrapper is more transparent and requires no runtime patching.

### Express 5 changes

Express 5 (released as 5.0 in 2024) **automatically catches rejected promises** from route handlers and passes the rejection reason to `next()`. No wrapper needed:

```typescript
import express, { Request, Response, NextFunction } from "express";

const app = express();

// Express 5: rejection is automatically caught and forwarded to error middleware
app.get("/safe", async (_req: Request, res: Response) => {
  const data = await someDbCall();
  res.json(data);
});

app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    res.status(500).json({ error: err.message }); // fires correctly
  },
);

async function someDbCall(): Promise<never> {
  throw new Error("DB connection refused");
}

app.listen(3000);
// Run: npx tsx 02-express5.ts (requires express@5)
```

| Behavior                          | Express 4                           | Express 5                           |
| --------------------------------- | ----------------------------------- | ----------------------------------- |
| Sync `throw` in handler           | Caught, forwarded to error MW       | Caught, forwarded to error MW       |
| `next(err)` call                  | Forwarded to error MW               | Forwarded to error MW               |
| Rejected promise from async handler | **Not caught** — request hangs     | Caught, forwarded to error MW       |
| `path-to-regexp` version          | v0.x                                | v8                                  |

### Error middleware ordering

Error middleware **must be defined after all routes and regular middleware.** Express walks the stack top-to-bottom; if the error middleware appears before a route that throws, the error has nowhere to go.

You can chain multiple error middleware for different error types:

```typescript
import express, { Request, Response, NextFunction } from "express";

const app = express();

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

app.post("/submit", (_req: Request, _res: Response): void => {
  throw new ValidationError("email is required");
});

app.get("/admin", (_req: Request, _res: Response): void => {
  throw new AuthError("not authorized");
});

// Error middleware 1: handle validation errors → 400
app.use(
  (err: Error, _req: Request, res: Response, next: NextFunction): void => {
    if (err instanceof ValidationError) {
      res.status(400).json({ error: err.message });
      return;
    }
    next(err); // not a validation error — pass to next error middleware
  },
);

// Error middleware 2: handle auth errors → 401
app.use(
  (err: Error, _req: Request, res: Response, next: NextFunction): void => {
    if (err instanceof AuthError) {
      res.status(401).json({ error: err.message });
      return;
    }
    next(err);
  },
);

// Error middleware 3: catch-all → 500
app.use(
  (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal Server Error" });
  },
);

app.listen(3000);
// Run: npx tsx 02-error-chain.ts
// Test: curl -X POST http://localhost:3000/submit → 400
// Test: curl http://localhost:3000/admin → 401
```

### Comparison with Node core error handling

Without Express, you handle every error inside the single `http.createServer` callback. There is no dispatch, no chain, and no automatic skipping:

```typescript
import http, { IncomingMessage, ServerResponse } from "node:http";

const server = http.createServer(
  (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (req.url === "/boom") {
        throw new Error("Something broke");
      }
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    }
  },
);

server.listen(3000);
// Run: npx tsx 02-raw-node-errors.ts
```

Express abstracts this into a dedicated error-handling dispatch layer so you can separate "what went wrong" (any middleware calling `next(err)`) from "how to respond to what went wrong" (error middleware at the bottom of the stack). For deeper coverage of Node's error philosophy, see [Error Doctrine](/nodejs/module-03/06-error-doctrine).

### The request timeout problem

If no middleware sends a response **and** no error middleware catches the error, the request hangs forever. Express does not set a default timeout. In production, this manifests as growing memory usage, exhausted connection pools, and load balancer 502 errors.

Two defenses:

```typescript
import express, { Request, Response, NextFunction } from "express";

const app = express();

// Defense 1: Timeout middleware
app.use((_req: Request, res: Response, next: NextFunction): void => {
  res.setTimeout(5000, () => {
    if (!res.headersSent) {
      res.status(503).json({ error: "Request timeout" });
    }
  });
  next();
});

// ... routes ...

app.listen(3000);
// Run: npx tsx 02-timeout.ts
```

```typescript
import express from "express";

const app = express();

// ... routes ...

// Defense 2: Server-level timeout
const server = app.listen(3000);
server.setTimeout(10_000); // 10 seconds
```

See also [Unhandled Rejections](/nodejs/module-03/02-unhandled-rejections) for what happens when a promise rejection escapes both Express and your process-level handlers.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Missing the fourth parameter.** If your error handler has three parameters because you omitted `next`, Express silently treats it as regular middleware. Errors fly past it and the request hangs. Always declare all four parameters, even if you do not use `next` in the body. Use an underscore prefix (`_next`) to satisfy linters.

**2. Async errors in Express 4 cause silent hangs.** An `async` route handler that throws does not trigger error middleware -- the rejection is unhandled, the response is never sent, and the client waits until its own timeout fires. Wrapping every async handler is mandatory in Express 4.

**3. Error middleware defined too early.** Error middleware placed before your routes catches nothing from those routes. It must be the last `app.use()` call. During refactors, it is easy to accidentally move it above a new router mount.

**4. Calling `next(err)` after `res.send()`.** If your handler sends a response and later calls `next(err)` (common with event-driven code), Express tries to forward the error but the response is already finished. You get `ERR_HTTP_HEADERS_SENT` in your logs and the error middleware may attempt to write to a closed stream.
:::

## 🎯 Checkpoint

::: details Question 1 — Why four parameters?
**Q:** Why does Express require exactly four parameters in an error middleware signature? What happens if you use three?

**A:** Express inspects `fn.length` (the function's declared parameter count) to distinguish error middleware from regular middleware. If `fn.length === 4`, it is treated as error middleware and receives `(err, req, res, next)`. If `fn.length < 4`, Express treats it as regular middleware and never routes errors to it. This is a runtime arity check, not a type-system feature.
:::

::: details Question 2 — Async handler in Express 4
**Q:** In Express 4, you write `app.get('/data', async (req, res) => { throw new Error('fail') })`. What happens when a client hits GET /data?

**A:** Express 4 calls the async handler inside a `try/catch`, but the handler returns a Promise. The `try/catch` does not await the Promise, so the rejection goes unhandled. No error middleware fires, no response is sent, and the request hangs until the client or load balancer times out. The server logs an `UnhandledPromiseRejection` warning (or crashes, depending on the Node version and `--unhandled-rejections` flag).
:::

::: details Question 3 — Error middleware ordering
**Q:** You have three error middleware: one for validation errors (400), one for auth errors (401), and a catch-all (500). Where do they go relative to your routes, and in what order?

**A:** All three must be defined after all routes and regular middleware. Order them from most specific to least specific: validation handler first, then auth handler, then the catch-all 500 handler. Each specific handler calls `next(err)` for errors it does not recognize, letting them fall through to the next error middleware.
:::

::: details Question 4 — Express 5 improvement
**Q:** What specific change in Express 5 eliminates the need for the `asyncHandler` wrapper pattern?

**A:** Express 5 checks the return value of route handlers. If the return value is a Promise (i.e., the handler is async), Express attaches a `.catch(next)` to it automatically. This means rejected promises are forwarded to error middleware without any wrapper. The behavior is equivalent to the manual `asyncHandler` pattern but built into the framework's dispatch layer.
:::

## Key Mental Models

- **Arity is the contract.** Express uses `fn.length === 4` to identify error middleware -- this is a runtime dispatch mechanism, not a convention you can shortcut.
- **Errors skip the main belt.** Calling `next(err)` bypasses all regular middleware and jumps to the next error middleware, like a circuit breaker in the dispatch chain.
- **Express 4 is blind to promises.** Async handlers that reject produce unhandled rejections and hung requests; wrapping with `asyncHandler` is non-negotiable until you migrate to Express 5.
- **Error middleware goes last.** It must be defined after all routes; this is a positional requirement in the stack array, not a suggestion.
- **No response means no termination.** Express never times out a request on its own -- every error path must eventually call `res.send()`, `res.json()`, or `res.end()`, or the connection leaks.

## Related

- [The Middleware Stack](./01-middleware-stack)
- [Error Doctrine](/nodejs/module-03/06-error-doctrine)
- [Unhandled Rejections](/nodejs/module-03/02-unhandled-rejections)
- [NestJS Request Lifecycle](/frameworks/nestjs/02-request-lifecycle)
