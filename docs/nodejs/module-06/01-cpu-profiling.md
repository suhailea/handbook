---
title: "CPU Profiling & Flame Graphs"
outline: deep
---

# CPU Profiling & Flame Graphs

> **Interview weight:** Medium-High -- profiling questions appear in performance-tuning and system-design rounds. Interviewers want to hear *how* you identify hot paths, not just that you "use a profiler."
> **Node version notes:** `--cpu-prof` available since Node 12. `--prof` has existed since early Node versions. Examples target Node 22+.
> **Prerequisites:** [What Node Actually Is](/nodejs/module-01/01-what-node-is), [Blocking the Loop](/nodejs/module-02/03-blocking-the-loop).

## 🗣️ In Plain English

::: tip In Plain English
Imagine you are a factory manager and you suspect one station on the assembly line is slowing everything down. You cannot just stare at the line and guess -- it moves too fast and there are too many stations. So you install a camera that takes a photo of every station once per second. After an hour, you stack the photos into a flip-book. The stations that appear in the most frames are the ones doing the most work -- or the ones that are stuck.

A CPU profiler is that camera for your code. It periodically asks the JavaScript engine, "What function are you executing right now?" Each answer is a **sample**. Thousands of samples later, you have a statistical picture of where your program spends its time. A function that appears in 40% of samples is consuming roughly 40% of CPU time.

A **flame graph** is the flip-book turned sideways. The x-axis is not time -- it is the total number of samples. Each horizontal bar is a function. If function A calls function B, B sits on top of A. Wider bars mean more samples, which means more CPU time. You scan the graph for wide plateaus near the top -- those are the "hot" functions where the work is actually happening (or getting stuck). Tall narrow towers are deep call stacks that resolve quickly; they are usually fine.

The beauty of sampling is that it is cheap. The profiler does not instrument every function call -- it just peeks periodically. The overhead is typically under 5%, making it safe even in production. You do not need to modify your source code, add decorators, or install agents. Node has the camera built in -- you just need to press record.
:::

## ⚙️ Under the Hood

### The Built-in `--cpu-prof` Flag

The simplest way to collect a CPU profile is a single flag:

```typescript
// run: node --cpu-prof --cpu-prof-interval=1000 cpu-work.ts
// Generates a .cpuprofile file in the current directory on exit

function isPrime(n: number): boolean {
  if (n < 2) return false;
  for (let i = 2; i <= Math.sqrt(n); i++) {
    if (n % i === 0) return false;
  }
  return true;
}

function findPrimes(limit: number): number[] {
  const primes: number[] = [];
  for (let i = 2; i < limit; i++) {
    if (isPrime(i)) primes.push(i);
  }
  return primes;
}

const result = findPrimes(500_000);
console.log(`Found ${result.length} primes`);
```

Key flags:

| Flag | Default | Purpose |
|------|---------|---------|
| `--cpu-prof` | off | Enable CPU profiler, write `.cpuprofile` on exit |
| `--cpu-prof-interval` | 1000 (microseconds) | Sampling interval. Lower = more detail, more overhead |
| `--cpu-prof-dir` | CWD | Directory for output files |
| `--cpu-prof-name` | `CPU.${yyyymmdd}.${hhmmss}.${pid}.${tid}.cpuprofile` | Custom filename |

The output is a JSON file in the Chrome DevTools `.cpuprofile` format. Open it in Chrome DevTools (Performance tab > Load profile) or VS Code.

### Reading a Flame Graph in Chrome DevTools

1. Open `chrome://inspect` or the DevTools Performance tab.
2. Load the `.cpuprofile` file.
3. Switch to the **Chart** view for a flame chart (time on x-axis) or **Heavy (Bottom Up)** for the most expensive leaf functions.

What to look for:

- **Wide bars** -- functions that consume many samples. These are your optimization targets.
- **Self time vs. total time** -- *self time* is CPU spent inside the function body itself (not in functions it calls). A function with high total time but low self time is just a caller; look at its children instead.
- **Gaps** -- periods of no JS execution mean the event loop was idle (waiting for I/O), which is healthy behavior.

### V8 Tick Profiler: `--prof` and `--prof-process`

The `--prof` flag uses V8's internal tick-based profiler, which captures lower-level data including JIT compilation and GC activity:

```typescript
// Step 1: Collect the profile
// run: node --prof heavy-computation.ts
// Produces: isolate-0x*.log (a V8 tick log)

// Step 2: Process the log into human-readable output
// run: node --prof-process isolate-0x*.log > profile.txt

import { createHash } from 'node:crypto';

function hashRepeatedly(input: string, rounds: number): string {
  let result = input;
  for (let i = 0; i < rounds; i++) {
    result = createHash('sha256').update(result).digest('hex');
  }
  return result;
}

const hash = hashRepeatedly('hello world', 100_000);
console.log(`Final hash: ${hash.slice(0, 16)}...`);
```

The processed output shows a breakdown by category:

```
 [JavaScript]:
   ticks  total  nonlib   name
    234   45.2%   52.1%  hashRepeatedly
     89   17.2%   19.8%  SHA256

 [C++]:
   ticks  total  nonlib   name
     56   10.8%   12.5%  node::crypto::Hash::HashUpdate

 [GC]:
   ticks  total  nonlib   name
     23    4.4%
```

### Identifying Optimization Killers

V8's TurboFan optimizer can "deoptimize" functions that violate its assumptions. Common killers:

```typescript
// run: node --trace-deopt deopt-examples.ts

// 1. Megamorphic property access -- too many shapes
function processItem(item: any): string {
  return item.name; // V8 sees different hidden classes → deopt
}

// Called with objects of different shapes:
processItem({ name: 'a' });
processItem({ name: 'b', age: 1 });       // different shape
processItem({ name: 'c', x: 1, y: 2 });   // yet another shape

// 2. try/catch in hot loops (less of an issue in modern V8, but still worth noting)
function riskyLoop(arr: number[]): number {
  let sum = 0;
  for (const n of arr) {
    try {
      sum += n;
    } catch {
      // TurboFan historically could not optimize try/catch bodies
    }
  }
  return sum;
}

// 3. Arguments object leaking
function leakyArgs(): unknown[] {
  return Array.from(arguments); // prevents optimization
}
```

Use `--trace-deopt` to see exactly where and why deoptimizations happen:

```
[deoptimizing: ... reason: wrong map]
```

### Using the Inspector Protocol Programmatically

For more control, connect to the inspector and start/stop profiling on demand:

```typescript
// run: node --inspect=0 cpu-inspector-profile.ts
import { Session } from 'node:inspector/promises';

const session = new Session();
session.connect();

await session.post('Profiler.enable');
await session.post('Profiler.start');

// --- do the work you want to profile ---
const data: number[] = [];
for (let i = 0; i < 1_000_000; i++) {
  data.push(Math.sqrt(i) * Math.sin(i));
}
// --- end of work ---

const { profile } = await session.post('Profiler.stop');

import { writeFile } from 'node:fs/promises';
await writeFile('custom.cpuprofile', JSON.stringify(profile));
console.log('Profile written to custom.cpuprofile');

session.disconnect();
```

This approach lets you profile specific code paths in production (e.g., profile the next 10 seconds when latency spikes).

### Third-Party Tools

| Tool | What It Does | When to Use |
|------|-------------|-------------|
| **[0x](https://github.com/davidmarkclements/0x)** | Generates interactive flame graphs from `--prof` data. `npx 0x app.js` | Quick local profiling with beautiful output |
| **[clinic.js](https://clinicjs.org/)** | Suite: `clinic doctor` (event loop), `clinic flame` (flame graphs), `clinic bubbleprof` (async) | Comprehensive diagnostics, especially async bottlenecks |
| **[N|Solid](https://nodesource.com/products/nsolid)** | Commercial Node runtime with always-on CPU profiling | Production monitoring at scale |
| **Chrome DevTools** | Built-in, attach via `--inspect` | Interactive debugging and profiling |

Using 0x:

```bash
# Install and profile in one command
npx 0x -- node my-server.ts
# Send traffic to the server, then Ctrl+C
# Opens an interactive flame graph in the browser
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

### 1. Profiling Overhead in Production

**Symptom:** You enable `--cpu-prof` on a production server and p99 latency doubles.

**Root cause:** The default sampling interval (1ms / 1000 microseconds) is aggressive. Each sample interrupts the V8 isolate to walk the call stack. Under high throughput, this adds up.

**Fix:** Use a wider interval for production (`--cpu-prof-interval=10000` for 10ms intervals). Better yet, use the inspector protocol to profile only during specific windows (e.g., 30 seconds when you detect latency degradation). Never leave `--prof` on in production -- it writes a large log file on every tick.

### 2. Flame Graph Looks Flat -- Missing Frames

**Symptom:** Your flame graph shows most time in `(anonymous)` or `(program)` with very few meaningful function names.

**Root cause:** V8 inlines small functions aggressively. Once inlined, the function no longer appears as a separate frame in profiles. Also, native C++ frames (crypto, zlib) may appear as `(C++)` without detail.

**Fix:** Use `--no-turbo-inlining` during profiling to prevent inlining (do NOT use in production). For C++ frames, use `--prof` instead of `--cpu-prof`, as the tick profiler captures native frames with symbol names.

### 3. Profiling the Wrong Thing

**Symptom:** The profile shows your server is 80% idle (in the `poll` phase). You conclude there is no CPU problem, but requests are still slow.

**Root cause:** The bottleneck is not CPU -- it is I/O latency (slow database, upstream API, DNS resolution). CPU profiling only measures where the CPU spends time. If your code is waiting on network I/O, the CPU is idle and the profiler has nothing to sample.

**Fix:** Use `clinic bubbleprof` or async hooks to diagnose async bottlenecks. Combine CPU profiling with distributed tracing (OpenTelemetry) to see where wall-clock time is spent across services.

:::

## 🎯 Checkpoint

::: details Question 1 -- Self time vs. total time
**Q:** A function `processRequest` shows 60% total time but only 2% self time. A function `validateInput` shows 8% total time and 8% self time. Which one should you optimize first, and why?

**A:** **`validateInput`** is the better target. `processRequest` has high total time because it *calls* expensive functions, but it is not doing much work itself (2% self time). Optimizing `processRequest` means optimizing its children. `validateInput` has 100% of its total time as self time -- all the work is inside the function body. It is a direct optimization opportunity. After optimizing `validateInput`, look at `processRequest`'s other children with the highest self time. The general rule: optimize functions with high **self** time first.
:::

::: details Question 2 -- When NOT to use a CPU profiler
**Q:** Your Node.js API server has p99 latency of 2 seconds, but `--cpu-prof` shows the event loop is idle 90% of the time. What does this tell you, and what should you use instead?

**A:** The CPU profiler is telling you the CPU is *not* the bottleneck. The server is spending most of its time waiting -- likely on network I/O (database queries, upstream API calls, DNS lookups). A CPU profiler only captures samples when the CPU is executing JavaScript; it cannot see time spent waiting for I/O. You should use **distributed tracing** (OpenTelemetry spans) to measure wall-clock time across service boundaries, or **`clinic bubbleprof`** to visualize async delays within the Node process. Also check for thread pool exhaustion if many `fs` or DNS operations are queuing up.
:::

::: details Question 3 -- Production profiling safety
**Q:** Your team wants to add always-on CPU profiling to production servers. What are the trade-offs, and how would you design this safely?

**A:** The trade-offs are **overhead** (each sample interrupts V8), **disk/memory** (profiles can be large), and **security** (profiles contain function names and may reveal business logic). To do this safely: (1) Use a wide sampling interval (10ms+) to keep overhead under 1-2%. (2) Use the inspector protocol to capture short windows (30-60 seconds) triggered by a signal or an API endpoint -- never continuously. (3) Stream profiles to object storage, not local disk. (4) Gate the profiling endpoint behind authentication. (5) Consider a commercial solution like N|Solid that is designed for always-on production profiling with minimal overhead.
:::

## Key Mental Models

- **Sampling, not tracing:** CPU profilers take periodic snapshots rather than instrumenting every call. This keeps overhead low but means short-lived functions may be underrepresented. The profile is a statistical approximation, not an exact recording.
- **Self time is the signal:** Total time tells you where time flows through; self time tells you where work actually happens. Optimize self time first.
- **CPU profiling answers "what is the CPU doing?" -- not "why is the request slow?":** If the bottleneck is I/O latency, the CPU profiler will show idle time. Use the right tool for the right question.
- **Flame graphs are sorted alphabetically, not chronologically:** The x-axis width represents sample count, not time order. Two functions next to each other are not necessarily called sequentially.

## Related

- [Heap Snapshots](./02-heap-snapshots) -- profiling memory instead of CPU.
- [GC & Latency](./03-gc-latency) -- GC pauses show up in CPU profiles as unexplained gaps.
- [Blocking the Loop](/nodejs/module-02/03-blocking-the-loop) -- CPU-bound work is what profiling catches.
