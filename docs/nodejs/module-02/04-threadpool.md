---
title: The libuv Threadpool
outline: deep
---

# The libuv Threadpool

> **Interview weight:** :fire::fire: — frequently tested alongside event loop questions, especially the `dns.lookup` vs `dns.resolve` distinction.
>
> **Node version notes:** All examples run on Node 22+. Threadpool behavior has been consistent since Node 10. `UV_THREADPOOL_SIZE` max was raised to 1024 in libuv 1.30 (Node 12+).
>
> **Prerequisites:** [libuv Phases](./01-libuv-phases), [What Node Actually Is](/nodejs/module-01/01-what-node-is)

## :speaking_head: In Plain English

::: tip In Plain English
Think of a restaurant kitchen. The head chef (the event loop) takes orders from the dining room and coordinates everything. Most of the time, the chef handles things directly — checking if food is ready, plating dishes, calling out orders. But some tasks cannot be done at the counter: grinding spices, kneading dough, slow-roasting a cut of meat. These tasks get handed to a small team of prep cooks working in the back.

The prep cook team is the libuv threadpool. By default, there are four prep cooks. When Node needs to do something that the operating system does not offer a non-blocking API for — reading a file, looking up a DNS name via the system resolver, running a cryptographic hash — it writes a ticket and drops it into the prep cooks' queue. A free prep cook picks it up, does the work, and returns the result to the head chef, who then serves it to the dining room.

Here is where it gets interesting. Network I/O (HTTP requests, TCP sockets, database connections) does *not* go through the prep cooks. The operating system provides efficient non-blocking interfaces for network operations (epoll on Linux, kqueue on macOS). The head chef handles these directly, like checking a timer or glancing at the pass — no prep cook needed.

The trouble starts when all four prep cooks are busy. If three are grinding spices (crypto operations) and one is kneading dough (a file read), and a new order comes in that needs a DNS lookup — it has to wait in line. The head chef is free, the dining room is ready, but the ticket sits in the queue because there are no available prep cooks. This is threadpool exhaustion, and it manifests as mysterious latency spikes: file reads that normally take 2ms suddenly take 500ms, not because the disk is slow, but because the thread was waiting in a queue.

You can hire more prep cooks by setting `UV_THREADPOOL_SIZE` to a higher number (up to 1024), but more cooks means more salaries (memory) and more bumping into each other (context switching). The real fix is understanding which operations need prep cooks and planning accordingly.
:::

## :gear: Under the Hood

### Which operations use the threadpool — and why

Not all asynchronous work in Node goes through the threadpool. The rule is: if the operating system provides an efficient non-blocking API, libuv uses it directly. If not, the work goes to the threadpool.

| Operation | Uses threadpool? | Why |
|---|---|---|
| `fs.*` (all file system ops) | Yes | Most OSes do not provide truly async file system APIs. Linux `io_uring` is changing this, but libuv still uses the threadpool for portability. |
| `dns.lookup()` | Yes | Calls POSIX `getaddrinfo()`, which is a blocking C library function. |
| `dns.resolve()` / `dns.resolve4()` etc. | **No** | Uses c-ares, an asynchronous DNS resolution library that operates on the event loop directly. |
| `crypto.pbkdf2()` | Yes | CPU-intensive key derivation — must not block the main thread. |
| `crypto.scrypt()` | Yes | Same reason as pbkdf2. |
| `crypto.randomBytes()` (large) | Yes | Gathering entropy for large buffers is blocking at the OS level. |
| `zlib.deflate()` / `zlib.inflate()` | Yes | CPU-intensive compression/decompression. |
| TCP / UDP / HTTP sockets | **No** | OS provides `epoll` (Linux), `kqueue` (macOS), IOCP (Windows) — all non-blocking. |
| `child_process.exec()` | **No** | Spawns a separate OS process, not a threadpool thread. |
| Timers (`setTimeout`, `setInterval`) | **No** | Managed by libuv's timer heap in the event loop directly. |

### The `dns.lookup` vs `dns.resolve` distinction

This is one of the most important practical differences in Node.js and a frequent interview question.

```typescript
// run: node --experimental-strip-types dns-comparison.ts
import { lookup } from "node:dns";
import { resolve4 } from "node:dns";
import { Resolver } from "node:dns/promises";

// dns.lookup — uses getaddrinfo() → THREADPOOL
// Respects /etc/hosts, nsswitch.conf, system resolver config
lookup("example.com", (err, address, family) => {
  if (err) throw err;
  console.log(`dns.lookup: ${address} (IPv${family}) — used threadpool`);
});

// dns.resolve4 — uses c-ares → EVENT LOOP directly
// Queries DNS servers directly, ignores /etc/hosts
resolve4("example.com", (err, addresses) => {
  if (err) throw err;
  console.log(`dns.resolve4: ${addresses.join(", ")} — used event loop, no threadpool`);
});

// In practice: Node's http.request and fetch use dns.lookup by default
// This means every outgoing HTTP request competes with fs operations for threadpool threads!
```

**Why this matters in production:** When your application makes many outgoing HTTP requests (calling microservices, external APIs), each request triggers a `dns.lookup` that occupies a threadpool thread. If your app also reads files or runs crypto operations, they all compete for the same 4 threads. Switching to `dns.resolve` (or using a custom lookup function) can eliminate this contention entirely.

### The default pool: 4 threads

libuv creates a threadpool of 4 threads by default. You can change this with the `UV_THREADPOOL_SIZE` environment variable, but it must be set **before the Node.js process initializes the pool** (at startup, not at runtime).

```typescript
// run: UV_THREADPOOL_SIZE=8 node --experimental-strip-types pool-size.ts
import { pbkdf2 } from "node:crypto";

// Demonstrate threadpool contention with default size
const iterations = 20;
const start = Date.now();

let completed = 0;

for (let i = 0; i < iterations; i++) {
  pbkdf2("password", "salt", 100_000, 64, "sha512", (err, _key) => {
    if (err) throw err;
    completed++;
    const elapsed = Date.now() - start;
    console.log(`Task ${completed} done at ${elapsed}ms`);

    if (completed === iterations) {
      console.log(`\nAll ${iterations} tasks done in ${elapsed}ms`);
      console.log(
        "Notice: with 4 threads, tasks complete in batches of 4.",
        "With UV_THREADPOOL_SIZE=8, batches of 8.",
      );
    }
  });
}
```

Run this with the default pool and then with `UV_THREADPOOL_SIZE=8`. You will see tasks completing in batches that match the pool size.

**Setting `UV_THREADPOOL_SIZE` at runtime does not work:**

```typescript
// run: node --experimental-strip-types pool-size-warning.ts
import { readFile } from "node:fs";

// THIS IS TOO LATE — the pool is already initialized
process.env.UV_THREADPOOL_SIZE = "16"; // Has no effect!

// The pool was created with 4 threads the first time any threadpool
// operation was requested (or at startup). This assignment is ignored.
readFile("/dev/null", () => {
  console.log("This still used 4 threads, not 16.");
  console.log("Set UV_THREADPOOL_SIZE in your shell, Dockerfile, or process manager.");
});
```

### `fs.promises` still uses the threadpool

A common misconception: "`fs.promises` is async, so it doesn't use the threadpool." Wrong. The promise-based API is syntactic sugar. Under the hood, it submits the same work items to the same libuv threadpool.

```typescript
// run: node --experimental-strip-types fs-promises-threadpool.ts
import { readFile } from "node:fs/promises";
import { pbkdf2 } from "node:crypto";

// Saturate the threadpool with crypto work
console.log("Saturating threadpool with crypto operations...");
const cryptoStart = Date.now();

for (let i = 0; i < 4; i++) {
  pbkdf2("password", "salt", 500_000, 64, "sha512", () => {
    console.log(`Crypto task done at ${Date.now() - cryptoStart}ms`);
  });
}

// Now try to read a tiny file — fs.promises uses the same threadpool!
const fsStart = Date.now();
const content = await readFile("/dev/null");
const fsElapsed = Date.now() - fsStart;

console.log(`fs.promises.readFile took ${fsElapsed}ms`);
console.log(
  fsElapsed > 50
    ? "^ Delayed by threadpool contention (expected with saturated pool)"
    : "^ Fast — threadpool had a free slot",
);
```

### Threadpool exhaustion: demonstration and diagnosis

```typescript
// run: node --experimental-strip-types exhaustion-demo.ts
import { readFile, writeFile } from "node:fs/promises";
import { pbkdf2 } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Write a test file
const testFile = join(tmpdir(), "threadpool-test.txt");
await writeFile(testFile, "hello");

// Phase 1: Baseline — read the file with an empty threadpool
const baseline = Date.now();
await readFile(testFile);
console.log(`Baseline readFile: ${Date.now() - baseline}ms`);

// Phase 2: Saturate all 4 threads with slow crypto
console.log("\nSaturating threadpool with 4 slow pbkdf2 operations...");

const promises: Promise<void>[] = [];

for (let i = 0; i < 4; i++) {
  promises.push(
    new Promise<void>((resolve) => {
      pbkdf2("password", "salt", 500_000, 64, "sha512", () => resolve());
    }),
  );
}

// While threads are busy, try to read the file
const blockedStart = Date.now();
const filePromise = readFile(testFile);

// The readFile is now queued — all 4 threads are busy with pbkdf2
const content = await filePromise;
const blockedElapsed = Date.now() - blockedStart;

console.log(`Blocked readFile: ${blockedElapsed}ms`);
console.log(
  `\nSlowdown factor: ${(blockedElapsed / Math.max(Date.now() - baseline, 1)).toFixed(0)}x`,
);

await Promise.all(promises);
console.log("Crypto operations complete.");
```

### Monitoring threadpool saturation

Node does not expose a direct "threadpool queue length" API. The practical approach is to use a **probe pattern**: periodically perform a known-fast threadpool operation and measure its latency. If it spikes, the pool is saturated.

```typescript
// run: node --experimental-strip-types threadpool-probe.ts
import { stat } from "node:fs/promises";
import { createServer } from "node:http";

const PROBE_TARGET = "/dev/null"; // Known-fast file
const PROBE_INTERVAL_MS = 1000;
const THRESHOLD_MS = 50; // A stat on /dev/null should take <1ms normally

let lastProbeLatency = 0;

async function probeThreadpool(): Promise<number> {
  const start = performance.now();
  await stat(PROBE_TARGET);
  return performance.now() - start;
}

// Probe every second
setInterval(async () => {
  lastProbeLatency = await probeThreadpool();
  if (lastProbeLatency > THRESHOLD_MS) {
    console.warn(
      `⚠ Threadpool saturation detected! Probe latency: ${lastProbeLatency.toFixed(1)}ms`,
    );
  }
}, PROBE_INTERVAL_MS);

// Expose probe latency as a metric
const server = createServer((req, res) => {
  if (req.url === "/metrics") {
    const metrics = [
      "# HELP nodejs_threadpool_probe_seconds Latency of a trivial fs.stat probe.",
      "# TYPE nodejs_threadpool_probe_seconds gauge",
      `nodejs_threadpool_probe_seconds ${(lastProbeLatency / 1000).toFixed(6)}`,
    ].join("\n");
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    res.end(metrics);
  } else {
    res.writeHead(200).end("OK");
  }
});

server.listen(9101, () => {
  console.log("Threadpool probe metrics on :9101/metrics");
});
```

### Tuning `UV_THREADPOOL_SIZE`

| Workload type | Recommended size | Rationale |
|---|---|---|
| Typical web server (few fs ops, some DNS) | 4–8 | Default is usually fine. Increase slightly if you see probe latency spikes. |
| File-heavy service (file uploads, static serving) | 16–32 | Many concurrent file reads/writes compete for threads. |
| Crypto-heavy (password hashing, TLS cert generation) | 16–64 | Each pbkdf2/scrypt call occupies a thread for 50-300ms. |
| Mixed fs + crypto + DNS | 32–64 | All three compete. Size based on the peak concurrent threadpool operations. |
| Services making many outgoing HTTP requests | 8–16 (or switch to `dns.resolve`) | Each `dns.lookup` burns a thread. Better fix: use c-ares via custom lookup. |

**Costs of too many threads:**
- Each thread allocates a stack (default 8MB virtual, ~few KB committed). At 1024 threads, that is 8GB of virtual address space.
- Context switching overhead increases with thread count — diminishing returns past 64 on most workloads.
- CPU cache thrashing on high core-count machines.

**Set it in your Dockerfile or process manager, not in code:**

```dockerfile
# Dockerfile
ENV UV_THREADPOOL_SIZE=16
CMD ["node", "server.js"]
```

```bash
# systemd service file
Environment=UV_THREADPOOL_SIZE=16
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. `dns.lookup` quietly starves file operations**
- **Symptoms:** `fs.readFile` calls that normally take 1-2ms start taking 200-500ms. No disk I/O spike visible. Application logs show no errors, just slow responses.
- **Root cause:** The application makes many outgoing HTTP requests (to microservices, S3, Redis Sentinel DNS). Each `http.request` / `fetch` call triggers `dns.lookup`, which occupies a threadpool thread. With 4 threads and bursts of 10+ outgoing requests, `fs` operations queue up behind DNS lookups.
- **Diagnosis:** Instrument threadpool probe latency (the `fs.stat` probe pattern above). If probe latency correlates with outgoing request volume, DNS lookups are the culprit. Fix: increase `UV_THREADPOOL_SIZE`, or configure your HTTP client to use `dns.resolve` (e.g., `{ lookup: customDnsResolve }` in the `http.Agent` options), or use a local DNS cache.

**2. Setting `UV_THREADPOOL_SIZE` too late**
- **Symptoms:** You set `process.env.UV_THREADPOOL_SIZE = "32"` in your application entry point, but threadpool contention persists. The pool still behaves as if it has 4 threads.
- **Root cause:** The threadpool initializes on first use. If any module imported before your assignment triggers a threadpool operation (a `require` that reads a file, a TLS certificate load, a `.env` parser), the pool is already created with 4 threads. Your assignment is ignored.
- **Diagnosis:** Set the variable in the shell environment, not in JavaScript. Verify with the probe pattern. In containerized environments, set it in the Dockerfile `ENV` directive.

**3. Password hashing blocks file serving**
- **Symptoms:** A registration or login endpoint uses `crypto.pbkdf2` with high iterations. During a burst of sign-ups, file-serving endpoints (static assets, uploads) slow to a crawl.
- **Root cause:** Each `pbkdf2` call occupies a threadpool thread for 100-300ms. Four concurrent password hashes saturate the pool. File reads queue behind them.
- **Diagnosis:** Time your `fs` probe during authentication bursts. Fix: increase pool size, or move password hashing to a dedicated worker thread or separate auth service.
:::

## :dart: Checkpoint

::: details Question 1 — dns.lookup vs dns.resolve
**Q:** Your Node.js service makes 50 outgoing HTTP requests per second to various microservices. You notice `fs.readFile` latency spikes coinciding with request bursts. Explain the connection and propose two solutions.

**A:** By default, `http.request` and `fetch` use `dns.lookup` for hostname resolution, which calls the blocking POSIX function `getaddrinfo()` and therefore uses the libuv threadpool. With 50 lookups per second, many of these queue up in the 4-thread pool, starving `fs.readFile` calls that use the same pool. Two solutions: (1) Increase `UV_THREADPOOL_SIZE` to 16-32 at process startup (via environment variable, not runtime assignment) to give both DNS and file operations room. (2) Configure your HTTP agent to use a custom lookup function based on `dns.resolve()` (which uses c-ares and bypasses the threadpool entirely), combined with a local DNS cache to avoid repeated queries. Solution 2 is superior because it removes the contention rather than just increasing capacity.
:::

::: details Question 2 — fs.promises and the threadpool
**Q:** A colleague argues that migrating from `fs.readFile` (callback) to `fs.promises.readFile` will reduce threadpool pressure because "promises are more async." Is this correct?

**A:** No. `fs.promises.readFile` is a wrapper around the same libuv threadpool mechanism. The promise API provides a more ergonomic interface (no callback nesting, works with `async/await`), but under the hood it submits identical work items to the threadpool. A `readFile` call uses one threadpool thread regardless of whether you use the callback API, the promise API, or `fs.readFileSync` (which blocks the main thread entirely but still uses a synchronous OS call, not the threadpool). To actually reduce threadpool pressure, you need to either (a) reduce the number of concurrent file operations, (b) increase `UV_THREADPOOL_SIZE`, (c) use caching to avoid repeated reads, or (d) use streaming (`createReadStream`) which still uses the threadpool but releases the thread between chunks.
:::

::: details Question 3 — Pool size tuning
**Q:** Why is the maximum `UV_THREADPOOL_SIZE` set to 1024, and why would you not just set it to 1024 for every application?

**A:** Each thread in the pool allocates a stack (typically 8MB of virtual address space, with physical pages committed on demand). At 1024 threads, that is 8GB of virtual address space, and potentially hundreds of MB of committed memory if threads are active. Beyond memory, more threads cause more context switching at the OS level — the CPU spends time saving and restoring thread state rather than doing useful work. Cache efficiency also drops as more threads compete for CPU caches. For most workloads, the optimal pool size is tied to the number of concurrent threadpool operations, not a maximum value. Empirically, 16-64 threads covers the vast majority of Node.js workloads. The right approach is to measure (using the probe pattern) and increase incrementally.
:::

## Key Mental Models

- **The threadpool is for operations the OS cannot do asynchronously.** File I/O, `getaddrinfo` DNS, CPU-heavy crypto, and compression go to the pool. Network I/O uses OS-native non-blocking APIs and never touches the pool.
- **`dns.lookup` is the hidden threadpool consumer.** Every outgoing HTTP request defaults to `dns.lookup`, meaning network-heavy services can exhaust the pool without a single `fs` call.
- **`fs.promises` is sugar, not a different mechanism.** The promise wrapper submits the same work to the same threadpool. It does not reduce contention.
- **Set `UV_THREADPOOL_SIZE` before the process starts, not in code.** The pool initializes on first use, and any early import can trigger it. Use environment variables in your Dockerfile or process manager.
- **Monitor indirectly with a probe.** Node exposes no threadpool queue length API. A periodic `fs.stat` on a known-fast path gives you a reliable saturation signal.

## Related

- [libuv Phases](./01-libuv-phases) — how the event loop dispatches work to the threadpool and collects results
- [Blocking the Loop](./03-blocking-the-loop) — a related but distinct problem: blocking the main thread vs exhausting the threadpool
- [What Node Actually Is](/nodejs/module-01/01-what-node-is) — the architecture that leads to a threadpool in the first place
- [HTTP, Keep-Alive & Pooling](/nodejs/module-05/02-http-keep-alive) — connection pooling reduces DNS lookups, which reduces threadpool pressure
