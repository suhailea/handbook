---
title: "Stream Classes, Backpressure & pipeline()"
outline: deep
---

# Stream Classes, Backpressure & pipeline()

> **Interview weight:** :fire::fire::fire::fire: — Backpressure is the single most misunderstood topic in Node.js. Expect deep questions.
> **Node version:** All examples target Node 22+. `pipeline()` available since Node 10; `stream/promises` since Node 15.
> **Prereqs:** [Buffers, TypedArrays & Encodings](./01-buffers-typed-arrays) · [Async Iteration vs EventEmitter](/nodejs/module-03/04-async-iteration-vs-eventemitter)

## :speaking_head: In Plain English

::: tip In Plain English
Picture a bottling factory with three stations connected by conveyor belts. Station 1 fills bottles with liquid, Station 2 screws on caps, and Station 3 applies labels and packs them into boxes. Each station works at a different speed.

If Station 1 fills bottles faster than Station 2 can cap them, bottles start piling up on the conveyor belt between them. That belt has a limited capacity — the **highWaterMark**. When bottles hit the limit, Station 1 needs to stop filling until Station 2 catches up. That's **backpressure** — a downstream bottleneck pushing back upstream to slow things down.

In Node, the conveyor belt is a stream's internal buffer, and each station is a stream instance. A **Readable** stream is the source (Station 1). A **Writable** stream is the destination (Station 3). A **Transform** stream is a station in the middle that modifies each bottle as it passes through (Station 2). A **Duplex** stream can both produce and consume independently — think of a phone line where you can talk and listen at the same time.

The key mechanism is simple: when you write to a Writable stream and its internal buffer is full, the `.write()` method returns `false`. That's the conveyor belt saying "I'm full, stop sending." When the buffer drains below the watermark, the stream fires a `'drain'` event — "OK, you can send more now."

`.pipe()` was the original way to connect streams. It wires up backpressure automatically but has a fatal flaw: if any stream in the chain errors, `.pipe()` does not clean up the others. Leaked file handles, zombie connections, memory that never gets freed.

`pipeline()` fixed this. It connects streams just like `.pipe()` but it destroys all streams in the chain if any one of them errors, and it calls a callback (or resolves/rejects a promise) when the pipeline finishes. Always use `pipeline()`. Forget `.pipe()` exists.
:::

## :gear: Under the Hood

### The Four Stream Types

```
┌───────────┐     ┌───────────┐     ┌───────────┐
│ Readable  │────>│ Transform │────>│ Writable  │
│ (source)  │     │ (modify)  │     │ (sink)    │
└───────────┘     └───────────┘     └───────────┘

┌───────────┐
│  Duplex   │ <── reads and writes independently (e.g., TCP socket)
└───────────┘
```

| Type | Extends | Key methods | Example |
|---|---|---|---|
| `Readable` | `Stream` | `push()`, `_read()`, `read()` | `fs.createReadStream`, `http.IncomingMessage` |
| `Writable` | `Stream` | `write()`, `_write()`, `end()` | `fs.createWriteStream`, `http.ServerResponse` |
| `Duplex` | `Readable` + `Writable` | Both sets | `net.Socket`, `zlib` streams |
| `Transform` | `Duplex` | `_transform()`, `_flush()` | `zlib.createGzip()`, `crypto.createCipher()` |

### highWaterMark and the Internal Buffer

Every stream has an internal buffer and a `highWaterMark` (default: 16KB for byte streams, 16 objects for object-mode streams). The `highWaterMark` is **not** a hard limit — it's an advisory threshold. Data can exceed it, but the stream signals that it should stop receiving more.

```typescript
// run: node --experimental-strip-types hwm-demo.ts
import { Writable } from "node:stream";

const sink = new Writable({
  highWaterMark: 16, // tiny buffer for demonstration (16 bytes)
  write(chunk: Buffer, _encoding: string, callback: () => void) {
    // Simulate slow consumer — 50ms per chunk
    setTimeout(() => {
      console.log(`  consumed: ${chunk.toString()}`);
      callback();
    }, 50);
  },
});

// write() returns false when the internal buffer exceeds highWaterMark
for (let i = 0; i < 5; i++) {
  const canContinue = sink.write(`chunk-${i} `);
  console.log(`write chunk-${i}: canContinue=${canContinue}`);
}

sink.end();
```

### Backpressure Propagation

The protocol is a conversation between producer and consumer:

```
Producer                           Consumer (Writable)
   │                                      │
   │──── write(chunk) ───────────────────>│
   │<─── returns true (buffer OK) ────────│
   │                                      │
   │──── write(chunk) ───────────────────>│
   │<─── returns false (buffer full!) ────│
   │                                      │
   │     ** producer MUST pause **        │
   │                                      │
   │<─── 'drain' event ──────────────────│
   │                                      │
   │──── write(chunk) ───────────────────>│
   │     ** resume sending **             │
```

```typescript
// run: node --experimental-strip-types backpressure-manual.ts
import { createReadStream, createWriteStream } from "node:fs";

const src = createReadStream("/dev/urandom", { highWaterMark: 1024 });
const dst = createWriteStream("/dev/null", { highWaterMark: 256 });

let writes = 0;
let drains = 0;

src.on("data", (chunk: Buffer) => {
  writes++;
  const ok = dst.write(chunk);
  if (!ok) {
    // Backpressure! Pause the source until the destination drains
    src.pause();
    dst.once("drain", () => {
      drains++;
      src.resume();
    });
  }
});

src.on("end", () => dst.end());

setTimeout(() => {
  src.destroy();
  dst.destroy();
  console.log(`writes: ${writes}, drains: ${drains}`);
}, 200);
```

### .pipe() vs pipeline()

```typescript
// run: node --experimental-strip-types pipe-vs-pipeline.ts
import { createReadStream, createWriteStream } from "node:fs";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

// BAD: .pipe() — no error cleanup
// If gzip errors, readStream and writeStream leak
// createReadStream("input.txt")
//   .pipe(createGzip())
//   .pipe(createWriteStream("output.gz"));

// GOOD: pipeline() — auto-destroys all streams on error
try {
  await pipeline(
    createReadStream("input.txt"),
    createGzip(),
    createWriteStream("output.gz"),
  );
  console.log("Pipeline succeeded");
} catch (err) {
  console.error("Pipeline failed — all streams cleaned up:", err);
}
```

**Key differences:**

| Feature | `.pipe()` | `pipeline()` |
|---|---|---|
| Error propagation | Manual — must listen on each stream | Automatic — callback/promise on any error |
| Stream cleanup | None — leaked handles on error | Destroys all streams on error or completion |
| Return value | Returns destination stream (chainable) | Returns void (callback) or Promise |
| Signal/abort support | No | Yes — pass `AbortSignal` as option |

### Object Mode Streams

Streams normally deal with `Buffer` or `string` chunks. In **object mode**, chunks can be any JavaScript value, and `highWaterMark` counts objects instead of bytes.

```typescript
// run: node --experimental-strip-types object-mode.ts
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

// A transform that converts lines to parsed objects
const parser = new Transform({
  objectMode: true, // output side is object mode
  writableObjectMode: false, // input side is byte mode
  transform(chunk: Buffer, _encoding: string, callback) {
    const lines = chunk.toString().trim().split("\n");
    for (const line of lines) {
      const [name, score] = line.split(",");
      this.push({ name, score: Number(score) });
    }
    callback();
  },
});

const input = Readable.from(["alice,95\nbob,87\ncarol,92\n"]);

const results: Array<{ name: string; score: number }> = [];

await pipeline(input, parser, async function* (source) {
  for await (const record of source) {
    results.push(record as { name: string; score: number });
    yield; // required — pipeline needs an async generator or writable
  }
});

console.log(results);
// [ { name: 'alice', score: 95 }, { name: 'bob', score: 87 }, { name: 'carol', score: 92 } ]
```

### Implementing Custom Streams

```typescript
// run: node --experimental-strip-types custom-streams.ts
import { Readable, Writable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

// Custom Readable — generates numbers 1 through 5
class CounterStream extends Readable {
  private current = 1;
  private max: number;

  constructor(max: number) {
    super({ objectMode: true });
    this.max = max;
  }

  override _read(): void {
    if (this.current > this.max) {
      this.push(null); // signal end of stream
      return;
    }
    this.push(this.current++);
  }
}

// Custom Transform — doubles each number
class DoubleTransform extends Transform {
  constructor() {
    super({ objectMode: true });
  }

  override _transform(
    chunk: number,
    _encoding: string,
    callback: (error?: Error | null, data?: number) => void,
  ): void {
    callback(null, chunk * 2);
  }

  // _flush is called once when the readable side ends
  override _flush(callback: () => void): void {
    console.log("  (transform flushed)");
    callback();
  }
}

// Custom Writable — collects results
class CollectorSink extends Writable {
  public items: number[] = [];

  constructor() {
    super({ objectMode: true });
  }

  override _write(
    chunk: number,
    _encoding: string,
    callback: () => void,
  ): void {
    this.items.push(chunk);
    callback();
  }
}

const source = new CounterStream(5);
const doubler = new DoubleTransform();
const collector = new CollectorSink();

await pipeline(source, doubler, collector);
console.log(collector.items); // [2, 4, 6, 8, 10]
```

### pipeline() Auto-cleanup and AbortSignal

```typescript
// run: node --experimental-strip-types pipeline-abort.ts
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";

const ac = new AbortController();

// Cancel after 100ms
sleep(100).then(() => ac.abort());

const infinite = new Readable({
  read() {
    this.push("data\n");
  },
});

const slow = new Transform({
  async transform(chunk, _enc, cb) {
    await sleep(50);
    cb(null, chunk);
  },
});

try {
  await pipeline(infinite, slow, process.stdout, { signal: ac.signal });
} catch (err: unknown) {
  if (err instanceof Error && err.name === "AbortError") {
    console.error("\nPipeline aborted — all streams destroyed");
  }
}
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. Ignoring backpressure causes memory exhaustion.** The most common stream bug: reading a fast source (e.g., database cursor yielding millions of rows) and writing to a slow destination (e.g., HTTP response over a slow network) without respecting `write()` returning `false`. The writable's internal buffer grows without bound, and the process runs out of memory. Always check the return value of `write()` or use `pipeline()`.

**2. `.pipe()` leaks streams on error.** If the destination stream errors, `.pipe()` does not destroy the source. The source keeps reading data, the file handle stays open, and memory accumulates. This is the number-one reason to prefer `pipeline()` in all production code.

**3. Forgetting to call `callback()` in `_write` / `_transform`.** If your custom stream's implementation never calls the callback, backpressure builds up infinitely. The writable buffer fills, the source pauses, and the entire pipeline freezes silently — no error, no crash, just a hung process.

**4. `highWaterMark` misunderstanding.** It's not a max buffer size — it's a "start pushing back" threshold. A single `write(hugeChunk)` can blow past it. If you write a 100MB buffer to a stream with a 16KB `highWaterMark`, the entire 100MB is buffered. Always write in reasonably sized chunks.
:::

## :dart: Checkpoint

::: details Question 1 — Backpressure Signal
**Q:** A Writable stream's `write()` method returns `false`. What should the producer do, and what event tells it to resume?

**A:** The producer must stop calling `write()` and wait for the `'drain'` event on the writable stream. This event fires when the internal buffer has been flushed below the `highWaterMark`. Continuing to write despite a `false` return defeats backpressure and risks unbounded memory growth.
:::

::: details Question 2 — pipe vs pipeline Error Handling
**Q:** You use `.pipe()` to connect a file read stream through a gzip transform to a file write stream. The gzip transform throws an error mid-stream. What happens to the read and write streams?

**A:** With `.pipe()`, neither the read stream nor the write stream is destroyed. The read stream continues reading (wasting I/O and memory), and the write stream's file handle remains open (potentially corrupting the output file). With `pipeline()`, all three streams would be destroyed immediately, file handles closed, and the error propagated to the callback or rejected promise.
:::

::: details Question 3 — Object Mode highWaterMark
**Q:** You create a Transform stream in object mode with the default `highWaterMark`. How many objects will it buffer before applying backpressure?

**A:** The default `highWaterMark` for object-mode streams is 16 objects (not 16KB — bytes don't apply in object mode). After 16 objects accumulate in the internal buffer, `push()` returns `false` on the readable side, and `write()` returns `false` on the writable side.
:::

## Key Mental Models

- **Backpressure is a conversation, not a mechanism.** The writable says "I'm full" (`write()` returns `false`), the producer pauses, the writable says "I'm ready" (`'drain'`), the producer resumes. Both sides must cooperate.
- **`pipeline()` is the only correct way to connect streams.** It handles error propagation, stream cleanup, and supports `AbortSignal`. There is no valid production use case for `.pipe()`.
- **`highWaterMark` is advisory, not enforced.** It's the threshold at which backpressure signals begin. Actual buffer size can exceed it.
- **Always call the callback.** In `_write`, `_transform`, and `_flush`, failing to call the callback hangs the entire pipeline silently.
- **Object mode changes the unit of measurement.** `highWaterMark` counts objects instead of bytes. A single object could be 100MB — the stream doesn't know or care about its size.

## Related

- [Buffers, TypedArrays & Encodings](./01-buffers-typed-arrays) — understanding the chunks that flow through streams
- [Web Streams](./03-web-streams) — the platform-standard alternative with a pull-based model
- [Async Iteration vs EventEmitter](/nodejs/module-03/04-async-iteration-vs-eventemitter) — consuming streams with `for await...of`
