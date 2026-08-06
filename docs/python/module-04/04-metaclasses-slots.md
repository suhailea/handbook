---
title: Metaclasses & __slots__
outline: deep
---

# Metaclasses & `__slots__`

Interview weight: 🔥🔥 | Python 3.12+ | Prerequisites: [Classes & Instances](./01-classes-instances), [The Descriptor Protocol](./03-descriptors-properties)

## 🗣️ In Plain English

::: tip In Plain English
If a class is a cookie cutter and instances are cookies, then a metaclass is the **machine that manufactures cookie cutters**.

Most of the time, you don't build your own machine. The factory default — called `type` — works perfectly well. You hand it a design (your class body), and it stamps out a cookie cutter (your class object). Every class you've ever written was manufactured by this default machine.

But what if you wanted every cookie cutter to automatically come with a serial number? Or to register itself in a catalog the moment it's created? Or to reject any design that doesn't include a specific safety feature? You'd need to modify the machine itself — that's a **custom metaclass**. You're not changing what the cookies look like; you're changing what happens when a new cutter is manufactured.

Here's the thing: building a custom manufacturing machine is complicated. Most of the time, you don't need one. Python 3.6 introduced a much simpler hook called `__init_subclass__` — think of it as a small attachment you bolt onto an *existing* cutter. Every new cutter modeled after yours automatically passes through this attachment. It can stamp the serial number, register in the catalog, or check for safety features — all without building a whole new machine. For the vast majority of use cases, this attachment is all you need.

Now, separately, there's `__slots__`. Every cookie normally comes with a little pouch sewn on (its `__dict__`), letting you stick any number of extra decorations on it later. That pouch is flexible but takes up space. If you're making ten million cookies and you know each one will only ever have exactly three attributes, you can tell the cutter to skip the pouch and instead create exactly three fixed pockets. No pouch means less material per cookie — that's `__slots__`. The trade-off: you can't add surprise decorations later, because there's no pouch to put them in.
:::

## ⚙️ Under the Hood

### `type` as the Default Metaclass

Every class is an instance of its metaclass. The default metaclass is `type`:

```python
# run: python3 type_metaclass.py

class Dog:
    pass

print(type(Dog))       # <class 'type'> — Dog is an instance of type
print(type(type))      # <class 'type'> — type is its own metaclass
print(isinstance(Dog, type))  # True

# Creating a class manually with type():
Cat = type("Cat", (), {"sound": "meow"})
print(Cat.sound)       # meow
print(type(Cat))       # <class 'type'>
```

The relationship: `type` is to classes what classes are to instances. `Dog()` creates an instance of `Dog`. `type("Dog", (), {...})` creates an instance of `type` — which is a class.

### The Class Creation Protocol

When Python encounters a `class` statement, it follows this sequence:

1. **`metaclass.__prepare__(name, bases, **kwargs)`** — returns the namespace dict (usually a regular `dict`, but can be `OrderedDict` or custom mapping)
2. **Execute the class body** in that namespace
3. **`metaclass.__new__(mcs, name, bases, namespace, **kwargs)`** — creates the class object
4. **`metaclass.__init__(cls, name, bases, namespace, **kwargs)`** — initializes the class object

```python
# run: python3 class_creation_protocol.py

class VerboseMeta(type):
    @classmethod
    def __prepare__(mcs, name: str, bases: tuple[type, ...], **kwargs: object) -> dict[str, object]:  # type: ignore[override]
        print(f"1. __prepare__({name})")
        return {}

    def __new__(mcs, name: str, bases: tuple[type, ...], namespace: dict[str, object], **kwargs: object) -> type:
        print(f"2. __new__({name}) — namespace keys: {list(namespace.keys())}")
        return super().__new__(mcs, name, bases, namespace)

    def __init__(cls, name: str, bases: tuple[type, ...], namespace: dict[str, object], **kwargs: object) -> None:
        print(f"3. __init__({name})")
        super().__init__(name, bases, namespace)


class MyClass(metaclass=VerboseMeta):
    x = 10
    def method(self) -> None:
        pass

# Output:
# 1. __prepare__(MyClass)
# 2. __new__(MyClass) — namespace keys: ['__module__', '__qualname__', 'x', 'method']
# 3. __init__(MyClass)
```

### Writing a Custom Metaclass: Registry Pattern

```python
# run: python3 registry_metaclass.py

class RegistryMeta(type):
    """Metaclass that registers every class created with it."""
    _registry: dict[str, type] = {}

    def __new__(mcs, name: str, bases: tuple[type, ...], namespace: dict[str, object]) -> type:
        cls = super().__new__(mcs, name, bases, namespace)
        if bases:  # Don't register the base class itself
            mcs._registry[name] = cls
        return cls

    @classmethod
    def get_registry(mcs) -> dict[str, type]:
        return dict(mcs._registry)


class Plugin(metaclass=RegistryMeta):
    """Base class — not registered."""
    pass

class AuthPlugin(Plugin):
    """Automatically registered by RegistryMeta."""
    pass

class CachePlugin(Plugin):
    """Also automatically registered."""
    pass


print(RegistryMeta.get_registry())
# {'AuthPlugin': <class 'AuthPlugin'>, 'CachePlugin': <class 'CachePlugin'>}
```

### `__init_subclass__`: The Modern Alternative (3.6+)

Most metaclass use cases — registration, validation, injecting attributes — can be handled with `__init_subclass__`, which is simpler and doesn't require understanding the metaclass machinery:

```python
# run: python3 init_subclass.py

class Plugin:
    """Base class with automatic registration — no metaclass needed."""
    _registry: dict[str, type] = {}

    def __init_subclass__(cls, *, author: str = "unknown", **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        cls.author = author  # Inject attribute into every subclass
        Plugin._registry[cls.__name__] = cls
        print(f"Registered {cls.__name__} by {author}")


class AuthPlugin(Plugin, author="Alice"):
    pass

class CachePlugin(Plugin, author="Bob"):
    pass


print(Plugin._registry)
# {'AuthPlugin': <class 'AuthPlugin'>, 'CachePlugin': <class 'CachePlugin'>}
print(AuthPlugin.author)  # Alice
print(CachePlugin.author) # Bob
```

`__init_subclass__` is called on the **parent** class whenever a new subclass is defined. It receives `cls` (the new subclass) and any keyword arguments passed in the class definition. This is the recommended approach for plugin registries, validation hooks, and attribute injection since Python 3.6.

### When Do You Actually Need a Metaclass?

| Use case | `__init_subclass__` | Class decorator | Metaclass |
|----------|-------------------|-----------------|-----------|
| Register subclasses | Yes | No | Yes |
| Validate class structure | Yes | Yes | Yes |
| Inject attributes/methods | Yes | Yes | Yes |
| Custom `__prepare__` namespace | No | No | **Yes** |
| Control `__new__` (class creation) | No | No | **Yes** |
| Affect `isinstance`/`issubclass` | No | No | **Yes** |
| Intercept attribute access on the **class** | No | No | **Yes** (via `__getattr__` on metaclass) |

Rule of thumb: try `__init_subclass__` first, then class decorators, then metaclasses. Reach for metaclasses only when you need to control the class creation process itself.

### Singleton via Metaclass

```python
# run: python3 singleton_metaclass.py

class SingletonMeta(type):
    _instances: dict[type, object] = {}

    def __call__(cls, *args: object, **kwargs: object) -> object:
        if cls not in cls._instances:
            instance = super().__call__(*args, **kwargs)
            cls._instances[cls] = instance
        return cls._instances[cls]


class Database(metaclass=SingletonMeta):
    def __init__(self, url: str) -> None:
        self.url = url
        print(f"Connecting to {url}")


db1 = Database("postgres://localhost/app")  # "Connecting to ..."
db2 = Database("postgres://other/app")      # No output — returns cached instance
print(db1 is db2)  # True
print(db1.url)     # postgres://localhost/app — first init wins
```

This is cleaner than the `__new__`-based singleton because `__init__` only runs once — `SingletonMeta.__call__` short-circuits before `__init__` is invoked on subsequent calls.

### `__slots__`: Eliminating Per-Instance `__dict__`

By default, every Python instance carries a `__dict__` — a dictionary of its attributes. `__slots__` replaces this with fixed, pre-allocated attribute storage:

```python
# run: python3 slots_demo.py
import sys


class WithDict:
    def __init__(self, x: int, y: int) -> None:
        self.x = x
        self.y = y


class WithSlots:
    __slots__ = ("x", "y")

    def __init__(self, x: int, y: int) -> None:
        self.x = x
        self.y = y


wd = WithDict(1, 2)
ws = WithSlots(1, 2)

print(f"WithDict instance size:  {sys.getsizeof(wd)} bytes")
print(f"  + __dict__ overhead:   {sys.getsizeof(wd.__dict__)} bytes")
print(f"WithSlots instance size: {sys.getsizeof(ws)} bytes")

try:
    print(ws.__dict__)
except AttributeError as e:
    print(f"No __dict__: {e}")

# Cannot add arbitrary attributes:
try:
    ws.z = 3  # type: ignore[attr-defined]
except AttributeError as e:
    print(f"Cannot add attribute: {e}")
```

Typical output (CPython 3.12):
```
WithDict instance size:  48 bytes
  + __dict__ overhead:   64 bytes
WithSlots instance size: 48 bytes
No __dict__: 'WithSlots' object has no attribute '__dict__'
Cannot add attribute: 'WithSlots' object has no attribute 'z'
```

The total saving per instance is the `__dict__` object itself (64+ bytes) plus the hash table overhead. With millions of instances, this is significant.

### Memory Comparison at Scale

```python
# run: python3 slots_memory.py
import sys


class PointDict:
    def __init__(self, x: float, y: float, z: float) -> None:
        self.x = x
        self.y = y
        self.z = z


class PointSlots:
    __slots__ = ("x", "y", "z")

    def __init__(self, x: float, y: float, z: float) -> None:
        self.x = x
        self.y = y
        self.z = z


N = 100_000
dict_points = [PointDict(float(i), float(i), float(i)) for i in range(N)]
slots_points = [PointSlots(float(i), float(i), float(i)) for i in range(N)]

dict_size = sum(sys.getsizeof(p) + sys.getsizeof(p.__dict__) for p in dict_points)
slots_size = sum(sys.getsizeof(p) for p in slots_points)

print(f"100k PointDict objects: {dict_size / 1_000_000:.1f} MB")
print(f"100k PointSlots objects: {slots_size / 1_000_000:.1f} MB")
print(f"Savings: {(dict_size - slots_size) / 1_000_000:.1f} MB ({100 * (1 - slots_size / dict_size):.0f}%)")
```

### `__slots__` with Inheritance: Gotchas

```python
# run: python3 slots_inheritance.py

class Base:
    """Base has __dict__ (no __slots__)."""
    pass

class Child(Base):
    __slots__ = ("x", "y")


c = Child()
c.x = 1
c.y = 2
c.z = 3  # This WORKS! Base provides __dict__, so arbitrary attributes are allowed.
print(c.__dict__)  # {'z': 3} — x and y are in slots, z is in __dict__

# For __slots__ to fully eliminate __dict__, EVERY class in the chain must define __slots__:
class StrictBase:
    __slots__ = ()

class StrictChild(StrictBase):
    __slots__ = ("x", "y")

sc = StrictChild()
sc.x = 1
try:
    sc.z = 3  # type: ignore[attr-defined]  — AttributeError!
except AttributeError as e:
    print(f"Fully locked: {e}")
```

**Gotcha:** if *any* class in the MRO has `__dict__` (i.e., doesn't define `__slots__`), the child gets `__dict__` too, negating the memory savings for attributes not in `__slots__`.

**Don't repeat slots in subclasses:**

```python
# run: python3 slots_no_repeat.py

class Parent:
    __slots__ = ("x",)

class Child(Parent):
    __slots__ = ("y",)  # Only NEW attributes — "x" is inherited from Parent's slots

c = Child()
c.x = 1  # From Parent.__slots__
c.y = 2  # From Child.__slots__
print(c.x, c.y)  # 1 2

# Repeating "x" in Child.__slots__ creates an independent, inaccessible slot
# that shadows Parent's — this wastes memory and causes subtle bugs.
```

### ORM Field Collection via Metaclass

A practical metaclass example: collecting field definitions from the class body, similar to how ORMs work:

```python
# run: python3 orm_metaclass.py
from typing import Any


class Field:
    """A simple descriptor representing a database column."""
    def __init__(self, column_type: str, primary_key: bool = False) -> None:
        self.column_type = column_type
        self.primary_key = primary_key
        self.name = ""

    def __set_name__(self, owner: type, name: str) -> None:
        self.name = name

    def __get__(self, obj: Any, objtype: type | None = None) -> Any:
        if obj is None:
            return self
        return obj.__dict__.get(self.name)

    def __set__(self, obj: Any, value: Any) -> None:
        obj.__dict__[self.name] = value

    def __repr__(self) -> str:
        return f"Field({self.column_type!r}, primary_key={self.primary_key})"


class ModelMeta(type):
    def __new__(mcs, name: str, bases: tuple[type, ...], namespace: dict[str, Any]) -> type:
        fields = {}
        for key, value in namespace.items():
            if isinstance(value, Field):
                fields[key] = value
        namespace["_fields"] = fields
        return super().__new__(mcs, name, bases, namespace)


class Model(metaclass=ModelMeta):
    _fields: dict[str, Field]

    def __repr__(self) -> str:
        attrs = ", ".join(f"{k}={getattr(self, k)!r}" for k in self._fields)
        return f"{type(self).__name__}({attrs})"


class User(Model):
    id = Field("INTEGER", primary_key=True)
    name = Field("TEXT")
    email = Field("TEXT")


u = User()
u.id = 1
u.name = "Alice"
u.email = "alice@example.com"
print(u)          # User(id=1, name='Alice', email='alice@example.com')
print(User._fields)  # {'id': Field('INTEGER',...), 'name': Field('TEXT',...), ...}
```

### The Same Example with `__init_subclass__` (No Metaclass)

```python
# run: python3 orm_init_subclass.py
from typing import Any


class Field:
    def __init__(self, column_type: str, primary_key: bool = False) -> None:
        self.column_type = column_type
        self.primary_key = primary_key
        self.name = ""

    def __set_name__(self, owner: type, name: str) -> None:
        self.name = name

    def __get__(self, obj: Any, objtype: type | None = None) -> Any:
        if obj is None:
            return self
        return obj.__dict__.get(self.name)

    def __set__(self, obj: Any, value: Any) -> None:
        obj.__dict__[self.name] = value


class Model:
    _fields: dict[str, Field]

    def __init_subclass__(cls, **kwargs: object) -> None:
        super().__init_subclass__(**kwargs)
        cls._fields = {
            key: value
            for key, value in vars(cls).items()
            if isinstance(value, Field)
        }

    def __repr__(self) -> str:
        attrs = ", ".join(f"{k}={getattr(self, k)!r}" for k in self._fields)
        return f"{type(self).__name__}({attrs})"


class Product(Model):
    id = Field("INTEGER", primary_key=True)
    name = Field("TEXT")
    price = Field("REAL")


p = Product()
p.id = 42
p.name = "Widget"
p.price = 9.99
print(p)              # Product(id=42, name='Widget', price=9.99)
print(Product._fields) # {'id': ..., 'name': ..., 'price': ...}
```

Same result, zero metaclass complexity. This is why `__init_subclass__` is the recommended first tool.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Metaclass conflicts.**
You try to inherit from two base classes that use different metaclasses: `class MyModel(DjangoModel, ProtobufMessage)`. Python raises `TypeError: metaclass conflict`. The fix is creating a new metaclass that inherits from both metaclasses, but this is fragile and a sign of a design problem. Symptom: `TypeError` at class definition time, often deep in framework internals. Practical fix: use composition instead of inheriting from two framework base classes.

**2. `__slots__` breaks pickling and dynamic attribute assignment.**
You add `__slots__` to a data class for memory savings. Later, a serialization library (pickle, some JSON encoders) tries to access `__dict__` and fails with `AttributeError`. Or a test that monkey-patches an attribute (`obj.mock_flag = True`) breaks. Symptom: `AttributeError: 'X' object has no attribute '__dict__'` in serialization code, or `AttributeError` when tests try to add attributes. Fix: include `"__dict__"` in `__slots__` if you need both slot attributes *and* dynamic attributes (though this partially defeats the purpose), or define `__getstate__`/`__setstate__` for pickle.

**3. `__init_subclass__` keyword arguments silently ignored.**
You define `__init_subclass__(cls, *, required_param: str)` on a base class, but forget `**kwargs`. A grandchild class passes its own keywords to `super().__init_subclass__()`, and Python raises `TypeError: __init_subclass__() got an unexpected keyword argument`. This breaks the cooperative chain. Fix: always include `**kwargs` in `__init_subclass__` and pass them through to `super().__init_subclass__(**kwargs)`.
:::

## 🎯 Checkpoint

::: details Question 1 — `type` of `type`
**Q:** What is `type(type)`, and why?

**A:** `type(type)` is `type`. This is the bootstrap circularity at the foundation of Python's object model. `type` is its own metaclass — it is an instance of itself. This is implemented at the C level in CPython; it cannot be recreated in pure Python. The chain is: `object` is an instance of `type`, and `type` is a subclass of `object`. This mutual dependency is resolved during interpreter initialization, not through normal class creation.
:::

::: details Question 2 — `__slots__` with inheritance
**Q:** Class `A` does not define `__slots__`. Class `B(A)` defines `__slots__ = ("x",)`. Does `B` save memory compared to a class without `__slots__`? Can you assign arbitrary attributes to a `B` instance?

**A:** `B` does **not** fully save memory because `A` contributes `__dict__` to the instance. `B` instances have *both* slot-based storage for `x` *and* a `__dict__` for everything else. You *can* assign arbitrary attributes to `B` instances — they go into `__dict__`. The `x` attribute uses slot storage (slightly faster access, contributes to the slot layout), but the `__dict__` overhead remains. For full memory savings, every class in the MRO must define `__slots__`.
:::

::: details Question 3 — `__init_subclass__` vs metaclass
**Q:** You want every subclass of `Base` to validate that it defines a `version` class attribute. How would you do this with `__init_subclass__`? Under what circumstances would this fail and require a metaclass?

**A:** With `__init_subclass__`:
```python
class Base:
    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        if not hasattr(cls, 'version'):
            raise TypeError(f"{cls.__name__} must define 'version'")
```
This works for direct and indirect subclasses. It would fail if you need to inspect or modify the namespace *before* the class is fully created (e.g., to reorder attributes, create a custom namespace type via `__prepare__`, or intercept `type.__new__`). It also fails if you need to customize `isinstance`/`issubclass` checks via `__instancecheck__`/`__subclasscheck__`, which only work on metaclasses.
:::

## Key Mental Models

- **`type` is to classes what classes are to instances** — classes are objects, manufactured by their metaclass, which is usually `type`.
- **`__init_subclass__` is the 80/20 tool** — it handles registration, validation, and attribute injection without metaclass complexity.
- **Metaclasses control class *creation*; `__init_subclass__` reacts to class creation** — reach for metaclasses only when you need `__prepare__`, custom `__new__`, or metaclass-level `__getattr__`.
- **`__slots__` trades flexibility for memory** — no `__dict__` means no dynamic attributes, but significant memory savings at scale.
- **`__slots__` requires full-chain participation** — if any ancestor lacks `__slots__`, the instance gets `__dict__` anyway.

## Related

- [Classes & Instances](./01-classes-instances) — `type()` creating classes and the `__new__`/`__init__` distinction
- [The Descriptor Protocol & Properties](./03-descriptors-properties) — `__slots__` creates descriptors on the class for each slot
- [Inheritance & MRO](./02-inheritance-mro) — `__init_subclass__` follows MRO for cooperative usage; metaclass conflicts arise from multiple inheritance
