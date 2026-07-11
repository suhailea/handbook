---
title: "Executables & Single Executable Apps"
outline: deep
---

# Executables & Single Executable Apps

**Interview weight:** 🔥 | **Node 22+** | Prerequisites: [What Node Actually Is](/nodejs/module-01/01-what-node-is), [FS API](./01-fs-api)

## 🗣️ In Plain English

::: tip In Plain English
Normally when you write a Node.js program, you need two things to run it: the Node runtime (a 70+ MB binary) and your JavaScript files. It is like writing a letter — you need both the letter and a postal worker to deliver it. The letter cannot deliver itself.

**Single Executable Applications (SEA)** change this. They take your letter, stuff it inside the postal worker's uniform, and create a self-delivering letter. The result is a single binary file that contains both the Node runtime and your application code. Double-click it (or run it from the command line), and it just works — no Node installation required.

Think of it like the difference between a recipe (your .js files) and a frozen meal (the SEA binary). The recipe requires a kitchen and a cook. The frozen meal just needs a microwave — all the cooking has already been done and packaged together.

There are other ways to achieve something similar. **Docker** wraps your entire kitchen — the cook, the ingredients, the oven — into a shipping container. It is heavier but gives you total control over the environment. SEA is lighter: just the finished dish, sealed and ready.

**npm bin scripts** are a different concept entirely. They do not bundle Node — they just make your script callable by name (like `eslint` or `tsc`) when installed as a package. They still need Node installed on the machine.

SEA is best for CLI tools, internal utilities, and edge cases where you need to distribute a Node program to machines that do not (and should not) have Node installed. For web servers, Docker is still king — you get networking, environment variables, multi-stage builds, and orchestration that a single binary cannot provide.
:::

## ⚙️ Under the Hood

### How SEA Works (Node 20+, Stable in Node 22)

The SEA feature embeds your application's JavaScript (or a V8 code cache / snapshot blob) into a copy of the Node binary itself. At startup, the modified binary detects the embedded resource and runs it instead of looking for a script argument.

The process has four steps:

#### Step 1: Prepare Your Application as a Single File

SEA embeds **one file**. If your app has multiple modules, you must bundle them first:

```typescript
// greeter.ts — a simple CLI tool
// run: (this file gets bundled and embedded — see steps below)

const name = process.argv[2] || 'World';
console.log(`Hello, ${name}!`);
console.log(`Node version: ${process.version}`);
console.log(`Platform: ${process.platform}-${process.arch}`);
```

For multi-file projects, bundle with esbuild:

```bash
npx esbuild src/cli.ts --bundle --platform=node --format=esm --outfile=dist/cli.js
```

#### Step 2: Create the SEA Configuration

```json
// sea-config.json
{
  "main": "greeter.js",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true,
  "useSnapshot": false,
  "useCodeCache": true
}
```

| Field | Purpose |
|---|---|
| `main` | Entry point JS file (must be CJS or bundled ESM — raw ESM with `import` is not supported in SEA as of Node 22) |
| `output` | The blob file that will be injected into the binary |
| `disableExperimentalSEAWarning` | Suppress the startup warning |
| `useSnapshot` | If `true`, create a V8 startup snapshot for faster boot (advanced, has restrictions) |
| `useCodeCache` | If `true`, include V8 code cache for faster compilation at startup |

#### Step 3: Generate the Blob and Inject

```bash
# Generate the preparation blob
node --experimental-sea-config sea-config.json

# Copy the Node binary (do not modify the original!)
cp $(which node) my-greeter         # macOS/Linux
# copy node.exe my-greeter.exe      # Windows

# Inject the blob into the copied binary

# macOS: remove the code signature first, then re-sign after injection
codesign --remove-signature my-greeter
npx postject my-greeter NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 \
  --macho-segment-name NODE_SEA
codesign --sign - my-greeter

# Linux:
# npx postject my-greeter NODE_SEA_BLOB sea-prep.blob \
#   --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# Run it — no node command needed!
./my-greeter Claude
# Output: Hello, Claude!
```

#### Step 4: Understanding the Fuse

The `sentinel-fuse` is a magic string embedded in the Node binary. Before injection, the fuse value is `0` (untriggered). `postject` flips it to `1`, telling Node at startup: "there is embedded application code — run it instead of looking for a CLI argument." This is a one-way operation; you cannot un-inject.

### V8 Startup Snapshot

With `"useSnapshot": true`, the SEA config instructs Node to run your `main` script during build, capture the V8 heap state, and embed that snapshot. At runtime, V8 deserializes the snapshot instead of parsing and compiling the script — **near-instant startup**.

Restrictions on snapshot code:
- Cannot use `require()` or `import` at the top level for native addons
- Cannot hold open handles (timers, sockets) during snapshot creation
- Must call `v8.startupSnapshot.setDeserializeMainFunction()` to define the entry point at run time

```typescript
// snapshot-app.ts — using the snapshot API
import v8 from 'node:v8';

// This code runs at BUILD time (snapshot creation)
const config = { greeting: 'Hello from snapshot' };

// This function runs at RUN time (after deserialization)
v8.startupSnapshot.setDeserializeMainFunction(() => {
  console.log(config.greeting);
  console.log(`Deserialized at: ${new Date().toISOString()}`);
});
```

### npm bin Scripts and Shebangs

This is the traditional way to make Node scripts executable — no bundling required, but Node must be installed:

```json
// package.json
{
  "name": "my-tool",
  "version": "1.0.0",
  "bin": {
    "my-tool": "./dist/cli.js"
  }
}
```

```typescript
#!/usr/bin/env node
// dist/cli.js — the shebang line tells the OS to use node to run this file

console.log('Hello from my-tool!');
```

```bash
# After npm install -g my-tool (or npx my-tool):
my-tool
# Output: Hello from my-tool!

# The shebang mechanism (Unix):
# 1. OS reads first two bytes: #!
# 2. Uses /usr/bin/env to find `node` in $PATH
# 3. Executes: node ./dist/cli.js
```

### pkg and Historical Alternatives

Before SEA, the community used third-party bundlers:

| Tool | Status | Approach |
|---|---|---|
| **pkg** (Vercel) | Deprecated (2023) | Bundled Node + app + assets into a binary using a patched Node |
| **nexe** | Maintained | Compiles Node from source with app embedded |
| **bun build --compile** | Active | Bun's native single-binary feature (not Node, but worth knowing) |
| **Node SEA** | Official, stable (Node 22) | The blessed path forward |

### When SEA vs Docker

| Criterion | SEA | Docker |
|---|---|---|
| **Distribution** | Single binary, copy anywhere | Image registry, docker pull |
| **Dependencies** | Self-contained (Node only) | Full OS, system libs, Node |
| **Binary size** | ~70-100 MB (includes Node) | ~150-500 MB (depending on base image) |
| **Startup time** | Instant (especially with snapshots) | Seconds (container init, overlay fs) |
| **Native addons** | Must be compiled for target platform | Handled at image build time |
| **Networking / env** | Process-level, manual | Docker/K8s provides networking, env, volumes |
| **Best for** | CLI tools, lambdas, edge functions, scripts for non-dev machines | Web servers, microservices, anything in K8s |

### Cross-Compilation Caveat

SEA does **not** support cross-compilation. The generated binary runs on the same OS and architecture where it was built. To create binaries for Linux x64, macOS ARM64, and Windows x64, you need to run the build process on each platform (or use CI with platform-specific runners).

```yaml
# GitHub Actions example — build SEA for multiple platforms
# .github/workflows/build-sea.yml
name: Build SEA
on: [push]
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node --experimental-sea-config sea-config.json
      # Platform-specific injection steps...
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. ESM import/export does not work in SEA main.**
Symptom: your SEA binary crashes with `SyntaxError: Cannot use import statement` or silently fails. As of Node 22, SEA requires the embedded script to be CommonJS or a pre-bundled file that does not use bare `import`/`export` at runtime. Fix: bundle your ESM source into a single CJS file using esbuild or rollup before creating the SEA blob. Use `--format=cjs --bundle --platform=node`.

**2. Native addons (`.node` files) are not embedded.**
Symptom: SEA binary works on the build machine but fails on the target with `Error: Cannot find module './binding.node'`. Native addons are platform-specific compiled C++ — they are not included in the SEA blob. Fix: either avoid native addons (use pure-JS alternatives like `better-sqlite3` → `sql.js`), or ship the `.node` file alongside the binary and use a runtime path resolution strategy.

**3. Binary size surprises.**
Symptom: your 50-line CLI tool produces a 90 MB binary. The SEA binary includes the entire Node runtime. This is inherent to the approach — there is no tree-shaking of Node internals. For simple tools, consider whether a shell script or a Bun-compiled binary (Bun's runtime is ~40 MB) might be more appropriate.

**4. `__dirname` and `__filename` do not point to the filesystem.**
Symptom: `fs.readFileSync(__dirname + '/config.json')` fails in the SEA binary because `__dirname` refers to a virtual path inside the binary, not a real filesystem directory. Fix: use `process.execPath` to find the binary's location and resolve relative paths from there, or embed configuration data directly in the bundled script.
:::

## 🎯 Checkpoint

::: details Question 1 — SEA build pipeline
**Q:** Describe the four-step process to create a Node.js Single Executable Application from a TypeScript source file. What role does the "fuse" play?

**A:** (1) **Bundle** the TypeScript into a single JavaScript file using a bundler like esbuild (`--bundle --platform=node --format=cjs`). SEA embeds exactly one file. (2) **Generate the blob** by running `node --experimental-sea-config sea-config.json`, which compiles the script (and optionally creates a V8 code cache or startup snapshot) into a binary blob. (3) **Copy the Node binary** to a new file (never modify the original). (4) **Inject the blob** using `postject`, which writes the blob into a designated section of the copied binary and flips the **sentinel fuse** — a magic string embedded in every Node binary. At startup, Node checks whether the fuse has been flipped from `0` to `1`. If it has, Node reads the embedded blob and executes it instead of parsing command-line arguments for a script path. The fuse is a one-way mechanism: once flipped, the binary always runs the embedded code.
:::

::: details Question 2 — SEA vs Docker tradeoffs
**Q:** Your team maintains an internal CLI tool written in Node that is used by 200 non-developer employees (marketing, ops). The tool is currently distributed as a Docker image that they run via `docker run`. A colleague suggests switching to SEA. Evaluate this proposal.

**A:** **SEA is likely the better fit here.** Non-developers should not need Docker installed — it requires understanding of containers, volumes, and networking. A single binary (SEA) is download-and-run: copy the file, make it executable (`chmod +x`), run it. No Docker daemon, no image pulls, no container lifecycle. The tradeoffs to consider: (1) SEA produces ~90 MB binaries, which is comparable to a slim Docker image but must be distributed per-platform (macOS ARM, macOS x64, Windows, Linux). The CI pipeline needs matrix builds for each target OS. (2) If the tool uses native addons, those must be compiled on each target platform and shipped alongside the binary — Docker handles this more cleanly at build time. (3) If the tool needs environment isolation (specific system libraries, filesystem layout), Docker is better. For a typical CLI tool that reads files and calls APIs, SEA is simpler for end users despite the multi-platform build complexity for developers.
:::

## Key Mental Models

- **SEA = Node binary + your code fused into one file.** It solves distribution, not execution — the runtime is still Node, just embedded.
- **Bundle first, embed second.** SEA takes one file. Multi-module projects must be bundled into a single script before blob generation.
- **The fuse is a one-way switch.** Once the blob is injected, the binary always runs the embedded code. There is no "un-inject."
- **SEA is for CLI tools and utilities; Docker is for servers.** SEA cannot replicate Docker's networking, orchestration, and environment management.
- **Cross-compilation is not supported.** Build on each target platform, or use CI matrix builds.

## Related

- [FS API Families](./01-fs-api) — understanding file operations that SEA binaries interact with differently
- [What Node Actually Is](/nodejs/module-01/01-what-node-is) — the V8 + libuv architecture that gets embedded in SEA binaries
