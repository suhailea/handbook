---
title: "JavaScript Core — 25 Interview Questions"
outline: deep
---

# JavaScript Core — 25 Interview Questions

25 curated questions covering execution contexts, closures, prototypes, the event loop, promises, generators, memory/GC, and ES modules. Each answer is rigorous — not just the conclusion, but the mechanism.

---

## Execution Contexts, Scopes & Hoisting

::: details Q1 — What is the Temporal Dead Zone and why does it exist?
**Q:** What is the Temporal Dead Zone (TDZ), and why did the spec introduce it instead of just hoisting `let`/`const` the same way as `var`?

**A:** The TDZ is the region between the entry into a scope and the point where a `let` or `const` binding is initialized. During this window the binding *exists* in the environment record (the engine has already registered it during the creation phase of the execution context), but any read or write throws a `ReferenceError`. This is a deliberate design decision, not an implementation detail. `var` declarations are hoisted *and* initialized to `undefined`, which causes a category of silent bugs — code reads a variable before the programmer intended it to be available and gets `undefined` instead of an error. By making `let`/`const` hoisted-but-not-initialized, the spec gives you an early, loud failure. Importantly, the TDZ is *temporal*, not spatial — it depends on execution order, not position in the source:

```typescript
// run: node --experimental-strip-types tdz-demo.ts
function surprise(): number {
  return x; // ReferenceError at call time, not at definition time
}
// surprise(); ← calling here would throw because `x` is in TDZ
const x: number = 42;
surprise(); // works fine — TDZ for x has ended
```

The TDZ also applies to `class` declarations and to `default` parameter expressions that reference later parameters. The key takeaway: the engine *always* hoists the binding (it knows the name at parse time), but the *initialization* is what differs between `var`, `let`/`const`, and function declarations.

See [full page](/js-core/01-execution-contexts) for the complete execution context lifecycle.
:::

::: details Q2 — Hoisting differences between function declarations, function expressions, and arrow functions
**Q:** Given this code, predict the output and explain exactly what the engine does during the creation phase vs the execution phase:

```typescript
console.log(typeof a); // ?
console.log(typeof b); // ?
console.log(typeof c); // ?

function a() { return 1; }
var b = function() { return 2; };
var c = () => 3;
```

**A:** The output is `"function"`, `"undefined"`, `"undefined"`. During the creation phase of the global execution context, the engine does three things in order: (1) it scans for function declarations and creates them *fully* — `a` is bound to the actual function object immediately; (2) it scans for `var` declarations and initializes them to `undefined` — so `b` and `c` are both `undefined` at this point; (3) `let`/`const` would be registered but left uninitialized (TDZ). During the execution phase, the three `console.log` calls run before any assignment. `a` is already a function. `b` and `c` are `undefined` because `var` hoisted the name but not the right-hand-side assignment. The assignment `b = function() { ... }` and `c = () => 3` only happen when execution reaches those lines.

This is why function declarations can be called "before" they appear in source (they are fully hoisted) while function expressions and arrow functions assigned to `var` are not — they behave like any other variable assignment. If `b` and `c` were declared with `const`, the `typeof` calls would throw a `ReferenceError` instead of returning `"undefined"`, because `typeof` does *not* protect against TDZ (a common misconception — `typeof` only avoids errors for completely *undeclared* names, not for declared-but-uninitialized bindings).

See [full page](/js-core/01-execution-contexts) for the full creation-phase algorithm.
:::

::: details Q3 — Scope chain resolution and variable shadowing
**Q:** How does the engine resolve a variable name at runtime, and what happens in memory when an inner scope shadows an outer variable?

**A:** Every execution context has a reference to its *outer lexical environment*, forming a chain. When the engine encounters a name, it searches the current environment record first. If the binding is not found, it follows the `[[OuterEnv]]` link and searches the next record, continuing until it reaches the global environment (whose `[[OuterEnv]]` is `null`). This is the *scope chain*, and its structure is determined *lexically* at parse time — not at call time (which is why closures work).

When an inner scope declares a variable with the same name as an outer one, the inner binding *shadows* the outer. The outer variable is not overwritten or deleted — it still exists in its own environment record and is accessible to any code that closes over that outer scope. The inner scope simply has its own binding that the engine finds first during lookup, so it never traverses further up the chain:

```typescript
// run: node --experimental-strip-types shadow.ts
const x: string = "outer";

function inner(): void {
  const x: string = "inner"; // shadows, does not mutate outer
  console.log(x); // "inner"
}

inner();
console.log(x); // "outer" — untouched
```

A performance note: modern engines (V8, SpiderMonkey) do *not* actually walk a linked list at runtime. During compilation they resolve most variable references to fixed offsets in known environment records, making lookup O(1). The linked-list model is the *specification* abstraction; the implementation is much faster. The scope chain walk only materializes at runtime for constructs like `eval()` or `with` that prevent static analysis.

See [full page](/js-core/01-execution-contexts) for the full environment record model.
:::

---

## Closures

::: details Q4 — What exactly does a closure keep alive on the heap?
**Q:** When a function "closes over" a variable, what object in memory keeps that variable alive, and can the garbage collector ever reclaim it while the closure exists?

**A:** A closure is not a special data structure — it is a function object paired with a reference to the *environment record* (the lexical environment) in which it was created. That environment record lives on the heap (not the stack) precisely because the function outlives the execution context that created the record. The closed-over variable exists as a *slot* in that record. As long as the function object is reachable, the environment record it points to is also reachable, and so is the variable.

V8 is smart about this: during compilation it performs *scope analysis* and only allocates variables to a heap-backed "context" object if they are actually referenced by an inner function. Variables that are *not* closed over stay on the stack (or in registers) and are freed when the frame pops. However, if even one variable in a scope is closed over, V8 allocates the *entire* context object — which means other variables in the same scope *may* be retained too, depending on the engine version and optimization tier. This is one mechanism behind accidental closure-based memory leaks.

The GC cannot reclaim the environment record while any function referencing it remains reachable. Once all closures referencing that record become unreachable, the record (and its variables) become eligible for collection.

See [full page](/js-core/02-closures) for V8's context allocation strategy.
:::

::: details Q5 — The classic loop closure problem and three solutions
**Q:** Explain why this code prints `3, 3, 3` instead of `0, 1, 2`, and provide three distinct solutions with an explanation of why each works:

```typescript
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
```

**A:** `var` is function-scoped (or global-scoped), not block-scoped. There is a single `i` binding shared across all iterations. By the time the three callbacks run (after the loop completes and the current task finishes), `i` is `3`. All three closures point to the same environment record containing the same `i`.

**Solution 1 — `let`:** `for (let i = 0; i < 3; i++)` creates a *fresh* binding of `i` per iteration. The spec mandates that a `for` loop with `let` creates a new lexical environment for each iteration and copies the current value into the new binding. Each closure captures a different environment record.

**Solution 2 — IIFE:** `setTimeout(((j: number) => () => console.log(j))(i), 0)` — the IIFE executes immediately, receives the current value of `i` as `j` (a new parameter binding per call), and returns a new function that closes over `j`.

**Solution 3 — `setTimeout`'s third argument:** `setTimeout((j: number) => console.log(j), 0, i)` — `setTimeout` accepts extra arguments that are passed to the callback. The value of `i` is captured *by value* at the time of the `setTimeout` call.

Each solution works by ensuring each callback closes over (or receives) a *distinct* copy of the loop counter at the time of that iteration, rather than sharing a single mutable binding.

See [full page](/js-core/02-closures) for more on closures in loops.
:::

::: details Q6 — Memory leaks caused by closures
**Q:** Describe a realistic closure-based memory leak pattern and explain why it is hard to detect.

**A:** A classic pattern involves event handlers or callbacks that close over large objects unintentionally:

```typescript
// run: node --experimental-strip-types leak.ts
function createHandler(): () => void {
  const hugeBuffer: Buffer = Buffer.alloc(50 * 1024 * 1024); // 50 MB
  const id: number = 1;

  // Developer only needs `id`, but the closure captures the
  // entire context object — which includes `hugeBuffer`
  return () => {
    console.log(`Handler for ${id}`);
  };
}

const handler = createHandler();
// `hugeBuffer` is still alive — the closure's context retains it
```

In many V8 optimization tiers, if *any* variable in a scope is closed over, the engine allocates a shared context object for that scope. Even though `hugeBuffer` is never read by the returned function, it may share the same context as `id` and remain reachable. This is sometimes called the "accidental closure leak." Modern V8 (with TurboFan) has improved at pruning unreferenced variables from context objects, but it is not guaranteed — particularly when `eval` is present in the scope or when the function is not optimized.

These leaks are hard to detect because: (1) heap snapshots show the `Buffer` as retained by a `(closure)` context, which does not directly point back to a named function; (2) the leak grows slowly per connection or event cycle, so it manifests as a gradual memory climb over hours; (3) in production, GC pauses increase before an OOM kill, making the symptom look like a CPU problem.

The fix is to narrow the scope — extract only the needed value into a smaller closure, or null out the reference after use.

See [full page](/js-core/02-closures) for the full V8 context allocation analysis.
:::

---

## Prototypes & `this`

::: details Q7 — The four rules of `this` binding (in priority order)
**Q:** List the four rules that determine the value of `this` for a regular (non-arrow) function call, in order of precedence.

**A:** From highest to lowest priority:

1. **`new` binding:** When a function is called with `new`, `this` is bound to the newly created object (whose `[[Prototype]]` is set to the constructor's `.prototype`). This takes precedence over all other rules.

2. **Explicit binding:** `call`, `apply`, or `bind` explicitly set `this`. A `bind`-created function has a fixed `this` that cannot be overridden by rule 3, but `new` (rule 1) *can* override `bind` — this is by spec design so that `bind`-ed constructors still work.

3. **Implicit binding:** When a function is called as a method on an object (`obj.fn()`), `this` is `obj`. The key detail: it is the *call-site* that matters, not where the function is defined. If you extract the method (`const fn = obj.fn; fn()`), the implicit binding is lost.

4. **Default binding:** A plain function call (`fn()`) — `this` is `undefined` in strict mode, `globalThis` in sloppy mode. Since ES modules and classes are always strict, this usually means `undefined` in modern code.

An important fifth case that *overrides* all of these: **arrow functions** have no `this` binding at all. They lexically capture `this` from the enclosing execution context at creation time. You cannot rebind an arrow function's `this` with `call`, `bind`, or `new`.

```typescript
// run: node --experimental-strip-types this-rules.ts
const obj = {
  value: 42,
  regular() { return this?.value; },
  arrow: () => typeof this, // `this` is module-level (undefined in ESM)
};

console.log(obj.regular());       // 42 — implicit binding
console.log(obj.regular.call({ value: 99 })); // 99 — explicit binding
console.log(obj.arrow());         // "undefined" — lexical, ignores obj
```

See [full page](/js-core/03-prototypes-this-classes) for the complete `this` binding algorithm.
:::

::: details Q8 — Why arrow functions capture `this` lexically
**Q:** Why do arrow functions not have their own `this`, and what problem does this solve?

**A:** Before arrow functions (ES5 and earlier), callbacks inside methods constantly lost their `this` binding. The classic workaround was `const self = this;` or `.bind(this)`. Arrow functions were designed specifically to solve this ergonomic problem by *not* creating a `this` binding at all. When the engine encounters `this` inside an arrow function, it treats it like any other variable — it walks up the scope chain to the nearest enclosing execution context that *does* have a `this` binding (a regular function, a method, or the global scope) and uses that value. This is called *lexical `this`*.

This means arrow functions cannot be used as constructors (calling `new` on one throws a `TypeError`), cannot be used as methods that need to reference the receiver (`this` will not be the object), and `call`/`apply`/`bind` have no effect on their `this` (they can still pass arguments, but the `thisArg` is ignored).

The design is not arbitrary — it follows from the principle that arrow functions are *expressions*, not full function declarations. They intentionally lack `this`, `arguments`, `super`, and `new.target` to serve as lightweight closures, not as independent callable entities.

See [full page](/js-core/03-prototypes-this-classes) for the full comparison.
:::

::: details Q9 — Prototype chain lookup and performance
**Q:** When you access `obj.x`, what exactly does the engine do if `x` is not an own property? What are the performance implications of deep prototype chains?

**A:** The engine calls the internal `[[Get]]` method on `obj`. First, it checks `obj`'s own properties (via `[[OwnPropertyKeys]]` / the object's internal property table). If `x` is found, its value (or getter) is returned. If not, the engine follows `obj.[[Prototype]]` (the internal link, accessible via `Object.getPrototypeOf(obj)`) and searches that object's own properties. This continues up the chain until either the property is found or `[[Prototype]]` is `null` (the end of the chain, reached above `Object.prototype`), at which point `undefined` is returned.

For *reads*, this is a lookup that is conceptually O(n) in chain depth. However, V8 uses *inline caches* (ICs) and *hidden classes* (Maps/Shapes) to make repeated property access effectively O(1). On the first access, V8 records the shape of the object and the offset where the property was found (even if it was found on a prototype). On subsequent accesses with the same shape, it goes directly to the cached offset. A deep prototype chain only hurts performance on the first access or when shapes are polymorphic (many different object shapes flow through the same code path, causing the IC to become *megamorphic* and fall back to dictionary-mode lookup).

For *writes*, `obj.x = value` always creates an own property on `obj` (unless a *setter* exists somewhere in the chain), which is why prototype mutation is not a concern during assignment.

See [full page](/js-core/03-prototypes-this-classes) for the full prototype chain model.
:::

::: details Q10 — Class syntax is sugar — what does it desugar to?
**Q:** What does a `class` declaration actually produce under the hood? Show what the engine creates in terms of functions and prototype linkage.

**A:** A `class` declaration creates a *constructor function* and sets up the prototype chain. Here is the desugaring:

```typescript
// This class:
class Animal {
  name: string;
  constructor(name: string) { this.name = name; }
  speak(): string { return `${this.name} makes a noise`; }
  static kingdom(): string { return "Animalia"; }
}

// Is mechanically equivalent to:
function Animal(this: any, name: string) {
  this.name = name;
}
Animal.prototype.speak = function(): string {
  return `${this.name} makes a noise`;
};
Animal.kingdom = function(): string {
  return "Animalia";
};
```

The engine creates a function object `Animal` (the constructor). Instance methods (`speak`) are placed on `Animal.prototype` — they are *shared* across all instances via the prototype chain, not copied per instance. Static methods (`kingdom`) are placed directly on the `Animal` function object itself.

Key differences between `class` syntax and manual function constructors: (1) `class` bodies are implicitly strict mode; (2) `class` declarations are *not* hoisted in the same way as function declarations — they are hoisted to the top of the block but placed in the TDZ (like `let`); (3) calling a class without `new` throws a `TypeError` (the `[[IsClassConstructor]]` internal flag); (4) methods defined in a class body are non-enumerable (matching `Object.defineProperty` behavior, unlike manual assignment which creates enumerable properties).

Inheritance via `extends` sets up *two* prototype links: `Child.prototype.[[Prototype]] = Parent.prototype` (for instance method inheritance) and `Child.[[Prototype]] = Parent` (for static method inheritance). The `super()` call invokes the parent constructor with the child's `this`.

See [full page](/js-core/03-prototypes-this-classes) for the full class desugaring.
:::

---

## Event Loop

::: details Q11 — Microtasks vs macrotasks — ordering guarantees
**Q:** What is the difference between a microtask and a macrotask, and what ordering guarantee does the spec provide?

**A:** A *macrotask* (or simply "task") is a unit of work scheduled by the host environment — `setTimeout`, `setInterval`, I/O callbacks, `setImmediate` (Node). A *microtask* is a job scheduled by the language runtime itself — `Promise.then`/`.catch`/`.finally` callbacks, `queueMicrotask()`, and `MutationObserver` (browser).

The critical ordering guarantee: **after each macrotask completes, the engine drains the entire microtask queue before picking the next macrotask.** This means microtasks have higher effective priority — they always run before the next timer, I/O callback, or rendering step.

```typescript
// run: node --experimental-strip-types ordering.ts
setTimeout(() => console.log("timeout 1"), 0);
setTimeout(() => console.log("timeout 2"), 0);

Promise.resolve()
  .then(() => console.log("microtask 1"))
  .then(() => console.log("microtask 2"));

console.log("sync");

// Output:
// sync
// microtask 1
// microtask 2
// timeout 1
// timeout 2
```

`"sync"` prints first (it is part of the currently executing macrotask — the script itself). Then the microtask queue is drained (`microtask 1`, `microtask 2`). Only then does the event loop move to the next macrotask (`timeout 1`), drain microtasks again (none), then `timeout 2`.

The spec guarantee is that microtask draining is *exhaustive* — even microtasks enqueued *during* microtask processing are drained before the loop proceeds. This is both the source of their power (predictable async sequencing) and their danger (a recursive microtask loop will starve the event loop forever).

See [full page](/js-core/04-event-loop) for the complete event loop phase model.
:::

::: details Q12 — Browser event loop vs Node.js event loop
**Q:** How does Node's event loop differ from the browser's?

**A:** The browser spec (HTML spec's "processing model") defines a single task queue (conceptually — browsers use multiple priority queues internally), a microtask checkpoint after each task, and a rendering pipeline (rAF, style, layout, paint) that runs approximately every 16ms. The loop is: pick task → run it → drain microtasks → maybe render → repeat.

Node.js uses libuv, which divides a single "tick" of the loop into **six phases**: (1) **timers** — run callbacks for expired `setTimeout`/`setInterval`; (2) **pending callbacks** — system-level callbacks like TCP errors; (3) **idle/prepare** — internal to libuv; (4) **poll** — retrieve new I/O events, execute I/O callbacks (most application code runs here), and block if nothing else is scheduled; (5) **check** — `setImmediate` callbacks; (6) **close** — `socket.on('close', ...)` etc. Microtasks are drained *between each phase* (since Node 11+), and `process.nextTick()` runs before regular microtasks.

Practical differences: (1) Node has `setImmediate` (check phase) which has no browser equivalent; (2) `process.nextTick` is Node-only and runs *before* promise microtasks (it has its own queue); (3) Node has no rendering step; (4) `setTimeout(fn, 0)` vs `setImmediate(fn)` ordering is non-deterministic in the main module (depends on whether the poll phase has been entered) but deterministic inside an I/O callback (setImmediate always fires first). Since Node 11+, microtask draining behavior aligns with the browser model — microtasks drain between each individual macrotask-equivalent, not just between loop phases.

See [full page](/js-core/04-event-loop) for the libuv phase diagram and ordering puzzles.
:::

::: details Q13 — Microtask starvation
**Q:** Can microtasks starve the event loop? Demonstrate and explain the consequences.

**A:** Yes. Because the engine drains the microtask queue *exhaustively* before proceeding, a microtask that recursively enqueues another microtask creates an infinite loop that never yields to the next event loop phase:

```typescript
// run: node --experimental-strip-types starvation.ts
// WARNING: this will hang the process
function starve(): void {
  queueMicrotask(starve);
}
starve();

// These will NEVER run:
setTimeout(() => console.log("I am a timer"), 0);
setImmediate(() => console.log("I am immediate"));
```

The consequences are severe: (1) no I/O callbacks fire — the server stops responding to requests; (2) no timers fire — health checks time out, K8s marks the pod as unhealthy; (3) in the browser, no rendering occurs — the page freezes completely; (4) the process does not crash (it is not stuck in an infinite *synchronous* loop — the call stack unwinds between microtasks) so it appears to be alive but is completely unresponsive.

`process.nextTick` is even more dangerous in this regard because its queue is drained before the promise microtask queue, and it was historically unbounded. A recursive `process.nextTick` loop will also prevent promise callbacks from settling.

This is why the Node.js docs recommend `queueMicrotask` over `process.nextTick` for new code, and why long microtask chains in production (e.g., deeply chained `.then()` calls processing large arrays synchronously) can cause latency spikes even without infinite recursion.

See [full page](/js-core/04-event-loop) for starvation examples and `monitorEventLoopDelay`.
:::

---

## Promises & Microtasks

::: details Q14 — The Promise state machine
**Q:** Describe the internal state machine of a Promise. What states can it be in, and what transitions are allowed?

**A:** A Promise has three states: **pending**, **fulfilled**, and **rejected**. The state transition rules are:

1. A Promise starts as *pending*.
2. It can transition from *pending* to *fulfilled* (with a value) — this is called *resolving*.
3. It can transition from *pending* to *rejected* (with a reason) — this is called *rejecting*.
4. Once fulfilled or rejected, it is *settled*. **A settled promise never changes state again.** Calling `resolve()` or `reject()` on an already-settled promise is a silent no-op.

There is a subtle distinction between *resolving* and *fulfilling*. When you call `resolve(x)`, if `x` is a thenable (has a `.then` method), the promise *locks in* to `x`'s state — it waits for `x` to settle and adopts its outcome. The promise is "resolved" (its fate is determined) but not yet "fulfilled" (it may still be pending). This is why a promise resolved with another pending promise remains pending:

```typescript
// run: node --experimental-strip-types states.ts
const inner = new Promise<string>((resolve) => {
  setTimeout(() => resolve("done"), 1000);
});

const outer = new Promise<string>((resolve) => {
  resolve(inner); // outer is "resolved" but not yet "fulfilled"
});

console.log(await Promise.race([outer, Promise.resolve("quick")]));
// "quick" — because outer is still pending (waiting for inner)
```

Internally, a promise stores either its fulfillment value or rejection reason, and maintains a list of *reactions* (the callbacks passed to `.then(onFulfilled, onRejected)`). When the promise settles, each reaction is enqueued as a microtask. If `.then()` is called on an already-settled promise, the reaction is enqueued immediately (still as a microtask — never synchronously).

See [full page](/js-core/05-promises-microtasks) for the full promise internals.
:::

::: details Q15 — Chaining mechanics — why `.then()` always returns a new promise
**Q:** Why does `.then()` return a *new* promise, and what determines that new promise's fate?

**A:** `.then(onFulfilled, onRejected)` creates and returns a *new* promise (call it `p2`) linked to the original (`p1`). This is what makes chaining work — each `.then()` produces a fresh promise whose fate depends on what the handler returns. The rules for `p2`'s resolution are:

1. If the handler returns a *plain value* `v`, `p2` is fulfilled with `v`.
2. If the handler returns a *thenable* (including another promise), `p2` locks in to that thenable's state (adopts its outcome).
3. If the handler *throws*, `p2` is rejected with the thrown value.
4. If the handler for the relevant state is *missing* (e.g., no `onRejected` callback), the state *passes through* — `p2` inherits `p1`'s state. This is why rejections propagate down a chain until they hit a `.catch()`.

```typescript
// run: node --experimental-strip-types chain.ts
const result = await Promise.resolve(1)
  .then((x) => x + 1)        // returns 2 → next promise fulfilled with 2
  .then((x) => {
    throw new Error(`fail: ${x}`);  // throws → next promise rejected
  })
  .catch((err: Error) => err.message) // handles rejection → returns string
  .then((x) => console.log(x));      // "fail: 2"
```

This chain creates four intermediate promises. Each `.then`/`.catch` handler runs as a microtask (not synchronously), which means the chain always yields to the microtask queue between steps — preserving the async contract even if every step is synchronous.

See [full page](/js-core/05-promises-microtasks) for the full chaining model.
:::

::: details Q16 — async/await equivalence with Promises
**Q:** Is `async/await` just syntax sugar? Show the mechanical equivalence between an `async` function and its promise chain form.

**A:** Yes, `async/await` is syntax sugar over promises and generators (conceptually). An `async` function *always* returns a promise. The `await` keyword suspends execution of the async function, scheduling the remainder as a microtask when the awaited value settles. Here is the equivalence:

```typescript
// Async/await version:
async function fetchData(url: string): Promise<string> {
  const response = await fetch(url);
  const text = await response.text();
  return text.toUpperCase();
}

// Equivalent promise chain:
function fetchData(url: string): Promise<string> {
  return fetch(url)
    .then((response) => response.text())
    .then((text) => text.toUpperCase());
}
```

There are mechanical details that differ slightly: (1) an `async` function wraps its return value in a promise even if it is already a promise — but V8 optimizes this with "promise identity" checks; (2) `await` uses the same microtask mechanism as `.then()`, but V8 has a fast-path for awaiting native promises (since V8 7.2 / Node 12) that avoids creating an extra intermediate promise, making `await` *faster* than the equivalent `.then()` chain; (3) error handling differs ergonomically — in async/await you use `try/catch`, which catches both synchronous throws and rejections, while `.catch()` only handles rejections.

A common interview trap: `return await p` inside a `try` block is *not* the same as `return p`. Without `await`, the promise `p` is returned directly, and if it rejects, the rejection bypasses the `try/catch` because the async function has already returned. With `await`, the function suspends, and if `p` rejects, the rejection is caught by the `try` block.

See [full page](/js-core/05-promises-microtasks) for microtask scheduling under async/await.
:::

::: details Q17 — Promise.all vs allSettled vs race vs any
**Q:** Compare `Promise.all`, `Promise.allSettled`, `Promise.race`, and `Promise.any`. When does each short-circuit, and what does each return?

**A:**

| Combinator | Resolves when | Rejects when | Result type |
|---|---|---|---|
| `Promise.all` | *All* promises fulfill | *Any one* rejects (short-circuits immediately) | `T[]` — array of fulfillment values in input order |
| `Promise.allSettled` | *All* promises settle (never short-circuits) | Never rejects | `PromiseSettledResult<T>[]` — array of `{status, value/reason}` |
| `Promise.race` | *First* promise to settle (fulfill or reject) | *First* promise to settle with rejection | Single value or error from the winner |
| `Promise.any` | *First* promise to fulfill | *All* promises reject | Single fulfillment value; rejects with `AggregateError` |

Key nuances: (1) `Promise.all` short-circuits on the *first* rejection — but the remaining promises *keep running* (promises are eager, there is no cancellation). This is a common source of resource leaks if the other promises hold I/O handles. (2) `Promise.allSettled` *(ES2020)* is the only combinator that waits for everything regardless of outcome — ideal for "fire N requests, report results" patterns. (3) `Promise.race` settles on the first *settlement* (win or loss), while `Promise.any` *(ES2021)* only cares about the first *fulfillment* — it swallows rejections until all promises reject. (4) `Promise.any`'s rejection produces an `AggregateError` containing all individual rejection reasons, which you need to handle explicitly:

```typescript
// run: node --experimental-strip-types combinators.ts
try {
  await Promise.any([
    Promise.reject("a"),
    Promise.reject("b"),
  ]);
} catch (err) {
  console.log(err instanceof AggregateError); // true
  console.log((err as AggregateError).errors); // ["a", "b"]
}
```

See [full page](/js-core/05-promises-microtasks) for advanced combinator patterns.
:::

---

## Iterators & Generators

::: details Q18 — The iteration protocol
**Q:** What is the iteration protocol, and what must an object implement to be iterable?

**A:** The iteration protocol has two parts: the *iterable* protocol and the *iterator* protocol.

An object is **iterable** if it has a method at the key `Symbol.iterator` that returns an *iterator*. An **iterator** is an object with a `next()` method that returns `{ value: T, done: boolean }`. When `done` is `true`, the iteration is complete. Optional: an iterator can have a `return()` method (called for early termination, e.g., `break` in a `for...of`) and a `throw()` method (used by generators).

```typescript
// run: node --experimental-strip-types iterable.ts
const range = {
  from: 1,
  to: 3,
  [Symbol.iterator](): Iterator<number> {
    let current = this.from;
    const last = this.to;
    return {
      next(): IteratorResult<number> {
        if (current <= last) {
          return { value: current++, done: false };
        }
        return { value: undefined, done: true };
      },
    };
  },
};

for (const n of range) {
  console.log(n); // 1, 2, 3
}

console.log([...range]); // [1, 2, 3] — spread uses the same protocol
```

The protocol is consumed by: `for...of`, spread (`...`), destructuring (`const [a, b] = iterable`), `Array.from()`, `yield*`, `Promise.all()`, `Map`/`Set` constructors, and more. Arrays, strings, Maps, Sets, and TypedArrays are all built-in iterables.

The key design insight: the protocol separates the *data structure* from the *traversal logic*. The same data structure can have multiple iteration strategies (e.g., a tree can be iterated depth-first or breadth-first) by returning different iterators. And consumer code (`for...of`) does not need to know anything about the data structure's internals.

See [full page](/js-core/06-iterators-generators) for the full iteration protocol specification.
:::

::: details Q19 — Generator two-way communication
**Q:** How do generators support two-way communication, and what is `yield` actually doing mechanically?

**A:** A generator function (declared with `function*`) returns a generator object that implements both the iterator *and* the iterable protocols. The key insight is that `yield` is not just "return a value" — it is a *suspension point* that can also *receive* a value.

When you call `gen.next(value)`, execution resumes from the last `yield` expression, and that `yield` expression *evaluates to* `value`. The first `next()` call starts execution up to the first `yield`; any argument to the first `next()` is discarded (there is no `yield` expression to receive it).

```typescript
// run: node --experimental-strip-types two-way.ts
function* accumulator(): Generator<number, string, number> {
  let total = 0;
  while (true) {
    const input: number = yield total; // yield sends total out, receives input
    if (input < 0) return `Final: ${total}`; // return sets done: true
    total += input;
  }
}

const gen = accumulator();
console.log(gen.next());      // { value: 0, done: false } — first yield, argument ignored
console.log(gen.next(10));    // { value: 10, done: false } — yield evaluates to 10
console.log(gen.next(20));    // { value: 30, done: false }
console.log(gen.next(-1));    // { value: "Final: 30", done: true }
```

Mechanically, the engine saves the generator's execution context (local variables, instruction pointer) when it hits `yield`, and restores it on the next `.next()` call. This is *coroutine-style* concurrency — the generator does not run on a separate thread; it cooperatively yields control. `gen.throw(err)` resumes by making the `yield` expression throw (allowing the generator to handle errors internally), and `gen.return(val)` forces the generator to complete as if it hit a `return` statement at the `yield` point.

See [full page](/js-core/06-iterators-generators) for generator internals and use cases.
:::

::: details Q20 — Async generators and their use case
**Q:** What problem do async generators solve that regular generators and async functions alone cannot?

**A:** Regular generators produce values *synchronously* — each `next()` call returns `{ value, done }` immediately. Async functions handle asynchronous operations but produce only a *single* value (the promise's resolution). Async generators combine both: they produce a *sequence* of values where each value may require asynchronous work to produce.

An async generator function (`async function*`) can use both `yield` and `await`. Each call to `next()` returns a *promise* that resolves to `{ value, done }`. They are consumed with `for await...of`:

```typescript
// run: node --experimental-strip-types async-gen.ts
async function* paginatedFetch(url: string): AsyncGenerator<string[]> {
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const response = await fetch(`${url}?page=${page}`);
    const data = await response.json() as { items: string[]; hasMore: boolean };
    yield data.items;    // yield a page of results
    hasMore = data.hasMore;
    page++;
  }
}

// Consumer processes pages as they arrive — no need to load everything into memory
// for await (const items of paginatedFetch("https://api.example.com/data")) {
//   console.log(`Got ${items.length} items`);
// }
```

The key use cases are: (1) **paginated API consumption** — fetch and yield pages on demand; (2) **streaming data processing** — read from a readable stream (Node streams implement `Symbol.asyncIterator`), transform, and yield results; (3) **real-time event sequences** — SSE events, WebSocket messages, or database change streams where each event arrives asynchronously. Without async generators you would need to either collect all results into memory first (wasteful), use callbacks/EventEmitter (loss of backpressure semantics), or build a complex state machine manually.

See [full page](/js-core/06-iterators-generators) for async generator patterns and backpressure.
:::

---

## Memory & GC

::: details Q21 — V8's generational garbage collection
**Q:** Explain V8's generational GC strategy. Why is it generational, and what are the two spaces?

**A:** V8's GC is based on the *generational hypothesis*: most objects die young. Empirically, the majority of allocations become unreachable almost immediately (temporary variables, intermediate results, short-lived closures). Separating objects by age allows the engine to collect the short-lived ones frequently and cheaply, and the long-lived ones infrequently.

V8 divides the heap into two main generations:

**Young generation (nursery/new space):** Small (typically 1-8 MB per semi-space), collected by the **Scavenger** (a semi-space copying collector). It divides new space into two halves: "from-space" and "to-space." Allocation happens in from-space via *bump pointer* (extremely fast — just increment a pointer). When from-space fills up, the Scavenger traces live objects from roots, copies them to to-space, and then swaps the spaces. Dead objects are not touched — their memory is reclaimed when the spaces swap. Objects that survive two Scavenge cycles are *promoted* (tenured) to old space. This collection is fast (sub-millisecond for small heaps) but stops the world.

**Old generation (old space):** Much larger (up to `--max-old-space-size`, default ~4 GB on 64-bit). Collected by **Major GC (Mark-Sweep-Compact)**, which runs less frequently. It has three phases: *mark* (trace reachable objects from roots, mark them), *sweep* (reclaim unmarked memory, add to free lists), and *compact* (move objects to reduce fragmentation). V8 performs most marking *concurrently* and *incrementally* (interleaved with JavaScript execution) to reduce pause times, but compaction requires a stop-the-world pause.

The practical implication for Node.js: short-lived request-scoped objects are cheap (collected by Scavenger). Long-lived objects (caches, connection pools, singletons) go to old space and only add GC cost during major collections. Memory leaks hurt because they grow old space, making major GC pauses longer and more frequent.

See [full page](/js-core/07-memory-gc) for GC tuning flags and heap snapshot analysis.
:::

::: details Q22 — WeakRef and FinalizationRegistry
**Q:** What are `WeakRef` and `FinalizationRegistry`, and when should you (and should you not) use them?

**A:** `WeakRef` *(ES2021)* holds a *weak reference* to an object — a reference that does not prevent garbage collection. You access the target via `.deref()`, which returns the object if it is still alive or `undefined` if it has been collected.

`FinalizationRegistry` lets you register a callback that runs *after* an object has been garbage collected. You register objects with a "held value" (typically an identifier or resource handle), and when the object is collected, the callback receives the held value.

```typescript
// run: node --experimental-strip-types weakref.ts
const registry = new FinalizationRegistry((heldValue: string) => {
  console.log(`Object ${heldValue} was collected`);
});

let obj: { data: string } | undefined = { data: "important" };
const weakRef = new WeakRef(obj);
registry.register(obj, "my-object");

obj = undefined; // remove strong reference

// At some future point after GC, deref() returns undefined
// and the finalization callback fires
```

**When to use:** caches where you want to keep objects only as long as something else needs them (WeakRef-based caches), cleaning up external resources (file handles, native memory) tied to GC'd objects (FinalizationRegistry), or observability/diagnostics.

**When NOT to use (critical):** never rely on finalization for correctness. The spec provides *zero* guarantees about *when* or *if* the finalizer will run. The GC may not run at all before the process exits. Finalizers may run in any order, at any time, or never. They are a last-resort safety net, not a resource management strategy. For deterministic cleanup, use explicit `close()`/`dispose()` methods or the `using`/`Symbol.dispose` pattern *(ES2024 Explicit Resource Management)*.

See [full page](/js-core/07-memory-gc) for WeakRef-based cache implementations.
:::

::: details Q23 — Common memory leak patterns in Node.js
**Q:** Name three common memory leak patterns in Node.js applications and explain the mechanism behind each.

**A:**

**1. Unbounded caches or Maps:** The simplest leak. A `Map` or plain object used as a cache without eviction grows indefinitely. Each entry is a strong reference, so the values are never GC'd. The fix is to use an LRU cache with a size limit, or `WeakRef`-based caching, or TTL-based eviction:

```typescript
// Leak: grows forever
const cache = new Map<string, object>();
function process(id: string, data: object): void {
  cache.set(id, data); // never deleted
}
```

**2. Unremoved event listeners:** Calling `.on()` or `.addEventListener()` without a corresponding `.off()` / `.removeEventListener()` accumulates closures. Each listener closure retains its entire scope chain. In a server that creates listeners per request (e.g., listening for `'close'` on a response), failing to clean up leaks one closure per request. Node emits a warning at 11 listeners (the `MaxListenersExceededWarning`), which is a diagnostic signal, not a limit.

**3. Closures retaining large scopes (see Q6):** A function closes over more than it needs because V8 allocates the entire context object for the scope. The retained variables may include large buffers, database result sets, or response objects that should have been freed. This is especially insidious with long-lived callbacks (event handlers, interval callbacks, stream transform functions) that accidentally capture a large outer variable.

**Bonus — Detached DOM nodes (browser) / Unreferenced Timers:** `setInterval` callbacks retain their closure and are never GC'd until `clearInterval` is called. A forgotten interval that references a large data structure is a steady leak.

The diagnostic approach: take two heap snapshots separated by a known workload (e.g., 1000 requests), compare retained sizes, and look for objects whose count grows linearly. V8's `--inspect` with Chrome DevTools' "Comparison" view makes this straightforward.

See [full page](/js-core/07-memory-gc) for heap snapshot walkthroughs and leak detection.
:::

---

## ES Modules

::: details Q24 — Live bindings vs CJS value copies
**Q:** What does "live bindings" mean in ESM, and how does it differ from CommonJS's behavior?

**A:** In ESM, when you `import { count } from './counter.js'`, you do not receive a *copy* of the value. You receive a *live read-only binding* — a reference to the variable slot in the exporting module's scope. If the exporting module mutates `count`, every importer sees the updated value immediately.

In CommonJS, `module.exports` creates an object, and `require()` returns that object (or a copy of its primitive properties). If the exporter later changes a primitive (`exports.count = 5` after `exports.count = 0`), importers who destructured (`const { count } = require(...)`) still see the old value — they captured a *snapshot*.

```typescript
// counter.ts (ESM)
export let count = 0;
export function increment(): void { count++; }

// main.ts (ESM)
// run: node --experimental-strip-types main.ts
import { count, increment } from './counter.ts';

console.log(count);   // 0
increment();
console.log(count);   // 1 — live binding, sees the mutation

// In CJS equivalent:
// const { count, increment } = require('./counter');
// console.log(count); // 0
// increment();
// console.log(count); // 0 — still 0, got a copy of the primitive
```

This is possible because ESM is *statically analyzable* — the engine knows all import/export bindings at parse time (before execution) and can wire up direct references to the exporter's variable slots. CJS is *dynamic* — `require()` runs at execution time and returns a plain object, so the binding is just an ordinary variable assignment.

The "read-only" part means importers cannot reassign the binding (`count = 5` throws a `TypeError`). Only the exporting module can mutate its own exports. This design prevents confusing bidirectional mutation while still allowing modules to communicate state changes through function calls.

See [full page](/js-core/08-es-modules) for ESM resolution and the module graph.
:::

::: details Q25 — Top-level await and its impact
**Q:** What is top-level await (TLA), and what happens to modules that import a module using TLA?

**A:** Top-level await *(ES2022)* allows the `await` keyword at the module scope — outside any `async` function. Before TLA, module-level async initialization required workarounds (IIFEs, exported promises).

```typescript
// db.ts — uses top-level await
// run: node --experimental-strip-types db.ts
const connection = await createDatabaseConnection();
export { connection };
```

The critical implication is for the **module graph**. ESM modules are evaluated in post-order (dependencies first). When the engine encounters a TLA in a module, that module's evaluation *pauses* until the awaited promise settles. **Every module that imports (directly or transitively) from a TLA module also waits.** The module becomes an *async module*, and its evaluation returns a promise rather than completing synchronously.

The engine handles this by treating the module evaluation as an async function internally. Sibling modules that do *not* depend on the TLA module can still evaluate in parallel — the dependency graph determines what blocks.

**Consequences:** (1) A slow TLA (e.g., fetching config from a remote service) delays the entire import chain. If your entry point transitively depends on a module with a 3-second TLA, your application takes at least 3 seconds to start. (2) Circular dependencies involving TLA can deadlock (module A awaits something that depends on module B, which imports from A — but A has not finished evaluating). (3) TLA only works in ESM — it is a syntax error in CJS. (4) Bundlers (webpack, Rollup) must handle TLA specially, and not all configurations support it.

The design philosophy: TLA makes modules behave like async functions — their consumers do not need to know whether the module uses await internally. The cost is that static analysis of startup time becomes harder, and the "modules are synchronous singletons" mental model no longer holds universally.

See [full page](/js-core/08-es-modules) for module evaluation order and TLA pitfalls.
:::
