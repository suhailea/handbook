---
title: "Heap Snapshots & Leak Hunting"
outline: deep
---

# Heap Snapshots & Leak Hunting

> **Interview weight:** High -- memory leaks are one of the most common production Node.js issues. Interviewers expect you to describe a systematic approach to finding and fixing them.
> **Node version notes:** `v8.writeHeapSnapshot()` available since Node 12. `v8.getHeapSnapshot()` returns a Readable stream. Examples target Node 22+.
> **Prerequisites:** [What Node Actually Is](/nodejs/module-01/01-what-node-is), [Memory & GC (JS Core)](/js-core/07-memory-gc).

## 🗣️ In Plain English

::: tip In Plain English
Think of your application's memory as a storage unit you are renting. Every time your code creates an object, array, or string, it puts a box in the storage unit. The garbage collector is a cleaning crew that comes by periodically and removes boxes that nobody needs anymore -- boxes that no label points to.

A memory leak happens when boxes keep piling up but the cleaning crew cannot remove them because *something* still holds a label pointing to each one. Maybe you forgot to cancel a subscription, or an old event listener is still attached, or a cache keeps growing without a size limit. The storage unit fills up, the rent goes up (more RAM consumed), and eventually you run out of space entirely (an out-of-memory crash).

A **heap snapshot** is a photograph of every box in the storage unit at one instant. It shows you what each box contains, how big it is, and -- critically -- what labels point to it (its "retainers"). If you take two photographs five minutes apart, you can compare them: "These 50,000 new boxes appeared between photo 1 and photo 2, and they are all being held by this one growing array."

That comparison technique is the core of leak hunting. You take snapshot A when the app is fresh, run it under load for a while, take snapshot B, and look for objects that grew significantly. The **retainer tree** in Chrome DevTools traces back from a leaked object to the root reference that is keeping it alive. Once you find the root, you know what to fix: clear the cache, remove the listener, break the closure.

The key insight is that you do not need to find every object -- you need to find the **retainers** that prevent garbage collection. Fix the retainer, and the cleaning crew handles the rest.
:::

## ⚙️ Under the Hood

### Taking a Heap Snapshot

The simplest method is the built-in `v8` module:

```typescript
// run: node --expose-gc heap-snapshot-demo.ts
import { writeHeapSnapshot } from 'node:v8';

// Force GC before snapshot so we only see live objects
globalThis.gc!();

const snapshotPath: string = writeHeapSnapshot();
console.log(`Heap snapshot written to: ${snapshotPath}`);
// Output: Heap snapshot written to: Heap.20260711.143022.12345.0.001.heapsnapshot
```

For programmatic control (e.g., triggered by an API endpoint):

```typescript
// run: node heap-snapshot-server.ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { writeHeapSnapshot } from 'node:v8';
import { getHeapStatistics } from 'node:v8';

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/debug/heap-snapshot') {
    // Guard this endpoint in production!
    const path = writeHeapSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path }));
    return;
  }

  if (req.url === '/debug/heap-stats') {
    const stats = getHeapStatistics();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));
    return;
  }

  res.writeHead(200);
  res.end('OK');
});

server.listen(3000, () => console.log('Listening on :3000'));
```

### Reading Snapshots in Chrome DevTools

1. Open Chrome DevTools > Memory tab.
2. Click **Load** and select the `.heapsnapshot` file.
3. Use these views:

| View | Purpose |
|------|---------|
| **Summary** | Objects grouped by constructor name. Shows count, shallow size, retained size. |
| **Comparison** | Load two snapshots and see what was allocated between them. The leak hunting power tool. |
| **Containment** | The object graph from the GC roots down. Shows what owns what. |
| **Statistics** | Pie chart of memory by category (code, strings, arrays, etc.). |

Key columns in the Summary view:

- **Shallow size** -- memory the object itself uses (not including objects it references).
- **Retained size** -- memory that would be freed if this object were garbage collected (includes everything it exclusively retains).
- **Distance** -- number of edges from GC root. High distance objects are deeply nested and harder to reach.

### The Three-Snapshot Technique

The most reliable leak-hunting workflow:

```typescript
// run: node --expose-gc three-snapshot-leak.ts
import { writeHeapSnapshot } from 'node:v8';

// Simulated leak: event listeners that are never removed
import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();
emitter.setMaxListeners(Infinity); // suppress warning (bad in prod!)

const leakedData: Map<number, Buffer> = new Map();

function simulateWork(requestId: number): void {
  // Leak 1: Growing map without eviction
  leakedData.set(requestId, Buffer.alloc(1024, 'x'));

  // Leak 2: Listener added but never removed
  emitter.on('tick', () => {
    void leakedData.get(requestId);
  });
}

// Snapshot 1: Baseline
globalThis.gc!();
const snap1 = writeHeapSnapshot();
console.log(`Snapshot 1 (baseline): ${snap1}`);

// Simulate 1000 requests
for (let i = 0; i < 1000; i++) simulateWork(i);

// Snapshot 2: After work
globalThis.gc!();
const snap2 = writeHeapSnapshot();
console.log(`Snapshot 2 (after 1000 requests): ${snap2}`);

// Simulate 1000 more requests
for (let i = 1000; i < 2000; i++) simulateWork(i);

// Snapshot 3: More growth confirms the leak
globalThis.gc!();
const snap3 = writeHeapSnapshot();
console.log(`Snapshot 3 (after 2000 requests): ${snap3}`);

console.log('Load all three in DevTools > Memory > Comparison view');
console.log('Compare snap2 vs snap1, then snap3 vs snap2');
console.log('Objects that grow proportionally between both comparisons are leaks');
```

**Why three snapshots?** Snapshot 1 establishes a baseline. Comparing 2 vs. 1 shows allocations, but some may be one-time initialization. If the same object types also grow between snapshot 3 vs. 2 at a similar rate, that is a confirmed leak -- not just startup cost.

### Retainer Trees

When you find a suspicious object in the comparison view, right-click and select **"Show in Containment view"** or look at the **Retainers** panel at the bottom. The retainer tree shows the chain of references from a GC root to your object:

```
GC Root
  └─ global
       └─ leakedData (Map)
            └─ Map entry [key: 1500]
                 └─ Buffer (1024 bytes)  ← the leaked object
```

The retainer closest to the root is usually the one you need to fix. In this case, `leakedData` is the root cause -- a Map that grows without bounds.

### Common Leak Patterns

```typescript
// run: node common-leaks.ts

// ────────────────────────────────────────────
// LEAK 1: Unbounded cache
// ────────────────────────────────────────────
const cache = new Map<string, object>();

function getCached(key: string): object {
  if (!cache.has(key)) {
    cache.set(key, { data: Buffer.alloc(4096) });
  }
  return cache.get(key)!;
}
// Fix: Use an LRU cache with a max size, or WeakRef + FinalizationRegistry

// ────────────────────────────────────────────
// LEAK 2: Event listeners never removed
// ────────────────────────────────────────────
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();

function handleRequest(reqId: number): void {
  const handler = () => console.log(`Processing ${reqId}`);
  bus.on('process', handler);
  // Missing: bus.off('process', handler) when done
}
// Fix: Use AbortSignal, or { once: true }, or explicitly removeListener

// ────────────────────────────────────────────
// LEAK 3: Closures capturing large scope
// ────────────────────────────────────────────
function processLargePayload(payload: Buffer): () => number {
  // This closure captures the entire `payload` even though
  // it only needs the length
  return () => payload.length;
  // Fix: extract what you need before closing over it:
  // const len = payload.length;
  // return () => len;
}

// ────────────────────────────────────────────
// LEAK 4: Timers holding references
// ────────────────────────────────────────────
function startPolling(resource: { data: Buffer }): void {
  setInterval(() => {
    // `resource` is captured and can never be GC'd
    // even if the caller has moved on
    console.log(resource.data.length);
  }, 1000);
  // Fix: store the interval ID and call clearInterval when done
}
```

### Automated Leak Detection

For CI pipelines or production monitoring:

```typescript
// run: node --expose-gc automated-leak-check.ts
import { getHeapStatistics } from 'node:v8';

function checkForLeaks(
  label: string,
  heapBefore: number,
  heapAfter: number,
  thresholdMB: number = 50
): void {
  const grewByMB = (heapAfter - heapBefore) / 1024 / 1024;
  if (grewByMB > thresholdMB) {
    console.error(
      `[LEAK WARNING] ${label}: heap grew by ${grewByMB.toFixed(1)}MB ` +
      `(threshold: ${thresholdMB}MB)`
    );
    process.exitCode = 1;
  } else {
    console.log(`[OK] ${label}: heap grew by ${grewByMB.toFixed(1)}MB`);
  }
}

// Simulate a test run
globalThis.gc!();
const before = getHeapStatistics().used_heap_size;

// ... run your test suite or load test here ...
const arr: number[] = [];
for (let i = 0; i < 100_000; i++) arr.push(i);

globalThis.gc!();
const after = getHeapStatistics().used_heap_size;

checkForLeaks('post-test-suite', before, after, 10);
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

### 1. Heap Snapshot Freezes the Process

**Symptom:** You trigger `writeHeapSnapshot()` on a production server with a 2GB heap. The process becomes unresponsive for 5-30 seconds. Health checks fail. The load balancer removes the node from rotation.

**Root cause:** Taking a heap snapshot requires V8 to walk the entire object graph. This is a stop-the-world operation -- no JavaScript executes while the snapshot is being written. Larger heaps take longer.

**Fix:** Never take snapshots on servers currently serving traffic. Instead: (1) Drain the instance first (remove from load balancer). (2) Use `getHeapStatistics()` for lightweight monitoring -- it does not freeze the process. (3) If you must snapshot under load, use the inspector protocol to stream the snapshot incrementally, which reduces peak latency.

### 2. The Leak Is in Native Code

**Symptom:** `process.memoryUsage().rss` keeps growing, but `heapUsed` stays flat. Heap snapshots show nothing unusual.

**Root cause:** The leak is in native memory -- C++ addon allocations, `Buffer.alloc` backed by external memory, or libuv handles that are not being closed. V8's heap snapshot only covers the JS heap, not native allocations.

**Fix:** Use `process.memoryUsage()` to compare `rss` vs `heapUsed`. If `rss` grows but `heapUsed` does not, the leak is native. Use `valgrind` or `AddressSanitizer` on the native addon, or check for unclosed sockets/handles with `process._getActiveHandles()` and `process._getActiveRequests()`.

### 3. WeakRef Does Not Prevent All Leaks

**Symptom:** You replaced a `Map` cache with `WeakRef`-based entries, but memory still grows.

**Root cause:** `WeakRef` only works if the *target* has no other strong references. If the cached value is also referenced from another data structure (e.g., an active session object), the `WeakRef` target stays alive. Also, `WeakRef` targets are only collected during full GC, not during minor (Scavenge) collections, so memory may stay elevated longer than expected.

**Fix:** Audit all references to cached values. Use `FinalizationRegistry` to log when objects are collected, verifying that cleanup actually happens. Consider an LRU cache with explicit eviction as a more predictable alternative.

:::

## 🎯 Checkpoint

::: details Question 1 -- Shallow vs. retained size
**Q:** An object has a shallow size of 64 bytes but a retained size of 12 MB. What does that tell you about this object?

**A:** The object itself (its own fields, internal V8 overhead) is only 64 bytes. But it *exclusively* retains references to other objects totaling 12 MB. If this object were garbage collected, 12 MB would be freed. This pattern is typical of container objects like a Map, Set, or array that holds many large entries. The container shell is small; the contents are huge. If this object is a leak, fixing the single retainer path to it frees the entire 12 MB.
:::

::: details Question 2 -- Why three snapshots?
**Q:** Why is the three-snapshot technique more reliable than comparing just two snapshots?

**A:** Two snapshots can show false positives. Between snapshot 1 (startup) and snapshot 2 (after load), you see many new allocations -- but some are **one-time initialization** (module caches, JIT-compiled code, connection pools). These are not leaks; they are expected growth that stabilizes. By taking a third snapshot after more load and comparing snapshot 3 vs. snapshot 2, you isolate objects that grow **continuously and proportionally** to workload. If the same object type grows by 1000 entries between both comparison pairs, that is a confirmed leak. One-time costs will not appear in the second comparison.
:::

::: details Question 3 -- RSS vs. heapUsed
**Q:** `process.memoryUsage()` shows `heapUsed: 150MB` but `rss: 800MB`. Where is the other 650 MB?

**A:** RSS (Resident Set Size) includes everything the OS has paged into physical memory for this process: (1) V8's heap total (which includes reserved but unused heap space beyond `heapUsed`), (2) V8's code space (compiled machine code from JIT), (3) native allocations from C++ addons and Node internals, (4) `Buffer` instances allocated outside the V8 heap (`arrayBuffers` in `memoryUsage()`), (5) libuv's internal structures, (6) shared libraries (OpenSSL, ICU, zlib). Check `memoryUsage().arrayBuffers` for Buffer-related memory. The gap between `heapTotal` and `heapUsed` is V8's reserved but unused heap. Large RSS-to-heap ratios are common in apps that use many Buffers (file I/O, streaming, crypto).
:::

## Key Mental Models

- **Snapshots are photographs, not videos:** They show the state at one instant. The comparison technique (before/after/after-again) turns static photos into a story about what is growing.
- **Find the retainer, not the object:** The leaked object is a symptom. The retainer (the reference that prevents GC) is the cause. The retainer tree in DevTools is the most important panel.
- **Heap snapshots are expensive:** They freeze the process proportional to heap size. Use `getHeapStatistics()` for monitoring and snapshots only for diagnosis.
- **Not all memory is on the heap:** Buffers, native addons, and libuv structures live outside V8's heap. RSS growth without heap growth points to native-memory issues.

## Related

- [CPU Profiling](./01-cpu-profiling) -- profiling CPU instead of memory.
- [Memory & GC (JS Core)](/js-core/07-memory-gc) -- how JavaScript garbage collection works at the language level.
