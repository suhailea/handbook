---
title: "ReDoS & Path Traversal"
outline: deep
---

# ReDoS & Path Traversal

> **Interview weight:** Medium-High -- security rounds often include "is this regex safe?" or "what's wrong with this file server?" questions.
> **Node version notes:** Examples target Node 22+. The `node:path` module and `node:fs` behaviors discussed are stable across all LTS versions.
> **Prerequisites:** Regular expression basics, file system API familiarity, understanding of the event loop (Module 2).

## 🗣️ In Plain English

::: tip In Plain English
Think of a regular expression engine as a person trying to find their way through a hedge maze. For simple mazes, there is one obvious path and the person walks through quickly. But some mazes have branching paths that all look the same, and when the person hits a dead end, they have to backtrack to the last fork and try another route. If the maze has many layers of identical forks, the number of routes to try doubles with each layer. Give them a maze with 30 layers of forks and they will be trying routes until the sun burns out.

That is catastrophic backtracking -- also known as Regular Expression Denial of Service (ReDoS). An attacker crafts an input string that forces the regex engine into an exponential number of backtracking steps. Because Node runs regex matching on the main thread (V8 executes it synchronously), a single evil input can freeze your entire server for seconds or minutes. Every other request queues up behind the stuck regex.

Path traversal is a different attack but follows a similar philosophy: the attacker feeds crafted input to navigate somewhere they should not be. Instead of exploiting a regex engine, they exploit file path resolution. If your server reads files based on a user-supplied filename, the attacker sends `../../etc/passwd` to escape your intended directory and read arbitrary files on the system. Node's `path.resolve` and `path.join` faithfully process `..` segments -- they do not enforce any security boundary. Your code must do that.

Both attacks share a root cause: trusting user input to behave within expected bounds. The defenses are also conceptually similar: constrain the input before processing it. For regex, use non-backtracking patterns or alternative engines. For paths, resolve the full path first, then verify it starts with your allowed directory.
:::

## ⚙️ Under the Hood

### ReDoS: Catastrophic Backtracking

V8's regex engine uses a backtracking NFA (non-deterministic finite automaton) approach for most patterns. When a pattern has **nested quantifiers** or **overlapping alternations**, the engine explores an exponential number of paths.

#### The Classic Vulnerable Pattern

```typescript
// run: node --experimental-strip-types redos-demo.ts
// WARNING: the "evil" test will freeze for several seconds

const vulnerableRegex = /^(a+)+$/;  // Nested quantifiers: (a+)+

// Safe input: matches instantly
console.time('safe');
vulnerableRegex.test('aaaaaaaaaaaaaaaaaa');
console.timeEnd('safe');  // < 1ms

// Evil input: 'a' repeated + a non-matching char at the end
// The engine backtracks exponentially trying to make (a+)+ match without the trailing 'b'
console.time('evil-20');
vulnerableRegex.test('aaaaaaaaaaaaaaaaaaab');  // 20 a's + b
console.timeEnd('evil-20');  // Could take seconds

// DO NOT RUN with 30+ a's -- it will block for minutes/hours
```

#### Why It Happens

For the input `aaaaab` against `/^(a+)+$/`:

1. The outer `+` tries to match the inner `(a+)` multiple times.
2. The inner `a+` can consume 1 to N `a` characters per iteration.
3. When the final `b` prevents a complete match, the engine backtracks and tries every possible partition of the `a` characters across iterations of the outer `+`.
4. For N `a` characters, there are 2^(N-1) ways to partition -- exponential growth.

#### Identifying Vulnerable Patterns

| Pattern | Why it is dangerous |
|---------|-------------------|
| `(a+)+` | Nested quantifiers with overlapping scope |
| `(a\|aa)+` | Alternation where both branches can match the same input |
| `(a+b?)+` | Optional element allows the quantifier to re-partition |
| `(\w+\s?)+$` | Common in email/URL validators -- overlapping word boundaries |
| `(.*a){x}` | Greedy `.*` with repeated group |

#### Safe Alternatives

**1. Atomic groups and possessive quantifiers (via `re2` or careful rewriting)**

```typescript
// run: npm install re2 && node --experimental-strip-types redos-safe-re2.ts
import RE2 from 're2';

// RE2 uses a linear-time algorithm (Thompson NFA) -- no backtracking
const safeRegex = new RE2('^(a+)+$');
const input = 'a'.repeat(100) + 'b';

console.time('re2');
const result = safeRegex.test(input);
console.timeEnd('re2');  // Always fast, regardless of input length
console.log('Match:', result);  // false
```

**2. Rewrite to remove nesting**

```typescript
// run: node --experimental-strip-types redos-rewrite.ts

// VULNERABLE: /^(a+)+$/
// SAFE rewrite: /^a+$/  -- semantically identical, no nesting
const safeRegex = /^a+$/;

const evil = 'a'.repeat(100) + 'b';
console.time('safe-rewrite');
safeRegex.test(evil);
console.timeEnd('safe-rewrite');  // < 1ms
```

**3. Input length limits**

```typescript
// run: node --experimental-strip-types redos-limit.ts

function safeMatch(input: string, pattern: RegExp, maxLength: number = 1000): boolean {
  if (input.length > maxLength) {
    throw new Error(`Input exceeds maximum length of ${maxLength}`);
  }
  return pattern.test(input);
}

try {
  safeMatch('a'.repeat(2000) + 'b', /^(a+)+$/, 1000);
} catch (e) {
  console.log((e as Error).message);  // Input exceeds maximum length of 1000
}
```

**4. Timeout-based protection**

```typescript
// run: node --experimental-strip-types redos-timeout.ts
import { Worker, isMainThread, workerData } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

if (isMainThread) {
  // Run regex in a worker thread with a timeout
  const worker = new Worker(fileURLToPath(import.meta.url), {
    workerData: { pattern: '^(a+)+$', input: 'a'.repeat(25) + 'b' },
  });

  const timeout = setTimeout(() => {
    worker.terminate();
    console.log('Regex timed out -- likely ReDoS');
  }, 1000);

  worker.on('message', (result: boolean) => {
    clearTimeout(timeout);
    console.log('Result:', result);
  });

  worker.on('exit', (code) => {
    clearTimeout(timeout);
    if (code !== 0) console.log('Worker exited with code:', code);
  });
} else {
  const { pattern, input } = workerData as { pattern: string; input: string };
  const regex = new RegExp(pattern);
  const result = regex.test(input);
  const { parentPort } = await import('node:worker_threads');
  parentPort!.postMessage(result);
}
```

### Path Traversal

#### The Attack

```typescript
// run: node --experimental-strip-types path-traversal-demo.ts
import { join, resolve, normalize } from 'node:path';

// A naive file server: serve files from ./public
const PUBLIC_DIR = resolve('./public');

function unsafeGetFilePath(userInput: string): string {
  return join(PUBLIC_DIR, userInput);  // No validation!
}

// Attacker requests:
const evilPaths = [
  '../../../etc/passwd',
  '..\\..\\..\\etc\\passwd',         // Windows-style
  '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',  // URL-encoded (if decoded before path resolution)
  'public/../../../etc/passwd',
];

for (const evil of evilPaths) {
  const resolved = unsafeGetFilePath(evil);
  const isContained = resolved.startsWith(PUBLIC_DIR);
  console.log(`Input: ${evil}`);
  console.log(`  Resolved: ${resolved}`);
  console.log(`  Contained: ${isContained}`);
  console.log();
}
```

#### `path.resolve` and `path.normalize` Pitfalls

```typescript
// run: node --experimental-strip-types path-pitfalls.ts
import { resolve, normalize, join } from 'node:path';

// normalize resolves .. segments but does NOT enforce a boundary
console.log(normalize('/app/public/../../../etc/passwd'));
// → /etc/passwd

// resolve also processes .. segments
console.log(resolve('/app/public', '../../../etc/passwd'));
// → /etc/passwd

// join concatenates but resolves .. as well
console.log(join('/app/public', '../../../etc/passwd'));
// → /etc/passwd

// NONE of these enforce directory confinement -- that is YOUR job
```

#### Directory Confinement Pattern

```typescript
// run: node --experimental-strip-types path-confinement.ts
import { resolve, relative } from 'node:path';
import { access, readFile } from 'node:fs/promises';

const ALLOWED_DIR = resolve('./public');

async function safeReadFile(userInput: string): Promise<string> {
  // Step 1: Resolve the full, absolute path (eliminates .., symlinks conceptually)
  const requestedPath = resolve(ALLOWED_DIR, userInput);

  // Step 2: Verify the resolved path is inside the allowed directory
  if (!requestedPath.startsWith(ALLOWED_DIR + '/') && requestedPath !== ALLOWED_DIR) {
    throw new Error(`Path traversal blocked: ${userInput}`);
  }

  // Step 3: (Optional) Verify the path exists and resolve symlinks
  // realpath resolves symlinks -- a symlink inside ./public could point outside
  const { realpath } = await import('node:fs/promises');
  const realPath = await realpath(requestedPath);
  if (!realPath.startsWith(ALLOWED_DIR + '/')) {
    throw new Error(`Symlink escape blocked: ${userInput}`);
  }

  return readFile(realPath, 'utf-8');
}

// Test cases
const tests = [
  'index.html',                    // Valid
  '../../../etc/passwd',           // Traversal attempt
  'subdir/../index.html',         // Resolves within boundary -- valid
  'subdir/../../etc/passwd',      // Traversal attempt
];

for (const input of tests) {
  try {
    await safeReadFile(input);
    console.log(`ALLOWED: ${input}`);
  } catch (e) {
    console.log(`BLOCKED: ${input} -- ${(e as Error).message}`);
  }
}
```

#### Additional Defense: `chroot`-Style with Node Permissions

```typescript
// run: node --experimental-permission --allow-fs-read=./public path-permission.ts
// Node 20+ experimental permission model restricts fs access at the runtime level

import { readFile } from 'node:fs/promises';

// This will succeed (within allowed directory)
try {
  const data = await readFile('./public/index.html', 'utf-8');
  console.log('Read public file successfully');
} catch {
  console.log('File not found (expected if ./public/index.html does not exist)');
}

// This will throw ERR_ACCESS_DENIED (outside allowed directory)
try {
  await readFile('/etc/passwd', 'utf-8');
} catch (e) {
  console.log(`Blocked by permission model: ${(e as Error).message}`);
}
```

### Combining Defenses

```typescript
// run: node --experimental-strip-types combined-defense.ts
import { resolve } from 'node:path';

// Defense-in-depth for a file-serving endpoint
function validateAndResolvePath(
  baseDir: string,
  userInput: string,
): string {
  // 1. Reject null bytes (classic bypass technique)
  if (userInput.includes('\0')) {
    throw new Error('Null byte in path');
  }

  // 2. Length limit
  if (userInput.length > 255) {
    throw new Error('Path too long');
  }

  // 3. Reject suspicious patterns before resolution
  if (userInput.includes('..') || userInput.includes('~')) {
    throw new Error('Path traversal characters detected');
  }

  // 4. Resolve and verify containment
  const resolved = resolve(baseDir, userInput);
  if (!resolved.startsWith(baseDir + '/')) {
    throw new Error('Path escapes base directory');
  }

  return resolved;
}

const base = resolve('./public');
console.log(validateAndResolvePath(base, 'style.css'));          // OK
try { validateAndResolvePath(base, '../secret'); } catch (e) { console.log((e as Error).message); }
try { validateAndResolvePath(base, 'a\0b'); } catch (e) { console.log((e as Error).message); }
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

### 1. ReDoS Freezing the Entire Server

**Symptom:** All HTTP requests time out simultaneously. CPU is pegged at 100% on one core. No memory pressure, no I/O errors.

**Root cause:** A user-input validation regex (often for email, URL, or phone number format) has nested quantifiers. An attacker submits a crafted string that triggers exponential backtracking, blocking the event loop for minutes. Because V8 executes regex synchronously on the main thread, the entire server is frozen.

**Fix:** Audit all regex patterns that touch user input. Replace complex validators with purpose-built parsing libraries. Use `re2` for untrusted input. Set input length limits.

### 2. Path Traversal Leaking Secrets

**Symptom:** `.env` files, private keys, or configuration files appear in HTTP responses. Attackers gain database credentials or API keys.

**Root cause:** A file-serving endpoint uses `path.join(baseDir, req.params.filename)` without verifying the resolved path stays within `baseDir`. The attacker requests `../../../.env` and the server reads the file from the project root.

**Fix:** Always resolve the full path with `path.resolve`, then verify it starts with the allowed directory. Use `realpath` to resolve symlinks. Consider the Node permission model for defense-in-depth.

### 3. URL-Encoded Double Traversal

**Symptom:** Path traversal protections are in place, but the attacker bypasses them by double-encoding `..%252f..%252f` or using `%2e%2e%2f`.

**Root cause:** The path is URL-decoded at one layer (middleware) and then decoded again in the application code. The first decode turns `%2e%2e%2f` into `../`, but if the traversal check runs before the second decode, it misses the attack.

**Fix:** Decode exactly once, at the earliest possible point. Run all security checks after full decoding and path resolution. Never roll your own URL decoding -- use `decodeURIComponent` and handle it at one layer only.

:::

## 🎯 Checkpoint

::: details Question 1 -- Spotting ReDoS
**Q:** Is this regex vulnerable to ReDoS? Explain why or why not: `/^(\w+\.)*\w+@(\w+\.)+\w+$/`

**A:** Yes, it is vulnerable. The pattern `(\w+\.)*` has a quantifier `*` wrapping a group that itself contains `\w+`. If the input is a long string of word characters without dots followed by an `@` that does not lead to a valid match, the engine must try every possible partition of the word characters across iterations of the outer `*`. For example, `'aaaaaaaaaaaa@'` followed by an invalid domain will cause exponential backtracking in the domain portion `(\w+\.)+\w+` as well. Each `(\w+\.)+` segment with a trailing non-matching character triggers the same exponential growth. The fix is to use a simpler regex like `/^\S+@\S+\.\S+$/` for basic validation, or use a dedicated email validation library.
:::

::: details Question 2 -- Path resolution
**Q:** A developer writes `if (!userPath.includes('..')) { /* safe */ }`. Is this sufficient to prevent path traversal? Why or why not?

**A:** No, it is insufficient for several reasons: (1) On Windows, `..` can also be expressed as `..\\`. (2) Null bytes (`\0`) can truncate path strings in some contexts. (3) Symlinks inside the allowed directory can point to arbitrary locations -- `..` checking does not catch symlink escapes. (4) URL encoding (`%2e%2e%2f`) or double encoding can bypass the string check if decoding happens after the check. The correct approach is to resolve the full path first (`path.resolve`), optionally follow symlinks with `realpath`, and then verify the resolved path starts with the allowed directory prefix.
:::

## Key Mental Models

- **Regex runs on the main thread.** Unlike I/O, regex evaluation is synchronous CPU work in V8. A single catastrophic regex blocks the entire event loop -- treat user-input regex matching as a potential DoS vector.
- **Exponential comes from ambiguity.** Catastrophic backtracking happens when the engine cannot determine which path is correct without trying all of them. Eliminate ambiguity by removing nested quantifiers or using linear-time engines.
- **Path resolution is not path validation.** `path.resolve`, `path.join`, and `path.normalize` faithfully process `..` segments. They do not enforce any security boundary. Validation must happen after resolution.
- **Decode once, validate after.** URL decoding, path resolution, and security checks must happen in the correct order. Decode first, resolve fully, then validate containment.

## Related

- [Prototype Pollution](./01-prototype-pollution) -- another class of input-driven attacks in Node applications.
- [Supply Chain & Lockfiles](./03-supply-chain) -- vulnerable regex patterns often arrive through dependencies.
- [Timeouts & Slowloris](/nodejs/module-05/03-timeouts-slowloris) -- application-layer timeouts that limit the blast radius of ReDoS.
