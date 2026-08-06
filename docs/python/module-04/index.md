---
title: Module 4 — OOP & The Descriptor Protocol
outline: deep
---

# Module 4 — OOP & The Descriptor Protocol

Python's object system is built on a remarkably small set of primitives: `type` creates classes, classes create instances, and the **descriptor protocol** governs every attribute access. This module takes you from everyday class definitions through the full lookup machinery, into descriptors, properties, MRO linearization, and — when you truly need them — metaclasses.

Every page follows the handbook's dual-layer format: first a plain-English analogy you can explain at a whiteboard, then a full mechanical deep dive with runnable code.

## What You'll Learn

- How `class` statements actually work at the runtime level (hint: it's a call to `type()`)
- The precise attribute lookup chain: instance dict, data descriptors, class dict, non-data descriptors, and `__getattr__`
- `__new__` vs `__init__`, class methods vs static methods, and why `__eq__` quietly kills `__hash__`
- Inheritance, multiple inheritance, and exactly how C3 linearization resolves method conflicts
- The descriptor protocol — the mechanism behind `property()`, `classmethod`, `staticmethod`, and Django/SQLAlchemy model fields
- Metaclasses and `__slots__` — when and (more importantly) when *not* to reach for them

## Prerequisites

- [Module 3 — Functions & Scoping](/python/module-03/) — closures, decorators, and `*args`/`**kwargs` are used heavily in OOP patterns

## Pages in This Module

| # | Page | Focus |
|---|------|-------|
| 1 | [Classes & Instances](./01-classes-instances) | Class creation, `__new__`/`__init__`, attribute lookup, dunders, dataclasses |
| 2 | [Inheritance & MRO](./02-inheritance-mro) | Single & multiple inheritance, C3 linearization, `super()`, mixins, ABCs |
| 3 | [The Descriptor Protocol & Properties](./03-descriptors-properties) | `__get__`/`__set__`/`__delete__`, data vs non-data descriptors, `property()`, custom validators |
| 4 | [Metaclasses & `__slots__`](./04-metaclasses-slots) | `type` as metaclass, `__init_subclass__`, `__slots__` memory savings, registry patterns |

After completing all four pages, see the [Module 4 Summary](./summary) for consolidated mental models and a self-assessment checklist.
