---
title: Numbers, Strings & None
outline: deep
---

# Numbers, Strings & None

> **Interview weight:** 🔥🔥 — floating-point precision, string immutability, and `None` checks are interview staples.
> **Python version notes:** Examples target Python 3.12+. `int.bit_count()` requires 3.10+.
> **Prerequisites:** [1.2 Data Model](02-data-model)

## 🗣️ In Plain English

::: tip In Plain English
Python gives you three different ways to measure things, each suited to a different job.

**Integers** are like a tape measure that stretches forever. Need to measure something a million miles long? No problem — the tape just keeps unrolling. There is no upper limit, no overflow. Python will happily work with a number that has ten thousand digits. The only cost is that longer tape measures weigh more (take more memory).

**Floats** are like a wooden ruler with marks etched into it. The marks are incredibly fine — you can measure most everyday things with stunning accuracy. But every now and then, the measurement you need falls *between* two marks. The ruler rounds to the nearest one, and you get a tiny error. That is why `0.1 + 0.2` lands on a mark ever so slightly away from `0.3`. For everyday work, nobody notices. For bank ledgers, those tiny rounding errors pile up over millions of transactions, so Python offers **Decimal** — a ruler where *you* choose exactly how fine the marks are.

**Strings** are beaded necklaces. Each bead is one Unicode character — a letter, an emoji, a Chinese ideogram. You can look at any bead, count them, or read the whole necklace. But you cannot pry a bead off and swap in a different one. If you want a different necklace, you build a new one from scratch. That is immutability: the necklace itself never changes; you just make new necklaces when you need different text.

**None** is not zero, not an empty string, not False. It is a specific, deliberate "nothing here" marker — like a labelled empty shelf in a warehouse. The label says "Reserved — intentionally vacant." There is exactly one such marker in the entire program, so when you want to check whether a shelf is the empty one, you check its identity ("is this *the* empty shelf?"), not its appearance.
:::

## ⚙️ Under the Hood

### Integers — Arbitrary Precision

CPython represents every `int` as a `PyLongObject`: a variable-length array of "digits," where each digit is a 30-bit chunk on 64-bit systems (15-bit on 32-bit). This means Python integers have **no upper bound** — they grow by allocating more digit slots.

```python
# run: python3 numbers_int_size.py
import sys

small = 42
big = 2**1000

print(f"Size of 42:      {sys.getsizeof(small)} bytes")   # 28 bytes
print(f"Size of 2**1000: {sys.getsizeof(big)} bytes")      # ~172 bytes
print(f"Digit count:     {big.bit_length()} bits")          # 1001 bits
```

Each `int` carries a fixed overhead (object header + reference count + digit-count field), which is why even the number `0` costs 28 bytes.

#### Small integer cache

CPython pre-allocates and reuses integer objects for values **-5 through 256**. Every time you write `x = 42`, you get the *same* object in memory:

```python
# run: python3 int_interning.py
a = 256
b = 256
print(a is b)  # True — same cached object

c = 257
d = 257
print(c is d)  # False (in the general case — REPL may intern more aggressively)
```

This is an implementation detail of CPython, not a language guarantee. Never rely on `is` for integer comparison — always use `==`.

#### Bit operations

Bitwise operators work directly on the internal two's-complement representation:

```python
# run: python3 int_bits.py
flags = 0b1010_1100
print(f"AND:        {flags & 0b1111_0000:#010b}")   # 0b10100000
print(f"OR:         {flags | 0b0000_0011:#010b}")    # 0b10101111
print(f"XOR:        {flags ^ 0b1111_1111:#010b}")    # 0b01010011
print(f"NOT:        {~flags}")                         # -173 (inverts all bits, two's complement)
print(f"Left shift: {1 << 10}")                        # 1024
print(f"Right shift:{flags >> 4}")                     # 10
```

#### Useful int methods and conversions

```python
# run: python3 int_methods.py
n = 255

print(n.bit_length())                    # 8 — minimum bits to represent 255
print(n.bit_count())                     # 8 — number of 1-bits (popcount, 3.10+)
print(n.to_bytes(2, byteorder="big"))    # b'\x00\xff'
print(int.from_bytes(b"\x00\xff", "big"))  # 255

# Underscore separators (PEP 515) — visual aid, no semantic meaning
population = 8_100_000_000
print(population)  # 8100000000

# Base conversions
print(bin(255))         # '0b11111111'
print(oct(255))         # '0o377'
print(hex(255))         # '0xff'
print(int("ff", 16))   # 255
print(int("0b1010", 2))  # 10
```

---

### Floats — IEEE 754 Doubles

Python's `float` is a C `double`: 64 bits total — 1 sign bit, 11 exponent bits, 52 mantissa bits. This gives roughly **15--17 significant decimal digits** of precision.

#### The classic precision trap

```python
# run: python3 float_precision.py
result = 0.1 + 0.2
print(result)               # 0.30000000000000004
print(result == 0.3)         # False
print(repr(0.1))             # 0.1 (Python shows the shortest repr that round-trips)
print(f"{0.1:.25f}")         # 0.1000000000000000055511151 — the actual stored value
```

Why? `0.1` cannot be represented exactly in base-2 floating point, just as `1/3` cannot be written exactly in base-10. The closest 64-bit double to `0.1` is slightly above it.

#### Special values

```python
# run: python3 float_special.py
import math

inf = float("inf")
neg_inf = float("-inf")
nan = float("nan")

print(inf > 1e308)          # True
print(inf + 1 == inf)       # True
print(neg_inf < -1e308)     # True

# NaN is not equal to anything, including itself — per IEEE 754
print(nan == nan)            # False
print(nan != nan)            # True
print(math.isnan(nan))      # True — the correct way to check
```

#### Correct float comparison

```python
# run: python3 float_compare.py
import math

a = 0.1 + 0.2
b = 0.3

# Wrong
print(a == b)                              # False

# Right — relative tolerance (default 1e-9)
print(math.isclose(a, b))                  # True

# With explicit tolerance
print(math.isclose(a, b, rel_tol=1e-12))   # True
print(math.isclose(a, b, abs_tol=1e-15))   # True
```

---

### Decimal and Fraction

#### `decimal.Decimal` — exact decimal arithmetic

```python
# run: python3 decimal_demo.py
from decimal import Decimal, getcontext

# Always construct from strings, not floats!
print(Decimal("0.1") + Decimal("0.2") == Decimal("0.3"))  # True
print(Decimal(0.1))  # 0.1000000000000000055511151231257827021181583404541015625
                      # ^ the float 0.1 is already imprecise before Decimal sees it

# Configure precision
getcontext().prec = 50
pi_approx = Decimal(1) / Decimal(7)
print(pi_approx)  # 0.14285714285714285714285714285714285714285714285714

# Rounding modes
from decimal import ROUND_HALF_UP, ROUND_HALF_EVEN
ctx = getcontext()
ctx.rounding = ROUND_HALF_UP
print(Decimal("2.5").quantize(Decimal("1")))   # 3 (banker's rounding would give 2)

ctx.rounding = ROUND_HALF_EVEN
print(Decimal("2.5").quantize(Decimal("1")))   # 2 (banker's rounding — Python default)
```

#### `fractions.Fraction` — exact rational arithmetic

```python
# run: python3 fraction_demo.py
from fractions import Fraction

a = Fraction(1, 3)
b = Fraction(1, 6)
print(a + b)            # 1/2 — exact, no rounding
print(a + b == Fraction(1, 2))  # True

# From float (warning: inherits float imprecision)
print(Fraction(0.1))    # 3602879701896397/36028797018963968
# From string (exact)
print(Fraction("0.1"))  # 1/10
```

**When to use each:**

| Type | Use case | Speed | Precision |
|------|----------|-------|-----------|
| `float` | General-purpose math, ML, physics | Fastest (hardware FPU) | ~15 decimal digits |
| `Decimal` | Money, financial calculations, tax | Slower (~100x) | Configurable, exact decimal |
| `Fraction` | Exact ratios, symbolic math | Slowest | Exact rational |

---

### complex

Python has built-in complex number support with the `j` suffix (not `i` as in math notation):

```python
# run: python3 complex_demo.py
import cmath

z = 3 + 4j
print(z.real)        # 3.0
print(z.imag)        # 4.0
print(z.conjugate()) # (3-4j)
print(abs(z))        # 5.0 — magnitude (modulus)

# cmath for complex-aware math
print(cmath.sqrt(-1))   # 1j
print(cmath.phase(z))   # 0.9272952180016122 (radians)
print(cmath.polar(z))   # (5.0, 0.9272952180016122) — (magnitude, phase)
```

Complex numbers appear in signal processing, control systems, quantum computing simulations, and scientific computing. Most backend engineers will rarely use them directly, but knowing they exist avoids reaching for external libraries when simple complex arithmetic is needed.

---

### Strings — Unicode by Default

In Python 3, `str` is a sequence of **Unicode code points** — every string is Unicode, always. There is no separate "unicode" type as in Python 2.

#### CPython's flexible string representation (PEP 393)

CPython does not store every string as UTF-8 or UCS-4. Instead, it inspects the highest code point in the string and picks the narrowest encoding that fits:

| Max code point | Internal encoding | Bytes per character | Example |
|---|---|---|---|
| U+00--U+FF | Latin-1 | 1 | `"hello"`, `"caf\u00e9"` |
| U+0100--U+FFFF | UCS-2 | 2 | `"\u4e16\u754c"` (Chinese) |
| U+10000+ | UCS-4 | 4 | `"\U0001F600"` (emoji) |

This means a single emoji in an otherwise ASCII string forces the *entire* string to 4 bytes per character:

```python
# run: python3 str_memory.py
import sys

ascii_str = "hello"
emoji_str = "hell\U0001F600"  # same length (5 chars), but one emoji

print(f"ASCII:  {sys.getsizeof(ascii_str)} bytes")  # ~54 bytes (Latin-1)
print(f"Emoji:  {sys.getsizeof(emoji_str)} bytes")  # ~76 bytes (UCS-4)
print(f"len():  {len(ascii_str)}, {len(emoji_str)}") # 5, 5 — code points, not bytes
```

#### Encoding and decoding

```python
# run: python3 str_encoding.py
text = "caf\u00e9"  # "cafe" with accented e

# str → bytes (encoding)
utf8_bytes = text.encode("utf-8")
print(utf8_bytes)        # b'caf\xc3\xa9' — 5 bytes (e-acute is 2 bytes in UTF-8)
print(len(utf8_bytes))   # 5

# bytes → str (decoding)
decoded = utf8_bytes.decode("utf-8")
print(decoded)           # café
print(decoded == text)   # True

# Wrong encoding = trouble
try:
    utf8_bytes.decode("ascii")
except UnicodeDecodeError as e:
    print(f"Error: {e}")
    # 'ascii' codec can't decode byte 0xc3 in position 3
```

Common encodings: **UTF-8** (Python's default, variable-width, ASCII-compatible), **ASCII** (7-bit, English only), **Latin-1** (8-bit, Western European — every byte 0x00--0xFF maps to a code point, so it never fails to decode, but may produce garbage).

#### String immutability and methods

Every string method returns a **new** string. The original is never modified:

```python
# run: python3 str_methods.py
s = "  Hello, World!  "

print(s.strip())                  # "Hello, World!"
print(s.lower())                  # "  hello, world!  "
print(s.replace("World", "Python"))  # "  Hello, Python!  "
print(s.split(","))               # ['  Hello', ' World!  ']
print("-".join(["a", "b", "c"])) # "a-b-c"
print("hello".startswith("hel")) # True
print("hello".endswith("llo"))   # True
print(s)                          # "  Hello, World!  " — unchanged
```

#### String interning

CPython automatically interns strings that look like identifiers (letters, digits, underscores). You can also force interning with `sys.intern()`:

```python
# run: python3 str_intern.py
import sys

a = sys.intern("hello_world")
b = sys.intern("hello_world")
print(a is b)  # True — same object, O(1) identity comparison

# CPython auto-interns identifier-like strings
x = "foo"
y = "foo"
print(x is y)  # True (auto-interned — but don't rely on this!)

# Strings with spaces are NOT auto-interned
p = "hello world"
q = "hello world"
print(p is q)  # May be True or False — implementation detail
```

#### Why loop concatenation is O(n^2)

```python
# run: python3 str_concat.py
import time

# BAD: O(n^2) — each += creates a new string and copies all previous content
def concat_loop(n: int) -> str:
    result = ""
    for i in range(n):
        result += str(i) + ","
    return result

# GOOD: O(n) — collect in list, join once
def concat_join(n: int) -> str:
    return ",".join(str(i) for i in range(n))

n = 100_000
start = time.perf_counter()
concat_loop(n)
loop_time = time.perf_counter() - start

start = time.perf_counter()
concat_join(n)
join_time = time.perf_counter() - start

print(f"Loop concat: {loop_time:.4f}s")
print(f"Join:        {join_time:.4f}s")
print(f"Join is {loop_time / join_time:.1f}x faster")
```

Each `+=` allocates a new string of length `len(old) + len(addition)` and copies the old content. After *n* iterations, total bytes copied is `1 + 2 + 3 + ... + n = O(n^2)`. `''.join()` allocates once and copies each piece once: `O(n)`.

> **Note:** CPython has an optimization that *sometimes* resizes strings in-place when the reference count is 1, but this is fragile, does not work in other Python implementations, and should not be relied upon.

---

### bytes and bytearray

```python
# run: python3 bytes_demo.py
# bytes — immutable sequence of integers 0-255
data = b"hello"
print(data[0])        # 104 — the integer, not 'h'
print(list(data))     # [104, 101, 108, 108, 111]

# Construction from integer list
raw = bytes([0x48, 0x65, 0x6C, 0x6C, 0x6F])
print(raw)            # b'Hello'

# bytearray — mutable version
buf = bytearray(b"hello")
buf[0] = 72           # ASCII 'H'
print(buf)            # bytearray(b'Hello')
buf.extend(b" world")
print(buf)            # bytearray(b'Hello world')

# When you need bytes:
# - File I/O (reading binary files: images, PDFs)
# - Network protocols (TCP/UDP payloads)
# - Cryptography (hashing, encryption input/output)
# - Binary serialization (struct, msgpack, protobuf)
```

The critical rule: **`str` is text (Unicode code points), `bytes` is raw data (octets)**. Never mix them. Python 3 enforces this boundary — you must explicitly `.encode()` / `.decode()` to cross it.

---

### None

`None` is the sole instance of `NoneType`. It is a **singleton** — the language guarantees exactly one `None` object exists per interpreter:

```python
# run: python3 none_demo.py
print(type(None))   # <class 'NoneType'>

# Identity check — the correct way
x = None
print(x is None)    # True
print(x is not None)  # False

# None is falsy...
print(bool(None))   # False

# ...but it is not False, 0, or ""
print(None == False) # False
print(None == 0)     # False
print(None == "")    # False
```

#### Why `is None`, not `== None`

`==` calls the object's `__eq__` method, which a class can override. `is` checks object identity — it cannot be fooled:

```python
# run: python3 none_is_vs_eq.py
class Sneaky:
    def __eq__(self, other: object) -> bool:
        return True  # claims to be equal to everything

s = Sneaky()
print(s == None)    # True — __eq__ lies
print(s is None)    # False — identity doesn't lie
```

This is why every linter (flake8 E711, ruff, pylint) flags `== None` — it is semantically wrong.

#### None as a default parameter sentinel

```python
# run: python3 none_sentinel.py
# WRONG: mutable default argument is shared across all calls
def append_bad(item: int, items: list[int] = []) -> list[int]:
    items.append(item)
    return items

print(append_bad(1))  # [1]
print(append_bad(2))  # [1, 2] — surprise! Same list object.

# CORRECT: use None sentinel, create a new list each call
def append_good(item: int, items: list[int] | None = None) -> list[int]:
    if items is None:
        items = []
    items.append(item)
    return items

print(append_good(1))  # [1]
print(append_good(2))  # [2] — fresh list each time
```

#### Type hinting with None

```python
# run: python3 none_typing.py
from typing import Optional

# These two are equivalent (Python 3.10+)
def find_user_a(user_id: int) -> str | None:
    ...

def find_user_b(user_id: int) -> Optional[str]:
    ...

# Python 3.12+ — use the | syntax, it's cleaner
```

---

### Type Conversion Gotchas

```python
# run: python3 conversion_gotchas.py
# int() from string — no implicit octal (unlike C/JS)
print(int("010"))        # 10, NOT 8
print(int("0o10", 8))   # 8 — explicit base required
print(int("0x1a", 16))  # 26
print(int("0b1010", 2)) # 10

# float() accepts special strings
print(float("inf"))      # inf
print(float("-inf"))     # -inf
print(float("nan"))      # nan

# bool() — the "truthy" traps
print(bool(""))          # False — empty string
print(bool("False"))     # True!  Non-empty string is truthy
print(bool("0"))         # True!  Non-empty string is truthy
print(bool(0))           # False
print(bool([]))          # False — empty list
print(bool([0]))         # True  — non-empty list (even if contents are falsy)

# str() on None
result = None
print(str(result))       # "None" — the string, NOT ""
print(f"Got: {result}")  # "Got: None"
# If you want empty string: result or ""
print(result or "")      # ""  (but careful: this also catches 0 and False)
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Float rounding in financial code**

A fintech service computes transaction fees as `amount * 0.029 + 0.30` using native `float`. Each individual calculation looks fine, but over 500,000 daily transactions the rounding errors compound. End-of-day reconciliation is off by several dollars. Auditors flag it.

**Root cause:** IEEE 754 doubles cannot represent `0.029` exactly. Each multiplication introduces a sub-penny error that accumulates.

**Fix:** Use `decimal.Decimal` for all monetary arithmetic. Construct from strings (`Decimal("0.029")`), never from floats. Set `ROUND_HALF_EVEN` (banker's rounding) via `getcontext()`. Store money as integer cents/pips in your database to avoid the problem at the persistence layer too.

**2. `UnicodeDecodeError` when reading files**

A log-processing pipeline reads files with `open("log.txt")` (which uses the platform's default encoding). On a developer's macOS machine, the default is UTF-8, and everything works. In the production Docker container (some slim Debian images), the locale is `POSIX`/`ASCII`. A single log line containing a user's name with an accented character crashes the pipeline: `UnicodeDecodeError: 'ascii' codec can't decode byte 0xc3`.

**Root cause:** `open()` without an explicit `encoding` parameter inherits the system locale. Python 3.11+ issues an `EncodingWarning` if you enable it (`-X warn_default_encoding`), but many teams don't.

**Fix:** Always pass `encoding="utf-8"` explicitly to `open()`. Add `errors="replace"` or `errors="backslashreplace"` when processing untrusted input where crashing is worse than lossy decoding.

**3. O(n^2) string concatenation in report generation**

A reporting service builds a large CSV string by looping over 200,000 rows and concatenating with `+=`. During load testing, this endpoint takes 12 seconds and spikes memory to 2 GB. The garbage collector struggles with hundreds of thousands of short-lived string objects.

**Root cause:** Each `+=` allocates a new string of length `old + addition` and copies the entire accumulated content. Total work is proportional to `n^2`.

**Fix:** Collect rows in a `list[str]` and call `"\n".join(rows)` at the end. Or, better yet, write directly to a `io.StringIO` buffer. For CSV specifically, use the `csv` module, which handles this internally.
:::

## 🎯 Checkpoint

::: details Question 1 — Float comparison
**Q:** Why does `0.1 + 0.2 != 0.3` in Python, and how do you correctly compare floats?

**A:** `0.1` and `0.2` cannot be represented exactly in IEEE 754 binary64 format. The closest representable double to `0.1` is slightly greater than `0.1`, and similarly for `0.2`. When you add these two approximations, the result is `0.30000000000000004` — close to `0.3` but not bit-identical to the closest double for `0.3`.

To compare correctly, use `math.isclose(a, b)`, which checks whether the two values are within a relative tolerance (default `1e-9`) of each other. For absolute comparisons near zero, pass `abs_tol`. For financial or exact-decimal use cases, avoid `float` entirely and use `decimal.Decimal` constructed from strings.
:::

::: details Question 2 — Integer memory overhead
**Q:** A Python `int` with value `42` uses 28 bytes. Why so much for a single small number? How does CPython store an integer internally?

**A:** CPython represents every `int` as a `PyLongObject`, which is a C struct containing: a reference count (8 bytes on 64-bit), a pointer to the type object (8 bytes), and a variable-length array of 30-bit "digits" plus a count/sign field. Even the number `42` needs one digit slot plus all the object header overhead, totaling 28 bytes. Larger integers simply add more digit slots (each holding 30 bits of magnitude), so `2**1000` might use ~172 bytes. The tradeoff is that Python integers have unlimited range — they never overflow — at the cost of being 7x larger than a raw C `int64_t`. For values -5 through 256, CPython pre-allocates and caches the objects at startup so that repeated use of common small integers doesn't incur extra allocations.
:::

::: details Question 3 — `is None` vs `== None`
**Q:** Why should you use `x is None` instead of `x == None`? Give a concrete example where they produce different results.

**A:** `is` checks object identity (same address in memory). `==` calls `__eq__`, which any class can override. Since `None` is a singleton (exactly one instance exists), `is None` is both correct and faster (a pointer comparison).

They differ when an object overrides `__eq__`:

```python
class AlwaysEqual:
    def __eq__(self, other):
        return True

obj = AlwaysEqual()
print(obj == None)   # True — __eq__ returns True for everything
print(obj is None)   # False — obj is not the None singleton
```

In production, ORM model fields, NumPy arrays, and pandas objects are common examples that override `__eq__` in ways that make `== None` behave unexpectedly (e.g., a SQLAlchemy column expression `Column == None` produces a SQL `IS NULL` clause rather than returning a boolean). Using `is None` avoids all such surprises.
:::

## Key Mental Models

- **Ints stretch, floats approximate.** Python integers have arbitrary precision and will never overflow. Floats are fixed-size IEEE 754 doubles with ~15 digits of precision — close but not exact for most decimals.
- **Strings are immutable bead necklaces.** Every method returns a new string. Build long strings with `''.join()` or `io.StringIO`, never `+=` in a loop.
- **`str` is text, `bytes` is data — never mix them.** Crossing the boundary requires explicit `.encode()` / `.decode()` with a named encoding. Always pass `encoding="utf-8"` to `open()`.
- **`None` is a singleton — test with `is`, not `==`.** Identity comparison is correct, faster, and immune to `__eq__` overrides.
- **Construct `Decimal` from strings, not floats.** `Decimal(0.1)` bakes in float imprecision before `Decimal` ever sees it. `Decimal("0.1")` is exact.

## Related

- [Python Data Model](02-data-model) — object identity, `is` vs `==`, reference counting, and small integer caching all originate here.
- [Python Module 2 — Data Structures](/python/module-02/) — lists, dicts, sets, and tuples build on these primitive types.
- [Python Module 9 — Memory & Performance](/python/module-09/) — GC behavior, `sys.getsizeof()`, memory profiling, and why object overhead matters at scale.
- [JS Core — Memory & GC Fundamentals](/js-core/07-memory-gc) — compare Python's reference counting + cycle collector with V8's generational garbage collector.
