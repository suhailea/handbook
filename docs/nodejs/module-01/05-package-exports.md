---
title: "package.json exports & Dual-Package Hazard"
outline: deep
---

# package.json exports & Dual-Package Hazard

<span class="badge interview-hot">Interview 🔥🔥</span> <span class="badge">Node 12.7+ (exports)</span> <span class="badge">Node 12.11+ (self-reference)</span>

**Prerequisites:** [CJS Resolution & Caching](./03-cjs-resolution) ·  [ESM & Interop](./04-esm-interop)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you run a warehouse. For years, you had exactly one front door — customers walked in and got whatever was on the shelf. That front door is the `"main"` field in `package.json`: one entry, one format, no questions asked.

Then your business grew. You now have wholesale buyers (who need pallets) and retail shoppers (who need individual boxes). You also have internal staff who should use the back corridors but should never be reached by outsiders. Having everyone funnel through the same front door is chaos.

The `"exports"` field is you replacing that single front door with a **reception desk**. The receptionist checks two things: *who you are* (are you an `import` customer or a `require` customer?) and *what you asked for* (the main product, or a specific sub-product like `"my-lib/utils"`?). Based on those two answers, the receptionist sends you to the exact right shelf — and *blocks you from wandering into aisles you weren't offered*.

This is powerful but introduces a trap. Suppose the same wholesale buyer walks in through the `require` entrance and gets Pallet A, and then later walks in through the `import` entrance and gets Box B — but Pallet A and Box B contain the *same product, packaged differently*. Now there are two copies of that product in the buyer's truck, and they don't know about each other. If the product has internal state (say, a running counter), each copy keeps its own count. That is the **dual-package hazard**: one dependency, loaded twice, two separate identities in memory.

The `"imports"` field, by contrast, is like labeling your internal back corridors with `#`-prefixed names so staff can navigate between them — but those names only work inside your warehouse. Outsiders never see them.
:::

## ⚙️ Under the Hood

### Why `"main"` is legacy

The `"main"` field has existed since npm's earliest days. It specifies a single file resolved when someone does `require('my-lib')` or `import 'my-lib'`. Its limitations:

1. **One entry point.** You cannot expose `my-lib/utils` without relying on filesystem conventions (and hoping nobody imports `my-lib/src/internal`).
2. **No conditional resolution.** CJS and ESM consumers get the same file.
3. **No encapsulation.** Every file in the package is reachable by path.

Node 12.7 introduced `"exports"` to solve all three. When `"exports"` is present, it **completely replaces** `"main"` for any Node version that understands it. Older Nodes fall back to `"main"`, which is why many packages keep both.

### Subpath exports

```jsonc
// package.json
{
  "name": "my-lib",
  "exports": {
    ".": "./dist/index.js",
    "./utils": "./dist/utils.js",
    "./utils/*": "./dist/utils/*.js"
  }
}
```

- `"."` is the main entry — `import 'my-lib'`.
- `"./utils"` maps `import 'my-lib/utils'` to a specific file.
- `"./utils/*"` is a **subpath pattern** *(Node 12.20+)* that allows wildcard mapping.

**Encapsulation:** any path *not* listed in `"exports"` is **blocked**. `import 'my-lib/dist/internal-helper'` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`. This is intentional — it makes the package's public API explicit and lets maintainers refactor internals freely.

### Conditional exports

Each subpath can branch based on *conditions*:

```jsonc
{
  "name": "my-lib",
  "exports": {
    ".": {
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.cjs",
      "default": "./dist/esm/index.js"
    }
  }
}
```

Node evaluates conditions top-to-bottom and picks the **first match**. Built-in conditions:

| Condition     | When it matches                                    |
|---------------|---------------------------------------------------|
| `"import"`    | Loaded via `import` or `import()`                 |
| `"require"`   | Loaded via `require()`                            |
| `"node"`      | Running in Node.js (not browser/Deno)             |
| `"default"`   | Always — the fallback, must come last             |
| `"types"`     | TypeScript type resolution (community convention) |
| `"node-addons"` | Native addon resolution *(Node 18.19+)*       |

Custom conditions (e.g., `"production"`, `"development"`) can be activated with the `--conditions` CLI flag or `--conditions` in loader hooks.

**Order matters.** This is wrong:

```jsonc
{
  ".": {
    "default": "./fallback.js",   // matches everything — import/require never reached
    "import": "./esm.js"
  }
}
```

### The `"imports"` field (private aliases)

`"imports"` defines package-private specifiers that begin with `#`:

```jsonc
{
  "imports": {
    "#db": {
      "node": "./src/db-node.ts",
      "default": "./src/db-browser.ts"
    },
    "#utils/*": "./src/utils/*.ts"
  }
}
```

```typescript
// Inside the package — works:
import { connect } from '#db';

// Outside the package — ERR_PACKAGE_IMPORT_NOT_DEFINED
```

This is powerful for aliasing without bundler path-mapping, and for environment branching (Node vs edge runtime) within a single codebase.

### The dual-package hazard

This is the most important concept on this page. Here is exactly what happens:

1. Package `foo` ships both CJS (`dist/cjs/index.cjs`) and ESM (`dist/esm/index.mjs`) via conditional exports.
2. Your app does `import foo from 'foo'` — Node loads the ESM entry.
3. A dependency of yours (`bar`) does `require('foo')` — Node loads the CJS entry.
4. **Both files execute.** Node's module caches are keyed by resolved file path, and `dist/cjs/index.cjs` and `dist/esm/index.mjs` are different files. Two separate module instances exist in memory.

**Consequences:**

```typescript
// foo/dist/esm/index.mjs
let count = 0;
export function increment(): number { return ++count; }

// foo/dist/cjs/index.cjs
let count = 0;
module.exports.increment = function(): number { return ++count; };
```

```typescript
// app.ts
import { increment } from 'foo';        // ESM copy
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const fooCjs = require('foo');           // CJS copy

console.log(increment());               // 1
console.log(fooCjs.increment());         // 1 — NOT 2!
console.log(increment === fooCjs.increment); // false — different functions
// run: node --experimental-strip-types app.ts
```

The two copies share no state. `instanceof` checks fail across the boundary. Registries, caches, and singletons inside `foo` are doubled.

**Mitigation strategies:**

1. **ESM-only wrapper (recommended by Node docs).** Ship CJS as the real implementation. The ESM entry re-exports from it:

   ```javascript
   // dist/esm/index.mjs
   import cjsModule from '../cjs/index.cjs';
   export const { increment } = cjsModule;
   ```

   Now both entry points resolve to the same CJS module instance. State is shared.

2. **Stateless package.** If the package exports only pure functions with no mutable state, the hazard is cosmetic — two copies exist but behave identically.

3. **CJS-only.** Ship only CJS; ESM consumers use `import` of a CJS module (supported since Node 22 with `require(esm)` stabilizing the interop story).

### `require(esm)` changes the game *(Node 22+)*

Since Node 22, `require()` can load ESM modules synchronously (provided they don't use top-level `await`). This means a package can ship ESM-only with `"type": "module"` and a single `"exports"` entry:

```jsonc
{
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  }
}
```

Both `import 'foo'` and `require('foo')` resolve to the **same file**. The dual-package hazard disappears because there is only one file path in the cache.

### Bundlers vs Node resolution

Bundlers (webpack, esbuild, Rollup, Vite) implement their own `"exports"` resolution, but with differences:

| Behavior                        | Node                                      | Bundlers (typical)                       |
|---------------------------------|------------------------------------------|------------------------------------------|
| Condition `"browser"`           | Ignored (use `--conditions` to enable)    | Recognized by default                    |
| Condition `"module"`            | Not a built-in condition                  | Many bundlers recognize it (legacy)      |
| Wildcard `*` patterns           | Supported since 12.20                     | Support varies; some use `index` heuristics |
| Encapsulation (blocked paths)   | Strict — throws `ERR_PACKAGE_PATH_NOT_EXPORTED` | Often bypassed or configurable        |
| `"types"` condition             | Ignored at runtime (TS-only)              | Used by TypeScript's `moduleResolution: "bundler"` |

**TypeScript's `moduleResolution: "bundler"` vs `"node16"`:** The `"node16"` (or `"nodenext"`) strategy mirrors Node's algorithm exactly — it requires file extensions in relative imports and respects `"exports"` strictly. `"bundler"` mode is looser, allowing extensionless imports and resolving `"types"` conditions. Choose based on whether you're shipping for Node directly or through a bundler.

### A complete real-world `package.json`

```jsonc
{
  "name": "@acme/toolkit",
  "version": "2.0.0",
  "type": "module",
  "engines": { "node": ">=22" },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "default": "./dist/index.js"
    },
    "./logger": {
      "types": "./dist/logger.d.ts",
      "import": "./dist/logger.js",
      "require": "./dist/logger.cjs",
      "default": "./dist/logger.js"
    },
    "./package.json": "./package.json"
  },
  "imports": {
    "#internal/*": "./src/internal/*.ts"
  },
  "main": "./dist/index.cjs",
  "types": "./dist/index.d.ts",
  "files": ["dist"]
}
```

Key points:
- `"types"` condition comes **first** — TypeScript resolves before `"import"`/`"require"`.
- `"./package.json"` is explicitly exported — some tools need it and it's blocked by default when `"exports"` is present.
- `"main"` and `"types"` at the top level are fallbacks for old tooling.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Silent dual-instance bugs.** Your NestJS app uses a shared `@acme/config` package that holds a singleton registry. The config package ships dual CJS+ESM. NestJS loads it via `require`, but one of your utility modules uses `import`. Two registries exist in memory. Config registered in one is invisible to the other. Symptom: services randomly get `undefined` configuration values. Diagnosis: `require.cache` and ESM loader traces (`NODE_DEBUG=esm`) show two different file paths for the same package.

**2. `ERR_PACKAGE_PATH_NOT_EXPORTED` after upgrade.** A library adds `"exports"` in a minor version (technically a breaking change, but many authors don't realize). Your code that imported `'the-lib/dist/internal-util'` breaks instantly. Fix: use only documented public entry points or pin the version.

**3. Condition-order bugs.** An author puts `"default"` before `"import"`. Every consumer gets the fallback file. In a monorepo with mixed CJS/ESM packages, this produces bizarre "module not found" errors because the fallback file has the wrong module format for the consumer.

**4. `"imports"` path collision with npm packages.** The `#` prefix exists specifically to avoid collisions — but if you accidentally omit the `#` in `"imports"` keys, Node interprets the entry as a bare specifier, shadowing real npm packages. Always verify `"imports"` keys start with `#`.
:::

## 🎯 Checkpoint

::: details Question 1 — Encapsulation enforcement
**Q:** A package has `"exports": { ".": "./lib/index.js" }`. A consumer tries `import helper from 'the-pkg/lib/utils.js'`. What happens in Node, and what happens in a typical bundler?

**A:** In Node, resolution throws `ERR_PACKAGE_PATH_NOT_EXPORTED` because `"./lib/utils.js"` is not an entry in the `"exports"` map. The `"exports"` field is an allowlist — unlisted paths are blocked regardless of whether the file exists on disk. In most bundlers, behavior depends on configuration: webpack and esbuild generally respect `"exports"` encapsulation by default (since webpack 5), but some bundler configurations or plugins may bypass it, resolving the file directly from `node_modules`. The safe assumption is that Node enforces encapsulation; bundlers *usually* do but are not guaranteed to.
:::

::: details Question 2 — Dual-package hazard mitigation
**Q:** You maintain a library with mutable singleton state. You need to support both `require('your-lib')` and `import 'your-lib'`. How do you ship it to avoid the dual-package hazard?

**A:** The recommended strategy is to make one format the "source of truth" and have the other re-export from it. Concretely: implement the library in CJS (`index.cjs`), then create a thin ESM wrapper (`index.mjs`) that does `import mod from './index.cjs'; export const { thing } = mod;`. Both entry points resolve to the same CJS module instance in Node's CJS cache, so the singleton is truly singular. Alternatively, on Node 22+, ship ESM-only (no top-level `await`) — `require(esm)` allows CJS consumers to load it, and because there is only one file, only one instance exists.
:::

::: details Question 3 — Condition evaluation order
**Q:** Given these exports, what file does `require('pkg')` resolve to? What about `import 'pkg'`?
```json
{ ".": { "node": "./node.js", "import": "./esm.js", "require": "./cjs.js", "default": "./fallback.js" } }
```

**A:** Conditions are evaluated top-to-bottom. `require('pkg')`: Node checks `"node"` first — matches (we are in Node) — resolves to `./node.js`. `import 'pkg'`: Node checks `"node"` first — still matches — resolves to `./node.js`. The `"import"` and `"require"` conditions are never reached because `"node"` matches first for both call styles. To get the intended behavior, the author should nest conditions: `{ ".": { "import": { "node": "./esm-node.js", "default": "./esm.js" }, "require": { "node": "./cjs-node.js", "default": "./cjs.js" } } }`.
:::

## Key Mental Models

- **`"exports"` is an allowlist, not a mapping convenience.** Anything not listed is blocked. This is encapsulation, not routing.
- **Conditions are evaluated top-to-bottom, first-match wins.** Put `"default"` last. Nest conditions when you need to combine them.
- **The dual-package hazard is a *cache-identity* problem.** Different file paths mean different cache entries mean different module instances. One file path = one instance = no hazard.
- **`"imports"` with `#` gives you aliasing without bundler config** — and it works at the Node resolution level, not just at build time.
- **On Node 22+, `require(esm)` makes ESM-only packages viable** — the simplest way to kill the dual-package hazard is to have only one format.

## Related

- [CJS Resolution & Caching](./03-cjs-resolution) — the legacy resolution algorithm that `"main"` feeds into
- [ESM & Interop](./04-esm-interop) — how `import` and `require` interact, and how `require(esm)` works
- [Supply Chain & Lockfiles](/nodejs/module-08/03-supply-chain) — `"exports"` encapsulation as a supply-chain security boundary
