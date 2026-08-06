---
title: Module 2 — Data Structures Deep Dive
outline: deep
---

# Module 2 — Data Structures Deep Dive

Every non-trivial program boils down to **choosing the right container** for your data and understanding the cost of every operation on it. This module tears open CPython's core data structures — lists, tuples, dicts, sets, and the `collections` toolkit — so you can make those choices with precision rather than intuition.

## What You'll Learn

- How CPython implements **lists as dynamic arrays** with a specific over-allocation formula, and why `append` is O(1) amortized but `insert(0, x)` is O(n).
- The real meaning of **tuple immutability** — and the surprising fact that a tuple can contain mutable objects.
- How **dictionaries are hash tables** with open addressing and perturbation-based probing, including the compact dict layout that preserves insertion order since Python 3.7.
- How **sets** reuse the same hash-table machinery minus the values.
- The **collections module** power tools: `Counter`, `deque`, `defaultdict`, `ChainMap`, `namedtuple` — and when each one saves you from reinventing the wheel.
- A decision framework for **choosing the right container** based on access patterns, mutability needs, and hashability requirements.

## Pages in This Module

| # | Page | What It Covers |
|---|------|---------------|
| 1 | [Lists & Tuples](./01-lists-tuples.md) | Dynamic arrays, over-allocation, shallow/deep copy, tuple immutability, namedtuple, memory comparison |
| 2 | [Dictionaries — Hash Tables Under the Hood](./02-dicts.md) | Hash tables, open addressing, compact dict layout, collision handling, dict views, merge operators |
| 3 | [Sets & The Collections Module](./03-sets-collections.md) | Hash sets, frozenset, Counter, deque, defaultdict, ChainMap, container decision flowchart |
| — | [Module 2 Summary](./summary.md) | Mental models, self-assessment checklist, time complexity quick-reference tables |

## Prerequisites

- [Module 1 — Python Foundations](/python/module-01/) — you should be comfortable with Python's object model, variables as name bindings, and basic type mechanics before diving into container internals.
