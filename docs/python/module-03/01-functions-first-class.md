---
title: Functions as First-Class Objects
outline: deep
---

# Functions as First-Class Objects

> **Interview weight:** 🔥🔥🔥 — nearly every Python interview touches callbacks, higher-order functions, or the mutable default trap.
> **Python version notes:** Examples target Python 3.12+. Positional-only parameters (`/`) were added in 3.8.
> **Prerequisites:** [Module 1 — What Python Actually Is](/python/module-01/01-what-python-is.md), [Module 2 — Data Structures](/python/module-02/).

## 🗣️ In Plain English

::: tip In Plain English
Think of a function as a **recipe card**. It is a physical object — a piece of card stock with instructions written on it. You can hand the card to a friend ("here, you follow these steps"), pin it on a bulletin board for later, stuff it inside an envelope along with other cards, or photocopy it and give the copy to someone else. The card is a *thing*. "Calling" the function is the act of picking up the card and actually following the instructions.

In many older languages, a function is not a thing — it is more like instructions tattooed on a wall. You can point at the wall, but you cannot peel the tattoo off and hand it to someone. Python is different. The moment you write a recipe (the `def` block), Python prints it onto a card (creates an object in memory), slaps a label on it (the function's name), and drops it into the current drawer (the namespace). From that point on, the label and the card are separate. You can peel the label off and stick it on a different card. You can put a second label on the same card. You can toss the card into a list alongside other cards, or hand it to another recipe that says "take a helper recipe as an ingredient."

This is what "first-class" means: functions are values, just like numbers and strings. There is no special gate you have to pass through. Anything you can do with a number — store it, pass it, return it, put it in a collection — you can do with a function.

Some recipe cards even have **sticky notes** attached — default ingredients. Here is the catch: those sticky notes are written once, when the card is first printed, and they are the *same physical sticky note* every time someone follows the recipe. If the sticky note says "use this shared shopping bag," every cook who follows the recipe reaches into the same bag. That is the mutable default argument trap, and understanding it requires knowing that defaults are baked into the card itself at printing time, not freshly created each time someone follows the instructions.
:::

## ⚙️ Under the Hood

### `def` Creates an Object

The `def` statement is an executable statement. When the interpreter reaches it, three things happen:

1. The body is compiled to a **code object** (`types.CodeType`) — this happens once, at compile time.
2. A **function object** (`types.FunctionType`) is created, wrapping that code object plus runtime context (defaults, closure, globals reference, annotations).
3. The function object is **bound to the name** in the current namespace via a `STORE_NAME` or `STORE_FAST` opcode.

```python
# run: python3 def_is_executable.py
def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}"

# greet is just an object — prove it
print(type(greet))          # <class 'function'>
print(id(greet))            # some memory address
print(greet.__class__.__mro__)  # (function, object)
```

### Function Attributes

Every function object carries a rich set of attributes:

```python
# run: python3 func_attrs.py
def add(a: int, b: int = 0) -> int:
    """Add two numbers."""
    return a + b

print(add.__name__)         # 'add'
print(add.__qualname__)     # 'add' (or 'Outer.add' if nested)
print(add.__doc__)          # 'Add two numbers.'
print(add.__defaults__)     # (0,)  — tuple of positional default values
print(add.__annotations__)  # {'a': <class 'int'>, 'b': <class 'int'>, 'return': <class 'int'>}
print(add.__code__)         # <code object add at 0x...>
print(add.__code__.co_varnames)  # ('a', 'b')
print(add.__code__.co_consts)    # (None, — docstring and constants)
print(add.__module__)       # '__main__'
print(add.__globals__ is globals())  # True — same dict
```

Key insight: `__defaults__` is a **tuple stored on the function object**, created once when `def` executes. This is the root of the mutable default gotcha.

### Passing and Returning Functions

Because functions are objects, they can be passed as arguments and returned from other functions — this is the foundation of higher-order programming:

```python
# run: python3 higher_order.py
from typing import Callable

def apply_twice(func: Callable[[int], int], value: int) -> int:
    """Apply func to value, then apply func to the result."""
    return func(func(value))

def double(x: int) -> int:
    return x * 2

print(apply_twice(double, 3))   # double(double(3)) = double(6) = 12

# Returning a function
def make_adder(n: int) -> Callable[[int], int]:
    def adder(x: int) -> int:
        return x + n
    return adder

add_five = make_adder(5)
print(add_five(10))             # 15
print(type(add_five))           # <class 'function'>
print(add_five.__name__)        # 'adder'
print(add_five.__closure__)     # (<cell ...>,) — captures n
```

### The `__call__` Protocol

Any object with a `__call__` method is callable. Functions happen to implement it, but so can your own classes:

```python
# run: python3 callable_protocol.py
class Counter:
    """A callable that counts how many times it has been called."""
    def __init__(self) -> None:
        self.count = 0

    def __call__(self, *args: object, **kwargs: object) -> int:
        self.count += 1
        return self.count

counter = Counter()
print(callable(counter))   # True
print(counter())            # 1
print(counter())            # 2
print(counter())            # 3

# The built-in callable() checks for __call__
print(callable(42))         # False
print(callable(print))      # True
print(callable(Counter))    # True — classes are callable (they create instances)
```

The interpreter resolves `obj()` by looking up `type(obj).__call__` — note that it checks the **type**, not the instance, following the standard data model lookup for special methods.

### The Mutable Default Argument Gotcha

This is one of the most common Python interview questions. Watch:

```python
# run: python3 mutable_default_bug.py
def append_to(item: int, target: list[int] = []) -> list[int]:
    target.append(item)
    return target

print(append_to(1))    # [1]       — looks fine
print(append_to(2))    # [1, 2]    — wait, where did 1 come from?
print(append_to(3))    # [1, 2, 3] — it keeps growing!

# Why? The default list is ONE object, created once when def runs:
print(append_to.__defaults__)  # ([1, 2, 3],) — it is the SAME list
```

**Why this happens:** When Python executes the `def` statement, it evaluates the default value expression `[]` **once** and stores the resulting list object in `func.__defaults__`. Every call that uses the default gets the same object. Since lists are mutable, mutations accumulate.

**The fix — use `None` as a sentinel:**

```python
# run: python3 mutable_default_fix.py
def append_to(item: int, target: list[int] | None = None) -> list[int]:
    if target is None:
        target = []       # fresh list on every call
    target.append(item)
    return target

print(append_to(1))    # [1]
print(append_to(2))    # [2] — independent lists now
print(append_to.__defaults__)  # (None,)
```

### `*args` and `**kwargs` — Packing and Unpacking

Python uses two mechanisms: **packing** (collecting extra arguments into a tuple or dict) and **unpacking** (spreading a sequence or mapping into separate arguments).

```python
# run: python3 args_kwargs.py
def show(*args: object, **kwargs: object) -> None:
    print(f"args   = {args!r}")    # tuple
    print(f"kwargs = {kwargs!r}")   # dict

show(1, 2, 3, name="Alice", age=30)
# args   = (1, 2, 3)
# kwargs = {'name': 'Alice', 'age': 30}

# Unpacking at call site
numbers = [10, 20, 30]
options = {"sep": " | ", "end": "!\n"}
print(*numbers, **options)    # 10 | 20 | 30!
```

### Keyword-Only and Positional-Only Parameters

Python 3 introduced keyword-only parameters (after `*`), and Python 3.8 added positional-only parameters (before `/`):

```python
# run: python3 param_kinds.py
def query(
    table: str,          # positional-only (before /)
    /,
    columns: str = "*",  # normal (positional or keyword)
    *,
    where: str = "",     # keyword-only (after *)
    limit: int = 100,    # keyword-only
) -> str:
    sql = f"SELECT {columns} FROM {table}"
    if where:
        sql += f" WHERE {where}"
    sql += f" LIMIT {limit}"
    return sql

# Valid calls:
print(query("users"))
print(query("users", "name, email", where="active=1", limit=10))

# Invalid:
# query(table="users")        # TypeError: positional-only
# query("users", limit=5, "id")  # SyntaxError: positional after keyword
```

The full parameter ordering rule: `positional-only / normal *args keyword-only **kwargs`.

### Signature Introspection

The `inspect` module gives you programmatic access to any callable's signature:

```python
# run: python3 signature_demo.py
import inspect

def connect(
    host: str,
    /,
    port: int = 5432,
    *,
    timeout: float = 30.0,
    ssl: bool = True,
) -> None:
    ...

sig = inspect.signature(connect)
print(sig)  # (host: str, /, port: int = 5432, *, timeout: float = 30.0, ssl: bool = True) -> None

for name, param in sig.parameters.items():
    print(f"  {name:10s}  kind={param.kind.name:20s}  default={param.default!r}")

# Output:
#   host        kind=POSITIONAL_ONLY        default=<class 'inspect._empty'>
#   port        kind=POSITIONAL_OR_KEYWORD   default=5432
#   timeout     kind=KEYWORD_ONLY            default=30.0
#   ssl         kind=KEYWORD_ONLY            default=True
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Mutable Default in a Service Layer**
Symptom: an API endpoint returns data from previous requests blended into the current response. A function deep in the service layer used `def process(items: list[dict] = [])`. Each request mutated the same list. In tests (which start fresh processes) this never appeared — it only manifested under sustained traffic where the same worker process handled multiple requests.
Diagnosis: inspect `func.__defaults__` on the live object. If you see accumulated data, you found it. Fix: always use `None` sentinel for mutable defaults.

**2. Accidentally Passing a Function Instead of Calling It**
Symptom: a value that should be a string or number is `<function foo at 0x...>`. Common in configuration code: `config = {"timeout": get_timeout}` instead of `config = {"timeout": get_timeout()}`. Because functions are first-class, Python happily stores the function object. No error until something downstream tries to use it as a number.
Diagnosis: add type checks or use `mypy --strict`. Log types alongside values during debugging.

**3. Keyword Argument Conflicts with `**kwargs`**
Symptom: `TypeError: got multiple values for argument 'x'`. This happens when you pass `x` as a positional argument *and* it also appears in a dict you unpack with `**`. The function receives `x` twice. Common in wrapper functions that forward arguments.
Diagnosis: use positional-only parameters (before `/`) for arguments that should never conflict with keyword forwarding.
:::

## 🎯 Checkpoint

::: details Question 1 — Why are mutable defaults shared?
**Q:** Explain *mechanically* why `def f(x=[])` shares the same list across calls. Where is the list stored?

**A:** When Python executes the `def` statement, it evaluates each default value expression exactly once and stores the results in the tuple `f.__defaults__`. This tuple is an attribute of the function object itself, which persists for the lifetime of the function. On each call where the caller omits the argument, Python does not re-evaluate `[]` — it pulls the existing object from `__defaults__`. Since lists are mutable, any in-place modification (like `.append()`) alters the one shared object. The fix is to use `None` as the default and create a fresh list inside the function body.
:::

::: details Question 2 — What makes an object callable?
**Q:** I have a class `Widget`. How do I make instances of `Widget` callable, and how does Python actually resolve `widget()` at runtime?

**A:** Define `__call__` on the class: `def __call__(self, *args, **kwargs)`. When Python encounters `widget()`, it does not look at the instance for `__call__` — it looks at `type(widget).__call__`, following the standard special-method lookup on the type. This is the same mechanism used for `__len__`, `__iter__`, etc. You can verify callability with `callable(widget)`, which internally checks whether `type(widget)` has a `__call__` attribute. Note that classes themselves are callable because their metaclass (`type`) defines `__call__`, which orchestrates `__new__` and `__init__`.
:::

::: details Question 3 — Parameter kind ordering
**Q:** Write a function signature that uses all five parameter kinds in Python 3.12+. What happens if you try to put keyword-only parameters before `*args`?

**A:** The full ordering is: positional-only, `/`, positional-or-keyword, `*args`, keyword-only, `**kwargs`. Example: `def f(a, /, b, *args, c, **kwargs)`. You cannot place keyword-only parameters before `*args` — there is nothing to mark them as keyword-only. The `*` (bare star) or `*args` acts as the separator. If you write `def f(c, *args)`, then `c` is positional-or-keyword, not keyword-only. To make `c` keyword-only without accepting variable positional args, use a bare star: `def f(*, c)`.
:::

## Key Mental Models

- **`def` is an assignment statement** — it creates a function object and binds a name to it in the current scope, just like `x = 42` creates an int and binds `x`.
- **Functions are objects with baggage** — `__defaults__`, `__closure__`, `__code__`, `__annotations__` are all inspectable attributes, not hidden compiler magic.
- **Defaults are baked at definition time** — think of them as sticky notes attached to the recipe card at print time, not at cooking time.
- **Callable is a protocol, not a type** — any object with `__call__` on its type can be called with `()`, making strategies, command objects, and stateful callbacks trivial.
- **The five parameter kinds have a fixed order** — positional-only `/` normal `*args` keyword-only `**kwargs` — and knowing this order prevents `TypeError` surprises in wrapper functions.

## Related

- [LEGB Scoping & Closures](./02-scoping-closures.md) — how the names inside a function body are resolved.
- [Decorators](./03-decorators.md) — the most common use of higher-order functions in Python.
- [Functional Programming Tools](./04-functional-tools.md) — `partial`, `lru_cache`, and other tools that accept or return functions.
- [Module 2 — Data Structures](/python/module-02/) — mutability concepts needed to understand the default argument trap.
