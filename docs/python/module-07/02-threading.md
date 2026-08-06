---
title: Threading — Concurrency for I/O
outline: deep
---

# Threading — Concurrency for I/O

**Interview weight:** 🔥🔥 — frequently tested alongside the GIL. Interviewers want to see that you know when threads help and when they don't.

**Python version:** `threading` module is stable across all modern Python. `ThreadPoolExecutor` since 3.2. Thread-safety nuances unchanged.

**Prerequisites:** [The GIL — Global Interpreter Lock](./01-gil.md), [Functions & Closures](/python/module-03/)

---

## 🗣️ In Plain English

::: tip In Plain English
Threads are like multiple waiters in a restaurant, all sharing one kitchen pass window (the GIL). While one waiter is standing at the kitchen window waiting for a dish to come up (I/O), the other waiters can take orders, bring drinks, and clear tables. They're useful not because they make the kitchen cook faster, but because they eliminate idle time among the wait staff.

Each waiter knows their own tables (thread-local state) but they all share the same dining room. If two waiters try to update the same reservation book at the exact same moment, they might overwrite each other's entries — that's a race condition. To prevent this, the restaurant has a little sign they flip to "in use" when someone is writing in the book — that's a lock.

Sometimes waiters get stuck. Waiter A has the pen and is waiting for the reservation book. Waiter B has the reservation book and is waiting for the pen. Neither can proceed — that's a deadlock. The solution is a rule: "always grab the pen before the book." If everyone acquires resources in the same order, deadlocks can't happen.

There's also a special kind of waiter: the daemon waiter. When the restaurant (the main program) closes, daemon waiters just vanish — they don't finish their tasks, they don't clean up, they just disappear. Regular waiters, on the other hand, must finish their current task before the restaurant can close.

For most modern Python code, you don't manage individual waiters anymore. You use a staffing pool — a `ThreadPoolExecutor` — that keeps a set number of waiters ready and assigns tasks to whoever is free. You submit work and get tickets back (futures) that you can check later for results.
:::

---

## ⚙️ Under the Hood

### Thread Basics

Each `threading.Thread` is backed by an OS-level (POSIX/Windows) thread. CPython's GIL ensures only one thread runs Python bytecode at a time, but OS threads are real — they get scheduled by the kernel, have their own stack, and can truly run in parallel during GIL-released operations.

```python
# run: python3 threading_basics.py
import threading
import time

def worker(name: str, duration: float) -> None:
    thread = threading.current_thread()
    print(f"[{name}] started on thread {thread.name} (ident={thread.ident})")
    time.sleep(duration)  # Releases GIL
    print(f"[{name}] done after {duration}s")

# Create and start threads
t1 = threading.Thread(target=worker, args=("task-A", 2.0), name="worker-1")
t2 = threading.Thread(target=worker, args=("task-B", 1.0), name="worker-2")

t1.start()  # Spawns OS thread, begins execution
t2.start()

# join() blocks the calling thread until the target thread finishes
t1.join(timeout=5.0)  # Wait up to 5s for t1
t2.join()

# Check if a thread is still running
print(f"t1 alive: {t1.is_alive()}")  # False — it finished
print(f"Active threads: {threading.active_count()}")
```

### Synchronization Primitives

#### Lock — The Foundation

```python
# run: python3 threading_lock.py
import threading

counter = 0
lock = threading.Lock()

def increment_unsafe(n: int) -> None:
    """Without a lock: race condition on counter."""
    global counter
    for _ in range(n):
        counter += 1  # NOT atomic: LOAD, ADD 1, STORE — can interleave

def increment_safe(n: int) -> None:
    """With a lock: serialized access."""
    global counter
    for _ in range(n):
        with lock:  # Lock supports context manager protocol
            counter += 1

# Demonstrate race condition
counter = 0
threads = [threading.Thread(target=increment_unsafe, args=(100_000,)) for _ in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()
print(f"Unsafe counter (expected 1_000_000): {counter}")  # Usually less!

# Demonstrate correct behavior with lock
counter = 0
threads = [threading.Thread(target=increment_safe, args=(100_000,)) for _ in range(10)]
for t in threads:
    t.start()
for t in threads:
    t.join()
print(f"Safe counter (expected 1_000_000):   {counter}")  # Always 1_000_000
```

#### RLock — Reentrant Lock

An `RLock` can be acquired multiple times by the **same** thread without deadlocking. It must be released the same number of times.

```python
# run: python3 threading_rlock.py
import threading

rlock = threading.RLock()

def outer() -> None:
    with rlock:
        print("outer acquired lock")
        inner()  # Would deadlock with a regular Lock!

def inner() -> None:
    with rlock:  # Same thread can re-acquire
        print("inner acquired lock (reentrant)")

outer()
```

#### Semaphore — Bounded Concurrency

```python
# run: python3 threading_semaphore.py
import threading
import time

# Allow at most 3 concurrent workers
sem = threading.Semaphore(value=3)

def rate_limited_worker(worker_id: int) -> None:
    with sem:
        print(f"Worker {worker_id} started (at most 3 concurrent)")
        time.sleep(1.0)
        print(f"Worker {worker_id} done")

threads = [threading.Thread(target=rate_limited_worker, args=(i,)) for i in range(8)]
for t in threads:
    t.start()
for t in threads:
    t.join()
# Output shows workers starting in batches of 3
```

#### Event — Simple Signaling

```python
# run: python3 threading_event.py
import threading
import time

startup_complete = threading.Event()

def server() -> None:
    print("Server: initializing...")
    time.sleep(1.0)  # Simulate startup
    print("Server: ready!")
    startup_complete.set()  # Signal that server is ready

def client() -> None:
    print("Client: waiting for server...")
    startup_complete.wait()  # Blocks until set()
    print("Client: server is up, proceeding!")

threading.Thread(target=server).start()
threading.Thread(target=client).start()
```

#### Condition — Wait/Notify

```python
# run: python3 threading_condition.py
import threading
import time
from collections import deque

queue: deque[int] = deque()
condition = threading.Condition()

def producer() -> None:
    for i in range(5):
        time.sleep(0.5)
        with condition:
            queue.append(i)
            print(f"Produced: {i}")
            condition.notify()  # Wake one waiting consumer

def consumer() -> None:
    consumed = 0
    while consumed < 5:
        with condition:
            while not queue:  # Must use while, not if (spurious wakeups)
                condition.wait()
            item = queue.popleft()
            print(f"Consumed: {item}")
            consumed += 1

threading.Thread(target=producer).start()
threading.Thread(target=consumer).start()
```

#### Barrier — Synchronization Point

```python
# run: python3 threading_barrier.py
import threading
import time
import random

barrier = threading.Barrier(parties=3)

def phase_worker(worker_id: int) -> None:
    # Phase 1
    duration = random.uniform(0.5, 2.0)
    print(f"Worker {worker_id}: phase 1 ({duration:.1f}s)")
    time.sleep(duration)

    barrier.wait()  # All 3 must reach here before any continues
    print(f"Worker {worker_id}: phase 2 (all synchronized)")

threads = [threading.Thread(target=phase_worker, args=(i,)) for i in range(3)]
for t in threads:
    t.start()
for t in threads:
    t.join()
```

### Deadlocks

```python
# run: python3 threading_deadlock.py
# WARNING: This program will hang forever — Ctrl-C to stop
import threading
import time

lock_a = threading.Lock()
lock_b = threading.Lock()

def worker_1() -> None:
    with lock_a:
        print("Worker 1: acquired lock_a, waiting for lock_b...")
        time.sleep(0.1)  # Ensure worker_2 grabs lock_b first
        with lock_b:  # DEADLOCK: worker_2 holds lock_b
            print("Worker 1: acquired both — won't reach here")

def worker_2() -> None:
    with lock_b:
        print("Worker 2: acquired lock_b, waiting for lock_a...")
        time.sleep(0.1)
        with lock_a:  # DEADLOCK: worker_1 holds lock_a
            print("Worker 2: acquired both — won't reach here")

# Prevention: always acquire locks in the same order (a before b)
# Or use lock.acquire(timeout=5) to detect deadlocks

t1 = threading.Thread(target=worker_1)
t2 = threading.Thread(target=worker_2)
t1.start()
t2.start()
# This will hang. Press Ctrl-C.
```

**Prevention strategies:**
1. **Lock ordering:** Always acquire locks in a consistent global order (e.g., by `id(lock)`).
2. **Timeouts:** Use `lock.acquire(timeout=5.0)` — returns `False` on timeout instead of blocking forever.
3. **Avoid holding multiple locks** when possible.
4. **Use higher-level abstractions** (`queue.Queue`, `concurrent.futures`) that manage locking internally.

### Thread-Local Data

```python
# run: python3 threading_local.py
import threading

# Each thread sees its own copy of attributes on this object
context = threading.local()

def handle_request(request_id: str) -> None:
    context.request_id = request_id  # Thread-local — no races
    process_step_1()
    process_step_2()

def process_step_1() -> None:
    # Access thread-local data without passing it through every function
    print(f"[{threading.current_thread().name}] step 1, request={context.request_id}")

def process_step_2() -> None:
    print(f"[{threading.current_thread().name}] step 2, request={context.request_id}")

threads = [
    threading.Thread(target=handle_request, args=(f"req-{i}",), name=f"worker-{i}")
    for i in range(3)
]
for t in threads:
    t.start()
for t in threads:
    t.join()
```

### Daemon Threads

```python
# run: python3 threading_daemon.py
import threading
import time

def background_task() -> None:
    while True:
        print("Daemon: still running...")
        time.sleep(0.5)

# Daemon thread: killed when all non-daemon threads exit
bg = threading.Thread(target=background_task, daemon=True)
bg.start()

time.sleep(1.5)
print("Main thread exiting — daemon will be killed abruptly")
# No join() — the daemon thread is abandoned
# It does NOT get to run finally blocks or cleanup code
```

**Danger:** Daemon threads don't flush file buffers, don't release external resources, and don't run `finally` blocks when the interpreter shuts down. Use them only for truly disposable background work (heartbeats, monitoring).

### ThreadPoolExecutor — The Modern API

```python
# run: python3 threading_pool.py
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.request import urlopen

URLS = [
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/1",
    "https://httpbin.org/delay/1",
]

def fetch(url: str) -> tuple[str, int]:
    resp = urlopen(url, timeout=10)
    data = resp.read()
    return url, len(data)

# Context manager ensures clean shutdown
start = time.perf_counter()
with ThreadPoolExecutor(max_workers=4) as executor:
    # submit() returns a Future immediately
    futures = {executor.submit(fetch, url): url for url in URLS}

    # as_completed yields futures as they finish (not in submission order)
    for future in as_completed(futures):
        url, size = future.result()  # Raises if the callable raised
        print(f"  {url}: {size} bytes")

elapsed = time.perf_counter() - start
print(f"Total: {elapsed:.2f}s (sequential would be ~{len(URLS)}s)")
```

### When Threading Helps vs Hurts

```python
# run: python3 threading_help_vs_hurt.py
import threading
import time

def io_work() -> None:
    """Simulate I/O — sleeps release the GIL."""
    time.sleep(1.0)

def cpu_work() -> None:
    """CPU-bound — GIL prevents parallelism."""
    total = 0
    for i in range(10_000_000):
        total += i

def benchmark(label: str, fn, count: int) -> None:
    # Sequential
    start = time.perf_counter()
    for _ in range(count):
        fn()
    seq = time.perf_counter() - start

    # Threaded
    start = time.perf_counter()
    threads = [threading.Thread(target=fn) for _ in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    thr = time.perf_counter() - start

    speedup = seq / thr
    print(f"{label}:")
    print(f"  Sequential: {seq:.2f}s | Threaded: {thr:.2f}s | Speedup: {speedup:.2f}x")

benchmark("I/O-bound (time.sleep)", io_work, 4)
benchmark("CPU-bound (counting)",   cpu_work, 4)
```

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Race conditions in "atomic-looking" operations.**
`counter += 1` looks atomic but compiles to `LOAD_GLOBAL`, `LOAD_CONST`, `BINARY_ADD`, `STORE_GLOBAL` — four bytecodes. The GIL can release between any of them. Two threads doing `counter += 1` can both load the same value, increment it, and store it — losing an update. **Diagnosis:** intermittent wrong values that only appear under load. Hard to reproduce. **Fix:** always use a `Lock` for shared mutable state, or use `queue.Queue` which is internally synchronized.

**2. Daemon threads corrupting data on shutdown.**
A logging daemon thread writes to a file. When the main thread exits, the daemon is killed mid-write, leaving a truncated log entry or a corrupted file. In a database context, this can mean half-written transactions. **Diagnosis:** corrupted output files that only appear when the program exits quickly. **Fix:** don't use daemon threads for anything that writes to persistent storage. Use non-daemon threads with a signaling mechanism (`Event`) for graceful shutdown.

**3. Thread leaks from forgotten joins.**
A web server creates threads for background tasks but never joins them. Under load, thread count grows until the OS refuses to create more (`RuntimeError: can't start new thread`). Each thread consumes ~8MB of stack space by default. **Diagnosis:** monitor `threading.active_count()` — if it grows monotonically, you have a leak. **Fix:** use `ThreadPoolExecutor` with a fixed pool size, or ensure every thread is joined.
:::

---

## 🎯 Checkpoint

::: details Question 1 — counter += 1 is not atomic
**Q:** Explain precisely why `counter += 1` is not thread-safe in Python, even though the GIL ensures only one thread runs at a time.

**A:** `counter += 1` compiles to multiple bytecode instructions: `LOAD_GLOBAL counter`, `LOAD_CONST 1`, `BINARY_ADD`, `STORE_GLOBAL counter`. The GIL can be released between any two bytecodes (every ~5ms by default). Thread A can load `counter` (value 5), then lose the GIL. Thread B loads `counter` (still 5), increments to 6, stores 6. Thread A resumes, increments its stale 5 to 6, stores 6. One increment is lost. The GIL prevents simultaneous execution but NOT interleaving between bytecodes. For thread safety, you need explicit locking (`threading.Lock`) or atomic data structures (`queue.Queue`).
:::

::: details Question 2 — RLock use case
**Q:** When would you use an `RLock` instead of a regular `Lock`? Give a concrete scenario.

**A:** An `RLock` is necessary when the same thread needs to acquire the lock more than once — typically in recursive functions or when a locked method calls another locked method on the same object. For example, a thread-safe cache class has a `get()` method that acquires a lock, and a `get_or_compute()` method that also acquires the lock and internally calls `get()`. With a regular `Lock`, this deadlocks immediately because the thread blocks trying to acquire a lock it already holds. An `RLock` tracks the owning thread and an acquisition count, allowing re-entry by the same thread. The lock is only truly released when the count drops to zero (matched `release()` calls). The tradeoff: `RLock` is slightly slower than `Lock` due to the ownership tracking.
:::

::: details Question 3 — ThreadPoolExecutor sizing
**Q:** `ThreadPoolExecutor` defaults to `min(32, os.cpu_count() + 4)` workers. Why is this a reasonable default, and when should you override it?

**A:** The formula targets I/O-bound workloads. `os.cpu_count() + 4` provides enough threads to keep the CPU busy while some threads wait on I/O, with a cap at 32 to prevent excessive memory usage and OS scheduling overhead (each thread ~8MB stack). Override higher (e.g., 100+) when: tasks are almost entirely I/O-bound (HTTP calls with seconds-long waits) and you need high concurrency — the threads spend most of their time sleeping, so many can coexist cheaply. Override lower when: tasks have significant CPU components (because GIL contention makes extra threads counterproductive), or when the target resource has its own concurrency limit (e.g., a database connection pool of 10 — no point having 32 threads fighting for 10 connections). For very high concurrency (thousands), switch to `asyncio` instead of adding more threads.
:::

---

## Key Mental Models

- **Threads share memory; that's their power and their danger.** Fast data sharing, but every shared mutable variable is a potential race condition.
- **Locks are the price of shared memory.** If you share mutable state across threads, you must synchronize access. No exceptions.
- **Prefer ThreadPoolExecutor over raw threads.** It manages thread lifecycle, limits concurrency, and provides a clean Future-based API.
- **Threading shines for I/O-bound work only.** For CPU-bound work, threads under the GIL are worse than useless.
- **Daemon threads are fire-and-forget.** They're killed without cleanup on interpreter exit — never use them for anything that must complete or flush.

---

## Related

- [The GIL — Global Interpreter Lock](./01-gil.md) — why threading can't parallelize CPU work
- [Multiprocessing — True Parallelism](./03-multiprocessing.md) — the alternative when you need real parallel execution
- [concurrent.futures — Unified Executor API](./05-concurrent-futures.md) — `ThreadPoolExecutor` in depth alongside `ProcessPoolExecutor`
- [asyncio — Async/Await from Scratch](./04-asyncio.md) — single-threaded alternative for high-concurrency I/O
