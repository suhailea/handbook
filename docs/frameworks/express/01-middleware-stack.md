---
title: The Middleware Stack
outline: deep
---

# The Middleware Stack

<Badge type="tip" text="Interview: High" /> <Badge type="warning" text="Prereqs: Node HTTP basics, TypeScript" />

## 🗣️ In Plain English

::: tip In Plain English
Picture an assembly line in a factory. A raw item (an HTTP request) enters one end of the belt and must pass through a series of stations before it leaves the factory as a finished product (an HTTP response).

Each station on the line has exactly one job. The first station stamps a label onto every item (a logging middleware). The second station checks whether the item has the right clearance sticker (authentication). The third station actually shapes the item into its final form (the route handler that builds the response body). Each station can do one of three things: do its work and wave the item forward to the next station (call `next()`), reject the item and send it straight to the shipping dock itself (send a response and end the chain), or flag the item as defective and divert it onto the problems lane (pass an error to `next(err)`).

Order matters. If you put the packing station before the quality-check station, defective items get packed and shipped. If you put your authentication middleware after your route handler, unauthenticated requests still reach the handler. The belt moves in one direction: once an item passes a station, it does not revisit that station on its own.

The entire Express framework is, at its core, this assembly line. Every call to `app.use()` or `app.get()` bolts another station onto the belt. When a request arrives, Express walks through the stations one by one, handing the item to each station whose path pattern matches. The first station to send a response ends the journey. If no station ever responds, the item sits on the belt forever -- that is the dreaded "hanging request."

Understanding the middleware stack means understanding Express. Everything else -- routing, error handling, sub-applications -- is just a specialization of the same belt-and-station model.
:::

## ⚙️ Under the Hood

### What `app.use()` builds internally

Every time you call `app.use()` or a route method like `app.get()`, Express pushes a **Layer** object onto an internal stack (an array). Each Layer stores two things: a path pattern to match against, and a handler function. The stack is processed top-to-bottom, first-match-wins.

```typescript
// conceptual model of what Express builds internally
interface Layer {
  path: string;           // e.g. "/" or "/api/users"
  method?: string;        // e.g. "GET" — undefined for app.use()
  handler: Function;      // the middleware or route handler
}

const stack: Layer[] = [];

// app.use('/api', logger)  →  stack.push({ path: '/api', handler: logger })
// app.get('/api/users', listUsers) → stack.push({ path: '/api/users', method: 'GET', handler: listUsers })
```

### The middleware signature

Every middleware function receives three arguments:

| Parameter | Node Core Type            | Express Additions                                                                 |
| --------- | ------------------------- | --------------------------------------------------------------------------------- |
| `req`     | `http.IncomingMessage`    | `.params`, `.query`, `.body`, `.cookies`, `.path`, `.hostname`, `.ip`, and more    |
| `res`     | `http.ServerResponse`     | `.json()`, `.send()`, `.status()`, `.redirect()`, `.render()`, `.set()`, and more  |
| `next`    | `(err?: any) => void`     | Invoke with no argument to advance; pass an error to jump to error middleware      |

```typescript
import type { Request, Response, NextFunction } from "express";

const logger = (req: Request, res: Response, next: NextFunction): void => {
  console.log(`${req.method} ${req.path}`);
  next(); // hand off to the next layer
};
```

### Router matching algorithm

Express evaluates layers in definition order. It uses `path-to-regexp` (v0.x in Express 4, v8 in Express 5) to compile each path into a regex.

**Key rules:**

1. **First match wins.** If two routes match the same request, only the first-defined one runs (unless it calls `next()`).
2. **`app.use()` matches prefixes.** `app.use('/api', handler)` fires for `/api`, `/api/users`, `/api/users/42`.
3. **`app.get()` matches exactly.** `app.get('/api', handler)` fires only for `/api` (and `/api/` with strict routing off).
4. **Path parameters.** `/users/:id` captures `id` into `req.params.id`.
5. **Regex routes.** `app.get(/\.json$/, handler)` matches any path ending in `.json`.

```typescript
import express, { Request, Response } from "express";

const app = express();

// Prefix match — fires for /api, /api/anything
app.use("/api", (_req: Request, res: Response) => {
  res.json({ scope: "api" });
});

// Exact match — only fires for GET /health
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

// Path parameter — captures :id
app.get("/users/:id", (req: Request, res: Response) => {
  res.json({ userId: req.params.id });
});

app.listen(3000);
// Run: npx tsx 01-matching.ts
```

### `next()` mechanics

`next()` is a synchronous function call that transfers control to the next matching layer. A common misconception is that code after `next()` runs on the "way back" like Koa's downstream/upstream model. It does not work that way reliably in Express.

```typescript
import express, { Request, Response, NextFunction } from "express";

const app = express();

app.use((req: Request, res: Response, next: NextFunction): void => {
  console.log("A: before next");
  next();
  // This line executes AFTER the downstream middleware calls res.send(),
  // but res is already finished. Writing here causes "headers already sent."
  console.log("A: after next — response is already sent");
});

app.get("/", (_req: Request, res: Response) => {
  res.send("done");
});

app.listen(3000);
// Run: npx tsx 01-next-mechanics.ts
```

**If you never call `next()` and never send a response**, the request hangs indefinitely. Express has no built-in timeout.

### Mounting sub-apps and routers

A `Router` is itself a middleware. When you mount it with `app.use('/api', router)`, Express **strips the mount path** before the router sees the request. The router's internal routes are relative to the mount point.

```typescript
import express, { Request, Response, Router } from "express";

const app = express();
const usersRouter: Router = express.Router();

// Inside the router, "/" means "/api/users" to the outside world
usersRouter.get("/", (_req: Request, res: Response) => {
  res.json({ users: [] });
});

// "/:id" means "/api/users/:id" to the outside world
usersRouter.get("/:id", (req: Request, res: Response) => {
  res.json({ userId: req.params.id });
});

app.use("/api/users", usersRouter);
app.listen(3000);
// Run: npx tsx 01-router-mount.ts
```

Sub-applications (`const subApp = express()`) work the same way. They carry their own settings and middleware stack but mount identically.

### What Express abstracts from Node core

Express is a thin layer over `http.createServer()`. Here is the equivalent raw Node HTTP server for a simple two-middleware setup:

```typescript
import http, { IncomingMessage, ServerResponse } from "node:http";

// Without Express: manual dispatch
const server = http.createServer(
  (req: IncomingMessage, res: ServerResponse) => {
    // "middleware 1" — logging
    console.log(`${req.method} ${req.url}`);

    // "middleware 2" — route matching (manual)
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    // No match — 404
    res.writeHead(404);
    res.end("Not Found");
  },
);

server.listen(3000);
// Run: npx tsx 01-raw-node.ts
```

Express gives you: automatic route matching via `path-to-regexp`, the `next()` chain so each concern lives in its own function, convenience methods on `req` and `res`, and error middleware dispatch. It does **not** give you: request body parsing (you add `express.json()` middleware), authentication, validation, or a timeout. Those are all "stations you bolt onto the belt."

For more on the raw Node HTTP layer, see [HTTP, Keep-Alive & Pooling](/nodejs/module-05/02-http-keep-alive).

### Full execution flow

Putting it all together with a realistic four-middleware setup:

```typescript
import express, { Request, Response, NextFunction } from "express";

const app = express();

// Station 1: Logger
app.use((req: Request, _res: Response, next: NextFunction): void => {
  const start = Date.now();
  console.log(`→ ${req.method} ${req.path}`);
  next();
  console.log(`← ${req.method} ${req.path} [${Date.now() - start}ms]`);
});

// Station 2: JSON body parser (built-in middleware)
app.use(express.json());

// Station 3: Auth check
const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const token = req.headers.authorization;
  if (!token) {
    res.status(401).json({ error: "No token" });
    return; // do NOT call next() — chain stops here
  }
  next();
};

// Station 4: Protected route handler
app.get("/api/secret", requireAuth, (req: Request, res: Response) => {
  res.json({ data: "classified" });
});

// Station 5: Catch-all 404
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

app.listen(3000, () => console.log("Listening on :3000"));
// Run: npx tsx 01-full-flow.ts
// Test: curl http://localhost:3000/api/secret
// Test: curl -H "Authorization: Bearer tok" http://localhost:3000/api/secret
```

**Request flow for `GET /api/secret` without a token:**

1. Logger runs, calls `next()`.
2. `express.json()` runs (no body to parse), calls `next()`.
3. `requireAuth` runs, finds no token, sends 401. **Chain stops.**
4. Route handler never executes.

**Request flow for `GET /api/secret` with a token:**

1. Logger runs, calls `next()`.
2. `express.json()` runs, calls `next()`.
3. `requireAuth` runs, finds token, calls `next()`.
4. Route handler sends 200 with JSON body.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Middleware order bugs are silent.** If you place `express.json()` after your route handler, `req.body` is `undefined` -- no error, no warning. You only discover this when POST payloads silently disappear. Always define parsing middleware before route handlers.

**2. Forgetting `next()` hangs requests.** A middleware that neither calls `next()` nor sends a response leaves the client waiting forever. In production, this surfaces as socket timeouts, load balancer 502s, and memory leaks from accumulating open connections. Add a request-timeout middleware or use `server.setTimeout()`.

**3. Code after `next()` runs in a confusing state.** Because Express is not truly an onion model, code placed after `next()` executes after the response has already been sent. Trying to modify headers or call `res.json()` there throws `ERR_HTTP_HEADERS_SENT`. If you need post-response logic, use the `res.on('finish', ...)` event instead.

**4. Mount-path stripping surprises.** When you mount a router at `/api`, the router sees `/users` instead of `/api/users`. If you log `req.path` inside the router, you see the stripped path. Use `req.originalUrl` when you need the full path for logging or metrics.
:::

## 🎯 Checkpoint

::: details Question 1 — Middleware execution order
**Q:** You define `app.get('/users', handlerA)` and then `app.get('/users', handlerB)`. A GET request arrives for `/users`. Which handler runs and why?

**A:** `handlerA` runs because Express uses first-match-wins ordering. `handlerB` never executes unless `handlerA` calls `next()` without sending a response. This is why middleware and route definition order is critical.
:::

::: details Question 2 — What happens without `next()`?
**Q:** A middleware function logs the request method but never calls `next()` and never sends a response. What happens to the client?

**A:** The request hangs indefinitely. Express has no built-in timeout, so the TCP connection stays open until the client times out or the OS reclaims the socket. In production, this leaks connections and eventually exhausts the server's capacity.
:::

::: details Question 3 — Router path stripping
**Q:** You mount a router with `app.use('/api/v2', router)`. Inside the router you define `router.get('/users', handler)`. What URL does a client hit to reach this handler? What does `req.path` return inside the handler?

**A:** The client hits `/api/v2/users`. Inside the handler, `req.path` returns `/users` because Express strips the mount prefix. `req.originalUrl` returns `/api/v2/users`, which is the full path.
:::

::: details Question 4 — Express vs. raw Node
**Q:** Name two things Express's middleware stack provides that a raw `http.createServer` callback does not.

**A:** (1) Automatic route pattern matching via `path-to-regexp`, so you do not need to manually parse `req.url` and check patterns. (2) The `next()` dispatch chain, which lets you decompose request handling into isolated, composable functions instead of writing one monolithic callback.
:::

## Key Mental Models

- **The stack is an ordered array.** Definition order determines execution order; first match wins, and skipping a layer is impossible unless the prior layer calls `next()`.
- **`next()` is a forward-only pass.** It transfers control to the next matching layer; Express is not an onion model, so "upstream" code after `next()` runs in a treacherous post-response state.
- **Every middleware is the same shape.** `(req, res, next) => void` -- routers, sub-apps, body parsers, and your business logic all conform to the same three-parameter contract.
- **Express adds convenience, not magic.** It decorates Node's `IncomingMessage` and `ServerResponse` with helper methods and wraps `http.createServer` with pattern matching and dispatch. Understanding the raw layer makes Express transparent.
- **A middleware that neither calls `next()` nor responds is a resource leak.** Every request must terminate; Express will not do it for you.

## Related

- [Error Middleware & Async Errors](./02-error-handling)
- [NestJS Request Lifecycle](/frameworks/nestjs/02-request-lifecycle)
- [HTTP, Keep-Alive & Pooling](/nodejs/module-05/02-http-keep-alive)
