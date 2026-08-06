---
title: Module 5 — Iterators, Generators & Comprehensions
outline: deep
---

# Module 5 — Iterators, Generators & Comprehensions

Python's iteration machinery is one of its deepest and most elegant features. Almost every loop, comprehension, unpacking, and data pipeline you write depends on a single protocol: the **iterator protocol**. This module takes you from the low-level mechanics of `__iter__` and `__next__` through generators (Python's answer to lazy evaluation) to comprehensions and `itertools` (the toolkit for composing iteration pipelines without materializing intermediate collections).

By the end of this module, you will think of iteration not as "looping over a list" but as **pulling values one at a time from any source** — a file, a network stream, a mathematical sequence, or a chain of transformations — with constant memory overhead.

## What You'll Learn

- The **iterator protocol** — the two-dunder contract (`__iter__`, `__next__`) that powers every `for` loop, and how CPython implements it at the bytecode level.
- **Generators** — functions that pause and resume, producing values lazily. How `yield` suspends a frame, how `send()` / `throw()` / `close()` turn generators into coroutines, and how `yield from` delegates to sub-generators.
- **Comprehensions & itertools** — concise syntax for building collections, the memory difference between list comprehensions and generator expressions, and the pre-built iteration building blocks in the standard library.

## Pages in This Module

| # | Page | Focus |
|---|------|-------|
| 1 | [The Iterator Protocol](./01-iterator-protocol.md) | `__iter__` / `__next__`, `StopIteration`, `for` loop desugaring, custom iterators, `iter(callable, sentinel)`, CPython bytecode |
| 2 | [Generators — Lazy Evaluation](./02-generators.md) | `yield`, generator state machine, `send` / `throw` / `close`, generator expressions, `yield from`, memory advantages |
| 3 | [Comprehensions & itertools](./03-comprehensions-itertools.md) | List/dict/set comprehensions, scoping rules, `itertools` essentials, data pipelines |

## Prerequisites

- **[Module 3 — Functions & Scoping](/python/module-03/)**: You need to understand closures, `*args`/`**kwargs`, and how Python manages function-local state to grasp how generators freeze and resume their local scope.
- **[Module 4 — OOP & Descriptors](/python/module-04/)**: The iterator protocol is built on dunder methods (`__iter__`, `__next__`), so you should be comfortable with Python's special-method dispatch.

## How the Pages Connect

The iterator protocol (page 1) is the **foundation** — it defines the contract that all iteration depends on. Generators (page 2) are Python's shortcut for *implementing* that protocol without writing a class. Comprehensions and `itertools` (page 3) are **consumers and composers** of iterators — high-level tools built on top of the same protocol. Every page builds on the one before it.
