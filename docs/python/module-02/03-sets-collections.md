---
title: Sets & The Collections Module
outline: deep
---

# Sets & The Collections Module

**Interview weight:** 🔥🔥 — sets appear in deduplication and membership-check questions; `Counter` and `deque` are frequent "what standard library tool would you use?" prompts.

**Python version notes:** All examples target Python 3.12+. `collections.Counter` gained operator support in 3.2+; `deque` has been stable since 2.4. Set literal syntax `{1, 2, 3}` works from 2.7+.

**Prerequisites:** [Lists & Tuples](./01-lists-tuples.md), [Dictionaries](./02-dicts.md) (sets share the hash table mechanism)

## 🗣️ In Plain English

::: tip In Plain English
A **set** is like the guest list at an exclusive party. The bouncer has one job: check if a name is on the list. They don't care about the *order* people were added to the list, and they won't write the same name twice no matter how many times you tell them "add Charlie." The magic is that the bouncer has a system — think of it as a filing cabinet with alphabetized tabs — that lets them check any name almost instantly, without reading through the entire list from top to bottom.

Want to know who's on *both* the VIP list and the press list? That's an **intersection**. Who's on the VIP list but *not* the press list? That's a **difference**. These operations are built right in — the bouncer doesn't have to manually compare lists one name at a time.

Now, sometimes you need a guest list that's locked forever — a **frozenset**. It's the same list, same instant lookups, but nobody can add or remove names after it's created. Because it's locked, you can use it as a *label* on other things (like a dictionary key), which you couldn't do with a regular guest list that keeps changing.

Beyond sets, Python's **collections module** is like a utility belt for special-purpose containers. A **Counter** is a tally sheet — it counts how many times each item appears. A **deque** (pronounced "deck") is a double-ended line where people can join or leave from *either* end instantly. A **defaultdict** is a dictionary that automatically creates a default entry when you look up a name that isn't there yet, instead of throwing an error. A **ChainMap** is a stack of dictionaries searched top-to-bottom — perfect for layered configuration where local settings override global defaults.

Each of these tools solves a specific problem more cleanly and efficiently than hand-rolling the solution with basic lists and dicts.
:::

## ⚙️ Under the Hood

### Sets as hash tables without values

A Python `set` is implemented as a hash table that stores only keys — no associated values. The internal mechanism is essentially the same as `dict`: open addressing with perturbation-based probing, a load factor cap of 2/3, and automatic resizing.

```python
# run: python3 set_basics.py
"""Sets: no duplicates, no order guarantees, O(1) membership."""
import sys

# Creating sets
from_literal = {3, 1, 4, 1, 5, 9, 2, 6, 5}  # duplicates removed
from_iter = set(range(10))
empty_set = set()  # NOT {} — that's an empty dict!

print(f"Literal: {from_literal}")  # order may vary (implementation detail)
print(f"type({{}}): {type({})}")   # <class 'dict'>
print(f"type(set()): {type(empty_set)}")  # <class 'set'>

# Membership test: O(1) average
print(f"5 in from_literal: {5 in from_literal}")  # True

# Size comparison: set vs list for membership checks
data = list(range(10_000))
as_list = data
as_set = set(data)

print(f"\nlist size: {sys.getsizeof(as_list):>8} bytes")
print(f"set  size: {sys.getsizeof(as_set):>8} bytes")
# Sets use MORE memory than lists (hash table overhead),
# but membership checks are O(1) vs O(n).
```

### Set operations

```python
# run: python3 set_operations.py
"""Set operations — both operator and method forms."""

backend = {"Python", "Go", "Rust", "Java"}
frontend = {"JavaScript", "TypeScript", "Rust", "Python"}  # overlap!

# --- Union: all unique elements from both ---
print(f"Union (|):        {backend | frontend}")
print(f"Union (.union()): {backend.union(frontend)}")

# --- Intersection: elements in BOTH ---
print(f"Intersection (&):           {backend & frontend}")
print(f"Intersection (.intersection()): {backend.intersection(frontend)}")

# --- Difference: in left but NOT in right ---
print(f"Difference (-):           {backend - frontend}")
print(f"Difference (.difference()): {backend.difference(frontend)}")

# --- Symmetric difference: in one OR the other, but not both ---
print(f"Sym diff (^):                    {backend ^ frontend}")
print(f"Sym diff (.symmetric_difference()): {backend.symmetric_difference(frontend)}")

# --- Subset / superset checks ---
web_langs = {"Python", "JavaScript"}
print(f"\n{web_langs} <= {backend}: {web_langs <= backend}")  # False
print(f"{web_langs} <= {backend | frontend}: {web_langs <= (backend | frontend)}")  # True

# --- In-place variants (mutate the set) ---
skills = {"Python", "SQL"}
skills |= {"Docker", "K8s"}      # union update
skills &= {"Python", "Docker", "K8s", "Go"}  # intersection update
print(f"After in-place ops: {skills}")  # {'Python', 'Docker', 'K8s'}

# --- Disjoint check ---
evens = {2, 4, 6}
odds = {1, 3, 5}
print(f"Disjoint: {evens.isdisjoint(odds)}")  # True
```

**Operator vs method:** The operator forms (`|`, `&`, `-`, `^`) require both operands to be sets. The method forms (`.union()`, `.intersection()`, etc.) accept any iterable as the argument — they'll convert it to a set internally.

### frozenset: hashable, immutable sets

```python
# run: python3 frozenset_demo.py
"""frozenset — an immutable set that can be a dict key or set member."""

# Regular sets are NOT hashable
try:
    d = {frozenset({1, 2}): "pair", frozenset({3}): "single"}
    print(f"frozenset as dict key: {d}")
    print(f"Lookup: {d[frozenset({1, 2})]}")  # 'pair'
except TypeError:
    pass

# Set of sets — only possible with frozenset
set_of_sets: set[frozenset[int]] = {
    frozenset({1, 2}),
    frozenset({3, 4}),
    frozenset({1, 2}),  # duplicate — removed
}
print(f"Set of frozensets: {set_of_sets}")  # 2 elements

# frozenset supports all non-mutating set operations
fs = frozenset({1, 2, 3})
print(f"Union: {fs | frozenset({4, 5})}")       # frozenset({1, 2, 3, 4, 5})
print(f"Intersection: {fs & {2, 3, 4}}")         # frozenset({2, 3})

# Cannot add/remove/discard
try:
    fs.add(4)  # type: ignore[attr-defined]
except AttributeError as e:
    print(f"AttributeError: {e}")
```

### collections.Counter: multisets

```python
# run: python3 counter_demo.py
"""Counter — count things, find most common, do multiset arithmetic."""
from collections import Counter

# Count from iterable
words = "the quick brown fox jumps over the lazy brown dog the".split()
counts: Counter[str] = Counter(words)
print(f"Counts: {counts}")
print(f"Most common 3: {counts.most_common(3)}")
# [('the', 3), ('brown', 2), ('quick', 1)]  — stable tie-breaking by insertion order

# Counter from dict or keyword args
inventory = Counter(apples=5, bananas=3, oranges=7)

# --- Arithmetic operations ---
day1_sales = Counter(apples=2, bananas=1)
day2_sales = Counter(apples=1, oranges=3)
total_sales = day1_sales + day2_sales  # add counts
print(f"Total sales: {total_sales}")  # Counter({'oranges': 3, 'apples': 3, 'bananas': 1})

remaining = inventory - total_sales   # subtract counts (drops zero/negative)
print(f"Remaining: {remaining}")      # Counter({'oranges': 4, 'apples': 2, 'bananas': 2})

# --- Intersection & union of counters (min/max of counts) ---
c1 = Counter(a=3, b=1)
c2 = Counter(a=1, b=5)
print(f"Min of each (c1 & c2): {c1 & c2}")  # Counter({'a': 1, 'b': 1})
print(f"Max of each (c1 | c2): {c1 | c2}")  # Counter({'b': 5, 'a': 3})

# --- total() — sum of all counts (Python 3.10+) ---
print(f"Total items: {counts.total()}")

# --- elements() — iterator repeating each element by its count ---
c = Counter(a=2, b=3)
print(f"Elements: {list(c.elements())}")  # ['a', 'a', 'b', 'b', 'b']

# --- Accessing missing keys returns 0 (not KeyError) ---
print(f"Missing key: {counts['nonexistent']}")  # 0
```

### collections.deque: O(1) both ends

```python
# run: python3 deque_demo.py
"""deque — double-ended queue with O(1) append/pop at both ends."""
from collections import deque

# --- Basic operations ---
dq: deque[str] = deque(["b", "c", "d"])
dq.appendleft("a")   # O(1) — list.insert(0, x) would be O(n)
dq.append("e")        # O(1) — same as list.append
print(f"After appends: {dq}")  # deque(['a', 'b', 'c', 'd', 'e'])

left = dq.popleft()   # O(1) — list.pop(0) would be O(n)
right = dq.pop()      # O(1)
print(f"Popped: left={left}, right={right}")

# --- maxlen: bounded deque (auto-discards from opposite end) ---
recent: deque[int] = deque(maxlen=3)
for i in range(6):
    recent.append(i)
    print(f"  append({i}): {list(recent)}")
# Final: deque([3, 4, 5]) — oldest items silently dropped
# Perfect for "last N items" sliding windows, log buffers, etc.

# --- rotate: shift elements circularly ---
d = deque([1, 2, 3, 4, 5])
d.rotate(2)    # move 2 elements from right end to left end
print(f"rotate(2):  {d}")  # deque([4, 5, 1, 2, 3])
d.rotate(-2)   # move 2 elements from left end to right end
print(f"rotate(-2): {d}")  # deque([1, 2, 3, 4, 5])

# --- Index access: O(n) in the middle! ---
# deque is implemented as a doubly-linked list of fixed-size blocks.
# It excels at ends but random access (d[500]) requires traversal.
import timeit
big_list = list(range(100_000))
big_deque = deque(big_list)
mid = len(big_list) // 2

list_time = timeit.timeit(lambda: big_list[mid], number=100_000)
deque_time = timeit.timeit(lambda: big_deque[mid], number=100_000)
print(f"\nMiddle access — list: {list_time:.4f}s, deque: {deque_time:.4f}s")
print(f"deque is {deque_time/list_time:.1f}x slower for random access")
```

### collections.defaultdict: factory-driven defaults

```python
# run: python3 defaultdict_deep.py
"""defaultdict — automatic default values via factory functions."""
from collections import defaultdict

# --- Basic: grouping pattern ---
records = [
    ("engineering", "Alice"),
    ("marketing", "Bob"),
    ("engineering", "Charlie"),
    ("marketing", "Diana"),
    ("engineering", "Eve"),
]

by_dept: defaultdict[str, list[str]] = defaultdict(list)
for dept, name in records:
    by_dept[dept].append(name)  # no KeyError, no if-check

print(f"By department: {dict(by_dept)}")

# --- Nested defaultdict (tree-like structure) ---
def tree() -> defaultdict:  # type: ignore[type-arg]
    return defaultdict(tree)

taxonomy = tree()
taxonomy["animal"]["mammal"]["dog"] = "Canis familiaris"
taxonomy["animal"]["mammal"]["cat"] = "Felis catus"
taxonomy["animal"]["bird"]["eagle"] = "Aquila chrysaetos"
# No KeyError at any level — intermediate dicts created automatically

import json
print(json.dumps(taxonomy, indent=2))

# --- Counting (int factory returns 0) ---
char_freq: defaultdict[str, int] = defaultdict(int)
for ch in "abracadabra":
    char_freq[ch] += 1
print(f"Frequencies: {dict(char_freq)}")

# --- Caution: accessing a missing key CREATES it ---
dd: defaultdict[str, list[int]] = defaultdict(list)
_ = dd["phantom"]  # This creates the key with an empty list!
print(f"Phantom key exists: {'phantom' in dd}")  # True
print(f"Length: {len(dd)}")  # 1
# Use 'key in dd' BEFORE accessing if you don't want side effects,
# or use dd.get(key) which does NOT trigger the factory.
```

### collections.ChainMap: layered lookups

```python
# run: python3 chainmap_demo.py
"""ChainMap — search multiple dicts in order, first match wins."""
from collections import ChainMap

# Typical use: layered configuration
cli_args = {"debug": True}
env_vars = {"debug": False, "log_level": "INFO", "workers": "4"}
defaults = {"debug": False, "log_level": "WARNING", "workers": "2", "timeout": "30"}

config = ChainMap(cli_args, env_vars, defaults)

# Lookup searches cli_args first, then env_vars, then defaults
print(f"debug:     {config['debug']}")      # True (from cli_args)
print(f"log_level: {config['log_level']}")   # INFO (from env_vars)
print(f"timeout:   {config['timeout']}")     # 30 (from defaults)

# Mutations go to the FIRST dict only
config["new_setting"] = "value"
print(f"cli_args after mutation: {cli_args}")  # {'debug': True, 'new_setting': 'value'}
print(f"defaults unchanged: {defaults}")       # original defaults intact

# new_child() creates a new layer on top
request_overrides = {"debug": False, "request_id": "abc123"}
request_config = config.new_child(request_overrides)
print(f"\nRequest debug: {request_config['debug']}")  # False (from request_overrides)
print(f"Maps count:    {len(request_config.maps)}")    # 4

# Access the underlying maps
print(f"All maps: {request_config.maps}")

# ChainMap is used internally by Python:
# - string.Template uses ChainMap for substitution
# - The scoping in Python itself (locals -> enclosing -> globals -> builtins)
#   is conceptually a ChainMap
```

### Container decision flowchart

```
Need to store items?
│
├── Need key-value pairs?
│   ├── Need default values for missing keys?   → defaultdict
│   ├── Need to count occurrences?               → Counter
│   ├── Need layered/scoped lookup?              → ChainMap
│   ├── Need ordered equality comparison?        → OrderedDict
│   └── Otherwise                                → dict
│
├── Need only unique items?
│   ├── Need it immutable/hashable?              → frozenset
│   └── Otherwise                                → set
│
├── Need ordered sequence?
│   ├── Need O(1) ops at BOTH ends?              → deque
│   ├── Need immutability / hashability?         → tuple
│   ├── Need named fields?                       → NamedTuple
│   └── Need mutable, grow/shrink?               → list
│
└── Need a fixed-size record with names?
    ├── Need immutability?                       → NamedTuple / @dataclass(frozen=True)
    └── Need mutability?                         → @dataclass
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Using a list where a set belongs.** A service checks `if user_id in blocked_users` where `blocked_users` is a list loaded from the database. At 50,000 entries, every check takes a linear scan — p99 latency spikes proportionally with the block list size. The fix is a one-line change: `blocked_users = set(blocked_users)`. Always ask: "am I checking membership? If yes, use a set."

**2. defaultdict's silent key creation.** A function checks `if key in config` and then later does `val = config[key]`. Between the two, another code path accidentally accesses `config[missing_key]`, which silently creates it with the default factory. Now `len(config)` grows unboundedly in a long-running process, and `if key in config` returns True for phantom keys. **Fix:** use `config.get(key)` for lookups that shouldn't create entries, or use a regular dict with explicit `.setdefault()` only where creation is intended.

**3. deque random access in hot loops.** A developer replaces a list with a deque for O(1) `appendleft()`, but the same data structure is also indexed by position (`dq[i]`) inside a tight loop. deque's random access is O(n) because it's backed by a linked list of blocks — the indexing loop becomes O(n^2). **Fix:** if you need both fast ends *and* fast random access, maintain two data structures (a deque for the queue operations, a dict or list for indexed lookups), or reconsider the algorithm.
:::

## 🎯 Checkpoint

::: details Question 1 — Why can't you use a set as a dict key, but you can use a frozenset?
**Q:** Explain the mechanism that prevents sets from being dict keys and how frozenset solves this.

**A:** Dict keys must be **hashable** — they must implement `__hash__()` and the hash must remain constant over the object's lifetime. A regular `set` is mutable: you can `.add()` or `.discard()` elements, which would change what the set "equals." If the hash were computed at creation and then the set's contents changed, the hash would become stale — lookups would probe the wrong slot and the set would "vanish" from the dict. Python prevents this by making `set.__hash__` undefined (calling `hash()` on a set raises `TypeError`).

A `frozenset` is immutable — its contents are fixed at creation and can never change. Therefore its hash is stable and computable. Python computes the frozenset's hash using a commutative, order-independent formula (XOR-based with bit mixing) so that `frozenset({1, 2})` and `frozenset({2, 1})` produce the same hash, consistent with their equality.
:::

::: details Question 2 — When would you still use OrderedDict over a regular dict in Python 3.7+?
**Q:** Since Python 3.7 guarantees dict insertion order, is `OrderedDict` obsolete? Name specific features it still provides.

**A:** `OrderedDict` is not obsolete. It provides at least three capabilities that regular dicts lack:

1. **`move_to_end(key, last=True/False)`** — repositions an existing key to either end in O(1). This is the building block for LRU caches: on access, move the key to the end; when evicting, `popitem(last=False)` removes the least recently used.

2. **Order-sensitive equality.** `OrderedDict(a=1, b=2) != OrderedDict(b=2, a=1)`, whereas `{"a": 1, "b": 2} == {"b": 2, "a": 1}`. This matters when order is semantically significant (e.g., comparing serialized output).

3. **`popitem(last=False)`** — pop from either end. Regular `dict.popitem()` only pops the *last* item (LIFO); `OrderedDict` supports FIFO via `last=False`.

For simple "remember insertion order" needs, regular dict is sufficient and slightly faster/smaller.
:::

::: details Question 3 — What happens when you subtract two Counters?
**Q:** Given `c1 = Counter(a=3, b=1)` and `c2 = Counter(a=1, b=5)`, what is `c1 - c2`? What about negative counts?

**A:** `c1 - c2` produces `Counter({'a': 2})`. Counter subtraction **drops zero and negative counts** from the result. `b` had count `1 - 5 = -4`, which is dropped entirely; `a` had `3 - 1 = 2`, which is kept.

If you need to preserve negative counts, use `c1.subtract(c2)`, which mutates `c1` in place and retains all values:

```python
c1 = Counter(a=3, b=1)
c1.subtract(Counter(a=1, b=5))
# c1 is now Counter({'a': 2, 'b': -4}) — negative preserved
```

This distinction matters when you're tracking "debt" or "deficits" (e.g., inventory shortfalls). The operator form (`-`) is designed for multiset semantics where negative counts are meaningless; the method form (`.subtract()`) is for general arithmetic.
:::

## Key Mental Models

- **Sets are dicts without values.** Same hash table, same O(1) average lookup, same requirement for hashable elements.
- **Use `frozenset` when you need a hashable, immutable set.** It's the tuple equivalent for sets — frozen means it can be a dict key or set member.
- **Counter is a multiset, not just a counting dict.** It supports arithmetic (`+`, `-`, `&`, `|`) that operates on counts, making frequency analysis concise.
- **deque is O(1) at both ends, O(n) in the middle.** If you also need random access, deque is the wrong choice — use a list and accept the O(n) at the left end, or use two data structures.
- **defaultdict creates keys on access, not just on assignment.** Even reading `dd[key]` triggers the factory. Use `.get()` for non-creating lookups.

## Related

- [Lists & Tuples](./01-lists-tuples.md) — `deque` as the O(1)-both-ends alternative to lists
- [Dictionaries — Hash Tables Under the Hood](./02-dicts.md) — the hash table mechanism that sets and frozensets share
- [Module 2 Summary](./summary.md) — complete time complexity comparison and container decision table
