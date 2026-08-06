---
title: asyncio — Async/Await from Scratch
outline: deep
---

# asyncio — Async/Await from Scratch

**Interview weight:** 🔥🔥🔥 — alongside the GIL, the most probed Python concurrency topic. Interviewers test whether you understand what `async`/`await` actually does mechanically, or just use it as a recipe.

**Python version:** `asyncio` stable since 3.4. `async`/`await` syntax since 3.5. `asyncio.run()` since 3.7. `TaskGroup` since 3.11. `asyncio.to_thread()` since 3.9.

**Prerequisites:** [The GIL — Global Interpreter Lock](./01-gil.md), [Iterators & Generators](/python/module-04/) (generator-based coroutines are the historical foundation)

---

## 🗣️ In Plain English

::: tip In Plain English
asyncio is like a single chef who is incredibly organized. Instead of standing idle while the pasta boils, the chef puts the pasta on, sets a mental timer, immediately starts chopping vegetables, and when the timer goes off, drains the pasta. One chef, many dishes, no idle time — but the chef can only do ONE thing at any given instant. If a task requires heavy chopping for ten straight minutes (CPU work), everything else waits.

This chef has a notebook — the event loop. Every dish in progress is listed there with its current state: "pasta: boiling, check at 3:15", "sauce: reducing, check at 3:20", "bread: in oven, check at 3:25". The chef cycles through the notebook constantly: "Is the pasta done? No. Is the sauce done? No. Any new orders? Yes — start the salad." That's the loop.

The key insight: the chef never actually does two things simultaneously. There's no magical parallelism happening. The speed gain comes from eliminating dead time. In a traditional kitchen (synchronous code), the chef puts pasta on, then stands there watching it boil for eight minutes, doing nothing. Our async chef uses those eight minutes to prep four other dishes.

The `async def` keyword is how you write a recipe that the chef knows can be paused. When a recipe says `await boil(pasta)`, the chef knows: "I can walk away from this step. I'll come back when it's ready." If you write `time.sleep(5)` (a non-async blocking call) instead of `await asyncio.sleep(5)`, it's like telling the chef "stand here and stare at the clock for five minutes" — the entire kitchen freezes.

This model handles thousands of concurrent tasks beautifully — as long as none of them require sustained attention. Serving ten thousand diners who are all waiting for their pasta to boil? Easy. Serving ten diners who all need hand-rolled dumplings requiring constant kneading? One chef can't parallelize that.
:::

---

## ⚙️ Under the Hood

### Coroutines: What `async def` Actually Creates

```python
# run: python3 asyncio_coroutines.py
import asyncio
import inspect

async def greet(name: str) -> str:
    return f"Hello, {name}!"

# Calling an async function does NOT execute it — it returns a coroutine object
coro = greet("World")
print(f"Type: {type(coro)}")                    # <class 'coroutine'>
print(f"Is coroutine: {inspect.iscoroutine(coro)}")  # True

# The coroutine hasn't run yet. To run it, you must:
# 1. await it inside another async function, or
# 2. pass it to asyncio.run(), or
# 3. create a Task from it

result = asyncio.run(coro)
print(f"Result: {result}")  # Hello, World!
```

### What `await` Does Mechanically

`await` suspends the current coroutine and yields control back to the event loop. When the awaited operation completes, the loop resumes the coroutine where it left off.

```python
# run: python3 asyncio_await_flow.py
import asyncio
import time

async def step(name: str, delay: float) -> str:
    print(f"  [{time.strftime('%H:%M:%S')}] {name}: starting")
    await asyncio.sleep(delay)  # Yields control to the event loop
    print(f"  [{time.strftime('%H:%M:%S')}] {name}: done")
    return f"{name}-result"

async def main() -> None:
    # Sequential: total time = sum of delays
    print("Sequential:")
    r1 = await step("A", 1.0)
    r2 = await step("B", 1.0)
    print(f"  Results: {r1}, {r2}\n")

    # Concurrent: total time = max of delays
    print("Concurrent (with gather):")
    r1, r2 = await asyncio.gather(
        step("C", 1.0),
        step("D", 1.0),
    )
    print(f"  Results: {r1}, {r2}")

asyncio.run(main())
```

### The Event Loop Under the Hood

`asyncio.run()` creates an event loop, runs the coroutine until complete, then closes the loop. Under the hood, the loop uses OS-level I/O multiplexing:

| OS | Selector | Mechanism |
|----|----------|-----------|
| Linux | `epoll` | O(1) readiness notification |
| macOS/BSD | `kqueue` | O(1) readiness notification |
| Windows | `IOCP` (ProactorEventLoop) | Completion-based |

```python
# run: python3 asyncio_loop_internals.py
import asyncio
import selectors
import sys

# The default event loop uses the best available selector
print(f"Platform: {sys.platform}")
print(f"Default selector: {selectors.DefaultSelector.__name__}")
# Linux: EpollSelector, macOS: KqueueSelector, Windows: SelectSelector

# You can inspect the running loop
async def show_loop() -> None:
    loop = asyncio.get_running_loop()
    print(f"Loop class: {type(loop).__name__}")
    print(f"Loop running: {loop.is_running()}")
    print(f"Loop closed: {loop.is_closed()}")

asyncio.run(show_loop())
```

### Tasks: Concurrent Execution

`asyncio.create_task()` schedules a coroutine to run concurrently. It wraps the coroutine in a `Task` (a subclass of `Future`) and registers it with the event loop.

```python
# run: python3 asyncio_tasks.py
import asyncio

async def fetch_data(source: str, delay: float) -> dict:
    print(f"Fetching from {source}...")
    await asyncio.sleep(delay)  # Simulate network I/O
    return {"source": source, "items": delay * 100}

async def main() -> None:
    # create_task() starts execution immediately (at next await point)
    task_a = asyncio.create_task(fetch_data("database", 2.0))
    task_b = asyncio.create_task(fetch_data("cache", 0.5))
    task_c = asyncio.create_task(fetch_data("api", 1.0))

    # Tasks are running concurrently now
    # We can do other work here...
    print("All tasks started, doing other work...")
    await asyncio.sleep(0.1)

    # Await results (these will complete in ~2s total, not 3.5s)
    result_a = await task_a
    result_b = await task_b
    result_c = await task_c

    print(f"Results: {result_a}, {result_b}, {result_c}")

asyncio.run(main())
```

### gather() vs wait() vs TaskGroup

```python
# run: python3 asyncio_gather_wait.py
import asyncio

async def may_fail(name: str, fail: bool = False) -> str:
    await asyncio.sleep(0.1)
    if fail:
        raise ValueError(f"{name} failed!")
    return f"{name} ok"

async def demo_gather() -> None:
    """gather: collect all results in order. One failure = all fail (unless return_exceptions)."""
    print("--- gather (return_exceptions=True) ---")
    results = await asyncio.gather(
        may_fail("A"),
        may_fail("B", fail=True),
        may_fail("C"),
        return_exceptions=True,  # Without this, first exception propagates
    )
    for r in results:
        print(f"  {r!r}")  # 'A ok', ValueError('B failed!'), 'C ok'

async def demo_wait() -> None:
    """wait: more control — can wait for FIRST_COMPLETED, ALL_COMPLETED, or FIRST_EXCEPTION."""
    print("\n--- wait (FIRST_COMPLETED) ---")
    tasks = {
        asyncio.create_task(may_fail("fast"), name="fast"),
        asyncio.create_task(may_fail("slow"), name="slow"),
    }
    # Returns two sets: (done, pending)
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    print(f"  Done: {[t.get_name() for t in done]}")
    print(f"  Pending: {[t.get_name() for t in pending]}")

    # Clean up pending tasks
    for t in pending:
        t.cancel()
    await asyncio.gather(*pending, return_exceptions=True)

async def demo_task_group() -> None:
    """TaskGroup (3.11+): structured concurrency. If any task fails, all are cancelled."""
    print("\n--- TaskGroup (structured concurrency) ---")
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(may_fail("X"))
            tg.create_task(may_fail("Y", fail=True))
            tg.create_task(may_fail("Z"))
        # If we reach here, all tasks succeeded
    except* ValueError as eg:
        # ExceptionGroup (3.11+): collects all errors
        print(f"  Caught: {eg.exceptions}")

asyncio.run(demo_gather())
asyncio.run(demo_wait())
asyncio.run(demo_task_group())
```

**TaskGroup vs gather:**

| Feature | `gather()` | `TaskGroup` (3.11+) |
|---------|-----------|-------------------|
| Error handling | First exception or `return_exceptions=True` | Structured: all tasks cancelled on error, `ExceptionGroup` raised |
| Cancellation | Manual | Automatic — if the context exits, pending tasks are cancelled |
| New tasks mid-flight | No | Yes (`tg.create_task()` at any point) |
| Nesting | Awkward | Natural (`async with`) |

### Async Iterators and Context Managers

```python
# run: python3 asyncio_async_iter.py
import asyncio

class AsyncCounter:
    """Async iterator: produces values with delays."""
    def __init__(self, stop: int) -> None:
        self.current = 0
        self.stop = stop

    def __aiter__(self):
        return self

    async def __anext__(self) -> int:
        if self.current >= self.stop:
            raise StopAsyncIteration
        await asyncio.sleep(0.1)  # Simulate async data source
        value = self.current
        self.current += 1
        return value

class AsyncResource:
    """Async context manager: setup and teardown with async operations."""
    async def __aenter__(self):
        print("Acquiring resource (async)...")
        await asyncio.sleep(0.1)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        print("Releasing resource (async)...")
        await asyncio.sleep(0.1)
        return False  # Don't suppress exceptions

async def main() -> None:
    # async for
    print("Async iteration:")
    async for value in AsyncCounter(5):
        print(f"  Got: {value}")

    # async with
    print("\nAsync context manager:")
    async with AsyncResource() as resource:
        print(f"  Using resource: {resource}")

asyncio.run(main())
```

### asyncio vs Node.js Event Loop

| Aspect | Python asyncio | Node.js |
|--------|---------------|---------|
| Thread model | Single-threaded event loop | Single-threaded event loop |
| Async syntax | Explicit `async`/`await` required | I/O is async by default; `async`/`await` for Promises |
| Blocking calls | Must use `asyncio.sleep()`, not `time.sleep()` | Must use non-blocking APIs |
| GIL | Has it (but irrelevant for single-threaded loop) | No GIL (V8 has no equivalent) |
| I/O backend | `selectors` (epoll/kqueue) | libuv (epoll/kqueue/IOCP) |
| CPU offloading | `asyncio.to_thread()` or `ProcessPoolExecutor` | `worker_threads` |
| Microtask queue | Coroutines resume in FIFO order | `process.nextTick` + Promise microtasks |
| Ecosystem | Must use async libraries (aiohttp, asyncpg) | Most I/O libraries are async by default |

### Common Mistakes

#### Blocking the Event Loop

```python
# run: python3 asyncio_blocking_mistake.py
import asyncio
import time

async def bad_sleep() -> None:
    """WRONG: time.sleep() blocks the entire event loop."""
    print("bad_sleep: starting")
    time.sleep(2)  # Blocks the thread — no other coroutine can run!
    print("bad_sleep: done")

async def good_sleep() -> None:
    """RIGHT: asyncio.sleep() yields to the event loop."""
    print("good_sleep: starting")
    await asyncio.sleep(2)  # Non-blocking — loop runs other tasks
    print("good_sleep: done")

async def monitor() -> None:
    """Shows whether the loop is responsive."""
    for i in range(5):
        print(f"  monitor tick {i}")
        await asyncio.sleep(0.5)

async def demo_blocking() -> None:
    print("=== With time.sleep (blocking) ===")
    await asyncio.gather(bad_sleep(), monitor())

async def demo_nonblocking() -> None:
    print("\n=== With asyncio.sleep (non-blocking) ===")
    await asyncio.gather(good_sleep(), monitor())

asyncio.run(demo_blocking())
asyncio.run(demo_nonblocking())
```

#### Forgetting to `await`

```python
# run: python3 asyncio_forget_await.py
import asyncio
import warnings

async def fetch() -> str:
    await asyncio.sleep(0.1)
    return "data"

async def main() -> None:
    # WRONG: calling without await returns a coroutine object, not the result
    result = fetch()  # No await!
    print(f"Type without await: {type(result)}")  # <class 'coroutine'>
    # Python will emit: RuntimeWarning: coroutine 'fetch' was never awaited

    # RIGHT:
    result = await fetch()
    print(f"Type with await: {type(result)}")  # <class 'str'>
    print(f"Value: {result}")

# Enable all warnings to see the RuntimeWarning
warnings.simplefilter("always")
asyncio.run(main())
```

### asyncio.to_thread() — Running Blocking Code

```python
# run: python3 asyncio_to_thread.py
import asyncio
import time

def blocking_io_work(label: str) -> str:
    """Simulate a blocking I/O library that doesn't support async."""
    time.sleep(1.0)  # This would block the event loop
    return f"{label}: done"

async def main() -> None:
    start = time.perf_counter()

    # to_thread() runs the sync function in a thread pool,
    # returning an awaitable that doesn't block the event loop
    results = await asyncio.gather(
        asyncio.to_thread(blocking_io_work, "task-1"),
        asyncio.to_thread(blocking_io_work, "task-2"),
        asyncio.to_thread(blocking_io_work, "task-3"),
    )

    elapsed = time.perf_counter() - start
    print(f"Results: {results}")
    print(f"Total time: {elapsed:.2f}s (sequential would be ~3s)")

asyncio.run(main())
```

### Practical Example: Concurrent HTTP Fetching

```python
# run: pip install httpx && python3 asyncio_http_fetch.py
import asyncio
import time

try:
    import httpx
except ImportError:
    print("Install httpx first: pip install httpx")
    raise SystemExit(1)

URLS = [
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/1",
]

async def fetch(client: httpx.AsyncClient, url: str) -> tuple[str, int]:
    response = await client.get(url, timeout=10.0)
    return url, response.status_code

async def main() -> None:
    start = time.perf_counter()

    async with httpx.AsyncClient() as client:
        tasks = [fetch(client, url) for url in URLS]
        results = await asyncio.gather(*tasks)

    elapsed = time.perf_counter() - start

    for url, status in results:
        print(f"  {url}: {status}")
    print(f"\nFetched {len(URLS)} URLs in {elapsed:.2f}s "
          f"(sequential would be ~{len(URLS)}s)")

asyncio.run(main())
```

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Accidentally blocking the loop.**
A FastAPI endpoint calls a legacy library that internally uses `requests.get()` (synchronous HTTP). Under load, every concurrent request blocks the event loop for the duration of the HTTP call. Latency spikes to seconds; throughput drops to near-sequential. **Diagnosis:** event loop lag monitoring shows spikes correlated with the endpoint. `asyncio.get_event_loop().slow_callback_duration = 0.1` logs warnings for callbacks taking >100ms. **Fix:** wrap the blocking call in `asyncio.to_thread()`, or replace `requests` with `httpx` in async mode.

**2. "Fire and forget" task losing exceptions silently.**
`asyncio.create_task(some_coro())` without ever `await`-ing the task. If the coroutine raises, the exception is logged as "Task exception was never retrieved" — and silently swallowed. In production, errors disappear. **Diagnosis:** look for "Task exception was never retrieved" in logs. Set a global exception handler: `loop.set_exception_handler()`. **Fix:** always store task references and await them, or use `TaskGroup` (3.11+) which propagates exceptions automatically.

**3. Resource exhaustion from unbounded task creation.**
A loop creates tasks for every incoming message without any concurrency limit. With 100K messages, 100K tasks are created simultaneously, each opening a database connection or HTTP socket. The system runs out of file descriptors or memory. **Diagnosis:** `ResourceWarning` or `OSError: [Errno 24] Too many open files`. **Fix:** use `asyncio.Semaphore` to bound concurrency, or process items in batches.
:::

---

## 🎯 Checkpoint

::: details Question 1 — What does `await` actually do?
**Q:** Explain what happens mechanically when the Python interpreter executes `result = await some_coroutine()`. What data structures are involved?

**A:** `await` does three things: (1) It checks that the operand is an awaitable (has `__await__` method — coroutines, Tasks, and Futures all qualify). (2) It calls `__await__()` which returns an iterator. (3) It drives this iterator with `send(None)` / `send(value)`, and when the iterator yields, the current coroutine suspends — execution returns to the event loop. The event loop stores the suspended coroutine and its continuation (where to resume) as a callback associated with the I/O event or timer being waited on. When the OS signals that the I/O is ready (via epoll/kqueue), the loop calls `send(result)` on the coroutine's iterator, which resumes execution at the `await` expression, and the sent value becomes the result of the `await`. This is fundamentally generator machinery — `async`/`await` is syntactic sugar over `yield`/`send` with type checking to prevent mixing generators and coroutines.
:::

::: details Question 2 — gather vs TaskGroup
**Q:** Your service uses `asyncio.gather()` to fan out 10 API calls. If call #3 fails after 100ms but calls #7 and #9 are still running, what happens? How does `TaskGroup` handle this differently?

**A:** With `asyncio.gather()` (default `return_exceptions=False`): the exception from call #3 propagates immediately to the caller. However, calls #7 and #9 **continue running in the background** as orphaned tasks — their results and exceptions will be silently discarded (logged as "Task exception was never retrieved"). Resources they hold (connections, memory) aren't cleaned up until they finish or the loop closes. With `asyncio.gather(return_exceptions=True)`, all 10 calls run to completion and exceptions appear as values in the result list — but you lose fail-fast behavior. With `TaskGroup` (3.11+): when call #3 fails, the TaskGroup **immediately cancels all remaining tasks** (#7, #9, and all others) by injecting `CancelledError`, waits for them to handle cancellation, then raises an `ExceptionGroup` containing all errors. This is structured concurrency — resources are deterministically cleaned up within the `async with` block's scope.
:::

::: details Question 3 — to_thread and the GIL
**Q:** `asyncio.to_thread()` runs a sync function in a thread. Given the GIL, does this actually achieve parallelism? When does it help?

**A:** It depends on what the sync function does. If the function is I/O-bound (e.g., `requests.get()`, `open().read()`, `time.sleep()`), the GIL is released during the I/O operation, and `to_thread()` achieves true concurrent I/O — the event loop continues running other coroutines while the thread waits. If the function is CPU-bound (e.g., image processing in pure Python), the GIL prevents parallelism — the thread and the event loop take turns, and you gain nothing. The primary use case for `to_thread()` is integrating synchronous I/O libraries (database drivers, file operations, legacy HTTP clients) into an async application without blocking the event loop. For CPU-bound work, use `loop.run_in_executor()` with a `ProcessPoolExecutor` to bypass the GIL entirely.
:::

---

## Key Mental Models

- **`async def` declares; `await` suspends.** An async function returns a coroutine object. Only `await` (or the event loop) actually runs it.
- **Concurrency is not parallelism.** asyncio runs one thing at a time — it just eliminates idle time between I/O operations.
- **Blocking calls poison the loop.** A single `time.sleep(5)` in any coroutine freezes every other coroutine for 5 seconds. Always use async-native alternatives.
- **TaskGroup is structured concurrency.** It ensures all child tasks are completed or cancelled before the scope exits — no orphaned tasks, no leaked resources.
- **asyncio and threading solve the same problem differently.** Both handle I/O concurrency. asyncio is cooperative (explicit `await` points), threading is preemptive (OS-scheduled). asyncio scales better (thousands of coroutines vs hundreds of threads) but requires an async-compatible ecosystem.

---

## Related

- [The GIL — Global Interpreter Lock](./01-gil.md) — why asyncio works despite the GIL (single thread, no contention)
- [Threading — Concurrency for I/O](./02-threading.md) — the preemptive alternative; `asyncio.to_thread()` bridges the two
- [Multiprocessing — True Parallelism](./03-multiprocessing.md) — for CPU-bound work that asyncio can't handle
- [concurrent.futures — Unified Executor API](./05-concurrent-futures.md) — `run_in_executor()` connects asyncio to thread/process pools
- [Iterators & Generators](/python/module-04/) — the generator protocol underlying async/await
