---
title: Memory & GC Fundamentals (V8)
outline: deep
---

# Memory & GC Fundamentals (V8)

<Badge type="tip" text="Interview: Medium-High" /> <Badge type="warning" text="Prereqs: Closures, Execution Contexts" />

## 🗣️ In Plain English

::: tip In Plain English
Imagine a city with two neighborhoods.

The **nursery** is a small, bustling neighborhood where every new resident moves in. People come and go constantly — most stay for a few days and leave. Every few minutes, a census worker walks through. Anyone still around gets relocated to the **established neighborhood** across town. Everyone who left? Their house is instantly bulldozed and the land reused. This is fast because the nursery is tiny and most houses are already empty.

The **established neighborhood** is larger and calmer. Residents here have proven they are sticking around. A thorough city inspector visits less often. The inspector starts at city hall (the "root") and follows every connected road. Any house the inspector can reach by road is safe. Any house with no road connection at all — no one can get to it, no one references it — gets demolished. After demolition, the remaining houses are sometimes shuffled closer together to eliminate gaps (compaction).

This is exactly how V8's garbage collector works. Short-lived objects (temporary variables, intermediate results) are born in the young generation and usually die there — collected quickly and cheaply. Objects that survive get promoted to the old generation, where collection is more expensive but happens less often.

Memory leaks happen when you accidentally keep a road connected to a house you thought was abandoned. A forgotten timer callback, a closure that captures a huge variable, a cache that grows without bounds — these are roads that keep objects reachable long after you are done with them. The garbage collector cannot read your intentions; it only sees connections.

Understanding this model helps you write code that cooperates with the GC rather than fighting it: let short-lived objects die young, avoid accidentally retaining references, and know how to diagnose leaks when they happen.
:::

## ⚙️ Under the Hood

### V8 Heap Layout

V8 divides its managed heap into several spaces, each with a distinct purpose and collection strategy.

| Space                | Size        | Contains                                    | GC Strategy                |
|----------------------|-------------|---------------------------------------------|----------------------------|
| **New Space** (young)| ~1-8 MB     | Newly allocated objects                     | Scavenge (minor GC)        |
| **Old Space** (old)  | Up to heap limit | Objects surviving 2+ scavenges          | Mark-Sweep-Compact (major) |
| **Large Object Space**| Varies     | Objects > ~512 KB                           | Mark-Sweep (never moved)   |
| **Code Space**       | Varies      | JIT-compiled machine code                   | Mark-Sweep                 |
| **Map Space**        | Varies      | Hidden classes / shapes                     | Mark-Sweep                 |

```ts
// run: node --experimental-strip-types demo.ts

// Inspect current heap usage
const mem = process.memoryUsage();
console.log({
  rss:       `${(mem.rss / 1024 / 1024).toFixed(1)} MB`,  // total resident set
  heapTotal: `${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB`,  // V8 heap allocated
  heapUsed:  `${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB`,   // V8 heap in use
  external:  `${(mem.external / 1024 / 1024).toFixed(1)} MB`,   // C++ objects bound to JS
});
```

### Reachability: How GC Decides What Lives

GC starts from a set of **roots**:

- The global object (`globalThis`)
- The current call stack (local variables, parameters)
- Active timers and pending callbacks in the event loop
- Internal V8 handles

Any object reachable from a root — directly or through a chain of references — is **live**. Everything else is **garbage**.

```ts
// run: node --experimental-strip-types demo.ts

function demo() {
  const big = new ArrayBuffer(1024 * 1024); // 1 MB
  // 'big' is reachable via the stack while demo() runs

  const leaked = { ref: big };
  (globalThis as any).__leak = leaked;
  // Now 'big' is reachable via globalThis → __leak → ref
  // Even after demo() returns, 'big' survives GC
}

demo();
// Cleanup: remove the root reference
delete (globalThis as any).__leak;
// Now 'big' is unreachable and eligible for GC
```

### Minor GC: The Scavenger

New Space is divided into two equal **semi-spaces**: **from-space** and **to-space**.

1. New objects are allocated in from-space.
2. When from-space fills up, the Scavenger runs.
3. Live objects are copied from from-space to to-space. Dead objects are simply abandoned.
4. The roles swap: to-space becomes the new from-space.
5. Objects surviving **two scavenges** are **promoted** to Old Space.

This works because of the **generational hypothesis**: most objects die young. Copying only the survivors is fast when most objects are dead.

```
  Allocation → [from-space ██░░░░░░]  [to-space ________]
                    ↓ Scavenge
               [from-space ________]  [to-space ██______]
                                           ↑ only live objects copied
```

### Major GC: Mark-Sweep-Compact

Old Space is collected less frequently, using a three-phase algorithm:

| Phase       | What Happens                                                        |
|-------------|---------------------------------------------------------------------|
| **Mark**    | Trace from roots, mark every reachable object.                      |
| **Sweep**   | Walk the heap, free memory of unmarked objects, build free lists.    |
| **Compact** | Move surviving objects to eliminate fragmentation (optional phase).  |

### Reducing Stop-the-World Pauses

Early GC implementations stopped JavaScript entirely during collection. Modern V8 minimizes pauses:

| Technique               | Description                                                             |
|--------------------------|-------------------------------------------------------------------------|
| **Incremental marking**  | Mark in small steps interleaved with JS execution (~1 ms each).         |
| **Concurrent marking**   | Mark on background threads while JS runs on the main thread.            |
| **Concurrent sweeping**  | Free memory on background threads.                                      |
| **Parallel scavenging**  | Multiple threads cooperate during minor GC.                             |
| **Lazy sweeping**        | Sweep pages only when memory is needed, not all at once.                |

```ts
// run: node --experimental-strip-types demo.ts

// You can observe GC events with --expose-gc and performance hooks
// Run with: node --expose-gc --experimental-strip-types demo.ts

import { PerformanceObserver } from "node:perf_hooks";

const obs = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    // GC entries have detail.kind: 1 = Scavenge, 2 = Mark-Sweep
    const detail = (entry as any).detail;
    console.log(
      `GC: ${entry.name} | kind=${detail?.kind} | duration=${entry.duration.toFixed(2)}ms`
    );
  }
});
obs.observe({ entryTypes: ["gc"] });

// Force a minor + major GC to see the events
if (typeof globalThis.gc === "function") {
  // Allocate many short-lived objects to trigger scavenge
  for (let i = 0; i < 100_000; i++) {
    JSON.parse('{"a":1}');
  }
  globalThis.gc(); // major GC
}

setTimeout(() => obs.disconnect(), 1000);
```

### Common Memory Leak Patterns

#### 1. Forgotten Timers and Intervals

```ts
// run: node --experimental-strip-types demo.ts

function startPolling() {
  const hugeData = new Array(1_000_000).fill("x");

  // This closure captures hugeData — it can never be GC'd
  // until the interval is cleared
  const id = setInterval(() => {
    console.log(hugeData.length); // hugeData is retained
  }, 60_000);

  // FIX: return a cleanup function
  return () => clearInterval(id);
}

const stop = startPolling();
// Later: stop() to release memory
stop();
```

#### 2. Closures Capturing Large Scopes

```ts
// run: node --experimental-strip-types demo.ts

function processData() {
  const raw = Buffer.alloc(50 * 1024 * 1024); // 50 MB

  // This closure only needs the length, but captures the entire scope
  return () => {
    return raw.length; // 'raw' (50 MB) is retained!
  };
}

// FIX: extract only what you need before closing over it
function processDataFixed() {
  const raw = Buffer.alloc(50 * 1024 * 1024);
  const len = raw.length; // extract the value
  // raw can now be GC'd after processDataFixed() returns
  return () => len;
}
```

#### 3. Growing Maps/Sets as Unbounded Caches

```ts
// run: node --experimental-strip-types demo.ts

// BAD: cache grows without bound
const cache = new Map<string, object>();

function lookup(key: string): object {
  if (!cache.has(key)) {
    cache.set(key, { data: key.repeat(1000) });
  }
  return cache.get(key)!;
}

// FIX: use an LRU strategy or WeakRef-based cache
// (see WeakRef section below)
```

#### 4. Event Listener Accumulation

```ts
// run: node --experimental-strip-types demo.ts
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();

function subscribe() {
  // Each call adds ANOTHER listener — they accumulate
  emitter.on("data", (d: unknown) => console.log(d));
}

// After 11 calls, Node.js warns about a possible leak
for (let i = 0; i < 12; i++) subscribe();
console.log(`Listener count: ${emitter.listenerCount("data")}`); // 12
```

### WeakRef and FinalizationRegistry (ES2021)

`WeakRef` holds a reference that does not prevent garbage collection. `FinalizationRegistry` runs a callback after an object is collected.

```ts
// run: node --experimental-strip-types demo.ts
// Run with: node --expose-gc --experimental-strip-types demo.ts

const registry = new FinalizationRegistry((heldValue: string) => {
  console.log(`Object "${heldValue}" was garbage collected`);
});

function demo() {
  let obj: { name: string } | undefined = { name: "ephemeral" };
  const weak = new WeakRef(obj);
  registry.register(obj, "my-object"); // heldValue for the callback

  console.log("Before GC:", weak.deref()?.name); // "ephemeral"

  obj = undefined; // remove the strong reference

  if (typeof globalThis.gc === "function") {
    globalThis.gc();
    // GC timing is non-deterministic; deref may or may not return undefined here
    console.log("After GC:", weak.deref()?.name ?? "collected");
  }
}

demo();
setTimeout(() => {}, 500); // allow the FinalizationRegistry callback to fire
```

**Caveats:**
- GC timing is **non-deterministic**. Never rely on `FinalizationRegistry` for correctness — only for cleanup.
- `WeakRef.deref()` may return the object even after you drop all references if GC hasn't run yet.
- Use cases: caches, observer pattern cleanup, preventing memory leaks in long-lived maps.

### Reading a Heap Snapshot

```ts
// run: node --experimental-strip-types demo.ts
import { writeHeapSnapshot } from "node:v8";

// Take a snapshot (writes a .heapsnapshot file to cwd)
const filename = writeHeapSnapshot();
console.log(`Heap snapshot written to: ${filename}`);
// Open in Chrome DevTools → Memory → Load
```

**What to look for in Chrome DevTools:**

| View             | Purpose                                                          |
|------------------|------------------------------------------------------------------|
| **Summary**      | Objects grouped by constructor. Sort by "Retained Size" to find big retainers. |
| **Comparison**   | Diff two snapshots to see what was allocated between them.       |
| **Containment**  | Tree view showing the object graph from roots.                   |
| **Retainers**    | For a selected object, shows the chain of references keeping it alive ("shortest path to root"). |

**Leak diagnosis workflow:**
1. Take snapshot **before** the suspected operation.
2. Perform the operation (e.g., handle 100 requests).
3. Force GC (`global.gc()`).
4. Take snapshot **after**.
5. Compare: look for objects whose count or size grew unexpectedly.
6. Inspect the retainer tree to find what is holding them.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Closures silently retaining entire scopes.**
V8 cannot partially capture a closure's scope. If a closure references any variable from an outer function, the entire scope object is retained. A closure that uses one small string can inadvertently keep a 50 MB buffer alive because both live in the same scope. Extract only needed values into local variables before closing over them.

**2. Unbounded caches causing slow, invisible OOM.**
A `Map` used as a cache grows one entry at a time. Memory usage climbs linearly over hours or days until the process hits its heap limit and crashes. This does not show up in short load tests. Use LRU caches with size limits, or `WeakRef`-based caches for object keys.

**3. Detached DOM nodes in server-side rendering.**
If you use JSDOM or similar in Node.js, removing a DOM element from the tree does not free it if JavaScript still holds a reference (e.g., in a variable or event listener). These "detached nodes" accumulate in heap snapshots.

**4. GC pauses spiking P99 latency.**
A major GC on a large old-generation heap can pause the event loop for 50-200ms. This is invisible in average latency but devastating for P99/P99.9. Monitor with `--trace-gc` or `perf_hooks` GC entries. Reduce old-generation pressure by letting objects die young and avoiding premature promotion.
:::

## 🎯 Checkpoint

::: details Question 1 — Generational Hypothesis
**Q:** Why does V8 divide the heap into a young generation and an old generation instead of treating all objects the same?

**A:** The generational hypothesis states that most objects die young. By segregating short-lived objects into a small young generation, V8 can collect them with a fast copying algorithm (Scavenge) that only touches live objects — and since most are dead, very little is copied. The old generation is collected less often with the more expensive Mark-Sweep-Compact algorithm. This division optimizes for the common case: frequent, cheap minor GCs for short-lived objects, and infrequent, thorough major GCs for long-lived objects.
:::

::: details Question 2 — Closures and Retention
**Q:** A function returns a closure that uses a single `number` from its outer scope. The outer scope also has a 100 MB `Buffer`. Is the buffer retained? Why or why not?

**A:** It depends on V8's scope analysis. V8 creates a single scope object for the outer function's variables that are captured by any closure. If the closure references any variable from that scope, the scope object is retained. However, V8 performs static analysis and only includes variables that are actually referenced by any closure in the scope. If no closure references the `Buffer` variable, V8 can exclude it from the scope object and it becomes eligible for GC. But if another closure in the same scope references it — even one you forgot about — the entire buffer is retained.
:::

::: details Question 3 — WeakRef Semantics
**Q:** Can you use `FinalizationRegistry` to reliably close a file handle when the object wrapping it is garbage collected?

**A:** No. `FinalizationRegistry` callbacks are non-deterministic — they may fire late, never fire (if the process exits), or fire in a different order than expected. You cannot rely on them for correctness or timely resource cleanup. Use explicit cleanup patterns (`try/finally`, `using` with `Symbol.dispose`, or `AbortController`) for critical resources like file handles. `FinalizationRegistry` is a safety net, not a primary resource management strategy.
:::

## Key Mental Models

- **Reachability is the only rule.** If the GC can trace a path from any root to an object, that object survives — regardless of your intent.
- **Most objects should die young.** Design data flow so temporary objects stay in the young generation and are collected cheaply by the Scavenger.
- **Closures capture scopes, not individual variables.** Be deliberate about what is in scope when you create long-lived closures.
- **Caches need eviction policies.** An unbounded `Map` is not a cache — it is a memory leak with a delayed fuse.
- **Measure, don't guess.** Use heap snapshots and `--trace-gc` to diagnose memory issues; intuition alone is unreliable.

## Related

- [Closures](./02-closures)
- [Heap Snapshots](/nodejs/module-06/02-heap-snapshots)
- [GC Behavior & Latency](/nodejs/module-06/03-gc-latency)
