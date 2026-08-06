---
title: Context Managers — The with Statement
outline: deep
---

# Context Managers — The with Statement

Interview weight: 🔥🔥🔥 | Python 3.10+ for parenthesized `with` | Prerequisites: [Module 1 — Data Model](/python/module-01/), [Module 3 — Functions](/python/module-03/), [Exceptions](./01-exceptions.md)

## 🗣️ In Plain English

::: tip In Plain English
Think of a context manager as a hotel's check-in / check-out system. When you arrive at the hotel (enter the `with` block), the front desk gives you a room key — that is the value you get after `as`. You can do whatever you want in your room: sleep, work, make a mess, even accidentally start a small fire. No matter what happens, when you leave the hotel (exit the `with` block), the checkout process runs **automatically**. The room is cleaned, the key is deactivated, and the billing is finalized. You do not have to remember to do any of that yourself.

This is the core guarantee: **cleanup always happens**. If your stay goes perfectly, checkout runs. If you cause a disaster, checkout still runs (though the hotel may also deal with the disaster separately). If you try to sneak out the back door, the system still catches you. There is no path out of the hotel that skips checkout.

Now compare this to a world without the hotel system. You would have to manually call "clean the room" and "deactivate the key" every time you leave. If something goes wrong and you rush out in a panic, you forget to clean up. The room stays dirty. The key stays active. Resources leak.

That is exactly what happens with resources in programming — database connections, open files, network sockets, locks. If you open them manually, you must also close them manually, and you must close them even when errors happen. Without a context manager, you need a `try`/`finally` block every single time, and you *will* forget eventually. The `with` statement packages "open, use, and guarantee-close" into a single construct so the cleanup is impossible to forget.

The real elegance is that the hotel can also **handle the disaster itself**. The checkout system sees the exception (the fire) and can decide: "We dealt with this, no need to escalate" (suppress the exception) or "This is beyond us, pass it to the authorities" (let the exception propagate). Most context managers choose to let exceptions propagate — they just make sure the room is cleaned up first.
:::

## ⚙️ Under the Hood

### The Protocol: `__enter__` and `__exit__`

A context manager is any object that implements two dunder methods:

```python
# run: python3 cm_protocol.py
"""The context manager protocol — __enter__ and __exit__."""

class ManagedResource:
    """A context manager that demonstrates the full protocol."""

    def __init__(self, name: str) -> None:
        self.name = name
        print(f"[{self.name}] __init__ — object created (NOT entered yet)")

    def __enter__(self) -> "ManagedResource":
        """Called when entering the with block. Return value becomes the 'as' target."""
        print(f"[{self.name}] __enter__ — resource acquired")
        return self  # This is what goes into the 'as' variable

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object | None,
    ) -> bool:
        """Called when exiting the with block — ALWAYS, even on exception.

        Args:
            exc_type: Exception class, or None if no exception
            exc_val:  Exception instance, or None
            exc_tb:   Traceback object, or None

        Returns:
            True to suppress the exception, False (or None) to let it propagate.
        """
        if exc_type is not None:
            print(f"[{self.name}] __exit__ — cleaning up after {exc_type.__name__}: {exc_val}")
        else:
            print(f"[{self.name}] __exit__ — cleaning up (no exception)")
        # Return False (default) — do NOT suppress the exception
        return False

    def do_work(self) -> None:
        print(f"[{self.name}] doing work...")


# Normal exit
print("=== Normal exit ===")
with ManagedResource("R1") as r:
    r.do_work()

print()

# Exit with exception
print("=== Exit with exception ===")
try:
    with ManagedResource("R2") as r:
        r.do_work()
        raise ValueError("something broke")
except ValueError:
    print("Exception caught outside the with block")
```

### How `with` Desugars

The `with` statement is syntactic sugar for a `try`/`finally` pattern:

```python
# run: python3 with_desugar.py
"""How the with statement desugars to try/finally."""

class SimpleFile:
    def __init__(self, path: str) -> None:
        self.path = path
        self.handle: object = None

    def __enter__(self) -> "SimpleFile":
        print(f"Opening {self.path}")
        self.handle = f"<file:{self.path}>"
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object | None,
    ) -> bool:
        print(f"Closing {self.path}")
        self.handle = None
        return False


# This:
print("=== with statement ===")
with SimpleFile("/tmp/data.txt") as f:
    print(f"Using {f.handle}")

print()

# Is equivalent to this:
print("=== desugared equivalent ===")
_manager = SimpleFile("/tmp/data.txt")
_value = _manager.__enter__()
_exit = type(_manager).__exit__  # Looked up on the TYPE, not the instance
_exc = True
try:
    try:
        f = _value
        print(f"Using {f.handle}")
    except:
        _exc = False
        if not _exit(_manager, *__import__('sys').exc_info()):
            raise
finally:
    if _exc:
        _exit(_manager, None, None, None)

# Key subtleties:
# 1. __exit__ is looked up on the type (not instance) — like all dunder dispatch
# 2. If __enter__ raises, __exit__ is NOT called
# 3. If __exit__ returns True, the exception is suppressed
```

### Suppressing Exceptions from `__exit__`

```python
# run: python3 exit_suppress.py
"""__exit__ returning True suppresses the exception."""

class ErrorSuppressor:
    """A context manager that suppresses ValueError but lets others propagate."""

    def __enter__(self) -> "ErrorSuppressor":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object | None,
    ) -> bool:
        if exc_type is ValueError:
            print(f"Suppressed ValueError: {exc_val}")
            return True   # Suppress — code continues after the with block
        return False       # Don't suppress — exception propagates normally


# ValueError is suppressed
with ErrorSuppressor():
    raise ValueError("this will be silently caught")
print("Execution continues here!")

# TypeError is NOT suppressed
try:
    with ErrorSuppressor():
        raise TypeError("this will propagate")
except TypeError as e:
    print(f"Caught outside: {e}")
```

### `contextlib.contextmanager` — Generators as Context Managers

Writing a full class for every context manager is verbose. The `contextlib.contextmanager` decorator turns a generator function (that yields exactly once) into a context manager:

```python
# run: python3 contextlib_generator.py
"""contextlib.contextmanager — the Pythonic way to write context managers."""

from contextlib import contextmanager
import time


@contextmanager
def timer(label: str):
    """Time a block of code."""
    # Everything BEFORE yield = __enter__
    start = time.perf_counter()
    print(f"[{label}] Starting timer...")

    try:
        yield start  # This value becomes the 'as' target
        # Everything AFTER yield = __exit__ (normal case)
    except Exception as e:
        # This runs if an exception occurred inside the with block
        elapsed = time.perf_counter() - start
        print(f"[{label}] Failed after {elapsed:.4f}s with {type(e).__name__}: {e}")
        raise  # Re-raise — we just want to time, not suppress
    else:
        elapsed = time.perf_counter() - start
        print(f"[{label}] Completed in {elapsed:.4f}s")


# Normal usage
with timer("computation") as t:
    total = sum(range(1_000_000))
    print(f"  Result: {total}")

print()

# Usage with exception
try:
    with timer("failing-op"):
        raise RuntimeError("oops")
except RuntimeError:
    pass


# How it works internally:
# 1. Decorator wraps the generator in a class with __enter__ and __exit__
# 2. __enter__ calls next(gen) — advancing to the yield, returning yielded value
# 3. __exit__ calls next(gen) again (for normal exit) or gen.throw(exc) (for exception)
# 4. If the generator yields MORE than once → RuntimeError
# 5. If the generator doesn't yield at all → RuntimeError


@contextmanager
def temp_config(key: str, value: str):
    """Temporarily set a config value, restore on exit."""
    config: dict[str, str] = {"debug": "false", "log_level": "info"}
    original = config.get(key)
    config[key] = value
    print(f"  Config[{key}] = {value!r}")

    try:
        yield config
    finally:
        # finally ensures restoration even on exception
        if original is None:
            del config[key]
        else:
            config[key] = original
        print(f"  Config[{key}] restored to {original!r}")


with temp_config("debug", "true") as cfg:
    print(f"  Inside: {cfg}")
```

### `contextlib` Utilities

```python
# run: python3 contextlib_utils.py
"""contextlib utilities: suppress, redirect_stdout, closing."""

from contextlib import suppress, redirect_stdout, redirect_stderr, closing
import io


# 1. suppress(*exceptions) — cleaner than try/except/pass
# Instead of:
try:
    result = int("abc")
except ValueError:
    pass

# Write:
with suppress(ValueError):
    result = int("abc")
# Execution continues here — no exception raised
print("suppress: ValueError was silently ignored")

# Multiple exception types:
with suppress(FileNotFoundError, PermissionError):
    with open("/nonexistent/file.txt") as f:
        data = f.read()
print("suppress: FileNotFoundError was silently ignored")


# 2. redirect_stdout — capture print output
buffer = io.StringIO()
with redirect_stdout(buffer):
    print("This goes to the buffer, not the terminal")
    print("So does this")

captured = buffer.getvalue()
print(f"Captured {len(captured)} chars: {captured.strip()!r}")


# 3. redirect_stderr — same for stderr
err_buffer = io.StringIO()
with redirect_stderr(err_buffer):
    import sys
    print("Error message!", file=sys.stderr)
print(f"Captured stderr: {err_buffer.getvalue().strip()!r}")


# 4. closing — wraps objects that have .close() but not __exit__
class LegacyConnection:
    """A class with .close() but no context manager protocol."""
    def __init__(self, url: str) -> None:
        self.url = url
        self.is_open = True
        print(f"  Opened connection to {url}")

    def close(self) -> None:
        self.is_open = False
        print(f"  Closed connection to {self.url}")

    def query(self, sql: str) -> str:
        return f"<result of '{sql}'>"


with closing(LegacyConnection("db://localhost")) as conn:
    print(f"  Query result: {conn.query('SELECT 1')}")
# .close() called automatically
```

### `contextlib.ExitStack` — Dynamic Resource Management

`ExitStack` manages a variable number of context managers and cleanup callbacks, entered and exited as a stack (LIFO):

```python
# run: python3 exit_stack.py
"""ExitStack — managing a dynamic/variable number of resources."""

from contextlib import ExitStack, contextmanager


@contextmanager
def managed_file(name: str):
    """Simulate opening a file."""
    print(f"  Opening {name}")
    try:
        yield f"<handle:{name}>"
    finally:
        print(f"  Closing {name}")


# Problem: how do you open N files where N is not known at write time?
# You can't write: with open(f1) as a, open(f2) as b, ...

filenames = ["data1.csv", "data2.csv", "data3.csv"]

with ExitStack() as stack:
    # Enter context managers dynamically
    handles = [
        stack.enter_context(managed_file(name))
        for name in filenames
    ]
    print(f"  All handles: {handles}")
    print("  Processing all files...")

# All files closed in reverse order (LIFO)
print()

# ExitStack also supports cleanup callbacks
print("=== Callbacks ===")
with ExitStack() as stack:
    # Register a callback that runs on exit
    stack.callback(print, "  Callback 3 (registered last, runs first)")
    stack.callback(print, "  Callback 2")
    stack.callback(print, "  Callback 1 (registered first, runs last)")
    print("  Inside the with block")

print()

# Advanced: pop_all() — transfer ownership
print("=== pop_all() for resource transfer ===")
def acquire_resources() -> tuple[ExitStack, list[str]]:
    """Acquire resources, return them for the caller to manage."""
    with ExitStack() as stack:
        handles = []
        handles.append(stack.enter_context(managed_file("important.dat")))
        handles.append(stack.enter_context(managed_file("index.dat")))
        # Transfer ownership: caller must close these
        transferred = stack.pop_all()
        print("  Resources transferred, original stack will NOT close them")
        return transferred, handles

# Caller manages the resources
new_stack, handles = acquire_resources()
print(f"  Caller has: {handles}")
new_stack.close()  # NOW they get closed
```

### Nested `with` Statements

```python
# run: python3 nested_with.py
"""Nested with statements and the parenthesized form (3.10+)."""

from contextlib import contextmanager


@contextmanager
def resource(name: str):
    print(f"  Enter {name}")
    try:
        yield name
    finally:
        print(f"  Exit {name}")


# Classic nesting — two ways:

# 1. Comma-separated (single line)
with resource("A") as a, resource("B") as b:
    print(f"  Using {a} and {b}")
print()

# 2. Parenthesized form (Python 3.10+) — for readability with many managers
with (
    resource("X") as x,
    resource("Y") as y,
    resource("Z") as z,
):
    print(f"  Using {x}, {y}, {z}")
print()

# Order matters: entered left-to-right, exited right-to-left (LIFO)
# If B's __enter__ raises, A's __exit__ is still called
print("=== Error during entry ===")

@contextmanager
def failing_resource(name: str):
    print(f"  Enter {name}")
    if name == "BAD":
        raise RuntimeError(f"{name} failed to initialize!")
    try:
        yield name
    finally:
        print(f"  Exit {name}")

try:
    with resource("GOOD") as g, failing_resource("BAD") as b:
        print("This never executes")
except RuntimeError as e:
    print(f"  Caught: {e}")
# GOOD's __exit__ was still called!
```

### Async Context Managers

```python
# run: python3 async_cm.py
"""Async context managers: async with, __aenter__, __aexit__."""

import asyncio
from contextlib import asynccontextmanager


# Class-based async context manager
class AsyncDBConnection:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self.connected = False

    async def __aenter__(self) -> "AsyncDBConnection":
        # Simulate async connection setup
        await asyncio.sleep(0.01)
        self.connected = True
        print(f"  Connected to {self.dsn}")
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: object | None,
    ) -> bool:
        # Simulate async disconnect
        await asyncio.sleep(0.01)
        self.connected = False
        print(f"  Disconnected from {self.dsn}")
        return False

    async def execute(self, query: str) -> str:
        if not self.connected:
            raise RuntimeError("Not connected")
        await asyncio.sleep(0.01)
        return f"<result of '{query}'>"


# Generator-based async context manager
@asynccontextmanager
async def async_transaction(conn: AsyncDBConnection):
    """Wrap a block in a database transaction."""
    await conn.execute("BEGIN")
    print("  Transaction started")
    try:
        yield conn
        await conn.execute("COMMIT")
        print("  Transaction committed")
    except Exception:
        await conn.execute("ROLLBACK")
        print("  Transaction rolled back")
        raise


async def main() -> None:
    # async with — same semantics as with, but __aenter__/__aexit__ are awaited
    async with AsyncDBConnection("postgresql://localhost/mydb") as db:
        result = await db.execute("SELECT 1")
        print(f"  Query result: {result}")

        # Nested async context managers
        async with async_transaction(db) as tx:
            await tx.execute("INSERT INTO users VALUES ('Alice')")
            print("  Insert completed")

    print()

    # Transaction rollback on error
    print("=== Rollback scenario ===")
    try:
        async with AsyncDBConnection("postgresql://localhost/mydb") as db:
            async with async_transaction(db) as tx:
                await tx.execute("INSERT INTO users VALUES ('Bob')")
                raise ValueError("Validation failed!")
    except ValueError:
        print("  Error handled outside")


asyncio.run(main())
```

### Common Patterns

```python
# run: python3 cm_patterns.py
"""Real-world context manager patterns."""

from contextlib import contextmanager
import time
import threading
import os
import tempfile
import shutil


# Pattern 1: Timing block
@contextmanager
def timed(label: str):
    start = time.perf_counter()
    yield
    elapsed = time.perf_counter() - start
    print(f"[{label}] {elapsed:.4f}s")


with timed("sum"):
    total = sum(range(10_000_000))


# Pattern 2: Temporary directory that auto-cleans
@contextmanager
def temp_workspace(prefix: str = "work_"):
    """Create a temporary directory, clean it up on exit."""
    path = tempfile.mkdtemp(prefix=prefix)
    print(f"  Created temp dir: {path}")
    try:
        yield path
    finally:
        shutil.rmtree(path)
        print(f"  Cleaned up temp dir: {path}")


with temp_workspace("test_") as workspace:
    # Create some files
    test_file = os.path.join(workspace, "data.txt")
    with open(test_file, "w") as f:
        f.write("test data")
    print(f"  Wrote to: {test_file}")
# Directory and all contents deleted
print()


# Pattern 3: Lock acquisition
@contextmanager
def acquire_lock(lock: threading.Lock, timeout: float = 5.0):
    """Acquire a lock with timeout, guaranteed release."""
    acquired = lock.acquire(timeout=timeout)
    if not acquired:
        raise TimeoutError(f"Could not acquire lock within {timeout}s")
    print("  Lock acquired")
    try:
        yield
    finally:
        lock.release()
        print("  Lock released")


lock = threading.Lock()
with acquire_lock(lock):
    print("  Doing work under lock")


# Pattern 4: Database transaction (mock)
@contextmanager
def transaction(conn_name: str):
    """Commit on success, rollback on failure."""
    print(f"  [{conn_name}] BEGIN")
    try:
        yield conn_name
        print(f"  [{conn_name}] COMMIT")
    except Exception:
        print(f"  [{conn_name}] ROLLBACK")
        raise


print()
# Success case
with transaction("db1") as conn:
    print(f"  [{conn}] INSERT INTO ...")

print()
# Failure case
try:
    with transaction("db2") as conn:
        print(f"  [{conn}] INSERT INTO ...")
        raise RuntimeError("constraint violation")
except RuntimeError:
    print("  Error handled outside transaction")


# Pattern 5: Temporary environment variable
@contextmanager
def env_var(key: str, value: str):
    """Temporarily set an environment variable."""
    original = os.environ.get(key)
    os.environ[key] = value
    try:
        yield
    finally:
        if original is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original


print()
print(f"  DEBUG before: {os.environ.get('DEBUG', 'not set')}")
with env_var("DEBUG", "true"):
    print(f"  DEBUG inside: {os.environ.get('DEBUG')}")
print(f"  DEBUG after:  {os.environ.get('DEBUG', 'not set')}")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Forgetting that `__enter__` failure skips `__exit__`**

Symptom: a resource partially acquired during `__init__` or the first half of `__enter__` leaks when the second half of `__enter__` raises. Root cause: Python only calls `__exit__` if `__enter__` completed successfully. If your `__enter__` opens a socket on line 1 and then raises on line 3, the socket is never closed. Fix: acquire resources in `__init__` and use `__enter__` only for the "activate" step, or use `ExitStack` inside `__enter__` to register partial cleanup that rolls back if `__enter__` fails.

**2. Generator context manager without `try`/`finally`**

Symptom: resources leak when an exception occurs inside the `with` block. Root cause: a `@contextmanager` generator has its cleanup code after `yield` but without a `finally` clause. If the `with` block raises, Python calls `gen.throw()`, but if the generator does not handle the exception, the code after `yield` never runs. Fix: always wrap `yield` in `try`/`finally` inside `@contextmanager` generators. The cleanup goes in `finally`, not after a bare `yield`.

```python
# WRONG:
@contextmanager
def bad():
    conn = connect()
    yield conn
    conn.close()  # SKIPPED on exception!

# RIGHT:
@contextmanager
def good():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()  # Always runs
```

**3. Suppressing exceptions accidentally in `__exit__`**

Symptom: exceptions vanish silently. The code after the `with` block runs as if nothing went wrong, but data is corrupted or incomplete. Root cause: `__exit__` returns a truthy value (sometimes accidentally — e.g., returning the result of a function call that happens to return a non-empty string). Python interprets any truthy return from `__exit__` as "suppress the exception." Fix: always explicitly return `False` (or return nothing) from `__exit__` unless you specifically intend to suppress. Review your `__exit__` for accidental truthy returns.

:::

## 🎯 Checkpoint

::: details Question 1 — The protocol contract
**Q:** If `__enter__` raises an exception, does `__exit__` get called? What about if the body of the `with` block raises? Explain why this asymmetry exists.

**A:** If `__enter__` raises, `__exit__` is **not** called. If the body raises, `__exit__` **is** called. The asymmetry exists because `__exit__` is the cleanup for a resource that was *successfully acquired* by `__enter__`. If `__enter__` never completed, there is nothing to clean up — or worse, calling `__exit__` on a half-initialized resource could raise a secondary error. This is why resources that need partial-acquisition cleanup must handle it internally (e.g., with `ExitStack` inside `__enter__`, or by wrapping the acquisition in `try`/`except` within `__enter__` itself). The `with` statement desugars to: call `__enter__`, and only if it succeeds, set up `__exit__` in a `finally`.
:::

::: details Question 2 — Generator context managers and exceptions
**Q:** What happens if a `@contextmanager` generator catches the exception thrown via `gen.throw()` and then yields a second time?

**A:** Python raises a `RuntimeError` with the message "generator didn't stop after throw()." The `@contextmanager` contract requires the generator to yield **exactly once**. After `__enter__` calls `next(gen)` to advance to the first yield, `__exit__` either calls `next(gen)` (normal exit) or `gen.throw(exc_type, exc_val, exc_tb)` (exception exit). In both cases, the generator must finish (raise `StopIteration`) after that. If the generator catches the thrown exception and yields again, the `_GeneratorContextManager.__exit__` implementation detects this and raises `RuntimeError`. This prevents the generator from remaining alive and potentially leaking state.
:::

::: details Question 3 — ExitStack and pop_all
**Q:** Explain what `ExitStack.pop_all()` does and give a use case.

**A:** `pop_all()` creates a **new** `ExitStack` instance and transfers all registered context managers and callbacks from the original stack to the new one. The original stack is left empty, so when the original `with` block exits, no cleanup runs. The caller now owns the new stack and must close it explicitly (or use it in another `with` block). The primary use case is **resource acquisition factories**: a function opens several resources inside an `ExitStack`, and if all acquisitions succeed, it transfers them to the caller via `pop_all()`. If any acquisition fails, the original `ExitStack.__exit__` cleans up everything acquired so far. This gives you all-or-nothing semantics: either all resources are acquired and transferred, or all are cleaned up on failure.
:::

## Key Mental Models

- **`with` is `try`/`finally` with structure.** It guarantees cleanup runs, but bundles the setup, use, and teardown into one readable construct.
- **`__exit__` receives the exception but does not have to handle it.** Return `False` to let it propagate (the default); return `True` only to deliberately suppress it.
- **`@contextmanager` splits a generator at `yield`.** Before yield is `__enter__`, after yield is `__exit__`. Always wrap `yield` in `try`/`finally`.
- **`ExitStack` is your dynamic context manager.** Use it when the number of resources is not known at write time, or when you need to transfer resource ownership between scopes.
- **If `__enter__` fails, `__exit__` never runs.** Partial acquisition must be handled internally, not relied upon from the `with` machinery.

## Related

- [Exceptions — The Full Picture](./01-exceptions.md) — `__exit__` receives exception info as its parameters; understanding `try`/`except`/`finally` is prerequisite to understanding how `with` desugars.
- [Module 5 — Generators](/python/module-05/) — `contextlib.contextmanager` is a generator decorator; understanding `yield`, `send()`, and `throw()` explains how generator-based context managers work.
- [Module 4 — OOP & Descriptors](/python/module-04/) — context managers are built on the dunder method protocol; `__enter__` and `__exit__` follow the same dispatch rules as `__getattr__`, `__setattr__`, etc.
