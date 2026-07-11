---
title: "Web Streams vs Node Streams"
outline: deep
---

# Web Streams vs Node Streams

> **Interview weight:** :fire::fire: — Less commonly asked than Node streams, but increasingly relevant as frameworks adopt Web Streams.
> **Node version:** Web Streams API stable since Node 18. `Readable.fromWeb()` / `Readable.toWeb()` stable since Node 20. Examples target Node 22+.
> **Prereqs:** [Streams & Backpressure](./02-streams-backpressure) · [Buffers, TypedArrays & Encodings](./01-buffers-typed-arrays)

## :speaking_head: In Plain English

::: tip In Plain English
Node streams are like a fire hose — the source pushes water at you, and you need to yell "stop!" (backpressure) when you can't handle the flow. Web Streams are more like a water cooler with a lever. Nothing flows until you press the lever, and you only get as much as you ask for. That's the core difference: **push-based** (Node) vs **pull-based** (Web).

With the fire hose (Node streams), the source is in charge. It fires `data` events at you, and you have to manage pausing and resuming. With the water cooler (Web Streams), the consumer is in charge. The stream sits idle until a reader calls `read()`, then the source produces exactly one chunk and goes back to sleep. Backpressure is built into the design — the source never runs ahead of the consumer because it only produces data when asked.

Web Streams come from the browser world, defined by the WHATWG Streams Standard. They're the same API you use in `fetch()` response bodies, service workers, and the Compression Streams API. Node adopted them wholesale starting in Node 16, and they're now stable.

There are three types: `ReadableStream` (source), `WritableStream` (sink), and `TransformStream` (a pair — a writable side connected to a readable side). They mirror Node's `Readable`, `Writable`, and `Transform`, but with a different API shape.

The big question: when should you use which? If you're writing Node-only code and touching the filesystem, network sockets, or child processes, Node streams are the better fit — the ecosystem is enormous and the APIs are mature. If you're writing code that needs to run in both Node and the browser (shared libraries, edge functions, universal frameworks), Web Streams are the portable choice. And if you need to bridge the two worlds, Node provides `Readable.fromWeb()` and `Readable.toWeb()` to convert between them seamlessly.

One practical note: `fetch()` in Node (powered by Undici) returns a `Response` whose `.body` is a `ReadableStream`, not a Node `Readable`. If you want to pipe that to a Node file stream, you'll need to convert it first.
:::

## :gear: Under the Hood

### Web Streams Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     ReadableStream                            │
│  ┌──────────────┐       ┌────────────┐                       │
│  │ Underlying   │──────>│  Internal  │──────> reader.read()  │
│  │   Source      │       │   Queue    │                       │
│  │ (pull-based) │<──────│            │                       │
│  └──────────────┘ pull()└────────────┘                       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│                     TransformStream                           │
│  ┌──────────────┐       ┌────────────┐                       │
│  │  writable    │──────>│ transformer│──────>│  readable     │
│  │  (input)     │       │            │       │  (output)     │
│  └──────────────┘       └────────────┘       └───────────────│
└──────────────────────────────────────────────────────────────┘
```

### The Three Web Stream Types

```typescript
// run: node --experimental-strip-types web-streams-basics.ts

// 1. ReadableStream — the source
const readable = new ReadableStream<string>({
  start(controller) {
    controller.enqueue("hello");
    controller.enqueue("world");
    controller.close();
  },
});

// Consume with a reader
const reader = readable.getReader();
let result = await reader.read(); // { value: "hello", done: false }
console.log(result);
result = await reader.read();     // { value: "world", done: false }
console.log(result);
result = await reader.read();     // { value: undefined, done: true }
console.log(result);

// 2. WritableStream — the sink
const chunks: string[] = [];
const writable = new WritableStream<string>({
  write(chunk) {
    chunks.push(chunk);
  },
  close() {
    console.log("WritableStream closed. Chunks:", chunks);
  },
});

// 3. TransformStream — a writable+readable pair
const { readable: tReadable, writable: tWritable } = new TransformStream<string, string>({
  transform(chunk, controller) {
    controller.enqueue(chunk.toUpperCase());
  },
});
```

### Pull-based Backpressure

The key design difference: Web Streams use a **pull model**. The underlying source's `pull()` function is called only when the internal queue has space.

```typescript
// run: node --experimental-strip-types pull-model.ts

let pullCount = 0;

const stream = new ReadableStream<number>({
  pull(controller) {
    pullCount++;
    controller.enqueue(pullCount);
    console.log(`pull() called — produced item ${pullCount}`);

    if (pullCount >= 5) {
      controller.close();
    }
  },
}, {
  // Queuing strategy: only buffer 1 item at a time
  highWaterMark: 1,
});

const reader = stream.getReader();

// Each read() triggers exactly one pull() — the source never runs ahead
console.log(await reader.read()); // pull() called, { value: 1, done: false }

// Simulate slow consumer
await new Promise((r) => setTimeout(r, 500));

console.log(await reader.read()); // pull() called, { value: 2, done: false }
console.log(await reader.read()); // { value: 3, done: false }
console.log(await reader.read()); // { value: 4, done: false }
console.log(await reader.read()); // { value: 5, done: false }
console.log(await reader.read()); // { value: undefined, done: true }
```

### BYOB Readers (Bring Your Own Buffer)

Web Streams support BYOB readers that let you supply your own `ArrayBuffer` for zero-copy reads. Node streams have no equivalent.

```typescript
// run: node --experimental-strip-types byob-reader.ts

const stream = new ReadableStream({
  type: "bytes", // enables BYOB mode
  pull(controller) {
    // Write directly into the consumer's buffer
    const view = controller.byobRequest?.view;
    if (view) {
      const u8 = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      u8[0] = 0x48; // 'H'
      u8[1] = 0x69; // 'i'
      controller.byobRequest.respond(2);
    } else {
      controller.enqueue(new Uint8Array([0x48, 0x69]));
    }
    controller.close();
  },
});

const reader = stream.getReader({ mode: "byob" });
const buffer = new ArrayBuffer(1024);
const result = await reader.read(new Uint8Array(buffer, 0, 64));
console.log(new TextDecoder().decode(result.value)); // "Hi"
```

### Cancellation Model

Web Streams have first-class cancellation. Calling `reader.cancel(reason)` or `readable.cancel(reason)` propagates to the underlying source's `cancel()` method, giving it a chance to release resources.

```typescript
// run: node --experimental-strip-types cancellation.ts

const stream = new ReadableStream<number>({
  start(controller) {
    let i = 0;
    const id = setInterval(() => {
      controller.enqueue(i++);
    }, 100);

    // Store interval ID for cleanup
    (controller as any)._intervalId = id;
  },
  cancel(reason) {
    console.log(`Stream cancelled: ${reason}`);
    // Cleanup is guaranteed to be called
    clearInterval((this as any)._intervalId);
  },
});

const reader = stream.getReader();
console.log(await reader.read()); // { value: 0, done: false }
console.log(await reader.read()); // { value: 1, done: false }

// Cancel the stream — triggers cancel() on the source
await reader.cancel("no longer needed");
console.log(await reader.read()); // { value: undefined, done: true }
```

### pipeTo() and pipeThrough()

Web Streams use `pipeTo()` (connect to a writable) and `pipeThrough()` (connect through a transform).

```typescript
// run: node --experimental-strip-types pipe-web.ts

const source = new ReadableStream<string>({
  start(controller) {
    controller.enqueue("hello");
    controller.enqueue("world");
    controller.close();
  },
});

const upper = new TransformStream<string, string>({
  transform(chunk, controller) {
    controller.enqueue(chunk.toUpperCase());
  },
});

const chunks: string[] = [];
const sink = new WritableStream<string>({
  write(chunk) {
    chunks.push(chunk);
  },
  close() {
    console.log("Result:", chunks.join(" ")); // "HELLO WORLD"
  },
});

// Chain: source -> uppercase transform -> sink
await source.pipeThrough(upper).pipeTo(sink);
```

### Node-Web Interop: fromWeb() and toWeb()

```typescript
// run: node --experimental-strip-types interop.ts
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

// Web ReadableStream -> Node Readable
const webStream = new ReadableStream<string>({
  start(controller) {
    controller.enqueue("data from web stream\n");
    controller.close();
  },
});

const nodeReadable = Readable.fromWeb(webStream);

// Now you can use it with Node's pipeline()
await pipeline(nodeReadable, process.stdout);

// Node Readable -> Web ReadableStream
const nodeSource = Readable.from(["hello", " ", "from", " ", "node"]);
const webReadable = Readable.toWeb(nodeSource);

// Now you can use it with Web Streams' pipeTo()
const result: string[] = [];
await webReadable.pipeTo(
  new WritableStream<string>({
    write(chunk) {
      result.push(chunk);
    },
  }),
);
console.log(result.join("")); // "hello from node"
```

### fetch() Response Body

```typescript
// run: node --experimental-strip-types fetch-body.ts

const response = await fetch("https://httpbin.org/stream/3");

// response.body is a Web ReadableStream, NOT a Node Readable
const body: ReadableStream<Uint8Array> | null = response.body;

if (body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    console.log("chunk:", decoder.decode(value, { stream: true }));
  }
}
```

### Comparison Table

| Feature | Node Streams | Web Streams |
|---|---|---|
| **Model** | Push-based (events) | Pull-based (read requests) |
| **Backpressure** | Manual (`write()` returns `false`, `'drain'` event) | Built-in (source only produces when pulled) |
| **Types** | Readable, Writable, Duplex, Transform | ReadableStream, WritableStream, TransformStream |
| **Zero-copy reads** | No | Yes (BYOB readers) |
| **Cancellation** | `stream.destroy(err)` | `reader.cancel(reason)` — first-class |
| **Error handling** | Events + `pipeline()` | Promises throughout |
| **Object mode** | Yes (`objectMode: true`) | Partially (no built-in concept, but chunks can be any type) |
| **Browser support** | No | Yes — native in all modern browsers |
| **Node ecosystem** | Massive (fs, net, http, zlib, crypto) | Growing (fetch, compression, encoding) |
| **Async iteration** | `for await (const chunk of stream)` | `for await (const chunk of stream)` (via `[Symbol.asyncIterator]`) |
| **Pipe** | `pipeline()` | `pipeTo()` / `pipeThrough()` |

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. fetch() returns Web Streams, not Node Streams.** Trying to `.pipe()` a `fetch()` response body to a Node `createWriteStream()` fails silently or throws. You must convert with `Readable.fromWeb(response.body)` first. This is the number-one gotcha when migrating from `node-fetch` (which returned Node streams) to the built-in `fetch()`.

**2. Web Streams are locked after getting a reader.** Once you call `stream.getReader()`, the stream is locked — no other reader can be obtained, and you can't use `for await...of` on it. You must release the lock with `reader.releaseLock()` first. This is by design (prevents two consumers racing on the same stream), but it surprises people coming from Node streams where multiple `.pipe()` targets are common.

**3. TransformStream's writable side errors are not always visible.** If a `TransformStream`'s transform function throws, the error propagates to the readable side. But if nothing is reading from the readable side, the error is silently swallowed. Always consume both sides or use `pipeTo()` / `pipeThrough()` which handle error propagation.

**4. Performance overhead in Node.** Web Streams in Node are implemented on top of the same libuv primitives as Node streams but with an extra layer of abstraction. For high-throughput Node-only workloads (file I/O, TCP proxying), Node streams are measurably faster. Use Web Streams when you need portability, not when you need maximum throughput.
:::

## :dart: Checkpoint

::: details Question 1 — Push vs Pull
**Q:** Explain the fundamental difference between Node streams' push model and Web Streams' pull model in terms of backpressure behavior.

**A:** In Node's push model, the source emits data proactively via `data` events. The consumer must explicitly signal backpressure by checking `write()` return values and calling `pause()`/`resume()`. If the consumer doesn't, data piles up in memory. In Web Streams' pull model, the source's `pull()` function is only called when the internal queue has space below the `highWaterMark`. The source physically cannot run ahead of the consumer because it's never asked to produce until there's room. Backpressure is structural, not cooperative.
:::

::: details Question 2 — Interop
**Q:** You're using the built-in `fetch()` API to download a large file and want to save it to disk using `fs.createWriteStream()`. Write the minimal code to do this correctly.

**A:**
```typescript
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";

const response = await fetch("https://example.com/large-file.bin");
if (!response.body) throw new Error("No response body");

await pipeline(
  Readable.fromWeb(response.body),
  createWriteStream("large-file.bin"),
);
```
The key steps: (1) convert the Web ReadableStream to a Node Readable with `Readable.fromWeb()`, (2) use `pipeline()` for proper backpressure and cleanup.
:::

## Key Mental Models

- **Node streams push, Web Streams pull.** Node's source is eager and must be throttled. Web's source is lazy and must be asked. Both achieve backpressure, but Web Streams make it structural.
- **Use Web Streams for portability, Node streams for ecosystem.** If your code must run in browsers, Deno, Cloudflare Workers, and Node, Web Streams are the only option. If you're purely in Node, the ecosystem advantage of Node streams is significant.
- **`Readable.fromWeb()` / `Readable.toWeb()` are your bridges.** Memorize these two methods — they're how you cross between the two worlds.
- **Locking is by design.** A Web `ReadableStream` can only have one reader at a time. This prevents data races. Tee the stream with `.tee()` if you need multiple consumers.
- **`fetch().body` is a Web Stream.** This is the most common place you'll encounter Web Streams in Node. Always remember to convert before piping to Node APIs.

## Related

- [Streams & Backpressure](./02-streams-backpressure) — the Node streams API in depth
- [SSE & LLM Token Streaming](./04-sse-streaming) — a practical application of streaming
