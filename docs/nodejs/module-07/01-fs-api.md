---
title: "FS API Families & Watchers"
outline: deep
---

# FS API Families & Watchers

**Interview weight:** 🔥🔥 | **Node 22+** | Prerequisites: [The libuv Threadpool](/nodejs/module-02/04-threadpool), [Process Lifecycle](/nodejs/module-01/02-process-lifecycle)

## 🗣️ In Plain English

::: tip In Plain English
Think of your hard drive as a filing cabinet in a government office. You (Node.js) are a clerk who processes requests from citizens (your code). There are three ways to handle a "get me file X" request:

**The callback way** is the original system. You fill out a request slip, hand it to an assistant, and say "call me when it's ready." You go back to serving other citizens. When the file arrives, the assistant taps your shoulder and you deal with it. This works but your desk is covered in callback slips and you lose track of the order.

**The promise way** is the modern upgrade. You fill out the same request slip, but instead of a callback, you get a numbered ticket. You can `await` the ticket at any point, and the system cleanly tells you when the file is ready. Same assistant, same filing cabinet — just better paperwork.

**The sync way** is you walking to the filing cabinet yourself. You leave your desk, find the file, bring it back. While you are gone, **every citizen in line waits.** This is fine at opening time when no one else is around (application startup, reading config files), but doing it during business hours (while handling requests) grinds everything to a halt.

Now, **watchers** are different. Instead of asking for a file, you pin a note to a cabinet drawer: "tell me whenever anything in here changes." The office has two methods. The cheap one (`fs.watch`) asks the building's security system — it gets notified instantly when someone opens the drawer (using OS-native facilities like inotify on Linux or FSEvents on macOS). The expensive one (`fs.watchFile`) sends an intern to physically check the drawer every few seconds (polling). Use the security system whenever possible — the intern is slow and wastes resources.
:::

## ⚙️ Under the Hood

### The Three API Families

Node's `node:fs` module exposes every operation in three forms. They all do the same system calls — the difference is how they integrate with the event loop:

```typescript
// run: node --experimental-strip-types fs-families.ts
import { readFile, readFileSync } from 'node:fs';
import { readFile as readFilePromise } from 'node:fs/promises';

const path = import.meta.filename; // read this file itself

// 1. CALLBACK (original, since Node 0.x)
readFile(path, 'utf-8', (err, data) => {
  if (err) throw err;
  console.log(`Callback: ${data.length} chars`);
});

// 2. PROMISE (since Node 10, stable since Node 14)
async function readWithPromise(): Promise<void> {
  const data = await readFilePromise(path, 'utf-8');
  console.log(`Promise: ${data.length} chars`);
}
readWithPromise();

// 3. SYNC (blocks the event loop!)
const data = readFileSync(path, 'utf-8');
console.log(`Sync: ${data.length} chars`);
```

**Under the hood, all three use the libuv threadpool for actual I/O.** The sync variants call `uv_fs_*` with a blocking wait on the main thread, while callback and promise variants post work to the threadpool and resume via the event loop's poll phase.

### fs.promises — The Preferred API

`node:fs/promises` *(stable since Node 14)* should be your default choice. Key advantages over callbacks:

- Natural `async`/`await` flow — no callback nesting
- Errors propagate through `try`/`catch` or `.catch()`
- Compatible with `AbortSignal` for cancellation

```typescript
// run: node --experimental-strip-types fs-promises.ts
import { readFile, writeFile, mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

async function demo(): Promise<void> {
  const dir = join(tmpdir(), `fs-demo-${Date.now()}`);

  // mkdir with recursive (like mkdir -p)
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, 'example.txt');

  // Write, read, stat
  await writeFile(filePath, 'Hello from fs.promises\n', 'utf-8');
  const content = await readFile(filePath, 'utf-8');
  const info = await stat(filePath);

  console.log(`Content: ${content.trim()}`);
  console.log(`Size: ${info.size} bytes, modified: ${info.mtime.toISOString()}`);

  // Cleanup
  await rm(dir, { recursive: true, force: true });
  console.log('Cleaned up');
}

demo();
```

### File Descriptors and FileHandle

At the OS level, every open file is tracked by a numeric **file descriptor** (fd). Node exposes this via `fs.open()` (callback API returning an fd number) and `fs.promises.open()` (returning a `FileHandle` object).

`FileHandle` is the object-oriented wrapper — it holds the fd and provides methods like `.read()`, `.write()`, `.stat()`, `.close()`. Critically, **you must close it** or you leak file descriptors:

```typescript
// run: node --experimental-strip-types filehandle.ts
import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

async function readChunks(): Promise<void> {
  const handle = await open(import.meta.filename, 'r');

  try {
    const buf = Buffer.alloc(64);

    // Read the first 64 bytes
    const { bytesRead } = await handle.read(buf, 0, 64, 0);
    console.log(`Read ${bytesRead} bytes: ${buf.toString('utf-8', 0, bytesRead)}`);

    // stat via the handle (no extra path resolution)
    const info = await handle.stat();
    console.log(`Total file size: ${info.size} bytes`);
  } finally {
    // ALWAYS close in finally — leaked fds cause EMFILE errors
    await handle.close();
  }
}

readChunks();
```

*(Node 20+)* `FileHandle` is also an `AsyncIterable<Buffer>`, so you can `for await` over it to read line by line.

### `using` for Automatic Cleanup (Node 22+)

Node 22 supports the TC39 Explicit Resource Management proposal. `FileHandle` implements `Symbol.asyncDispose`, allowing automatic cleanup:

```typescript
// run: node --experimental-strip-types filehandle-using.ts
import { open } from 'node:fs/promises';

async function readSafely(): Promise<void> {
  await using handle = await open(import.meta.filename, 'r');
  // handle.close() is called automatically when scope exits,
  // even if an error is thrown — similar to try/finally but cleaner.

  const content = await handle.readFile('utf-8');
  console.log(`File has ${content.split('\n').length} lines`);
}
// handle is already closed here

readSafely();
```

### fs.watch vs fs.watchFile

| Feature | `fs.watch()` | `fs.watchFile()` |
|---|---|---|
| Mechanism | OS-native events (inotify, FSEvents, kqueue, ReadDirectoryChangesW) | Stat polling at a configurable interval |
| Performance | Low overhead, event-driven | High overhead — one stat call per interval per file |
| Recursive | *(Node 19+)* `{ recursive: true }` on macOS and Windows; Linux since Node 22 | Not applicable (watches single files) |
| Reliability | May miss events under high churn; behavior varies by OS | Always catches changes (at the cost of latency) |
| Network filesystems | Often does not work (NFS, CIFS) | Works everywhere (it's just `stat()`) |
| Use case | Local development file watching | Network mounts, or when `fs.watch` is unreliable |

```typescript
// run: node --experimental-strip-types fs-watch.ts
import { watch } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = join(tmpdir(), `watch-demo-${Date.now()}`);

import { mkdirSync } from 'node:fs';
mkdirSync(dir, { recursive: true }); // sync is fine during setup

// Watch the directory for changes
const watcher = watch(dir, { recursive: false }, (eventType, filename) => {
  console.log(`Event: ${eventType}, file: ${filename}`);
});

// Trigger some file changes
setTimeout(async () => {
  await writeFile(join(dir, 'a.txt'), 'hello');
  await writeFile(join(dir, 'b.txt'), 'world');
  await writeFile(join(dir, 'a.txt'), 'updated');
}, 100);

// Clean up after 2 seconds
setTimeout(() => {
  watcher.close();
  console.log('Watcher closed');
  import('node:fs/promises').then((fs) => fs.rm(dir, { recursive: true, force: true }));
}, 2000);
```

### Platform Differences in fs.watch

This is one of the most platform-inconsistent APIs in Node:

- **macOS (FSEvents):** Reliable, supports recursive watching natively. Filenames in events are correct.
- **Linux (inotify):** Recursive watching uses multiple inotify watches — one per subdirectory. Systems have a limit (`/proc/sys/fs/inotify/max_user_watches`, default ~8192). Large directory trees can exceed this. *(Node 22)* added native recursive support.
- **Windows (ReadDirectoryChangesW):** Supports recursive natively. May buffer events and deliver them in batches.

### Atomic Writes

A naive `writeFile` is not atomic — if the process crashes mid-write, you get a half-written file. The standard pattern for atomic writes:

```typescript
// run: node --experimental-strip-types atomic-write.ts
import { writeFile, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

async function atomicWriteFile(
  targetPath: string,
  content: string | Buffer,
): Promise<void> {
  // 1. Write to a temp file in the same directory (same filesystem = same mount)
  const tempPath = join(
    dirname(targetPath),
    `.tmp-${randomBytes(6).toString('hex')}`,
  );

  try {
    await writeFile(tempPath, content, 'utf-8');
    // 2. rename() is atomic on POSIX (same filesystem)
    await rename(tempPath, targetPath);
  } catch (err) {
    // Clean up temp file on failure
    await unlink(tempPath).catch(() => {}); // ignore cleanup errors
    throw err;
  }
}

// Demo
const target = join(tmpdir(), 'atomic-demo.txt');
await atomicWriteFile(target, 'This write is atomic\n');

import { readFile } from 'node:fs/promises';
console.log(await readFile(target, 'utf-8'));
```

The key insight: `rename()` on POSIX is an atomic operation at the filesystem level (assuming source and target are on the same mount). The file either has the old content or the new content — never a partial state.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. EMFILE — too many open files.**
Symptom: `Error: EMFILE, too many open files` under load. Every `open()` consumes a file descriptor. The OS has a per-process limit (often 1024 on Linux, `ulimit -n`). If your code opens files without closing them (leaked `FileHandle`s, un-closed `createReadStream`), you hit this limit. Diagnosis: `ls /proc/<pid>/fd | wc -l` (Linux) shows current fd count. Fix: always close handles in `finally` blocks or use `await using`. For high-throughput scenarios, increase `ulimit` and use a file-access queue to limit concurrency.

**2. Sync fs calls in request handlers freeze the event loop.**
Symptom: all request latencies spike to 200 ms+ simultaneously (not just p99 — *all* requests). A single `readFileSync` on a 5 MB file blocks the event loop for the duration of the disk I/O. Fix: use `fs.promises` methods. Only use sync APIs during startup (reading config, loading certs) before the server starts listening.

**3. fs.watch emits duplicate events.**
Symptom: your hot-reload logic runs twice for a single file save. Many editors (VS Code, Vim) perform write-rename-write sequences, and the OS may emit multiple events per logical change. Fix: debounce watch events (wait 50–100 ms and coalesce), or use a mature watcher library (chokidar) that handles deduplication.

**4. Recursive watching exhausts inotify watches on Linux.**
Symptom: `Error: ENOSPC: System limit for number of file watchers reached`. Watching `node_modules` or a large source tree consumes thousands of inotify watches. Fix: exclude `node_modules` and build output directories. Increase the limit if needed: `echo fs.inotify.max_user_watches=524288 | sudo tee /etc/sysctl.d/40-watches.conf`.
:::

## 🎯 Checkpoint

::: details Question 1 — Threadpool interaction
**Q:** `readFile()` (the async version) is non-blocking from the main thread's perspective. But it is not truly asynchronous at the OS level on all platforms. Explain what actually happens in the libuv threadpool.

**A:** On most platforms, `readFile()` delegates to libuv, which posts the `read()` system call to a **threadpool worker thread**. That worker thread performs a blocking `read()` syscall. When it completes, libuv queues the result for delivery on the main thread's event loop (via the poll phase). The main thread never blocks, but a threadpool thread does. This matters because the default threadpool has only 4 threads (`UV_THREADPOOL_SIZE=4`). If all 4 are busy with slow I/O (large reads, DNS lookups, crypto), additional fs operations queue up and appear slow — even though the event loop itself is free. Linux has `io_uring` for true async disk I/O, but libuv does not use it by default as of Node 22. The workaround for threadpool contention is to increase `UV_THREADPOOL_SIZE` (up to 1024) or limit concurrent fs operations in application code.
:::

::: details Question 2 — Atomic writes
**Q:** Why must the temporary file for an atomic write be on the same filesystem as the target file? What happens if it is not?

**A:** POSIX `rename()` is atomic only when source and destination are on the **same mount point** (same filesystem). The kernel implements same-filesystem rename by updating directory entries — a metadata-only operation that is atomic by design. If source and destination are on different filesystems, `rename()` fails with `EXDEV` (cross-device link). The fallback — copy + delete — is not atomic: a crash mid-copy leaves a partial file. This is why the temporary file is created in `dirname(targetPath)`, which guarantees the same filesystem. In containers, be careful with volume mounts — `/tmp` might be a different filesystem from `/data`.
:::

## Key Mental Models

- **Three APIs, one syscall.** Callback, promise, and sync versions all perform the same libuv/kernel operation — the difference is entirely in how they schedule completion on the event loop.
- **fs.promises is the default choice.** Use callbacks only in legacy code, sync only at startup.
- **File descriptors are a finite resource.** Always close them. `await using` makes this automatic in Node 22+.
- **fs.watch is fast but unreliable; fs.watchFile is reliable but slow.** Choose based on whether you are on a local filesystem and can tolerate occasional duplicates.
- **Atomic write = write-to-temp + rename.** `rename()` is atomic on POSIX only within the same filesystem.

## Related

- [Child Processes](./02-child-processes) — spawning processes that interact with the filesystem
- [The libuv Threadpool](/nodejs/module-02/04-threadpool) — where async fs operations actually execute
