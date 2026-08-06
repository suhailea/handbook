---
title: Module 6 — Error Handling & Context Managers
outline: deep
---

# Module 6 — Error Handling & Context Managers

Every program encounters the unexpected: a file that does not exist, a network that drops, a user who sends garbage input. What separates production-grade code from tutorial code is not *whether* errors happen but **how the code responds when they do**. Python's exception system gives you a structured way to detect, propagate, and recover from errors, while context managers guarantee that resources are cleaned up no matter what goes wrong.

This module covers both topics together because they are deeply intertwined. Exceptions tell you *what went wrong*; context managers ensure that *cleanup always happens* even when something goes wrong. Master both, and you can write code that fails gracefully instead of silently corrupting state.

## What You'll Learn

- **Exceptions** — the full hierarchy from `BaseException` down, the precise execution flow of `try`/`except`/`else`/`finally` in every scenario, exception chaining, custom exception design, exception groups (3.11+), and the performance characteristics of raising vs catching.
- **Context managers** — the `__enter__`/`__exit__` protocol, how `with` desugars to `try`/`finally`, the `contextlib` toolkit (generators as context managers, `ExitStack`, `suppress`), async context managers, and real-world patterns for transactions, timing, and resource management.

## Pages in This Module

| # | Page | Focus |
|---|------|-------|
| 1 | [Exceptions — The Full Picture](./01-exceptions.md) | Exception hierarchy, `try`/`except`/`else`/`finally`, chaining, custom exceptions, exception groups, LBYL vs EAFP |
| 2 | [Context Managers — The with Statement](./02-context-managers.md) | `__enter__`/`__exit__` protocol, `contextlib`, `ExitStack`, async context managers, real-world patterns |

## Prerequisites

- **[Module 1 — The Data Model](/python/module-01/)**: Exceptions are objects and context managers rely on dunder methods (`__enter__`, `__exit__`). You need to understand how Python dispatches special methods.
- **[Module 3 — Functions & Scoping](/python/module-03/)**: Understanding the call stack is essential for grasping how exceptions propagate. Generator functions (from [Module 5](/python/module-05/)) are used by `contextlib.contextmanager`.

## How the Pages Connect

Exceptions (page 1) are the **mechanism** — how Python signals and propagates errors. Context managers (page 2) are the **guarantee** — how you ensure cleanup runs regardless of whether an exception occurred. Nearly every real context manager has a `try`/`finally` at its core, and `__exit__` receives exception information as its arguments. Understanding exceptions first makes context managers click naturally.
