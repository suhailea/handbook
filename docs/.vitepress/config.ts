import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Engineering Handbook',
  description: 'Backend engineering explained twice — plain English first, then full technical depth.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  base: process.env.GITHUB_ACTIONS ? '/engineering-handbook/' : '/',

  head: [
    ['meta', { name: 'theme-color', content: '#42b883' }],
  ],

  themeConfig: {
    search: {
      provider: 'local',
    },

    nav: [
      { text: 'Home', link: '/' },
      { text: 'JS Core', link: '/js-core/', activeMatch: '/js-core/' },
      { text: 'Node.js', link: '/nodejs/', activeMatch: '/nodejs/' },
      { text: 'Frameworks', link: '/frameworks/', activeMatch: '/frameworks/' },
      { text: 'System Design', link: '/system-design/', activeMatch: '/system-design/' },
      { text: 'Interview Prep', link: '/interview/', activeMatch: '/interview/' },
    ],

    sidebar: {
      // ── Track 1: JavaScript Core ──
      '/js-core/': [
        {
          text: 'JavaScript Core',
          items: [
            { text: 'Overview', link: '/js-core/' },
            { text: '1. Execution Contexts, Scopes & Hoisting', link: '/js-core/01-execution-contexts' },
            { text: '2. Closures', link: '/js-core/02-closures' },
            { text: '3. Prototypes, this & Classes', link: '/js-core/03-prototypes-this-classes' },
            { text: '4. The Event Loop', link: '/js-core/04-event-loop' },
            { text: '5. Promises & Microtasks', link: '/js-core/05-promises-microtasks' },
            { text: '6. Iterators & Generators', link: '/js-core/06-iterators-generators' },
            { text: '7. Memory & GC (V8)', link: '/js-core/07-memory-gc' },
            { text: '8. ES Modules', link: '/js-core/08-es-modules' },
          ],
        },
      ],

      // ── Track 2: Node.js Runtime ──
      '/nodejs/': [
        {
          text: 'Node.js Runtime',
          items: [{ text: 'Overview', link: '/nodejs/' }],
        },
        {
          text: 'Module 1 — The Runtime',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/nodejs/module-01/' },
            { text: '1.1 What Node Actually Is', link: '/nodejs/module-01/01-what-node-is' },
            { text: '1.2 Process Lifecycle', link: '/nodejs/module-01/02-process-lifecycle' },
            { text: '1.3 CJS Resolution', link: '/nodejs/module-01/03-cjs-resolution' },
            { text: '1.4 ESM & Interop', link: '/nodejs/module-01/04-esm-interop' },
            { text: '1.5 package.json exports', link: '/nodejs/module-01/05-package-exports' },
            { text: 'Summary', link: '/nodejs/module-01/summary' },
          ],
        },
        {
          text: 'Module 2 — The Event Loop',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-02/' },
            { text: '2.1 libuv Phases', link: '/nodejs/module-02/01-libuv-phases' },
            { text: '2.2 nextTick vs queueMicrotask', link: '/nodejs/module-02/02-nexttick-vs-queuemicrotask' },
            { text: '2.3 Blocking the Loop', link: '/nodejs/module-02/03-blocking-the-loop' },
            { text: '2.4 The libuv Threadpool', link: '/nodejs/module-02/04-threadpool' },
            { text: 'Summary', link: '/nodejs/module-02/summary' },
          ],
        },
        {
          text: 'Module 3 — Async Patterns & Errors',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-03/' },
            { text: '3.1 Promise Internals', link: '/nodejs/module-03/01-promise-internals' },
            { text: '3.2 Unhandled Rejections', link: '/nodejs/module-03/02-unhandled-rejections' },
            { text: '3.3 AbortController', link: '/nodejs/module-03/03-abort-controller' },
            { text: '3.4 Async Iteration vs EventEmitter', link: '/nodejs/module-03/04-async-iteration-vs-eventemitter' },
            { text: '3.5 AsyncLocalStorage', link: '/nodejs/module-03/05-async-local-storage' },
            { text: '3.6 Error Doctrine', link: '/nodejs/module-03/06-error-doctrine' },
            { text: 'Summary', link: '/nodejs/module-03/summary' },
          ],
        },
        {
          text: 'Module 4 — Streams & Backpressure',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-04/' },
            { text: '4.1 Buffers & TypedArrays', link: '/nodejs/module-04/01-buffers-typed-arrays' },
            { text: '4.2 Streams & Backpressure', link: '/nodejs/module-04/02-streams-backpressure' },
            { text: '4.3 Web Streams vs Node Streams', link: '/nodejs/module-04/03-web-streams' },
            { text: '4.4 SSE & LLM Streaming', link: '/nodejs/module-04/04-sse-streaming' },
            { text: 'Summary', link: '/nodejs/module-04/summary' },
          ],
        },
        {
          text: 'Module 5 — Networking & HTTP',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-05/' },
            { text: '5.1 TCP with node:net', link: '/nodejs/module-05/01-tcp-net' },
            { text: '5.2 HTTP, Keep-Alive & Pooling', link: '/nodejs/module-05/02-http-keep-alive' },
            { text: '5.3 Timeouts & Slowloris', link: '/nodejs/module-05/03-timeouts-slowloris' },
            { text: '5.4 HTTP/2, TLS & WebSockets', link: '/nodejs/module-05/04-http2-tls-websockets' },
            { text: 'Summary', link: '/nodejs/module-05/summary' },
          ],
        },
        {
          text: 'Module 6 — Performance & Diagnostics',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-06/' },
            { text: '6.1 CPU Profiling & Flame Graphs', link: '/nodejs/module-06/01-cpu-profiling' },
            { text: '6.2 Heap Snapshots', link: '/nodejs/module-06/02-heap-snapshots' },
            { text: '6.3 GC Behavior & Latency', link: '/nodejs/module-06/03-gc-latency' },
            { text: '6.4 Workers vs Cluster vs Pods', link: '/nodejs/module-06/04-workers-cluster' },
            { text: 'Summary', link: '/nodejs/module-06/summary' },
          ],
        },
        {
          text: 'Module 7 — FS, Processes & OS',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-07/' },
            { text: '7.1 FS API Families', link: '/nodejs/module-07/01-fs-api' },
            { text: '7.2 Child Processes & IPC', link: '/nodejs/module-07/02-child-processes' },
            { text: '7.3 Graceful Shutdown', link: '/nodejs/module-07/03-graceful-shutdown' },
            { text: '7.4 Executables & SEA', link: '/nodejs/module-07/04-executables-sea' },
            { text: 'Summary', link: '/nodejs/module-07/summary' },
          ],
        },
        {
          text: 'Module 8 — Security & Hardening',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-08/' },
            { text: '8.1 Prototype Pollution', link: '/nodejs/module-08/01-prototype-pollution' },
            { text: '8.2 ReDoS & Path Traversal', link: '/nodejs/module-08/02-redos-path-traversal' },
            { text: '8.3 Supply Chain & Lockfiles', link: '/nodejs/module-08/03-supply-chain' },
            { text: '8.4 HTTP Hardening & LLM Threats', link: '/nodejs/module-08/04-http-hardening' },
            { text: 'Summary', link: '/nodejs/module-08/summary' },
          ],
        },
        {
          text: 'Module 9 — Testing & Observability',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-09/' },
            { text: '9.1 node:test & Coverage', link: '/nodejs/module-09/01-node-test' },
            { text: '9.2 Structured Logging', link: '/nodejs/module-09/02-structured-logging' },
            { text: '9.3 OpenTelemetry', link: '/nodejs/module-09/03-opentelemetry' },
            { text: '9.4 Debugging & Diagnostics', link: '/nodejs/module-09/04-debugging' },
            { text: 'Summary', link: '/nodejs/module-09/summary' },
          ],
        },
        {
          text: 'Module 10 — Capstones',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-10/' },
            { text: '10.1 Minimal Web Framework', link: '/nodejs/module-10/01-mini-framework' },
            { text: '10.2 Redis-Backed Job Queue', link: '/nodejs/module-10/02-job-queue' },
            { text: '10.3 Production LLM Gateway', link: '/nodejs/module-10/03-llm-gateway' },
            { text: 'Summary', link: '/nodejs/module-10/summary' },
          ],
        },
        {
          text: 'Module 11 — Database Patterns',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-11/' },
            { text: '11.1 Connection Pooling', link: '/nodejs/module-11/01-connection-pooling' },
            { text: '11.2 ORMs & Query Builders', link: '/nodejs/module-11/02-orms-query-builders' },
            { text: '11.3 Transactions', link: '/nodejs/module-11/03-transactions' },
            { text: '11.4 Migrations', link: '/nodejs/module-11/04-migrations' },
            { text: '11.5 Query Optimization & N+1', link: '/nodejs/module-11/05-query-optimization' },
            { text: 'Summary', link: '/nodejs/module-11/summary' },
          ],
        },
        {
          text: 'Module 12 — Auth & Security',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-12/' },
            { text: '12.1 JWT & Token Rotation', link: '/nodejs/module-12/01-jwt-tokens' },
            { text: '12.2 OAuth 2.0 & Social Login', link: '/nodejs/module-12/02-oauth' },
            { text: '12.3 Sessions & Cookies', link: '/nodejs/module-12/03-sessions' },
            { text: '12.4 RBAC & Authorization', link: '/nodejs/module-12/04-rbac-authorization' },
            { text: 'Summary', link: '/nodejs/module-12/summary' },
          ],
        },
        {
          text: 'Module 13 — API Design Patterns',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-13/' },
            { text: '13.1 REST Best Practices', link: '/nodejs/module-13/01-rest-best-practices' },
            { text: '13.2 Versioning & Pagination', link: '/nodejs/module-13/02-versioning-pagination' },
            { text: '13.3 Validation & Error Handling', link: '/nodejs/module-13/03-validation-error-handling' },
            { text: '13.4 GraphQL vs REST', link: '/nodejs/module-13/04-graphql-vs-rest' },
            { text: '13.5 File Uploads & Presigned URLs', link: '/nodejs/module-13/05-file-uploads' },
            { text: 'Summary', link: '/nodejs/module-13/summary' },
          ],
        },
        {
          text: 'Module 14 — Real-World Middleware',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-14/' },
            { text: '14.1 Request Validation (Zod)', link: '/nodejs/module-14/01-request-validation' },
            { text: '14.2 CORS, Compression & Security', link: '/nodejs/module-14/02-cors-compression-security' },
            { text: '14.3 Rate Limiting Middleware', link: '/nodejs/module-14/03-rate-limiting-middleware' },
            { text: '14.4 Request Context & Tracing', link: '/nodejs/module-14/04-request-context' },
            { text: 'Summary', link: '/nodejs/module-14/summary' },
          ],
        },
        {
          text: 'Module 15 — WebSockets & Real-Time',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-15/' },
            { text: '15.1 WebSocket Fundamentals', link: '/nodejs/module-15/01-websocket-fundamentals' },
            { text: '15.2 Socket.IO & Rooms', link: '/nodejs/module-15/02-socketio-rooms' },
            { text: '15.3 Real-Time Patterns', link: '/nodejs/module-15/03-realtime-patterns' },
            { text: '15.4 Scaling WebSockets', link: '/nodejs/module-15/04-scaling-websockets' },
            { text: 'Summary', link: '/nodejs/module-15/summary' },
          ],
        },
        {
          text: 'Module 16 — Cron Jobs & Scheduling',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-16/' },
            { text: '16.1 Scheduling Fundamentals', link: '/nodejs/module-16/01-scheduling-fundamentals' },
            { text: '16.2 Distributed Scheduling', link: '/nodejs/module-16/02-distributed-scheduling' },
            { text: '16.3 Email, Storage & External APIs', link: '/nodejs/module-16/03-email-external-services' },
            { text: 'Summary', link: '/nodejs/module-16/summary' },
          ],
        },
        {
          text: 'Module 17 — DevOps & Deployment',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/nodejs/module-17/' },
            { text: '17.1 Docker for Node.js', link: '/nodejs/module-17/01-docker' },
            { text: '17.2 CI/CD Pipelines', link: '/nodejs/module-17/02-cicd' },
            { text: '17.3 Config & Secrets', link: '/nodejs/module-17/03-config-secrets' },
            { text: '17.4 Health Checks & Monitoring', link: '/nodejs/module-17/04-health-monitoring' },
            { text: 'Summary', link: '/nodejs/module-17/summary' },
          ],
        },
      ],

      // ── Track 3: Frameworks ──
      '/frameworks/': [
        {
          text: 'Frameworks',
          items: [{ text: 'Overview', link: '/frameworks/' }],
        },
        {
          text: 'Express',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/frameworks/express/' },
            { text: 'The Middleware Stack', link: '/frameworks/express/01-middleware-stack' },
            { text: 'Error Handling & Async', link: '/frameworks/express/02-error-handling' },
          ],
        },
        {
          text: 'NestJS',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/frameworks/nestjs/' },
            { text: 'DI Container', link: '/frameworks/nestjs/01-di-container' },
            { text: 'Request Lifecycle', link: '/frameworks/nestjs/02-request-lifecycle' },
            { text: 'Provider Scopes & CLS', link: '/frameworks/nestjs/03-provider-scopes' },
            { text: 'Microservices Transports', link: '/frameworks/nestjs/04-microservices' },
          ],
        },
      ],

      // ── Track 4: System Design ──
      '/system-design/': [
        {
          text: 'System Design',
          items: [{ text: 'Overview', link: '/system-design/' }],
        },
        {
          text: 'Message Queues',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/system-design/queues/' },
            { text: 'Why Queues Exist', link: '/system-design/queues/01-why-queues' },
            { text: 'Redis Queues & BullMQ', link: '/system-design/queues/02-redis-bullmq' },
            { text: 'Delivery Semantics', link: '/system-design/queues/03-delivery-semantics' },
          ],
        },
        {
          text: 'Microservices',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/system-design/microservices/' },
            { text: 'Sync vs Async Communication', link: '/system-design/microservices/01-communication' },
            { text: 'Sagas & Distributed Transactions', link: '/system-design/microservices/02-sagas' },
            { text: 'Distributed Failure Modes', link: '/system-design/microservices/03-failure-modes' },
          ],
        },
        {
          text: 'Load Balancing',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/system-design/load-balancing/' },
            { text: 'L4 vs L7 & Algorithms', link: '/system-design/load-balancing/01-l4-vs-l7' },
            { text: 'nginx as Reverse Proxy', link: '/system-design/load-balancing/02-nginx' },
            { text: 'Streaming & SSE', link: '/system-design/load-balancing/03-streaming-sse' },
          ],
        },
        {
          text: 'Caching',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/system-design/caching/' },
            { text: 'Patterns & Stampede', link: '/system-design/caching/01-patterns' },
            { text: 'Redis, CDN & Invalidation', link: '/system-design/caching/02-redis-cdn' },
          ],
        },
        {
          text: 'Scaling',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/system-design/scaling/' },
            { text: 'Horizontal vs Vertical', link: '/system-design/scaling/01-horizontal-vertical' },
            { text: 'Rate Limiting Algorithms', link: '/system-design/scaling/02-rate-limiting' },
          ],
        },
      ],

      // ── Track 5: Interview Prep ──
      '/interview/': [
        {
          text: 'Interview Prep',
          items: [
            { text: 'Overview', link: '/interview/' },
            { text: 'JS Crash Sheet', link: '/interview/crash-sheet-js' },
            { text: 'Node.js Crash Sheet', link: '/interview/crash-sheet-node' },
            { text: 'System Design Crash Sheet', link: '/interview/crash-sheet-system-design' },
            { text: 'Question Bank', link: '/interview/question-bank' },
          ],
        },
        {
          text: 'Design Walkthroughs',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/interview/design-walkthroughs/' },
            { text: 'Rate Limiter', link: '/interview/design-walkthroughs/rate-limiter' },
            { text: 'Job Queue', link: '/interview/design-walkthroughs/job-queue' },
            { text: 'LLM Gateway', link: '/interview/design-walkthroughs/llm-gateway' },
            { text: 'Webhook System', link: '/interview/design-walkthroughs/webhook-system' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/msuhailea/engineering-handbook' },
    ],

    footer: {
      message: 'Built by Muhammed Suhail EA',
    },
  },
})
