---
title: Lists & Tuples
outline: deep
---

# Lists & Tuples

**Interview weight:** 🔥🔥🔥 — list/tuple internals appear in nearly every Python technical interview, from "what's the time complexity of `list.insert`" to "why can tuples be dict keys but lists can't."

**Python version notes:** All examples target Python 3.12+. `typing.NamedTuple` was introduced in 3.5; the class-based syntax shown here works from 3.6+.

**Prerequisites:** [Module 1 — Python Foundations](/python/module-01/)

## 🗣️ In Plain English

::: tip In Plain English
Think of a **list** as a stretchy shopping bag. You can toss in apples, bread, milk — whatever you want, in any order. You can reach in and swap the bread for bagels, shove a new item between the apples and milk (though you'll have to push everything else aside to make room), or pull something out from the top in a flash. The bag stretches as you add more — it even stays a little roomier than it needs to be, so the next few items won't require the whole bag to be replaced with a bigger one. That's the over-allocation trick: the bag anticipates your next shopping impulse.

A **tuple**, on the other hand, is like a sealed evidence bag. Once the forensics team bags the items and seals it shut, nobody can add, remove, or rearrange anything inside. You can *look* at what's in there — "item 0 is a fingerprint card, item 1 is a fiber sample" — but the bag itself is tamper-proof. That seal is what makes evidence bags trustworthy: you can label them, file them, and use them as references precisely *because* nobody can swap the contents.

Here's the twist, though: if one of the items inside the evidence bag is itself a *container* — say, a small open box — you can still reach through the clear plastic and rearrange things *inside that box*. The bag is sealed; the box inside it is not. That's exactly how a tuple containing a list works: the tuple won't let you replace the list with something else, but the list inside can still change.

Use a shopping bag (list) when you need to grow, shrink, or reorder your collection. Use an evidence bag (tuple) when the collection itself should never change — function return values, dictionary keys, or coordinates that must stay locked together.
:::

## ⚙️ Under the Hood

### List: a dynamic array

A Python `list` is backed by a contiguous C array of **pointers to PyObject**. The list object itself holds three fields: a pointer to the array, the current number of items (`ob_size`), and the allocated capacity.

When you `append` past the current capacity, CPython allocates a new, larger array and copies the pointers over. The growth formula (from CPython `Objects/listobject.c`) is:

```
new_allocated = (newsize >> 3) + (newsize < 9 ? 3 : 6) + newsize
```

This gives a growth factor of roughly **1.125** (12.5% over-allocation), which is more conservative than Java's `ArrayList` (1.5x) or C++ `std::vector` (typically 2x). The trade-off: slightly more frequent resizes, but less wasted memory.

```python
# run: python3 list_growth.py
"""Observe CPython's list over-allocation in action."""
import sys

sizes: list[int] = []
prev_size = 0
items: list[int] = []

for i in range(80):
    items.append(i)
    current_size = sys.getsizeof(items)
    if current_size != prev_size:
        sizes.append((len(items), current_size))
        prev_size = current_size

print(f"{'Length':>8} {'Size (bytes)':>14}")
print("-" * 24)
for length, size in sizes:
    print(f"{length:>8} {size:>14}")
```

### Time complexity of list operations

| Operation | Average Case | Worst Case | Notes |
|-----------|-------------|------------|-------|
| `append(x)` | O(1) amort. | O(n) | Resize triggers copy |
| `insert(0, x)` | O(n) | O(n) | Shifts all elements right |
| `pop()` | O(1) | O(1) | Removes from end |
| `pop(0)` | O(n) | O(n) | Shifts all elements left |
| `x in list` | O(n) | O(n) | Linear scan |
| `list[i]` | O(1) | O(1) | Direct pointer offset |
| `list.index(x)` | O(n) | O(n) | Linear scan |
| `list.sort()` | O(n log n) | O(n log n) | Timsort — stable |
| `del list[i]` | O(n) | O(n) | Shifts elements left |
| `list.extend(k)` | O(k) | O(n+k) | If resize needed |

Key insight: lists are **fast at the right end** and **slow at the left end**. If you need O(1) operations on both ends, reach for `collections.deque` (covered in [Sets & The Collections Module](./03-sets-collections.md)).

### Shallow vs deep copy

```python
# run: python3 copy_gotcha.py
"""Shallow copy shares nested references — a classic gotcha."""
import copy

original: list[list[int]] = [[1, 2], [3, 4]]

# All three produce SHALLOW copies
slice_copy = original[:]
method_copy = original.copy()
module_copy = copy.copy(original)

# Modify a nested list via the original
original[0].append(999)

# Every shallow copy sees the change — they share the inner lists
print(f"slice_copy:  {slice_copy}")   # [[1, 2, 999], [3, 4]]
print(f"method_copy: {method_copy}")  # [[1, 2, 999], [3, 4]]
print(f"module_copy: {module_copy}")  # [[1, 2, 999], [3, 4]]

# Deep copy is fully independent
deep = copy.deepcopy(original)
original[0].append(888)
print(f"deep_copy:   {deep}")         # [[1, 2, 999], [3, 4]] — no 888
```

**Rule of thumb:** `copy()` and slicing duplicate the *outer* container only. If the container holds mutable objects (lists, dicts, sets), the inner objects are still shared. Use `copy.deepcopy()` when you need full independence — but be aware it is significantly slower and can fail on objects with complex reference cycles.

### Tuple immutability (and its limits)

Tuples are immutable **at the container level**: you cannot reassign, append, or delete slots. But if a slot points to a mutable object, that object can still change.

```python
# run: python3 tuple_mutable_inside.py
"""A tuple containing a list: the tuple is sealed, the list is not."""

evidence: tuple[list[int], str] = ([1, 2], "fiber sample")

# This is fine — mutating the list INSIDE the tuple
evidence[0].append(3)
print(evidence)  # ([1, 2, 3], 'fiber sample')

# This raises TypeError — you can't replace a slot
try:
    evidence[0] = [10, 20]
except TypeError as e:
    print(f"TypeError: {e}")  # 'tuple' object does not support item assignment

# The += trap: augmented assignment on a mutable element inside a tuple
t: tuple = ([1, 2],)
try:
    t[0] += [3, 4]  # Raises TypeError...
except TypeError:
    pass
print(t)  # ([1, 2, 3, 4],)  ...but the list was STILL mutated!
# Why? += on a list calls list.extend() (mutates in place) THEN tries to
# reassign the slot (fails). The mutation happens before the assignment error.
```

### Tuple packing, unpacking, and starred assignments

```python
# run: python3 tuple_unpacking.py
"""Packing, unpacking, and starred assignment patterns."""

# Packing — parentheses are optional
point: tuple[int, int, int] = 10, 20, 30

# Unpacking
x, y, z = point
print(f"x={x}, y={y}, z={z}")  # x=10, y=20, z=30

# Starred assignment (Python 3.0+)
first, *middle, last = range(6)
print(f"first={first}, middle={middle}, last={last}")
# first=0, middle=[1, 2, 3, 4], last=5
# Note: *middle is always a list, even if it captures 0 or 1 elements

# Swap without temp variable (tuple packing/unpacking under the hood)
a, b = 1, 2
a, b = b, a
print(f"a={a}, b={b}")  # a=2, b=1

# Nested unpacking
(a, b), c = [1, 2], 3
print(f"a={a}, b={b}, c={c}")  # a=1, b=2, c=3
```

### namedtuple: two flavors

```python
# run: python3 namedtuple_flavors.py
"""collections.namedtuple vs typing.NamedTuple — both create tuple subclasses."""
from collections import namedtuple
from typing import NamedTuple

# --- Style 1: collections.namedtuple (functional) ---
PointOld = namedtuple("PointOld", ["x", "y"])
p1 = PointOld(3, 4)
print(f"PointOld: {p1}, x={p1.x}")  # PointOld(x=3, y=4), x=3

# --- Style 2: typing.NamedTuple (class-based, preferred in modern code) ---
class Point(NamedTuple):
    x: float
    y: float
    label: str = "origin"  # default values supported

p2 = Point(3.0, 4.0)
print(f"Point: {p2}, label={p2.label}")  # Point(x=3.0, y=4.0, label='origin')

# Both are true tuples — immutable, hashable, iterable, indexable
print(f"Is tuple: {isinstance(p2, tuple)}")  # True
print(f"Hash: {hash(p2)}")
print(f"Index access: {p2[0]}")  # 3.0

# _asdict() returns a regular dict (3.8+: regular dict, not OrderedDict)
print(f"As dict: {p2._asdict()}")  # {'x': 3.0, 'y': 4.0, 'label': 'origin'}

# _replace() returns a NEW namedtuple (remember, tuples are immutable)
p3 = p2._replace(label="custom")
print(f"Replaced: {p3}")  # Point(x=3.0, y=4.0, label='custom')
```

**Prefer `typing.NamedTuple`** in new code: it gives you type annotations, default values, docstrings, and method definitions — all in a natural class syntax.

### Memory: list vs tuple

```python
# run: python3 memory_comparison.py
"""Tuples are leaner than lists for the same data."""
import sys

data = list(range(10))
as_list = list(data)
as_tuple = tuple(data)

print(f"list  of 10 ints: {sys.getsizeof(as_list):>4} bytes")
print(f"tuple of 10 ints: {sys.getsizeof(as_tuple):>4} bytes")

# Why? Lists carry extra capacity (over-allocation) and a resize pointer.
# Tuples have fixed size — no over-allocation, no resize machinery.

# For small tuples (length 0-20), CPython caches and reuses them.
# This is called the "tuple free list" — an internal optimization.
empty1 = ()
empty2 = ()
print(f"\nEmpty tuples are same object: {empty1 is empty2}")  # True

# Single-element tuple syntax (the comma matters!)
not_a_tuple = (42)     # This is just int 42 in parentheses
actual_tuple = (42,)   # The trailing comma makes it a tuple
print(f"type((42)):  {type(not_a_tuple)}")   # <class 'int'>
print(f"type((42,)): {type(actual_tuple)}")  # <class 'tuple'>
```

### When to use which

| Criterion | list | tuple |
|-----------|------|-------|
| Mutable? | Yes | No |
| Hashable? | No | Yes (if all elements are hashable) |
| Can be dict key? | No | Yes |
| Can be set member? | No | Yes |
| Over-allocation overhead? | Yes | No |
| Use for homogeneous sequences? | Yes (e.g., list of users) | Less common |
| Use for heterogeneous records? | Possible but unclear | Yes (e.g., (name, age, score)) |
| Signals intent of immutability? | No | Yes |
| Supports `sort()` in place? | Yes | No (use `sorted()` which returns a list) |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. The O(n) surprise at scale.** A service maintains a list of active session IDs and uses `session_id in sessions` to check membership. At 10 sessions, nobody notices. At 100,000 sessions, every check is a linear scan — latency spikes appear in p99 metrics, and the event loop (in async frameworks) blocks longer than expected. **Fix:** switch to a `set` for O(1) membership checks.

**2. Shallow-copy data corruption.** A request handler copies a "template" config list with `config.copy()` and then modifies nested dicts inside it. Because the inner dicts are shared across all copies, one request's mutation silently corrupts every subsequent request's config. The symptom: intermittent, non-reproducible wrong behavior that depends on request ordering. **Fix:** use `copy.deepcopy()` for nested structures, or use immutable data (tuples, frozen dataclasses) for templates.

**3. The `+=` on tuple element trap.** A developer stores a list inside a tuple (e.g., a cached record) and uses `record[0] += [new_item]`. The code raises `TypeError` — but the list is *still mutated*. This half-success, half-failure confuses error handling: the except block runs, but the data is already changed. **Fix:** never use augmented assignment on mutable elements inside tuples. Call `.append()` or `.extend()` directly.
:::

## 🎯 Checkpoint

::: details Question 1 — Why is list.append() O(1) amortized, not O(1)?
**Q:** Explain why `list.append()` is described as O(1) *amortized* rather than strict O(1). What happens during the non-O(1) calls?

**A:** Most `append` calls simply write a pointer into the next empty slot of the pre-allocated array — true O(1). But when the array is full, CPython must allocate a *new*, larger array (using the growth formula `new = newsize + (newsize >> 3) + (3 if newsize < 9 else 6)`), copy all existing pointers to it, and free the old array. That single resize is O(n) where n is the current length. However, because each resize increases capacity by a multiplicative factor (~12.5%), the expensive copies become exponentially rarer relative to the total number of appends. When you spread the cost of all resizes across all n appends, the average cost per append converges to O(1) — that's the "amortized" guarantee. The worst-case single call is still O(n).
:::

::: details Question 2 — Can a tuple always be used as a dict key?
**Q:** "Tuples are immutable, so they're hashable and can be used as dict keys." Is this statement always true? Give a counterexample.

**A:** The statement is **false in general**. A tuple is only hashable if *all of its elements* are hashable. If a tuple contains a mutable (unhashable) element — such as a list — then `hash()` raises `TypeError`:

```python
t = (1, [2, 3])
hash(t)  # TypeError: unhashable type: 'list'
```

Python's hash contract requires that an object's hash remain constant over its lifetime. Since a list's contents can change, allowing it to be hashed (even when inside a tuple) would break the invariant. So tuples are *conditionally* hashable: `(1, 2, (3, 4))` is hashable; `(1, 2, [3, 4])` is not.
:::

::: details Question 3 — What is the difference between a shallow copy and a deep copy in practice?
**Q:** You have `matrix = [[1, 2], [3, 4]]`. You create `m2 = matrix.copy()` and then do `m2[0][0] = 99`. What is `matrix[0][0]` now, and why?

**A:** `matrix[0][0]` is **99**. `matrix.copy()` creates a shallow copy: a *new* outer list, but the inner lists are the same objects in memory. Both `matrix[0]` and `m2[0]` point to the identical `[1, 2]` list object. Mutating it through either reference changes the same object. To get full independence, use `copy.deepcopy(matrix)`, which recursively copies every nested mutable object, creating entirely separate inner lists.
:::

## Key Mental Models

- **Lists are fast at the tail, slow at the head.** Design your algorithms to `append`/`pop` from the right. If you need both ends, use `deque`.
- **Over-allocation is a space-time trade-off.** CPython wastes a little memory now so it doesn't have to copy the entire array on every append.
- **Tuple immutability is shallow.** The *container* is frozen, but objects *inside* it can still change if they're mutable.
- **Hashability requires immutability all the way down.** A tuple is only hashable if every element (and every nested element) is also hashable.
- **Shallow copy is almost never what you want for nested data.** Default to `copy.deepcopy()` when your structure has more than one level.

## Related

- [Dictionaries — Hash Tables Under the Hood](./02-dicts.md) — the hash table that tuples can be keys of (but lists cannot)
- [Sets & The Collections Module](./03-sets-collections.md) — `deque` as the O(1)-both-ends alternative to lists, `namedtuple` revisited with `Counter`
- [Module 2 Summary](./summary.md) — cross-container time complexity comparison table
