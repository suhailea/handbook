---
title: "Request Validation & Error Handling"
outline: deep
---

# Request Validation & Error Handling

| Interview weight | Node version | Prerequisites |
|---|---|---|
| :fire::fire::fire: | Node 22+ (examples use native fetch, `node:test`) | [REST Best Practices](./01-rest-best-practices), [Error Doctrine](/nodejs/module-03/06-error-doctrine) |

## 🗣️ In Plain English

::: tip In Plain English
Think of your API as a nightclub with a bouncer at the door. The bouncer's job is simple: check IDs before anyone gets in. They do not care what happens on the dance floor — they just make sure no one enters who should not be there.

Validation is that bouncer. It sits at the very edge of your application — the API boundary — and inspects every piece of incoming data before it reaches your business logic. The body, the URL parameters, the query string, the headers — everything is suspect until checked.

Why not just let the business logic deal with bad data? Because by that time, you might have already started a database transaction, sent a message to a queue, or called a third-party API. Catching "email is missing" after you have already charged a credit card is much worse than catching it at the door.

The bouncer also needs a consistent way to tell people *why* they were rejected. "You cannot come in" is useless. "Your ID is expired" is actionable. Similarly, your API should not just say "Bad Request" — it should say "The field 'email' must be a valid email address" in a predictable format that every client can parse the same way.

A good bouncer also does not modify people — they do not trim beards or change outfits. In API terms, be cautious about *sanitizing* input (silently modifying it). It is usually safer to reject invalid data than to guess what the client meant. The one exception is harmless normalization like trimming whitespace, which people genuinely do not intend to include.
:::

## ⚙️ Under the Hood

### Zod — Schema-First Validation with TypeScript Inference

Zod is the dominant validation library in the TypeScript ecosystem. You define a schema, and Zod infers the TypeScript type from it — one source of truth for both runtime validation and compile-time types.

```ts
// run: node --experimental-strip-types zod-demo.ts
// requires: npm install zod

import { z } from 'zod';

// Define the schema — this IS the type
const CreateUserSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  age: z.number().int().min(18).max(150).optional(),
  role: z.enum(['user', 'admin']).default('user'),
  tags: z.array(z.string()).max(10).default([]),
});

// Infer the TypeScript type from the schema
type CreateUserInput = z.infer<typeof CreateUserSchema>;
// Equivalent to:
// { name: string; email: string; age?: number; role: 'user' | 'admin'; tags: string[] }

// .parse() throws on invalid input
try {
  const user = CreateUserSchema.parse({
    name: '',
    email: 'not-an-email',
    age: -5,
  });
} catch (err) {
  if (err instanceof z.ZodError) {
    console.log(err.issues);
    // [
    //   { code: 'too_small', minimum: 1, path: ['name'], message: 'String must contain at least 1 character(s)' },
    //   { code: 'invalid_string', path: ['email'], message: 'Invalid email' },
    //   { code: 'too_small', minimum: 18, path: ['age'], message: 'Number must be greater than or equal to 18' },
    // ]
  }
}

// .safeParse() returns a discriminated union — no try/catch needed
const result = CreateUserSchema.safeParse({ name: 'Alice', email: 'a@b.com' });
if (result.success) {
  console.log(result.data);  // Typed as CreateUserInput
} else {
  console.log(result.error.issues);  // ZodIssue[]
}
```

### Validation Middleware Pattern

Validate body, params, and query separately with a generic middleware:

```ts
// run: node --experimental-strip-types validation-middleware.ts
// requires: npm install zod

import { z, ZodSchema, ZodError } from 'zod';
import { IncomingMessage, ServerResponse, createServer } from 'node:http';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  errors?: Array<{ field: string; message: string; code: string }>;
}

function zodErrorToProblem(err: ZodError): ProblemDetails {
  return {
    type: 'https://api.example.com/errors/validation',
    title: 'Validation Failed',
    status: 422,
    detail: 'The request body contains invalid fields.',
    errors: err.issues.map((issue) => ({
      field: issue.path.join('.'),
      message: issue.message,
      code: issue.code,
    })),
  };
}

// Express-style middleware (conceptual — works with any framework)
function validateBody<T>(schema: ZodSchema<T>) {
  return (req: IncomingMessage & { body?: unknown; validatedBody?: T },
          res: ServerResponse,
          next: (err?: Error) => void) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const problem = zodErrorToProblem(result.error);
      res.writeHead(problem.status, {
        'Content-Type': 'application/problem+json',
      });
      res.end(JSON.stringify(problem));
      return;
    }
    req.validatedBody = result.data;
    next();
  };
}

// Usage in a route:
// app.post('/users', validateBody(CreateUserSchema), (req, res) => {
//   const user = req.validatedBody;  // Fully typed, guaranteed valid
// });
```

### class-validator + class-transformer (NestJS Style)

NestJS uses decorator-based validation via `class-validator` and its built-in `ValidationPipe`:

```ts
// Conceptual — runs inside NestJS
// requires: npm install class-validator class-transformer

import { IsString, IsEmail, IsOptional, IsInt, Min, Max, IsEnum } from 'class-validator';

class CreateUserDto {
  @IsString()
  @Min(1)
  name!: string;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsInt()
  @Min(18)
  @Max(150)
  age?: number;

  @IsEnum(['user', 'admin'])
  role: string = 'user';
}

// In the NestJS controller:
// @Post('users')
// create(@Body() dto: CreateUserDto) {
//   // dto is already validated by ValidationPipe
//   // NestJS returns 400 with error details automatically
// }

// NestJS's ValidationPipe internally:
// 1. Uses class-transformer to instantiate the DTO class from plain JSON
// 2. Runs class-validator decorators against the instance
// 3. If validation fails, throws BadRequestException with field-level errors
// 4. Requires tsconfig: "emitDecoratorMetadata": true
```

**Zod vs class-validator trade-offs:**

| | Zod | class-validator |
|---|---|---|
| Style | Functional, schema-first | Decorator-based, class-first |
| TS inference | Automatic from schema | Manual (decorators do not infer types) |
| Bundle size | ~13 KB | ~50 KB + class-transformer |
| NestJS integration | Via `nestjs-zod` or custom pipe | Built-in `ValidationPipe` |
| Composability | Chain methods, `.transform()`, `.refine()` | Limited — custom decorators for complex rules |
| `emitDecoratorMetadata` | Not needed | Required (and has perf/compatibility implications) |

### Error Classification at the API Level

```ts
// run: node --experimental-strip-types error-classification.ts

// Map internal error types to HTTP responses

class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorType: string,
    public readonly isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Specific error factories
class NotFoundError extends AppError {
  constructor(resource: string, id: string | number) {
    super(
      `${resource} with id '${id}' not found`,
      404,
      'https://api.example.com/errors/not-found',
    );
  }
}

class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'https://api.example.com/errors/conflict');
  }
}

class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly fieldErrors: Array<{ field: string; message: string }>,
  ) {
    super(message, 422, 'https://api.example.com/errors/validation');
  }
}

// 4xx = client's fault (operational) — log at warn level, do not page
// 5xx = server's fault (bug or infra) — log at error level, page on-call
// This distinction drives monitoring and alerting:
// - 4xx rate spike → possible client bug, API abuse, or breaking change
// - 5xx rate spike → your code is broken, wake someone up
```

### Global Error Handler Pattern

```ts
// run: node --experimental-strip-types global-error-handler.ts

import { createServer, IncomingMessage, ServerResponse } from 'node:http';

interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
}

function globalErrorHandler(
  err: unknown,
  req: IncomingMessage,
  res: ServerResponse,
  requestId: string,
): void {
  // Already sent headers — cannot change status code
  if (res.headersSent) {
    // Log and let the connection close
    console.error(JSON.stringify({
      level: 'error',
      requestId,
      message: 'Error after headers sent',
      error: err instanceof Error ? err.message : String(err),
    }));
    res.end();
    return;
  }

  // Known operational error
  if (err instanceof AppError && err.isOperational) {
    const problem: ProblemDetails = {
      type: err.errorType,
      title: err.name,
      status: err.statusCode,
      detail: err.message,
      instance: `/errors/${requestId}`,
    };
    res.writeHead(err.statusCode, {
      'Content-Type': 'application/problem+json',
      'X-Request-Id': requestId,
    });
    res.end(JSON.stringify(problem));
    return;
  }

  // Unknown error — programmer bug or unexpected failure
  console.error(JSON.stringify({
    level: 'error',
    requestId,
    message: 'Unhandled error',
    error: err instanceof Error ? err.stack : String(err),
  }));

  const problem: ProblemDetails = {
    type: 'https://api.example.com/errors/internal',
    title: 'Internal Server Error',
    status: 500,
    detail: 'An unexpected error occurred.',  // Never leak stack traces to clients
    instance: `/errors/${requestId}`,
  };
  res.writeHead(500, {
    'Content-Type': 'application/problem+json',
    'X-Request-Id': requestId,
  });
  res.end(JSON.stringify(problem));
}

// Express equivalent:
// app.use((err, req, res, next) => { ... })  // 4-arity = error middleware
//
// NestJS equivalent:
// @Catch() export class AllExceptionsFilter implements ExceptionFilter {
//   catch(exception: unknown, host: ArgumentsHost) { ... }
// }

class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly errorType: string,
    public readonly isOperational: boolean = true,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
```

### Sanitization vs Validation

```ts
// run: node --experimental-strip-types sanitization.ts

import { z } from 'zod';

// Prefer REJECTION over silent modification:
// If the client sends extra fields, strip them (principle of least surprise)
// If the client sends wrong types, reject — do not coerce

const StrictUserSchema = z.object({
  name: z.string()
    .trim()                          // OK: trim whitespace (harmless normalization)
    .min(1, 'Name is required'),
  email: z.string()
    .toLowerCase()                   // OK: emails are case-insensitive per RFC
    .email('Invalid email'),
  bio: z.string()
    .max(500)
    .optional(),
    // Do NOT sanitize HTML here — prefer output encoding (escape on render)
    // Server-side HTML stripping is lossy and error-prone
}).strict();  // .strict() rejects unknown fields instead of silently dropping them

// .strict() vs .strip() vs .passthrough():
// .strict()      — unknown keys → validation error (safest)
// .strip()       — unknown keys silently removed (default in Zod)
// .passthrough() — unknown keys kept as-is (dangerous — can inject unexpected data)
```

### File Upload Validation

```ts
// run: node --experimental-strip-types file-validation.ts

// Content-Type headers are client-controlled and CANNOT be trusted
// Always verify the actual file content via magic bytes

const MAGIC_BYTES: Record<string, Buffer> = {
  'image/png':  Buffer.from([0x89, 0x50, 0x4E, 0x47]),
  'image/jpeg': Buffer.from([0xFF, 0xD8, 0xFF]),
  'image/gif':  Buffer.from([0x47, 0x49, 0x46, 0x38]),
  'application/pdf': Buffer.from([0x25, 0x50, 0x44, 0x46]),
};

function detectFileType(buffer: Buffer): string | null {
  for (const [mime, magic] of Object.entries(MAGIC_BYTES)) {
    if (buffer.subarray(0, magic.length).equals(magic)) {
      return mime;
    }
  }
  return null;
}

function validateUpload(
  buffer: Buffer,
  declaredType: string,
  maxSizeBytes: number,
  allowedTypes: Set<string>,
): void {
  // 1. Check size
  if (buffer.length > maxSizeBytes) {
    throw new Error(`File exceeds maximum size of ${maxSizeBytes} bytes`);
  }

  // 2. Check actual type via magic bytes
  const actualType = detectFileType(buffer);
  if (!actualType) {
    throw new Error('Unrecognized file type');
  }

  // 3. Verify against allowlist
  if (!allowedTypes.has(actualType)) {
    throw new Error(`File type '${actualType}' is not allowed`);
  }

  // 4. Optionally verify declared type matches actual
  if (actualType !== declaredType) {
    console.warn(`Declared type '${declaredType}' does not match actual '${actualType}'`);
  }
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Validation after side effects.** A handler starts a database transaction, writes three rows, then validates the request body and discovers the email is invalid. Now you need to roll back. Worse: if you sent a welcome email before validation, you cannot un-send it. Always validate at the very start, before any business logic executes.

**2. Leaking stack traces in production error responses.** A 500 response contains `"detail": "TypeError: Cannot read properties of undefined (reading 'id') at UserService.findOne (/app/src/user.service.ts:42:15)"`. This reveals your file structure, framework, and the exact line of a bug. Attackers use this for reconnaissance. The global error handler must distinguish operational errors (safe to expose) from programmer errors (return a generic message, log the full stack internally).

**3. Inconsistent error shapes breaking frontend error rendering.** Endpoint A returns `{ errors: [{ field: "email", msg: "invalid" }] }`. Endpoint B returns `{ error: { message: "Invalid email" } }`. The frontend error display component cannot handle both shapes, so half the forms show raw JSON to the user. Fix: a single `ProblemDetails`-based error format enforced by a global error handler.

**4. Zod .strip() silently dropping fields the client sent intentionally.** A client sends `{ name: "Alice", role: "admin" }` to a schema that does not include `role`. Zod's default behavior strips it silently — no error, no trace. If the client expected `role` to be set, it is a silent bug. Use `.strict()` for APIs where you want to catch unexpected fields, especially for sensitive operations.
:::

## 🎯 Checkpoint

::: details Question 1 — Validation boundary
**Q:** Where should validation happen in the request lifecycle — in the controller, the service layer, or both? What are the trade-offs?

**A:** Validation should happen in two layers with different purposes. **API-level validation** (controller/middleware) checks the *shape* of the request: required fields present, correct types, string lengths, email format. This is structural validation — it answers "is this a well-formed request?" and rejects garbage early, before any business logic runs. **Domain-level validation** (service layer) checks *business rules*: does this email already exist, does the referenced order belong to this user, is the account balance sufficient? This requires database queries and business context the API layer does not have. The API layer uses Zod/class-validator. The domain layer uses custom checks and throws domain-specific errors. Skipping API-level validation risks processing invalid data. Skipping domain-level validation risks assuming structural validity guarantees business correctness.
:::

::: details Question 2 — safeParse vs parse
**Q:** When should you use Zod's `.safeParse()` over `.parse()`? What is the practical difference?

**A:** `.parse()` throws a `ZodError` on invalid input, which means you need try/catch and the error propagates up the call stack. `.safeParse()` returns a discriminated union: `{ success: true, data: T }` or `{ success: false, error: ZodError }`. Use `.safeParse()` when you want to handle validation failures as data flow (check the result, build a response) rather than exception flow. This is especially important in middleware patterns where you want to consistently transform validation errors into RFC 7807 responses. Use `.parse()` when you have a global error handler that catches `ZodError` and transforms it — this keeps the handler code cleaner (no if/else branching). In practice, `.safeParse()` is preferred in explicit validation middleware, while `.parse()` works well with NestJS-style exception filters or Express error middleware.
:::

::: details Question 3 — Magic bytes
**Q:** Why is Content-Type insufficient for file validation, and what are magic bytes?

**A:** The `Content-Type` header is set by the client and can be trivially spoofed. An attacker can upload a PHP shell script with `Content-Type: image/png` — if the server trusts the header and stores the file with a `.png` extension on a web server that also processes PHP, the script executes on access. Magic bytes (also called file signatures) are the first few bytes of a file that identify its format at the binary level. PNG files always start with `89 50 4E 47` (`.PNG`), JPEG with `FF D8 FF`, PDF with `%PDF`. By reading the actual bytes of the uploaded file and comparing against known signatures, you verify what the file *actually is* regardless of what the client *claims* it is. This is not foolproof — a carefully crafted polyglot file can have valid magic bytes for one format while being executable as another — but it catches the vast majority of mistyped or maliciously relabeled uploads.
:::

## Key Mental Models

- **Validate at the boundary, before any side effects.** The API edge is your bouncer. Once data passes validation, downstream code can trust it without re-checking.
- **Zod schemas are the single source of truth.** Define the schema once, infer the TypeScript type from it. Never maintain a separate interface that can drift out of sync with validation rules.
- **Rejection over sanitization.** Silently modifying client input creates invisible bugs. Reject invalid data with clear errors. Trim whitespace if you must, but do not guess intent.
- **4xx is the client's problem; 5xx is your problem.** This distinction drives alerting. A spike in 4xx rates means clients are confused (check your docs or recent breaking changes). A spike in 5xx means you broke something.
- **Never leak internals in error responses.** Stack traces, file paths, SQL queries, and framework details are gifts to attackers. Log them internally; return a generic message to the client.

## Related

- [REST Best Practices](./01-rest-best-practices) — the status codes and error format these patterns implement
- [Error Doctrine](/nodejs/module-03/06-error-doctrine) — operational vs programmer errors at the Node.js runtime level
- [File Uploads & Presigned URLs](./05-file-uploads) — deeper dive on file handling and streaming uploads
