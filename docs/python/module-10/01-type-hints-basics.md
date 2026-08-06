---
title: Type Hints — From Zero to Useful
outline: deep
---

# Type Hints — From Zero to Useful

**Interview weight:** 🔥🔥 — type hints are expected knowledge for any senior Python role. Interviewers test whether you understand annotations as metadata (not enforcement), can fluently annotate real code, and know the 3.9/3.10/3.12 syntax evolution.

**Python version notes:** All examples target Python 3.12+. Built-in generic syntax (`list[int]`) requires 3.9+. Union syntax (`X | Y`) requires 3.10+. The `type` statement requires 3.12+. `from __future__ import annotations` (PEP 563) has been available since 3.7.

**Prerequisites:** [Module 3 — Functions & Scoping](/python/module-03/), [Module 4 — OOP & Descriptors](/python/module-04/)

## 🗣️ In Plain English

::: tip In Plain English
Type hints are like labels on storage containers in a shared kitchen.

Imagine a commercial kitchen where dozens of cooks share the same shelves. Every container has a label — "FLOUR ONLY," "SUGAR ONLY," "CHILI FLAKES." These labels serve two purposes: they help any cook who grabs a container know what is inside without opening it, and they let an inspector walk through the kitchen before service and flag containers that are mislabeled or placed on the wrong shelf.

But here is the critical detail: **nobody physically stops you from putting sugar in the "FLOUR" container.** The label is stuck on with tape, not welded on by a machine. If you pour sugar in, the container does not reject it. The sugar sits there happily. The only consequence is that the next cook who trusts the label and scoops out "flour" for a bread recipe will bake something inedible.

Python's type hints work the same way. When you write `def bake(flour: str, grams: int) -> str`, Python stores those labels in a dictionary on the function — but it never checks them when the function runs. You can pass a list where it says `int`, and Python will not complain. The labels are purely for **humans reading the code** and for **automated inspectors** (tools like mypy and pyright) that walk through your codebase before execution and flag mismatches — exactly like the kitchen inspector catching that someone labeled chili flakes as paprika.

The payoff is real: with labels on everything, your editor can autocomplete methods, catch typos before you run the code, and refactoring becomes dramatically safer. But unlike languages where the compiler enforces types as law, Python treats them as advisory. The labels are voluntary, they have zero cost at runtime, and they are only as useful as the tools and discipline you pair them with.
:::

## ⚙️ Under the Hood

### What annotations actually are

When you write type annotations in Python, the interpreter stores them as plain data in an `__annotations__` dictionary — on functions, classes, and modules. It does **nothing else** with them. No validation, no type checking, no runtime enforcement.

```python
# run: python3 annotations_are_data.py
"""Annotations are just dictionaries — Python stores them and moves on."""

def greet(name: str, times: int = 1) -> str:
    return (f"Hello, {name}! " * times).strip()

# The annotations live in a dict on the function object:
print(greet.__annotations__)
# {'name': <class 'str'>, 'times': <class 'int'>, 'return': <class 'str'>}

# Python does NOT check them at call time:
result = greet(42, "not_an_int")  # No TypeError from annotations!
print(result)  # TypeError from str operations, not from type hints
```

### Basic scalar types

The fundamental annotation types map directly to Python's built-in types:

```python
# run: python3 basic_types.py
"""The basic scalar type annotations."""

# Variables
name: str = "Alice"
age: int = 30
height: float = 1.75
active: bool = True
raw: bytes = b"\x00\xff"
nothing: None = None  # annotating that something is always None

# Python stores module-level annotations too:
print(__annotations__)
# {'name': <class 'str'>, 'age': <class 'int'>, 'height': <class 'float'>,
#  'active': <class 'bool'>, 'raw': <class 'bytes'>, 'nothing': <class 'NoneType'>}
```

### Container types (3.9+ built-in generics)

Before Python 3.9, you had to import `List`, `Dict`, `Tuple`, `Set` from `typing` to parameterize containers. Since 3.9, the built-in types themselves accept subscripts:

```python
# run: python3 container_types.py
"""Container type annotations — 3.9+ built-in generic syntax."""

# Homogeneous collections
names: list[str] = ["Alice", "Bob"]
scores: dict[str, int] = {"Alice": 95, "Bob": 87}
unique_tags: set[str] = {"python", "typing"}
frozen_ids: frozenset[int] = frozenset({1, 2, 3})

# Tuples — fixed-length (each position typed):
coordinate: tuple[float, float] = (3.14, 2.72)
record: tuple[int, str, float] = (1, "Alice", 95.5)

# Tuples — variable-length (homogeneous):
values: tuple[int, ...] = (1, 2, 3, 4, 5)  # any number of ints

# Nested containers
matrix: list[list[int]] = [[1, 2], [3, 4]]
registry: dict[str, list[tuple[int, str]]] = {
    "users": [(1, "Alice"), (2, "Bob")]
}

print(f"names type hint works at runtime: {list[str]}")
# list[str] — this is a GenericAlias object, not a class
print(f"Type of list[str]: {type(list[str])}")
# <class 'types.GenericAlias'>
```

### Optional and Union

`Optional[X]` means "X or None." Since Python 3.10, you can write `X | None` directly — and more generally, `X | Y` for any union:

```python
# run: python3 optional_union.py
"""Optional and Union — representing 'one of several types'."""
from typing import Optional, Union

# Pre-3.10 style:
def find_user_old(user_id: int) -> Optional[str]:
    """Return username or None if not found."""
    db = {1: "Alice", 2: "Bob"}
    return db.get(user_id)

# 3.10+ style (preferred):
def find_user(user_id: int) -> str | None:
    """Identical semantics, cleaner syntax."""
    db = {1: "Alice", 2: "Bob"}
    return db.get(user_id)

# Union of multiple types:
# Pre-3.10:
Identifier_old = Union[int, str]
# 3.10+:
type Identifier = int | str  # 3.12 type alias syntax

def lookup(key: int | str) -> str:
    return str(key)

# Optional[X] is EXACTLY Union[X, None]:
print(Optional[int] == Union[int, None])  # True
print(Optional[int] == int | None)        # True (3.10+)
```

### Any — the escape hatch

`Any` is compatible with every type in both directions — it silences the type checker. Use it deliberately, not as a default:

```python
# run: python3 any_escape.py
"""Any — when you genuinely cannot type something."""
from typing import Any

def log_anything(value: Any) -> None:
    """Accepts literally anything — the type checker won't complain."""
    print(f"[LOG] {value!r}")

# Any is different from 'object':
# - object: accepts anything, but you can only use object methods on it
# - Any: accepts anything AND lets you use any method/attribute on it
def with_object(x: object) -> None:
    # x.strip()  # mypy error: "object" has no attribute "strip"
    print(x)

def with_any(x: Any) -> None:
    x.strip()     # mypy: no error (Any disables checking)
    x.whatever()  # mypy: no error
    print(x)

log_anything(42)
log_anything("hello")
log_anything([1, 2, 3])
```

### Type aliases

Type aliases let you name complex types for readability. Python has evolved through three syntax generations:

```python
# run: python3 type_aliases.py
"""Three generations of type alias syntax."""
from typing import TypeAlias

# Generation 1 — plain assignment (3.0+):
# Problem: tools can't distinguish this from a regular variable
Vector_v1 = list[float]

# Generation 2 — TypeAlias annotation (3.10+):
# Explicit marker, but still just an assignment
Vector_v2: TypeAlias = list[float]

# Generation 3 — the type statement (3.12+):
# Proper syntax, supports forward references, lazy evaluation
type Vector = list[float]
type Matrix = list[Vector]  # can reference other type aliases
type JSONValue = str | int | float | bool | None | list["JSONValue"] | dict[str, "JSONValue"]
# ↑ Recursive type aliases only work properly with the type statement

# All three are usable in annotations:
def scale(v: Vector, factor: float) -> Vector:
    return [x * factor for x in v]

print(scale([1.0, 2.0, 3.0], 2.5))
# [2.5, 5.0, 7.5]

# The type statement creates a TypeAliasType object:
print(type(Vector))
# <class 'typing.TypeAliasType'>
```

### Function signatures

The full vocabulary for annotating function signatures:

```python
# run: python3 function_signatures.py
"""Complete function annotation patterns."""
from collections.abc import Callable, Iterator

# Basic: parameter types + return type
def repeat(text: str, n: int) -> str:
    return text * n

# -> None for functions that return nothing meaningful
def log(message: str) -> None:
    print(f"[LOG] {message}")

# *args and **kwargs
def variadic(*args: int, **kwargs: str) -> None:
    """Each *arg is int, each **kwarg value is str."""
    print(f"args: {args}, kwargs: {kwargs}")

# Callable types — for function parameters
def apply(func: Callable[[int, int], int], a: int, b: int) -> int:
    """func takes two ints and returns an int."""
    return func(a, b)

result = apply(lambda x, y: x + y, 3, 4)
print(result)  # 7

# Generator return type
def count_up(limit: int) -> Iterator[int]:
    for i in range(limit):
        yield i

# Default values don't change the annotation:
def connect(host: str, port: int = 5432, ssl: bool = True) -> None:
    print(f"Connecting to {host}:{port} (ssl={ssl})")

connect("localhost")
```

### Variables: Final and ClassVar

`Final` marks a value as not to be reassigned. `ClassVar` distinguishes class-level attributes from instance attributes:

```python
# run: python3 final_classvar.py
"""Final and ClassVar — constraining where and how variables are used."""
from typing import Final, ClassVar

# Final — a constant (type checkers prevent reassignment)
MAX_RETRIES: Final[int] = 3
API_URL: Final = "https://api.example.com"  # type inferred as str

# Reassigning a Final triggers a mypy error (but Python itself allows it):
# MAX_RETRIES = 5  # mypy: error: Cannot assign to final name "MAX_RETRIES"

class Connection:
    # ClassVar — belongs to the class, not instances
    pool_size: ClassVar[int] = 10
    timeout: ClassVar[float] = 30.0

    # Instance attributes (no ClassVar)
    host: str
    port: int

    def __init__(self, host: str, port: int) -> None:
        self.host = host
        self.port = port

# ClassVar tells type checkers this is wrong:
# conn = Connection("localhost", 5432)
# conn.pool_size = 20  # mypy error: cannot assign to ClassVar via instance

print(Connection.pool_size)  # 10 — access via class
```

### The `__annotations__` dict and `get_type_hints()`

Annotations are stored raw in `__annotations__`. For forward references and proper resolution, use `typing.get_type_hints()`:

```python
# run: python3 get_type_hints_demo.py
"""Accessing annotations at runtime — __annotations__ vs get_type_hints()."""
from typing import get_type_hints

class TreeNode:
    """A node that references its own type — a forward reference."""
    value: int
    # Forward reference as string — because TreeNode isn't fully defined yet:
    children: list["TreeNode"]

    def __init__(self, value: int) -> None:
        self.value = value
        self.children = []

# Raw __annotations__ keeps the string as-is:
print(TreeNode.__annotations__)
# {'value': <class 'int'>, 'children': list['TreeNode']}

# get_type_hints() resolves the forward reference to the actual class:
resolved = get_type_hints(TreeNode)
print(resolved)
# {'value': <class 'int'>, 'children': list[TreeNode]}

# This is why frameworks like Pydantic and FastAPI use get_type_hints()
# instead of reading __annotations__ directly — they need resolved types.

# Function annotations work the same way:
def process(items: list["TreeNode"]) -> "TreeNode":
    return items[0]

print(get_type_hints(process))
# {'items': list[TreeNode], 'return': TreeNode}
```

### Forward references and `from __future__ import annotations`

When a class references itself or a not-yet-defined class, you must use a string literal — or enable PEP 563's deferred evaluation:

```python
# run: python3 forward_references.py
"""Forward references — two approaches."""
from __future__ import annotations  # PEP 563: all annotations become strings
from typing import get_type_hints

class Department:
    name: str
    manager: Employee  # Without __future__.annotations, this would be a NameError
    # because Employee isn't defined yet

    def __init__(self, name: str) -> None:
        self.name = name
        self.manager: Employee | None = None

class Employee:
    name: str
    dept: Department  # Department IS defined, so this works either way

    def __init__(self, name: str, dept: Department) -> None:
        self.name = name
        self.dept = dept

# With from __future__ import annotations, ALL annotations are stored as strings:
print(Department.__annotations__)
# {'name': 'str', 'manager': 'Employee'}

# get_type_hints() resolves them when you need the actual types:
print(get_type_hints(Department))
# {'name': <class 'str'>, 'manager': <class 'Employee'>}

# NOTE on PEP 563 vs PEP 649 (Python 3.14+):
# PEP 563 (from __future__ import annotations) stringifies everything.
# PEP 649 (3.14) will instead use deferred evaluation — annotations
# are stored as code objects that are evaluated on demand, avoiding
# both the string-parsing overhead and the NameError problem.
# Until 3.14, PEP 563 is the standard forward-reference solution.
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Assuming annotations enforce types at runtime**

The single most common misconception. A function annotated `def process(data: dict[str, int])` will happily accept a string, a list, or `None` — and crash deep inside its body with an incomprehensible traceback. Symptom: `TypeError: string indices must be integers` on line 47 of a function whose signature "clearly" says `dict[str, int]`. Root cause: the annotation was never checked. Fix: either run mypy/pyright in CI so the caller is flagged at commit time, or use Pydantic/`beartype` if you need runtime validation at the boundary.

**2. `from __future__ import annotations` breaking runtime annotation readers**

PEP 563 turns all annotations into strings. If your code or a library reads `__annotations__` directly (instead of calling `get_type_hints()`), it gets strings like `'list[int]'` instead of `list[int]`. Symptom: `attrs`/`dataclasses`/custom metaclasses that worked without the import suddenly raise `TypeError` or produce wrong behavior. Diagnosis: check whether the library supports PEP 563; if not, remove the future import from that file. This is especially dangerous because adding the import at the top of a file silently changes behavior of every annotation in it.

**3. Mutable default annotations hiding bugs from type checkers**

```python
# This is a bug — but mypy/pyright won't catch it:
def add_item(item: str, items: list[str] = []) -> list[str]:
    items.append(item)
    return items
```

The mutable default argument problem is orthogonal to type hints. `list[str] = []` is a perfectly valid annotation+default, so the type checker is satisfied. But the shared mutable default still causes cross-call contamination. Type hints give a false sense of safety here — you still need to know Python's default argument semantics (use `None` and create inside the body).

:::

## 🎯 Checkpoint

::: details Question 1 — Annotations at runtime
**Q:** You annotate a function parameter as `data: dict[str, int]` and call it with `data="hello"`. What happens at runtime, and why?

**A:** Nothing related to the annotation happens. Python stores `{'data': dict[str, int], 'return': ...}` in the function's `__annotations__` dict during function definition, then completely ignores it during the call. The string `"hello"` is bound to the parameter `data` with no type check. If the function body tries to do `data["key"]`, Python will attempt string subscripting, which succeeds (returning a character) or raises a `KeyError`/`TypeError` depending on the operation. The annotation is purely metadata — it exists for static analysis tools and human readers, never for the interpreter's call mechanism.
:::

::: details Question 2 — Optional vs Union vs default
**Q:** What is the difference between `def f(x: int = None)`, `def f(x: int | None = None)`, and `def f(x: int | None)`?

**A:** `def f(x: int = None)` is a type error — mypy/pyright will flag it because the annotation says `int` but the default is `None`, which is `NoneType`. `def f(x: int | None = None)` is correct — the annotation explicitly allows `None`, and the default matches. `def f(x: int | None)` is valid syntax meaning `x` is required (no default) but can be either `int` or `None` — the caller must explicitly pass a value, which may be `None`. The key insight: `Optional` / `| None` controls the *type*, while the default value controls whether the *argument can be omitted*. They are independent dimensions.
:::

::: details Question 3 — TypeAlias vs type statement
**Q:** Why did Python 3.12 introduce the `type` statement when `TypeAlias` already existed since 3.10?

**A:** `TypeAlias` (`Vector: TypeAlias = list[float]`) is still just an annotated assignment — the right-hand side is evaluated immediately at module load time. This means: (1) forward references require string quoting, (2) recursive type aliases are impossible because the name isn't bound yet during evaluation, and (3) tools can't always distinguish a type alias from a variable without reading the annotation. The `type` statement (`type Vector = list[float]`) is real syntax — the right-hand side is lazily evaluated (stored as a code object and only resolved when accessed). This enables recursive aliases (`type JSON = str | int | list[JSON] | dict[str, JSON]`), avoids import-order issues, and gives tools an unambiguous signal that this is a type alias, not a variable.
:::

## Key Mental Models

- **Annotations are metadata, not enforcement.** Python stores them in `__annotations__` and never checks them at call time. They become useful only when external tools read them.
- **Three eras of syntax:** pre-3.9 (`List[int]` from typing), 3.9-3.11 (`list[int]` built-in generics, `X | Y` unions), 3.12+ (`type` statement for aliases). Know all three because you will read all three in production codebases.
- **`Optional[X]` is just `Union[X, None]`.** It does not make the parameter optional (that is what default values do). The name is misleading and a common interview trap.
- **`get_type_hints()` over `__annotations__`** — always use it when reading annotations at runtime, because it resolves forward references and handles `from __future__ import annotations`.
- **Type hints have zero runtime cost** (unless you use `from __future__ import annotations`, which changes them to strings and affects annotation-reading code). The interpreter spends no time validating them.

## Related

- [Advanced Typing — Generics, Protocols & More](./02-advanced-typing.md) — builds on these basics with TypeVar, Generic, Protocol, and advanced patterns
- [mypy, Pydantic & Runtime Typing](./03-mypy-pydantic.md) — the tools that make annotations actionable
- [Module 3 — Functions & Scoping](/python/module-03/) — function mechanics that annotations decorate
- [Module 4 — OOP & Descriptors](/python/module-04/) — class mechanics underlying ClassVar, Generic, and Protocol
