---
title: "Module 1 Summary"
outline: deep
---

# Module 1 — The Runtime: Summary

You've completed the foundation module. Before moving on, make sure these mental models are solid.

## Mental Models Gained

- **Node = V8 + libuv + bindings.** V8 executes JavaScript (single-threaded). libuv provides the event loop and async I/O (multi-threaded where needed). The bindings layer bridges JS calls to C/C++ operations. Understanding which layer owns what behavior is the key to debugging Node.
- **The process is the unit of work.** A Node process has a lifecycle (boot → run → drain → exit), communicates exit status via codes, and responds to POSIX signals. In containers, your process may be PID 1 — and that changes signal behavior.
- **`process.exit()` is an ejection seat.** It skips cleanup. The graceful alternative is to stop accepting work, let in-flight operations finish, and let the event loop drain naturally.
- **Two module systems coexist.** CJS (`require`) is synchronous, caches by resolved filename, and returns value copies. ESM (`import`) is asynchronous, statically analyzable, and exports live bindings. Understanding the resolution algorithm for each prevents "module not found" surprises.
- **`package.json` `"exports"` is the new contract.** It replaces `"main"`, supports conditional exports for CJS/ESM dual packages, and encapsulates internal files. The dual-package hazard (same package loaded twice as both CJS and ESM) is a real production bug.

## Self-Assessment Checklist

### 1.1 — What Node Actually Is
- [ ] Can you draw the three-layer architecture (V8 / bindings / libuv) from memory?
- [ ] Can you explain what happens between typing `node app.ts` and your first line of code running?
- [ ] Do you understand how `fs.readFile` crosses from JS into C++ and back?

### 1.2 — Process Lifecycle, Exit Codes & Signals
- [ ] Can you list at least 4 exit codes and what triggers each?
- [ ] Do you know the difference between `beforeExit` and `exit` events?
- [ ] Can you explain the PID 1 signal-forwarding problem in containers?
- [ ] Do you understand when stdout is synchronous vs asynchronous?

### 1.3 — CJS Resolution, Caching & Circular Deps
- [ ] Can you trace the `require()` resolution algorithm step by step?
- [ ] Do you know what happens with circular `require()` calls (partial exports)?
- [ ] Can you explain why `module.exports = ...` works but `exports = ...` doesn't?

### 1.4 — ESM, Interop & require(esm)
- [ ] Do you understand the ESM loader pipeline (resolve → load → evaluate)?
- [ ] Can you explain `require(esm)` constraints in Node 22+?
- [ ] Do you know why named imports from CJS sometimes fail?

### 1.5 — package.json exports & Dual-Package Hazard
- [ ] Can you write a `"exports"` field with subpath and conditional exports?
- [ ] Can you explain the dual-package hazard and how to avoid it?
- [ ] Do you understand the difference between `"exports"` and `"imports"`?

## What's Next

[Module 2 — The Event Loop](/nodejs/module-02/) dives into libuv's phase system, microtask scheduling, and the threadpool — the engine that makes all the async I/O from this module actually work.
