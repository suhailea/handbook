---
title: The Iterator Protocol
outline: deep
---

# The Iterator Protocol

**Interview weight:** 🔥🔥🔥 — Nearly every Python interview touches iteration. Understanding the protocol beneath `for` separates "I use Python" from "I understand Python."

**Python version notes:** The protocol itself is unchanged since Python 2. The `collections.abc` location stabilized in 3.3. Bytecode opcodes referenced here are CPython 3.12+.

**Prerequisites:** [Functions & Scoping](/python/module-03/01-functions-first-class.md) (callables, dunder methods), [Classes & Instances](/python/module-04/01-classes-instances.md) (writing classes with special methods).

## 🗣️ In Plain English

::: tip In Plain English
Think of an **iterable** as a book. A book can be read, but the book itself doesn't remember where you left off — it just sits on the shelf, always ready to be opened from page one.

When you decide to read the book, you grab a **bookmark** and place it at the start. That bookmark is the **iterator**. Every time you say "give me the next page," the bookmark moves forward one page and shows you what's there. It can only move forward — there's no "previous page" button on this bookmark.

When the bookmark reaches the last page and you ask for more, it tells you "there are no more pages." That's **StopIteration** — not an error, just the bookmark saying the book is finished.

Here's the key insight: you can create as many bookmarks as you want for the same book. Each one starts at page one and moves independently. But each individual bookmark is a one-way trip — once it reaches the end, it's done. You can't rewind it; you just grab a new bookmark.

A `for` loop in Python does exactly this behind the scenes: it asks the book for a fresh bookmark, then keeps saying "next page, next page, next page" until the bookmark says it's done. You never see the bookmark or the "I'm done" signal — Python handles both for you.

Some things in Python are *both* the book and the bookmark — like a file object. You can read through it once, but if you want to read again, you need to seek back to the start or open the file fresh. That's why iterating over a file twice without resetting gives you nothing the second time.
:::

## ⚙️ Under the Hood

### The Two-Dunder Contract

Python's iteration is built on two protocols defined in `collections.abc`:

| Protocol | Required Method | Returns | ABC |
|----------|----------------|---------|-----|
| **Iterable** | `__iter__()` | An iterator | `collections.abc.Iterable` |
| **Iterator** | `__next__()` | The next value, or raises `StopIteration` | `collections.abc.Iterator` |

An **iterator** must also implement `__iter__()` returning `self`. This makes every iterator also an iterable — you can pass an iterator anywhere an iterable is expected.

```python
# run: python3 iterator_basics.py
from collections.abc import Iterable, Iterator

# A list is iterable but NOT an iterator
numbers = [1, 2, 3]
print(isinstance(numbers, Iterable))  # True
print(isinstance(numbers, Iterator))  # False

# Calling iter() on the list produces an iterator
it = iter(numbers)
print(isinstance(it, Iterator))  # True
print(isinstance(it, Iterable))  # True — iterators are also iterable

# __iter__ on the iterator returns itself
print(it.__iter__() is it)  # True

# __next__ yields values one at a time
print(next(it))  # 1
print(next(it))  # 2
print(next(it))  # 3

try:
    next(it)
except StopIteration:
    print("Exhausted — no more values")
```

### How `for` Desugars

A `for` loop is syntactic sugar. This:

```python
for x in collection:
    process(x)
```

Is equivalent to:

```python
_iter = iter(collection)        # calls collection.__iter__()
while True:
    try:
        x = next(_iter)         # calls _iter.__next__()
    except StopIteration:
        break
    process(x)
```

You can see this at the bytecode level:

```python
# run: python3 for_loop_bytecode.py
import dis

def loop_demo():
    for x in [1, 2, 3]:
        pass

dis.dis(loop_demo)
# Key opcodes to look for:
#   GET_ITER     — calls iter() on the iterable
#   FOR_ITER     — calls __next__(), jumps to end on StopIteration
#   END_FOR      — cleanup after the loop (3.12+)
```

In CPython 3.12+, `FOR_ITER` is a specialized opcode that calls `__next__()` and, on `StopIteration`, jumps directly past the loop body — no Python-level exception handling overhead for the normal termination case.

### Building a Custom Iterator

```python
# run: python3 countdown.py
class Countdown:
    """An iterable that produces values from n down to 1."""

    def __init__(self, start: int) -> None:
        self.start = start

    def __iter__(self) -> "CountdownIterator":
        # Each call returns a FRESH iterator — the iterable itself
        # is never exhausted
        return CountdownIterator(self.start)


class CountdownIterator:
    """The iterator (bookmark) for Countdown."""

    def __init__(self, current: int) -> None:
        self.current = current

    def __iter__(self) -> "CountdownIterator":
        return self  # iterators return themselves

    def __next__(self) -> int:
        if self.current <= 0:
            raise StopIteration
        value = self.current
        self.current -= 1
        return value


# Two independent iterations over the same iterable
cd = Countdown(3)
print(list(cd))  # [3, 2, 1]
print(list(cd))  # [3, 2, 1] — works again because __iter__ creates a new iterator

# The iterator itself is one-pass
it = iter(cd)
print(list(it))  # [3, 2, 1]
print(list(it))  # [] — exhausted, no reset
```

### Combining Iterable and Iterator in One Class

Sometimes you see a single class serve as both iterable and iterator. This works but creates a one-pass object — fine for single-use streams, dangerous when callers expect re-iterability:

```python
# run: python3 single_pass.py
class SinglePassRange:
    """Acts as both iterable and iterator — one pass only."""

    def __init__(self, n: int) -> None:
        self.n = n
        self.current = 0

    def __iter__(self) -> "SinglePassRange":
        return self  # returns self, so this IS the iterator

    def __next__(self) -> int:
        if self.current >= self.n:
            raise StopIteration
        value = self.current
        self.current += 1
        return value


r = SinglePassRange(3)
print(list(r))  # [0, 1, 2]
print(list(r))  # [] — exhausted, __iter__ returned the same spent object
```

### `iter()` with a Sentinel (Two-Argument Form)

The built-in `iter()` has a lesser-known two-argument form: `iter(callable, sentinel)`. It repeatedly calls the callable until the return value equals the sentinel, then raises `StopIteration`.

```python
# run: python3 iter_sentinel.py
import io

# Simulate reading fixed-size blocks until empty string
data = io.StringIO("aaabbbccc")
blocks: list[str] = []

for block in iter(lambda: data.read(3), ""):
    blocks.append(block)

print(blocks)  # ['aaa', 'bbb', 'ccc']

# Classic use: reading lines from a socket/pipe until a marker
# for line in iter(socket.readline, b""):
#     process(line)
```

Under the hood, `iter(callable, sentinel)` returns a `callable_iterator` object (a CPython internal type) whose `__next__` calls the callable and compares the result to the sentinel using `==`.

### Why Iterators Are One-Pass

An iterator maintains internal state (the "cursor position"). Once `__next__` raises `StopIteration`, the protocol provides no `__reset__` or `__rewind__` method. This is by design:

- Many data sources are inherently one-pass (network streams, stdin, sensor readings).
- Requiring rewind would force buffering, defeating the memory advantage.
- If you need multiple passes, iterate over the **iterable** (which creates fresh iterators), not the iterator.

```python
# run: python3 exhaustion_demo.py
nums = [10, 20, 30]
it = iter(nums)

# First pass works
for n in it:
    print(n, end=" ")  # 10 20 30
print()

# Second pass over the SAME iterator — nothing
for n in it:
    print(n, end=" ")  # (nothing printed)
print("(empty)")

# Second pass over the ITERABLE — works
for n in nums:
    print(n, end=" ")  # 10 20 30
print()
```

### The `collections.abc` ABCs

The abstract base classes provide `isinstance` checking and can be used as base classes for your own iterators:

```python
# run: python3 abc_iterator.py
from collections.abc import Iterator
from typing import override


class Fib(Iterator[int]):
    """Infinite Fibonacci iterator using the ABC."""

    def __init__(self) -> None:
        self.a = 0
        self.b = 1

    @override
    def __next__(self) -> int:
        value = self.a
        self.a, self.b = self.b, self.a + self.b
        return value

    # __iter__ is inherited from Iterator — returns self


fib = Fib()
first_ten = [next(fib) for _ in range(10)]
print(first_ten)  # [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
```

The ABC hierarchy:

```
Iterable          — requires __iter__
  └── Iterator    — requires __next__, provides __iter__ returning self
```

Registering via `isinstance` also works with structural subtyping — any object with `__iter__` and `__next__` is recognized as an `Iterator` even without inheriting the ABC *(since Python 3.0, via `__subclasshook__`)*.

### CPython Bytecode: `GET_ITER` and `FOR_ITER`

For those who want to see the machinery at the C level:

- **`GET_ITER`**: Calls `PyObject_GetIter()`, which invokes `tp_iter` on the object's type (the C-level equivalent of `__iter__`). Pushes the resulting iterator onto the value stack.
- **`FOR_ITER`**: Calls `tp_iternext` on the top-of-stack iterator. If a value is returned, pushes it. If `StopIteration` is raised, pops the iterator and jumps past the loop body. In CPython 3.12+, specialized variants (`FOR_ITER_LIST`, `FOR_ITER_RANGE`, etc.) inline the iteration for built-in types, avoiding method lookup overhead entirely.

```python
# run: python3 bytecode_detail.py
import dis
import sys

print(f"CPython {sys.version}")

def iterate_range():
    total = 0
    for i in range(5):
        total += i
    return total

dis.dis(iterate_range)
# On 3.12+, look for LOAD_FAST, FOR_ITER_RANGE (specialized),
# and END_FOR opcodes
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Silent exhaustion — iterating a spent iterator returns nothing, no error.**
A function accepts an iterable, iterates it once for validation, then tries to iterate again for processing. The second pass silently produces zero items. No exception, no warning — just missing data. This is especially treacherous when passing generator objects (which are iterators) where the caller expects a re-iterable collection. **Fix:** If a function needs multiple passes, materialize to a list at the boundary, or document that it consumes the iterator.

**2. Mutating a collection during iteration.**
Adding or removing items from a dict or set while iterating raises `RuntimeError` in Python 3. Lists don't raise, but skip or duplicate elements unpredictably as indices shift.

```python
# RuntimeError: dictionary changed size during iteration
d = {"a": 1, "b": 2, "c": 3}
for k in d:
    if d[k] < 2:
        del d[k]  # 💥 RuntimeError
```

**Fix:** Iterate over a snapshot — `for k in list(d):` — or build a separate list of keys to delete.

**3. `StopIteration` leaking out of a generator.**
If code inside a generator calls `next()` on an inner iterator and that raises `StopIteration`, in Python 3.6- it silently terminated the outer generator. Since Python 3.7 (PEP 479), this raises `RuntimeError` instead. Legacy code that relied on the old behavior breaks on upgrade.

```python
# run: python3 stopiter_leak.py
def old_style_gen(it):
    while True:
        yield next(it)  # 💥 RuntimeError in 3.7+ when it is exhausted

# Fix: use for-loop or explicit try/except
def safe_gen(it):
    for item in it:
        yield item

print(list(safe_gen(iter([1, 2, 3]))))  # [1, 2, 3]
```

:::

## 🎯 Checkpoint

::: details Question 1 — Iterable vs Iterator
**Q:** What is the precise difference between an iterable and an iterator? Can an object be both? What are the consequences of being both?

**A:** An **iterable** implements `__iter__()` and returns an iterator. An **iterator** implements `__next__()` (returning values or raising `StopIteration`) AND `__iter__()` returning `self`. So every iterator is also an iterable, but not every iterable is an iterator.

An object *can* be both — when `__iter__` returns `self`. The consequence is that the object is **single-pass**: once exhausted, calling `iter()` on it again returns the same spent object. This is appropriate for inherently single-pass sources (files, network streams) but dangerous for data structures where callers expect re-iteration. The canonical pattern for re-iterable collections is to have the iterable create a *new* iterator object in `__iter__`.
:::

::: details Question 2 — `for` loop internals
**Q:** A junior developer writes `for x in my_obj:` and gets `TypeError: 'MyObj' object is not iterable`. They add `__next__` to the class. Will the `for` loop work now?

**A:** No. The `for` loop starts with `GET_ITER`, which calls `iter()` on the object. The built-in `iter()` looks for `__iter__` first. If `__iter__` is absent, it falls back to `__getitem__` with integer indices starting from 0 (a legacy protocol). It does **not** fall back to `__next__`. So adding only `__next__` is insufficient — the class needs `__iter__` (returning `self` or a dedicated iterator). Alternatively, implementing `__getitem__` with sequential integer keys would work via the legacy fallback, but this is not the recommended approach.
:::

::: details Question 3 — `iter(callable, sentinel)`
**Q:** Explain `iter(f, sentinel)`. Why is it useful for I/O patterns? What type does it return?

**A:** `iter(callable, sentinel)` returns a `callable_iterator` (an internal CPython type). On each `__next__` call, it invokes the callable with no arguments and compares the result to `sentinel` using `==`. If they match, it raises `StopIteration`; otherwise, it yields the result.

This is useful for I/O because many read patterns follow "call a function repeatedly until you get an end marker." For example, reading fixed-size blocks: `iter(lambda: file.read(4096), b"")` reads 4 KB chunks until the file is exhausted (returning `b""`). Without this form, you'd need an explicit `while True` / `break` loop.
:::

## Key Mental Models

- **Iterable = "I can produce iterators." Iterator = "I am a cursor and I can produce next values."** The split between container and cursor is the foundation of Python's entire iteration system.
- **`for` is syntactic sugar for `iter()` + repeated `next()` + catch `StopIteration`.** Once you see through the sugar, iterator behavior becomes predictable.
- **Iterators are one-way, one-pass.** There is no rewind. If you need multiple passes, go back to the iterable (or materialize to a list).
- **`__iter__` returning `self` means single-pass.** If your `__iter__` creates a new object, your iterable is re-iterable. If it returns `self`, it's a one-shot.
- **`StopIteration` is not an error — it's a signal.** The `for` loop catches it silently. But if it leaks out of a generator (3.7+), Python converts it to `RuntimeError` to prevent subtle bugs.

## Related

- [Generators — Lazy Evaluation](./02-generators.md) — generators implement the iterator protocol automatically, so you rarely write `__iter__`/`__next__` by hand.
- [Comprehensions & itertools](./03-comprehensions-itertools.md) — high-level tools for consuming and composing iterators.
- [Classes & Instances](/python/module-04/01-classes-instances.md) — building classes with dunder methods.
- [Context Managers](/python/module-06/02-context-managers.md) — another dunder-based protocol (`__enter__`/`__exit__`) that often pairs with iteration for resource cleanup.
