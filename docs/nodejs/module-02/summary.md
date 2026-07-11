---
title: "Module 2 Summary"
outline: deep
---

# Module 2 — The Event Loop: Summary

Module 2 is the conceptual core of Node.js. Everything async — HTTP, streams, timers, file I/O — runs through this machinery.

## Mental Models Gained

- **The event loop is a phase machine, not a simple queue.** Six phases execute in a fixed order (timers → pending → idle/prepare → poll → check → close). Microtasks drain between every phase. Understanding the phase order explains why `setImmediate` and `setTimeout(fn, 0)` have different behavior depending on context.
- **The poll phase is where Node lives.** Most of the time, the loop is parked in the poll phase, waiting for I/O from the OS kernel (via epoll/kqueue/IOCP). When I/O arrives, callbacks fire. When timers are due, the loop moves on. This is why Node is efficient with many concurrent connections — it's waiting, not spinning.
- **Microtasks cut the line.** `process.nextTick` and `queueMicrotask` (including promise callbacks) run between phases, not within them. Recursive microtasks can starve I/O indefinitely. Prefer `setImmediate` when you want to yield to I/O.
- **The threadpool is the hidden bottleneck.** File system ops, `dns.lookup`, crypto, and zlib all share 4 threads by default. Threadpool exhaustion looks like "everything is slow" even though CPU is idle. `dns.lookup` competing with `fs` operations is a classic production surprise.
- **Event loop delay and ELU are your SLO metrics.** `monitorEventLoopDelay` measures how long callbacks wait to run. `eventLoopUtilization()` measures busy vs idle time. These are more meaningful than CPU percentage for Node.js services.

## Self-Assessment Checklist

### 2.1 — libuv Phases
- [ ] Can you draw the six-phase cycle from memory with microtask drain points?
- [ ] Can you explain what the poll phase does and how it decides when to block?
- [ ] Can you predict the output of a `setTimeout` vs `setImmediate` vs `Promise.then` vs `nextTick` ordering puzzle?
- [ ] Do you know the relationship between libuv and the OS kernel (epoll/kqueue)?

### 2.2 — nextTick vs queueMicrotask vs setImmediate
- [ ] Can you rank the execution order: nextTick > microtask/promise > setImmediate > setTimeout?
- [ ] Can you explain the starvation problem with recursive `nextTick`?
- [ ] Do you understand when `setTimeout(fn, 0)` vs `setImmediate` order is non-deterministic vs deterministic?
- [ ] Can you justify when to use each scheduling mechanism?

### 2.3 — Blocking the Loop
- [ ] Can you explain what "blocking" means and its symptoms (latency spikes, health check failures)?
- [ ] Can you use `monitorEventLoopDelay` and `eventLoopUtilization` to detect problems?
- [ ] Can you list 3 strategies to avoid blocking (worker_threads, partitioning, streaming)?
- [ ] Can you identify common blockers (large JSON.parse, sync crypto, ReDoS)?

### 2.4 — The libuv Threadpool
- [ ] Can you list which operations use the threadpool and which don't?
- [ ] Can you explain why `dns.lookup` uses the threadpool but `dns.resolve` doesn't?
- [ ] Can you diagnose threadpool exhaustion (symptoms: slow fs + slow DNS, idle CPU)?
- [ ] Do you know how to tune `UV_THREADPOOL_SIZE` and its constraints?

## What's Next

[Module 3 — Async Patterns & Error Semantics](/nodejs/module-03/) builds on the event loop foundation to cover promises, cancellation, async context tracking, and error handling — the patterns you use daily on top of this machinery.
