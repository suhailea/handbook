---
title: Module 1 Summary
outline: deep
---

# Module 1 Summary — Language Foundations

You have now walked through how Python executes your code, how it models every value as an object, how names bind to those objects, and how the core scalar types behave. Before moving on, consolidate what you have learned.

---

## Mental Models Gained

1. **Python is compiled — to bytecode.** Your `.py` files are not interpreted line-by-line. CPython compiles them to `.pyc` bytecode instructions that run on a stack-based virtual machine. The "interpreter" label refers to the VM executing bytecode, not to raw source interpretation. You can inspect this bytecode yourself with `dis.dis()`.

2. **Variables are name tags, not boxes.** Assignment in Python does not copy a value into a container. It binds a name to an object that already exists on the heap. Multiple names can point to the same object, which is why `a = b` followed by mutating `b` can surprise you — both names reference the same underlying object.

3. **Everything is an object.** Integers, strings, functions, classes, modules, `None`, even `type` itself — every value in Python has `id()`, `type()`, and a value. There is no distinction between "primitives" and "objects" the way some languages draw it. This uniformity is what makes Python's data model so consistent.

4. **Mutable vs immutable determines what you can do in-place.** Immutable objects (`int`, `float`, `str`, `tuple`, `frozenset`, `bytes`) cannot be changed after creation — any "modification" produces a new object. Mutable objects (`list`, `dict`, `set`, `bytearray`) can be altered in-place, which means every name pointing at that object sees the change. This distinction drives decisions about default arguments, dictionary keys, and thread safety.

5. **`is` checks identity, `==` checks value.** `is` asks "are these the same object in memory?" (`id(a) == id(b)`). `==` asks "do these objects consider themselves equal?" (calls `__eq__`). They are fundamentally different questions. CPython's small-integer cache (`-5` to `256`) and string interning can make `is` appear to work for value comparison, but that is an implementation accident you must never rely on.

6. **Truthiness follows a strict protocol.** When Python needs a boolean (in `if`, `while`, `and`, `or`, `not`), it calls `__bool__()` on the object. If `__bool__` is not defined, it falls back to `__len__()` — zero length means `False`. If neither is defined, the object is `True`. This is why empty containers are falsy and custom objects are truthy by default.

7. **Floats approximate, Decimals exact.** IEEE 754 double-precision floats cannot represent most decimal fractions exactly (`0.1 + 0.2 != 0.3`). When you need exact decimal arithmetic — financial calculations, rounding-sensitive logic — use `decimal.Decimal` with an explicit context. `fractions.Fraction` gives exact rational arithmetic. Know which tool fits which job.

8. **`None` is a singleton — always use `is` to check it.** There is exactly one `None` object in any Python process. The idiomatic check is `if x is None`, never `if x == None`. The `==` form can be hijacked by a custom `__eq__`, but `is` cannot lie — it compares object identity directly.

---

## Self-Assessment Checklist

After completing this module, you should be able to:

- [ ] Explain what CPython does with your `.py` file before any code runs (compilation to bytecode, the code object, the VM loop)
- [ ] Use `dis.dis()` to inspect the bytecode of a simple function and identify `LOAD_FAST`, `STORE_NAME`, `BINARY_OP`, and similar opcodes
- [ ] Predict the output of name-binding puzzles (e.g., `a = [1, 2]; b = a; b.append(3)` — what is `a`?)
- [ ] Explain the difference between `is` and `==` and give an example where they diverge
- [ ] List all falsy values in Python from memory
- [ ] Classify the built-in types as mutable or immutable and explain one consequence of each category
- [ ] Describe why `def f(items=[]):` is a classic bug and what the fix is
- [ ] Explain why `0.1 + 0.2 != 0.3` and demonstrate the fix using `decimal.Decimal`
- [ ] Use `id()` and `type()` to prove that integers are objects and that small-integer caching exists
- [ ] Explain what `__bool__` and `__len__` have to do with `if my_obj:`
- [ ] Describe what happens when you use a mutable value as a dictionary key (and why Python prevents it for `list`)
- [ ] Write a function that correctly handles `None` as a distinct value from other falsy values (e.g., `0`, `""`, `[]`)

---

## Quick Reference

### Falsy Values

| Value | Type | Notes |
|-------|------|-------|
| `False` | `bool` | The boolean itself |
| `None` | `NoneType` | The singleton null value |
| `0` | `int` | Zero integer |
| `0.0` | `float` | Zero float |
| `0j` | `complex` | Zero complex |
| `Decimal(0)` | `Decimal` | Zero decimal |
| `Fraction(0, 1)` | `Fraction` | Zero fraction |
| `""` | `str` | Empty string |
| `[]` | `list` | Empty list |
| `()` | `tuple` | Empty tuple |
| `{}` | `dict` | Empty dict |
| `set()` | `set` | Empty set |
| `b""` | `bytes` | Empty bytes |
| `bytearray(b"")` | `bytearray` | Empty bytearray |
| `range(0)` | `range` | Empty range |

Everything else is **truthy** by default (including custom objects unless they define `__bool__` or `__len__`).

### Mutable vs Immutable Types

| Mutable | Immutable |
|---------|-----------|
| `list` | `tuple` |
| `dict` | `frozenset` |
| `set` | `str` |
| `bytearray` | `bytes` |
| Custom objects (by default) | `int`, `float`, `complex` |
| | `bool`, `None` |
| | `Decimal`, `Fraction` |

**Key consequence:** Only immutable (and hashable) objects can serve as dictionary keys or set members.

### Number Types

| Type | Precision | Use Case | Example |
|------|-----------|----------|---------|
| `int` | Arbitrary (unlimited) | Counting, indices, bitwise ops | `2**1000` works fine |
| `float` | ~15-17 significant digits (IEEE 754 double) | General math, science, performance-sensitive | `3.14159` |
| `complex` | Two floats (real + imaginary) | Scientific computing, signal processing | `3+4j` |
| `Decimal` | User-configurable, exact decimal | Finance, money, rounding-critical | `Decimal("0.1")` |
| `Fraction` | Exact rational | Exact ratios, avoiding float drift | `Fraction(1, 3)` |

---

## What's Next

Now that you understand how Python represents values as objects, how names bind to those objects, and how mutability governs what can change in-place, you are ready to see how Python's built-in containers — `list`, `dict`, `set`, `tuple`, and their relatives — work under the hood.

[Module 2 — Data Structures Deep Dive](/python/module-02/) builds directly on the foundations from this module. You will see why list appends are amortized O(1) (resizing arrays on the heap), how dict uses hash tables (and why keys must be hashable — tying back to immutability), how set operations map to hash lookups, and when to reach for `deque`, `defaultdict`, `Counter`, or `namedtuple` instead of the basics. Every data structure discussion will connect back to the object model and mutability rules you have just internalized.
