---
title: Prototype Pollution
outline: deep
---

# Prototype Pollution

> **Interview weight:** High -- appears in security-focused rounds and code review exercises. Expect "spot the vulnerability" questions.
> **Node version notes:** Examples target Node 22+. Mitigations like `Object.hasOwn()` are stable since Node 18.
> **Prerequisites:** JavaScript prototype chain, object property lookup, JSON parsing basics.

## 🗣️ In Plain English

::: tip In Plain English
Imagine every house in a neighborhood inherits its blueprint from a single master plan stored at city hall. If someone sneaks into city hall and adds "install a backdoor" to the master plan, every house built from that plan suddenly has a backdoor -- even houses that were built before the change, because they all share the same reference blueprint.

In JavaScript, nearly every object inherits from `Object.prototype`. That shared prototype is like the master plan at city hall. Prototype pollution is the attack where an adversary manages to write new properties onto `Object.prototype` (or any constructor's prototype). Once that happens, every object in your application sees those injected properties unless it explicitly overrides them.

The attack usually arrives through code that recursively merges or deep-clones objects without checking whether a key is `__proto__` or `constructor`. An attacker sends a JSON payload like `{"__proto__": {"isAdmin": true}}`, and if your merge function walks every key blindly, it writes `isAdmin` onto the prototype of all objects. Later, when your authorization middleware checks `user.isAdmin`, it walks up the prototype chain, finds the injected `true`, and grants admin access to an unauthenticated request.

What makes this attack subtle is that the polluted property does not appear in `Object.keys()` or `JSON.stringify()` output for the targeted objects. It is invisible unless you know to look at the prototype chain directly. Code reviews miss it because the merge utility works perfectly for legitimate data -- the vulnerability only manifests when adversarial input arrives.

The defenses are straightforward once you know the threat exists: use `Map` instead of plain objects for user-supplied key-value data, create prototype-free objects with `Object.create(null)`, freeze prototypes with `Object.freeze(Object.prototype)` during startup, and always validate or skip dangerous keys like `__proto__`, `constructor`, and `prototype` in any recursive object operation.
:::

## ⚙️ Under the Hood

### How the Prototype Chain Enables Pollution

When you access a property on an object, V8 walks up the prototype chain:

```
myObj → Object.prototype → null
```

If `myObj` does not have `isAdmin`, but `Object.prototype` does (because it was injected), the lookup returns the injected value.

### The Attack Mechanism

```typescript
// run: node --experimental-strip-types proto-pollution-demo.ts  (Node 22)
// run: node proto-pollution-demo.ts                             (Node 23.4+)

// A naive deep merge -- the kind you find in hundreds of npm packages
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = target[key];
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
      target[key] = deepMerge(
        (tgtVal && typeof tgtVal === 'object' ? tgtVal : {}) as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      target[key] = srcVal;
    }
  }
  return target;
}

// Attacker sends this payload via HTTP body
const maliciousPayload = JSON.parse('{"__proto__": {"isAdmin": true}}');

// The merge walks into __proto__ and writes onto Object.prototype
const config = {};
deepMerge(config, maliciousPayload);

// Now EVERY object in the process is "admin"
const innocentUser = {};
console.log((innocentUser as Record<string, unknown>).isAdmin); // true  <-- polluted!
console.log({}.constructor.prototype.isAdmin);                   // true

// Cleanup for demonstration
delete (Object.prototype as Record<string, unknown>).isAdmin;
```

### Attack Vectors

| Vector | How it works |
|--------|-------------|
| `__proto__` key in JSON | `JSON.parse` faithfully creates an object with `__proto__` as an own property. If merged naively, it writes to the prototype. |
| `constructor.prototype` | Accessing `obj.constructor.prototype` reaches the same target as `obj.__proto__`. Merges that walk `constructor` keys are vulnerable. |
| Nested pollution | `{"constructor": {"prototype": {"polluted": true}}}` achieves the same result through a different path. |
| Query string parsers | `?__proto__[isAdmin]=true` in URL query strings parsed by naive `qs`-like libraries. |

### Real-World CVEs

| CVE | Package | Impact |
|-----|---------|--------|
| CVE-2019-10744 | `lodash` (< 4.17.12) | `_.defaultsDeep` allowed prototype pollution. Millions of dependents affected. |
| CVE-2020-28469 | `glob-parent` (< 5.1.2) | ReDoS + prototype pollution combination in file-matching libraries. |
| CVE-2021-25945 | `set-value` (< 4.0.1) | Deep property setter allowed prototype pollution via `constructor.prototype`. |
| CVE-2022-21824 | Node.js core | `console.table` prototype pollution via crafted property names. Fixed in Node 12.22.9, 14.18.3, 16.13.2. |

### JSON Parsing Risks

`JSON.parse` creates `__proto__` as an **own property**, not as a prototype link. The danger arises when that parsed object is later merged, spread, or iterated over by code that does not skip the key:

```typescript
// run: node --experimental-strip-types json-proto-demo.ts
const parsed = JSON.parse('{"__proto__": {"injected": true}}');

// Own property -- not pollution yet
console.log(Object.hasOwn(parsed, '__proto__'));          // true
console.log(({} as Record<string, unknown>).injected);   // undefined -- safe so far

// But if you do this, pollution happens:
// Object.assign({}, parsed);  <-- __proto__ is copied as a regular key, NOT as prototype
// A naive deep merge WOULD follow __proto__ into Object.prototype
```

### Defense Patterns

**1. Prototype-free objects**

```typescript
// run: node --experimental-strip-types defense-null-proto.ts
const safeStore: Record<string, unknown> = Object.create(null);
safeStore['__proto__'] = 'harmless';   // Just a regular key, no prototype to pollute
console.log(({} as Record<string, unknown>).__proto__);  // [Object: null prototype] {} -- unaffected
console.log(safeStore['__proto__']);                      // 'harmless'
```

**2. Use `Map` for user-supplied keys**

```typescript
// run: node --experimental-strip-types defense-map.ts
const userConfig = new Map<string, unknown>();
userConfig.set('__proto__', 'whatever');  // Just a string key in a hash map -- no prototype involved
console.log(userConfig.get('__proto__'));  // 'whatever'
console.log(({} as Record<string, unknown>).whatever);  // undefined -- no pollution
```

**3. Key filtering in merge functions**

```typescript
// run: node --experimental-strip-types defense-filter.ts
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function safeMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of Object.keys(source)) {
    if (DANGEROUS_KEYS.has(key)) continue;  // Skip dangerous keys
    const srcVal = source[key];
    const tgtVal = target[key];
    if (srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal)) {
      target[key] = safeMerge(
        (tgtVal && typeof tgtVal === 'object' ? tgtVal : {}) as Record<string, unknown>,
        srcVal as Record<string, unknown>,
      );
    } else {
      target[key] = srcVal;
    }
  }
  return target;
}

const payload = JSON.parse('{"__proto__": {"admin": true}, "name": "ok"}');
const result = safeMerge({}, payload);
console.log(result);                                        // { name: 'ok' }
console.log(({} as Record<string, unknown>).admin);         // undefined -- safe
```

**4. Freeze the prototype (defense-in-depth)**

```typescript
// run: node --experimental-strip-types defense-freeze.ts
Object.freeze(Object.prototype);

try {
  (Object.prototype as Record<string, unknown>).injected = true;
} catch (e) {
  console.log('Blocked:', (e as Error).message);
  // In strict mode: "Cannot add property injected, object is not extensible"
}
```

> **Caveat:** Freezing `Object.prototype` can break third-party libraries that monkeypatch prototypes. Test thoroughly before enabling in production.

### Detection in Code Review

Look for these red flags:

- **Recursive object merges** without key filtering (`deepMerge`, `deepAssign`, custom `clone`)
- **`for...in` loops** without `Object.hasOwn()` guard
- **Dynamic property assignment** from user input: `obj[userKey] = userValue`
- **Libraries with known CVEs:** `lodash.merge` (pre-4.17.21), `hoek.merge`, `set-value`

```typescript
// run: node --experimental-strip-types detection-demo.ts

// RED FLAG: for...in without hasOwn
function unsafeIterate(obj: Record<string, unknown>): void {
  for (const key in obj) {
    console.log(`  ${key}: ${obj[key]}`);  // Walks prototype chain!
  }
}

// SAFE: Object.keys or hasOwn guard
function safeIterate(obj: Record<string, unknown>): void {
  for (const key of Object.keys(obj)) {  // Own properties only
    console.log(`  ${key}: ${obj[key]}`);
  }
}

const testObj = { a: 1, b: 2 };
console.log('Unsafe iteration:');
unsafeIterate(testObj);
console.log('Safe iteration:');
safeIterate(testObj);
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

### 1. Authorization Bypass via Config Merge

**Symptom:** Unauthenticated users gain admin privileges. Audit logs show no explicit role assignment.

**Root cause:** A configuration merging utility applied user-supplied JSON to a defaults object. The payload `{"__proto__": {"role": "admin"}}` polluted `Object.prototype`. Every subsequent `user.role` lookup returned `"admin"` because no user object had an own `role` property -- they all fell through to the polluted prototype.

**Fix:** Replace naive merge with a library that filters prototype keys (e.g., `lodash.merge` >= 4.17.21), or use `Map` for runtime config.

### 2. Remote Code Execution via Template Engines

**Symptom:** Arbitrary shell commands execute on the server. The attack surface appears to be a harmless form submission.

**Root cause:** Template engines like Handlebars and Pug compile templates into JavaScript functions. If the options object passed to the template compiler inherits a polluted property (e.g., `allowProtoMethodsByDefault: true` or a code-injection property), the attacker can execute arbitrary code during template compilation.

**Fix:** Pin template engine versions with known fixes. Validate all input before passing to template compilation. Freeze `Object.prototype` as defense-in-depth.

### 3. Silent Behavioral Changes Across the Entire Process

**Symptom:** Intermittent, hard-to-reproduce bugs across unrelated parts of the application. A feature flag appears enabled in some requests but not others. JSON serialization produces unexpected output.

**Root cause:** A one-time pollution event added a property to `Object.prototype`. Because the property is invisible to `JSON.stringify` and `Object.keys`, debugging is extremely difficult. The pollution persists for the lifetime of the process. In a long-running server, this can go undetected for days.

**Fix:** Add automated prototype-pollution detection in CI (e.g., `eslint-plugin-security`). In production, periodically assert that `Object.prototype` has no unexpected own properties.

:::

## 🎯 Checkpoint

::: details Question 1 -- The mechanism
**Q:** Why does `JSON.parse('{"__proto__": {"x": 1}}')` not immediately pollute `Object.prototype`? At what point does pollution actually occur?

**A:** `JSON.parse` creates `__proto__` as an **own property** on the resulting object. It does not interpret `__proto__` as a prototype assignment -- it is just a string key. Pollution occurs when a subsequent operation (deep merge, `Object.assign` with recursive walk, or a `for...in` loop that writes properties) copies the nested object into `Object.prototype`. The key distinction is between **parsing** (safe) and **merging/assigning** (dangerous if unguarded).
:::

::: details Question 2 -- Defense trade-offs
**Q:** You propose freezing `Object.prototype` in production. Your teammate argues this will break things. Who is right, and what is the pragmatic approach?

**A:** Both are right. Freezing `Object.prototype` is the most thorough defense against pollution, but it breaks any library that adds methods to `Object.prototype` (some polyfills, older lodash versions, certain ORM internals). The pragmatic approach is **defense in layers**: (1) Use `Map` or `Object.create(null)` for user-supplied data, (2) filter dangerous keys in all merge/clone utilities, (3) run `eslint-plugin-security` in CI, (4) consider freezing `Object.prototype` only after testing the full dependency tree. In new projects with modern dependencies, freezing is safe and highly recommended.
:::

::: details Question 3 -- Spotting vulnerabilities
**Q:** Given this code, identify the vulnerability and fix it:
```typescript
function applyDefaults(config: Record<string, unknown>, defaults: Record<string, unknown>) {
  for (const key in defaults) {
    if (config[key] === undefined) config[key] = defaults[key];
  }
  return config;
}
```

**A:** The `for...in` loop iterates over inherited (prototype) properties, not just own properties. If `defaults` has been polluted (or if `Object.prototype` is polluted), the loop copies those injected properties into `config`. Additionally, the function does not guard against `__proto__` or `constructor` keys. **Fix:** Replace `for...in` with `Object.keys(defaults)` or add an `Object.hasOwn(defaults, key)` guard, and add a `DANGEROUS_KEYS` check.
:::

## Key Mental Models

- **The prototype chain is a shared mutable global.** Any write to `Object.prototype` affects every object in the process. Treat prototype modification as a global side effect on par with modifying `process.env`.
- **Parse is safe; merge is dangerous.** `JSON.parse` creates own properties. The vulnerability lives in code that copies those properties to prototypes -- merge utilities, deep clone functions, `for...in` loops.
- **Defense is about denying the path, not detecting the payload.** Blocking `__proto__` as a key is necessary but not sufficient -- `constructor.prototype` is an equally valid path. Use structural defenses (null prototypes, `Map`, `Object.freeze`) rather than blocklist-only approaches.
- **Pollution is invisible by default.** `Object.keys()`, `JSON.stringify()`, and `console.log()` do not show inherited prototype properties. Detection requires explicit inspection of the prototype chain.

## Related

- [ReDoS & Path Traversal](./02-redos-path-traversal) -- other input-driven attack vectors in Node applications.
- [HTTP Hardening](./04-http-hardening) -- request validation and security headers that complement prototype pollution defenses.
- [Supply Chain & Lockfiles](./03-supply-chain) -- vulnerable dependencies are the most common source of pollution in production.
