---
title: "Minimal Web Framework"
outline: deep
---

# Minimal Web Framework

> **Interview weight:** High -- building a framework from scratch is a common "explain what Express does" question.
> **Node version notes:** Examples target Node 22+. Uses native TypeScript via `--experimental-strip-types`.
> **Prerequisites:** [HTTP & Keep-Alive](/nodejs/module-05/02-http-keep-alive), basic familiarity with Express or similar.

## 🗣️ In Plain English

::: tip In Plain English
Think of a web framework like an assembly line in a factory.

A raw HTTP request arrives at the factory door -- it is just a blob of bytes: a method, a URL, some headers, maybe a body. The factory needs to figure out which workstation should handle this particular item (that is **routing**), pass it through a series of quality-control checkpoints along the way (that is **middleware**), and finally package a response to ship back to the customer.

Express, Fastify, Koa -- they are all factories. They differ in how fancy the conveyor belt is, but the fundamentals are identical: parse the request, match it to a handler, run it through a pipeline, send a response.

In this capstone you build the factory yourself. You will start with `node:http`, which gives you the loading dock -- raw `IncomingMessage` and `ServerResponse` objects. On top of that you will bolt together five pieces:

1. **A router** that turns URL patterns like `/users/:id` into a lookup table. When a request arrives, the router walks the table, finds a match, and extracts parameters.

2. **A middleware pipeline** -- an ordered list of functions. Each function can inspect or modify the request, short-circuit the response, or call `next()` to pass control down the line. This is the "conveyor belt."

3. **Request helpers** that parse JSON bodies, query strings, and cookies so handlers do not have to do it manually every time.

4. **Response helpers** that let you write `res.json({ ok: true })` instead of manually setting headers and calling `res.end(JSON.stringify(...))`.

5. **Error handling middleware** -- a special kind of middleware that catches any error thrown (or passed to `next(err)`) and converts it into a clean HTTP error response instead of crashing the process.

The goal is not to build a production framework. The goal is to understand every layer Express hides from you, so that when something breaks at 3 a.m. you know exactly where to look.
:::

## ⚙️ Under the Hood

### Project Skeleton

```
mini-framework/
├── src/
│   ├── app.ts          # The framework core
│   ├── router.ts       # Path matching + method dispatch
│   ├── middleware.ts    # Pipeline runner
│   ├── helpers.ts       # req/res extensions
│   └── static.ts       # Static file serving
└── demo.ts             # Example server
```

```bash
# Run the demo
node --experimental-strip-types demo.ts
```

### 1. The Router — Path Matching and Params

The router converts route patterns like `/users/:id/posts/:postId` into regular expressions and extracts named parameters.

```typescript
// src/router.ts
interface RouteMatch {
  handler: Handler;
  params: Record<string, string>;
}

interface RouteEntry {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

type Handler = (req: EnhancedReq, res: EnhancedRes, next: Next) => void | Promise<void>;
type Next = (err?: Error) => void;

interface EnhancedReq extends import("node:http").IncomingMessage {
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
}

interface EnhancedRes extends import("node:http").ServerResponse {
  json: (data: unknown, status?: number) => void;
  send: (text: string, status?: number) => void;
}

function compilePath(path: string): { pattern: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];

  // Convert /users/:id/posts/:postId → /users/([^/]+)/posts/([^/]+)
  const regexStr = path.replace(/:([a-zA-Z_][a-zA-Z0-9_]*)/g, (_match, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });

  return {
    pattern: new RegExp(`^${regexStr}$`),
    paramNames,
  };
}

class Router {
  private routes: RouteEntry[] = [];

  add(method: string, path: string, handler: Handler): void {
    const { pattern, paramNames } = compilePath(path);
    this.routes.push({ method: method.toUpperCase(), pattern, paramNames, handler });
  }

  get(path: string, handler: Handler): void { this.add("GET", path, handler); }
  post(path: string, handler: Handler): void { this.add("POST", path, handler); }
  put(path: string, handler: Handler): void { this.add("PUT", path, handler); }
  delete(path: string, handler: Handler): void { this.add("DELETE", path, handler); }

  match(method: string, pathname: string): RouteMatch | null {
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      const m = pathname.match(route.pattern);
      if (!m) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });

      return { handler: route.handler, params };
    }
    return null;
  }
}

export { Router, Handler, Next, EnhancedReq, EnhancedRes, compilePath };
```

**Key insight:** Express does exactly this -- it compiles path strings to regexes using the `path-to-regexp` library. The matching is linear: routes are tested in the order they were registered. This is why route order matters.

### 2. The Middleware Pipeline

Middleware is just an array of functions executed in sequence. Each calls `next()` to continue, or responds directly to short-circuit.

```typescript
// src/middleware.ts
import type { EnhancedReq, EnhancedRes, Handler, Next } from "./router.ts";

type ErrorHandler = (err: Error, req: EnhancedReq, res: EnhancedRes, next: Next) => void;

function runPipeline(
  middlewares: Handler[],
  errorHandlers: ErrorHandler[],
  req: EnhancedReq,
  res: EnhancedRes
): void {
  let idx = 0;

  function next(err?: Error): void {
    // If an error was passed, jump to error handlers
    if (err) {
      return runErrorPipeline(err, errorHandlers, req, res);
    }

    // No more middleware? 404.
    if (idx >= middlewares.length) {
      if (!res.writableEnded) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: "Not Found" }));
      }
      return;
    }

    const mw = middlewares[idx++];
    try {
      const result = mw(req, res, next);
      // Handle async middleware -- catch rejected promises
      if (result && typeof (result as Promise<void>).catch === "function") {
        (result as Promise<void>).catch(next);
      }
    } catch (e) {
      next(e instanceof Error ? e : new Error(String(e)));
    }
  }

  next();
}

function runErrorPipeline(
  err: Error,
  handlers: ErrorHandler[],
  req: EnhancedReq,
  res: EnhancedRes
): void {
  let idx = 0;

  function next(newErr?: Error): void {
    const currentErr = newErr ?? err;

    if (idx >= handlers.length) {
      // No error handler caught it -- send generic 500
      res.statusCode = 500;
      res.end(JSON.stringify({ error: currentErr.message }));
      return;
    }

    const handler = handlers[idx++];
    try {
      handler(currentErr, req, res, next);
    } catch (e) {
      next(e instanceof Error ? e : new Error(String(e)));
    }
  }

  next();
}

export { runPipeline, ErrorHandler };
```

**Key insight:** The `next()` closure captures the index and increments it. This is how Express chains middleware -- it is a linked-list walk disguised as a function call. Async errors are caught by attaching `.catch(next)` to the returned promise -- Express 4 famously does *not* do this, which is why `express-async-errors` exists.

### 3. Request & Response Helpers

```typescript
// src/helpers.ts
import { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import type { EnhancedReq, EnhancedRes } from "./router.ts";

/** Collect request body and parse as JSON */
async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.includes("application/json")) return undefined;

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

/** Enhance raw req/res with helper methods */
function enhance(
  rawReq: IncomingMessage,
  rawRes: ServerResponse,
  baseUrl: string
): { req: EnhancedReq; res: EnhancedRes } {
  const req = rawReq as EnhancedReq;
  const res = rawRes as EnhancedRes;

  // Parse query string
  const parsed = new URL(req.url ?? "/", baseUrl);
  req.query = Object.fromEntries(parsed.searchParams);
  req.params = {};

  // Response helpers
  res.json = (data: unknown, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(data));
  };

  res.send = (text: string, status = 200) => {
    res.statusCode = status;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end(text);
  };

  return { req, res };
}

export { parseJsonBody, enhance };
```

### 4. Static File Serving Middleware

```typescript
// src/static.ts
import { readFile, stat } from "node:fs/promises";
import { join, extname, resolve } from "node:path";
import type { EnhancedReq, EnhancedRes, Next } from "./router.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css":  "text/css",
  ".js":   "application/javascript",
  ".json": "application/json",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".txt":  "text/plain",
};

function serveStatic(root: string) {
  const absRoot = resolve(root);

  return async function staticMiddleware(
    req: EnhancedReq,
    res: EnhancedRes,
    next: Next
  ): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") return next();

    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

    // SECURITY: prevent path traversal
    const filePath = resolve(join(absRoot, pathname));
    if (!filePath.startsWith(absRoot)) {
      res.json({ error: "Forbidden" }, 403);
      return;
    }

    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return next();

      const ext = extname(filePath);
      const contentType = MIME_TYPES[ext] ?? "application/octet-stream";
      const body = await readFile(filePath);

      res.statusCode = 200;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Content-Length", body.length);
      res.end(body);
    } catch {
      // File not found -- pass to next middleware
      next();
    }
  };
}

export { serveStatic };
```

**Critical security note:** The `resolve` + `startsWith` check prevents directory traversal attacks. Without it, a request to `/../../../etc/passwd` would leak system files.

### 5. The Framework Core — Tying It Together

```typescript
// src/app.ts
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Router, Handler, EnhancedReq } from "./router.ts";
import { runPipeline, ErrorHandler } from "./middleware.ts";
import { parseJsonBody, enhance } from "./helpers.ts";

class App {
  private router = new Router();
  private middlewares: Handler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private port = 3000;

  /** Register global middleware */
  use(mw: Handler): this {
    this.middlewares.push(mw);
    return this;
  }

  /** Register error-handling middleware (4-arg) */
  useError(handler: ErrorHandler): this {
    this.errorHandlers.push(handler);
    return this;
  }

  get(path: string, handler: Handler): this { this.router.get(path, handler); return this; }
  post(path: string, handler: Handler): this { this.router.post(path, handler); return this; }
  put(path: string, handler: Handler): this { this.router.put(path, handler); return this; }
  delete(path: string, handler: Handler): this { this.router.delete(path, handler); return this; }

  listen(port: number, cb?: () => void): void {
    this.port = port;
    const baseUrl = `http://localhost:${port}`;

    const server = createServer(async (rawReq: IncomingMessage, rawRes: ServerResponse) => {
      const { req, res } = enhance(rawReq, rawRes, baseUrl);

      // Parse JSON body before routing
      try {
        req.body = await parseJsonBody(rawReq);
      } catch {
        res.json({ error: "Invalid JSON" }, 400);
        return;
      }

      // Find matching route
      const pathname = new URL(req.url ?? "/", baseUrl).pathname;
      const match = this.router.match(req.method ?? "GET", pathname);

      // Build the full pipeline: global middleware → route handler
      const pipeline = [...this.middlewares];
      if (match) {
        req.params = match.params;
        pipeline.push(match.handler);
      }

      runPipeline(pipeline, this.errorHandlers, req, res);
    });

    server.listen(port, cb);
  }
}

export { App };
```

### 6. Demo Server

```typescript
// demo.ts
import { App } from "./src/app.ts";
import { serveStatic } from "./src/static.ts";

const app = new App();

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.url} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Static files
app.use(serveStatic("./public"));

// Routes
app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/users/:id", (req, res) => {
  res.json({ userId: req.params.id, query: req.query });
});

app.post("/users", (req, res) => {
  res.json({ created: req.body }, 201);
});

// Simulate an error
app.get("/boom", () => {
  throw new Error("Something broke");
});

// Error handler
app.useError((err, _req, res, _next) => {
  console.error("Caught:", err.message);
  res.json({ error: err.message }, 500);
});

app.listen(3000, () => {
  console.log("Mini framework running on http://localhost:3000");
});
```

```bash
# Test it
curl http://localhost:3000/healthz
curl http://localhost:3000/users/42?role=admin
curl -X POST -H "Content-Type: application/json" -d '{"name":"Ada"}' http://localhost:3000/users
curl http://localhost:3000/boom
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Forgotten `next()` calls hang forever.**
If a middleware neither calls `next()` nor sends a response, the request hangs until the client times out. Express has the same problem. Always set a server-level `setTimeout` on the socket as a safety net.

**2. Path traversal in static serving.**
Without the `resolve` + `startsWith` guard, `GET /../../etc/passwd` serves arbitrary files. Every static-file middleware in production must normalize and jail the resolved path to the declared root.

**3. Linear route matching is O(n).**
Our router walks every registered route on every request. Express does the same. At hundreds of routes this becomes measurable. Fastify uses a radix tree (find-my-way) for O(log n) matching. If you outgrow linear matching, switch to a trie.

**4. Unbounded body parsing is a DoS vector.**
Our `parseJsonBody` collects all chunks into memory with no size limit. A malicious client can send a 10 GB JSON body and exhaust heap. Production frameworks cap body size (Express default: 100 KB via `body-parser`). Always enforce `Content-Length` limits.
:::

## 🎯 Checkpoint

::: details Question 1 — Middleware ordering
**Q:** You register `app.use(auth)` *after* `app.get("/public", handler)`. Will `/public` requests go through the auth middleware?

**A:** No. The pipeline is built as `[...this.middlewares, matchedHandler]`. But middleware is pushed in registration order, so if `auth` is registered after the route, it is still in the global middleware array. The real issue arises if you register route-level handlers *before* middleware that should protect them. In our implementation, all `use()` middleware runs before the matched route handler regardless of registration order relative to routes. In Express, however, `app.use` and `app.get` share a single stack, so ordering matters. This is a subtle but critical difference.
:::

::: details Question 2 — Async error handling
**Q:** What happens if a route handler returns a rejected promise but does not call `next(err)`?

**A:** In our framework, `runPipeline` attaches `.catch(next)` to the returned promise, so the error is caught and forwarded to the error pipeline automatically. In Express 4, this does *not* happen -- the rejected promise is unhandled and the request hangs. Express 5 added automatic promise rejection forwarding. This is one of the most common Express production bugs.
:::

::: details Question 3 — Path traversal
**Q:** Why is `resolve(join(root, pathname))` alone not sufficient to prevent directory traversal?

**A:** `resolve(join("./public", "/../../../etc/passwd"))` resolves to `/etc/passwd` -- a valid absolute path outside the intended root. You must check that the resolved path `startsWith` the resolved root directory. Without this check, an attacker can read any file the Node process has permission to access.
:::

## Key Mental Models

| Model | One-liner |
|-------|-----------|
| **Framework = Router + Pipeline + Helpers** | Every web framework decomposes into these three pieces; the rest is ergonomics. |
| **Middleware is a linked list** | `next()` is just "advance the index and call the next function." |
| **Route matching is regex** | Path parameters are syntactic sugar for capture groups. |
| **Error middleware is a separate pipeline** | Errors short-circuit normal flow and enter a parallel chain. |
| **Static serving needs path jailing** | Never trust user-supplied paths without resolving and bounding them. |

## Related

- [The Middleware Stack](/frameworks/express/01-middleware-stack) -- how Express implements the same pattern
- [HTTP & Keep-Alive](/nodejs/module-05/02-http-keep-alive) -- what `node:http` gives you under the hood
