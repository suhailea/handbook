---
title: Generators — Lazy Evaluation
outline: deep
---

# Generators — Lazy Evaluation

**Interview weight:** 🔥🔥🔥 — Generators are a top-tier interview topic. Expect questions on `yield` semantics, memory behavior, `yield from`, and `send()`.

**Python version notes:** `yield from` since 3.3 (PEP 380). `StopIteration` propagation changed in 3.7 (PEP 479). Generator return values since 3.3.

**Prerequisites:** [The Iterator Protocol](./01-iterator-protocol.md) (generators *are* iterators), [Functions & Scoping](/python/module-03/01-functions-first-class.md) (local variables, frames), [Scoping & Closures](/python/module-03/02-scoping-closures.md) (understanding what "suspend local state" means).

## 🗣️ In Plain English

::: tip In Plain English
A generator is like a TV show you're streaming. The production studio doesn't film all 100 episodes, stack them in a warehouse, and ship the whole pile to your house before you can watch the first one. Instead, each episode is produced one at a time. You press "next episode," and the studio makes the next one right then. If you pause and come back next week, the studio picks up exactly where it left off — same sets, same actors, same scene.

That's what `yield` does. A normal function is like a movie on a DVD: it runs from start to finish, gives you the whole thing at once, and then it's done. A generator function is the streaming show: it runs until it hits `yield`, hands you one value, and then *freezes in place*. Everything — every local variable, every half-finished calculation — stays exactly as it was. When you ask for the next value, it unfreezes and continues from that exact spot.

Why bother? Imagine a show with a million episodes. The DVD approach means manufacturing a million discs before you watch one. The streaming approach means you only ever have one episode in hand at a time. If you decide to stop watching after episode 5, the studio never wastes effort on episodes 6 through a million. That's the memory advantage: a generator producing a million numbers uses the same amount of memory as one producing five.

You can also *talk back* to the show. Imagine pressing a button that tells the studio "actually, change the genre to comedy starting now." That's `send()` — it lets you push a value *into* the generator, influencing what it produces next. And if you want the show cancelled, `close()` tells the studio to shut down the set, and `throw()` lets you throw a rotten tomato onto the stage to see how the actors handle it.
:::

## ⚙️ Under the Hood

### Generator Functions vs Normal Functions

A function containing `yield` is a **generator function**. Calling it does not execute the body — it returns a **generator object** (which is an iterator):

```python
# run: python3 gen_basics.py
def count_up(n: int):
    """A generator function — note the yield keyword."""
    i = 0
    while i < n:
        yield i
        i += 1

# Calling the function does NOT run the body
gen = count_up(3)
print(type(gen))  # <class 'generator'>

# The generator IS an iterator
print(hasattr(gen, "__next__"))  # True
print(hasattr(gen, "__iter__"))  # True
print(iter(gen) is gen)          # True

# Values are produced lazily
print(next(gen))  # 0  — body runs until first yield
print(next(gen))  # 1  — resumes after yield, runs until next yield
print(next(gen))  # 2
# next(gen) would raise StopIteration
```

### The Generator State Machine

A generator object has four states, visible via `gi_frame` and inspectable via `inspect.getgeneratorstate()`:

```python
# run: python3 gen_states.py
import inspect

def my_gen():
    yield 1
    yield 2

g = my_gen()
print(inspect.getgeneratorstate(g))  # GEN_CREATED — never started

next(g)
print(inspect.getgeneratorstate(g))  # GEN_SUSPENDED — paused at yield

next(g)
print(inspect.getgeneratorstate(g))  # GEN_SUSPENDED — paused at second yield

try:
    next(g)
except StopIteration:
    pass
print(inspect.getgeneratorstate(g))  # GEN_CLOSED — finished or closed

# GEN_RUNNING is only visible from within the generator itself
# (e.g., if the generator inspects its own state during execution)
```

States:
| State | `gi_frame` | Meaning |
|-------|-----------|---------|
| `GEN_CREATED` | frame exists, not started | `next()` not yet called |
| `GEN_RUNNING` | frame on the call stack | Currently executing (only visible from within) |
| `GEN_SUSPENDED` | frame exists, paused at `yield` | Waiting for `next()` / `send()` |
| `GEN_CLOSED` | `gi_frame is None` | Exhausted, closed, or threw an unhandled exception |

### How `yield` Suspends Execution

When the interpreter hits `yield`, it:
1. Saves the generator's frame object (local variables, instruction pointer, block stack) — the frame is **not** deallocated.
2. Returns the yielded value to the caller of `__next__`.
3. The generator's instruction pointer stays at the `yield` expression.

When `__next__` is called again:
1. The saved frame is pushed back onto the call stack.
2. Execution resumes from the instruction *after* the `yield`.
3. In a plain `next()` call, the `yield` expression evaluates to `None`.

```python
# run: python3 yield_internals.py
def demo():
    print("before first yield")
    x = yield 10
    print(f"after first yield, x = {x}")
    y = yield 20
    print(f"after second yield, y = {y}")

g = demo()
val1 = next(g)       # prints "before first yield", val1 = 10
print(f"got {val1}")

val2 = next(g)       # prints "after first yield, x = None", val2 = 20
print(f"got {val2}")

try:
    next(g)           # prints "after second yield, y = None", then StopIteration
except StopIteration:
    print("done")
```

### `send(value)` — Pushing Data Into a Generator

`send(value)` resumes the generator and makes the `yield` expression evaluate to `value` instead of `None`:

```python
# run: python3 gen_send.py
def accumulator():
    """Yields running totals. Send values in to add them."""
    total = 0
    while True:
        received = yield total
        if received is None:
            break
        total += received

g = accumulator()
# Must prime the generator first — advance to the first yield
print(next(g))          # 0 (initial total)

print(g.send(10))       # 10
print(g.send(20))       # 30
print(g.send(5))        # 35

try:
    g.send(None)        # triggers break → StopIteration
except StopIteration:
    print("done")
```

**Critical rule:** The first call must be `next(g)` or `g.send(None)` to advance the generator to the first `yield`. Sending a non-None value to a just-started generator raises `TypeError`.

### `throw(exception)` and `close()`

```python
# run: python3 gen_throw_close.py
def resilient():
    try:
        while True:
            try:
                value = yield
                print(f"received: {value}")
            except ValueError as e:
                print(f"handled ValueError: {e}")
    except GeneratorExit:
        print("generator closed — cleanup here")
        # Do NOT yield inside GeneratorExit handling

g = resilient()
next(g)                          # prime

g.send("hello")                  # received: hello
g.throw(ValueError, "bad data")  # handled ValueError: bad data
g.send("still alive")           # received: still alive
g.close()                       # generator closed — cleanup here
```

- **`throw(type, value, traceback)`**: Raises the exception *at the point where the generator is suspended*. If the generator catches it, execution continues to the next `yield`. If not, the exception propagates to the caller.
- **`close()`**: Throws `GeneratorExit` at the suspension point. If the generator catches it and tries to `yield`, Python raises `RuntimeError`. The generator should perform cleanup and return.

### Generator Expressions

A generator expression creates an anonymous generator object — lazy, single-pass:

```python
# run: python3 genexpr.py
import sys

# List comprehension: builds the entire list in memory
list_comp = [x * 2 for x in range(1_000_000)]
print(f"list: {sys.getsizeof(list_comp):,} bytes")  # ~8 MB

# Generator expression: produces values on demand
gen_expr = (x * 2 for x in range(1_000_000))
print(f"generator: {sys.getsizeof(gen_expr):,} bytes")  # ~200 bytes

# Generator expressions are single-pass
first_five = [next(gen_expr) for _ in range(5)]
print(first_five)  # [0, 2, 4, 6, 8]
# The generator remembers its position — next call continues from 10
```

Generator expressions use the same parenthesis syntax as tuples but are distinguished by the `for` clause. When a generator expression is the sole argument to a function, the extra parentheses can be omitted: `sum(x*x for x in range(10))`.

### `yield from` — Delegating to Sub-Generators (PEP 380)

`yield from iterable` delegates iteration to another iterable, transparently passing `send()`, `throw()`, and `close()` through:

```python
# run: python3 yield_from_demo.py
def inner():
    """A sub-generator that can receive values and return a result."""
    total = 0
    while True:
        value = yield
        if value is None:
            return total  # This becomes the value of the yield-from expression
        total += value


def outer():
    """Delegates to inner(), gets its return value."""
    print("delegating to inner...")
    result = yield from inner()  # result captures inner's return value
    print(f"inner returned: {result}")
    yield result


g = outer()
next(g)           # prime — prints "delegating to inner..."
g.send(10)        # goes straight to inner's yield
g.send(20)        # goes straight to inner's yield
try:
    g.send(None)  # inner returns 30 → outer prints and yields 30
except StopIteration as e:
    pass
```

What `yield from` handles that manual forwarding doesn't:
1. Forwards `next()` and `send()` calls to the sub-generator.
2. Forwards `throw()` and `close()` to the sub-generator.
3. Captures the sub-generator's `return` value as the value of the `yield from` expression.
4. Propagates `StopIteration` correctly.

Without `yield from`, implementing this correctly requires about 40 lines of try/except boilerplate.

### Flattening with `yield from`

The most common practical use — recursively flattening nested structures:

```python
# run: python3 flatten.py
from collections.abc import Iterable

def flatten(items):
    """Recursively flatten nested iterables (except strings)."""
    for item in items:
        if isinstance(item, Iterable) and not isinstance(item, (str, bytes)):
            yield from flatten(item)
        else:
            yield item

nested = [1, [2, 3, [4, 5]], 6, [[7], 8]]
print(list(flatten(nested)))  # [1, 2, 3, 4, 5, 6, 7, 8]
```

### Memory Comparison

```python
# run: python3 memory_comparison.py
import sys

def squares_gen(n: int):
    """Generator: O(1) memory regardless of n."""
    for i in range(n):
        yield i * i

def squares_list(n: int) -> list[int]:
    """List: O(n) memory."""
    return [i * i for i in range(n)]

n = 1_000_000

gen = squares_gen(n)
lst = squares_list(n)

print(f"Generator object: {sys.getsizeof(gen):>10,} bytes")
print(f"List of {n:,}:     {sys.getsizeof(lst):>10,} bytes")

# The generator hasn't computed anything yet — it's just a suspended frame.
# The list has allocated memory for all 1M integers.
```

### Use Cases

**Streaming large files line by line:**

```python
# run: python3 streaming_file.py
from pathlib import Path
import tempfile

# Create a demo file
tmp = Path(tempfile.mktemp(suffix=".txt"))
tmp.write_text("\n".join(f"line {i}" for i in range(1000)))

def grep(filepath: Path, pattern: str):
    """Lazily yield matching lines — never loads entire file."""
    with open(filepath) as f:
        for line in f:
            if pattern in line:
                yield line.rstrip()

# Only matching lines are ever in memory
matches = grep(tmp, "42")
print(list(matches))  # ['line 42', 'line 420', 'line 421', ...]

tmp.unlink()
```

**Infinite sequences:**

```python
# run: python3 fibonacci.py
def fibonacci():
    """Infinite Fibonacci generator."""
    a, b = 0, 1
    while True:
        yield a
        a, b = b, a + b

# Take only what you need
from itertools import islice
print(list(islice(fibonacci(), 15)))
# [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233, 377]
```

**Data pipelines — chaining generators:**

```python
# run: python3 pipeline.py
def read_lines(text: str):
    for line in text.strip().splitlines():
        yield line

def parse_csv(lines):
    for line in lines:
        yield line.split(",")

def filter_active(records):
    for record in records:
        if record[2].strip().lower() == "active":
            yield record

def format_output(records):
    for record in records:
        yield f"{record[0].strip()} ({record[1].strip()})"

data = """
Alice, Engineering, Active
Bob, Marketing, Inactive
Charlie, Engineering, Active
Diana, Sales, Active
Eve, Marketing, Inactive
"""

# Pipeline: no intermediate lists created
pipeline = format_output(filter_active(parse_csv(read_lines(data))))
for result in pipeline:
    print(result)
# Alice (Engineering)
# Charlie (Engineering)
# Diana (Sales)
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Generator exhaustion in retry logic.**
A function receives a generator of items to process. On failure, the retry logic calls the function again with the same generator object. The second attempt processes zero items because the generator is spent. No exception, no warning — just silent data loss. **Fix:** Accept iterables (not iterators) in public APIs, or materialize to a list before retrying. Document whether a function consumes its input.

**2. Holding resources open via suspended generators.**
A generator opens a database connection or file handle, yields rows, and cleans up in a `finally` block. If the consumer breaks out of the `for` loop early and the generator object isn't closed or garbage-collected, the resource stays open. CPython's reference counting usually handles this, but PyPy and other implementations with deferred GC may delay cleanup indefinitely. **Fix:** Use `contextlib.closing()` or explicitly call `gen.close()`. Better yet, manage resources in a `with` block *outside* the generator.

**3. `StopIteration` from `next()` inside a generator (PEP 479).**
Before Python 3.7, calling `next()` on an exhausted inner iterator inside a generator silently terminated the outer generator — a subtle source of data truncation bugs. Since 3.7, this raises `RuntimeError`. Code migrated from 3.6 or earlier may hit unexpected `RuntimeError` in generators that relied on `StopIteration` propagation.

```python
# Broken pattern:
def take_pairs(it):
    it = iter(it)
    while True:
        a = next(it)  # 💥 RuntimeError when exhausted (3.7+)
        b = next(it)
        yield (a, b)

# Fixed:
def take_pairs_safe(it):
    it = iter(it)
    while True:
        try:
            a = next(it)
        except StopIteration:
            return
        try:
            b = next(it)
        except StopIteration:
            return
        yield (a, b)

print(list(take_pairs_safe([1, 2, 3, 4, 5])))  # [(1, 2), (3, 4)]
```

:::

## 🎯 Checkpoint

::: details Question 1 — Generator vs Iterator
**Q:** You can build an iterator by writing a class with `__iter__` and `__next__`. You can also write a generator function. When would you choose one over the other?

**A:** Use a **generator function** when the iteration logic is straightforward sequential code — it's far less boilerplate (no class, no `StopIteration` management, no explicit state variables). The generator's frame automatically preserves all local state.

Use a **class-based iterator** when:
- You need to expose additional methods beyond the iteration protocol (e.g., `reset()`, `peek()`, `skip(n)`).
- The iteration state is complex and benefits from named attributes rather than local variables.
- You need the iterable to be re-iterable (the class's `__iter__` creates a fresh iterator each time).
- You need to serialize/pickle the iterator state (generator frames are not picklable).

In practice, generators cover 90%+ of use cases. Class-based iterators are for when you need a richer interface.
:::

::: details Question 2 — `yield from` vs manual forwarding
**Q:** What does `yield from sub_gen` do that a simple `for item in sub_gen: yield item` does not?

**A:** The `for`/`yield` loop only forwards `__next__` calls. `yield from` additionally:

1. **Forwards `send(value)`** — values sent to the outer generator pass through to the sub-generator's `yield` expression.
2. **Forwards `throw(exc)`** — exceptions thrown into the outer generator are thrown into the sub-generator.
3. **Forwards `close()`** — closing the outer generator closes the sub-generator.
4. **Captures the sub-generator's `return` value** — the `return` value of the sub-generator becomes the value of the `yield from` expression in the outer generator.
5. **Handles `StopIteration` correctly** — including extracting the return value from `StopIteration.value`.

If you only use `next()` to drive the generator and never use `send`/`throw`/`close`, the two are functionally identical. But `yield from` is essential for coroutine-style generators and is the foundation of `async`/`await` (which originally desugared to `yield from`).
:::

::: details Question 3 — Memory and laziness
**Q:** A data pipeline reads 50 GB of log files, filters lines matching a pattern, extracts timestamps, and counts unique hours. How would you implement this with generators to avoid memory issues? What's the peak memory usage?

**A:** Chain generators where each stage processes one line at a time:

```python
def read_files(paths):
    for path in paths:
        with open(path) as f:
            yield from f  # yields one line at a time

def filter_pattern(lines, pattern):
    for line in lines:
        if pattern in line:
            yield line

def extract_hour(lines):
    for line in lines:
        # assume timestamp is first 13 chars: "2024-01-15 03"
        yield line[:13]

# Only the set of unique hours is materialized
unique_hours = set(extract_hour(filter_pattern(read_files(paths), "ERROR")))
```

Peak memory is proportional to: **(a)** the size of the largest single line (held by the current generator stage), **(b)** the number of unique hours in the result set (held by the `set`), and **(c)** Python's file I/O buffer (typically 8 KB). The 50 GB of raw data is never in memory — each line is read, passed through the pipeline, and discarded before the next line is read. Peak memory is likely a few MB regardless of input size, assuming the set of unique hours is small.
:::

## Key Mental Models

- **A generator function is a factory for iterators.** Calling it doesn't run code — it creates a generator object paused at the top of the function body.
- **`yield` is a two-way valve.** It pushes a value out to the caller *and* can receive a value back in via `send()`. A plain `next()` sends `None`.
- **Generator state lives on the frame.** All local variables are preserved in `gi_frame` between `yield`s — no manual state management needed.
- **`yield from` is not just syntactic sugar for a for-loop.** It creates a transparent bidirectional channel between the caller and the sub-generator, forwarding `send`, `throw`, `close`, and `return`.
- **Generators trade CPU for memory.** Each value is computed on demand rather than stored. For large or infinite sequences, this is essential. For small sequences iterated multiple times, a list is cheaper.

## Related

- [The Iterator Protocol](./01-iterator-protocol.md) — the contract that generators implement automatically.
- [Comprehensions & itertools](./03-comprehensions-itertools.md) — generator expressions and pre-built tools for composing lazy pipelines.
- [Scoping & Closures](/python/module-03/02-scoping-closures.md) — understanding frame objects and local variable scope, which generators suspend and resume.
- [Context Managers](/python/module-06/02-context-managers.md) — `contextlib.contextmanager` uses generators to implement context managers.
