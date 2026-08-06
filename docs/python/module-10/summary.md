---
title: Module 10 Summary
outline: deep
---

# Module 10 Summary — Type Hints & Modern Python

## Mental Models Gained

1. **Annotations are metadata, not enforcement.** Python stores type hints in `__annotations__` dictionaries and never checks them at call time. They exist for humans and tools, not for the interpreter.

2. **Static and runtime checking solve different problems.** mypy/pyright catch internal logic errors at development time (you passed a string where your code expects an int). Pydantic catches external data errors at execution time (the API client sent `"twenty"` where the schema expects an integer). Use both.

3. **Generics parameterize behavior, Protocols define contracts by shape.** `TypeVar` and `Generic` let you write code that works with "some specific type T, decided later." `Protocol` lets you accept any object that has the right methods, regardless of its class hierarchy. Together they give you type-safe duck typing.

4. **Variance protects mutability.** Mutable containers (`list`) are invariant because allowing `list[Dog]` as `list[Animal]` would let someone insert a `Cat`. Read-only views (`Sequence`, `Iterable`) are covariant and safely accept subtypes.

5. **Pydantic's speed comes from one-time schema compilation to Rust.** The `BaseModel` subclass creation compiles a Rust-backed `SchemaValidator` once. Every validation call after that runs in compiled code, not interpreted Python.

6. **`get_type_hints()` is the only safe way to read annotations at runtime.** Raw `__annotations__` may contain unresolved forward reference strings, especially with `from __future__ import annotations`. Frameworks must use `get_type_hints()`.

## Self-Assessment Checklist

Before moving on, verify you can confidently:

- [ ] Annotate a function with parameter types, return type, and `-> None` for void functions
- [ ] Use `list[int]`, `dict[str, int]`, `tuple[int, ...]`, `X | None` without importing from `typing` (3.9+/3.10+)
- [ ] Explain why `Optional[int]` is `Union[int, None]` and not "the parameter is optional"
- [ ] Write a generic function with `TypeVar` and a generic class with `Generic[T]` (or 3.12+ syntax)
- [ ] Define a `Protocol` and use it to accept any structurally compatible class
- [ ] Configure mypy in `pyproject.toml` with strict mode and per-module overrides
- [ ] Explain the difference between mypy and Pydantic — what each catches and what each misses
- [ ] Create a Pydantic `BaseModel` with `Field` constraints and `@field_validator`
- [ ] Decide between `@dataclass` and Pydantic `BaseModel` for a given use case and justify the choice
- [ ] Use `typing.get_type_hints()` to read resolved annotations at runtime

## Quick Reference

### Type Hints Cheat Sheet

| What You Want | Syntax (3.12+) | Pre-3.10 Equivalent |
|---|---|---|
| Integer | `x: int` | Same |
| Optional value | `x: int \| None` | `Optional[int]` |
| Union | `x: int \| str` | `Union[int, str]` |
| List of ints | `x: list[int]` | `List[int]` (from typing) |
| Dict | `x: dict[str, int]` | `Dict[str, int]` (from typing) |
| Fixed tuple | `x: tuple[int, str]` | `Tuple[int, str]` (from typing) |
| Variable tuple | `x: tuple[int, ...]` | `Tuple[int, ...]` (from typing) |
| Callable | `f: Callable[[int], str]` | Same (from collections.abc) |
| Type alias | `type Name = list[int]` | `Name: TypeAlias = list[int]` |
| Constant | `X: Final[int] = 5` | Same (from typing) |
| Class variable | `x: ClassVar[int] = 0` | Same (from typing) |
| Literal value | `x: Literal["a", "b"]` | Same (from typing) |
| Generic function | `def f[T](x: T) -> T` | `T = TypeVar('T'); def f(x: T) -> T` |
| Generic class | `class Box[T]` | `class Box(Generic[T])` |
| Protocol | `class P(Protocol)` | Same (from typing) |

### typing Module Imports Table

| Import | Purpose | Version |
|---|---|---|
| `Any` | Escape hatch — compatible with everything | 3.5+ |
| `Union` | `Union[X, Y]` — use `X \| Y` on 3.10+ | 3.5+ |
| `Optional` | `Optional[X]` = `X \| None` | 3.5+ |
| `Final` | Constant marker — no reassignment | 3.8+ |
| `ClassVar` | Class-level attribute marker | 3.5.3+ |
| `TypeVar` | Generic type variable | 3.5+ |
| `Generic` | Base class for generic types | 3.5+ |
| `Protocol` | Structural subtyping interface | 3.8+ |
| `runtime_checkable` | Enable isinstance() on Protocol | 3.8+ |
| `Literal` | Restrict to specific values | 3.8+ |
| `TypedDict` | Typed dictionary schema | 3.8+ |
| `overload` | Multiple type signatures for one function | 3.5+ |
| `TypeGuard` | Custom type narrowing (True branch) | 3.10+ |
| `TypeIs` | Custom type narrowing (both branches) | 3.13+ |
| `ParamSpec` | Capture function parameter types | 3.10+ |
| `Concatenate` | Prepend parameters in ParamSpec | 3.10+ |
| `TypeAlias` | Explicit type alias marker | 3.10+ |
| `Annotated` | Attach metadata to type hints | 3.9+ |
| `Required` / `NotRequired` | TypedDict field optionality | 3.11+ |
| `get_type_hints` | Resolve annotations (including forward refs) | 3.5+ |
| `reveal_type` | Debug type inference (runtime version) | 3.11+ |
| `cast` | Tell type checker "trust me, this is type X" | 3.5+ |

### mypy vs pyright Comparison

| Aspect | mypy | pyright |
|---|---|---|
| **Written in** | Python | TypeScript (Node.js) |
| **Speed** | Slower; use `dmypy` daemon for incremental | 5-10x faster; built-in watch mode |
| **Strictness config** | `--strict` + 15+ granular flags | `basic` / `standard` / `strict` presets |
| **IDE integration** | Separate tool; some editor plugins | Powers Pylance in VS Code natively |
| **Type inference** | Conservative — requires more annotations | Aggressive — infers more without hints |
| **Plugin system** | Yes (Django, SQLAlchemy, Pydantic plugins) | No plugin system |
| **Configuration** | `[tool.mypy]` in pyproject.toml | `[tool.pyright]` or pyrightconfig.json |
| **Error messages** | Readable but sometimes vague | Generally more detailed |
| **PEP compliance** | Reference implementation | Sometimes implements proposals before finalization |
| **Best for** | CI pipelines, plugin-heavy projects | Editor-time checking, large codebases needing speed |

**Recommendation:** Use pyright in your editor (via Pylance) for instant feedback, and mypy in CI for authoritative checking. They agree on >95% of cases.

## Next Up

[Module 11 — Standard Library Deep Dives](/python/module-11/) — applying your typing knowledge to the most important modules in Python's standard library.
