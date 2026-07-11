---
title: "AbortController & AbortSignal"
outline: deep
---

# AbortController & AbortSignal

| Interview weight | Node version | Prerequisites |
|---|---|---|
| 🔥🔥 | `AbortController` global since Node 15; `AbortSignal.timeout` since 17.3; `AbortSignal.any` since 20 | [Promise Internals](./01-promise-internals) |

## 🗣️ In Plain English

::: tip In Plain English
Imagine you are sitting at a restaurant and you place an order. The kitchen starts cooking. A minute later you change your mind -- you want to cancel. You press a cancel button on the table. But here is the catch: pressing the button does not teleport the food out of the pan. All it does is turn on a small red lamp visible from the kitchen. If the chef is well-trained, they glance at the lamp between every step -- chopping, searing, plating -- and if they see it lit up, they stop and toss the dish. If the chef never looks at the lamp, your food still arrives even though you cancelled.

That is exactly how `AbortController` works. You, the caller, hold the controller -- that is your cancel button. The function doing work only receives the signal -- the lamp. It is a read-only object. Pressing the button (`controller.abort()`) lights the lamp (`signal.aborted` becomes `true`), and any code that was listening for the `'abort'` event gets notified.

This is called **cooperative cancellation**. The button is useless unless the worker agrees to check it. The good news is that most built-in Node APIs -- `fetch`, timers, file system reads, streams -- already know how to watch the lamp. When they see it light up, they reject their promise with an `AbortError` and clean up resources.

You can also wire up automatic timeouts. `AbortSignal.timeout(5000)` creates a lamp that lights itself after five seconds -- no button needed. And `AbortSignal.any([signal1, signal2])` creates a lamp that lights up when any one of several lamps lights up, so you can combine a user-cancel signal with a timeout signal into a single signal you hand to a worker.

The most important thing to remember: the controller is for the code that decides when to cancel. The signal is for the code that does the work. Never hand the controller to the worker -- they should not be able to cancel themselves.
:::

## ⚙️ Under the Hood

### The Controller + Signal Pair

`AbortController` is a simple class. Constructing one gives you a `.signal` property (an `AbortSignal`) and an `.abort(reason?)` method. Calling `.abort()` sets `signal.aborted = true`, assigns `signal.reason`, and dispatches the `'abort'` event on the signal. It is a one-shot operation -- once aborted, the signal stays aborted forever.

```ts
// run: node --experimental-strip-types demo-basic.ts

const controller = new AbortController();
const { signal } = controller;

console.log(signal.aborted); // false

signal.addEventListener('abort', () => {
  console.log('Aborted! Reason:', signal.reason);
});

controller.abort('User changed their mind');

console.log(signal.aborted); // true
console.log(signal.reason);  // "User changed their mind"
```

When you call `.abort()` with no argument, the reason defaults to a `DOMException` with name `"AbortError"`. When you pass a string or custom error, that becomes the reason verbatim.

### AbortSignal.timeout(ms) -- Node 17.3+

Creates a signal that auto-aborts after the given number of milliseconds. The reason is a `DOMException` with name `"TimeoutError"`, not `"AbortError"` -- this distinction matters when you catch errors.

```ts
// run: node --experimental-strip-types demo-timeout.ts

import { setTimeout as sleep } from 'node:timers/promises';

const signal = AbortSignal.timeout(100);

try {
  await sleep(5000, undefined, { signal });
} catch (err: unknown) {
  if (err instanceof DOMException) {
    console.log(err.name);    // "TimeoutError"
    console.log(err.message); // "The operation was aborted due to timeout"
  }
}
```

### AbortSignal.any(signals) -- Node 20+

Creates a composite signal that aborts when **any** of the input signals aborts. The reason is taken from whichever signal fired first. This is ideal for combining a per-request timeout with a server-shutdown signal.

```ts
// run: node --experimental-strip-types demo-any.ts

const shutdownController = new AbortController();
const requestTimeout = AbortSignal.timeout(5000);

// Aborts if EITHER the server shuts down OR 5 seconds pass
const combined = AbortSignal.any([shutdownController.signal, requestTimeout]);

combined.addEventListener('abort', () => {
  console.log('Combined signal aborted. Reason:', combined.reason);
});

// Simulate server shutdown after 100ms
setTimeout(() => shutdownController.abort('SIGTERM received'), 100);
```

### Node APIs That Accept AbortSignal

| API | Module | Notes |
|---|---|---|
| `fetch(url, { signal })` | global | Rejects with `AbortError` |
| `setTimeout(ms, val, { signal })` | `node:timers/promises` | Rejects with `AbortError` |
| `fs.readFile(path, { signal })` | `node:fs/promises` | Node 16+ |
| `stream.pipeline(…, { signal })` | `node:stream/promises` | Destroys streams on abort |
| `EventEmitter.on(emitter, event, { signal })` | `node:events` | Stops async iterator |
| `readline.createInterface({ signal })` | `node:readline` | Closes interface on abort |
| `new Response(body, { signal })` | global (Fetch API) | Node 20+ |

### Building a Custom Cancellable Operation

When you write your own async function, you need to manually cooperate with the signal. There are two patterns: **poll** (check `signal.aborted` at safe points) and **listen** (attach an `'abort'` event listener to trigger cleanup).

```ts
// run: node --experimental-strip-types demo-custom.ts

async function processItems(
  items: string[],
  signal?: AbortSignal
): Promise<string[]> {
  const results: string[] = [];

  for (const item of items) {
    // Poll pattern: check before each unit of work
    if (signal?.aborted) {
      throw signal.reason;
    }

    // Simulate async work
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => resolve(), 50);

      // Listen pattern: cancel in-flight work immediately
      signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      }, { once: true });
    });

    results.push(`done:${item}`);
  }

  return results;
}

const controller = new AbortController();
setTimeout(() => controller.abort('Too slow'), 120);

try {
  const result = await processItems(['a', 'b', 'c', 'd', 'e'], controller.signal);
  console.log(result);
} catch (err) {
  console.log('Cancelled after partial work:', err);
}
```

### Listener Cleanup and Memory Leaks

Every `signal.addEventListener('abort', fn)` registers a listener. If you create thousands of short-lived operations that each attach a listener to a long-lived signal (like a server-shutdown signal), and those operations complete before the signal fires, the listeners pile up.

Three defenses:

1. **`{ once: true }`** -- removes the listener after it fires, but does **not** help if the signal never fires.
2. **`removeEventListener`** -- manually remove when the operation completes.
3. **Nested `AbortSignal.any`** -- create a short-lived combined signal per operation so listeners attach to the short-lived signal, not the long-lived one.

```ts
// run: node --experimental-strip-types demo-cleanup.ts

async function fetchWithCleanup(url: string, parentSignal: AbortSignal): Promise<string> {
  // Create a per-request controller so we can clean up
  const localController = new AbortController();
  const combined = AbortSignal.any([parentSignal, localController.signal]);

  try {
    const res = await fetch(url, { signal: combined });
    return await res.text();
  } finally {
    // Abort the local controller to detach any internal listeners
    localController.abort();
  }
}

const shutdown = new AbortController();
try {
  const html = await fetchWithCleanup('https://example.com', shutdown.signal);
  console.log('Fetched', html.length, 'bytes');
} catch {
  console.log('Request failed or was cancelled');
}
```

### AbortError vs TimeoutError

| Source | `reason` type | `reason.name` |
|---|---|---|
| `controller.abort()` (no arg) | `DOMException` | `"AbortError"` |
| `controller.abort(new Error('x'))` | `Error` | `"Error"` |
| `AbortSignal.timeout(ms)` | `DOMException` | `"TimeoutError"` |

This distinction lets you differentiate between explicit cancellation and a timeout expiry in your catch blocks:

```ts
// run: node --experimental-strip-types demo-error-types.ts

import { setTimeout as sleep } from 'node:timers/promises';

try {
  await sleep(10_000, undefined, { signal: AbortSignal.timeout(50) });
} catch (err: unknown) {
  if (err instanceof DOMException && err.name === 'TimeoutError') {
    console.log('Timed out -- consider retrying');
  } else if (err instanceof DOMException && err.name === 'AbortError') {
    console.log('Explicitly cancelled -- do not retry');
  } else {
    throw err;
  }
}
```

### Cascading Cancellation Across Services

A common pattern in microservices: an incoming HTTP request gets an abort signal. Every downstream call (database query, external API, cache lookup) should share that signal so that if the client disconnects, all in-flight work stops.

```ts
// run: node --experimental-strip-types demo-cascade.ts

async function handleRequest(incomingSignal: AbortSignal): Promise<string> {
  // All downstream calls share the same signal
  const [user, orders] = await Promise.all([
    fetchUser('u-123', incomingSignal),
    fetchOrders('u-123', incomingSignal),
  ]);

  return JSON.stringify({ user, orders });
}

async function fetchUser(id: string, signal: AbortSignal): Promise<object> {
  signal.throwIfAborted(); // Node 17.2+ — throws immediately if already aborted
  // simulate work
  return { id, name: 'Alice' };
}

async function fetchOrders(userId: string, signal: AbortSignal): Promise<object[]> {
  signal.throwIfAborted();
  return [{ orderId: 'o-1', userId }];
}

const controller = new AbortController();
const result = await handleRequest(controller.signal);
console.log(result);
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Listener leaks on long-lived signals.**
**Symptom:** Memory usage climbs steadily; `process.memoryUsage().heapUsed` grows without bound.
**Root cause:** Thousands of per-request operations each attach a listener to a server-level shutdown signal. The operations complete, but listeners are never removed because the signal never fires.
**Diagnosis:** Use `getEventListeners(signal, 'abort').length` or the `--max-listeners` warning. Fix with `AbortSignal.any` to isolate per-request listeners.

**2. Forgetting that cancellation is cooperative.**
**Symptom:** You abort a controller, but the operation still completes and its side effects still happen.
**Root cause:** The function you called does not check the signal. Custom code must explicitly poll `signal.aborted` or listen for `'abort'`.
**Diagnosis:** Audit the function. If it is your code, add signal checks between each unit of work.

**3. Confusing AbortError and TimeoutError.**
**Symptom:** Your retry logic retries timed-out requests but also retries user-cancelled requests, wasting resources.
**Root cause:** Catching all `DOMException` without checking `.name`. `AbortSignal.timeout` produces `"TimeoutError"`, not `"AbortError"`.
**Diagnosis:** Always check `err.name` in your catch block, not just `instanceof DOMException`.

**4. Aborting after resolution.**
**Symptom:** Calling `controller.abort()` after the operation already resolved throws an unhandled error in some custom implementations.
**Root cause:** Your `'abort'` listener calls `reject()` on an already-resolved promise, or performs cleanup that is no longer valid.
**Diagnosis:** Guard your listener with a `completed` flag or use `{ once: true }` combined with removing the listener on success.
:::

## 🎯 Checkpoint

::: details Question 1 — Signal vs Controller
**Q:** Why should you never pass the `AbortController` to the function doing the work? Why only the `AbortSignal`?

**A:** The controller has the `.abort()` method -- it is the write side. The function doing work should only be able to observe cancellation, not trigger it. Passing the controller would let the worker cancel its own caller's broader operation, violating separation of concerns. The signal is the read-only side: it exposes `.aborted`, `.reason`, and the `'abort'` event, which is all a worker needs.
:::

::: details Question 2 — timeout vs abort
**Q:** You use `AbortSignal.timeout(3000)` with `fetch`. The request takes 5 seconds. What error do you catch, and how does it differ from calling `controller.abort()`?

**A:** `AbortSignal.timeout` produces a `DOMException` with `.name === "TimeoutError"`. Calling `controller.abort()` with no argument produces a `DOMException` with `.name === "AbortError"`. Both cause `fetch` to reject, but the error names differ, allowing you to distinguish between "timed out, maybe retry" and "explicitly cancelled, do not retry."
:::

::: details Question 3 — AbortSignal.any composition
**Q:** You have a server-shutdown signal and a per-request timeout signal. How do you combine them so a `fetch` call is cancelled by whichever fires first? What Node version is required?

**A:** Use `AbortSignal.any([shutdownSignal, AbortSignal.timeout(ms)])` to create a composite signal. Pass this composite to `fetch`. It aborts when either input signal aborts, carrying the reason from whichever fired first. This API requires Node 20+.
:::

## Key Mental Models

- **Controller = write side, Signal = read side.** Never hand the controller to the worker; hand only the signal.
- **Cooperative, not preemptive.** Aborting a signal does nothing unless the receiving code explicitly checks it -- that is the contract.
- **`timeout` gives `TimeoutError`, `abort()` gives `AbortError`.** Always check `.name` when distinguishing cancellation reasons.
- **`AbortSignal.any` is your composition primitive.** Combine per-request timeouts with server-shutdown signals into a single signal.
- **Listener hygiene prevents leaks.** Use `{ once: true }`, `removeEventListener`, or scoped signals via `AbortSignal.any` to avoid piling listeners on long-lived signals.

## Related

- [Promise Internals](./01-promise-internals)
- [Async Iteration vs EventEmitter](./04-async-iteration-vs-eventemitter)
- [Timeouts & Slowloris](/nodejs/module-05/03-timeouts-slowloris)
- [SSE & LLM Token Streaming](/nodejs/module-04/04-sse-streaming)
