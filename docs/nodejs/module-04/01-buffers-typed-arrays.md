---
title: "Buffers, TypedArrays & Encodings"
outline: deep
---

# Buffers, TypedArrays & Encodings

> **Interview weight:** :fire::fire::fire: — Buffer questions surface in every Node systems interview; encoding bugs cause real production incidents.
> **Node version:** All examples target Node 22+. `Buffer` has been a `Uint8Array` subclass since Node 4; pool semantics unchanged since Node 8.
> **Prereqs:** Basic understanding of binary data · [Streams & Backpressure](./02-streams-backpressure)

## :speaking_head: In Plain English

::: tip In Plain English
Imagine a warehouse loading dock that handles shipments of goods. Each pallet slot holds exactly one unit — that's a **byte**. A `Buffer` is a fixed row of these pallet slots. When you create one, you're reserving a specific number of slots, and each slot holds a number between 0 and 255.

Now, letters and symbols in the real world take up different amounts of space depending on the language. A plain English letter like "A" fits in one slot. But a Chinese character or an emoji might need three or four slots. That's encoding — the mapping between human-readable characters and the raw bytes that fill the slots. UTF-8 is the most common mapping, and it's the default in Node.

`Buffer.alloc(size)` gives you a clean row of slots, every slot zeroed out — like a freshly swept loading dock. `Buffer.allocUnsafe(size)` is faster because it skips the sweeping. The slots might contain leftover junk from whatever occupied that memory before. This is fine when you're about to fill every slot yourself, but dangerous if you accidentally expose unfilled slots — you might leak old passwords or tokens sitting in recycled memory.

`Buffer.from()` is the most common way to create a buffer — you hand it a string, an array, or another buffer, and it copies the data into fresh slots.

Here's a trick Node uses for speed: it keeps a pre-allocated 8KB block of memory (the "pool") and carves small buffers out of it. When you call `Buffer.allocUnsafe(100)`, Node doesn't go to the operating system for 100 bytes — it slices them off the pool. This is why small buffer allocations are blazing fast, but it also means those small buffers share underlying memory with other small buffers. If you pass a buffer's `.buffer` property (the raw ArrayBuffer) to another API, you might accidentally expose neighboring data.

The sneaky bug that catches everyone: if you're reading a stream of UTF-8 text in fixed-size chunks, a multi-byte character might get split across two chunks. The first chunk ends with half a Chinese character, and the second chunk starts with the other half. If you decode each chunk independently with `.toString('utf8')`, you get garbage (the replacement character). The fix is `StringDecoder` or collecting buffers before decoding.
:::

## :gear: Under the Hood

### Buffer Is a Uint8Array Subclass

Since Node 4, `Buffer` extends `Uint8Array`. Every `Buffer` instance is backed by an `ArrayBuffer` and exposes all TypedArray methods (`slice`, `subarray`, `set`, etc.) plus Node-specific convenience methods (`toString`, `write`, `readUInt32BE`, etc.).

```typescript
// run: node --experimental-strip-types buffers-basics.ts
import { Buffer } from "node:buffer";

const buf = Buffer.from("hello");

console.log(buf instanceof Uint8Array);  // true
console.log(buf instanceof Buffer);       // true
console.log(buf.buffer);                  // ArrayBuffer (the backing store)
console.log(buf.byteOffset);             // offset within the ArrayBuffer
console.log(buf.byteLength);             // 5
```

The inheritance chain: `Buffer` -> `Uint8Array` -> `TypedArray` -> `Object`.

### Allocation: alloc vs allocUnsafe vs from

```typescript
// run: node --experimental-strip-types alloc-demo.ts
import { Buffer } from "node:buffer";

// 1. alloc — zeroed, safe, slightly slower
const safe = Buffer.alloc(16);
console.log(safe); // <Buffer 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00>

// 2. allocUnsafe — uninitialized, fast, may contain old data
const unsafe = Buffer.allocUnsafe(16);
console.log(unsafe); // <Buffer ??  ??  ??  ... > — unpredictable contents

// 3. allocUnsafeSlow — bypasses the pool entirely, for large or long-lived buffers
const slow = Buffer.allocUnsafeSlow(16);

// 4. from — copies data in
const fromStr = Buffer.from("hello", "utf8");
const fromArr = Buffer.from([0x68, 0x65, 0x6c, 0x6c, 0x6f]);
const fromBuf = Buffer.from(fromStr); // full copy

console.log(fromStr.equals(fromArr)); // true
```

**When to use which:**

| Method | Zeroed? | Uses pool? | Use case |
|---|---|---|---|
| `alloc(n)` | Yes | No | Security-sensitive buffers, crypto output |
| `allocUnsafe(n)` | No | Yes (< 4KB) | Performance-critical paths where you fill every byte |
| `allocUnsafeSlow(n)` | No | No | Long-lived buffers you don't want tied to the pool |
| `from(data)` | N/A | Yes (< 4KB) | Converting strings, arrays, other buffers |

### The 8KB Buffer Pool

Node maintains an internal slab allocator. When you call `Buffer.allocUnsafe(n)` for `n < Buffer.poolSize / 2` (default: `n < 4096`), Node carves the buffer from a shared 8KB `ArrayBuffer`. Multiple small buffers share the same backing `ArrayBuffer`.

```typescript
// run: node --experimental-strip-types pool-demo.ts
import { Buffer } from "node:buffer";

const a = Buffer.allocUnsafe(32);
const b = Buffer.allocUnsafe(32);

// Both share the same underlying ArrayBuffer (the pool slab)
console.log(a.buffer === b.buffer); // true (usually)
console.log(`a offset: ${a.byteOffset}, b offset: ${b.byteOffset}`);

// DANGER: passing a.buffer to a WebSocket or worker gives them
// access to the ENTIRE 8KB slab, not just your 32 bytes.
// Fix: copy first, or use buf.subarray() which respects offset/length.
const safeCopy = Buffer.from(a); // new allocation, no shared backing
```

### Encodings

Node supports these character encodings:

```typescript
// run: node --experimental-strip-types encodings-demo.ts
import { Buffer } from "node:buffer";

const text = "Hello, World!";

// UTF-8 (default) — variable-width, 1-4 bytes per character
console.log(Buffer.from(text, "utf8").toString("hex"));

// Base64 — 3 bytes become 4 ASCII chars
console.log(Buffer.from(text).toString("base64"));    // SGVsbG8sIFdvcmxkIQ==
console.log(Buffer.from(text).toString("base64url")); // SGVsbG8sIFdvcmxkIQ

// Hex — each byte becomes 2 hex chars
console.log(Buffer.from(text).toString("hex"));       // 48656c6c6f2c20576f726c6421

// Latin1 (ISO-8859-1) — single byte per char, first 256 Unicode code points only
console.log(Buffer.from(text, "latin1").toString("latin1"));

// Binary — alias for latin1
// ASCII — strips the high bit (7-bit only)
```

### TypedArrays and ArrayBuffer Relationship

```
┌─────────────────────────────────────────────┐
│              ArrayBuffer (raw bytes)         │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │Uint8Array│ │Int16Array│ │Float64Array  │ │
│  │(view 1)  │ │(view 2)  │ │(view 3)      │ │
│  └──────────┘ └──────────┘ └──────────────┘ │
└─────────────────────────────────────────────┘
```

An `ArrayBuffer` is a fixed-length chunk of raw memory. You never interact with it directly — you use **views** (`TypedArray` subclasses or `DataView`) to read and write it. `Buffer` is just another view — a `Uint8Array` subclass with extra methods.

```typescript
// run: node --experimental-strip-types typed-arrays.ts
// Sharing memory between different views
const ab = new ArrayBuffer(8);
const u8 = new Uint8Array(ab);
const u32 = new Uint32Array(ab);

u32[0] = 0x04030201;
console.log(u8[0], u8[1], u8[2], u8[3]); // 1 2 3 4 (little-endian)

// Buffer wrapping an existing ArrayBuffer
import { Buffer } from "node:buffer";
const buf = Buffer.from(ab);
console.log(buf.readUInt32LE(0)); // 67305985 (0x04030201)
```

### Multi-byte Character Pitfalls

UTF-8 encodes characters in 1-4 bytes. When a stream delivers data in fixed-size chunks, a multi-byte character can be split across chunk boundaries.

```typescript
// run: node --experimental-strip-types multibyte-pitfall.ts
import { Buffer } from "node:buffer";
import { StringDecoder } from "node:string_decoder";

// The Chinese character '中' is encoded as 3 bytes: E4 B8 AD
const full = Buffer.from("中文");
console.log(full); // <Buffer e4 b8 ad e6 96 87>

// Simulate a chunk split in the middle of '中'
const chunk1 = full.subarray(0, 2);  // E4 B8 — incomplete character
const chunk2 = full.subarray(2);     // AD E6 96 87

// BAD: decoding each chunk independently
console.log(chunk1.toString("utf8")); // "�" — replacement character
console.log(chunk2.toString("utf8")); // "�文" — leading garbage

// GOOD: use StringDecoder to handle partial characters
const decoder = new StringDecoder("utf8");
console.log(decoder.write(chunk1)); // "" — holds incomplete bytes internally
console.log(decoder.write(chunk2)); // "中文" — assembles the full character
console.log(decoder.end());         // "" — flushes any remainder
```

### Buffer.concat and Zero-copy Patterns

```typescript
// run: node --experimental-strip-types concat-demo.ts
import { Buffer } from "node:buffer";

// Collecting stream chunks — common pattern
const chunks: Buffer[] = [];
chunks.push(Buffer.from("hello "));
chunks.push(Buffer.from("world"));
const combined = Buffer.concat(chunks);
console.log(combined.toString()); // "hello world"

// Zero-copy slice with subarray (shares memory)
const header = combined.subarray(0, 5);
header[0] = 0x48; // modifies combined too!
console.log(combined.toString()); // "Hello world"

// Full copy with Buffer.from (independent memory)
const copy = Buffer.from(combined);
copy[0] = 0x4a;
console.log(combined.toString()); // "Hello world" — unchanged
console.log(copy.toString());     // "Jello world"
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. Memory leaks from `allocUnsafe` and the pool.** Small buffers carved from the 8KB pool keep the entire slab alive as long as any one buffer in that slab is referenced. If you store a tiny 16-byte buffer forever (e.g., in a cache), you pin the whole 8KB slab. For long-lived data, use `Buffer.from()` to make a standalone copy or `Buffer.allocUnsafeSlow()`.

**2. Data leakage via `allocUnsafe`.** If you allocate a buffer with `allocUnsafe` and only partially fill it, then send it over the network or to a client, the unfilled bytes contain whatever was in that memory before — potentially passwords, tokens, or other sensitive data. Always use `alloc()` for security-sensitive buffers, or ensure every byte is written.

**3. Split multi-byte characters in streaming pipelines.** Any time you process text through a `Transform` stream or chunk-based reader and call `.toString()` on each chunk, you risk splitting a multi-byte UTF-8 character at the boundary. The fix: use `StringDecoder`, or accumulate all chunks and decode once at the end.

**4. Accidentally sharing the ArrayBuffer backing store.** When you pass `buf.buffer` to a `Worker` via `postMessage` with a transfer list, or to a `WebSocket` library, you transfer the entire backing `ArrayBuffer` — which, for pooled buffers, includes other buffers' data. Always use `buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)` to isolate.
:::

## :dart: Checkpoint

::: details Question 1 — allocUnsafe Security
**Q:** You're building an API that returns a fixed-size binary payload. You use `Buffer.allocUnsafe(256)` and fill only the first 100 bytes from your data source. What is the security risk, and how do you fix it?

**A:** The remaining 156 bytes contain whatever previously occupied that memory — potentially sensitive data from other requests (session tokens, passwords, etc.). Fix: either use `Buffer.alloc(256)` to zero-fill, or explicitly zero the remainder with `buf.fill(0, 100)`, or allocate only the exact size needed with `Buffer.alloc(100)`.
:::

::: details Question 2 — Pool Sharing
**Q:** You call `Buffer.allocUnsafe(64)` twice and get buffers `a` and `b`. You pass `a.buffer` to a worker thread via `postMessage`. What unexpected data might the worker see?

**A:** Since both `a` and `b` are carved from the same 8KB pool slab, `a.buffer` is the entire 8KB `ArrayBuffer`. The worker would see `b`'s data (and everything else in the slab) by reading at the appropriate offsets. Fix: transfer `a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength)` instead.
:::

::: details Question 3 — Encoding Mismatch
**Q:** `Buffer.from('café', 'latin1').toString('utf8')` produces garbled output. Why?

**A:** The `é` character (U+00E9) is encoded as a single byte `0xE9` in Latin-1. But `0xE9` is not a valid single-byte UTF-8 sequence — it's the start of a 3-byte sequence. When decoded as UTF-8, the byte is invalid and produces the replacement character. You must decode with the same encoding used to encode: `buf.toString('latin1')`.
:::

## Key Mental Models

- **Buffer = Uint8Array + convenience methods.** Everything you know about TypedArrays applies. Buffer just adds encoding-aware `.toString()` and `.from()`, plus binary read/write helpers.
- **`alloc` = safe, `allocUnsafe` = fast but dirty.** Default to `alloc` unless you've profiled and confirmed every byte will be written before the buffer is read.
- **The 8KB pool is a shared slab.** Small buffers share backing memory. Never expose `.buffer` without slicing to your exact range.
- **Encoding is a contract.** Encode and decode with the same encoding. UTF-8 is variable-width; never assume 1 byte = 1 character.
- **`StringDecoder` exists for a reason.** Any time you call `.toString()` on stream chunks, you risk splitting multi-byte characters. Use it.

## Related

- [Streams & Backpressure](./02-streams-backpressure) — how buffers flow through stream pipelines
- [Web Streams](./03-web-streams) — the platform-native alternative that works with `Uint8Array` directly
