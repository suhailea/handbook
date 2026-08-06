---
title: Python Crash Sheet
outline: deep
---

# Python Crash Sheet

<span class="badge-planned">🚧 Planned</span>

Rapid-review bullets for Python interviews, organized by tier. Each bullet links to its full page for deep-dive context.

## Tier 1 — Must Know Cold

> These come up in almost every Python interview. If you blank on any of these, it's a red flag.

- 🚧 Everything is an object — `id()`, `type()`, `is` vs `==` → [Data Model](/python/module-01/02-data-model)
- 🚧 Mutable vs immutable types → [Data Model](/python/module-01/02-data-model)
- 🚧 List vs tuple vs dict vs set — time complexities → [Data Structures](/python/module-02/)
- 🚧 Dict implementation (hash table, insertion order 3.7+) → [Dicts](/python/module-02/02-dicts)
- 🚧 List comprehensions vs generator expressions → [Comprehensions](/python/module-05/03-comprehensions-itertools)
- 🚧 The GIL — what it is, what it prevents → [GIL](/python/module-07/01-gil)
- 🚧 Decorators — how they work, writing one → [Decorators](/python/module-03/03-decorators)
- 🚧 `*args` and `**kwargs` → [Functions](/python/module-03/01-functions-first-class)
- 🚧 Exception handling (try/except/else/finally) → [Exceptions](/python/module-06/01-exceptions)
- 🚧 Context managers (`with` statement) → [Context Managers](/python/module-06/02-context-managers)

## Tier 2 — Strong Candidate Signals

> Senior-level differentiators. Knowing these well sets you apart.

- 🚧 Closures and the LEGB scoping rule → [Scoping & Closures](/python/module-03/02-scoping-closures)
- 🚧 The descriptor protocol (__get__, __set__) → [Descriptors](/python/module-04/03-descriptors-properties)
- 🚧 MRO and C3 linearization → [Inheritance & MRO](/python/module-04/02-inheritance-mro)
- 🚧 Iterator protocol and generators (yield, send, yield from) → [Generators](/python/module-05/02-generators)
- 🚧 asyncio event loop, async/await → [asyncio](/python/module-07/04-asyncio)
- 🚧 Threading vs multiprocessing — when to use each → [Concurrency](/python/module-07/)
- 🚧 Import system mechanics (finders, loaders, sys.modules) → [Import Mechanics](/python/module-08/01-import-mechanics)
- 🚧 Reference counting + cyclic GC → [Memory Management](/python/module-09/01-memory-management)
- 🚧 Type hints, Protocols, Generics → [Type Hints](/python/module-10/)
- 🚧 pytest fixtures and parametrize → [pytest](/python/module-12/01-pytest)

## Tier 3 — Deep Knowledge

> Internals and edge cases. Impressive when you can speak to these fluently.

- 🚧 CPython bytecode and the dis module → [What Python Is](/python/module-01/01-what-python-is)
- 🚧 PyObject/PyVarObject C structs → [Memory Management](/python/module-09/01-memory-management)
- 🚧 Metaclasses and `__init_subclass__` → [Metaclasses](/python/module-04/04-metaclasses-slots)
- 🚧 `__slots__` memory optimization → [Metaclasses & __slots__](/python/module-04/04-metaclasses-slots)
- 🚧 Free-threaded Python (PEP 703) → [GIL](/python/module-07/01-gil)
- 🚧 Compact dict implementation internals → [Dicts](/python/module-02/02-dicts)
- 🚧 Exception groups and `except*` (3.11+) → [Exceptions](/python/module-06/01-exceptions)
- 🚧 pymalloc allocator arena/pool/block hierarchy → [Memory Management](/python/module-09/01-memory-management)
