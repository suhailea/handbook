---
title: "OpenTelemetry & Auto-Instrumentation"
outline: deep
---

# OpenTelemetry & Auto-Instrumentation

**Interview weight:** :fire::fire: | **Node.js 22+** | **Prerequisites:** [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage), [Structured Logging](./02-structured-logging)

## :speaking_head: In Plain English

::: tip In Plain English
Imagine you are running a large hospital. A patient (a request) arrives at the front desk, is seen by a triage nurse, gets blood work from the lab, sees a doctor, gets an X-ray from radiology, and finally picks up medication from the pharmacy. If something goes wrong -- the patient waited two hours -- you need to know *where* the delay happened. Was it the lab? The doctor? The X-ray queue?

**Tracing** is like giving the patient a clipboard at the front desk. Every department stamps the clipboard with their name, when the patient arrived, and when they left. At the end, you have a complete timeline of the patient's journey through every department. That clipboard is a **trace**, and each department's stamp is a **span**.

**OpenTelemetry** (OTel) is a universal standard for that clipboard format. It does not matter if the lab uses one computer system and radiology uses another -- as long as both understand OTel's clipboard format, you can stitch the full journey together.

**Auto-instrumentation** is the magic part: you do not need to modify each department's workflow to add stamping. Instead, you install invisible cameras at every department entrance and exit. They automatically record when the patient enters and leaves. In Node.js, these "cameras" hook into the modules your code already uses -- `http`, `pg`, `redis`, `fetch` -- and create spans without you writing a single line of tracing code.

The three things OTel collects are called the **three pillars of observability**: **traces** (the clipboard -- what happened in what order), **metrics** (aggregate numbers -- "the lab processed 200 patients today with an average wait of 8 minutes"), and **logs** (detailed notes -- "patient Smith's blood sample was hemolyzed, re-draw required"). Together, they give you a complete picture of your system's health.
:::

## :gear: Under the Hood

### The OpenTelemetry Data Model

#### Traces and Spans

A **trace** is a tree of **spans** representing a single request's journey through a distributed system. Every span has:

| Field | Description |
|---|---|
| `traceId` | 128-bit ID shared by all spans in the trace |
| `spanId` | 64-bit ID unique to this span |
| `parentSpanId` | The span that created this one (null for the root span) |
| `name` | Human-readable operation name (e.g., `HTTP GET /api/users`) |
| `kind` | `SERVER`, `CLIENT`, `INTERNAL`, `PRODUCER`, `CONSUMER` |
| `startTime` | Nanosecond timestamp |
| `endTime` | Nanosecond timestamp |
| `status` | `OK`, `ERROR`, `UNSET` |
| `attributes` | Key-value metadata (e.g., `http.method: GET`, `db.system: postgresql`) |
| `events` | Timestamped annotations within the span (e.g., exceptions) |

```
Trace: abc123
├── [root] HTTP POST /api/orders         (300ms, SERVER)
│   ├── [child] validateInput            (2ms, INTERNAL)
│   ├── [child] pg.query INSERT orders   (45ms, CLIENT)
│   ├── [child] HTTP POST /payments      (200ms, CLIENT)
│   │   └── [child] stripe.charges.create (180ms, CLIENT)  ← different service
│   └── [child] redis SET order:456      (3ms, CLIENT)
```

#### Context Propagation

When Service A calls Service B, the trace context must travel with the request. OTel uses the **W3C Trace Context** standard: two HTTP headers.

```
traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
              │  │                                │                │
              │  │                                │                └─ flags (01 = sampled)
              │  │                                └─ parent span ID (8 bytes)
              │  └─ trace ID (16 bytes)
              └─ version
```

Service B reads these headers, creates a child span with the same `traceId`, and sets `parentSpanId` to the span ID from the header. This is how spans from different processes, different languages, and different hosts are stitched into one trace.

### Setting Up OTel in Node.js

```typescript
// run: node --experimental-strip-types --require ./tracing.ts app.ts
// NOTE: tracing must be initialized BEFORE any other imports

// tracing.ts -- OTel bootstrap
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: 'order-service',
    [ATTR_SERVICE_VERSION]: '1.2.0',
  }),

  // Trace exporter: sends spans to an OTel Collector or Jaeger
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces', // OTel Collector OTLP/HTTP endpoint
  }),

  // Metric reader: periodically exports metrics
  metricReader: new PeriodicExportingMetricReader({
    exporter: new OTLPMetricExporter({
      url: 'http://localhost:4318/v1/metrics',
    }),
    exportIntervalMillis: 15_000,
  }),

  // Auto-instrumentation: patches http, fetch, pg, redis, express, etc.
  instrumentations: [
    getNodeAutoInstrumentations({
      // Disable noisy instrumentations
      '@opentelemetry/instrumentation-fs': { enabled: false },
      // Configure specific ones
      '@opentelemetry/instrumentation-http': {
        ignoreIncomingPaths: ['/health', '/ready'],
      },
    }),
  ],
});

sdk.start();

// Graceful shutdown -- flush pending spans/metrics
process.on('SIGTERM', async () => {
  await sdk.shutdown();
  process.exit(0);
});
```

### How Auto-Instrumentation Works

Auto-instrumentation does **not** modify your source code. It uses Node's module loading hooks to **patch** modules at load time:

1. When `require('http')` or `import('http')` executes, OTel's instrumentation hook intercepts the module.
2. It wraps key functions (e.g., `http.request`, `http.createServer`) with proxy functions.
3. The proxy function:
   - Creates a new span before calling the original function
   - Sets span attributes from the arguments (URL, method, etc.)
   - Ends the span when the operation completes (response `'end'` event)
   - Propagates context so child operations become child spans

```typescript
// Simplified illustration of what http instrumentation does internally:
// (This is NOT code you write -- OTel does this automatically)

import { trace, context, SpanKind } from '@opentelemetry/api';

const tracer = trace.getTracer('http-instrumentation');

// Original: http.request(options, callback)
// Patched version (conceptual):
function patchedHttpRequest(original: Function) {
  return function (options: any, callback: any) {
    const span = tracer.startSpan(`HTTP ${options.method} ${options.path}`, {
      kind: SpanKind.CLIENT,
      attributes: {
        'http.method': options.method,
        'http.url': `${options.hostname}${options.path}`,
        'net.peer.name': options.hostname,
        'net.peer.port': options.port,
      },
    });

    // Inject trace context into outgoing headers (W3C traceparent)
    const propagatedContext = trace.setSpan(context.active(), span);
    // ... inject headers ...

    // Call the original http.request
    const req = original.call(this, options, (res: any) => {
      span.setAttribute('http.status_code', res.statusCode);
      res.on('end', () => span.end());
      callback?.(res);
    });

    req.on('error', (err: Error) => {
      span.setStatus({ code: 2 /* ERROR */, message: err.message });
      span.end();
    });

    return req;
  };
}
```

**The async_hooks connection:** OTel uses `AsyncLocalStorage` (which is built on `async_hooks`) to maintain the current span context across asynchronous boundaries. When you `await` a database query inside an HTTP handler, the database span knows its parent is the HTTP span because `AsyncLocalStorage` automatically propagates the context through the `await`.

### Manual Instrumentation

When auto-instrumentation is not enough (custom business logic, internal operations), you create spans manually:

```typescript
// run: node --experimental-strip-types manual-spans.ts

import { trace, SpanStatusCode, context } from '@opentelemetry/api';

// Get a tracer (name should be your module/package name)
const tracer = trace.getTracer('order-service', '1.0.0');

interface Order {
  id: string;
  items: Array<{ productId: string; quantity: number }>;
  userId: string;
}

async function processOrder(order: Order): Promise<void> {
  // Start a new span
  await tracer.startActiveSpan('processOrder', async (span) => {
    try {
      // Add attributes (metadata)
      span.setAttribute('order.id', order.id);
      span.setAttribute('order.item_count', order.items.length);
      span.setAttribute('user.id', order.userId);

      // Add an event (a timestamped annotation within the span)
      span.addEvent('validation.started');
      await validateOrder(order);
      span.addEvent('validation.completed');

      await chargePayment(order);

      span.setStatus({ code: SpanStatusCode.OK });
    } catch (err) {
      // Record the error on the span
      span.setStatus({ code: SpanStatusCode.ERROR, message: (err as Error).message });
      span.recordException(err as Error);
      throw err;
    } finally {
      // ALWAYS end the span
      span.end();
    }
  });
}

async function validateOrder(order: Order): Promise<void> {
  // startActiveSpan automatically sets this span as the current context
  // so it becomes a child of processOrder
  await tracer.startActiveSpan('validateOrder', async (span) => {
    try {
      // Validation logic...
      if (order.items.length === 0) {
        throw new Error('Empty order');
      }
      span.setStatus({ code: SpanStatusCode.OK });
    } finally {
      span.end();
    }
  });
}

async function chargePayment(order: Order): Promise<void> {
  await tracer.startActiveSpan('chargePayment', { attributes: { 'payment.provider': 'stripe' } }, async (span) => {
    try {
      // Payment logic...
      await new Promise(resolve => setTimeout(resolve, 100)); // simulate API call
      span.setStatus({ code: SpanStatusCode.OK });
    } finally {
      span.end();
    }
  });
}
```

### Exporters

| Exporter | Protocol | Use case |
|---|---|---|
| `@opentelemetry/exporter-trace-otlp-http` | OTLP over HTTP | Production: send to OTel Collector |
| `@opentelemetry/exporter-trace-otlp-grpc` | OTLP over gRPC | Production: higher throughput |
| `@opentelemetry/exporter-jaeger` | Jaeger native | Direct to Jaeger (legacy, prefer OTLP) |
| `@opentelemetry/sdk-trace-base` (ConsoleSpanExporter) | stdout | Development/debugging |

The recommended production architecture:

```
App (OTel SDK) → OTel Collector → Backend (Jaeger / Tempo / Datadog / Honeycomb)
```

The **Collector** is a separate process that receives telemetry, processes it (sampling, filtering, enrichment), and forwards it to one or more backends. This decouples your app from the backend and allows you to switch backends without code changes.

### Metrics vs Traces vs Logs

| Pillar | What it answers | Cardinality | Example |
|---|---|---|---|
| **Traces** | "What happened to *this* request?" | Per-request (high) | Request abc123 took 300ms, 200ms in payment |
| **Metrics** | "How is the *system* performing?" | Aggregated (low) | P99 latency is 450ms, 5 errors/min |
| **Logs** | "What *details* explain an event?" | Per-event (high) | "Payment failed: card declined, code: insufficient_funds" |

```typescript
// run: node --experimental-strip-types otel-metrics.ts

import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('order-service', '1.0.0');

// Counter: monotonically increasing (total orders processed)
const orderCounter = meter.createCounter('orders.processed', {
  description: 'Total number of orders processed',
  unit: '1',
});

// Histogram: distribution of values (request duration)
const latencyHistogram = meter.createHistogram('http.request.duration', {
  description: 'HTTP request duration in milliseconds',
  unit: 'ms',
});

// UpDownCounter: can increase or decrease (active connections)
const activeConnections = meter.createUpDownCounter('http.connections.active', {
  description: 'Number of active HTTP connections',
});

// Usage:
function handleOrder(status: 'success' | 'failure'): void {
  const start = performance.now();

  // ... process order ...

  const duration = performance.now() - start;

  orderCounter.add(1, { status });
  latencyHistogram.record(duration, { 'http.method': 'POST', 'http.route': '/orders' });
}
```

### Connecting Logs to Traces

The most powerful observability pattern is correlating logs with traces. When a log line includes the `traceId` and `spanId`, you can click from a log entry in Kibana/Loki directly to the trace in Jaeger/Tempo:

```typescript
// run: node --experimental-strip-types log-trace-correlation.ts

import { trace, context } from '@opentelemetry/api';
import pino from 'pino';

const logger = pino({
  level: 'info',
  // Mixin: a function called on every log call to add dynamic fields
  mixin() {
    const span = trace.getSpan(context.active());
    if (span) {
      const spanContext = span.spanContext();
      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        traceFlags: spanContext.traceFlags,
      };
    }
    return {};
  },
});

// Now every log line automatically includes traceId and spanId:
// {"level":30,"time":...,"traceId":"abc123...","spanId":"def456...","msg":"Processing order"}

// In Grafana, you can configure Loki to link traceId to Tempo,
// giving you one-click navigation from log → trace.
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites
**1. Import order breaks auto-instrumentation.** OTel must be initialized *before* any instrumented modules are imported. If your `app.ts` does `import express from 'express'` at the top and `import './tracing'` later, Express is loaded before OTel can patch it. No spans are created for HTTP requests, but the app works fine otherwise -- the failure is completely silent. Fix: use `--require ./tracing.ts` (CJS) or `--import ./tracing.ts` (ESM) to ensure OTel loads first, or use `node --experimental-loader` with an OTel ESM loader.

**2. Unbounded span attributes cause cardinality explosion.** A developer adds `span.setAttribute('http.url', fullUrl)` including query parameters with user-specific values (e.g., `/search?q=unique-query-12345`). Each unique attribute value creates a new time series in the metrics backend. With millions of unique queries, the backend's storage and indexing costs explode. Jaeger/Tempo slow to a crawl. Fix: normalize URL paths (strip query params, replace IDs with placeholders like `/users/:id`).

**3. Missing span.end() causes memory leaks.** A developer creates a span with `tracer.startSpan()` but forgets to call `span.end()` in an error path. The span stays in memory indefinitely, accumulating across requests. Over hours, memory grows until the process OOMs. Fix: always use `try/finally` with `span.end()` in the `finally` block, or use `tracer.startActiveSpan()` with the callback pattern (easier to get right).

**4. Context loss across manual async boundaries.** Code uses `setTimeout`, `EventEmitter`, or a callback-based API that does not automatically propagate async context. A span started in the HTTP handler is not the active span inside the callback, so child spans are orphaned (they appear as separate root traces). Fix: use `context.with(context.active(), callback)` to explicitly propagate context, or wrap callbacks with `AsyncResource.bind()`.
:::

## :dart: Checkpoint

::: details Question 1 -- Auto-instrumentation mechanism
**Q:** How does OTel auto-instrumentation create spans for `http.request()` calls without modifying application source code?

**A:** Auto-instrumentation uses Node's module loading hooks to intercept `require('http')` or `import('http')`. When the `http` module loads, the instrumentation library wraps (monkey-patches) key functions like `http.request` and `http.Server.prototype.emit`. The wrapper function creates a span before calling the original function, sets attributes from the request options (method, URL, headers), injects W3C trace context headers into outgoing requests (for context propagation), and ends the span when the response completes or an error occurs. The current span context is maintained across async boundaries using `AsyncLocalStorage` (built on `async_hooks`), so a database query inside an HTTP handler automatically becomes a child span of the HTTP span.
:::

::: details Question 2 -- Context propagation
**Q:** A trace shows spans from Service A but not from Service B, even though A calls B and both have OTel configured. What is the most likely cause?

**A:** The most likely cause is that the trace context is not being propagated in the HTTP headers between services. For distributed tracing to work, Service A must inject `traceparent` (and optionally `tracestate`) headers into outgoing requests, and Service B must extract them from incoming requests. If A uses a custom HTTP client that bypasses the auto-instrumented `http.request` (e.g., a native addon or a manually constructed TCP connection), the headers are not injected. Similarly, if B sits behind a reverse proxy or API gateway that strips unknown headers, the context is lost. Additionally, if the services use different propagation formats (e.g., A uses W3C Trace Context but B expects Jaeger's `uber-trace-id`), they cannot read each other's context. Fix: ensure both services use the same propagator (W3C is the standard) and that intermediary infrastructure preserves the headers.
:::

::: details Question 3 -- Traces vs metrics
**Q:** Why do you need both traces and metrics? Why not derive metrics from traces?

**A:** While it is technically possible to derive metrics from traces (and some backends like Tempo/Grafana support this), there are practical reasons to collect both independently. (1) **Sampling**: traces are typically sampled (1-10% of requests) to control cost. Metrics derived from sampled traces are statistically inaccurate -- you might miss a brief latency spike that affected only 0.5% of requests. Metrics are collected on every request (counters, histograms) and then aggregated, so they capture the full picture. (2) **Cardinality**: metrics are pre-aggregated by dimension (route, method, status code), making them cheap to store. Storing every span for every request is 100-1000x more expensive. (3) **Alerting**: you alert on metrics ("P99 > 500ms"), not on individual traces. Metrics are designed for aggregation and threshold comparison. (4) **Latency**: metrics are available in near-real-time (15-60 second intervals). Trace data may take minutes to be ingested and indexed.
:::

## Key Mental Models

- **A trace is a tree of spans, not a log.** It captures the *structure* of a request's journey (what called what, how long each part took), not just a sequence of events.
- **Auto-instrumentation is module patching via loader hooks.** It must load before the modules it patches, or it has nothing to patch.
- **Context propagation is the difference between local spans and distributed traces.** Without W3C Trace Context headers flowing between services, you have isolated span trees, not traces.
- **Metrics for alerting, traces for debugging.** Metrics tell you *something is wrong*. Traces tell you *why*.
- **Always end your spans.** An unended span is a memory leak and a gap in your trace.

## Related

- [Structured Logging](./02-structured-logging) -- correlating logs with trace IDs
- [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage) -- the mechanism OTel uses for context propagation in Node
- [Debugging](./04-debugging) -- complementary debugging tools
