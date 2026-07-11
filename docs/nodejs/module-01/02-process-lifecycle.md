---
title: "Process Lifecycle, Exit Codes & Signals"
outline: deep
---

# Process Lifecycle, Exit Codes & Signals

<Badge type="danger" text="Interview Weight 🔥🔥🔥" />
<Badge type="tip" text="Node 22+" />
<Badge type="info" text="Prereqs: OS basics, event loop concept" />

## 🗣️ In Plain English

::: tip In Plain English
Think of a Node.js process like a restaurant kitchen during service.

When the kitchen **opens** (process starts), the head chef checks in: they know which building they are in (the operating system), what their station number is (PID), what ingredients are available (environment variables), and what orders are on the ticket rail (arguments). All of this context is available the moment the kitchen is live — you never have to go hunting for it.

During service, the kitchen stays open as long as there are tickets on the rail — orders being cooked, dishes being plated, waiters picking things up. The moment every ticket is cleared and nothing new is coming in, the kitchen naturally winds down and closes. That is a **clean exit** — exit code 0, everything finished, nothing left behind.

Now imagine someone yells "fire!" That is a **signal**. SIGTERM is the manager walking in and saying, "Wrap up what you are doing, we are closing early." You still get to finish plating the current dishes, wipe down counters, and turn off the stoves. SIGINT is a customer hitting the fire alarm — more urgent, but you can still choose how to react. SIGKILL is the fire department kicking down the door and physically dragging everyone out. There is no negotiation, no cleanup, no goodbye. The kitchen just stops.

The mistake a lot of engineers make is the equivalent of pulling the fire alarm themselves (`process.exit()`) instead of simply clearing the ticket rail and letting the kitchen close on its own. When you pull the alarm, half-plated dishes get abandoned, the stove is left on, and the dishwasher never finishes its cycle. In production, that means open database connections, half-written files, and HTTP responses that never reach the client.

The smart move is to stop accepting new orders, finish the ones in progress, clean up your stations, and walk out the front door. That is graceful shutdown — and understanding the process lifecycle is the foundation it sits on.
:::

## ⚙️ Under the Hood

### The `process` Object

The `process` global is an instance of `EventEmitter` and the primary bridge between your JavaScript code and the operating system. It is available everywhere — no import needed — though you can import it explicitly from `node:process` for clarity.

```typescript
// process-info.ts
// Run: npx tsx process-info.ts -- --verbose

import process from "node:process";

// Identity
console.log("PID:", process.pid);
console.log("Parent PID:", process.ppid);
console.log("Title:", process.title);
console.log("Platform:", process.platform); // 'linux', 'darwin', 'win32'
console.log("Architecture:", process.arch);  // 'x64', 'arm64'

// Arguments — argv[0] is the node binary, argv[1] is the script
console.log("Arguments:", process.argv);
// ['/.../node', '/.../process-info.ts', '--verbose']

// Environment — inherited from the parent process, read/write in-process
console.log("NODE_ENV:", process.env.NODE_ENV);
// Writes are process-local; they do NOT modify the parent shell
process.env.MY_FLAG = "true";

// Versions — V8, libuv, OpenSSL, etc.
console.log("Node:", process.versions.node);
console.log("V8:", process.versions.v8);
console.log("libuv:", process.versions.uv);
console.log("OpenSSL:", process.versions.openssl);

// Resource usage
console.log("Memory:", process.memoryUsage());
// { rss, heapTotal, heapUsed, external, arrayBuffers }

console.log("CPU:", process.cpuUsage());
// { user: microseconds, system: microseconds }

console.log("Uptime:", process.uptime(), "seconds");

// High-resolution time (bigint nanoseconds since arbitrary epoch)
const start = process.hrtime.bigint();
// ... work ...
const elapsed = process.hrtime.bigint() - start;
console.log("Elapsed:", elapsed, "ns");
```

Key details:

- **`process.env`** values are always strings. Reading `process.env.PORT` gives `"3000"`, not `3000`. A missing key returns `undefined`.
- **`process.memoryUsage()`** returns bytes. `rss` (Resident Set Size) is the total physical memory. `heapUsed` is what V8 has allocated and is actively using. `external` counts memory held by C++ objects bound to JS (e.g., Buffers).
- **`process.memoryUsage.rss()`** (Node 22+) is a faster call that returns only the RSS value without computing the full breakdown.
- **`process.hrtime.bigint()`** replaced the older `process.hrtime()` tuple API. It returns a `bigint` of nanoseconds — ideal for benchmarking.

---

### Exit Codes

When a process terminates, it returns a numeric exit code to the operating system. The parent process (shell, container runtime, systemd, K8s kubelet) reads this code to decide what happened.

| Code | Meaning | What Triggers It |
|------|---------|-----------------|
| **0** | Success | Normal completion, `process.exit(0)`, or event loop drains with nothing left |
| **1** | Uncaught Fatal Exception | An exception propagates to the top of the call stack without a handler |
| **2** | _(reserved by Bash)_ | Misuse of shell builtins (not set by Node itself) |
| **5** | Fatal Error | V8 internal error (e.g., out of memory in the heap) |
| **6** | Non-function Internal Exception Handler | The internal `_fatalException` handler is not a function |
| **7** | Internal Exception Handler Run-Time Failure | The `_fatalException` handler itself threw |
| **8** | _(unused)_ | Was used in older Node versions |
| **9** | Invalid Argument | An unknown option was passed or a required value was missing |
| **10** | Internal JavaScript Run-Time Failure | Bootstrap code within Node itself threw |
| **12** | Invalid Debug Argument | `--inspect` or `--debug` was passed with an invalid port/host |
| **13** | Unfinished Top-Level Await | A top-level `await` never resolved and the event loop had nothing else to do |
| **>128** | Signal Exits | 128 + signal number. E.g., SIGKILL (9) produces exit code 137 (128 + 9). SIGTERM (15) produces 143. |

```typescript
// exit-codes-demo.ts
// Run: npx tsx exit-codes-demo.ts

import process from "node:process";

// Demonstrating manual exit code setting without calling process.exit()
process.exitCode = 0; // Set desired code; process will use this when it drains

// You can change it at any time before exit
process.exitCode = 1;

// This is the PREFERRED way to set an exit code.
// The process still runs to completion, unlike process.exit(1).
console.log("This line still executes.");
console.log("Current exitCode:", process.exitCode);

// Reset for clean exit in this demo
process.exitCode = 0;
```

```typescript
// tla-exit-13.ts
// Run: node --experimental-strip-types tla-exit-13.ts
// Then: echo $?   → 13

// This promise never resolves, and nothing else keeps the event loop alive.
// Node detects the stall and exits with code 13.
const neverResolves: Promise<void> = new Promise(() => {});
await neverResolves;
```

> **Node 22+ note:** Top-level await is stable in ESM. The exit code 13 behavior applies when the `await` expression is the only thing preventing the event loop from draining and the awaited promise never settles.

---

### `process.exit()` vs Letting the Loop Drain

`process.exit(code?)` forces an immediate termination. The event loop does not get another tick. This is almost always wrong in production code.

```typescript
// bad-exit.ts — DON'T do this in production
// Run: npx tsx bad-exit.ts

import { createServer } from "node:http";
import process from "node:process";

const server = createServer((_req, res) => {
  res.end("OK");
});

server.listen(3000, () => {
  console.log("Listening on 3000");

  // Simulate a "shutdown" — but this is WRONG:
  process.exit(0);
  // ❌ In-flight requests get TCP RST
  // ❌ Database pools don't drain
  // ❌ Streams don't flush
  // ❌ 'close' events on the server never fire
});
```

The correct approach: stop accepting new work, let existing work finish, then let the event loop drain naturally.

```typescript
// clean-shutdown.ts — the right way
// Run: npx tsx clean-shutdown.ts

import { createServer, type Server } from "node:http";
import process from "node:process";

const server: Server = createServer((_req, res) => {
  res.end("OK");
});

function shutdown(signal: string): void {
  console.log(`Received ${signal}. Starting graceful shutdown...`);

  // 1. Stop accepting new connections
  server.close((err) => {
    if (err) {
      console.error("Error during server close:", err);
      process.exitCode = 1;
    }
    console.log("Server closed. Event loop will drain.");
    // 2. Close other resources (DB pools, caches, etc.) here
    // 3. Do NOT call process.exit() — let the loop empty itself
  });

  // 4. Safety net: force-kill if cleanup takes too long
  const forceTimeout = setTimeout(() => {
    console.error("Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10_000);

  // Unref the timer so it doesn't keep the loop alive if everything else finishes
  forceTimeout.unref();
}

server.listen(3000, () => {
  console.log("Listening on 3000");
});

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
```

**Why `process.exit()` is dangerous:** It calls the C++ `exit()` function synchronously. Any libuv handles that are still open (sockets, file descriptors, timers) are abandoned. Data buffered in writable streams (including `stdout` when piped) may be lost. The `'exit'` event fires, but only synchronous code runs in it — you cannot do any final async cleanup.

**The preferred pattern:**
1. Set `process.exitCode = N` to communicate the desired code.
2. Close servers and unref timers.
3. Let the event loop drain to zero handles and requests.
4. Node exits automatically with the code you set.

---

### `beforeExit` vs `exit` Events

These two events look similar but have fundamentally different semantics.

#### `beforeExit`

Fires when the event loop has emptied and Node is **about** to exit — but the process has not committed to exiting yet. You **can** schedule new async work inside this handler, and doing so will prevent the exit and keep the loop running. Once that new work finishes, `beforeExit` fires again.

```typescript
// before-exit-demo.ts
// Run: npx tsx before-exit-demo.ts

import process from "node:process";

let count = 0;

process.on("beforeExit", (code: number) => {
  console.log(`beforeExit fired (code=${code}), count=${count}`);

  if (count < 2) {
    count++;
    // Schedule async work — this PREVENTS exit and re-enters the loop
    setTimeout(() => {
      console.log(`Async work round ${count} done.`);
    }, 100);
  }
  // After count reaches 2, we stop scheduling work.
  // The loop drains, 'beforeExit' fires once more, then 'exit' fires.
});

process.on("exit", (code: number) => {
  console.log(`exit fired (code=${code}). No async allowed here.`);
});

console.log("Main module done. Event loop will drain.");
```

**Critical rules for `beforeExit`:**
- It does **NOT** fire if `process.exit()` is called explicitly.
- It does **NOT** fire after an uncaught exception.
- It does **NOT** fire if the process is killed by a signal.
- It fires only when the event loop drains on its own.

#### `exit`

Fires synchronously after the point of no return. The event loop is dead. Any async operations scheduled here (timers, promises, I/O) will be **silently discarded**.

```typescript
// exit-event-demo.ts
// Run: npx tsx exit-event-demo.ts

import process from "node:process";

process.on("exit", (code: number) => {
  console.log(`Exiting with code ${code}`);

  // This WILL run (synchronous):
  console.log("Synchronous cleanup here.");

  // This will NOT run (async — event loop is gone):
  setTimeout(() => {
    console.log("You will never see this.");
  }, 0);

  // You can change the exit code here as a last resort:
  // process.exitCode = 1;
});

console.log("Starting...");
// Nothing keeps the loop alive, so it drains → 'exit' fires.
```

| Behavior | `beforeExit` | `exit` |
|----------|-------------|--------|
| Can schedule async work? | Yes (delays exit) | No (silently dropped) |
| Fires on `process.exit()`? | No | Yes |
| Fires on uncaught exception? | No | Yes |
| Fires on signal death? | No | No (unless your handler calls `process.exit()`) |
| Receives exit code argument? | Yes | Yes |

---

### POSIX Signals

Signals are the operating system's way of poking a process. Node exposes them through the `process` EventEmitter.

| Signal | Number | Default Behavior | Notes |
|--------|--------|-----------------|-------|
| **SIGTERM** | 15 | Terminate | The "polite" shutdown request. Sent by `docker stop`, K8s pod termination, `kill <pid>`. |
| **SIGINT** | 2 | Terminate | Sent by Ctrl+C in a terminal. |
| **SIGKILL** | 9 | Terminate (forced) | **Cannot be caught, blocked, or ignored.** The kernel kills the process immediately. |
| **SIGHUP** | 1 | Terminate | Terminal was closed. Historically used to tell daemons to reload config. |
| **SIGUSR1** | 10 | Start debugger | Node reserves this to activate the inspector/debugger. If you add a listener, you override the debugger activation. |
| **SIGUSR2** | 12 | Terminate | Free for application use. Often used by process managers like `nodemon` for restart. |
| **SIGPIPE** | 13 | Ignored by Node | Default OS behavior would terminate, but Node ignores it to handle write errors in-band. |
| **SIGWINCH** | 28 | No action | Terminal window was resized. Node resets the terminal if `stdout` is a TTY. |

```typescript
// signal-handlers.ts
// Run: npx tsx signal-handlers.ts
// Then in another terminal: kill -SIGTERM <pid>

import process from "node:process";

console.log(`Process started. PID: ${process.pid}`);

// SIGTERM — graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM. Cleaning up...");
  // Do your cleanup, then let the process exit:
  process.exitCode = 0;
  // Remove the listener so the default behavior (terminate) takes effect
  // on a second SIGTERM, or just exit:
  process.exit(0);
});

// SIGINT — Ctrl+C
process.on("SIGINT", () => {
  console.log("\nReceived SIGINT (Ctrl+C). Shutting down...");
  process.exit(0);
});

// SIGHUP — terminal closed or config reload
process.on("SIGHUP", () => {
  console.log("Received SIGHUP. Reloading config...");
  // Re-read config files, reopen log files, etc.
});

// Keep the process alive
setInterval(() => {
  console.log("Still alive...");
}, 5000);
```

**Important behaviors:**

- Installing a handler for SIGINT or SIGTERM **replaces** the default behavior (which is to terminate). Your handler is now fully responsible for ending the process if that is what you want.
- You can call `process.kill(process.pid, signal)` to send a signal to yourself. This is sometimes used for testing or re-raising a signal after cleanup.
- **Windows** has limited signal support. SIGINT works from the console, SIGTERM is emitted on `process.kill()` but has no OS equivalent. SIGHUP is emitted when the console window is closed.

```typescript
// re-raise-signal.ts
// Run: npx tsx re-raise-signal.ts
// Press Ctrl+C to test

import process from "node:process";

process.on("SIGINT", () => {
  console.log("\nCaught SIGINT. Cleaning up...");

  // After cleanup, re-raise so the parent process sees the correct
  // exit signal (exit code 130 = 128 + 2) instead of exit code 0.
  process.removeAllListeners("SIGINT");
  process.kill(process.pid, "SIGINT");
});

setInterval(() => {}, 1000); // Keep alive
```

---

### PID 1 Behavior in Containers

When Node runs as **PID 1** inside a Docker container, signal handling breaks in a subtle and dangerous way.

**The problem:** On Linux, PID 1 (the init process) has special kernel behavior. Signals that would normally terminate a process (SIGTERM, SIGINT) are **ignored by default** if PID 1 has not explicitly installed a handler for them. Node does not install a default SIGTERM handler at the C level — it relies on the OS default behavior (terminate). But as PID 1, there is no OS default to fall back on.

**What happens in practice:**

1. K8s sends `SIGTERM` to your pod to initiate graceful shutdown.
2. Your Node process, running as PID 1 with no SIGTERM listener, ignores the signal.
3. K8s waits for `terminationGracePeriodSeconds` (default 30s).
4. K8s sends SIGKILL. The process dies immediately — no cleanup, no connection draining, no graceful shutdown.
5. Clients see broken connections. Database transactions are left hanging.

```dockerfile
# BAD — Node runs as PID 1
FROM node:22-slim
WORKDIR /app
COPY . .
CMD ["node", "server.js"]
```

```dockerfile
# GOOD — Use tini as the init process (PID 1)
FROM node:22-slim
RUN apt-get update && apt-get install -y tini
WORKDIR /app
COPY . .
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
```

```dockerfile
# ALSO GOOD — Docker's built-in init flag (uses tini internally)
# Run with: docker run --init my-image
FROM node:22-slim
WORKDIR /app
COPY . .
CMD ["node", "server.js"]
```

**What `tini` does:** It runs as PID 1 and forwards signals to your Node process (which runs as PID 2). It also reaps zombie child processes — another responsibility of PID 1 that Node does not handle.

**Alternative:** If you cannot use `tini`, install signal handlers explicitly in your code:

```typescript
// pid1-safe-handlers.ts
// Ensures signals are caught even when running as PID 1

import process from "node:process";

function handleSignal(signal: string): void {
  console.log(`Received ${signal} as PID ${process.pid}`);
  // Your cleanup logic here
  process.exit(0);
}

// Always install these when running in containers
process.on("SIGTERM", () => handleSignal("SIGTERM"));
process.on("SIGINT", () => handleSignal("SIGINT"));
```

> **K8s lifecycle note:** When K8s terminates a pod, the sequence is: (1) pod marked as `Terminating`, (2) `preStop` hook runs if defined, (3) SIGTERM sent to PID 1, (4) wait `terminationGracePeriodSeconds`, (5) SIGKILL. Your graceful shutdown window is step 3-4. If you miss SIGTERM, you waste that entire window.

---

### stdio Streams

Node exposes three pre-opened streams on the `process` object:

| Stream | Type | File Descriptor |
|--------|------|----------------|
| `process.stdin` | `Readable` | fd 0 |
| `process.stdout` | `Writable` | fd 1 |
| `process.stderr` | `Writable` | fd 2 |

The surprising part is their **synchronous vs asynchronous** behavior, which depends on what they are connected to:

| Connected To | `stdout` Behavior | `stderr` Behavior |
|-------------|-------------------|-------------------|
| **TTY** (terminal) | Async, line-buffered | Async, line-buffered |
| **Pipe** (e.g., `node app.js \| less`) | **Synchronous, blocking** | **Synchronous, blocking** |
| **File** (e.g., `node app.js > out.log`) | **Synchronous, blocking** | **Synchronous, blocking** |

```typescript
// stdio-detection.ts
// Run three ways to see the difference:
//   npx tsx stdio-detection.ts              (TTY)
//   npx tsx stdio-detection.ts | cat        (pipe)
//   npx tsx stdio-detection.ts > /tmp/out   (file)

import process from "node:process";

console.log("stdout isTTY:", process.stdout.isTTY ?? false);
console.log("stderr isTTY:", process.stderr.isTTY ?? false);
console.log("stdin  isTTY:", process.stdin.isTTY ?? false);

// When stdout is a pipe or file, console.log() is SYNCHRONOUS.
// This means a slow pipe consumer (e.g., `| less`) will block
// your Node process on every write. In extreme cases, this can
// make your server unresponsive.
```

**Why this matters in production:**

- If you pipe your application's output to a logging agent and that agent slows down or stalls, your Node process blocks on every `console.log()` call. Response latency spikes.
- `process.stderr` is **not buffered** when connected to a TTY — each `console.error()` call goes out immediately, which is why error logging feels "instant" during development.
- `process.stdout.write()` returns `false` when the internal buffer is full (backpressure), but `console.log()` ignores the return value. In high-throughput scenarios, prefer a proper logging library that respects backpressure.

```typescript
// stdin-example.ts
// Run: echo "hello world" | npx tsx stdin-example.ts

import process from "node:process";

const chunks: Buffer[] = [];

process.stdin.on("data", (chunk: Buffer) => {
  chunks.push(chunk);
});

process.stdin.on("end", () => {
  const input = Buffer.concat(chunks).toString("utf-8").trim();
  console.log(`Received ${input.length} characters: "${input}"`);
});

// stdin is paused by default in a TTY. If nothing pipes into this script,
// it will wait for user input until they press Ctrl+D (EOF).
```

> **Node 22+ note:** `process.stdout` and `process.stderr` gained a `fd` property for direct access to the underlying file descriptor number. The synchronous/async behavior has been stable since Node 12 and is documented as intentional — not a bug.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

### 1. Silent SIGTERM Drops in Containers

**Symptoms:** Pods take 30 seconds to terminate instead of the expected 2-3 seconds. Clients see `ECONNRESET` errors during deployments. Health check endpoints return 200 right up until the SIGKILL.

**Root cause:** Node is PID 1 with no SIGTERM handler installed. The signal is silently ignored. K8s waits the full `terminationGracePeriodSeconds`, then SIGKILL hits.

**Diagnosis:** Check your Dockerfile for `CMD ["node", ...]` without `tini` or `--init`. Run `docker exec <container> ps aux` — if your `node` process is PID 1, you are exposed. Fix by adding `tini` as the entrypoint or installing an explicit SIGTERM handler.

### 2. `process.exit()` in Request Handlers

**Symptoms:** Intermittent 502 errors from your load balancer. Database shows open transactions that were never committed or rolled back. Log files end mid-line.

**Root cause:** A developer added `process.exit(1)` in an error path (e.g., database connection failure). In-flight HTTP responses are dropped. Writable stream buffers (including the log file stream) are not flushed.

**Diagnosis:** Search your codebase for `process.exit(`. In library code, it should be zero occurrences. In application code, it should only appear in top-level signal handlers with a safety timeout. Replace with `process.exitCode = 1` and proper resource cleanup.

### 3. `beforeExit` Loops

**Symptoms:** Process never exits. CPU is at 100%. Memory grows without bound. The container keeps running forever after the workload should be done.

**Root cause:** A `beforeExit` handler unconditionally schedules new async work every time it fires. Since scheduling work prevents exit, `beforeExit` fires again after the work completes, creating an infinite loop.

**Diagnosis:** Add logging inside your `beforeExit` handler. If you see it firing repeatedly, add a guard condition (a counter or a "shutting down" flag) to stop scheduling after the first invocation.

### 4. Blocking stdout in Piped Deployments

**Symptoms:** Application response times spike 10-100x in production but not in development. CPU is mostly idle. The event loop appears stalled.

**Root cause:** In production, stdout is piped to a log collector (`node app.js | fluent-bit`). When connected to a pipe, `stdout.write()` is synchronous and blocking. If the log collector cannot consume fast enough, every `console.log()` becomes a blocking system call. In development, stdout is a TTY and writes are async.

**Diagnosis:** Check `process.stdout.isTTY`. If it is `undefined` or `false` in production, you are piped. Switch to a logging library that writes to files or sockets asynchronously instead of using stdout. Alternatively, redirect stdout to a file and use a sidecar to tail it.

:::

## 🎯 Checkpoint

::: details Question 1 — Exit Code 137
**Q:** Your container exits with code 137. No error is logged. What happened, and what is your first debugging step?

**A:** Exit code 137 = 128 + 9, meaning the process was killed by SIGKILL (signal 9). SIGKILL cannot be caught, so no cleanup or logging runs. The most common cause in a container environment is the OOM Killer (the process exceeded its memory limit and the kernel killed it) or K8s sending SIGKILL after `terminationGracePeriodSeconds` elapsed without the process exiting. First debugging step: check `kubectl describe pod <name>` for `OOMKilled` in the termination reason. If not OOM, check whether your graceful shutdown handler is actually working — the process may be ignoring SIGTERM (PID 1 problem) and getting SIGKILL after the grace period.
:::

::: details Question 2 — beforeExit and process.exit()
**Q:** You register a `beforeExit` handler that logs a message and flushes metrics to an external service. During testing it works perfectly. In production, when an uncaught exception terminates the process, the metrics never flush. Why?

**A:** `beforeExit` does **not** fire when the process exits due to an uncaught exception or an explicit `process.exit()` call. It only fires when the event loop drains naturally with no remaining work. For crash-time metric flushing, you need to use the `'exit'` event (synchronous only, so you can set a flag or write to a synchronous file, but cannot do network I/O) or — better — the `'uncaughtException'` event where you can attempt a final async flush with a timeout before calling `process.exit(1)`.
:::

::: details Question 3 — Synchronous stdout
**Q:** A developer reports that their Node.js HTTP server "freezes" for seconds at a time in production but never in development. They use `console.log()` extensively for request logging. CPU and memory look normal. What is your theory?

**A:** In production, stdout is likely connected to a pipe (e.g., `docker logs`, a logging sidecar, or systemd journal). When stdout is a pipe, `process.stdout.write()` is **synchronous and blocking**. If the pipe consumer is slow or its buffer fills up, every `console.log()` call blocks the entire event loop until the kernel buffer drains. In development, stdout goes to a TTY and writes are async. The fix is to replace `console.log()` with an async logging library (pino, winston with a stream transport) that writes to a file or socket, not stdout. Alternatively, redirect stdout to `/dev/null` in the container and write structured logs to a separate file that a sidecar tails.
:::

::: details Question 4 — PID 1 and Zombie Processes
**Q:** Your containerized application spawns child processes using `child_process.exec()`. Over time, `ps aux` in the container shows dozens of `<defunct>` processes. What is going on?

**A:** When a child process exits, it becomes a "zombie" until its parent calls `waitpid()` to read its exit status. Normally, the init system (PID 1) acts as a "subreaper" and automatically reaps orphaned zombies. When Node runs as PID 1, it does not perform this reaping for processes it did not directly spawn (or for processes whose exit events were not consumed). The fix is to use `tini` or `docker --init` as PID 1. `tini` calls `waitpid(-1)` in a loop to reap all zombie children. Alternatively, ensure every `exec()`/`spawn()` call in your code attaches an `'exit'` or `'close'` listener.
:::

## Key Mental Models

- **Exit code is a contract.** Zero means success; everything else is a specific failure mode. The parent process (shell, K8s, systemd) relies on this to decide whether to restart you.
- **`process.exit()` is an ejection seat.** It gets you out, but everything in the cockpit is destroyed. Use it only as a last-resort timeout in shutdown handlers, never as normal flow control.
- **`beforeExit` is a second chance; `exit` is a farewell.** `beforeExit` lets you schedule more work before the process commits to dying. `exit` is synchronous-only and final — use it for last-breath logging, not cleanup.
- **Signals have a hierarchy.** SIGTERM asks politely. SIGINT asks firmly. SIGKILL does not ask. Your code should handle the first two; the third is the operating system's guarantee that no process runs forever.
- **PID 1 is special.** In containers, if your process is PID 1, signals are silently swallowed and zombie children pile up. Always use an init system (`tini`, `docker --init`) or install explicit handlers.

## Related

- [What Node Actually Is](./01-what-node-is) — architecture of V8, libuv, and the binding layer that `process` sits on top of
- [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown) — full patterns for draining connections, closing pools, and coordinating with K8s
- [Error Doctrine](/nodejs/module-03/06-error-doctrine) — when to throw, when to reject, and how uncaught exceptions trigger exit code 1
- [Unhandled Rejections](/nodejs/module-03/02-unhandled-rejections) — how unhandled promise rejections became fatal in Node 15+ and their effect on exit codes
