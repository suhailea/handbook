---
title: Request Lifecycle
outline: deep
---

# Request Lifecycle

<Badge type="tip" text="Interview: High" /> <Badge type="warning" text="Prereqs: DI Container, Express Middleware" />

## 🗣️ In Plain English

::: tip In Plain English
Think of an airport security checkpoint that every passenger (request) must pass through in a strict order.

First, you show your boarding pass at the entrance (middleware). This is the most basic check -- the agent might stamp your pass, redirect you to a different terminal, or stop you entirely if you don't have a ticket. It is raw, simple, and runs before anything else.

Next, you reach the ID verification desk (guard). The officer checks your passport and boarding pass together. If you are not authorized for this flight, you are turned away with a "Forbidden" stamp and sent straight to the complaints desk (exception filter). No further checks happen.

If you pass ID verification, you enter the X-ray scanner tunnel (interceptor, pre-handler). This is where timing starts, bags are logged, and any last-minute adjustments happen before you proceed. The scanner wraps around the entire rest of your journey -- it sees you going in and coming out.

Then you walk through the metal detector (pipe). This validates your items one by one. Are your liquids under 100ml? Is your laptop out of the bag? Each item (parameter) is checked individually. If something is invalid, you are stopped.

Now you board the plane (handler). This is the actual work -- your controller method runs and produces a response.

On the way out, the X-ray scanner logs your exit (interceptor, post-handler). It can transform what you are carrying, add metadata, or measure how long the whole trip took.

If anything goes wrong at any stage, the complaints desk (exception filter) catches the problem and produces a structured response -- a polite error message instead of a crash.

The key insight: this pipeline runs in a guaranteed order every single time. Global-level checks run before controller-level, which run before route-level. Within the same level, they run in the order you registered them. This predictability is what makes NestJS applications debuggable.
:::

## ⚙️ Under the Hood

### The Full Request Pipeline

Every incoming request passes through these layers in this exact order:

```
Request
  │
  ▼
┌─────────────────────┐
│     Middleware       │  ← Express-style (req, res, next)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│       Guards         │  ← Returns boolean (canActivate)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Interceptors (pre) │  ← Before handler (RxJS Observable)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│        Pipes         │  ← Validate/transform per parameter
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│      Handler         │  ← Controller method
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│ Interceptors (post)  │  ← After handler (map/tap response)
└─────────┬───────────┘
          ▼
┌─────────────────────┐
│  Exception Filters   │  ← Catch thrown exceptions
└─────────┴───────────┘
          ▼
       Response
```

### What Each Layer Does

#### Middleware

Identical to Express middleware. Receives `req`, `res`, and `next`. Runs before NestJS's own pipeline begins:

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const correlationId =
      (req.headers['x-correlation-id'] as string) ?? crypto.randomUUID();
    req.headers['x-correlation-id'] = correlationId;
    res.setHeader('x-correlation-id', correlationId);
    next();
  }
}
```

Middleware is registered in the module's `configure()` method, not via decorators:

```typescript
@Module({})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```

#### Guards

Guards determine whether a request should proceed. They implement `CanActivate` and return a boolean (or Promise/Observable of boolean):

```typescript
import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.headers.authorization?.replace('Bearer ', '');

    if (!token) return false;

    const user = await this.authService.validateToken(token);
    request['user'] = user; // attach user to request
    return !!user;
  }
}
```

When a guard returns `false`, NestJS throws a `ForbiddenException` automatically. The request skips all subsequent layers and goes straight to exception filters.

#### Interceptors

Interceptors wrap the handler execution using RxJS Observables. They run both **before** and **after** the handler:

```typescript
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, tap, map } from 'rxjs';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const start = performance.now();

    return next.handle().pipe(
      // POST-handler: runs after the handler returns
      tap(() => {
        const ms = (performance.now() - start).toFixed(2);
        console.log(`${context.getHandler().name} took ${ms}ms`);
      }),
    );
  }
}

@Injectable()
export class ResponseWrapperInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((data) => ({
        success: true,
        data,
        timestamp: new Date().toISOString(),
      })),
    );
  }
}
```

The critical detail: `next.handle()` returns an Observable of the handler's return value. Everything before `next.handle()` is pre-handler; everything inside `pipe()` is post-handler.

#### Pipes

Pipes validate or transform individual handler parameters. They run per parameter, not per request:

```typescript
import {
  Controller,
  Get,
  Param,
  UsePipes,
  ValidationPipe,
  ParseIntPipe,
  Body,
} from '@nestjs/common';

@Controller('users')
export class UserController {
  // ParseIntPipe transforms the string "42" into the number 42
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.userService.findById(id);
  }

  // ValidationPipe validates the body against the DTO's class-validator decorators
  @Post()
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))
  create(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }
}
```

If validation fails, the pipe throws a `BadRequestException` with details about which fields failed.

#### Exception Filters

Exception filters catch thrown exceptions and convert them to HTTP responses:

```typescript
import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    response.status(status).json({
      statusCode: status,
      message: exception.message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

The default built-in exception filter handles any `HttpException` subclass. For non-HTTP exceptions, it returns a generic 500 Internal Server Error.

### Execution Order Guarantees

When multiple guards, interceptors, or pipes are registered, they execute in this precedence:

| Priority | Scope | Example |
|---|---|---|
| 1st (outermost) | Global | `app.useGlobalGuards(new AuthGuard())` |
| 2nd | Controller | `@UseGuards(RoleGuard)` on the class |
| 3rd (innermost) | Route | `@UseGuards(OwnerGuard)` on the method |

Within the same level, they run in **registration order** (left to right in the decorator array):

```typescript
// RoleGuard runs first, then ThrottleGuard
@UseGuards(RoleGuard, ThrottleGuard)
@Controller('admin')
export class AdminController {}
```

### The Execution Context

Guards, interceptors, and filters receive an `ExecutionContext` (or `ArgumentsHost`) that provides access to the current handler's metadata:

```typescript
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Read custom metadata set by a decorator
    const requiredRoles = this.reflector.get<string[]>(
      'roles',
      context.getHandler(),
    );

    if (!requiredRoles) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;
    return requiredRoles.some((role) => user.roles.includes(role));
  }
}
```

`ExecutionContext` extends `ArgumentsHost` and adds `getClass()` (the controller class) and `getHandler()` (the route method). This lets guards and interceptors make decisions based on which handler is about to execute, enabling metadata-driven logic via custom decorators.

### How Each Layer Maps to Express

| NestJS Layer | Express Equivalent | Key Difference |
|---|---|---|
| Middleware | `app.use(fn)` | Identical API |
| Guard | Auth middleware returning 403 | Returns boolean, not manual `res.status(403)` |
| Interceptor | No direct equivalent | Wraps handler; sees both request and response |
| Pipe | Validation middleware (e.g., Joi) | Per-parameter, not per-request |
| Exception Filter | Error middleware `(err, req, res, next)` | Type-safe, decorator-based routing |

### Short-Circuiting the Pipeline

Each layer can halt the pipeline:

```typescript
// Middleware: call res.send() instead of next()
use(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/health') {
    res.json({ status: 'ok' }); // pipeline stops here
    return;
  }
  next();
}

// Guard: return false → ForbiddenException → exception filter
canActivate(context: ExecutionContext): boolean {
  return false; // skips interceptors, pipes, handler
}

// Interceptor: return without calling next.handle()
intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
  const cached = this.cache.get(context.switchToHttp().getRequest().url);
  if (cached) {
    return of(cached); // handler never executes
  }
  return next.handle();
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Middleware runs outside NestJS's DI-aware pipeline.** If you throw an exception from middleware, the default NestJS exception filter does NOT catch it. It falls through to Express's default error handler. To handle errors in middleware, either call `next(error)` with Express error middleware, or move the logic to a guard or interceptor where NestJS filters apply.

**2. Global guards registered with `app.useGlobalGuards()` are not DI-aware.** They are instantiated outside the module system, so they cannot inject services. Use the module-based approach instead: `{ provide: APP_GUARD, useClass: AuthGuard }` in your module's providers array.

**3. Interceptor ordering surprises.** Because interceptors wrap the handler, the first interceptor's `pipe()` operators run last. If `InterceptorA` is registered before `InterceptorB`, A's pre-handler runs first, but A's post-handler runs after B's post-handler (onion model, like middleware). Getting this wrong leads to timing/logging interceptors reporting incorrect durations.

**4. Pipes throw `BadRequestException` by default.** If you have a global exception filter that only catches specific exception types (via `@Catch(SpecificError)`), validation errors from pipes will not be caught by your filter and will fall through to the default filter, producing an unexpected response format.
:::

## 🎯 Checkpoint

::: details Question 1 -- Pipeline order
**Q:** A request hits a route that has a global guard, a controller-level interceptor, and a route-level pipe. In what order do they execute?

**A:** Global guard runs first. If it returns true, the controller-level interceptor's pre-handler code runs next. Then the route-level pipe validates/transforms the parameter. Then the handler executes. Then the interceptor's post-handler code runs. If any layer throws, exception filters catch it (route-level filter first, then controller-level, then global).
:::

::: details Question 2 -- Guard vs middleware for auth
**Q:** Why should you prefer a guard over middleware for authentication in NestJS?

**A:** Guards have access to `ExecutionContext`, which tells you which controller and handler will run. This lets you read custom metadata (like `@Roles('admin')`) and make handler-specific authorization decisions. Middleware only sees `req` and `res` -- it has no knowledge of which NestJS handler will execute. Additionally, guards participate in the NestJS exception filter pipeline, while middleware exceptions do not.
:::

::: details Question 3 -- Interceptor short-circuit
**Q:** If an interceptor returns `of(cachedValue)` without calling `next.handle()`, what happens to pipes?

**A:** Pipes still run. Pipes execute before the handler (and before the interceptor calls `next.handle()`). The execution order is: guards, then interceptors' pre-handler code runs up to the point where `next.handle()` would be called, but pipes run as part of `next.handle()`. Actually, this is a common misconception. The precise order is: guards run, then interceptor pre-code runs, and when `next.handle()` is called, pipes run followed by the handler. If the interceptor never calls `next.handle()`, pipes and the handler are both skipped.
:::

## Key Mental Models

- **The pipeline is an onion.** Middleware is the outermost layer, the handler is the core. Each layer wraps the next, and execution flows in then back out.
- **Guards answer "should this request proceed?" -- nothing more.** They return a boolean. They do not transform the request or response.
- **Interceptors see both sides.** They are the only layer that can act on both the incoming request and the outgoing response in a single class.
- **Pipes are per-parameter, not per-request.** Each decorated parameter gets its own pipe execution. Think "validate this one argument" not "validate the whole request."
- **Exception filters are the safety net.** Any uncaught exception from any layer ends up here. Design your filters to handle the unexpected.

## Related

- [DI Container & reflect-metadata](./01-di-container)
- [Provider Scopes & CLS](./03-provider-scopes)
- [The Middleware Stack (Express)](/frameworks/express/01-middleware-stack)
- [Error Handling (Express)](/frameworks/express/02-error-handling)
