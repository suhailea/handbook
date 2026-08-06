---
title: Module 9 Summary
outline: deep
---

# Module 9 Summary — Memory, GC & Performance

## Mental Models Gained

1. **Two-layer garbage collection:** Reference counting handles the common case (immediate, deterministic deallocation). The cyclic collector handles the exception (reference cycles). Neither alone is sufficient, and understanding when each fires is the key to predicting memory behavior.

2. **pymalloc is a small-object fast path:** Objects up to 512 bytes are served from CPython's arena/pool/block hierarchy, avoiding expensive system `malloc` calls. Larger objects fall through to the OS. This is why millions of small Python objects are feasible, but each carries irreducible header overhead.

3. **Weak references are a design pattern, not a workaround:** Use `weakref` to build caches that do not prevent garbage collection, observer patterns where the subject should not own the listener, and parent-child structures where one direction is non-owning.

4. **Profile before optimizing:** The bottleneck is almost never where intuition says it is. cProfile for function-level hot spots, line_profiler for line-level cost, py-spy for sampling live processes, tracemalloc for memory attribution. Skipping this step is the most common source of wasted optimization effort.

5. **Algorithmic wins dwarf constant-factor wins:** Switching from O(n^2) to O(n log n), or from list-based lookup to set-based lookup, produces larger improvements than rewriting Python in C. Reach for Cython/Numba only after the algorithm and data structures are correct.

6. **Generators trade time for memory:** A generator pipeline processes one item at a time with O(1) memory, but each `__next__` call has overhead. Lists allow bulk C-level operations and random access. The right choice depends on dataset size, iteration pattern, and whether you need multiple passes.

## Self-Assessment Checklist

Use this checklist to verify you have internalized the module. If you cannot answer a question confidently, revisit the linked page.

- [ ] **Can you draw CPython's memory hierarchy?** Arenas (256 KB) -> pools (4 KB, one per size class) -> blocks (8-512 bytes). Objects >512 bytes go to system malloc. ([Memory Management](./01-memory-management.md))

- [ ] **Can you explain why `del x` does not always free memory?** `del` removes the name binding and decrements the refcount by 1. The object is freed only if the refcount reaches zero. If other references exist (containers, closures, cycles), the object persists. ([Memory Management](./01-memory-management.md))

- [ ] **Can you create and identify a reference cycle?** Two objects with mutual references, or a self-referencing container. After deleting external references, refcounts remain >0. Only the cyclic GC can reclaim them. ([Memory Management](./01-memory-management.md))

- [ ] **Can you explain the three GC generations and their thresholds?** gen0 (700 net allocations), gen1 (every 10 gen0 collections), gen2 (every 10 gen1 collections). Objects that survive a collection are promoted. ([Memory Management](./01-memory-management.md))

- [ ] **Do you know when `gc.disable()` and `gc.freeze()` are legitimate?** Pre-fork servers to preserve copy-on-write pages. Workloads with no reference cycles. Latency-sensitive code where GC pauses are unacceptable. Always pair with manual `gc.collect()` at safe points. ([Memory Management](./01-memory-management.md))

- [ ] **Can you profile a Python function and interpret the output?** cProfile's columns: ncalls, tottime (self), cumtime (self + children), percall. Sort by cumtime to find the hot path. ([Profiling & Optimization](./02-profiling-optimization.md))

- [ ] **Can you choose the right profiler for the situation?** cProfile for development, line_profiler for per-line cost, py-spy for production/live processes, tracemalloc for memory. ([Profiling & Optimization](./02-profiling-optimization.md))

- [ ] **Can you list five concrete optimizations and explain why each works?** set/dict lookup (O(1) vs O(n)), `str.join` (single allocation vs N copies), `__slots__` (no per-instance `__dict__`), generators (O(1) memory), local variables (LOAD_FAST vs LOAD_GLOBAL). ([Profiling & Optimization](./02-profiling-optimization.md))

- [ ] **Do you know when Cython and Numba are appropriate?** Numba for numerical hot loops (zero boilerplate, LLVM JIT). Cython for loops with complex Python objects or when you need C library integration. Neither helps with I/O-bound code or algorithmic inefficiency. ([Profiling & Optimization](./02-profiling-optimization.md))

- [ ] **Can you use tracemalloc to find a memory leak?** Start tracing, take a baseline snapshot, run the suspect code, take a second snapshot, compare. The diff shows which lines allocated the most new memory. ([Profiling & Optimization](./02-profiling-optimization.md))

## Quick Reference

### Object sizes (CPython 3.12, 64-bit)

| Object | `sys.getsizeof()` (bytes) | Notes |
|--------|---------------------------|-------|
| `int(0)` | 28 | PyLongObject header + 1 digit |
| `int(2**30)` | 32 | 2 digits |
| `int(2**120)` | 44 | 5 digits |
| `float(3.14)` | 24 | Header + 8-byte IEEE 754 double |
| `bool(True)` | 28 | Subclass of int |
| `None` | 16 | Singleton, minimal header |
| `str("")` | 49 | Compact ASCII, base overhead |
| `str("hello")` | 54 | 49 + 5 characters |
| `bytes(b"")` | 33 | Base overhead |
| `list([])` | 56 | Header + empty pointer array |
| `list(range(10))` | 136 | 56 + 10 * 8 byte pointers |
| `tuple(())` | 40 | Smaller header than list (no resize fields) |
| `tuple(range(10))` | 120 | 40 + 10 * 8 byte pointers |
| `dict({})` | 64 | Compact dict (Python 3.6+) |
| `set()` | 216 | Hash table overhead |
| Object (no `__slots__`) | 48 + 64 (`__dict__`) | ~112 bytes minimum |
| Object (`__slots__`) | 48-56 | No `__dict__`, fixed layout |

*Sizes are approximate and vary by platform. Always verify with `sys.getsizeof()` on your target runtime.*

### Profiling tools comparison

| Tool | Type | Overhead | Production-safe | What it measures | Install |
|------|------|----------|-----------------|------------------|---------|
| `cProfile` | Deterministic | 30-100% | No | Function call counts + time | Built-in |
| `line_profiler` | Deterministic | High | No | Per-line time | `pip install line_profiler` |
| `py-spy` | Sampling | <5% | Yes | Call stack snapshots, flame graphs | `pip install py-spy` |
| `tracemalloc` | Allocation tracking | 10-30% | Cautiously | Memory allocations by source line | Built-in |
| `timeit` | Microbenchmark | N/A | N/A | Execution time of code snippets | Built-in |
| `sys.getsizeof` | Introspection | None | Yes | Shallow object size | Built-in |
| `pympler.asizeof` | Introspection | Moderate | No | Deep/recursive object size | `pip install pympler` |

### Optimization checklist

Before optimizing, ask these questions in order:

1. **Have I profiled?** If not, stop and profile first.
2. **Is it an algorithm problem?** O(n^2) -> O(n log n) beats any constant-factor optimization.
3. **Is it a data structure problem?** list `in` -> set `in`, list as queue -> `collections.deque`.
4. **Is it an I/O problem?** Database queries, network calls, disk reads. No amount of Python optimization fixes a missing index or unnecessary round trip.
5. **Is it a memory problem?** Materialize less data (generators), use `__slots__`, reduce object count.
6. **Is it a CPU-bound hot loop?** Try Numba (numerical), Cython (general), or move to a C extension.
7. **Have I measured the improvement?** Re-profile to confirm. If the improvement is <10% and the code is harder to read, revert.

## What's Next

Continue to [Module 10 — Type Hints & Modern Python](/python/module-10/) to learn how Python's type annotation system works under the hood, from basic annotations through advanced generics, `Protocol`, and integration with mypy and Pydantic.
