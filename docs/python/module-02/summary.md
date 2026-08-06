---
title: Module 2 Summary
outline: deep
---

# Module 2 Summary — Data Structures Deep Dive

You've now seen inside Python's core containers. This page distills the module into the mental models, reference tables, and self-checks you need before moving on.

## Mental Models Gained

1. **Lists are dynamic arrays with conservative over-allocation (~12.5%).** They're fast at the right end (append/pop O(1) amortized) and slow at the left (insert/pop(0) O(n)).

2. **Tuples are frozen, compact sequences.** Immutability means less memory (no over-allocation), hashability (if all elements are hashable), and a clear signal that the data shouldn't change.

3. **Dicts are hash tables with open addressing and perturbation probing.** The compact dict layout (sparse indices + dense entries) preserves insertion order and saves memory compared to the pre-3.6 design.

4. **Sets are dicts without values.** Same hash table, same O(1) average membership test, same requirement for hashable elements.

5. **The `__hash__`/`__eq__` contract is the foundation of dict and set correctness.** If `a == b` then `hash(a)` must equal `hash(b)`. Violate this and objects silently disappear from hash-based containers.

6. **Shallow copy duplicates the outer container; deep copy duplicates everything recursively.** For nested mutable structures, shallow copy creates shared-reference bugs that are hard to diagnose.

7. **The collections module provides purpose-built containers.** `Counter` for frequencies, `deque` for double-ended O(1) ops, `defaultdict` for auto-initializing missing keys, `ChainMap` for layered lookups, `OrderedDict` for order-sensitive equality and repositioning.

8. **Container choice is an algorithmic decision, not a style preference.** The difference between O(1) and O(n) membership checks (set vs list) or O(1) and O(n) left-end operations (deque vs list) can make or break production performance.

## Self-Assessment Checklist

Test yourself on each item. If you can't explain the mechanism (not just state the fact), revisit the linked page.

- [ ] I can explain CPython's list resize formula and why `append` is O(1) amortized. → [Lists & Tuples](./01-lists-tuples.md)
- [ ] I know the difference between `list.copy()`, `copy.copy()`, slicing `[:]`, and `copy.deepcopy()` — and when each matters. → [Lists & Tuples](./01-lists-tuples.md)
- [ ] I can explain why `t[0] += [3]` on a tuple containing a list both raises TypeError AND mutates the list. → [Lists & Tuples](./01-lists-tuples.md)
- [ ] I can describe the compact dict layout (sparse indices + dense entries) and why it preserves insertion order. → [Dicts](./02-dicts.md)
- [ ] I can explain perturbation-based probing and why it's better than linear probing. → [Dicts](./02-dicts.md)
- [ ] I know the `__hash__`/`__eq__` contract and what happens when it's violated. → [Dicts](./02-dicts.md)
- [ ] I can explain why dict views are live references, not snapshots, and the implications for iteration. → [Dicts](./02-dicts.md)
- [ ] I know when to use `set` vs `frozenset` and why regular sets can't be dict keys. → [Sets & Collections](./03-sets-collections.md)
- [ ] I can explain why `deque` is O(1) at both ends but O(n) for random access, and what data structure backs it. → [Sets & Collections](./03-sets-collections.md)
- [ ] I know that `defaultdict` creates keys on *access* (not just assignment) and how to avoid phantom keys. → [Sets & Collections](./03-sets-collections.md)

## Quick Reference: Time Complexities

### list

| Operation | Average | Worst | Notes |
|-----------|---------|-------|-------|
| `append(x)` | O(1) amort. | O(n) | Resize copies array |
| `insert(0, x)` | O(n) | O(n) | Shifts all elements |
| `pop()` | O(1) | O(1) | From end |
| `pop(0)` | O(n) | O(n) | Shifts all elements |
| `x in list` | O(n) | O(n) | Linear scan |
| `list[i]` | O(1) | O(1) | Pointer offset |
| `sort()` | O(n log n) | O(n log n) | Timsort, stable |
| `len()` | O(1) | O(1) | Stored attribute |

### tuple

| Operation | Average | Worst | Notes |
|-----------|---------|-------|-------|
| `t[i]` | O(1) | O(1) | Pointer offset |
| `x in t` | O(n) | O(n) | Linear scan |
| `len()` | O(1) | O(1) | Stored attribute |
| `hash()` | O(n) | O(n) | Hashes all elements (cached after first call) |

### dict

| Operation | Average | Worst | Notes |
|-----------|---------|-------|-------|
| `d[key]` / `get` | O(1) | O(n) | Worst = all collisions |
| `d[key] = val` | O(1) | O(n) | May trigger resize |
| `del d[key]` | O(1) | O(n) | Leaves tombstone |
| `key in d` | O(1) | O(n) | Hash + probe |
| `iter(d)` | O(n) | O(n) | Walks dense entries |
| `len()` | O(1) | O(1) | Stored attribute |
| `d.copy()` | O(n) | O(n) | Shallow |

### set

| Operation | Average | Worst | Notes |
|-----------|---------|-------|-------|
| `add(x)` | O(1) | O(n) | May trigger resize |
| `discard(x)` | O(1) | O(n) | No error if missing |
| `x in s` | O(1) | O(n) | Hash + probe |
| `s \| t` (union) | O(len(s)+len(t)) | — | New set |
| `s & t` (intersect) | O(min(len(s),len(t))) | — | Checks smaller against larger |
| `s - t` (difference) | O(len(s)) | — | Checks each in s |

### deque

| Operation | Average | Worst | Notes |
|-----------|---------|-------|-------|
| `append(x)` | O(1) | O(1) | Right end |
| `appendleft(x)` | O(1) | O(1) | Left end |
| `pop()` | O(1) | O(1) | Right end |
| `popleft()` | O(1) | O(1) | Left end |
| `d[i]` | O(n) | O(n) | Block traversal |
| `x in d` | O(n) | O(n) | Linear scan |
| `rotate(k)` | O(k) | O(k) | Circular shift |

### Counter

| Operation | Average | Notes |
|-----------|---------|-------|
| `Counter(iterable)` | O(n) | One pass count |
| `most_common(k)` | O(n log k) | Heap-based |
| `c[key]` | O(1) | Returns 0 for missing |
| `c1 + c2` | O(len(c1)+len(c2)) | Adds counts |
| `c1 - c2` | O(len(c1)+len(c2)) | Drops zero/negative |

## Quick Reference: Mutability & Hashability

| Container | Mutable? | Hashable? | Can be dict key? | Can be set member? | Ordered? |
|-----------|----------|-----------|-------------------|---------------------|----------|
| `list` | Yes | No | No | No | Yes (by index) |
| `tuple` | No | Conditionally* | Conditionally* | Conditionally* | Yes (by index) |
| `dict` | Yes | No | No | No | Yes (insertion, 3.7+) |
| `set` | Yes | No | No | No | No |
| `frozenset` | No | Yes | Yes | Yes | No |
| `deque` | Yes | No | No | No | Yes (by index) |
| `Counter` | Yes | No | No | No | Yes (insertion, 3.7+) |
| `OrderedDict` | Yes | No | No | No | Yes (insertion) |
| `NamedTuple` | No | Conditionally* | Conditionally* | Conditionally* | Yes (by index) |

*\*Conditionally hashable: only if all contained elements are themselves hashable.*

## What's Next

Continue to [Module 3 — Functions & Scoping](/python/module-03/) to explore how Python's function machinery — closures, scoping rules, decorators, and `*args`/`**kwargs` — interacts with these data structures.
