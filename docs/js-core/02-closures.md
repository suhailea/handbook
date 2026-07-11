---
title: Closures
outline: deep
---

# Closures

<Badge type="danger" text="Interview: High" /> <Badge type="info" text="Prereqs: Execution Contexts" />

## 🗣️ In Plain English

::: tip In Plain English
Imagine an employee who leaves a company. Normally, when someone resigns (an outer function returns), their desk is cleared, their badge is deactivated, and their stuff is thrown away. The company reclaims all resources.

But suppose, before leaving, this employee made a copy of a **keycard** that opens one specific filing cabinet on the third floor. That keycard is a **closure**. As long as the ex-employee holds that keycard, the company cannot destroy that filing cabinet -- even though the employee's desk is gone, their email is deleted, and their floor badge no longer works. The filing cabinet stays alive solely because someone, somewhere, still has a key to it.

Now, the company's facilities team (the garbage collector) is smart. They do not keep the *entire third floor* intact just because of one filing cabinet. If the keycard only opens cabinet 3B, they can tear down everything else on that floor and just preserve cabinet 3B. This is what V8 does: it analyzes which variables the closure actually references and only keeps those alive -- not the entire outer scope.

There is one exception. If the ex-employee has a wildcard keycard labeled `eval` -- a card that could potentially open *any* cabinet -- the facilities team has no choice but to preserve the entire floor, because they cannot predict which cabinets might be accessed. This is why `eval` inside a closure defeats V8's dead-variable elimination.

Keycards can also cause trouble. If the ex-employee's keycard inadvertently keeps alive a filing cabinet stuffed with thousands of pages of data they never actually need, that is a **memory leak**. The filing cabinet sits there forever, wasting space, just because a reference exists. In production, this happens when closures in long-lived event listeners or timers accidentally hold references to large objects like DOM trees or data buffers.
:::

## ⚙️ Under the Hood

### What Is a Closure?

A closure is a **function bundled together with its lexical environment**. Concretely, every function object has an internal slot called `[[Environment]]` that points to the environment record of the scope in which the function was *created* (not called).

```ts
// run: node --experimental-strip-types demo.ts

function makeCounter(start: number): () => number {
  let count: number = start; // lives in makeCounter's environment record

  return function increment(): number {
    // increment.[[Environment]] points to makeCounter's env record
    // so `count` is still reachable
    return ++count;
  };
}

const counter = makeCounter(0);
console.log(counter()); // 1
console.log(counter()); // 2
console.log(counter()); // 3
// makeCounter's stack frame is long gone, but `count` persists on the heap
```

### What the Heap Keeps Alive

When `makeCounter` returns, its stack frame is popped. But the environment record containing `count` is **not** freed because `increment.[[Environment]]` still references it. The environment record is allocated on the heap (V8 calls it a "Context" object).

```
increment (function object)
  └── [[Environment]] ──► Environment Record { count: 3 }
                              └── [[OuterEnv]] ──► Global Environment Record
```

### V8's Dead Variable Elimination

V8 performs **scope analysis** at parse time. If a closure only references variable `a` from the outer scope, V8 only captures `a` in the heap-allocated context -- variables `b`, `c`, etc. are discarded when the outer function returns.

```ts
// run: node --experimental-strip-types demo.ts

function efficient(): () => number {
  const kept: number = 42;
  const discarded: string = "x".repeat(1_000_000); // 1MB string

  return () => kept; // only `kept` is captured; `discarded` is GC'd
}

const fn = efficient();
console.log(fn()); // 42
// The 1MB string is eligible for garbage collection immediately
```

**Exception:** if the closure body contains a direct `eval()` call, V8 cannot statically determine which variables will be accessed. It must keep the **entire** environment record alive:

```ts
// run: node --experimental-strip-types demo.ts

function leaky(input: string): () => unknown {
  const kept: number = 42;
  const alsoKept: string = "x".repeat(100); // cannot be eliminated

  return () => eval(input); // eval could access anything
}

const evalFn = leaky("kept + alsoKept.length");
console.log(evalFn()); // 142
```

### Closures in Loops -- The Classic `var` Trap

```ts
// run: node --experimental-strip-types demo.ts

// Problem: all callbacks share the same `i`
const results: number[] = [];
for (var i = 0; i < 3; i++) {
  (function (captured: number) {
    results.push(captured); // IIFE creates a new scope per iteration
  })(i);
}
console.log("IIFE fix:", results); // [0, 1, 2]

// Modern fix: `let` creates a new binding per iteration
const letResults: number[] = [];
for (let j = 0; j < 3; j++) {
  setTimeout(() => letResults.push(j), 0);
}
setTimeout(() => console.log("let fix:", letResults), 50); // [0, 1, 2]
```

Why `let` works: the ECMAScript spec requires the loop to create a **new environment record** for each iteration, copying the current value of `j` into the fresh binding. Each closure captures a distinct binding.

### Common Memory Leak Patterns

```ts
// run: node --experimental-strip-types demo.ts

// Pattern 1: closure retaining a large object via a single reference
function setupHandler(): () => void {
  const largePayload: number[] = new Array(1_000_000).fill(0);

  // The handler only needs the length, but it closes over the entire array
  return () => {
    console.log("Payload length:", largePayload.length);
  };
}

const handler = setupHandler();
handler(); // Payload length: 1000000
// `largePayload` (4MB+) stays in memory as long as `handler` is reachable

// Fix: extract what you need before closing over it
function setupHandlerFixed(): () => void {
  const largePayload: number[] = new Array(1_000_000).fill(0);
  const len: number = largePayload.length; // extract the needed value

  return () => {
    console.log("Payload length:", len);
  };
  // `largePayload` is now eligible for GC after setupHandlerFixed returns
}

const fixedHandler = setupHandlerFixed();
fixedHandler(); // Payload length: 1000000
```

```ts
// run: node --experimental-strip-types demo.ts

// Pattern 2: closures in long-lived listeners (conceptual -- no DOM here)
import { EventEmitter } from "node:events";

const emitter = new EventEmitter();
let listenerCount = 0;

function attachLeak(): void {
  const bigBuffer: Buffer = Buffer.alloc(1024 * 1024); // 1MB

  emitter.on("data", () => {
    // This closure keeps `bigBuffer` alive for the lifetime of the emitter
    listenerCount++;
    void bigBuffer; // reference prevents GC
  });
}

// Each call leaks 1MB that will never be freed until `emitter` is GC'd
attachLeak();
attachLeak();
console.log("Listeners attached:", emitter.listenerCount("data")); // 2
// Fix: use emitter.once(), or remove listeners when done, or avoid closing
// over large objects.
emitter.removeAllListeners("data");
```

### Real-World Uses

#### Factory Functions

```ts
// run: node --experimental-strip-types demo.ts

function createLogger(prefix: string): (msg: string) => void {
  return (msg: string) => console.log(`[${prefix}] ${msg}`);
}

const dbLog = createLogger("DB");
const apiLog = createLogger("API");

dbLog("connected");   // [DB] connected
apiLog("request in"); // [API] request in
```

#### Data Privacy (Module Pattern)

```ts
// run: node --experimental-strip-types demo.ts

function createWallet(initial: number) {
  let balance: number = initial; // truly private -- no way to access directly

  return {
    deposit(amount: number): void {
      if (amount <= 0) throw new Error("Amount must be positive");
      balance += amount;
    },
    getBalance(): number {
      return balance;
    },
  };
}

const wallet = createWallet(100);
wallet.deposit(50);
console.log(wallet.getBalance()); // 150
// (wallet as any).balance === undefined -- no direct access
```

#### Partial Application / Currying

```ts
// run: node --experimental-strip-types demo.ts

function multiply(a: number): (b: number) => number {
  return (b: number) => a * b;
}

const double = multiply(2);
const triple = multiply(3);

console.log(double(5));  // 10
console.log(triple(5));  // 15
```

#### Memoization

```ts
// run: node --experimental-strip-types demo.ts

function memoize<T extends (...args: string[]) => unknown>(
  fn: T
): T {
  const cache = new Map<string, unknown>();

  return ((...args: string[]) => {
    const key = JSON.stringify(args);
    if (cache.has(key)) {
      console.log("  cache hit");
      return cache.get(key);
    }
    console.log("  cache miss");
    const result = fn(...args);
    cache.set(key, result);
    return result;
  }) as T;
}

const slowUpper = memoize((s: string) => s.toUpperCase());
console.log(slowUpper("hello")); // cache miss, "HELLO"
console.log(slowUpper("hello")); // cache hit, "HELLO"
console.log(slowUpper("world")); // cache miss, "WORLD"
```

### Performance Considerations

In modern engines (V8, SpiderMonkey, JavaScriptCore), closures have **negligible overhead**:

| Concern | Reality |
|---------|---------|
| Creation cost | A closure is just a function object + a pointer to the context. Cheap to allocate. |
| Call overhead | No difference from a regular function call after JIT compilation. |
| Memory | Only referenced outer variables are captured (see dead-variable elimination above). |
| GC pressure | Closures add objects to the heap, but modern generational GC handles short-lived closures efficiently. |

The only real performance concern is **unintentional retention** of large objects, which is a correctness issue, not an inherent cost of closures.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Closures in `setInterval` / long-lived timers.**
A closure passed to `setInterval` keeps its entire captured scope alive for the lifetime of the interval. If the closure references a large response object, that memory is pinned until `clearInterval` is called. In server code, forgetting to clear intervals causes steady memory growth that only manifests under sustained load.

**2. Shared mutable state across closures.**
Multiple closures from the same outer function share the *same* environment record. Mutating a captured variable in one closure affects all siblings. This is intentional but frequently surprising, especially in async code where execution order is non-obvious.

**3. Closures in hot loops defeating inlining.**
Creating a new closure on every iteration of a performance-critical loop (e.g., `array.map(() => ...)` inside a tight loop) can prevent V8 from inlining the callback if the closure shape changes (megamorphic call site). In practice this is rarely the bottleneck, but in CPU-bound hot paths it can matter.

**4. Debugging captured variables.**
When a variable is captured by a closure, browser DevTools sometimes show it as `<optimized out>` if the debugger triggers a deoptimization. This makes it harder to inspect closure state during production debugging.
:::

## 🎯 Checkpoint

::: details Question 1 -- Environment Retention
**Q:** In the following code, is `bigString` eligible for garbage collection after `getLength()` is assigned? Why or why not?

```ts
function outer() {
  const bigString = "x".repeat(10_000_000);
  const len = bigString.length;
  return function getLength() { return len; };
}
const getLength = outer();
```

**A:** Yes, `bigString` is eligible for GC. The closure `getLength` only references `len` (a primitive number). V8's scope analysis detects that `bigString` is not referenced by any surviving closure, so it is excluded from the heap-allocated context. Only `len` is captured. The 10MB string can be collected as soon as `outer` returns.
:::

::: details Question 2 -- Shared Mutation
**Q:** What does this code log?

```ts
function makeAdders() {
  let n = 0;
  const add = () => ++n;
  const read = () => n;
  return { add, read };
}
const { add, read } = makeAdders();
add(); add(); add();
console.log(read());
```

**A:** It logs `3`. Both `add` and `read` close over the **same** environment record, sharing the same `n` binding. Each call to `add()` mutates `n` in-place (1, 2, 3). When `read()` is called, it sees the current value `3`. This is the defining characteristic of closures -- they capture **bindings**, not values.
:::

::: details Question 3 -- eval Defeating Optimization
**Q:** Why does using `eval` inside a closure prevent V8 from eliminating unused captured variables?

**A:** `eval` can execute arbitrary code at runtime, including referencing any identifier in scope by name. At parse time, V8 cannot statically determine which variables `eval` will access. Therefore, it must conservatively keep the **entire** environment record alive -- every variable from every enclosing scope -- because any of them could be referenced by the evaluated string. This is why `eval` is sometimes called an "optimization barrier."
:::

## Key Mental Models

- **A closure is a function + a pointer to its birth scope.** The `[[Environment]]` internal slot on every function object points to the environment record where it was created, keeping referenced variables alive on the heap.
- **Closures capture bindings, not values.** Multiple closures from the same scope share the same mutable bindings -- mutations are visible across all of them.
- **V8 only retains what is referenced.** Dead-variable elimination means unused outer variables are freed, unless `eval` is present and forces full retention.
- **Memory leaks from closures are reference leaks.** The closure itself is cheap; the problem is when it inadvertently pins large objects that are no longer needed.
- **`let` in loops creates per-iteration bindings.** This is a spec-level mechanic, not a V8 optimization -- each iteration gets a fresh environment record with a copy of the loop variable.

## Related

- [Execution Contexts](./01-execution-contexts)
- [Memory & GC](./07-memory-gc)
- [Prototypes & `this`](./03-prototypes-this-classes)
