---
title: The Descriptor Protocol & Properties
outline: deep
---

# The Descriptor Protocol & Properties

Interview weight: 🔥🔥 | Python 3.12+ | Prerequisites: [Classes & Instances](./01-classes-instances), [Inheritance & MRO](./02-inheritance-mro)

## 🗣️ In Plain English

::: tip In Plain English
A descriptor is like a smart mailbox.

A regular mailbox just holds whatever you put in it. You open the slot, drop in a letter, close it. Later you open the door, pull out the letter. No questions asked, no rules enforced. That's a normal attribute — you assign a value, you read a value, done.

A **smart mailbox** has rules. When you try to put something in, it might check: "Is this actually a letter? Is it the right size? Does the sender have permission?" It can reject invalid mail, transform it (flatten an envelope, add a timestamp), or log every delivery. When you try to read from it, it might compute something on the fly rather than just handing you what's stored — like showing you a summary of all letters received this week.

In Python, any object that defines the right "hooks" — methods named `__get__`, `__set__`, or `__delete__` — becomes a descriptor. When that object is placed as a **class** attribute, Python calls those hooks automatically whenever anyone accesses, assigns, or deletes the attribute on an instance.

The most common smart mailbox you've already used is `property()`. When you write `@property` on a method, you're wrapping that method inside a descriptor object that calls your function every time someone reads the attribute, and optionally calls a different function when they try to write to it.

But `property()` is just one descriptor. The mechanism is far more general. Django model fields, SQLAlchemy columns, and even `@classmethod` and `@staticmethod` are all descriptors. The protocol is the engine beneath a huge amount of Python's "magic" — and once you see the pattern, the magic vanishes and you just see a consistent, simple mechanism: place an object with the right hooks on a class, and Python calls those hooks instead of doing plain attribute access.
:::

## ⚙️ Under the Hood

### The Descriptor Protocol

A descriptor is any object that defines at least one of:

| Method | Signature | Called when |
|--------|-----------|------------|
| `__get__` | `(self, obj, objtype=None) -> value` | Reading `obj.attr` |
| `__set__` | `(self, obj, value) -> None` | Writing `obj.attr = value` |
| `__delete__` | `(self, obj) -> None` | Deleting `del obj.attr` |

The descriptor must be a **class attribute** — instances holding descriptors do not trigger the protocol.

### Data Descriptors vs Non-Data Descriptors

This distinction controls lookup priority:

| Type | Defines | Lookup priority |
|------|---------|----------------|
| **Data descriptor** | `__set__` and/or `__delete__` (with or without `__get__`) | **Higher** than `instance.__dict__` |
| **Non-data descriptor** | Only `__get__` | **Lower** than `instance.__dict__` |

The full attribute lookup order for `obj.x`:

1. **Data descriptors** on `type(obj).__mro__`
2. **`obj.__dict__['x']`** (instance dict)
3. **Non-data descriptors** on `type(obj).__mro__`
4. `__getattr__` (if defined)
5. Raise `AttributeError`

```python
# run: python3 descriptor_priority.py

class DataDesc:
    """Data descriptor — has __set__, so it wins over instance __dict__."""
    def __get__(self, obj: object, objtype: type | None = None) -> str:
        return "from data descriptor"

    def __set__(self, obj: object, value: object) -> None:
        print(f"DataDesc.__set__ intercepted: {value!r}")


class NonDataDesc:
    """Non-data descriptor — only __get__, so instance __dict__ wins."""
    def __get__(self, obj: object, objtype: type | None = None) -> str:
        return "from non-data descriptor"


class MyClass:
    data = DataDesc()
    nondata = NonDataDesc()


m = MyClass()

# Non-data descriptor: instance __dict__ wins
m.__dict__["nondata"] = "from instance"
print(m.nondata)  # "from instance" — instance dict beats non-data descriptor

# Data descriptor: descriptor wins even with instance dict entry
m.__dict__["data"] = "from instance"
print(m.data)  # "from data descriptor" — data descriptor beats instance dict
```

### How `property()` Works

`property` is a class that implements the full descriptor protocol. Here's a simplified reimplementation:

```python
# run: python3 property_impl.py
from typing import Any, Callable


class MyProperty:
    """Simplified reimplementation of the built-in property."""

    def __init__(
        self,
        fget: Callable[..., Any] | None = None,
        fset: Callable[..., None] | None = None,
        fdel: Callable[..., None] | None = None,
    ) -> None:
        self.fget = fget
        self.fset = fset
        self.fdel = fdel

    def __get__(self, obj: Any, objtype: type | None = None) -> Any:
        if obj is None:
            return self  # Accessed on the class, return the descriptor itself
        if self.fget is None:
            raise AttributeError("unreadable attribute")
        return self.fget(obj)

    def __set__(self, obj: Any, value: Any) -> None:
        if self.fset is None:
            raise AttributeError("can't set attribute")
        self.fset(obj, value)

    def __delete__(self, obj: Any) -> None:
        if self.fdel is None:
            raise AttributeError("can't delete attribute")
        self.fdel(obj)

    def setter(self, fset: Callable[..., None]) -> "MyProperty":
        return MyProperty(self.fget, fset, self.fdel)

    def deleter(self, fdel: Callable[..., None]) -> "MyProperty":
        return MyProperty(self.fget, self.fset, fdel)


# Usage — exactly like built-in property
class Circle:
    def __init__(self, radius: float) -> None:
        self._radius = radius

    @MyProperty
    def radius(self) -> float:
        return self._radius

    @radius.setter
    def radius(self, value: float) -> None:
        if value < 0:
            raise ValueError("Radius must be non-negative")
        self._radius = value


c = Circle(5)
print(c.radius)    # 5.0  — calls __get__ → fget
c.radius = 10      # calls __set__ → fset
print(c.radius)    # 10.0

try:
    c.radius = -1  # ValueError: Radius must be non-negative
except ValueError as e:
    print(e)
```

Note how `property` has `__set__`, making it a **data descriptor** — this is why `instance.__dict__['radius']` never shadows a property, even if you manually insert it.

### `property` as Decorator: The Standard Pattern

```python
# run: python3 property_decorator.py

class Account:
    def __init__(self, owner: str, balance: float = 0.0) -> None:
        self._owner = owner
        self._balance = balance

    @property
    def balance(self) -> float:
        """Read-only by default — no setter defined yet."""
        return self._balance

    @balance.setter
    def balance(self, value: float) -> None:
        if value < 0:
            raise ValueError("Balance cannot be negative")
        self._balance = value

    @balance.deleter
    def balance(self) -> None:
        print("Closing account")
        self._balance = 0.0

    @property
    def owner(self) -> str:
        """Truly read-only — no setter defined."""
        return self._owner


a = Account("Alice", 100.0)
print(a.balance)   # 100.0
a.balance = 200.0  # Works — setter is defined
print(a.balance)   # 200.0

try:
    a.owner = "Bob"  # AttributeError: property 'owner' has no setter
except AttributeError as e:
    print(e)

del a.balance      # "Closing account"
print(a.balance)   # 0.0
```

### Building Custom Descriptors: Validated Attributes

```python
# run: python3 validated_descriptor.py

class Validated:
    """Reusable descriptor for type-checked, range-checked attributes."""

    def __init__(self, expected_type: type, min_val: float | None = None, max_val: float | None = None) -> None:
        self.expected_type = expected_type
        self.min_val = min_val
        self.max_val = max_val
        self.attr_name = ""  # Filled in by __set_name__

    def __set_name__(self, owner: type, name: str) -> None:
        """Called automatically when the descriptor is assigned to a class attribute (3.6+)."""
        self.attr_name = f"_validated_{name}"

    def __get__(self, obj: object, objtype: type | None = None) -> object:
        if obj is None:
            return self
        return getattr(obj, self.attr_name, None)

    def __set__(self, obj: object, value: object) -> None:
        if not isinstance(value, self.expected_type):
            raise TypeError(f"{self.attr_name}: expected {self.expected_type.__name__}, got {type(value).__name__}")
        if self.min_val is not None and value < self.min_val:  # type: ignore[operator]
            raise ValueError(f"{self.attr_name}: {value} < minimum {self.min_val}")
        if self.max_val is not None and value > self.max_val:  # type: ignore[operator]
            raise ValueError(f"{self.attr_name}: {value} > maximum {self.max_val}")
        setattr(obj, self.attr_name, value)


class Product:
    name = Validated(str)
    price = Validated(float, min_val=0.0, max_val=10_000.0)
    quantity = Validated(int, min_val=0)

    def __init__(self, name: str, price: float, quantity: int) -> None:
        self.name = name        # Triggers Validated.__set__
        self.price = price
        self.quantity = quantity


p = Product("Widget", 9.99, 100)
print(p.name, p.price, p.quantity)  # Widget 9.99 100

try:
    p.price = -5.0  # ValueError
except ValueError as e:
    print(e)

try:
    p.quantity = "many"  # type: ignore  — TypeError
except TypeError as e:
    print(e)
```

### `__set_name__`: Descriptor Self-Awareness (3.6+)

Before Python 3.6, descriptors had no way to know which attribute name they were assigned to. You had to pass the name manually:

```python
# Old way (pre-3.6): name = Validated("name", str)
# New way (3.6+): name = Validated(str)  — __set_name__ handles it
```

`__set_name__(self, owner, name)` is called automatically by `type.__init__` when the class body is executed. `owner` is the class, `name` is the attribute name. This eliminates boilerplate and prevents name mismatches.

### How `@classmethod` and `@staticmethod` Work as Descriptors

Both are **non-data descriptors** (they only define `__get__`):

```python
# run: python3 classmethod_staticmethod_descriptors.py

class MyClassMethod:
    """Simplified classmethod — non-data descriptor."""
    def __init__(self, func: object) -> None:
        self.func = func

    def __get__(self, obj: object, objtype: type | None = None) -> object:
        if objtype is None:
            objtype = type(obj)
        import functools
        return functools.partial(self.func, objtype)  # type: ignore[arg-type]


class MyStaticMethod:
    """Simplified staticmethod — non-data descriptor."""
    def __init__(self, func: object) -> None:
        self.func = func

    def __get__(self, obj: object, objtype: type | None = None) -> object:
        return self.func  # Return the raw function, no binding


class Demo:
    @MyClassMethod
    def cm(cls) -> str:  # type: ignore[misc]
        return f"classmethod called on {cls.__name__}"

    @MyStaticMethod
    def sm() -> str:  # type: ignore[misc]
        return "staticmethod called"


print(Demo.cm())       # classmethod called on Demo
print(Demo().cm())     # classmethod called on Demo
print(Demo.sm())       # staticmethod called
print(Demo().sm())     # staticmethod called
```

`classmethod.__get__` binds the first argument to `cls`. `staticmethod.__get__` returns the raw function with no binding. Because they're non-data descriptors (no `__set__`), you *could* technically shadow them on an instance via `instance.__dict__`, though doing so would be bizarre.

### Regular Methods Are Non-Data Descriptors Too

Functions define `__get__`, which binds `self`:

```python
# run: python3 function_descriptor.py

class Greeter:
    def hello(self) -> str:
        return "hello"


# Accessing via the class gives the raw function:
print(type(Greeter.__dict__["hello"]))  # <class 'function'>

# Accessing via an instance triggers function.__get__, which returns a bound method:
g = Greeter()
print(type(g.hello))  # <class 'method'>

# The bound method has self baked in:
method = g.hello
print(method.__self__ is g)  # True
print(method.__func__ is Greeter.__dict__["hello"])  # True
```

### Descriptors in the Wild

| Library | Descriptor | Purpose |
|---------|-----------|---------|
| **Django ORM** | `Field` subclasses (`CharField`, `IntegerField`) | Define model schema, validate on assignment, map to SQL columns |
| **SQLAlchemy** | `InstrumentedAttribute` | Track attribute changes for unit-of-work pattern, lazy loading |
| **stdlib** | `functools.cached_property` (3.8+) | Non-data descriptor that computes once, then stores result in instance `__dict__` (which then shadows it) |

```python
# run: python3 cached_property_demo.py
from functools import cached_property
import time


class Report:
    def __init__(self, data: list[int]) -> None:
        self.data = data

    @cached_property
    def summary(self) -> dict[str, float]:
        """Expensive computation — runs once, cached in instance __dict__."""
        print("Computing summary...")
        time.sleep(0.1)  # Simulate work
        return {
            "mean": sum(self.data) / len(self.data),
            "total": float(sum(self.data)),
        }


r = Report([1, 2, 3, 4, 5])
print(r.summary)  # "Computing summary..." then {'mean': 3.0, 'total': 15.0}
print(r.summary)  # No "Computing..." — served from instance __dict__

# Why it works: cached_property is a NON-data descriptor.
# After first access, it stores the result in instance.__dict__["summary"].
# On subsequent access, instance.__dict__ wins over the non-data descriptor.
print("summary" in r.__dict__)  # True
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. `cached_property` in multi-threaded code (pre-3.12).**
Before Python 3.12, `cached_property` was not thread-safe. Two threads could simultaneously find the instance dict empty, both compute the value, and both write to the dict. If the computation has side effects (database queries, file I/O), it runs twice. In 3.12+, `cached_property` uses a per-instance lock. For earlier versions, protect with your own lock or use `threading.Lock` in a custom descriptor. Symptom: duplicate database writes, double-counted metrics, or (rarely) a corrupted return value if the cached object itself isn't thread-safe.

**2. Forgetting that `property` makes `__dict__` writes invisible.**
A developer stores data via `obj.__dict__['x'] = value` to "bypass" a property. On read, the property's `__get__` always fires because `property` is a data descriptor and takes priority over instance `__dict__`. The stored value is silently ignored. Symptom: values appear to vanish — you set them but reads return something different. Fix: never manually write to `__dict__` for attributes managed by data descriptors.

**3. Descriptor not on the class.**
A newcomer creates a descriptor instance as an *instance attribute* in `__init__` — `self.validated = Validated(int)`. The descriptor protocol is never triggered because Python only invokes it for class-level attributes. All the validation logic is silently skipped. Symptom: invalid data passes through without any error. Fix: descriptors must be defined at the class level, not in `__init__`.
:::

## 🎯 Checkpoint

::: details Question 1 — Data vs non-data descriptor priority
**Q:** If a class has a non-data descriptor `x` (only `__get__`) and an instance also has `x` in its `__dict__`, which wins when you access `instance.x`? What if the descriptor also defines `__set__`?

**A:** With only `__get__` (non-data descriptor): **instance `__dict__` wins**. The lookup order puts instance `__dict__` above non-data descriptors. This is exactly how `cached_property` works — it stores the result in instance `__dict__` to shadow itself. With `__set__` added (now a data descriptor): **the descriptor wins**. Data descriptors have higher priority than instance `__dict__`. This is how `property` prevents instance dict entries from shadowing it.
:::

::: details Question 2 — Why are functions non-data descriptors?
**Q:** Regular functions define `__get__` but not `__set__`. Why was this design choice made, and what would break if functions were data descriptors?

**A:** Functions are non-data descriptors so that you can shadow a method on a specific instance: `obj.method = lambda: "custom"`. This is used in testing (monkey-patching) and in patterns where instances override behavior. If functions were data descriptors, the class method would always take priority over any instance-level override, and you'd need to modify the class itself to change behavior — which affects all instances. The non-data descriptor design gives instances the final say.
:::

::: details Question 3 — `__set_name__` timing
**Q:** When exactly is `__set_name__` called, and what happens if you dynamically add a descriptor to a class after class creation?

**A:** `__set_name__` is called by `type.__init__` during class creation — specifically, after the class body has been executed and the namespace dict is being processed into the new class. If you dynamically add a descriptor to an existing class (`MyClass.x = Validated(int)`), `__set_name__` is **not called automatically**. You must call it manually: `Validated.__set_name__(MyClass.x, MyClass, 'x')` (or more practically, use `MyClass.x.__set_name__(MyClass, 'x')`). Forgetting this means the descriptor's `attr_name` is unset, typically causing bugs in storage or error messages.
:::

## Key Mental Models

- **Descriptors are the engine beneath Python's attribute access** — `property`, `classmethod`, `staticmethod`, bound methods, and ORM fields all use the same three-method protocol.
- **Data descriptors outrank instance `__dict__`; non-data descriptors don't** — this single rule explains why `property` can't be shadowed but `cached_property` can.
- **`property` is a data descriptor because it defines `__set__`** — even a read-only property (no setter) has `__set__` that raises `AttributeError`, which is enough to claim data-descriptor priority.
- **`__set_name__` eliminated the biggest descriptor ergonomics problem** — before 3.6, every descriptor needed the attribute name passed in manually.
- **If the descriptor isn't on the class, the protocol doesn't fire** — this is the most common descriptor bug for beginners.

## Related

- [Classes & Instances](./01-classes-instances) — the attribute lookup chain that descriptors plug into
- [Inheritance & MRO](./02-inheritance-mro) — the MRO determines which class's descriptor is found first
- [Metaclasses & `__slots__`](./04-metaclasses-slots) — metaclasses can inject descriptors during class creation
