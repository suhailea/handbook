---
title: Provider Scopes & CLS
outline: deep
---

# Provider Scopes & CLS

<Badge type="tip" text="Interview: Medium" /> <Badge type="warning" text="Prereqs: DI Container, AsyncLocalStorage" />

## 🗣️ In Plain English

::: tip In Plain English
Imagine a car rental company with three service tiers.

The first tier is the shuttle bus (DEFAULT scope, singleton). There is one bus, and every customer rides it. It is the cheapest option by far -- the company bought one bus and it serves everyone. The downside: you cannot personalize the ride. The radio station is the same for all passengers. This is what you use 99% of the time in NestJS, because most services do not need per-customer state.

The second tier is the personal rental car (REQUEST scope). Every customer gets a brand new car when they arrive, customized to their preferences -- their music, their seat position, their GPS destination. But the company must allocate a new car for every single trip and scrap it after. Worse, if the rental car needs a driver, the company hires a new driver for each trip too. And if the driver needs a uniform, a new uniform is made. The cost cascades through the entire supply chain. This is REQUEST scope: powerful but expensive, because every dependency in the chain becomes request-scoped too.

The third tier is the TRANSIENT scope -- like a disposable rental scooter. Every single person who asks for one gets a brand new scooter, even if two people in the same trip both ask. It is rarely needed.

Now here is the clever alternative: CLS (Continuation-Local Storage) is like keeping the shuttle bus but giving each passenger a personal briefcase. The bus (singleton service) is shared, but when a passenger needs to check their personal documents (the current user, the tenant ID), they open their own briefcase. The briefcase travels with them through the entire bus ride without anyone else seeing its contents. The company does not need extra buses or cars -- just briefcases. This is AsyncLocalStorage: you keep the performance of singletons while carrying per-request context.
:::

## ⚙️ Under the Hood

### The Three Scopes

NestJS provides three injection scopes, set via the `@Injectable()` decorator:

```typescript
import { Injectable, Scope } from '@nestjs/common';

@Injectable() // Default: Scope.DEFAULT (singleton)
export class UserService {}

@Injectable({ scope: Scope.REQUEST })
export class TenantService {}

@Injectable({ scope: Scope.TRANSIENT })
export class LoggerService {}
```

| Scope | Instances Created | Lifetime | Use Case |
|---|---|---|---|
| `DEFAULT` | 1 per app | App lifetime | Stateless services (most services) |
| `REQUEST` | 1 per incoming request | Request lifetime | Multi-tenant state, request-scoped DB connections |
| `TRANSIENT` | 1 per injection point | Consumer lifetime | Per-consumer isolated state (rare) |

### How Request Scope Propagates

This is the most important gotcha. When a provider is REQUEST-scoped, **every provider that depends on it must also become REQUEST-scoped**:

```typescript
@Injectable({ scope: Scope.REQUEST })
class TenantService {
  constructor(@Inject(REQUEST) private readonly request: Request) {
    this.tenantId = request.headers['x-tenant-id'] as string;
  }
  readonly tenantId: string;
}

@Injectable() // This is DEFAULT scope...
class UserService {
  constructor(private readonly tenantService: TenantService) {}
  // BUT because TenantService is REQUEST-scoped,
  // NestJS forces UserService to become REQUEST-scoped too!
}

@Injectable()
class OrderService {
  constructor(private readonly userService: UserService) {}
  // OrderService is also forced to REQUEST-scoped,
  // because UserService is now REQUEST-scoped.
}
```

This "infection" cascades up the entire dependency tree. What started as one REQUEST-scoped provider can force dozens of providers to be rebuilt on every request.

### The Performance Cost

With DEFAULT scope, the DI container resolves the entire dependency graph once at startup. With REQUEST scope, it must:

1. Create a new DI sub-container per request
2. Re-resolve the entire affected dependency tree
3. Instantiate every request-scoped provider and its dependents
4. Garbage-collect all instances after the request completes

```typescript
// With DEFAULT scope: one resolution at startup
// Startup: resolve A → B → C → D (once)
// Request 1: reuse A, B, C, D
// Request 2: reuse A, B, C, D
// Request N: reuse A, B, C, D

// With REQUEST scope on D:
// Request 1: create new D, new C(D), new B(C), new A(B)
// Request 2: create new D, new C(D), new B(C), new A(B)
// Request N: create new D, new C(D), new B(C), new A(B)  ← O(n) per request
```

Under high concurrency, this creates significant GC pressure and increases response latency. Benchmarks typically show 2-5x slower response times for request-scoped trees of 10+ providers.

### CLS with AsyncLocalStorage

Node.js's `AsyncLocalStorage` (stable since Node 16) provides a way to carry per-request context without changing provider scopes:

```typescript
import { AsyncLocalStorage } from 'node:async_hooks';

// A store that travels with the async context
interface RequestContext {
  tenantId: string;
  userId: string;
  correlationId: string;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
```

Set up as middleware to populate the store at the start of each request:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class ClsMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const context: RequestContext = {
      tenantId: req.headers['x-tenant-id'] as string,
      userId: req['user']?.id ?? 'anonymous',
      correlationId: req.headers['x-correlation-id'] as string ?? crypto.randomUUID(),
    };

    requestContext.run(context, () => next());
  }
}
```

Now any singleton provider can read request-specific data without being request-scoped:

```typescript
@Injectable() // Stays DEFAULT scope -- singleton!
export class TenantService {
  get tenantId(): string {
    const ctx = requestContext.getStore();
    if (!ctx) throw new Error('No request context available');
    return ctx.tenantId;
  }
}

@Injectable() // Also stays DEFAULT scope
export class UserService {
  constructor(private readonly tenantService: TenantService) {}

  findAll() {
    // tenantService.tenantId returns the correct tenant
    // for the CURRENT request, even in a singleton
    return this.db.query('SELECT * FROM users WHERE tenant = $1', [
      this.tenantService.tenantId,
    ]);
  }
}
```

### Using `nestjs-cls` (Community Library)

The `nestjs-cls` package wraps AsyncLocalStorage with NestJS-idiomatic APIs:

```typescript
// npm install nestjs-cls
import { ClsModule, ClsService } from 'nestjs-cls';

@Module({
  imports: [
    ClsModule.forRoot({
      middleware: {
        mount: true, // auto-mount middleware for all routes
        setup: (cls, req) => {
          cls.set('tenantId', req.headers['x-tenant-id']);
          cls.set('userId', req.user?.id);
        },
      },
    }),
  ],
})
export class AppModule {}

@Injectable()
export class TenantService {
  constructor(private readonly cls: ClsService) {}

  get tenantId(): string {
    return this.cls.get<string>('tenantId');
  }
}
```

### Comparison: Request Scope vs CLS

| Aspect | REQUEST Scope | CLS (AsyncLocalStorage) |
|---|---|---|
| **Performance** | O(n) instantiations per request | O(1) store lookup |
| **Scope propagation** | Infects entire dependency tree | No propagation; providers stay singleton |
| **Setup complexity** | Just add `{ scope: Scope.REQUEST }` | Need middleware + store setup |
| **Type safety** | Full (constructor injection) | Manual (string keys, or typed wrapper) |
| **Testing** | Automatic per-test isolation | Must manually set up store in tests |
| **GC pressure** | High (new instances every request) | Minimal (one Map per request) |
| **When to use** | Provider *instance* must differ per request (e.g., different DB connection per tenant) | Provider just needs to *read* request data (user, tenant ID, correlation ID) |

### When to Use Each

**Use REQUEST scope when:**
- The provider itself must be a fundamentally different instance per request -- for example, a database connection to a tenant-specific database with different credentials
- The dependency tree above it is small (2-3 providers)

**Use CLS / AsyncLocalStorage when:**
- You need to read request context (current user, tenant ID, correlation ID) from singleton services
- Performance matters (high-throughput APIs)
- The dependency tree is large and you want to avoid scope infection

**Use TRANSIENT scope when:**
- Each consumer of the provider needs its own isolated instance (e.g., a logger that includes the consumer's class name)
- The provider carries consumer-specific (not request-specific) configuration

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Scope infection tanks performance silently.** You add `Scope.REQUEST` to one small service. You don't realize that 15 other services depend on it transitively. Suddenly your API's p99 latency doubles and memory usage climbs. NestJS logs no warning about this. Profile with `onModuleInit` timing or a custom scope-audit script.

**2. AsyncLocalStorage store is `undefined` outside the request context.** If a singleton service is called from a CRON job, a queue consumer, or application bootstrap (not from an HTTP request), `requestContext.getStore()` returns `undefined`. Always guard against this with a null check or provide a fallback context for non-request execution paths.

**3. REQUEST-scoped providers break WebSocket gateways and microservice handlers.** The `REQUEST` object injected via `@Inject(REQUEST)` is HTTP-specific. WebSocket and microservice contexts have different shapes. If you register a REQUEST-scoped provider that expects `Request` from Express, it will receive an unexpected object in non-HTTP contexts.

**4. Mixing scopes across modules creates hard-to-trace bugs.** Module A exports a DEFAULT-scoped service. Module B imports it and also has a REQUEST-scoped service that depends on it. NestJS silently promotes Module A's service to REQUEST scope within Module B's context. The same class now has two different lifecycles depending on who injects it, leading to subtle state-sharing bugs.
:::

## 🎯 Checkpoint

::: details Question 1 -- Scope infection
**Q:** ServiceA (DEFAULT) depends on ServiceB (DEFAULT), which depends on ServiceC (REQUEST). What scope does ServiceA effectively run at?

**A:** REQUEST scope. NestJS forces every provider in the dependency chain above a REQUEST-scoped provider to also become request-scoped. ServiceB depends on ServiceC (REQUEST), so ServiceB becomes REQUEST-scoped. ServiceA depends on ServiceB (now REQUEST), so ServiceA also becomes REQUEST-scoped. All three are instantiated fresh on every request.
:::

::: details Question 2 -- CLS vs scope
**Q:** You need to access the current user's ID in a deeply nested service. The service has 10+ providers above it in the dependency tree. Should you use REQUEST scope or CLS?

**A:** CLS (AsyncLocalStorage). Making the service REQUEST-scoped would force all 10+ providers in the chain to rebuild on every request, causing significant performance degradation. With CLS, all providers remain singletons. You set up middleware to store the user ID in AsyncLocalStorage at the start of the request, and the deeply nested service reads it via `getStore()` in O(1) time.
:::

::: details Question 3 -- TRANSIENT use case
**Q:** You want each service that injects a Logger to get a Logger instance pre-configured with that service's class name. Which scope should Logger use?

**A:** TRANSIENT scope. Each injection point receives its own Logger instance. Combined with `@Inject(INQUIRER)`, the Logger can discover which class injected it and auto-configure the class name prefix. REQUEST scope would be wrong because the Logger doesn't need per-request isolation -- it needs per-consumer isolation.
:::

## Key Mental Models

- **DEFAULT scope is the happy path.** Singletons are fast, predictable, and sufficient for stateless services. Start here and deviate only when you must.
- **REQUEST scope is viral.** One request-scoped provider infects its entire dependency tree upward. Measure the cost before using it.
- **CLS is the performance escape hatch.** AsyncLocalStorage gives you per-request data in singleton providers -- the best of both worlds.
- **Scope choice is a performance vs convenience trade-off.** REQUEST scope is automatic but expensive; CLS is cheap but requires manual setup.
- **Always guard `getStore()` against `undefined`.** Code that runs outside an HTTP request context (CRON, queues, startup) has no store.

## Related

- [DI Container & reflect-metadata](./01-di-container)
- [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage)
- [Request Lifecycle](./02-request-lifecycle)
