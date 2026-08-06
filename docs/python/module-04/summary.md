---
title: Module 4 Summary
outline: deep
---

# Module 4 Summary — OOP & The Descriptor Protocol

## Mental Models Gained

1. **A class is an object** — created at runtime by `type()`, stored in a variable, passed to functions, and modifiable like any other object.

2. **Attribute lookup is a chain with strict priority** — data descriptors beat instance `__dict__`, instance `__dict__` beats non-data descriptors, and MRO determines which class to check first.

3. **`__new__` creates, `__init__` decorates** — the two-step construction lets you control *which* object is returned (`__new__`) separately from *how* it's configured (`__init__`).

4. **`super()` means "next in MRO," not "my parent"** — in multiple inheritance, `super()` follows the linearized order, which may route through sibling classes.

5. **C3 linearization is deterministic and strict** — it respects children-before-parents and declaration order, and rejects hierarchies that would create ambiguity.

6. **Descriptors are the engine behind Python's attribute access** — `property`, `classmethod`, `staticmethod`, bound methods, and ORM fields all use the same `__get__`/`__set__`/`__delete__` protocol.

7. **`__init_subclass__` is the 80/20 metaclass replacement** — registration, validation, and attribute injection without the complexity of a custom metaclass.

8. **`__slots__` trades flexibility for memory at scale** — eliminates `__dict__` per instance, but requires full-chain participation and disables dynamic attribute assignment.

## Self-Assessment Checklist

Test yourself — can you confidently explain each of these?

- [ ] How does `class Foo: ...` translate to a `type()` call at runtime?
- [ ] What is the difference between `__new__` and `__init__`, and when would you override `__new__`?
- [ ] Why does defining `__eq__` without `__hash__` make a class unhashable?
- [ ] What is the shared-mutable class attribute trap, and why does `self.x.append(...)` behave differently from `self.x = ...`?
- [ ] Can you trace the C3 linearization of a diamond hierarchy by hand?
- [ ] Why does `super()` in class `Left` call `Right.method()` when invoked from a `Child(Left, Right)` instance?
- [ ] What is the difference between a data descriptor and a non-data descriptor, and how does it affect lookup priority?
- [ ] How is `property()` implemented in terms of the descriptor protocol?
- [ ] When should you use `__init_subclass__` vs a class decorator vs a full metaclass?
- [ ] What happens to `__slots__` memory savings if a parent class doesn't define `__slots__`?

## Quick Reference

### Attribute Lookup Order (for `obj.x`)

```
1. Data descriptor on type(obj).__mro__     ← has __set__ or __delete__
2. obj.__dict__['x']                        ← instance namespace
3. Non-data descriptor on type(obj).__mro__  ← only has __get__
4. obj.__getattr__('x')                     ← fallback hook
5. raise AttributeError
```

### Descriptor Types

| Type | Defines | Lookup priority | Examples |
|------|---------|----------------|----------|
| **Data descriptor** | `__get__` + (`__set__` and/or `__delete__`) | Beats `instance.__dict__` | `property`, Django `Field`, custom validators |
| **Non-data descriptor** | `__get__` only | Loses to `instance.__dict__` | Functions (bound methods), `classmethod`, `staticmethod`, `cached_property` |

### MRO Rules (C3 Linearization)

```
L[C] = C + merge(L[B1], L[B2], ..., [B1, B2, ...])
```

- **merge**: repeatedly take the first head that doesn't appear in the tail of any other list
- **Invariant 1**: children always come before parents
- **Invariant 2**: if class declares `(B1, B2)`, then `B1` comes before `B2` in the MRO
- **Failure**: if no valid head exists, `TypeError` is raised at class definition time

### Class Creation Methods — When to Use What

| Tool | Complexity | Use when |
|------|-----------|----------|
| `__init_subclass__` | Low | Subclass registration, validation, attribute injection |
| Class decorator | Low | Wrapping/modifying a class after creation |
| Custom metaclass | High | Custom `__prepare__`, controlling `__new__`, `isinstance` hooks |

### `__slots__` Rules

- Define `__slots__` as a tuple of attribute name strings
- Every class in the MRO must define `__slots__` for full `__dict__` elimination
- Never repeat a parent's slot name in a child's `__slots__`
- `__slots__` creates data descriptors on the class for each declared attribute
- Include `"__weakref__"` in `__slots__` if you need weak references

## What's Next

Continue to [Module 5 — Iterators & Generators](/python/module-05/) to learn how Python's iteration protocol works, from `__iter__`/`__next__` to generator functions, `yield from`, and async generators.
