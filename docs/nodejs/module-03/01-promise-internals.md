---
title: "Promise Internals & Combinators"
outline: deep
---

# Promise Internals & Combinators

> **Interview weight:** 🔥🔥🔥 — Promise mechanics and combinator choice are perennial interview favorites.
> **Node version:** All examples target Node 22+. Microtask semantics have been stable since Node 12.
> **Prereqs:** [The Event Loop (JS Core)](/js-core/04-event-loop) · [nextTick vs queueMicrotask](/nodejs/module-02/02-nexttick-vs-queuemicrotask)

## 🗣️ In Plain English

::: tip In Plain English
Think of a promise as a **takeout order receipt**. When you place your order at the counter, you get a slip of paper immediately — that's the pending promise. You don't have food yet, but you have something to hold onto. At some future point one of two things happens: your food is ready (fulfilled) or the kitchen tells you they're out of ingredients (rejected). Either way, once the ticket is stamped, it's final — the kitchen can't un-cook your food or un-reject your order.

The `.then()` method is like writing your phone number on the receipt and saying "text me when it's ready." You're not standing at the counter blocking everyone. You walk away, and you get notified later. And here's the important part: every time you write your number on a receipt, they give you a *new* receipt — for the thing you'll do *after* you pick up the food. That's chaining.

Now for the combinators — imagine you've placed orders at four different food trucks:

- **`Promise.all`** is like telling your friend "we eat when *everyone's* food is ready." If any truck says they can't make your order, the whole lunch is cancelled.
- **`Promise.allSettled`** is more relaxed: "let's see what everyone comes back with — successes and failures — and figure it out from there."
- **`Promise.race`** is "I'm starving, whoever finishes first, that's what I'm eating." It doesn't matter if the result is good or bad — first one done wins.
- **`Promise.any`** is slightly pickier: "Give me the first truck that *actually delivers food*." If they all fail, you get a special complaint form (AggregateError).

One detail that trips people up: the moment a promise settles and you have a `.then()` waiting, that callback doesn't fire *right now*. It gets dropped into a special express lane called the microtask queue, which runs before the next event-loop task but after the current synchronous code finishes. That tiny timing detail explains a mountain of ordering puzzles.
:::

## ⚙️ Under the Hood

### The Promise State Machine

Every promise has two internal slots (per the ECMAScript spec, not directly accessible in JS):

| Internal Slot | Values | Notes |
|---|---|---|
| `[[PromiseState]]` | `"pending"` \| `"fulfilled"` \| `"rejected"` | Transition is one-way and irreversible |
| `[[PromiseResult]]` | `undefined` initially, then the fulfillment value or rejection reason | Set exactly once at settlement |

A promise transitions from `pending` to either `fulfilled` or `rejected` — never both, never back, never twice. This is why calling `resolve()` after `reject()` (or vice versa) inside an executor is a silent no-op.

```typescript
// run: node --experimental-strip-types demo-state-machine.ts
const p = new Promise<string>((resolve, reject) => {
  resolve("first");   // transitions to fulfilled
  resolve("second");  // silent no-op — already settled
  reject("too late"); // silent no-op — already settled
});

p.then((v) => console.log("value:", v));
// Output: value: first
```

### Resolution and the Thenable Protocol

When you call `resolve(x)`, the engine checks what `x` is:

1. **If `x` is the promise itself** — throw a `TypeError` (no self-resolution).
2. **If `x` is a thenable** (any object/function with a `.then` method) — the promise "assimilates" it. The engine calls `x.then(resolve, reject)` with the promise's own resolve/reject, essentially adopting the thenable's eventual value.
3. **Otherwise** — the promise fulfills with `x` directly.

This assimilation is how you can return a promise from a `.then()` handler and the chain "flattens" — you never get a `Promise<Promise<T>>`.

```typescript
// run: node --experimental-strip-types demo-thenable.ts
// Any object with a .then() method is treated as a thenable
const thenable = {
  then(onFulfill: (v: string) => void) {
    setTimeout(() => onFulfill("from thenable"), 50);
  },
};

const p: Promise<string> = Promise.resolve(thenable);
p.then((v) => console.log(v));
// Output (after ~50ms): from thenable
```

### Microtask Scheduling

When a promise settles and has handlers attached via `.then()`, those callbacks are not invoked synchronously. They are enqueued as **microtasks** (via `PromiseResolveThenableJob` or `PromiseReactionJob` in spec terms). The microtask queue is drained completely after each task, before the event loop picks up the next task from the macrotask queue.

```typescript
// run: node --experimental-strip-types demo-microtask-order.ts
console.log("1: synchronous start");

setTimeout(() => console.log("5: macrotask (setTimeout)"), 0);

Promise.resolve()
  .then(() => console.log("3: microtask 1"))
  .then(() => console.log("4: microtask 2"));

console.log("2: synchronous end");

// Output:
// 1: synchronous start
// 2: synchronous end
// 3: microtask 1
// 4: microtask 2
// 5: macrotask (setTimeout)
```

Note the extra microtask hop that comes from thenable resolution: resolving a promise with another promise always costs at least one additional microtask tick (per spec, `PromiseResolveThenableJob` is enqueued first, then the resulting `PromiseReactionJob`).

```typescript
// run: node --experimental-strip-types demo-extra-tick.ts
const p1 = Promise.resolve("direct");
const p2 = Promise.resolve(Promise.resolve("nested"));

p1.then((v) => console.log("A:", v));
p2.then((v) => console.log("B:", v));

// Output:
// A: direct    — fires on first microtask drain
// B: nested    — fires one tick later due to thenable assimilation
```

### Chaining Mechanics

Every call to `.then()` returns a **new promise**. The resolution of that new promise depends on what the handler returns:

| Handler returns... | New promise becomes... |
|---|---|
| A value `v` | Fulfilled with `v` |
| A fulfilled promise / thenable | Fulfilled with its value (after assimilation) |
| A rejected promise / thenable | Rejected with its reason |
| Throws an error | Rejected with that error |
| Nothing (`undefined`) | Fulfilled with `undefined` |

```typescript
// run: node --experimental-strip-types demo-chaining.ts
const result = await Promise.resolve(1)
  .then((v) => v + 1)            // returns 2 → next promise fulfills with 2
  .then((v) => Promise.resolve(v * 3)) // returns Promise<6> → assimilated
  .then((v) => {
    if (v > 5) throw new Error("too big");
    return v;
  })
  .catch((err: Error) => {
    console.log("caught:", err.message);
    return -1; // recovery — next promise fulfills with -1
  });

console.log("final:", result);
// Output:
// caught: too big
// final: -1
```

### Combinators

#### `Promise.all<T>(iterable): Promise<T[]>`

Resolves when **all** input promises fulfill. Rejects immediately (fail-fast) on the **first** rejection. Results are ordered to match the input, regardless of settlement order.

```typescript
// run: node --experimental-strip-types demo-all.ts
const delay = (ms: number, val: string) =>
  new Promise<string>((res) => setTimeout(() => res(val), ms));

// All succeed — order preserved
const results = await Promise.all([
  delay(100, "slow"),
  delay(10, "fast"),
  delay(50, "mid"),
]);
console.log(results); // ["slow", "fast", "mid"]

// Fail-fast behavior
try {
  await Promise.all([
    delay(100, "ok"),
    Promise.reject(new Error("boom")),
    delay(50, "never matters"),
  ]);
} catch (err) {
  console.log("rejected:", (err as Error).message); // "boom"
}
```

#### `Promise.allSettled<T>(iterable): Promise<PromiseSettledResult<T>[]>`

**Never** short-circuits. Waits for every promise to settle. Returns an array of status objects. Available since Node 12.9 / ES2020.

```typescript
// run: node --experimental-strip-types demo-allsettled.ts
const results = await Promise.allSettled([
  Promise.resolve("ok"),
  Promise.reject(new Error("fail")),
  Promise.resolve(42),
]);

for (const r of results) {
  if (r.status === "fulfilled") {
    console.log("fulfilled:", r.value);
  } else {
    console.log("rejected:", r.reason.message);
  }
}
// Output:
// fulfilled: ok
// rejected: fail
// fulfilled: 42
```

#### `Promise.race<T>(iterable): Promise<T>`

Settles with whichever input promise settles **first** — fulfilled or rejected. The other promises keep running (promises are not cancellable), but their results are ignored.

```typescript
// run: node --experimental-strip-types demo-race.ts
const timeout = (ms: number) =>
  new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), ms)
  );

const fetchData = () =>
  new Promise<string>((resolve) =>
    setTimeout(() => resolve("data"), 200)
  );

try {
  const result = await Promise.race([fetchData(), timeout(100)]);
  console.log(result);
} catch (err) {
  console.log("lost the race:", (err as Error).message);
}
// Output: lost the race: timeout
```

#### `Promise.any<T>(iterable): Promise<T>`

Resolves with the **first fulfillment**. Ignores rejections unless *all* promises reject, in which case it throws an `AggregateError` containing every rejection reason. Available since Node 15 / ES2021.

```typescript
// run: node --experimental-strip-types demo-any.ts
// First success wins
const winner = await Promise.any([
  Promise.reject(new Error("a")),
  Promise.resolve("b wins"),
  Promise.resolve("c too late"),
]);
console.log(winner); // "b wins"

// All reject → AggregateError
try {
  await Promise.any([
    Promise.reject(new Error("x")),
    Promise.reject(new Error("y")),
  ]);
} catch (err) {
  if (err instanceof AggregateError) {
    console.log("all failed:", err.errors.map((e: Error) => e.message));
    // ["x", "y"]
  }
}
```

#### Combinator Decision Table

| Combinator | Short-circuits on | Result shape | Use case |
|---|---|---|---|
| `Promise.all` | First rejection | `T[]` | Parallel tasks where all must succeed |
| `Promise.allSettled` | Never | `PromiseSettledResult<T>[]` | Parallel tasks where you need every outcome |
| `Promise.race` | First settlement | `T` | Timeouts, "fastest mirror" patterns |
| `Promise.any` | First fulfillment | `T` | Redundant sources, fallback chains |

### Performance: Long Promise Chains

Each `.then()` allocates a new promise object and its associated reaction records. In a tight loop, chaining thousands of `.then()` calls creates:

- **Memory pressure:** Each link holds references to handlers and the next promise.
- **Microtask flooding:** Settlement cascades through the chain one microtask per link.
- **Stack-trace degradation:** Async stack traces become harder to follow.

Prefer `async/await` for sequential logic — it compiles to a state machine rather than allocating a new promise per step. V8's async/await optimization (since V8 7.2 / Node 12) specifically avoids the extra microtask tick that hand-written `.then()` chains incur.

```typescript
// run: node --experimental-strip-types demo-chain-perf.ts
// Anti-pattern: building a chain in a loop
async function chainLoop(n: number): Promise<number> {
  let p: Promise<number> = Promise.resolve(0);
  for (let i = 0; i < n; i++) {
    p = p.then((v) => v + 1); // allocates n promise objects
  }
  return p;
}

// Preferred: async/await
async function awaitLoop(n: number): Promise<number> {
  let v = 0;
  for (let i = 0; i < n; i++) {
    v = await Promise.resolve(v + 1); // V8 optimizes this path
  }
  return v;
}

const t1 = performance.now();
await chainLoop(100_000);
const t2 = performance.now();
await awaitLoop(100_000);
const t3 = performance.now();

console.log(`chain: ${(t2 - t1).toFixed(1)}ms`);
console.log(`await: ${(t3 - t2).toFixed(1)}ms`);
```

### Microtask Ordering Puzzle

This is the kind of question that appears in interviews. Predict the output:

```typescript
// run: node --experimental-strip-types demo-ordering-puzzle.ts
console.log("A");

setTimeout(() => console.log("B"), 0);

Promise.resolve()
  .then(() => {
    console.log("C");
    return Promise.resolve(); // thenable — costs an extra microtask
  })
  .then(() => console.log("D"));

Promise.resolve().then(() => console.log("E"));

queueMicrotask(() => console.log("F"));

console.log("G");

// Output:
// A
// G
// C        — first microtask: first .then() handler
// E        — second microtask: independent chain's .then()
// F        — third microtask: queueMicrotask
// D        — delayed: thenable assimilation needed extra tick(s)
// B        — macrotask: setTimeout runs after all microtasks
```

The key insight: returning `Promise.resolve()` from a `.then()` handler triggers thenable assimilation, which enqueues a `PromiseResolveThenableJob` microtask — pushing `D` after `E` and `F`.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Silent swallowing with missing `.catch()`**
**Symptom:** An operation fails but nothing logs, no alert fires, the system silently degrades.
**Root cause:** A `.then()` chain with no terminal `.catch()`. Before Node 15, unhandled rejections only warned; code written in that era may still lack handlers.
**Diagnosis:** Enable `--unhandled-rejections=strict` in staging. Instrument the `unhandledRejection` process event. See [Unhandled Rejections](./02-unhandled-rejections).

**2. `Promise.all` cascading failure**
**Symptom:** One flaky service causes an entire batch of independent operations to report failure.
**Root cause:** Using `Promise.all` when partial success is acceptable. The fail-fast behavior discards all fulfilled results.
**Diagnosis:** Switch to `Promise.allSettled` when you need every result regardless of individual failures.

**3. Microtask starvation of the event loop**
**Symptom:** HTTP server stops accepting new connections; health checks time out; CPU pegged at 100%.
**Root cause:** A recursive microtask loop (e.g., `.then()` handlers that resolve and immediately enqueue more `.then()` handlers) prevents the event loop from advancing to the next phase. `setTimeout` and I/O callbacks never fire.
**Diagnosis:** Use `--inspect` and take a CPU profile. The microtask drain will appear as an unbroken block in the profiler. Break the recursion with `setImmediate()` to yield back to the event loop.

**4. Thenable assimilation from untrusted input**
**Symptom:** A third-party object with a `.then()` method (e.g., from a deserialized payload) gets accidentally assimilated by `Promise.resolve()`, executing arbitrary code.
**Root cause:** The thenable protocol checks for *any* `.then` property that is a function — it's duck-typed.
**Diagnosis:** Never pass untrusted objects through `Promise.resolve()`. Wrap with `{ data: untrustedObj }` or check for `.then` before resolving.

:::

## 🎯 Checkpoint

::: details Question 1 — State immutability
**Q:** What happens if you call `reject()` inside a promise executor after `resolve()` has already been called?

**A:** Nothing. Once a promise transitions from `pending` to `fulfilled` (via `resolve()`), it is permanently settled. Subsequent calls to `resolve()` or `reject()` are silently ignored. The `[[PromiseState]]` internal slot only transitions once.
:::

::: details Question 2 — Combinator choice
**Q:** You need to fetch user profiles from 10 different microservices. Some may be down. You want to display whatever data you can get. Which combinator do you use, and why?

**A:** `Promise.allSettled`. Unlike `Promise.all`, it never short-circuits on rejection. You get an array of `{ status: "fulfilled", value }` or `{ status: "rejected", reason }` objects for all 10 calls, so you can render the successful ones and show fallback UI for the failed ones.
:::

::: details Question 3 — Microtask ordering
**Q:** In the following code, does `"X"` or `"Y"` log first?
```typescript
Promise.resolve().then(() => console.log("X"));
queueMicrotask(() => console.log("Y"));
```

**A:** `"X"` logs first. Both are microtasks, and microtasks are processed in FIFO order. The `.then()` handler is enqueued first (as a `PromiseReactionJob`), then the `queueMicrotask` callback. Since the microtask queue drains in order, `"X"` precedes `"Y"`.
:::

## Key Mental Models

- **One-way ticket.** A promise can only move from pending to fulfilled or rejected — never back, never to the other state, never twice.
- **`.then()` is a factory.** Every `.then()` call creates and returns a brand-new promise whose fate depends on the handler's return value.
- **Microtask express lane.** Promise reactions run in the microtask queue — after the current synchronous code, before the next event-loop task.
- **Thenable duck-typing.** Anything with a `.then()` method gets assimilated by `Promise.resolve()` — powerful but dangerous with untrusted data.
- **Pick the right combinator.** `all` for all-or-nothing, `allSettled` for best-effort, `race` for first-to-settle, `any` for first-to-succeed.

## Related

- [Promises & Microtasks (JS Core)](/js-core/05-promises-microtasks)
- [Unhandled Rejections](./02-unhandled-rejections)
- [The Event Loop (JS Core)](/js-core/04-event-loop)
- [nextTick vs queueMicrotask](/nodejs/module-02/02-nexttick-vs-queuemicrotask)
