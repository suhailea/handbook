---
title: Promises & the Microtask Queue
outline: deep
---

# Promises & the Microtask Queue

🔥🔥🔥 **Interview weight:** asked in virtually every JS/Node interview | **Node >= 22** | **Prereqs:** [The Event Loop](./04-event-loop)

## 🗣️ In Plain English

::: tip In Plain English
Think of a promise as an IOU from a restaurant kitchen. You walk up to the counter, place an order for a burger, and the cashier hands you a numbered ticket. That ticket is your promise. Right now it says "pending" — the kitchen has not finished your order yet.

Eventually one of two things happens. The kitchen slides a tray onto the counter with your burger: the ticket is now "fulfilled," and the value is your meal. Or a cook comes out and says, "Sorry, we are out of beef" — the ticket is now "rejected," and the reason is the missing ingredient. Once the ticket flips to either state, it stays there permanently. The kitchen cannot un-deliver your burger or change the rejection into a fulfillment. Settled means settled.

Before you even get your food, you can attach instructions to the ticket. "When my burger is ready, add ketchup" — that is `.then()`. "If something goes wrong, bring me the vegetarian menu instead" — that is `.catch()`. "Either way, bring me a napkin" — that is `.finally()`. Each instruction the cashier writes creates a new ticket, because each step might itself succeed or fail.

Here is the clever part about how the restaurant handles these instructions. When your burger lands on the counter, the staff do not wait until the next regular customer is served to run your ketchup instruction. Instead, your ketchup ticket goes into a VIP tray — the microtask queue. Every VIP ticket is processed before the next regular customer (macrotask) is called. If the ketchup step itself generates another VIP ticket ("now add lettuce"), that one also runs before any regular customer. The VIP tray always empties completely first.

This is why promises feel "faster" than `setTimeout` — they are not faster in wall-clock time, they simply have higher scheduling priority. And it is also why you can accidentally starve regular customers if you keep generating VIP tickets in an infinite loop. The regular queue never gets a turn.

The `async/await` syntax is just a nicer way to write these ticket instructions. Instead of chaining `.then().then().then()`, you write code that looks synchronous — `const burger = await orderBurger()` — and the engine translates it into the same ticket-and-VIP-tray mechanism under the hood.
:::

## ⚙️ Under the Hood

### The promise state machine

A promise is a state machine with exactly three states:

```
         fulfill(value)
  ┌──────────────────────────┐
  │                          ▼
PENDING ──────────────── FULFILLED  (value is immutable)
  │
  │        reject(reason)
  └──────────────────────────┐
                             ▼
                         REJECTED   (reason is immutable)
```

**Rules:**
- A promise starts in **pending**.
- It transitions to **fulfilled** or **rejected** exactly once.
- Once settled (fulfilled or rejected), the state and its value/reason are immutable.
- Calling `resolve()` or `reject()` a second time is silently ignored.

```ts
// run: node --experimental-strip-types demo-state.ts

const p = new Promise<string>((resolve, reject) => {
  resolve("first");   // settles the promise
  resolve("second");  // silently ignored
  reject("error");    // also silently ignored
});

p.then((val) => console.log(val)); // "first"
```

### The microtask queue and its priority

When a promise settles, its `.then()` / `.catch()` / `.finally()` handlers are not called synchronously. They are enqueued as **microtasks**. The engine drains the entire microtask queue after the current task completes and before the next macrotask runs.

This gives promise callbacks "cut the line" semantics over `setTimeout`, `setInterval`, I/O callbacks, and all other macrotask sources.

```ts
// run: node --experimental-strip-types demo-priority.ts

console.log("1 — sync");

setTimeout(() => console.log("4 — macrotask"), 0);

Promise.resolve().then(() => console.log("2 — microtask (promise)"));

queueMicrotask(() => console.log("3 — microtask (queueMicrotask)"));

// Output:
// 1 — sync
// 2 — microtask (promise)
// 3 — microtask (queueMicrotask)
// 4 — macrotask
```

### `.then()` / `.catch()` / `.finally()` chaining mechanics

Each method returns a **new promise**, enabling chains. The behavior of the returned promise depends on what the handler does:

| Handler action | Resulting promise state |
|---|---|
| Returns a value `v` | Fulfills with `v` |
| Throws an error `e` | Rejects with `e` |
| Returns a promise `p` | Adopts the state of `p` (waits for it to settle) |
| Returns a thenable `t` | Calls `t.then()` and adopts the result |

```ts
// run: node --experimental-strip-types demo-chaining.ts

Promise.resolve(1)
  .then((v) => {
    console.log(v);      // 1
    return v + 1;        // return a value → next promise fulfills with 2
  })
  .then((v) => {
    console.log(v);      // 2
    throw new Error("boom"); // throw → next promise rejects
  })
  .catch((err) => {
    console.log(err.message); // "boom"
    return "recovered";       // return value from catch → next promise fulfills
  })
  .then((v) => {
    console.log(v);      // "recovered"
  });
```

**Key equivalences:**
- `.catch(onRejected)` is exactly `.then(undefined, onRejected)`.
- `.finally(onFinally)` receives no argument, does not change the settled value (unless it throws), and is called on both fulfillment and rejection.

```ts
// run: node --experimental-strip-types demo-finally.ts

Promise.resolve("data")
  .finally(() => {
    console.log("cleanup runs"); // runs, but cannot see "data"
    // returning a value here does NOT change the chain's value
  })
  .then((v) => console.log(v)); // "data" — unchanged

Promise.reject(new Error("fail"))
  .finally(() => {
    console.log("cleanup on rejection too");
  })
  .catch((err) => console.log(err.message)); // "fail"
```

### Static combinators: `all`, `allSettled`, `race`, `any`

| Method | Resolves when | Rejects when | Return shape | Use case |
|---|---|---|---|---|
| `Promise.all(ps)` | ALL fulfill | FIRST rejection (fail-fast) | `T[]` | Parallel fetch of dependent data — if any fails, you cannot proceed |
| `Promise.allSettled(ps)` | ALL settle | Never rejects | `{status, value\|reason}[]` | Fire-and-forget batch — you want results of every operation regardless |
| `Promise.race(ps)` | FIRST to settle (fulfill or reject) | FIRST to settle if it rejects | `T` | Timeout pattern — race a fetch against a timer |
| `Promise.any(ps)` *(ES2021)* | FIRST to fulfill | ALL reject → `AggregateError` | `T` | Fastest-mirror pattern — try multiple CDNs, use first success |

```ts
// run: node --experimental-strip-types demo-combinators.ts

const fast = (ms: number, val: string) =>
  new Promise<string>((res) => setTimeout(() => res(val), ms));

const fail = (ms: number, msg: string) =>
  new Promise<string>((_, rej) => setTimeout(() => rej(new Error(msg)), ms));

// Promise.all — fail-fast
Promise.all([fast(50, "a"), fail(30, "oops"), fast(10, "c")])
  .catch((e) => console.log("all:", e.message)); // "oops" (first rejection)

// Promise.allSettled — never rejects
Promise.allSettled([fast(50, "a"), fail(30, "oops")])
  .then((results) => console.log("allSettled:", results));
// [{status:"fulfilled",value:"a"}, {status:"rejected",reason:Error}]

// Promise.race — first to settle wins
Promise.race([fast(100, "slow"), fast(10, "fast")])
  .then((v) => console.log("race:", v)); // "fast"

// Promise.any — first to fulfill wins (ES2021)
Promise.any([fail(10, "err1"), fail(20, "err2"), fast(30, "winner")])
  .then((v) => console.log("any:", v)); // "winner"

Promise.any([fail(10, "e1"), fail(20, "e2")])
  .catch((e) => console.log("any all-fail:", e.constructor.name)); // "AggregateError"
```

### `async`/`await` as syntactic sugar

An `async` function always returns a promise. `await` suspends execution of the function and schedules the remainder as a microtask when the awaited promise settles.

```ts
// run: node --experimental-strip-types demo-async-await.ts

// These two functions are semantically equivalent:

function fetchWithThen(url: string): Promise<string> {
  return fetch(url)
    .then((res) => res.text())
    .then((body) => body.toUpperCase());
}

async function fetchWithAwait(url: string): Promise<string> {
  const res = await fetch(url);
  const body = await res.text();
  return body.toUpperCase();
}
```

**Error handling equivalence:**

```ts
// run: node --experimental-strip-types demo-async-errors.ts

// .catch() style
function riskyThen(): Promise<string> {
  return doSomething()
    .then((v) => transform(v))
    .catch((err) => {
      console.error(err);
      return "fallback";
    });
}

// try/catch style (identical behavior)
async function riskyAwait(): Promise<string> {
  try {
    const v = await doSomething();
    return transform(v);
  } catch (err) {
    console.error(err);
    return "fallback";
  }
}

// Helper stubs for the demo
function doSomething(): Promise<number> { return Promise.resolve(42); }
function transform(v: number): string { return String(v); }
```

**Top-level `await` (TLA):** Available in ES modules since ES2022 and Node.js 14.8+. The module's evaluation is suspended until the awaited promise settles, which blocks any module that imports it.

```ts
// run: node --experimental-strip-types tla-demo.ts
// (file must use .ts or .mts extension, or package.json must have "type": "module")

const data = await fetch("https://httpbin.org/get").then((r) => r.json());
console.log("fetched:", data.origin);
```

### The unhandled rejection detection window

When a promise rejects, the engine gives you until the end of the current microtask drain to attach a rejection handler. If the microtask queue empties and no `.catch()` or second argument to `.then()` has been registered, the runtime fires an **unhandledrejection** event.

```ts
// run: node --experimental-strip-types demo-unhandled.ts

// This WILL trigger an unhandled rejection warning:
const p = Promise.reject(new Error("nobody caught me"));

// This will NOT — handler attached synchronously:
const q = Promise.reject(new Error("caught"));
q.catch(() => {}); // attached before microtasks drain
```

In Node.js 15+, unhandled rejections crash the process by default (exit code 1). This behavior is configurable with the `--unhandled-rejections` flag, but the default is `throw`. The [Node.js track](/nodejs/module-03/02-unhandled-rejections) covers this in detail.

### Microtask starvation

Because the microtask queue drains completely before the next macrotask, recursive microtask scheduling can prevent macrotasks from ever running:

```ts
// run: node --experimental-strip-types demo-starvation.ts
// WARNING: This will hang. Press Ctrl+C to stop.

// This setTimeout callback will NEVER fire:
setTimeout(() => console.log("I never run"), 0);

// Infinite microtask recursion:
function recurse(): void {
  Promise.resolve().then(recurse);
}
recurse();

// The microtask queue never empties, so the macrotask queue starves.
```

This is a real production failure mode. Any pattern that generates microtasks faster than they drain will prevent I/O, timers, and the rendering step (browser) from executing.

### Ordering puzzles

#### Puzzle 1 — async/await vs .then() interleaving

```ts
// run: node --experimental-strip-types puzzle-async.ts

async function foo(): Promise<void> {
  console.log("A");
  await Promise.resolve();
  console.log("B");
}

console.log("C");
foo();
console.log("D");
Promise.resolve().then(() => console.log("E"));
```

**Step-by-step:**

| Step | Action | Output so far |
|------|--------|---------------|
| 1 | `console.log("C")` — sync | `C` |
| 2 | Call `foo()` — sync enters the function | `C` |
| 3 | `console.log("A")` — sync inside foo | `C A` |
| 4 | `await Promise.resolve()` — suspends foo, schedules remainder as microtask | `C A` |
| 5 | `foo()` returns to caller, `console.log("D")` — sync | `C A D` |
| 6 | `Promise.resolve().then(...)` enqueues `log("E")` as microtask | `C A D` |
| 7 | Call stack empty. Drain microtasks. First: foo's continuation → `console.log("B")` | `C A D B` |
| 8 | Next microtask: `console.log("E")` | `C A D B E` |

**Output:** `C A D B E`

**Key insight:** `await` is not free — it yields control back to the caller. The code after `await` runs as a microtask, interleaved with other microtasks in queue order.

#### Puzzle 2 — .catch() placement matters

```ts
// run: node --experimental-strip-types puzzle-catch.ts

Promise.resolve()
  .then(() => {
    console.log("1");
    throw new Error("fail");
  })
  .then(() => {
    console.log("2"); // skipped — previous promise rejected
  })
  .catch((err) => {
    console.log("3", err.message);
    return "recovered";
  })
  .then((v) => {
    console.log("4", v);
  });
```

**Step-by-step:**
1. First `.then()` runs: prints "1", then throws.
2. The returned promise rejects with Error("fail").
3. Next `.then(() => log("2"))` — its promise is rejected too (no rejection handler), so "2" is skipped.
4. `.catch()` handles the rejection: prints "3 fail", returns "recovered".
5. `.catch()` returned a value, so the next promise fulfills with "recovered".
6. Final `.then()` prints "4 recovered".

**Output:** `1` `3 fail` `4 recovered`

**Key insight:** `.catch()` works like a try/catch boundary in the chain. Rejection propagates through `.then()` handlers that have no second argument until it finds a `.catch()`. After `.catch()` returns a value, the chain resumes in the fulfilled path.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Forgetting to return a promise in a `.then()` chain**
**Symptom:** Downstream `.then()` receives `undefined` instead of the expected value. Async operations appear to run but results are lost.
**Root cause:** If you call an async function inside `.then()` but forget to `return` it, the chain does not wait for it. The next `.then()` fires immediately with `undefined`.
**Diagnosis:** Lint with `eslint-plugin-promise` rule `no-return-in-then`. Always `return` or use `async/await` to avoid the trap entirely.

**2. `.catch()` in the wrong position**
**Symptom:** Errors from later `.then()` handlers go unhandled; process crashes (Node 15+).
**Root cause:** `.catch()` only handles rejections from promises **above** it in the chain. A `.then()` added after `.catch()` can still throw without a handler.
**Diagnosis:** Place `.catch()` at the end of the chain, or use `async/await` with try/catch wrapping the entire block.

**3. `Promise.all` fail-fast surprise**
**Symptom:** A batch of API calls partially completes, but you have no results because one call failed and `Promise.all` rejected immediately.
**Root cause:** `Promise.all` rejects on the first failure and discards all other results, including those that already fulfilled. The other promises continue running (they are not cancelled) but their results are inaccessible.
**Diagnosis:** Use `Promise.allSettled` when you need partial results. Use `Promise.all` only when every result is required and any failure means you cannot proceed.

**4. Microtask starvation from recursive promise chains**
**Symptom:** The event loop hangs — timers, I/O callbacks, and setImmediate never fire. CPU pegged at 100%.
**Root cause:** A `.then()` handler that synchronously enqueues another `.then()` in an infinite loop. The microtask queue never empties, so the event loop cannot advance to the next phase.
**Diagnosis:** Use `setTimeout(fn, 0)` or `setImmediate` (Node) to break out of the microtask queue and yield to the event loop.

:::

## 🎯 Checkpoint

::: details Question 1 — State immutability
**Q:** What happens if you call `resolve("a")` and then `resolve("b")` inside a `new Promise()` constructor?

**A:** The promise settles with value `"a"`. The second `resolve("b")` call is silently ignored. A promise can only transition from pending to settled once. This is part of the spec — subsequent resolve/reject calls are no-ops.
:::

::: details Question 2 — .catch() chain recovery
**Q:** After a `.catch()` handler returns a value (not a rejected promise), does the next `.then()` in the chain receive a fulfilled or rejected promise?

**A:** Fulfilled. `.catch()` returning a value is equivalent to a try/catch block that handles the error and moves on. The chain resumes on the fulfillment path with whatever value `.catch()` returned. Only if `.catch()` throws or returns a rejected promise does the chain continue on the rejection path.
:::

::: details Question 3 — Promise.any vs Promise.race
**Q:** If the first promise to settle is a rejection, how do `Promise.race` and `Promise.any` differ in behavior?

**A:** `Promise.race` settles with that rejection — it resolves or rejects with whichever promise settles first, regardless of outcome. `Promise.any` ignores the rejection and keeps waiting for the first fulfillment. `Promise.any` only rejects if ALL input promises reject, at which point it throws an `AggregateError` containing all rejection reasons. Use `race` for timeouts (where you want to know about any settlement), and `any` for "try multiple sources, take the first success."
:::

## Key Mental Models

- **Settled means sealed.** A promise transitions from pending to fulfilled or rejected exactly once — the value or reason is then immutable. No take-backs.
- **Each `.then()` / `.catch()` / `.finally()` creates a new promise.** Chains are pipelines of independent promises, not mutations of a single one.
- **Microtasks cut the line, every time.** Promise callbacks always run before the next macrotask, giving them priority scheduling — but also starvation potential.
- **`async/await` is `.then()` in disguise.** Every `await` suspends the function and schedules the rest as a microtask. Understanding `.then()` mechanics means you understand `await`.
- **`Promise.all` is fail-fast; `Promise.allSettled` is fail-safe.** Choose based on whether partial results are useful.

## Related

- [The Event Loop](./04-event-loop) — previous page in this track
- [Promise Internals (Node)](/nodejs/module-03/01-promise-internals) — V8's internal promise implementation
- [Unhandled Rejections (Node)](/nodejs/module-03/02-unhandled-rejections) — Node's crash-on-unhandled behavior
- [Iterators & Generators](./06-iterators-generators) — next page in this track
