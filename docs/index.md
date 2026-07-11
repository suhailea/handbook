---
layout: home

hero:
  name: Engineering Handbook
  text: Backend Engineering, Explained Twice
  tagline: Every concept in plain English first, then full technical depth. Built for senior engineers who want intuition and internals side by side.
  actions:
    - theme: brand
      text: Start with JS Core
      link: /js-core/
    - theme: alt
      text: Jump to Node.js
      link: /nodejs/

features:
  - title: JavaScript Core
    details: Execution contexts, closures, prototypes, the event loop, promises, generators, memory & GC, and ES Modules.
    link: /js-core/
  - title: Node.js Runtime
    details: 10 deep-dive modules — from boot sequence and event loop internals to streams, networking, security, and capstone projects.
    link: /nodejs/
  - title: Frameworks
    details: Express and NestJS — what they abstract from Node core, and how they work under the hood.
    link: /frameworks/
  - title: System Design
    details: Queues, microservices, load balancing, caching, and scaling patterns with real implementations.
    link: /system-design/
  - title: Interview Prep
    details: Crash sheets, a full question bank, and worked design walkthroughs.
    link: /interview/
---

## How This Site Works

Every topic page has **two explanation layers**:

1. **In Plain English** — a real-world analogy with zero jargon. A smart person who has never written code should follow this section fully.
2. **Under the Hood** — the full technical deep dive: internals, mechanics, edge cases, runnable TypeScript examples.

Below those, you'll find **Where It Bites** (production failure modes) and **Checkpoint** (interview-depth questions with hidden answers).

This is not a reference manual and not a beginner tutorial. It's a handbook that gives you both *intuition* and *internals* on the same page.

## The Five Tracks

| Track | Focus | Pages |
|-------|-------|-------|
| [JavaScript Core](/js-core/) | The language itself — scopes, closures, prototypes, event loop, promises, memory | 8 |
| [Node.js Runtime](/nodejs/) | 10 modules covering the runtime end-to-end, from process lifecycle to capstone projects | 50+ |
| [Frameworks](/frameworks/) | Express middleware mechanics, NestJS DI & request lifecycle | 6 |
| [System Design](/system-design/) | Queues, microservices, load balancing, caching, scaling | 14 |
| [Interview Prep](/interview/) | Crash sheets, question bank, design walkthroughs | 8 |
