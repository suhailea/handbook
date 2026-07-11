---
title: Node.js Crash Sheet
outline: deep
---

# Node.js Crash Sheet

Rapid-review bullets for Node.js backend interviews. Each bullet links to its full page for the deep dive.

> **How to use:** Tier 1 = must-know (asked in almost every interview). Tier 2 = frequently asked. Tier 3 = differentiators that impress.

---

## Tier 1 — Must Know

### The Runtime ([full page](/nodejs/module-01/01-what-node-is))
- Node = **V8** (JS engine) + **libuv** (event loop, async I/O) + **bindings** (bridge JS ↔ C++)
- Single-threaded for JS execution; libuv uses a threadpool (default 4 threads) for blocking ops like `fs` and `dns.lookup`
- Native TypeScript support via type stripping since Node 22 (`--experimental-strip-types`, stable in 23+)
- `node:` prefix for core modules is the modern convention — makes it unambiguous vs npm packages

### Process Lifecycle ([full page](/nodejs/module-01/02-process-lifecycle))
- Exit code 0 = success, 1 = uncaught exception, 12 = invalid debug arg, 13 = unfinished top-level await
- `process.exit()` skips cleanup and pending I/O — prefer letting the event loop drain
- `beforeExit` fires when loop is empty (can schedule more work); `exit` is synchronous-only, last chance
- SIGTERM = polite shutdown request (K8s sends this); SIGINT = Ctrl+C; SIGKILL = cannot catch
- **PID 1 trap:** Node as PID 1 in containers doesn't forward signals — use `tini` or `docker init`

### Unhandled Rejections ([full page](/nodejs/module-03/02-unhandled-rejections))
- Since Node 15: unhandled rejection = **process crash** (`--unhandled-rejections=throw` is default)
- **The parallel-start/sequential-await trap:** `const a = f(); const b = g(); await a; await b;` — if `b` rejects while `a` is pending, the rejection is unhandled
- Fix: always `await Promise.all([a, b])` for concurrent work
- `unhandledRejection` event is the last-chance handler — log and crash, don't swallow

### Error Doctrine ([full page](/nodejs/module-03/06-error-doctrine))
- **Operational errors** (network timeout, file not found) → handle gracefully
- **Programmer errors** (TypeError, null deref) → crash the process, let the orchestrator restart
- `Error.cause` (Node 16.9+) for error wrapping — preserves the full chain
- Never: empty `catch {}`, returning error codes instead of throwing, catching errors you can't handle

## Tier 2 — Frequently Asked

### Promise Internals ([full page](/nodejs/module-03/01-promise-internals))
- Promise = state machine: pending → fulfilled/rejected (settled once, immutable)
- `.then()` callbacks run as **microtasks** — always before next I/O callback
- `Promise.all` = fail-fast; `Promise.allSettled` = never short-circuits; `Promise.race` = first settled; `Promise.any` = first fulfilled
- Each `.then()` returns a NEW promise — the return value determines its resolution

### AbortController ([full page](/nodejs/module-03/03-abort-controller))
- **Cooperative cancellation:** AbortController = cancel button, AbortSignal = lamp the worker checks
- `AbortSignal.timeout(ms)` auto-aborts (Node 17.3+); `AbortSignal.any(signals)` composes signals (Node 20+)
- Accepted by: `fetch`, `fs.readFile`, `setTimeout` (timers/promises), `stream.pipeline`, `EventEmitter.on`
- Watch for listener leaks — use `{ once: true }` on signal listeners

### Async Iteration vs EventEmitter ([full page](/nodejs/module-03/04-async-iteration-vs-eventemitter))
- EventEmitter = **push** (synchronous `emit`, fan-out); Async iteration = **pull** (consumer-paced, backpressure)
- `'error'` event with no listener → **process crash** (by design)
- **Async listener trap:** `emitter.on('data', async fn)` — the promise is NOT awaited; rejection = unhandled
- `on(emitter, event)` from `node:events` converts to AsyncIterator with proper error handling

## Tier 3 — Differentiators

### AsyncLocalStorage ([full page](/nodejs/module-03/05-async-local-storage))
- Carries request-scoped data through async chains without argument threading
- `als.run(store, callback)` → `als.getStore()` anywhere in the chain
- Built on `async_hooks` — ~8-15% overhead, but cheaper than REQUEST-scoped DI
- Context can break in native C++ addons — fix with `AsyncResource.bind()`
- Real uses: correlation IDs, tenant isolation, OpenTelemetry context propagation

---

*Bullets for Modules 2, 4–10 will be added as those pages are completed.*
