---
title: Module 9 — Memory, GC & Performance
outline: deep
---

# Module 9 — Memory, GC & Performance

Understanding how CPython manages memory and knowing how to profile your code are the dividing line between writing Python that works and writing Python that works *at scale*. This module pulls back the curtain on the allocator, the garbage collector, and the profiling toolkit so you can diagnose real-world performance problems instead of guessing.

## What You'll Learn

- How CPython's private heap is organized — arenas, pools, blocks — and why you never call `malloc` directly from Python.
- The two-pronged garbage collection strategy: reference counting for the common case, a generational cycle collector for the rest.
- Weak references, finalizers (`__del__`), and the subtle ways they interact with the GC.
- Object memory overhead — why a Python `int` costs 28 bytes and an empty `dict` costs 64.
- The profiling toolkit: cProfile for function-level hot spots, line_profiler for line-by-line cost, py-spy for sampling live processes, tracemalloc for memory attribution.
- Concrete optimization techniques with before/after benchmarks — and the discipline of profiling *before* optimizing.
- When to reach for Cython, Numba, or C extensions versus when to fix the algorithm.

## Pages in This Module

| # | Page | Focus |
|---|------|-------|
| 1 | [CPython Memory Management](./01-memory-management.md) | Private heap, pymalloc, reference counting, cyclic GC, weak references, `__del__`, object sizes |
| 2 | [Profiling & Optimization](./02-profiling-optimization.md) | cProfile, line_profiler, py-spy, tracemalloc, common optimizations, Cython, Numba, timeit |

After completing both pages, review the [Module 9 Summary](./summary.md) for consolidated mental models and a self-assessment checklist.

## Prerequisites

- [Module 1 — Python Foundations](/python/module-01/) — understanding of Python objects and the data model.
- [Module 4 — OOP & Descriptors](/python/module-04/) — classes, `__init__`, descriptors, `__slots__`.
- [Module 5 — Iterators & Generators](/python/module-05/) — generators and lazy evaluation (relevant to memory-efficient patterns in the optimization page).
