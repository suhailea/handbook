---
title: "GC Behavior & Latency"
outline: deep
---

# GC Behavior & Latency

**Interview weight:** 🔥🔥🔥 | **Node 22+** | **V8 12.x** | Prerequisites: [Memory & GC (JS Core)](/js-core/07-memory-gc), [Blocking the Loop](/nodejs/module-02/03-blocking-the-loop)

## 🗣️ In Plain English

::: tip In Plain English
Imagine your desk. As you work, you pile up sticky notes, coffee cups, and scratch paper. If you never clean up, eventually there is no space to put anything down and work stops completely.

Your program's memory is that desk. V8's **garbage collector** is the cleaning crew. The question is not *whether* they clean — they always do — but *when* and *how long it takes*.

V8 uses two strategies depending on how old the mess is. Fresh clutter (variables from the current request, temporary strings) piles up in a small "nursery" area. Every few seconds a quick cleaner does a fast sweep of just that area — most of the mess is recent, most of it is trash, so this takes a millisecond or two. Think of it like clearing your desk at the end of each task.

But some things stick around — your database connection, a big cache object, a config map. Those get promoted to the "warehouse" — a much larger storage area. Cleaning the warehouse is a bigger job. The crew has to walk every shelf, mark what is still needed, and then either sweep the dead items away or compact the remaining items together to eliminate gaps. While they do this heavy cleaning, **your program pauses** — no requests are handled, no timers fire, nothing happens until the crew finishes.

That pause is the **GC latency hit**. For a nursery sweep it is barely noticeable. For a full warehouse cleanup on a service holding 1.5 GB of live data, it can freeze your server for 50-200 milliseconds. At scale, those pauses show up as tail-latency spikes — your p99 jumps while your p50 looks fine.

The art of GC-friendly Node programming is keeping the warehouse small and the nursery turnover fast: allocate less, hold less, and let go quickly.
:::

## ⚙️ Under the Hood

### V8's Generational Heap Layout

V8 divides the managed heap into two generations:

| Region | Default size | GC algorithm | Typical pause |
|---|---|---|---|
| **Young generation** (semi-space / nursery) | ~16 MB (two 8 MB semi-spaces) | **Scavenge** (Cheney's copying collector) | 0.5–3 ms |
| **Old generation** | ~1.7 GB (64-bit), configurable via `--max-old-space-size` | **Mark-Sweep** and **Mark-Compact** | 5–200+ ms |

There is also a **Large Object Space** (objects > ~512 KB go directly to old gen) and a **Code Space** for JIT-compiled machine code.

### Scavenge (Young Generation)

The young generation is split into two equally-sized **semi-spaces**: `from-space` (active) and `to-space` (empty). When `from-space` fills:

1. V8 pauses execution (stop-the-world).
2. It walks all roots (stack, globals, handles) and copies every reachable object from `from-space` into `to-space`.
3. Objects that survive a second scavenge are **promoted** to old generation.
4. `from-space` and `to-space` swap roles. The old `from-space` is now considered empty.

Because most young objects are short-lived, scavenge typically copies very little and completes in under 2 ms.

```typescript
// run: node --experimental-strip-types --trace-gc demo-scavenge.ts
// Demonstrates rapid young-gen allocation and scavenge cycles

function churner(): void {
  const results: string[] = [];
  for (let i = 0; i < 100_000; i++) {
    // Each iteration allocates a short-lived string in young gen
    results.push(`item-${i}-${Date.now()}`);
  }
  // results goes out of scope here — all young-gen garbage
}

for (let round = 0; round < 10; round++) {
  churner();
}
// With --trace-gc you will see many Scavenge lines like:
// [12345:0x...] 42 ms: Scavenge 8.2 (16.0) -> 1.1 (16.0) MB, 1.3 / 0.0 ms ...
```

### Mark-Sweep & Mark-Compact (Old Generation)

When old generation usage crosses a threshold, V8 triggers a **major GC**:

**Mark phase:** Starting from roots, V8 walks the entire object graph and marks every reachable object. Since Node 12+, most marking is **incremental** — V8 interleaves small marking steps with JavaScript execution to avoid one giant pause. V8 also uses **concurrent marking** — helper threads mark objects while the main thread continues running JS.

**Sweep phase:** V8 walks the old-gen pages and adds unmarked (dead) objects to a free list. Sweeping is largely **concurrent** — it happens on background threads.

**Compact phase:** When fragmentation is high, V8 moves live objects together to eliminate gaps. Compaction requires a stop-the-world pause because object addresses change and all pointers must be updated atomically.

```typescript
// run: node --experimental-strip-types --trace-gc --max-old-space-size=256 demo-major-gc.ts
// Forces objects into old gen to trigger major GC

const cache: Map<number, Buffer> = new Map();

for (let i = 0; i < 50_000; i++) {
  // 4 KB buffers that survive scavenge and get promoted
  cache.set(i, Buffer.alloc(4096, i % 256));

  // Evict old entries to create fragmentation
  if (i > 10_000) {
    cache.delete(i - 10_000);
  }
}

console.log(`Final cache size: ${cache.size}`);
// --trace-gc output will show Mark-Sweep and Mark-Compact lines:
// [12345:0x...] 850 ms: Mark-Sweep 200.3 (256.0) -> 45.1 (256.0) MB, 23.5 / 0.0 ms ...
```

### Reading `--trace-gc` Output

Each `--trace-gc` line follows this format:

```
[PID:isolate] time_since_start_ms: GC_TYPE before_size (committed) -> after_size (committed) MB, pause / ... ms (reason)
```

| Field | Meaning |
|---|---|
| `Scavenge` / `Mark-Sweep` / `Mark-Compact` | Which collector ran |
| `before_size` | Heap used before GC |
| `after_size` | Heap used after GC (the difference is freed memory) |
| `committed` | Total memory committed from the OS |
| `pause ms` | **The stop-the-world pause your code experienced** |

For deeper analysis, use `--trace-gc-verbose` which adds per-space breakdowns.

### Controlling Heap Size with `--max-old-space-size`

```bash
# Default: ~1.7 GB on 64-bit systems (changed in Node 12+, was 1.4 GB before)
node --max-old-space-size=4096 server.ts   # 4 GB old generation limit
node --max-old-space-size=512 worker.ts    # 512 MB — tighter, faster major GC
```

V8 triggers major GC more frequently as usage approaches the limit. A smaller limit means more frequent but shorter pauses. A larger limit means fewer but potentially longer pauses with more memory to walk.

**In containers:** Always set `--max-old-space-size` explicitly. V8 detects container memory limits *(since Node 12.17)*, but the auto-detected value may be too aggressive. A safe rule of thumb: set it to **75% of container memory**, leaving room for native allocations (Buffers, libuv, C++ objects) and the OS.

### Monitoring GC Programmatically

```typescript
// run: node --experimental-strip-types gc-monitor.ts
import v8 from 'node:v8';
import { performance, PerformanceObserver } from 'node:perf_hooks';

// --- Approach 1: Heap statistics snapshot ---
function logHeapStats(): void {
  const stats = v8.getHeapStatistics();
  console.log({
    totalHeapSize:       `${(stats.total_heap_size / 1024 / 1024).toFixed(1)} MB`,
    usedHeapSize:        `${(stats.used_heap_size / 1024 / 1024).toFixed(1)} MB`,
    heapSizeLimit:       `${(stats.heap_size_limit / 1024 / 1024).toFixed(1)} MB`,
    externalMemory:      `${(stats.external_memory / 1024 / 1024).toFixed(1)} MB`,
    mallocedMemory:      `${(stats.malloced_memory / 1024 / 1024).toFixed(1)} MB`,
  });
}

// --- Approach 2: PerformanceObserver for GC entries (Node 16+) ---
const gcObserver = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const gcEntry = entry as PerformanceEntry & { detail?: { kind?: number } };
    const kind = gcEntry.detail?.kind;
    const kindName = kind === 1 ? 'Scavenge'
                   : kind === 2 ? 'Mark-Sweep-Compact'
                   : kind === 4 ? 'Incremental-Marking'
                   : kind === 8 ? 'Weak-Processing'
                   : `Unknown(${kind})`;

    console.log(`GC: ${kindName} took ${entry.duration.toFixed(2)} ms`);
  }
});

gcObserver.observe({ type: 'gc', buffered: false });

// --- Approach 3: Per-space breakdown ---
function logSpaces(): void {
  const spaces = v8.getHeapSpaceStatistics();
  for (const space of spaces) {
    if (space.space_used_size > 0) {
      console.log(
        `  ${space.space_name}: ${(space.space_used_size / 1024 / 1024).toFixed(1)} MB ` +
        `/ ${(space.space_size / 1024 / 1024).toFixed(1)} MB`
      );
    }
  }
}

// Simulate some work
const data: string[] = [];
const interval = setInterval(() => {
  for (let i = 0; i < 50_000; i++) {
    data.push(`entry-${Math.random().toString(36)}`);
  }
  if (data.length > 500_000) data.length = 0; // drop references

  logHeapStats();
  logSpaces();
}, 1000);

setTimeout(() => {
  clearInterval(interval);
  gcObserver.disconnect();
}, 10_000);
```

### GC-Friendly Coding Patterns

**1. Avoid mid-life objects** — objects that survive one scavenge but die shortly after promotion are the worst case. They cost a scavenge copy *and* a major GC mark-sweep.

```typescript
// BAD: response objects cached "just in case" for 30 seconds
const recentResponses = new Map<string, object>();
setTimeout(() => recentResponses.delete(key), 30_000); // promoted, then swept

// BETTER: use an LRU with a max size, or don't cache at all
```

**2. Reuse buffers and objects in hot paths:**

```typescript
// run: node --experimental-strip-types reuse-buffer.ts

// BAD — allocates a new Buffer every call
function encodePayloadBad(data: string): Buffer {
  return Buffer.from(data, 'utf-8');
}

// GOOD — reuse a pre-allocated buffer for fixed-size work
const sharedBuf = Buffer.alloc(4096);
function encodePayloadGood(data: string): number {
  return sharedBuf.write(data, 'utf-8'); // returns bytes written
}

console.log(encodePayloadGood('hello'));
```

**3. Flatten object graphs** — deeply nested structures with many pointers force the marker to chase more edges. Prefer flat arrays, TypedArrays, or Buffers for large datasets.

**4. Null out references explicitly** in long-lived scopes:

```typescript
// In a long-running handler that captures a large context
async function processJob(job: { payload: Buffer }): Promise<void> {
  const result = transform(job.payload);
  (job as { payload: Buffer | null }).payload = null; // free the 50 MB payload early
  await saveResult(result);
  // ... more work that doesn't need payload
}

function transform(buf: Buffer): string {
  return buf.toString('utf-8').toUpperCase();
}
async function saveResult(r: string): Promise<void> { /* ... */ }
```

**5. Prefer `Buffer.allocUnsafe()` for short-lived buffers** — avoids the cost of zero-filling when you will immediately overwrite the contents. But never send un-overwritten portions to clients (information leak risk).

### Forcing GC (Testing Only)

```typescript
// run: node --experimental-strip-types --expose-gc force-gc.ts
declare function gc(): void;

const before = process.memoryUsage().heapUsed;
gc(); // synchronous full GC
const after = process.memoryUsage().heapUsed;
console.log(`Freed: ${((before - after) / 1024 / 1024).toFixed(1)} MB`);
```

`--expose-gc` adds a global `gc()` function. Never use in production — it forces a full stop-the-world Mark-Compact. Useful for heap snapshot baselines and leak testing.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. p99 latency spikes from major GC pauses.**
Symptom: your monitoring shows p50 at 12 ms but p99 at 180 ms. Flame graphs and CPU profiles show no hot function — the pause is invisible to profilers because no JS runs during GC. Diagnosis: enable the `PerformanceObserver` for GC events and correlate GC pause timestamps with slow-request timestamps. Root cause: old-generation heap is 1.2 GB of live data; major GC must walk it all. Fix: reduce live heap (externalize caching to Redis), set `--max-old-space-size` lower to trigger smaller, more frequent collections, or split the workload across worker threads or pods.

**2. OOM kills in containers with no `--max-old-space-size`.**
Symptom: K8s pod shows `OOMKilled` with exit code 137. Node's default heap limit (~1.7 GB) plus native memory (Buffers, libuv handles, TLS contexts) exceeds the container's memory limit. The kernel kills the process before V8 even has a chance to GC. Fix: set `--max-old-space-size` to 75% of container memory and set K8s `resources.requests.memory` equal to `resources.limits.memory` to avoid eviction.

**3. Allocation tsunamis from JSON.parse / JSON.stringify on large payloads.**
Symptom: a single GraphQL query returns a 50 MB JSON response. `JSON.stringify` creates intermediate strings that double memory usage momentarily. If multiple such requests overlap, the heap spikes, triggering back-to-back major GCs or OOM. Fix: stream responses instead of buffering (`Transfer-Encoding: chunked`), paginate results, or use `JSON.stringify` replacer to prune unnecessary fields.

**4. Memory leak mistaken for "GC is slow."**
Symptom: GC pauses grow linearly over hours. `--trace-gc` shows `after_size` increasing on every major GC — meaning the collector is finding less and less to free. This is not a GC performance problem; it is a leak. The GC is working correctly — there is just nothing dead to collect. Common culprits: event listeners not removed, closures capturing request objects in long-lived maps, un-cleared `setInterval` handles. Diagnosis: take two heap snapshots 10 minutes apart and compare retained-size deltas by constructor name.
:::

## 🎯 Checkpoint

::: details Question 1 — Scavenge promotion
**Q:** An object survives its first scavenge cycle. What happens to it on the second scavenge, and why is this relevant to latency?

**A:** On the second scavenge, the object is **promoted** (copied) from young generation into old generation. This matters because old-gen objects are only freed by Mark-Sweep or Mark-Compact, which have significantly longer pauses. Objects that are allocated frequently but live just long enough to be promoted (so-called "mid-life" objects) are the worst case for GC latency — they incur the cost of both a scavenge copy and a later major GC cycle. Patterns like short TTL caches (5–30 seconds) often create mid-life objects. The fix is to either let objects die before promotion (keep them truly short-lived) or accept they are long-lived and size the heap accordingly.
:::

::: details Question 2 — Container memory sizing
**Q:** Your Node service runs in a K8s pod with `resources.limits.memory: 2Gi`. You set `--max-old-space-size=2048`. The pod gets OOMKilled after running under load for 20 minutes. Explain why.

**A:** `--max-old-space-size` controls only the V8 old-generation heap. Total process memory includes: young generation (~16 MB), code space, external/native memory (Buffers backed by C++ allocations, which live **outside** the V8 heap), libuv's thread pool stack allocations, TLS session caches, and the Node binary itself. With `--max-old-space-size=2048`, V8 alone can use up to 2 GB for old gen, and total process RSS will exceed the 2 GiB container limit. The kernel's OOM killer terminates the process (SIGKILL, exit code 137). The fix is to set `--max-old-space-size` to roughly 75% of container memory — in this case, ~1536 — leaving headroom for everything outside V8's managed heap.
:::

::: details Question 3 — Concurrent vs incremental marking
**Q:** V8 uses both incremental and concurrent marking for major GC. What is the difference between these two techniques, and why does V8 use both?

**A:** **Incremental marking** breaks the marking phase into small steps interleaved with JavaScript execution on the main thread. Instead of one long pause to mark the entire heap, V8 marks a few objects, yields to JS, marks more, and so on. This reduces maximum pause time but adds overhead from write barriers (V8 must track pointer changes JS makes between marking steps). **Concurrent marking** runs marking work on background helper threads simultaneously with JS execution on the main thread. This reduces main-thread pause time even further by offloading traversal to other CPU cores. V8 uses both because they solve different aspects of the problem: incremental marking handles the main-thread portion by splitting it into small chunks, while concurrent marking moves as much work as possible off the main thread entirely. The final "remark" step — where V8 must pause to process objects modified since the concurrent marker last saw them — is kept short because incremental marking has already handled most of the graph.
:::

## Key Mental Models

- **Young gen is cheap, old gen is expensive.** Design your allocation patterns so most objects die young and never get promoted.
- **GC pauses scale with live heap size, not total allocations.** Allocating millions of short-lived objects is fine; holding millions of live objects is what makes major GC slow.
- **Container memory != V8 heap.** Always leave 25% headroom between `--max-old-space-size` and the container memory limit for native allocations.
- **Rising `after_size` in `--trace-gc` means a leak, not slow GC.** The collector cannot free what your code still references.
- **Monitor GC with `PerformanceObserver`, not `--trace-gc` in production.** The observer gives you programmatic access to pause durations for alerting and dashboards.

## Related

- [Heap Snapshots & Leak Hunting](./02-heap-snapshots) — finding *what* is retained when GC cannot free enough
- [Memory & GC Fundamentals (JS Core)](/js-core/07-memory-gc) — the language-level view of V8's garbage collection
- [Blocking the Loop](/nodejs/module-02/03-blocking-the-loop) — GC pauses are one of the ways the loop gets blocked
