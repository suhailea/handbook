---
title: "Module 3 Summary"
outline: deep
---

# Module 3 — Async Patterns & Error Semantics: Summary

Module 3 is the densest module in the handbook. It covers how async work is scheduled, cancelled, tracked, and how errors propagate through all of it.

## Mental Models Gained

- **Promises are state machines, microtasks are their execution mechanism.** A promise transitions from pending to settled exactly once. The `.then()` callback runs as a microtask — which means it always runs before the next I/O callback but can starve the event loop if you chain thousands synchronously.
- **Unhandled rejections are crashes, not warnings.** Since Node 15, an unhandled rejection terminates the process. The most insidious source: starting async operations in parallel but awaiting them sequentially. Always use `Promise.all()` for concurrent work.
- **Cancellation is cooperative.** `AbortController` provides a cancel button; `AbortSignal` is the lamp the worker checks. The system only works if the code doing the work actually listens for the signal. This is fundamentally different from thread interruption.
- **Push vs pull: EventEmitter vs async iteration.** EventEmitter pushes events synchronously to all listeners — great for fan-out, dangerous for backpressure. Async iteration lets the consumer pull at its own pace — great for serial processing, natural backpressure. Never use an async function as an EventEmitter listener without understanding that the promise is discarded.
- **AsyncLocalStorage is the clipboard that follows the patient.** It carries request-scoped data through the async call chain without threading arguments through every function. Built on `async_hooks`, it has measurable cost but far less than REQUEST-scoped DI.
- **Crash on bugs, handle expected failures.** Operational errors (network timeout, file not found) get graceful handling. Programmer errors (TypeError, null deref) should crash the process — the orchestrator will restart a clean instance. Never swallow errors silently.

## Self-Assessment Checklist

### 3.1 — Promise Internals & Combinators
- [ ] Can you explain the microtask scheduling that happens when a promise resolves?
- [ ] Do you know the difference between `Promise.all`, `allSettled`, `race`, and `any`?
- [ ] Can you predict the output order of a nested promise/microtask puzzle?

### 3.2 — Unhandled Rejections
- [ ] Can you explain the parallel-start/sequential-await trap?
- [ ] Do you know what `--unhandled-rejections=throw` does and why it's the default since Node 15?
- [ ] Can you describe the detection window for unhandled rejections?

### 3.3 — AbortController & AbortSignal
- [ ] Can you build a cancellable async operation using AbortSignal?
- [ ] Do you know how `AbortSignal.timeout()` and `AbortSignal.any()` work?
- [ ] Can you explain the memory leak risk with signal listeners and how to prevent it?

### 3.4 — Async Iteration vs EventEmitter
- [ ] Can you explain why `emit()` is synchronous and what that implies?
- [ ] Do you understand the async-listener trap (async function as event handler)?
- [ ] Can you convert an EventEmitter to an AsyncIterator using `on()` from `node:events`?

### 3.5 — AsyncLocalStorage & async_hooks
- [ ] Can you implement request-scoped correlation IDs with AsyncLocalStorage?
- [ ] Do you know where async context can break and how to fix it with `AsyncResource.bind`?
- [ ] Can you explain the performance cost trade-off of async_hooks?

### 3.6 — Error Doctrine
- [ ] Can you classify a given error as operational vs programmer and justify your choice?
- [ ] Do you know how to use `Error.cause` for error wrapping?
- [ ] Can you explain why crash-on-bug is the right strategy in containerized environments?

## What's Next

[Module 4 — Buffers, Streams & Backpressure](/nodejs/module-04/) takes the async patterns from this module and applies them to data flow — how Node moves bytes efficiently with constant memory, from files to HTTP responses to LLM token streams.
