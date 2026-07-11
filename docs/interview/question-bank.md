---
title: Question Bank
outline: deep
---

# Question Bank

Every Checkpoint question from across the handbook, grouped by track. Each links back to the source page where the full answer is hidden behind a details block.

> **How to use:** Work through these as interview practice. Try answering without peeking first, then check the source page for the rigorous answer.

---

## JavaScript Core

### Execution Contexts, Scopes & Hoisting — [source](/js-core/01-execution-contexts)
- What happens during the "creation phase" of an execution context?
- Why can you use a `var` variable before its declaration but not a `let`?
- What does the temporal dead zone (TDZ) actually mean at the spec level?

### Closures — [source](/js-core/02-closures)
- What exactly does V8 keep alive when a closure is formed?
- Why does `let` fix the classic closure-in-a-loop problem but `var` doesn't?
- Can closures cause memory leaks? How?

### Prototypes, `this` & Classes — [source](/js-core/03-prototypes-this-classes)
- What are the four `this` binding rules in order of precedence?
- Why can't you rebind `this` on an arrow function with `.call()`?
- What does `class` desugar to under the hood?

### The Event Loop — [source](/js-core/04-event-loop)
- What is the difference between a macrotask and a microtask?
- How does the browser event loop differ from Node's event loop?
- Can microtasks starve macrotasks? How?

### Promises & the Microtask Queue — [source](/js-core/05-promises-microtasks)
- What happens when you return a promise from a `.then()` handler?
- What is the difference between `Promise.race` and `Promise.any`?
- How does `async/await` relate to the microtask queue?

### Iterators, Generators & Async Generators — [source](/js-core/06-iterators-generators)
- What is the iteration protocol and how does `for...of` use it?
- How does two-way communication work with generators?
- When would you choose an async generator over a regular async function?

### Memory & GC (V8) — [source](/js-core/07-memory-gc)
- How does V8's generational GC work (young vs old generation)?
- What are the most common causes of memory leaks in Node.js?
- What is `WeakRef` and when would you use it?

### ES Modules — [source](/js-core/08-es-modules)
- What are "live bindings" and how do they differ from CJS value copies?
- How does top-level `await` affect module evaluation?
- Why must `import`/`export` be at the top level?

---

## Node.js Runtime

### Module 1 — The Runtime

**What Node Actually Is** — [source](/nodejs/module-01/01-what-node-is)
- What are the three pillars of Node.js architecture?
- What happens between typing `node app.ts` and your first line of code running?
- How does a `fs.readFile` call cross from JavaScript into C++?

**Process Lifecycle** — [source](/nodejs/module-01/02-process-lifecycle)
- What is exit code 137 and what causes it?
- Why doesn't `beforeExit` fire on `process.exit()` or uncaught exceptions?
- What is the PID 1 signal-forwarding problem in containers?

**CJS Resolution** — [source](/nodejs/module-01/03-cjs-resolution)
- Walk through the `require()` resolution algorithm step by step.
- What happens with circular `require()` calls?
- Why does `module.exports = x` work but `exports = x` doesn't?

**ESM & Interop** — [source](/nodejs/module-01/04-esm-interop)
- What are the constraints of `require(esm)` in Node 22+?
- Why do named imports from CJS modules sometimes fail?
- What is `import.meta.resolve` and how does it differ from `require.resolve`?

**package.json exports** — [source](/nodejs/module-01/05-package-exports)
- What is the dual-package hazard and how do you prevent it?
- How does the `"exports"` field differ from `"main"`?
- What are conditional exports and when do you need them?

### Module 2 — The Event Loop

**libuv Phases** — [source](/nodejs/module-02/01-libuv-phases)
- Name the six phases of the libuv event loop in order.
- What does the poll phase do and how does it decide when to block?
- Where do microtasks drain relative to the phase cycle?

**nextTick vs queueMicrotask vs setImmediate** — [source](/nodejs/module-02/02-nexttick-vs-queuemicrotask)
- What is the execution order of nextTick, queueMicrotask, setImmediate, and setTimeout(fn, 0)?
- How can recursive `process.nextTick` starve I/O?
- When is `setTimeout(fn, 0)` vs `setImmediate` order non-deterministic?

**Blocking the Loop** — [source](/nodejs/module-02/03-blocking-the-loop)
- What are the symptoms of a blocked event loop?
- How do you use `monitorEventLoopDelay` and ELU to detect problems?
- Name 3 strategies to avoid blocking the event loop.

**The libuv Threadpool** — [source](/nodejs/module-02/04-threadpool)
- Which operations use the libuv threadpool?
- Why does `dns.lookup` use the threadpool but `dns.resolve` doesn't?
- How do you diagnose threadpool exhaustion?

### Module 3 — Async Patterns & Error Semantics

**Promise Internals** — [source](/nodejs/module-03/01-promise-internals)
- How does microtask scheduling work when a promise resolves?
- What is the thenable assimilation protocol?
- Compare `Promise.all`, `allSettled`, `race`, and `any`.

**Unhandled Rejections** — [source](/nodejs/module-03/02-unhandled-rejections)
- Explain the parallel-start/sequential-await trap.
- What changed in Node 15 regarding unhandled rejections?
- What is the detection window for unhandled rejections?

**AbortController** — [source](/nodejs/module-03/03-abort-controller)
- Why is cancellation in Node called "cooperative"?
- What is the difference between `AbortSignal.timeout()` and `AbortSignal.any()`?
- How can AbortSignal listeners cause memory leaks?

**Async Iteration vs EventEmitter** — [source](/nodejs/module-03/04-async-iteration-vs-eventemitter)
- Why is `emitter.emit()` synchronous and what does that imply?
- What is the async-listener trap?
- How does `events.on()` provide backpressure?

**AsyncLocalStorage** — [source](/nodejs/module-03/05-async-local-storage)
- How does AsyncLocalStorage propagate context through async operations?
- Where can async context break and how do you fix it?
- What is the performance cost of async_hooks?

**Error Doctrine** — [source](/nodejs/module-03/06-error-doctrine)
- What is the difference between operational and programmer errors?
- Why should you crash on programmer errors in containerized environments?
- How does `Error.cause` work for error wrapping?

### Modules 4–10

*Questions for Modules 4–10 will appear here as those pages are finalized.*

---

## Frameworks

### Express

**The Middleware Stack** — [source](/frameworks/express/01-middleware-stack)
- What does `app.use()` build internally?
- How does `next()` work and what happens if you don't call it?
- What is Express abstracting from raw `node:http`?

**Error Handling** — [source](/frameworks/express/02-error-handling)
- Why does Express detect error middleware by parameter count?
- Why does Express 4 struggle with async errors?
- What changed in Express 5 for promise rejection handling?

### NestJS

**DI Container** — [source](/frameworks/nestjs/01-di-container)
- Why is `emitDecoratorMetadata` required for NestJS?
- How does the DI container resolve constructor dependencies?
- What are the four types of custom providers?

**Request Lifecycle** — [source](/frameworks/nestjs/02-request-lifecycle)
- Name the NestJS request pipeline stages in order.
- How does each NestJS layer map to an Express concept?
- What is the ExecutionContext and who uses it?

**Provider Scopes** — [source](/frameworks/nestjs/03-provider-scopes)
- What is the performance cost of REQUEST-scoped providers?
- How does request scope "infect" the dependency tree?
- When should you use AsyncLocalStorage instead of REQUEST scope?

**Microservices Transports** — [source](/frameworks/nestjs/04-microservices)
- What is the difference between `@MessagePattern` and `@EventPattern`?
- What are the trade-offs of NestJS's transport abstraction?
- How do hybrid applications work?

---

## System Design

### Message Queues

**Why Queues Exist** — [source](/system-design/queues/01-why-queues)
- What are the three core benefits of message queues?
- When should you NOT use a queue?

**Redis Queues & BullMQ** — [source](/system-design/queues/02-redis-bullmq)
- What Redis data structures are used for job queues?
- When would you choose Kafka over a simple Redis queue?

**Delivery Semantics** — [source](/system-design/queues/03-delivery-semantics)
- Why is exactly-once delivery "mostly a lie"?
- How do idempotency keys prevent duplicate processing?
- What is the transactional outbox pattern?

### Load Balancing

**L4 vs L7** — [source](/system-design/load-balancing/01-l4-vs-l7)
- What is the difference between L4 and L7 load balancing?
- When would you choose least-connections over round-robin?

**nginx** — [source](/system-design/load-balancing/02-nginx)
- What does the `keepalive` directive in an upstream block actually control?
- Why must you set `proxy_http_version 1.1` for upstream keepalive?

**Streaming & SSE** — [source](/system-design/load-balancing/03-streaming-sse)
- Why does nginx buffering break SSE streaming?
- How do you configure nginx for LLM token streaming?

### Microservices, Caching, Scaling

*Questions for these sections will appear as pages are finalized.*

---

*This page is maintained manually. When a new content page is added, its Checkpoint questions should be added here.*
