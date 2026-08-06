---
title: Module 5 Summary
outline: deep
---

# Module 5 Summary — Iterators, Generators & Comprehensions

## Mental Models Gained

1. **Iterable vs Iterator = Book vs Bookmark.** An iterable can produce fresh iterators (bookmarks). An iterator is a one-way, one-pass cursor that remembers position. The split between container and cursor is what makes Python's `for` loop work on everything from lists to files to network streams.

2. **`for` is sugar for `iter()` + `next()` + catch `StopIteration`.** Every `for` loop calls `__iter__` to get an iterator, then calls `__next__` repeatedly until `StopIteration` is raised. The CPython bytecodes `GET_ITER` and `FOR_ITER` implement this at the C level.

3. **`yield` freezes a function mid-execution.** A generator function's frame (local variables, instruction pointer) is preserved on `yield` and restored on `next()`. This is not magic — it's the interpreter saving and restoring a frame object.

4. **Generators are iterators you write as functions.** Instead of implementing `__iter__` + `__next__` in a class, `yield` gives you an iterator for free. The generator handles `StopIteration`, state management, and the iterator protocol automatically.

5. **`yield from` is a bidirectional pipe.** It doesn't just forward values — it passes `send()`, `throw()`, and `close()` through to the sub-generator and captures its `return` value. Manual forwarding requires ~40 lines of boilerplate.

6. **Comprehensions trade memory for speed; generators trade speed for memory.** List comprehensions allocate the entire result upfront (fast iteration, high memory). Generator expressions produce one item at a time (low memory, per-item overhead). Choose based on whether you need the whole collection or just one pass.

7. **`itertools` is a standard vocabulary for iteration patterns.** Learning `chain`, `islice`, `groupby`, `product`, `accumulate`, `tee`, `pairwise`, and `batched` lets you compose pipelines declaratively instead of writing custom loops.

8. **Lazy pipelines are the key to constant-memory data processing.** Chaining generators and `itertools` functions processes items one at a time — a 50 GB file flows through the pipeline with only a few KB of overhead.

## Self-Assessment Checklist

Rate yourself on each item: **confident** / **shaky** / **need to revisit**.

| # | Concept | Status |
|---|---------|--------|
| 1 | I can explain the difference between an iterable and an iterator, and why iterators return `self` from `__iter__`. | |
| 2 | I can desugar a `for` loop into `iter()` / `next()` / `StopIteration` and explain the CPython bytecodes involved. | |
| 3 | I can write a custom iterator class with separate iterable and iterator objects for re-iterability. | |
| 4 | I know when to use `iter(callable, sentinel)` and can give a practical I/O example. | |
| 5 | I can explain generator states (CREATED, RUNNING, SUSPENDED, CLOSED) and how `yield` suspends a frame. | |
| 6 | I can use `send()`, `throw()`, and `close()` on a generator and explain what each does at the protocol level. | |
| 7 | I can use `yield from` and explain what it does beyond a simple `for`/`yield` loop (forwarding send, throw, close, capturing return). | |
| 8 | I know the memory difference between `[x for x in range(1M)]` and `(x for x in range(1M))` and when to choose each. | |
| 9 | I can use `itertools.groupby` correctly (sorting first) and explain why it fails on unsorted data. | |
| 10 | I can build a multi-stage data pipeline using chained generators and `itertools` that processes data in constant memory. | |

## Quick Reference

### The Iterator Protocol

| Method | Defined On | Returns | Purpose |
|--------|-----------|---------|---------|
| `__iter__()` | Iterable | An iterator object | Creates a fresh cursor; called by `iter()` and `for` |
| `__iter__()` | Iterator | `self` | Makes iterators usable wherever iterables are expected |
| `__next__()` | Iterator | Next value, or raises `StopIteration` | Advances the cursor; called by `next()` and `for` |

### Generator Methods

| Method | Effect |
|--------|--------|
| `next(gen)` | Resumes execution until next `yield`; returns yielded value |
| `gen.send(value)` | Resumes execution; `yield` expression evaluates to `value` |
| `gen.throw(exc_type)` | Raises exception at the suspension point |
| `gen.close()` | Throws `GeneratorExit` at the suspension point |

### Key `itertools` Functions

| Function | Purpose | Gotcha |
|----------|---------|--------|
| `chain(*iterables)` | Concatenate iterables end-to-end | — |
| `chain.from_iterable(it)` | Flatten one level of nesting | — |
| `islice(it, start, stop, step)` | Lazy slicing (no negative indices) | Consumes items from the iterator |
| `groupby(it, key)` | Group consecutive equal-key elements | **Input must be sorted by key** |
| `product(*iterables)` | Cartesian product | Result size is multiplicative |
| `permutations(it, r)` | r-length permutations | O(n!/(n-r)!) items |
| `combinations(it, r)` | r-length combinations without replacement | — |
| `zip_longest(*its, fillvalue)` | Zip, padding shorter iterables | — |
| `pairwise(it)` | Sliding window of size 2 | Python 3.10+ |
| `batched(it, n)` | Group into n-sized chunks | Python 3.12+ |
| `accumulate(it, func)` | Running totals (or running max, etc.) | Default func is `operator.add` |
| `tee(it, n)` | Clone an iterator into n copies | Buffers if consumers diverge — memory risk |
| `filterfalse(pred, it)` | Yield items where predicate is false | Complement of `filter()` |

## What's Next

Continue to **[Module 6 — Errors & Context Managers](/python/module-06/)** to learn how Python's exception system works under the hood and how `with` statements tie into the iterator-like protocol pattern (`__enter__`/`__exit__`). You'll see that `contextlib.contextmanager` uses *generators* to implement context managers — a direct application of this module's material.
