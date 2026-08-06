---
title: Core Syntax & Truthiness
outline: deep
---

# Core Syntax & Truthiness

> **Interview weight:** 🔥🔥 — truthiness and operator questions are common in screening rounds.
> **Python version notes:** Walrus operator (`:=`) requires Python 3.8+. `f"{expr=}"` debugging requires 3.8+. Examples target Python 3.12+.
> **Prerequisites:** [1.2 Data Model](02-data-model)

## 🗣️ In Plain English

::: tip In Plain English
Imagine Python reads your code like a strict recipe editor reading a cookbook manuscript. Two things make this editor unusual.

**First, indentation is grammar.** Most editors let you indent however you like for readability — Python's editor treats indentation as actual punctuation. If you write "stir the sauce" indented under "if the water is boiling," then stirring only happens when the water boils. Pull that line back to the left margin and it happens every time, no matter what. There are no curly braces or `end` keywords — the whitespace itself is the grouping. Get it wrong by even one space and the editor rejects your manuscript.

**Second, Python has a bouncer at the door of every `if` statement.** When you write `if something:`, Python does not just check whether `something` is literally `True` or `False`. It runs a quick "are you *substantial*?" check. Empty pockets? Rejected. Zero dollars in your wallet? Rejected. An empty bag, an empty list, an empty string, the number zero, the special value `None` — all rejected. The bouncer calls these "falsy." Anything else — a list with even one item, a non-zero number, a string with even one character — gets waved through as "truthy."

This bouncer system extends to `and` and `or`. Think of `or` like checking a chain of backup contacts: Python calls the first one, and if they answer (truthy), it stops and hands you that contact. If they don't answer (falsy), it tries the next, and the next, until someone picks up or it reaches the end and hands you the last one regardless. `and` works the opposite way — it keeps going as long as everyone answers, and stops the moment someone doesn't.

These two ideas — indentation as structure and truthiness as a spectrum rather than a binary switch — are the grammar rules that make Python feel different from languages where braces define blocks and only booleans live inside conditions.
:::

## ⚙️ Under the Hood

### Indentation as Syntax

Python's tokenizer converts leading whitespace into explicit `INDENT` and `DEDENT` tokens before the parser ever sees your code. This is why indentation is not cosmetic — it is literally part of the token stream.

```python
# file: indent_demo.py
# run: python -m tokenize indent_demo.py

def greet(name: str) -> str:
    if name:
        return f"Hello, {name}"
    return "Hello, stranger"
```

Run the tokenizer on this file:

```bash
python -m tokenize indent_demo.py
```

You will see output like:

```
1,0-1,3:            NAME           'def'
...
2,0-2,4:            INDENT         '    '
2,4-2,6:            NAME           'if'
...
3,0-3,8:            INDENT         '        '
3,8-3,14:           NAME           'return'
...
4,0-4,0:            DEDENT         ''
4,4-4,10:           NAME           'return'
...
5,0-5,0:            DEDENT         ''
```

Each increase in indentation level emits an `INDENT` token; each decrease emits a `DEDENT`. The parser grammar references these tokens just like it references `(` and `)`.

**Spaces vs tabs:** Python 3 raises a `TabError` if you mix tabs and spaces for indentation within the same block. PEP 8 mandates 4 spaces per level. There is no ambiguity — pick spaces and never look back.

```python
# file: tab_error_demo.py
# run: python tab_error_demo.py
# This file intentionally mixes tabs and spaces — Python 3 will raise TabError.

def broken() -> None:
    x = 1       # 4 spaces
	y = 2       # 1 tab — TabError: inconsistent use of tabs and spaces
```

**Line continuation:** Python allows implicit continuation inside brackets `()`, `[]`, `{}`, and explicit continuation with a trailing backslash:

```python
# file: continuation_demo.py
# run: python continuation_demo.py

# Implicit continuation inside parentheses
result = (
    1 + 2
    + 3 + 4
    + 5
)

# Implicit continuation inside list brackets
items = [
    "alpha",
    "beta",
    "gamma",
]

# Explicit continuation with backslash (less preferred)
total = 1 + 2 \
    + 3 + 4

print(result, items, total)  # 15 ['alpha', 'beta', 'gamma'] 10
```

Prefer implicit continuation (wrap in parentheses) over backslash — a stray space after `\` silently breaks the continuation.

---

### Expressions vs Statements

An **expression** produces a value. A **statement** performs an action. This distinction matters because expressions can appear anywhere a value is expected, while statements cannot.

```python
# file: expr_vs_stmt.py
# run: python expr_vs_stmt.py

# Expressions — each of these produces a value
x = 3 + 4           # 3 + 4 is an expression; the assignment itself is a statement
y = [i**2 for i in range(5)]  # list comprehension is an expression
z = (lambda a: a * 2)(5)      # lambda is an expression

# Statements — these perform actions, they don't "return" a value you can capture
# if, for, while, def, class, import, return, raise — all statements

# This is illegal in Python (unlike C/JS):
# if (x = 5):   # SyntaxError — assignment is a statement, not an expression
#     print(x)

print(x, y, z)  # 7 [0, 1, 4, 9, 16] 10
```

#### The Walrus Operator (`:=`) — Assignment as an Expression

PEP 572 introduced assignment expressions (the "walrus operator") in Python 3.8. It lets you assign and use a value in the same expression:

```python
# file: walrus_basic.py
# run: python walrus_basic.py

import re

# Without walrus — compute twice or use a temp variable
data = "Error: connection refused"
match = re.search(r"Error: (.+)", data)
if match:
    print(f"Found error: {match.group(1)}")

# With walrus — assign and test in one expression
if (match := re.search(r"Error: (.+)", data)):
    print(f"Found error: {match.group(1)}")

# Walrus in a while loop — the classic use case
import io
stream = io.StringIO("line1\nline2\nline3\n")
while (line := stream.readline()):
    print(f"Read: {line.strip()}")

# Walrus in comprehension filters — compute once, filter, and keep result
raw = [1, -2, 3, -4, 5, 0, -6]

def expensive(n: int) -> int:
    """Simulate an expensive transformation."""
    return n * 10

# Without walrus you'd call expensive() twice or use a nested loop
positives = [y for x in raw if (y := expensive(x)) > 0]
print(positives)  # [10, 30, 50]
```

We cover the walrus operator's scoping rules and controversies in a [dedicated section below](#the-walrus-operator).

---

### Truthiness

When Python evaluates an object in a boolean context (`if x:`, `while x:`, `not x`, `x and y`, `x or y`), it follows a precise protocol:

1. Call `x.__bool__()` if defined. Must return `True` or `False`.
2. Otherwise, call `x.__len__()` if defined. Returns truthy if the result is non-zero.
3. If neither is defined, the object is truthy (all user-defined objects default to `True`).

```python
# file: truthiness_protocol.py
# run: python truthiness_protocol.py

class AlwaysFalsy:
    def __bool__(self) -> bool:
        print("  __bool__ called")
        return False

class LenBased:
    def __init__(self, size: int) -> None:
        self.size = size

    def __len__(self) -> int:
        print(f"  __len__ called, returning {self.size}")
        return self.size

class NeitherDefined:
    pass

print("AlwaysFalsy:")
print(f"  bool = {bool(AlwaysFalsy())}")     # __bool__ called -> False

print("LenBased(0):")
print(f"  bool = {bool(LenBased(0))}")       # __len__ called -> False (0)

print("LenBased(3):")
print(f"  bool = {bool(LenBased(3))}")       # __len__ called -> True (3)

print("NeitherDefined:")
print(f"  bool = {bool(NeitherDefined())}")  # True (default)
```

#### The Complete Falsy List

```python
# file: falsy_list.py
# run: python falsy_list.py

falsy_values = [
    None,           # the null singleton
    False,          # boolean false
    0,              # int zero
    0.0,            # float zero
    0j,             # complex zero
    "",             # empty string
    (),             # empty tuple
    [],             # empty list
    {},             # empty dict
    set(),          # empty set
    frozenset(),    # empty frozenset
    range(0),       # empty range
    b"",            # empty bytes
    bytearray(),    # empty bytearray
]

for val in falsy_values:
    assert not val, f"Expected {val!r} ({type(val).__name__}) to be falsy"
    print(f"  {type(val).__name__:>12}: {val!r:>15}  ->  falsy")

print(f"\nAll {len(falsy_values)} values confirmed falsy.")
```

#### Bytecode View

You can inspect how `if x:` compiles using `dis`:

```python
# file: truthiness_bytecode.py
# run: python truthiness_bytecode.py

import dis

def check(x: object) -> str:
    if x:
        return "truthy"
    return "falsy"

dis.dis(check)
# Key instructions:
#   LOAD_FAST  x
#   POP_JUMP_FORWARD_IF_FALSE  (jumps past the "truthy" return)
#
# POP_JUMP_IF_FALSE internally calls bool(x), which triggers
# the __bool__ / __len__ protocol described above.
```

#### Custom Truthiness

```python
# file: custom_truthiness.py
# run: python custom_truthiness.py

class ConnectionPool:
    """A pool is truthy when it has available connections."""

    def __init__(self, total: int, in_use: int) -> None:
        self.total = total
        self.in_use = in_use

    def __bool__(self) -> bool:
        return (self.total - self.in_use) > 0

    def __len__(self) -> int:
        # __bool__ takes priority, so this won't be called for bool()
        return self.total

    def __repr__(self) -> str:
        avail = self.total - self.in_use
        return f"ConnectionPool(total={self.total}, available={avail})"

pool_ok = ConnectionPool(10, 5)
pool_exhausted = ConnectionPool(10, 10)

print(f"{pool_ok}: bool={bool(pool_ok)}")           # True — 5 available
print(f"{pool_exhausted}: bool={bool(pool_exhausted)}")  # False — 0 available

if pool_ok:
    print("Pool has connections available")

if not pool_exhausted:
    print("Pool is exhausted, waiting...")
```

#### Short-Circuit Evaluation

`and` and `or` do **not** return `True` or `False` — they return the actual operand that determined the result:

- `and` returns the **first falsy** value, or the **last** value if all are truthy.
- `or` returns the **first truthy** value, or the **last** value if all are falsy.

```python
# file: short_circuit.py
# run: python short_circuit.py

# `or` — returns first truthy, or last value
print("" or 0 or [] or "hello")        # "hello" — first truthy
print("" or 0 or [] or None)           # None    — all falsy, returns last
print("first" or "second")             # "first" — already truthy, stops

# `and` — returns first falsy, or last value
print(1 and 2 and 3)                   # 3    — all truthy, returns last
print(1 and 0 and 3)                   # 0    — first falsy
print(1 and "" and 3)                  # ""   — first falsy

# Using `or` for defaults — common idiom
user_input = ""
name = user_input or "Anonymous"
print(f"name = {name!r}")              # "Anonymous"

# THE TRAP: 0 and "" are valid values but falsy
quantity = 0
result = quantity or 10
print(f"quantity = {result}")           # 10 — BUG! We wanted 0

# Safe alternative: explicit None check
quantity_safe = 0
result_safe = quantity_safe if quantity_safe is not None else 10
print(f"quantity_safe = {result_safe}") # 0 — correct
```

---

### Operator Overloading Preview

Python uses "dunder" (double-underscore) methods to let objects define how operators behave:

```python
# file: vector_class.py
# run: python vector_class.py

from __future__ import annotations

class Vector:
    """A 2D vector demonstrating operator overloading."""

    __slots__ = ("x", "y")

    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

    def __repr__(self) -> str:
        return f"Vector({self.x}, {self.y})"

    def __add__(self, other: Vector) -> Vector:
        if not isinstance(other, Vector):
            return NotImplemented
        return Vector(self.x + other.x, self.y + other.y)

    def __mul__(self, scalar: float) -> Vector:
        if not isinstance(scalar, (int, float)):
            return NotImplemented
        return Vector(self.x * scalar, self.y * scalar)

    def __rmul__(self, scalar: float) -> Vector:
        """Called when the left operand doesn't support __mul__ with Vector.
        e.g., 3 * Vector(1, 2) — int.__mul__ returns NotImplemented,
        so Python tries Vector.__rmul__(3)."""
        return self.__mul__(scalar)

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Vector):
            return NotImplemented
        return self.x == other.x and self.y == other.y

    def __abs__(self) -> float:
        return (self.x ** 2 + self.y ** 2) ** 0.5

    def __bool__(self) -> bool:
        return abs(self) > 0

v1 = Vector(1, 2)
v2 = Vector(3, 4)

print(v1 + v2)        # Vector(4, 6)
print(v1 * 3)         # Vector(3, 6)
print(3 * v1)         # Vector(3, 6)  — uses __rmul__
print(v1 == Vector(1, 2))  # True
print(abs(v2))         # 5.0
print(bool(Vector(0, 0)))  # False — zero vector is falsy
```

**Reflected operators** (`__radd__`, `__rmul__`, etc.) are Python's fallback mechanism. When `a + b` is evaluated, Python first tries `a.__add__(b)`. If that returns `NotImplemented`, Python tries `b.__radd__(a)`. This is how a `Vector` can participate in `3 * vector` even though `int` knows nothing about `Vector`.

---

### Chained Comparisons

Python lets you write `1 < x < 10` and it means what a mathematician would expect:

```python
# file: chained_comparisons.py
# run: python chained_comparisons.py

import dis

x = 5

# Chained — Pythonic
print(1 < x < 10)       # True
print(1 < x < 3)        # False

# Equivalent desugaring — x is only evaluated ONCE in the chained form
print(1 < x and x < 10) # True (but x is evaluated twice here)

# Any comparison operator can be chained
a, b, c = 1, 2, 3
print(a < b <= c)        # True: (a < b) and (b <= c)
print(a < b > c)         # False: (a < b) and (b > c)  -> True and False -> False

# Works with ==, !=, is, in, etc.
print(1 == 1 == 1)       # True
print(1 == 1 != 2)       # True: (1 == 1) and (1 != 2)

print("\n--- Bytecode for chained comparison ---")
def chained(x: int) -> bool:
    return 1 < x < 10

dis.dis(chained)
# The bytecode loads 1, loads x, does COMPARE_OP (<),
# if False jumps to the end (short-circuit),
# otherwise loads 10, does COMPARE_OP (<).
# x is on the stack — it's evaluated exactly once.
```

**The gotcha with `is` in chains:**

```python
# file: chained_gotcha.py
# run: python chained_gotcha.py

a = 1
b = 1

# You might think this tests whether (a == b) is True
result1 = a == b is True
# But it actually chains: (a == b) and (b is True)
# a == b -> True, but b is True -> False (1 is not the True singleton)
print(f"a == b is True  -> {result1}")  # False!

# What you probably meant:
result2 = (a == b) is True
print(f"(a == b) is True -> {result2}")  # True

# Or simply:
result3 = a == b
print(f"a == b          -> {result3}")   # True
```

---

### String Formatting

Python has three string formatting systems. Each has its place.

#### f-strings (3.6+, preferred)

```python
# file: fstrings_demo.py
# run: python fstrings_demo.py

import dis

name = "World"
pi = 3.14159265

# Basic interpolation
print(f"Hello, {name}!")                    # Hello, World!

# Format spec: {value:format_spec}
print(f"Pi = {pi:.3f}")                     # Pi = 3.142
print(f"{'left':<15}|{'center':^15}|{'right':>15}")
# left           |    center     |          right

# Conversions: !s (str), !r (repr), !a (ascii)
special = "caf\u00e9"
print(f"{special!s}")  # cafe  (str)
print(f"{special!r}")  # 'caf\u00e9' (repr — shows quotes and escapes)
print(f"{special!a}")  # 'caf\xe9' (ascii — escapes non-ASCII)

# Combined conversion + format spec
print(f"{name!r:.10}")  # 'World' — repr then truncate to 10 chars

# Debugging trick (3.8+): = suffix prints expression AND value
x = 42
items = [1, 2, 3]
print(f"{x = }")               # x = 42
print(f"{len(items) = }")      # len(items) = 3
print(f"{x * 2 = }")           # x * 2 = 84

# Nested f-strings (3.12+ allows reuse of outer quote type)
width = 10
print(f"{'hello':>{width}}")   # Nested expression in format spec

# f-string internals: compiled to bytecode, not parsed at runtime
print("\n--- f-string bytecode ---")
def greet(name: str) -> str:
    return f"Hello, {name}!"

dis.dis(greet)
# You'll see FORMAT_VALUE or BUILD_STRING opcodes —
# the f-string is compiled to efficient concatenation operations.
```

#### `.format()` — for reusable templates

```python
# file: format_method_demo.py
# run: python format_method_demo.py

# Positional arguments
print("{} + {} = {}".format(1, 2, 3))              # 1 + 2 = 3

# Named arguments — great for reusable templates
template = "Dear {name}, your order #{order_id} ships on {date}."
print(template.format(name="Alice", order_id=42, date="2026-08-10"))

# Access attributes and items
class Point:
    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

p = Point(3, 4)
print("({0.x}, {0.y})".format(p))  # (3, 4)

data = {"key": "value"}
print("{0[key]}".format(data))     # value

# Format spec mini-language
print(f"{'Type':<10} {'Example':>10}")
print(f"{'int':<10} {42:>10,}")        # Comma as thousands separator
print(f"{'float':<10} {3.14159:>10.2f}")
print(f"{'hex':<10} {255:>10#x}")       # 0xff
print(f"{'bin':<10} {42:>10#010b}")     # 0b00101010
print(f"{'pct':<10} {0.856:>10.1%}")    # 85.6%
```

#### `%` formatting — old style, but not dead

```python
# file: percent_format_demo.py
# run: python percent_format_demo.py

import logging

# Basic % formatting
name = "World"
print("Hello, %s!" % name)               # Hello, World!
print("Pi = %.3f" % 3.14159)             # Pi = 3.142
print("%d in hex is %#x" % (255, 255))   # 255 in hex is 0xff

# WHY % formatting survives: lazy evaluation in logging
# The string is only formatted if the log level is enabled.
logging.basicConfig(level=logging.WARNING)

expensive_value = 42  # imagine this is the result of a costly computation

# With f-string: formatted ALWAYS, even if DEBUG is disabled (wasted work)
logging.debug(f"Value is {expensive_value}")

# With %: formatted ONLY if DEBUG is enabled (lazy)
logging.debug("Value is %s", expensive_value)

# Rule of thumb:
# - f-strings: default choice for all normal string building
# - %: inside logging calls (lazy formatting)
# - .format(): reusable template strings stored in variables/configs
```

---

### The Walrus Operator (`:=`) {#the-walrus-operator}

PEP 572 (Python 3.8) added assignment expressions. The operator `:=` assigns a value to a variable **and** returns that value, making it an expression rather than a statement.

```python
# file: walrus_deep_dive.py
# run: python walrus_deep_dive.py

# --- Use case 1: avoid redundant computation in conditions ---
data = [1, 5, 12, 3, 18, 7, 22]

# Without walrus: call the function twice, or use a temp variable
filtered = []
for x in data:
    transformed = x * 2 + 1
    if transformed > 15:
        filtered.append(transformed)

# With walrus: compute once, test, and use
filtered_w = [y for x in data if (y := x * 2 + 1) > 15]

print(f"filtered:   {filtered}")    # [25, 37, 15, 45] — wait, 15 is not > 15
print(f"filtered_w: {filtered_w}")  # [25, 37, 45]
# (Both correctly exclude 15 since we use >, not >=)

# --- Use case 2: while loops with sentinel ---
import io
lines: list[str] = []
stream = io.StringIO("alpha\nbeta\ngamma\n")
while (line := stream.readline()):
    lines.append(line.strip())
print(f"lines: {lines}")  # ['alpha', 'beta', 'gamma']

# --- Use case 3: reducing nesting in if/elif chains ---
import re

text = "error code: 404"

if (m := re.match(r"error code: (\d+)", text)):
    print(f"Error {m.group(1)}")
elif (m := re.match(r"warning: (.+)", text)):
    print(f"Warning: {m.group(1)}")
```

**Scoping rule:** inside a comprehension, `:=` binds the variable in the **enclosing** scope, not the comprehension's internal scope:

```python
# file: walrus_scope.py
# run: python walrus_scope.py

# y will exist in the enclosing scope after the comprehension runs
results = [y for x in range(5) if (y := x ** 2) > 5]
print(f"results: {results}")  # [9, 16]
print(f"y = {y}")             # y = 16 — the last value assigned by :=
# y "leaks" into the surrounding scope. This is by design, not a bug.
```

**When NOT to use the walrus:**

```python
# BAD — hurts readability, no real benefit
# result = (x := 10) + (y := 20) + (z := x + y)

# BAD — nested walruses are confusing
# if (a := (b := get_data()).process()):

# GOOD — use walrus only when it eliminates genuine duplication
# and keeps the code's intent clear
```

**Historical note:** PEP 572 was so contentious that Guido van Rossum stepped down as BDFL (Benevolent Dictator For Life) in July 2018 after it was accepted, citing the exhausting debate. Python governance moved to a steering council model. The operator itself is useful and well-defined — the controversy was about process and community dynamics, not a design flaw.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

### 1. Mixed Indentation — The Invisible Bug

**Symptoms:** `TabError: inconsistent use of tabs and spaces in indentation` on deployment, even though the code "looks fine" in your editor. Or worse: in Python 2 legacy code ported to 3, the file was silently mixing tabs (displayed as 4 spaces in some editors) and spaces. After a colleague edits one line with a different editor, the file breaks.

**Root cause:** Different editors render tabs at different widths. A file can look perfectly aligned in VS Code (tab = 4 spaces) and be broken in another tool. Python 3 refuses to guess and raises `TabError` if tabs and spaces are mixed.

**Diagnosis and fix:** Run `python -m tabnanny your_file.py` to detect mixed indentation. Configure your editor and CI linter (ruff, flake8) to enforce spaces-only. In CI, `ruff check --select E101,W191` catches tab issues before they reach production.

### 2. The `or`-Default Trap with Falsy Valid Values

**Symptoms:** A configuration value of `0`, `""`, or `False` is silently replaced by a default. Downstream behavior is wrong but no error is raised — the application runs with the default instead of the user's explicit zero or empty string.

**Root cause:** Code like `timeout = config.get("timeout") or 30` treats `0` as falsy, replacing a valid `timeout=0` (meaning "no timeout" or "immediate") with `30`. Same issue with `name = user_input or "Anonymous"` when the user genuinely sends an empty string.

**Fix:** Use explicit `None` checks:
```python
timeout = config.get("timeout")
if timeout is None:
    timeout = 30

# Or with a sentinel default from dict.get():
timeout = config.get("timeout", 30)  # only applies if key is missing
```

### 3. `if x is True` vs `if x` — Identity vs Truthiness

**Symptoms:** A function that returns `1` (or any truthy non-boolean) fails an `if result is True:` check. Tests pass when the function returns `True` literally but break when a refactor changes the return value to `1` or a non-empty string.

**Root cause:** `is True` tests **identity** — whether the object is literally the `True` singleton. `1 is True` is `False` because `int(1)` and `bool(True)` are distinct objects (even though `1 == True` is `True`, because `bool` is a subclass of `int`). This bites particularly hard when consuming values from JSON parsing or database drivers that return `1`/`0` instead of `True`/`False`.

**Rule:** Use `if x:` for truthiness checks. Use `if x is True:` only when you specifically need to distinguish `True` from other truthy values (rare). Use `if x is None:` for None checks (this one IS correct and idiomatic — `None` is a singleton).
:::

## 🎯 Checkpoint

::: details Question 1 — Short-circuit evaluation
**Q:** What does `[] or {} or "hello"` return and why?

**A:** It returns `"hello"`.

`or` evaluates left to right and returns the first truthy value, or the last value if all are falsy. `[]` is falsy (empty list, `__len__` returns 0), so evaluation continues. `{}` is falsy (empty dict, `__len__` returns 0), so evaluation continues. `"hello"` is truthy (non-empty string, `__len__` returns 5), so `or` returns it immediately without evaluating further.

The return type is `str`, not `bool`. `or` returns the actual operand, not `True`/`False`. This is the mechanism behind the `value or default` idiom.
:::

::: details Question 2 — Truthiness vs identity vs equality
**Q:** What is the difference between `if x == True`, `if x is True`, and `if x`? Give an example where they produce different results for the same value of `x`.

**A:** These test three different things:

- `if x` — **truthiness**. Calls `bool(x)`, which invokes `x.__bool__()` or `x.__len__()`. Passes for any truthy value.
- `if x == True` — **equality**. Calls `x.__eq__(True)`. Since `bool` is a subclass of `int` and `True == 1`, this passes for `x = 1` as well as `x = True`.
- `if x is True` — **identity**. Checks whether `x` is the exact `True` singleton object. `1 is True` is `False`.

Example where all three differ: `x = 1`
- `if x:` — passes (1 is truthy)
- `if x == True:` — passes (`1 == True` because `True` has int value 1)
- `if x is True:` — fails (the `int` object `1` is not the `bool` object `True`)

Another example: `x = [1, 2, 3]`
- `if x:` — passes (non-empty list is truthy)
- `if x == True:` — fails (list has no meaningful equality with `True`)
- `if x is True:` — fails (not the `True` singleton)
:::

::: details Question 3 — Walrus scoping
**Q:** What does `result = [y := f(x), y**2, y**3]` do, and in what scope does `y` live after execution?

**A:** This creates a list of three elements. First, `y := f(x)` calls `f(x)`, assigns the return value to `y`, and uses that value as the first element. Then `y**2` and `y**3` use the just-assigned `y` for the second and third elements. If `f(x)` returns `3`, the result is `[3, 9, 27]`.

The variable `y` lives in the **enclosing function scope** (or module scope if at the top level) — not in some temporary scope. After the line executes, `y` is accessible as a regular local variable with the value `f(x)`.

This is the fundamental scoping rule for `:=`: inside comprehensions, it binds in the enclosing scope (this was deliberate — it's the primary reason walrus is useful in comprehension filters). Outside comprehensions, it binds in the current scope like a normal assignment would, except it can appear inside expressions where `=` cannot.
:::

## Key Mental Models

- **Indentation is tokenized, not decorative.** The Python tokenizer emits `INDENT` and `DEDENT` tokens that the parser treats as grammar — indentation errors are syntax errors, not style warnings.
- **Truthiness is a protocol, not a property.** Python calls `__bool__()`, then `__len__()`, then defaults to `True` — you control truthiness by implementing these methods on your classes.
- **`and`/`or` return operands, not booleans.** `or` returns the first truthy value (or the last), `and` returns the first falsy value (or the last). This enables the `x or default` idiom but creates traps with falsy valid values.
- **Assignment is a statement; `:=` is an expression.** The walrus operator exists precisely to allow assignment inside `if`, `while`, and comprehensions — places where statements are forbidden.
- **Chained comparisons evaluate each operand once.** `a < b < c` is `a < b and b < c` with `b` evaluated only once, but beware that `==` and `is` can chain in surprising ways.

## Related

- [Data Model & Object Identity](02-data-model) — `__bool__` and `__len__` are part of the data model protocol covered there
- [Numbers, Strings & None](04-numbers-strings-none) — deeper dive into the types that appear in the falsy list
- [JS Core: Execution Contexts & Scopes](/js-core/) — contrast Python's indentation-based scoping with JavaScript's brace-based blocks and hoisting
