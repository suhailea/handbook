---
title: concurrent.futures — Unified Executor API
outline: deep
---

# concurrent.futures — Unified Executor API

**Interview weight:** 🔥🔥 — interviewers use this to test whether you understand the abstraction layer over threads and processes, and whether you can choose the right executor for a given problem.

**Python version:** `concurrent.futures` since 3.2. `max_tasks_per_child` for `ProcessPoolExecutor` since 3.11. Default `max_workers` formula for `ThreadPoolExecutor` changed in 3.8.

**Prerequisites:** [Threading — Concurrency for I/O](./02-threading.md), [Multiprocessing — True Parallelism](./03-multiprocessing.md)

---

## 🗣️ In Plain English

::: tip In Plain English
concurrent.futures is like a temp staffing agency. You tell the agency (the Executor) what work needs doing, and they handle the logistics — whether to send office workers who share a workspace (threads) or field teams who work independently in separate locations (processes). You don't manage the workers directly. You don't hire them, train them, or fire them.

For each job you submit, the agency gives you a ticket — a Future. This ticket doesn't have the answer yet. It's a promise that the answer will arrive. You can check if the job is done, wait for the result, or — most usefully — ask the agency to notify you the moment any job finishes, regardless of the order you submitted them.

The two kinds of agencies are `ThreadPoolExecutor` (sends office workers — cheap, fast to deploy, but they share resources and can only do one thing at a time when it comes to certain tasks) and `ProcessPoolExecutor` (sends field teams — expensive to deploy, each brings their own equipment, but they work truly independently).

The beauty of the abstraction is that your code looks identical whether you use threads or processes. You call `executor.submit(do_work, arg)` and get a Future back. Want to switch from threads to processes because you realized the work is CPU-bound? Change one line — the executor type. Everything else stays the same.

The `as_completed()` function is the agency's "results as they come in" service. Instead of waiting for all jobs to finish, you get notified the instant any job finishes. This is valuable when jobs take varying amounts of time and you want to process results immediately rather than waiting for the slowest one.
:::

---

## ⚙️ Under the Hood

### The Executor Abstraction

Both `ThreadPoolExecutor` and `ProcessPoolExecutor` inherit from the abstract `Executor` class. The interface is identical:

```python
# run: python3 cf_executor_basics.py
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import time

def compute(n: int) -> int:
    """Simulate work."""
    time.sleep(0.5)
    return n * n

# The API is identical for both executor types
def run_with_executor(executor_class, label: str) -> None:
    start = time.perf_counter()
    with executor_class(max_workers=4) as executor:
        # submit() returns a Future immediately
        future = executor.submit(compute, 42)
        print(f"[{label}] Future created: done={future.done()}")

        # result() blocks until the future completes
        result = future.result(timeout=5.0)
        print(f"[{label}] Result: {result}")
    elapsed = time.perf_counter() - start
    print(f"[{label}] Total: {elapsed:.2f}s\n")

if __name__ == "__main__":
    run_with_executor(ThreadPoolExecutor, "Thread")
    run_with_executor(ProcessPoolExecutor, "Process")
```

### ThreadPoolExecutor Deep Dive

```python
# run: python3 cf_thread_pool.py
from concurrent.futures import ThreadPoolExecutor
import os
import time

def fetch_page(url: str) -> tuple[str, int]:
    """Simulate fetching a web page."""
    time.sleep(1.0)  # Simulated network I/O (releases the GIL)
    return url, 200

# max_workers default (since 3.8): min(32, os.cpu_count() + 4)
print(f"CPU count: {os.cpu_count()}")
print(f"Default max_workers: {min(32, (os.cpu_count() or 1) + 4)}")

urls = [f"https://example.com/page/{i}" for i in range(10)]

start = time.perf_counter()
with ThreadPoolExecutor(max_workers=5) as executor:
    # map() returns results in submission order
    results = list(executor.map(fetch_page, urls))
elapsed = time.perf_counter() - start

for url, status in results:
    print(f"  {url}: {status}")
print(f"\nFetched {len(urls)} pages in {elapsed:.2f}s "
      f"(sequential would be ~{len(urls)}s)")
```

#### Initializer: Per-Thread Setup

```python
# run: python3 cf_thread_initializer.py
from concurrent.futures import ThreadPoolExecutor
import threading

# Thread-local storage for per-thread resources
_local = threading.local()

def init_worker() -> None:
    """Called once per thread when it's created."""
    _local.connection = f"db-conn-{threading.current_thread().name}"
    print(f"Initialized: {_local.connection}")

def do_query(query: str) -> str:
    """Uses the per-thread connection."""
    return f"[{_local.connection}] executed: {query}"

with ThreadPoolExecutor(max_workers=2, initializer=init_worker) as executor:
    queries = ["SELECT 1", "SELECT 2", "SELECT 3", "SELECT 4"]
    results = list(executor.map(do_query, queries))
    for r in results:
        print(f"  {r}")
```

### ProcessPoolExecutor Deep Dive

```python
# run: python3 cf_process_pool.py
from concurrent.futures import ProcessPoolExecutor
import os
import time
import math

def cpu_intensive(n: int) -> tuple[int, bool]:
    """Check if a large number is prime — pure CPU work."""
    if n < 2:
        return n, False
    if n < 4:
        return n, True
    if n % 2 == 0:
        return n, False
    for i in range(3, int(math.isqrt(n)) + 1, 2):
        if n % i == 0:
            return n, False
    return n, True

NUMBERS = [
    104729, 104743, 15485863, 15485867,
    32452843, 32452867, 49979687, 49979693,
    67867967, 67867979, 86028121, 86028157,
]

if __name__ == "__main__":
    # max_workers default: os.cpu_count()
    print(f"CPU count: {os.cpu_count()}")

    # Sequential
    start = time.perf_counter()
    seq_results = [cpu_intensive(n) for n in NUMBERS]
    seq_time = time.perf_counter() - start

    # Parallel with processes
    start = time.perf_counter()
    with ProcessPoolExecutor(max_workers=4) as executor:
        par_results = list(executor.map(cpu_intensive, NUMBERS))
    par_time = time.perf_counter() - start

    print(f"Sequential:    {seq_time:.3f}s")
    print(f"Parallel (4p): {par_time:.3f}s")
    print(f"Speedup:       {seq_time / par_time:.2f}x")

    primes = [n for n, is_p in par_results if is_p]
    print(f"Primes: {primes}")
```

#### max_tasks_per_child (3.11+)

Limits how many tasks each worker process handles before being replaced with a fresh one. Useful for mitigating memory leaks in worker processes:

```python
# run: python3 cf_max_tasks_per_child.py
from concurrent.futures import ProcessPoolExecutor
import os

def leaky_work(n: int) -> tuple[int, int]:
    """Each invocation might leak memory. max_tasks_per_child recycles the process."""
    return n, os.getpid()

if __name__ == "__main__":
    # Each worker handles at most 3 tasks, then is killed and replaced
    with ProcessPoolExecutor(max_workers=2, max_tasks_per_child=3) as executor:
        results = list(executor.map(leaky_work, range(10)))

    for task_id, pid in results:
        print(f"  Task {task_id}: ran in PID {pid}")
    # You'll see PIDs change as workers are recycled
```

### Future Objects in Detail

```python
# run: python3 cf_future_details.py
from concurrent.futures import ThreadPoolExecutor, Future
import time

def slow_add(a: int, b: int) -> int:
    time.sleep(1.0)
    return a + b

def on_complete(future: Future) -> None:
    """Callback: invoked when the future completes (in the worker thread!)."""
    if future.exception():
        print(f"  Callback: task failed with {future.exception()!r}")
    else:
        print(f"  Callback: task result = {future.result()}")

with ThreadPoolExecutor(max_workers=2) as executor:
    f: Future = executor.submit(slow_add, 3, 4)

    # Inspect state
    print(f"Done: {f.done()}")           # False — still running
    print(f"Cancelled: {f.cancelled()}")  # False

    # Add callback (runs when future completes)
    f.add_done_callback(on_complete)

    # result() blocks until complete (or timeout)
    try:
        result = f.result(timeout=5.0)
        print(f"Result: {result}")  # 7
    except TimeoutError:
        print("Timed out!")

    # exception() returns the exception if the callable raised, else None
    print(f"Exception: {f.exception()}")  # None

    # Demonstrate exception propagation
    def failing_task() -> None:
        raise ValueError("something broke")

    f2 = executor.submit(failing_task)
    f2.add_done_callback(on_complete)
    time.sleep(0.5)  # Let it complete
    try:
        f2.result()
    except ValueError as e:
        print(f"Caught from future: {e}")
```

### as_completed() — Results as They Arrive

```python
# run: python3 cf_as_completed.py
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import random

def variable_work(task_id: int) -> tuple[int, float]:
    """Each task takes a random amount of time."""
    duration = random.uniform(0.5, 3.0)
    time.sleep(duration)
    return task_id, duration

start = time.perf_counter()
with ThreadPoolExecutor(max_workers=4) as executor:
    # submit() returns futures mapped to task IDs
    future_to_id = {
        executor.submit(variable_work, i): i
        for i in range(8)
    }

    # as_completed() yields futures in completion order (not submission order)
    for future in as_completed(future_to_id):
        task_id, duration = future.result()
        elapsed = time.perf_counter() - start
        print(f"  Task {task_id} completed at {elapsed:.2f}s "
              f"(took {duration:.2f}s)")

total = time.perf_counter() - start
print(f"\nAll done in {total:.2f}s")
```

### map() vs submit() + as_completed()

```python
# run: python3 cf_map_vs_submit.py
from concurrent.futures import ThreadPoolExecutor, as_completed
import time

def work(task_id: int) -> tuple[int, float]:
    duration = 3.0 - task_id * 0.5  # Task 0 is slowest, task 5 is fastest
    time.sleep(max(duration, 0.1))
    return task_id, duration

print("=== executor.map() — results in submission order ===")
start = time.perf_counter()
with ThreadPoolExecutor(max_workers=3) as executor:
    # map() returns an iterator that yields results IN ORDER
    # Even if task 5 finishes first, you wait for task 0's result first
    for task_id, duration in executor.map(work, range(6)):
        elapsed = time.perf_counter() - start
        print(f"  Got task {task_id} at {elapsed:.2f}s (took {duration:.1f}s)")

print(f"\n=== submit() + as_completed() — results as they finish ===")
start = time.perf_counter()
with ThreadPoolExecutor(max_workers=3) as executor:
    futures = {executor.submit(work, i): i for i in range(6)}
    for future in as_completed(futures):
        task_id, duration = future.result()
        elapsed = time.perf_counter() - start
        print(f"  Got task {task_id} at {elapsed:.2f}s (took {duration:.1f}s)")
```

**Key difference:** `map()` preserves order (iterator blocks until the next result is ready). `submit()` + `as_completed()` gives you results in completion order — better for latency-sensitive pipelines where you want to process each result immediately.

### Practical Example: Threads for I/O, Processes for CPU

```python
# run: python3 cf_practical.py
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
import time
import hashlib

# I/O-bound: use threads
def fetch_data(source_id: int) -> bytes:
    """Simulate fetching data over network."""
    time.sleep(1.0)  # Network latency
    return f"data-from-source-{source_id}".encode()

# CPU-bound: use processes
def process_data(data: bytes) -> str:
    """CPU-intensive processing."""
    digest = data
    for _ in range(50_000):
        digest = hashlib.sha256(digest).digest()
    return digest.hex()[:16]

if __name__ == "__main__":
    sources = list(range(8))

    # Step 1: Fetch data concurrently with threads (I/O-bound)
    start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=8) as thread_pool:
        raw_data = list(thread_pool.map(fetch_data, sources))
    fetch_time = time.perf_counter() - start
    print(f"Fetched {len(raw_data)} sources in {fetch_time:.2f}s (threads)")

    # Step 2: Process data in parallel with processes (CPU-bound)
    start = time.perf_counter()
    with ProcessPoolExecutor(max_workers=4) as proc_pool:
        results = list(proc_pool.map(process_data, raw_data))
    proc_time = time.perf_counter() - start
    print(f"Processed {len(results)} items in {proc_time:.2f}s (processes)")

    for src, result in zip(sources, results):
        print(f"  Source {src}: {result}")

    print(f"\nTotal: {fetch_time + proc_time:.2f}s")
```

### Decision Tree: Threading vs Multiprocessing vs asyncio

```
Is the work I/O-bound or CPU-bound?
|
+-- I/O-bound
|   |
|   +-- How many concurrent connections?
|   |   |
|   |   +-- < 100 --> ThreadPoolExecutor (simple, good enough)
|   |   |
|   |   +-- > 100 or > 1000 --> asyncio (lower overhead per connection)
|   |
|   +-- Does your library support async?
|       |
|       +-- Yes (aiohttp, asyncpg, httpx) --> asyncio
|       |
|       +-- No (requests, psycopg2) --> ThreadPoolExecutor
|          (or asyncio + to_thread() / run_in_executor())
|
+-- CPU-bound
    |
    +-- Does your library release the GIL? (numpy, hashlib, PIL)
    |   |
    |   +-- Yes --> ThreadPoolExecutor may work
    |   |
    |   +-- No  --> ProcessPoolExecutor
    |
    +-- Is per-task work > 10ms?
        |
        +-- Yes --> ProcessPoolExecutor (overhead amortized)
        |
        +-- No  --> Consider batching tasks, or stay single-threaded
            (process creation overhead dominates)
```

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. ProcessPoolExecutor + unpicklable results.**
A data pipeline uses `ProcessPoolExecutor` to process images. The worker function returns a PIL Image object. In some PIL versions or configurations, Image objects can't be pickled. The `future.result()` call raises `pickle.PicklingError` — not in the worker, but when the result is transmitted back to the parent. **Diagnosis:** the traceback mentions `pickle` and `_pickle.PicklingError`, but the actual function ran successfully in the worker. **Fix:** return serializable data (bytes, numpy arrays, file paths) instead of complex objects. Always test that your worker's return type is picklable.

**2. Executor not shut down — resource leak.**
Code creates a `ProcessPoolExecutor` without a `with` block and never calls `shutdown()`. Worker processes accumulate across requests in a web server. Each process consumes 30-50MB. After thousands of requests, the server OOMs. **Diagnosis:** `ps aux` shows hundreds of Python processes; memory usage grows linearly with request count. **Fix:** always use executors as context managers (`with ProcessPoolExecutor() as e:`), or call `executor.shutdown(wait=True)` in a `finally` block.

**3. as_completed() with exception handling.**
A batch job uses `as_completed()` to process futures. One future raises an exception. The code calls `future.result()` without a try/except, crashing the loop — remaining futures (potentially hundreds) are abandoned without their results being consumed. **Diagnosis:** partial results, some tasks silently abandoned. **Fix:** always wrap `future.result()` in try/except within the `as_completed()` loop, and decide per-task whether to log and continue or abort the entire batch.
:::

---

## 🎯 Checkpoint

::: details Question 1 — map() vs submit() ordering
**Q:** You have 100 tasks with highly variable runtimes (1ms to 10s). You want to display results to the user as soon as each task finishes. Should you use `executor.map()` or `executor.submit()` + `as_completed()`? Why?

**A:** Use `executor.submit()` + `as_completed()`. `executor.map()` returns an iterator that yields results in **submission order**. If task 0 takes 10s and task 1 takes 1ms, you won't see task 1's result until task 0 completes — the iterator blocks waiting for the next sequential result. `as_completed()` yields futures in **completion order** — task 1's future is yielded after 1ms regardless of task 0's status. For user-facing applications where perceived latency matters (progress bars, streaming results, live dashboards), `as_completed()` is always the right choice. `map()` is appropriate when you need ordered results and don't care about latency (e.g., writing output to a file that must be in order).
:::

::: details Question 2 — Choosing the right executor
**Q:** You need to resize 10,000 images (CPU-bound, ~50ms each using Pillow) and upload them to S3 (I/O-bound, ~200ms each). How would you structure this with concurrent.futures?

**A:** Use a two-stage pipeline: `ProcessPoolExecutor` for resizing (CPU-bound, bypasses GIL) and `ThreadPoolExecutor` for uploading (I/O-bound, threads are sufficient). Stage 1: `ProcessPoolExecutor(max_workers=os.cpu_count())` with `executor.map(resize, images)` — returns resized image bytes in order. Stage 2: `ThreadPoolExecutor(max_workers=20)` (S3 concurrency limit) with `executor.map(upload, resized_images)`. Don't use threads for resizing (Pillow's C code may or may not release the GIL for all operations). Don't use processes for uploading (process creation overhead for 200ms I/O is wasteful, and you'd need to serialize image bytes through a pipe). An alternative is `asyncio` with `aiobotocore` for uploads, combined with `loop.run_in_executor(ProcessPoolExecutor(...), resize, img)` for CPU work — but this adds complexity.
:::

::: details Question 3 — Future exception propagation
**Q:** What happens if a function submitted to an executor raises an exception? When and where does the exception propagate?

**A:** The exception is captured by the executor and stored inside the `Future` object. It does NOT propagate immediately — the caller's thread is not interrupted. The exception propagates only when: (1) `future.result()` is called — it re-raises the stored exception in the calling thread. (2) `future.exception()` is called — it returns the exception object (or `None` if no exception). If neither is ever called, the exception is silently lost (Python logs a "Future exception was never retrieved" warning during garbage collection of the Future). This means fire-and-forget patterns (`executor.submit(fn)` without storing the Future) silently swallow errors. Done callbacks (`add_done_callback`) run regardless of success or failure and can check `future.exception()` to handle errors.
:::

---

## Key Mental Models

- **Executor is the abstraction; Thread/Process is the implementation.** Your code should depend on the Executor interface, making it trivial to switch between thread and process backends.
- **Futures are promises with teeth.** They capture both results AND exceptions. Call `.result()` to get the value or re-raise the exception.
- **`as_completed()` is for latency; `map()` is for ordering.** Use `as_completed()` when you want to react to results immediately; use `map()` when result order matters.
- **ProcessPoolExecutor = pickling tax.** Everything crossing the process boundary (arguments AND return values) must be picklable. Design worker functions to accept and return simple types.
- **Always use context managers for executors.** Without `with` or `shutdown()`, worker threads/processes leak and accumulate.

---

## Related

- [Threading — Concurrency for I/O](./02-threading.md) — what `ThreadPoolExecutor` wraps
- [Multiprocessing — True Parallelism](./03-multiprocessing.md) — what `ProcessPoolExecutor` wraps
- [asyncio — Async/Await from Scratch](./04-asyncio.md) — `loop.run_in_executor()` bridges asyncio to concurrent.futures
- [The GIL — Global Interpreter Lock](./01-gil.md) — why the choice between thread and process executor matters
