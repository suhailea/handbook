---
title: Inheritance & MRO (C3 Linearization)
outline: deep
---

# Inheritance & MRO (C3 Linearization)

Interview weight: 🔥🔥 | Python 3.12+ | Prerequisites: [Classes & Instances](./01-classes-instances)

## 🗣️ In Plain English

::: tip In Plain English
Inheritance is like family recipes passed down through generations.

Your grandmother has a recipe for tomato sauce. Your mother inherits that recipe but adds garlic and basil. You inherit your mother's version and add chili flakes. When someone asks for your tomato sauce recipe, you look at your own notes first. If they're blank on a step, you check your mother's version. If hers is blank too, you go back to grandma's. That's **single inheritance** — a straight line of lookup.

Now imagine you have *two* parents who both cook. Your father has his own tomato sauce recipe. When someone asks you how to make tomato sauce, whose recipe wins — your mother's or your father's? You can't just flip a coin. Python has a formal rule called **C3 linearization** — think of it as a family council that sits down and produces a single, definitive ordering of whose recipe to check first, second, third. The ordering has to respect two constraints: children before parents, and if your mother listed her parents in a certain order, the council respects that order too. The result is called the **MRO** — the Method Resolution Order — and every class has one.

Here's the part that surprises people: `super()` does *not* mean "call my parent." It means "call the **next** class in the MRO." In a single-inheritance chain, the next class happens to be the parent, so it looks the same. But with multiple inheritance, `super()` might call a *sibling* class that you didn't directly inherit from. That's why **cooperative** multiple inheritance requires *every* class in the chain to call `super()` — if one class skips it, the chain breaks and some class's recipe never gets consulted.

Finally, not everything should be inheritance. If a car *has* an engine, don't make Car a subclass of Engine. That's **composition** — your object holds a reference to another object rather than becoming a subtype of it. A good rule: use inheritance for "is-a" relationships (a Dog *is* an Animal) and composition for "has-a" relationships (a Car *has* an Engine).
:::

## ⚙️ Under the Hood

### Single Inheritance and `super()`

```python
# run: python3 single_inheritance.py

class Animal:
    def __init__(self, name: str) -> None:
        self.name = name

    def speak(self) -> str:
        return f"{self.name} makes a sound"


class Dog(Animal):
    def __init__(self, name: str, breed: str) -> None:
        super().__init__(name)  # delegates to Animal.__init__
        self.breed = breed

    def speak(self) -> str:
        return f"{self.name} barks"


d = Dog("Rex", "Shepherd")
print(d.speak())    # Rex barks
print(d.name)       # Rex — set by Animal.__init__ via super()
print(Dog.__mro__)  # (<class 'Dog'>, <class 'Animal'>, <class 'object'>)
```

`super()` in Python 3 is magic-free shorthand: inside a method, `super()` is equivalent to `super(CurrentClass, self)`. It returns a **proxy object** that delegates attribute lookups to the next class in the MRO of `type(self)`, not necessarily the direct parent.

### Multiple Inheritance and the Diamond Problem

```python
# run: python3 diamond.py

class A:
    def greet(self) -> str:
        return "Hello from A"

class B(A):
    def greet(self) -> str:
        return "Hello from B"

class C(A):
    def greet(self) -> str:
        return "Hello from C"

class D(B, C):
    pass


d = D()
print(d.greet())    # Hello from B — B comes before C in D's MRO
print(D.__mro__)
# (<class 'D'>, <class 'B'>, <class 'C'>, <class 'A'>, <class 'object'>)
```

This is the **diamond problem**: `D` inherits from both `B` and `C`, which both inherit from `A`. Without a linearization rule, `d.greet()` would be ambiguous. C3 resolves it.

### C3 Linearization: Step by Step

The algorithm computes `L[C]` (the linearization of class `C`) recursively:

```
L[C] = C + merge(L[B1], L[B2], ..., [B1, B2, ...])
```

where `B1, B2, ...` are `C`'s bases in declaration order.

**`merge` rule:** take the first head of any list that does not appear in the tail of any other list. Remove it from all lists. Repeat until empty. If no valid head exists, the hierarchy is illegal and Python raises `TypeError`.

Let's trace `D(B, C)` where `B(A)` and `C(A)`:

```
L[A] = [A, object]
L[B] = [B] + merge([A, object], [A]) = [B, A, object]
L[C] = [C] + merge([A, object], [A]) = [C, A, object]
L[D] = [D] + merge([B, A, object], [C, A, object], [B, C])
```

Step 1: Head of first list = `B`. Is `B` in the tail of any list? Tails are `[A, object]`, `[A, object]`, `[C]` — no. Take `B`. Remove `B` from all lists:
```
merge([A, object], [C, A, object], [C])
```

Step 2: Head = `A`. Is `A` in the tail of any list? `[C, A, object]` has `A` in its tail. Skip. Try next list head: `C`. Is `C` in any tail? No. Take `C`:
```
merge([A, object], [A, object])
```

Step 3: Head = `A`. Not in any tail. Take `A`:
```
merge([object], [object])
```

Step 4: Take `object`. Done.

**Result:** `L[D] = [D, B, C, A, object]`

```python
# run: python3 c3_trace.py

class A: pass
class B(A): pass
class C(A): pass
class D(B, C): pass

# Confirm our manual trace:
print([cls.__name__ for cls in D.__mro__])
# ['D', 'B', 'C', 'A', 'object']
```

**Illegal hierarchies** — C3 rejects inconsistent orderings:

```python
# run: python3 c3_illegal.py

class X: pass
class Y: pass
class A(X, Y): pass
class B(Y, X): pass

try:
    class C(A, B): pass  # A says X before Y, B says Y before X — contradiction
except TypeError as e:
    print(f"TypeError: {e}")
    # Cannot create a consistent method resolution order
```

### `super()` is NOT "Call Parent"

```python
# run: python3 super_mro.py

class Base:
    def setup(self) -> None:
        print("Base.setup")

class Left(Base):
    def setup(self) -> None:
        print("Left.setup")
        super().setup()  # Next in MRO, NOT necessarily Base

class Right(Base):
    def setup(self) -> None:
        print("Right.setup")
        super().setup()

class Child(Left, Right):
    def setup(self) -> None:
        print("Child.setup")
        super().setup()


print("MRO:", [c.__name__ for c in Child.__mro__])
# MRO: ['Child', 'Left', 'Right', 'Base', 'object']

Child().setup()
# Child.setup
# Left.setup
# Right.setup   <-- Left's super() called Right, not Base!
# Base.setup
```

`Left.super().setup()` calls `Right.setup()` because `Right` is next after `Left` in `Child`'s MRO. This is why `super()` must be understood as "next in MRO" not "my parent."

### Cooperative Multiple Inheritance

For the chain to work, **every class** must call `super()`, including classes that appear to be at the "top":

```python
# run: python3 cooperative.py

class Base:
    def __init__(self, **kwargs: object) -> None:
        # Absorb remaining kwargs — the chain ends here
        super().__init__()

class Serializable(Base):
    def __init__(self, **kwargs: object) -> None:
        self.format = kwargs.pop("format", "json")
        super().__init__(**kwargs)

class Timestamped(Base):
    def __init__(self, **kwargs: object) -> None:
        from datetime import datetime, timezone
        self.created_at = datetime.now(timezone.utc)
        super().__init__(**kwargs)

class Document(Serializable, Timestamped):
    def __init__(self, title: str, **kwargs: object) -> None:
        self.title = title
        super().__init__(**kwargs)


doc = Document(title="Design Doc", format="yaml")
print(doc.title)       # Design Doc
print(doc.format)      # yaml
print(doc.created_at)  # 2026-... UTC
print(Document.__mro__)
# Document -> Serializable -> Timestamped -> Base -> object
```

The `**kwargs` pattern is the standard approach for cooperative `__init__`: each class extracts the arguments it cares about and forwards the rest.

### Mixin Pattern

Mixins are small classes that add a single capability, designed to be composed with other classes via multiple inheritance:

```python
# run: python3 mixins.py
import json


class JsonMixin:
    """Adds JSON serialization to any class with a __dict__."""
    def to_json(self) -> str:
        return json.dumps(self.__dict__, default=str)

class ReprMixin:
    """Auto-generates __repr__ from __dict__."""
    def __repr__(self) -> str:
        attrs = ", ".join(f"{k}={v!r}" for k, v in self.__dict__.items())
        return f"{type(self).__name__}({attrs})"

class User(JsonMixin, ReprMixin):
    def __init__(self, name: str, email: str) -> None:
        self.name = name
        self.email = email


u = User("Alice", "alice@example.com")
print(repr(u))     # User(name='Alice', email='alice@example.com')
print(u.to_json()) # {"name": "Alice", "email": "alice@example.com"}
```

Convention: mixins do not define `__init__` and add a single, well-defined behavior.

### Composition vs Inheritance

```python
# run: python3 composition.py

# BAD: Car "is-a" Engine? No.
class Engine:
    def start(self) -> str:
        return "Engine started"

# class Car(Engine): pass  # Don't do this

# GOOD: Car "has-a" Engine.
class Car:
    def __init__(self, engine: Engine) -> None:
        self._engine = engine

    def start(self) -> str:
        return self._engine.start()


car = Car(Engine())
print(car.start())  # Engine started
```

Prefer composition when: the relationship is "has-a", you want to swap implementations at runtime, or the parent's interface is too wide for the child.

### Abstract Base Classes

```python
# run: python3 abc_demo.py
from abc import ABC, abstractmethod


class Shape(ABC):
    @abstractmethod
    def area(self) -> float:
        """Subclasses MUST implement this."""
        ...

    @abstractmethod
    def perimeter(self) -> float:
        ...

    def describe(self) -> str:
        """Concrete method — inherited as-is."""
        return f"{type(self).__name__}: area={self.area():.2f}"


try:
    s = Shape()  # TypeError: Can't instantiate abstract class
except TypeError as e:
    print(e)


class Circle(Shape):
    def __init__(self, radius: float) -> None:
        self.radius = radius

    def area(self) -> float:
        from math import pi
        return pi * self.radius ** 2

    def perimeter(self) -> float:
        from math import pi
        return 2 * pi * self.radius


c = Circle(5)
print(c.describe())  # Circle: area=78.54
```

`ABC` is a convenience base that sets the metaclass to `ABCMeta`. `@abstractmethod` marks methods that subclasses must override — attempting to instantiate a class with unimplemented abstract methods raises `TypeError` at instantiation time, not at call time.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Broken cooperative chains.**
One class in a multiple-inheritance hierarchy forgets to call `super().__init__()`. Everything works in tests because that class is only tested in isolation. In production, a subclass combines it with another mixin, and the mixin's `__init__` never runs — attributes are silently missing, leading to `AttributeError` deep in request handling. Symptom: sporadic `AttributeError` on attributes that "should always exist." Fix: every `__init__` in a cooperative hierarchy must call `super().__init__()`.

**2. MRO surprises after refactoring.**
You rearrange base classes — changing `class Service(Auth, Logging)` to `class Service(Logging, Auth)` — and suddenly Auth's `process()` method is no longer called because Logging's version now comes first in the MRO and doesn't call `super()`. The behavior change is completely silent — no error, no warning, just different runtime behavior. Fix: always verify `ClassName.__mro__` after changing inheritance order, and ensure all methods in the chain are cooperative.

**3. Forgetting `@abstractmethod` means no safety net.**
You define a `BaseHandler` with methods that subclasses should override, but you forget `@abstractmethod`. A developer creates a subclass without implementing the method. Python happily instantiates it. The base implementation (which might just raise `NotImplementedError` or return a dummy value) runs silently in production. Fix: use `ABC` and `@abstractmethod` for any method that must be overridden — you get a clear `TypeError` at instantiation rather than a subtle bug at runtime.
:::

## 🎯 Checkpoint

::: details Question 1 — MRO by hand
**Q:** Given the hierarchy `class A: pass`, `class B(A): pass`, `class C(A): pass`, `class D(B, C): pass`, `class E(C, B): pass` — what happens when you try to create `class F(D, E): pass`?

**A:** This raises `TypeError: Cannot create a consistent method resolution order`. `D`'s MRO puts `B` before `C`. `E`'s MRO puts `C` before `B`. `F(D, E)` would need to satisfy both orderings simultaneously, which is impossible — C3 linearization detects the contradiction and refuses to create the class. This happens at class *definition* time, not at instantiation.
:::

::: details Question 2 — `super()` in multiple inheritance
**Q:** Why does `super()` in `Left.setup()` call `Right.setup()` instead of `Base.setup()` when invoked through a `Child(Left, Right)` instance?

**A:** `super()` doesn't look at `Left`'s parent — it looks at the MRO of the *actual instance's type*, which is `Child`. `Child.__mro__` is `[Child, Left, Right, Base, object]`. When `Left.setup()` calls `super().setup()`, the proxy finds the next class after `Left` in this MRO, which is `Right`. This is why `super()` means "next in MRO" not "my parent." The MRO is determined by the *runtime type of the instance*, not by the class where `super()` is written.
:::

::: details Question 3 — Abstract method enforcement timing
**Q:** When does Python enforce that abstract methods are implemented — at class definition, at instantiation, or at method call time?

**A:** At **instantiation**. Python allows you to define a class that inherits from an ABC without implementing all abstract methods — the class itself is created successfully. But when you try to create an instance via `MyClass()`, `ABCMeta.__call__` checks for unimplemented abstract methods and raises `TypeError` listing them. This means you can define abstract subclasses (themselves intended for further subclassing) without error. The check is specifically in `type.__call__` (or `ABCMeta.__call__`) during object creation.
:::

## Key Mental Models

- **MRO is the single source of truth** — every attribute lookup and every `super()` call follows the same linearized order, computed once at class creation.
- **`super()` means "next in MRO," not "my parent"** — this is the most commonly misunderstood Python OOP concept.
- **Cooperative inheritance requires universal participation** — if any class in the chain skips `super()`, every class after it in the MRO is silently excluded.
- **C3 exists to prevent ambiguity, not to be clever** — it enforces two simple invariants: children before parents, and declaration order among siblings.
- **Composition over inheritance is not a slogan, it's a design heuristic** — use inheritance for type hierarchies ("is-a"), composition for capabilities ("has-a").

## Related

- [Classes & Instances](./01-classes-instances) — the attribute lookup chain that MRO plugs into
- [The Descriptor Protocol & Properties](./03-descriptors-properties) — how attribute access actually dispatches once the MRO identifies the right class
- [Metaclasses & `__slots__`](./04-metaclasses-slots) — `ABCMeta` is itself a metaclass; `__init_subclass__` as a simpler alternative
