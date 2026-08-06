---
title: Multiprocessing — True Parallelism
outline: deep
---

# Multiprocessing — True Parallelism

**Interview weight:** 🔥🔥 — essential for explaining how Python achieves CPU parallelism. Often paired with GIL questions.

**Python version:** `multiprocessing` stable since Python 2.6. `shared_memory` since 3.8. macOS default start method changed to `spawn` in 3.12. `max_tasks_per_child` for `Pool` since 3.2, for `ProcessPoolExecutor` since 3.11.

**Prerequisites:** [The GIL — Global Interpreter Lock](./01-gil.md), [Threading — Concurrency for I/O](./02-threading.md)

---

## 🗣️ In Plain English

::: tip In Plain English
If threading is multiple waiters sharing one kitchen, multiprocessing is building entire separate restaurants. Each restaurant has its own kitchen, its own wait staff, its own supplies, its own everything. They can all cook simultaneously because nothing is shared — the global interpreter lock (the single kitchen pass window) doesn't matter because each restaurant has its own.

The downside is obvious: opening a new restaurant is expensive. You need a whole new building (a full copy of the Python interpreter in memory), a whole new set of supplies (duplicated data), and setting up takes time. If all you needed was to carry three plates at once, building a second restaurant is absurd overkill.

And here's the real nuance: these separate restaurants can't just shout across the street to coordinate. If one restaurant needs to tell another "we're out of salmon," it has to write a note and send it by courier. That's inter-process communication (IPC). The courier has to physically carry the message — it can't just point at a shared whiteboard because there is no shared whiteboard. Everything sent between restaurants must be packaged up (serialized) for transport and unpacked (deserialized) on arrival. Some things can't be packaged at all — try sending a live fish through the mail.

When is this worth it? When the actual cooking (CPU computation) is the bottleneck and you need multiple kitchens operating truly in parallel. Image processing, number crunching, batch data transformations — anything where the per-task work dwarfs the cost of setting up the restaurant and sending messages.

For lightweight coordination — sharing a shopping list or reporting back how many dishes were served — there are special shared bulletin boards (shared memory) mounted on the wall between the buildings. Fast, but limited to simple data.
:::

---

## ⚙️ Under the Hood

### Process Basics

Each `multiprocessing.Process` creates a new OS process with its own Python interpreter and its own GIL. True parallel execution across CPU cores.

```python
# run: python3 mp_basics.py
import multiprocessing
import os
import time

def worker(name: str) -> None:
    print(f"[{name}] PID={os.getpid()}, Parent PID={os.getppid()}")
    time.sleep(1.0)
    print(f"[{name}] done")

if __name__ == "__main__":
    print(f"Main process PID={os.getpid()}")

    p1 = multiprocessing.Process(target=worker, args=("worker-A",))
    p2 = multiprocessing.Process(target=worker, args=("worker-B",))

    p1.start()
    p2.start()

    p1.join()  # Block until p1 finishes
    p2.join()

    print(f"p1 exit code: {p1.exitcode}")  # 0 = success
    print(f"p2 alive: {p2.is_alive()}")    # False
```

**Critical:** always use `if __name__ == "__main__":` as the entry guard. The `spawn` and `forkserver` start methods re-import the module in the child process — without the guard, child processes recursively spawn more children.

### Start Methods: fork vs spawn vs forkserver

The start method determines how child processes are created. This choice has deep implications for correctness and safety.

```python
# run: python3 mp_start_methods.py
import multiprocessing
import sys

print(f"Platform: {sys.platform}")
print(f"Default start method: {multiprocessing.get_start_method()}")
print(f"Available: {multiprocessing.get_all_start_methods()}")

# You can set it (once, at program start):
# multiprocessing.set_start_method("spawn")
# Or use a context for a specific Pool:
# ctx = multiprocessing.get_context("spawn")
# pool = ctx.Pool(4)
```

| Method | How it works | Speed | Safety | Default on |
|--------|-------------|-------|--------|------------|
| **fork** | `os.fork()` — copies entire process memory (COW) | Fast | Unsafe: copies locks in locked state, corrupts threads, breaks OpenSSL/CUDA | Linux |
| **spawn** | Starts fresh Python interpreter, pickles and sends data | Slow | Safe: clean interpreter state | macOS (3.12+), Windows |
| **forkserver** | Forks from a clean server process (started once at the beginning) | Medium | Safer than fork, faster than spawn | Available on Unix |

**Why fork is dangerous:** if the parent process has threads (e.g., a background logging thread holds a lock), `fork()` copies the locked lock into the child. The child's thread that would release it doesn't exist — deadlock. This is why macOS switched the default to `spawn` in Python 3.12.

### Inter-Process Communication (IPC)

#### Queue — Thread/Process-Safe FIFO

```python
# run: python3 mp_queue.py
import multiprocessing
import time

def producer(q: multiprocessing.Queue, items: list[int]) -> None:
    for item in items:
        q.put(item)
        print(f"Produced: {item}")
        time.sleep(0.1)
    q.put(None)  # Sentinel: signals end of stream

def consumer(q: multiprocessing.Queue) -> None:
    while True:
        item = q.get()  # Blocks until available
        if item is None:
            break
        print(f"Consumed: {item}")

if __name__ == "__main__":
    q: multiprocessing.Queue = multiprocessing.Queue()
    p = multiprocessing.Process(target=producer, args=(q, [1, 2, 3, 4, 5]))
    c = multiprocessing.Process(target=consumer, args=(q,))

    p.start()
    c.start()
    p.join()
    c.join()
```

Under the hood, `multiprocessing.Queue` uses a pipe + locks + a background thread to move pickled objects between processes.

#### Pipe — Two-Way Communication

```python
# run: python3 mp_pipe.py
import multiprocessing

def child(conn: multiprocessing.connection.Connection) -> None:
    conn.send({"status": "ready", "pid": multiprocessing.current_process().pid})
    msg = conn.recv()  # Block until parent sends
    print(f"Child received: {msg}")
    conn.close()

if __name__ == "__main__":
    parent_conn, child_conn = multiprocessing.Pipe()  # duplex=True by default

    p = multiprocessing.Process(target=child, args=(child_conn,))
    p.start()

    msg = parent_conn.recv()
    print(f"Parent received: {msg}")
    parent_conn.send("proceed")

    p.join()
```

### Shared Memory (3.8+)

For high-performance data sharing without serialization overhead:

```python
# run: python3 mp_shared_memory.py
from multiprocessing import shared_memory, Process
import struct

def writer(shm_name: str) -> None:
    shm = shared_memory.SharedMemory(name=shm_name)
    # Write 10 integers directly into shared memory
    for i in range(10):
        struct.pack_into("i", shm.buf, i * 4, i * i)
    shm.close()

def reader(shm_name: str) -> None:
    shm = shared_memory.SharedMemory(name=shm_name)
    values = [struct.unpack_from("i", shm.buf, i * 4)[0] for i in range(10)]
    print(f"Read from shared memory: {values}")
    shm.close()

if __name__ == "__main__":
    # Create shared memory block: 10 ints * 4 bytes each
    shm = shared_memory.SharedMemory(create=True, size=40)
    print(f"Shared memory name: {shm.name}")

    w = Process(target=writer, args=(shm.name,))
    r = Process(target=reader, args=(shm.name,))

    w.start()
    w.join()  # Writer finishes before reader starts
    r.start()
    r.join()

    shm.close()
    shm.unlink()  # Must unlink to free the shared memory block
```

#### ShareableList — High-Level Shared Container

```python
# run: python3 mp_shareable_list.py
from multiprocessing import shared_memory, Process

def update_list(shm_name: str) -> None:
    sl = shared_memory.ShareableList(name=shm_name)
    sl[0] = 100  # Direct write — no pickling
    sl[1] = 200
    sl.shm.close()

if __name__ == "__main__":
    sl = shared_memory.ShareableList([0, 0, 0, 0, 0])
    print(f"Before: {list(sl)}")

    p = Process(target=update_list, args=(sl.shm.name,))
    p.start()
    p.join()

    print(f"After:  {list(sl)}")  # [100, 200, 0, 0, 0]

    sl.shm.close()
    sl.shm.unlink()
```

**Limitations:** `ShareableList` supports only `int`, `float`, `bool`, `str` (fixed max length), `bytes` (fixed max length), and `None`. No nested structures.

### Value and Array — Shared State with Locks

```python
# run: python3 mp_value_array.py
from multiprocessing import Process, Value, Array
import ctypes

def increment_counter(counter: Value, n: int) -> None:
    for _ in range(n):
        with counter.get_lock():  # Built-in lock
            counter.value += 1

if __name__ == "__main__":
    # 'i' = signed int (ctypes.c_int), 'd' = double, etc.
    counter: Value = Value(ctypes.c_int, 0)

    procs = [Process(target=increment_counter, args=(counter, 100_000)) for _ in range(4)]
    for p in procs:
        p.start()
    for p in procs:
        p.join()

    print(f"Counter: {counter.value}")  # 400_000 (correct with lock)

    # Shared array
    arr: Array = Array(ctypes.c_double, [0.0, 0.0, 0.0])
    print(f"Shared array: {arr[:]}")
```

### Process Pools

```python
# run: python3 mp_pool.py
import multiprocessing
import time

def is_prime(n: int) -> bool:
    """CPU-intensive prime check."""
    if n < 2:
        return False
    if n < 4:
        return True
    if n % 2 == 0 or n % 3 == 0:
        return False
    i = 5
    while i * i <= n:
        if n % i == 0 or n % (i + 2) == 0:
            return False
        i += 6
    return True

NUMBERS = [
    15485863, 15485867, 32452843, 32452867,
    49979687, 49979693, 67867967, 67867979,
    86028121, 86028157, 104395301, 104395303,
]

if __name__ == "__main__":
    # Sequential
    start = time.perf_counter()
    seq_results = [is_prime(n) for n in NUMBERS]
    seq_time = time.perf_counter() - start

    # Parallel with Pool
    start = time.perf_counter()
    with multiprocessing.Pool(processes=4) as pool:
        # map() preserves order, distributes work across processes
        par_results = pool.map(is_prime, NUMBERS)
    par_time = time.perf_counter() - start

    assert seq_results == par_results
    print(f"Sequential:    {seq_time:.3f}s")
    print(f"Parallel (4p): {par_time:.3f}s")
    print(f"Speedup:       {seq_time / par_time:.2f}x")

    primes = [n for n, p in zip(NUMBERS, par_results) if p]
    print(f"Primes found:  {len(primes)}/{len(NUMBERS)}")
```

#### Pool methods comparison

| Method | Blocking? | Ordered? | Use case |
|--------|----------|----------|----------|
| `map(fn, iterable)` | Yes | Yes | Simple batch processing |
| `starmap(fn, iterable)` | Yes | Yes | Multiple arguments per call |
| `apply_async(fn, args)` | No | N/A | Fire-and-forget / callback |
| `map_async(fn, iterable)` | No | Yes | Non-blocking batch |
| `imap(fn, iterable)` | Iterator | Yes | Memory-efficient ordered |
| `imap_unordered(fn, iterable)` | Iterator | No | First-available results |

### Serialization: What Can't Be Pickled

Everything sent between processes (arguments, return values, queue items) must be serializable with `pickle`. This fails for:

```python
# run: python3 mp_pickle_limits.py
import pickle

# These CANNOT be sent between processes:

# 1. Lambda functions
try:
    pickle.dumps(lambda x: x + 1)
except pickle.PicklingError as e:
    print(f"Lambda: {e}")

# 2. Inner/nested functions
def outer():
    def inner():
        pass
    return inner

try:
    pickle.dumps(outer())
except AttributeError as e:
    print(f"Inner function: {e}")

# 3. Open file handles
import io
try:
    real_file = open("/dev/null", "r")
    pickle.dumps(real_file)
except TypeError as e:
    print(f"File handle: {e}")
finally:
    real_file.close()

# 4. Database connections, sockets, locks
import threading
try:
    pickle.dumps(threading.Lock())
except TypeError as e:
    print(f"Lock: {e}")

# These CAN be pickled:
print(f"\nTop-level function: OK")
print(f"Dict/list: {pickle.dumps({'key': [1, 2, 3]})!r:.50}...")
```

### Practical Pattern: CPU-Bound Batch Processing

```python
# run: python3 mp_batch_processing.py
from concurrent.futures import ProcessPoolExecutor
import time
import hashlib

def compute_hash(data: bytes) -> str:
    """CPU-intensive: compute SHA-256 hash 10000 times (key stretching)."""
    digest = data
    for _ in range(10_000):
        digest = hashlib.sha256(digest).digest()
    return digest.hex()

if __name__ == "__main__":
    items = [f"item-{i}".encode() for i in range(50)]

    # Sequential
    start = time.perf_counter()
    seq = [compute_hash(item) for item in items]
    seq_time = time.perf_counter() - start

    # Parallel
    start = time.perf_counter()
    with ProcessPoolExecutor(max_workers=4) as executor:
        par = list(executor.map(compute_hash, items))
    par_time = time.perf_counter() - start

    assert seq == par
    print(f"Sequential: {seq_time:.2f}s")
    print(f"Parallel:   {par_time:.2f}s")
    print(f"Speedup:    {seq_time / par_time:.1f}x")
```

### Cost Analysis

| Cost | Magnitude | Notes |
|------|-----------|-------|
| **Process creation** | 30-100ms (spawn), 5-30ms (fork) | Amortize with pools |
| **Memory per process** | 30-50MB baseline (full interpreter) | COW helps with fork, not spawn |
| **Serialization (small)** | Microseconds for simple types | pickle overhead is real |
| **Serialization (large)** | Milliseconds-seconds for large objects | 1GB numpy array = seconds of pickle |
| **IPC latency** | ~10-100 microseconds per message | Pipe faster than Queue |
| **Shared memory** | Near-zero for reads | No serialization; direct memory access |

**Rule of thumb:** if per-task computation takes less than ~10ms, the IPC overhead dominates and multiprocessing is slower than sequential.

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Fork + threads = deadlock.**
A Django app using gunicorn with `--preload` (preloads the app, then forks workers) and a background logging thread. After fork, the child process has a copy of the logging thread's lock in a locked state, but no thread to release it. First log call in the child: deadlock. **Diagnosis:** child processes hang on startup, `strace` shows them stuck on `futex(FUTEX_WAIT)`. **Fix:** use `--preload` with `spawn` start method, or don't start threads before forking.

**2. Pickle bombs in the queue.**
A pipeline sends large pandas DataFrames through `multiprocessing.Queue`. Each 500MB DataFrame is pickled (serialized) in the sender, transmitted through a pipe, and unpickled in the receiver — doubling memory usage and taking seconds per transfer. Under load, the pipe buffer fills up, `put()` blocks, and the pipeline stalls. **Diagnosis:** worker processes show high memory usage; profiling shows time spent in `pickle.dumps/loads`. **Fix:** use `shared_memory` for large data, or write to a shared file/mmap and send only the filename through the queue.

**3. Zombie processes from unkilled children.**
A process pool crashes but doesn't terminate child processes. On Linux, these become zombies (visible in `ps` as `<defunct>`). Over time, the PID table fills up and no new processes can be created system-wide. **Diagnosis:** `ps aux | grep defunct` shows growing zombie count. **Fix:** always use pools as context managers (`with Pool() as p:`), and call `pool.terminate()` in exception handlers. In production, use a process supervisor (systemd, supervisord) that reaps orphans.
:::

---

## 🎯 Checkpoint

::: details Question 1 — fork vs spawn
**Q:** A machine learning pipeline uses `multiprocessing.Pool` to parallelize inference. It works on Linux but hangs on macOS after upgrading to Python 3.12. What changed, and how do you fix it?

**A:** Python 3.12 changed the default start method on macOS from `fork` to `spawn`. With `fork`, child processes inherited the parent's memory (including initialized ML models) via copy-on-write. With `spawn`, each child starts a fresh interpreter and must re-initialize everything — including re-loading the ML model. If the model initialization code isn't reachable from `__main__` (e.g., it's in a notebook or uses unpicklable objects), the children fail or hang. **Fix:** either (1) explicitly set `multiprocessing.set_start_method("fork")` (risky if threads exist), (2) use a `Pool` initializer function that loads the model in each child, or (3) restructure so the model is picklable and passed as an argument. The safest option is (2) with `spawn`.
:::

::: details Question 2 — Shared memory vs Queue
**Q:** When should you use `multiprocessing.shared_memory` instead of `multiprocessing.Queue`? What are the tradeoffs?

**A:** Use `shared_memory` when: (1) data is large (avoids pickle serialization/deserialization cost), (2) multiple processes need read access to the same data, (3) you need low-latency access (no pipe I/O). The tradeoffs: shared memory gives you a raw byte buffer — you're responsible for layout, synchronization, and lifecycle management (`unlink()` to free). There's no built-in locking; concurrent writes require external synchronization (`multiprocessing.Lock`). Data must fit in a fixed-size block allocated upfront. `Queue`, by contrast, handles serialization, synchronization, and ordering automatically but copies data through a pipe, making it slow for large objects. For structured data larger than a few KB, shared memory wins on performance; for small messages and coordination signals, Queue wins on simplicity.
:::

::: details Question 3 — Pool sizing
**Q:** You have a 16-core server running a batch processing job. Each task takes 200ms of CPU and 50ms of I/O (reading input). How many pool workers should you use?

**A:** With 80% CPU and 20% I/O per task, this is CPU-dominated. Start with `os.cpu_count()` = 16 workers. The 50ms I/O means each worker is idle ~20% of the time, so you could justify `16 / 0.8 = 20` workers to keep all cores busy during I/O gaps. But beyond `cpu_count`, you hit diminishing returns: more processes means more memory, more context switching, and if the I/O is disk-bound (not parallelizable), more workers won't help. Benchmark with 16, 20, and 24 workers. Also consider whether the I/O is sequential (single disk) or parallel (SSD, network). For a single spinning disk, extra workers may cause seek thrashing. **Practical answer:** start with `os.cpu_count()`, measure, and adjust.
:::

---

## Key Mental Models

- **Multiprocessing trades memory for parallelism.** Each process gets a full Python interpreter — real isolation, real overhead.
- **Everything crosses a serialization boundary.** If you can't pickle it, you can't send it between processes. Design your data flow accordingly.
- **Fork copies problems; spawn avoids them.** If your parent process has threads, locks, GPU contexts, or database connections, `fork` will copy them in broken states. Prefer `spawn` for safety.
- **Shared memory is the escape hatch for large data.** When serialization cost dominates, bypass it entirely with `shared_memory` — but you're on your own for synchronization.
- **Pool startup cost must amortize.** Process creation is expensive. Create pools once, reuse them, and ensure per-task work is large enough to justify the overhead.

---

## Related

- [The GIL — Global Interpreter Lock](./01-gil.md) — why multiprocessing exists: to bypass the GIL for CPU work
- [Threading — Concurrency for I/O](./02-threading.md) — the lighter-weight alternative for I/O-bound work
- [concurrent.futures — Unified Executor API](./05-concurrent-futures.md) — `ProcessPoolExecutor` as the modern interface to multiprocessing pools
- [asyncio — Async/Await from Scratch](./04-asyncio.md) — the single-threaded concurrency model (can combine with multiprocessing via `run_in_executor`)
