---
title: Functional Programming Tools
outline: deep
---

# Functional Programming Tools

> **Interview weight:** 🔥 — rarely the main topic, but `lambda`, `map`/`filter`, and `lru_cache` appear in code-reading and optimization questions.
> **Python version notes:** Examples target Python 3.12+. `functools.cache` was added in 3.9. `operator.call` was added in 3.11.
> **Prerequisites:** [Functions as First-Class Objects](./01-functions-first-class.md), [Decorators](./03-decorators.md) (for `lru_cache`).

## 🗣️ In Plain English

::: tip In Plain English
Picture an assembly line in a factory.

**`map`** is a processing station. Every item on the conveyor belt passes through it and comes out transformed — a raw potato goes in, a peeled potato comes out. You tell the station what operation to perform (peel, slice, paint, whatever), and it applies that operation to each item, one at a time, without caring what the items are.

**`filter`** is a quality-check station. A worker inspects each item and asks a yes-or-no question: "Does this potato weigh more than 200 grams?" Items that pass the test continue down the belt; items that fail are diverted to the reject bin. The station does not change items — it only decides which ones survive.

**`reduce`** is the station at the end of the line that squashes everything into one final product. Imagine a worker who takes the first two potatoes, mashes them together, then takes that result and mashes it with the third potato, and so on until there is one giant lump. The final lump is the single output.

These tools let you describe *what* should happen to data ("transform each item," "keep items matching this rule," "collapse everything into one") without writing explicit loops. You hand them a small recipe card (a function) and a conveyor belt (an iterable), and they handle the mechanics.

Python also gives you a way to create tiny, nameless recipe cards on the spot — **lambda expressions**. They are useful when the recipe is so simple that giving it a full name would be more clutter than help. Think of a lambda as a sticky note with one instruction, versus a full recipe card with a title and detailed steps.

One final tool: **`partial`**. Imagine you have a recipe card that says "make a sandwich with bread X and filling Y." If you always use sourdough, you can create a simplified card that says "make a sandwich with filling Y" — sourdough is pre-filled. That is partial application: you lock in some arguments ahead of time and get back a simpler function.
:::

## ⚙️ Under the Hood

### Lambda Expressions

A `lambda` creates an anonymous function object. It is limited to a **single expression** — no statements, no assignments, no multi-line logic:

```python
# run: python3 lambda_basics.py
# Lambda syntax: lambda params: expression
square = lambda x: x ** 2
print(square(5))           # 25
print(type(square))        # <class 'function'>
print(square.__name__)     # '<lambda>' — anonymous

# Lambdas are just syntactic sugar for a def with a return:
def square_named(x):
    return x ** 2

# They produce identical bytecode for the body
import dis
print("=== lambda ===")
dis.dis(square)
print("=== def ===")
dis.dis(square_named)
```

**When to use lambda vs named functions:**
- Use `lambda` for short, throwaway callbacks (e.g., `sorted(items, key=lambda x: x.name)`).
- Use a named `def` when: the logic needs multiple expressions, you want a docstring, or the function is used more than once. PEP 8 explicitly discourages assigning a lambda to a variable — use `def` instead.

### `map()` — Transform Every Element

`map(func, iterable)` returns a **lazy iterator** that applies `func` to each element:

```python
# run: python3 map_demo.py
# map returns an iterator, not a list (Python 3)
numbers = [1, 2, 3, 4, 5]

squared = map(lambda x: x ** 2, numbers)
print(type(squared))       # <class 'map'>
print(list(squared))       # [1, 4, 9, 16, 25]

# map with multiple iterables — stops at shortest
a = [1, 2, 3]
b = [10, 20, 30, 40]
print(list(map(lambda x, y: x + y, a, b)))  # [11, 22, 33]

# Equivalent list comprehension (usually preferred in Python):
print([x ** 2 for x in numbers])  # [1, 4, 9, 16, 25]
```

**Key point:** `map` is lazy — it does not compute results until iterated. This matters for large datasets where you want to process elements one at a time without materializing the entire result.

### `filter()` — Select Elements

`filter(func, iterable)` returns a lazy iterator yielding elements for which `func` returns truthy:

```python
# run: python3 filter_demo.py
numbers = range(1, 11)

evens = filter(lambda x: x % 2 == 0, numbers)
print(type(evens))         # <class 'filter'>
print(list(evens))         # [2, 4, 6, 8, 10]

# filter(None, iterable) removes falsy values
data = [0, 1, "", "hello", None, [], [1, 2], False, True]
print(list(filter(None, data)))  # [1, 'hello', [1, 2], True]

# Equivalent list comprehension:
print([x for x in range(1, 11) if x % 2 == 0])  # [2, 4, 6, 8, 10]
```

### `functools.reduce()` — Fold a Sequence

`reduce(func, iterable[, initializer])` applies a two-argument function cumulatively to elements, reducing the sequence to a single value:

```python
# run: python3 reduce_demo.py
from functools import reduce
import operator

# Sum without built-in sum:
numbers = [1, 2, 3, 4, 5]
total = reduce(operator.add, numbers)
print(total)  # 15

# Step by step: ((((1+2)+3)+4)+5)
# Step 1: add(1, 2) = 3
# Step 2: add(3, 3) = 6
# Step 3: add(6, 4) = 10
# Step 4: add(10, 5) = 15

# With initializer (avoids TypeError on empty sequences):
print(reduce(operator.add, [], 0))  # 0

# Flatten a list of lists:
nested = [[1, 2], [3, 4], [5]]
flat = reduce(operator.iadd, nested, [])
print(flat)  # [1, 2, 3, 4, 5]
# Note: operator.iadd mutates, so pass a fresh [] as initializer

# Find maximum (for illustration — use max() in practice):
print(reduce(lambda a, b: a if a > b else b, numbers))  # 5
```

`reduce` was moved from builtins to `functools` in Python 3 — Guido van Rossum argued that explicit loops are usually clearer. Use `reduce` when the reduction pattern is well-known (sum, product, flatten). For anything complex, write a loop.

### `functools.partial()` — Partial Application

`partial(func, *args, **kwargs)` returns a new callable with some arguments pre-filled:

```python
# run: python3 partial_demo.py
from functools import partial

# Base function with many parameters
def power(base: float, exponent: float) -> float:
    return base ** exponent

# Create specialized versions
square = partial(power, exponent=2)
cube = partial(power, exponent=3)

print(square(5))    # 25.0
print(cube(3))      # 27.0

# Inspect what partial stores
print(square.func)      # <function power at 0x...>
print(square.args)      # ()
print(square.keywords)  # {'exponent': 2}

# Practical use: pre-configured API client
import json

compact_json = partial(json.dumps, indent=None, separators=(",", ":"))
pretty_json = partial(json.dumps, indent=2)

data = {"name": "Alice", "scores": [95, 87, 92]}
print(compact_json(data))
# {"name":"Alice","scores":[95,87,92]}
print(pretty_json(data))
# {
#   "name": "Alice",
#   "scores": [95, 87, 92]
# }
```

`partial` is preferable to `lambda` when you are simply fixing arguments — it is more explicit about intent and preserves the original function reference (`partial.func`).

### `functools.lru_cache` and `functools.cache`

These are decorator-based memoization tools covered in depth in the [Decorators page](./03-decorators.md). Key API details:

```python
# run: python3 cache_details.py
import functools

@functools.lru_cache(maxsize=256, typed=False)
def expensive(n: int) -> int:
    """Simulate expensive computation."""
    print(f"  Computing for n={n}")
    return n * n

# First calls compute:
print(expensive(5))        # Computing for n=5 → 25
print(expensive(10))       # Computing for n=10 → 100

# Cached calls skip computation:
print(expensive(5))        # 25 (no "Computing" print)

# Inspect cache state
info = expensive.cache_info()
print(f"Hits: {info.hits}, Misses: {info.misses}, Size: {info.currsize}, Max: {info.maxsize}")

# typed=True: treats 5 and 5.0 as different keys
# (default typed=False treats them as the same)

# Clear cache
expensive.cache_clear()
print(expensive.cache_info())  # all zeros

# functools.cache (3.9+) — unbounded, no maxsize
@functools.cache
def factorial(n: int) -> int:
    return 1 if n <= 1 else n * factorial(n - 1)

print(factorial(10))  # 3628800
```

**Important:** all arguments must be **hashable** since the cache uses a dictionary internally. Passing a list as an argument raises `TypeError`.

### The `operator` Module — Avoiding Trivial Lambdas

The `operator` module provides function equivalents of Python's operators and common accessors:

```python
# run: python3 operator_demo.py
import operator

# Instead of lambda x, y: x + y
print(operator.add(3, 4))      # 7

# itemgetter — replaces lambda x: x[key]
from operator import itemgetter, attrgetter, methodcaller

students = [
    {"name": "Alice", "grade": 92},
    {"name": "Bob", "grade": 87},
    {"name": "Charlie", "grade": 95},
]

# Sort by grade
by_grade = sorted(students, key=itemgetter("grade"))
print([s["name"] for s in by_grade])  # ['Bob', 'Alice', 'Charlie']

# Multi-key sort
records = [("math", 92), ("english", 87), ("math", 85), ("english", 95)]
by_subject_then_score = sorted(records, key=itemgetter(0, 1))
print(by_subject_then_score)
# [('english', 87), ('english', 95), ('math', 85), ('math', 92)]

# attrgetter — replaces lambda x: x.attr
class Student:
    def __init__(self, name: str, gpa: float) -> None:
        self.name = name
        self.gpa = gpa
    def __repr__(self) -> str:
        return f"Student({self.name!r}, {self.gpa})"

students_obj = [Student("Alice", 3.9), Student("Bob", 3.7), Student("Charlie", 4.0)]
print(sorted(students_obj, key=attrgetter("gpa")))
# [Student('Bob', 3.7), Student('Alice', 3.9), Student('Charlie', 4.0)]

# Nested attribute access: attrgetter("address.city") ≡ lambda x: x.address.city

# methodcaller — replaces lambda x: x.method(args)
names = ["alice", "BOB", "Charlie"]
print(list(map(methodcaller("upper"), names)))  # ['ALICE', 'BOB', 'CHARLIE']
print(list(map(methodcaller("center", 20, "-"), names)))
# ['-------alice--------', '---------BOB--------', '------Charlie-------']
```

**Why prefer `operator` over `lambda`?**
1. **Readability:** `itemgetter("grade")` communicates intent more clearly than `lambda x: x["grade"]`.
2. **Performance:** `operator` functions are implemented in C and avoid the overhead of a Python function call frame.
3. **Picklability:** `operator` functions can be pickled for multiprocessing; lambdas cannot (by default).

### When Functional Style Helps vs Hurts

Python is not Haskell. The language has list comprehensions, generator expressions, and explicit loops — all of which are considered more Pythonic than chaining `map`/`filter`/`reduce`.

```python
# run: python3 functional_vs_pythonic.py
# GOOD: comprehension is clearer
names = ["Alice", "Bob", "Charlie", "Diana"]
upper_long = [name.upper() for name in names if len(name) > 3]
print(upper_long)  # ['ALICE', 'CHARLIE', 'DIANA']

# LESS CLEAR: chained map + filter
upper_long_fp = list(map(str.upper, filter(lambda n: len(n) > 3, names)))
print(upper_long_fp)  # same result, harder to read

# GOOD use of functional tools:
# 1. sorted() with key= (very common, very readable)
print(sorted(names, key=len))  # ['Bob', 'Alice', 'Diana', 'Charlie']

# 2. partial for configuration (clearer than lambda)
from functools import partial
import json
serialize = partial(json.dumps, indent=2, default=str)

# 3. reduce for well-known folds
from functools import reduce
import operator
product = reduce(operator.mul, range(1, 6), 1)  # 5! = 120
print(product)

# AVOID: deeply nested map/filter/reduce chains
# AVOID: lambda with complex logic — use a named function
# AVOID: reduce when a loop would be clearer
```

**Rules of thumb:**
- **Comprehensions** over `map`/`filter` when the transformation is simple.
- **`sorted(key=...)`** is universally accepted — use `itemgetter`/`attrgetter` or simple lambdas.
- **`partial`** over `lambda` when you are only fixing arguments.
- **`reduce`** only for well-known algebraic operations (sum, product, flatten). For anything else, write a loop.
- **Named functions** over multi-line lambdas. Python's `lambda` is intentionally limited to one expression — if you need more, use `def`.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Lazy Iterators Exhausted Silently**
Symptom: code works the first time through a `map()` or `filter()` result but produces nothing on the second pass. `map` and `filter` return one-shot iterators — once consumed, they are empty. If you assign the result to a variable and iterate twice, the second iteration yields nothing with no error.
Diagnosis: if you need to iterate multiple times, convert to a list first (`list(map(...))`). Or use a generator function that can be re-invoked.

**2. `lru_cache` with Unhashable Arguments**
Symptom: `TypeError: unhashable type: 'list'` on a function that "used to work." Someone added a list parameter to a cached function. Since the cache uses a dict internally, all arguments must be hashable. This also means `lru_cache` silently creates subtle bugs with mutable default arguments — if a dict is passed, it works initially but breaks when someone passes a different type.
Diagnosis: ensure all cached function parameters are hashable. Convert lists to tuples before passing to cached functions.

**3. Lambda Closure Over Loop Variable**
Symptom: a list of callbacks built with `lambda` in a loop all produce the same result. This is the same late-binding gotcha from [LEGB Scoping & Closures](./02-scoping-closures.md), but it appears most often with `lambda` because lambdas are commonly created inline in loops. The fix is the default argument snapshot: `lambda x=x: ...`.
Diagnosis: check `callback.__closure__` — if all callbacks share the same cell, late binding is the culprit.
:::

## 🎯 Checkpoint

::: details Question 1 — `map` vs comprehension
**Q:** When would you choose `map()` over a list comprehension, and vice versa? Are there performance differences?

**A:** Use a list comprehension when: (1) you need filtering (`if` clause), (2) the transformation is an expression rather than a single function call, or (3) readability matters more than micro-optimization. Use `map()` when: (1) you already have a named function (`map(str.upper, names)` is cleaner than `[s.upper() for s in names]`), (2) you want lazy evaluation without wrapping in a generator expression, or (3) you need to map over multiple iterables in parallel (`map(func, a, b)`).

Performance: `map` with a C-implemented function (like `str.upper`) can be faster because it avoids creating a Python frame for each call. A list comprehension with an inline expression avoids the function-call overhead entirely. In practice the differences are negligible — readability should drive the choice.
:::

::: details Question 2 — Why was `reduce` demoted?
**Q:** `reduce` was a builtin in Python 2 but moved to `functools` in Python 3. Why?

**A:** Guido van Rossum argued that `reduce` is hard to read for non-trivial operations. Most `reduce` use cases are better served by explicit loops, `sum()`, `math.prod()`, `str.join()`, or `itertools.accumulate()`. The remaining legitimate uses (well-known folds like product or flatten) are rare enough to justify an explicit import. Moving it to `functools` signals "this is a power tool, not everyday usage." Python's philosophy favors readability over conciseness, and explicit loops make the step-by-step logic visible in a way that `reduce(lambda a, b: ..., seq)` does not.
:::

::: details Question 3 — `partial` vs `lambda`
**Q:** What are the concrete advantages of `functools.partial` over a `lambda` that achieves the same thing?

**A:** (1) **Introspection:** `partial` objects expose `.func`, `.args`, and `.keywords`, making debugging easier. A lambda only shows `<lambda>`. (2) **Picklability:** `partial` objects can be pickled (important for `multiprocessing`); lambdas cannot by default. (3) **Readability:** `partial(json.dumps, indent=2)` immediately communicates "json.dumps with indent=2 pre-filled," while `lambda data: json.dumps(data, indent=2)` requires reading the entire expression. (4) **Performance:** `partial` is implemented in C and has slightly less overhead than a Python-level lambda wrapper. The lambda is better only when you need to transform arguments, not just fix them — e.g., `lambda x: func(x * 2)` cannot be expressed with `partial`.
:::

## Key Mental Models

- **`map` and `filter` are lazy** — they return iterators that compute on demand and exhaust after one pass. Convert to `list` if you need reuse.
- **Comprehensions are usually more Pythonic** — use `map`/`filter` only when a named function makes the intent clearer than an inline expression.
- **`reduce` is for well-known folds** — sum, product, flatten. For anything else, write an explicit loop.
- **`partial` fixes arguments, `lambda` transforms them** — if you are only pre-filling parameters, `partial` is clearer and more capable.
- **`operator` functions replace trivial lambdas** — `itemgetter`, `attrgetter`, and `methodcaller` are faster, picklable, and self-documenting.

## Related

- [Functions as First-Class Objects](./01-functions-first-class.md) — understanding that functions are objects is prerequisite to passing them to `map`, `filter`, etc.
- [LEGB Scoping & Closures](./02-scoping-closures.md) — lambda closures over loop variables share the same late-binding gotcha.
- [Decorators](./03-decorators.md) — `lru_cache` and `cache` are decorator-based memoization tools.
