---
title: "Async Iteration vs EventEmitter"
outline: deep
---

# Async Iteration vs EventEmitter

| Interview weight | Node version | Prerequisites |
|---|---|---|
| 🔥🔥 | `EventEmitter` since Node 0.1; `events.on()` async iterator since Node 13.6; `AbortSignal` support since Node 16 | [Promise Internals](./01-promise-internals), [AbortController & AbortSignal](./03-abort-controller) |

## 🗣️ In Plain English

::: tip In Plain English
Think of two ways to get information: a radio station and a library.

A **radio station** broadcasts live. If three people have their radios on, all three hear the same song at the same time. But if nobody is tuned in, the broadcast still happens -- it just vanishes into the air. Nobody asked for it; the station pushed it out. That is the EventEmitter model. The producer decides when to send data. Listeners either catch it in the moment or miss it entirely.

A **library** works the opposite way. Books sit on the shelf, waiting. You walk in, pick up a book, read it at your own pace, then go back for the next one. The library does not throw books at you. You pull them when you are ready. That is async iteration. The consumer controls the pace. If the consumer is slow, the producer simply waits -- no data is lost, no one is overwhelmed.

The radio model shines when you need **fan-out** -- one event, many listeners. A user logs in and you need to update analytics, send a welcome email, and refresh a cache, all at once. Each listener does its own thing independently. An EventEmitter handles this naturally because `emit()` calls every registered listener.

The library model shines when you need **backpressure** -- processing one thing at a time, carefully, without being flooded. Reading a large file line by line, processing database rows, consuming a message queue. If your processing is slower than the source, you want the source to slow down and wait. Async iteration gives you this for free: the `for await` loop does not ask for the next item until the current one is done.

Here is the key surprise that trips people up: `emit()` is synchronous. When you call `emitter.emit('data', chunk)`, it calls every listener right then and there, one after another, and it does NOT await any promises they return. If a listener is an async function, the emitter has no idea. The returned promise floats away, and if it rejects, you get an unhandled promise rejection -- not an `'error'` event. This is the single most common mistake with EventEmitter.

When in doubt: if you have one consumer processing a stream of things in order, use async iteration. If you have multiple independent consumers reacting to the same event, use EventEmitter.
:::

## ⚙️ Under the Hood

### Push Model: EventEmitter Fundamentals

`EventEmitter` is the backbone of Node's event system. Streams, HTTP servers, child processes -- all extend it. The core API is simple: `.on()` registers a listener, `.emit()` fires an event synchronously.

```ts
// run: node --experimental-strip-types demo-emitter-basics.ts

import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();

emitter.on('request', (url: string) => {
  console.log(`[Logger] ${url}`);
});

emitter.on('request', (url: string) => {
  console.log(`[Metrics] +1 for ${url}`);
});

// emit() is synchronous — both listeners run before this line completes
emitter.emit('request', '/api/users');

console.log('All listeners have finished');
```

Output order is deterministic: listeners fire in the order they were registered, synchronously, within the same tick.

### Synchronous emit() -- The Surprise

Because `emit()` is synchronous, if a listener throws, subsequent listeners never run:

```ts
// run: node --experimental-strip-types demo-sync-emit.ts

import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();

emitter.on('data', () => {
  console.log('Listener 1');
});

emitter.on('data', () => {
  throw new Error('Listener 2 explodes');
});

emitter.on('data', () => {
  console.log('Listener 3 — never runs');
});

try {
  emitter.emit('data');
} catch (err) {
  console.log('Caught:', (err as Error).message);
}
```

Listener 3 never executes. The thrown error propagates synchronously out of `emit()`.

### The 'error' Event Magic

Node enforces a special rule: if you emit `'error'` and no listener is registered for it, Node throws the error, which usually crashes the process. This is intentional -- silent error swallowing is worse than crashing.

```ts
// run: node --experimental-strip-types demo-error-event.ts

import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();

// No 'error' listener registered!
// This will throw and crash:
try {
  emitter.emit('error', new Error('database connection lost'));
} catch (err) {
  console.log('Caught the unhandled error event:', (err as Error).message);
}

// Fix: always register an 'error' listener
emitter.on('error', (err: Error) => {
  console.log('Handled gracefully:', err.message);
});

emitter.emit('error', new Error('database connection lost'));
```

### The Async-Listener Trap

This is the most dangerous pattern with EventEmitter. When you pass an `async` function as a listener, the EventEmitter calls it, gets back a Promise, and **discards it**. If that promise rejects, it becomes an unhandled promise rejection -- it does NOT trigger the `'error'` event.

```ts
// run: node --experimental-strip-types demo-async-trap.ts

import { EventEmitter } from 'node:events';

const emitter = new EventEmitter();

// BAD: async listener — emitter ignores the returned promise
emitter.on('job', async (data: string) => {
  console.log('Processing:', data);
  // If this throws, it becomes an unhandled rejection
  // NOT an 'error' event
});

// GOOD: wrap async work and forward errors
emitter.on('job:safe', async (data: string) => {
  try {
    console.log('Processing safely:', data);
    // async work here
  } catch (err) {
    emitter.emit('error', err);
  }
});

emitter.on('error', (err: Error) => {
  console.log('Error caught via emit:', err.message);
});

emitter.emit('job', 'task-1');
emitter.emit('job:safe', 'task-2');
```

| Pattern | Promise rejection handling | Safe? |
|---|---|---|
| `emitter.on('x', async () => { ... })` | Unhandled rejection | No |
| `emitter.on('x', async () => { try { ... } catch(e) { emitter.emit('error', e) } })` | Routed to `'error'` event | Yes |
| `events.on(emitter, 'x')` with `for await` | Rejects the async iterator | Yes |

### Pull Model: Async Iteration

The `for await...of` loop pulls values one at a time. The consumer calls `.next()` on the async iterator, waits for the promise to resolve, processes the value, then calls `.next()` again. This creates natural backpressure -- the producer cannot outpace the consumer.

```ts
// run: node --experimental-strip-types demo-async-iter.ts

async function* generateItems(): AsyncGenerator<string> {
  const items = ['alpha', 'beta', 'gamma'];
  for (const item of items) {
    console.log(`  [producer] yielding ${item}`);
    yield item;
    // Execution pauses here until the consumer calls .next()
  }
}

for await (const item of generateItems()) {
  console.log(`  [consumer] processing ${item}`);
  // Simulate slow consumer
  await new Promise((r) => setTimeout(r, 100));
}
```

The producer yields an item and then **suspends** until the consumer is ready for the next one. No buffering, no overflow.

### Bridging: `events.on()` -- EventEmitter to AsyncIterator

The `on()` function from `node:events` converts an EventEmitter into an async iterator. It buffers events internally if the consumer is slower than the producer, and it properly surfaces `'error'` events as rejections on the iterator.

```ts
// run: node --experimental-strip-types demo-events-on.ts

import { EventEmitter } from 'node:events';
import { on } from 'node:events';

const emitter = new EventEmitter();

// Produce events every 100ms
let count = 0;
const interval = setInterval(() => {
  count++;
  if (count <= 5) {
    emitter.emit('tick', count);
  } else {
    clearInterval(interval);
    // Signal completion by emitting a known "done" event
    emitter.emit('close');
  }
}, 100);

// Consume as async iterator with AbortSignal for clean teardown
const ac = new AbortController();

setTimeout(() => ac.abort(), 700); // stop after 700ms

try {
  for await (const [n] of on(emitter, 'tick', { signal: ac.signal })) {
    console.log('Tick:', n);
  }
} catch (err) {
  if ((err as Error).name === 'AbortError') {
    console.log('Iterator stopped cleanly via AbortSignal');
  }
}
```

Key details of `events.on()`:
- Returns an `AsyncIterableIterator`. Each yielded value is the **arguments array** passed to `emit()` (hence the destructuring `[n]` above).
- If the emitter emits `'error'`, the iterator rejects with that error.
- Accepts an `AbortSignal` via `{ signal }` for clean teardown (Node 16+).
- Buffers events internally if the consumer is slow. This means it does **not** exert true backpressure on the producer -- the emitter can still fire events faster than you consume them. The buffer grows. For real backpressure, use Readable streams.

### Streams Are Async Iterables

Since Node 10, all Readable streams implement the async iterable protocol. This means you can `for await` over any stream:

```ts
// run: node --experimental-strip-types demo-stream-iter.ts

import { createReadStream } from 'node:fs';

const stream = createReadStream(import.meta.filename, { encoding: 'utf8' });

let lineCount = 0;
for await (const chunk of stream) {
  lineCount += (chunk as string).split('\n').length - 1;
}

console.log(`This file has roughly ${lineCount} lines`);
```

Unlike `events.on()`, Readable streams DO exert backpressure through the stream's internal buffering and highWaterMark mechanism. When the consumer is slow, the stream pauses reading from the source.

### When to Use Which

| Criterion | EventEmitter | Async Iteration |
|---|---|---|
| Consumer count | Multiple (fan-out) | Single (serial) |
| Backpressure | None built-in | Natural |
| Data loss if no listener | Yes -- event vanishes | No -- producer waits |
| Error handling | `'error'` event or process crash | `try/catch` around `for await` |
| Ordering guarantee | Listeners fire in registration order | Items processed sequentially |
| Best for | Notifications, hooks, pub/sub | Stream processing, pipelines |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Async listeners silently swallow rejections.**
**Symptom:** You have an `async` function as an event listener. It throws. No `'error'` event fires. Eventually, Node logs an `UnhandledPromiseRejection` warning (or crashes in newer Node versions with `--unhandled-rejections=throw`).
**Root cause:** `emit()` calls the listener synchronously, receives a Promise, and discards it. The rejection has nowhere to go.
**Diagnosis:** Audit all `.on()` calls for `async` handlers. Wrap them in `try/catch` and forward errors to `emitter.emit('error', err)`.

**2. Missing `'error'` listener crashes the process.**
**Symptom:** Process exits with an uncaught error like `Error [ERR_UNHANDLED_ERROR]`.
**Root cause:** Someone called `emitter.emit('error', err)` but no `'error'` listener was registered. Node's special-case behavior throws the error.
**Diagnosis:** Always register an `'error'` listener on every EventEmitter you use in production, even if it just logs and moves on.

**3. `events.on()` buffer grows without bound.**
**Symptom:** Memory usage climbs steadily when consuming a fast EventEmitter via `for await (const x of on(emitter, 'data'))`.
**Root cause:** `events.on()` buffers events internally. If the producer emits faster than the consumer processes, the buffer grows unbounded. Unlike Readable streams, there is no highWaterMark.
**Diagnosis:** Monitor buffer size. If the producer is too fast, switch to a Readable stream which has built-in backpressure, or throttle the producer.

**4. Listener throws and breaks sibling listeners.**
**Symptom:** You have three listeners on `'data'`. The second one throws. The third never executes.
**Root cause:** `emit()` is synchronous. An uncaught throw in any listener aborts the remaining listeners for that event.
**Diagnosis:** Wrap each listener body in `try/catch` if independent execution matters.
:::

## 🎯 Checkpoint

::: details Question 1 — Synchronous emit
**Q:** If you call `emitter.emit('data', chunk)` with three registered listeners, in what order do they execute? What happens if the second listener throws?

**A:** Listeners execute synchronously in the order they were registered (first, second, third). If the second listener throws, the exception propagates synchronously out of `emit()`. The third listener never runs. This is because `emit()` is a synchronous loop over the listener array -- it does not wrap each call in a try/catch.
:::

::: details Question 2 — The async-listener trap
**Q:** You register `emitter.on('job', async (data) => { await processJob(data); })`. If `processJob` throws, does the `'error'` event fire? What happens instead?

**A:** No, the `'error'` event does not fire. The EventEmitter calls the listener synchronously, receives a Promise, and discards it. When `processJob` rejects, the promise becomes an unhandled promise rejection. In newer Node versions with `--unhandled-rejections=throw`, this crashes the process. To fix it, wrap the async body in `try/catch` and call `emitter.emit('error', err)` in the catch block.
:::

::: details Question 3 — Backpressure differences
**Q:** You convert an EventEmitter to an async iterator using `events.on(emitter, 'data')`. Does this give you backpressure? How does this differ from iterating over a Readable stream?

**A:** `events.on()` does NOT give you true backpressure. It buffers events internally -- if the producer emits faster than the consumer processes, the buffer grows without bound. A Readable stream, on the other hand, has a `highWaterMark`. When the internal buffer is full, the stream pauses reading from the source, exerting backpressure all the way to the data origin. For high-throughput scenarios, prefer Readable streams over `events.on()`.
:::

## Key Mental Models

- **Push vs Pull.** EventEmitter pushes to all listeners simultaneously; async iteration lets the consumer pull one item at a time.
- **`emit()` is synchronous.** All listeners run in the same tick, in registration order. A throw in one listener kills the rest.
- **Async listeners are invisible to EventEmitter.** The returned promise is discarded. Rejections become unhandled -- always wrap in try/catch.
- **`events.on()` bridges the gap but does not add backpressure.** It buffers internally. For real backpressure, use Readable streams.
- **Fan-out = EventEmitter, serial pipeline = async iteration.** Pick the model that matches your consumer pattern.

## Related

- [AbortController & AbortSignal](./03-abort-controller)
- [AsyncLocalStorage](./05-async-local-storage)
- [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure)
- [Promises & Microtasks (JS Core)](/js-core/05-promises-microtasks)
