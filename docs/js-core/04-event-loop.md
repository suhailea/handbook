---
title: The Event Loop
outline: deep
---

# The Event Loop

🔥🔥🔥 **Interview weight:** asked in virtually every JS/Node interview | **Node >= 22** | **Prereqs:** [Execution Contexts, Scopes & Hoisting](./01-execution-contexts)

## 🗣️ In Plain English

::: tip In Plain English
Imagine a theme park with a single roller coaster and one operator. There is only one seat, so only one rider goes at a time. The operator follows a strict routine: load a rider from the regular queue, run the ride, then — before loading the next regular rider — check the VIP line. Every single VIP pass holder must ride before the operator even glances at the regular queue again.

That single operator is JavaScript's lone thread of execution. The ride is whatever code is running right now (a "task"). The regular queue is the macrotask queue — things like `setTimeout` callbacks, I/O completions, and click handlers waiting their turn. The VIP line is the microtask queue — promise callbacks and `queueMicrotask` calls that always jump ahead of regular riders.

Here is the critical rule: the VIP line must be fully emptied before the next regular rider boards. If a VIP rider hands out more VIP passes while on the ride, those new VIPs also go before any regular guest. In theory, if VIPs keep handing out passes indefinitely, regular guests wait forever. That is starvation, and it is a real production bug.

In the browser, there is an extra twist. Between rides, a painter comes out and touches up the park scenery — that is the browser's rendering step (layout, paint, composite). If a ride takes too long (a task runs longer than roughly 16 milliseconds), the painter has to wait, and visitors see choppy, janky animations. This is why long-running synchronous code causes the page to freeze.

Node.js has no painter, but it replaces the simple "regular queue" with a more sophisticated system of phases managed by a C library called libuv. The core VIP-before-regular rule is the same, but the regular queue is split into multiple lanes (timers, I/O, check, close, and so on) that the operator visits in a fixed order each lap around the park.

The event loop is the operator's routine — the algorithm that decides what runs next. Understanding it means you can predict the exact order any mix of synchronous code, promises, and timers will execute.
:::

## ⚙️ Under the Hood

### What problem the event loop solves

JavaScript is single-threaded: one call stack, one piece of code executing at a time. Without a concurrency mechanism, any I/O operation (network request, file read, timer) would block that thread and freeze everything else. The event loop solves this by offloading wait-time to the host environment (browser APIs or libuv) and scheduling callbacks to run when results are ready — all without spawning additional threads in user-land code.

### The core algorithm

At its simplest, the event loop repeats this cycle:

1. **Pick one task** from the macrotask queue (the oldest one).
2. **Execute it** to completion (run the call stack until it is empty).
3. **Drain the entire microtask queue** — run every microtask, including any new microtasks enqueued during this step.
4. **Optionally render** (browser only) — run `requestAnimationFrame` callbacks, recalculate styles, layout, paint.
5. **Go to step 1.**

### Browser event loop vs Node.js event loop

| Aspect | Browser | Node.js (libuv) |
|---|---|---|
| **Macrotask sources** | `setTimeout`, `setInterval`, UI events, `MessageChannel`, I/O | `setTimeout`, `setInterval`, `setImmediate`, I/O callbacks, close callbacks |
| **Microtask sources** | `Promise.then`, `queueMicrotask`, `MutationObserver` | `Promise.then`, `queueMicrotask`, `process.nextTick` (runs before other microtasks) |
| **Rendering step** | Yes — rAF, style, layout, paint interleaved between tasks | No rendering step |
| **Phase structure** | Single task queue + microtask queue | Six phases: timers -> pending -> idle/prepare -> poll -> check -> close; microtask queue drains **between every phase** |
| **Frame-aligned callback** | `requestAnimationFrame` (before repaint) | Not applicable; use `setImmediate` for "next iteration" semantics |
| **Microtask drain timing** | After each macrotask, before render | After each phase transition |

### Macrotasks vs microtasks

**Macrotasks** (also called "tasks"):
- `setTimeout`, `setInterval`
- `setImmediate` (Node.js only)
- I/O callbacks (network, file system)
- UI rendering events (browser)
- `MessageChannel.onmessage`

**Microtasks:**
- `Promise.then()` / `.catch()` / `.finally()` callbacks
- `queueMicrotask(fn)`
- `process.nextTick(fn)` (Node.js only — runs before all other microtasks)
- `MutationObserver` callbacks (browser only)

**The cardinal rule:** after each macrotask completes, the engine drains the entire microtask queue — including any microtasks added while draining — before picking the next macrotask.

```ts
// run: node --experimental-strip-types demo-macro-micro.ts

console.log("1 — synchronous (script start)");

setTimeout(() => {
  console.log("5 — macrotask (setTimeout)");
}, 0);

Promise.resolve().then(() => {
  console.log("3 — microtask (Promise.then)");
});

queueMicrotask(() => {
  console.log("4 — microtask (queueMicrotask)");
});

console.log("2 — synchronous (script end)");

// Output:
// 1 — synchronous (script start)
// 2 — synchronous (script end)
// 3 — microtask (Promise.then)
// 4 — microtask (queueMicrotask)
// 5 — macrotask (setTimeout)
```

**Why this order:** The entire `<script>` block is itself a macrotask. Synchronous lines (1, 2) run first. When the call stack empties, the microtask queue drains (3, 4). Only then does the next macrotask (5) execute.

### `process.nextTick` priority (Node.js)

In Node.js, `process.nextTick` callbacks form a separate queue that drains **before** the promise microtask queue. This means `nextTick` always beats `Promise.then`:

```ts
// run: node --experimental-strip-types demo-nexttick.ts

Promise.resolve().then(() => console.log("2 — Promise microtask"));
process.nextTick(() => console.log("1 — nextTick (runs first)"));

// Output:
// 1 — nextTick (runs first)
// 2 — Promise microtask
```

> **Node >= 11 behavior change:** Before Node 11, microtasks only drained between phases. From Node 11 onward, microtasks drain between every individual callback within a phase, aligning more closely with browser behavior.

### `requestAnimationFrame` timing (browser)

`requestAnimationFrame` (rAF) is neither a macrotask nor a microtask. It occupies its own slot in the browser event loop:

1. Macrotask executes
2. Microtask queue drains
3. **If the browser decides it is time to repaint (~60fps / every ~16.7ms):**
   - Run all queued `requestAnimationFrame` callbacks
   - Recalculate styles
   - Layout
   - Paint / composite

rAF callbacks run **before** the repaint, making them ideal for DOM mutations that need to be visually smooth. If the browser skips a frame (tab is hidden, or it has not been 16.7ms yet), rAF callbacks are deferred.

### How rendering interleaves with tasks (browser)

The browser targets 60 frames per second, which gives each frame a budget of roughly 16.7 milliseconds. If a single task (macrotask + its microtask drain) takes longer than that, the rendering step is delayed, and the user sees jank — stuttering animations, unresponsive scrolling, frozen UI.

```
Frame budget: |-------- 16.7ms --------|
Ideal:        [task][microtasks][render ][task][microtasks][render ]
Long task:    [=========== 50ms task ===========][render ][task]...
                                    ^ 2 frames missed = jank
```

Strategies to avoid this:
- Break large tasks with `setTimeout(fn, 0)` or `scheduler.postTask()` (Chromium)
- Use `requestIdleCallback` for non-urgent work
- Move heavy computation to a Web Worker

### Node.js libuv phase cycle (overview)

```
   ┌───────────────────────────┐
┌─>│        timers              │  ← setTimeout, setInterval callbacks
│  └───────────┬───────────────┘
│        [microtask drain]
│  ┌───────────┴───────────────┐
│  │     pending callbacks      │  ← system-level callbacks (TCP errors, etc.)
│  └───────────┬───────────────┘
│        [microtask drain]
│  ┌───────────┴───────────────┐
│  │     idle, prepare          │  ← internal use only
│  └───────────┬───────────────┘
│        [microtask drain]
│  ┌───────────┴───────────────┐
│  │         poll               │  ← retrieve new I/O events; execute I/O callbacks
│  └───────────┬───────────────┘
│        [microtask drain]
│  ┌───────────┴───────────────┐
│  │         check              │  ← setImmediate callbacks
│  └───────────┬───────────────┘
│        [microtask drain]
│  ┌───────────┴───────────────┐
│  │      close callbacks       │  ← socket.on('close', ...) etc.
│  └───────────┬───────────────┘
│        [microtask drain]
└──────────────┘
```

The deep dive into each phase, the poll phase's blocking behavior, and the libuv threadpool is covered in the [Node.js Track — libuv Phases](/nodejs/module-02/01-libuv-phases).

### Classic ordering puzzles

#### Puzzle 1 — setTimeout vs Promise vs sync

```ts
// run: node --experimental-strip-types puzzle1.ts

console.log("A");

setTimeout(() => console.log("B"), 0);

Promise.resolve()
  .then(() => console.log("C"))
  .then(() => console.log("D"));

console.log("E");
```

**Step-by-step:**

| Step | Action | Call stack | Microtask queue | Macrotask queue |
|------|--------|-----------|-----------------|-----------------|
| 1 | `console.log("A")` | `log("A")` | — | — |
| 2 | `setTimeout(cb, 0)` registers callback | — | — | `cb→log("B")` |
| 3 | `Promise.resolve().then(cb1)` enqueues microtask | — | `cb1→log("C")` | `cb→log("B")` |
| 4 | `console.log("E")` | `log("E")` | `cb1→log("C")` | `cb→log("B")` |
| 5 | Call stack empty → drain microtasks: run `cb1` → prints "C", `.then(cb2)` enqueues `cb2` | — | `cb2→log("D")` | `cb→log("B")` |
| 6 | Still draining: run `cb2` → prints "D" | — | — | `cb→log("B")` |
| 7 | Microtask queue empty → pick macrotask: run `cb` → prints "B" | — | — | — |

**Output:** `A E C D B`

#### Puzzle 2 — Node.js: nextTick vs setImmediate vs setTimeout

```ts
// run: node --experimental-strip-types puzzle2.ts

setTimeout(() => console.log("1 — setTimeout"), 0);
setImmediate(() => console.log("2 — setImmediate"));

process.nextTick(() => console.log("3 — nextTick"));
Promise.resolve().then(() => console.log("4 — Promise.then"));

console.log("5 — sync");
```

**Step-by-step:**
1. `setTimeout` registers a timer callback in the timers phase.
2. `setImmediate` registers a callback in the check phase.
3. `process.nextTick` enqueues in the nextTick queue.
4. `Promise.resolve().then` enqueues in the microtask queue.
5. `console.log("5 — sync")` runs immediately.
6. Call stack empty → drain nextTick queue: prints "3 — nextTick".
7. Drain promise microtasks: prints "4 — Promise.then".
8. The order of `setTimeout(0)` vs `setImmediate` from the main module is **non-deterministic** — it depends on how fast the event loop enters the timers phase relative to the 1ms timer minimum. Either "1" then "2" or "2" then "1".

**Guaranteed output:** `5 3 4` first, then `1` and `2` in either order.

> **Deterministic case:** Inside an I/O callback, `setImmediate` always fires before `setTimeout(fn, 0)` because the I/O callback runs in the poll phase, and check (setImmediate) comes before timers in the next iteration.

#### Puzzle 3 — Nested microtasks

```ts
// run: node --experimental-strip-types puzzle3.ts

console.log("start");

setTimeout(() => {
  console.log("timeout 1");
  Promise.resolve().then(() => console.log("promise inside timeout"));
}, 0);

Promise.resolve().then(() => {
  console.log("promise 1");
  queueMicrotask(() => console.log("nested microtask"));
});

setTimeout(() => console.log("timeout 2"), 0);

console.log("end");
```

**Output:** `start end promise 1 nested microtask timeout 1 promise inside timeout timeout 2`

**Key insight:** The nested microtask created inside "promise 1" runs immediately (still draining microtasks) before any macrotask. The promise inside "timeout 1" runs after "timeout 1" because each macrotask gets its own microtask drain.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Microtask starvation blocks the world**
**Symptom:** Server stops responding; health checks time out; no new connections are accepted.
**Root cause:** A recursive microtask loop (or a very long `.then()` chain generated in a loop) prevents the event loop from advancing to the next phase. Timers, I/O callbacks, and `setImmediate` never fire.
**Diagnosis:** Use `--prof` or `clinic flame` — you will see the microtask drain consuming 100% of the tick. Replace recursive microtask patterns with `setImmediate` or `setTimeout(fn, 0)` to yield back to the loop.

**2. `setTimeout(fn, 0)` is not actually 0ms**
**Symptom:** High-frequency timer-based code runs slower than expected.
**Root cause:** Browsers clamp nested `setTimeout` to a minimum of 4ms after 5 levels of nesting (HTML spec). Node.js clamps to 1ms internally. `setImmediate` (Node) or `MessageChannel` (browser) are faster alternatives for "run on the next turn."
**Diagnosis:** If you need sub-millisecond scheduling, use `setImmediate` in Node or `MessageChannel` in the browser.

**3. Long tasks cause UI jank (browser)**
**Symptom:** Animations stutter, input feels laggy, Lighthouse flags "Long Tasks."
**Root cause:** A single synchronous task exceeds the 16.7ms frame budget, blocking the rendering step.
**Diagnosis:** Use Chrome DevTools Performance tab — look for long yellow bars in the Main thread flame chart. Break the work into smaller chunks using `requestIdleCallback`, `scheduler.yield()` (Chrome 129+), or manual chunking with `setTimeout`.

**4. Unpredictable `setTimeout(0)` vs `setImmediate` ordering**
**Symptom:** Tests pass locally but fail in CI, or race conditions in initialization code.
**Root cause:** When called from the main module (not inside an I/O callback), their relative order depends on process performance and timer resolution. This is a known non-determinism in Node.js.
**Diagnosis:** Never depend on the relative ordering of `setTimeout(fn, 0)` and `setImmediate` from top-level code. If order matters, nest one inside an I/O callback or use only one mechanism.

:::

## 🎯 Checkpoint

::: details Question 1 — Microtask drain timing
**Q:** If a `.then()` callback enqueues another microtask via `queueMicrotask()`, when does that new microtask run — before or after the next macrotask?

**A:** Before the next macrotask. The microtask queue must be fully drained — including any microtasks added during the drain — before the event loop picks the next macrotask. The new microtask runs in the same drain cycle.
:::

::: details Question 2 — nextTick vs Promise.then
**Q:** In Node.js, which runs first: a `process.nextTick` callback or a `Promise.resolve().then()` callback, and why?

**A:** `process.nextTick` runs first. Node.js maintains a separate nextTick queue that is drained before the promise microtask queue. This is by design — `nextTick` was in Node before promises existed, and it retains its priority for backward compatibility. This is also why overusing `nextTick` can starve promise callbacks and I/O.
:::

::: details Question 3 — Browser rendering and macrotasks
**Q:** A single click handler runs for 80ms. How many frames does the browser miss, and what does the user experience?

**A:** At 60fps, each frame is ~16.7ms. An 80ms task blocks roughly 4–5 frames. The user experiences visible jank — animations freeze, scrolling stops, and the page feels unresponsive for that duration. The rendering step (rAF, style, layout, paint) cannot run until the task and its microtask drain complete.
:::

## Key Mental Models

- **Single-threaded, not single-tasked.** JavaScript uses one thread but achieves concurrency by interleaving small units of work via the event loop — not by running things in parallel.
- **Microtasks always cut the line.** After every macrotask, the entire microtask queue drains (including recursively added microtasks) before the next macrotask can run.
- **The browser's render step is a guest, not the host.** Rendering only happens when the event loop lets it — long tasks push it out, causing jank.
- **Node's loop is a phase wheel, not a simple queue.** libuv cycles through six phases in a fixed order, draining microtasks between each transition.
- **`process.nextTick` is the highest-priority microtask in Node.** It drains before promise microtasks, which makes it powerful but dangerous in large volumes.

## Related

- [libuv Phases](/nodejs/module-02/01-libuv-phases) — the Node-specific deep dive into each phase
- [nextTick vs queueMicrotask vs setImmediate](/nodejs/module-02/02-nexttick-vs-queuemicrotask) — when to use which
- [Promises & the Microtask Queue](./05-promises-microtasks) — next page in this track
- [Blocking the Loop](/nodejs/module-02/03-blocking-the-loop) — production patterns for keeping the loop healthy
