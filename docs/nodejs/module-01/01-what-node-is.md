---
title: What Node Actually Is
outline: deep
---

# What Node Actually Is

> **Interview weight:** High -- expect this in system-design rounds and "explain the runtime" questions.
> **Node version notes:** Examples target Node 22+. Native TypeScript (type stripping) is `--experimental-strip-types` in Node 22, stable by default in Node 23.4+.
> **Prerequisites:** Comfortable with JavaScript fundamentals. Familiarity with C/C++ is helpful but not required.

## 🗣️ In Plain English

::: tip In Plain English
Imagine a restaurant with a single waiter but a large kitchen staff.

The waiter is your JavaScript thread. There is exactly one of them. They take orders from customers (your code), write each order on a ticket, and slide it through the kitchen window. They never walk into the kitchen to cook anything themselves -- they turn around immediately and take the next customer's order.

The kitchen is **libuv**. It has multiple cooks (a thread pool, plus the operating system's own async facilities). When a cook finishes a dish -- a file has been read, a DNS lookup has resolved, a timer has fired -- they place the plate on the pass. The waiter checks the pass between customers, picks up the finished plate, and delivers it to whoever ordered it (your callback, your `.then`, your `await`).

But the waiter doesn't speak Kitchen. They speak JavaScript. So there is a **translation layer** -- a set of bilingual staff standing at the kitchen window. These are the **bindings** (also called the "Node API" or "N-API"). When your code calls `fs.readFile`, the waiter hands the ticket to a translator, who rewrites it into instructions the kitchen understands (C/C++ system calls). When the dish comes back, the translator converts the result into something the waiter can carry (a JavaScript `Buffer`, an error object, etc.).

Finally, the waiter's brain -- the part that actually understands the tickets, does arithmetic, and remembers variable names -- is **V8**, Google's JavaScript engine. V8 doesn't know anything about files, networks, or timers. It only knows how to parse and execute JavaScript (and now, with type stripping, TypeScript). Everything "Node-ish" -- I/O, the event loop, native modules -- lives outside V8, in libuv and the bindings.

So Node.js is three things bolted together: **V8** (the brain), **libuv** (the kitchen), and **bindings** (the translators). One waiter, many cooks, a well-defined contract between them. That single-threaded-but-asynchronous architecture is what makes Node excellent at handling thousands of concurrent connections and terrible at crunching prime numbers on the main thread.
:::

## ⚙️ Under the Hood

### The Three Pillars

| Component | Language | Responsibility | Source |
|-----------|----------|----------------|--------|
| **V8** | C++ | Parses, compiles (JIT via TurboFan), and executes JavaScript. Manages the heap, garbage collection, and the call stack. | [v8.dev](https://v8.dev) |
| **libuv** | C | Provides the event loop, async I/O (file system, DNS, TCP/UDP), a fixed-size thread pool (default 4 threads), and cross-platform abstractions over `epoll`, `kqueue`, `IOCP`. | [libuv.org](https://libuv.org) |
| **Bindings** | C++ | The glue. Each binding exposes a C/C++ capability to JavaScript. `node::fs`, `node::crypto`, `node::http_parser`, etc. Registered via the internal `NODE_BINDING` macro or the public N-API (`node-api.h`). | Node.js source: `src/` directory |

Node also ships an extensive **standard library** written in JavaScript/TypeScript (`lib/` in the source tree). When you `import { readFile } from 'node:fs/promises'`, you are loading JS code that ultimately calls a C++ binding.

### How V8 Works (the Short Version)

1. **Parsing** -- Source text is parsed into an Abstract Syntax Tree (AST).
2. **Ignition** -- The AST is compiled to bytecode and executed by V8's interpreter.
3. **TurboFan** -- Hot functions are identified by profiling counters and recompiled into optimized machine code.
4. **Deoptimization** -- If an assumption TurboFan made is violated (e.g., a variable changes type), the function is "deoptimized" back to bytecode.

V8 has no concept of `setTimeout`, `fetch`, `fs`, or any I/O. Those are provided by the **embedder** -- in a browser that embedder is Blink; in Node it is libuv + bindings.

### How libuv Works

libuv runs a loop (the "event loop") that proceeds through distinct **phases** on each tick:

```
   ┌───────────────────────────┐
┌─>│        timers              │  ← setTimeout, setInterval callbacks
│  └───────────┬───────────────┘
│  ┌───────────┴───────────────┐
│  │     pending callbacks      │  ← I/O callbacks deferred from previous tick
│  └───────────┬───────────────┘
│  ┌───────────┴───────────────┐
│  │       idle, prepare        │  ← internal use
│  └───────────┬───────────────┘
│  ┌───────────┴───────────────┐
│  │         poll               │  ← retrieve new I/O events; execute I/O callbacks
│  └───────────┬───────────────┘
│  ┌───────────┴───────────────┐
│  │         check              │  ← setImmediate callbacks
│  └───────────┬───────────────┘
│  ┌───────────┴───────────────┐
│  │    close callbacks         │  ← socket.on('close', ...)
│  └───────────┴───────────────┘
│              │
└──────────────┘
```

Between each phase, Node drains the **microtask queue** (resolved promises, `queueMicrotask`) and the **`process.nextTick` queue** (which fires before microtasks, per the Node.js docs).

The thread pool (default size controlled by `UV_THREADPOOL_SIZE`, max 1024) handles operations that don't have good OS-level async support: file system I/O on most platforms, DNS `getaddrinfo`, some crypto operations, and zlib.

### The Binding Layer -- How JS Crosses into C++

When you write:

```typescript
// run: node --experimental-strip-types binding-demo.ts  (Node 22)
// run: node binding-demo.ts                             (Node 23.4+)
import { readFile } from 'node:fs/promises';

const content: string = await readFile('./package.json', 'utf-8');
console.log(`Read ${content.length} characters`);
```

Here is what actually happens, step by step:

1. **JS standard library** -- `node:fs/promises` is a JS module in Node's `lib/` directory. The `readFile` function validates arguments, creates a `FileHandle` if needed, and calls an internal binding.
2. **Binding call** -- The JS code calls `binding.read(...)`, which is a C++ function registered via `NODE_BINDING`. V8 marshals the JS arguments into C++ types.
3. **libuv request** -- The C++ binding creates a `uv_fs_t` request struct and calls `uv_fs_read()`. Because this is the *async* variant, libuv posts the work to its thread pool.
4. **Thread pool execution** -- A worker thread performs the blocking `read()` syscall against the OS kernel.
5. **Completion** -- The worker thread finishes and signals the event loop. On the next poll phase, libuv invokes the C++ completion callback.
6. **Back to JS** -- The C++ callback converts the raw bytes into a V8 `Buffer` (or string, since we passed `'utf-8'`), and resolves the JS promise.

The entire round trip typically takes microseconds for cached files, milliseconds for disk reads. The critical design choice: **the main thread never blocks on I/O**. It delegates, continues executing other JS, and picks up results later.

### The Boot Sequence

What happens from the moment you type `node app.ts` to the first line of your code executing?

| Step | What happens |
|------|-------------|
| 1. **Process start** | The OS loads the `node` binary (a C++ executable). `main()` in `src/node_main.cc` is called. |
| 2. **V8 initialization** | V8 platform is created, the V8 isolate (an isolated instance of the engine) is initialized, the heap is set up. |
| 3. **libuv loop creation** | `uv_default_loop()` creates the event loop. |
| 4. **Node environment setup** | Internal C++ bindings are registered. The `process` object, `Buffer`, timers, and other globals are created and injected into V8's global scope. |
| 5. **Bootstrap scripts** | Node runs internal JS bootstrap files (`lib/internal/bootstrap/`) that set up `require`, the module system, `console`, and other APIs. |
| 6. **TypeScript detection** (Node 22+) | If the entry file ends in `.ts`, `.mts`, or `.cts`, Node invokes the **type-stripping** transform (see below) to remove type annotations before handing source to V8. |
| 7. **Module loading** | The entry module is resolved and loaded (CJS via `require` or ESM via the module loader). Imports are recursively resolved. |
| 8. **Top-level execution** | Your code runs. Synchronous code executes immediately. Async operations (timers, I/O) are registered with libuv. |
| 9. **Event loop starts** | `uv_run()` begins ticking. The process stays alive as long as there are active handles or requests (pending timers, open sockets, etc.). |
| 10. **Exit** | When the event loop drains (no more work), `process.exit()` is called (or the process terminates). `'exit'` event fires. Cleanup runs. |

### Native TypeScript via Type Stripping

Since Node 22 (behind `--experimental-strip-types`) and stable in Node 23.4+, Node can run `.ts` files directly. Here is what that means mechanically:

- Node uses a **lightweight transform** (powered by [amaro](https://github.com/nicolo-ribaudo/amaro), which wraps SWC) that **strips type annotations** from the source text. It does *not* perform type checking and does *not* support TypeScript features that require code emission (enums with initializers, namespaces with runtime code, legacy decorators).
- The transform is **syntax-only**: it removes `: string`, `interface Foo {}`, `type Bar = ...`, generic brackets, etc. The output is valid JavaScript with the same semantics.
- Source maps are preserved so stack traces point to the correct `.ts` line.

```typescript
// run: node --experimental-strip-types strip-demo.ts  (Node 22)
// run: node strip-demo.ts                             (Node 23.4+)

interface ServerConfig {
  port: number;
  host: string;
  debug?: boolean;
}

function describeConfig(config: ServerConfig): string {
  return `Server at ${config.host}:${config.port} (debug=${config.debug ?? false})`;
}

const cfg: ServerConfig = { port: 3000, host: 'localhost', debug: true };
console.log(describeConfig(cfg));
// → Server at localhost:3000 (debug=true)
```

What gets stripped before V8 sees it (conceptually):

```javascript
// What V8 actually executes (after type stripping):

function describeConfig(config        ) {
  return `Server at ${config.host}:${config.port} (debug=${config.debug ?? false})`;
}

const cfg          = { port: 3000, host: 'localhost', debug: true };
console.log(describeConfig(cfg));
```

Note the whitespace padding -- the transform replaces type annotations with spaces to preserve source positions without needing a full source map rewrite.

**What does NOT work with type stripping:**

| Feature | Why | Workaround |
|---------|-----|-----------|
| `enum Foo { A = 'x' }` (const enums are fine) | Requires code generation, not just removal | Use `as const` objects |
| `namespace Ns { export function f() {} }` | Emits runtime code | Use ES modules |
| Legacy experimental decorators | Needs a full transform pipeline | Use standard TC39 decorators (Stage 3) |
| `import Foo = require('...')` | TypeScript-specific import syntax | Use `import` / `require` |

### How Node Differs from Browser JS

Both environments run V8 (in Chrome-based browsers) or equivalent engines, but the platform APIs are entirely different:

| Concept | Browser | Node.js |
|---------|---------|---------|
| Global object | `window` / `self` / `globalThis` | `global` / `globalThis` (no `window`) |
| DOM | Full DOM API (`document`, `Element`, etc.) | None. No DOM, no `document`. |
| Module system | `<script type="module">`, import maps | CJS (`require`), ESM (`import`), `node:` built-ins |
| I/O | `fetch`, `XMLHttpRequest`, Web Streams | `node:fs`, `node:net`, `node:http`, `node:stream` |
| Timers | `setTimeout`, `requestAnimationFrame` | `setTimeout`, `setImmediate` (no `requestAnimationFrame`) |
| Binary data | `ArrayBuffer`, `Uint8Array`, `Blob` | `Buffer` (subclass of `Uint8Array`), `ArrayBuffer`, `Blob` (Node 18+) |
| Threads | Web Workers (separate global) | `worker_threads` (shared `ArrayBuffer` possible), child processes |
| Process info | Limited (`navigator.userAgent`) | `process.env`, `process.argv`, `process.pid`, signals |
| Security model | Same-origin policy, CORS, CSP | Full OS access (file system, network, child processes) |

A quick demonstration:

```typescript
// run: node --experimental-strip-types env-demo.ts  (Node 22)
// run: node env-demo.ts                             (Node 23.4+)

// These exist in Node, not in browsers:
console.log('PID:', process.pid);
console.log('Node version:', process.version);
console.log('Platform:', process.platform);
console.log('Arch:', process.arch);
console.log('CWD:', process.cwd());
console.log('Memory usage:', JSON.stringify(process.memoryUsage(), null, 2));

// This exists in both Node 18+ and browsers:
const response: Response = await fetch('https://httpbin.org/get');
console.log('fetch status:', response.status);
```

### Seeing the Architecture in Action

This example ties together V8, libuv, and the binding layer in a single script:

```typescript
// run: node --experimental-strip-types architecture-demo.ts  (Node 22)
// run: node architecture-demo.ts                             (Node 23.4+)
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

// 1. V8 executes this synchronous JS immediately
const filePath: string = resolve('./package.json');
console.log('[V8] Resolved path:', filePath);

// 2. readFile delegates to libuv's threadpool via the fs binding
const t0: number = performance.now();
const data: string = await readFile(filePath, 'utf-8');
const readMs: number = performance.now() - t0;
console.log(`[libuv → binding → V8] Read ${data.length} chars in ${readMs.toFixed(2)}ms`);

// 3. crypto binding delegates to OpenSSL (via libuv threadpool for large payloads)
const hash: string = createHash('sha256').update(data).digest('hex');
console.log(`[binding: crypto] SHA-256: ${hash}`);

// 4. Back to pure V8: JSON parsing, no I/O involved
const parsed: Record<string, unknown> = JSON.parse(data);
console.log(`[V8] Package name: ${(parsed as { name?: string }).name ?? 'unknown'}`);
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

### 1. Blocking the Event Loop with CPU-Intensive Work

**Symptom:** All HTTP request latencies spike simultaneously. Health checks time out. The process appears alive but unresponsive.

**Root cause:** A synchronous, CPU-bound operation (JSON parsing a 50 MB payload, image resizing, regex backtracking) monopolizes V8's single thread. While V8 is grinding through that work, the event loop cannot advance -- no callbacks fire, no new connections are accepted.

**Diagnosis:** Use `--prof` to generate a V8 CPU profile, or attach the Chrome DevTools profiler via `node --inspect`. Look for long-running synchronous frames. In production, monitor event loop lag with `monitorEventLoopDelay()` (Node 12+) -- sustained lag above 100ms is a red flag.

**Fix:** Offload heavy computation to a `worker_threads` worker, a child process, or an external service. For JSON specifically, consider streaming parsers.

### 2. Thread Pool Exhaustion

**Symptom:** File system operations and DNS lookups become extremely slow, even though CPU and memory look normal. `getaddrinfo ENOTFOUND` errors appear intermittently.

**Root cause:** libuv's default thread pool has only 4 threads. If your application does many concurrent `fs` calls or DNS lookups, requests queue up waiting for a free thread. DNS resolution uses the thread pool (not async OS APIs), so it competes with `fs` for the same threads.

**Diagnosis:** Set `UV_THREADPOOL_SIZE=128` and see if latency drops. Monitor the event loop's `poll` phase duration. A growing gap between "I/O requested" and "I/O callback fired" indicates pool saturation.

**Fix:** Increase `UV_THREADPOOL_SIZE` (max 1024, set it **before** the process starts -- it's read once). Better yet, reduce concurrent fs operations with a concurrency limiter, or use connection pooling for DNS-heavy workloads.

### 3. Confusing Type Stripping with Type Checking

**Symptom:** A `.ts` file runs without errors under `node --experimental-strip-types`, but the code has a type error that causes a silent runtime bug (e.g., passing a string where a number was expected).

**Root cause:** Node's type stripping literally removes type annotations. It does not run `tsc`. Your code gets no type safety at runtime -- types are purely cosmetic from Node's perspective.

**Diagnosis:** If something behaves unexpectedly, run `tsc --noEmit` separately. CI pipelines should **always** include a dedicated type-check step.

**Fix:** Treat `node file.ts` as a convenience for development. Always run `tsc --noEmit` (or equivalent: `vue-tsc`, `astro check`, `biome check`) in CI. Never rely on Node's type stripping to catch errors.

### 4. Assuming `node:` Built-ins Are Pure JavaScript

**Symptom:** A mock of `fs.readFile` in a test suite doesn't behave like the real thing, or a polyfill for `Buffer` has subtle differences from Node's `Buffer`.

**Root cause:** Many `node:` modules are thin JS wrappers around C++ bindings. `Buffer` is a C++ object exposed to JS. `crypto.randomBytes` calls OpenSSL. Their behavior is defined by the C++ implementation, not the JS layer. Mocking the JS surface may not capture edge cases (error codes, partial reads, encoding quirks).

**Diagnosis:** When a mock diverges from production behavior, check whether the real implementation delegates to a C++ binding (search for `internalBinding(...)` in the Node.js source `lib/` directory).

**Fix:** Prefer integration tests for I/O-heavy code. When mocking is necessary, use the real module in at least one test scenario to catch divergence.

:::

## 🎯 Checkpoint

::: details Question 1 -- V8's boundaries
**Q:** If V8 is "just" a JavaScript engine, how does `setTimeout` work? V8 doesn't have timers. Walk through the full path from a `setTimeout` call to the callback firing.

**A:** `setTimeout` is **not** part of V8. It is a function injected into V8's global scope by Node during bootstrap (step 4 of the boot sequence). When you call `setTimeout(fn, 1000)`:

1. The JS-side timer module validates arguments and creates a timer entry in an internal data structure (a priority queue, sorted by expiration time).
2. It calls a C++ binding that creates a `uv_timer_t` handle on libuv's event loop and calls `uv_timer_start()` with the timeout duration.
3. On each event loop iteration, the **timers phase** checks whether any `uv_timer_t` handles have expired. When one has, libuv calls the C++ callback.
4. The C++ callback uses V8's API to call the original JS function (`fn`).

The key insight: V8 executes the callback, but libuv is responsible for knowing *when* to fire it. V8 is the execution engine; libuv is the scheduler.
:::

::: details Question 2 -- Thread pool and the event loop
**Q:** A colleague says "Node.js is single-threaded, so it can only do one thing at a time." Is that accurate? Explain with specifics.

**A:** It is a half-truth. **JavaScript execution** is single-threaded -- there is one V8 isolate running one piece of JS at a time on the main thread. But Node as a whole is **multi-threaded**:

- **libuv's thread pool** (default 4 threads, configurable up to 1024) handles blocking operations like file system I/O, DNS `getaddrinfo`, and some crypto work. These run in parallel on real OS threads.
- **libuv's async I/O** (epoll/kqueue/IOCP) handles network I/O without threads at all -- the OS kernel notifies libuv when data is ready.
- **V8's internal threads** handle garbage collection (concurrent marking, sweeping) and JIT compilation (TurboFan optimization) on background threads.
- **`worker_threads`** let you spawn additional V8 isolates for CPU-bound work.

So at any moment, a Node process may have 10+ threads running. What is single-threaded is the *JS event loop* -- your callbacks, awaits, and promise handlers execute one at a time on the main thread. That distinction matters enormously for reasoning about concurrency bugs: you will never have two JS callbacks corrupting the same variable simultaneously (no data races in JS land), but you can absolutely have ordering issues (race conditions at the async level).
:::

::: details Question 3 -- Type stripping vs. transpilation
**Q:** Your team is debating whether to drop their build step now that Node 23+ supports TypeScript natively. What trade-offs should they consider?

**A:** Type stripping is **not** a full replacement for a build step. Trade-offs:

**What you gain by dropping the build step:**
- Faster dev iteration -- no `tsc --watch` or `tsx` wrapper needed.
- Fewer dependencies (`typescript`, `ts-node`, `tsx` can be removed from dev dependencies).
- Source maps are preserved automatically (stack traces point to `.ts` lines).

**What you lose or must address:**
- **No type checking.** Node strips types; it does not validate them. You must run `tsc --noEmit` separately (in CI at minimum, ideally in a pre-commit hook or editor integration).
- **No support for emit-dependent features.** `enum` (non-const), `namespace` with runtime code, legacy decorators, and `import Foo = require(...)` will not work. If your codebase uses these, you need a transform step.
- **No path aliases.** TypeScript's `paths` in `tsconfig.json` (e.g., `@/utils`) require a resolver or bundler. Node's type stripping does not resolve aliases.
- **No downleveling.** If you target older Node versions, you cannot use syntax that those versions do not support. A build step with `target: "es2020"` would downlevel newer syntax; type stripping does not.
- **Production deployment.** Shipping `.ts` files to production means the stripping transform runs on every cold start. For serverless (Lambda, Cloud Functions) where cold start matters, pre-compiling to `.js` may still be preferable.

The pragmatic answer: for applications (servers, CLIs), dropping the build step is viable if you add a CI type-check step and don't use emit-dependent features. For libraries published to npm, you still want to emit `.js` + `.d.ts` files so consumers don't need TypeScript.
:::

## Key Mental Models

- **Three pillars, one contract:** Node is V8 (execute JS) + libuv (async I/O and event loop) + bindings (translate between them). Understanding which pillar owns a behavior tells you where to look when things break.
- **The main thread is a dispatcher, not a worker:** JS code should schedule work, not perform it. Any synchronous operation longer than a few milliseconds is stealing time from every other connection.
- **Type stripping is not type safety:** Running `.ts` files with Node gives you developer convenience, not correctness guarantees. `tsc --noEmit` is the safety net; the runtime is just an eraser.
- **The thread pool is a shared resource:** File I/O, DNS, crypto, and zlib all compete for the same (small) pool of libuv threads. Saturation in one subsystem cascades into latency in all of them.
- **Node is not "JavaScript on the server" -- it is C++ machinery with a JavaScript control plane:** The performance-critical work (I/O, crypto, HTTP parsing, compression) happens in C/C++. JavaScript orchestrates when and how that work is invoked.

## Related

- [Process Lifecycle](./02-process-lifecycle) -- what happens after boot: signals, graceful shutdown, exit codes.
- [CJS Resolution](./03-cjs-resolution) -- how `require()` finds and loads modules.
- [ESM & Interop](./04-esm-interop) -- ESM semantics in Node and how CJS and ESM coexist.
- [The Event Loop (JS Core)](/js-core/04-event-loop) -- the event loop from the JavaScript specification's perspective.
- [libuv Phases](/nodejs/module-02/01-libuv-phases) -- deep dive into each event loop phase and its real-world implications.
