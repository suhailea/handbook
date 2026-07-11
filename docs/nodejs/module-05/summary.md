---
title: "Module 5 Summary"
outline: deep
---

# Module 5 — Networking & HTTP Internals: Summary

Module 5 covers what happens on the wire — from raw TCP to HTTP connection management to real-time protocols.

## Mental Models Gained

- **`node:net` is where networking starts.** TCP sockets are bidirectional byte streams. Everything higher-level (HTTP, WebSocket, TLS) is built on top of this.
- **HTTP keep-alive is a connection cache.** Without it, every request needs a new TCP+TLS handshake. The `Agent` class manages the pool. `undici` (powering native `fetch`) is the modern replacement.
- **Timeouts must be set at every layer.** Miss one and you're vulnerable to slowloris, connection leaks, or hanging requests. In reverse-proxy setups, the inner timeout must be shorter than the outer.
- **WebSocket starts as HTTP then upgrades.** The `Upgrade` header triggers a protocol switch to a persistent, full-duplex channel.

## Self-Assessment Checklist

- [ ] Can you build a basic protocol on raw TCP sockets?
- [ ] Can you explain HTTP connection pooling and diagnose pool exhaustion?
- [ ] Can you name all the timeout settings and what each protects against?
- [ ] Can you describe the WebSocket upgrade handshake?

## What's Next

[Module 6 — Performance & Diagnostics](/nodejs/module-06/) teaches you to find and fix performance problems.
