---
title: "ESM, Interop & require(esm)"
outline: deep
---
# ESM, Interop & require(esm)

<Badge type="tip" text="Interview: High" /> <Badge type="info" text="Node 22+" /> <Badge type="warning" text="Prereqs: CJS Resolution, JS Modules" />

## In Plain English
::: tip In Plain English
Imagine two postal systems operating in the same country. The old system (CommonJS) works like this: you write a letter saying "I need the contents of Package X," hand it to the mailman, and he walks to the warehouse, photocopies the contents, and hands the copy back to you right there on the spot. It is synchronous -- you stand at the door and wait. If the package changes later, your photocopy does not update.

The new system (ES Modules) works differently. You submit a formal request (an `import` statement). The post office first plans the entire delivery route -- it reads all the requests from all the letters before moving a single parcel. Then it fetches everything, and instead of giving you a photocopy, it gives you a live feed -- a window into the original package. If the value inside the package changes, you see the change in real time. These are called "live bindings."

The interop challenge is what happens when you try to send a CJS parcel through the ESM post office, or vice versa. For most of Node's history, the ESM post office could accept CJS parcels (you can `import` a CJS module), but the CJS post office refused ESM parcels (`require` could not load ESM). Starting with Node 22, the CJS post office gained a special window where it can accept ESM parcels -- but only simple ones. If the ESM parcel has a "top-level await" (a note saying "wait for something async before opening"), the CJS post office rejects it, because CJS fundamentally cannot wait.

Each module system also gives you a different return envelope. CJS gives you `__filename` and `__dirname` -- street addresses as plain strings. ESM gives you `import.meta.url` -- a full URL (starting with `file://`), plus `import.meta.dirname` and `import.meta.filename` (Node 21.2+) which are the familiar string forms brought back for convenience.

The `"type"` field in `package.json` acts like a district-wide policy. Set it to `"module"` and every `.js` file in that package is treated as ESM. Set it to `"commonjs"` (or omit it) and every `.js` file is CJS. Individual files can override the policy by using `.mjs` (always ESM) or `.cjs` (always CJS) extensions.
:::

## Under the Hood

### The ESM Loader Pipeline

Node's ESM loader operates in three distinct phases, unlike CJS which does everything in a single synchronous pass.

```typescript
// esm-phases.ts — conceptual model (not runnable as-is)

// Phase 1: RESOLVE — determine the URL for a specifier
// Inputs:  specifier string, parent URL, conditions
// Output:  a fully resolved file:// URL
// Key:     "exports" field in package.json is consulted here

// Phase 2: LOAD — fetch source text and determine format
// Inputs:  resolved URL
// Output:  source code + format ("module", "commonjs", "json", "builtin", "wasm")
// Key:     "type" field in nearest package.json determines format for .js files

// Phase 3: EVALUATE — execute the module
// Inputs:  parsed module record
// Output:  module namespace object
// Key:     evaluation is depth-first, but all parsing happens first (static analysis)
```

### import vs require at the Engine Level

```typescript
// comparison.ts — run: node --input-type=module comparison.ts

// CJS: synchronous, single pass, runtime-resolved
// const x = require("./lib");
// 1. resolve path → 2. read file → 3. wrap in function → 4. execute → 5. return module.exports
// All in one synchronous call.  Specifier can be a variable.

// ESM: multi-phase, statically analyzed, asynchronous-capable
// import { x } from "./lib.js";
// 1. parse all imports (static) → 2. resolve all specifiers → 3. fetch all modules
// 4. link bindings → 5. evaluate depth-first
// Specifiers must be string literals (no variables, no expressions).

// Key difference: live bindings
// --- lib.mjs ---
// export let count = 0;
// export function increment() { count++; }

// --- main.mjs ---
// import { count, increment } from "./lib.mjs";
// console.log(count); // 0
// increment();
// console.log(count); // 1  ← live binding updated!

// In CJS, count would remain 0 — it's a copied value, not a binding.
```

### Live Bindings in Action

```typescript
// lib.mts — run: node --loader ts-node/esm main.mts
export let count = 0;

export function increment(): void {
  count++;
}

// Set up an interval to demonstrate liveness
setInterval(() => { count++; }, 1000);
```

```typescript
// main.mts — run: node --loader ts-node/esm main.mts
import { count, increment } from "./lib.mts";

console.log(count);   // 0
increment();
console.log(count);   // 1 — live binding reflects the mutation

setTimeout(() => {
  console.log(count); // 2 — interval in lib.mts incremented it
  process.exit(0);
}, 1500);
```

### require(esm) — Node 22+

Starting with Node 22, `require()` can load ES modules, removing one of the biggest interop headaches.

```typescript
// cjs-loading-esm.cjs — run: node cjs-loading-esm.cjs (Node 22+)
// No flag needed in Node 23+; in Node 22 use --experimental-require-module

const esmModule = require("./math-utils.mjs");
console.log(esmModule.add(2, 3)); // 5

// Constraints:
// 1. The ESM module must NOT contain top-level await (TLA).
//    TLA is inherently async; require() is synchronous — irreconcilable.
// 2. The module is loaded synchronously, just like CJS.
// 3. You receive the module namespace object (all named exports as properties).
```

```typescript
// math-utils.mjs — a simple ESM module loadable via require()
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

// This would break require(esm):
// const data = await fetch("https://example.com/api"); // TLA — not allowed
```

### Named Exports from CJS — Why It Sometimes Fails

```typescript
// cjs-named-exports.cjs
// Pattern 1: object literal — static analysis CAN detect named exports
module.exports = {
  greet: () => "hello",
  farewell: () => "bye",
};

// Pattern 2: dynamic assignment — static analysis CANNOT reliably detect
function buildExports() {
  const obj: Record<string, () => string> = {};
  obj["greet"] = () => "hello";
  return obj;
}
module.exports = buildExports();
```

```typescript
// consumer.mts — run: node --input-type=module consumer.mts
// Pattern 1: named imports WORK (Node can statically analyze the object literal)
import { greet } from "./pattern1.cjs"; // OK

// Pattern 2: named imports FAIL
// import { greet } from "./pattern2.cjs";
// SyntaxError: Named export 'greet' not found

// Workaround: always use default import for CJS
import pattern2 from "./pattern2.cjs";
pattern2.greet(); // OK — access via the default export
```

Node uses a static analysis tool called **cjs-module-lexer** to detect named exports from CJS. It recognizes patterns like `exports.x = ...` and `module.exports = { x, y }` but cannot follow dynamic or computed assignments.

### The "type" Field and File Extensions

```jsonc
// package.json — the "type" field sets the default for .js files
{
  "name": "my-package",
  "type": "module"  // or "commonjs" (default if omitted)
}
```

```typescript
// Resolution table:
// ┌────────────────┬──────────────┬──────────────┐
// │ Extension      │ type=module  │ type=commonjs│
// ├────────────────┼──────────────┼──────────────┤
// │ .js            │ ESM          │ CJS          │
// │ .mjs           │ ESM          │ ESM          │
// │ .cjs           │ CJS          │ CJS          │
// │ .mts           │ ESM (TS)     │ ESM (TS)     │
// │ .cts           │ CJS (TS)     │ CJS (TS)     │
// └────────────────┴──────────────┴──────────────┘
// .mjs and .cjs ALWAYS override the package.json "type" field.
```

### import.meta Properties

```typescript
// meta-demo.mts — run: node meta-demo.mts
console.log(import.meta.url);
// file:///Users/you/project/meta-demo.mts

console.log(import.meta.dirname);   // Node 21.2+
// /Users/you/project

console.log(import.meta.filename);  // Node 21.2+
// /Users/you/project/meta-demo.mts

// import.meta.resolve — synchronous since Node 20.7
const resolvedUrl = import.meta.resolve("./lib.mjs");
console.log(resolvedUrl);
// file:///Users/you/project/lib.mjs

// Converting between URL and path (needed for fs operations)
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const filePath = fileURLToPath(import.meta.url);
const content = readFileSync(filePath, "utf8"); // works with fs API
```

### CJS Globals Missing in ESM

```typescript
// esm-no-globals.mts — run: node esm-no-globals.mts

// These CJS globals do NOT exist in ESM:
// __filename  → use import.meta.filename (Node 21.2+) or fileURLToPath(import.meta.url)
// __dirname   → use import.meta.dirname  (Node 21.2+) or dirname(fileURLToPath(import.meta.url))
// require     → use createRequire(import.meta.url) for CJS interop
// module      → no equivalent (ESM uses export syntax)
// exports     → no equivalent (ESM uses export syntax)

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Now you can require() CJS modules from an ESM file
const cjsLib = require("./legacy-lib.cjs");
```

## Where It Bites (Production Lens)

::: warning Where It Bites

**1. Top-level await blocks require(esm).**
You add a single `await` at the top level of an ESM module for a config fetch. Now every CJS consumer that was using `require()` to load your package gets `ERR_REQUIRE_ASYNC_MODULE`. This can break an entire downstream ecosystem. Always gate TLA behind a separate async entry point.

**2. Named imports from CJS fail unpredictably.**
Your CJS library exports work fine with `import { x } from "lib"` on one version but break on another, because a refactor changed `module.exports = { x }` (statically analyzable) to `module.exports = buildExports()` (opaque to cjs-module-lexer). Consumers suddenly get `SyntaxError: Named export 'x' not found`. Test your CJS package with ESM consumers in CI.

**3. The "type" field cascade.**
You set `"type": "module"` in your root `package.json`. Now every `.js` file in every subdirectory is treated as ESM -- including build scripts, config files, and test helpers that use `require()`. They all break with `ReferenceError: require is not defined`. Fix: rename them to `.cjs`, or add a `package.json` with `"type": "commonjs"` in those directories.

**4. import.meta.url vs __filename in path operations.**
`import.meta.url` is a URL string (`file:///path/to/file.mjs`). Passing it directly to `fs.readFileSync()` works, but passing it to `path.join()` produces garbage (`file:/...` concatenated with your relative path). Always convert with `fileURLToPath()` before using path utilities.
:::

## Checkpoint

::: details Question 1 -- ESM Phases
**Q:** Name the three phases of the ESM loader pipeline and explain why `import` specifiers cannot be variables.

**A:** The three phases are: (1) **Resolve** -- map specifiers to URLs, (2) **Load** -- fetch source and determine format, (3) **Evaluate** -- execute depth-first. Specifiers cannot be variables because resolution happens during the **parse** step, before any code executes. The engine needs to know all dependencies statically to build the module graph. For dynamic loading, use `import()` which returns a Promise.
:::

::: details Question 2 -- require(esm) Constraints
**Q:** Under what conditions can `require()` load an ESM module in Node 22+? What happens if those conditions are not met?

**A:** `require()` can load ESM if and only if the module does **not** contain top-level `await`. The module is evaluated synchronously, just like CJS. If the module contains TLA, Node throws `ERR_REQUIRE_ASYNC_MODULE` because `require()` is fundamentally synchronous and cannot pause to wait for a Promise. Additionally, in Node 22 the `--experimental-require-module` flag is needed; in Node 23+ it is enabled by default.
:::

::: details Question 3 -- Named Exports
**Q:** Why does `import { readFile } from "fs-extra"` work but `import { myFunc } from "./dynamic-lib.cjs"` might fail?

**A:** Node uses **cjs-module-lexer** to statically analyze CJS source and detect named exports. `fs-extra` uses recognizable patterns (`exports.readFile = ...` or `module.exports = { readFile }`). A dynamic CJS module that computes its exports at runtime (e.g., `module.exports = factory()`) defeats static analysis. The fallback is to use the default import: `import dynamicLib from "./dynamic-lib.cjs"` and then access `dynamicLib.myFunc`.
:::

::: details Question 4 -- Live Bindings
**Q:** Module A (ESM) exports `let count = 0` and `function inc() { count++ }`. Module B imports both. After calling `inc()`, what is `count` in Module B? Would the answer differ if Module A were CJS?

**A:** In ESM, `count` in Module B is `1`. ESM exports are live bindings -- they are references to the original variable in Module A's scope, not copies. In CJS, `count` would still be `0` in Module B because `require()` returns a snapshot (the value is copied at the time of the assignment to `module.exports`). Module B would need to call a getter function to see the updated value.
:::

## Key Mental Models

| Model | Summary |
|---|---|
| **Two postal systems** | CJS delivers synchronous photocopies; ESM delivers live feeds with async capability |
| **Static graph** | ESM parses all imports before executing any code; CJS resolves one `require()` at a time during execution |
| **Live vs snapshot** | ESM exports are bindings (pointers); CJS exports are copied values |
| **TLA barrier** | Top-level await is the hard line that separates what `require()` can and cannot load |
| **cjs-module-lexer** | Static analysis heuristic -- pattern-based, not semantic -- determines whether named imports from CJS work |

## Related

- [CJS Resolution](./03-cjs-resolution) -- the require() algorithm in detail
- [package.json exports](./05-package-exports) -- controlling how your package is resolved in both systems
- [ES Modules (JS Core)](/js-core/08-es-modules) -- language-level module specification
