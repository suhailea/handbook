---
title: "Email, File Storage & External APIs"
outline: deep
---

# Email, File Storage & External APIs

| Interview weight | Node version | Prerequisites |
|---|---|---|
| 🔥🔥 | Node 22+ (native `fetch`) | [Scheduling Fundamentals](./01-scheduling-fundamentals), [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq), [AbortController](/nodejs/module-03/03-abort-controller) |

## 🗣️ In Plain English

::: tip In Plain English
Imagine you run a bakery with a front counter and a kitchen. A customer orders a birthday cake with a personalized message. You could stop everything, go to the kitchen, bake the cake, write the message, box it, and come back to the counter. But during that time, every other customer is staring at an empty counter wondering if the bakery is closed.

The smarter approach: write the order on a ticket, stick it on the kitchen's order rail, and go back to serving customers. The kitchen works through tickets in order. If the oven breaks, the ticket stays on the rail -- nobody loses the order. If a delivery driver comes for the cake, they wait until the ticket is done.

This is exactly how production systems handle external work -- sending emails, uploading files to cloud storage, calling third-party APIs, processing webhooks. You never do this work inline in a web request. You write a "ticket" (a queue job) and let a background worker handle it. The web request returns immediately, the user sees a fast response, and the work happens reliably in the background.

Why not inline? Three reasons. First, external services are slow -- a single email API call might take 2 seconds. Hold that connection open, and your server handles half as many requests. Second, external services fail -- the email provider might be down for 30 seconds. Your user should not stare at a spinner for 30 seconds. Third, external services have rate limits -- blast 10,000 emails in a loop, and the provider throttles you. A queue with concurrency controls processes them at a pace the provider accepts.

The pattern is always the same: validate the request, write a job to the queue, return a 202 (Accepted) to the client, and let the worker handle retries, failures, and rate limits.
:::

## ⚙️ Under the Hood

### Email: Never Send Inline

The golden rule: **never send an email inside an HTTP request handler.** Always enqueue it.

#### Nodemailer for SMTP

```ts
// run: npx tsx email-nodemailer.ts
// requires: SMTP server (use Ethereal for testing)

import { createTransport } from 'nodemailer';

// Create a reusable transporter — one per application, not per email
const transporter = createTransport({
  host: process.env.SMTP_HOST ?? 'smtp.ethereal.email',
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER ?? 'test@ethereal.email',
    pass: process.env.SMTP_PASS ?? 'testpassword',
  },
  pool: true,          // reuse connections
  maxConnections: 5,   // limit concurrent SMTP connections
  maxMessages: 100,    // messages per connection before reconnect
});

// Verify connection on startup — fail fast
await transporter.verify();
console.log('SMTP connection verified');

const info = await transporter.sendMail({
  from: '"My App" <noreply@myapp.com>',
  to: 'user@example.com',
  subject: 'Your order is confirmed',
  text: 'Order #12345 has been confirmed.',
  html: '<h1>Order Confirmed</h1><p>Order #12345 has been confirmed.</p>',
});

console.log('Message sent:', info.messageId);
```

#### AWS SES for Scale

```ts
// run: npx tsx email-ses.ts
// requires: AWS credentials configured

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

const ses = new SESClient({ region: process.env.AWS_REGION ?? 'us-east-1' });

const command = new SendEmailCommand({
  Source: 'noreply@myapp.com',
  Destination: {
    ToAddresses: ['user@example.com'],
  },
  Message: {
    Subject: { Data: 'Your order is confirmed' },
    Body: {
      Html: { Data: '<h1>Order Confirmed</h1><p>Order #12345.</p>' },
      Text: { Data: 'Order #12345 has been confirmed.' },
    },
  },
});

const result = await ses.send(command);
console.log('SES MessageId:', result.MessageId);
```

#### Email as a Queue Job (The Right Way)

```ts
// run: npx tsx email-queue.ts
// requires: Redis on localhost:6379

import { Queue, Worker } from 'bullmq';
import { createTransport } from 'nodemailer';

const connection = { host: 'localhost', port: 6379 };

// --- In your HTTP handler (producer) ---
const emailQueue = new Queue('emails', { connection });

// This is what your route handler calls — returns instantly
async function queueEmail(to: string, subject: string, html: string): Promise<string> {
  const job = await emailQueue.add('send-email', { to, subject, html }, {
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400 },   // keep completed jobs for 1 day
    removeOnFail: { age: 604800 },       // keep failed jobs for 7 days
  });
  return job.id!;
}

// Express/NestJS handler example:
// app.post('/orders', async (req, res) => {
//   const order = await createOrder(req.body);
//   await queueEmail(order.email, 'Order Confirmed', `<p>Order ${order.id}</p>`);
//   res.status(202).json({ orderId: order.id, message: 'Confirmation email queued' });
// });

// --- In a separate worker process (consumer) ---
const transporter = createTransport({
  host: process.env.SMTP_HOST ?? 'smtp.ethereal.email',
  port: 587,
  auth: {
    user: process.env.SMTP_USER ?? 'test',
    pass: process.env.SMTP_PASS ?? 'test',
  },
});

const worker = new Worker('emails', async (job) => {
  const { to, subject, html } = job.data;

  console.log(`[Attempt ${job.attemptsMade + 1}] Sending email to ${to}`);

  await transporter.sendMail({
    from: '"My App" <noreply@myapp.com>',
    to,
    subject,
    html,
  });

  console.log(`Email sent to ${to}`);
}, {
  connection,
  concurrency: 10, // process up to 10 emails simultaneously
  limiter: {
    max: 50,        // max 50 jobs
    duration: 1000,  // per 1 second — respects SES/SendGrid rate limits
  },
});

worker.on('failed', (job, err) => {
  console.error(`Email to ${job?.data.to} failed:`, err.message);
  if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
    console.error('Max retries reached — email will go to failed queue');
    // Alert the team, log to dead letter monitoring
  }
});

// Demo: queue an email
const jobId = await queueEmail('user@example.com', 'Test', '<p>Hello!</p>');
console.log('Queued email job:', jobId);
```

### S3 File Operations

#### Upload, Download, and Presigned URLs

```ts
// run: npx tsx s3-operations.ts
// requires: AWS credentials, S3 bucket

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { readFile } from 'node:fs/promises';

const s3 = new S3Client({ region: process.env.AWS_REGION ?? 'us-east-1' });
const BUCKET = process.env.S3_BUCKET ?? 'my-app-uploads';

// --- Upload a file ---
async function uploadFile(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    // ServerSideEncryption: 'AES256', // encrypt at rest
  }));
  console.log(`Uploaded: s3://${BUCKET}/${key}`);
}

// --- Generate a presigned upload URL (client uploads directly to S3) ---
async function getPresignedUploadUrl(key: string, contentType: string): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  // URL valid for 15 minutes
  return getSignedUrl(s3, command, { expiresIn: 900 });
}

// --- Generate a presigned download URL ---
async function getPresignedDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  // URL valid for 1 hour
  return getSignedUrl(s3, command, { expiresIn: 3600 });
}

// --- Delete a file ---
async function deleteFile(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  }));
  console.log(`Deleted: s3://${BUCKET}/${key}`);
}

// Demo
const fileBuffer = Buffer.from('Hello, world!');
const key = `uploads/${Date.now()}/hello.txt`;

await uploadFile(key, fileBuffer, 'text/plain');

const downloadUrl = await getPresignedDownloadUrl(key);
console.log('Download URL:', downloadUrl);

const uploadUrl = await getPresignedUploadUrl(`uploads/${Date.now()}/new.txt`, 'text/plain');
console.log('Presigned upload URL:', uploadUrl);
```

**Lifecycle policies:** Configure S3 lifecycle rules to automatically transition or delete objects:
- Move uploads older than 30 days to S3 Infrequent Access (cheaper storage).
- Delete temporary uploads (e.g., `tmp/` prefix) after 24 hours.
- Delete incomplete multipart uploads after 7 days (these silently accumulate and cost money).

### External API Resilience Patterns

Every call to an external service can fail. The patterns below protect your system.

#### Retry with Exponential Backoff

```ts
// run: npx tsx retry-backoff.ts

async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: { maxAttempts: number; baseDelay: number; maxDelay: number }
): Promise<T> {
  const { maxAttempts, baseDelay, maxDelay } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000); // 10s timeout

      try {
        const result = await fn(controller.signal);
        clearTimeout(timeout);
        return result;
      } catch (err) {
        clearTimeout(timeout);
        throw err;
      }
    } catch (err) {
      if (attempt === maxAttempts) throw err;

      // Exponential backoff with jitter
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000,
        maxDelay
      );
      console.log(`Attempt ${attempt} failed, retrying in ${Math.round(delay)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error('Unreachable');
}

// Usage
const data = await withRetry(
  async (signal) => {
    const res = await fetch('https://api.example.com/data', { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  { maxAttempts: 3, baseDelay: 1000, maxDelay: 30_000 }
);
```

#### Circuit Breaker

```ts
// run: npx tsx circuit-breaker.ts

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly threshold: number = 5,       // failures before opening
    private readonly resetTimeout: number = 30_000, // ms before trying again
    private readonly halfOpenMax: number = 3,       // successes to close
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        this.successCount = 0;
        console.log('Circuit: OPEN → HALF_OPEN');
      } else {
        throw new Error('Circuit breaker is OPEN — request rejected');
      }
    }

    try {
      const result = await fn();

      if (this.state === 'HALF_OPEN') {
        this.successCount++;
        if (this.successCount >= this.halfOpenMax) {
          this.state = 'CLOSED';
          this.failureCount = 0;
          console.log('Circuit: HALF_OPEN → CLOSED');
        }
      } else {
        this.failureCount = 0; // reset on success
      }

      return result;
    } catch (err) {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.threshold) {
        this.state = 'OPEN';
        console.log(`Circuit: → OPEN (${this.failureCount} failures)`);
      }

      throw err;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

// Usage
const breaker = new CircuitBreaker(3, 10_000);

for (let i = 0; i < 6; i++) {
  try {
    await breaker.execute(async () => {
      // Simulate a failing external API
      throw new Error('Service unavailable');
    });
  } catch (err) {
    console.log(`Request ${i + 1}: ${(err as Error).message} [${breaker.getState()}]`);
  }
}
```

#### Typed API Client

```ts
// run: npx tsx api-client.ts

interface PaymentIntent {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed';
}

class PaymentApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: unknown,
  ) {
    super(message);
    this.name = 'PaymentApiError';
  }
}

class PaymentClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: { baseUrl: string; apiKey: string }) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
  }

  async createPaymentIntent(
    amount: number,
    currency: string,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<PaymentIntent> {
    const res = await fetch(`${this.baseUrl}/payment-intents`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey, // Stripe-style idempotency
      },
      body: JSON.stringify({ amount, currency }),
      signal,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new PaymentApiError(
        `Payment API error: ${res.status}`,
        res.status,
        body,
      );
    }

    return res.json() as Promise<PaymentIntent>;
  }
}

// Usage — idempotency key prevents duplicate charges
const client = new PaymentClient({
  baseUrl: 'https://api.payments.example.com',
  apiKey: process.env.PAYMENT_API_KEY ?? 'test_key',
});

// The same idempotency key ensures this is safe to retry
// const intent = await client.createPaymentIntent(2500, 'usd', `order-${orderId}`);
```

### Webhook Consumption

When external services call your API (webhooks), three things matter: signature verification, idempotent processing, and async handling.

```ts
// run: npx tsx webhook-handler.ts

import { createHmac, timingSafeEqual } from 'node:crypto';
import { Queue } from 'bullmq';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? 'whsec_test123';
const connection = { host: 'localhost', port: 6379 };
const webhookQueue = new Queue('webhooks', { connection });

// --- Signature verification (Stripe-style) ---
function verifyWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): boolean {
  // Stripe signature format: t=timestamp,v1=signature
  const parts = signatureHeader.split(',');
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const signature = parts.find((p) => p.startsWith('v1='))?.slice(3);

  if (!timestamp || !signature) return false;

  // Reject if timestamp is too old (replay attack prevention)
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) return false; // 5 minute tolerance

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  // Timing-safe comparison prevents timing attacks
  return timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expected, 'hex'),
  );
}

// --- Webhook endpoint (Express-style pseudo-code) ---
async function handleWebhook(rawBody: string, headers: Record<string, string>): Promise<void> {
  // 1. Verify signature
  const sig = headers['stripe-signature'] ?? '';
  if (!verifyWebhookSignature(rawBody, sig, WEBHOOK_SECRET)) {
    throw new Error('Invalid webhook signature');
  }

  const event = JSON.parse(rawBody) as { id: string; type: string; data: unknown };

  // 2. Enqueue for async processing — return 200 immediately
  await webhookQueue.add(event.type, event, {
    jobId: event.id, // BullMQ deduplicates by jobId — idempotent
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  });

  // 3. The HTTP handler returns 200 here
  // The webhook provider sees success and does not retry
  console.log(`Webhook ${event.id} (${event.type}) queued for processing`);
}

// Demo
await handleWebhook(
  JSON.stringify({ id: 'evt_123', type: 'payment_intent.succeeded', data: {} }),
  { 'stripe-signature': 't=1234567890,v1=fakesig' } // would fail verification in real use
).catch((err) => console.log('Expected:', (err as Error).message));

await webhookQueue.close();
```

**Key webhook patterns:**
- **Always return 200/202 fast.** If your handler takes too long, the webhook provider retries, causing duplicates.
- **Use the event ID as the job ID** for built-in deduplication.
- **Process asynchronously.** The queue worker handles retries, not the webhook endpoint.
- **Store the raw event** before processing. If your processing logic has a bug, you can replay from stored events.

### Payment Integration (Stripe Pattern)

```ts
// run: npx tsx payment-stripe-pattern.ts

import { Queue, Worker } from 'bullmq';

const connection = { host: 'localhost', port: 6379 };
const paymentQueue = new Queue('payments', { connection });

// --- Creating a payment (in your order handler) ---
async function createOrder(orderId: string, amount: number): Promise<void> {
  // 1. Create order in database with status 'pending_payment'
  console.log(`Order ${orderId} created, status: pending_payment`);

  // 2. Create Stripe PaymentIntent (or enqueue it)
  await paymentQueue.add('create-payment-intent', {
    orderId,
    amount,
    currency: 'usd',
    idempotencyKey: `order-${orderId}`, // prevents duplicate charges on retry
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
  });
}

// --- Worker processes payment jobs ---
const worker = new Worker('payments', async (job) => {
  const { orderId, amount, currency, idempotencyKey } = job.data;

  console.log(`Processing payment for order ${orderId}: ${amount} ${currency}`);

  // Call Stripe API with idempotency key
  // const intent = await stripe.paymentIntents.create(
  //   { amount, currency, metadata: { orderId } },
  //   { idempotencyKey }
  // );

  // Update order with payment intent ID
  // await db.orders.update(orderId, { paymentIntentId: intent.id });
}, { connection });

// --- Webhook handler updates order status ---
const webhookWorker = new Worker('webhooks', async (job) => {
  if (job.name === 'payment_intent.succeeded') {
    const { data } = job.data;
    // const orderId = data.object.metadata.orderId;
    // await db.orders.update(orderId, { status: 'paid' });
    console.log('Payment succeeded, order updated');
  }

  if (job.name === 'payment_intent.payment_failed') {
    // await db.orders.update(orderId, { status: 'payment_failed' });
    // await emailQueue.add('send-email', { template: 'payment-failed', ... });
    console.log('Payment failed, user notified');
  }
}, { connection });

// Demo
await createOrder('ORD-001', 2500);

// Cleanup
setTimeout(async () => {
  await worker.close();
  await webhookWorker.close();
  await paymentQueue.close();
  process.exit(0);
}, 2000);
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Sending emails inline causes cascading timeouts.** Your `/register` endpoint sends a welcome email synchronously. The SMTP server takes 8 seconds to respond (DNS issue). Every registration request hangs for 8 seconds. Your connection pool fills up. Upstream requests start timing out. The entire API becomes unresponsive because of one slow email. Symptom: p99 latency spikes to 10+ seconds, 502s from the load balancer. Fix: enqueue the email via BullMQ. The registration endpoint returns in 50ms regardless of SMTP health.

**2. Presigned URL expiration leads to silent upload failures.** You generate a presigned S3 upload URL with a 5-minute expiry. The user starts a large file upload over a slow connection. At minute 6, the upload fails with a 403 Forbidden from S3. The frontend shows a generic error. The user retries and it works (new presigned URL). Symptom: intermittent upload failures correlated with file size. Fix: set presigned URL expiry generously (15-60 minutes), and implement multipart upload for large files (each part gets its own presigned URL).

**3. Missing webhook idempotency causes duplicate processing.** Stripe sends a `payment_intent.succeeded` webhook. Your handler processes it and credits the user's account. Due to network latency, your 200 response does not reach Stripe in time. Stripe retries the webhook. Your handler processes it again -- the user is credited twice. Symptom: account balances are higher than expected, financial reconciliation fails. Fix: use the event ID as a deduplication key. Check if the event has already been processed before acting on it.

**4. Circuit breaker not implemented -- one failing dependency takes down everything.** Your cron job calls a third-party analytics API. The API starts returning 500s. Your retry logic dutifully retries 3 times per request, with backoff. But the cron fires every minute, spawning new retry chains. After 10 minutes, you have dozens of concurrent retry chains hammering a dead API, consuming worker threads and memory. Symptom: event loop lag spikes, heap usage climbs, other jobs in the same queue stall. Fix: implement a circuit breaker that opens after N failures and rejects immediately for a cooldown period.
:::

## 🎯 Checkpoint

::: details Question 1 — Email queue design
**Q:** Your application sends transactional emails (order confirmation, password reset) and marketing emails (weekly newsletter to 50,000 users). Both currently go through the same BullMQ queue. What problems does this cause, and how would you redesign it?

**A:** The problem is priority inversion and rate limit interference. Marketing emails (50,000 jobs) flood the queue. A password reset email (time-sensitive, user is waiting) gets stuck behind thousands of newsletter emails. Additionally, blasting 50,000 emails saturates your email provider's rate limit, delaying transactional emails further.

Redesign: Use two separate queues -- `transactional-emails` and `marketing-emails`. The transactional queue has higher concurrency (process immediately) and no rate limiting beyond the provider's transactional limit. The marketing queue has lower concurrency and aggressive rate limiting (e.g., 100/second for SES). Additionally, use BullMQ's priority system within the transactional queue: password resets at priority 1, order confirmations at priority 5. For marketing, implement batching: send in groups of 100 with delays between batches. Monitor both queues independently -- a backup in the marketing queue is acceptable; a backup in the transactional queue is an incident.
:::

::: details Question 2 — Webhook reliability
**Q:** Your webhook endpoint receives Stripe events and processes them synchronously. Under load, the handler sometimes takes longer than 10 seconds. What happens, and how do you fix it?

**A:** Stripe's webhook delivery has a timeout (typically 20 seconds for initial attempts, shorter for retries). If your handler exceeds this, Stripe considers the delivery failed and retries. This creates a dangerous loop: the slow handler processes the event fully, but Stripe retries because it never received the 200 response. The retry triggers a second processing of the same event.

Fix: (1) The webhook endpoint should do minimal work -- verify the signature, parse the event, enqueue it in BullMQ with the event ID as the job ID (for deduplication), and return 200 immediately. Total time: < 100ms. (2) A separate worker processes the queued events at its own pace, with retries and error handling. (3) Use the event ID as an idempotency key in the worker: before processing, check if this event has already been handled (database flag or Redis key). (4) Store the raw event payload for replay capability if you discover a processing bug later.
:::

## Key Mental Models

- **External work belongs in a queue, not in a request handler.** Emails, file operations, API calls -- anything that touches an external service should be enqueued and processed asynchronously.
- **Idempotency keys make retries safe.** Whether it is Stripe's `Idempotency-Key` header or BullMQ's `jobId` deduplication, the pattern is the same: assign a deterministic ID so that duplicates are harmlessly ignored.
- **Presigned URLs push work to the client.** Instead of proxying file uploads through your server, let S3 handle the heavy lifting. Your server only generates the signed URL.
- **Circuit breakers prevent a dead dependency from killing your system.** Without them, retry storms against a failing API consume all your resources.
- **Webhooks are fire-and-forget from the sender's perspective.** Your receiver must be fast (return 200 immediately), idempotent (handle retries), and async (process in the background).

## Related

- [File Uploads & Presigned URLs](/nodejs/module-13/05-file-uploads) — deeper dive on upload patterns and multipart uploads
- [Delivery Semantics](/system-design/queues/03-delivery-semantics) — at-most-once, at-least-once, and the idempotency patterns that make retries safe
- [Distributed Failure Modes](/system-design/microservices/03-failure-modes) — circuit breakers, bulkheads, and timeout contracts in a microservices context
- [AbortController & AbortSignal](/nodejs/module-03/03-abort-controller) — cancelling in-flight external API calls
- [Scheduling Fundamentals](./01-scheduling-fundamentals) — cron-driven jobs that trigger external service calls
