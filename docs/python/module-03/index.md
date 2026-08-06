---
title: Module 3 — Functions & Scoping
outline: deep
---

# Module 3 — Functions & Scoping

Functions are the primary unit of code reuse in Python, and unlike many languages, they are full-blown objects you can pass around, inspect, wrap, and compose. This module builds a mechanical understanding of how Python creates, scopes, wraps, and combines functions — from the `def` statement through closures, decorators, and functional utilities.

## What You'll Learn

- Functions are objects: they carry attributes, can be assigned, passed, and returned like any other value.
- Python's name-lookup rule (LEGB) and how the compiler decides at parse time where a name lives.
- How closures capture variables (not values) through cell objects, and the gotchas that follow.
- Decorators as a pattern for wrapping behavior without modifying the wrapped function.
- Functional programming tools in the standard library and when they help vs hurt readability.

## Pages in This Module

| # | Page | Focus |
|---|------|-------|
| 1 | [Functions as First-Class Objects](./01-functions-first-class.md) | `def` creates objects, `__call__`, parameters, mutable defaults |
| 2 | [LEGB Scoping & Closures](./02-scoping-closures.md) | Name resolution, `global`/`nonlocal`, cell objects, late binding |
| 3 | [Decorators — Wrapping Functions & Classes](./03-decorators.md) | `@` syntax, `functools.wraps`, stacking, class decorators, `@dataclass` |
| 4 | [Functional Programming Tools](./04-functional-tools.md) | `lambda`, `map`/`filter`, `functools.reduce`/`partial`/`lru_cache`, `operator` |

## Prerequisites

- [Module 1 — What Python Actually Is](/python/module-01/01-what-python-is.md) — you need to know about bytecode and the PVM.
- [Module 2 — Data Structures Deep Dive](/python/module-02/) — understanding mutability matters for the mutable default argument trap.
