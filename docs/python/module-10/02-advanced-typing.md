---
title: Advanced Typing — Generics, Protocols & More
outline: deep
---

# Advanced Typing — Generics, Protocols & More

**Interview weight:** 🔥🔥 — senior Python roles expect fluency with generics and protocols. Interviewers probe whether you understand TypeVar constraints vs bounds, can explain structural vs nominal subtyping, and know when to reach for @overload vs Union.

**Python version notes:** All examples target Python 3.12+. The new generic syntax (`class Stack[T]`, `def first[T]`) requires 3.12+. `TypeGuard` requires 3.10+. `TypeIs` requires 3.13+. `ParamSpec` requires 3.10+. Protocols (PEP 544) require 3.8+.

**Prerequisites:** [Type Hints — From Zero to Useful](./01-type-hints-basics.md), [Module 4 — OOP & Descriptors](/python/module-04/)

## 🗣️ In Plain English

::: tip In Plain English
Think of two separate ideas: **generics** and **protocols**.

**Generics** are like a vending machine design that works with any product size. An engineer designs the machine once, leaving a placeholder for "whatever product goes here." The blueprint says: "this machine has a slot of size T, a storage rack of size T, and a dispensing chute of size T." When a factory stamps out a real machine, they pick a concrete product — cans, bottles, or candy bars — and every T in the blueprint gets replaced. You get a can-machine, a bottle-machine, or a candy-machine, each fully type-safe for its product. In Python, T is that placeholder, and you "stamp" a concrete version by writing `Stack[int]` or `Stack[str]`.

**Protocols** are like job descriptions. When a company posts a job, they list required skills: "must be able to write reports, give presentations, and manage a calendar." They do not care where you went to school, what your family name is, or what other jobs you have held. If you can do those three things, you qualify. This is **structural** subtyping — qualification by capability, not by ancestry. In Python's class world, normal subtyping is **nominal**: you qualify because you literally inherit from a base class. Protocols flip that: any class that has the right methods qualifies, even if it has never heard of the protocol class. A class with a `.read()` method satisfies a `Readable` protocol whether or not it inherits from anything.

The rest of this page — `Literal`, `TypedDict`, `@overload`, `TypeGuard`, `ParamSpec` — are specialized tools. They each solve one narrow problem: restricting values to a fixed set, typing dictionary schemas, expressing different return types for different inputs, helping the type checker narrow types in if-branches, and correctly typing decorators. You will not use all of them daily, but when you need them, nothing else works.
:::

## ⚙️ Under the Hood

### TypeVar — parameterizing functions

A `TypeVar` introduces a type variable that the type checker tracks across a function signature. It means "some specific type, decided at call time":

```python
# run: python3 typevar_basics.py
"""TypeVar — the foundation of generic programming in Python."""
from typing import TypeVar

T = TypeVar("T")

def first(items: list[T]) -> T:
    """Return the first element — its type matches the list's element type."""
    return items[0]

# Type checker infers T = int:
x: int = first([1, 2, 3])

# Type checker infers T = str:
y: str = first(["a", "b", "c"])

print(x, y)  # 1 a

# Bound TypeVar — restricts T to a specific supertype:
class Animal:
    def speak(self) -> str:
        return "..."

class Dog(Animal):
    def speak(self) -> str:
        return "Woof"

class Cat(Animal):
    def speak(self) -> str:
        return "Meow"

A = TypeVar("A", bound=Animal)

def loudest(animals: list[A]) -> A:
    """T must be Animal or a subclass of Animal."""
    return max(animals, key=lambda a: len(a.speak()))

print(loudest([Dog(), Cat()]).speak())  # Meow

# Constrained TypeVar — restricts to specific types (not subclasses):
StrOrBytes = TypeVar("StrOrBytes", str, bytes)

def concat(a: StrOrBytes, b: StrOrBytes) -> StrOrBytes:
    """T is either str or bytes — not a mix, and not a subclass."""
    return a + b

print(concat("hello", " world"))  # hello world
print(concat(b"hello", b" world"))  # b'hello world'
```

### Generic classes

A generic class carries a type parameter that specializes each instance:

```python
# run: python3 generic_class.py
"""Generic classes — pre-3.12 syntax with typing.Generic."""
from typing import TypeVar, Generic, Iterator

T = TypeVar("T")

class Stack(Generic[T]):
    """A type-safe stack. Stack[int] only holds ints, Stack[str] only strings."""

    def __init__(self) -> None:
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T:
        if not self._items:
            raise IndexError("pop from empty stack")
        return self._items.pop()

    def peek(self) -> T:
        if not self._items:
            raise IndexError("peek at empty stack")
        return self._items[-1]

    def __len__(self) -> int:
        return len(self._items)

    def __iter__(self) -> Iterator[T]:
        return iter(reversed(self._items))

# Usage:
int_stack: Stack[int] = Stack()
int_stack.push(1)
int_stack.push(2)
# int_stack.push("oops")  # mypy error: Argument 1 has incompatible type "str"

print(int_stack.pop())  # 2
print(list(int_stack))  # [1]
```

### New 3.12+ generic syntax

Python 3.12 introduced a cleaner syntax (PEP 695) that eliminates the need for explicit `TypeVar` declarations:

```python
# run: python3 generic_312.py
"""Python 3.12+ generic syntax — no TypeVar declarations needed."""

# Generic function — T is declared inline in square brackets:
def first[T](items: list[T]) -> T:
    return items[0]

# Generic class — type params declared on the class itself:
class Stack[T]:
    def __init__(self) -> None:
        self._items: list[T] = []

    def push(self, item: T) -> None:
        self._items.append(item)

    def pop(self) -> T:
        if not self._items:
            raise IndexError("pop from empty stack")
        return self._items.pop()

    def __repr__(self) -> str:
        return f"Stack({self._items!r})"

# Bounded type parameter:
class Animal:
    name: str = "?"

class Dog(Animal):
    name = "Rex"

def best_friend[A: Animal](pets: list[A]) -> A:
    """A is bound to Animal — any Animal subclass works."""
    return pets[0]

# Multiple type parameters:
class Pair[K, V]:
    def __init__(self, key: K, value: V) -> None:
        self.key = key
        self.value = value

    def __repr__(self) -> str:
        return f"Pair({self.key!r}, {self.value!r})"

s = Stack[int]()
s.push(10)
print(s)  # Stack([10])

p = Pair("name", 42)
print(p)  # Pair('name', 42)

print(first(["alpha", "beta"]))  # alpha
```

### Protocols — structural subtyping

Protocols (PEP 544) define interfaces by structure, not by inheritance. A class satisfies a protocol if it has the required methods and attributes — no `class Foo(MyProtocol)` needed:

```python
# run: python3 protocols_demo.py
"""Protocols — duck typing with static type checking."""
from typing import Protocol, runtime_checkable

class Drawable(Protocol):
    """Any class with a draw() -> str method satisfies this protocol."""
    def draw(self) -> str: ...

class Circle:
    """Circle doesn't inherit from Drawable — but it HAS draw()."""
    def __init__(self, radius: float) -> None:
        self.radius = radius

    def draw(self) -> str:
        return f"Circle(r={self.radius})"

class Square:
    def __init__(self, side: float) -> None:
        self.side = side

    def draw(self) -> str:
        return f"Square(s={self.side})"

class Triangle:
    """No draw() method — does NOT satisfy Drawable."""
    def __init__(self, base: float) -> None:
        self.base = base

def render(shapes: list[Drawable]) -> None:
    """Accepts anything with a draw() method."""
    for shape in shapes:
        print(shape.draw())

# Both Circle and Square satisfy Drawable structurally:
render([Circle(5.0), Square(3.0)])
# Circle(r=5.0)
# Square(s=3.0)

# render([Triangle(4.0)])  # mypy error: Triangle doesn't implement draw()

# Protocol with attributes:
class Named(Protocol):
    name: str

class User:
    def __init__(self, name: str) -> None:
        self.name = name

def greet(entity: Named) -> str:
    return f"Hello, {entity.name}"

print(greet(User("Alice")))  # Hello, Alice
```

### @runtime_checkable

By default, protocols are static-only. Adding `@runtime_checkable` enables `isinstance()` checks — but with a significant caveat:

```python
# run: python3 runtime_checkable_demo.py
"""@runtime_checkable — isinstance() for protocols (with caveats)."""
from typing import Protocol, runtime_checkable

@runtime_checkable
class Closeable(Protocol):
    def close(self) -> None: ...

class FileWrapper:
    def close(self) -> None:
        print("Closed!")

class NotCloseable:
    pass

# isinstance works — checks method EXISTENCE only:
print(isinstance(FileWrapper(), Closeable))   # True
print(isinstance(NotCloseable(), Closeable))   # False

# CAVEAT: isinstance only checks that the method EXISTS as an attribute.
# It does NOT check:
# - Parameter types
# - Return type
# - That it's actually callable

class Broken:
    close = 42  # close exists as an attribute, but it's an int!

print(isinstance(Broken(), Closeable))  # True! (misleading)
# Broken().close() would crash at runtime with TypeError

# This is why @runtime_checkable is a rough check — for precise
# validation, rely on static analysis (mypy/pyright), not isinstance().
```

### Literal types

`Literal` restricts a value to specific compile-time constants:

```python
# run: python3 literal_demo.py
"""Literal — restricting values to a fixed set."""
from typing import Literal

type Mode = Literal["read", "write", "append"]

def open_file(path: str, mode: Mode) -> str:
    return f"Opening {path} in {mode} mode"

# Valid:
print(open_file("data.txt", "read"))
print(open_file("log.txt", "append"))

# open_file("data.txt", "delete")  # mypy error: incompatible type "delete"

# Literal works with int, bool, bytes, enum values, None too:
type HttpSuccess = Literal[200, 201, 204]
type Toggle = Literal[True, False]  # (same as bool, but explicit)

def handle_status(code: HttpSuccess) -> str:
    match code:
        case 200: return "OK"
        case 201: return "Created"
        case 204: return "No Content"

print(handle_status(200))  # OK
```

### TypedDict

`TypedDict` defines the schema for a dictionary — which keys exist and what types their values have:

```python
# run: python3 typeddict_demo.py
"""TypedDict — typed dictionary schemas."""
from typing import TypedDict, Required, NotRequired

# Basic TypedDict — all keys required by default:
class UserRecord(TypedDict):
    id: int
    name: str
    email: str

# With optional keys (total=False makes all keys optional):
class Config(TypedDict, total=False):
    debug: bool
    log_level: str
    max_retries: int

# Mixing required and optional with Required/NotRequired (3.11+):
class APIResponse(TypedDict):
    status: Required[int]         # must be present
    data: Required[dict[str, str]]
    error: NotRequired[str]       # may be absent
    trace_id: NotRequired[str]

# Usage — type checker validates keys and value types:
user: UserRecord = {"id": 1, "name": "Alice", "email": "alice@example.com"}
print(user["name"])  # Alice

config: Config = {"debug": True}  # log_level and max_retries are optional
print(config)  # {'debug': True}

response: APIResponse = {"status": 200, "data": {"key": "value"}}
# response = {"status": "200", "data": {}}  # mypy error: incompatible type for "status"

# TypedDict is NOT a class at runtime — it's still a plain dict:
print(type(user))  # <class 'dict'>

# Inheritance works for extending schemas:
class AdminUser(UserRecord):
    role: str
    permissions: list[str]

admin: AdminUser = {
    "id": 1, "name": "Admin", "email": "admin@co.com",
    "role": "superadmin", "permissions": ["read", "write", "delete"]
}
print(admin["role"])  # superadmin
```

### @overload

`@overload` lets you declare multiple signatures for a single function — the type checker uses them to infer different return types based on input types:

```python
# run: python3 overload_demo.py
"""@overload — different return types for different argument types."""
from typing import overload

# Overloaded signatures (for the type checker only — never executed):
@overload
def process(data: str) -> list[str]: ...
@overload
def process(data: bytes) -> list[int]: ...
@overload
def process(data: list[int]) -> int: ...

# The actual implementation (must handle all cases):
def process(data: str | bytes | list[int]) -> list[str] | list[int] | int:
    if isinstance(data, str):
        return data.split()
    elif isinstance(data, bytes):
        return list(data)
    else:
        return sum(data)

# Type checker knows the exact return type per input type:
words: list[str] = process("hello world")       # inferred: list[str]
byte_vals: list[int] = process(b"\x01\x02")     # inferred: list[int]
total: int = process([1, 2, 3])                  # inferred: int

print(words)      # ['hello', 'world']
print(byte_vals)  # [1, 2]
print(total)      # 6

# Important: @overload decorators are ONLY for the type checker.
# At runtime, only the final (non-decorated) implementation exists.
# Calling process.__overloads__ does not exist — the overloads
# are consumed by the type checker and discarded.
```

### TypeGuard and TypeIs

`TypeGuard` (3.10+) and `TypeIs` (3.13+) let you write custom type-narrowing functions that the type checker trusts:

```python
# run: python3 typeguard_demo.py
"""TypeGuard and TypeIs — custom type narrowing."""
from typing import TypeGuard, TypeIs

# TypeGuard — narrows the type in the True branch only:
def is_string_list(val: list[object]) -> TypeGuard[list[str]]:
    """Return True if every element is a string."""
    return all(isinstance(item, str) for item in val)

def process_items(items: list[object]) -> None:
    if is_string_list(items):
        # Type checker now knows items is list[str]:
        for s in items:
            print(s.upper())  # .upper() is valid — s is str
    else:
        print("Not all strings")

process_items(["hello", "world"])  # HELLO / WORLD
process_items(["hello", 42])       # Not all strings

# TypeIs (3.13+) — narrows in BOTH branches and is more precise:
def is_str(val: str | int) -> TypeIs[str]:
    return isinstance(val, str)

def handle(val: str | int) -> None:
    if is_str(val):
        # val is narrowed to str
        print(f"String: {val.upper()}")
    else:
        # val is narrowed to int (the remaining type)
        print(f"Integer: {val + 1}")

handle("hello")  # String: HELLO
handle(42)        # Integer: 43

# Key difference:
# TypeGuard[B]: True branch → B, False branch → unchanged (still original type)
# TypeIs[B]:    True branch → B, False branch → original minus B (proper narrowing)
```

### ParamSpec and Concatenate

`ParamSpec` (3.10+) captures the parameter signature of a callable — essential for correctly typing decorators:

```python
# run: python3 paramspec_demo.py
"""ParamSpec — typing decorators that preserve function signatures."""
from typing import ParamSpec, Callable, TypeVar
from functools import wraps
import time

P = ParamSpec("P")
R = TypeVar("R")

def timer(func: Callable[P, R]) -> Callable[P, R]:
    """A decorator that times function execution.

    Without ParamSpec, you'd lose the original function's parameter types.
    With ParamSpec, the decorated function keeps its exact signature.
    """
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} took {elapsed:.4f}s")
        return result
    return wrapper

@timer
def compute(n: int, label: str = "result") -> str:
    total = sum(range(n))
    return f"{label}: {total}"

# Type checker preserves the signature of compute:
# compute(n: int, label: str = "result") -> str
result: str = compute(1_000_000, label="sum")
print(result)

# compute("wrong")  # mypy error: expected int, got str
# compute(100, times=3)  # mypy error: unexpected keyword argument "times"

# Concatenate — for decorators that ADD parameters:
from typing import Concatenate

def with_user(
    func: Callable[Concatenate[str, P], R]
) -> Callable[P, R]:
    """Decorator that injects a 'user' first argument."""
    @wraps(func)
    def wrapper(*args: P.args, **kwargs: P.kwargs) -> R:
        return func("admin", *args, **kwargs)
    return wrapper

@with_user
def delete_record(user: str, record_id: int) -> str:
    return f"{user} deleted record {record_id}"

# After decoration, the signature is: delete_record(record_id: int) -> str
print(delete_record(42))  # admin deleted record 42
```

### Variance — covariance, contravariance, invariance

Variance determines how subtype relationships of generic types relate to subtype relationships of their parameters:

```python
# run: python3 variance_demo.py
"""Variance — when generic subtyping gets subtle."""
from typing import TypeVar
from collections.abc import Sequence, Callable

# INVARIANCE (default for mutable containers):
# list[Dog] is NOT a subtype of list[Animal], even though Dog is a subtype of Animal.
# Why? Because list is mutable:

class Animal:
    pass

class Dog(Animal):
    def bark(self) -> str:
        return "Woof"

class Cat(Animal):
    def meow(self) -> str:
        return "Meow"

def add_cat(animals: list[Animal]) -> None:
    animals.append(Cat())

dogs: list[Dog] = [Dog(), Dog()]
# add_cat(dogs)  # mypy error! list[Dog] is not list[Animal]
# If this were allowed, we'd have a Cat in a list[Dog] — type unsafety.

# COVARIANCE (safe for read-only / immutable containers):
# Sequence[Dog] IS a subtype of Sequence[Animal]
# Because you can only read from a Sequence, adding a Cat is impossible.

def count_animals(animals: Sequence[Animal]) -> int:
    return len(animals)

print(count_animals(dogs))  # Works! Sequence is covariant.

# CONTRAVARIANCE (for function parameters / callbacks):
# Callable[[Animal], None] IS a subtype of Callable[[Dog], None]
# A function that handles any Animal can be used where a Dog-handler is expected.

def handle_animal(a: Animal) -> None:
    print(f"Handling {type(a).__name__}")

def process_dogs(handler: Callable[[Dog], None], dogs: list[Dog]) -> None:
    for dog in dogs:
        handler(dog)

# handle_animal accepts Animal (supertype of Dog), so it's safe as a Dog handler:
process_dogs(handle_animal, [Dog(), Dog()])

# Summary:
# - list[T]: INVARIANT — list[Dog] is NOT list[Animal]
# - Sequence[T]: COVARIANT — Sequence[Dog] IS Sequence[Animal] (read-only)
# - Callable[[T], R]: CONTRAVARIANT in T — Callable[[Animal], None] IS Callable[[Dog], None]

# In 3.12+ syntax, you can declare variance explicitly:
# class ReadOnly[T_co]:  ...    # T_co is covariant (naming convention)
# class WriteOnly[T_contra]: ...  # T_contra is contravariant
# PEP 695 also allows: class Box[T: covariant]: ...  (but this isn't standard yet)
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Using TypeVar without understanding invariance — hidden Cat-in-Dog-list bugs**

You define `def process(items: list[Animal])` and pass a `list[Dog]`. mypy rejects it. You "fix" it by adding `# type: ignore` or switching to `Any`. Later, the function appends a `Cat` into the list, and downstream code that assumes all elements are `Dog` crashes. Symptom: `AttributeError: 'Cat' object has no attribute 'bark'` deep in a loop. Fix: use `Sequence[Animal]` if you only read, or keep `list[Animal]` and construct the list with the right type at the call site. Understand *why* mypy rejected it — it was protecting you.

**2. @overload implementation not matching overload signatures**

You write three `@overload` signatures and an implementation that doesn't cover all cases. mypy may not catch a mismatch between the overload signatures and the implementation body (it trusts the overloads). At runtime, a caller hits a code path the implementation doesn't handle. Symptom: `TypeError` or wrong return type at runtime despite mypy showing no errors. Fix: ensure the implementation body explicitly handles every overloaded case with isinstance/match guards, and write tests for each overload variant.

**3. Protocol + @runtime_checkable giving false positives**

You define a `@runtime_checkable` protocol with a `process(self, data: bytes) -> str` method. A class has `process` as a plain attribute (a string, not a method). `isinstance()` returns `True` because it only checks attribute existence, not callability or signature. Symptom: `TypeError: 'str' object is not callable` when your code tries to call `.process()` on the object. Fix: don't rely on `isinstance()` with `@runtime_checkable` for anything safety-critical — use static type checking as the primary guard and `isinstance` only as a quick runtime hint.

:::

## 🎯 Checkpoint

::: details Question 1 — TypeVar bound vs constraint
**Q:** What is the difference between `T = TypeVar('T', bound=Animal)` and `T = TypeVar('T', Dog, Cat)`? How does each affect what types can be passed?

**A:** `bound=Animal` means T can be `Animal` or *any subclass* of Animal — the type checker accepts `Dog`, `Cat`, `Parrot(Animal)`, etc. The inferred type preserves the specific subclass (e.g., if you pass a `Dog`, T is `Dog`, not `Animal`). `TypeVar('T', Dog, Cat)` is a *constraint* — T can be exactly `Dog` or exactly `Cat`, nothing else. A new `Parrot(Animal)` class would be rejected. Furthermore, constrained TypeVars don't allow mixing: in a function `f(a: T, b: T)`, both arguments must be the same constrained type (both `Dog` or both `Cat`). With bound, they must both be the same type too, but any Animal subclass qualifies.
:::

::: details Question 2 — Why is list invariant?
**Q:** Why does mypy reject `list[Dog]` as a `list[Animal]`, even though `Dog` is a subclass of `Animal`?

**A:** Because `list` is mutable. If `list[Dog]` were accepted as `list[Animal]`, code receiving `list[Animal]` could legally append a `Cat()` to it. The original caller — who holds a `list[Dog]` reference — would now have a `Cat` in their dog list, violating type safety. This is the classic variance problem. `list` is invariant: `list[Dog]` is not a subtype of `list[Animal]`, and `list[Animal]` is not a subtype of `list[Dog]`. If you only need to read from the collection, use `Sequence[Animal]` (which is covariant because it's read-only) or `Iterable[Animal]`.
:::

::: details Question 3 — Protocol vs ABC
**Q:** When would you use a Protocol instead of an abstract base class (ABC)? What trade-off does each make?

**A:** Use a Protocol when you want **structural subtyping** — the implementing class doesn't need to know about or inherit from your interface. This is ideal for library code where you want to accept any object with the right shape (like any object with a `.read()` method) without forcing users to import and inherit from your base class. Use an ABC when you want **nominal subtyping** — explicit "I implement this interface" declarations, shared implementation via mixin methods, and `register()` for virtual subclasses. The trade-off: Protocols are more flexible and decoupled (any conforming class works retroactively), but ABCs provide stronger guarantees (a class explicitly opts in, and the ABC can enforce that all abstract methods are implemented at class creation time via `__init_subclass__`). Protocols also can't provide default method implementations the way ABCs can.
:::

## Key Mental Models

- **TypeVar is "some specific type, decided by the caller."** It's not `Any` — it's a variable that the type checker solves per call site, enforcing consistency within each call.
- **Protocols check shape, ABCs check lineage.** Use Protocol when you want duck typing with static verification; use ABC when you want explicit contracts with shared implementation.
- **Invariance protects mutability.** `list[Dog]` is not `list[Animal]` because lists can be written to. Read-only views (`Sequence`, `Iterable`) are covariant and accept subtypes.
- **@overload is for the type checker, not for runtime dispatch.** Only the final implementation body exists at runtime — the overload signatures are consumed and discarded by the type checker.
- **ParamSpec preserves the decorated function's signature.** Without it, every decorator erases parameter types, leaving callers with `(*args: Any, **kwargs: Any)`.

## Related

- [Type Hints — From Zero to Useful](./01-type-hints-basics.md) — the foundation this page builds on
- [mypy, Pydantic & Runtime Typing](./03-mypy-pydantic.md) — the tools that validate these advanced types
- [Module 4 — OOP & Descriptors](/python/module-04/) — class mechanics, inheritance, and ABCs
- [Module 5 — Iterators & Generators](/python/module-05/) — Iterator/Generator protocols tie directly to typing.Protocol
