---
title: Profiling & Optimization
outline: deep
---

# Profiling & Optimization

**Interview weight:** 🔥🔥 — interviewers rarely ask you to recite profiler APIs, but they frequently ask "how would you diagnose this slow endpoint?" or "this service uses too much memory — walk me through your approach." Knowing the toolkit and having a disciplined methodology is what separates senior from mid-level answers.

**Python version notes:** All examples target Python 3.12+. `tracemalloc` was added in Python 3.4. `cProfile` has been available since Python 2.5. `line_profiler` and `py-spy` are third-party packages.

**Prerequisites:** [CPython Memory Management](./01-memory-management.md), [Module 5 — Iterators & Generators](/python/module-05/)

## 🗣️ In Plain English

::: tip In Plain English
Optimizing Python code without profiling is like renovating a house by randomly tearing down walls. You might knock out a load-bearing wall (break something critical) while the actual problem — a leaking pipe in the basement — goes untouched.

What you need first is a **building inspector**.

**cProfile** is the inspector who walks through every room in your house and writes down how much time was spent in each one. The report says "you spent 40% of your time in the kitchen and 35% in the bathroom." Now you know which rooms to focus on — no guessing.

**line_profiler** goes deeper. Once you know the kitchen is the problem, this inspector examines the kitchen board by board, telling you "this countertop installation took 80% of the kitchen time." It's slower (you wouldn't run it on the whole house), but it pinpoints the exact line of code that's costing you.

**py-spy** is a surveillance camera. It doesn't require any cooperation from the people inside — you can attach it to a house that's already built and occupied (a running process). It takes periodic snapshots of what everyone is doing and assembles a heat map. Because it just observes without interfering, it barely slows anything down.

**tracemalloc** is a furniture inventory specialist. It doesn't care about time — it cares about *stuff*. It tells you "the living room has 400 pieces of furniture, and 350 of them were brought in by this one delivery" (allocated by this one line of code). When your house is running out of floor space (memory), this is the inspector you call.

The cardinal rule: **inspect first, renovate second.** Donald Knuth said "premature optimization is the root of all evil," and he meant it literally — optimizing the wrong thing wastes your time and often makes the code harder to read for zero benefit. The 80/20 rule applies reliably: 80% of the time is spent in 20% (or less) of the code. Find that 20% before you touch anything.
:::

## ⚙️ Under the Hood

### "Profile first, optimize second"

Knuth's full quote: *"Programmers waste enormous amounts of time thinking about, or worrying about, the speed of noncritical parts of their programs, and these attempts at efficiency actually have a strong negative impact when debugging and maintenance are considered. We should forget about small efficiencies, say about 97% of the time: premature optimization is the root of all evil. Yet we should not pass up our opportunities in that critical 3%."*

The workflow:

1. **Reproduce the problem** with a realistic workload.
2. **Profile** to find the actual bottleneck.
3. **Optimize** the bottleneck — and only the bottleneck.
4. **Measure again** to confirm improvement.
5. **Stop** when you meet your performance target.

### cProfile — function-level profiling

`cProfile` is CPython's built-in deterministic profiler. It instruments every function call with entry/exit timestamps.

**From the command line:**

```bash
python3 -m cProfile -s cumtime script.py
```

The `-s cumtime` flag sorts output by cumulative time (the most useful default). Key columns:

| Column | Meaning |
|--------|---------|
| `ncalls` | Number of times the function was called |
| `tottime` | Time spent *in* the function (excluding sub-calls) |
| `percall` | `tottime / ncalls` |
| `cumtime` | Time spent in the function *including* all sub-calls |
| `percall` (2nd) | `cumtime / ncalls` |

```python
# run: python3 cprofile_demo.py
"""Demonstrate cProfile usage from within code."""
import cProfile
import pstats
from io import StringIO


def slow_function() -> list[int]:
    """Simulates a bottleneck."""
    return sorted([i ** 2 for i in range(50_000)], reverse=True)


def fast_function() -> int:
    """Simulates a fast helper."""
    return sum(range(1000))


def main() -> None:
    for _ in range(10):
        slow_function()
    for _ in range(1000):
        fast_function()


# --- Programmatic profiling ---
profiler = cProfile.Profile()
profiler.enable()

main()

profiler.disable()

# Print top 15 functions by cumulative time
stream = StringIO()
stats = pstats.Stats(profiler, stream=stream)
stats.sort_stats("cumtime")
stats.print_stats(15)
print(stream.getvalue())
```

**Tip:** For web applications, profile a single request handler in isolation rather than the entire server. Most frameworks (Django, FastAPI) have middleware or plugins that wrap individual requests with cProfile.

### line_profiler — line-by-line cost

`line_profiler` is a third-party package (`pip install line_profiler`) that profiles individual lines within decorated functions.

```python
# run: kernprof -l -v line_profile_demo.py
"""Line-by-line profiling with line_profiler.
Install: pip install line_profiler
Run: kernprof -l -v line_profile_demo.py
"""


@profile  # type: ignore[name-defined]  # 'profile' is injected by kernprof
def process_data(n: int) -> dict[str, float]:
    # Generate data
    raw = [i * 0.5 for i in range(n)]

    # Filter
    filtered = [x for x in raw if x > n * 0.25]

    # Transform (deliberately inefficient for demonstration)
    result: dict[str, float] = {}
    for x in filtered:
        result[f"key_{x}"] = x ** 2

    return result


if __name__ == "__main__":
    process_data(100_000)
```

The output shows per-line: hits, time, time-per-hit, and percentage. This is invaluable for pinpointing *which line* in a function is the bottleneck.

### py-spy — sampling profiler for running processes

`py-spy` (`pip install py-spy`) is a **sampling profiler** written in Rust. It reads the Python call stack at regular intervals (typically 100 Hz) without modifying or slowing the target process significantly.

```bash
# Attach to a running process
py-spy top --pid 12345

# Record a flame graph (SVG)
py-spy record -o profile.svg --pid 12345

# Run a script under py-spy
py-spy record -o profile.svg -- python3 my_script.py
```

Key advantages:
- **No code changes** — attach to production processes.
- **Low overhead** — sampling at 100 Hz adds <5% overhead.
- **Flame graphs** — the SVG output is interactive and immediately shows the call stack hot path.
- **GIL detection** — `py-spy` can show which threads are holding the GIL.

### tracemalloc — memory allocation tracking

`tracemalloc` traces memory allocations back to the source code line that allocated them. Essential for hunting memory leaks.

```python
# run: python3 tracemalloc_demo.py
"""Track memory allocations with tracemalloc."""
import tracemalloc
import linecache

tracemalloc.start()

# --- Simulate some allocations ---
small_data: list[int] = list(range(10_000))
big_strings: list[str] = [f"item_{i}" * 100 for i in range(5_000)]
nested: list[dict[str, list[int]]] = [
    {"values": list(range(100))} for _ in range(1_000)
]

# --- Take a snapshot and display top allocators ---
snapshot = tracemalloc.take_snapshot()
top_stats = snapshot.statistics("lineno")

print("=== Top 10 memory allocations by line ===")
for stat in top_stats[:10]:
    print(f"  {stat}")

print(f"\nTotal traced memory: {tracemalloc.get_traced_memory()[0] / 1024:.1f} KB")
print(f"Peak traced memory:  {tracemalloc.get_traced_memory()[1] / 1024:.1f} KB")
```

**Comparing snapshots** to find leaks:

```python
# run: python3 tracemalloc_compare.py
"""Compare two tracemalloc snapshots to find memory growth."""
import tracemalloc

tracemalloc.start()

# Snapshot 1: baseline
data: list[bytes] = []
snapshot1 = tracemalloc.take_snapshot()

# Simulate a "leak" — data that grows but is never cleaned up
for i in range(1_000):
    data.append(b"x" * 1024)  # 1 KB per iteration

# Snapshot 2: after the growth
snapshot2 = tracemalloc.take_snapshot()

# Compare: show what grew
diff = snapshot2.compare_to(snapshot1, "lineno")
print("=== Memory growth between snapshots ===")
for stat in diff[:5]:
    print(f"  {stat}")
```

### sys.getsizeof() vs pympler.asizeof()

`sys.getsizeof()` reports **shallow** size — the object itself, not the objects it references.

```python
# run: python3 shallow_vs_deep.py
"""Shallow (sys.getsizeof) vs deep (pympler.asizeof) measurement.
Install pympler: pip install pympler
"""
import sys

# A list of dicts
data: list[dict[str, int]] = [{"a": i, "b": i * 2} for i in range(100)]

shallow = sys.getsizeof(data)
print(f"sys.getsizeof(data): {shallow} bytes  (just the list's pointer array)")

# Deep size includes all referenced objects
try:
    from pympler.asizeof import asizeof
    deep = asizeof(data)
    print(f"pympler.asizeof(data): {deep} bytes  (list + all 100 dicts + all keys/values)")
    print(f"Ratio: {deep / shallow:.1f}x")
except ImportError:
    print("Install pympler for deep size: pip install pympler")
```

### Common optimizations with benchmarks

Every optimization below should be validated with profiling on your actual workload. These are patterns, not rules.

#### List vs generator for large data (memory)

```python
# run: python3 list_vs_gen.py
"""Compare memory: list comprehension vs generator expression."""
import tracemalloc

tracemalloc.start()

# List: materializes all 1M items in memory
big_list = [x ** 2 for x in range(1_000_000)]
list_snapshot = tracemalloc.take_snapshot()
list_mem = tracemalloc.get_traced_memory()[0]

del big_list

# Reset tracking
tracemalloc.stop()
tracemalloc.start()

# Generator: yields one item at a time, constant memory
big_gen = (x ** 2 for x in range(1_000_000))
total = sum(big_gen)  # Consumes the generator
gen_mem = tracemalloc.get_traced_memory()[1]  # peak

print(f"List peak memory:      {list_mem / 1024 / 1024:.1f} MB")
print(f"Generator peak memory: {gen_mem / 1024 / 1024:.1f} MB")
print(f"Sum result: {total}")  # Same answer either way
```

#### dict/set lookup vs list search

```python
# run: python3 lookup_benchmark.py
"""O(1) dict/set lookup vs O(n) list search."""
import timeit

n = 100_000
data_list: list[int] = list(range(n))
data_set: set[int] = set(range(n))

# Search for an element near the end
target = n - 1

list_time = timeit.timeit(lambda: target in data_list, number=1000)
set_time = timeit.timeit(lambda: target in data_set, number=1000)

print(f"List 'in' ({n} items, 1000 lookups): {list_time:.4f}s")
print(f"Set  'in' ({n} items, 1000 lookups): {set_time:.4f}s")
print(f"Set is {list_time / set_time:.0f}x faster")
```

#### String join vs += concatenation

```python
# run: python3 string_concat.py
"""String join() vs += concatenation at scale."""
import timeit

n = 50_000
parts: list[str] = [f"word_{i}" for i in range(n)]


def concat_plus() -> str:
    result = ""
    for p in parts:
        result += p  # Creates a new string object each time (usually)
    return result


def concat_join() -> str:
    return "".join(parts)  # Single allocation


plus_time = timeit.timeit(concat_plus, number=10)
join_time = timeit.timeit(concat_join, number=10)

print(f"+= concatenation ({n} parts, 10 runs): {plus_time:.4f}s")
print(f"join()           ({n} parts, 10 runs): {join_time:.4f}s")
print(f"join() is {plus_time / join_time:.1f}x faster")

# Note: CPython has an optimization that makes += O(n) in some cases
# (when the string has refcount 1, it resizes in place). But this
# optimization is an implementation detail, not guaranteed, and fails
# when the string is referenced elsewhere.
```

#### `__slots__` for memory reduction

```python
# run: python3 slots_benchmark.py
"""Memory savings from __slots__ at scale."""
import sys


class PointDict:
    def __init__(self, x: float, y: float, z: float) -> None:
        self.x = x
        self.y = y
        self.z = z


class PointSlots:
    __slots__ = ("x", "y", "z")
    def __init__(self, x: float, y: float, z: float) -> None:
        self.x = x
        self.y = y
        self.z = z


regular = PointDict(1.0, 2.0, 3.0)
slotted = PointSlots(1.0, 2.0, 3.0)

regular_size = sys.getsizeof(regular) + sys.getsizeof(regular.__dict__)
slotted_size = sys.getsizeof(slotted)

print(f"Regular instance: {regular_size} bytes (instance + __dict__)")
print(f"Slotted instance: {slotted_size} bytes")
print(f"Savings: {regular_size - slotted_size} bytes per instance")
print(f"At 1M instances: {(regular_size - slotted_size) * 1_000_000 / 1024 / 1024:.0f} MB saved")
```

#### Local variable vs global variable access speed

```python
# run: python3 local_vs_global.py
"""Local variables are faster than globals due to LOAD_FAST vs LOAD_GLOBAL."""
import timeit
import dis

GLOBAL_VALUE: int = 42


def use_global() -> int:
    total = 0
    for _ in range(1000):
        total += GLOBAL_VALUE  # LOAD_GLOBAL bytecode
    return total


def use_local() -> int:
    local_value = GLOBAL_VALUE  # Copy to local once
    total = 0
    for _ in range(1000):
        total += local_value  # LOAD_FAST bytecode
    return total


print("=== Bytecode comparison ===")
print("use_global inner loop uses LOAD_GLOBAL:")
dis.dis(use_global)
print("\nuse_local inner loop uses LOAD_FAST:")
dis.dis(use_local)

global_time = timeit.timeit(use_global, number=10_000)
local_time = timeit.timeit(use_local, number=10_000)

print(f"\nuse_global: {global_time:.4f}s")
print(f"use_local:  {local_time:.4f}s")
print(f"Local is {global_time / local_time:.2f}x faster")
```

`LOAD_FAST` uses an index into a fixed-size array (the function's local variable table). `LOAD_GLOBAL` requires a dictionary lookup (the module's `__dict__`), which is slower even with CPython's inline caching optimizations.

#### collections.deque vs list for queue operations

```python
# run: python3 deque_vs_list.py
"""deque is O(1) for left-end operations; list is O(n)."""
import timeit
from collections import deque

n = 100_000


def list_queue() -> None:
    q: list[int] = []
    for i in range(n):
        q.append(i)
    for _ in range(n):
        q.pop(0)  # O(n) — shifts all elements


def deque_queue() -> None:
    q: deque[int] = deque()
    for i in range(n):
        q.append(i)
    for _ in range(n):
        q.popleft()  # O(1) — doubly-linked list


list_time = timeit.timeit(list_queue, number=3)
deque_time = timeit.timeit(deque_queue, number=3)

print(f"list  as queue ({n} push+pop, 3 runs): {list_time:.4f}s")
print(f"deque as queue ({n} push+pop, 3 runs): {deque_time:.4f}s")
print(f"deque is {list_time / deque_time:.0f}x faster")
```

### timeit — proper microbenchmarking

`timeit` runs a statement many times and reports the best time, automatically disabling the GC to reduce noise.

```python
# run: python3 timeit_demo.py
"""Proper microbenchmarking with timeit."""
import timeit

# From the command line:
#   python3 -m timeit "sum(range(1000))"
#   python3 -m timeit -s "data = list(range(1000))" "sum(data)"

# Programmatic usage
result = timeit.timeit(
    stmt="sum(range(1000))",
    number=100_000,
)
print(f"sum(range(1000)) x 100k: {result:.4f}s ({result / 100_000 * 1e6:.2f} us/call)")

# Compare two approaches
setup = "data = list(range(10_000))"
time_sum = timeit.timeit("sum(data)", setup=setup, number=10_000)
time_loop = timeit.timeit(
    """
total = 0
for x in data:
    total += x
""",
    setup=setup,
    number=10_000,
)

print(f"\nsum(data):     {time_sum:.4f}s")
print(f"manual loop:   {time_loop:.4f}s")
print(f"Built-in sum() is {time_loop / time_sum:.1f}x faster")
```

### Cython — compiling Python to C

Cython compiles Python-like code to C, then to a shared library. Adding C type annotations to critical loops can yield 10-100x speedups.

```python
# File: fib_cython.pyx (Cython source — not runnable as plain Python)
# Build: cythonize -i fib_cython.pyx
# Then: python3 -c "from fib_cython import fib; print(fib(35))"

def fib(int n) -> int:
    """Fibonacci with C-level int — no Python object overhead in the loop."""
    cdef int a = 0
    cdef int b = 1
    cdef int i
    for i in range(n):
        a, b = b, a + b
    return a
```

For comparison, the equivalent pure Python:

```python
# run: python3 fib_comparison.py
"""Compare pure Python Fibonacci to show what Cython would optimize."""
import timeit


def fib_python(n: int) -> int:
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


time_py = timeit.timeit(lambda: fib_python(35), number=100_000)
print(f"Pure Python fib(35) x 100k: {time_py:.4f}s")
print(f"Cython version would typically be 10-50x faster")
print(f"(compile fib_cython.pyx to test: cythonize -i fib_cython.pyx)")
```

### Numba — JIT compilation for numeric code

Numba uses LLVM to JIT-compile Python functions that work with numerical data. No C code needed — just add a decorator.

```python
# run: python3 numba_demo.py
"""Numba JIT compilation for numeric hot loops.
Install: pip install numba
"""
import timeit

try:
    from numba import jit  # type: ignore[import-untyped]

    @jit(nopython=True)  # type: ignore[misc]
    def sum_squares_numba(n: int) -> float:
        total = 0.0
        for i in range(n):
            total += i * i
        return total

    # Warm up the JIT (first call compiles)
    sum_squares_numba(10)

    numba_time = timeit.timeit(lambda: sum_squares_numba(1_000_000), number=100)
    print(f"Numba JIT:    {numba_time:.4f}s (100 calls, n=1M)")
except ImportError:
    print("Numba not installed — pip install numba")
    numba_time = None


def sum_squares_python(n: int) -> float:
    total = 0.0
    for i in range(n):
        total += i * i
    return total


python_time = timeit.timeit(lambda: sum_squares_python(1_000_000), number=100)
print(f"Pure Python:  {python_time:.4f}s (100 calls, n=1M)")

if numba_time:
    print(f"Numba is {python_time / numba_time:.0f}x faster")
```

Numba works best with:
- Loops over numerical arrays (NumPy arrays).
- Mathematical operations without complex Python object manipulation.
- Functions that are called frequently (amortize compilation cost).

Numba does *not* accelerate arbitrary Python code — dict lookups, string operations, and class instance manipulation are not supported in `nopython` mode.

### When to reach for C extensions vs when to fix the algorithm

Decision framework:

| Situation | Approach |
|-----------|----------|
| Algorithm is O(n^2) but could be O(n log n) | Fix the algorithm first |
| Using list `in` instead of set `in` | Fix the data structure |
| Hot loop does float math in pure Python | Try Numba first (zero boilerplate) |
| Need to call a C library (OpenSSL, libxml) | Use `ctypes` or `cffi` |
| Hot loop with complex Python objects | Consider Cython |
| Entire pipeline is numerical (matrices, ML) | Use NumPy/SciPy (already C/Fortran) |
| None of the above works | Write a C extension with the Python C API |

The golden rule: **algorithmic improvements beat constant-factor optimizations by orders of magnitude.** Switching from O(n^2) to O(n log n) matters more than rewriting in C.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Profiling overhead in production**

**Symptom:** A developer enables `cProfile` on a production web server to diagnose slow requests. Response latencies double across the board, triggering alerts and SLO violations.

**Root cause:** `cProfile` is a **deterministic** profiler — it hooks into every function call and return. In a framework like Django or FastAPI with deep call stacks (middleware, ORM, serialization), this overhead is 30-100%. It was never designed for always-on production use.

**Fix:** Use **py-spy** for production profiling. As a sampling profiler, it reads the call stack at intervals without instrumenting function calls, keeping overhead below 5%. For memory, use `tracemalloc.start(1)` (one frame of traceback) to minimize overhead while still attributing allocations.

**2. Optimizing the wrong thing**

**Symptom:** An engineer spends a week rewriting a string-processing function in Cython, achieving a 50x speedup on that function. Overall API latency does not change.

**Root cause:** The string processing took 0.1% of total request time. The actual bottleneck was a database query doing a sequential scan (70% of request time). No amount of Cython will fix a missing database index.

**Fix:** Always profile the complete request path first. Sort by `cumtime` in cProfile output. The top entries are your bottlenecks. If the top entry is `socket.recv` or `cursor.execute`, your problem is I/O, not Python speed.

**3. `timeit` results that don't reflect reality**

**Symptom:** `timeit` shows function A is 3x faster than function B. In production, function B is actually faster.

**Root cause:** `timeit` disables the GC by default (to reduce noise), runs with warm caches, and operates on tiny inputs. Production runs with GC enabled, cold caches, memory pressure, and realistic data sizes. Additionally, `timeit` measures wall-clock time of a tight loop, which doesn't account for memory allocation patterns that cause GC pauses at scale.

**Fix:** Use `timeit` for relative comparisons of small code snippets, not for predicting absolute production performance. For realistic benchmarks, use `cProfile` or `py-spy` on a staging environment with production-like data volumes.
:::

## 🎯 Checkpoint

::: details Question 1 — Diagnosing a slow endpoint
**Q:** A FastAPI endpoint that processes uploaded CSV files takes 12 seconds for a 100MB file. Walk through your profiling strategy to find and fix the bottleneck.

**A:** Step 1: Reproduce with a consistent test file. Step 2: Run the handler function under `cProfile` (not the whole server) — `python3 -m cProfile -s cumtime process_csv.py test.csv`. Look at the top 5 entries by `cumtime`. Likely candidates: (a) if `read` or I/O functions dominate, the bottleneck is disk/network — consider streaming or memory-mapping the file; (b) if a parsing function dominates, use `line_profiler` on that function to find the expensive line — perhaps a regex, a per-row type conversion, or an O(n^2) string concatenation; (c) if memory functions or GC show up, run `tracemalloc` to check whether the entire file is being materialized in memory — switch to streaming/chunked processing. Step 3: After identifying the bottleneck, fix it and re-profile. A common fix for CSV processing: use `csv.reader` with a generator pipeline instead of reading the entire file into a list of dicts, and replace list-based lookups with dict/set lookups. Step 4: Verify the fix under realistic conditions (staging, full-size files, concurrent requests).
:::

::: details Question 2 — Sampling vs deterministic profiling
**Q:** Explain the difference between a deterministic profiler (cProfile) and a sampling profiler (py-spy). When would you choose one over the other?

**A:** A **deterministic profiler** instruments every function call and return — it records the exact number of calls and exact time spent. This gives complete, accurate data but adds significant overhead (30-100% for cProfile) because every function entry/exit triggers profiler code. It is unsuitable for production but excellent for development/staging analysis.

A **sampling profiler** periodically interrupts the program (e.g., 100 times per second) and records the current call stack. It does not instrument individual calls, so overhead is minimal (<5%). The trade-off is statistical: short-lived functions that run between samples may be underrepresented, and exact call counts are not available. However, for the purpose of finding hot spots (the 80/20 rule), sampling is sufficient and safe enough for production use.

Choose cProfile when: you need exact call counts, you are profiling in development, or you need to attribute time precisely to a specific function. Choose py-spy when: you are profiling a live production process, you cannot modify the code, or you need a flame graph visualization of the hot path.
:::

::: details Question 3 — Generator vs list memory trade-off
**Q:** You have a data pipeline that processes 10 million records. Currently it uses a list comprehension at each stage. Explain the memory implications and how generators change them. Are there cases where a list is actually better?

**A:** A list comprehension materializes all 10M results in memory simultaneously. If each record is a 200-byte dict, that is ~2 GB. With three pipeline stages (`filter` -> `transform` -> `aggregate`), you could have three lists alive at once: ~6 GB peak.

A generator pipeline (`(transform(x) for x in data if predicate(x))`) processes one item at a time and discards it before producing the next. Peak memory is proportional to one item, not the full dataset — roughly O(1) regardless of input size.

However, lists are better when: (a) you need to iterate over the data multiple times (a generator is exhausted after one pass), (b) you need random access by index, (c) the total data fits comfortably in memory and you need the speed of C-level list iteration over generator `__next__` call overhead, or (d) you need to know the length upfront (e.g., for progress bars or pre-allocating output arrays). The key insight is that generators trade *time* (per-item `__next__` overhead, inability to use C-optimized bulk operations like `sum` on a list) for *memory*.
:::

## Key Mental Models

- **Profile before optimizing:** Without measurement, you are guessing. The bottleneck is almost never where you think it is. cProfile for function-level, line_profiler for line-level, py-spy for production, tracemalloc for memory.
- **Algorithmic wins dwarf constant-factor wins:** Switching from O(n^2) to O(n log n) is worth more than rewriting O(n^2) in C. Fix data structures and algorithms before reaching for Cython or Numba.
- **`sys.getsizeof()` lies by omission:** It reports shallow size only. A list of 1000 dicts appears to be ~8 KB (just the pointer array), but the total including all dicts and their contents is hundreds of KB. Use `pympler.asizeof()` for the real number.
- **Sampling profilers are production-safe; deterministic profilers are not:** py-spy adds <5% overhead. cProfile adds 30-100%. Never leave cProfile enabled in production.
- **`timeit` is for relative comparisons, not absolute predictions:** Its controlled environment (GC disabled, warm caches, tiny inputs) does not reflect production conditions.

## Related

- [CPython Memory Management](./01-memory-management.md) — the allocator and GC internals that profiling tools like tracemalloc observe.
- [Module 5: Iterators & Generators](/python/module-05/) — generator pipelines as a memory optimization technique.
- [Module 4: Metaclasses & `__slots__`](/python/module-04/04-metaclasses-slots.md) — `__slots__` for per-instance memory reduction.
- [Module 7: The GIL](/python/module-07/01-gil.md) — the GIL's impact on CPU-bound performance and why multiprocessing or C extensions bypass it.
