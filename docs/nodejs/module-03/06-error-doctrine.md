---
title: Error Doctrine
outline: deep
---

# Error Doctrine

| Interview weight | Node version | Prerequisites |
|---|---|---|
| :fire::fire::fire: Fundamental to production Node.js | `Error.cause` since Node 16.9; `process.on('unhandledRejection')` default behavior changed in Node 15 | [Promise Internals](./01-promise-internals), [Process Lifecycle](/nodejs/module-01/02-process-lifecycle) |

## :speaking_head: In Plain English

::: tip In Plain English
Imagine you are driving a car. A flat tire is annoying, but it is a known failure mode. You have a spare in the trunk, you know the procedure, you pull over, change it, and keep going. That is an *operational error* — a predictable problem from the environment that your system was designed to handle.

Now imagine your steering wheel detaches from the column while you are on the highway. That is not a flat tire. There is no procedure for that because it should never happen — it is a manufacturing defect. You do not try to "handle" it by steering with your knees. You stop the car immediately and call the manufacturer. That is a *programmer error* — a bug in the code itself.

This distinction is the single most important decision in error handling: **can I recover from this, or should I stop and fix the root cause?**

For flat tires (operational errors), you build recovery into the system. Retry the network call. Show the user a helpful message. Fall back to cached data. These errors are part of your contract with the outside world.

For detached steering wheels (programmer errors), you crash the process. Yes, deliberately. A process running with a bug it did not anticipate is like a car with a detached steering wheel — it is in an unknown state, and continuing to operate makes things worse. In containerized environments (Kubernetes, ECS), crashing is cheap. The orchestrator restarts a fresh process in seconds. The important thing is that you logged the error so someone can fix the manufacturing defect.

The rest of error handling follows from this one principle: classify every error as operational or programmer, then apply the right response. Operational errors get graceful handling. Programmer errors get a crash, a log, and a code fix.
:::

## :gear: Under the Hood

### The fundamental distinction

| | Operational error | Programmer error |
|---|---|---|
| **Definition** | Expected failure from the environment | Bug in your code |
| **Examples** | Network timeout, file not found, invalid user input, disk full | TypeError, null dereference, wrong arguments, assertion failure |
| **Can you recover?** | Yes — you designed for this | No — the process is in an unknown state |
| **Correct response** | Handle gracefully (retry, fallback, user message) | Crash, log, fix the code |
| **Whose fault?** | Nobody's — the world is unreliable | The developer's — the code is wrong |

### Custom error classes for classification

```typescript
// run: node --experimental-strip-types error-classes.ts

// Base class for all operational errors in your application
abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly isOperational: boolean;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = this.constructor.name;
  }
}

// Specific operational errors
class NotFoundError extends AppError {
  readonly statusCode = 404;
  readonly isOperational = true;

  constructor(resource: string, id: string, options?: ErrorOptions) {
    super(`${resource} with id '${id}' not found`, options);
  }
}

class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly isOperational = true;

  constructor(
    message: string,
    public readonly field: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

class ConflictError extends AppError {
  readonly statusCode = 409;
  readonly isOperational = true;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

// Usage
function findUser(id: string): { id: string; name: string } {
  if (id === "missing") {
    throw new NotFoundError("User", id);
  }
  return { id, name: "Alice" };
}

// Classification at the boundary
function isOperationalError(err: unknown): boolean {
  return err instanceof AppError && err.isOperational;
}

try {
  findUser("missing");
} catch (err) {
  if (isOperationalError(err)) {
    console.log("Operational — handle gracefully:", (err as AppError).message);
    console.log("Status code:", (err as AppError).statusCode);
  } else {
    console.log("Programmer error — crash");
    throw err;
  }
}
```

### Error wrapping with `Error.cause` (ES2022, Node 16.9+)

`Error.cause` preserves the full causal chain without losing the original stack trace.

```typescript
// run: node --experimental-strip-types error-cause.ts

class DatabaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DatabaseError";
  }
}

class ServiceError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ServiceError";
  }
}

// Low-level function throws a raw error
async function queryDatabase(sql: string): Promise<unknown[]> {
  // Simulate a connection refused error
  throw new Error(`ECONNREFUSED 127.0.0.1:5432`);
}

// Mid-level function wraps with context
async function getUserFromDb(userId: string): Promise<unknown> {
  try {
    return await queryDatabase(`SELECT * FROM users WHERE id = '${userId}'`);
  } catch (err) {
    throw new DatabaseError(`Failed to query user '${userId}'`, { cause: err });
  }
}

// High-level function wraps again
async function getUserProfile(userId: string): Promise<unknown> {
  try {
    return await getUserFromDb(userId);
  } catch (err) {
    throw new ServiceError(`Could not load profile for user '${userId}'`, {
      cause: err,
    });
  }
}

// Walking the cause chain
function getFullErrorChain(err: unknown): string[] {
  const chain: string[] = [];
  let current = err;
  while (current instanceof Error) {
    chain.push(`${current.name}: ${current.message}`);
    current = current.cause;
  }
  return chain;
}

getUserProfile("42").catch((err) => {
  console.log("Error chain:");
  for (const entry of getFullErrorChain(err)) {
    console.log("  ->", entry);
  }
  // Output:
  //   -> ServiceError: Could not load profile for user '42'
  //   -> DatabaseError: Failed to query user '42'
  //   -> Error: ECONNREFUSED 127.0.0.1:5432
});
```

### Graceful degradation vs fail-fast

| Strategy | When to use | Example |
|---|---|---|
| **Fail-fast** | Programmer errors; invariant violations; corrupted state | Assertion fails -> crash immediately |
| **Graceful degradation** | Operational errors; non-critical features; external dependency down | Recommendation engine down -> show popular items instead |

```typescript
// run: node --experimental-strip-types fail-fast-vs-degrade.ts

// FAIL-FAST: crash on impossible state (programmer error)
function processPayment(amount: number, currency: string): void {
  if (amount <= 0) {
    // This is a bug in the caller — the UI should have validated
    throw new Error(`Invariant violation: payment amount must be positive, got ${amount}`);
  }
  if (!["USD", "EUR", "GBP"].includes(currency)) {
    throw new Error(`Invariant violation: unsupported currency '${currency}'`);
  }
  console.log(`Processing ${currency} ${amount}`);
}

// GRACEFUL DEGRADATION: fallback on external dependency failure (operational error)
interface Product {
  id: string;
  name: string;
}

async function getRecommendations(userId: string): Promise<Product[]> {
  try {
    // Primary: ML recommendation service
    return await fetchFromRecommendationService(userId);
  } catch {
    console.warn("Recommendation service unavailable, falling back to popular items");
    // Fallback: static popular items
    return getPopularItems();
  }
}

async function fetchFromRecommendationService(_userId: string): Promise<Product[]> {
  throw new Error("Connection timeout"); // Simulated failure
}

function getPopularItems(): Product[] {
  return [{ id: "1", name: "Popular Item A" }];
}

// Demonstrations
processPayment(29.99, "USD"); // OK
getRecommendations("user-42").then((items) =>
  console.log("Got items:", items),
);

try {
  processPayment(-5, "USD"); // Crash — programmer error
} catch (err) {
  console.error("Caught programmer error:", (err as Error).message);
}
```

### Error handling in async code

```typescript
// run: node --experimental-strip-types async-error-patterns.ts

// Pattern 1: try/catch with async/await — the default choice
async function fetchUser(id: string): Promise<{ name: string }> {
  try {
    const response = await fetch(`https://httpbin.org/status/404`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching user ${id}`);
    }
    return await response.json() as { name: string };
  } catch (err) {
    // Wrap and rethrow with context
    throw new Error(`Failed to fetch user '${id}'`, { cause: err });
  }
}

// Pattern 2: .catch() for fire-and-forget side effects
function logAnalyticsEvent(event: string): void {
  // We don't want analytics failures to break the main flow
  sendToAnalytics(event).catch((err) => {
    console.warn("Analytics failed (non-critical):", (err as Error).message);
  });
}

async function sendToAnalytics(_event: string): Promise<void> {
  // fire-and-forget
}

// Pattern 3: Top-level error boundary
async function main(): Promise<void> {
  try {
    await fetchUser("42");
  } catch (err) {
    console.error("Request failed:", (err as Error).message);
  }

  logAnalyticsEvent("page_view");
  console.log("Main completed");
}

main();
```

### Process-level error handlers

```typescript
// run: node --experimental-strip-types process-errors.ts

// CRITICAL: these handlers are your last line of defense

// Unhandled promise rejection — log and crash
// Since Node 15, unhandled rejections throw by default
process.on("unhandledRejection", (reason: unknown, promise: Promise<unknown>) => {
  console.error("UNHANDLED REJECTION at:", promise, "reason:", reason);
  // Log to your error tracking service (Sentry, Datadog, etc.)
  // Then crash — don't swallow it
  process.exit(1);
});

// Uncaught exception — always crash after logging
process.on("uncaughtException", (err: Error, origin: string) => {
  console.error(`UNCAUGHT EXCEPTION (${origin}):`, err);
  // Perform synchronous cleanup only (flush logs, close DB connections)
  // NEVER try to resume normal operation
  process.exit(1);
});

// SIGTERM — graceful shutdown (not an error, but often confused with one)
process.on("SIGTERM", () => {
  console.log("Received SIGTERM — starting graceful shutdown");
  // Close server, drain connections, flush buffers
  process.exit(0);
});

console.log("Process error handlers registered");

// Demonstrate: this rejection will be caught by the handler above
// Uncomment to test:
// Promise.reject(new Error("unhandled!"));
```

### What NOT to do

```typescript
// run: node --experimental-strip-types error-antipatterns.ts

// ANTI-PATTERN 1: Silent swallowing
async function badFetch1(url: string): Promise<unknown> {
  try {
    const res = await fetch(url);
    return await res.json();
  } catch {
    // NEVER DO THIS — errors vanish silently
    return null;
  }
}

// ANTI-PATTERN 2: Catching errors you cannot handle
function badMiddleware(data: string): string {
  try {
    return JSON.parse(data); // If this throws, you have no recovery strategy
  } catch {
    return data; // Returning the raw string masks the real problem
  }
}

// ANTI-PATTERN 3: try/catch around every line
async function badGranularity(): Promise<void> {
  try { console.log("step 1"); } catch { /* */ }
  try { console.log("step 2"); } catch { /* */ }
  try { console.log("step 3"); } catch { /* */ }
  // This is not error handling — it is error denial
}

// ANTI-PATTERN 4: Returning error codes instead of throwing
function badGoStyle(id: string): { data: unknown; error: string | null } {
  // This is not idiomatic in TypeScript/Node.js
  // Use exceptions for exceptional conditions
  if (!id) return { data: null, error: "missing id" };
  return { data: { id }, error: null };
}

// CORRECT: Let errors propagate naturally
async function goodFetch(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

console.log("Anti-patterns demonstrated (see code comments)");
```

### Error classification decision tree

```
Is the error caused by a bug in my code?
├── YES → Programmer error
│   ├── Log with full stack trace + context
│   ├── Crash the process (let K8s/systemd restart)
│   └── Fix the code in the next deploy
│
└── NO → Operational error
    ├── Can I recover?
    │   ├── YES → Handle gracefully
    │   │   ├── Retry (with backoff) for transient failures
    │   │   ├── Fallback to cached/default data
    │   │   └── Return meaningful error to caller
    │   └── NO → Propagate to caller
    │       ├── Wrap with context (Error.cause)
    │       └── Let the error boundary handle it
    └── Is it critical?
        ├── YES → Alert on-call, degrade gracefully
        └── NO → Log warning, continue
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. Swallowed errors in `.catch(() => {})` create silent data loss**
- **Symptom:** Database writes or queue publishes silently fail. No errors in logs. Data is missing but nobody notices for hours or days.
- **Root cause:** A developer added `.catch(() => {})` to silence a noisy promise rejection during development and forgot to remove it.
- **Diagnosis:** Lint for empty catch blocks (`no-empty` ESLint rule). Require every `.catch()` to at least log a warning. Use `unhandledRejection` handler as a safety net.

**2. Catching `TypeError` as an operational error leads to corrupt state**
- **Symptom:** API returns `200 OK` with partial or wrong data. Downstream systems process garbage.
- **Root cause:** A broad `try/catch` catches a `TypeError` (reading property of `undefined`) and treats it as a recoverable error, returning a default value instead of crashing.
- **Diagnosis:** Inside catch blocks, check `err instanceof AppError` (or whatever your operational error base class is). If the error is not a known operational type, rethrow it.

**3. `process.on('uncaughtException')` used to "recover" instead of crash**
- **Symptom:** Memory leaks, stale connections, data corruption. The process is in an inconsistent state but keeps serving requests.
- **Root cause:** The handler swallows the exception and continues operation. Node's documentation explicitly warns: "It is not safe to resume normal operation after `uncaughtException`."
- **Diagnosis:** The `uncaughtException` handler should only perform synchronous cleanup (flush logs, close sockets) and then call `process.exit(1)`. Never `return` from it and continue.

**4. Missing `Error.cause` makes production debugging a guessing game**
- **Symptom:** Error logs show "Failed to process order" with no indication of *why* — was it a database timeout? A validation error? A network partition?
- **Root cause:** Errors are rethrown with a new message but the original error is discarded: `throw new Error('Failed to process order')` instead of `throw new Error('Failed to process order', { cause: originalError })`.
- **Diagnosis:** Adopt a team convention: every `catch`-and-rethrow must use `{ cause: err }`. Add a lint rule or code review checklist item.
:::

## :dart: Checkpoint

::: details Question 1 — Operational vs programmer
**Q:** Your HTTP handler receives a request with `Content-Type: application/json` but the body is `"{invalid json"`. Is this an operational error or a programmer error? How should you handle it?

**A:** This is an **operational error**. Invalid input from a client is an expected failure mode — you cannot control what clients send. Handle it gracefully: return a `400 Bad Request` response with a clear message like "Invalid JSON in request body." Do not crash the process. However, if your *own* code generates invalid JSON and tries to parse it, that would be a programmer error.
:::

::: details Question 2 — Error.cause
**Q:** What is the advantage of `throw new Error('User lookup failed', { cause: dbError })` over `throw new Error(`User lookup failed: ${dbError.message}`)`?

**A:** `Error.cause` preserves the **entire original error object** — including its stack trace, name, custom properties, and its own `cause` chain. String interpolation only captures the message, losing the stack trace and any structured metadata. With `cause`, debugging tools and logging libraries can walk the full chain and show exactly where each layer failed. Without it, you lose the stack trace of the root cause, making production debugging significantly harder.
:::

::: details Question 3 — uncaughtException
**Q:** A teammate proposes adding this handler: `process.on('uncaughtException', (err) => { logger.error(err); })` — with no `process.exit()`. What will happen?

**A:** The process will continue running in an **unknown, potentially corrupt state**. An uncaught exception means the code hit a path nobody anticipated — variables may be half-initialized, database transactions may be uncommitted, in-memory caches may be inconsistent. The Node.js documentation explicitly states: "It is not safe to resume normal operation after `uncaughtException`." The handler must call `process.exit(1)` after logging. In a containerized environment, the orchestrator will restart a fresh, clean process within seconds.
:::

## Key Mental Models

- **Classify first, handle second.** Every error is either operational (handle gracefully) or programmer (crash and fix). The response depends entirely on the classification.
- **Crash is a feature, not a failure.** In containerized environments, a crashed process is replaced in seconds. A process running with corrupt state can cause damage for hours.
- **`Error.cause` is non-negotiable.** Every catch-and-rethrow must preserve the original error. Losing the root cause stack trace turns debugging from minutes into hours.
- **Empty catch blocks are silent data loss.** If you cannot handle an error meaningfully, do not catch it. Let it propagate to a boundary that can.
- **Process-level handlers are the last resort, not the first.** `uncaughtException` and `unhandledRejection` exist to log and crash, never to recover.

## Related

- [Unhandled Rejections](./02-unhandled-rejections) — deep dive on promise rejection behavior across Node versions
- [Process Lifecycle](/nodejs/module-01/02-process-lifecycle) — how Node starts, runs, and exits
- [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown) — clean exit strategies in production
- [AbortController](./03-abort-controller) — cancellation patterns that interact with error handling
