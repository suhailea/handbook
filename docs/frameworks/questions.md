---
title: "Frameworks — 25 Interview Questions"
outline: deep
---

# Frameworks — 25 Interview Questions

25 curated questions covering Express middleware, error handling, and NestJS DI, request lifecycle, providers, and microservices. Each answer explains the mechanism and connects to what the framework abstracts from Node core.

## Express

::: details Q1 — What does `app.use()` build internally?

**Q:** What does `app.use()` build internally?

**A:** Every call to `app.use(path, fn)` pushes a `Layer` object onto the router's ordered stack (the `router.stack` array). Each `Layer` stores the mount path, the handler function, and a compiled path-matching regexp built by `path-to-regexp`. When a request arrives, `router.handle()` walks this array top-to-bottom, testing each layer's regexp against the request's `url`. If the path matches, the layer's handler is invoked with `(req, res, next)` where `next` is a closure that, when called, resumes iteration at the next index. This is Express's entire dispatch model — a linear, synchronous walk through an array. There is no dependency graph, no priority system, no parallel execution. What Express abstracts here is the raw `node:http` `requestListener` callback: instead of one monolithic function handling every route and concern, Express decomposes it into an ordered chain of small functions. Understanding that it is just an array walk explains why middleware order matters and why a missing `next()` call silently hangs the request — nothing advances the index.
:::

::: details Q2 — How does Express detect error middleware (4-arity)?

**Q:** How does Express detect error middleware — the 4-argument `(err, req, res, next)` signature?

**A:** Express inspects each handler's `.length` property — the value JavaScript gives every function, reflecting its declared parameter count. During the stack walk in `router.handle()`, if an error has been propagated (i.e., `next(err)` was called), Express skips every layer whose `fn.length !== 4` and only invokes layers where `fn.length === 4`. This is a pure runtime arity check, not static analysis. The consequence is that using default parameters, rest parameters, or destructuring in the signature can change `.length` and silently break detection. For example, `(err, req, res, next = () => {})` reports `.length === 3` because parameters with defaults are not counted — Express will never route errors to it. This is raw `Function.prototype.length` from the JavaScript spec being used as a dispatch mechanism, which is clever but fragile. Node core has no such convention; error-first callbacks use position by convention but nothing inspects arity.
:::

::: details Q3 — Why does Express 4 fail with async handler rejections?

**Q:** Why does Express 4 fail to handle promise rejections from async route handlers?

**A:** Express 4's `router.handle()` calls each layer's handler inside a `try/catch`. The `try/catch` captures synchronous `throw` errors and forwards them via `next(err)`. However, when a handler is declared `async`, it returns a `Promise` — the function body completes synchronously from Express's perspective (returning the promise object), and any subsequent rejection happens asynchronously in a later microtask. Express 4 does not inspect the handler's return value for a `.then`/`.catch`, so the rejection is never caught by Express. Instead, it becomes an unhandled rejection at the process level, which since Node 15 terminates the process with exit code 1. This is the gap Express abstracts poorly: Node's `node:http` server likewise has no built-in promise awareness in its `requestListener`, but Express's middleware model makes developers assume the framework will handle it. The workaround in Express 4 is wrapping every async handler with a higher-order function that attaches `.catch(next)` to the returned promise:

```typescript
// Wrapper for Express 4 async handlers
const asyncHandler = (fn: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/users', asyncHandler(async (req, res) => {
  const users = await db.getUsers(); // rejection now routes to error middleware
  res.json(users);
}));
```
:::

::: details Q4 — What does `next()` actually do mechanically?

**Q:** What does `next()` actually do mechanically?

**A:** `next` is a closure created by `router.handle()`. It captures a mutable index (`idx`) into the `router.stack` array. When invoked with no arguments, it increments `idx` and resumes the `while` loop that matches layers, eventually calling the next matching handler. When invoked with a non-`'route'` truthy argument (`next(err)`), the error is stored and the loop resumes but now skips all non-error (arity < 4) layers until it finds error middleware. Critically, `next()` is **synchronous** — calling it does not defer to a future tick. If middleware A calls `next()` synchronously, middleware B runs immediately on the same call stack, and when B returns, execution continues in A after the `next()` call. This means code after `next()` executes in reverse order (like unwinding a call stack), which is how response-timing middleware works: start a timer, call `next()`, and the line after `next()` runs after all downstream middleware have called their `next()` or sent a response. At the Node core level, this replaces what you would otherwise build as explicit function composition or a chain of callbacks wired together manually.
:::

::: details Q5 — How does router mounting and path stripping work?

**Q:** How does router mounting and path stripping work?

**A:** When you call `app.use('/api', apiRouter)`, Express mounts `apiRouter` as a sub-application at the `/api` prefix. Internally, the parent router creates a `Layer` with the mount path `/api` and the sub-router as its handler. When a request for `/api/users` arrives, the parent layer matches the prefix `/api`, then **strips it** from `req.url` before passing the request into the sub-router. The sub-router sees `req.url` as `/users`, so its own routes match against the remainder. Express preserves the original URL in `req.originalUrl` (set once and never modified) and tracks the matched base in `req.baseUrl`. This prefix-stripping is recursive — nested mounts compose. The mechanism is the same pattern as a filesystem mount: the sub-router operates in a namespace relative to its mount point. This abstracts away the manual URL parsing you would do with `node:http`, where `req.url` is always the full path and any path hierarchy is your responsibility to decompose.
:::

::: details Q6 — What's the difference between `app.use` and `app.all`?

**Q:** What's the difference between `app.use()` and `app.all()`?

**A:** Both register handlers that match all HTTP methods, but they differ in two critical ways. First, **path matching**: `app.use('/api')` matches any URL that *starts with* `/api` — it matches `/api`, `/api/users`, `/api/users/123`. `app.all('/api')` matches only the *exact* path `/api` (unless you add a wildcard like `/api/*`). This is because `app.use` sets the Layer's `end` option to `false` in `path-to-regexp`, making it a prefix match, while `app.all` uses `end: true` for exact matching. Second, **path stripping**: `app.use` strips the matched prefix from `req.url` before passing to the handler (relevant when mounting routers), while `app.all` does not modify `req.url`. In practice, `app.use` is for middleware and sub-router mounting where prefix semantics are needed, while `app.all` is for route handlers that should respond to any HTTP method at a specific path. At the Node core level, both are abstractions over testing `req.method` and `req.url` inside the single `requestListener` callback.
:::

::: details Q7 — How does Express handle the request timeout problem?

**Q:** How does Express handle the request timeout problem?

**A:** Express itself does almost nothing about timeouts — and that is the problem. The underlying `node:http` server has `server.timeout` (default: 0, meaning no timeout since Node 13+) and `server.requestTimeout` (added in Node 18.0, default 300 seconds), which control socket-level inactivity. But Express adds no handler-level timeout mechanism. If your async operation takes 60 seconds, Express will happily hold the request open for that duration. This means you need to implement timeouts yourself: either via middleware that starts a `setTimeout` and calls `next(err)` if the downstream handler does not respond in time, or by using `AbortSignal.timeout()` on individual async operations. In production behind a reverse proxy (nginx, ALB), the proxy's timeout often fires first, sending a `502` to the client while the Node process continues doing work on the now-abandoned request — a resource leak. The key insight is that Express's abstraction over `node:http` deliberately stays thin here; it doesn't wrap the response lifecycle in a timeout-aware harness the way NestJS interceptors can.

```typescript
import { Request, Response, NextFunction } from 'express';

// Handler-level timeout middleware
function timeout(ms: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const timer = setTimeout(() => {
      if (!res.headersSent) {
        res.status(503).json({ error: 'Service timeout' });
      }
    }, ms);
    res.on('finish', () => clearTimeout(timer));
    next();
  };
}
```
:::

::: details Q8 — What happens when you call `next('route')`?

**Q:** What happens when you call `next('route')`?

**A:** `next('route')` is a special sentinel value in Express's dispatch loop. When Express matches a route (e.g., `app.get('/users', handlerA, handlerB)`), both `handlerA` and `handlerB` are stacked on the same `Route` object. Normally, calling `next()` from `handlerA` advances to `handlerB` within that route. But calling `next('route')` tells Express to skip the remaining handlers on the *current Route* and resume the outer router's stack walk, looking for the next matching route or middleware. This is useful for conditional routing — for example, a handler that checks a condition and, if not met, falls through to an alternative route definition. Note: `next('route')` only works in handlers added via `app.METHOD()` or `router.METHOD()`, not in middleware attached via `app.use()`, because `app.use` handlers are not grouped into `Route` objects. Passing any other string to `next()` (e.g., `next('some error')`) is treated as an error value, which is a common source of bugs.
:::

::: details Q9 — How does `res.json()` differ from `res.send()` with an object?

**Q:** How does `res.json()` differ from `res.send()` with an object?

**A:** In Express 4, calling `res.send()` with an object internally calls `res.json()`, so for objects they produce the same output. However, `res.json()` does two things explicitly: it applies JSON replacer and spaces settings from `app.set('json replacer')` and `app.set('json spaces')`, and it always sets `Content-Type: application/json; charset=utf-8`. `res.send()`, on the other hand, is polymorphic — it inspects the argument type and behaves differently for strings (sets `Content-Type: text/html`), Buffers (sets `application/octet-stream`), numbers (in Express 4, treated as status codes — a deprecated and confusing behavior removed in Express 5), and objects (delegates to `res.json()`). The practical difference matters when you have configured `json spaces` for pretty-printing or a `json replacer` for sanitization — only `res.json()` and `res.send()` with an object will use them. At the Node core level, both ultimately call `res.end()` from `node:http`, writing the serialized string to the socket. Prefer `res.json()` for API responses for clarity of intent.
:::

::: details Q10 — Why must error middleware be defined last?

**Q:** Why must error middleware be defined last?

**A:** Because Express's dispatch is a single linear walk through the `router.stack` array, and error middleware (4-arity functions) is only invoked when the loop is in "error mode" — i.e., after some prior handler called `next(err)`. If you define error middleware *before* your routes, the stack walk has not yet encountered any route handler that could generate an error. When a later route does call `next(err)`, Express resumes the walk from that point forward, looking for the next 4-arity handler. If the error middleware is behind (above) the erroring route in the array, it will never be reached. Additionally, you typically want error middleware after all routes so it acts as a catch-all — any error from any route flows down to it. Defining multiple error middleware in sequence lets you layer concerns (logging error middleware first, then response-formatting error middleware). This is a direct consequence of Express being an ordered array, not a declarative error-handler registry. In Node core, you would handle this in a single `try/catch` or error callback — Express's contribution is decomposing that into a chain, but the chain's ordering semantics are on you.
:::

::: details Q11 — Async error handling in Express 4 without a wrapper?

**Q:** How would you implement async error handling in Express 4 without a per-handler wrapper function?

**A:** Beyond the `asyncHandler` wrapper pattern, there are two structural approaches. First, you can monkey-patch `Layer.prototype.handle_request` in Express's router to detect when a handler returns a thenable and attach `.catch(next)` automatically — this is exactly what the `express-async-errors` package does. It modifies Express's internals at import time so every handler gets promise-aware dispatch without any per-route changes:

```typescript
// Must be imported before any route definitions
// express-async-errors patches Layer.prototype.handle_request
import 'express-async-errors';
import express from 'express';

const app = express();

// Now rejections are caught automatically
app.get('/users', async (req, res) => {
  const users = await db.getUsers(); // rejection → error middleware
  res.json(users);
});
```

Second, you can build a router-level wrapper that iterates over a router's stack after route registration and wraps each handler. Both approaches are fragile because they depend on Express internals that are not part of the public API. The monkey-patching approach works because Express's architecture is simple — `Layer.handle_request` is the single point where all handlers are invoked, so patching it once covers every route. This is a case where Express's thin abstraction over `node:http` creates a gap that the community fills with runtime patches.
:::

::: details Q12 — What does Express 5 change for promise rejections?

**Q:** What does Express 5 change for promise rejections?

**A:** Express 5 makes the router promise-aware natively. When a route handler or middleware returns a value, Express 5's `Layer.handle_request` checks if the return value is a thenable (has a `.then` method). If so, it attaches `.then(next, next)` — routing both fulfillments and rejections through `next()`. For rejections, this means the rejected value is passed as `next(err)`, entering error-dispatch mode and reaching your error middleware. This eliminates the need for `asyncHandler` wrappers or `express-async-errors` patches. Express 5 also removes several legacy behaviors: `req.host` returns the full `Host` header (not stripped of port), `req.query` uses a getter that reparses on each access by default, the deprecated `app.del()` alias is removed, and calling `res.send(number)` sends a JSON number body instead of treating it as a status code. The promise handling is the most impactful change for modern Node.js applications. At the Node core level, Express 5 finally catches up to what you would naturally do when building on `node:http` with `async` functions — inspect the return value and handle rejections.
:::

## NestJS

::: details Q13 — Why is `emitDecoratorMetadata` required?

**Q:** Why does NestJS require the `emitDecoratorMetadata` TypeScript compiler option?

**A:** NestJS's dependency injection relies on constructor parameter types to know *what* to inject. TypeScript's `emitDecoratorMetadata` option causes the compiler to emit calls to `Reflect.metadata('design:paramtypes', [...])` on decorated classes, recording the constructor parameter types as runtime metadata. When you write `constructor(private usersService: UsersService)`, the compiled JavaScript includes metadata that maps parameter index 0 to the `UsersService` constructor function. Without this flag, the types are erased during compilation (TypeScript's core contract) and the DI container has no way to know what to inject — it sees only a generic function with unnamed parameters. This is why `@Inject()` tokens exist as a fallback: when you inject an interface (which has no runtime representation) or a string/symbol token, `emitDecoratorMetadata` cannot help, and you must use `@Inject('TOKEN')` to explicitly tell the container what to resolve. The entire mechanism builds on the `reflect-metadata` polyfill, which provides the `Reflect.getMetadata` API. Node core has no DI system — NestJS adds this layer to bring Angular-style inversion of control to server-side TypeScript, trading startup reflection cost for decoupled architecture.
:::

::: details Q14 — How does the DI container resolve constructor dependencies?

**Q:** How does the DI container resolve constructor dependencies?

**A:** During application bootstrap, NestJS's `InstanceLoader` processes the module graph. For each module, it reads the `providers` array and builds a dependency graph. For each provider, it reads `Reflect.getMetadata('design:paramtypes', ProviderClass)` to discover constructor dependencies. Resolution follows topological order — if `ServiceA` depends on `ServiceB`, `ServiceB` is instantiated first. Circular dependencies cause a runtime error unless broken with `@Inject(forwardRef(() => ServiceB))`, which defers resolution. By default, all providers are singletons (scope `DEFAULT`) — instantiated once during bootstrap and shared across all requests. The container stores instances in a flat map keyed by injection token (the class constructor or a custom token). When a provider from Module A needs a provider from Module B, Module B must `exports` that provider and Module A must `imports` Module B — this enforces encapsulation at the module boundary. The entire system is a compile-time-metadata-driven IoC container that replaces what you would otherwise do with manual factory functions and explicit dependency wiring in plain Node.js.

```typescript
// What NestJS does conceptually during bootstrap:
// 1. Read metadata
const paramTypes = Reflect.getMetadata('design:paramtypes', UsersController);
// paramTypes === [UsersService]

// 2. Resolve each dependency recursively
const usersService = container.get(UsersService); // already instantiated or create now

// 3. Instantiate with resolved deps
const controller = new UsersController(usersService);
```
:::

::: details Q15 — What is the full request lifecycle pipeline in order?

**Q:** What is the full request lifecycle pipeline in order?

**A:** A request in NestJS passes through seven layers in this exact order: **(1) Middleware** — runs first, has access to `req`, `res`, `next`, identical to Express middleware (NestJS uses Express or Fastify underneath). **(2) Guards** — evaluated next, return `true`/`false` (or a promise thereof) to allow/deny access. The `ExecutionContext` is available here. **(3) Interceptors (pre-handler)** — wrap the handler in an RxJS `Observable` pipeline. The `before` phase of the interceptor runs here (e.g., timing, logging, transforming the request). **(4) Pipes** — transform and validate individual parameters (`@Param()`, `@Body()`, `@Query()`). `ValidationPipe` with `class-validator` runs here. **(5) Route handler** — your controller method executes. **(6) Interceptors (post-handler)** — the handler's return value flows back through interceptors as an `Observable`, allowing response transformation, caching, or mapping. **(7) Exception Filters** — if any layer throws, the exception propagates out and is caught by the nearest bound exception filter. This pipeline is NestJS's major abstraction over Express/Fastify: Express only gives you linear middleware, and you must manually decompose auth checks, validation, and error handling within that. NestJS separates these into distinct, typed, testable layers.
:::

::: details Q16 — How do Guards differ from middleware?

**Q:** How do Guards differ from middleware?

**A:** Middleware in NestJS is identical to Express middleware — it receives `req`, `res`, `next` and runs before the route is even resolved. It has no knowledge of which controller or handler will execute. Guards, in contrast, run *after* routing and receive an `ExecutionContext` object that exposes the target handler, the controller class, and metadata set via `@SetMetadata()` or custom decorators. This means guards can make authorization decisions based on handler-level metadata (e.g., `@Roles('admin')` decorators), while middleware cannot. Guards implement a `canActivate()` method that returns `boolean | Promise<boolean> | Observable<boolean>`. A `false` return or a thrown exception results in a `ForbiddenException` (HTTP 403) by default. Another key difference: middleware is bound per-route via the module's `configure()` method and runs in Express's middleware stack, while guards can be bound at the method, controller, or global level using `@UseGuards()`. Guards represent NestJS's separation of the "can this request proceed?" concern from the "do something with this request" concern — a decomposition you would have to invent manually in Express.
:::

::: details Q17 — What's the performance cost of REQUEST-scoped providers?

**Q:** What's the performance cost of REQUEST-scoped providers?

**A:** When a provider is marked `@Injectable({ scope: Scope.REQUEST })`, NestJS creates a new instance of that provider for every incoming request instead of reusing a singleton. The cost is threefold. First, **instantiation overhead**: the DI container must resolve the full dependency sub-tree on every request, running constructors, calling factory functions, and allocating memory. For a deep dependency graph, this can mean dozens of object allocations per request. Second, **scope infection**: any provider that depends on a request-scoped provider *must also become request-scoped*, even if it was originally a singleton. This cascading effect can turn large portions of your provider graph into per-request allocations. Third, **garbage collection pressure**: each request produces a tree of short-lived objects that must be GC'd, increasing V8's minor GC pause frequency. Benchmarks typically show 20-40% throughput degradation for request-scoped providers compared to singletons, depending on tree depth. In Node core terms, this is the cost of re-running module-level factory logic on every request instead of doing it once at startup. The alternative — `AsyncLocalStorage` for request context with singleton providers — avoids all three costs because ALS stores context on the async execution chain without creating new provider instances.
:::

::: details Q18 — How does scope "infection" propagate through the DI tree?

**Q:** How does scope "infection" propagate through the DI tree?

**A:** When Provider A (singleton) depends on Provider B (request-scoped), NestJS must promote Provider A to request-scoped. This is because a singleton is created once at startup, so it cannot hold a reference to a per-request instance — it would only ever see the first request's instance. NestJS detects this during module initialization and automatically changes A's effective scope to `REQUEST`. This propagates upward through the entire dependency chain: if Controller C depends on Provider A (now request-scoped), Controller C also becomes request-scoped. This is "scope infection" — a single request-scoped provider deep in the graph can force every provider above it to lose singleton status. The propagation is transitive and unavoidable within NestJS's DI model because constructors receive injected instances directly (not factories or proxies). You can visualize the scope as `max(own_scope, max(dependency_scopes))` — the most granular scope wins. To contain infection, inject request-scoped providers only into leaves of the graph, or restructure to use `AsyncLocalStorage` (which NestJS exposes via `ClsModule` patterns) so that the per-request data travels via the async context rather than the DI tree.
:::

::: details Q19 — When should you use AsyncLocalStorage instead of REQUEST scope?

**Q:** When should you use `AsyncLocalStorage` instead of REQUEST-scoped providers?

**A:** Use `AsyncLocalStorage` (ALS) whenever you need request-scoped *data* (user identity, correlation IDs, tenant context) but not request-scoped *instances*. ALS, introduced in Node 12 and stable since Node 16, stores context on the async execution chain itself — it piggybacks on Node's `async_hooks` to propagate a store object through all `await` points, callbacks, and event handlers within a request's async flow. You initialize the store in middleware via `als.run(store, next)`, and any provider — even a singleton — can read `als.getStore()` to access request-specific data. This avoids scope infection entirely: all providers remain singletons (created once, shared across requests), and only the ALS store is per-request. The performance difference is dramatic — ALS adds roughly 5-10% overhead from async_hooks tracking, while REQUEST-scoped providers add 20-40% overhead from repeated instantiation and GC pressure. The tradeoff: ALS is implicit (any code in the async chain can access it, which can make data flow harder to trace), while REQUEST scope is explicit in the DI graph. Choose REQUEST scope only when you genuinely need a fresh *instance* per request (e.g., a stateful transaction manager that cannot be reused).

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

interface RequestContext {
  correlationId: string;
  userId?: string;
}

// Singleton — created once, shared across all requests
export const requestContext = new AsyncLocalStorage<RequestContext>();

// In middleware (runs per request):
// requestContext.run({ correlationId: crypto.randomUUID() }, next);

// In any singleton provider:
// const ctx = requestContext.getStore(); // per-request data without DI scope infection
```
:::

::: details Q20 — How do Interceptors work with RxJS Observables?

**Q:** How do Interceptors work with RxJS Observables?

**A:** Every NestJS interceptor's `intercept()` method receives an `ExecutionContext` and a `CallHandler`. Calling `next.handle()` on the `CallHandler` returns an `Observable<any>` that, when subscribed, executes the route handler and emits its return value. This design lets interceptors compose using RxJS operators. The interceptor can do work *before* calling `next.handle()` (pre-processing), and apply operators to the returned Observable (post-processing). For example, `map()` transforms the response, `tap()` adds side effects like logging, `catchError()` handles errors, and `timeout()` enforces response time limits.

```typescript
import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map, tap } from 'rxjs/operators';

export class TimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const start = Date.now();
    return next.handle().pipe(
      tap(() => {
        const ms = Date.now() - start;
        console.log(`${context.getHandler().name} took ${ms}ms`);
      }),
    );
  }
}
```

When multiple interceptors are applied, they nest like Russian dolls — the outer interceptor's `next.handle()` triggers the next interceptor, not the handler directly. The handler is only called by the innermost interceptor's `next.handle()`. This is a sophisticated abstraction over what would be raw `res.on('finish')` callbacks and response wrapping in Node core. The Observable model means NestJS interceptors can handle streaming responses and SSE natively, which simple middleware wrappers cannot.
:::

::: details Q21 — What's the difference between `@MessagePattern` and `@EventPattern`?

**Q:** What's the difference between `@MessagePattern` and `@EventPattern` in NestJS microservices?

**A:** `@MessagePattern` implements a **request-response** communication style. The sender emits a message and waits for a reply — the handler's return value is serialized and sent back to the caller. Under the hood, the transport layer (Redis, NATS, RabbitMQ, etc.) sets up a reply channel, and NestJS's `ServerProxy` manages the correlation between requests and responses. `@EventPattern` implements **fire-and-forget** (event-based) communication. The sender emits an event and does not wait for or expect a response — the handler's return value is discarded. This maps directly to the publish/subscribe pattern.

The choice between them determines the transport semantics: `@MessagePattern` requires a request-reply capable transport (or NestJS's emulation of it), while `@EventPattern` works with any pub/sub transport. In terms of Node core, `@MessagePattern` abstracts the pattern of sending a message over a TCP/IPC channel and correlating the response via a unique ID — what you would build manually with `node:net` or `child_process.send()` with callback correlation. `@EventPattern` abstracts `EventEmitter.emit()` across process/network boundaries. Use `@MessagePattern` when the caller needs a result; use `@EventPattern` for notifications, audit events, and any case where the producer should not be blocked by the consumer.
:::

::: details Q22 — How does `ExecutionContext` work and who uses it?

**Q:** How does `ExecutionContext` work and who uses it?

**A:** `ExecutionContext` extends `ArgumentsHost` and provides metadata about the current handler being executed. `ArgumentsHost` wraps the underlying transport arguments — for HTTP, it gives access to `req` and `res` via `switchToHttp()`; for WebSockets, `switchToWs()`; for RPC/microservices, `switchToRpc()`. `ExecutionContext` adds two critical methods: `getHandler()` returns a reference to the controller method that will be invoked, and `getClass()` returns the controller class. These references let you read custom metadata attached via `Reflect.getMetadata()` — the mechanism behind `@SetMetadata()` and custom decorators. Guards and interceptors are the primary consumers: a guard calls `context.getHandler()` and reads metadata (e.g., `@Roles('admin')`) to make authorization decisions; an interceptor uses it for logging or caching keyed to the handler.

```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.get<string[]>('roles', context.getHandler());
    if (!roles) return true;
    const request = context.switchToHttp().getRequest();
    return roles.includes(request.user?.role);
  }
}
```

The transport-agnostic design means the same guard works across HTTP, WebSocket, and microservice handlers — NestJS's abstraction over the fact that Node core's `node:http`, `node:net`, and `node:dgram` have completely different APIs for accessing request data.
:::

::: details Q23 — How do Pipes validate and transform parameters?

**Q:** How do Pipes validate and transform parameters in NestJS?

**A:** Pipes implement a `transform(value: any, metadata: ArgumentMetadata)` method that receives the raw parameter value and metadata describing where it came from (type: `'body'`, `'query'`, `'param'`, `'custom'`; the metatype class if available; and the parameter name). The pipe can return a transformed value (which replaces the original in the handler's arguments) or throw an exception (typically `BadRequestException`) to reject the input. NestJS's built-in `ValidationPipe` uses `class-transformer` to instantiate a DTO class from the plain object, then runs `class-validator` decorators against the instance. If validation fails, it throws a `BadRequestException` with the validation errors.

```typescript
import { PipeTransform, Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class ParseIntPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      throw new BadRequestException(`"${value}" is not an integer`);
    }
    return parsed; // handler receives a number, not a string
  }
}

// Usage: @Get(':id') findOne(@Param('id', ParseIntPipe) id: number)
```

Pipes run *after* guards but *before* the handler, giving you a validation+transformation layer that Express lacks entirely — in Express, you either validate inside the handler or use middleware that cannot target individual parameters. The `metatype` in `ArgumentMetadata` comes from `emitDecoratorMetadata`, connecting pipes back to TypeScript's type system. At the Node core level, pipes replace the manual `parseInt(req.params.id)` and `if (!valid) res.status(400)` boilerplate that every raw `node:http` handler needs.
:::

::: details Q24 — What are the four custom provider types and when to use each?

**Q:** What are the four custom provider types in NestJS and when should you use each?

**A:** NestJS supports four provider registration forms beyond the standard class provider:

**1. Value providers (`useValue`):** Supply a pre-existing object or constant. Used for configuration objects, mock implementations in tests, or external library instances that are not classes. The container stores and injects the exact value given.

**2. Factory providers (`useFactory`):** Supply a factory function that the container calls to create the instance. The function can be `async` and can inject other providers via the `inject` array. Used when instantiation requires async work (database connection), conditional logic, or external configuration.

**3. Class providers (`useClass`):** Supply an alternative class to instantiate for a given token. Used for environment-specific implementations — e.g., `provide: ConfigService, useClass: process.env.NODE_ENV === 'test' ? MockConfigService : RealConfigService`.

**4. Alias providers (`useExisting`):** Create an alias token that resolves to an already-registered provider. Used when you want multiple injection tokens to resolve to the same singleton instance — e.g., making `'LEGACY_SERVICE'` point to the same instance as `NewService`.

```typescript
const providers = [
  { provide: 'API_KEY', useValue: process.env.API_KEY },
  { provide: DatabaseService, useFactory: async (config: ConfigService) => {
      const conn = await createConnection(config.get('DB_URL'));
      return new DatabaseService(conn);
    }, inject: [ConfigService],
  },
  { provide: LoggerService, useClass: process.env.NODE_ENV === 'test'
      ? SilentLogger : PinoLogger },
  { provide: 'LEGACY_LOGGER', useExisting: LoggerService },
];
```

All four map to what you would do manually in Node.js with factory functions, conditional `require`/`import`, and module-level singletons. NestJS's contribution is making these patterns declarative, lazy-resolvable, and scope-aware within the DI container.
:::

::: details Q25 — How do Exception Filters catch and transform errors?

**Q:** How do Exception Filters catch and transform errors in NestJS?

**A:** Exception filters implement a `catch(exception: T, host: ArgumentsHost)` method and are decorated with `@Catch(ExceptionType)` to declare which exception classes they handle. When any layer in the request pipeline throws (or rejects a promise), NestJS's exception zone catches it and walks the filter chain — from the most specific (method-bound) to the least specific (global) — looking for a filter whose `@Catch` type matches the thrown exception via `instanceof`. The default `BaseExceptionFilter` handles `HttpException` and its subclasses, mapping them to the appropriate HTTP status code and response body. Unrecognized exceptions become `500 Internal Server Error`.

```typescript
import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const status = exception.getStatus();

    response.status(status).json({
      statusCode: status,
      message: exception.message,
      timestamp: new Date().toISOString(),
    });
  }
}
```

Filters can be bound at three levels: method (`@UseFilters()`), controller, or globally (`app.useGlobalFilters()`). A filter bound to a specific exception type only fires for that type and its subclasses — `@Catch(NotFoundException)` will not fire for `BadRequestException`. `@Catch()` with no arguments catches everything. This is NestJS's structured replacement for Express's 4-arity error middleware pattern. The key improvement: Express error middleware gets a generic `err` with no type discrimination mechanism, while NestJS filters dispatch by exception class, enabling clean separation of error handling logic (validation errors vs auth errors vs database errors). At the Node core level, this replaces the `try/catch` around your `requestListener` and the manual `res.writeHead(500)` response formatting.
:::
