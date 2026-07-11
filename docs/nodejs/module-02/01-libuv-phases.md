---
title: libuv Phases
outline: deep
---

# libuv Phases

🔥🔥🔥 **Interview weight:** the #1 most-asked Node.js interview topic | **Node 22+** | **Prereqs:** [What Node Actually Is](/nodejs/module-01/01-what-node-is)

## 🗣️ In Plain English

::: tip In Plain English
Imagine a theme park with exactly six ride stations arranged in a circle. A single tram (the event loop) drives around this circle forever, stopping at each station in the same fixed order. At each station, the tram picks up every passenger who is ready and waiting, drops them off at the ride, waits until they are done, and then moves on to the next station. It never skips a station and it never reverses direction.

The six stations are: **Timers**, **Pending Callbacks**, **Idle/Prepare**, **Poll**, **Check**, and **Close Callbacks**. Most of the action happens at the **Poll** station — that is where the park's main attraction lives. When the tram arrives at Poll, it checks whether any new visitors have shown up at the park gates (new I/O events from the operating system). If visitors are waiting, the tram processes them immediately. If nobody is there, the tram idles at Poll, engine running, waiting for someone to arrive — but it keeps one eye on its watch, because it knows exactly when the next visitor is due at the Timers station. The moment that deadline is close, the tram drives on to complete the loop and circle back to Timers.

Here is the critical detail that trips people up: **between every single station**, the tram pulls over and empties a special express lane — the microtask queue. Passengers in this lane (promises and `process.nextTick` callbacks) always get processed before the tram moves to the next station. They are VIP pass holders who cut the line between every ride. If one VIP keeps inviting more VIPs, the tram never reaches the next station, and the park grinds to a halt.

Once the tram has completed all six stations plus the express-lane stops in between, that is one **tick** of the event loop. Then the tram starts the circle again. If no passengers remain at any station and no one is expected, the tram shuts off its engine and the park closes (`process.exit`).

This is all libuv does: it drives the tram. V8 runs the JavaScript at each station, but libuv decides when and where to stop.
:::

## ⚙️ Under the Hood

### The Phase Cycle

libuv implements the event loop as a fixed-order sequence of six phases. Each phase has a FIFO queue of callbacks to execute. When the loop enters a phase, it drains that queue (up to a system-dependent hard cap to prevent starvation), then moves to the next phase.

```
    ┌─────────────────────────────────────────────────┐
    │                                                 │
    │  ┌───────────────────────────────────────────┐  │
    │  │           ⏱️  TIMERS                      │  │
    │  │   setTimeout / setInterval callbacks      │  │
    │  └──────────────────┬────────────────────────┘  │
    │    ── nextTick + microtask drain ──              │
    │  ┌──────────────────▼────────────────────────┐  │
    │  │       📬  PENDING CALLBACKS               │  │
    │  │   Deferred I/O callbacks (TCP errors)     │  │
    │  └──────────────────┬────────────────────────┘  │
    │    ── nextTick + microtask drain ──              │
    │  ┌──────────────────▼────────────────────────┐  │
    │  │       🔧  IDLE / PREPARE                  │  │
    │  │   Internal libuv housekeeping             │  │
    │  └──────────────────┬────────────────────────┘  │
    │    ── nextTick + microtask drain ──              │
    │  ┌──────────────────▼────────────────────────┐  │
    │  │       📡  POLL  (the big one)             │  │
    │  │   Retrieve I/O events from OS kernel      │  │
    │  │   Execute I/O callbacks                   │  │
    │  │   May block here waiting for I/O          │  │
    │  └──────────────────┬────────────────────────┘  │
    │    ── nextTick + microtask drain ──              │
    │  ┌──────────────────▼────────────────────────┐  │
    │  │       ✅  CHECK                           │  │
    │  │   setImmediate callbacks                  │  │
    │  └──────────────────┬────────────────────────┘  │
    │    ── nextTick + microtask drain ──              │
    │  ┌──────────────────▼────────────────────────┐  │
    │  │       🚪  CLOSE CALLBACKS                 │  │
    │  │   socket.on('close') and similar          │  │
    │  └──────────────────┬────────────────────────┘  │
    │    ── nextTick + microtask drain ──              │
    │                     │                           │
    │                     └───────── loop ─────────►  │
    │                                                 │
    └─────────────────────────────────────────────────┘
```

### Phase-by-Phase Breakdown

| Phase | What Executes | Key Details |
|---|---|---|
| **Timers** | `setTimeout` and `setInterval` callbacks whose delay has elapsed | Timers are **not precise**. A `setTimeout(fn, 100)` means "run `fn` no sooner than 100 ms from now." The actual delay depends on OS scheduling and what else is on the queue. |
| **Pending Callbacks** | I/O callbacks deferred from the previous iteration (e.g., `ECONNREFUSED` TCP errors) | Most developers never interact with this directly. It exists so that certain system-level I/O error callbacks do not block the poll phase. |
| **Idle / Prepare** | Internal libuv bookkeeping | Not exposed to JavaScript. libuv uses this for internal prepare handles. You cannot schedule work here from user code. |
| **Poll** | New I/O event callbacks (file reads, network responses, etc.) | The **most important phase**. This is where the loop spends most of its time. Two responsibilities: (1) calculate how long it should block waiting for I/O, and (2) process events in the poll queue. |
| **Check** | `setImmediate` callbacks | Exists specifically so that code can run immediately after poll completes, before the loop circles back to timers. |
| **Close Callbacks** | Close event handlers (`socket.on('close', ...)`, `server.on('close', ...)`) | Cleanup phase. If a handle is closed via `.close()`, its callback fires here. |

### How the Poll Phase Decides to Block

The poll phase uses a calculated timeout to decide how long to wait for new I/O:

1. **If the `setImmediate` queue is non-empty:** poll timeout is **0** (do not block — proceed to check phase immediately).
2. **If timers are scheduled:** poll timeout is `min(nextTimerDeadline - now, hardCap)`. The loop must wake up in time to fire the timer.
3. **If neither timers nor setImmediate are pending:** poll blocks **indefinitely**, waiting for I/O events from the kernel.

This is why a Node.js process with only a listening HTTP server does not consume CPU while idle — it is parked in the poll phase, waiting on epoll/kqueue.

### libuv and the OS Kernel

libuv is a C library that abstracts OS-level I/O notification mechanisms:

| OS | Mechanism | Used by libuv for |
|---|---|---|
| Linux | `epoll` | Scalable I/O event notification |
| macOS / BSD | `kqueue` | Kernel event notification |
| Windows | IOCP (I/O Completion Ports) | Async I/O completion |

All three are **readiness-based** (or completion-based for IOCP) notification systems. Instead of the process constantly checking "is this socket readable yet?", the kernel tells libuv when data arrives. This is why Node.js can handle thousands of concurrent connections on a single thread — it never blocks waiting for any one of them.

### Timer Coalescing and Resolution

libuv coalesces timer wakeups to reduce the number of times the loop must wake from its poll-phase sleep. The minimum timer resolution is **1 ms** on most platforms. A `setTimeout(fn, 0)` is internally clamped to `setTimeout(fn, 1)` per the HTML spec (and Node follows the same convention). This means `setTimeout(fn, 0)` and `setTimeout(fn, 1)` are functionally identical.

Timer storage uses a **min-heap** data structure, so finding the next timer to fire is O(log n), not O(n).

### Microtask Draining Between Phases

Since Node 11, the microtask queue drains **between every phase** (and after every individual callback within a phase, matching browser behavior). Before Node 11, microtasks drained only between phases, not between individual callbacks. This was a source of subtle bugs when porting browser code to Node.

The drain order within the microtask flush is:

1. **`process.nextTick` queue** — drained completely first
2. **Microtask queue** (`Promise.then`, `queueMicrotask`) — drained completely second

If a `nextTick` callback enqueues another `nextTick`, it is processed in the same flush. This is the starvation risk.

### Ordering Puzzle

```typescript
// run: node --experimental-strip-types ordering-puzzle.ts

setTimeout(() => console.log("1: setTimeout"), 0);

setImmediate(() => console.log("2: setImmediate"));

Promise.resolve().then(() => console.log("3: Promise.then"));

process.nextTick(() => console.log("4: nextTick"));

console.log("5: synchronous");
```

**Output (deterministic):**

```
5: synchronous
4: nextTick
3: Promise.then
1: setTimeout        ← or 2: setImmediate first (non-deterministic at top level)
2: setImmediate      ← or 1: setTimeout first
```

**Step-by-step explanation:**

1. `"5: synchronous"` prints first — it is synchronous code executing in the current call stack.
2. After the synchronous code completes, Node drains the microtask queues before entering any event loop phase.
3. `"4: nextTick"` prints next — `process.nextTick` has its own queue that drains before the standard microtask queue.
4. `"3: Promise.then"` prints next — the standard microtask queue drains after the nextTick queue.
5. `"1: setTimeout"` and `"2: setImmediate"` — at the top level (outside an I/O callback), the order between these two is **non-deterministic**. It depends on how quickly the event loop initializes and whether the 1 ms timer threshold has already elapsed by the time the loop reaches the timers phase. Inside an I/O callback, `setImmediate` always fires before `setTimeout(fn, 0)` because check comes right after poll.

### Demonstrating the I/O Context Difference

```typescript
// run: node --experimental-strip-types io-context.ts

import { readFile } from "node:fs";

// Top level: order is non-deterministic
setTimeout(() => console.log("top-level: setTimeout"), 0);
setImmediate(() => console.log("top-level: setImmediate"));

// Inside I/O callback: setImmediate always first
readFile(import.meta.filename, () => {
  setTimeout(() => console.log("I/O: setTimeout"), 0);
  setImmediate(() => console.log("I/O: setImmediate"));
});
```

**Output (the I/O section is deterministic):**

```
top-level: setTimeout   ← or setImmediate (non-deterministic)
top-level: setImmediate ← or setTimeout
I/O: setImmediate       ← always first (check phase follows poll)
I/O: setTimeout         ← always second (timers phase is next loop)
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. "My timers are late"**
**Symptom:** `setTimeout(fn, 50)` consistently fires at 200+ ms.
**Root cause:** a synchronous operation or a dense microtask loop is blocking the event loop, preventing it from reaching the timers phase on time. The timer callback cannot fire until the loop arrives at the timers phase and the call stack is empty.
**Diagnosis:** use `monitorEventLoopDelay` from `node:perf_hooks` to measure event loop lag. Any p99 value significantly above your timer interval confirms the loop is being starved.

**2. "My server stops accepting connections"**
**Symptom:** health checks time out; the process is alive but unresponsive.
**Root cause:** recursive `process.nextTick` or an unbounded microtask loop prevents the loop from ever reaching the poll phase. No I/O events are processed.
**Diagnosis:** take a CPU profile. If nearly 100% of time is in `_tickCallback` or `runMicrotasks`, you have a microtask starvation problem.

**3. "setImmediate and setTimeout order keeps changing"**
**Symptom:** tests pass locally, fail in CI (or vice versa), due to different execution order of `setTimeout(fn, 0)` vs `setImmediate`.
**Root cause:** at the top level (outside I/O callbacks), the order is genuinely non-deterministic. It depends on process startup time and timer resolution.
**Diagnosis:** move the code inside an I/O callback for deterministic ordering, or do not depend on relative ordering between these two at the top level.

**4. "DNS lookups block the loop"**
**Symptom:** event loop lag spikes correlate with DNS resolution.
**Root cause:** `dns.lookup()` (the default used by `http.request`) delegates to the libuv thread pool, not the kernel's async resolver. If all thread pool threads are busy with other work (e.g., `fs` operations), DNS resolution is queued.
**Diagnosis:** increase `UV_THREADPOOL_SIZE` (default is 4, max is 1024) or switch to `dns.resolve()` which uses c-ares and does not consume thread pool threads.

:::

## 🎯 Checkpoint

::: details Question 1 — Phase Ordering
**Q:** A `readFile` callback runs in the poll phase. Inside that callback, you call `setImmediate(fn)` and `setTimeout(fn, 0)`. Which fires first and why?

**A:** `setImmediate` fires first. When the poll phase finishes executing the I/O callback, the loop advances to the **check** phase (where `setImmediate` callbacks run) before looping back to the **timers** phase (where `setTimeout` callbacks run). This ordering is deterministic when called from within an I/O callback.
:::

::: details Question 2 — Microtask Drain Points
**Q:** Before Node 11, microtasks drained once between phases. Since Node 11, when do they drain?

**A:** Since Node 11, microtasks drain **after every individual callback** within a phase, not just between phases. This was changed to match browser behavior. For example, if the timers phase has three `setTimeout` callbacks queued, microtasks are drained after each one, not just once after all three have run.
:::

::: details Question 3 — Poll Phase Blocking
**Q:** A Node.js process has a single `setInterval` running every 500 ms and a TCP server listening on port 3000. No requests are arriving. Where does the loop spend most of its time, and for how long does it block?

**A:** The loop spends most of its time **blocked in the poll phase**, waiting for I/O events on the TCP server socket. It blocks for at most **~500 ms** (the time until the next `setInterval` deadline). When the deadline approaches, the poll phase unblocks, the loop cycles through check and close, and arrives at the timers phase to fire the interval callback. Then it returns to poll and blocks again.
:::

## Key Mental Models

- **Fixed order, always forward:** the loop visits the six phases in the same order every time — it never skips, reverses, or reorders them.
- **Poll is home base:** the loop spends most of its idle time parked in the poll phase, waking only when I/O arrives or a timer deadline approaches.
- **Microtasks are the VIP lane:** `process.nextTick` and promise callbacks drain between every phase and after every callback — they always cut the line.
- **Timers are lower bounds, not guarantees:** `setTimeout(fn, 100)` means "at least 100 ms," never "exactly 100 ms."
- **libuv is the scheduler, V8 is the executor:** libuv decides when to call your JavaScript; V8 runs it. They are two separate components collaborating on a single thread.

## Related

- [nextTick vs queueMicrotask vs setImmediate](./02-nexttick-vs-queuemicrotask)
- [Blocking the Loop](./03-blocking-the-loop)
- [The Event Loop (JS Core)](/js-core/04-event-loop)
- [What Node Actually Is](/nodejs/module-01/01-what-node-is)
