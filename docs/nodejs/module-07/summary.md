---
title: "Module 7 Summary"
outline: deep
---

# Module 7 — FS, Child Processes & OS Boundary: Summary

Module 7 covers Node's interface with the OS — files, processes, signals, and graceful shutdown.

## Mental Models Gained

- **Three API families, one threadpool.** `fs` callbacks, promises, and sync all use the libuv threadpool for async variants.
- **`spawn` streams, `exec` buffers.** Use `spawn` for large output, `exec` for short commands, `fork` for Node IPC. Never `exec` with user input.
- **Graceful shutdown is a state machine.** SIGTERM → stop accepting → drain in-flight → close connections → exit 0. Add a hard timeout as safety.
- **SEA is niche but useful.** Good for CLI tools. For services, Docker is usually better.

## Self-Assessment Checklist

- [ ] Can you choose between spawn, exec, execFile, and fork?
- [ ] Can you implement a full graceful shutdown for K8s?
- [ ] Can you explain `fs.watch` vs `fs.watchFile`?

## What's Next

[Module 8 — Security & Hardening](/nodejs/module-08/)
