---
title: Dictionaries — Hash Tables Under the Hood
outline: deep
---

# Dictionaries — Hash Tables Under the Hood

**Interview weight:** 🔥🔥🔥 — dict internals are a top-tier Python interview topic. Expect questions on hash collisions, the `__hash__`/`__eq__` contract, and why dicts preserve insertion order.

**Python version notes:** Compact dict layout became an implementation detail in 3.6 (CPython) and a language guarantee in 3.7+. Merge operators `|` and `|=` require Python 3.9+. All examples target Python 3.12+.

**Prerequisites:** [Lists & Tuples](./01-lists-tuples.md) (for understanding hash table key requirements)

## 🗣️ In Plain English

::: tip In Plain English
A dictionary is like a **library card catalog**. Imagine a wall of small drawers, each with a label on the front. You want to find the catalog card for *Moby Dick*. You don't start at drawer #1 and scan every label — that would take forever in a large library. Instead, you run the title through a simple formula: "take the first letter, M, and go to the M section." You jump straight to roughly the right area. That formula is the **hash function**.

Now, what if two books hash to the same drawer? Say *Moby Dick* and *Middlemarch* both land on drawer #47. That's a **collision**. The librarian has a rule for this: "if drawer 47 is taken, check drawer 50, then 56, then a calculated next spot." You probe forward in a specific pattern until you find an empty slot. When someone asks for *Middlemarch* later, the same probing sequence leads them to the right drawer.

Here's what makes the catalog fast: no matter how many thousands of books you have, looking up any single book takes roughly the same amount of effort — you hash the title, jump to a drawer, and maybe check one or two neighbors. Compare that to a plain list of cards where you'd have to scan from the beginning every time.

The catalog also keeps a **sign-in sheet** — a simple log of every book in the order it was added. This is why, since Python 3.7, dictionaries remember the order you inserted keys. The drawers themselves are scattered (that's how hashing works), but the sign-in sheet gives you a neat chronological list when you iterate.

One important rule: the drawer labels must be **permanent**. If you could change a label after filing the card, the formula would point to the wrong drawer and you'd never find it again. That's why dictionary keys must be immutable (hashable) — strings, numbers, tuples of immutables. You can't use a list as a key because its contents might change, invalidating its hash.
:::

## ⚙️ Under the Hood

### Hash table with open addressing

CPython's dict uses a **hash table with open addressing** — all entries live inside a single contiguous array rather than in linked lists (as in chaining-based implementations like Java's `HashMap` pre-Java 8).

When a collision occurs, CPython doesn't simply check the next slot (linear probing). Instead, it uses **perturbation-based probing**:

```
perturb >>= PERTURB_SHIFT  # PERTURB_SHIFT = 5
j = (5 * j + 1 + perturb) % table_size
```

The `perturb` variable starts as the full hash value and is right-shifted by 5 each iteration, gradually degrading to zero. This means the probe sequence initially depends on *all* bits of the hash (not just the lower bits used for the initial index), which distributes collisions more evenly than linear or quadratic probing.

### The compact dict layout (Python 3.6+)

Before Python 3.6, a dict was a single sparse array where each slot held `(hash, key, value)` — but most slots were empty (the table is kept at most 2/3 full). This wasted significant memory.

The **compact dict** splits the storage into two structures:

```
Indices array (sparse):  [None, 2, None, 0, None, 1, None, None]
                          ^               ^         ^
                        slot 0          slot 3    slot 5

Entries array (dense):   [(hash_a, key_a, val_a),   # entry 0
                          (hash_b, key_b, val_b),   # entry 1
                          (hash_c, key_c, val_c)]   # entry 2
```

- The **indices array** is sparse (sized to the hash table) but each element is just a small integer (1 byte for tables up to 128 entries, 2 bytes up to 32768, etc.) — far cheaper than storing full `(hash, key, value)` triples.
- The **entries array** is dense (no gaps) and stores entries in **insertion order**.

This is why iteration preserves insertion order: iterating just walks the dense entries array from start to finish. It also saves 20-25% memory compared to the old layout.

### Hash collision handling step by step

```python
# run: python3 hash_collision.py
"""Demonstrate hash collisions and their effect on dict behavior."""
import sys

# Custom class with deliberately colliding hashes
class BadHash:
    def __init__(self, value: int) -> None:
        self.value = value

    def __hash__(self) -> int:
        return 1  # Every instance hashes to 1 — worst case!

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, BadHash):
            return NotImplemented
        return self.value == other.value

    def __repr__(self) -> str:
        return f"BadHash({self.value})"

# With colliding hashes, every insertion triggers probing
d: dict[BadHash, str] = {}
for i in range(10):
    d[BadHash(i)] = f"val_{i}"

print(f"Length: {len(d)}")  # 10 — all stored, just slowly
print(f"Lookup: {d[BadHash(5)]}")  # val_5 — found via probing

# Measure the cost: dict with good hashes vs all-colliding hashes
import time

good_dict: dict[int, int] = {}
bad_dict: dict[BadHash, int] = {}
n = 5_000

start = time.perf_counter()
for i in range(n):
    good_dict[i] = i
good_time = time.perf_counter() - start

start = time.perf_counter()
for i in range(n):
    bad_dict[BadHash(i)] = i
bad_time = time.perf_counter() - start

print(f"\nGood hashes: {good_time:.4f}s")
print(f"Bad hashes:  {bad_time:.4f}s")
print(f"Slowdown:    {bad_time / good_time:.1f}x")
```

### Why insertion order is preserved (3.7+)

In CPython 3.6, insertion-order preservation was an **implementation detail** of the compact dict. In Python 3.7, it was promoted to a **language specification guarantee** — all conforming Python implementations must preserve it.

The mechanism: new entries are always appended to the *end* of the dense entries array. The sparse indices array maps hash slots to positions in the entries array. Iteration walks the dense array sequentially, yielding insertion order.

Deletion marks the entry as a "dummy" (tombstone) in the indices array but does not compact the entries array immediately. Compaction happens during resize.

### Dict comprehensions and merge operators

```python
# run: python3 dict_operations.py
"""Dict comprehensions, merge operators (3.9+), and unpacking."""

# --- Dict comprehension ---
squares: dict[int, int] = {x: x**2 for x in range(6)}
print(f"Squares: {squares}")
# {0: 0, 1: 1, 2: 4, 3: 9, 4: 16, 5: 25}

# Filtering in comprehension
even_squares: dict[int, int] = {x: x**2 for x in range(10) if x % 2 == 0}
print(f"Even squares: {even_squares}")

# --- Merge operator | (Python 3.9+) ---
# Creates a NEW dict; right side wins on key conflicts
defaults = {"color": "blue", "size": "medium", "verbose": False}
overrides = {"color": "red", "verbose": True}
config = defaults | overrides
print(f"Merged: {config}")
# {'color': 'red', 'size': 'medium', 'verbose': True}

# --- Update operator |= (Python 3.9+) ---
# Mutates in place; equivalent to .update()
settings: dict[str, str | bool] = {"color": "blue", "size": "medium"}
settings |= {"color": "green", "debug": True}
print(f"Updated: {settings}")

# --- Unpacking merge (works in 3.5+) ---
merged_old = {**defaults, **overrides}
print(f"Unpacking merge: {merged_old}")

# --- fromkeys class method ---
keys = ["host", "port", "debug"]
template = dict.fromkeys(keys, None)
print(f"Template: {template}")  # {'host': None, 'port': None, 'debug': None}
# WARNING: if the default is mutable, all keys share the SAME object!
bad_template = dict.fromkeys(keys, [])
bad_template["host"].append("oops")
print(f"Shared reference trap: {bad_template}")
# {'host': ['oops'], 'port': ['oops'], 'debug': ['oops']}
```

### defaultdict and OrderedDict

```python
# run: python3 defaultdict_ordereddict.py
"""defaultdict avoids KeyError; OrderedDict still has unique features."""
from collections import defaultdict, OrderedDict

# --- defaultdict ---
# The factory function is called when accessing a missing key
word_counts: defaultdict[str, int] = defaultdict(int)  # int() returns 0
for word in "the cat sat on the mat the cat".split():
    word_counts[word] += 1
print(f"Counts: {dict(word_counts)}")

# With list factory — group items
groups: defaultdict[str, list[str]] = defaultdict(list)
pairs = [("fruit", "apple"), ("veg", "carrot"), ("fruit", "banana"), ("veg", "pea")]
for category, item in pairs:
    groups[category].append(item)
print(f"Groups: {dict(groups)}")

# --- OrderedDict: still useful? ---
# Since 3.7, regular dict preserves order. But OrderedDict has features dict lacks:

od = OrderedDict([("a", 1), ("b", 2), ("c", 3)])

# 1. move_to_end — reorder without rebuilding
od.move_to_end("a")           # move to end
print(f"After move_to_end('a'): {list(od.keys())}")  # ['b', 'c', 'a']

od.move_to_end("a", last=False)  # move to beginning
print(f"After move_to_end('a', last=False): {list(od.keys())}")  # ['a', 'b', 'c']

# 2. Equality considers order
d1 = OrderedDict([("a", 1), ("b", 2)])
d2 = OrderedDict([("b", 2), ("a", 1)])
print(f"OrderedDict eq (order matters): {d1 == d2}")  # False

# Regular dicts don't consider order in equality
print(f"Regular dict eq (order ignored): {dict(d1) == dict(d2)}")  # True

# 3. popitem(last=False) — pop from either end (LRU cache building block)
od2 = OrderedDict([("x", 10), ("y", 20), ("z", 30)])
oldest = od2.popitem(last=False)
print(f"Popped oldest: {oldest}")  # ('x', 10)
```

### The `__hash__` and `__eq__` contract

```python
# run: python3 hash_eq_contract.py
"""The fundamental contract: if a == b, then hash(a) == hash(b)."""

class User:
    def __init__(self, uid: int, name: str) -> None:
        self.uid = uid
        self.name = name

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, User):
            return NotImplemented
        return self.uid == other.uid  # equality by uid only

    def __hash__(self) -> int:
        # MUST be consistent with __eq__:
        # if two Users are equal (same uid), they MUST have the same hash
        return hash(self.uid)

    def __repr__(self) -> str:
        return f"User({self.uid}, {self.name!r})"

u1 = User(1, "Alice")
u2 = User(1, "Alice V2")  # same uid, different name

print(f"u1 == u2: {u1 == u2}")          # True (same uid)
print(f"hash(u1) == hash(u2): {hash(u1) == hash(u2)}")  # True (required!)

# They collapse to one entry in a dict/set
users = {u1: "admin", u2: "editor"}
print(f"Dict: {users}")  # Only one entry — u2 overwrites u1
print(f"Set:  {set([u1, u2])}")  # Only one element

# VIOLATION: define __eq__ without __hash__
class Broken:
    def __init__(self, val: int) -> None:
        self.val = val
    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Broken):
            return NotImplemented
        return self.val == other.val
    # Python automatically sets __hash__ = None when you define __eq__
    # without __hash__, making the class unhashable

try:
    hash(Broken(1))
except TypeError as e:
    print(f"\nBroken hash: {e}")  # unhashable type: 'Broken'
```

**The contract states:**

1. If `a == b`, then `hash(a) == hash(b)` (mandatory).
2. If `hash(a) == hash(b)`, it does NOT necessarily mean `a == b` (collisions are allowed).
3. If you define `__eq__`, Python sets `__hash__ = None` unless you also define `__hash__`.
4. An object's hash must **never change** while it's in a dict or set.

### Time complexity

| Operation | Average | Worst | Notes |
|-----------|---------|-------|-------|
| `d[key]` (get) | O(1) | O(n) | Worst case: all keys collide |
| `d[key] = val` (set) | O(1) | O(n) | May trigger resize |
| `del d[key]` | O(1) | O(n) | Leaves tombstone |
| `key in d` | O(1) | O(n) | Same as get |
| `len(d)` | O(1) | O(1) | Stored as attribute |
| `iter(d)` | O(n) | O(n) | Walks dense entries array |
| `d.keys()` | O(1) | O(1) | Returns a view object |
| `d.copy()` | O(n) | O(n) | Shallow copy |

The O(n) worst case requires a pathological hash function where all keys collide — essentially never in practice with Python's built-in types, whose hash functions are well-distributed.

### Dict views: live, not snapshots

```python
# run: python3 dict_views.py
"""Dict views (.keys(), .values(), .items()) are live views, not copies."""

inventory: dict[str, int] = {"apples": 5, "bananas": 3, "cherries": 12}

# Get a view
keys_view = inventory.keys()
items_view = inventory.items()

print(f"Keys view: {keys_view}")
print(f"Type: {type(keys_view)}")  # <class 'dict_keys'>

# Modify the dict — the view reflects changes immediately
inventory["dates"] = 7
del inventory["bananas"]
print(f"Keys view after mutation: {keys_view}")  # includes 'dates', no 'bananas'

# Views support set operations (keys and items views, not values)
other: dict[str, int] = {"apples": 5, "elderberries": 2}
print(f"Common keys: {keys_view & other.keys()}")       # {'apples'}
print(f"All keys:    {keys_view | other.keys()}")        # union
print(f"Common items: {items_view & other.items()}")     # {('apples', 5)}

# Caution: you CANNOT mutate a dict while iterating over a view
# This raises RuntimeError:
try:
    for k in inventory:
        if inventory[k] < 10:
            del inventory[k]  # RuntimeError!
except RuntimeError as e:
    print(f"\nRuntimeError: {e}")

# Safe pattern: iterate over a snapshot (list of keys)
inventory = {"apples": 5, "bananas": 3, "cherries": 12}
for k in list(inventory):  # list() creates a snapshot
    if inventory[k] < 10:
        del inventory[k]
print(f"After safe deletion: {inventory}")  # {'cherries': 12}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Mutating dicts during iteration.** A background task iterates over a session dict to expire old entries: `for sid in sessions: if expired(sid): del sessions[sid]`. This raises `RuntimeError: dictionary changed size during iteration`. The fix is trivial — `for sid in list(sessions):` — but the error often surfaces only under load when the timing aligns with actual expirations. In async code with `asyncio`, a context switch between the check and the delete can trigger the same issue even with the `list()` snapshot if another coroutine mutates the dict.

**2. Mutable default arguments as dict values.** A function creates a config with `dict.fromkeys(names, [])`. Every key points to the **same list object**, so appending to one key silently appends to all of them. The symptom: user A's data appears in user B's response. The fix: use a dict comprehension `{name: [] for name in names}` to create independent lists.

**3. Breaking the hash contract.** A developer defines `__eq__` on a model class (for business logic equality) but forgets `__hash__`. Python silently makes the class unhashable. Later, another engineer tries to use instances as cache keys and gets `TypeError: unhashable type`. Worse: if `__hash__` is defined but inconsistent with `__eq__` (e.g., hashing on a mutable field that can change), objects "disappear" from dicts — they're still in the table, but lookups miss them because the hash points to the wrong slot.
:::

## 🎯 Checkpoint

::: details Question 1 — Why does CPython use perturbation-based probing instead of linear probing?
**Q:** Explain why CPython's dict uses perturbation-based probing (`j = (5*j + 1 + perturb) % size; perturb >>= 5`) rather than simpler linear probing (`j = (j+1) % size`).

**A:** Linear probing suffers from **primary clustering**: consecutive occupied slots form long chains, so a collision near an existing cluster extends it, making future collisions in that region even more likely. This degrades average lookup time significantly as load factor increases.

Perturbation-based probing addresses this by incorporating *all* bits of the hash into the probe sequence, not just the lower bits used for the initial index. The `perturb` variable starts as the full hash and is right-shifted by 5 each step. In early iterations, the probe jumps depend on the high-order hash bits (which are essentially random with respect to the table index), scattering collisions across the table. As `perturb` degrades to zero, the sequence falls back to `j = (5*j + 1) % size`, which is guaranteed to visit every slot in a power-of-2 table (since 5 and 2^k are coprime). This gives both good distribution and guaranteed coverage.
:::

::: details Question 2 — What makes the compact dict more memory-efficient?
**Q:** Before Python 3.6, a dict with 8 slots allocated `8 * (hash + key_ptr + value_ptr)` = 8 * 24 = 192 bytes for the table (on 64-bit). Explain how the compact dict layout reduces this.

**A:** The compact dict splits storage into two arrays:

1. **Indices array** (sparse, hash-table-sized): stores only small integers pointing into the entries array. For a table with <= 128 entries, each index is just 1 byte, so 8 slots = 8 bytes. For <= 32768 entries, 2 bytes each, and so on.

2. **Entries array** (dense, no gaps): stores `(hash, key_ptr, value_ptr)` triples, but only for *actual* entries — no empty slots. If you have 5 entries in an 8-slot table, the entries array has 5 * 24 = 120 bytes, not 8 * 24.

Total for 5 entries in an 8-slot table: 8 bytes (indices) + 120 bytes (entries) = 128 bytes, versus 192 bytes in the old layout. The savings grow as the load factor decreases (more empty slots = more savings in the sparse array). As a bonus, iteration walks the dense array contiguously, which is cache-friendly and naturally preserves insertion order.
:::

::: details Question 3 — Are dict views snapshots or live references?
**Q:** Given `d = {"a": 1}; keys = d.keys(); d["b"] = 2`, what does `keys` contain? What are the practical implications?

**A:** `keys` contains `dict_keys(['a', 'b'])`. Dict views (`.keys()`, `.values()`, `.items()`) are **live views**, not snapshots. They reflect the current state of the dict at the moment you access them, with zero copy cost.

Practical implications:
- **Positive:** Creating a view is O(1), not O(n). You can store a keys view and it always reflects the current dict state.
- **Negative:** You **cannot mutate the dict while iterating over a view** — doing so raises `RuntimeError`. To safely delete keys during iteration, take a snapshot first: `for k in list(d):`.
- **Set operations:** `dict_keys` and `dict_items` views support set-like operations (`&`, `|`, `-`, `^`), making it easy to find common keys between dicts. `dict_values` does not support these because values are not necessarily hashable.
:::

## Key Mental Models

- **A dict is a hash table with open addressing and perturbation probing.** Collisions are resolved by jumping to calculated positions using all bits of the hash, not just scanning forward.
- **Compact dict = sparse index + dense entries.** The indices array is tiny (1-8 bytes per slot); the entries array is packed with no gaps, which preserves insertion order and saves memory.
- **The `__hash__`/`__eq__` contract is non-negotiable.** If `a == b`, then `hash(a)` must equal `hash(b)`. Violate this and objects silently vanish from dicts and sets.
- **Dict views are live.** They cost O(1) to create and always reflect the current state — but you must not mutate the dict while iterating over one.
- **O(1) average, O(n) worst case.** The worst case requires pathological hash collisions. In practice, Python's built-in hash functions make this virtually impossible.

## Related

- [Lists & Tuples](./01-lists-tuples.md) — why tuples can be dict keys but lists cannot (hashability)
- [Sets & The Collections Module](./03-sets-collections.md) — sets use the same hash table machinery; `defaultdict` and `Counter` are dict subclasses
- [Module 2 Summary](./summary.md) — time complexity comparison across all containers
