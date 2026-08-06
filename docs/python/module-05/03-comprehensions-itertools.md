---
title: Comprehensions & itertools
outline: deep
---

# Comprehensions & itertools

**Interview weight:** 🔥🔥 — Comprehensions are basic literacy; interviewers care more about *when not* to use them. `itertools` questions test whether you know the standard library beyond the basics.

**Python version notes:** Comprehension scoping inlined via PEP 709 in 3.12. `itertools.pairwise` added in 3.10. `itertools.batched` added in 3.12.

**Prerequisites:** [The Iterator Protocol](./01-iterator-protocol.md) (understanding what iterators are), [Generators — Lazy Evaluation](./02-generators.md) (generator expressions, lazy vs eager).

## 🗣️ In Plain English

::: tip In Plain English
A list comprehension is like a **factory conveyor belt with a blueprint**. Raw materials (items from a collection) roll in one end. The blueprint says what to build from each item — maybe double it, maybe extract one part, maybe reshape it entirely. There's also an optional quality inspector standing at the belt who rejects any item that doesn't pass a condition. What comes out the other end is a neat box of finished products.

The beauty is that one line describes the whole factory: "take these raw materials, build this from each one, but only if they pass inspection." Compare that to writing out the factory step by step: set up an empty box, grab each raw material, check if it passes, build the product, put it in the box. The conveyor belt version is shorter and, once you're used to reading blueprints, clearer.

But factories can get out of hand. If you chain two conveyor belts, add three inspectors, and nest a smaller factory inside a bigger one, nobody walking into the plant can figure out what's being built. That's the readability limit of comprehensions — if your blueprint needs more than two conveyor belts (two `for` clauses), tear it down and write a regular loop. Clarity beats cleverness.

Now, what if you need specialized conveyor belt components — a splitter that feeds items to two belts, a merger that interleaves items from three sources, a counter that keeps a running total, or a grouper that bundles items by category? You *could* build each from scratch, but Python ships a warehouse full of pre-built components called **itertools**. They snap together like LEGO pieces: chain this, slice that, group by this field, take combinations of these. And because they're all lazy (producing items one at a time, not all at once), you can connect ten components in a pipeline and still use barely any memory.
:::

## ⚙️ Under the Hood

### List, Dict, and Set Comprehensions

```python
# run: python3 comprehension_types.py

# List comprehension: [expression for item in iterable if condition]
squares = [x**2 for x in range(10) if x % 2 == 0]
print(squares)  # [0, 4, 16, 36, 64]

# Dict comprehension: {key_expr: value_expr for item in iterable if condition}
word_lengths = {w: len(w) for w in ["hello", "world", "python"]}
print(word_lengths)  # {'hello': 5, 'world': 5, 'python': 6}

# Set comprehension: {expression for item in iterable if condition}
unique_remainders = {x % 3 for x in range(20)}
print(unique_remainders)  # {0, 1, 2}
```

### Nested Loops in Comprehensions

The order of `for` clauses matches the order of nested `for` loops written the traditional way — **outer loop first, inner loop second**:

```python
# run: python3 nested_comp.py

# Traditional nested loop
result = []
for row in range(3):
    for col in range(3):
        result.append((row, col))

# Equivalent comprehension — outer for first
comp = [(row, col) for row in range(3) for col in range(3)]
assert result == comp
print(comp)
# [(0, 0), (0, 1), (0, 2), (1, 0), (1, 1), (1, 2), (2, 0), (2, 1), (2, 2)]

# Nested comprehension (list of lists) — different thing
matrix = [[col * row for col in range(4)] for row in range(3)]
print(matrix)  # [[0, 0, 0, 0], [0, 1, 2, 3], [0, 2, 4, 6]]

# Flattening with a comprehension
flat = [x for row in matrix for x in row]
print(flat)  # [0, 0, 0, 0, 0, 1, 2, 3, 0, 2, 4, 6]
```

### The Two-Loop Rule

When a comprehension has more than two `for` clauses, readability collapses. Use a regular loop or break it into helper functions:

```python
# run: python3 two_loop_rule.py

# Acceptable: 2 for-clauses
pairs = [(x, y) for x in range(5) for y in range(5) if x != y]

# Unreadable: 3 for-clauses with conditions
# BAD:
triples = [(x, y, z) for x in range(10) for y in range(x, 10)
           for z in range(y, 10) if x**2 + y**2 == z**2]

# BETTER: use a function
def pythagorean_triples(limit: int) -> list[tuple[int, int, int]]:
    results = []
    for x in range(1, limit):
        for y in range(x, limit):
            for z in range(y, limit):
                if x**2 + y**2 == z**2:
                    results.append((x, y, z))
    return results

print(pythagorean_triples(20))
# [(3, 4, 5), (5, 12, 13), (6, 8, 10), (8, 15, 17), (9, 12, 15)]
```

### Comprehension Scoping

**Python 3 rule:** The iteration variable in a comprehension does **not** leak into the enclosing scope (unlike Python 2):

```python
# run: python3 comp_scoping.py
x = "before"
result = [x for x in range(5)]
print(x)  # "before" — x is NOT overwritten (Python 3)
```

**CPython 3.11 and earlier:** Comprehensions were implemented as an implicit nested function (a code object with its own local scope). This had overhead: creating a function object, calling it, and tearing it down.

**CPython 3.12+ (PEP 709):** Comprehensions are inlined into the enclosing function's bytecode. The scoping behavior is identical (iteration variables don't leak), but the implementation is faster — roughly 10-20% for simple comprehensions — because there's no function call overhead.

```python
# run: python3 comp_bytecode.py
import dis
import sys

print(f"Python {sys.version}")

def demo():
    return [x * 2 for x in range(10)]

dis.dis(demo)
# On 3.12+: no MAKE_FUNCTION/CALL — the comprehension is inlined
# On 3.11-: you'll see MAKE_FUNCTION + CALL for the implicit function
```

### Generator Expressions vs List Comprehensions

| Feature | List comprehension `[...]` | Generator expression `(...)` |
|---------|---------------------------|------------------------------|
| Returns | `list` | `generator` object |
| Memory | O(n) — all items stored | O(1) — one item at a time |
| Passes | Re-iterable (it's a list) | Single-pass (it's an iterator) |
| Speed (small n) | Faster (no suspension overhead) | Slightly slower |
| Speed (large n) | Slower if you don't need all items | Faster if you short-circuit |
| Indexable | Yes (`result[3]`) | No |

```python
# run: python3 genexpr_vs_listcomp.py
import sys

# When you need ALL results: list comprehension
all_squares = [x**2 for x in range(1000)]
print(f"List: {sys.getsizeof(all_squares):,} bytes")

# When you need to iterate once or aggregate: generator expression
total = sum(x**2 for x in range(1_000_000))
print(f"Sum of 1M squares: {total}")
# The generator never stores more than one int — sum() consumes on-the-fly

# When you need to check existence: generator + any/all (short-circuits)
has_large = any(x > 999_998 for x in range(1_000_000))
print(f"Has large value: {has_large}")  # True, stops early at 999_999
```

### `itertools` Essentials

All `itertools` functions return **lazy iterators**. Import:

```python
import itertools
```

#### `chain` and `chain.from_iterable` — Flattening

```python
# run: python3 it_chain.py
from itertools import chain

# chain: concatenate multiple iterables
combined = list(chain([1, 2], [3, 4], [5]))
print(combined)  # [1, 2, 3, 4, 5]

# chain.from_iterable: flatten one level of nesting
nested = [[1, 2], [3, 4], [5, 6]]
flat = list(chain.from_iterable(nested))
print(flat)  # [1, 2, 3, 4, 5, 6]
```

#### `islice` — Lazy Slicing

```python
# run: python3 it_islice.py
from itertools import islice

def infinite_counter():
    n = 0
    while True:
        yield n
        n += 1

# Take elements 5-9 from an infinite iterator — no memory explosion
portion = list(islice(infinite_counter(), 5, 10))
print(portion)  # [5, 6, 7, 8, 9]

# First 5 elements
first_five = list(islice(infinite_counter(), 5))
print(first_five)  # [0, 1, 2, 3, 4]
```

#### `groupby` — Grouping (Requires Pre-Sorted Input!)

```python
# run: python3 it_groupby.py
from itertools import groupby

# IMPORTANT: groupby groups CONSECUTIVE items with the same key.
# Input MUST be sorted by the key for global grouping.
data = [
    ("Engineering", "Alice"),
    ("Engineering", "Bob"),
    ("Marketing", "Charlie"),
    ("Marketing", "Diana"),
    ("Engineering", "Eve"),  # ← not grouped with first Engineering block!
]

# Without sorting: Engineering appears twice
print("Without sorting:")
for dept, members in groupby(data, key=lambda x: x[0]):
    print(f"  {dept}: {[m[1] for m in members]}")

# With sorting: correct grouping
print("\nWith sorting:")
sorted_data = sorted(data, key=lambda x: x[0])
for dept, members in groupby(sorted_data, key=lambda x: x[0]):
    print(f"  {dept}: {[m[1] for m in members]}")
```

#### `product`, `permutations`, `combinations` — Combinatorics

```python
# run: python3 it_combinatorics.py
from itertools import product, permutations, combinations, combinations_with_replacement

# Cartesian product
print(list(product("AB", "12")))
# [('A', '1'), ('A', '2'), ('B', '1'), ('B', '2')]

# Permutations (order matters)
print(list(permutations("ABC", 2)))
# [('A', 'B'), ('A', 'C'), ('B', 'A'), ('B', 'C'), ('C', 'A'), ('C', 'B')]

# Combinations (order doesn't matter)
print(list(combinations("ABC", 2)))
# [('A', 'B'), ('A', 'C'), ('B', 'C')]

# Combinations with replacement
print(list(combinations_with_replacement("AB", 2)))
# [('A', 'A'), ('A', 'B'), ('B', 'B')]
```

#### `zip_longest`, `pairwise`, `batched`

```python
# run: python3 it_zipping.py
from itertools import zip_longest, pairwise, batched

# zip_longest: like zip but pads shorter iterables
names = ["Alice", "Bob", "Charlie"]
scores = [90, 85]
print(list(zip_longest(names, scores, fillvalue=0)))
# [('Alice', 90), ('Bob', 85), ('Charlie', 0)]

# pairwise (3.10+): sliding window of 2
print(list(pairwise([1, 2, 3, 4, 5])))
# [(1, 2), (2, 3), (3, 4), (4, 5)]

# batched (3.12+): group into fixed-size chunks
print(list(batched("ABCDEFG", 3)))
# [('A', 'B', 'C'), ('D', 'E', 'F'), ('G',)]
```

#### `accumulate` — Running Totals

```python
# run: python3 it_accumulate.py
from itertools import accumulate
import operator

# Default: running sum
print(list(accumulate([1, 2, 3, 4, 5])))
# [1, 3, 6, 10, 15]

# Running product
print(list(accumulate([1, 2, 3, 4, 5], operator.mul)))
# [1, 2, 6, 24, 120]

# Running maximum
print(list(accumulate([3, 1, 4, 1, 5, 9, 2, 6], max)))
# [3, 3, 4, 4, 5, 9, 9, 9]
```

#### `tee` — Cloning Iterators (And Its Memory Cost)

```python
# run: python3 it_tee.py
from itertools import tee
import sys

data = iter(range(1_000_000))

# Create two independent iterators from one
a, b = tee(data, 2)

# Both can iterate independently
print(next(a), next(a), next(a))  # 0 1 2
print(next(b))                     # 0 — b has its own position

# WARNING: if one consumer races ahead while the other is slow,
# tee buffers all the values between them. In the worst case
# (one consumer finishes, the other hasn't started), tee stores
# the entire sequence — worse than materializing to a list because
# it adds overhead.
# Rule: only use tee when consumers advance at similar rates.
```

### Building Data Pipelines

The real power of itertools emerges when you chain generators and itertools functions into a pipeline — each stage is lazy, and only one item flows through the pipeline at a time:

```python
# run: python3 data_pipeline.py
from itertools import chain, islice, groupby
from collections import Counter

# Sample log data (imagine this is a 10GB file)
log_lines = [
    "2024-01-15 03:22:01 ERROR db connection timeout",
    "2024-01-15 03:22:05 INFO request completed",
    "2024-01-15 04:10:30 ERROR disk full",
    "2024-01-15 04:11:00 WARN memory high",
    "2024-01-15 04:15:22 ERROR db connection timeout",
    "2024-01-15 05:00:00 INFO startup complete",
    "2024-01-15 05:00:01 ERROR auth service down",
]

# Stage 1: Parse each line (lazy)
def parse_logs(lines):
    for line in lines:
        parts = line.split(" ", 3)
        yield {
            "date": parts[0],
            "time": parts[1],
            "level": parts[2],
            "message": parts[3],
        }

# Stage 2: Filter errors only (lazy)
def errors_only(records):
    for r in records:
        if r["level"] == "ERROR":
            yield r

# Stage 3: Extract hour (lazy)
def extract_hour(records):
    for r in records:
        yield r["time"][:2]

# Compose the pipeline — nothing executes until we consume
pipeline = extract_hour(errors_only(parse_logs(log_lines)))

# Only now does data flow through all stages
error_hours = Counter(pipeline)
print(error_hours)  # Counter({'04': 2, '03': 1, '05': 1})
```

### `itertools` Recipes from the Documentation

The `itertools` docs include a "Recipes" section with common patterns built from the primitives. Key ones:

```python
# run: python3 itertools_recipes.py
from itertools import chain, filterfalse, tee
from typing import TypeVar, Callable
from collections.abc import Iterable, Iterator

T = TypeVar("T")

# --- flatten: one level of nesting ---
def flatten(list_of_lists: Iterable[Iterable[T]]) -> Iterator[T]:
    """Flatten one level of nesting."""
    return chain.from_iterable(list_of_lists)

print(list(flatten([[1, 2], [3], [4, 5, 6]])))  # [1, 2, 3, 4, 5, 6]


# --- partition: split iterable by predicate ---
def partition(predicate: Callable[[T], bool],
              iterable: Iterable[T]) -> tuple[Iterator[T], Iterator[T]]:
    """Split into (false_items, true_items)."""
    t1, t2 = tee(iterable)
    return filterfalse(predicate, t1), filter(predicate, t2)

evens, odds = partition(lambda x: x % 2, range(10))
print("Evens:", list(evens))  # [0, 2, 4, 6, 8]
print("Odds:", list(odds))    # [1, 3, 5, 7, 9]


# --- unique_everseen: deduplicate preserving order ---
def unique_everseen(iterable: Iterable[T]) -> Iterator[T]:
    """Yield unique elements, preserving first-seen order."""
    seen: set = set()
    for element in iterable:
        if element not in seen:
            seen.add(element)
            yield element

print(list(unique_everseen([1, 3, 2, 3, 1, 4, 2])))  # [1, 3, 2, 4]
```

### `functools.reduce` + `itertools` Patterns

While `accumulate` gives running results, `functools.reduce` gives a single final result. They pair well:

```python
# run: python3 reduce_itertools.py
from functools import reduce
from itertools import chain
import operator

# Flatten and sum in one pass
nested = [[1, 2], [3, 4], [5, 6]]
total = reduce(operator.add, chain.from_iterable(nested))
print(total)  # 21

# Find longest string
words = ["cat", "elephant", "dog", "hippopotamus"]
longest = reduce(lambda a, b: a if len(a) >= len(b) else b, words)
print(longest)  # hippopotamus
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. `groupby` on unsorted data silently produces wrong groups.**
`itertools.groupby` groups *consecutive* elements with the same key. If data arrives in arbitrary order (e.g., from a database query without `ORDER BY`), each key may appear in multiple non-adjacent groups, and you get fragmented results. This rarely causes an error — just silently wrong aggregations. **Fix:** Always sort by the group key before calling `groupby`, or use `collections.defaultdict(list)` for grouping unsorted data.

**2. `tee` as a memory bomb.**
A developer uses `tee(big_iterator, 3)` to feed data to three consumers. Consumer 1 reads everything immediately; consumers 2 and 3 are lazy. `tee` buffers the entire dataset internally, tripling memory usage versus a single pass. In a data pipeline processing gigabytes, this OOMs the process. **Fix:** If consumers advance at very different rates, materialize to a list (at least you know the cost) or restructure to use a single pass with multiple aggregations.

**3. Comprehension used where a loop is clearer — code review friction.**
A developer writes a list comprehension with three `for` clauses and two `if` conditions. It's technically correct but takes 60 seconds for every reviewer to parse. In production codebases, this slows reviews and introduces maintenance risk — the next person to modify it will likely introduce a bug. **Fix:** The two-loop rule — if you need more than two `for` clauses, refactor to a regular loop or break into named helper functions. Comprehensions are for *clarity*, not compression.

:::

## 🎯 Checkpoint

::: details Question 1 — Comprehension scoping
**Q:** In Python 3.11, a list comprehension `[x for x in range(5)]` was implemented as an implicit nested function. In Python 3.12 (PEP 709), it changed to inlined bytecode. What user-visible difference does this make? Does the iteration variable `x` leak in either version?

**A:** The iteration variable `x` does **not** leak in either version — scoping behavior is unchanged. The difference is purely a performance optimization:

- In 3.11: Python creates a temporary code object, wraps it in a function, calls it, and discards it. This has overhead from `MAKE_FUNCTION` and `CALL` opcodes.
- In 3.12: The comprehension's bytecode is inlined directly into the enclosing function. No function creation, no call overhead. This yields roughly 10-20% speedup for simple comprehensions.

There are a few edge-case behavioral differences: (1) exceptions from within a 3.11 comprehension show the implicit function in the traceback; 3.12 does not. (2) `sys._getframe()` inside a 3.11 comprehension returns the implicit function's frame; in 3.12 it returns the enclosing function's frame.
:::

::: details Question 2 — `groupby` gotcha
**Q:** You have a list of transactions `[("deposit", 100), ("withdrawal", 50), ("deposit", 200), ("withdrawal", 75)]` and you call `itertools.groupby(transactions, key=lambda t: t[0])`. How many groups do you get, and what are they?

**A:** You get **four** groups, not two. `groupby` groups consecutive elements with the same key:
1. `"deposit"` → `[("deposit", 100)]`
2. `"withdrawal"` → `[("withdrawal", 50)]`
3. `"deposit"` → `[("deposit", 200)]`
4. `"withdrawal"` → `[("withdrawal", 75)]`

Because the data alternates between `"deposit"` and `"withdrawal"`, each run of identical keys is a separate group. To get the expected two groups, sort by key first: `sorted(transactions, key=lambda t: t[0])` groups all deposits together and all withdrawals together, giving `groupby` contiguous blocks to work with.
:::

::: details Question 3 — Generator expression vs list comprehension
**Q:** `sum([x**2 for x in range(10_000_000)])` vs `sum(x**2 for x in range(10_000_000))`. What are the memory and performance characteristics of each?

**A:**
- **List comprehension version:** Allocates a list of 10 million integers (~80 MB on 64-bit CPython), populates it fully, then passes it to `sum()`. Peak memory: ~80 MB. The list is created *before* `sum` starts iterating.
- **Generator expression version:** Creates a generator object (~200 bytes). `sum()` calls `__next__` 10 million times, each producing one integer that is immediately added to the accumulator and discarded. Peak memory: a few KB.
- **Speed:** The list comprehension version is often *slightly faster* in total CPU time (despite the memory allocation) because CPython can use specialized fast paths for iterating over lists. The generator version has per-item suspension/resumption overhead. However, the list version may trigger garbage collection of the 80 MB list, and on memory-constrained systems, the generator version avoids GC pressure entirely.
- **Recommendation:** Use the generator expression. The memory savings far outweigh the marginal CPU difference, and you avoid risking `MemoryError` for large inputs.
:::

## Key Mental Models

- **Comprehensions are for clarity, not compression.** If a comprehension is harder to read than the loop it replaces, use the loop. The two-loop rule: more than two `for` clauses means refactor.
- **Generator expressions are lazy comprehensions.** Replace `[...]` with `(...)` to go from eager (allocate everything) to lazy (one item at a time). Use generators when you consume once; lists when you need indexing or multiple passes.
- **`itertools` is a vocabulary of iteration patterns.** Learning it is like learning standard library functions — you stop reinventing `islice`, `chain`, and `groupby` and start composing them.
- **`groupby` requires sorted input.** This is the single most common `itertools` mistake. It groups *consecutive* equal-key runs, not *all* items with the same key.
- **`tee` is not free cloning.** It buffers the difference between consumers. If one consumer is much faster, you pay the memory cost of storing the gap.

## Related

- [The Iterator Protocol](./01-iterator-protocol.md) — the `__iter__`/`__next__` contract that comprehensions and itertools consume.
- [Generators — Lazy Evaluation](./02-generators.md) — generator expressions are a special case of generators; `yield from` complements `chain`.
- [Functions as First-Class Objects](/python/module-03/01-functions-first-class.md) — `key=` functions, lambdas, and higher-order functions used throughout `itertools`.
- [Functional Tools](/python/module-03/04-functional-tools.md) — `map`, `filter`, `functools.reduce` — the functional counterparts to comprehensions and `accumulate`.
