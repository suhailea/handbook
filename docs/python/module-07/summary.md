---
title: Module 7 Summary — Concurrency
outline: deep
---

# Module 7 Summary — Concurrency

## Mental Models Gained

1. **The GIL is a mutex on the interpreter, not on your data.** It serializes bytecode execution but does not make your code thread-safe. You still need locks for shared mutable state.

2. **I/O releases the GIL; CPU does not.** This single fact determines whether threading helps (I/O-bound) or hurts (CPU-bound).

3. **Threads share memory; processes share nothing.** Threading is cheap but requires synchronization. Multiprocessing is expensive but provides true isolation and parallelism.

4. **asyncio is cooperative concurrency.** One thread, many coroutines, zero parallelism — but near-zero overhead per concurrent I/O operation. A single blocking call poisons the entire loop.

5. **Futures are promises you must redeem.** A `Future` stores both the result and any exception. If you never call `.result()`, exceptions are silently lost.

6. **`as_completed()` gives you results in completion order; `map()` gives them in submission order.** Choose based on whether you need low latency or ordered output.

7. **Serialization is the tax on multiprocessing.** Every argument and return value crossing a process boundary must be picklable. Large objects pay a large serialization cost.

8. **Structured concurrency (TaskGroup) prevents orphaned work.** Unlike `gather()`, a `TaskGroup` cancels all tasks and cleans up resources when any task fails.

---

## Self-Assessment Checklist

Before moving to Module 8, you should be able to answer "yes" to all of these:

- [ ] I can explain what the GIL protects and why CPython has it
- [ ] I can demonstrate that CPU-bound threading is slower than sequential (and explain why)
- [ ] I can use `threading.Lock` to fix a race condition and explain what happens without it
- [ ] I can describe the difference between `fork` and `spawn` start methods and when each is dangerous
- [ ] I can send data between processes using `Queue`, `Pipe`, or `shared_memory` and know the tradeoffs
- [ ] I can write an async function, create tasks, and use `asyncio.gather()` correctly
- [ ] I can explain what `await` does mechanically (suspend, yield to loop, resume)
- [ ] I can identify a blocking call inside an async function and fix it with `asyncio.to_thread()`
- [ ] I can explain the difference between `TaskGroup` and `gather()` in error handling
- [ ] I can choose between `ThreadPoolExecutor` and `ProcessPoolExecutor` for a given workload
- [ ] I can use `as_completed()` to process results in completion order
- [ ] I can describe the free-threaded CPython changes (PEP 703) and their migration implications

---

## Quick Reference

### Concurrency Model Comparison

| Feature | `threading` | `multiprocessing` | `asyncio` |
|---------|------------|-------------------|-----------|
| **GIL impact** | Full — only one thread runs Python at a time | None — each process has its own GIL | None — single thread, no contention |
| **Best for** | I/O-bound work (network, disk, sleep) | CPU-bound work (math, image processing) | High-concurrency I/O (thousands of connections) |
| **Parallelism** | No (concurrency only) | Yes (true multi-core) | No (concurrency only) |
| **Overhead per unit** | ~8MB stack per thread | ~30-50MB per process (full interpreter) | ~1KB per coroutine |
| **Max practical units** | ~100-1000 threads | ~`os.cpu_count()` processes | ~100,000+ coroutines |
| **Data sharing** | Shared memory (with locks) | IPC (Queue, Pipe, shared_memory) | Shared memory (single thread — no locks needed) |
| **Synchronization** | Lock, RLock, Semaphore, Event, Condition, Barrier | Lock, Value, Array, Queue, shared_memory | asyncio.Lock, Semaphore, Event, Condition |
| **Error isolation** | Crash kills the thread, not the process | Crash kills only the child process | Exception in one coroutine doesn't affect others (unless using TaskGroup) |
| **Start cost** | Microseconds | Milliseconds (30-100ms for spawn) | Microseconds |
| **Ecosystem requirement** | Works with any library | Worker functions must be picklable | Requires async-compatible libraries |

### High-Level API Comparison

| API | Backed by | Returns | Best for |
|-----|----------|---------|----------|
| `ThreadPoolExecutor` | `threading` | `Future` | I/O-bound tasks, simple parallelism |
| `ProcessPoolExecutor` | `multiprocessing` | `Future` | CPU-bound tasks, true parallelism |
| `asyncio.create_task()` | Event loop | `Task` (a Future subclass) | High-concurrency async I/O |
| `asyncio.to_thread()` | `threading` + event loop | Awaitable | Bridging sync I/O into async code |
| `loop.run_in_executor()` | Either executor type | Awaitable | Bridging any executor into async code |

### Decision Flowchart

```
What kind of work?
|
+-- I/O-bound (network, disk, database)
|   |
|   +-- Need > 100 concurrent operations?
|   |   +-- Yes --> asyncio (if ecosystem supports it)
|   |   +-- No  --> ThreadPoolExecutor
|   |
|   +-- Using sync-only libraries?
|       +-- In async code --> asyncio.to_thread()
|       +-- In sync code  --> ThreadPoolExecutor
|
+-- CPU-bound (math, image processing, parsing)
|   |
|   +-- Does your library release the GIL? (numpy, hashlib)
|   |   +-- Yes --> ThreadPoolExecutor may suffice
|   |   +-- No  --> ProcessPoolExecutor
|   |
|   +-- Is per-task work > 10ms?
|       +-- Yes --> ProcessPoolExecutor
|       +-- No  --> Batch tasks or stay sequential
|
+-- Mixed (I/O + CPU)
    +-- asyncio + run_in_executor(ProcessPoolExecutor)
        or two-stage pipeline: threads for I/O, processes for CPU
```

---

## What's Next

Continue to [Module 8](/python/module-08/) to build on these concurrency foundations with real-world application patterns.

---

## Related

- [The GIL — Global Interpreter Lock](./01-gil.md)
- [Threading — Concurrency for I/O](./02-threading.md)
- [Multiprocessing — True Parallelism](./03-multiprocessing.md)
- [asyncio — Async/Await from Scratch](./04-asyncio.md)
- [concurrent.futures — Unified Executor API](./05-concurrent-futures.md)
