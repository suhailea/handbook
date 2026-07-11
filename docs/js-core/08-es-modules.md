---
title: ES Modules
outline: deep
---

# ES Modules

<Badge type="tip" text="Interview: High" /> <Badge type="warning" text="Prereqs: Execution Contexts" />

## 🗣️ In Plain English

::: tip In Plain English
Think about the difference between photocopying a book and subscribing to a live document.

**CommonJS** (`require`) is like walking into a library and photocopying the pages you need. You get a snapshot of the text as it was at the moment you copied it. If the original book is updated later, your photocopy stays the same. You can mark up your copy, fold pages, do whatever you want — it is completely independent of the original.

**ES Modules** (`import`) are like a digital subscription. Instead of getting a copy, you get a live link to the original document. Whenever the author updates a paragraph, every subscriber sees the change immediately. You cannot edit the document yourself (imports are read-only), but you always have the latest version.

The library also has a strict policy: you must declare all your subscriptions **before the library opens** (at the top level of your file). No walking in at noon and asking for a new subscription on the spot. This upfront declaration lets the librarian (the JavaScript engine, or a bundler like Webpack) know the full list of dependencies before anything runs. That is what makes **tree-shaking** possible — the librarian can see which books nobody subscribed to and remove them from the shelves entirely.

There is one exception: the library has a special request form called `import()` that you can fill out at any time. You hand it in and wait for a response (it returns a Promise). This is how you do conditional or lazy loading — you subscribe to a book only when you actually need it, not upfront.

This system also supports **top-level await**: if your module needs to fetch data before it can export anything, it can pause its own initialization. Downstream subscribers simply wait until your module is ready.
:::

## ⚙️ Under the Hood

### Static Structure

`import` and `export` declarations must appear at the top level of a module. They cannot be inside `if` blocks, functions, or loops.

```ts
// run: node --experimental-strip-types demo.ts

// VALID — top-level declarations
export const VERSION = "1.0.0";
export function greet(name: string): string {
  return `Hello, ${name}`;
}

// INVALID — would be a SyntaxError:
// if (condition) { import { foo } from "./bar.ts"; }
```

This constraint is deliberate: it allows the engine (and bundlers) to determine the full dependency graph by **static analysis** — no code needs to execute. This enables:

- **Tree-shaking:** Dead exports are removed at build time.
- **Faster startup:** The module graph is resolved before evaluation begins.
- **Better tooling:** IDEs can auto-import, rename across files, and detect unused exports.

### Live Bindings vs CommonJS Value Copies

This is the most important behavioral difference between ESM and CJS.

```ts
// --- counter.ts ---
export let count = 0;
export function increment(): void {
  count++;
}
```

```ts
// run: node --experimental-strip-types demo.ts

// Simulating the live-binding behavior within a single file
// (In real code, these would be separate modules)

// ESM behavior: importers see the live binding
const counter = (() => {
  let count = 0;
  function increment() { count++; }
  // ESM exports are like getters — they always read the current value
  return {
    get count() { return count; },
    increment,
  };
})();

console.log(counter.count);    // 0
counter.increment();
console.log(counter.count);    // 1 — live binding sees the update

// CJS behavior: importers get a value copy
const cjsCounter = (() => {
  let count = 0;
  function increment() { count++; }
  // CJS module.exports is a snapshot
  return { count, increment };
})();

console.log(cjsCounter.count);    // 0
cjsCounter.increment();
console.log(cjsCounter.count);    // 0 — still 0! It's a copy, not a binding
```

| Aspect               | ESM (`import`)                       | CJS (`require`)                      |
|-----------------------|--------------------------------------|--------------------------------------|
| Binding type          | Live reference (getter)              | Value copy at `require()` time       |
| Mutability by importer| Read-only (cannot reassign)          | Can mutate the exports object        |
| Circular dependencies | Bindings exist but may be uninitialized | Partial `module.exports` object     |
| Evaluation            | Deferred, async-capable             | Synchronous, on first `require()`    |

### Module Evaluation Order

The engine processes modules in three distinct phases:

```
1. PARSE        →  Build the dependency graph via static analysis of imports
2. INSTANTIATE  →  Create module records, wire up live bindings (no code runs yet)
3. EVALUATE     →  Execute module bodies in depth-first, post-order traversal
```

```ts
// run: node --experimental-strip-types demo.ts

// Demonstration of evaluation order
// If module A imports B and C, and B imports D:
//
//   A → B → D
//   A → C
//
// Evaluation order: D, B, C, A  (depth-first, post-order)
// Each module evaluates only once, even if imported multiple times.

console.log("Module evaluation is depth-first, post-order");
console.log("Dependencies evaluate before their dependents");
console.log("Each module evaluates exactly once (singleton)");
```

### Circular Dependencies

Circular imports are allowed but require care. During instantiation, bindings exist but are **uninitialized** (`TDZ` — Temporal Dead Zone). Accessing an uninitialized binding throws `ReferenceError`.

```ts
// --- a.ts ---
// import { b } from "./b.ts";
// export const a = "A:" + b;
// When b.ts tries to read 'a' during its evaluation,
// 'a' has not been initialized yet → ReferenceError

// SAFE pattern: use functions that defer access
// --- a.ts ---
// import { getB } from "./b.ts";
// export const a = "A";
// export function getA() { return a; }
// console.log(getB()); // works — b.ts has evaluated by now

// --- b.ts ---
// import { getA } from "./a.ts";
// export const b = "B";
// export function getB() { return b; }
// console.log(getA()); // works — a.ts has evaluated by now
```

### Top-Level `await` (ES2022)

A module can use `await` at the top level. This **blocks dependent modules** from evaluating until the promise settles.

```ts
// run: node --experimental-strip-types demo.ts

// Top-level await — this module's dependents wait for this to resolve
const config = await Promise.resolve({
  apiUrl: "https://api.example.com",
  timeout: 5000,
});

console.log("Config loaded:", config);

// Siblings (modules imported in parallel) are NOT blocked.
// Only modules that import THIS module must wait.
```

**Tradeoffs:**

| Pro                                     | Con                                              |
|-----------------------------------------|--------------------------------------------------|
| Clean async initialization              | Can delay app startup unpredictably              |
| Replaces async IIFE wrapper pattern     | Harder to reason about evaluation order          |
| Errors propagate as rejected modules    | A failing TLA module breaks all its importers    |

### Dynamic `import()`

`import()` returns a `Promise<ModuleNamespace>`. It works everywhere — including CJS files.

```ts
// run: node --experimental-strip-types demo.ts

// Conditional loading
const locale = "en";

async function loadTranslations(lang: string) {
  // Dynamic import — resolved at runtime, not statically analyzed
  // In a real app, these would be separate files
  const translations: Record<string, Record<string, string>> = {
    en: { greeting: "Hello" },
    es: { greeting: "Hola" },
  };

  // Simulating: const mod = await import(`./i18n/${lang}.ts`);
  return translations[lang] ?? translations["en"]!;
}

const t = await loadTranslations(locale);
console.log(t.greeting); // "Hello"
```

Use cases:
- **Code splitting:** Load routes or features on demand.
- **Conditional polyfills:** Only load when a feature is missing.
- **Reducing startup cost:** Defer heavy modules until needed.

### `import.meta`

`import.meta` is an object available in every ES module, providing metadata about the current module.

```ts
// run: node --experimental-strip-types demo.ts
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// import.meta.url — the module's file URL
console.log("Module URL:", import.meta.url);
// e.g., "file:///Users/you/project/demo.ts"

// Convert to file path (replaces __filename)
const __filename = fileURLToPath(import.meta.url);
console.log("File path:", __filename);

// Get directory (replaces __dirname)
const __dirname = dirname(__filename);
console.log("Directory:", __dirname);

// Node 21.2+ convenience properties
// console.log(import.meta.filename);  // same as __filename
// console.log(import.meta.dirname);   // same as __dirname
```

| CJS Equivalent     | ESM Replacement                                        |
|---------------------|---------------------------------------------------------|
| `__filename`        | `fileURLToPath(import.meta.url)` or `import.meta.filename` (Node 21.2+) |
| `__dirname`         | `dirname(fileURLToPath(import.meta.url))` or `import.meta.dirname` (Node 21.2+) |
| `require.resolve()` | `import.meta.resolve("./foo.ts")`                      |

### ESM in Node.js

Node.js determines the module system per-file based on these rules:

| Signal                           | Result          |
|----------------------------------|-----------------|
| `.mjs` extension                 | Always ESM      |
| `.cjs` extension                 | Always CJS      |
| `.js` + `"type": "module"` in nearest `package.json` | ESM |
| `.js` + no `"type"` field        | CJS (default)   |
| `.ts` with `--experimental-strip-types` | Follows same `.mts`/`.cts`/`"type"` rules |

**What is NOT available in ESM:**

```ts
// These CJS globals do not exist in ES modules:
// require()          → use import or import()
// module.exports     → use export
// exports            → use export
// __dirname          → use import.meta.dirname or fileURLToPath
// __filename         → use import.meta.filename or fileURLToPath
```

**Best practices for Node.js ESM:**

```ts
// run: node --experimental-strip-types demo.ts

// 1. Use node: prefix for built-in modules
import { readFile } from "node:fs/promises";

// 2. File extensions are REQUIRED in ESM imports (unlike CJS)
// import { foo } from "./utils.ts";  // must include extension

// 3. JSON imports need an import attribute (Node 22+)
// import config from "./config.json" with { type: "json" };

console.log("ESM in Node.js is working");
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Circular dependency TDZ crashes.**
Two modules that import each other's top-level constants will hit a `ReferenceError` for whichever module evaluates second. The binding exists (no "not defined" error) but is uninitialized. Fix by restructuring to use function calls that defer access, or extract shared constants into a third module.

**2. Top-level `await` delaying startup.**
A single module with `const db = await connect()` blocks every module that imports it, directly or transitively. If the connection takes 5 seconds, your entire app startup is delayed. Use lazy initialization or explicit `init()` functions for slow async operations.

**3. Missing file extensions in Node.js ESM.**
CJS auto-resolves `require("./utils")` to `./utils.js`, `./utils/index.js`, etc. ESM does not. Omitting the extension gives `ERR_MODULE_NOT_FOUND`. This is a frequent source of migration pain.

**4. CJS/ESM interop gotchas.**
`import` of a CJS module works but gives you a single `default` export (the `module.exports` object). Named imports from CJS are only available if Node can statically detect them. `require()` of an ESM module is not supported (throws `ERR_REQUIRE_ESM`) unless using `--experimental-require-module` (Node 22+).
:::

## 🎯 Checkpoint

::: details Question 1 — Live Bindings
**Q:** Module A exports `let x = 1` and a function `inc()` that does `x++`. Module B imports both. After calling `inc()`, what does B see when it reads `x`?

**A:** B sees `2`. ESM exports are live bindings — they behave like getters that always read the current value of the variable in the exporting module. When `inc()` mutates `x` inside module A, B's imported `x` reflects the change immediately. This is fundamentally different from CJS, where `x` would remain `1` because it was copied at `require()` time.
:::

::: details Question 2 — Evaluation Order
**Q:** Module `app.ts` imports `A` and `B`. `A` imports `C`. In what order do the module bodies execute?

**A:** Depth-first, post-order: `C` evaluates first, then `A` (its parent in the import tree), then `B`, then `app.ts`. Dependencies always evaluate before the modules that depend on them. Each module evaluates exactly once even if imported by multiple modules (the module record is cached).
:::

::: details Question 3 — Static vs Dynamic
**Q:** Why can't you write `if (condition) { import { foo } from "./bar.ts"; }`?

**A:** `import` declarations are part of the module's static structure and are processed during the **parse** phase, before any code executes. The engine must know the complete dependency graph upfront for instantiation (wiring live bindings) and to enable static analysis (tree-shaking, cycle detection). Conditional logic only runs during the **evaluate** phase, which is too late. For conditional loading, use the dynamic `import()` function, which returns a Promise and is evaluated at runtime.
:::

## Key Mental Models

- **Static graph, live bindings.** The module graph is fixed at parse time, but exported values are live references, not snapshots.
- **Parse, instantiate, evaluate.** Three distinct phases — understanding them explains circular dependency behavior, TDZ errors, and why tree-shaking works.
- **`import()` is the escape hatch.** When you need runtime decisions about what to load, dynamic import bridges the static/dynamic gap.
- **Top-level `await` is contagious.** It blocks all transitive dependents, making it powerful but dangerous for startup performance.
- **ESM is the future, CJS is the legacy.** Node.js is converging on ESM; design new packages as ESM-first with explicit file extensions.

## Related

- [Execution Contexts](./01-execution-contexts)
- [CJS Resolution](/nodejs/module-01/03-cjs-resolution)
- [ESM & Interop](/nodejs/module-01/04-esm-interop)
- [package.json exports](/nodejs/module-01/05-package-exports)
