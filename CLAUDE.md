# CLAUDE.md — Engineering Handbook Project

## What this project is

A personal **backend engineering handbook** — a self-hosted documentation site (like W3Schools in form, but deeper in substance) owned by Muhammed Suhail EA, a Senior Full Stack & AI Engineer. It is both a **learning tool** and a **public portfolio artifact**.

**The core differentiator — never violate this:** every concept is explained **twice on the same page**:

1. First in **pure plain English** (analogies, intuition, zero jargon), then
2. In **full technical depth** (engine internals, mechanics, source-level behavior).

Existing sites give reference material OR tutorials. This site gives *intuition and internals side by side*. If a page has only one of the two layers, it is incomplete and must not be marked done.

**Audience:** the owner himself (senior engineer, 5+ yrs, uses Node/NestJS/React daily, preparing for senior backend interviews) and, secondarily, other engineers who find the site. Never write down to the reader in technical sections; never use jargon in plain-English sections.

---

## Tech stack & constraints

- **VitePress** (latest stable) — do not swap for Docusaurus/Astro/Next.js. No custom SPA. Content lives in Markdown; the framework provides nav, sidebar, search, dark mode.
- **TypeScript everywhere**: the VitePress config (`config.ts`) and every code example in content. Strict mode assumed. Never write plain-JS examples unless the page is explicitly contrasting JS behavior.
- **Code examples target Node.js 22+, ESM by default.** Use `node:` prefixed core-module imports (`import { createServer } from 'node:http'`). Flag version-specific behavior inline, e.g. *(Node 15+)*, *(changed in Node 20)*.
- **Prefer Node core over npm packages in examples** (`node:http` before Express, `node:test` before Jest, native `fetch`, `node:worker_threads`) — except in the Frameworks track, where Express/NestJS are the subject.
- Local search via VitePress built-in (`search: { provider: 'local' }`). No Algolia setup.
- Deployment target: **Vercel** (primary) with GitHub Pages workflow as fallback. Include config for both.
- Package manager: **npm**. Node engine `>=22` in package.json.

---

## Repository structure

```
engineering-handbook/
├─ CLAUDE.md                       # this file
├─ package.json
├─ .gitignore
├─ vercel.json                     # SPA-safe rewrites if needed; clean URLs
├─ .github/workflows/deploy.yml    # GitHub Pages fallback deploy
├─ source-material/                # RAW input content (gitignored is fine) — see "Content pipeline"
└─ docs/
   ├─ .vitepress/
   │  ├─ config.ts                 # nav (8 tracks), sidebar per track, search, theme
   │  └─ theme/
   │     ├─ index.ts               # extends default theme
   │     └─ custom.css             # styles for custom containers + badges
   ├─ index.md                     # landing page: track map, how to use the site
   ├─ js-core/                     # Track 1
   ├─ nodejs/                      # Track 2 (module-01 ... module-10 subfolders)
   ├─ frameworks/                  # Track 3 (express/, nestjs/)
   ├─ system-design/               # Track 4 (queues/, microservices/, load-balancing/, caching/, scaling/)
   ├─ interview/                   # Track 5 (crash sheets + question bank)
   ├─ python/                      # Track 6 (dual-layer doctrine)
   ├─ rag/                         # Track 7 (AI-track doctrine)
   ├─ ai-engineering/              # Track 8 (AI-track doctrine)
   └─ ml-foundations/              # Reference track — theory, linked on demand, not in a build line
```

**File naming:** kebab-case, numeric prefixes for ordering within a module, e.g. `docs/nodejs/module-03/02-unhandled-rejections.md`. Every folder gets an `index.md` acting as the track/module overview + roadmap.

---

## THE PAGE TEMPLATE (mandatory, every content page)

Every session/topic page follows this exact structure and order. Use VitePress custom containers so the layers are visually distinct.

```md
---
title: <Concept name>
outline: deep
---

# <Concept name>

<Badges paragraph: interview weight 🔥🔥🔥 / 🔥🔥 / 🔥, Node/JS version notes, prerequisites with links>

## 🗣️ In Plain English

::: tip In Plain English
<Explanation with ZERO jargon. Use one strong real-world analogy and carry it
through. A smart person who has never used Node should follow this fully.
Short paragraphs. No code. 150–400 words.>
:::

## ⚙️ Under the Hood

<The full technical deep dive: mechanics, internals (V8 / libuv / kernel /
framework source where relevant), precise semantics, edge cases. TypeScript
code blocks, each runnable, each annotated with the command to run it
(e.g. `// run: node --experimental-strip-types demo.ts`). Tables for
comparisons. This section is allowed to be long. Never simplify to the point
of inaccuracy — if something is genuinely complicated, show the complexity
and say why it's complicated.>

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
<2–4 concrete production failure modes: symptoms as an engineer sees them
(log lines, exit codes, K8s pod states, latency graphs), root cause tying
back to the mechanism above, and how to diagnose with core tooling. Where
relevant, connect to: NestJS, GraphQL servers, Redis queues, K8s
deployments, and LLM/AI workloads (SSE streaming, backpressure, aborts).>
:::

## 🎯 Checkpoint

<2–3 probing questions at interview depth or harder. Each answer hidden
behind a <details> block:>

::: details Question 1 — <short label>
**Q:** <question>

**A:** <rigorous answer, including the mechanism, not just the conclusion>
:::

## Key Mental Models

<3–5 one-sentence takeaways, bolded lead-ins. These are what the reader
should still remember a month later.>

## Related

<Cross-links to sibling pages in other tracks covering the same territory
from a different angle (e.g. Node event loop ↔ JS Core promises page).>
```

**Container styling (custom.css):** style `tip` (In Plain English) with a calm green/neutral accent, `warning` (Where It Bites) amber. Add a small CSS badge system for interview weight used in the header paragraph.

### Writing-voice calibration (critical)

**Plain English section** — target this voice (approved sample, AbortController):

> You cannot kill a promise. Once you've asked the kitchen to cook your order, you can't reach in and physically stop the chef. What you *can* do is press a "cancel order" button at your table. That button (the **AbortController**) lights up a lamp on the chef's counter (the **AbortSignal**). A well-trained chef glances at the lamp between steps and, if it's lit, abandons the dish. A badly trained chef never looks — and cooks the whole meal for nobody. That's why cancellation in Node is called *cooperative*: the button does nothing unless the code doing the work agrees to check it. You keep the button; the worker only ever sees the lamp.

Rules: one analogy carried through, no API names except the concept being named, no code, conversational but precise. **Do not** write watered-down technical prose and call it plain English — it must be a genuinely different register.

**Under the Hood section** — assume a senior engineer. First-principles, mechanism-first ("what happens between `await` and the next line"), name the components (microtask queue, libuv threadpool, DI container), cite behavior sources ("per the Node.js process docs", "since Node 15"), and prefer *why it was designed this way* over *how to use it*.

---

## The eight tracks and their content maps

> Tracks 1–5 are the original backend tracks and follow the dual-layer page template above.
> Tracks 6–8 (Python, RAG, AI Engineering) were added later. **AI Engineering and RAG use a
> different page doctrine** — see "AI-track doctrine" below. Do not apply the dual-layer
> template to them.

Create every folder now; create stub pages (frontmatter + title + "🚧 Planned" + a 5-10 bullet roadmap of what the page will cover) for everything not yet written, so the full site shape is navigable from day one. Sidebar must show the complete tree with stubs marked.

### Track 1 — JavaScript Core (`/js-core/`)
1. Execution contexts, scopes & hoisting mechanically
2. Closures — what the heap actually keeps alive
3. Prototypes, `this` binding rules, classes as sugar
4. The event loop — browser vs Node differences
5. Promises & the microtask queue (language-level view)
6. Iterators, generators, async generators
7. Memory & GC fundamentals (V8 young/old generation)
8. ES Modules in the language (static structure, live bindings, TLA)

### Track 2 — Node.js Runtime (`/nodejs/`) — the deepest track
- **Module 1 — The Runtime:** 1.1 What Node actually is (V8+libuv+bindings, boot sequence, native TS via type stripping); 1.2 Process lifecycle, exit codes, signals, PID 1, stdio; 1.3 CJS resolution & caching & circular deps; 1.4 ESM, interop, `require(esm)`; 1.5 package.json `exports`, dual-package hazard. Exercise: mini `require()`.
- **Module 2 — The Event Loop:** 2.1 libuv phases (timers → pending → idle/prepare → poll → check → close); 2.2 `process.nextTick` vs `queueMicrotask` vs `setImmediate`, starvation; 2.3 blocking the loop + `monitorEventLoopDelay`; 2.4 the libuv threadpool (fs, dns.lookup, crypto, zlib; `UV_THREADPOOL_SIZE`). Exercise: ordering puzzles + loop-lag instrumentation.
- **Module 3 — Async Patterns & Error Semantics:** 3.1 Promise internals & combinators; 3.2 Unhandled rejections (Node 15+ crash default, the parallel-start/sequential-await trap); 3.3 AbortController/AbortSignal (`timeout`, `any`, listener hygiene); 3.4 Async iteration vs EventEmitter (push vs pull, `'error'` magic, sync `emit`, async-listener trap); 3.5 AsyncLocalStorage & async_hooks (mechanism, where context breaks, `AsyncResource.bind`); 3.6 Error doctrine (operational vs programmer, crash-on-bug). Exercise: request-scoped correlation-ID system.
- **Module 4 — Buffers, Streams, Backpressure:** Buffer/TypedArray & encodings; four stream classes, highWaterMark, backpressure propagation; `pipeline()` vs `.pipe()`; object mode; Web Streams vs Node streams; SSE/LLM token streaming with disconnect cleanup. Exercise: 5GB CSV→JSONL constant-memory transformer + SSE token streamer.
- **Module 5 — Networking & HTTP Internals:** TCP in `node:net`; what `http` adds; keep-alive & pooling (undici architecture, native fetch behavior); timeouts at every layer; slowloris; HTTP/2, TLS; WebSockets from the upgrade handshake. Exercise: HTTP/1.1 server on raw TCP + tiny reverse proxy.
- **Module 6 — Performance & Diagnostics:** `--cpu-prof` & flame graphs; heap snapshots & leak hunting; GC behavior & latency; event loop utilization as SLO; worker_threads vs cluster vs pods; SharedArrayBuffer/Atomics; honest benchmarking. Exercise: diagnose a deliberately broken service.
- **Module 7 — FS, Child Processes, OS Boundary:** fs API families & watchers; spawn/exec/execFile/fork, stdio wiring, IPC; graceful shutdown done fully (K8s SIGTERM/preStop, draining); executables & SEA. Exercise: process supervisor with backoff + rolling shutdown.
- **Module 8 — Security & Hardening:** prototype pollution; ReDoS; path traversal; unsafe deserialization; vm-module myths; supply chain & lockfiles; permission model; HTTP hardening (header/body limits, decompression bombs); threat-modeling an LLM-facing API (SSRF from tool-calling agents). Exercise: find 8 planted vulns.
- **Module 9 — Testing, Observability, Debugging:** `node:test`, ESM mocking, coverage; pino structured logging; OpenTelemetry (how auto-instrumentation hooks tie to async_hooks); metrics that matter (ELU, heap, handles); `--inspect` on live processes, heapdumps, diagnostic reports. Exercise: instrument Module 6's service.
- **Module 10 — Capstones:** minimal web framework; Redis-backed job queue (BullMQ-lite); production-grade LLM gateway (streaming proxy, backpressure, coalescing, token-bucket limits, end-to-end aborts, OTel).

Each Node module folder ends with a `summary.md`: mental models gained + self-assessment checklist.

### Track 3 — Frameworks (`/frameworks/`)
- **express/**: what `app.use` builds (the middleware stack), the chain as sequential dispatch, router matching, error-middleware mechanics (4-arity), why Express 4 struggles with async errors (and Express 5 changes), req/res as decorated streams.
- **nestjs/**: DI container & `reflect-metadata` (why `emitDecoratorMetadata`, constructor param types), module graph resolution, full request lifecycle (middleware → guards → interceptors(pre) → pipes → handler → interceptors(post) → filters), provider scopes (default/request/transient) and their cost, CLS vs request-scoped providers (ties to Node 3.5), microservices transports overview.
- Teach every framework topic as **"what does this abstract from Node core"**, cross-linking to Track 2.

### Track 4 — System Design (`/system-design/`)
- **queues/**: why queues exist (coupling, spikes, retries); Redis-backed queues & BullMQ architecture; Kafka concepts vs simple queues; delivery semantics (at-most/at-least/exactly-once — and why exactly-once is mostly a lie); idempotency keys; outbox pattern; DLQs; backoff & poison messages.
- **microservices/**: monolith-first doctrine; sync (REST/gRPC) vs async communication; sagas & distributed transactions; API gateway & BFF; service discovery; distributed failure modes (partial failure, timeouts as contracts, circuit breakers, bulkheads).
- **load-balancing/**: L4 vs L7; algorithms (RR, least-conn, hashing); nginx as reverse proxy — real config examples; TLS termination; sticky sessions vs stateless; health checks; **nginx buffering vs SSE/streaming (proxy_buffering off) — must-cover given LLM streaming**; keep-alive between nginx and Node upstreams.
- **caching/**: cache-aside vs write-through; TTLs & stampede protection (jitter, single-flight); Redis data structures for caching; CDN vs app cache; invalidation strategies.
- **scaling/**: vertical vs horizontal; stateless services; K8s HPA basics; rate limiting algorithms (token bucket, sliding window) with a Node/Redis implementation; graceful degradation.
- Every system-design page gets a **"Design It" mini-scenario** at the end instead of / in addition to Checkpoint: a prompt like "design a webhook delivery system" with a collapsible worked solution.

### Track 5 — Interview Prep (`/interview/`)
- `crash-sheet-node.md`, `crash-sheet-js.md`, `crash-sheet-system-design.md`: Tier-1/2/3 rapid-review bullets, each bullet linking to its full page.
- `question-bank.md`: auto-compiled list of every Checkpoint question across the site, grouped by track, linking back (maintain manually; keep in sync when adding pages).
- `design-walkthroughs/`: rate limiter, job queue, LLM gateway, webhook system — full worked designs.

### Track 6 — Python (`/python/`)
12 modules: language foundations, data structures, concurrency, type hints, CPython internals, FastAPI. Follows the dual-layer template (Tracks 1–5 doctrine).

### Track 7 — Production RAG (`/rag/`)
18 modules, ingestion through operations, plus 10 case studies in Module 18. Uses the **AI-track doctrine** below. This track is the reference implementation of a finished track: it is the only one with the full support set (`index.md`, `questions.md`, `crash-sheet.md`, `interview-framework.md`). Match it.

### Track 8 — AI Engineering (`/ai-engineering/`)
The main build line: mental models → prompting → agents → application layer → RAG bridge → evaluation → observability → security → architecture → serving → fine-tuning → infrastructure → case studies → strategy. Uses the **AI-track doctrine** below.

Pure ML/math theory does **not** live here — it lives in `/ml-foundations/` and is linked on demand. If a page teaches gradient descent or backprop as its subject, it is in the wrong track.

---

## AI-track doctrine (applies to `/rag/` and `/ai-engineering/` only)

These tracks deliberately **do not** use the dual-layer template. The reasoning: Node internals reward source-level depth because the mechanism is stable for years, whereas AI engineering knowledge goes stale in months. What outlives it is intuition, decision frameworks, and trade-off judgment. A second "Under the Hood" layer here would mostly document APIs that change.

**The rule: plain English carried all the way through, grounded in worked examples.** Not a technical reference. Not a watered-down explainer either — the reasoning must be rigorous, only the register is conversational.

### Page template

```md
---
title: <Concept name>
outline: deep
---

# <Concept name>

<One-paragraph story hook. For /ai-engineering/, continue the TaskFlow narrative —
the running example is TaskFlow's customer support agent. Each page opens with the
problem TaskFlow hit that makes this concept necessary.>

::: tip Plain English
<The concept with zero jargon, one analogy carried through. 150–400 words.>
:::

## <Mechanism sections — 2–4 of them>

<How it actually works. Tables for comparisons, ASCII diagrams for flows, TypeScript
for code. Examples are concrete and TaskFlow-anchored, never abstract.>

::: warning Watch out
<1–3 real failure modes: the symptom as an engineer sees it, the cause, the fix.
Describe these as typical patterns — never fabricate specific incidents or numbers.>
:::

::: details Interview Question — <short label>
**Q:** <question>

**A:** <rigorous answer giving the mechanism, not just the conclusion>
:::

## Key Mental Models

<3–5 one-sentence takeaways, bolded lead-ins.>

## Related

<Cross-links, including to /ml-foundations/ for theory and /rag/ for retrieval.>
```

### Depth targets

| Element | Target |
|---|---|
| Words per content page | 1,600–2,200 |
| Plain English block | exactly 1, mandatory, never omitted |
| Watch out block | ≥1 |
| Interview questions | **≥2** per page |
| Visual anchor (table or diagram) | ≥1 |

### Hard rules

- **Every page has a Plain English block.** A page without one is incomplete regardless of length. (Known violations to fix: `module-00/01-how-transformers-work.md`, `module-00/04-rlhf.md`.)
- **One topic, one home.** If a concept gets a full treatment in two modules, one of them is wrong. Merge toward the stronger page and delete the other.
- **Narrative continuity.** Every main-line AI Engineering module advances the TaskFlow story, or is explicitly marked as a reference module in its index.
- Never invent benchmarks, costs, or incidents. Model prices and context limits go stale — state them as illustrative, not authoritative.
- Theory is linked, not inlined. Send readers to `/ml-foundations/`.

---

## Content pipeline & source material

- The folder `source-material/` may contain raw drafts (Markdown exported from the owner's mentoring chats — currently: Node sessions 1.1, 1.2, and a complete Module 3 document written in technical-only format). **When a source file exists for a page: preserve its technical content faithfully** (it is already at the right depth) — restructure it into the page template and **author the missing 🗣️ In Plain English and 🎯 answer-reveal sections fresh**.
- When no source exists, author the page from scratch following the template and voice rules. Accuracy bar: if unsure about a version-specific Node behavior, check the official Node.js docs rather than guessing, and flag the version inline.
- Never invent fake benchmarks, fake quotes, or fake incident numbers. War stories in 💥 sections should be described as typical failure patterns, not fabricated specific events.

---

## Build phases (work in this order)

**Phase 1 — Skeleton (do first, completely):**
1. Scaffold VitePress with TS config; wire nav (5 tracks) + full sidebars including stubs; custom containers CSS; landing page (`index.md`) explaining the dual-format concept and mapping the tracks; deploy configs (Vercel + GH Pages workflow); README with local dev instructions.
2. `npm run docs:dev` must work; `npm run docs:build` must pass with zero dead links (enable VitePress dead-link checking; do not use `ignoreDeadLinks: true`).

**Phase 2 — Seed content:**
3. Build all pages that have source material (Node 1.1, 1.2, Module 3's six pages) in full template form, plus Module 1 and Module 3 `summary.md`.
4. Build the three crash sheets in skeleton form (Tier headings + bullets for existing content only).

**Phase 3 — Stubs everywhere else:** every remaining page as a roadmap stub (see stub definition above). The site must look intentional, not empty — stubs carry real roadmaps.

**Phase 4+ (ongoing, on request):** fill tracks in this priority order unless told otherwise: Node Module 2 → JS Core 4–5 (event loop/promises) → System Design (queues, load-balancing) → Frameworks → remaining.

## Definition of done (per content page)

- [ ] All template sections present and in order; Plain English section passes the "no jargon" test
- [ ] Every code block: TypeScript, strict-mode-valid, ESM, `node:` imports, run command comment, actually runs on Node 22
- [ ] Version-specific claims flagged inline
- [ ] At least 2 checkpoint questions with rigorous hidden answers
- [ ] Cross-links in Related section resolve (build passes dead-link check)
- [ ] Sidebar entry updated; crash sheet + question bank updated if page is non-stub

## Things NOT to do

- Do not add a component framework, custom Vue pages, or interactive playgrounds in early phases — content first. (Interactive event-loop visualizers are a Phase 5 idea, only on explicit request.)
- Do not use Jest, CommonJS `require` in examples (outside CJS-topic pages), or JavaScript-only snippets.
- Do not compress the two explanation layers into one "medium" explanation. Ever.
- Do not mark stub pages as complete in the sidebar or crash sheets.
- Do not `ignoreDeadLinks` to make builds pass — fix the links.

## Commands

```bash
npm run docs:dev      # local dev server
npm run docs:build    # production build (must pass clean)
npm run docs:preview  # preview the build
```
