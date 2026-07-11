---
title: "Module 4 Summary"
outline: deep
---

# Module 4 — Buffers, Streams & Backpressure: Summary

Module 4 covers how Node moves data efficiently — from binary encoding to constant-memory streaming to real-time token delivery.

## Mental Models Gained

- **Buffer is just a Uint8Array with extra methods.** It gives you raw byte access with encoding helpers. `allocUnsafe` is faster but leaks memory contents — use `alloc` unless you're immediately overwriting every byte.
- **Streams are the plumbing of Node.** Four types (Readable, Writable, Duplex, Transform) with one shared concept: `highWaterMark` as the internal buffer size. When the buffer fills, backpressure kicks in.
- **Backpressure is automatic — if you use `pipeline()`.** `write()` returns `false` when the buffer is full, signaling the source to pause. `.pipe()` handles this but swallows errors. `pipeline()` handles both backpressure AND error propagation AND cleanup.
- **Web Streams and Node Streams serve different masters.** Web Streams are spec-standard, pull-based, and work in browsers. Node Streams are battle-tested, push-based, and deeply integrated with Node APIs. Use Web Streams for new cross-platform code; Node Streams when you need the ecosystem.
- **SSE is HTTP's simplest streaming protocol.** `text/event-stream`, `data:` lines, double newlines. For LLM token streaming, the key challenges are disconnect detection, cleanup, and nginx proxy configuration (`proxy_buffering off`).

## Self-Assessment Checklist

### 4.1 — Buffers, TypedArrays & Encodings
- [ ] Do you understand the relationship between Buffer, Uint8Array, and ArrayBuffer?
- [ ] Can you explain the multi-byte character pitfall when splitting utf-8 across chunks?

### 4.2 — Streams & Backpressure
- [ ] Can you explain how backpressure propagates through `write()` returning `false`?
- [ ] Can you justify when to use `pipeline()` vs `.pipe()`?

### 4.3 — Web Streams vs Node Streams
- [ ] Can you convert between Web Streams and Node Streams?
- [ ] Do you know the key architectural difference (pull vs push)?

### 4.4 — SSE & LLM Token Streaming
- [ ] Can you implement an SSE endpoint with `node:http`?
- [ ] Can you handle client disconnect and clean up resources?

## What's Next

[Module 5 — Networking & HTTP Internals](/nodejs/module-05/) goes deeper into the transport layer.
