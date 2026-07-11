---
title: "worker_threads vs cluster vs Pods"
outline: deep
---

# worker_threads vs cluster vs Pods

**Interview weight:** 🔥🔥🔥 | **Node 22+** | Prerequisites: [CPU Profiling](./01-cpu-profiling), [Blocking the Loop](/nodejs/module-02/03-blocking-the-loop)

## 🗣️ In Plain English

::: tip In Plain English
Picture a restaurant kitchen. By default, Node.js is a kitchen with **one chef**. That chef is incredibly fast at switching between tasks — checking the oven, plating a dish, reading the next ticket — but can only do one thing at a time. If a ticket requires 30 minutes of solid chopping, every other ticket waits.

You have three ways to scale:

**worker_threads** is like giving the chef a second pair of hands at the same counter. They share the same kitchen (same process, same memory space). They can pass knives and cutting boards back and forth directly (SharedArrayBuffer). Great when the bottleneck is raw CPU work — image processing, encryption, parsing. But coordination is tricky: two pairs of hands reaching for the same knife at the same time causes problems, so you use explicit signals (Atomics) to take turns.

**cluster** is like opening identical copies of the entire kitchen, each with its own chef, its own fridge, its own set of knives. They do not share anything directly. A maître d' at the front door (the primary process) hands each incoming customer to whichever kitchen is free. This is the classic way to use all CPU cores for a web server — each process handles requests independently.

**K8s pods** is like opening multiple restaurant branches across the city. Each branch is a completely independent operation. A central dispatcher (the load balancer) sends customers to whichever branch has capacity. Pods can scale across machines, not just cores — and they can scale to zero or to thousands.

The rule of thumb: use **worker_threads** for CPU-heavy subtasks within a request. Use **cluster** (or just multiple pods) to utilize all cores for I/O-heavy servers. Use **pods** when you need to scale beyond a single machine or want independent failure isolation.
:::

## ⚙️ Under the Hood

### worker_threads — True Threads, Shared Memory

`worker_threads` *(stable since Node 12)* creates actual OS threads that each run their own V8 isolate and event loop. Unlike threads in Java or Go, **each worker has its own heap** — you cannot share JS objects across workers. Communication happens through:

1. **Structured clone** via `postMessage()` (deep copy, like JSON round-trip but supports more types)
2. **Transfer** via `postMessage(value, [transferList])` (zero-copy ownership transfer of ArrayBuffer)
3. **SharedArrayBuffer** (true shared memory, requires Atomics for synchronization)

```typescript
// run: node --experimental-strip-types worker-main.ts
// Main thread — offloads CPU work to a worker

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

if (isMainThread) {
  const currentFile = fileURLToPath(import.meta.url);

  // Spawn a worker, passing initial data
  const worker = new Worker(currentFile, {
    workerData: { iterations: 1_000_000_000 },
  });

  const start = performance.now();

  worker.on('message', (result: number) => {
    console.log(`Result: ${result}, took ${(performance.now() - start).toFixed(0)} ms`);
  });

  worker.on('error', (err) => console.error('Worker error:', err));
  worker.on('exit', (code) => console.log(`Worker exited with code ${code}`));

  // Main thread remains free to handle other work
  console.log('Main thread is not blocked');
} else {
  // Worker thread — runs CPU-intensive computation
  const { iterations } = workerData as { iterations: number };
  let sum = 0;
  for (let i = 0; i < iterations; i++) {
    sum += Math.sqrt(i);
  }
  parentPort!.postMessage(sum);
}
```

### SharedArrayBuffer and Atomics

SharedArrayBuffer allows truly shared memory between threads — no copying, no transfer. But raw shared memory requires explicit synchronization:

```typescript
// run: node --experimental-strip-types shared-memory.ts
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

if (isMainThread) {
  const currentFile = fileURLToPath(import.meta.url);

  // Shared buffer visible to both threads
  const shared = new SharedArrayBuffer(4); // 4 bytes = 1 Int32
  const view = new Int32Array(shared);

  const worker = new Worker(currentFile, { workerData: { shared } });

  worker.on('exit', () => {
    console.log(`Final counter value: ${Atomics.load(view, 0)}`);
    // Without Atomics, this could be any value due to race conditions
  });
} else {
  const { shared } = workerData as { shared: SharedArrayBuffer };
  const view = new Int32Array(shared);

  // Atomics.add is an atomic read-modify-write — thread-safe
  for (let i = 0; i < 100_000; i++) {
    Atomics.add(view, 0, 1);
  }
}
```

Key Atomics operations:

| Operation | Purpose |
|---|---|
| `Atomics.add/sub` | Atomic increment/decrement |
| `Atomics.load/store` | Atomic read/write with memory ordering guarantees |
| `Atomics.compareExchange` | CAS — foundation for lock-free data structures |
| `Atomics.wait/notify` | Block a thread until notified (like a futex) — **only in workers, not main thread** |

### Worker Thread Pool Pattern

Spawning a new worker per task is expensive (~30 ms startup). Production code uses a pool:

```typescript
// run: node --experimental-strip-types worker-pool.ts
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

interface Task {
  data: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

class WorkerPool extends EventEmitter {
  private workers: Worker[] = [];
  private freeWorkers: Worker[] = [];
  private queue: Task[] = [];

  constructor(private workerScript: string, private size: number) {
    super();
    for (let i = 0; i < size; i++) {
      const worker = new Worker(workerScript);
      this.workers.push(worker);
      this.freeWorkers.push(worker);
    }
  }

  runTask(data: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const task: Task = { data, resolve, reject };
      const worker = this.freeWorkers.pop();
      if (worker) {
        this.executeTask(worker, task);
      } else {
        this.queue.push(task); // wait for a free worker
      }
    });
  }

  private executeTask(worker: Worker, task: Task): void {
    const onMessage = (result: unknown) => {
      worker.removeListener('error', onError);
      task.resolve(result);
      this.recycle(worker);
    };
    const onError = (err: unknown) => {
      worker.removeListener('message', onMessage);
      task.reject(err);
      this.recycle(worker);
    };
    worker.once('message', onMessage);
    worker.once('error', onError);
    worker.postMessage(task.data);
  }

  private recycle(worker: Worker): void {
    const next = this.queue.shift();
    if (next) {
      this.executeTask(worker, next);
    } else {
      this.freeWorkers.push(worker);
    }
  }

  async destroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.terminate()));
  }
}

// Usage would be:
// const pool = new WorkerPool('./compute-worker.js', 4);
// const result = await pool.runTask({ input: 42 });
console.log('WorkerPool class defined — see usage pattern above');
```

### cluster — Multi-Process, Shared Ports

The `cluster` module *(stable since Node 0.8)* forks the main process into multiple child processes. The magic trick: **all children can listen on the same port**. The primary process accepts incoming connections and distributes them to workers.

```typescript
// run: node --experimental-strip-types cluster-server.ts
import cluster from 'node:cluster';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { availableParallelism } from 'node:os';

const numCPUs = availableParallelism();

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} forking ${numCPUs} workers`);

  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork(); // auto-restart
  });
} else {
  createServer((_req: IncomingMessage, res: ServerResponse) => {
    // Each worker runs this independently — separate V8 heap, separate event loop
    res.writeHead(200);
    res.end(`Handled by worker ${process.pid}\n`);
  }).listen(3000);

  console.log(`Worker ${process.pid} started`);
}
```

**How port sharing works (Linux):** The primary process creates the listening socket and passes the file descriptor to children via IPC. On Linux, the kernel's `SO_REUSEPORT` or round-robin distribution (`cluster.schedulingPolicy`) handles which child gets each connection.

| Scheduling policy | Behavior |
|---|---|
| `cluster.SCHED_RR` (default on Linux) | Primary accepts, round-robins to workers |
| `cluster.SCHED_NONE` (default on Windows/macOS) | OS decides which worker's `accept()` wins |

### Comparison Table

| Dimension | `worker_threads` | `cluster` | K8s Pods |
|---|---|---|---|
| **Isolation** | Separate V8 isolate, shared process | Separate OS process | Separate container/machine |
| **Memory** | Shared via SharedArrayBuffer | Fully isolated (IPC for communication) | Fully isolated (network for communication) |
| **Startup cost** | ~30 ms | ~100 ms (full process fork) | Seconds (container pull + boot) |
| **Failure blast radius** | Worker crash can destabilize process | Worker crash is isolated | Pod crash is fully isolated |
| **Scaling** | Same machine, same cores | Same machine, all cores | Across machines, unlimited |
| **Port sharing** | Not applicable (workers don't listen) | Built-in via fd passing | Load balancer / Service |
| **Best for** | CPU-heavy subtasks | Multi-core HTTP servers | Production horizontal scaling |

### When to Use Each

**worker_threads:** Your HTTP server receives a request that requires heavy computation — image resizing, PDF generation, bcrypt hashing, JSON schema validation of a 10 MB payload. Offload to a worker pool. The main thread stays responsive.

**cluster:** You have a straightforward HTTP/WebSocket server that is I/O bound. Each request is independent. You want to use all 8 cores. Fork 8 workers. This is the simplest way to go from 1 core to N cores with zero code changes.

**K8s pods (multiple replicas):** You need to scale beyond a single machine, deploy independently, or tolerate machine failure. In modern deployments, many teams skip `cluster` entirely and just run one Node process per pod with `replicas: N`. The K8s Service handles load distribution. This is simpler to reason about and gives you rolling deployments, health checks, and auto-scaling for free.

```yaml
# K8s deployment — one Node process per pod, let K8s scale horizontally
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
spec:
  replicas: 4 # equivalent to cluster with 4 workers, but across machines
  template:
    spec:
      containers:
        - name: api
          image: myapp:latest
          resources:
            requests:
              cpu: "1"
              memory: "512Mi"
            limits:
              cpu: "1"
              memory: "512Mi"
          # One Node process, one core — simple, predictable
          command: ["node", "--max-old-space-size=384", "server.js"]
```

### MessageChannel for Worker-to-Worker Communication

Workers can communicate directly without routing through the main thread:

```typescript
// run: node --experimental-strip-types message-channel.ts
import { Worker, isMainThread, parentPort, MessageChannel } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

if (isMainThread) {
  const currentFile = fileURLToPath(import.meta.url);
  const { port1, port2 } = new MessageChannel();

  // Each worker gets one end of the channel
  const workerA = new Worker(currentFile, { workerData: { role: 'sender' } });
  const workerB = new Worker(currentFile, { workerData: { role: 'receiver' } });

  // Transfer ports — after this, main thread cannot use them
  workerA.postMessage({ port: port1 }, [port1]);
  workerB.postMessage({ port: port2 }, [port2]);
} else {
  parentPort!.on('message', (msg: { port: MessagePort }) => {
    const { port } = msg;
    const { workerData } = require('node:worker_threads');
    if (workerData.role === 'sender') {
      port.postMessage('Hello directly from worker A');
    } else {
      port.on('message', (data: string) => {
        console.log(`Worker B received: ${data}`);
        port.close();
      });
    }
  });
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Spawning workers per-request destroys performance.**
Symptom: response times increase from 50 ms to 200 ms when you add worker_threads for a "simple" CPU task. Each `new Worker()` costs ~30 ms for V8 isolate creation and script compilation. Fix: use a worker pool (pre-spawned workers that accept tasks via `postMessage`). Libraries like `piscina` implement this pattern with proper task queuing and backpressure.

**2. cluster + in-memory state = inconsistency.**
Symptom: a user logs in on worker 3, then the next request hits worker 1 and they appear logged out. Session state, caches, rate-limit counters — anything stored in process memory is per-worker. Fix: externalize state to Redis or a database. If you must share state between cluster workers, communicate via IPC (slow) or use sticky sessions (fragile).

**3. SharedArrayBuffer data races without Atomics.**
Symptom: counter values are wrong, data structures become corrupted intermittently. Raw reads and writes to SharedArrayBuffer are not atomic for values larger than a single byte on some architectures. Two workers writing overlapping regions produce torn reads. Fix: always use `Atomics.*` operations for shared state. For complex shared data structures, consider a single "owner" worker that processes mutations sequentially via message passing.

**4. Worker thread crashes from unhandled errors silently drop tasks.**
Symptom: tasks submitted to workers occasionally vanish with no error logged in the main process. An unhandled exception in a worker terminates that worker. If the main thread does not listen for the `'error'` and `'exit'` events, the pending task's Promise is never resolved or rejected — it just hangs. Fix: always attach `'error'` and `'exit'` handlers. In a pool, replace crashed workers automatically and reject any pending task.
:::

## 🎯 Checkpoint

::: details Question 1 — SharedArrayBuffer vs postMessage
**Q:** You need to share a 100 MB lookup table (read-only) between the main thread and 4 workers. Would you use `postMessage` or `SharedArrayBuffer`? Explain the memory implications of each.

**A:** **`postMessage` with structured clone** would copy the 100 MB buffer into each worker's heap — 100 MB x 4 = 400 MB of additional memory, plus the original. Cloning also takes time proportional to data size. **`postMessage` with transfer** would move the buffer to one worker (zero-copy), but then the main thread and other workers lose access. **SharedArrayBuffer** is the correct choice: the underlying memory is allocated once (100 MB total) and all threads see the same bytes with zero copying. Since the table is read-only, no Atomics synchronization is needed — concurrent reads from shared memory are safe. You would create a `SharedArrayBuffer`, populate it in the main thread, then pass it to each worker via `workerData` or `postMessage`.
:::

::: details Question 2 — cluster vs pods
**Q:** Your team currently uses `cluster` with 8 workers on a single 8-core VM. You are migrating to Kubernetes. Should you keep `cluster` inside each pod or run one process per pod with 8 replicas? What are the tradeoffs?

**A:** **One process per pod (8 replicas) is generally preferred.** Reasons: (1) K8s health checks and restarts operate at the pod level — if one of 8 cluster workers is stuck but the primary is alive, K8s sees the pod as healthy. With one process per pod, a stuck process fails its health check and gets restarted. (2) K8s HPA (Horizontal Pod Autoscaler) scales pods, not processes within a pod — you get finer-grained scaling. (3) Resource limits are simpler: one process, one core, predictable memory usage. (4) Rolling deployments replace pods individually; with cluster, replacing the primary restarts all workers at once. The tradeoff: with `cluster`, inter-worker IPC is faster than cross-pod network calls, and you have slightly lower overhead (one primary process vs one K8s Service). For most HTTP services, the operational simplicity of one-process-per-pod outweighs the IPC advantage.
:::

::: details Question 3 — Atomics.wait limitation
**Q:** Why can `Atomics.wait()` only be called from worker threads and not from the main thread?

**A:** `Atomics.wait()` is a **blocking synchronous call** — it suspends the calling thread until another thread calls `Atomics.notify()` on the same memory location. If the main thread called `Atomics.wait()`, the entire event loop would freeze. No I/O callbacks, no timers, no incoming connections would be processed. This would be equivalent to an infinite synchronous loop. The Node.js (and browser) runtimes explicitly forbid `Atomics.wait()` on the main thread to prevent developers from accidentally deadlocking the event loop. Worker threads have their own independent event loops, so blocking one does not affect the main thread. If the main thread needs to wait for a result from a worker, it should use the asynchronous `postMessage` / `'message'` event pattern instead.
:::

## Key Mental Models

- **worker_threads = same process, different V8 heaps.** They share a process ID and can share raw memory via SharedArrayBuffer, but every JS object is isolated per thread.
- **cluster = same machine, different processes.** No shared memory; communication via IPC. Best for stateless HTTP servers that need multi-core utilization.
- **In K8s, prefer one process per pod.** Let the orchestrator handle scaling, health, and rolling deploys rather than managing it yourself with `cluster`.
- **Worker pools, not worker-per-request.** The ~30 ms startup cost of a new worker makes per-request spawning impractical for low-latency services.
- **SharedArrayBuffer requires Atomics.** Raw shared memory without synchronization primitives leads to data races — even in "high-level" JavaScript.

## Related

- [CPU Profiling & Flame Graphs](./01-cpu-profiling) — profiling identifies whether you need workers at all
- [Blocking the Loop](/nodejs/module-02/03-blocking-the-loop) — understanding why the single-threaded model needs escape hatches
- [Horizontal vs Vertical Scaling](/system-design/scaling/01-horizontal-vertical) — the system-design perspective on multi-process vs multi-machine
