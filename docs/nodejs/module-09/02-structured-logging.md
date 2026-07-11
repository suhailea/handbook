---
title: "Structured Logging with Pino"
outline: deep
---

# Structured Logging with Pino

**Interview weight:** :fire::fire: | **Node.js 22+** | **Prerequisites:** [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage)

## :speaking_head: In Plain English

::: tip In Plain English
Imagine you run a busy hotel. Every event -- a guest checking in, a room service order, a maintenance request -- gets written in a logbook at the front desk. If the logbook is just a notebook where staff scribble freeform sentences ("Bob came in at 3pm, he looked tired, room 405"), it is almost useless when you need to answer questions like "how many guests checked in between 2pm and 4pm?" or "which rooms had maintenance requests this week?" You would have to read every single line and interpret the handwriting.

**Structured logging** is like replacing that notebook with a standardized form. Every entry has the same fields: timestamp, event type, guest name, room number, staff member. Now a computer can read the logbook as easily as a person. You can filter, search, aggregate, and alert automatically.

**Pino** is the form template for Node.js. It writes every log entry as a single line of JSON. It is designed to be extremely fast -- so fast that logging does not slow down your hotel's operations. It achieves this by doing almost nothing in the main process: it writes JSON to stdout and lets a separate process (a "transport") handle the expensive work of sending logs to a database, a file, or a cloud service.

**Request-scoped logging** is like stamping every form with the guest's reservation number. When a request comes in, you generate a unique ID, and every log entry produced while handling that request carries that ID. If something goes wrong, you can pull up every log line related to that specific request, across every service it touched, in chronological order. This is made possible by AsyncLocalStorage, which is like an invisible ink stamp that automatically transfers onto every form a staff member fills out while handling that guest's request.
:::

## :gear: Under the Hood

### Why Not `console.log`?

```typescript
// run: node --experimental-strip-types console-problems.ts

// Problem 1: console.log is unstructured
console.log('User logged in', 'user123', 'from', '192.168.1.1');
// Output: User logged in user123 from 192.168.1.1
// A log aggregator cannot parse this reliably.

// Problem 2: console.log goes through the inspector protocol
// In Node, console.log calls process.stdout.write but also:
// 1. Formats arguments using util.inspect (expensive for objects)
// 2. If the debugger is attached, sends to the inspector protocol
// 3. Uses C++ bindings that are slower than direct stream writes

// Problem 3: no levels, no context, no correlation
console.log('Processing order');     // Is this debug? info? What request?
console.error('Payment failed');     // What order? What user? What error code?

// Problem 4: console methods are synchronous and block the event loop
// for the duration of the write + formatting
```

### Pino Fundamentals

```typescript
// run: node --experimental-strip-types pino-basic.ts

import pino from 'pino';

// Create a logger instance
const logger = pino({
  level: 'info', // Minimum level to output (trace < debug < info < warn < error < fatal)
});

// Basic logging -- each call produces one JSON line
logger.info('Server starting');
// {"level":30,"time":1720000000000,"pid":12345,"hostname":"myhost","msg":"Server starting"}

// With additional fields (merged into the JSON)
logger.info({ port: 3000, env: 'production' }, 'Server listening');
// {"level":30,"time":...,"pid":...,"hostname":...,"port":3000,"env":"production","msg":"Server listening"}

// Error logging with error serialization
try {
  throw new Error('Connection refused');
} catch (err) {
  logger.error({ err }, 'Database connection failed');
  // {"level":50,"time":...,"err":{"type":"Error","message":"Connection refused","stack":"Error: ..."},"msg":"Database connection failed"}
}

// IMPORTANT: object first, message second -- this is pino's API convention
// logger.info(object, message) -- NOT logger.info(message, object)
```

### Why Pino Is Fast

Pino's speed comes from deliberate design decisions:

1. **JSON.stringify, not util.inspect.** Pino uses a custom fast JSON serializer (`sonic-boom` + `fast-json-stringify`) instead of Node's `util.inspect`, which is designed for human readability, not speed.

2. **Asynchronous destination writes.** `sonic-boom`, Pino's default destination, batches writes and flushes asynchronously. It does not wait for the OS to confirm the write before returning control.

3. **No string formatting.** Pino does not support `printf`-style formatting (`%s`, `%d`). Every value is a JSON property.

4. **Level checking is a number comparison.** `logger.debug(...)` does nothing if the level is set to `info` -- it is a single integer comparison (`20 < 30`), not a string lookup.

```typescript
// Level numbers in pino:
// trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60
// When level is 'info' (30), any call with level < 30 is a no-op
```

### Child Loggers

Child loggers add persistent context without copying the parent:

```typescript
// run: node --experimental-strip-types pino-child.ts

import pino from 'pino';

const logger = pino({ level: 'info' });

// Create a child logger with bound context
const requestLogger = logger.child({
  requestId: 'abc-123',
  userId: 'user-456',
});

requestLogger.info('Processing payment');
// {"level":30,"time":...,"requestId":"abc-123","userId":"user-456","msg":"Processing payment"}

requestLogger.info({ amount: 99.99, currency: 'USD' }, 'Payment succeeded');
// {"level":30,"time":...,"requestId":"abc-123","userId":"user-456","amount":99.99,"currency":"USD","msg":"Payment succeeded"}

// Child of a child -- context accumulates
const paymentLogger = requestLogger.child({ service: 'stripe' });
paymentLogger.info('Charge created');
// {"level":30,"time":...,"requestId":"abc-123","userId":"user-456","service":"stripe","msg":"Charge created"}
```

**How child loggers work internally:** Pino does not clone the parent logger. A child logger holds a reference to its parent's serializer and destination, plus its own bindings (serialized once at creation time as a JSON fragment). When you call `childLogger.info(...)`, Pino concatenates the pre-serialized bindings with the new log data. This is why child logger creation is cheap and logging through a child is nearly as fast as logging through the parent.

### Custom Serializers

```typescript
// run: node --experimental-strip-types pino-serializers.ts

import pino from 'pino';
import type { IncomingMessage, ServerResponse } from 'node:http';

const logger = pino({
  level: 'info',
  serializers: {
    // Custom serializer for request objects -- extract only what you need
    req(req: IncomingMessage) {
      return {
        method: req.method,
        url: req.url,
        headers: {
          host: req.headers.host,
          'user-agent': req.headers['user-agent'],
          // Explicitly omit authorization, cookie, etc.
        },
      };
    },
    // Custom serializer for response objects
    res(res: ServerResponse) {
      return {
        statusCode: res.statusCode,
      };
    },
    // The built-in 'err' serializer handles Error objects
    // Override it to add custom fields:
    err: pino.stdSerializers.wrapErrorSerializer((err) => {
      // Add custom properties from your error classes
      return {
        ...err,
        code: (err as any).code,
        statusCode: (err as any).statusCode,
      };
    }),
  },
});

// When you log { req: incomingMessage }, the serializer runs automatically
// Only the fields you selected appear in the JSON output
```

### Request-Scoped Logging with AsyncLocalStorage

This is the most important production pattern. Every log line from a request handler should carry the request's correlation ID automatically, without passing a logger through every function call:

```typescript
// run: node --experimental-strip-types pino-als.ts

import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import pino from 'pino';

// The root logger
const rootLogger = pino({ level: 'info' });

// Store the child logger in ALS
const loggerStore = new AsyncLocalStorage<pino.Logger>();

// Helper to get the current request-scoped logger
function getLogger(): pino.Logger {
  return loggerStore.getStore() ?? rootLogger;
}

// --- Application code: just calls getLogger(), never worries about context ---

async function processOrder(orderId: string): Promise<void> {
  const log = getLogger();
  log.info({ orderId }, 'Processing order');

  await chargePayment(orderId);
  log.info({ orderId }, 'Order complete');
}

async function chargePayment(orderId: string): Promise<void> {
  const log = getLogger();
  log.info({ orderId, provider: 'stripe' }, 'Charging payment');
  // ... payment logic
}

// --- HTTP server: sets up the ALS context ---

const server = createServer((req, res) => {
  const requestId = (req.headers['x-request-id'] as string) ?? randomUUID();

  // Create a child logger with request context
  const requestLogger = rootLogger.child({ requestId, method: req.method, url: req.url });

  // Run the entire request handler inside ALS
  loggerStore.run(requestLogger, async () => {
    try {
      await processOrder('order-789');
      res.writeHead(200).end('OK');
    } catch (err) {
      requestLogger.error({ err }, 'Request failed');
      res.writeHead(500).end('Internal Server Error');
    }
  });
});

server.listen(3000, () => {
  rootLogger.info({ port: 3000 }, 'Server listening');
});

// Every log line from processOrder and chargePayment automatically
// includes requestId, method, and url -- without passing the logger down.
```

### Transports: Stdout and Beyond

Pino follows the Unix philosophy: the application writes JSON to stdout, and a separate process routes it to its destination.

```typescript
// run: node --experimental-strip-types pino-transport.ts

import pino from 'pino';

// Development: pretty-print to stdout
const devLogger = pino({
  level: 'debug',
  transport: {
    target: 'pino-pretty', // npm install pino-pretty
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname',
    },
  },
});

// Production: multiple destinations
const prodLogger = pino({
  level: 'info',
  transport: {
    targets: [
      // JSON to stdout (for container log collectors)
      { target: 'pino/file', options: { destination: 1 } }, // fd 1 = stdout
      // Errors to a separate file
      {
        target: 'pino/file',
        options: { destination: '/var/log/app/errors.log' },
        level: 'error',
      },
    ],
  },
});

devLogger.info('This is pretty-printed in dev');
prodLogger.error({ err: new Error('boom') }, 'This goes to both stdout and errors.log');
```

**Production log pipeline pattern:**

```
Node app (pino JSON → stdout)
  → Container runtime captures stdout
    → Log collector (Fluent Bit, Vector, Filebeat)
      → Log aggregator (Elasticsearch, Loki, Datadog, CloudWatch)
        → Dashboards & alerts
```

This pipeline means your Node process never opens file handles, never manages log rotation, and never blocks on slow network writes to a remote aggregator.

### pino-http for HTTP Request Logging

```typescript
// run: node --experimental-strip-types pino-http-demo.ts

import { createServer } from 'node:http';
import pino from 'pino';
import pinoHttp from 'pino-http';

const logger = pino({ level: 'info' });

const httpLogger = pinoHttp({
  logger,
  // Automatically generate request IDs
  genReqId: (req) => (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
  // Custom log level based on status code
  customLogLevel: (_req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  // Redact sensitive headers
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
  },
});

const server = createServer((req, res) => {
  // Attach pino-http to the request
  httpLogger(req, res);

  // req.log is now a child logger with request context
  req.log.info('Handling request');

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello');

  // pino-http automatically logs when the response finishes:
  // {"level":30,"time":...,"req":{"method":"GET","url":"/"},"res":{"statusCode":200},"responseTime":2,"msg":"request completed"}
});

server.listen(3000);
```

### Log Levels: When to Use Each

| Level | When to use | Example |
|---|---|---|
| `trace` (10) | Extremely verbose, line-by-line tracing | `Entering function processOrder with args {...}` |
| `debug` (20) | Development-useful detail, off in production | `Cache miss for key user:123` |
| `info` (30) | Business events and state changes | `Order processed`, `Server listening on :3000` |
| `warn` (40) | Something unexpected but handled | `Retry attempt 3/5 for payment`, `Deprecated API called` |
| `error` (50) | Failed operation that needs attention | `Payment failed: insufficient funds`, `Database connection lost` |
| `fatal` (60) | Process is about to crash | `Cannot bind to port`, `Unrecoverable state` |

**Rule of thumb for production:** Set level to `info`. Use `debug` only when actively investigating an issue (you can change the level at runtime via a signal handler or admin endpoint without restarting).

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites
**1. Logging sensitive data.** A developer logs the entire request body at `debug` level: `logger.debug({ body: req.body }, 'Received request')`. In production, someone temporarily enables `debug` level to diagnose an issue. Now credit card numbers, passwords, and API keys appear in the log aggregator, which is backed by Elasticsearch with broad read access. Fix: use custom serializers to redact sensitive fields, and establish a team convention that request/response bodies are never logged without explicit field selection.

**2. Synchronous logging stalling the event loop.** A team uses `pino` with `pino.destination({ sync: true })` because they want guaranteed log delivery. Under high load, the filesystem write blocks the event loop for milliseconds on each log call. P99 latency spikes. Fix: use the default asynchronous destination. Accept that a few log lines may be lost if the process crashes abruptly -- this is an acceptable trade-off in virtually all systems. For truly critical audit events, write to a transactional store, not a log.

**3. Missing correlation IDs across service boundaries.** Service A generates a request ID and logs it. It calls Service B but does not propagate the request ID in headers. Service B generates its own ID. When debugging a cross-service failure, there is no way to connect the log lines from A and B. Fix: propagate `x-request-id` (or W3C `traceparent`) in outbound HTTP requests. In the ALS-based pattern above, inject the request ID into the headers of any outbound `fetch` or HTTP client call.

**4. Log volume causing cost explosion.** A busy API logs at `info` level with request/response details, producing 50 GB/day of logs in Datadog at $0.10/GB ingested and $1.06/GB retained. Monthly cost: $1,740 just for log ingestion. Fix: be deliberate about what you log at `info`. Log business events (order placed, payment processed), not routine operations (cache hit, middleware passed). Use sampling for high-volume low-value events.
:::

## :dart: Checkpoint

::: details Question 1 -- Performance design
**Q:** Why is pino significantly faster than winston, and what architectural decision makes the biggest difference?

**A:** The single biggest factor is that pino writes pre-serialized JSON to a `sonic-boom` writable (an async, batching file descriptor writer) and does no formatting or string interpolation. Winston, by contrast, uses a transform stream pipeline: each log entry passes through a formatter, then a transport, each of which may allocate intermediate strings and buffers. Additionally, pino's child loggers pre-serialize their bindings at creation time (once), so logging through a child is a string concatenation, not a re-serialization. Winston's metadata merging happens on every log call. Pino also uses numeric level comparisons (a single integer `<` check) to skip disabled levels, while winston does string lookups. The cumulative effect is that pino is typically 5-10x faster than winston in benchmarks.
:::

::: details Question 2 -- ALS-based logging
**Q:** How does the AsyncLocalStorage-based logging pattern avoid passing a logger through every function parameter, and what is the mechanism that makes the logger available inside `async/await` chains?

**A:** `AsyncLocalStorage.run(store, callback)` associates the `store` value with the current execution context. V8 maintains an internal "async context" that is automatically propagated when new asynchronous operations are created (promises, timers, I/O callbacks). This works because Node's async resource tracking (the same mechanism behind `async_hooks`) tags each async operation with its parent context at creation time. When a `setTimeout` callback fires or a `Promise.then` handler runs, Node restores the async context that was active when the timer or promise was created. So `getLogger()` calls `loggerStore.getStore()`, which reads from the current async context -- no matter how deep in the call stack or how many `await` boundaries the code has crossed, as long as the original `run()` is an ancestor in the async chain.
:::

## Key Mental Models

- **Structured logs are queryable; unstructured logs are stories.** If you cannot `grep` your logs with `jq`, they are not structured.
- **The application writes JSON to stdout; everything else is someone else's job.** Log routing, rotation, aggregation, and alerting belong to infrastructure, not application code.
- **Child loggers are pre-serialized context, not copies.** Creating one is cheap; use them freely for request, user, and operation context.
- **Request IDs must propagate across service boundaries.** A correlation ID that stops at the first service call is not a correlation ID -- it is a local curiosity.
- **Log at the level of business events, not code execution.** "Order processed" is info. "Entering function X" is trace. Confusing the two leads to either noise or silence.

## Related

- [node:test](./01-node-test) -- testing logging output
- [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage) -- the mechanism behind request-scoped logging
