---
title: Request Validation with Zod
outline: deep
---

# Request Validation with Zod

Interview weight: 🔥🔥 | Node 22+ | TypeScript 5.x | Prerequisites: [Error Doctrine](/nodejs/module-03/06-error-doctrine), [The Middleware Stack](/frameworks/express/01-middleware-stack)

## 🗣️ In Plain English

::: tip In Plain English
Imagine a nightclub with a bouncer at the door. The bouncer has a checklist: you must have an ID (string, not expired), you must be on the guest list (known name), and you cannot bring in a bag larger than a certain size (number within range). The bouncer does not care what happens inside the club — their only job is to check every person against the rules *before* they walk in.

Zod is that bouncer for your API. Every request that arrives carries a body, URL parameters, and query strings — all of which are just raw text from the internet. Zod lets you write a description of exactly what shape that data should have. When a request arrives, Zod checks it against the description. If everything matches, the request walks in and your business logic can trust the data completely — no more "is this field actually a number?" checks scattered through your code. If something is wrong, Zod produces a detailed rejection list ("field `email` is not a valid email", "field `age` must be at least 18") and the request never reaches your handler at all.

The key insight is that Zod does double duty: it validates at runtime *and* generates TypeScript types at compile time from the same source. You write the schema once, and both the compiler and the runtime enforcer agree on what the data looks like. No drift between your types and your validation — they are literally the same object.
:::

## ⚙️ Under the Hood

### Basic Schema Definition

Zod schemas are composable objects that describe data shapes. Each schema is both a runtime validator and a TypeScript type source.

```typescript
// run: npx tsx request-validation-basics.ts
import { z } from 'zod';

// Define a schema for a user creation endpoint
const CreateUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain an uppercase letter')
    .regex(/[0-9]/, 'Password must contain a digit'),
  name: z.string().min(1).max(100),
  age: z.number().int().min(13).max(150).optional(),
  role: z.enum(['user', 'admin', 'moderator']).default('user'),
});

// Extract TypeScript type — zero drift between validation and types
type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Successful parse
const valid = CreateUserSchema.parse({
  email: 'suhail@example.com',
  password: 'Str0ngPass',
  name: 'Suhail',
});
console.log(valid); // typed as CreateUserInput, role defaults to 'user'

// safeParse returns a discriminated union — no throw
const result = CreateUserSchema.safeParse({ email: 'bad', password: '1' });
if (!result.success) {
  console.log(result.error.issues);
  // Each issue has: code, path, message
}
```

### Nested Objects, Arrays, and Coercion

```typescript
// run: npx tsx nested-validation.ts
import { z } from 'zod';

// Coercion: query params arrive as strings, coerce to number
const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['asc', 'desc']).default('desc'),
});

// Nested objects and arrays
const CreateOrderSchema = z.object({
  customerId: z.string().uuid('Invalid customer ID'),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1).max(999),
        notes: z.string().max(500).optional(),
      }),
    )
    .min(1, 'Order must have at least one item')
    .max(50, 'Order cannot exceed 50 items'),
  shippingAddress: z.object({
    street: z.string().min(1),
    city: z.string().min(1),
    country: z.string().length(2, 'Use ISO 3166-1 alpha-2'),
    postalCode: z.string().min(3).max(10),
  }),
  couponCode: z.string().optional(),
});

type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

// Coercion in action — "3" becomes 3
const pagination = PaginationSchema.parse({ page: '3', limit: '25' });
console.log(pagination); // { page: 3, limit: 25, sort: 'desc' }
```

### Discriminated Unions for Polymorphic Endpoints

```typescript
// run: npx tsx discriminated-union.ts
import { z } from 'zod';

// A notification endpoint that accepts different payload shapes
// depending on the "type" field
const NotificationSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    to: z.string().email(),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(10_000),
  }),
  z.object({
    type: z.literal('sms'),
    phoneNumber: z.string().regex(/^\+[1-9]\d{1,14}$/, 'E.164 format required'),
    message: z.string().min(1).max(160),
  }),
  z.object({
    type: z.literal('push'),
    deviceToken: z.string().min(1),
    title: z.string().max(100),
    body: z.string().max(500),
    data: z.record(z.string()).optional(),
  }),
]);

type NotificationInput = z.infer<typeof NotificationSchema>;

// TypeScript narrows correctly after parse
const notification = NotificationSchema.parse({
  type: 'email',
  to: 'user@example.com',
  subject: 'Welcome',
  body: 'Hello!',
});

if (notification.type === 'email') {
  // TypeScript knows notification.subject exists here
  console.log(notification.subject);
}
```

### Express Validation Middleware

The middleware pattern validates `req.body`, `req.params`, and `req.query` against separate schemas before the handler runs.

```typescript
// run: npx tsx express-zod-middleware.ts
import express, { type Request, type Response, type NextFunction } from 'express';
import { z, type ZodSchema, type ZodError } from 'zod';

// Generic validation middleware factory
interface ValidationSchemas {
  body?: ZodSchema;
  params?: ZodSchema;
  query?: ZodSchema;
}

function validate(schemas: ValidationSchemas) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: Array<{ location: string; issues: z.ZodIssue[] }> = [];

    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        errors.push({ location: 'body', issues: result.error.issues });
      } else {
        req.body = result.data; // Replace with parsed (coerced, defaulted) data
      }
    }

    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        errors.push({ location: 'params', issues: result.error.issues });
      }
    }

    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        errors.push({ location: 'query', issues: result.error.issues });
      } else {
        // Replace query with coerced values (e.g., string "5" → number 5)
        req.query = result.data;
      }
    }

    if (errors.length > 0) {
      res.status(400).json({
        error: 'Validation failed',
        details: errors.flatMap((e) =>
          e.issues.map((issue) => ({
            location: e.location,
            path: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        ),
      });
      return;
    }

    next();
  };
}

// Usage
const app = express();
app.use(express.json());

const CreateUserBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
});

const UserParams = z.object({
  id: z.string().uuid(),
});

app.post(
  '/users',
  validate({ body: CreateUserBody }),
  (req: Request, res: Response) => {
    // req.body is validated and typed
    const { email, name } = req.body;
    res.status(201).json({ email, name, id: crypto.randomUUID() });
  },
);

app.get(
  '/users/:id',
  validate({ params: UserParams }),
  (req: Request, res: Response) => {
    res.json({ id: req.params.id });
  },
);

app.listen(3000, () => console.log('Listening on :3000'));
```

### Custom Validators

```typescript
// run: npx tsx custom-validators.ts
import { z } from 'zod';

// Custom password strength validator
const StrongPassword = z
  .string()
  .min(8)
  .max(128)
  .refine((val) => /[A-Z]/.test(val), 'Must contain uppercase')
  .refine((val) => /[a-z]/.test(val), 'Must contain lowercase')
  .refine((val) => /[0-9]/.test(val), 'Must contain digit')
  .refine((val) => /[^A-Za-z0-9]/.test(val), 'Must contain special character');

// UUID that also checks version 4
const UUIDv4 = z.string().uuid().refine(
  (val) => val[14] === '4',
  'Must be UUID v4',
);

// Cross-field validation with superRefine
const DateRangeSchema = z
  .object({
    startDate: z.coerce.date(),
    endDate: z.coerce.date(),
  })
  .superRefine((data, ctx) => {
    if (data.endDate <= data.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endDate must be after startDate',
        path: ['endDate'],
      });
    }

    const maxRange = 90 * 24 * 60 * 60 * 1000; // 90 days
    if (data.endDate.getTime() - data.startDate.getTime() > maxRange) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Date range cannot exceed 90 days',
        path: ['endDate'],
      });
    }
  });

// Transform: parse and reshape in one step
const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  tags: z
    .string()
    .transform((val) => val.split(',').map((t) => t.trim().toLowerCase()))
    .pipe(z.array(z.string().min(1)).max(10))
    .optional(),
});

const parsed = SearchQuery.parse({ q: 'node streams', tags: 'Backend, Node, Streams' });
console.log(parsed.tags); // ['backend', 'node', 'streams']
```

### Zod + OpenAPI Generation

```typescript
// run: npx tsx zod-openapi.ts
import { z } from 'zod';
import { extendZodWithOpenApi, createDocument } from 'zod-openapi';

// Extend Zod with .openapi() method
extendZodWithOpenApi(z);

const UserSchema = z
  .object({
    id: z.string().uuid().openapi({ description: 'Unique user identifier', example: '550e8400-e29b-41d4-a716-446655440000' }),
    email: z.string().email().openapi({ description: 'User email address' }),
    name: z.string().min(1).max(100).openapi({ description: 'Display name' }),
    createdAt: z.string().datetime().openapi({ description: 'ISO 8601 creation timestamp' }),
  })
  .openapi({ ref: 'User', description: 'A registered user' });

const document = createDocument({
  openapi: '3.1.0',
  info: { title: 'User API', version: '1.0.0' },
  paths: {
    '/users': {
      post: {
        requestBody: {
          content: { 'application/json': { schema: UserSchema } },
        },
        responses: {
          '201': {
            description: 'User created',
            content: { 'application/json': { schema: UserSchema } },
          },
        },
      },
    },
  },
});

console.log(JSON.stringify(document, null, 2));
```

### Validation in NestJS: Zod Pipe vs class-validator

```typescript
// run: conceptual — NestJS application context required
import { PipeTransform, Injectable, BadRequestException, type ArgumentMetadata } from '@nestjs/common';
import { type ZodSchema, ZodError } from 'zod';

// Custom Zod validation pipe for NestJS
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private schema: ZodSchema) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);

    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        errors: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }

    return result.data;
  }
}

// Usage in a controller:
// @Post()
// create(@Body(new ZodValidationPipe(CreateUserSchema)) body: CreateUserInput) {
//   return this.usersService.create(body);
// }
```

**Zod vs class-validator trade-offs:**

| Aspect | Zod | class-validator |
|---|---|---|
| Type inference | Automatic via `z.infer` | Requires separate interface or duplicated decorators |
| Runtime overhead | Single parse call | Decorator reflection + metadata |
| Composability | Schemas are plain objects, compose with `.merge()`, `.extend()` | Class inheritance, harder to compose dynamically |
| NestJS integration | Requires custom pipe (above) | Built-in `ValidationPipe` — zero setup |
| OpenAPI generation | `zod-openapi` library | `@nestjs/swagger` decorators — more mature |
| Learning curve | Functional, chainable API | Decorator-based, familiar to NestJS developers |

For greenfield projects where you control the stack, Zod is typically more ergonomic. For NestJS projects already using `class-validator` across dozens of DTOs, switching has a high migration cost with marginal benefit.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. `.parse()` throws — unhandled in async handlers.**
If you call `schema.parse()` directly in an Express handler without try/catch, the `ZodError` becomes an unhandled exception. Express 4 does not catch async errors by default. Use `safeParse()` in middleware, or wrap handlers with an async error catcher. Express 5 and NestJS exception filters handle this correctly.

**2. Coercion hides type mismatches.**
`z.coerce.number()` converts `"abc"` to `NaN`, which then fails the subsequent `.int()` check — but the error message says "Expected integer, received nan" instead of "Expected number, received string." Debug by checking the raw input before coercion when error messages seem misleading.

**3. Large nested schemas slow down hot paths.**
Zod's parse is not free. On a schema with deeply nested objects, arrays of 1000+ items, and multiple `.refine()` calls, parse time can reach 5-15ms per request. For high-throughput endpoints (>5K rps), benchmark with `console.time` and consider pre-compiling schemas outside the request path (which Zod does by default if the schema is module-scoped, but not if you construct it dynamically per request).

**4. `.strip()` vs `.passthrough()` data loss.**
By default, `z.object()` strips unknown keys. If you rely on forwarding the full request body to another service, stripped fields silently disappear. Use `.passthrough()` when proxying, `.strict()` when you want unknown fields to be an error.
:::

## 🎯 Checkpoint

::: details Question 1 — safeParse vs parse
**Q:** When should you use `safeParse` instead of `parse`, and what is the structural difference in their return values?

**A:** Use `safeParse` when you want to handle validation errors as data (control flow) rather than exceptions (error flow). `parse` throws a `ZodError` on failure and returns the typed data on success. `safeParse` never throws — it returns a discriminated union: `{ success: true, data: T }` or `{ success: false, error: ZodError }`. In middleware, `safeParse` is preferred because it lets you format errors into a consistent API response without try/catch. In scripts or CLI tools where a failure is truly exceptional, `parse` with a top-level catch is fine.
:::

::: details Question 2 — discriminated union vs regular union
**Q:** Why does Zod offer `z.discriminatedUnion()` separately from `z.union()`? What is the performance and DX difference?

**A:** `z.union()` tries every member schema in order until one succeeds, which is O(n) in the number of members and produces confusing error messages (it reports errors from every failed branch). `z.discriminatedUnion()` takes a discriminant key (e.g., `type`), reads that field first, and jumps directly to the matching schema — O(1) lookup. Error messages are also clearer: "Invalid discriminator value. Expected 'email' | 'sms' | 'push'" instead of a wall of per-branch errors. Always prefer discriminated unions when your data has a type/kind/variant field.
:::

::: details Question 3 — Zod default stripping behavior
**Q:** A client sends `{ "name": "Alice", "role": "admin", "internalFlag": true }` to an endpoint whose schema is `z.object({ name: z.string(), role: z.enum(['user', 'admin']) })`. What does Zod do with `internalFlag` by default, and how could this default either protect you or cause a bug?

**A:** By default, `z.object()` uses `.strip()` mode, which silently removes unknown keys. `internalFlag` is dropped from the parsed output. This *protects* you against mass assignment attacks — a client cannot inject fields your schema does not declare. However, it *causes bugs* if your code passes the validated body to a downstream service or database query that expects those extra fields. If you forward bodies, use `.passthrough()`. If you want to reject unknown fields outright (strictest), use `.strict()`, which throws a `ZodError` with code `unrecognized_keys`.
:::

## Key Mental Models

- **Schema = runtime validator + compile-time type.** Write the shape once; Zod generates both the guard and the TypeScript type. No drift.
- **Validate at the boundary, trust inside.** Middleware validates; handlers and services never re-check the shape.
- **`safeParse` for control flow, `parse` for assertions.** Middleware should never throw for expected invalid input.
- **Coercion is for transport-layer mismatches.** Query params are always strings; `z.coerce.number()` bridges the gap between HTTP's string world and your typed domain.
- **Strip by default is a security feature.** Unknown fields disappear unless you explicitly opt in with `.passthrough()` or `.strict()`.

## Related

- [Request Validation & Error Handling](/nodejs/module-13/03-validation-error-handling) — the API design perspective on validation error formats
- [The Middleware Stack](/frameworks/express/01-middleware-stack) — how Express executes middleware in sequence
- [Error Doctrine](/nodejs/module-03/06-error-doctrine) — operational vs programmer errors and when to throw
