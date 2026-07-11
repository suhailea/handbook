---
title: "Supply Chain & Lockfiles"
outline: deep
---

# Supply Chain & Lockfiles

**Interview weight:** :fire::fire::fire: | **Node.js 20+** | **Prerequisites:** [package.json exports](/nodejs/module-01/05-package-exports), [ReDoS & Path Traversal](./02-redos-path-traversal)

## :speaking_head: In Plain English

::: tip In Plain English
Imagine you are building a house and you order materials from hundreds of suppliers you have never personally visited. You trust the brand names on the bags of cement, but what if someone swapped the label on a bag of sand for one that says "premium cement"? Or what if a delivery driver quietly slipped an extra package into your shipment -- one that looks like it belongs but actually contains something harmful?

That is what a **supply chain attack** is in the npm world. Your project depends on packages, and those packages depend on other packages, forming a chain of trust that can go dozens of layers deep. An attacker does not need to break into *your* code -- they just need to compromise *one* link in that chain.

The **lockfile** is your delivery manifest. It says exactly which version of each package you ordered, what its contents should look like (a cryptographic hash), and where it came from. When you use `npm ci` instead of `npm install`, you are telling npm: "do not accept anything that is not on this manifest." If someone tampered with a package or slipped in a different version, the build fails instead of silently accepting it.

**Auditing** is like hiring an inspector to walk through your warehouse and flag any materials that have known defects. `npm audit` checks every package against a public database of known vulnerabilities.

The **permission model** is like locking the doors inside your house so that even if a bad package gets in, it cannot access your file system, network, or child processes unless you explicitly hand it the key.

None of these measures alone is enough. Supply chain security is about layering defenses so that no single failure is catastrophic.
:::

## :gear: Under the Hood

### Attack Vectors

#### 1. Typosquatting

An attacker publishes a package with a name very close to a popular one (`expres`, `lodassh`, `colros`). A single typo in `package.json` pulls in malicious code.

```typescript
// Dangerous: a typo installs the wrong package
// package.json: "dependnecies": { "expresss": "^4.18.0" }
// The misspelled package runs a postinstall script that exfiltrates env vars

// Defense: always verify package names before installing
// run: npm info express | head -5
```

#### 2. Dependency Confusion (Namespace Confusion)

Organizations use private registries for internal packages. If an internal package `@company/auth-utils` is not published to the public npm registry, an attacker can publish `@company/auth-utils` on public npm. If the build system checks public npm first (or falls back to it), it installs the attacker's version.

```typescript
// .npmrc defense: scope your private packages to your registry
// @company:registry=https://npm.internal.company.com/
// registry=https://registry.npmjs.org/

// This ensures @company/* always resolves from your private registry
```

#### 3. Account Takeover & Maintainer Compromise

An attacker gains access to a maintainer's npm account (phished credentials, leaked tokens, expired email domain re-registered). They publish a new patch version with malicious code. Since most projects use `^` ranges, `npm install` pulls the new version automatically.

Notable real-world patterns:
- `event-stream` (2018): maintainer transferred ownership to an unknown actor who added a targeted cryptocurrency-stealing payload.
- `ua-parser-js` (2021): compromised maintainer account led to cryptominer injection.
- `colors` / `faker` (2022): maintainer themselves introduced destructive changes (a different threat model -- *maintainer intent*).

#### 4. Malicious `postinstall` Scripts

The `postinstall` lifecycle script runs automatically after `npm install`. It executes with the same privileges as the user. This is the most common payload delivery mechanism.

```typescript
// Inspecting what a package does on install:
// run: npm pack <package-name> && tar -xzf <package-name>-*.tgz && cat package/package.json | grep -A5 scripts

// Defense: disable scripts for untrusted packages
// run: npm install --ignore-scripts
// Then selectively allow: npm rebuild <trusted-package>
```

### Lockfile Integrity

#### `npm ci` vs `npm install`

| Behavior | `npm install` | `npm ci` |
|---|---|---|
| Reads lockfile | Yes, but may update it | Yes, strictly |
| Modifies `package-lock.json` | Yes, if versions drift | Never -- fails if lockfile is out of sync |
| Deletes `node_modules` first | No | Yes (clean slate) |
| Resolves new versions | Yes, within semver range | No -- uses exact lockfile versions |
| Speed | Slower (resolution + diffing) | Faster (no resolution) |
| CI/CD appropriate | No | **Yes** |

```typescript
// In CI pipelines, ALWAYS use npm ci
// run: npm ci --ignore-scripts && npm rebuild

// Verify lockfile integrity manually:
// run: npm ci --dry-run
```

#### Lockfile Anatomy

The `package-lock.json` contains an `integrity` field for every package -- a Subresource Integrity (SRI) hash:

```json
{
  "node_modules/lodash": {
    "version": "4.17.21",
    "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz",
    "integrity": "sha512-v2kDEe57lecTulaDIuNTPy3Ry4gLGJ6Z1O3vE1krgXZNrsQ+LFTGHVxVjcXPs17LhbZVGedAJv8XZ1tvj5FvSg=="
  }
}
```

If the downloaded tarball does not match this hash, npm refuses to install. This is why committing `package-lock.json` is non-negotiable: it is your tamper-evidence seal.

#### Lockfile Injection Attacks

A subtle attack: an attacker submits a PR that modifies `package-lock.json` to point `resolved` to a malicious tarball while keeping `version` the same. Most reviewers skip lockfile diffs. Defenses:
- Use `npm ci` (verifies integrity hashes)
- Use lockfile-lint tools in CI
- Review lockfile changes in PRs explicitly

### Dependency Auditing

```typescript
// Basic audit: checks installed packages against the npm advisory database
// run: npm audit

// Get machine-readable output for CI:
// run: npm audit --json

// Fix automatically (within semver ranges):
// run: npm audit fix

// See what would change without applying:
// run: npm audit fix --dry-run

// Force fixes (may include breaking major bumps -- use with caution):
// run: npm audit fix --force
```

#### `npm audit` Limitations

- Only checks the npm advisory database (GitHub Advisory Database). It misses zero-days and non-reported vulnerabilities.
- Transitive dependency advisories may not have fixes available -- the direct dependency must release an update.
- High noise-to-signal ratio: many advisories are for dev dependencies or require conditions you do not exercise (e.g., a ReDoS in a regex path you never call).

#### Complementary Tools

| Tool | What it adds |
|---|---|
| `socket.dev` | Detects behavioral anomalies (network calls, fs writes, postinstall scripts) |
| `snyk` | Broader vulnerability database, license compliance, fix PRs |
| `npm-lockfile-lint` | Validates lockfile integrity rules (allowed registries, no http://) |
| `npx is-my-node-vulnerable` | Checks if your Node.js binary itself has known CVEs |

### The Node.js Permission Model

*(Node 20+, `--experimental-permission`)*

Node's permission model restricts what the process itself can do, regardless of what code is loaded. This is a defense-in-depth layer: even if a malicious dependency runs, it cannot access resources you did not grant.

```typescript
// run: node --experimental-permission --allow-fs-read=/app/config --allow-fs-write=/app/logs app.ts

// In code, you can check permissions at runtime:
import { permission } from 'node:process';

if (permission.has('fs.read', '/etc/passwd')) {
  console.log('Can read /etc/passwd');
} else {
  console.log('Permission denied for /etc/passwd');
}

// Attempting a disallowed operation throws ERR_ACCESS_DENIED:
// Error [ERR_ACCESS_DENIED]: Access to this API has been restricted
```

Permission flags available *(Node 22)*:
- `--allow-fs-read=<path>` / `--allow-fs-write=<path>` -- granular filesystem access
- `--allow-child-process` -- allow `child_process.spawn` etc.
- `--allow-worker` -- allow `worker_threads`
- `--allow-addons` -- allow native addons
- Without `--allow-child-process`, a malicious postinstall script that somehow runs at application time cannot spawn reverse shells.

```typescript
// Example: locked-down production startup
// run: node --experimental-permission --allow-fs-read=/app --allow-fs-write=/app/logs --allow-fs-read=/tmp server.ts

// This prevents:
// - Reading /etc/shadow, ~/.ssh, environment credential files
// - Writing anywhere outside /app/logs
// - Spawning child processes
// - Creating worker threads
```

### Best Practices Checklist

```typescript
// 1. Pin exact versions for critical dependencies
// package.json: "express": "4.21.1" (not "^4.21.1")

// 2. Use npm ci in all automated environments
// Dockerfile example:
// COPY package.json package-lock.json ./
// RUN npm ci --ignore-scripts && npm rebuild

// 3. Audit in CI -- fail the build on high/critical
// run: npm audit --audit-level=high

// 4. Review postinstall scripts before installing new packages
// run: npm pack suspicious-package && tar -xzf suspicious-package-*.tgz
// run: cat package/package.json | grep -A10 '"scripts"'

// 5. Use scoped registries for private packages
// .npmrc: @myorg:registry=https://npm.myorg.com/

// 6. Enable 2FA on npm accounts
// run: npm profile enable-2fa auth-and-writes

// 7. Use npm provenance (Node 20+) to verify build origin
// run: npm publish --provenance
// Consumers can verify: npm audit signatures
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites
**1. Silent postinstall exfiltration.** A developer runs `npm install` on their laptop. A transitive dependency's postinstall script reads `~/.npmrc` (which contains their npm auth token), `~/.aws/credentials`, and all environment variables, then POSTs them to an external server. Symptom: none visible. The attack is silent. Detection: network monitoring, `socket.dev` alerts on outbound network calls during install, or `--ignore-scripts`.

**2. Lockfile drift in production.** A deployment pipeline uses `npm install` instead of `npm ci`. The lockfile is slightly out of date. npm resolves a newer patch version of a dependency that introduces a subtle behavioral change (not a vulnerability -- just a bug). The service starts throwing intermittent errors that do not reproduce locally because developers have a different `node_modules` tree. Diagnosis: compare `npm ls` output between environments; switch to `npm ci`.

**3. Dependency confusion in monorepos.** A company uses a monorepo with Nx/Turborepo. Internal packages like `@acme/shared-utils` are linked locally during development but resolved from the registry in CI. An attacker publishes `@acme/shared-utils` on public npm with a higher version number. CI installs the attacker's version. Symptom: CI builds start behaving differently from local builds. Fix: `.npmrc` with scoped registry pinning.

**4. Audit fatigue leading to ignored real vulnerabilities.** Teams configure `npm audit` but set `--audit-level=moderate`, flooding CI with dozens of low-severity advisories in dev dependencies. Engineers start ignoring audit output entirely. When a critical advisory appears (e.g., prototype pollution in a production dependency), it is missed. Fix: separate audit configs for production vs dev dependencies (`npm audit --omit=dev`), and alert only on high/critical for production deps.
:::

## :dart: Checkpoint

::: details Question 1 -- npm ci vs npm install
**Q:** Why should CI/CD pipelines use `npm ci` instead of `npm install`, and what specific guarantee does it provide that `npm install` does not?

**A:** `npm ci` deletes `node_modules` entirely and installs exactly the dependency tree described in `package-lock.json` without modifying it. If `package.json` and `package-lock.json` are out of sync, it fails rather than silently updating the lockfile. This provides a reproducibility guarantee: every build installs byte-identical dependencies (verified by SRI integrity hashes). `npm install`, by contrast, may resolve newer versions within semver ranges, update the lockfile, and reuse parts of an existing `node_modules` -- meaning two runs at different times can produce different dependency trees.
:::

::: details Question 2 -- Dependency confusion
**Q:** Explain the dependency confusion attack. What condition makes an organization vulnerable, and what is the primary mitigation?

**A:** Dependency confusion exploits the gap between private and public registries. If an organization uses internal packages (e.g., `@company/utils`) that exist only on a private registry, an attacker can publish a package with the same name on the public npm registry, often with a higher version number. If the build system checks the public registry first or falls back to it, it installs the attacker's package. The primary mitigation is scoping private packages to the private registry in `.npmrc` (`@company:registry=https://npm.internal.company.com/`), ensuring that scope always resolves to the private registry regardless of version numbers on public npm.
:::

::: details Question 3 -- Permission model scope
**Q:** What does the Node.js `--experimental-permission` flag protect against, and what does it *not* protect against?

**A:** The permission model restricts runtime access to filesystem (read/write separately), child process spawning, worker threads, and native addons. If a malicious dependency attempts `fs.readFile('/etc/passwd')` and the process was started without `--allow-fs-read=/etc/passwd`, Node throws `ERR_ACCESS_DENIED`. However, it does **not** protect against: (1) attacks during `npm install` (postinstall scripts run in a separate process, not under the permission model); (2) CPU-based attacks like cryptomining or ReDoS (the permission model does not limit CPU or memory); (3) network access (as of Node 22, there is no `--allow-net` flag -- any code can still make outbound HTTP requests); (4) information leakage via `process.env` (environment variables are readable regardless of permission flags).
:::

## Key Mental Models

- **Your dependency tree is your attack surface.** Every transitive dependency is code you run with your privileges but did not write or review.
- **Lockfiles are tamper-evidence seals, not locks.** They record what *should* be installed and detect changes -- but only if you enforce them with `npm ci`.
- **Defense in depth, not silver bullets.** No single measure (audit, lockfile, permissions) is sufficient. Layer them: lockfile integrity + audit in CI + `--ignore-scripts` + runtime permissions + scoped registries.
- **`npm install` is for development; `npm ci` is for automation.** This is the single most impactful supply chain hygiene practice.
- **The permission model is your last wall.** It does not prevent compromise -- it limits blast radius.

## Related

- [ReDoS & Path Traversal](./02-redos-path-traversal) -- other code-level vulnerability classes
- [HTTP Hardening](./04-http-hardening) -- network-layer threats and LLM API security
- [package.json exports](/nodejs/module-01/05-package-exports) -- how the `exports` field controls module entry points
