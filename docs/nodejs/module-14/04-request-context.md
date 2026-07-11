---
title: "Request Context, Tracing & Body Parsing"
outline: deep
---

# Request Context, Tracing & Body Parsing

Interview weight: 🔥🔥🔥 | Node 22+ | Prerequisites: [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage), [Structured Logging](/nodejs/module-09/02-structured-logging)

## 🗣️ In Plain English

::: tip In Plain English
Imagine a hospital where every patient gets a wristband with a unique number the moment they walk through the door. Every doctor, nurse, and lab technician who interacts with that patient looks at the wristband and writes the number on every form, test result, and prescription. If something goes wrong, you pull up the wristband number and instantly see every single thing that happened to that patient, in order, across every department.

That is what request context does for your API. The moment a request arrives, your middleware stamps it with a unique ID — the wristband. That ID follows the request through every function call, database query, and external API call, even when those calls happen asynchronously across different parts of your code. When something breaks at 3 AM, you search your logs for that one ID and see the complete story of that request.

The second part of this page is about body parsing — the process of reading the raw bytes that a client sends and turning them into something your code can work with. A JSON body needs parsing into an object. A file upload needs to be read from a multipart stream. A webhook from Stripe needs the raw, unmodified body so you can verify its signature. Each of these requires a different parser, and getting the wrong one (or no parser at all) means your handler sees an empty or garbled body.
:::

## ⚙️ Under the Hood

### Request ID Generation and Propagation

```typescript
// run: npx tsx request-id-middleware.ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';

// The store type for our request context
interface RequestContext {
  requestId: string;
  startTime: number;
  userId?: string;
}

// AsyncLocalStorage instance — shared across the entire app
export const requestStore = new AsyncLocalStorage<RequestContext>();

// Middleware: creates context and wraps the entire request in it
function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  // Honor upstream request ID (from API gateway, load balancer) or generate new
  const requestId =
    (req.headers['x-request-id'] as string) ??
    (req.headers['x-correlation-id'] as string) ??
    randomUUID();

  const context: RequestContext = {
    requestId,
    startTime: performance.now(),
  };

  // Run the rest of the middleware chain inside the ALS context
  requestStore.run(context, () => {
    next();
  });
}

// Response header middleware: attach request ID to response
function requestIdResponseHeader(req: Request, res: Response, next: NextFunction): void {
  const ctx = requestStore.getStore();
  if (ctx) {
    res.setHeader('X-Request-Id', ctx.requestId);
  }
  next();
}

// Helper function: get current request ID from anywhere in the call stack
export function getRequestId(): string {
  return requestStore.getStore()?.requestId ?? 'no-context';
}

// Simulated service that is deeply nested — no req/res passed
async function fetchUserFromDatabase(userId: string): Promise<{ name: string }> {
  const reqId = getRequestId();
  console.log(`[${reqId}] DB query: SELECT * FROM users WHERE id = ${userId}`);
  // The request ID is available without passing req through every layer
  return { name: 'Suhail' };
}

// Wire it up
const app = express();
app.use(requestContextMiddleware);
app.use(requestIdResponseHeader);
app.use(express.json());

app.get('/api/users/:id', async (req: Request, res: Response) => {
  const user = await fetchUserFromDatabase(req.params.id);
  const ctx = requestStore.getStore()!;
  const duration = performance.now() - ctx.startTime;
  console.log(`[${ctx.requestId}] Request completed in ${duration.toFixed(2)}ms`);
  res.json(user);
});

app.listen(3000, () => console.log('Listening on :3000'));
```

### Request Logging with pino-http

```typescript
// run: npx tsx pino-http-logging.ts
import express from 'express';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { randomUUID } from 'node:crypto';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

const app = express();

// pino-http automatically:
// 1. Generates a request ID (or reads from X-Request-Id header)
// 2. Logs request start (method, url, headers)
// 3. Logs request completion (status, duration)
// 4. Attaches req.log — a child logger with request context
app.use(
  pinoHttp({
    logger,
    genReqId: (req) =>
      (req.headers['x-request-id'] as string) ?? randomUUID(),

    // Customize what gets logged
    customProps: (req) => ({
      userId: (req as any).userId, // Added by auth middleware
    }),

    // Redact sensitive headers
    redact: ['req.headers.authorization', 'req.headers.cookie'],

    // Custom log level based on status code
    customLogLevel: (_req, res, error) => {
      if (res.statusCode >= 500 || error) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },

    // Custom success message
    customSuccessMessage: (req, res) => {
      return `${req.method} ${req.url} completed with ${res.statusCode}`;
    },
  }),
);

app.use(express.json());

app.get('/api/data', (req, res) => {
  // req.log is a child logger with the request ID baked in
  req.log.info('Fetching data from database');
  req.log.info({ query: req.query }, 'Query parameters');

  res.json({ data: 'hello' });
});

app.listen(3000, () => logger.info('Server started on :3000'));

// Output (structured JSON in production):
// {"level":30,"time":1720000000,"reqId":"abc-123","req":{"method":"GET","url":"/api/data"},...}
// {"level":30,"time":1720000001,"reqId":"abc-123","msg":"Fetching data from database"}
// {"level":30,"time":1720000002,"reqId":"abc-123","res":{"statusCode":200},"responseTime":15,"msg":"GET /api/data completed with 200"}
```

### Body Parsing

Express does not parse request bodies by default. Each parser reads the raw stream, interprets it according to the Content-Type, and attaches the result to `req.body`.

```typescript
// run: npx tsx body-parsing.ts
import express from 'express';

const app = express();

// JSON body parser — Content-Type: application/json
app.use(
  express.json({
    limit: '1mb',         // Reject bodies larger than 1MB (default: 100kb)
    strict: true,          // Only accept arrays and objects (reject primitives)
    type: 'application/json', // Only parse this Content-Type
  }),
);

// URL-encoded parser — Content-Type: application/x-www-form-urlencoded
app.use(
  express.urlencoded({
    extended: true,  // Use qs library (supports nested objects)
    limit: '1mb',
    parameterLimit: 1000, // Max number of parameters (DoS protection)
  }),
);

// Raw body parser — for webhook signature verification
// IMPORTANT: must be BEFORE express.json() for the specific routes that need it,
// or use a route-specific approach
app.post(
  '/webhooks/stripe',
  express.raw({ type: 'application/json', limit: '5mb' }),
  (req, res) => {
    // req.body is a Buffer — the raw, unmodified bytes
    const signature = req.headers['stripe-signature'] as string;
    const rawBody = req.body as Buffer;

    // Verify HMAC signature against the raw body
    // stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
    console.log('Raw body length:', rawBody.length);
    res.json({ received: true });
  },
);

// Regular JSON endpoint
app.post('/api/users', (req, res) => {
  // req.body is parsed JSON object
  console.log('Parsed body:', req.body);
  res.json({ received: req.body });
});

app.listen(3000);
```

### Multipart Parsing (File Uploads)

```typescript
// run: npx tsx multipart-upload.ts
import express from 'express';
import multer from 'multer';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';

// Memory storage — files are buffered in memory (fine for small files)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,  // 5MB per file
    files: 5,                    // Max 5 files per request
    fieldSize: 1024 * 1024,     // 1MB for non-file fields
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

// Disk storage — files streamed directly to disk (for large files)
const diskUpload = multer({
  storage: multer.diskStorage({
    destination: '/tmp/uploads',
    filename: (_req, file, cb) => {
      const ext = file.originalname.split('.').pop();
      cb(null, `${randomUUID()}.${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const app = express();

// Single file upload
app.post('/api/avatar', memoryUpload.single('avatar'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  console.log('File:', {
    originalname: req.file.originalname,
    mimetype: req.file.mimetype,
    size: req.file.size,
    // buffer available in memory: req.file.buffer
  });

  res.json({ uploaded: true, size: req.file.size });
});

// Multiple files
app.post('/api/documents', diskUpload.array('files', 10), (req, res) => {
  const files = req.files as Express.Multer.File[];
  res.json({
    uploaded: files.length,
    paths: files.map((f) => f.path),
  });
});

// Error handling for multer
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(3000);
```

### Request Timing and Slow Request Detection

```typescript
// run: npx tsx slow-request-detection.ts
import express, { type Request, type Response, type NextFunction } from 'express';

const SLOW_REQUEST_THRESHOLD_MS = 3000; // 3 seconds

function requestTimingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = performance.now();
  const method = req.method;
  const url = req.originalUrl;

  // Set a timer to warn about slow requests while they're still in progress
  const slowTimer = setTimeout(() => {
    console.warn(
      `[SLOW REQUEST IN PROGRESS] ${method} ${url} has been running for ${SLOW_REQUEST_THRESHOLD_MS}ms`,
    );
  }, SLOW_REQUEST_THRESHOLD_MS);

  // Hook into response finish event
  res.on('finish', () => {
    clearTimeout(slowTimer);
    const duration = performance.now() - start;

    if (duration > SLOW_REQUEST_THRESHOLD_MS) {
      console.warn(
        `[SLOW REQUEST COMPLETED] ${method} ${url} took ${duration.toFixed(0)}ms ` +
          `status=${res.statusCode}`,
      );
    }
  });

  // Hook into close event (client disconnected before response finished)
  res.on('close', () => {
    clearTimeout(slowTimer);
    if (!res.writableFinished) {
      const duration = performance.now() - start;
      console.warn(
        `[CLIENT DISCONNECTED] ${method} ${url} after ${duration.toFixed(0)}ms ` +
          `(response not fully sent)`,
      );
    }
  });

  next();
}

const app = express();
app.use(requestTimingMiddleware);

app.get('/api/fast', (_req, res) => {
  res.json({ speed: 'fast' });
});

app.get('/api/slow', async (_req, res) => {
  // Simulate slow database query
  await new Promise((resolve) => setTimeout(resolve, 5000));
  res.json({ speed: 'slow' });
});

app.listen(3000, () => console.log('Listening on :3000'));
```

### Request Context in NestJS (ClsModule)

```typescript
// run: conceptual — NestJS application context required
import { Module } from '@nestjs/common';
import { ClsModule, ClsService } from 'nestjs-cls';
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

@Module({
  imports: [
    ClsModule.forRoot({
      // Automatically set up CLS context for each request
      middleware: {
        mount: true,
        setup: (cls, req) => {
          // Store request ID in CLS (backed by AsyncLocalStorage)
          cls.set('requestId', req.headers['x-request-id'] ?? randomUUID());
          cls.set('startTime', performance.now());
          cls.set('userId', undefined); // Set later by auth guard
        },
      },
    }),
  ],
})
export class AppModule {}

// Any injectable service can access the context without req/res
@Injectable()
export class OrdersService {
  constructor(private readonly cls: ClsService) {}

  async createOrder(data: { productId: string; quantity: number }): Promise<void> {
    const requestId = this.cls.get('requestId');
    const userId = this.cls.get('userId');

    console.log(`[${requestId}] Creating order for user ${userId}`);
    // No need to pass requestId through every function call
  }
}
```

**CLS vs request-scoped providers:** NestJS offers `@Injectable({ scope: Scope.REQUEST })` which creates a new provider instance per request. This works but has a significant cost: every provider that depends on a request-scoped provider also becomes request-scoped, cascading through the DI tree. CLS (backed by `AsyncLocalStorage`) avoids this — providers remain singleton-scoped while accessing per-request data through the CLS store. Prefer CLS for request context; use request scope only when the provider itself genuinely needs a unique instance per request.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Request ID not propagated to downstream services.**
You generate `X-Request-Id` in your API gateway but do not forward it when calling internal microservices. Symptom: logs from different services cannot be correlated — you see the request enter the gateway but lose the trail. Fix: when making outbound HTTP calls, always read the current request ID from `AsyncLocalStorage` and set it as a header: `headers: { 'X-Request-Id': getRequestId() }`.

**2. Raw body consumed by JSON parser — webhook verification fails.**
Express processes middleware in order. If `express.json()` runs before your Stripe webhook route, it parses (and consumes) the body. When you try to verify the Stripe signature against the raw body, you get the *serialized-back-to-string* version, which may differ from the original bytes (key ordering, whitespace). Symptom: `stripe.webhooks.constructEvent` always throws "Signature verification failed." Fix: mount `express.raw()` on webhook routes *before* the global `express.json()`, or use route-specific middleware.

**3. Body size limit too low — legitimate large requests rejected.**
The default `express.json()` limit is 100KB. A single request with a nested GraphQL query, an array of 500 items, or a base64-encoded file easily exceeds this. Symptom: `413 Payload Too Large` with no useful error message in the client. Fix: set explicit limits per route. Keep the global limit conservative (1MB) and raise it only on specific endpoints that need it.

**4. Multer memory storage with large files — OOM kill.**
Using `multer.memoryStorage()` for a file upload endpoint that accepts 100MB files. Each concurrent upload buffers the entire file in Node's heap. 10 concurrent uploads = 1GB of heap. Symptom: Node process killed by the OS OOM killer, or V8 heap allocation failure. Fix: use `multer.diskStorage()` or stream directly to S3 using presigned URLs (no file touches your server at all).
:::

## 🎯 Checkpoint

::: details Question 1 — AsyncLocalStorage vs passing context
**Q:** Why use `AsyncLocalStorage` for request context instead of simply passing a `context` object through every function call? What are the trade-offs?

**A:** Passing context explicitly is type-safe and makes dependencies visible, but it pollutes every function signature in the call chain — `createOrder(ctx, data)`, `validateInventory(ctx, productId)`, `logQuery(ctx, sql)`. In a deep call stack (handler → service → repository → logger → metric), every layer must accept and forward the context. `AsyncLocalStorage` eliminates this by storing context in a per-async-chain storage that any function can read without it being passed as a parameter. Trade-offs: (1) ALS has a ~5-8% performance overhead per `getStore()` call (negligible for most apps, measurable at >50K rps), (2) context is invisible in function signatures (harder to test — you must wrap tests in `store.run()`), (3) context can break in certain edge cases (manual `setTimeout` callbacks lose context in older Node versions, though Node 22 handles this correctly). For request ID and logging context, ALS wins. For business logic dependencies, explicit passing is often clearer.
:::

::: details Question 2 — Raw body for webhook verification
**Q:** Explain why webhook signature verification requires the raw request body, not the parsed JSON object. What specifically goes wrong if you use `JSON.stringify(req.body)` instead?

**A:** Webhook providers (Stripe, GitHub, Slack) compute an HMAC signature over the exact bytes they sent. When `express.json()` parses the body, it deserializes JSON into a JavaScript object, then discards the original bytes. If you `JSON.stringify(req.body)` to get bytes back, the output may differ from the original: (1) key ordering is not guaranteed by `JSON.stringify`, (2) whitespace and formatting may differ, (3) Unicode escape sequences may be normalized differently, (4) numeric precision may change. Any byte-level difference produces a different HMAC hash, causing verification to fail. The fix is to capture the raw `Buffer` before any parsing occurs, using `express.raw()` or the `verify` callback in `express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } })`.
:::

::: details Question 3 — CLS vs request-scoped providers in NestJS
**Q:** A NestJS application has 50 services, and 3 of them need access to the current user's ID. If you make `AuthService` request-scoped, what happens to the DI tree? How does CLS avoid this problem?

**A:** In NestJS, if `AuthService` is `@Injectable({ scope: Scope.REQUEST })`, every provider that injects `AuthService` — directly or transitively — also becomes request-scoped. If `OrdersService` injects `AuthService`, and `PaymentService` injects `OrdersService`, both become request-scoped. This cascades through the DI tree. Instead of 50 singleton instances created once at startup, you now create dozens of new instances *per request*, increasing GC pressure and startup latency for each request. CLS (`nestjs-cls`) avoids this entirely: all 50 services remain singletons. The 3 services that need the user ID call `this.cls.get('userId')`, reading from the `AsyncLocalStorage` context that was set once in middleware. No DI scope changes, no cascading instantiation, no per-request overhead beyond the ALS lookup.
:::

## Key Mental Models

- **Request ID is the thread that ties distributed logs together.** Generate it at the edge, propagate it to every downstream call.
- **AsyncLocalStorage is implicit context; function parameters are explicit context.** Use ALS for cross-cutting concerns (logging, tracing), explicit params for business logic dependencies.
- **Body parsing is content-type dispatch.** JSON, URL-encoded, raw, and multipart each need a different parser. The wrong parser gives you an empty or garbled body.
- **Raw body preservation is a byte-fidelity problem.** Webhooks need the exact bytes the sender transmitted, not a round-tripped JavaScript object.
- **CLS over request scope.** In NestJS, CLS gives you per-request data without the DI cascade cost of request-scoped providers.

## Related

- [AsyncLocalStorage & async_hooks](/nodejs/module-03/05-async-local-storage) — the runtime mechanism behind request context propagation
- [Structured Logging](/nodejs/module-09/02-structured-logging) — pino, log levels, and structured JSON logging
- [Provider Scopes & CLS](/frameworks/nestjs/03-provider-scopes) — NestJS provider lifecycle and CLS integration
- [OpenTelemetry](/nodejs/module-09/03-opentelemetry) — distributed tracing that builds on request context
