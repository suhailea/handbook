---
title: Classes & Instances
outline: deep
---

# Classes & Instances

Interview weight: 🔥🔥🔥 | Python 3.12+ | Prerequisites: [Functions & Scoping](/python/module-03/)

## 🗣️ In Plain English

::: tip In Plain English
A class is a cookie cutter. An instance is a cookie.

The cutter defines the shape — how many points on the star, how deep the edges are. But the cutter itself is not a cookie; you press it into dough and out comes a cookie. Each cookie can have different frosting, different sprinkles, different colors — those are **instance attributes**, unique to each cookie.

Now, the cutter itself can carry properties too. Maybe it has a label on its handle that says "star-shaped" or a serial number from the factory. Every cookie made from that cutter shares those properties — you don't stamp the serial number into each cookie, but if someone asks "what cutter made you?", any cookie can point back and read the label. Those are **class attributes** — they live on the cutter, not on the cookie, but any cookie can see them.

When you ask a cookie "what's your frosting?", it checks itself first. If it has frosting, that's your answer. If not, it looks at the cutter's label. If the cutter doesn't know either, it looks at the cutter's parent design (inheritance). This is the **lookup chain** — check yourself, then check the template that made you, then check the template's parents.

There's a subtle trap: if the cutter has a label that says "toppings: [sprinkles]", and one cookie reaches up and *appends* to that list instead of creating its own, *every* cookie now sees "toppings: [sprinkles, chocolate chips]". The cookie mutated the cutter's label, not its own frosting. This is the **shared-mutable class attribute trap** — one of the most common bugs in Python.

Finally, Python has two steps when baking cookies. First, the factory forms the raw dough into the right shape (`__new__`). Then a decorator adds frosting and toppings (`__init__`). Almost always you only care about the decoration step, but when you need to control the *shape* of the dough itself — say, to guarantee only one cookie ever exists — you override the factory step.
:::

## ⚙️ Under the Hood

### How `class` Creates a Type Object

A `class` statement is syntactic sugar. At runtime, Python calls `type(name, bases, namespace)` to produce a new class object:

```python
# run: python3 class_creation.py

# These two are equivalent:

# 1. Normal class statement
class Dog:
    species = "Canis familiaris"

    def bark(self) -> str:
        return "Woof!"

# 2. Manual type() call
def bark(self) -> str:
    return "Woof!"

DogManual = type("DogManual", (), {"species": "Canis familiaris", "bark": bark})

# Proof they work the same way
d1 = Dog()
d2 = DogManual()
print(type(Dog))        # <class 'type'>
print(type(DogManual))  # <class 'type'>
print(d1.bark())        # Woof!
print(d2.bark())        # Woof!
print(d1.species)       # Canis familiaris
```

Key insight: a class **is** an object — an instance of `type`. Classes are first-class values; you can pass them to functions, store them in lists, and create them dynamically.

### `__new__` vs `__init__`: Construction vs Initialization

`__new__` **creates** the object (allocates memory, returns the instance). `__init__` **initializes** it (sets attributes on the already-created instance). Almost all user code only needs `__init__`.

```python
# run: python3 new_vs_init.py

class Verbose:
    def __new__(cls, *args: object, **kwargs: object) -> "Verbose":
        print(f"__new__ called — cls is {cls}")
        instance = super().__new__(cls)
        print(f"__new__ returning {instance!r}")
        return instance

    def __init__(self, name: str) -> None:
        print(f"__init__ called — self is {self!r}, name={name}")
        self.name = name

v = Verbose("Alice")
# Output:
# __new__ called — cls is <class '__main__.Verbose'>
# __new__ returning <__main__.Verbose object at 0x...>
# __init__ called — self is <__main__.Verbose object at 0x...>, name=Alice
```

**Singleton via `__new__`:** the classic use case for overriding `__new__`:

```python
# run: python3 singleton.py

class Singleton:
    _instance: "Singleton | None" = None

    def __new__(cls) -> "Singleton":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self) -> None:
        # This runs every time Singleton() is called,
        # even though __new__ returns the same object.
        pass

a = Singleton()
b = Singleton()
print(a is b)  # True
print(id(a) == id(b))  # True
```

Note: `__init__` is called every time, even when `__new__` returns an existing instance. If re-initialization is harmful, guard against it inside `__init__` or skip `__init__` entirely.

### Instance Attribute Lookup Chain

When you write `obj.x`, Python follows this order:

1. **Data descriptors** on `type(obj)` and its MRO (descriptors that define `__set__` or `__delete__`)
2. **`obj.__dict__`** — the instance's own namespace
3. **Non-data descriptors and other attributes** on `type(obj)` and its MRO
4. If nothing found, `__getattr__` (if defined)
5. Raise `AttributeError`

```python
# run: python3 lookup_chain.py

class Machine:
    voltage = 220  # class attribute

m = Machine()
print(m.voltage)          # 220 — found on class (step 3)
print("voltage" in m.__dict__)  # False — not on instance

m.voltage = 110           # creates an instance attribute
print(m.voltage)          # 110 — found on instance (step 2)
print(Machine.voltage)    # 220 — class attribute unchanged

del m.voltage             # removes instance attribute
print(m.voltage)          # 220 — falls back to class again
```

### The Shared-Mutable Class Attribute Trap

```python
# run: python3 shared_mutable_trap.py

class Team:
    members: list[str] = []  # DANGER: shared mutable class attribute

t1 = Team()
t2 = Team()
t1.members.append("Alice")

print(t2.members)  # ['Alice'] — t2 sees t1's modification!
print(t1.members is t2.members)  # True — same list object

# The fix: initialize mutable attributes in __init__
class TeamFixed:
    def __init__(self) -> None:
        self.members: list[str] = []  # each instance gets its own list

f1 = TeamFixed()
f2 = TeamFixed()
f1.members.append("Alice")
print(f2.members)  # [] — isolated
```

Why it happens: `t1.members.append(...)` does *not* assign to `t1.members`. It looks up `members` (finds the class attribute), then mutates the list in place. No instance attribute is created because there is no assignment to `t1.members`.

### `@classmethod` and `@staticmethod`

```python
# run: python3 class_static_methods.py
from __future__ import annotations
import json


class User:
    _count: int = 0

    def __init__(self, name: str, age: int) -> None:
        self.name = name
        self.age = age
        User._count += 1

    @classmethod
    def from_json(cls, data: str) -> User:
        """Alternative constructor — receives cls, not self."""
        parsed = json.loads(data)
        return cls(parsed["name"], parsed["age"])

    @classmethod
    def total_created(cls) -> int:
        return cls._count

    @staticmethod
    def validate_age(age: int) -> bool:
        """No implicit first arg — just a namespaced utility."""
        return 0 < age < 150


u = User.from_json('{"name": "Bob", "age": 30}')
print(u.name, u.age)          # Bob 30
print(User.total_created())   # 1
print(User.validate_age(200)) # False
```

`@classmethod` receives `cls` (the class itself), making it the standard way to write alternative constructors. `@staticmethod` has no implicit argument — it's a plain function that lives on the class for organizational purposes. Both are implemented via the descriptor protocol (covered in [Descriptors & Properties](./03-descriptors-properties)).

### Essential Dunders

#### `__repr__` vs `__str__`

```python
# run: python3 repr_str.py
from datetime import datetime


class Event:
    def __init__(self, name: str, when: datetime) -> None:
        self.name = name
        self.when = when

    def __repr__(self) -> str:
        """Unambiguous, for developers. Should ideally be valid Python."""
        return f"Event(name={self.name!r}, when={self.when!r})"

    def __str__(self) -> str:
        """Human-readable, for end users."""
        return f"{self.name} on {self.when:%Y-%m-%d}"


e = Event("Launch", datetime(2026, 1, 15))
print(repr(e))  # Event(name='Launch', when=datetime.datetime(2026, 1, 15, 0, 0))
print(str(e))   # Launch on 2026-01-15
print(e)        # Launch on 2026-01-15  (print calls __str__)
print([e])      # [Event(name='Launch', ...)]  (containers use __repr__)
```

Rule of thumb: always implement `__repr__`. Implement `__str__` only when you need a different human-friendly form.

#### `__eq__` and `__hash__`

```python
# run: python3 eq_hash.py

class Point:
    def __init__(self, x: int, y: int) -> None:
        self.x = x
        self.y = y

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Point):
            return NotImplemented
        return self.x == other.x and self.y == other.y


p1 = Point(1, 2)
p2 = Point(1, 2)
print(p1 == p2)  # True

# But now:
try:
    s = {p1, p2}  # TypeError!
except TypeError as e:
    print(f"Cannot hash: {e}")

print(Point.__hash__)  # None — Python set __hash__ to None when we defined __eq__!
```

**Why?** Objects that compare equal *must* have equal hashes. If you define custom `__eq__` without matching `__hash__`, Python defensively sets `__hash__ = None` to prevent silent bugs in sets and dicts.

Fix: define `__hash__` consistently with `__eq__`:

```python
# run: python3 eq_hash_fixed.py

class Point:
    def __init__(self, x: int, y: int) -> None:
        self.x = x
        self.y = y

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Point):
            return NotImplemented
        return self.x == other.x and self.y == other.y

    def __hash__(self) -> int:
        return hash((self.x, self.y))


p1 = Point(1, 2)
p2 = Point(1, 2)
print({p1, p2})  # {Point...} — only one element, since p1 == p2 and same hash
print(len({p1, p2}))  # 1
```

#### Comparison Dunders with `@functools.total_ordering`

```python
# run: python3 total_ordering.py
import functools


@functools.total_ordering
class Temperature:
    def __init__(self, celsius: float) -> None:
        self.celsius = celsius

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Temperature):
            return NotImplemented
        return self.celsius == other.celsius

    def __lt__(self, other: "Temperature") -> bool:
        if not isinstance(other, Temperature):
            return NotImplemented
        return self.celsius < other.celsius

    def __repr__(self) -> str:
        return f"Temperature({self.celsius})"


t1 = Temperature(20)
t2 = Temperature(30)
print(t1 < t2)   # True  — we defined this
print(t1 <= t2)  # True  — auto-derived by total_ordering
print(t1 > t2)   # False — auto-derived
print(t1 >= t2)  # False — auto-derived
```

`@total_ordering` derives the remaining comparison methods from `__eq__` and one of `__lt__`, `__le__`, `__gt__`, or `__ge__`. Minor performance cost (each derived call routes through the ones you wrote), but saves significant boilerplate.

### Dataclasses

`@dataclass` auto-generates `__init__`, `__repr__`, `__eq__`, and optionally `__hash__`, ordering, and more:

```python
# run: python3 dataclass_demo.py
from dataclasses import dataclass, field
from typing import ClassVar


@dataclass(frozen=True, slots=True)  # slots=True requires Python 3.10+
class Config:
    host: str
    port: int = 8080
    tags: tuple[str, ...] = ()
    _registry: ClassVar[list["Config"]] = []

    def __post_init__(self) -> None:
        # Runs after auto-generated __init__.
        # frozen=True means we can't do self.x = ..., but we can call class methods.
        Config._registry.append(self)


c1 = Config(host="localhost")
c2 = Config(host="localhost", port=8080)
print(c1)           # Config(host='localhost', port=8080, tags=())
print(c1 == c2)     # True  — auto __eq__ compares fields
print(hash(c1))     # Works because frozen=True auto-generates __hash__

# Mutable default fields must use field(default_factory=...)
@dataclass
class Job:
    name: str
    retries: list[float] = field(default_factory=list)
    _internal_id: int = field(init=False, repr=False, default=0)

    def __post_init__(self) -> None:
        import random
        object.__setattr__(self, "_internal_id", random.randint(1, 10000))


j = Job(name="send_email")
print(j)  # Job(name='send_email', retries=[])
```

Key `@dataclass` parameters:

| Parameter | Default | Effect |
|-----------|---------|--------|
| `init` | `True` | Generate `__init__` |
| `repr` | `True` | Generate `__repr__` |
| `eq` | `True` | Generate `__eq__` (and set `__hash__` to `None` if `frozen=False`) |
| `order` | `False` | Generate `__lt__`, `__le__`, `__gt__`, `__ge__` |
| `frozen` | `False` | Make instances immutable; also generates `__hash__` |
| `slots` | `False` | Generate `__slots__` (3.10+) |
| `kw_only` | `False` | All fields keyword-only (3.10+) |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. The shared mutable class attribute in config objects.**
You define a `Pipeline` class with `steps: list[Step] = []` as a class attribute. In production, every pipeline instance shares the same list. Pipeline A appends a step; Pipeline B now has it too. The symptom: data from unrelated requests leaks between them. In a web framework like Django or FastAPI, this manifests as users seeing each other's data. Fix: always initialize mutable attributes in `__init__`.

**2. `__eq__` without `__hash__` breaks caching and deduplication.**
You define a custom `__eq__` on your domain model. Everything works in tests. In production, you try to put instances in a set for deduplication, or use them as dict keys for caching. `TypeError: unhashable type`. The error doesn't surface until the code path that uses sets/dicts is exercised, which may be a rare branch. Fix: always define `__hash__` alongside `__eq__`, or use `@dataclass(frozen=True)` which handles both.

**3. `__init__` still runs on singleton `__new__`.**
You implement the singleton pattern via `__new__`. The first call works perfectly. But every subsequent call to `MySingleton(config=new_config)` re-runs `__init__`, silently overwriting the singleton's state. In a long-running service, this means the singleton's configuration drifts whenever a new module imports and "creates" it. Fix: guard `__init__` with a flag, or use a module-level instance instead of the singleton pattern.
:::

## 🎯 Checkpoint

::: details Question 1 — Why does Python set `__hash__` to `None` when you define `__eq__`?
**Q:** If you define `__eq__` on a class but not `__hash__`, why does Python make instances unhashable instead of using the default id-based hash?

**A:** The invariant that Python (and any hash-based container) depends on is: **if `a == b`, then `hash(a) == hash(b)`**. The default `__hash__` is based on `id()`, so two distinct objects with the same logical value would have equal `__eq__` but different hashes, violating the invariant. Rather than let you silently produce corrupt dicts and sets, Python defensively sets `__hash__ = None`, making the class unhashable and forcing you to explicitly decide on a consistent hash function.
:::

::: details Question 2 — `__new__` returning a different type
**Q:** What happens if `__new__` returns an instance of a *different* class — say, `Foo.__new__` returns a `Bar` instance? Does `__init__` run?

**A:** If `__new__` returns an object that is *not* an instance of the class being constructed, Python **skips `__init__` entirely**. The rule is: `type.__call__` calls `cls.__new__(cls, ...)`, and then only calls `cls.__init__(instance, ...)` if `isinstance(instance, cls)` is true. This is how patterns like `__new__` returning a cached instance of a *subclass* can work, but it also means returning an unrelated type silently produces an uninitialized object.
:::

::: details Question 3 — Class attribute shadowing
**Q:** Given `class C: x = [1, 2, 3]`, explain the difference between `instance.x.append(4)` and `instance.x = [1, 2, 3, 4]`. Why does one affect other instances and the other doesn't?

**A:** `instance.x.append(4)`: Python looks up `x` on the instance, doesn't find it in `instance.__dict__`, falls back to `C.__dict__['x']` (the class attribute), and calls `.append(4)` on that shared list. No assignment to `instance.x` occurs, so no instance attribute is created. All instances see the mutation. `instance.x = [1, 2, 3, 4]`: this is an assignment, which *always* writes to `instance.__dict__`, creating a new instance attribute `x` that shadows the class attribute. Other instances are unaffected — they still see `C.x`.
:::

## Key Mental Models

- **A class is an object** — an instance of `type`, created at runtime, stored in a variable, and modifiable like any object.
- **`__new__` creates, `__init__` decorates** — nearly all user code only needs `__init__`; reach for `__new__` only when you need to control *which object* is returned (singletons, caching, immutable types).
- **Assignment creates instance attributes; mutation follows the lookup chain** — `self.x = ...` always writes to `instance.__dict__`, but `self.x.mutate()` may modify a class attribute if `x` isn't in the instance dict.
- **`__eq__` and `__hash__` are a contract** — define them together or accept unhashability.
- **Dataclasses are the default choice for data-carrying classes** — reach for manual `__init__`/`__repr__`/`__eq__` only when you need behavior dataclasses can't express.

## Related

- [The Descriptor Protocol & Properties](./03-descriptors-properties) — how `@classmethod` and `@staticmethod` actually work at the descriptor level
- [Inheritance & MRO](./02-inheritance-mro) — what happens when the lookup chain involves multiple parent classes
- [Metaclasses & `__slots__`](./04-metaclasses-slots) — controlling class creation itself and eliminating per-instance `__dict__`
- [Functions & Scoping](/python/module-03/) — closures and decorators, prerequisites for understanding method wrappers
