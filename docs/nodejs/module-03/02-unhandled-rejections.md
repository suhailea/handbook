---
title: Unhandled Rejections
outline: deep
---

# Unhandled Rejections

> **Interview weight:** 🔥🔥🔥 — Extremely common interview topic and the #1 cause of mysterious Node.js crashes in production.
> **Node version:** Default behavior changed in Node 15 (`--unhandled-rejections=throw`). All examples target Node 22+.
> **Prereqs:** [Promise Internals](./01-promise-internals) · [Process Lifecycle](/nodejs/module-01/02-process-lifecycle)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you mail a letter to a company and they promise to reply. If the reply is bad news — say, a rejection letter — and nobody is home to receive it, the post office has a problem. It can't just throw the letter away and pretend everything is fine. Someone needs to deal with it.

That's what an unhandled rejection is in Node.js. You kicked off an asynchronous operation (mailed the letter), it failed (rejection letter came back), but there was no `.catch()` or `try/catch` waiting to receive the bad news. The rejection just... floats in limbo.

Before Node 15, the post office would tape a passive-aggressive note to your door ("DeprecationWarning: Unhandled promise rejection") and walk away. Your process kept running, silently broken. Since Node 15, the post office kicks your door down — it crashes the process with an unhandled rejection error, the same way an uncaught exception would.

Here's the most devious version of this problem — the **parallel-start trap**. Imagine you ask two friends to run two errands for you simultaneously. You wait by the phone for Friend A's call. Meanwhile, Friend B finishes first with bad news and calls you — but you're on the line with Friend A and can't pick up. By the time you hang up with Friend A and try to call Friend B back, it's too late. The post office already came by.

In code, this happens when you start two promises in parallel but `await` them one at a time. The second promise can reject while you're still stuck waiting on the first, and nobody is listening. The fix is simple: use `Promise.all()` so you're waiting for both calls at the same time, ready to hear bad news from either one immediately.

Node gives you a last-resort safety net — the `unhandledRejection` event on the `process` object. Think of it as hiring a doorman who catches any rejection letters that would otherwise fall on the floor. But it's a safety net, not a strategy. The real fix is always to handle your rejections at the source.
:::

## ⚙️ Under the Hood

### The Behavior Change: Node 15+

Per the Node.js release notes, Node 15 changed the default value of `--unhandled-rejections` from `warn` to `throw`. This means an unhandled promise rejection now triggers the same process crash as an uncaught synchronous exception.

| Node Version | Default `--unhandled-rejections` | Behavior |
|---|---|---|
| < 15 | `warn` | Prints warning + deprecation notice. Process continues. |
| >= 15 | `throw` | Throws the rejection as an uncaught exception. Process exits with code 1. |

### The Detection Window

Node does not decide a rejection is "unhandled" the instant it happens. There is a **detection window** based on microtask draining:

1. A promise is rejected.
2. The engine checks whether any rejection handler (`.catch()`, `.then(_, onReject)`, or `await` in a `try/catch`) is attached to that promise.
3. This check happens **after the current microtask queue fully drains** — meaning you have until the end of the current microtask cycle to attach a handler.
4. If no handler is found by that point, the `unhandledRejection` event fires.

```typescript
// run: node --experimental-strip-types demo-detection-window.ts
// This is FINE — handler attached synchronously (same microtask context)
const p1 = Promise.reject(new Error("handled in time"));
p1.catch((err) => console.log("caught:", err.message));

// This is ALSO fine — .then() is synchronous attachment
const p2 = Promise.reject(new Error("also handled"));
p2.then(undefined, (err) => console.log("caught via .then:", err.message));

// This CRASHES — handler attached too late (setTimeout = macrotask = after drain)
// Uncomment to see the crash:
// const p3 = Promise.reject(new Error("too late"));
// setTimeout(() => p3.catch(() => {}), 0);  // handler arrives after detection window
```

### The `unhandledRejection` Event

The `process` object emits `unhandledRejection` when a rejected promise has no handler after the microtask queue drains. This is your last chance to log, report to an error tracker, or perform cleanup before the process terminates (under `throw` mode).

```typescript
// run: node --experimental-strip-types demo-unhandled-event.ts
process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  console.error("Unhandled rejection detected!");
  console.error("Reason:", reason);
  // In production: send to error tracking (Sentry, Datadog, etc.)
  // Then let the process crash — don't swallow it
});

// Deliberately create an unhandled rejection
Promise.reject(new Error("something broke"));

// Output:
// Unhandled rejection detected!
// Reason: Error: something broke
// (then the process crashes under default --unhandled-rejections=throw)
```

### The `rejectionHandled` Event

If a rejection was initially unhandled but a handler is attached *later* (in a subsequent macrotask), Node fires `rejectionHandled`. This is rare in practice but useful for tracking systems.

```typescript
// run: node --unhandled-rejections=warn --experimental-strip-types demo-rejection-handled.ts
// Using --unhandled-rejections=warn so the process doesn't crash before
// the late handler can attach

process.on("unhandledRejection", (reason: unknown) => {
  console.log("1. unhandledRejection:", (reason as Error).message);
});

process.on("rejectionHandled", (promise: Promise<unknown>) => {
  console.log("3. rejectionHandled — late handler attached");
});

const p = Promise.reject(new Error("initially unhandled"));

// Attach handler in a later macrotask
setTimeout(() => {
  p.catch((err) => {
    console.log("2. late catch:", err.message);
  });
}, 100);

// Output:
// 1. unhandledRejection: initially unhandled
// 2. late catch: initially unhandled
// 3. rejectionHandled — late handler attached
```

### The `--unhandled-rejections` Flag

Node supports four modes via the `--unhandled-rejections` CLI flag:

| Mode | Behavior | Use case |
|---|---|---|
| `throw` (default since Node 15) | Raises as uncaught exception → process crashes | Production: fail-fast, don't run in a broken state |
| `warn` | Prints warning to stderr, process continues | Migration: finding unhandled rejections without crashing |
| `strict` | Raises immediately, even if a handler is attached later | CI/testing: zero-tolerance for any gap in handling |
| `none` | Silently ignores unhandled rejections | Never use this in production |

```bash
# Examples
node --unhandled-rejections=throw app.js    # default, crash on unhandled
node --unhandled-rejections=warn app.js     # warn only, for migration
node --unhandled-rejections=strict app.js   # strictest: no grace period
```

### THE TRAP: Parallel-Start / Sequential-Await

This is the most common pattern that accidentally creates unhandled rejections, and it comes up in interviews constantly.

```typescript
// run: node --experimental-strip-types demo-the-trap.ts

async function fetchA(): Promise<string> {
  return new Promise((resolve) => setTimeout(() => resolve("A"), 200));
}

async function fetchB(): Promise<string> {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("B failed")), 50));
}

// DANGEROUS: parallel start, sequential await
async function dangerous(): Promise<void> {
  const a = fetchA();  // starts immediately
  const b = fetchB();  // starts immediately — rejects at t=50ms

  // At t=50ms, b rejects. But we're stuck awaiting a (which resolves at t=200ms).
  // For 150ms, b's rejection has no handler. Node sees it as unhandled.
  try {
    const resultA = await a;  // blocks here until t=200ms
    const resultB = await b;  // never reached if process crashes at t=50ms
    console.log(resultA, resultB);
  } catch (err) {
    console.error("caught:", (err as Error).message);
  }
}

// SAFE: use Promise.all — both rejections are caught immediately
async function safe(): Promise<void> {
  try {
    const [resultA, resultB] = await Promise.all([fetchA(), fetchB()]);
    console.log(resultA, resultB);
  } catch (err) {
    console.error("caught:", (err as Error).message);
  }
}

// Run the safe version
safe();
// Output: caught: B failed
```

The timeline of the dangerous version:

```
t=0ms:   fetchA() starts, fetchB() starts
t=50ms:  fetchB() rejects → NO handler attached (we're awaiting fetchA)
         → "unhandledRejection" fires → process crashes (Node 15+)
t=200ms: fetchA() resolves → would have awaited b, but we're already dead
```

### Other Patterns That Create Unhandled Rejections

**1. Fire-and-forget async calls**

```typescript
// run: node --experimental-strip-types demo-fire-and-forget.ts
async function logToAnalytics(event: string): Promise<void> {
  throw new Error(`analytics service down for: ${event}`);
}

function handleRequest(): void {
  // DANGEROUS: calling async function without awaiting or catching
  logToAnalytics("page_view");  // unhandled rejection!

  // FIX 1: catch inline
  logToAnalytics("page_view").catch((err) =>
    console.error("analytics failed:", err.message)
  );

  // FIX 2: if you truly don't care, make it explicit
  void logToAnalytics("page_view").catch(() => {});
}

handleRequest();
```

**2. Conditional await**

```typescript
// run: node --experimental-strip-types demo-conditional-await.ts
async function riskyConditional(shouldWait: boolean): Promise<void> {
  const work = Promise.reject(new Error("oops"));

  if (shouldWait) {
    try {
      await work;  // handled when shouldWait is true
    } catch {
      console.log("caught in conditional path");
    }
  }
  // When shouldWait is false, `work` is never awaited → unhandled rejection!
}

// FIX: always attach a handler regardless of the branch
async function safeConditional(shouldWait: boolean): Promise<void> {
  const work = Promise.reject(new Error("oops"));
  work.catch(() => {}); // safety net — prevents unhandled rejection

  if (shouldWait) {
    try {
      await work;
    } catch {
      console.log("caught in conditional path");
    }
  }
}

safeConditional(false);
```

**3. Error in `.then()` handler without downstream `.catch()`**

```typescript
// run: node --experimental-strip-types demo-then-error.ts
// The original promise is handled, but the NEW promise from .then() is not
const p = Promise.resolve("data");

p.then((data) => {
  // This throws, creating a rejected promise from .then()
  // But nobody catches THAT promise
  JSON.parse("{invalid json" + data);
});

// FIX: always terminate chains with .catch()
p.then((data) => JSON.parse("{invalid json" + data))
  .catch((err) => console.error("parse failed:", err.message));
```

### Production Hardening Pattern

A robust Node.js application installs the `unhandledRejection` handler as a safety net, but treats any invocation as a bug to be fixed — not a normal error-handling path.

```typescript
// run: node --experimental-strip-types demo-hardening.ts
import { stderr } from "node:process";

// Last-resort handler — log and let the process crash
process.on("unhandledRejection", (reason: unknown) => {
  stderr.write(`FATAL: Unhandled rejection\n`);
  stderr.write(`${reason instanceof Error ? reason.stack : String(reason)}\n`);
  // In production, flush to your error tracker here (Sentry, etc.)
  // Then exit — don't try to keep running in an unknown state
  process.exitCode = 1;
});

// Also handle uncaught exceptions for symmetry
process.on("uncaughtException", (err: Error) => {
  stderr.write(`FATAL: Uncaught exception\n${err.stack}\n`);
  process.exitCode = 1;
});

console.log("Process hardening installed");
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. The parallel-start crash at scale**
**Symptom:** A Node service crashes intermittently under load with `UnhandledPromiseRejection`. Stack traces point to promise rejections from downstream services, but the calling code appears to have `try/catch`.
**Root cause:** The code starts multiple async calls, then `await`s them sequentially. Under load, the second call fails before the first returns, creating a window where the rejection is unhandled. This is timing-dependent, making it hard to reproduce locally.
**Diagnosis:** Search for the pattern `const a = asyncFn(); const b = asyncFn(); await a; await b;` — replace with `await Promise.all([a, b])`.

**2. Graceful shutdown blocked by unhandled rejection**
**Symptom:** A service receives SIGTERM, starts graceful shutdown, then abruptly crashes with an unhandled rejection error instead of draining connections cleanly.
**Root cause:** During shutdown, in-flight requests start failing (database connections closing, etc.). Fire-and-forget async operations that previously succeeded now reject with no handler.
**Diagnosis:** Audit all fire-and-forget async calls. Add `.catch()` handlers or stop initiating new work once shutdown begins.

**3. Error tracking noise from `rejectionHandled`**
**Symptom:** Error tracker shows unhandled rejections that were actually handled — false positives flooding your alerts.
**Root cause:** A late-attached handler (e.g., in a `setTimeout` or a subsequent event-loop tick) handles the rejection after the `unhandledRejection` event already fired. Without tracking the `rejectionHandled` event, your monitoring can't reconcile these.
**Diagnosis:** If you must support late handling (not recommended), track both events with a `Map<Promise, Error>` and remove entries when `rejectionHandled` fires.

:::

## 🎯 Checkpoint

::: details Question 1 — Detection window
**Q:** A promise rejects at time T. You attach a `.catch()` handler in a `queueMicrotask()` callback. Will Node detect this as an unhandled rejection?

**A:** No — it will be caught in time. The `.catch()` is attached via `queueMicrotask`, which is a microtask. Node's detection window extends until the microtask queue fully drains. Since the `queueMicrotask` callback runs as part of that same microtask drain cycle, the handler is attached before Node checks for unhandled rejections. However, attaching in a `setTimeout` (macrotask) would be too late.
:::

::: details Question 2 — The trap
**Q:** Explain why the following code can crash in Node 22, even though every `await` is inside a `try/catch`:
```typescript
async function run() {
  try {
    const a = slowFetch();
    const b = fastFetch(); // rejects quickly
    const ra = await a;
    const rb = await b;
    return [ra, rb];
  } catch (err) {
    console.error(err);
  }
}
```

**A:** `fastFetch()` starts immediately and may reject before `slowFetch()` resolves. While the code is blocked on `await a`, the rejection from `b` has no handler attached — the `await b` line hasn't been reached yet, and the `try/catch` only covers the `await` expressions, not the bare promises. Node's microtask-based detection sees the unhandled rejection and crashes the process before `await b` is ever executed. The fix is `await Promise.all([a, b])`, which attaches handlers to both promises immediately.
:::

::: details Question 3 — Flag behavior
**Q:** What is the difference between `--unhandled-rejections=throw` and `--unhandled-rejections=strict`?

**A:** Both cause the process to crash, but they differ in the grace period. `throw` (the default since Node 15) allows a brief detection window — the microtask queue drains before checking for handlers. `strict` is zero-tolerance: even if a handler would have been attached later (via `rejectionHandled`), `strict` mode still throws. It treats any rejection that was ever momentarily unhandled as fatal.
:::

## Key Mental Models

- **Unhandled = nobody listening when the microtask queue drains.** You have until the microtask queue finishes — attach a handler before then, and you're safe.
- **Parallel start demands `Promise.all`.** If you start N async operations concurrently, you must await them concurrently too — sequential `await` creates rejection windows.
- **Fire-and-forget is a loaded gun.** Every async function call that isn't awaited or `.catch()`-ed is a potential unhandled rejection waiting to happen.
- **The `unhandledRejection` event is a safety net, not a strategy.** Use it for logging and crash reporting, not as a primary error-handling mechanism.
- **Since Node 15, unhandled rejections kill.** Treat them with the same urgency as uncaught exceptions — they are equally fatal.

## Related

- [Promise Internals](./01-promise-internals)
- [Error Doctrine](./06-error-doctrine)
- [Process Lifecycle](/nodejs/module-01/02-process-lifecycle)
- [Promises & Microtasks (JS Core)](/js-core/05-promises-microtasks)
