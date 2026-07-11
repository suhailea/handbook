---
title: "CJS Resolution, Caching & Circular Deps"
outline: deep
---
# CJS Resolution, Caching & Circular Deps

<Badge type="tip" text="Interview: High" /> <Badge type="info" text="Node 22+" /> <Badge type="warning" text="Prereqs: JS Functions, Objects" />

## In Plain English
::: tip In Plain English
Think of `require()` as a librarian. You walk up and say "I need the book called `utils`." The librarian follows a strict search routine. First, she checks if you gave an exact title with a file extension -- if so, she looks for that exact book. If you just said "utils" without a suffix, she tries adding ".js", then ".json", then ".node" to see if any of those exist on the shelf.

If none of those work, she checks whether "utils" is actually a folder. If it is, she opens that folder and looks for a "package.json" with a "main" field that points to the real book. Failing that, she looks for "index.js" inside the folder.

But what if "utils" is not a relative path at all -- you just said "utils" without any "./" prefix? Now the librarian knows this must be a third-party book. She walks to the nearest "node_modules" shelf and looks there. If the book is not on that shelf, she walks upstairs to the parent floor's "node_modules" shelf, and keeps walking up floor by floor until she either finds it or reaches the building's roof and gives up with an error.

Once the librarian finds the book, she makes a photocopy and puts it in a special cache drawer. Every future request for the same book gets the cached photocopy instantly -- she never reads the original twice. This is great for speed, but it means if someone modifies the original book after the first read, nobody notices.

Now, here is the tricky part -- circular requests. Suppose Book A says "I need Book B," and Book B says "I need Book A." When the librarian is in the middle of photocopying Book A and hits the line that needs Book B, she pauses Book A (the photocopy is only half-done) and goes to fetch Book B. Book B then asks for Book A, and the librarian hands over the *half-finished* photocopy. Book B gets a partial, incomplete version of Book A. This is not a crash -- it is worse, because it silently works with missing data.

Finally, there is a classic trap with the exports object. The librarian gives each book a basket called `exports` to put things in. The book can add items to the basket (`exports.greet = ...`), and readers will see them. But if the book throws away the basket and replaces it with a brand-new one (`exports = something`), the librarian still hands out the *original* basket -- which is now empty. To fully replace what a book exports, you have to use `module.exports = something`, which swaps out the basket the librarian actually tracks.
:::

## Under the Hood

### The require() Resolution Algorithm

When `require(specifier)` is called, Node follows a deterministic algorithm. Understanding each step prevents mysterious `MODULE_NOT_FOUND` errors.

```typescript
// demo-resolution.ts — run: npx tsx demo-resolution.ts
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

// Step 1: Core modules short-circuit everything
// require("node:fs") → built-in, no filesystem lookup
const fs = require("node:fs");
console.log("fs is core module:", typeof fs.readFileSync === "function"); // true

// Step 2: Resolve a relative path — show the full resolved filename
const resolvedPath = require.resolve("./some-local-file");
console.log("Resolved:", resolvedPath);
// Node tries, in order:
//   ./some-local-file          (exact)
//   ./some-local-file.js       (append .js)
//   ./some-local-file.json     (append .json)
//   ./some-local-file.node     (append .node — native addon)
//   ./some-local-file/package.json → "main" field
//   ./some-local-file/index.js (directory index)
```

### The Full Lookup Order

```typescript
// resolution-order.ts — run: node --experimental-print-required-tla resolution-order.ts
// This pseudocode mirrors the actual C++ in node::loader

function resolveModule(specifier: string, parentDir: string): string {
  // 1. Core module?
  if (isBuiltin(specifier)) return `node:${specifier}`;

  // 2. Relative or absolute path?
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier.startsWith("/")) {
    return resolveAsFile(specifier, parentDir)
        ?? resolveAsDirectory(specifier, parentDir)
        ?? throwModuleNotFound(specifier);
  }

  // 3. Bare specifier → walk node_modules
  return resolveNodeModules(specifier, parentDir)
      ?? throwModuleNotFound(specifier);
}

function resolveAsFile(name: string, dir: string): string | null {
  // Try exact, then .js, .json, .node
  for (const ext of ["", ".js", ".json", ".node"]) {
    const candidate = `${dir}/${name}${ext}`;
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveAsDirectory(name: string, dir: string): string | null {
  const pkgPath = `${dir}/${name}/package.json`;
  if (existsSync(pkgPath)) {
    const main = JSON.parse(readFileSync(pkgPath, "utf8")).main;
    if (main) return resolveAsFile(main, `${dir}/${name}`);
  }
  // Fallback: index.js / index.json / index.node
  return resolveAsFile("index", `${dir}/${name}`);
}

function resolveNodeModules(specifier: string, startDir: string): string | null {
  // Walk up from startDir to root, checking node_modules at each level
  let current = startDir;
  while (true) {
    const nmDir = `${current}/node_modules`;
    const result = resolveAsFile(specifier, nmDir)
               ?? resolveAsDirectory(specifier, nmDir);
    if (result) return result;
    const parent = dirname(current);
    if (parent === current) return null; // reached filesystem root
    current = parent;
  }
}
```

### The Module Cache

Every loaded module is cached by its **fully resolved absolute path**.

```typescript
// cache-demo.ts — run: npx tsx cache-demo.ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// First require: file is read, compiled, executed
const a1 = require("./counter");
// Second require: cache hit — same object reference
const a2 = require("./counter");

console.log(a1 === a2); // true — referential identity

// Inspect the cache
const resolvedKey = require.resolve("./counter");
console.log(Object.keys(require.cache)); // [..., '/abs/path/to/counter.js']
console.log(require.cache[resolvedKey]?.loaded); // true
```

```typescript
// counter.ts — a module that proves it only executes once
console.log("counter.ts is executing"); // prints only once
let count = 0;
export function increment(): number { return ++count; }
module.exports = { increment };
```

**Cache key gotcha:** The cache is keyed by the *resolved* path. If two different symlinks point to the same file, they may produce different cache keys, resulting in the module executing twice. This is common with `npm link`.

### Circular Dependencies

```typescript
// a.ts
console.log("a.ts: starting");
module.exports = { fromA: "partial" };

const b = require("./b"); // pause a, go load b
console.log("a.ts: b.fromB =", b.fromB); // "complete"

module.exports.complete = true;
console.log("a.ts: finished");
```

```typescript
// b.ts
console.log("b.ts: starting");

const a = require("./a"); // gets a's PARTIAL exports (only { fromA: "partial" })
console.log("b.ts: a.fromA =", a.fromA);     // "partial"
console.log("b.ts: a.complete =", a.complete); // undefined — not yet assigned!

module.exports = { fromB: "complete" };
console.log("b.ts: finished");
```

```
// Output order — run: node a.ts
a.ts: starting
b.ts: starting
b.ts: a.fromA = partial
b.ts: a.complete = undefined   ← the silent hazard
b.ts: finished
a.ts: b.fromB = complete
a.ts: finished
```

Node handles the cycle by returning the **in-progress** `module.exports` object. Whatever properties have been assigned *so far* are visible; everything after the circular `require()` call is missing.

### module.exports vs exports

```typescript
// trap-demo.ts — run: node trap-demo.ts

// Behind the scenes, Node wraps your module in:
// (function(exports, require, module, __filename, __dirname) {
//   ... your code ...
// })
// where: exports = module.exports (same reference)

// WORKS — mutating the shared object
exports.greet = () => "hello";
// module.exports === exports === { greet: fn }

// BREAKS — reassigning the local variable
exports = { farewell: () => "bye" };
// module.exports still === { greet: fn }
// `exports` is now a detached local variable

// WORKS — reassigning the authoritative reference
module.exports = { farewell: () => "bye" };
// Now the module truly exports { farewell: fn }
```

**Rule of thumb:** If you need to export a single function, class, or non-plain object, always use `module.exports =`. Use `exports.x =` only when adding named properties to the default object.

### Cache Busting

```typescript
// cache-bust.ts — run: npx tsx cache-bust.ts
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

function requireFresh(modulePath: string): unknown {
  const resolved = require.resolve(modulePath);
  delete require.cache[resolved];       // evict from cache
  return require(resolved);             // re-read, re-compile, re-execute
}

// Use case: hot-reloading config in development
const config = requireFresh("./config.json");
```

**Why you usually should not do this:**
1. Any other module holding a reference to the *old* export still has stale data.
2. Module-level side effects (DB connections, event listeners) execute again, causing leaks.
3. In circular dependency graphs, busting one node can cause unpredictable partial re-evaluation.

## Where It Bites (Production Lens)

::: warning Where It Bites

**1. Silent partial exports from circular deps.**
Module A imports B, B imports A. B receives A's half-initialized exports. No error is thrown. The bug manifests as `undefined` values deep in a call stack, often only under specific import orders. Fix: restructure to break the cycle, or lazily require inside a function body.

**2. Symlink-induced double loading.**
`npm link` or monorepo symlinks cause the same package to resolve to two different absolute paths. The module executes twice, producing two separate singleton instances. A `Map` in one instance is invisible to the other. Symptoms: `instanceof` checks fail, state is not shared. Fix: use `exports` in `package.json` or `resolve.symlinks` configuration in bundlers.

**3. The `exports = {}` trap in production libraries.**
A CJS library author writes `exports = { init }` instead of `module.exports = { init }`. Consumers get an empty object. The library appears to load successfully but every function call throws `TypeError: x is not a function`. This passes unit tests if the test file uses `module.exports` correctly in mocks.

**4. Cache pollution in test suites.**
Tests that mutate a required module's exported object affect subsequent tests because they share the cached reference. The test suite passes when run in isolation but fails (or passes incorrectly) when run in a specific order. Fix: use `jest.resetModules()` or isolate via worker threads.
:::

## Checkpoint

::: details Question 1 -- Resolution Order
**Q:** Given the call `require("./utils")` in `/app/src/index.js`, list every filesystem path Node checks before throwing `MODULE_NOT_FOUND`.

**A:**
1. `/app/src/utils` (exact match)
2. `/app/src/utils.js`
3. `/app/src/utils.json`
4. `/app/src/utils.node`
5. `/app/src/utils/package.json` -> read `"main"` field, resolve that file
6. `/app/src/utils/index.js`
7. `/app/src/utils/index.json`
8. `/app/src/utils/index.node`

If none exist, `MODULE_NOT_FOUND` is thrown. Note: because the specifier starts with `./`, the `node_modules` walk is never triggered.
:::

::: details Question 2 -- Circular Dependency Output
**Q:** Module `x.js` does `module.exports.a = 1; require("./y"); module.exports.b = 2;`. Module `y.js` does `const x = require("./x"); console.log(x.a, x.b);`. What is printed?

**A:** `1 undefined`. When `y.js` requires `x.js`, Node returns the in-progress `module.exports` of `x.js`. At that point, `a` has been assigned (value `1`) but the line assigning `b` has not yet executed, so `x.b` is `undefined`.
:::

::: details Question 3 -- exports vs module.exports
**Q:** A file contains `exports = { name: "oops" };`. What does `require()` return and why?

**A:** `require()` returns `{}` -- an empty object. The `exports` variable is initially a reference to `module.exports`, which starts as `{}`. Reassigning `exports` only changes the local variable; it does not change `module.exports`. Since `require()` returns `module.exports`, consumers get the original empty object. The fix is `module.exports = { name: "oops" };`.
:::

::: details Question 4 -- Cache Identity
**Q:** You `require("./config")` in two different files. You mutate the returned object in one. Does the other see the mutation? Why?

**A:** Yes. Both `require()` calls resolve to the same absolute path, hit the same cache entry, and return the *same object reference*. Mutating it in one place is visible everywhere. This is why treating `require()` results as immutable is important in production code.
:::

## Key Mental Models

| Model | Summary |
|---|---|
| **Librarian lookup** | `require` checks exact -> extensions -> directory -> node_modules walk up |
| **Photocopy cache** | Once resolved, the module object is cached by absolute path -- never re-executed |
| **Partial snapshot** | Circular deps return whatever `module.exports` has *so far*, not a promise of the final state |
| **Basket swap** | `exports` is a local alias; only `module.exports` is the authoritative export reference |

## Related

- [ESM & Interop](./04-esm-interop) -- how the newer module system differs
- [package.json exports](./05-package-exports) -- the modern replacement for `"main"` resolution
- [ES Modules (JS Core)](/js-core/08-es-modules) -- language-level module semantics
