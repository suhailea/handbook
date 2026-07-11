---
title: "nextTick vs queueMicrotask vs setImmediate"
outline: deep
---

# nextTick vs queueMicrotask vs setImmediate

🔥🔥🔥 **Interview weight:** classic interview question | **Node 22+** | **Prereqs:** [libuv Phases](./01-libuv-phases)

## 🗣️ In Plain English

::: tip In Plain English
You are standing in a busy restaurant kitchen. You have just handed the head chef three notes, each with a different urgency level.

The first note is a **`process.nextTick`** — you staple it to the chef's forehead. Whatever the chef is doing right now, the moment the current dish leaves the pass, the chef reads that note before looking at anything else. Even if the waiters are screaming, even if the oven timer is beeping, the chef reads your forehead note first. And if that note says "read the next note stapled to your forehead," the chef will keep reading forehead notes forever and never serve another table. That is the starvation problem.

The second note is a **`queueMicrotask`** (or a `Promise.then`). You pin it to the chef's apron, right below the forehead notes. After all forehead notes are read, the chef reads all apron notes before turning back to the kitchen stations. Forehead notes always beat apron notes, but both are processed before the chef walks to the next station.

The third note is a **`setImmediate`**. You tack it to the bulletin board at the **check station** in the kitchen loop. The chef will not see it until the tram completes the poll station and arrives at check. It is not urgent — it is "do this on the next convenient pass through the check station."

And then there is **`setTimeout(fn, 0)`**, which you pin to the **timers station** bulletin board. The chef will see it when the tram passes through timers, but because the minimum timer delay is 1 ms, and because the loop may have already passed timers before your note was pinned, the timing is slightly unpredictable relative to `setImmediate`.

The key insight: `nextTick` and `queueMicrotask` are not event loop phases. They are express lanes that drain between phases. `setImmediate` and `setTimeout` are actual phase-bound callbacks. This distinction explains every ordering question you will ever encounter.

One more wrinkle: `process.nextTick` is Node-specific. It does not exist in browsers. `queueMicrotask` is part of the web standard and works everywhere. If you are writing new code, the Node.js team recommends `queueMicrotask` over `process.nextTick` in most cases.
:::

## ⚙️ Under the Hood

### The Four Scheduling Mechanisms

| Mechanism | Queue | When It Runs | Spec |
|---|---|---|---|
| `process.nextTick(fn)` | nextTick queue (Node-internal) | After current operation, before microtasks | Node-only |
| `queueMicrotask(fn)` | Microtask queue | After nextTick queue drains | WHATWG standard |
| `Promise.resolve().then(fn)` | Microtask queue (same as above) | After nextTick queue drains | ECMAScript |
| `setImmediate(fn)` | Check phase queue | Check phase of the event loop | Node-only (not in browsers) |
| `setTimeout(fn, 0)` | Timers phase queue (clamped to 1 ms) | Timers phase of the event loop | WHATWG / ECMAScript |

### Why `process.nextTick` Runs Before Microtasks

This is a historical design decision, not a specification requirement. When `process.nextTick` was created, the microtask queue (and promises) did not exist yet. It was Node's original mechanism for "run this callback as soon as the current synchronous code finishes."

Internally, Node maintains **two separate queues** that drain in the microtask flush:

1. **The nextTick queue** — drained completely first
2. **The promise microtask queue** — drained completely second

Per the Node.js source code (in `src/env.cc`), the `InternalCallbackScope::Close()` method calls `DrainNextTickQueue()` before `DrainMicrotaskQueue()`. This is the implementation detail that guarantees the ordering.

### The Complete Ordering — Demonstrated

```typescript
// run: node --experimental-strip-types complete-ordering.ts

console.log("1: synchronous start");

setTimeout(() => console.log("2: setTimeout"), 0);

setImmediate(() => console.log("3: setImmediate"));

Promise.resolve().then(() => console.log("4: Promise.then"));

queueMicrotask(() => console.log("5: queueMicrotask"));

process.nextTick(() => console.log("6: nextTick"));

console.log("7: synchronous end");
```

**Output:**

```
1: synchronous start
7: synchronous end
6: nextTick
4: Promise.then
5: queueMicrotask
2: setTimeout        ← or 3: setImmediate (non-deterministic at top level)
3: setImmediate      ← or 2: setTimeout
```

**Step-by-step breakdown:**

1. `"1: synchronous start"` — synchronous, runs immediately.
2. `setTimeout` — schedules a callback in the timers phase queue (1 ms minimum delay).
3. `setImmediate` — schedules a callback in the check phase queue.
4. `Promise.resolve().then` — enqueues onto the microtask queue.
5. `queueMicrotask` — enqueues onto the same microtask queue (after the promise callback, because it was called after).
6. `process.nextTick` — enqueues onto the nextTick queue.
7. `"7: synchronous end"` — synchronous, runs immediately.
8. Call stack is now empty. Node drains the nextTick queue: `"6: nextTick"`.
9. Node drains the microtask queue in FIFO order: `"4: Promise.then"`, then `"5: queueMicrotask"`.
10. The event loop begins. `setTimeout` and `setImmediate` race — order depends on loop startup timing.

Note that `Promise.then` and `queueMicrotask` share the same queue. Their relative order is simply the order in which they were enqueued (FIFO).

### Starvation: The `process.nextTick` Trap

```typescript
// run: node --experimental-strip-types starvation.ts
// WARNING: this will hang — kill with Ctrl+C

import { createServer } from "node:http";

const server = createServer((_req, res) => {
  res.end("hello");
});

server.listen(3000, () => {
  console.log("Server listening on :3000");

  // Simulate a recursive nextTick — I/O is starved
  let count = 0;
  function recursiveNextTick(): void {
    count++;
    if (count % 1_000_000 === 0) {
      console.log(`nextTick count: ${count} — server is unreachable`);
    }
    process.nextTick(recursiveNextTick);
  }

  recursiveNextTick();
});
```

This server will bind to port 3000 and print that it is listening, but **no HTTP request will ever be served**. The nextTick queue never empties because each callback enqueues another. The event loop never advances past the microtask drain to reach the poll phase where I/O events are processed.

The same starvation applies to recursive `queueMicrotask`, but `process.nextTick` starvation is more dangerous because it also blocks promise resolution.

### `setImmediate` vs `setTimeout(fn, 0)` — The I/O Context Rule

This is the most commonly asked interview question about these APIs.

**Rule:** Inside an I/O callback, `setImmediate` always fires before `setTimeout(fn, 0)`. At the top level, the order is non-deterministic.

**Why:** When an I/O callback runs, we are in the **poll phase**. After poll, the loop enters the **check phase** (`setImmediate`), then **close callbacks**, then loops back to **timers** (`setTimeout`). So `setImmediate` is always one phase away, while `setTimeout` is several phases away.

At the top level, the script runs during the initial module evaluation before the event loop is properly spinning. Whether the loop reaches timers or check first depends on process startup timing and the 1 ms timer clamp.

```typescript
// run: node --experimental-strip-types io-context-rule.ts

import { readFile } from "node:fs";

// Case 1: Top-level — non-deterministic
console.log("--- Top level ---");
setTimeout(() => console.log("top: setTimeout"), 0);
setImmediate(() => console.log("top: setImmediate"));

// Case 2: Inside I/O — deterministic
readFile(import.meta.filename, () => {
  console.log("--- Inside I/O callback ---");
  setTimeout(() => console.log("io: setTimeout"), 0);
  setImmediate(() => console.log("io: setImmediate"));
});
```

**Output:**

```
--- Top level ---
top: setTimeout          ← or setImmediate (varies between runs)
top: setImmediate        ← or setTimeout
--- Inside I/O callback ---
io: setImmediate         ← always first
io: setTimeout           ← always second
```

### Nested Microtasks — Drain Order Deep Dive

```typescript
// run: node --experimental-strip-types nested-microtasks.ts

process.nextTick(() => {
  console.log("1: nextTick");
  Promise.resolve().then(() => console.log("2: promise inside nextTick"));
  process.nextTick(() => console.log("3: nested nextTick"));
});

Promise.resolve().then(() => {
  console.log("4: promise");
  process.nextTick(() => console.log("5: nextTick inside promise"));
});

queueMicrotask(() => {
  console.log("6: queueMicrotask");
});
```

**Output:**

```
1: nextTick
3: nested nextTick
2: promise inside nextTick
4: promise
6: queueMicrotask
5: nextTick inside promise
```

**Why this order:**

1. `"1: nextTick"` — nextTick queue drains first.
2. `"3: nested nextTick"` — the nested `process.nextTick` was added to the nextTick queue during step 1. The nextTick queue must fully drain before moving to microtasks, so it runs now.
3. `"2: promise inside nextTick"` — the promise enqueued in step 1 is now in the microtask queue. With the nextTick queue empty, microtasks drain.
4. `"4: promise"` — the original promise callback, also in the microtask queue (FIFO after the one from step 3).
5. `"6: queueMicrotask"` — also in the microtask queue, enqueued after the promise.
6. `"5: nextTick inside promise"` — the `nextTick` enqueued during step 4. After the current microtask batch, Node checks the nextTick queue again before continuing.

### When to Use Which

| Use case | Mechanism | Why |
|---|---|---|
| Emit event after constructor returns (so listeners can attach) | `process.nextTick` | Must run before any I/O and before any promise handlers |
| Standard "run after current task" behavior | `queueMicrotask` | Spec-compliant, works in browsers, no starvation of promise queue |
| Yield to I/O, then continue processing | `setImmediate` | Runs after poll phase — allows pending I/O to be processed first |
| Break up CPU-intensive work | `setImmediate` | Each iteration yields to I/O between chunks |
| "Run as soon as possible" | `queueMicrotask` | **Not** `setTimeout(fn, 0)` — that has a 1 ms minimum delay |
| Polyfill or legacy code | `process.nextTick` | Existing codebases rely on it; do not refactor without understanding callers |

### Node.js Team Recommendations (per the official docs)

> "We recommend developers use `setImmediate()` in all cases because it is easier to reason about." — Node.js docs, Event Loop guide

> "Use `queueMicrotask()` instead of `process.nextTick()` for new code." — Node.js docs, process.nextTick section

The reasoning: `process.nextTick` is too powerful. It runs before all other async work, and recursive usage can starve the entire event loop. `queueMicrotask` provides the same "run after current synchronous code" semantics without the footgun of starving the promise queue, and it is a web standard.

### Historical Naming Confusion

The names are backwards from what you would expect:

- **`process.nextTick`** does **not** run on the "next tick" of the event loop. It runs **immediately** after the current operation completes, before the event loop continues. A more accurate name would have been `process.runImmediately`.
- **`setImmediate`** does **not** run "immediately." It runs on the **next iteration** of the event loop, in the check phase. A more accurate name would have been `setNextTick`.

This naming confusion is acknowledged in the Node.js documentation. The names are frozen for backward compatibility.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Recursive `nextTick` starvation in event emitters**
**Symptom:** server handles the first few requests, then stops responding entirely. CPU is pegged at 100%.
**Root cause:** a library (or your own code) recursively calls `process.nextTick` inside an event handler. Common in poorly written stream transforms where each chunk triggers a `nextTick` that triggers another.
**Diagnosis:** use `--prof` to generate a V8 CPU profile. Look for `_tickCallback` or `processTicksAndRejections` dominating the profile. The fix is to replace `process.nextTick` with `setImmediate` to yield to I/O between iterations.

**2. Non-deterministic test failures from `setTimeout` vs `setImmediate` ordering**
**Symptom:** tests pass locally on macOS but fail in CI on Linux (or vice versa), with assertion errors about callback order.
**Root cause:** test code schedules both `setTimeout(fn, 0)` and `setImmediate(fn)` at the top level and asserts a specific order. The order is genuinely non-deterministic outside I/O callbacks.
**Diagnosis:** wrap the scheduling calls inside an I/O callback (e.g., `fs.readFile` or `setImmediate` itself) to get deterministic ordering, or do not assert on relative order.

**3. `queueMicrotask` error swallowing**
**Symptom:** errors thrown inside `queueMicrotask` callbacks crash the process with no useful stack trace.
**Root cause:** unlike `process.nextTick`, `queueMicrotask` does not integrate with Node's domain error handling or `async_hooks` context in the same way. Exceptions in microtasks become uncaught exceptions.
**Diagnosis:** always wrap `queueMicrotask` callback bodies in try/catch if the surrounding code needs graceful error handling. Better yet, use promises and `.catch()`.

:::

## 🎯 Checkpoint

::: details Question 1 — Ordering Prediction
**Q:** Predict the output order:
```typescript
process.nextTick(() => console.log("A"));
Promise.resolve().then(() => console.log("B"));
queueMicrotask(() => console.log("C"));
setImmediate(() => console.log("D"));
setTimeout(() => console.log("E"), 0);
console.log("F");
```

**A:** The output is:
```
F
A
B
C
D or E (non-deterministic)
E or D
```
`F` is synchronous. `A` runs first because the nextTick queue drains before the microtask queue. `B` and `C` are in the same microtask queue in FIFO order. `D` (check phase) and `E` (timers phase) are in separate event loop phases and their top-level ordering is non-deterministic.
:::

::: details Question 2 — Starvation Diagnosis
**Q:** You have a Node.js HTTP server that stops responding to requests after exactly 60 seconds of uptime. CPU is at 100%. A colleague added a "keepalive" mechanism that calls `process.nextTick` recursively. Is this the likely cause, and why?

**A:** Yes. Recursive `process.nextTick` prevents the event loop from ever reaching the poll phase where incoming HTTP connections are accepted. The nextTick queue never empties because each callback enqueues another. The 60-second mark is likely when the recursive chain starts (perhaps triggered by a timer or a delayed initialization). The fix is to replace `process.nextTick` with `setImmediate`, which schedules in the check phase and allows the poll phase to process I/O between callbacks.
:::

::: details Question 3 — When to Choose Which
**Q:** You are writing a constructor for an `EventEmitter` subclass. After construction, the instance should emit a `"ready"` event so that callers can do `const obj = new MyEmitter(); obj.on("ready", handler)`. Which scheduling mechanism should you use to emit the event, and why?

**A:** Use `process.nextTick(() => this.emit("ready"))`. The event must fire after the constructor returns (so the caller has a chance to attach listeners), but before any I/O or other async work occurs. `process.nextTick` guarantees execution before microtasks and before any event loop phase, which means the listener attached on the very next line of synchronous code will be in place when the event fires. `queueMicrotask` would also work in most cases, but `process.nextTick` is the established pattern for this use case in the Node.js ecosystem (used in core streams, `net.Socket`, etc.).
:::

## Key Mental Models

- **nextTick is the VIP of VIPs:** it drains before promises, before microtasks, before everything except synchronous code. This power is also its danger.
- **queueMicrotask is the modern nextTick:** same "run after current code" semantics, but spec-compliant and less likely to starve the event loop since it does not block promise resolution.
- **setImmediate means "after I/O":** it yields to the poll phase first, making it the right tool for breaking up CPU work without starving network and file system operations.
- **setTimeout(fn, 0) is not "immediate":** the 1 ms clamp and its position in the timers phase make it the slowest of all four options for running code "soon."
- **Inside I/O, the order is deterministic:** `setImmediate` always beats `setTimeout(fn, 0)` when called from within a poll-phase callback. Outside I/O, do not depend on the order.

## Related

- [libuv Phases](./01-libuv-phases)
- [Blocking the Loop](./03-blocking-the-loop)
- [Promise Internals](/nodejs/module-03/01-promise-internals)
- [Promises & Microtasks (JS Core)](/js-core/05-promises-microtasks)
