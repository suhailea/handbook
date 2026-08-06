---
title: CPython Memory Management
outline: deep
---

# CPython Memory Management

**Interview weight:** 🔥🔥🔥 — memory management internals are a top-tier topic in senior Python interviews. Expect questions on reference counting vs tracing GC, why `gc.disable()` can be a valid production choice, and how to diagnose memory leaks.

**Python version notes:** All examples target Python 3.12+. The cyclic GC's handling of objects with `__del__` improved significantly in Python 3.4 (PEP 442). Free-threaded Python (3.13t) introduces biased reference counting but does not change the concepts here.

**Prerequisites:** [Module 1 — Python Foundations](/python/module-01/), [Module 4 — OOP & Descriptors](/python/module-04/)

## 🗣️ In Plain English

::: tip In Plain English
CPython's memory management is like a warehouse with a specialized shelving system.

The warehouse has three levels. First, the OS gives Python a big chunk of floor space — the **private heap**. You, as a Python programmer, never go to the OS yourself; the warehouse handles all floor-space requests on your behalf.

Within that floor space, a warehouse manager called **pymalloc** organizes shelves into zones by box size. Small boxes (up to a certain size) go in pre-built shelving units. These shelving units are called **pools**, and each pool only holds boxes of one particular size. Several pools sit together on a large pallet called an **arena**. When you need a small box, the manager walks to the right-sized shelf and grabs one instantly — no need to search the whole warehouse. Large boxes that won't fit on any shelf go straight to the open floor, handled by the operating system's general storage.

Every box in the warehouse has a counter on it showing how many workers are currently using it. When a worker picks up a box, the counter goes up by one. When a worker is done with it, the counter drops by one. The moment the counter hits zero — nobody is using that box — the box is immediately recycled and its shelf space freed. This is **reference counting**, and it handles the vast majority of cleanup.

But sometimes workers form circles: Alice points at Bob's box, Bob points at Carol's box, Carol points back at Alice's box. Each box's counter says "1" because someone is pointing at it — yet nobody *outside* the circle needs any of them. The counters never reach zero, and the boxes sit there forever. To deal with this, a periodic inspector called the **cycle collector** walks through the warehouse, traces these circular chains, identifies the ones nobody outside the circle cares about, and recycles them in bulk.

That two-layer system — instant cleanup via counters for the common case, periodic inspector for the tricky circular case — is how CPython keeps the warehouse tidy without stopping all work for a long cleanup shift.
:::

## ⚙️ Under the Hood

### The private heap

CPython manages all Python object memory through a single **private heap**. You never call `malloc` directly from Python code. The C-level API (`PyMem_Malloc`, `PyObject_Malloc`) routes allocations through CPython's own memory management layers before falling back to the system allocator for large requests.

This design gives CPython full control over allocation patterns, allows the pymalloc optimization for small objects, and means the `sys` module can report meaningful memory statistics.

### The pymalloc allocator hierarchy

For objects up to 512 bytes (the common case — ints, floats, small strings, tuples, small dicts), CPython uses its custom **pymalloc** allocator, organized in three tiers:

| Level | Size | Purpose |
|-------|------|---------|
| **Arena** | 256 KB | Chunk requested from the OS via `mmap`/`VirtualAlloc`. CPython maintains a sorted list of arenas; the most-full arena is preferred for new allocations so that emptier arenas can be released back to the OS. |
| **Pool** | 4 KB (one VM page) | Each pool serves a single **size class**. 64 pools fit in one arena. |
| **Block** | 8 to 512 bytes, in 8-byte increments | The actual unit handed to a `PyObject_Malloc` call. Size class `i` serves allocations of `(i+1) * 8` bytes — giving 64 size classes total. |

Objects larger than 512 bytes bypass pymalloc entirely and go straight to the system `malloc`.

```python
# run: python3 pymalloc_routing.py
"""Demonstrate that small and large objects take different allocation paths."""
import sys

small = [0] * 5          # small list object (~136 bytes on 3.12)
large = [0] * 10_000     # large list object (~80056 bytes on 3.12)

print(f"Small list size: {sys.getsizeof(small):>8} bytes  (pymalloc)")
print(f"Large list size: {sys.getsizeof(large):>8} bytes  (system malloc)")

# The list *object header* is always small (~56 bytes), but the internal
# pointer array is separately allocated. For large lists, that array
# exceeds 512 bytes and goes to system malloc.
```

### Reference counting

Every Python object carries a reference count field (`ob_refcnt` in the `PyObject` struct). The C macros `Py_INCREF` and `Py_DECREF` adjust it. When the count drops to zero, CPython immediately deallocates the object — no waiting for a GC cycle.

```python
# run: python3 refcount_demo.py
"""Watch reference counts change in real time."""
import sys

a = [1, 2, 3]
print(f"After creation:       refcount = {sys.getrefcount(a) - 1}")
# Note: sys.getrefcount() itself creates a temporary reference,
# so we subtract 1 for the "true" count.

b = a  # b now also references the same list
print(f"After b = a:          refcount = {sys.getrefcount(a) - 1}")

c = {"key": a}  # stored in a dict
print(f"After dict storage:   refcount = {sys.getrefcount(a) - 1}")

del b
print(f"After del b:          refcount = {sys.getrefcount(a) - 1}")

del c
print(f"After del c:          refcount = {sys.getrefcount(a) - 1}")
```

Reference count changes happen on:

| Action | Effect |
|--------|--------|
| Variable assignment (`b = a`) | +1 |
| Passing to a function | +1 (parameter binding) |
| Storing in a container (list, dict, set) | +1 |
| `del` statement | -1 |
| Variable going out of scope | -1 |
| Removing from container | -1 |

Advantages of reference counting:
- **Deterministic deallocation** — objects are freed the instant their last reference disappears, not at some later GC pause.
- **Low latency** — no stop-the-world collection for the common (non-cyclic) case.
- **Predictable `__del__` timing** — finalizers run immediately when refcount hits zero.

Disadvantages:
- **Cannot handle reference cycles** (see below).
- **Thread overhead** — every `Py_INCREF`/`Py_DECREF` must be atomic or GIL-protected.
- **Memory overhead** — every object carries the `ob_refcnt` field (8 bytes on 64-bit).

### Why reference counting can't handle cycles

When two or more objects reference each other in a loop, each object's refcount stays at least 1 even after all external references are dropped. The reference counting mechanism alone will never free them.

```python
# run: python3 cycle_demo.py
"""Create a reference cycle and show the GC must collect it."""
import gc
import sys

gc.disable()  # Turn off the cyclic collector so we can observe the leak

class Node:
    def __init__(self, name: str) -> None:
        self.name = name
        self.partner: "Node | None" = None
    def __repr__(self) -> str:
        return f"Node({self.name!r})"

a = Node("A")
b = Node("B")
a.partner = b  # A → B
b.partner = a  # B → A  — cycle formed

# External refcount (subtracting the getrefcount temporary):
print(f"a refcount: {sys.getrefcount(a) - 1}")  # 2 (a, b.partner)
print(f"b refcount: {sys.getrefcount(b) - 1}")  # 2 (b, a.partner)

del a, b  # External references gone, but the cycle keeps both alive

# With gc disabled, the cycle leaks. Let's prove it:
print(f"Uncollectable objects before gc.collect(): {gc.collect()}")

# Re-enable and collect:
gc.enable()
collected = gc.collect()
print(f"Collected {collected} objects (the cycle)")
```

A self-referencing list is an even simpler demonstration:

```python
# run: python3 self_ref.py
"""A list that references itself — simplest possible cycle."""
import gc

gc.disable()

lst: list = [1, 2, 3]
lst.append(lst)  # lst[3] is lst itself — cycle!

del lst  # refcount drops from 2 to 1, never reaches 0

gc.enable()
print(f"Collected: {gc.collect()}")  # GC finds and breaks the cycle
```

### The cyclic garbage collector

CPython's cyclic GC is a **generational, tracing collector** that only runs to reclaim reference cycles. It does not replace reference counting — it supplements it.

**Three generations:**

| Generation | Contains | Collection trigger |
|------------|----------|-------------------|
| gen0 (young) | Newly allocated objects | Every 700 allocations (net of deallocations) |
| gen1 (middle) | Survived 1 gen0 collection | Every 10 gen0 collections |
| gen2 (old) | Survived 1 gen1 collection | Every 10 gen1 collections |

The thresholds are configurable via `gc.set_threshold()`. The defaults — (700, 10, 10) — mean gen2 is collected roughly every 70,000 net allocations.

**How a collection works:**
1. CPython takes all objects in the target generation (and younger generations).
2. It copies each object's refcount to a temporary field and subtracts internal references (references between objects in the candidate set).
3. Objects whose adjusted refcount is zero are identified as unreachable (part of a cycle with no external references).
4. Those objects are deallocated; surviving objects are promoted to the next generation.

```python
# run: python3 gc_stats.py
"""Inspect generational GC thresholds and statistics."""
import gc

# Default thresholds
print(f"Thresholds (gen0, gen1, gen2): {gc.get_threshold()}")

# Current stats: collections count, objects collected, uncollectable
stats = gc.get_stats()
for i, gen_stats in enumerate(stats):
    print(f"Gen {i}: {gen_stats}")

# Force a full collection and see what's found
collected = gc.collect()
print(f"\nFull gc.collect() freed {collected} objects")

# You can tune thresholds for your workload:
# gc.set_threshold(1000, 15, 15)  # less frequent collections
```

### Disabling the cyclic GC

Calling `gc.disable()` is not as reckless as it sounds. Instagram famously disabled the cyclic GC in their Django web servers because:

1. Their workload was fork-heavy (pre-fork web workers via gunicorn).
2. The GC's tracing phase touched object headers, causing copy-on-write page faults that ballooned memory per worker.
3. Their code produced very few reference cycles.

The trade-off: if your code *does* create cycles, they leak until you explicitly call `gc.collect()` or re-enable the GC. This is viable when:
- You control the codebase and can audit for cycles.
- You use weak references or explicit cleanup to avoid cycles.
- The memory cost of occasional leaks is smaller than the GC's overhead.

```python
# run: python3 gc_disable_pattern.py
"""Pattern: disable GC during a tight loop, collect manually after."""
import gc

gc.disable()

# === Hot loop: allocate/deallocate rapidly without GC pauses ===
data: list[dict[str, int]] = []
for i in range(100_000):
    data.append({"index": i, "value": i * 2})
data.clear()

# === Explicit collection at a safe point ===
gc.enable()
collected = gc.collect()
print(f"Collected {collected} cyclic objects after hot loop")
```

### Weak references

A **weak reference** points to an object without incrementing its reference count. When the referent's (strong) refcount drops to zero, the object is freed and the weak reference returns `None`.

This is critical for:
- **Caches** that should not keep objects alive just because the cache references them.
- **Breaking reference cycles** by design — one direction uses a weak reference.
- **Observer/listener patterns** where the subject should not prevent listeners from being collected.

```python
# run: python3 weakref_demo.py
"""Weak references don't prevent garbage collection."""
import weakref

class ExpensiveResource:
    def __init__(self, name: str) -> None:
        self.name = name
    def __repr__(self) -> str:
        return f"ExpensiveResource({self.name!r})"
    def __del__(self) -> None:
        print(f"  [freed: {self.name}]")

obj = ExpensiveResource("db-connection-pool")
weak = weakref.ref(obj)

print(f"Weak ref alive: {weak()}")  # Returns the object

del obj  # Refcount hits 0 → freed immediately

print(f"Weak ref after del: {weak()}")  # Returns None
```

**`WeakValueDictionary`** — a dict whose values are weak references. Entries vanish automatically when the value is garbage-collected:

```python
# run: python3 weakvaluedict_demo.py
"""WeakValueDictionary for caches that don't prevent GC."""
import weakref

class Session:
    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
    def __repr__(self) -> str:
        return f"Session({self.session_id})"

cache: weakref.WeakValueDictionary[str, Session] = weakref.WeakValueDictionary()

s1 = Session("abc-123")
s2 = Session("def-456")

cache["abc-123"] = s1
cache["def-456"] = s2

print(f"Cache before: {dict(cache)}")

del s1  # Strong reference gone → entry vanishes from cache

print(f"Cache after del s1: {dict(cache)}")
```

`WeakSet` works identically for set membership.

### `__del__` — the finalizer

The `__del__` method (called a **finalizer**) is invoked when an object's reference count reaches zero. It is *not* guaranteed to run in all circumstances:

- If the interpreter is shutting down, finalizers may be skipped or run in unpredictable order.
- **Before Python 3.4:** objects in reference cycles that had `__del__` methods were placed in `gc.garbage` and *never collected* — the GC could not determine a safe order to call the finalizers. This was fixed by PEP 442 (safe object finalization) in Python 3.4.
- **Python 3.4+:** the cyclic GC *can* collect cycles containing `__del__` objects. It calls the finalizers in an arbitrary (but safe) order, then breaks the cycle.

```python
# run: python3 finalizer_demo.py
"""Finalizer behavior with cycles (Python 3.4+)."""
import gc

class Resource:
    def __init__(self, name: str) -> None:
        self.name = name
        self.partner: "Resource | None" = None

    def __del__(self) -> None:
        print(f"  __del__ called on {self.name}")

# Create a cycle with finalizers
a = Resource("A")
b = Resource("B")
a.partner = b
b.partner = a

del a, b

# Python 3.4+: the GC handles this correctly
collected = gc.collect()
print(f"Collected {collected} objects from cycle with __del__")

# Check gc.garbage — should be empty on 3.4+
print(f"gc.garbage: {gc.garbage}")
```

**Best practice:** avoid `__del__` for resource cleanup. Use context managers (`with` statements) instead. Finalizers are a last resort, not a primary cleanup mechanism.

### Object memory overhead

Every Python object carries overhead from its C-level `PyObject` header (`ob_refcnt` + `ob_type` pointer = 16 bytes on 64-bit). Container objects add more.

```python
# run: python3 object_sizes.py
"""Measure the memory cost of common Python objects."""
import sys

objects: list[tuple[str, object]] = [
    ("int (0)",          0),
    ("int (1)",          1),
    ("int (2**30)",      2**30),
    ("int (2**60)",      2**60),
    ("int (2**120)",     2**120),
    ("float (3.14)",     3.14),
    ("bool (True)",      True),
    ("None",             None),
    ("str (empty)",      ""),
    ("str ('hello')",    "hello"),
    ("str (100 chars)",  "a" * 100),
    ("bytes (empty)",    b""),
    ("bytes (100)",      b"x" * 100),
    ("list (empty)",     []),
    ("list (10 ints)",   list(range(10))),
    ("tuple (empty)",    ()),
    ("tuple (10 ints)",  tuple(range(10))),
    ("dict (empty)",     {}),
    ("dict (5 items)",   {i: i for i in range(5)}),
    ("set (empty)",      set()),
    ("set (10 ints)",    set(range(10))),
]

print(f"{'Object':<22} {'sys.getsizeof (bytes)':>22}")
print("-" * 46)
for label, obj in objects:
    print(f"{label:<22} {sys.getsizeof(obj):>22}")
```

Key observations:
- A Python `int` holding `0` costs **28 bytes** (the `PyLongObject` header plus one digit). Arbitrary-precision ints grow with magnitude.
- A `float` is **24 bytes** (header + 8-byte IEEE 754 double).
- An empty `dict` is **64 bytes** (compact dict introduced in Python 3.6).
- `sys.getsizeof()` reports **shallow** size — it does not follow references. For a list of 1000 dicts, it reports the size of the list's pointer array, not the total memory of the dicts themselves. Use `pympler.asizeof()` for deep/recursive size measurement.

**`__slots__` for memory reduction:**

```python
# run: python3 slots_memory.py
"""Compare memory usage: regular class vs __slots__ class."""
import sys

class PointRegular:
    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

class PointSlots:
    __slots__ = ("x", "y")
    def __init__(self, x: float, y: float) -> None:
        self.x = x
        self.y = y

regular = PointRegular(1.0, 2.0)
slotted = PointSlots(1.0, 2.0)

print(f"Regular instance:  {sys.getsizeof(regular)} bytes")
print(f"  + __dict__:      {sys.getsizeof(regular.__dict__)} bytes")
print(f"  Total:           {sys.getsizeof(regular) + sys.getsizeof(regular.__dict__)} bytes")
print()
print(f"Slotted instance:  {sys.getsizeof(slotted)} bytes (no __dict__)")
print()
print(f"Savings per instance: "
      f"{sys.getsizeof(regular) + sys.getsizeof(regular.__dict__) - sys.getsizeof(slotted)} bytes")

# At 1 million instances, this difference is ~100 MB
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Memory leaks from hidden reference cycles**

**Symptom:** RSS grows steadily over hours/days; restarting the process fixes it temporarily. `tracemalloc` shows allocations growing in a module that should be releasing data.

**Root cause:** A common pattern in web frameworks — a request handler stores a reference to a middleware object, which stores a reference back to the request context. With `gc.disable()` (or a suppressed GC), these cycles accumulate. Even with the GC enabled, gen2 collections are infrequent enough that memory can spike significantly before cycles are reclaimed.

**Diagnosis:** Use `gc.set_debug(gc.DEBUG_SAVEALL)` to make the GC save collected cycle objects in `gc.garbage` so you can inspect them. The `objgraph` library can draw reference graphs: `objgraph.show_backrefs(obj, max_depth=5, filename='refs.png')`.

**2. `__del__` preventing garbage collection (pre-3.4) or causing order-dependent bugs**

**Symptom:** `gc.garbage` fills up with objects that the GC refuses to collect (Python < 3.4), or finalizers run in unexpected order causing `AttributeError` or use-after-free-style bugs during shutdown.

**Root cause:** Even on Python 3.4+, if a `__del__` method accesses module-level globals, those globals may already be set to `None` during interpreter shutdown. The finalizer then fails with `TypeError: 'NoneType' is not callable`.

**Fix:** Guard attribute access in `__del__` with `try`/`except`, or better yet, do not rely on `__del__` — use context managers and `atexit` handlers.

**3. Copy-on-write blowup with fork-based workers**

**Symptom:** A gunicorn/uvicorn pre-fork deployment shows each worker using far more RSS than expected. Total memory usage is N workers times the full process size, rather than sharing pages via copy-on-write.

**Root cause:** The cyclic GC walks object headers during collection, writing to memory pages that the OS had marked as copy-on-write shared. Each touched page is duplicated per worker. This is exactly the scenario that motivated Instagram's `gc.disable()` strategy.

**Fix:** Call `gc.freeze()` (Python 3.7+) before forking. This moves all existing objects to a permanent generation that the GC never touches, preserving copy-on-write sharing. Alternatively, disable GC before fork and re-enable in each worker with periodic manual `gc.collect()` at safe points.
:::

## 🎯 Checkpoint

::: details Question 1 — Why can't reference counting alone manage all memory?
**Q:** Explain why CPython needs a cyclic garbage collector in addition to reference counting. Give a concrete code example that would leak memory without the cyclic GC.

**A:** Reference counting deallocates an object when its reference count drops to zero. However, when two or more objects reference each other in a cycle (e.g., `a.ref = b; b.ref = a`), deleting all external references (`del a; del b`) still leaves each object's refcount at 1 (from the internal cross-reference). The counts never reach zero, so the objects are never freed. The cyclic GC uses a tracing algorithm — it walks the reference graph, temporarily subtracts internal references, and identifies objects whose adjusted refcount is zero as unreachable cycle members. Without this second mechanism, any code that creates mutual or self-references (common in trees, graphs, observer patterns, parent-child relationships) would leak indefinitely.
:::

::: details Question 2 — gc.freeze() and pre-fork servers
**Q:** What does `gc.freeze()` do, and why is it relevant for pre-fork web server deployments?

**A:** `gc.freeze()` (Python 3.7+) moves all currently tracked objects into a permanent generation that the cyclic GC will never examine. In a pre-fork server (e.g., gunicorn with `--preload`), the parent process loads the application and its objects into memory. After `fork()`, child workers share these memory pages via the OS's copy-on-write mechanism. If the GC runs in a child and *traces* those shared objects, it modifies their `gc_refs` headers, triggering a copy-on-write page fault for every touched page. This duplicates memory across all workers, destroying the sharing benefit. By calling `gc.freeze()` before forking, those objects are excluded from future GC scans, so their pages remain shared. New objects allocated in each worker are still tracked and collected normally.
:::

::: details Question 3 — Object size and `__slots__`
**Q:** Why does a Python `int` with value `1` occupy 28 bytes? How does `__slots__` reduce per-instance memory, and what trade-off does it introduce?

**A:** A CPython `int` (`PyLongObject`) consists of: `ob_refcnt` (8 bytes) + `ob_type` pointer (8 bytes) + `ob_size` for digit count (4 bytes, padded to 8) + one 30-bit digit stored as a `uint32_t` (4 bytes, padded to 8). Total: 28 bytes. Arbitrary-precision integers grow by 4 bytes per additional digit.

`__slots__` replaces the per-instance `__dict__` (a hash table, 64+ bytes empty) with a fixed C-level array of pointers (8 bytes per slot). For a class with two attributes, this saves roughly 100+ bytes per instance. At millions of instances, this can mean hundreds of megabytes. The trade-off: instances with `__slots__` cannot have arbitrary attributes added at runtime (no `__dict__`), cannot be weakly referenced (unless `__weakref__` is included in `__slots__`), and subclasses must also define `__slots__` or they revert to having a `__dict__`.
:::

## Key Mental Models

- **Two-layer GC:** Reference counting handles the 99% case (immediate, deterministic deallocation). The cyclic collector handles the 1% (reference cycles). Neither alone is sufficient.
- **pymalloc is a small-object specialist:** Objects up to 512 bytes get fast, pool-based allocation. Larger objects fall through to system `malloc`. This is why creating millions of small Python objects is cheaper than you might expect — but each one still carries ~28+ bytes of header overhead.
- **Weak references are a design tool, not a hack:** Use `weakref` to build caches, observer patterns, and parent-child relationships where one direction should not prevent collection.
- **`__del__` is a footgun:** Prefer context managers for resource cleanup. Finalizers interact poorly with cycles, interpreter shutdown, and developer expectations about timing.
- **Profile before disabling the GC:** `gc.disable()` and `gc.freeze()` are legitimate production tools, but only after you have measured that the GC is your actual bottleneck (copy-on-write blowup, latency spikes from gen2 collections).

## Related

- [Module 4: Metaclasses & `__slots__`](/python/module-04/04-metaclasses-slots.md) — the `__slots__` mechanism in detail, including inheritance interactions.
- [Module 7: The GIL](/python/module-07/01-gil.md) — the GIL protects reference counting from data races; free-threaded Python (3.13t) introduces biased reference counting as a replacement.
- [Profiling & Optimization](./02-profiling-optimization.md) — tracemalloc for tracking memory allocations, practical memory optimization techniques.
