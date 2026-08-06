---
title: Module 6 Summary
outline: deep
---

# Module 6 Summary — Error Handling & Context Managers

## Mental Models Gained

1. **Exceptions propagate up, not down.** An exception unwinds the call stack frame by frame until a matching handler is found or the interpreter exits. This is fundamentally different from return values, which travel down.

2. **`BaseException` vs `Exception` is a deliberate firewall.** `KeyboardInterrupt` and `SystemExit` bypass `except Exception:` on purpose. Your broadest safe catch is `except Exception:`, never bare `except:`.

3. **`finally` is the only true guarantee.** It runs after normal exit, after caught exceptions, after uncaught exceptions, and after `return`. But never put `return` inside `finally` — it silently replaces exceptions.

4. **Exception chaining preserves causality.** `raise X from Y` creates an explicit cause chain; implicit chaining records context automatically. `raise X from None` suppresses the chain when the original is an implementation detail.

5. **EAFP is Pythonic when failure is rare.** Attempting the operation and catching the exception is idiomatic Python, avoids race conditions, and is faster than precondition checks when exceptions are uncommon.

6. **`with` is structured `try`/`finally`.** It guarantees `__exit__` runs on every exit path from the block, bundling setup-use-teardown into a single readable construct.

7. **`@contextmanager` splits at `yield`.** Before yield is `__enter__`, after yield is `__exit__`. Always wrap `yield` in `try`/`finally` or cleanup code after `yield` will be skipped on exceptions.

8. **`ExitStack` handles the dynamic case.** When you do not know how many resources you need at write time, `ExitStack` manages them as a LIFO stack with `pop_all()` for ownership transfer.

## Self-Assessment Checklist

Use this to gauge your understanding. If you cannot confidently explain any item, revisit the relevant page.

- [ ] I can draw the exception hierarchy from `BaseException` down through `Exception` to common types, and explain why `KeyboardInterrupt` is not under `Exception`.
- [ ] I can trace the execution order of `try`/`except`/`else`/`finally` in every scenario: no exception, caught exception, uncaught exception, `return` in `try`, `return` in `finally`.
- [ ] I understand the difference between `raise`, `raise X`, `raise X from Y`, and `raise X from None` — and what each sets on `__cause__`, `__context__`, and `__suppress_context__`.
- [ ] I can design a custom exception hierarchy with structured data (error codes, extra fields) for a domain.
- [ ] I can explain exception groups (`ExceptionGroup`, `except*`) and when they are needed (concurrent failures in 3.11+).
- [ ] I know when EAFP is faster/safer than LBYL and can justify the choice for a given scenario.
- [ ] I can implement a context manager as both a class (with `__enter__`/`__exit__`) and a generator (with `@contextmanager`).
- [ ] I understand why `__exit__` is not called if `__enter__` raises, and how to handle partial acquisition.
- [ ] I can use `ExitStack` to manage a dynamic number of resources and explain `pop_all()` for ownership transfer.
- [ ] I can identify the three common production bugs: bare `except:` swallowing `KeyboardInterrupt`, `return` in `finally` discarding exceptions, and generator context managers missing `try`/`finally` around `yield`.

## Quick Reference

### Exception Hierarchy (Simplified)

```
BaseException
├── SystemExit              # sys.exit() — NOT under Exception
├── KeyboardInterrupt       # Ctrl+C — NOT under Exception
├── GeneratorExit           # generator.close() — NOT under Exception
└── Exception               # ← Your broadest safe catch
    ├── ValueError           ├── TypeError
    ├── KeyError             ├── IndexError
    ├── AttributeError       ├── RuntimeError
    ├── OSError              │   └── RecursionError
    │   ├── FileNotFoundError
    │   ├── PermissionError
    │   └── TimeoutError
    ├── StopIteration
    ├── ImportError
    │   └── ModuleNotFoundError
    └── ExceptionGroup (3.11+)
```

### Exception Chaining Quick Reference

| Syntax | `__cause__` | `__context__` | `__suppress_context__` | Traceback message |
|--------|------------|--------------|----------------------|-------------------|
| `raise X from Y` | `Y` | `Y` | `True` | "was the direct cause of" |
| `raise X` (in except) | `None` | original exc | `False` | "During handling...another occurred" |
| `raise X from None` | `None` | original exc | `True` | (chain hidden) |

### Context Manager Protocol

| Method | When called | Arguments | Return value meaning |
|--------|------------|-----------|---------------------|
| `__enter__(self)` | Entering `with` block | None | Becomes the `as` target |
| `__exit__(self, exc_type, exc_val, exc_tb)` | Exiting `with` block (always) | Exception info or three `None`s | `True` = suppress exception |

### `contextlib` Utilities

| Utility | Purpose | Example |
|---------|---------|---------|
| `@contextmanager` | Generator function as context manager | `yield` once, wrap in `try`/`finally` |
| `@asynccontextmanager` | Async generator as async context manager | `async with` compatible |
| `suppress(*exceptions)` | Silently ignore specific exceptions | `with suppress(FileNotFoundError):` |
| `redirect_stdout(target)` | Redirect print output to a buffer | `with redirect_stdout(buf):` |
| `redirect_stderr(target)` | Redirect stderr to a buffer | `with redirect_stderr(buf):` |
| `closing(thing)` | Call `.close()` on exit for non-CM objects | `with closing(legacy_conn):` |
| `ExitStack` | Manage dynamic number of CMs | `.enter_context()`, `.callback()`, `.pop_all()` |
| `AsyncExitStack` | Async version of `ExitStack` | Same API, async context managers |

## What's Next

Continue to [Module 7 — Concurrency](/python/module-07/) to learn how Python handles threads, processes, `asyncio`, and the GIL. Context managers are central to concurrency: `async with` manages async resources, locks are context managers, and `ExitStack` patterns appear in task group management.
