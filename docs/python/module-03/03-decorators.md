---
title: Decorators — Wrapping Functions & Classes
outline: deep
---

# Decorators — Wrapping Functions & Classes

> **Interview weight:** 🔥🔥🔥 — decorators appear in almost every Python codebase and are a frequent interview topic covering higher-order functions, closures, and metaprogramming.
> **Python version notes:** Examples target Python 3.12+. `functools.cache` was added in 3.9. `@dataclass` `slots=True` was added in 3.10.
> **Prerequisites:** [Functions as First-Class Objects](./01-functions-first-class.md), [LEGB Scoping & Closures](./02-scoping-closures.md).

## 🗣️ In Plain English

::: tip In Plain English
A decorator is like a **phone case**. You slide it over the phone without modifying the phone's circuits. The phone still makes calls, takes photos, and runs apps — but now it has a kickstand, a card holder, or a rugged bumper. Some people stack cases: a thin inner sleeve plus a chunky outer armor. The phone underneath is untouched.

In Python, the "phone" is your function. A decorator wraps around it, adding behavior that runs before or after (or instead of) your function, without changing a single line inside it. Need every function call logged? Slide on a logging case. Need results cached? Slide on a caching case. Need to retry on failure? Stack a retry case on top.

The notation `@case` sitting above your function is just shorthand for "after you build this phone, immediately slide this case onto it." If you stack three `@case` lines, it is like stacking three cases: the bottom one goes on first (directly touching the phone), and the top one goes on last (outermost layer). When someone uses the phone, the outermost case handles the interaction first, passes through to the next case, and eventually the phone itself does the real work.

One important detail: after you put a case on, anyone looking at the phone sees the case, not the original phone. If the case does not have a little window showing the phone's brand label (its name and serial number), those details are hidden. That is why well-made cases include a transparent panel — in Python terms, `functools.wraps` copies the original function's identity onto the wrapper so that debugging tools, documentation generators, and other code can still see who the real phone is inside.
:::

## ⚙️ Under the Hood

### The `@` Syntax Is Sugar

The decorator syntax is strictly equivalent to reassigning the name:

```python
# run: python3 decorator_sugar.py

# With @
def my_decorator(func):
    def wrapper(*args, **kwargs):
        print(f"Calling {func.__name__}")
        return func(*args, **kwargs)
    return wrapper

@my_decorator
def greet(name: str) -> str:
    return f"Hello, {name}"

# Is exactly the same as:
# def greet(name: str) -> str:
#     return f"Hello, {name}"
# greet = my_decorator(greet)

print(greet("Alice"))
# Calling greet
# Hello, Alice

print(greet.__name__)  # 'wrapper' — oops, we lost the original name!
```

### Preserving Metadata with `functools.wraps`

Without `functools.wraps`, the wrapper replaces the original function's `__name__`, `__doc__`, `__module__`, and `__qualname__`:

```python
# run: python3 functools_wraps.py
import functools

def my_decorator(func):
    @functools.wraps(func)   # copies __name__, __doc__, __module__, __qualname__, __dict__
    def wrapper(*args, **kwargs):
        print(f"Calling {func.__name__}")
        return func(*args, **kwargs)
    return wrapper

@my_decorator
def greet(name: str) -> str:
    """Return a greeting."""
    return f"Hello, {name}"

print(greet.__name__)      # 'greet' — preserved!
print(greet.__doc__)       # 'Return a greeting.' — preserved!
print(greet.__wrapped__)   # <function greet at 0x...> — access to the original
```

`functools.wraps` is itself a decorator (a decorator for decorators). It calls `functools.update_wrapper` under the hood, which copies specific attributes and updates `__dict__`.

### Decorators with Arguments — The Triple-Nested Pattern

When you write `@decorator(arg)`, Python calls `decorator(arg)` first, which must return the actual decorator. This requires three layers of nesting:

```python
# run: python3 decorator_with_args.py
import functools
from typing import Callable, TypeVar

F = TypeVar("F", bound=Callable)

def repeat(n: int):
    """Decorator factory: returns a decorator that repeats the call n times."""
    def decorator(func: F) -> F:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            result = None
            for _ in range(n):
                result = func(*args, **kwargs)
            return result
        return wrapper  # type: ignore
    return decorator

@repeat(3)          # repeat(3) returns decorator, decorator wraps say_hello
def say_hello(name: str) -> None:
    print(f"Hello, {name}!")

say_hello("Alice")
# Hello, Alice!
# Hello, Alice!
# Hello, Alice!
```

**Evaluation order:**
1. `repeat(3)` executes, returning `decorator`.
2. `decorator(say_hello)` executes, returning `wrapper`.
3. `say_hello` is rebound to `wrapper`.

### Stacking Decorators

Multiple decorators are applied **bottom-up** (closest to the function first) but execute **top-down** at call time:

```python
# run: python3 stacking.py
import functools

def bold(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return f"<b>{func(*args, **kwargs)}</b>"
    return wrapper

def italic(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        return f"<i>{func(*args, **kwargs)}</i>"
    return wrapper

@bold       # applied second (outermost)
@italic     # applied first (innermost, directly wraps greet)
def greet(name: str) -> str:
    return f"Hello, {name}"

# Equivalent to: greet = bold(italic(greet))

print(greet("Alice"))  # <b><i>Hello, Alice</i></b>

# bold's wrapper runs first (top-down at call time)
# it calls italic's wrapper, which calls the original greet
```

### Class Decorators

Decorators can also be applied to classes. The decorator receives the class object and returns a (possibly modified) class:

```python
# run: python3 class_decorator.py
def add_repr(cls):
    """Add a __repr__ that shows all instance attributes."""
    def __repr__(self) -> str:
        attrs = ", ".join(f"{k}={v!r}" for k, v in self.__dict__.items())
        return f"{cls.__name__}({attrs})"
    cls.__repr__ = __repr__
    return cls

@add_repr
class Point:
    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

p = Point(1.0, 2.5)
print(p)    # Point(x=1.0, y=2.5)
print(repr(p))  # Point(x=1.0, y=2.5)
```

### Real-World Patterns

#### Timing Decorator

```python
# run: python3 timing_decorator.py
import functools
import time

def timed(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - start
        print(f"{func.__name__} took {elapsed:.4f}s")
        return result
    return wrapper

@timed
def slow_sum(n: int) -> int:
    return sum(range(n))

print(slow_sum(10_000_000))
# slow_sum took 0.1234s
# 49999995000000
```

#### Retry with Exponential Backoff

```python
# run: python3 retry_decorator.py
import functools
import time
import random

def retry(max_attempts: int = 3, base_delay: float = 1.0, backoff: float = 2.0):
    """Retry a function on exception with exponential backoff and jitter."""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            delay = base_delay
            for attempt in range(1, max_attempts + 1):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_attempts:
                        raise
                    jitter = random.uniform(0, delay * 0.1)
                    print(f"Attempt {attempt} failed: {e}. Retrying in {delay + jitter:.2f}s")
                    time.sleep(delay + jitter)
                    delay *= backoff
        return wrapper
    return decorator

call_count = 0

@retry(max_attempts=3, base_delay=0.1)
def flaky_api_call() -> str:
    global call_count
    call_count += 1
    if call_count < 3:
        raise ConnectionError(f"Server unavailable (attempt {call_count})")
    return "Success!"

print(flaky_api_call())
```

#### Memoization with `functools.lru_cache`

```python
# run: python3 lru_cache_demo.py
import functools

@functools.lru_cache(maxsize=128)
def fibonacci(n: int) -> int:
    if n < 2:
        return n
    return fibonacci(n - 1) + fibonacci(n - 2)

print(fibonacci(100))                  # 354224848179261915075
print(fibonacci.cache_info())          # CacheInfo(hits=98, misses=101, maxsize=128, currsize=101)

# functools.cache (3.9+) is lru_cache with maxsize=None (unbounded)
@functools.cache
def factorial(n: int) -> int:
    if n <= 1:
        return 1
    return n * factorial(n - 1)

print(factorial(20))                   # 2432902008176640000
print(factorial.cache_info())
```

### Decorator Classes

Instead of a closure, you can use a class with `__call__`. This is useful when the decorator needs to maintain state:

```python
# run: python3 decorator_class.py
import functools

class CountCalls:
    """Decorator that counts how many times the function is called."""

    def __init__(self, func):
        functools.update_wrapper(self, func)
        self.func = func
        self.call_count = 0

    def __call__(self, *args, **kwargs):
        self.call_count += 1
        print(f"{self.func.__name__} has been called {self.call_count} time(s)")
        return self.func(*args, **kwargs)

@CountCalls
def say_hi() -> str:
    return "Hi!"

print(say_hi())   # say_hi has been called 1 time(s) → Hi!
print(say_hi())   # say_hi has been called 2 time(s) → Hi!
print(say_hi.call_count)  # 2 — state is accessible
```

**Caveat for methods:** If you use a decorator class on a method, `self` binding breaks because the decorator instance is not a descriptor by default. You need to implement `__get__` to support the descriptor protocol:

```python
# run: python3 decorator_class_method.py
import functools
import types

class CountCalls:
    def __init__(self, func):
        functools.update_wrapper(self, func)
        self.func = func
        self.call_count = 0

    def __call__(self, *args, **kwargs):
        self.call_count += 1
        return self.func(*args, **kwargs)

    def __get__(self, obj, objtype=None):
        if obj is None:
            return self
        # Return a bound method: bind self.__call__ to the instance
        return types.MethodType(self, obj)

class Greeter:
    @CountCalls
    def greet(self, name: str) -> str:
        return f"Hello, {name}!"

g = Greeter()
print(g.greet("Alice"))   # Hello, Alice!
print(g.greet("Bob"))     # Hello, Bob!
```

### `@dataclass` — A Decorator Deep Dive

`@dataclass` is one of Python's most powerful standard decorators. It inspects class annotations and generates methods:

```python
# run: python3 dataclass_deepdive.py
from dataclasses import dataclass, field, fields

@dataclass(frozen=True, slots=True)   # slots=True added in 3.10
class Point:
    x: float
    y: float
    label: str = "origin"
    tags: list[str] = field(default_factory=list)  # mutable default done right

p = Point(1.0, 2.0, tags=["important"])
print(p)                    # Point(x=1.0, y=2.0, label='origin', tags=['important'])
print(repr(p))              # same
print(p == Point(1.0, 2.0)) # True (frozen implies eq)

# Inspect what @dataclass generated
for f in fields(p):
    print(f"  {f.name}: {f.type}, default={f.default!r}, default_factory={f.default_factory!r}")

# frozen=True: __setattr__ and __delattr__ raise FrozenInstanceError
try:
    p.x = 5.0   # type: ignore
except AttributeError as e:
    print(f"Cannot mutate: {e}")

# slots=True: __slots__ is generated, preventing __dict__
print(hasattr(p, "__dict__"))  # False
print(hasattr(p, "__slots__")) # True
```

**What `@dataclass` generates:** `__init__`, `__repr__`, `__eq__`. Optionally: `__hash__` (when `frozen=True` or `unsafe_hash=True`), `__lt__`/`__le__`/`__gt__`/`__ge__` (when `order=True`), `__slots__`, and `__match_args__` (3.10+, for structural pattern matching).

**`field(default_factory=list)`** solves the mutable default problem from [Functions as First-Class Objects](./01-functions-first-class.md). The factory is called per instance in the generated `__init__`, not once at class definition time.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Missing `functools.wraps` Breaks Debugging and Monitoring**
Symptom: stack traces, logging, and APM tools (Datadog, Sentry) show wrapper function names like `wrapper` or `inner` instead of the real function name. Monitoring dashboards group all decorated functions under one name, making alerts useless.
Diagnosis: check `func.__name__` on decorated functions. If it says `wrapper`, the decorator is missing `@functools.wraps(func)`. This also breaks `help(func)` since `__doc__` is lost.

**2. Decorator Order Causes Silent Logic Bugs**
Symptom: an authentication decorator is applied inside (below) a caching decorator. The cache stores the result of the first authenticated request and serves it to unauthenticated users. The stacking `@cache` then `@auth` means `cache(auth(handler))` — the cache wraps the auth check, so subsequent calls skip auth entirely.
Diagnosis: reason about stacking as function composition. `@A` above `@B` means `A(B(f))`. At call time, `A`'s wrapper runs first. Auth must be outermost (top) so it runs before cache is checked.

**3. `lru_cache` on Methods Leaks Instances**
Symptom: memory grows unboundedly. `@lru_cache` on a method captures `self` as part of the cache key. Since each instance is a different `self`, the cache grows with each instance, and the cache holds strong references to `self`, preventing garbage collection.
Diagnosis: check `method.cache_info()` — if `currsize` grows proportionally to instance count, you have this bug. Fix: cache the underlying computation in a module-level function or use a per-instance cache (e.g., `__init__` assigns `self.method = lru_cache(maxsize=128)(self._method_impl)`).
:::

## 🎯 Checkpoint

::: details Question 1 — Execution order
**Q:** Given these decorators:
```python
@A
@B
@C
def f(): ...
```
In what order are A, B, C applied? In what order do they execute when `f()` is called?

**A:** **Application order** (definition time): C first, then B, then A. This is equivalent to `f = A(B(C(f)))`. C directly wraps `f`, B wraps the result, A wraps the outermost layer. **Execution order** (call time): A's wrapper runs first (it is the outermost), then B's wrapper, then C's wrapper, then the original `f`. It is bottom-up application, top-down execution — exactly like nested function calls `A(B(C(f)))()`.
:::

::: details Question 2 — Why three levels for parameterized decorators?
**Q:** Why does `@repeat(3)` require three nested functions? What does each level do?

**A:** The three levels correspond to three phases:
1. **Decorator factory** (`repeat(n)`): called with the decorator's own arguments. Returns the actual decorator.
2. **Decorator** (`decorator(func)`): receives the function to be decorated. Returns the wrapper.
3. **Wrapper** (`wrapper(*args, **kwargs)`): runs on every call to the decorated function, adding the extra behavior.

When Python sees `@repeat(3)`, it first evaluates `repeat(3)`, which returns `decorator`. Then it applies `decorator` to the function, just like a plain `@decorator`. Without the outer level, there would be no way to pass configuration (`n=3`) to the decorator — the decorator receives exactly one argument (the function), so configuration must come from a closure in an enclosing scope.
:::

::: details Question 3 — `lru_cache` on methods
**Q:** Why does `@lru_cache` on an instance method cause memory leaks? How would you fix it?

**A:** `@lru_cache` uses the function's arguments as cache keys. For a method, the first argument is `self` — a different object for each instance. This means: (1) the cache never hits across instances (each `self` is unique), (2) the cache holds strong references to `self`, preventing the instance from being garbage collected even after all other references are dropped, and (3) `currsize` grows proportionally to the number of instances ever created. Fixes: (a) move the cacheable logic to a module-level function that takes only hashable data, not `self`; (b) use `__init__` to create a per-instance bound cached method: `self.expensive = lru_cache(maxsize=128)(self._expensive_impl)`; or (c) use a custom descriptor that stores the cache per-instance using weak references.
:::

## Key Mental Models

- **`@decorator` is reassignment** — `@dec def f` is exactly `f = dec(f)`, nothing more. The `@` syntax is convenience, not magic.
- **Always use `functools.wraps`** — without it, the wrapper erases the original function's identity, breaking debugging, documentation, and monitoring.
- **Bottom-up application, top-down execution** — decorators closer to the function are applied first but run last when the function is called.
- **Parameterized decorators need three levels** — factory returns decorator, decorator returns wrapper. Each level closes over the level above.
- **`@dataclass` is the poster child** — it inspects annotations at class creation time and generates methods, demonstrating that decorators can do arbitrary metaprogramming, not just wrap calls.

## Related

- [Functions as First-Class Objects](./01-functions-first-class.md) — decorators are higher-order functions; understanding `__call__` and closures is prerequisite.
- [LEGB Scoping & Closures](./02-scoping-closures.md) — decorator wrappers are closures over the original function.
- [Functional Programming Tools](./04-functional-tools.md) — `functools.lru_cache`, `functools.cache`, and `functools.partial` are themselves decorators or decorator-like tools.
