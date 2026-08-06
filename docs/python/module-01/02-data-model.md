---
title: Python's Data Model — Everything Is an Object
outline: deep
---

# Python's Data Model — Everything Is an Object

> **Interview weight:** 🔥🔥🔥 — `is` vs `==`, mutability traps, and name-binding questions appear in nearly every Python interview.
> **Python version notes:** Examples target Python 3.12+.
> **Prerequisites:** [1.1 What Python Actually Is](01-what-python-is)

## 🗣️ In Plain English

::: tip In Plain English
Forget the idea that a variable is a box you put things in. In Python, every piece of data — every number, every string, every list — is a physical suitcase sitting on a vast airport conveyor belt. When you write `x = 42`, you are not stuffing 42 into a box labeled `x`. You are tying a sticky nametag that reads "x" onto a suitcase that already exists and already contains 42. The suitcase was there before you named it; you just gave it a label.

Now write `y = x`. Did you photocopy the suitcase? No. You peeled off a second nametag reading "y" and stuck it onto the **same** suitcase. Open `x`, open `y` — you are looking inside the same luggage. If you later write `x = 99`, you have not changed the suitcase. You ripped the "x" nametag off suitcase-42 and stuck it onto a different suitcase — the one holding 99. The "y" nametag is still on the old suitcase, undisturbed.

This is how **all** assignment works in Python. Variables never hold data; they always point to data.

Now, some suitcases are **sealed shut** after they are manufactured. A number suitcase (42) is sealed — nobody can open it up and swap the contents. If you need 43, the factory builds a brand-new suitcase. These are **immutable** objects. Strings, numbers, and tuples are all sealed suitcases.

Other suitcases have **zippers**. A list is a zippered suitcase — you can reach in, rearrange what is inside, add items, remove them, all without replacing the suitcase itself. These are **mutable** objects. The nametags stay on the same luggage, but the contents change.

Finally, two questions you can ask about any suitcase. **"Is this literally the same suitcase?"** — that is the `is` check. It looks at the luggage tag's unique serial number (the memory address). **"Does this suitcase contain equivalent stuff?"** — that is the `==` check. Two different suitcases can hold identical clothes. They pass the `==` test, but fail the `is` test because they are different physical luggage.

One last quirk: the airport pre-manufactures a few hundred frequently-requested suitcases (the numbers -5 through 256). Whenever anyone asks for, say, suitcase-100, they get the **same** pre-built one. That is why `is` sometimes says True for small numbers and False for large ones — it depends on whether the factory reused the suitcase or built a new one.
:::

## ⚙️ Under the Hood

### The Three Pillars: id(), type(), value

Every Python object carries exactly three properties at all times:

| Property | Accessor | What it tells you |
|----------|----------|-------------------|
| **Identity** | `id(obj)` | Where the object lives in memory (in CPython, the memory address) |
| **Type** | `type(obj)` | What kind of object it is — determines which operations are legal |
| **Value** | the object itself | The data the object represents |

Identity never changes once an object is created. Type never changes either (in CPython). Value may or may not be changeable — that distinction is mutability.

```python
# run: python3 data_model_pillars.py

a: int = 42
b: str = "hello"
c: list[int] = [1, 2, 3]

def greet() -> str:
    return "hi"

class Dog:
    pass

for name, obj in [("a", a), ("b", b), ("c", c), ("greet", greet), ("Dog", Dog)]:
    print(f"{name:>6} -> id: {id(obj):<20} type: {type(obj).__name__:<12} value: {obj}")
```

Everything is an object — integers, strings, functions, classes, even `type` itself:

```python
# run: python3 everything_is_object.py

print(type(42))             # <class 'int'>
print(type(type(42)))       # <class 'type'>
print(type(type))           # <class 'type'> — type is its own type
print(type(None))           # <class 'NoneType'>
print(type(lambda: 0))      # <class 'function'>
print(type(int))            # <class 'type'> — classes are objects of type 'type'
```

### PyObject in CPython

At the C level, every Python object begins with the same header. The CPython source defines it in `Include/object.h`:

```c
// Simplified from CPython source — not runnable Python
typedef struct _object {
    Py_ssize_t ob_refcnt;   // reference count
    PyTypeObject *ob_type;  // pointer to the type object
} PyObject;
```

Every single Python object — from `True` to a Django queryset — starts with these two fields. Variable-length objects (lists, tuples, strings) extend this with `ob_size`:

```c
typedef struct {
    PyObject ob_base;       // refcnt + type pointer
    Py_ssize_t ob_size;     // number of items contained
} PyVarObject;
```

This means `sys.getrefcount()` is reading `ob_refcnt` directly. The count is always at least one more than you expect because the call to `sys.getrefcount()` itself creates a temporary reference:

```python
# run: python3 refcount_demo.py
import sys

a: list[int] = [1, 2, 3]
print(sys.getrefcount(a))  # 2 — 'a' holds one ref, the argument to getrefcount() is the second

b = a
print(sys.getrefcount(a))  # 3 — a, b, and the argument

del b
print(sys.getrefcount(a))  # 2 — back to a + argument
```

When `ob_refcnt` drops to zero, CPython deallocates the object immediately — no waiting for a GC cycle. This deterministic destruction is why CPython files close promptly when their last reference dies (though you should still use `with` statements).

### Names Are Labels, Not Boxes

Assignment in Python **never copies data**. It binds a name in a namespace dictionary to an object. You can see the namespace directly:

```python
# run: python3 names_labels.py

x: int = 10
y: int = x

# Same object — same id
print(f"id(x) = {id(x)}")
print(f"id(y) = {id(y)}")
print(f"x is y: {x is y}")  # True — same object

# globals() is the namespace dict for this module
print(f"'x' in globals(): {'x' in globals()}")
print(f"globals()['x'] = {globals()['x']}")
```

Reassignment moves the nametag, it does not mutate the object:

```python
# run: python3 rebinding.py

x: int = 10
original_id: int = id(x)

x = 20  # x now points to a different int object
print(f"id changed: {id(x) != original_id}")  # True — new object entirely
```

`del` removes the name from the namespace — it does **not** delete the object. The object gets deallocated only when its reference count hits zero:

```python
# run: python3 del_demo.py
import sys

a: list[int] = [1, 2, 3]
b = a
print(sys.getrefcount(a))  # 3 (a, b, argument)

del a  # removes 'a' from the namespace
# print(a)  # NameError: name 'a' is not defined
print(b)    # [1, 2, 3] — the object still exists, b still references it
print(sys.getrefcount(b))  # 2 (b, argument)
```

Inside a function, local names live in an optimized array (not a dict), but the concept is identical. `locals()` builds a snapshot dict on demand:

```python
# run: python3 local_namespace.py

def show_locals() -> None:
    a: int = 1
    b: str = "hi"
    print(locals())  # {'a': 1, 'b': 'hi'}

show_locals()
```

### Mutable vs Immutable

An object is **immutable** if its value cannot change after creation. The object's `id()` stays the same forever — but you cannot alter what lives at that address.

| Immutable | Mutable |
|-----------|---------|
| `int`, `float`, `complex` | `list` |
| `str` | `dict` |
| `tuple` | `set` |
| `frozenset` | `bytearray` |
| `bytes` | user-defined classes (by default) |
| `bool`, `NoneType` | |

Immutability means the **object** cannot change, not that the **variable** cannot be reassigned:

```python
# run: python3 immutable_demo.py

s: str = "hello"
original_id: int = id(s)

s += " world"  # does NOT mutate the original string
print(f"id changed: {id(s) != original_id}")  # True — s now points to a new str object
```

Mutable objects change in place — the `id()` stays the same:

```python
# run: python3 mutable_demo.py

lst: list[int] = [1, 2, 3]
original_id: int = id(lst)

lst.append(4)  # mutates the SAME object
print(f"id unchanged: {id(lst) == original_id}")  # True
print(lst)  # [1, 2, 3, 4]
```

**The tuple-with-a-list gotcha** — a tuple is immutable, but if it contains mutable objects, those inner objects can still be mutated:

```python
# run: python3 tuple_gotcha.py

t: tuple[list[int]] = ([1, 2],)
print(f"Before: {t}")  # ([1, 2],)

# The tuple can't change which object sits at index 0,
# but the list AT index 0 is mutable
t[0].append(3)
print(f"After:  {t}")  # ([1, 2, 3],)

# But you cannot replace the element itself:
try:
    t[0] = [9, 9, 9]
except TypeError as e:
    print(f"TypeError: {e}")  # 'tuple' object does not support item assignment
```

The tuple's immutability means its **references** are fixed — it will always point to the same list object. But the list object itself is mutable, so its contents can change. The tuple doesn't know or care.

**Why immutability matters in production:**

- **Hashability:** Only immutable objects (with a `__hash__`) can be dict keys or set members. A list cannot be a dict key — because if you mutated it, the hash would become stale and the dict would break.
- **Thread safety:** Immutable objects can be shared across threads without locks.
- **Function defaults:** Python evaluates default arguments once at function definition time. If the default is mutable, all calls share the same object (covered in the production pitfalls section below).

### Interning and Caching

CPython pre-allocates integer objects for -5 through 256 at interpreter startup. These live for the entire process lifetime. Any time you create an `int` in that range, you get back the same pre-existing object:

```python
# run: python3 interning_demo.py

# Small integers — same object (pre-cached)
a: int = 256
b: int = 256
print(f"a is b (256): {a is b}")   # True — same cached object
print(f"id(a)={id(a)}, id(b)={id(b)}")

# Large integers — different objects (no cache)
# NOTE: In a .py file, CPython's peephole optimizer may fold constants,
# making even large ints share an id. Run in the REPL to see the difference:
#   >>> a = 257
#   >>> b = 257
#   >>> a is b
#   False
c: int = 257
d: int = 257
print(f"c is d (257): {c is d}")  # May be True in a .py file due to constant folding
print(f"id(c)={id(c)}, id(d)={id(d)}")
```

**String interning** works differently. CPython automatically interns strings that look like identifiers (letters, digits, underscores). The `sys.intern()` function lets you force interning for other strings:

```python
# run: python3 string_interning.py
import sys

# Identifier-like strings get interned automatically
s1: str = "hello"
s2: str = "hello"
print(f"s1 is s2 (identifier-like): {s1 is s2}")  # True

# Strings with spaces are NOT auto-interned
s3: str = "hello world"
s4: str = "hello world"
# In a .py file constant folding may still merge these,
# but conceptually they are not guaranteed to be the same object

# Force interning
s5: str = sys.intern("hello world")
s6: str = sys.intern("hello world")
print(f"s5 is s6 (forced intern): {s5 is s6}")  # True — guaranteed
```

The lesson: **never rely on `is` for value comparisons**. The interning/caching behavior is an implementation detail of CPython that can change between versions and differs between contexts (REPL vs `.py` file vs optimized bytecode).

### is vs == Mechanically

`is` compares **identity** — are these the exact same object in memory?

`==` compares **value** — do these objects consider themselves equal?

```python
# run: python3 is_vs_eq.py

a: list[int] = [1, 2, 3]
b: list[int] = [1, 2, 3]

print(f"a == b: {a == b}")   # True — same contents
print(f"a is b: {a is b}")   # False — different objects in memory
print(f"id(a)={id(a)}, id(b)={id(b)}")

c = a  # c is now a label on the same object as a
print(f"a is c: {a is c}")   # True — same object
```

Under the hood, `==` calls the `__eq__` dunder method. You can override it to make `==` mean anything:

```python
# run: python3 eq_override.py

class AgreeableObject:
    """An object that claims equality with everything."""

    def __eq__(self, other: object) -> bool:
        return True

agreeable = AgreeableObject()
print(f"agreeable == 42:      {agreeable == 42}")       # True
print(f"agreeable == 'hello': {agreeable == 'hello'}")  # True
print(f"agreeable == None:    {agreeable == None}")      # True  (!)
print(f"agreeable is None:    {agreeable is None}")      # False — is can't be fooled
```

This is exactly why the Python community convention is **always `x is None`**, never `x == None`. Since `__eq__` can be overridden, `==` can lie. `is` cannot — it compares raw memory addresses (`id()` values), and no Python code can intercept that.

The same logic applies to `True` and `False` — use `is` when you mean identity:

```python
# run: python3 none_check.py

def check(x: object) -> None:
    # CORRECT: identity check for singletons
    if x is None:
        print("x is None")
    elif x is True:
        print("x is True (the boolean singleton)")
    elif x is False:
        print("x is False (the boolean singleton)")
    else:
        print(f"x is something else: {x!r}")

check(None)   # x is None
check(True)   # x is True (the boolean singleton)
check(1)      # x is something else: 1 — even though 1 == True
```

Notice that `1 == True` is `True` (because `bool` is a subclass of `int` and `True` has the integer value 1), but `1 is True` is `False`. The distinction matters.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

### 1. The Mutable Default Argument Trap

Python evaluates default argument values **once**, at function definition time. If the default is mutable, every call that uses the default shares the **same** object:

```python
# run: python3 mutable_default.py

def append_to(item: int, target: list[int] = []) -> list[int]:
    target.append(item)
    return target

print(append_to(1))  # [1]        — looks fine
print(append_to(2))  # [1, 2]     — surprise! same list
print(append_to(3))  # [1, 2, 3]  — it keeps growing

# The fix: use None as sentinel
def append_to_fixed(item: int, target: list[int] | None = None) -> list[int]:
    if target is None:
        target = []
    target.append(item)
    return target

print(append_to_fixed(1))  # [1]
print(append_to_fixed(2))  # [2] — fresh list each time
```

**Symptom in production:** API responses mysteriously contain data from previous requests. A FastAPI/Flask handler accumulates state across calls. Extremely hard to reproduce in testing because it depends on call order. Pylint/Ruff flag this as `W0102` / `B006`.

### 2. Shallow Copy Surprise

`list()`, `dict()`, `[:]` slicing, and `copy.copy()` all create **shallow** copies — the outer container is new, but the inner objects are shared references:

```python
# run: python3 shallow_copy_trap.py
import copy

original: list[list[int]] = [[1, 2], [3, 4]]
shallow: list[list[int]] = copy.copy(original)

shallow[0].append(99)
print(f"original: {original}")  # [[1, 2, 99], [3, 4]] — modified!
print(f"shallow:  {shallow}")   # [[1, 2, 99], [3, 4]]

# The fix: deep copy
original2: list[list[int]] = [[1, 2], [3, 4]]
deep: list[list[int]] = copy.deepcopy(original2)
deep[0].append(99)
print(f"original2: {original2}")  # [[1, 2], [3, 4]] — untouched
print(f"deep:      {deep}")       # [[1, 2, 99], [3, 4]]
```

**Symptom in production:** A background task modifies a "copy" of a shared config dict, and the original config silently mutates. Downstream handlers start seeing corrupted configuration. Usually surfaces as intermittent bugs under concurrency.

### 3. The `is` Comparison Trap

Using `is` to compare values instead of `==` creates bugs that only appear outside the interning range:

```python
# run: python3 is_trap.py

def check_status_code(code: int) -> str:
    if code is 200:  # BUG: should be ==
        return "OK"
    return "ERROR"

# Works by accident for small ints:
print(check_status_code(200))  # "OK" — because 200 is in the cache range

# Breaks for larger codes (in some contexts):
# In a .py file, constant folding may mask this.
# In dynamic scenarios (e.g., code = int(input())), it will fail.
# SyntaxWarning since Python 3.8: "is" with a literal
```

**Symptom in production:** *(Python 3.8+)* `SyntaxWarning: "is" with a literal. Did you mean "=="?` floods your logs. Before 3.8, no warning — just silent wrong behavior when values exceed the cache range. HTTP status code checks, database ID comparisons, and pagination offsets are common culprits.

:::

## 🎯 Checkpoint

::: details Question 1 — Aliasing and mutation
**Q:** What does `a` contain after this code runs? Why?

```python
a = [1, 2, 3]
b = a
b.append(4)
```

**A:** `a` is `[1, 2, 3, 4]`. The assignment `b = a` does not copy the list — it makes `b` another name (label) pointing to the **same** list object in memory. `a is b` is `True`. When `b.append(4)` mutates that object, the change is visible through both names. To get an independent copy, use `b = a.copy()` or `b = a[:]` (shallow) or `copy.deepcopy(a)` (deep, for nested structures).
:::

::: details Question 2 — Tuple immutability vs element mutability
**Q:** Why does `t[0].append(4)` succeed but `t[0] = [9]` fails when `t = (1, [2, 3])`? Isn't the tuple immutable?

**A:** The tuple's immutability means its **slots** (references to objects) are fixed — `t[0]` will always point to the `int` object `1`, and `t[1]` will always point to the same `list` object. `t[0] = [9]` tries to change which object slot 0 references, which violates tuple immutability and raises `TypeError`. But `t[1].append(4)` does not change the tuple at all — slot 1 still references the exact same list object (same `id()`). It is the list that is being mutated, and lists are mutable. The tuple neither knows nor cares that the list's internal contents changed. This is why "immutable container of mutable objects" is a common source of confusion — immutability applies to the container's structure, not to the objects it contains.
:::

::: details Question 3 — Integer caching and `is` behavior
**Q:** Explain why `a = 256; b = 256; a is b` returns `True` but (in the REPL) `a = 257; b = 257; a is b` might return `False`.

**A:** CPython pre-allocates integer objects for the range -5 to 256 during interpreter startup (defined in `Objects/longobject.c`). Whenever the interpreter needs an `int` in that range, it returns a pointer to the existing cached object rather than allocating a new one. So `a = 256` and `b = 256` both get references to the same pre-existing `PyLongObject`, making `a is b` true.

For 257, no pre-cached object exists. In the REPL, each statement `a = 257` and `b = 257` is compiled as a separate code object, so CPython creates two distinct `int` objects, making `a is b` false. However, in a `.py` file, the compiler may fold both `257` literals within the same code block into a single constant (the peephole/AST optimizer), in which case `a is b` could be `True`. This is an implementation detail — the language spec makes no guarantees about integer identity. The rule: use `==` for value comparison, always.
:::

## Key Mental Models

- **Names are labels, not boxes.** Assignment never copies data — it binds a name to an existing object. Multiple names can point to the same object.
- **Every object has identity, type, and value.** `id()` for identity, `type()` for type, and the object itself for value. Identity and type are fixed for the object's lifetime.
- **Immutable means the object cannot change, not that the variable cannot be reassigned.** `x = x + 1` does not mutate the int — it creates a new int and rebinds `x`.
- **`is` checks identity; `==` checks value.** Use `is` only for singletons (`None`, `True`, `False`). Use `==` for everything else.
- **CPython caches small integers and some strings — but never depend on it.** Interning is an optimization detail, not a language guarantee. Code that uses `is` for value comparison will break in subtle, context-dependent ways.

## Related

- [JS Core — Closures](/js-core/02-closures) — JavaScript has similar name-binding semantics; closures close over variables (bindings), not values
- [Node.js — Memory & GC Fundamentals](/js-core/07-memory-gc) — V8's generational garbage collector vs CPython's reference counting
- [Python Module 1.1 — What Python Actually Is](01-what-python-is) — the interpreter architecture that creates and manages these objects
