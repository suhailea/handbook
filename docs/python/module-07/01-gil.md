---
title: The GIL — Global Interpreter Lock
outline: deep
---

# The GIL — Global Interpreter Lock

**Interview weight:** 🔥🔥🔥 — THE most-asked Python interview topic. If you know one thing about Python concurrency, know this.

**Python version:** CPython-specific. PyPy has a GIL too. Jython and IronPython do not. Free-threaded CPython (3.13t+) experimentally removes it.

**Prerequisites:** [Memory & GC — Reference Counting](/python/module-06/)

---

## 🗣️ In Plain English

::: tip In Plain English
Imagine a recording studio with one microphone. Multiple singers (threads) are in the studio, but only one can use the mic at a time. They take turns — each singer gets a few seconds at the microphone, then passes it to the next person waiting.

This microphone is the Global Interpreter Lock. It ensures that only one thread is ever "speaking" Python bytecode at any given instant, no matter how many threads you create.

Now here's the twist that makes the microphone less of a problem than it sounds: if a singer is waiting for a pizza delivery — say they ordered food and are just standing around — they voluntarily step away from the microphone so someone else can sing. That's what happens during I/O. When your thread is waiting for a network response, reading from disk, or sleeping, it releases the mic. Another thread grabs it and runs.

The microphone only becomes a real bottleneck when every singer needs to sing nonstop. If all your threads are doing heavy computation (crunching numbers, processing images, running algorithms), they're all fighting for the one mic. Only one voice gets recorded at a time. Your eight-core machine acts like a one-core machine — actually worse, because the singers waste energy passing the mic back and forth.

This is why Python threads are great for I/O-heavy work (web scraping, API calls, file operations) but terrible for CPU-heavy work (data processing, number crunching). For CPU work, you need separate studios entirely — that's multiprocessing, which gives each worker its own mic, its own room, and its own copy of everything.

The GIL exists because CPython's memory management (reference counting) was never designed for truly concurrent access. Removing it is like trying to renovate the foundation of a skyscraper while people are living in it. That renovation is finally happening — Python 3.13 ships an experimental "free-threaded" mode — but the building is still standing on the old foundation for now.
:::

---

## ⚙️ Under the Hood

### What the GIL Protects

The GIL is a mutex (mutual exclusion lock) inside the CPython interpreter that ensures only one thread executes Python bytecode at a time. It exists to protect three things:

1. **Reference counts are not atomic.** Every Python object has an `ob_refcnt` field. Operations like `Py_INCREF` and `Py_DECREF` are simple `++` and `--` on this integer — not atomic operations. Without the GIL, two threads incrementing/decrementing the same object's refcount simultaneously would produce data races and memory corruption.

2. **CPython internal data structures.** The interpreter's internal state — the object allocator, the list of loaded modules, the dictionary of global variables — uses non-thread-safe C data structures. The GIL serializes access to all of them.

3. **C extension thread safety.** Many C extensions were written assuming single-threaded access. The GIL lets them work without modification.

```python
# run: python3 gil_refcount.py
import sys

a = []
# sys.getrefcount() returns refcount + 1 (for the temporary reference in the call itself)
print(f"refcount of a: {sys.getrefcount(a) - 1}")  # typically 1

b = a  # Py_INCREF on a's object — not atomic without GIL
print(f"refcount of a after b = a: {sys.getrefcount(a) - 1}")  # 2

del b  # Py_DECREF — not atomic without GIL
print(f"refcount of a after del b: {sys.getrefcount(a) - 1}")  # back to 1
```

### How the GIL Works: Time-Based Switching (Python 3.2+)

Before Python 3.2, the GIL was released every 100 bytecode instructions (the "tick" interval, `sys.setcheckinterval()`). This was unpredictable — some bytecodes take microseconds, others milliseconds.

Since Python 3.2 (via Antoine Pitrou's new GIL implementation), switching is **time-based**. A thread holds the GIL for up to **5 milliseconds** (the default), then another waiting thread can request it:

```python
# run: python3 gil_switch_interval.py
import sys

# Default: 5ms (0.005 seconds)
print(f"GIL switch interval: {sys.getswitchinterval()} seconds")

# You can change it (rarely useful outside benchmarks)
sys.setswitchinterval(0.001)  # 1ms — more responsive but more overhead
print(f"New switch interval: {sys.getswitchinterval()} seconds")

# Reset to default
sys.setswitchinterval(0.005)
```

The mechanism: when a thread wants the GIL and another thread holds it, the requesting thread sets a flag (`gil_drop_request`). The holding thread checks this flag after each bytecode instruction and, if set, releases the GIL and waits. The requesting thread acquires it.

### GIL Release During I/O

The GIL is released whenever CPython performs blocking I/O or calls into certain C libraries. This is the key reason threading works for I/O:

```python
# run: python3 gil_io_release.py
import threading
import time
import urllib.request

def fetch(url: str, label: str) -> None:
    start = time.perf_counter()
    urllib.request.urlopen(url).read()
    elapsed = time.perf_counter() - start
    print(f"  {label}: {elapsed:.2f}s")

url = "https://httpbin.org/delay/1"  # 1-second delay endpoint

# Sequential: ~3 seconds
print("Sequential:")
seq_start = time.perf_counter()
for i in range(3):
    fetch(url, f"request-{i}")
seq_total = time.perf_counter() - seq_start
print(f"  Total: {seq_total:.2f}s\n")

# Threaded: ~1 second (GIL released during network I/O)
print("Threaded:")
thr_start = time.perf_counter()
threads = [threading.Thread(target=fetch, args=(url, f"request-{i}")) for i in range(3)]
for t in threads:
    t.start()
for t in threads:
    t.join()
thr_total = time.perf_counter() - thr_start
print(f"  Total: {thr_total:.2f}s")
```

Operations that release the GIL include:
- `read()`, `write()`, `recv()`, `send()` on sockets and files
- `time.sleep()`
- `select.select()`, `select.poll()`, `select.epoll()`
- Many `hashlib`, `zlib`, and `numpy` operations

### C Extensions That Release the GIL

C extensions can explicitly release the GIL using the `Py_BEGIN_ALLOW_THREADS` / `Py_END_ALLOW_THREADS` macros. This is how numpy achieves parallel speedups even in threaded Python:

| Library | Releases GIL? | Why |
|---------|--------------|-----|
| `numpy` (array ops) | Yes | Pure C/Fortran math, no Python objects touched |
| `hashlib` | Yes | OpenSSL does the work in C |
| `zlib` | Yes | Compression is pure C |
| `re` (matching) | Yes | The regex engine is C |
| `json` (C impl) | No | Builds Python objects during parsing |
| `pickle` | No | Manipulates Python objects throughout |

### Demonstrating the GIL: CPU-Bound Threading is Slower

This is the canonical GIL demonstration — CPU-bound work with threads is actually **slower** than single-threaded, due to GIL contention overhead:

```python
# run: python3 gil_cpu_demo.py
import threading
import time

def cpu_work(n: int) -> int:
    """Pure CPU-bound work: count up to n."""
    total = 0
    for i in range(n):
        total += i * i
    return total

COUNT = 20_000_000

# Single-threaded: do the work twice sequentially
start = time.perf_counter()
cpu_work(COUNT)
cpu_work(COUNT)
single = time.perf_counter() - start
print(f"Single-threaded (2x sequential): {single:.2f}s")

# Two threads: same total work, but GIL contention adds overhead
start = time.perf_counter()
t1 = threading.Thread(target=cpu_work, args=(COUNT,))
t2 = threading.Thread(target=cpu_work, args=(COUNT,))
t1.start()
t2.start()
t1.join()
t2.join()
threaded = time.perf_counter() - start
print(f"Two threads:                      {threaded:.2f}s")
print(f"Threaded is {'SLOWER' if threaded > single else 'faster'} "
      f"(ratio: {threaded / single:.2f}x)")
```

Typical output on a multi-core machine: the threaded version is 1.1x-1.5x **slower** due to GIL acquisition/release overhead and cache-line bouncing.

### Free-Threaded CPython (PEP 703)

Python 3.13 ships an experimental build (`python3.13t` or `--disable-gil` build flag) that removes the GIL entirely. This is the biggest change to CPython's concurrency model in its history.

**What changes internally:**

| Mechanism | With GIL | Free-Threaded (3.13t+) |
|-----------|----------|----------------------|
| Reference counting | Simple `++`/`--` | **Biased reference counting**: the owning thread uses non-atomic ops; other threads use atomic ops |
| Object deallocation | Immediate when refcount hits 0 | **Deferred reference counting** for some objects; may delay deallocation |
| Container access | GIL-protected | **Per-object locks** (fine-grained locking) |
| Dict/list internals | Not thread-safe by design | Lock-free reads with per-object mutexes for writes |
| C extensions | Assume GIL protection | Must declare thread safety via `Py_mod_gil` slot |

**The migration path:**

```python
# run: python3 gil_check_free_threaded.py
import sys

# Check if running free-threaded build
# In 3.13t+, sys._is_gil_enabled() exists
if hasattr(sys, "_is_gil_enabled"):
    print(f"GIL enabled: {sys._is_gil_enabled()}")
    # In free-threaded builds, GIL is disabled by default
    # but can be re-enabled with PYTHON_GIL=1 env var
else:
    print("Standard CPython build — GIL is always active")
    print(f"Python version: {sys.version}")

# Extension modules must opt in to free-threaded mode:
# In C: set Py_mod_gil = Py_MOD_GIL_NOT_USED in module def
# Without this, importing the module re-enables the GIL
```

**Current status (as of Python 3.13):** experimental. Many C extensions (numpy, etc.) need updates. Performance of single-threaded code may regress 5-10% due to the overhead of fine-grained locking. Expected to stabilize over 3.14-3.16.

### When the GIL Matters vs When It Doesn't

| Scenario | GIL Impact | Solution |
|----------|-----------|----------|
| **CPU-bound parallel work** | Full bottleneck — only 1 thread runs at a time | `multiprocessing`, `ProcessPoolExecutor`, or numpy/C extensions that release GIL |
| **I/O-bound concurrent work** | Minimal — GIL released during I/O waits | `threading` or `asyncio` both work well |
| **Single-threaded program** | Zero impact — you never contend for it | N/A |
| **C extension doing math** | Depends — does it release GIL? | Check library docs; numpy/scipy/hashlib do |
| **asyncio event loop** | Minimal — single thread, no contention | N/A (though `asyncio.to_thread()` for blocking calls) |

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. "We added threads and it got slower."**
A data pipeline team parallelized CSV parsing across 8 threads expecting 8x speedup. Wall-clock time increased by 40%. The work was CPU-bound (string parsing, float conversion). Each thread fought for the GIL every 5ms, and the contention overhead — GIL acquisition, cache invalidation across cores, context switching — made it worse than sequential. **Diagnosis:** `py-spy` or `cProfile` shows all threads have similar CPU time but wall-clock time doesn't shrink. **Fix:** switch to `ProcessPoolExecutor` or use pandas (which releases the GIL for C-level operations).

**2. "Free-threaded build broke our app."**
A team tried Python 3.13t for true thread parallelism. The app crashed with segfaults because a C extension (a database driver) assumed GIL protection and had thread-unsafe global state. Importing it re-enabled the GIL silently via the `Py_mod_gil` fallback, negating the benefit. **Diagnosis:** check `sys._is_gil_enabled()` after imports — if it flips to `True`, a non-compatible extension triggered it. **Fix:** audit all C extensions for `Py_MOD_GIL_NOT_USED` support before deploying free-threaded builds.

**3. "The GIL switch interval killed our latency."**
A real-time trading system with tight latency requirements ran a monitoring thread alongside the main trading thread. The default 5ms switch interval meant the trading thread could be interrupted for up to 5ms every switch. For microsecond-sensitive paths, this is catastrophic. **Diagnosis:** measure P99 latency; observe periodic 5ms spikes correlated with thread scheduling. **Fix:** either eliminate the extra thread (use asyncio or a subprocess for monitoring) or tune `sys.setswitchinterval()` — but tuning has diminishing returns.
:::

---

## 🎯 Checkpoint

::: details Question 1 — Why can't CPython just use atomic reference counting?
**Q:** If the GIL exists primarily to protect reference counts, why not simply make `Py_INCREF`/`Py_DECREF` atomic (using CPU atomics like `lock inc`) and remove the GIL?

**A:** Atomic operations are significantly slower than plain increments — roughly 2-10x on x86, worse on ARM. Since virtually every Python operation touches reference counts (passing arguments, returning values, attribute access), making them atomic would slow down all single-threaded Python code substantially. This is the core tradeoff: the GIL makes single-threaded code fast at the cost of limiting multi-threaded parallelism. The free-threaded build (PEP 703) addresses this with **biased reference counting** — the owning thread uses fast non-atomic ops, and only cross-thread references use atomics — combined with deferred reference counting for immortal objects. This limits the atomic overhead to objects actually shared between threads.
:::

::: details Question 2 — Threading for I/O but not CPU
**Q:** A Python service handles 100 concurrent HTTP requests by spawning a thread per request. The handler reads from a database and returns JSON. Under what conditions does the GIL become a bottleneck here, even though this is "I/O-bound" work?

**A:** The work is I/O-bound only while waiting for database responses. But the handler also does CPU work: deserializing database rows into Python objects, serializing response dicts to JSON, template rendering, input validation. If these CPU segments collectively exceed a few milliseconds per request, 100 threads will contend for the GIL during those CPU segments. The GIL becomes a bottleneck when the aggregate CPU time across all concurrent handlers exceeds the wall-clock time. You'll see this as: CPU utilization pinned near 100% on one core (despite having many), and throughput plateauing well below what `multiprocessing` or `asyncio` (which avoids the thread overhead) would achieve. The solution is typically `asyncio` with an async database driver (eliminates thread overhead) or moving heavy serialization to C extensions that release the GIL.
:::

::: details Question 3 — GIL and signals
**Q:** Why does CPython only deliver signals (like `SIGINT` from Ctrl-C) to the main thread, and how does the GIL interact with this?

**A:** CPython installs signal handlers that set a flag, and the main thread checks these flags when it acquires the GIL between bytecode instructions. Only the main thread runs signal handlers because: (1) POSIX signal delivery to a specific thread is unreliable, and (2) Python's signal handling is not async-signal-safe — it must run Python code, which requires the GIL. This means if a background thread holds the GIL for an extended period (e.g., in a long-running C extension that doesn't release it), Ctrl-C will appear unresponsive because the main thread can't acquire the GIL to run the signal handler. The GIL switch interval (5ms) bounds this delay in pure Python code, but C extensions that hold the GIL can block signals indefinitely.
:::

---

## Key Mental Models

- **The GIL is a mutex on the interpreter, not on your data.** It prevents two threads from executing Python bytecode simultaneously — it does NOT make your code thread-safe. You still need locks for shared mutable state.
- **I/O releases the mic.** Any operation that blocks on the kernel (network, disk, sleep) releases the GIL, which is why threads excel at I/O concurrency.
- **CPU-bound threading is worse than useless.** Due to contention overhead, N threads doing CPU work will be slower than one thread doing it sequentially.
- **The GIL is a CPython implementation detail, not a language feature.** Other Python implementations (Jython, IronPython) don't have one. Free-threaded CPython is removing it.
- **Know the workarounds:** `multiprocessing` for CPU parallelism, `asyncio` for I/O concurrency, and C extensions that explicitly release the GIL for heavy computation.

---

## Related

- [Threading — Concurrency for I/O](./02-threading.md) — how to use threads effectively despite the GIL
- [Multiprocessing — True Parallelism](./03-multiprocessing.md) — the primary workaround for CPU-bound GIL limitations
- [asyncio — Async/Await from Scratch](./04-asyncio.md) — single-threaded concurrency that sidesteps the GIL entirely
- [Memory & GC — Reference Counting](/python/module-06/) — the reference counting mechanism that the GIL protects
