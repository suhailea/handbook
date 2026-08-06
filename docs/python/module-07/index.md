---
title: Module 7 — Concurrency
outline: deep
---

# Module 7 — Concurrency

This is the deepest module in the Python track. Concurrency is where interviews separate senior engineers from mid-level ones, and where production systems either scale gracefully or collapse under load. Every page here follows the dual-format rule: plain-English intuition first, then full mechanical depth.

## What You'll Learn

- **Why Python has the GIL** and exactly what it does and does not prevent
- **Threading** as a concurrency tool for I/O-bound work, including every synchronization primitive
- **Multiprocessing** for true CPU parallelism, with IPC, shared memory, and the cost model
- **asyncio** from first principles: coroutines, the event loop, tasks, structured concurrency
- **concurrent.futures** as the unified high-level API that wraps threads and processes behind a single interface
- How to **choose** between threading, multiprocessing, and asyncio for any given workload
- The **free-threaded CPython** future (PEP 703) and what it changes

## Pages in This Module

1. [The GIL — Global Interpreter Lock](./01-gil.md) — the single most-asked Python interview topic
2. [Threading — Concurrency for I/O](./02-threading.md) — threads, locks, pools, and when they help
3. [Multiprocessing — True Parallelism](./03-multiprocessing.md) — separate processes, IPC, shared memory
4. [asyncio — Async/Await from Scratch](./04-asyncio.md) — single-threaded concurrency done right
5. [concurrent.futures — Unified Executor API](./05-concurrent-futures.md) — the high-level abstraction over threads and processes

## Prerequisites

You should be comfortable with everything in Modules 1-6 before starting here. In particular:

- **[Module 1 — Python Fundamentals](/python/module-01/):** functions, classes, context managers
- **[Module 2 — Data Model](/python/module-02/):** how Python objects work in memory, reference counting
- **[Module 3 — Functions & Closures](/python/module-03/):** first-class functions, closures
- **[Module 4 — Iterators & Generators](/python/module-04/):** the iterator protocol, `yield`, generator-based coroutines (historical context for asyncio)
- **[Module 5 — Error Handling](/python/module-05/):** exception semantics (critical for concurrent error propagation)
- **[Module 6 — Memory & GC](/python/module-06/):** reference counting and the cycle collector (directly relevant to why the GIL exists)

## How to Work Through This Module

Start with the GIL page — it sets the context for everything else. Then read threading and multiprocessing as a pair (they solve the same problem differently). Read asyncio next. Finish with concurrent.futures, which unifies the threading and multiprocessing APIs. The [summary](./summary.md) at the end ties the mental models together and gives you a decision flowchart.
