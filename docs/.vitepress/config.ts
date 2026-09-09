import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: 'Engineering Handbook',
  description: 'Backend engineering explained twice — plain English first, then full technical depth.',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  base: process.env.GITHUB_ACTIONS ? '/handbook/' : '/',

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
      { text: 'Python', link: '/python/', activeMatch: '/python/' },
      { text: 'RAG', link: '/rag/', activeMatch: '/rag/' },
      { text: 'AI Engineering', link: '/ai-engineering/', activeMatch: '/ai-engineering/' },
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
            { text: '📝 25 Interview Questions', link: '/js-core/questions' },
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
        {
          text: '📝 Interview Questions',
          items: [
            { text: '25 Node.js Questions', link: '/nodejs/questions' },
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
        {
          text: '📝 Interview Questions',
          items: [
            { text: '25 Frameworks Questions', link: '/frameworks/questions' },
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
        {
          text: '📝 Interview Questions',
          items: [
            { text: '25 System Design Questions', link: '/system-design/questions' },
          ],
        },
      ],

      // ── Track 6: Python ──
      '/python/': [
        {
          text: 'Python',
          items: [{ text: 'Overview', link: '/python/' }],
        },
        {
          text: 'Module 1 — Language Foundations',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/python/module-01/' },
            { text: '1.1 What Python Actually Is', link: '/python/module-01/01-what-python-is' },
            { text: '1.2 Data Model', link: '/python/module-01/02-data-model' },
            { text: '1.3 Core Syntax & Truthiness', link: '/python/module-01/03-core-syntax' },
            { text: '1.4 Numbers, Strings & None', link: '/python/module-01/04-numbers-strings-none' },
            { text: 'Summary', link: '/python/module-01/summary' },
          ],
        },
        {
          text: 'Module 2 — Data Structures',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-02/' },
            { text: '2.1 Lists & Tuples', link: '/python/module-02/01-lists-tuples' },
            { text: '2.2 Dictionaries', link: '/python/module-02/02-dicts' },
            { text: '2.3 Sets & Collections', link: '/python/module-02/03-sets-collections' },
            { text: 'Summary', link: '/python/module-02/summary' },
          ],
        },
        {
          text: 'Module 3 — Functions & Scoping',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-03/' },
            { text: '3.1 Functions as First-Class Objects', link: '/python/module-03/01-functions-first-class' },
            { text: '3.2 LEGB Scoping & Closures', link: '/python/module-03/02-scoping-closures' },
            { text: '3.3 Decorators', link: '/python/module-03/03-decorators' },
            { text: '3.4 Functional Tools', link: '/python/module-03/04-functional-tools' },
            { text: 'Summary', link: '/python/module-03/summary' },
          ],
        },
        {
          text: 'Module 4 — OOP & Descriptors',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-04/' },
            { text: '4.1 Classes & Instances', link: '/python/module-04/01-classes-instances' },
            { text: '4.2 Inheritance & MRO', link: '/python/module-04/02-inheritance-mro' },
            { text: '4.3 Descriptors & Properties', link: '/python/module-04/03-descriptors-properties' },
            { text: '4.4 Metaclasses & __slots__', link: '/python/module-04/04-metaclasses-slots' },
            { text: 'Summary', link: '/python/module-04/summary' },
          ],
        },
        {
          text: 'Module 5 — Iterators & Generators',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-05/' },
            { text: '5.1 The Iterator Protocol', link: '/python/module-05/01-iterator-protocol' },
            { text: '5.2 Generators', link: '/python/module-05/02-generators' },
            { text: '5.3 Comprehensions & itertools', link: '/python/module-05/03-comprehensions-itertools' },
            { text: 'Summary', link: '/python/module-05/summary' },
          ],
        },
        {
          text: 'Module 6 — Errors & Context Managers',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-06/' },
            { text: '6.1 Exceptions', link: '/python/module-06/01-exceptions' },
            { text: '6.2 Context Managers', link: '/python/module-06/02-context-managers' },
            { text: 'Summary', link: '/python/module-06/summary' },
          ],
        },
        {
          text: 'Module 7 — Concurrency',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-07/' },
            { text: '7.1 The GIL', link: '/python/module-07/01-gil' },
            { text: '7.2 Threading', link: '/python/module-07/02-threading' },
            { text: '7.3 Multiprocessing', link: '/python/module-07/03-multiprocessing' },
            { text: '7.4 asyncio', link: '/python/module-07/04-asyncio' },
            { text: '7.5 concurrent.futures', link: '/python/module-07/05-concurrent-futures' },
            { text: 'Summary', link: '/python/module-07/summary' },
          ],
        },
        {
          text: 'Module 8 — Imports & Packaging',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-08/' },
            { text: '8.1 How import Works', link: '/python/module-08/01-import-mechanics' },
            { text: '8.2 Venvs & Packaging', link: '/python/module-08/02-venvs-packaging' },
            { text: 'Summary', link: '/python/module-08/summary' },
          ],
        },
        {
          text: 'Module 9 — Memory & Performance',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-09/' },
            { text: '9.1 CPython Memory Management', link: '/python/module-09/01-memory-management' },
            { text: '9.2 Profiling & Optimization', link: '/python/module-09/02-profiling-optimization' },
            { text: 'Summary', link: '/python/module-09/summary' },
          ],
        },
        {
          text: 'Module 10 — Type Hints & Modern Python',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-10/' },
            { text: '10.1 Type Hints Basics', link: '/python/module-10/01-type-hints-basics' },
            { text: '10.2 Advanced Typing', link: '/python/module-10/02-advanced-typing' },
            { text: '10.3 mypy & Pydantic', link: '/python/module-10/03-mypy-pydantic' },
            { text: 'Summary', link: '/python/module-10/summary' },
          ],
        },
        {
          text: 'Module 11 — Standard Library',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-11/' },
            { text: '11.1 pathlib & OS', link: '/python/module-11/01-pathlib-os' },
            { text: '11.2 Serialization', link: '/python/module-11/02-serialization' },
            { text: '11.3 Logging & Datetime', link: '/python/module-11/03-logging-datetime' },
            { text: 'Summary', link: '/python/module-11/summary' },
          ],
        },
        {
          text: 'Module 12 — Testing & Tooling',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-12/' },
            { text: '12.1 pytest', link: '/python/module-12/01-pytest' },
            { text: '12.2 Mocking & Coverage', link: '/python/module-12/02-mocking-coverage' },
            { text: '12.3 Debugging & Tooling', link: '/python/module-12/03-debugging-tooling' },
            { text: 'Summary', link: '/python/module-12/summary' },
          ],
        },
        {
          text: 'Module 13 — FastAPI',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/python/module-13/' },
            { text: '13.1 FastAPI Architecture', link: '/python/module-13/01-architecture' },
            { text: '13.2 Routing, Params & Validation', link: '/python/module-13/02-routing-validation' },
            { text: '13.3 Dependency Injection', link: '/python/module-13/03-dependency-injection' },
            { text: '13.4 Middleware, CORS & Error Handling', link: '/python/module-13/04-middleware-errors' },
            { text: '13.5 Auth — JWT, OAuth2 & Security', link: '/python/module-13/05-auth-security' },
            { text: '13.6 Database Integration', link: '/python/module-13/06-database-integration' },
            { text: '13.7 Background Tasks, WebSockets & SSE', link: '/python/module-13/07-background-websockets' },
            { text: '13.8 Testing FastAPI Applications', link: '/python/module-13/08-testing' },
            { text: '13.9 Deployment & Production', link: '/python/module-13/09-deployment' },
            { text: 'Summary', link: '/python/module-13/summary' },
          ],
        },
        {
          text: '📝 Interview Questions',
          items: [
            { text: '25 Python Questions', link: '/python/questions' },
          ],
        },
      ],

      // ── Track 7: Production RAG ──
      '/rag/': [
        {
          text: 'Production RAG',
          items: [{ text: 'Overview', link: '/rag/' }],
        },
        {
          text: 'Module 1 — RAG Fundamentals',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/rag/module-01/' },
            { text: '1.1 What Is RAG & When to Use It', link: '/rag/module-01/01-what-is-rag' },
            { text: '1.2 RAG vs Alternatives', link: '/rag/module-01/02-rag-vs-alternatives' },
            { text: 'Summary', link: '/rag/module-01/summary' },
          ],
        },
        {
          text: 'Module 2 — System Requirements',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-02/' },
            { text: '2.1 Designing Before Building', link: '/rag/module-02/01-requirements' },
            { text: 'Summary', link: '/rag/module-02/summary' },
          ],
        },
        {
          text: 'Module 3 — Data Ingestion',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-03/' },
            { text: '3.1 Ingestion Pipelines', link: '/rag/module-03/01-ingestion-pipelines' },
            { text: '3.2 Reliability & Monitoring', link: '/rag/module-03/02-reliability' },
            { text: 'Summary', link: '/rag/module-03/summary' },
          ],
        },
        {
          text: 'Module 4 — Document Parsing',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-04/' },
            { text: '4.1 Parsing Every Format', link: '/rag/module-04/01-parsing-formats' },
            { text: '4.2 CSV, Excel & Structured Data', link: '/rag/module-04/02-csv-excel' },
            { text: 'Summary', link: '/rag/module-04/summary' },
          ],
        },
        {
          text: 'Module 5 — Chunking',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-05/' },
            { text: '5.1 Chunking Strategies', link: '/rag/module-05/01-chunking-strategies' },
            { text: '5.2 Chunk Size & Evaluation', link: '/rag/module-05/02-chunk-size' },
            { text: 'Summary', link: '/rag/module-05/summary' },
          ],
        },
        {
          text: 'Module 6 — Metadata',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-06/' },
            { text: '6.1 Production Metadata Schema', link: '/rag/module-06/01-metadata-schema' },
            { text: 'Summary', link: '/rag/module-06/summary' },
          ],
        },
        {
          text: 'Module 7 — Embeddings',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-07/' },
            { text: '7.1 Embedding Models & Similarity', link: '/rag/module-07/01-embeddings-similarity' },
            { text: '7.2 Model Selection & Migration', link: '/rag/module-07/02-model-selection' },
            { text: 'Summary', link: '/rag/module-07/summary' },
          ],
        },
        {
          text: 'Module 8 — Vector Databases',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-08/' },
            { text: '8.1 Vector DB Internals', link: '/rag/module-08/01-vector-db-internals' },
            { text: '8.2 Schema & Index Design', link: '/rag/module-08/02-schema-design' },
            { text: 'Summary', link: '/rag/module-08/summary' },
          ],
        },
        {
          text: 'Module 9 — Retrieval & Hybrid Search',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-09/' },
            { text: '9.1 Retrieval Strategies', link: '/rag/module-09/01-retrieval-strategies' },
            { text: '9.2 Hybrid Search & Fusion', link: '/rag/module-09/02-hybrid-search' },
            { text: 'Summary', link: '/rag/module-09/summary' },
          ],
        },
        {
          text: 'Module 10 — Query Processing',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-10/' },
            { text: '10.1 Query Transformations', link: '/rag/module-10/01-query-transformations' },
            { text: '10.2 Routing & Classification', link: '/rag/module-10/02-routing-classification' },
            { text: 'Summary', link: '/rag/module-10/summary' },
          ],
        },
        {
          text: 'Module 11 — Reranking & Context',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-11/' },
            { text: '11.1 Reranking', link: '/rag/module-11/01-reranking' },
            { text: '11.2 Context Construction', link: '/rag/module-11/02-context-construction' },
            { text: 'Summary', link: '/rag/module-11/summary' },
          ],
        },
        {
          text: 'Module 12 — Generation & Hallucination',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-12/' },
            { text: '12.1 Grounded Generation', link: '/rag/module-12/01-grounded-generation' },
            { text: '12.2 Hallucination Mitigation', link: '/rag/module-12/02-hallucination' },
            { text: 'Summary', link: '/rag/module-12/summary' },
          ],
        },
        {
          text: 'Module 13 — Evaluation',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-13/' },
            { text: '13.1 Retrieval & Generation Metrics', link: '/rag/module-13/01-metrics' },
            { text: '13.2 Evaluation Frameworks & Datasets', link: '/rag/module-13/02-frameworks' },
            { text: 'Summary', link: '/rag/module-13/summary' },
          ],
        },
        {
          text: 'Module 14 — Security & Guardrails',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-14/' },
            { text: '14.1 RAG Security', link: '/rag/module-14/01-security' },
            { text: '14.2 Guardrails', link: '/rag/module-14/02-guardrails' },
            { text: 'Summary', link: '/rag/module-14/summary' },
          ],
        },
        {
          text: 'Module 15 — Advanced RAG Patterns',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-15/' },
            { text: '15.1 Agentic RAG', link: '/rag/module-15/01-agentic-rag' },
            { text: '15.2 GraphRAG', link: '/rag/module-15/02-graphrag' },
            { text: '15.3 Multimodal RAG', link: '/rag/module-15/03-multimodal' },
            { text: '15.4 MCP & Human-in-the-Loop', link: '/rag/module-15/04-mcp-hitl' },
            { text: '15.5 Corrective & Self-RAG', link: '/rag/module-15/05-corrective-self-rag' },
            { text: 'Summary', link: '/rag/module-15/summary' },
          ],
        },
        {
          text: 'Module 16 — Production Architecture',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-16/' },
            { text: '16.1 Full System Architecture', link: '/rag/module-16/01-system-architecture' },
            { text: '16.2 Microservices & Async Processing', link: '/rag/module-16/02-microservices' },
            { text: 'Summary', link: '/rag/module-16/summary' },
          ],
        },
        {
          text: 'Module 17 — Operations',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-17/' },
            { text: '17.1 Caching & Freshness', link: '/rag/module-17/01-caching-freshness' },
            { text: '17.2 Scaling & Cost Optimization', link: '/rag/module-17/02-scaling-cost' },
            { text: '17.3 Latency, Failure & Versioning', link: '/rag/module-17/03-latency-failure' },
            { text: '17.4 Observability', link: '/rag/module-17/04-observability' },
            { text: 'Summary', link: '/rag/module-17/summary' },
          ],
        },
        {
          text: 'Module 18 — Case Studies & Implementation',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/rag/module-18/' },
            { text: '18.1 Case Studies Overview', link: '/rag/module-18/01-case-studies' },
            { text: 'Enterprise KB', link: '/rag/module-18/case-enterprise-kb' },
            { text: 'Airline (3 variants)', link: '/rag/module-18/case-airline' },
            { text: 'Legal', link: '/rag/module-18/case-legal' },
            { text: 'Healthcare', link: '/rag/module-18/case-healthcare' },
            { text: 'E-commerce', link: '/rag/module-18/case-ecommerce' },
            { text: 'HR Policy', link: '/rag/module-18/case-hr-policy' },
            { text: 'CSV/Excel Analytics', link: '/rag/module-18/case-csv-excel' },
            { text: 'Multimodal', link: '/rag/module-18/case-multimodal' },
            { text: '18.2 Reference Implementation', link: '/rag/module-18/02-implementation' },
            { text: '18.3 Production Checklist', link: '/rag/module-18/03-checklist' },
            { text: 'Summary', link: '/rag/module-18/summary' },
          ],
        },
        {
          text: '📝 Interview Prep',
          items: [
            { text: '100 RAG Interview Questions', link: '/rag/questions' },
            { text: 'Interview Answer Framework', link: '/rag/interview-framework' },
            { text: 'RAG Crash Sheet', link: '/rag/crash-sheet' },
          ],
        },
      ],

      // ── Track 8: AI Engineering ──
      '/ai-engineering/': [
        {
          text: 'AI Engineering',
          items: [{ text: 'Overview', link: '/ai-engineering/' }],
        },
        {
          text: 'Module 0 — ML Foundations',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-00/' },
            { text: '0.1 How Transformers Work', link: '/ai-engineering/module-00/01-how-transformers-work' },
            { text: '0.2 Training vs Inference', link: '/ai-engineering/module-00/02-training-vs-inference' },
            { text: '0.3 Embeddings', link: '/ai-engineering/module-00/03-embeddings' },
            { text: '0.4 RLHF & Alignment', link: '/ai-engineering/module-00/04-rlhf' },
            { text: 'Summary', link: '/ai-engineering/module-00/summary' },
          ],
        },
        {
          text: 'Module 1 — LLMs & Prompting',
          collapsed: false,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-01/' },
            { text: '1.1 LLMs & Tokens', link: '/ai-engineering/module-01/01-llms-and-tokens' },
            { text: '1.2 Prompt Engineering', link: '/ai-engineering/module-01/02-prompt-engineering' },
            { text: '1.3 Context Engineering', link: '/ai-engineering/module-01/03-context-engineering' },
            { text: 'Summary', link: '/ai-engineering/module-01/summary' },
          ],
        },
        {
          text: 'Module 2 — Agents',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-02/' },
            { text: '2.1 The Agent Loop', link: '/ai-engineering/module-02/01-agent-loop' },
            { text: '2.2 Tools & Tool Calling', link: '/ai-engineering/module-02/02-tools-and-tool-calling' },
            { text: '2.3 Agent Memory', link: '/ai-engineering/module-02/03-agent-memory' },
            { text: '2.4 Planning & Reflection', link: '/ai-engineering/module-02/04-planning-and-reflection' },
            { text: '2.5 The Agent Harness', link: '/ai-engineering/module-02/05-agent-harness' },
            { text: '2.6 Multi-Agent Systems', link: '/ai-engineering/module-02/06-multi-agent' },
            { text: '2.7 MCP', link: '/ai-engineering/module-02/07-mcp' },
            { text: '2.8 A2A — Agent-to-Agent Protocol', link: '/ai-engineering/module-02/08-a2a' },
            { text: 'Summary', link: '/ai-engineering/module-02/summary' },
          ],
        },
        {
          text: 'Module 3 — Model Serving',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-03/' },
            { text: '3.1 Cloud vs Local vs Self-Hosted', link: '/ai-engineering/module-03/01-model-serving-overview' },
            { text: '3.2 GGUF & Local LLMs', link: '/ai-engineering/module-03/02-gguf-and-local-llms' },
            { text: '3.3 vLLM', link: '/ai-engineering/module-03/03-vllm' },
            { text: '3.4 KV Cache', link: '/ai-engineering/module-03/04-kv-cache' },
            { text: '3.5 Quantization', link: '/ai-engineering/module-03/05-quantization' },
            { text: '3.6 Semantic Caching', link: '/ai-engineering/module-03/06-semantic-caching' },
            { text: 'Summary', link: '/ai-engineering/module-03/summary' },
          ],
        },
        {
          text: 'Module 4 — Fine-Tuning',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-04/' },
            { text: '4.1 Fine-Tuning Overview', link: '/ai-engineering/module-04/01-fine-tuning-overview' },
            { text: '4.2 LoRA & QLoRA', link: '/ai-engineering/module-04/02-lora-qlora' },
            { text: '4.3 When to Fine-Tune', link: '/ai-engineering/module-04/03-when-to-fine-tune' },
            { text: 'Summary', link: '/ai-engineering/module-04/summary' },
          ],
        },
        {
          text: 'Module 5 — Production',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-05/' },
            { text: '5.1 Agent Observability', link: '/ai-engineering/module-05/01-agent-observability' },
            { text: '5.2 Agent Evaluation', link: '/ai-engineering/module-05/02-agent-evaluation' },
            { text: '5.3 Guardrails', link: '/ai-engineering/module-05/03-guardrails' },
            { text: 'Summary', link: '/ai-engineering/module-05/summary' },
          ],
        },
        {
          text: 'Module 6 — ML Foundations',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-06/' },
            { text: '6.1 Supervised vs Unsupervised', link: '/ai-engineering/module-06/01-supervised-vs-unsupervised' },
            { text: '6.2 Training, Validation & Test', link: '/ai-engineering/module-06/02-training-validation-test' },
            { text: '6.3 ML Algorithms', link: '/ai-engineering/module-06/03-ml-algorithms' },
            { text: '6.4 Statistics for AI', link: '/ai-engineering/module-06/04-statistics-for-ai' },
            { text: '6.5 Linear Algebra for AI', link: '/ai-engineering/module-06/05-linear-algebra-for-ai' },
            { text: '6.6 ML Metrics', link: '/ai-engineering/module-06/06-ml-metrics' },
            { text: '6.7 Optimization', link: '/ai-engineering/module-06/07-optimization' },
            { text: 'Summary', link: '/ai-engineering/module-06/summary' },
          ],
        },
        {
          text: 'Module 7 — Deep Learning & NLP',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-07/' },
            { text: '7.1 Neural Networks', link: '/ai-engineering/module-07/01-neural-networks' },
            { text: '7.2 CNN, RNN & LSTM', link: '/ai-engineering/module-07/02-cnn-rnn-lstm' },
            { text: '7.3 NLP Fundamentals', link: '/ai-engineering/module-07/03-nlp-fundamentals' },
            { text: 'Summary', link: '/ai-engineering/module-07/summary' },
          ],
        },
        {
          text: 'Module 8 — AI Architecture',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-08/' },
            { text: '8.1 AI System Patterns', link: '/ai-engineering/module-08/01-ai-system-patterns' },
            { text: '8.2 Enterprise AI Architecture', link: '/ai-engineering/module-08/02-enterprise-ai-architecture' },
            { text: '8.3 Data Architecture for AI', link: '/ai-engineering/module-08/03-data-architecture' },
            { text: 'Summary', link: '/ai-engineering/module-08/summary' },
          ],
        },
        {
          text: 'Module 9 — LLMOps & Evaluation',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-09/' },
            { text: '9.1 RAG Evaluation Metrics', link: '/ai-engineering/module-09/01-rag-evaluation-metrics' },
            { text: '9.2 Production Metrics', link: '/ai-engineering/module-09/02-production-metrics' },
            { text: '9.3 Evaluation Pipeline', link: '/ai-engineering/module-09/03-evaluation-pipeline' },
            { text: '9.4 LLMOps', link: '/ai-engineering/module-09/04-llmops' },
            { text: 'Summary', link: '/ai-engineering/module-09/summary' },
          ],
        },
        {
          text: 'Module 10 — AI Infrastructure & Cloud',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-10/' },
            { text: '10.1 Docker for AI', link: '/ai-engineering/module-10/01-docker-for-ai' },
            { text: '10.2 Kubernetes for AI', link: '/ai-engineering/module-10/02-kubernetes-for-ai' },
            { text: '10.3 AKS & Azure', link: '/ai-engineering/module-10/03-aks-and-azure' },
            { text: '10.4 AI Infrastructure Patterns', link: '/ai-engineering/module-10/04-ai-infrastructure-patterns' },
            { text: 'Summary', link: '/ai-engineering/module-10/summary' },
          ],
        },
        {
          text: 'Module 11 — Security & Responsible AI',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-11/' },
            { text: '11.1 AI Security', link: '/ai-engineering/module-11/01-ai-security' },
            { text: '11.2 Agent Security', link: '/ai-engineering/module-11/02-agent-security' },
            { text: '11.3 Responsible AI', link: '/ai-engineering/module-11/03-responsible-ai' },
            { text: 'Summary', link: '/ai-engineering/module-11/summary' },
          ],
        },
        {
          text: 'Module 12 — Energy Trading AI',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-12/' },
            { text: '12.1 Energy Trading Concepts', link: '/ai-engineering/module-12/01-energy-trading-concepts' },
            { text: '12.2 AI in Trading Architecture', link: '/ai-engineering/module-12/02-ai-in-trading-architecture' },
            { text: '12.3 LLM + Quant Models', link: '/ai-engineering/module-12/03-llm-plus-quant' },
            { text: 'Summary', link: '/ai-engineering/module-12/summary' },
          ],
        },
        {
          text: 'Module 13 — AI Business Strategy',
          collapsed: true,
          items: [
            { text: 'Overview', link: '/ai-engineering/module-13/' },
            { text: '13.1 The AI Decision Framework', link: '/ai-engineering/module-13/01-ai-decision-framework' },
            { text: '13.2 AI Metrics & ROI', link: '/ai-engineering/module-13/02-ai-metrics-roi' },
            { text: '13.3 AI Strategy for Engineers', link: '/ai-engineering/module-13/03-ai-strategy' },
            { text: 'Summary', link: '/ai-engineering/module-13/summary' },
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
            { text: 'Python Crash Sheet', link: '/interview/crash-sheet-python' },
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
      { icon: 'github', link: 'https://github.com/suhailea/handbook' },
    ],

    footer: {
      message: 'Built by Muhammed Suhail EA',
    },
  },
}))
