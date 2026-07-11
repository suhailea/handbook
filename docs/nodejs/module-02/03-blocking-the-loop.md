---
title: Blocking the Loop
outline: deep
---

# Blocking the Loop

> **Interview weight:** :fire::fire::fire: — one of the most commonly asked Node.js topics at every level.
>
> **Node version notes:** `monitorEventLoopDelay` requires Node 11.10+. `eventLoopUtilization` requires Node 14+. All other examples run on Node 22+.
>
> **Prerequisites:** [libuv Phases](./01-libuv-phases), basic understanding of synchronous vs asynchronous execution.

## :speaking_head: In Plain English

::: tip In Plain English
Imagine a single cashier working at a busy coffee shop. Customers line up, the cashier takes an order, passes it to the barista, and immediately moves on to the next customer. The line flows smoothly because the cashier never waits for a drink to be made — they just keep processing the queue.

Now imagine one customer walks up and asks the cashier to personally grind coffee beans by hand for five minutes. The cashier cannot take any other orders during that time. Every customer behind that person is stuck waiting. The drinks that are already done? They sit on the counter getting cold because the cashier is the only one who can call out names and hand them over. Health inspectors walk in and nobody greets them — they assume the shop is down.

That is what blocking the event loop means. Node.js has one cashier (the main JavaScript thread). When you give it synchronous, CPU-heavy work — computing a huge Fibonacci number, parsing a 50MB JSON blob, running a regex with catastrophic backtracking — that one thread is occupied. During that time, no I/O callbacks fire. No HTTP responses go out. No timers execute. Health check endpoints stop responding. Load balancers mark the process as dead. Clients see connection timeouts.

The sneaky part is that "blocking" does not only mean obviously slow code. A `JSON.parse` call on a moderately large payload might take 200ms — enough to make hundreds of concurrent requests wait. A synchronous bcrypt hash might take 100ms. These are invisible until traffic ramps up and suddenly your p99 latency spikes from 5ms to 2 seconds.

The good news is that Node gives you built-in tools to detect blocking (`monitorEventLoopDelay`, Event Loop Utilization) and strategies to avoid it (worker threads, partitioning with `setImmediate`, offloading to separate services, streaming instead of buffering). The rest of this page covers all of them.
:::

## :gear: Under the Hood

### What "blocking" means at the mechanism level

The event loop is a single-threaded loop that processes phases (timers, I/O callbacks, idle/prepare, poll, check, close). When JavaScript runs synchronously on the main thread, the loop cannot advance to the next phase. Every pending callback, every queued timer, every ready socket — all wait until the synchronous work completes.

```typescript
// run: node --experimental-strip-types blocking-demo.ts
import { createServer, IncomingMessage, ServerResponse } from "node:http";

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === "/slow") {
    // This blocks the entire event loop for ~2-5 seconds
    const result = fibonacci(42);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ result }));
  } else {
    // This handler cannot run while /slow is computing
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  }
});

server.listen(3000, () => {
  console.log("Server on :3000 — try hitting /slow and / simultaneously");
});
```

Hit `/slow` in one terminal and `/` in another. The second request hangs until the Fibonacci computation completes — even though it needs zero computation.

### Measuring the damage: `monitorEventLoopDelay`

Node 11.10 introduced `perf_hooks.monitorEventLoopDelay`. It creates a histogram that samples the delay between when a callback is *scheduled* to run and when it *actually runs*. A healthy loop shows delays under 20ms. A blocked loop shows spikes into hundreds of milliseconds or seconds.

```typescript
// run: node --experimental-strip-types monitor-delay.ts
import { monitorEventLoopDelay } from "node:perf_hooks";

// Resolution: sample every 20ms
const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

// Simulate blocking work
function blockFor(ms: number): void {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // intentionally blocking
  }
}

// Print stats every 2 seconds
setInterval(() => {
  console.table({
    min: `${(histogram.min / 1e6).toFixed(2)} ms`,
    max: `${(histogram.max / 1e6).toFixed(2)} ms`,
    mean: `${(histogram.mean / 1e6).toFixed(2)} ms`,
    p50: `${(histogram.percentile(50) / 1e6).toFixed(2)} ms`,
    p99: `${(histogram.percentile(99) / 1e6).toFixed(2)} ms`,
    stddev: `${(histogram.stddev / 1e6).toFixed(2)} ms`,
  });
  histogram.reset();
}, 2000);

// Block the loop for 500ms every 3 seconds
setInterval(() => {
  console.log("Blocking for 500ms...");
  blockFor(500);
}, 3000);
```

| Histogram field | What it tells you | Units |
|---|---|---|
| `min` | Best-case delay (nanoseconds) | Divide by 1e6 for ms |
| `max` | Worst-case delay — your blocking culprit | Divide by 1e6 for ms |
| `mean` | Average delay across all samples | Divide by 1e6 for ms |
| `percentile(N)` | N-th percentile (50, 90, 95, 99) | Divide by 1e6 for ms |
| `stddev` | Consistency — high stddev = sporadic blocking | Divide by 1e6 for ms |
| `exceeds` | Count of delays exceeding a threshold | Count |

### Event Loop Utilization (ELU) — the SLO metric

Available since Node 14, `eventLoopUtilization()` returns the ratio of time the event loop spent *active* (running callbacks) versus *idle* (waiting for I/O). This is a better health metric than CPU usage because a process can have low CPU but a completely saturated loop.

**ELU = active / (active + idle)**

| ELU value | Interpretation |
|---|---|
| 0.0 – 0.5 | Healthy. Plenty of headroom. |
| 0.5 – 0.7 | Moderate load. Monitor closely. |
| 0.7 – 0.9 | Heavy load. Start scaling or optimizing. |
| 0.9 – 1.0 | Critical. The loop is nearly 100% busy. Requests will queue and timeout. |

```typescript
// run: node --experimental-strip-types elu-monitor.ts
import { performance } from "node:perf_hooks";

function measureELU(intervalMs: number): void {
  // Take a snapshot now
  let prev = performance.eventLoopUtilization();

  setInterval(() => {
    // Calculate ELU *between* the two snapshots
    const curr = performance.eventLoopUtilization();
    const diff = performance.eventLoopUtilization(curr, prev);

    console.log({
      idle: `${(diff.idle).toFixed(2)} ms`,
      active: `${(diff.active).toFixed(2)} ms`,
      utilization: `${(diff.utilization * 100).toFixed(1)}%`,
    });

    prev = curr;
  }, intervalMs);
}

// Monitor every second
measureELU(1000);

// Simulate periodic blocking
setInterval(() => {
  const start = Date.now();
  while (Date.now() - start < 300) {
    // blocking
  }
}, 2000);
```

### Strategies to avoid blocking

#### 1. Worker threads — true parallelism

Move CPU-heavy work off the main thread entirely. The worker runs on its own V8 isolate with its own event loop.

```typescript
// run: node --experimental-strip-types worker-fib.ts
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { fileURLToPath } from "node:url";

function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

if (!isMainThread) {
  // Worker: compute and send result back
  const result = fibonacci(workerData.n as number);
  parentPort!.postMessage(result);
} else {
  // Main thread: spawn worker, keep event loop free
  console.log("Main thread: starting heavy computation in worker...");
  console.time("worker");

  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: { n: 42 },
  });

  worker.on("message", (result: number) => {
    console.timeEnd("worker");
    console.log(`Result: ${result}`);
  });

  // Main thread is free to handle other work
  setInterval(() => console.log("Main thread: still responsive!"), 500);
}
```

#### 2. Partitioning with `setImmediate` — cooperative scheduling

Break large synchronous operations into chunks. Between chunks, yield control back to the event loop so it can process pending I/O.

```typescript
// run: node --experimental-strip-types partition-demo.ts

function processArrayInChunks<T>(
  items: T[],
  processFn: (item: T) => void,
  chunkSize: number,
): Promise<void> {
  return new Promise((resolve) => {
    let index = 0;

    function processChunk(): void {
      const end = Math.min(index + chunkSize, items.length);
      for (; index < end; index++) {
        processFn(items[index]!);
      }

      if (index < items.length) {
        // Yield to the event loop, then continue
        setImmediate(processChunk);
      } else {
        resolve();
      }
    }

    processChunk();
  });
}

// Simulate: process 1 million items without blocking
const data = Array.from({ length: 1_000_000 }, (_, i) => i);
let sum = 0;

console.time("partitioned");
await processArrayInChunks(data, (n) => { sum += n; }, 10_000);
console.timeEnd("partitioned");
console.log(`Sum: ${sum}`);
```

#### 3. Streaming instead of buffering

Do not load an entire large payload into memory and parse it at once. Use streaming parsers.

```typescript
// run: node --experimental-strip-types stream-json.ts
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { Transform, TransformCallback } from "node:stream";

// Instead of: const data = JSON.parse(fs.readFileSync("huge.json", "utf8"));
// Use a streaming approach — process line-delimited JSON (NDJSON) one record at a time.

class NdjsonParser extends Transform {
  private buffer = "";

  constructor() {
    super({ objectMode: true });
  }

  _transform(chunk: Buffer, _encoding: string, callback: TransformCallback): void {
    this.buffer += chunk.toString();
    const lines = this.buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    this.buffer = lines.pop()!;

    for (const line of lines) {
      if (line.trim()) {
        try {
          this.push(JSON.parse(line));
        } catch {
          // skip malformed lines
        }
      }
    }
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.buffer.trim()) {
      try {
        this.push(JSON.parse(this.buffer));
      } catch {
        // skip malformed
      }
    }
    callback();
  }
}

let count = 0;
const counter = new Transform({
  objectMode: true,
  transform(_record, _encoding, callback) {
    count++;
    callback();
  },
});

// Replace with your actual NDJSON file path
const filePath = process.argv[2];
if (filePath) {
  await pipeline(createReadStream(filePath), new NdjsonParser(), counter);
  console.log(`Processed ${count} records without blocking the loop.`);
} else {
  console.log("Usage: node stream-json.ts <path-to-ndjson-file>");
}
```

### Production monitoring: exposing ELU and loop delay as metrics

```typescript
// run: node --experimental-strip-types prom-metrics.ts
import { monitorEventLoopDelay } from "node:perf_hooks";
import { performance } from "node:perf_hooks";
import { createServer } from "node:http";

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

let prevELU = performance.eventLoopUtilization();

// Expose a /metrics endpoint compatible with Prometheus scraping
const server = createServer((req, res) => {
  if (req.url === "/metrics") {
    const elu = performance.eventLoopUtilization(
      performance.eventLoopUtilization(),
      prevELU,
    );
    prevELU = performance.eventLoopUtilization();

    const metrics = [
      `# HELP nodejs_eventloop_lag_seconds Event loop lag in seconds.`,
      `# TYPE nodejs_eventloop_lag_seconds gauge`,
      `nodejs_eventloop_lag_seconds{quantile="0.5"} ${(histogram.percentile(50) / 1e9).toFixed(6)}`,
      `nodejs_eventloop_lag_seconds{quantile="0.9"} ${(histogram.percentile(90) / 1e9).toFixed(6)}`,
      `nodejs_eventloop_lag_seconds{quantile="0.99"} ${(histogram.percentile(99) / 1e9).toFixed(6)}`,
      `nodejs_eventloop_lag_max_seconds ${(histogram.max / 1e9).toFixed(6)}`,
      ``,
      `# HELP nodejs_eventloop_utilization Event loop utilization (0-1).`,
      `# TYPE nodejs_eventloop_utilization gauge`,
      `nodejs_eventloop_utilization ${elu.utilization.toFixed(4)}`,
    ].join("\n");

    histogram.reset();
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4" });
    res.end(metrics);
  } else {
    res.writeHead(200).end("OK");
  }
});

server.listen(9100, () => {
  console.log("Metrics server on :9100/metrics");
});
```

### Real-world blocking culprits

| Culprit | Why it blocks | Typical duration | Fix |
|---|---|---|---|
| `JSON.parse` / `JSON.stringify` on >10MB | Synchronous C++ parsing on main thread | 100ms–2s | Stream-parse (NDJSON, SAX-style), or move to worker |
| `bcrypt.hashSync` | CPU-intensive key derivation | 50–300ms per hash | Use `bcrypt.hash` (async, uses threadpool) or `argon2` |
| Image/PDF processing in-process | Heavy pixel/vector manipulation | 500ms–10s | Use `worker_threads` or offload to a dedicated service |
| Regex catastrophic backtracking (ReDoS) | Exponential-time regex matching | Seconds to minutes | Audit regexes with `safe-regex`, use RE2 engine |
| Large array `.sort()` / `.filter()` / `.map()` | Synchronous V8 operations on huge arrays | 50–500ms | Partition with `setImmediate`, or use worker threads |
| `fs.readFileSync` / `fs.writeFileSync` | Synchronous I/O — thread waits for OS | Variable (disk-dependent) | Always use `fs.promises` or callback-based `fs` |

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. The "ghost timeout" — health checks fail under CPU load**
- **Symptoms:** Load balancer marks instances as unhealthy. Kubernetes restarts pods. No errors in application logs — the process is alive, just unresponsive.
- **Root cause:** A synchronous operation (often a `JSON.stringify` for logging, or a validation library doing synchronous schema compilation) blocks the loop for 5+ seconds. The health check endpoint never gets a chance to respond.
- **Diagnosis:** Enable `monitorEventLoopDelay`. If `max` regularly exceeds your health check timeout, you have a blocking problem. Use `--prof` or `--cpu-prof` to find the synchronous hot path.

**2. Slow regex takes down production (ReDoS)**
- **Symptoms:** One specific request causes the server to hang. Other requests queue up. CPU is pegged at 100% on a single core.
- **Root cause:** A regex like `/^(a+)+$/` applied to a crafted input causes exponential backtracking. A 30-character input can take minutes.
- **Diagnosis:** Check for regexes applied to user input. Use the `safe-regex` or `re2` package to validate patterns. Monitor event loop delay — a sudden spike correlated with a specific endpoint is a strong signal.

**3. ELU creep goes unnoticed until it is too late**
- **Symptoms:** Latency gradually increases over weeks. No single event triggers an alert. Then one day, a small traffic increase pushes p99 from 200ms to 5s.
- **Root cause:** Accumulated "small" synchronous work — logging serialization, middleware, validation — each taking 1-5ms but stacking up. ELU crept from 0.3 to 0.85 without anyone noticing.
- **Diagnosis:** Track ELU as a time-series metric. Set alerts at 0.7 (warning) and 0.85 (critical). This is a leading indicator — it tells you the loop is saturating before users feel it.

**4. `JSON.parse` on a webhook payload crashes the service**
- **Symptoms:** A single large webhook payload (50MB+) causes 100% CPU for several seconds. All concurrent requests timeout.
- **Root cause:** Express/Fastify body parser defaults allow large payloads and call `JSON.parse` synchronously on the main thread.
- **Diagnosis:** Set `body-parser` limits (`{ limit: '1mb' }`). For large payloads, use streaming body parsing or accept the payload as a file upload and process it in a worker.
:::

## :dart: Checkpoint

::: details Question 1 — ELU Interpretation
**Q:** Your monitoring dashboard shows an ELU of 0.92 over the last 5 minutes. CPU usage is at 35%. What is happening, and what should you do?

**A:** An ELU of 0.92 means the event loop is active 92% of the time — it is nearly saturated. The low CPU (35%) is normal because ELU measures *main thread* busyness, and the machine likely has multiple cores. The main thread is almost never idle, meaning callbacks queue up and latency increases. Immediate actions: (1) identify the blocking work using `--cpu-prof` and flame graphs, (2) offload CPU-heavy operations to worker threads or separate services, (3) check for synchronous operations that can be made async, (4) scale horizontally if the workload is inherently CPU-bound. Long-term: set an ELU alert threshold at 0.7-0.8 so you catch this before it reaches critical levels.
:::

::: details Question 2 — monitorEventLoopDelay Mechanics
**Q:** `monitorEventLoopDelay` reports a `mean` of 2ms but a `max` of 1200ms. What does this tell you? How does the histogram collect its samples?

**A:** The histogram works by scheduling a timer at the configured `resolution` interval (e.g., every 20ms). When that timer fires, it measures how late it was — the difference between when it was *supposed* to fire and when it *actually* fired. A mean of 2ms indicates the loop is generally healthy. A max of 1200ms means that at least once during the measurement period, the loop was blocked for approximately 1.2 seconds. This is a sporadic blocking event — likely a periodic task such as cache serialization, log rotation, or a large synchronous computation triggered by a specific request pattern. You should correlate the spike with application events (request logs, cron jobs) to identify the culprit.
:::

::: details Question 3 — Partitioning vs Worker Threads
**Q:** You need to sort a 5-million-element array in a Node.js API server. Should you use `setImmediate`-based partitioning or `worker_threads`? Why?

**A:** Use `worker_threads`. Sorting cannot be meaningfully partitioned with `setImmediate` because most sorting algorithms (including V8's TimSort) are not designed to yield mid-sort and resume. You would need to implement a custom incremental sort (like merge sort with manual chunk merging), which adds complexity and is slower overall. A worker thread runs the sort on a separate V8 isolate, keeping the main thread completely free. The trade-off is the cost of transferring the data — for 5 million numbers, use a `SharedArrayBuffer` to avoid serialization overhead. Partitioning with `setImmediate` is better suited for operations that are naturally decomposable into independent chunks, like iterating over an array to transform each element.
:::

## Key Mental Models

- **One thread, one chance.** Any synchronous work that takes more than a few milliseconds steals time from every concurrent connection. There is no preemption — the loop cannot interrupt your code.
- **ELU is your leading indicator.** CPU usage hides the problem on multi-core machines. ELU directly measures how saturated the single JavaScript thread is. Treat 0.8+ as a red flag.
- **Event loop delay measures the gap between "should run" and "did run."** A high `max` with a low `mean` points to sporadic blocking. A high `mean` points to systemic overload.
- **Streaming beats buffering.** If you can process data incrementally, you never need to block the loop to parse a giant payload. This applies to JSON, CSV, XML, and binary protocols.
- **Workers for CPU, partitioning for iteration.** Use `worker_threads` when the work is inherently CPU-bound (crypto, sorting, image processing). Use `setImmediate` partitioning when you are iterating over a large dataset with lightweight per-item work.

## Related

- [libuv Phases](./01-libuv-phases) — understand the phases that get starved when you block
- [The libuv Threadpool](./04-threadpool) — blocking the threadpool is a related but distinct problem
- [worker_threads vs cluster vs Pods](/nodejs/module-06/04-workers-cluster) — choosing the right parallelism model
- [CPU Profiling & Flame Graphs](/nodejs/module-06/01-cpu-profiling) — finding exactly what is blocking your loop
