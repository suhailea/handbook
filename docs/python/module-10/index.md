---
title: Module 10 — Type Hints & Modern Python
outline: deep
---

# Module 10 — Type Hints & Modern Python

Python is a dynamically typed language — but that does not mean you have to fly blind. Since Python 3.0 introduced function annotations and the `typing` module landed in 3.5, the ecosystem has steadily built a parallel type system that lives in annotations, not in the runtime. This module covers that system end to end: from basic `int` and `str` annotations through generics, protocols, and advanced patterns, all the way to the tooling that makes it useful — static checkers like mypy and pyright, and runtime validation frameworks like Pydantic.

The key insight you will carry out of this module: **Python's type hints are metadata, not enforcement.** They exist in `__annotations__` dictionaries, they are ignored by the interpreter at execution time, and they become powerful only when external tools — static analyzers, serialization frameworks, dependency injection systems — read and act on them.

## What You'll Learn

- How Python stores type annotations internally and why they have zero runtime cost
- The full vocabulary of type hints: basic types, containers, unions, optionals, generics, protocols, literals, typed dicts, overloads, and type guards
- How to write generic, reusable typed code using `TypeVar`, `Generic`, and the 3.12+ syntax
- Structural subtyping via `Protocol` — duck typing with static checking
- Static analysis with mypy and pyright: configuration, strict mode, gradual adoption
- Runtime validation with Pydantic v2: how it reads annotations and enforces schemas at execution time
- The relationship between type hints and frameworks like FastAPI and dataclasses

## Pages in This Module

| # | Page | What It Covers |
|---|------|---------------|
| 1 | [Type Hints — From Zero to Useful](./01-type-hints-basics.md) | Annotations, basic types, containers, Optional, Union, Any, type aliases, Final, ClassVar, forward references |
| 2 | [Advanced Typing — Generics, Protocols & More](./02-advanced-typing.md) | TypeVar, Generic, Protocols, Literal, TypedDict, @overload, TypeGuard/TypeIs, ParamSpec, variance |
| 3 | [mypy, Pydantic & Runtime Typing](./03-mypy-pydantic.md) | Static checkers (mypy, pyright), Pydantic v2, dataclasses comparison, type stubs, runtime annotation access |

## Prerequisites

- [Module 3 — Functions & Scoping](/python/module-03/) — you need to be comfortable with function signatures, closures, and decorators before annotating them
- [Module 4 — OOP & Descriptors](/python/module-04/) — generics and protocols build on class mechanics, inheritance, and the descriptor protocol
