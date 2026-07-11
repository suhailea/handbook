---
title: Iterators, Generators & Async Generators
outline: deep
---

# Iterators, Generators & Async Generators

<Badge type="tip" text="Interview: High" /> <Badge type="warning" text="Prereqs: Closures, Promises & Microtasks" />

## 🗣️ In Plain English

::: tip In Plain English
Think about the difference between a buffet and a vending machine.

An array is a buffet. Every dish is prepared and laid out on the table before anyone starts eating. That is convenient, but it takes up the entire table even if you only want a salad.

A generator is a vending machine. It holds a menu of items, but nothing gets prepared until you walk up and press the button. You get one item, and the machine sits idle until you press the button again. It never wastes ingredients on food nobody ordered. If you walk away after two items, the remaining items are never made at all.

Now imagine a vending machine that needs to cook each item fresh — you press the button, wait a moment, and out comes a hot meal. That is an async generator. It still produces one item at a time, but each item involves waiting (like fetching data from a server or reading from a file).

The **iteration protocol** is the agreement between the vending machine and the customer. The machine promises to have a "next" button. Each press of the button returns an item and a sign saying whether the machine is empty. Any code that knows how to press the button (`for...of`, spread, destructuring) can work with any machine that follows this agreement — arrays, maps, sets, strings, or your own custom creations.

This protocol is what makes JavaScript's iteration composable. You can write a vending machine (generator) that fetches pages of data from an API, and plug it into a `for await...of` loop that processes each page, without ever holding the entire dataset in memory.
:::

## ⚙️ Under the Hood

### The Iteration Protocol

Every iterable object must have a `Symbol.iterator` method that returns an **iterator**. An iterator is any object with a `next()` method that returns `{ value, done }`.

```ts
// run: node --experimental-strip-types demo.ts

const range = {
  from: 1,
  to: 5,

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
  console.log(n); // 1, 2, 3, 4, 5
}

// Spread also consumes iterables
console.log([...range]); // [1, 2, 3, 4, 5]
```

### Built-in Iterables

| Type        | `Symbol.iterator` | Yields                        |
|-------------|-------------------|-------------------------------|
| `Array`     | Yes               | Element values                |
| `String`    | Yes               | Unicode code points           |
| `Map`       | Yes               | `[key, value]` pairs          |
| `Set`       | Yes               | Values                        |
| `TypedArray`| Yes               | Element values                |
| `arguments` | Yes               | Argument values               |
| `NodeList`  | Yes               | DOM nodes                     |
| Plain `{}`  | **No**            | Not iterable by default       |

### `for...of` vs `for...in`

| Feature      | `for...of`                          | `for...in`                              |
|--------------|-------------------------------------|-----------------------------------------|
| Calls        | `Symbol.iterator`                   | Enumerates enumerable property **keys** |
| Works on     | Iterables (array, map, set, string) | Any object                              |
| Includes inherited | No                             | Yes (prototype chain)                   |
| Order        | Iteration order of the iterable     | Insertion order (with numeric keys first)|

```ts
// run: node --experimental-strip-types demo.ts

const arr = ["a", "b", "c"];
(arr as any).extra = "oops";

// for...of iterates VALUES of the iterable
for (const v of arr) console.log(v);       // "a", "b", "c"

// for...in iterates enumerable KEYS (including non-index properties)
for (const k in arr) console.log(k);       // "0", "1", "2", "extra"
```

### Generator Functions

A generator function (`function*`) returns a generator object that conforms to both the iterable and iterator protocols.

```ts
// run: node --experimental-strip-types demo.ts

function* fibonacci(): Generator<number, void, unknown> {
  let a = 0;
  let b = 1;
  while (true) {
    yield a;
    [a, b] = [b, a + b];
  }
}

// Take the first 10 Fibonacci numbers
const fib = fibonacci();
const first10: number[] = [];
for (const n of fib) {
  first10.push(n);
  if (first10.length === 10) break; // generator is paused, not exhausted
}
console.log(first10); // [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
```

### Two-Way Communication

`yield` is an expression that can receive a value from the caller via `next(value)`.

```ts
// run: node --experimental-strip-types demo.ts

function* accumulator(): Generator<number, void, number> {
  let total = 0;
  while (true) {
    const input: number = yield total; // yield current total, receive next input
    total += input;
  }
}

const acc = accumulator();
console.log(acc.next());       // { value: 0, done: false }  — first next() starts the generator
console.log(acc.next(10));     // { value: 10, done: false }
console.log(acc.next(20));     // { value: 30, done: false }
console.log(acc.next(5));      // { value: 35, done: false }
```

### `return()` and `throw()`

```ts
// run: node --experimental-strip-types demo.ts

function* managed(): Generator<number, string, unknown> {
  try {
    yield 1;
    yield 2;
    yield 3;
  } finally {
    console.log("Cleanup runs on return() or throw()");
  }
  return "done";
}

const g1 = managed();
console.log(g1.next());       // { value: 1, done: false }
console.log(g1.return("early")); // Cleanup runs → { value: "early", done: true }

const g2 = managed();
g2.next();
try {
  g2.throw(new Error("injected")); // Cleanup runs → throws "injected"
} catch (e) {
  console.log((e as Error).message); // "injected"
}
```

### Lazy Evaluation

Generators produce values on demand. This makes them ideal for large or infinite sequences.

```ts
// run: node --experimental-strip-types demo.ts

function* naturals(): Generator<number> {
  let n = 1;
  while (true) yield n++;
}

function* map<T, U>(iter: Iterable<T>, fn: (x: T) => U): Generator<U> {
  for (const x of iter) yield fn(x);
}

function* filter<T>(iter: Iterable<T>, fn: (x: T) => boolean): Generator<T> {
  for (const x of iter) {
    if (fn(x)) yield x;
  }
}

function* take<T>(iter: Iterable<T>, n: number): Generator<T> {
  let count = 0;
  for (const x of iter) {
    if (count++ >= n) return;
    yield x;
  }
}

// Compose lazily: no intermediate arrays
const result = [
  ...take(
    filter(
      map(naturals(), (n) => n * n),
      (n) => n % 2 === 1
    ),
    5
  ),
];
console.log(result); // [1, 9, 25, 49, 81]
```

### Async Iterators and `for await...of`

The async iteration protocol uses `Symbol.asyncIterator`. The `next()` method returns a `Promise<{ value, done }>`.

```ts
// run: node --experimental-strip-types demo.ts

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function* countdownAsync(from: number): AsyncGenerator<number> {
  for (let i = from; i > 0; i--) {
    await delay(100); // simulate async work
    yield i;
  }
}

(async () => {
  for await (const n of countdownAsync(3)) {
    console.log(n); // 3, 2, 1 (each after ~100ms)
  }
})();
```

### Async Generators: Real-World Paginated API

```ts
// run: node --experimental-strip-types demo.ts

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// Simulate a paginated API
async function fetchPage(cursor: string | null): Promise<Page<string>> {
  const pages: Record<string, Page<string>> = {
    start: { items: ["a", "b"], nextCursor: "p2" },
    p2:    { items: ["c", "d"], nextCursor: "p3" },
    p3:    { items: ["e"],      nextCursor: null  },
  };
  return pages[cursor ?? "start"]!;
}

async function* paginate<T>(
  fetchFn: (cursor: string | null) => Promise<Page<T>>
): AsyncGenerator<T> {
  let cursor: string | null = null;
  do {
    const page = await fetchFn(cursor);
    for (const item of page.items) {
      yield item;
    }
    cursor = page.nextCursor;
  } while (cursor !== null);
}

(async () => {
  const items: string[] = [];
  for await (const item of paginate(fetchPage)) {
    items.push(item);
  }
  console.log(items); // ["a", "b", "c", "d", "e"]
})();
```

### Iterator Helpers (Stage 3+ Proposal, Shipping in V8)

Modern engines are shipping built-in methods on iterators, eliminating the need for manual `map`/`filter` generator wrappers.

```ts
// run: node --experimental-strip-types demo.ts
// Requires Node 22+

const squares = Iterator.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  .filter((n: number) => n % 2 === 0)
  .map((n: number) => n * n)
  .take(3)
  .toArray();

console.log(squares); // [4, 16, 36]
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Forgetting that generators are stateful and single-use.**
A generator object can only be iterated once. Spreading it twice gives an empty array the second time. If you need multiple iterations, create a new generator each time or wrap the generator function in an iterable object with `[Symbol.iterator]()`.

**2. Unhandled `return()` skipping cleanup.**
When a `for...of` loop `break`s, it calls `return()` on the iterator. If your generator does not have a `try/finally`, cleanup code after `yield` never runs — file handles stay open, connections linger.

**3. Async generators and backpressure blindness.**
`for await...of` calls `next()` immediately after consuming each value. If the producer is faster than the consumer, there is no built-in backpressure. Pair with Node.js streams or manual flow control for high-throughput pipelines.

**4. `yield` inside a callback does not work.**
`yield` can only appear directly inside the generator function body. You cannot `yield` from inside `Array.forEach`, `.map()`, or any callback. Use a `for...of` loop instead.
:::

## 🎯 Checkpoint

::: details Question 1 — Protocol Basics
**Q:** What must an object have to be usable in a `for...of` loop?

**A:** It must implement the iterable protocol by having a `[Symbol.iterator]()` method that returns an object conforming to the iterator protocol (i.e., an object with a `next()` method that returns `{ value, done }`). For `for await...of`, it must implement `[Symbol.asyncIterator]()` where `next()` returns a `Promise<{ value, done }>`.
:::

::: details Question 2 — Two-Way Communication
**Q:** In a generator, what does the expression `const x = yield 42` evaluate to?

**A:** It evaluates to whatever value the caller passes into the subsequent `next(value)` call. The `yield 42` sends `42` out to the caller, then the generator pauses. When the caller calls `gen.next("hello")`, the generator resumes and `x` is assigned `"hello"`. The very first `next()` call cannot deliver a value to a `yield` because no `yield` is waiting yet — its argument is discarded.
:::

::: details Question 3 — Lazy vs Eager
**Q:** Why is chaining generator-based `map` and `filter` more memory-efficient than chaining `Array.prototype.map` and `Array.prototype.filter`?

**A:** Array methods are eager: each call creates a full intermediate array in memory. For a million-element input, `arr.map(f).filter(g)` allocates two arrays of up to one million elements. Generator-based pipelines are lazy: values flow one at a time through the entire chain. No intermediate arrays are created. Only one element is in flight at any point, so memory usage is O(1) regardless of input size.
:::

## Key Mental Models

- **Protocol over type.** Iteration in JavaScript is duck-typed — any object with the right shape is iterable, regardless of inheritance.
- **Lazy by default.** Generators compute nothing until `next()` is called; this is the foundation of efficient streaming.
- **Two-way channel.** `yield` is not just an output — it is a suspension point that can also receive input, making generators coroutine-like.
- **Async generators unify async + lazy.** They let you `await` inside a lazy sequence, bridging asynchronous I/O with pull-based consumption.
- **Single-pass consumption.** An iterator is exhausted after one traversal; design accordingly.

## Related

- [Promises & Microtasks](./05-promises-microtasks)
- [Async Iteration vs EventEmitter](/nodejs/module-03/04-async-iteration-vs-eventemitter)
- [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure)
