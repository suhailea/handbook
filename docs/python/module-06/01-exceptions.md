---
title: Exceptions — The Full Picture
outline: deep
---

# Exceptions — The Full Picture

Interview weight: 🔥🔥🔥 | Python 3.11+ for exception groups | Prerequisites: [Module 1 — Data Model](/python/module-01/), [Module 3 — Functions](/python/module-03/)

## 🗣️ In Plain English

::: tip In Plain English
Imagine a tall office building where each floor is a function in your program. The ground floor is your `main()`, the second floor is a function `main` called, the third floor is a function *that* function called, and so on. Normal work flows downward: the ground floor asks the second floor to do something, the second floor delegates to the third, and results travel back down.

Now something goes wrong on floor five. A file is missing. The clerk on floor five does not just shrug and return a guess — that would hide the problem. Instead, she pulls the fire alarm. That alarm is an **exception**. It does not travel down through normal channels. It **screams upward** through every floor, interrupting whatever each floor was doing, until someone is trained to handle that particular alarm.

Maybe floor three has a fire team for "missing file" alarms. They catch it, handle it (perhaps by using a default file), and work resumes normally from floor three down. But if *nobody* catches the alarm — if it reaches the lobby — the building shuts down. The program crashes, and Python prints the full trail of which floors the alarm passed through (the **traceback**).

Here is the important part: there are two kinds of alarms. Most alarms are for problems you *can* recover from — a missing file, a bad number, a network timeout. These are all **Exception** alarms. But a few alarms are for **evacuations**: someone pressed Ctrl+C (the "everybody out" button) or the program decided to exit on purpose. These evacuation alarms (`KeyboardInterrupt`, `SystemExit`) bypass the normal fire teams. If you write a handler that catches *every* alarm, including evacuations, you are blocking the exits. That is why Python separates "catchable problems" from "system-level signals" in its alarm hierarchy — and why you should almost never catch the evacuation alarms.

The cost of this system is almost nothing when things go well. Setting up the fire alarm hardware on each floor (the `try` block) is nearly free. The expensive part is actually *pulling* the alarm (raising an exception) — that is when Python has to unwind the stack, build a traceback object, and search for handlers. So you should not use exceptions as everyday communication ("no more items" should not be a fire alarm on every floor) — except that Python actually *does* use `StopIteration` this way inside `for` loops, which is why the loop machinery catches it at the C level for speed.
:::

## ⚙️ Under the Hood

### The Exception Hierarchy

Every exception in Python is an instance of a class that inherits from `BaseException`. The hierarchy is deliberately split:

```
BaseException
├── SystemExit
├── KeyboardInterrupt
├── GeneratorExit
└── Exception
    ├── StopIteration
    ├── StopAsyncIteration
    ├── ArithmeticError
    │   ├── FloatingPointError
    │   ├── OverflowError
    │   └── ZeroDivisionError
    ├── AssertionError
    ├── AttributeError
    ├── BufferError
    ├── EOFError
    ├── ImportError
    │   └── ModuleNotFoundError
    ├── LookupError
    │   ├── IndexError
    │   └── KeyError
    ├── MemoryError
    ├── NameError
    │   └── UnboundLocalError
    ├── OSError
    │   ├── FileNotFoundError
    │   ├── PermissionError
    │   ├── TimeoutError
    │   └── ... (many more)
    ├── RuntimeError
    │   └── RecursionError
    ├── TypeError
    ├── ValueError
    │   └── UnicodeError
    └── Warning
        ├── DeprecationWarning
        └── ...
```

The critical design decision: `KeyboardInterrupt`, `SystemExit`, and `GeneratorExit` inherit from `BaseException` directly, **not** from `Exception`. This means `except Exception:` will not catch them — which is exactly right, because these represent signals to *stop*, not errors to recover from.

```python
# run: python3 exception_hierarchy.py
"""Demonstrate that except Exception does not catch KeyboardInterrupt."""

import sys

# This is SAFE — it only catches recoverable errors
try:
    result = int("not_a_number")
except Exception as e:
    print(f"Caught: {type(e).__name__}: {e}")

# Verify hierarchy
print(f"KeyboardInterrupt is BaseException? {issubclass(KeyboardInterrupt, BaseException)}")
print(f"KeyboardInterrupt is Exception?     {issubclass(KeyboardInterrupt, Exception)}")
print(f"ValueError is Exception?            {issubclass(ValueError, Exception)}")
print(f"ValueError is BaseException?        {issubclass(ValueError, BaseException)}")

# Show the MRO (method resolution order) for a specific exception
print(f"\nFileNotFoundError MRO:")
for cls in FileNotFoundError.__mro__:
    print(f"  {cls.__name__}")
```

### try / except / else / finally — Full Execution Flow

The complete form of error handling in Python has four clauses. Understanding when each runs is essential:

```python
# run: python3 try_flow.py
"""Every scenario of try/except/else/finally execution."""

def scenario(name: str, action: str) -> str:
    """Demonstrate execution flow for different outcomes."""
    result_log: list[str] = []

    try:
        result_log.append("try-start")
        if action == "succeed":
            value = 42
        elif action == "value_error":
            raise ValueError("bad value")
        elif action == "type_error":
            raise TypeError("bad type")
        elif action == "return_in_try":
            result_log.append("returning-from-try")
            return f"[{name}] " + ", ".join(result_log) + ", finally"
        result_log.append("try-end")
    except ValueError:
        result_log.append("except-ValueError")
    except TypeError:
        result_log.append("except-TypeError")
        raise  # Re-raise — finally STILL runs
    else:
        # Runs ONLY when try completed without any exception
        result_log.append("else")
    finally:
        # ALWAYS runs — exception or not, return or not
        result_log.append("finally")

    return f"[{name}] " + ", ".join(result_log)


# Scenario 1: No exception
print(scenario("no-error", "succeed"))
# [no-error] try-start, try-end, else, finally

# Scenario 2: Caught exception
print(scenario("caught", "value_error"))
# [caught] try-start, except-ValueError, finally
# Note: else did NOT run

# Scenario 3: Return inside try — finally still executes
print(scenario("return-in-try", "return_in_try"))
# [return-in-try] try-start, returning-from-try, finally

# Scenario 4: Uncaught exception — finally still runs, then exception propagates
try:
    print(scenario("uncaught-re-raise", "type_error"))
except TypeError:
    print("[uncaught-re-raise] ...exception propagated after finally")
```

**Key rules:**
- `else` runs only if the `try` block completed with no exception — it is *not* a catch-all.
- `finally` runs **always**: after normal completion, after an exception (caught or not), after a `return`, `break`, or `continue` inside `try`.
- If both `try` and `finally` contain `return`, the `finally` return **wins** (and silently discards the `try` return — a subtle bug source).

```python
# run: python3 finally_return_trap.py
"""The finally-return trap: finally's return silently replaces try's return."""

def dangerous() -> str:
    try:
        return "from try"
    finally:
        return "from finally"  # This REPLACES the try return!

print(dangerous())  # "from finally" — the try's return is lost

# Even worse: finally can swallow exceptions silently
def swallows_exception() -> str:
    try:
        raise ValueError("important error!")
    finally:
        return "from finally"  # Exception is silently discarded!

print(swallows_exception())  # "from finally" — no error raised!
# This is why linters (ruff, pylint) warn about return-in-finally.
```

### Catching Multiple Exceptions

```python
# run: python3 multiple_except.py
"""Different ways to catch multiple exception types."""

# Approach 1: Tuple of exceptions in one except clause
# Use when you handle them the same way
def parse_config(raw: str) -> dict[str, str]:
    try:
        key, value = raw.split("=")
        return {key.strip(): value.strip()}
    except (ValueError, AttributeError) as e:
        # ValueError: not enough values to unpack
        # AttributeError: raw is not a string (no .split)
        print(f"Config parse error ({type(e).__name__}): {e}")
        return {}

# Approach 2: Separate except blocks
# Use when you handle them differently
def process(data: object) -> int:
    try:
        return int(str(data))  # type: ignore[arg-type]
    except ValueError:
        print("Not a valid integer string, defaulting to 0")
        return 0
    except TypeError:
        print("Cannot convert to string at all, defaulting to -1")
        return -1

print(parse_config("name = Alice"))
print(parse_config("no-equals-sign"))

# NEVER do this — bare except catches BaseException (including KeyboardInterrupt!)
# try:
#     something()
# except:          # Catches SystemExit, KeyboardInterrupt — DANGEROUS
#     pass

# If you truly need to catch "everything recoverable":
# except Exception as e:   # This is the correct way
```

### raise — Raising and Re-raising

```python
# run: python3 raise_semantics.py
"""raise with/without arguments and re-raising."""

import traceback

# Basic raise
def validate_age(age: int) -> None:
    if age < 0:
        raise ValueError(f"Age cannot be negative, got {age}")
    if age > 150:
        raise ValueError(f"Age unrealistically high: {age}")

# Re-raise: preserves the original traceback
def process_record(record: dict[str, int]) -> None:
    try:
        validate_age(record["age"])
    except ValueError:
        print("Logging the error...")
        raise  # Re-raises the SAME exception with its ORIGINAL traceback

# Compare: raise vs raise new
def bad_reraise(record: dict[str, int]) -> None:
    try:
        validate_age(record["age"])
    except ValueError as e:
        # This creates a NEW exception — you lose the original traceback!
        raise ValueError(f"Validation failed: {e}")
        # Better: raise ValueError(...) from e  (see chaining below)

try:
    process_record({"age": -5})
except ValueError:
    print("Re-raised exception caught at top level")
    traceback.print_exc()
    print()

# raise without an active exception → RuntimeError
try:
    raise  # No active exception to re-raise
except RuntimeError as e:
    print(f"Got RuntimeError: {e}")
```

### Exception Chaining

Python has two forms of exception chaining, both recorded as attributes on the exception object:

```python
# run: python3 exception_chaining.py
"""Explicit and implicit exception chaining."""

# 1. EXPLICIT chaining: raise X from Y
#    Sets __cause__ on the new exception
#    Traceback shows: "The above exception was the direct cause of..."

class DatabaseError(Exception):
    pass

class UserNotFoundError(Exception):
    def __init__(self, user_id: int) -> None:
        self.user_id = user_id
        super().__init__(f"User {user_id} not found")

def get_user(user_id: int) -> dict[str, str]:
    try:
        # Simulate a low-level DB error
        raise ConnectionError("connection refused on port 5432")
    except ConnectionError as e:
        # Wrap the low-level error in a domain-specific one
        raise DatabaseError(f"Failed to fetch user {user_id}") from e

try:
    get_user(42)
except DatabaseError as e:
    print(f"Caught: {e}")
    print(f"__cause__: {e.__cause__}")        # The explicit cause
    print(f"__context__: {e.__context__}")     # Also set (same as cause here)
    print(f"__suppress_context__: {e.__suppress_context__}")  # True with 'from'
    print()

# 2. IMPLICIT chaining: exception raised inside an except block
#    Sets __context__ but NOT __cause__
#    Traceback shows: "During handling of the above exception, another occurred"

def implicit_chain() -> None:
    try:
        int("abc")
    except ValueError:
        # Oops — a bug in the error handler itself
        result = {}
        print(result["missing_key"])  # KeyError during handling of ValueError

try:
    implicit_chain()
except KeyError as e:
    print(f"Caught: {type(e).__name__}: {e}")
    print(f"__cause__: {e.__cause__}")       # None — not explicitly chained
    print(f"__context__: {e.__context__}")   # The original ValueError
    print()

# 3. SUPPRESSING the chain: raise X from None
#    When you want a clean traceback without the "during handling" noise

def clean_error() -> None:
    try:
        data = {"name": "Alice"}
        _ = data["age"]
    except KeyError:
        raise ValueError("Missing required field: age") from None

try:
    clean_error()
except ValueError as e:
    print(f"Caught: {e}")
    print(f"__cause__: {e.__cause__}")       # None — explicitly suppressed
    print(f"__context__: {e.__context__}")   # None — suppressed
    print(f"__suppress_context__: {e.__suppress_context__}")  # True
```

### Custom Exception Classes

Well-designed custom exceptions carry structured data, not just a message string:

```python
# run: python3 custom_exceptions.py
"""Custom exception design patterns."""

from dataclasses import dataclass
from enum import Enum


# Pattern 1: Simple hierarchy for a domain
class PaymentError(Exception):
    """Base class for all payment-related errors."""
    pass

class InsufficientFundsError(PaymentError):
    def __init__(self, account_id: str, required: float, available: float) -> None:
        self.account_id = account_id
        self.required = required
        self.available = available
        self.shortfall = required - available
        super().__init__(
            f"Account {account_id}: need {required:.2f}, "
            f"have {available:.2f} (short {self.shortfall:.2f})"
        )

class PaymentDeclinedError(PaymentError):
    def __init__(self, reason_code: str, message: str) -> None:
        self.reason_code = reason_code
        super().__init__(f"[{reason_code}] {message}")


# Pattern 2: Enum-based error codes (great for APIs)
class ErrorCode(Enum):
    VALIDATION = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    CONFLICT = "CONFLICT"
    RATE_LIMITED = "RATE_LIMITED"

class AppError(Exception):
    def __init__(self, code: ErrorCode, message: str, details: dict[str, object] | None = None) -> None:
        self.code = code
        self.details = details or {}
        super().__init__(message)

    def to_dict(self) -> dict[str, object]:
        """Serialize for API error responses."""
        return {
            "error": self.code.value,
            "message": str(self),
            "details": self.details,
        }


# Usage
try:
    raise InsufficientFundsError("ACC-123", required=100.0, available=42.50)
except PaymentError as e:
    # Catch ANY payment error — InsufficientFunds or Declined
    print(f"Payment failed: {e}")
    if isinstance(e, InsufficientFundsError):
        print(f"  Shortfall: ${e.shortfall:.2f}")

try:
    raise AppError(
        ErrorCode.VALIDATION,
        "Invalid email address",
        details={"field": "email", "value": "not-an-email"},
    )
except AppError as e:
    print(f"\nAPI Error: {e.to_dict()}")
```

### Exception Groups (Python 3.11+)

Exception groups let you raise and handle **multiple exceptions simultaneously** — essential for concurrent code where several tasks can fail at once:

```python
# run: python3 exception_groups.py
"""ExceptionGroup and except* — handling multiple concurrent errors."""

import sys

# Requires Python 3.11+
if sys.version_info < (3, 11):
    print("This example requires Python 3.11+")
    sys.exit(0)

# Creating an ExceptionGroup
def fetch_all(urls: list[str]) -> list[str]:
    """Simulate fetching multiple URLs where some fail."""
    errors: list[Exception] = []
    results: list[str] = []

    for url in urls:
        try:
            if "bad" in url:
                raise ConnectionError(f"Cannot reach {url}")
            if "invalid" in url:
                raise ValueError(f"Invalid URL format: {url}")
            results.append(f"<content from {url}>")
        except Exception as e:
            errors.append(e)

    if errors:
        raise ExceptionGroup("Multiple fetch failures", errors)
    return results


# except* handles specific exception TYPES within the group
try:
    fetch_all(["https://good.com", "https://bad.com", "https://invalid://x"])
except* ConnectionError as eg:
    # eg is an ExceptionGroup containing only the ConnectionErrors
    print(f"Connection errors ({len(eg.exceptions)}):")
    for e in eg.exceptions:
        print(f"  - {e}")
except* ValueError as eg:
    # This clause handles the ValueErrors — BOTH clauses can match!
    print(f"Validation errors ({len(eg.exceptions)}):")
    for e in eg.exceptions:
        print(f"  - {e}")

print()

# ExceptionGroups can be NESTED
nested = ExceptionGroup("outer", [
    ValueError("v1"),
    ExceptionGroup("inner", [
        TypeError("t1"),
        TypeError("t2"),
    ]),
])

# .subgroup() filters by type (returns a new group or None)
type_errors = nested.subgroup(TypeError)
print(f"TypeErrors found: {type_errors}")

# .derive() creates a new group with the same message but different exceptions
print(f"Original message: {nested.args[0]}")

# Key rules:
# 1. except* can match multiple clauses for the same ExceptionGroup
# 2. except* CANNOT be mixed with regular except in the same try block
# 3. ExceptionGroup is itself an Exception (not BaseException)
# 4. BaseExceptionGroup exists for groups containing BaseException subclasses
```

### Performance of Exceptions

```python
# run: python3 exception_perf.py
"""Exceptions: nearly free to set up, expensive to raise."""

import time

ITERATIONS = 1_000_000

# Measure cost of try/except when NO exception occurs
def with_try() -> int:
    total = 0
    for i in range(ITERATIONS):
        try:
            total += i
        except ValueError:
            pass
    return total

def without_try() -> int:
    total = 0
    for i in range(ITERATIONS):
        total += i
    return total

# Measure cost of actually RAISING an exception
def with_raising() -> int:
    total = 0
    for i in range(ITERATIONS):
        try:
            raise ValueError("oops")
        except ValueError:
            total += i
    return total

# LBYL (Look Before You Leap) vs EAFP (Easier to Ask Forgiveness)
sample_dict: dict[str, int] = {"a": 1, "b": 2, "c": 3}

def lbyl_lookup(key: str) -> int:
    """Check first, then access."""
    if key in sample_dict:
        return sample_dict[key]
    return -1

def eafp_lookup(key: str) -> int:
    """Try first, handle failure."""
    try:
        return sample_dict[key]
    except KeyError:
        return -1

# Time each approach
for label, func in [
    ("without try", without_try),
    ("with try (no raise)", with_try),
    ("with raise+catch", with_raising),
]:
    start = time.perf_counter()
    func()
    elapsed = time.perf_counter() - start
    print(f"{label:25s}: {elapsed:.4f}s")

# LBYL vs EAFP — when key EXISTS (common case)
for label, func in [("LBYL (key exists)", lambda: lbyl_lookup("a")),
                     ("EAFP (key exists)", lambda: eafp_lookup("a"))]:
    start = time.perf_counter()
    for _ in range(ITERATIONS):
        func()
    elapsed = time.perf_counter() - start
    print(f"{label:25s}: {elapsed:.4f}s")

# LBYL vs EAFP — when key is MISSING (exception path)
for label, func in [("LBYL (key missing)", lambda: lbyl_lookup("z")),
                     ("EAFP (key missing)", lambda: eafp_lookup("z"))]:
    start = time.perf_counter()
    for _ in range(ITERATIONS):
        func()
    elapsed = time.perf_counter() - start
    print(f"{label:25s}: {elapsed:.4f}s")

print()
print("Key insight: EAFP wins when exceptions are RARE (the common case).")
print("LBYL wins when the 'exceptional' case is actually frequent.")
```

### LBYL vs EAFP

Python's cultural idiom strongly favors EAFP — "Easier to Ask Forgiveness than Permission." Instead of checking preconditions before an operation (LBYL — "Look Before You Leap"), you attempt the operation and handle the exception if it fails.

```python
# run: python3 lbyl_vs_eafp.py
"""LBYL vs EAFP — Python's preferred style and when to break the rule."""

import os

# LBYL — check first, then act
# Problem: race condition! File could be deleted between check and open.
def read_file_lbyl(path: str) -> str | None:
    if os.path.exists(path):         # Check
        with open(path) as f:        # Act — but file might be gone!
            return f.read()
    return None

# EAFP — try it, handle failure
# No race condition. Atomic from the perspective of error handling.
def read_file_eafp(path: str) -> str | None:
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        return None

# EAFP with dict access
user = {"name": "Alice", "email": "alice@example.com"}

# LBYL
if "phone" in user:
    phone = user["phone"]
else:
    phone = "N/A"

# EAFP (Pythonic)
try:
    phone = user["phone"]
except KeyError:
    phone = "N/A"

# Even more Pythonic — .get() is EAFP baked into the API
phone = user.get("phone", "N/A")

# EAFP with type conversions
def safe_int(value: str) -> int | None:
    try:
        return int(value)
    except (ValueError, TypeError):
        return None

print(f"safe_int('42') = {safe_int('42')}")
print(f"safe_int('abc') = {safe_int('abc')}")

# When LBYL is BETTER:
# 1. When the exception would be raised very frequently (performance)
# 2. When the "try" has side effects you cannot undo
# 3. When the check itself is the point (validation)
print("\nRule of thumb: EAFP when failure is rare; LBYL when failure is common.")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Bare `except:` swallowing `KeyboardInterrupt`**

Symptom: your service is unresponsive to Ctrl+C during local development, or the container ignores SIGINT during shutdown. Root cause: a bare `except:` or `except BaseException:` somewhere in the call stack is catching `KeyboardInterrupt` and suppressing it. This is especially insidious in background workers with retry loops — the loop catches every exception and retries forever, preventing graceful shutdown. Fix: always use `except Exception:` as your broadest catch. If you must handle `KeyboardInterrupt`, do so in an explicit separate clause.

**2. Exception in `except` block — losing the original error**

Symptom: your logs show a `KeyError` or `AttributeError` in the error handler itself, and the *real* error that triggered the handler is buried in the `__context__` chain or lost entirely. Root cause: the `except` block has a bug (typo in variable name, missing dict key) that raises a new exception. Python records the original via implicit chaining (`__context__`), but if the second exception is also caught upstream by a generic handler, the original error message is gone from the logs. Fix: keep `except` blocks minimal. Log the exception immediately. If you do further processing, wrap it in its own `try`/`except`.

**3. `return` in `finally` silently discarding exceptions**

Symptom: a function that should raise an error returns `None` or a default value instead. No traceback in logs. Root cause: a `return` statement inside `finally` silently replaces the exception with the return value. The exception is not re-raised, not logged, just gone. This can also happen with `break` or `continue` in `finally`. Fix: never put `return` in `finally`. Use `else` for the success path. Modern linters (ruff B012, pylint) flag this.

:::

## 🎯 Checkpoint

::: details Question 1 — Why does Python separate BaseException from Exception?
**Q:** Why does `KeyboardInterrupt` inherit from `BaseException` instead of `Exception`? What would go wrong if it inherited from `Exception`?

**A:** If `KeyboardInterrupt` inherited from `Exception`, then every `except Exception:` clause in the codebase — including broad catch-all handlers in libraries, ORMs, and web frameworks — would silently swallow Ctrl+C. The user would lose the ability to interrupt the program. The same applies to `SystemExit`: `sys.exit()` raises `SystemExit`, and if it were an `Exception`, any generic error handler would prevent the program from exiting. By placing these under `BaseException` directly, Python ensures that `except Exception:` (the recommended broadest catch) does not interfere with system-level signals. The only way to catch them is to explicitly name them or to use `except BaseException:`, which is a deliberate action the developer must consciously choose.
:::

::: details Question 2 — Exception chaining semantics
**Q:** What is the difference between `raise X from Y`, `raise X` inside an `except` block, and `raise X from None`? What attributes do each set on the new exception?

**A:** (1) `raise X from Y` sets `X.__cause__ = Y` and `X.__suppress_context__ = True`. The traceback displays "The above exception was the direct cause of the following exception." This is explicit chaining — you are deliberately saying "X happened because of Y." (2) `raise X` inside an `except` block (without `from`) sets `X.__context__` to the currently handled exception but leaves `X.__cause__` as `None` and `__suppress_context__` as `False`. The traceback shows "During handling of the above exception, another exception occurred." This is implicit chaining — Python records the context automatically but does not assert a causal relationship. (3) `raise X from None` sets `X.__suppress_context__ = True` and `X.__cause__ = None`, which tells Python to hide the context chain entirely. The traceback shows only `X` with no mention of the original exception. Use this when the original exception is an implementation detail you do not want to expose to the caller.
:::

::: details Question 3 — The finally-return trap
**Q:** What does this function return, and what happens to the ValueError?

```python
def mystery() -> str:
    try:
        raise ValueError("important!")
    finally:
        return "all good"
```

**A:** The function returns `"all good"`. The `ValueError` is **silently discarded**. When Python executes `finally`, the pending exception is still "in flight." But a `return` statement in `finally` causes Python to abandon the exception propagation and return the value instead. The exception is not re-raised, not logged, and not recorded anywhere. This is one of the most dangerous patterns in Python and is flagged by linters (ruff B012) for exactly this reason. The same behavior occurs with `break` and `continue` inside `finally` blocks within loops.
:::

## Key Mental Models

- **Exceptions propagate up the call stack, not down.** They unwind frames until a matching handler is found or the interpreter exits.
- **`except Exception:` is your broadest safe net.** Bare `except:` catches `BaseException` — including `KeyboardInterrupt` and `SystemExit` — and should almost never be used.
- **`finally` always runs, and that is both its power and its danger.** Never put `return` in `finally` — it silently replaces the pending exception.
- **EAFP is Pythonic when failure is rare.** Attempting the operation and catching the exception is faster and race-condition-free compared to checking preconditions first.
- **Exception chaining preserves the causal trail.** Use `raise X from Y` to link a high-level error to its root cause; use `raise X from None` to hide implementation details from the caller.

## Related

- [Module 6 — Context Managers](./02-context-managers.md) — `__exit__` receives exception info and can suppress exceptions, tying directly into `try`/`except`/`finally` semantics.
- [Module 3 — Functions & Scoping](/python/module-03/) — understanding the call stack is essential for understanding exception propagation.
- [Module 5 — Iterators & Generators](/python/module-05/) — `StopIteration` is the exception that drives the iterator protocol; generators interact with exceptions via `throw()` and `GeneratorExit`.
- [Module 1 — The Data Model](/python/module-01/) — exceptions are objects; custom exceptions follow the same class-based patterns as any other Python object.
