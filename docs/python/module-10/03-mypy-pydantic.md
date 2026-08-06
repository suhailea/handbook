---
title: mypy, Pydantic & Runtime Typing
outline: deep
---

# mypy, Pydantic & Runtime Typing

**Interview weight:** 🔥🔥 — senior roles expect you to know the difference between static and runtime type checking, be able to configure mypy/pyright in a real project, and explain when to use Pydantic vs dataclasses. Production Python increasingly requires all three.

**Python version notes:** All examples target Python 3.12+. Pydantic v2 requires Python 3.8+. mypy and pyright support 3.8+. The `type` statement in pyproject.toml configuration requires mypy 0.900+.

**Prerequisites:** [Type Hints — From Zero to Useful](./01-type-hints-basics.md), [Advanced Typing — Generics, Protocols & More](./02-advanced-typing.md)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you are shipping packages internationally. There are two completely different checkpoints where your packages could be inspected.

**mypy is like a spell-checker for your shipping labels.** Before any package leaves the warehouse, an automated scanner reads every label you have written — sender address, recipient address, contents declaration — and flags inconsistencies. "You wrote 'fragile glassware' on the label but the customs form says 'clothing.' Fix it before we ship." This happens at your desk, before the package moves an inch. It is fast, it catches a huge number of mistakes, but it never opens the box. If the label says "books" and the box actually contains bricks, the spell-checker has no idea — it only reads what you wrote.

**Pydantic is like a customs officer at the border.** When a package actually arrives at the crossing, the officer opens it, inspects every item, weighs it, checks dimensions, and compares everything against the declaration. If the contents do not match — wrong type, missing items, unexpected extras — the package is rejected on the spot with a detailed report of every discrepancy. This happens at runtime, when real data flows through your program.

One works before your code runs. The other works while your code runs. They solve different problems, and using only one leaves a gap. mypy catches internal logic errors (you passed a string where your own code expects an int). Pydantic catches external data errors (the API client sent `{"age": "twenty"}` where your schema expects an integer). Together, they cover both sides: your code is internally consistent (mypy) and it rejects bad data at the boundaries (Pydantic).

In between sits **pyright** — an alternative to mypy that does the same job (static analysis) but faster, with a different implementation. And **dataclasses** sit between plain classes and Pydantic — they give you structured data containers without the validation overhead, ideal for internal data that you already trust.
:::

## ⚙️ Under the Hood

### mypy — static type checking

mypy reads your source code and type annotations without executing it, building an internal model of types and flagging inconsistencies:

```python
# run: mypy mypy_basics.py
"""A file with intentional type errors for mypy to catch."""

def greet(name: str) -> str:
    return f"Hello, {name}"

# Error 1: incompatible argument type
result: str = greet(42)  # error: Argument 1 to "greet" has incompatible type "int"; expected "str"

# Error 2: incompatible return type
def add(a: int, b: int) -> str:
    return a + b  # error: Incompatible return value type (got "int", expected "str")

# Error 3: missing return
def maybe_greet(name: str | None) -> str:
    if name:
        return f"Hello, {name}"
    # error: Missing return statement (implicit None is not str)

# Error 4: None not handled
def process(value: str | None) -> int:
    return len(value)  # error: Argument 1 to "len" has incompatible type "str | None"
    # Fix: if value is None: return 0; return len(value)
```

### mypy configuration in pyproject.toml

Real projects configure mypy via `pyproject.toml` rather than command-line flags:

```python
# run: cat pyproject_mypy_example.toml
"""Example mypy configuration — save as pyproject.toml [tool.mypy] section."""

# This is TOML, not Python — shown here for reference.
# [tool.mypy]
# python_version = "3.12"
# strict = true
# warn_return_any = true
# warn_unused_configs = true
# disallow_untyped_defs = true
# disallow_any_generics = true
# no_implicit_optional = true
# check_untyped_defs = true
#
# # Per-module overrides for gradual typing:
# [[tool.mypy.overrides]]
# module = "tests.*"
# disallow_untyped_defs = false
#
# [[tool.mypy.overrides]]
# module = "legacy_module.*"
# ignore_errors = true
```

```python
# run: python3 mypy_config_explainer.py
"""What --strict enables — the full list."""

strict_flags = {
    "disallow_untyped_defs": "Every function must have type annotations",
    "disallow_any_generics": "Generic types must be parameterized (list[int], not list)",
    "disallow_untyped_calls": "Cannot call untyped functions from typed code",
    "disallow_incomplete_defs": "Partially annotated functions are errors",
    "disallow_untyped_decorators": "Decorators must be typed",
    "no_implicit_optional": "def f(x: int = None) is an error — use int | None",
    "warn_return_any": "Warn when returning Any from a typed function",
    "warn_unreachable": "Flag unreachable code",
    "check_untyped_defs": "Type-check inside untyped function bodies",
    "strict_equality": "Flag comparisons of incompatible types",
}

print("mypy --strict enables these checks:\n")
for flag, description in strict_flags.items():
    print(f"  {flag:40s} {description}")
```

### Common mypy errors and fixes

```python
# run: python3 common_mypy_fixes.py
"""Common mypy errors and their fixes — runnable reference."""

from typing import Any, cast

# --- ERROR: Need type annotation for variable ---
# mypy cannot infer the type of an empty container:
# items = []  # error: Need type annotation for "items"
items: list[str] = []  # Fix: annotate explicitly

# --- ERROR: Incompatible types in assignment ---
x: int = 5
# x = "hello"  # error: Incompatible types (got "str", expected "int")
# Fix: use Union if the variable genuinely holds both:
y: int | str = 5
y = "hello"  # OK

# --- ERROR: Item "None" of "X | None" has no attribute "Y" ---
def process(name: str | None) -> str:
    # return name.upper()  # error: name might be None
    # Fix 1: guard with if
    if name is None:
        return ""
    return name.upper()  # mypy knows name is str here (narrowing)

# --- ERROR: Returning Any from function declared to return "str" ---
import json
def load_name(data: str) -> str:
    parsed = json.loads(data)       # json.loads returns Any
    # return parsed["name"]         # warn_return_any: returning Any
    return cast(str, parsed["name"])  # Fix: cast tells mypy "trust me, this is str"
    # Better fix: validate with Pydantic instead of casting

# --- ERROR: has no attribute (dynamic attributes) ---
class Config:
    def __init__(self) -> None:
        self.debug = True
        self.port = 8080

# config = Config()
# config.verbose = True  # error: "Config" has no attribute "verbose"
# Fix: declare all attributes in __init__ or use __slots__

print("All fixes demonstrated successfully.")
```

### Gradual typing — adding types to an existing codebase

```python
# run: python3 gradual_typing.py
"""Strategies for gradually typing a large codebase."""

# Strategy 1: Start with function boundaries (most value per annotation)
# Type the public API of each module first. Internal helpers can wait.

def public_api(user_id: int, *, include_deleted: bool = False) -> dict[str, str]:
    """Public functions get full annotations first."""
    return _internal_fetch(user_id, include_deleted)

def _internal_fetch(uid, deleted):  # type: ignore[no-untyped-def]
    """Internal helpers can be typed later — suppress with per-line ignore."""
    return {"id": str(uid)}

# Strategy 2: Per-module overrides in pyproject.toml
# Start with strict = false globally, enable strict per-module as you go.

# Strategy 3: The py.typed marker
# If you're building a library, create an empty file:
#   mypackage/py.typed
# This tells type checkers "this package ships type information."
# Without it, mypy treats your package as untyped and ignores its annotations.

# Strategy 4: Use reveal_type() for debugging
x = [1, 2, 3]
reveal_type(x)  # mypy output: note: Revealed type is "builtins.list[builtins.int]"
# reveal_type() is removed before runtime — it's a mypy/pyright directive.
# In Python 3.11+, typing.reveal_type() also works at runtime (prints and returns).

from typing import reveal_type as rt  # 3.11+ runtime version
val = rt([1, 2, 3])  # prints: Runtime type is 'list'
print(val)  # [1, 2, 3]
```

### pyright — the alternative

pyright is Microsoft's type checker, written in TypeScript. It powers Pylance (the VS Code Python extension) and is significantly faster than mypy on large codebases:

```python
# run: python3 pyright_comparison.py
"""mypy vs pyright — key differences."""

differences = {
    "Language": ("Python", "TypeScript/Node.js"),
    "Speed": ("Slower (Python runtime)", "5-10x faster (compiled)"),
    "IDE integration": ("Separate tool", "Built into Pylance/VS Code"),
    "Strictness levels": ("--strict flag + granular flags", "basic/standard/strict presets"),
    "Type inference": ("Conservative", "More aggressive — infers more without annotations"),
    "Configuration": ("pyproject.toml [tool.mypy]", "pyproject.toml [tool.pyright] or pyrightconfig.json"),
    "Plugin system": ("Yes (mypy plugins)", "No"),
    "Watch mode": ("dmypy daemon", "Built-in --watch"),
    "PEP compliance": ("Reference impl", "Sometimes ahead of PEPs"),
}

print(f"{'Feature':25s} {'mypy':35s} {'pyright':35s}")
print("-" * 95)
for feature, (mypy_val, pyright_val) in differences.items():
    print(f"{feature:25s} {mypy_val:35s} {pyright_val:35s}")

# pyright configuration in pyproject.toml:
# [tool.pyright]
# pythonVersion = "3.12"
# typeCheckingMode = "strict"    # "off" | "basic" | "standard" | "strict"
# reportMissingTypeStubs = false
# reportUnknownMemberType = false
```

### Pydantic v2 — runtime validation

Pydantic reads type annotations and enforces them at runtime. When data arrives (from an API, a file, a database), Pydantic validates and coerces it:

```python
# run: python3 pydantic_basics.py
"""Pydantic v2 — runtime type enforcement using annotations."""
from pydantic import BaseModel, field_validator, model_validator, Field
from datetime import datetime

class User(BaseModel):
    id: int
    name: str = Field(min_length=1, max_length=100)
    email: str
    age: int = Field(ge=0, le=150)
    created_at: datetime = Field(default_factory=datetime.now)

# Valid data:
user = User(id=1, name="Alice", email="alice@example.com", age=30)
print(user)
# id=1 name='Alice' email='alice@example.com' age=30 created_at=...

# Pydantic coerces compatible types:
user2 = User(id="42", name="Bob", email="bob@co.com", age="25")
print(f"id type after coercion: {type(user2.id)}")  # <class 'int'>

# Invalid data raises ValidationError with detailed messages:
from pydantic import ValidationError
try:
    User(id="not_a_number", name="", email="bad", age=-5)
except ValidationError as e:
    print(f"\nValidation errors ({e.error_count()}):")
    for err in e.errors():
        print(f"  {err['loc']}: {err['msg']}")

# Field validators — custom validation logic:
class Order(BaseModel):
    product: str
    quantity: int
    unit_price: float

    @field_validator("quantity")
    @classmethod
    def quantity_must_be_positive(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("quantity must be positive")
        return v

    @model_validator(mode="after")
    def check_total_not_absurd(self) -> "Order":
        total = self.quantity * self.unit_price
        if total > 1_000_000:
            raise ValueError(f"Order total ${total:,.2f} exceeds $1M limit")
        return self

order = Order(product="Widget", quantity=5, unit_price=9.99)
print(f"\nOrder total: ${order.quantity * order.unit_price:.2f}")
```

### Pydantic v2 internals — the Rust core

```python
# run: python3 pydantic_internals.py
"""Why Pydantic v2 is fast — the Rust core architecture."""

# Pydantic v2 architecture:
#
# ┌─────────────────────────────────────────────┐
# │  Python layer (pydantic)                     │
# │  - BaseModel, Field, validators              │
# │  - Schema generation from annotations        │
# │  - Developer-facing API                      │
# ├─────────────────────────────────────────────┤
# │  Rust layer (pydantic-core)                  │
# │  - Schema compilation → CoreSchema           │
# │  - Validation engine (SchemaValidator)        │
# │  - Serialization engine (SchemaSerializer)    │
# │  - Written in Rust, compiled via maturin/PyO3 │
# └─────────────────────────────────────────────┘
#
# Key insight: when you define a BaseModel subclass, Pydantic
# compiles the schema ONCE (at class creation time) into a
# Rust-backed validator object. Every subsequent validation
# call runs in Rust, bypassing Python's interpreter overhead.

from pydantic import BaseModel
import time

class Point(BaseModel):
    x: float
    y: float

# The validator is compiled once:
validator = Point.__pydantic_validator__
print(f"Validator type: {type(validator)}")
# <class 'pydantic_core._pydantic_core.SchemaValidator'>

# Benchmark: validate 100k points
data = {"x": 1.5, "y": 2.5}
start = time.perf_counter()
for _ in range(100_000):
    Point.model_validate(data)
elapsed = time.perf_counter() - start
print(f"100k validations: {elapsed:.3f}s ({100_000/elapsed:,.0f} validations/sec)")

# model_validate vs __init__:
# - Point(x=1.5, y=2.5) — Python-side construction, still validates
# - Point.model_validate(data) — dict-based construction, Rust-side
# - Point.model_validate_json(json_str) — parse JSON + validate in Rust (fastest)

import json
json_str = json.dumps(data)
start = time.perf_counter()
for _ in range(100_000):
    Point.model_validate_json(json_str)
elapsed2 = time.perf_counter() - start
print(f"100k JSON validations: {elapsed2:.3f}s ({100_000/elapsed2:,.0f} validations/sec)")

# Serialization is also Rust-backed:
p = Point(x=1.5, y=2.5)
print(f"\nmodel_dump: {p.model_dump()}")          # {'x': 1.5, 'y': 2.5}
print(f"model_dump_json: {p.model_dump_json()}")  # '{"x":1.5,"y":2.5}'
```

### dataclasses vs Pydantic

```python
# run: python3 dataclass_vs_pydantic.py
"""dataclasses vs Pydantic — when to use each."""
from dataclasses import dataclass, field
from pydantic import BaseModel, Field as PydanticField

# ─── dataclass: lightweight, no validation ───
@dataclass
class InternalPoint:
    """Use dataclasses for internal data structures where you trust the data."""
    x: float
    y: float
    label: str = ""

# No validation — garbage in, garbage out:
p1 = InternalPoint(x="not_a_float", y=None, label=42)  # No error!
print(f"dataclass accepts anything: {p1}")

# ─── Pydantic: validates and coerces ───
class ExternalPoint(BaseModel):
    """Use Pydantic for external data boundaries (APIs, files, user input)."""
    x: float
    y: float
    label: str = ""

# Validates and coerces:
p2 = ExternalPoint(x="3.14", y="2.72", label=42)
print(f"Pydantic coerces: {p2}")  # x=3.14, y=2.72, label='42'

# ─── Decision framework ───
decisions = [
    ("API request/response bodies",     "Pydantic", "Validates external input"),
    ("Config file parsing",             "Pydantic", "Validates + coerces config values"),
    ("Internal domain objects",         "dataclass", "Trusted data, less overhead"),
    ("Database row mapping",            "Either",    "Pydantic if untrusted, dataclass if ORM validates"),
    ("Function return grouping",        "dataclass", "Lightweight named tuples alternative"),
    ("JSON serialization needed",       "Pydantic", "Built-in model_dump_json()"),
    ("Immutability needed",             "Either",    "dataclass(frozen=True) or Pydantic model_config frozen"),
    ("Performance-critical hot path",   "dataclass", "No validation overhead"),
]

print(f"\n{'Use Case':40s} {'Choice':12s} {'Why'}")
print("-" * 90)
for case, choice, reason in decisions:
    print(f"{case:40s} {choice:12s} {reason}")

# Key difference in philosophy:
# - dataclasses are about STRUCTURE (give me named fields with defaults)
# - Pydantic is about VALIDATION (parse, validate, serialize external data)
```

### Type stubs (.pyi files)

Type stubs provide type information for libraries that don't ship their own annotations:

```python
# run: python3 type_stubs_explainer.py
"""Type stubs — adding types to untyped libraries."""

# .pyi files contain ONLY type signatures — no implementation.
# They shadow the corresponding .py file for type checkers.

# Example: if you have an untyped library `legacy.py`:
#
# legacy.py:
#   def compute(data, factor):
#       return [x * factor for x in data]
#
# You create legacy.pyi:
#   def compute(data: list[float], factor: float) -> list[float]: ...

# Where stubs live:
# 1. typeshed — community-maintained stubs for stdlib + popular packages
#    (bundled with mypy and pyright)
#    https://github.com/python/typeshed
#
# 2. Stub packages on PyPI — named types-<package>
#    pip install types-requests    # stubs for requests
#    pip install types-redis       # stubs for redis
#    pip install types-PyYAML      # stubs for PyYAML
#
# 3. Inline stubs — .pyi files in your own project

# How to generate stubs for an untyped package:
# stubgen -p mypackage  (ships with mypy)
# This creates a mypackage/ directory with .pyi files containing
# inferred signatures (mostly Any, but a starting point).

# Checking if a package ships its own types:
import importlib.util
import pathlib

def has_inline_types(package_name: str) -> bool:
    """Check if a package ships a py.typed marker."""
    spec = importlib.util.find_spec(package_name)
    if spec is None or spec.origin is None:
        return False
    package_dir = pathlib.Path(spec.origin).parent
    return (package_dir / "py.typed").exists()

# Test with some packages:
for pkg in ["json", "typing", "pydantic"]:
    try:
        result = has_inline_types(pkg)
        print(f"{pkg:20s} ships types: {result}")
    except Exception as e:
        print(f"{pkg:20s} check failed: {e}")
```

### Runtime annotation access and frameworks

```python
# run: python3 runtime_annotations.py
"""How frameworks like FastAPI use type hints at runtime."""
from typing import get_type_hints, Annotated
from dataclasses import dataclass

# FastAPI's core trick: reading function annotations to build API schemas.
# Here's a simplified version of what FastAPI does internally:

def extract_params(func: object) -> dict[str, type]:
    """Read a function's type hints (like FastAPI does for route handlers)."""
    hints = get_type_hints(func, include_extras=True)
    return {name: hint for name, hint in hints.items() if name != "return"}

# Simulated route handler:
def create_user(
    name: str,
    age: int,
    email: str | None = None,
) -> dict[str, str | int | None]:
    return {"name": name, "age": age, "email": email}

params = extract_params(create_user)
print("Extracted parameters:")
for name, type_hint in params.items():
    print(f"  {name}: {type_hint}")

# Annotated — adding metadata to type hints (3.9+):
# This is how FastAPI's Query(), Path(), Depends() work.

@dataclass
class FieldMeta:
    description: str
    min_length: int = 0

def search(
    query: Annotated[str, FieldMeta("Search query", min_length=1)],
    limit: Annotated[int, FieldMeta("Max results")] = 10,
) -> list[str]:
    return [f"result_{i}" for i in range(limit)]

# get_type_hints with include_extras=True preserves Annotated metadata:
hints = get_type_hints(search, include_extras=True)
print(f"\nAnnotated hints:")
for name, hint in hints.items():
    if name == "return":
        continue
    if hasattr(hint, "__metadata__"):
        meta = hint.__metadata__[0]
        print(f"  {name}: type={hint.__args__[0]}, meta={meta}")
    else:
        print(f"  {name}: {hint}")

# This is the bridge between static type hints and runtime behavior:
# - Type hints are metadata (no runtime enforcement by Python)
# - Frameworks read that metadata at import time / startup
# - They build validation, serialization, and routing from it
# - The type hints serve double duty: static checking AND runtime configuration
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. mypy passes but runtime crashes — the "typed but wrong" illusion**

You add type annotations everywhere, mypy reports zero errors, and you feel safe. Then production crashes because a JSON payload contains `{"count": null}` where your Pydantic-free code expected `int`. mypy checked your *internal* logic, but the *external* data never went through validation. Symptom: `TypeError: unsupported operand type(s) for +: 'NoneType' and 'int'` in a function whose signature says `count: int`. Root cause: no runtime validation at the data boundary. Fix: use Pydantic (or manual validation) at every point where external data enters your system — API endpoints, config loading, queue message parsing. mypy and Pydantic are complementary, not alternatives.

**2. Pydantic v1 to v2 migration breaking validators**

Pydantic v2 changed the validator API significantly. `@validator` became `@field_validator` with `@classmethod` required. `@root_validator` became `@model_validator`. The `values` dict in validators became `self` in `mode="after"` validators. Symptom: `TypeError` or `PydanticUserError` on startup after upgrading. Diagnosis: check migration guide; run `bump-pydantic` auto-fixer tool. Common trap: `pre=True` validators in v1 become `mode="before"` in v2, and the data shape changes from a dict to raw input.

**3. `from __future__ import annotations` breaking Pydantic models**

In Pydantic v1, `from __future__ import annotations` (PEP 563) broke model field resolution because Pydantic read `__annotations__` at class creation time and got strings instead of types. Pydantic v2 handles this correctly using `get_type_hints()`, but other libraries that read annotations directly (attrs, some ORMs, custom metaclasses) may still break. Symptom: fields showing as `str` type with the literal value `'int'` instead of being recognized as the `int` type. Fix: test annotation-reading code explicitly with and without the future import; prefer `get_type_hints()` over raw `__annotations__` access in your own libraries.

:::

## 🎯 Checkpoint

::: details Question 1 — Static vs runtime checking
**Q:** A function is annotated `def process(data: dict[str, int]) -> int` and is checked by mypy with zero errors. Can it still crash at runtime with a type-related error? If so, give a concrete scenario.

**A:** Yes. mypy validates the *internal consistency* of your code — that every call site passes a `dict[str, int]` as far as it can determine. But if `data` comes from an external source (JSON parsing, database query, API call), the actual runtime value may not match the annotation. For example: `data = json.loads(request.body)` returns `Any`, and mypy trusts your annotation. If the JSON contains `{"count": "five"}`, the value is `dict[str, str]` at runtime, and `process` will crash when it tries to do arithmetic on `"five"`. mypy cannot inspect runtime data. This is exactly the gap that Pydantic fills — it validates actual values against the schema at execution time. The two tools are complementary: mypy checks your code's logic, Pydantic checks your data's shape.
:::

::: details Question 2 — dataclass vs Pydantic model
**Q:** When would you choose a `@dataclass` over a Pydantic `BaseModel`? What do you lose and what do you gain?

**A:** Choose `@dataclass` for internal data structures where the data is already trusted (constructed by your own code, returned from a typed ORM, computed internally). You gain: lower overhead (no validation on construction), simpler mental model, stdlib with no dependency, and compatibility with everything in the ecosystem. You lose: automatic validation (a `@dataclass` will accept any value for any field), coercion (no automatic `"42"` to `42`), built-in JSON serialization (`model_dump_json()`), and rich error messages. Choose Pydantic at system boundaries — API endpoints, config file parsing, message queue consumers — where data comes from outside your process and cannot be trusted. In practice, many projects use both: Pydantic at the edges, dataclasses internally.
:::

::: details Question 3 — py.typed marker
**Q:** What is a `py.typed` file, and what happens if your library ships type annotations but omits it?

**A:** `py.typed` is an empty marker file placed in your package's root directory (e.g., `mypackage/py.typed`). It signals to type checkers (per PEP 561) that this package ships inline type information and should be type-checked by consumers. Without it, mypy treats the package as untyped — it ignores all annotations in the package and infers `Any` for every import from it. This means users of your library get no type checking benefit from your annotations, even though the annotations exist in the source code. The fix is trivial: create an empty `py.typed` file and include it in your package distribution (add it to `package_data` in setup.cfg/pyproject.toml).
:::

## Key Mental Models

- **mypy checks your logic, Pydantic checks your data.** They are complementary layers — static analysis catches internal inconsistencies, runtime validation catches external data violations. Neither replaces the other.
- **Gradual typing is a strategy, not a compromise.** Start with function signatures on public APIs, add `--strict` per module, use per-line `# type: ignore` as temporary debt markers. You don't need 100% coverage to get value.
- **Pydantic v2's speed comes from compiling schemas to Rust validators once at class creation time.** Every subsequent validation runs in compiled Rust, not interpreted Python. This is why `model_validate_json()` is faster than `model_validate(json.loads(...))` — it skips the Python dict intermediate.
- **`get_type_hints()` is the correct way to read annotations at runtime.** Raw `__annotations__` may contain unresolved strings (forward references, PEP 563). Frameworks that skip `get_type_hints()` break under `from __future__ import annotations`.
- **The `py.typed` marker is the difference between a typed library and an untyped library** — without it, consumers' type checkers ignore your annotations entirely.

## Related

- [Type Hints — From Zero to Useful](./01-type-hints-basics.md) — the annotation basics this page builds on
- [Advanced Typing — Generics, Protocols & More](./02-advanced-typing.md) — the advanced type constructs mypy/pyright validate
- [Module 4 — OOP & Descriptors](/python/module-04/) — dataclass mechanics and class internals
- [Module 3 — Functions & Scoping](/python/module-03/) — decorator mechanics relevant to ParamSpec and type-safe wrappers
