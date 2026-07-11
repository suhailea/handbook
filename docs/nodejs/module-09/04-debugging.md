---
title: "Debugging, Heapdumps & Diagnostic Reports"
outline: deep
---

# Debugging, Heapdumps & Diagnostic Reports

**Interview weight:** :fire::fire: | **Node.js 22+** | **Prerequisites:** [OpenTelemetry](./03-opentelemetry), [Heap Snapshots](/nodejs/module-06/02-heap-snapshots), [CPU Profiling](/nodejs/module-06/01-cpu-profiling)

## :speaking_head: In Plain English

::: tip In Plain English
Imagine your car breaks down on the highway. You have three tools available:

The **inspector** (`--inspect`) is like connecting your car to the dealer's diagnostic computer *while the engine is running*. You can watch every sensor in real time, pause the engine mid-stroke to look at the state of each cylinder, and step through the ignition sequence one spark at a time. This is Chrome DevTools attached to your Node process -- you can set breakpoints, inspect variables, and step through code live.

A **heapdump** is like taking a photograph of everything inside the car at one exact moment -- every part, every fluid, every connection. You study the photo later to find where the leak is. In Node, a heapdump captures every object in memory, every reference between objects, and how much space each one takes. If your process is slowly eating more and more RAM, a heapdump tells you what is accumulating and who is holding onto it.

A **diagnostic report** is like the black box on an airplane. When something catastrophic happens -- the engine catches fire, the car suddenly stops -- the black box records the state of everything: speed, altitude, fuel pressure, last 30 seconds of pilot inputs. In Node, a diagnostic report captures the event loop state, active handles and requests, loaded native modules, environment variables, system information, and the JavaScript stack -- all in one JSON file. You generate it automatically on a crash or a signal, and read it after the fact to understand what happened.

The key insight is that these tools serve different moments: the inspector is for *right now* (live debugging), heapdumps are for *slow problems* (memory leaks over time), and diagnostic reports are for *after the crash* (post-mortem analysis).
:::

## :gear: Under the Hood

### The Inspector Protocol (`--inspect`)

Node's debugger is built on the **Chrome DevTools Protocol (CDP)**, the same protocol Chrome uses internally. When you pass `--inspect`, Node:

1. Starts a WebSocket server on `127.0.0.1:9229` (by default)
2. V8 exposes its debugging API over this WebSocket
3. Any CDP-compatible client (Chrome DevTools, VS Code, WebStorm) can connect

```typescript
// run: node --experimental-strip-types --inspect server.ts

import { createServer } from 'node:http';

const server = createServer((req, res) => {
  // Set a breakpoint on the next line in Chrome DevTools
  const body = JSON.stringify({ path: req.url, time: Date.now() });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(body);
});

server.listen(3000, () => {
  console.log('Server listening on :3000');
  console.log('Open chrome://inspect in Chrome to attach debugger');
});
```

#### `--inspect` vs `--inspect-brk`

| Flag | Behavior |
|---|---|
| `--inspect` | Starts the inspector, does not pause. Process runs normally until a client connects and sets breakpoints. |
| `--inspect-brk` | Starts the inspector and pauses on the first line. Waits for a client to connect before executing any code. |

`--inspect-brk` is essential when you need to debug startup code (module loading, configuration parsing, DI container initialization):

```bash
# Pause before any user code runs
node --experimental-strip-types --inspect-brk=0.0.0.0:9229 app.ts
```

#### Binding Address Security

```bash
# Default: only localhost (safe)
node --inspect app.ts
# Debugger listening on ws://127.0.0.1:9229/...

# Bind to all interfaces (DANGEROUS in production -- anyone on the network can debug your process)
node --inspect=0.0.0.0:9229 app.ts

# In Docker/K8s: bind to 0.0.0.0 but restrict network access via K8s NetworkPolicy
# Never expose port 9229 to the public internet
```

### Attaching to a Running Process

You do not need to restart a process with `--inspect` to debug it. You can activate the inspector on a running process:

```bash
# Find your Node process PID
# On Linux/macOS:
pgrep -f "node.*app.ts"

# Send SIGUSR1 to activate the inspector
kill -USR1 <PID>

# The process prints: Debugger listening on ws://127.0.0.1:9229/...
# Now connect Chrome DevTools as usual
```

**How it works:** Node registers a `SIGUSR1` signal handler at startup. When the signal is received, Node starts the inspector WebSocket server (if not already running). This is entirely non-disruptive -- the process continues running, the event loop is not paused, and existing connections are unaffected.

```typescript
// You can also activate the inspector programmatically:
// run: node --experimental-strip-types inspector-api.ts

import inspector from 'node:inspector';

// Open the inspector programmatically
function enableDebugger(): void {
  inspector.open(9229, '127.0.0.1', true); // port, host, wait for connection
  console.log('Inspector is open. Connect Chrome DevTools.');
}

// Useful pattern: expose an admin endpoint that enables debugging
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  if (req.url === '/_admin/debug' && req.method === 'POST') {
    enableDebugger();
    res.writeHead(200).end('Debugger enabled');
    return;
  }
  res.writeHead(200).end('OK');
});

server.listen(3000);
```

### Diagnostic Reports

*(Stable since Node 18)*

A diagnostic report is a JSON document that captures a comprehensive snapshot of the process state. It includes:

- JavaScript and native stack traces for all threads
- Heap statistics (total heap, used heap, heap spaces)
- libuv handle and request information (open sockets, timers, fs watchers)
- Loaded native modules and shared libraries
- System information (OS, CPU, memory)
- Environment variables
- Resource usage (CPU time, max RSS)
- Node.js command-line flags

#### Generating Reports

```bash
# 1. On demand via CLI flag
node --report-filename=report.json --experimental-strip-types app.ts
# Then from another terminal: kill -USR2 <PID>

# 2. Automatically on uncaught exception
node --report-on-fatalerror --experimental-strip-types app.ts

# 3. Automatically on signal
node --report-on-signal --report-signal=SIGUSR2 --experimental-strip-types app.ts

# 4. Automatically on specific conditions
node --report-on-fatalerror --report-on-signal --report-directory=/tmp/reports --experimental-strip-types app.ts
```

```typescript
// Generate a report programmatically:
// run: node --experimental-strip-types report-demo.ts

import { report } from 'node:process';
import { writeFileSync } from 'node:fs';

// Configure report settings
report.reportOnFatalError = true;
report.reportOnSignal = true;
report.reportOnUncaughtException = true;
report.signal = 'SIGUSR2';
report.filename = 'diagnostic-report.json';
report.directory = '/tmp/reports';

// Generate a report now (does not stop the process)
const reportData = report.getReport() as object;
writeFileSync('/tmp/reports/manual-report.json', JSON.stringify(reportData, null, 2));
console.log('Report generated');

// Or write directly:
report.writeReport('/tmp/reports/direct-report.json');
```

#### Reading Diagnostic Reports

The report JSON has several key sections:

```typescript
// run: node --experimental-strip-types read-report.ts

import { readFileSync } from 'node:fs';

interface DiagnosticReport {
  header: {
    reportVersion: number;
    event: string;           // 'FatalError', 'Signal', 'Exception', etc.
    trigger: string;         // What caused the report
    filename: string;
    dumpEventTime: string;
    processId: number;
    commandLine: string[];
    nodejsVersion: string;
    componentVersions: Record<string, string>; // V8, libuv, OpenSSL versions
  };
  javascriptStack: {
    message: string;
    stack: string[];
  };
  nativeStack: Array<{
    pc: string;
    symbol: string;
  }>;
  javascriptHeap: {
    totalMemory: number;
    totalCommittedMemory: number;
    usedMemory: number;
    availableMemory: number;
    memoryLimit: number;
    heapSpaces: Record<string, { memorySize: number; committedMemory: number; capacity: number; used: number; available: number }>;
  };
  libuv: Array<{
    type: string;            // 'tcp', 'timer', 'pipe', etc.
    is_active: boolean;
    is_referenced: boolean;
    address?: string;
    localAddress?: string;
    remoteAddress?: string;
  }>;
  resourceUsage: {
    userCpuSeconds: number;
    kernelCpuSeconds: number;
    maxRss: number;          // Peak memory in bytes
    pageFaults: { IORequired: number; IONotRequired: number };
  };
  environmentVariables: Record<string, string>;
}

// Example: parse and extract key diagnostic info
function analyzeReport(path: string): void {
  const report: DiagnosticReport = JSON.parse(readFileSync(path, 'utf-8'));

  console.log(`Event: ${report.header.event}`);
  console.log(`Trigger: ${report.header.trigger}`);
  console.log(`Node.js: ${report.header.nodejsVersion}`);

  // Memory analysis
  const heap = report.javascriptHeap;
  const usedMB = Math.round(heap.usedMemory / 1024 / 1024);
  const limitMB = Math.round(heap.memoryLimit / 1024 / 1024);
  console.log(`Heap: ${usedMB} MB / ${limitMB} MB (${Math.round(usedMB / limitMB * 100)}%)`);

  // Active handles (potential leak indicators)
  const activeHandles = report.libuv.filter(h => h.is_active);
  console.log(`Active libuv handles: ${activeHandles.length}`);

  // Group handles by type
  const handlesByType = activeHandles.reduce((acc, h) => {
    acc[h.type] = (acc[h.type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('Handle types:', handlesByType);

  // If there are 10,000 active timers, you probably have a timer leak
  // If there are 500 active TCP handles, you probably have a connection leak
}

// analyzeReport('/tmp/reports/diagnostic-report.json');
```

#### What to Look for in Reports

| Symptom | Report section | What to check |
|---|---|---|
| OOM crash | `javascriptHeap` | `usedMemory` near `memoryLimit`; which heap space is full |
| Hang / no response | `libuv` | Look for handles with `is_active: true` -- a missing callback or unresolved promise may block the loop |
| Crash on startup | `javascriptStack` | The stack trace shows which module or config failed |
| High CPU | `resourceUsage` | `userCpuSeconds` vs wall clock time; if CPU time >> wall time, you have a CPU-bound operation |
| Connection leak | `libuv` | Count `tcp` handles -- if growing over time, connections are not being closed |

### Heapdumps

#### On-Demand Heapdumps

```typescript
// run: node --experimental-strip-types heapdump-demo.ts

import { writeHeapSnapshot } from 'node:v8';
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  if (req.url === '/_admin/heapdump' && req.method === 'POST') {
    // WARNING: this pauses the process while the heap is serialized
    // Can take seconds for large heaps (>1 GB)
    const filename = writeHeapSnapshot();
    console.log(`Heapdump written to ${filename}`);
    res.writeHead(200).end(`Heapdump: ${filename}`);
    return;
  }

  res.writeHead(200).end('OK');
});

server.listen(3000);
```

#### Heapdump on OOM

When Node runs out of memory, it normally crashes with `FATAL ERROR: CALL_AND_RETRY_LAST Allocation failed - JavaScript heap out of memory`. You can capture a heapdump at the moment of death:

```bash
# Generate heapdump when OOM occurs
node --max-old-space-size=512 --heapsnapshot-near-heap-limit=3 --experimental-strip-types app.ts

# --heapsnapshot-near-heap-limit=N writes up to N heapdumps as the heap approaches the limit
# The process still crashes, but you have the heap state to analyze
```

The `--heapsnapshot-near-heap-limit` flag *(Node 16+)* writes snapshots when the heap reaches approximately 90% of the limit. Setting it to `3` means up to three snapshots -- useful because the first snapshot might be before the leak is apparent, while the third is right before the crash.

#### Analyzing Heapdumps

```bash
# Open in Chrome DevTools:
# 1. Open Chrome, go to chrome://inspect
# 2. Click "Open dedicated DevTools for Node"
# 3. Go to the Memory tab
# 4. Load the .heapsnapshot file

# Key views:
# - Summary: objects grouped by constructor, sorted by retained size
# - Comparison: diff two snapshots to see what grew (the leak)
# - Containment: the object reference graph (who holds what)
# - Statistics: pie chart of heap composition
```

**The comparison technique for finding leaks:**

1. Take a heapdump after startup (baseline)
2. Run the workload for a few minutes
3. Take a second heapdump
4. Load both in Chrome DevTools Memory tab
5. Select "Comparison" view on the second snapshot
6. Sort by "# Delta" (objects created between snapshots that were not garbage collected)
7. The top entries are your leak candidates -- click to see the retainer chain

### Production Debugging Strategies

#### Strategy 1: Signal-Based Diagnostics

```bash
# In your Dockerfile / K8s deployment:
# Start with report-on-signal enabled
node --report-on-signal --report-signal=SIGUSR2 --report-directory=/tmp/reports app.ts

# When you need diagnostics, exec into the pod:
kubectl exec -it pod-name -- kill -USR2 1
# Report is written to /tmp/reports/

# Copy it out:
kubectl cp pod-name:/tmp/reports/report.json ./report.json
```

#### Strategy 2: Conditional Debugging in K8s

```typescript
// run: node --experimental-strip-types conditional-debug.ts

import inspector from 'node:inspector';
import { createServer } from 'node:http';

// Only enable the inspector if a specific env var is set
// Deploy a debug version of the pod with ENABLE_DEBUGGER=true
// and a port-forward to 9229
if (process.env['ENABLE_DEBUGGER'] === 'true') {
  inspector.open(9229, '0.0.0.0');
  console.log('Debugger enabled -- connect via port-forward');
}

const server = createServer((req, res) => {
  res.writeHead(200).end('OK');
});

server.listen(3000);
```

```bash
# Port-forward to the debug pod
kubectl port-forward pod/debug-pod 9229:9229

# Open chrome://inspect -- the remote target appears automatically
```

#### Strategy 3: Core Dumps for Native Crashes

When Node crashes at the C++ level (a segfault, a V8 bug, a native addon crash), JavaScript-level tools are useless. You need a core dump:

```bash
# Enable core dumps
ulimit -c unlimited

# On Linux, configure core dump location
echo '/tmp/cores/core.%p' | sudo tee /proc/sys/kernel/core_pattern

# Run Node
node app.ts
# If it crashes, a core file is written to /tmp/cores/

# Analyze with llnode (LLDB plugin for Node):
llnode node -c /tmp/cores/core.12345
# > v8 bt     -- JavaScript backtrace
# > v8 inspect <address>  -- inspect a V8 object
```

#### Strategy 4: Live Process Inspection Without Debugger

```typescript
// run: node --experimental-strip-types live-stats.ts

import { createServer } from 'node:http';
import { memoryUsage, cpuUsage, resourceUsage } from 'node:process';
import { monitorEventLoopDelay } from 'node:perf_hooks';

// Event loop delay histogram
const eld = monitorEventLoopDelay({ resolution: 20 });
eld.enable();

const server = createServer((req, res) => {
  if (req.url === '/_admin/stats') {
    const mem = memoryUsage();
    const cpu = cpuUsage();

    const stats = {
      memory: {
        rss: `${Math.round(mem.rss / 1024 / 1024)} MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)} MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)} MB`,
        external: `${Math.round(mem.external / 1024 / 1024)} MB`,
      },
      cpu: {
        user: `${Math.round(cpu.user / 1000)} ms`,
        system: `${Math.round(cpu.system / 1000)} ms`,
      },
      eventLoopDelay: {
        min: `${(eld.min / 1e6).toFixed(2)} ms`,
        max: `${(eld.max / 1e6).toFixed(2)} ms`,
        mean: `${(eld.mean / 1e6).toFixed(2)} ms`,
        p99: `${(eld.percentile(99) / 1e6).toFixed(2)} ms`,
      },
      uptime: `${Math.round(process.uptime())} seconds`,
      activeHandles: (process as any)._getActiveHandles().length,
      activeRequests: (process as any)._getActiveRequests().length,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats, null, 2));
    return;
  }

  res.writeHead(200).end('OK');
});

server.listen(3000);
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites
**1. Heapdump pauses in production.** A developer triggers `writeHeapSnapshot()` on a production pod with a 2 GB heap. The V8 engine pauses the process for 8 seconds while it serializes the entire heap to disk. During this pause, the health check fails, K8s marks the pod as unhealthy, and the load balancer removes it from rotation. Meanwhile, all in-flight requests timeout. If the heapdump is triggered on all pods simultaneously (e.g., via a broadcast admin endpoint), the entire service goes down. Fix: only take heapdumps on one pod at a time, increase health check timeouts during debugging sessions, and use `--heapsnapshot-near-heap-limit` for OOM cases (which pauses during a GC cycle that would have been long anyway).

**2. Inspector exposed on 0.0.0.0 in production.** A developer adds `--inspect=0.0.0.0:9229` to the production Dockerfile for debugging and forgets to remove it. The inspector allows full code execution via the evaluate protocol -- an attacker who can reach port 9229 can run arbitrary JavaScript in the Node process, read environment variables (including database credentials and API keys), access the filesystem, and spawn child processes. This is a full remote code execution vulnerability. Fix: never bind to `0.0.0.0` in production; use `kubectl port-forward` instead; if you must expose it, use K8s NetworkPolicy to restrict access to specific admin pods.

**3. Diagnostic report reveals secrets.** A diagnostic report includes `environmentVariables`, which often contains `DATABASE_URL`, `API_SECRET`, `AWS_SECRET_ACCESS_KEY`, and other credentials. The report is written to `/tmp/reports/` and the developer copies it to their laptop, uploads it to a Jira ticket, or commits it to a repository. Fix: configure `report.excludeEnv` *(Node 22+)* to exclude sensitive variables, or process reports through a redaction filter before sharing. Never commit diagnostic reports to version control.

**4. Core dump fills disk in a container.** A native addon crash generates a core dump. The core dump is as large as the process's virtual memory (potentially many GB). In a container with an `emptyDir` volume for `/tmp`, this can fill the node's disk, affecting all pods on that node. Fix: set `ulimit -c` to a bounded value, or set `kernel.core_pattern` to pipe through a size-limiting wrapper.
:::

## :dart: Checkpoint

::: details Question 1 -- SIGUSR1 mechanics
**Q:** What happens internally when you send `SIGUSR1` to a running Node process, and why is this safe to do in production?

**A:** Node registers a SIGUSR1 signal handler during process initialization (in C++, via libuv's `uv_signal_start`). When the signal arrives, the handler starts the V8 inspector WebSocket server on the default port (9229) if it is not already running. This is safe because: (1) the signal handler runs between event loop ticks (libuv delivers signals as events), so it does not interrupt mid-execution JavaScript; (2) starting the WebSocket server is a lightweight operation (binding a socket, registering it with the event loop); (3) the inspector does not execute any debug commands until a client connects and sends protocol messages; (4) the process continues running normally -- it is not paused unless the client sends a "pause" command. The only risk is if port 9229 is reachable by untrusted clients, which is an access control issue, not a stability issue.
:::

::: details Question 2 -- Heapdump timing
**Q:** Why does `--heapsnapshot-near-heap-limit=3` produce three snapshots instead of one, and how do you use the multiple snapshots to diagnose a memory leak?

**A:** Multiple snapshots are valuable because they capture the heap at different stages of the leak's progression. The first snapshot is taken when the heap first reaches ~90% of the limit -- at this point, the leak may be only partially developed. The second and third snapshots are taken on subsequent GC cycles as the heap continues to grow toward the limit. To diagnose the leak, load two consecutive snapshots in Chrome DevTools' Memory tab and use the **Comparison** view, which shows the delta between snapshots: objects allocated between snapshot 1 and snapshot 2 that were not garbage collected. Sort by "# Delta" (count of new objects) or "Size Delta" (bytes of new objects). The constructor names and retainer chains in the comparison identify exactly which objects are accumulating and what is preventing their garbage collection. Comparing snapshot 1 vs 2 and snapshot 2 vs 3 helps confirm the leak pattern is consistent, ruling out one-time allocations.
:::

::: details Question 3 -- Diagnostic report use case
**Q:** Your Node.js service in K8s restarts due to an OOM kill, but the process exit was from the kernel (SIGKILL), not from V8's heap limit. What diagnostic information can you still obtain, and what must you set up in advance?

**A:** When the kernel sends SIGKILL (OOM killer), the process is terminated immediately with no opportunity to run signal handlers, write reports, or take heapdumps. To diagnose this, you must set up **in advance**: (1) `--heapsnapshot-near-heap-limit=N` to capture heapdumps as the heap approaches V8's limit (but if the OOM is from RSS exceeding the container's memory limit before V8's heap limit, these may not trigger); (2) a periodic health/stats endpoint that records memory metrics (RSS, heap used, external, array buffers) to a time-series database so you can see the growth pattern before the kill; (3) K8s events (`kubectl describe pod`) which record the OOM kill reason and the container's memory usage at the time; (4) `dmesg` on the node shows the kernel OOM killer's decision, including which process was killed and how much memory it was using. The fundamental challenge is that SIGKILL is non-catchable -- all diagnostic tooling must be proactive, not reactive.
:::

## Key Mental Models

- **`--inspect` is a WebSocket server, not a mode change.** The process runs normally; the debugger is just an additional listener. Connecting and disconnecting clients has no effect on the process.
- **SIGUSR1 is the production debugger key.** You do not need to restart with `--inspect` -- signal the running process and connect.
- **Heapdumps freeze the world.** The pause is proportional to heap size. Plan for it: isolate the pod, extend health check timeouts, never heapdump all pods at once.
- **Diagnostic reports are your crash black box.** Enable `--report-on-fatalerror` on every production process. The cost is zero until a crash occurs.
- **Comparison of snapshots, not a single snapshot, reveals leaks.** One snapshot shows what is in memory. Two snapshots show what is *growing*.

## Related

- [OpenTelemetry](./03-opentelemetry) -- runtime observability complementing debugging tools
- [Heap Snapshots](/nodejs/module-06/02-heap-snapshots) -- deeper dive into V8 heap analysis
- [CPU Profiling](/nodejs/module-06/01-cpu-profiling) -- flame graphs and CPU analysis
