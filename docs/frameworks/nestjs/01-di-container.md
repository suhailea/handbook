---
title: DI Container & reflect-metadata
outline: deep
---

# DI Container & reflect-metadata

<Badge type="tip" text="Interview: High" /> <Badge type="warning" text="Prereqs: TypeScript Decorators, Node.js Modules" />

## 🗣️ In Plain English

::: tip In Plain English
Think of a restaurant kitchen with a head chef who manages the entire staff. When a new dish (a controller) comes in as an order, the head chef looks at the recipe card (the constructor parameters) and knows exactly which sous-chef handles sauces, which prep cook handles vegetables, and which baker handles bread. Nobody in the kitchen has to shout "Hey, who makes the beurre blanc?" -- the head chef already has a roster and assigns the right person automatically.

When you write a NestJS controller and put `UserService` in its constructor, the head chef (the DI container) reads the recipe card (the reflect-metadata information) and sees "this dish needs UserService." It checks its roster, finds the registered UserService, and hands it over. If UserService itself needs a `DatabaseService`, the head chef resolves that too -- recursively, all the way down.

If someone requests a role that doesn't exist on the roster -- say, a pastry chef that was never hired -- the head chef immediately refuses with a clear error ("Nest can't resolve dependencies of UserController. Please make sure that UserService is available in the current context") rather than silently serving an incomplete dish.

The roster is organized by station (modules). The sauce station's recipes are private to that station by default. If the grill station needs a sauce, the sauce station must explicitly put it on the shared shelf (the `exports` array). This keeps the kitchen organized -- each station owns its own recipes and only shares what it chooses to.

Custom providers are like bringing in outside specialists. You can swap the regular sauce chef for a vegan sauce chef (`useClass`), bring in a pre-made sauce from a jar (`useValue`), have a consultant create a custom sauce based on tonight's menu (`useFactory`), or simply give the existing sauce chef a second name tag (`useExisting`).
:::

## ⚙️ Under the Hood

### Why `emitDecoratorMetadata` Matters

NestJS relies on TypeScript's experimental decorator metadata to read constructor parameter types at runtime. When you enable `emitDecoratorMetadata` in `tsconfig.json`, TypeScript emits calls to `Reflect.metadata()` that attach type information to decorated classes:

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

Without this flag, the compiled JavaScript has no record of what types the constructor expects. NestJS would see an empty parameter list and fail to resolve dependencies.

### How `reflect-metadata` Stores Type Information

The `reflect-metadata` polyfill provides the `Reflect.getMetadata` and `Reflect.defineMetadata` APIs. When TypeScript emits decorator metadata, it stores three keys:

| Metadata Key | What It Stores | Used By |
|---|---|---|
| `design:type` | The type of a property | Property injection |
| `design:paramtypes` | Constructor parameter types as an array | **Constructor injection (primary)** |
| `design:returntype` | Return type of a method | Method decorators |

NestJS reads `design:paramtypes` to discover what a class needs:

```typescript
import 'reflect-metadata';

@Injectable()
class UserService {
  constructor(
    private readonly db: DatabaseService,
    private readonly logger: LoggerService,
  ) {}
}

// At runtime, NestJS does this internally:
const params = Reflect.getMetadata('design:paramtypes', UserService);
// => [DatabaseService, LoggerService]
```

### The DI Container Resolution Algorithm

NestJS resolves dependencies using a recursive algorithm:

1. **Read constructor params** -- call `Reflect.getMetadata('design:paramtypes', TargetClass)` to get the array of parameter types.
2. **Check for `@Inject()` overrides** -- if a parameter uses `@Inject(TOKEN)`, use that token instead of the reflected type.
3. **Look up each token in the container** -- find the provider registered for that token in the current module (or imported modules).
4. **Recursively resolve** -- if the found provider has its own dependencies, resolve those first (depth-first).
5. **Detect circular dependencies** -- the container tracks the resolution chain. If it encounters a token it's already resolving, it throws a circular dependency error.
6. **Instantiate and cache** -- create the instance with all resolved dependencies and store it for future requests (singleton scope by default).

```typescript
// Simplified pseudocode of what the container does
function resolve<T>(token: Type<T>, resolutionChain: Set<Type>): T {
  if (resolutionChain.has(token)) {
    throw new CircularDependencyException(token);
  }
  resolutionChain.add(token);

  // Check if already instantiated (singleton cache)
  if (container.has(token)) {
    return container.get(token);
  }

  const paramTypes = Reflect.getMetadata('design:paramtypes', token) ?? [];
  const deps = paramTypes.map((dep) => resolve(dep, new Set(resolutionChain)));
  const instance = new token(...deps);

  container.set(token, instance);
  return instance;
}
```

### Custom Providers

NestJS supports four provider forms beyond the standard class registration:

```typescript
@Module({
  providers: [
    // Standard: shorthand for { provide: UserService, useClass: UserService }
    UserService,

    // useClass -- swap implementation (great for testing or strategy pattern)
    {
      provide: UserRepository,
      useClass:
        process.env.NODE_ENV === 'test'
          ? InMemoryUserRepository
          : PostgresUserRepository,
    },

    // useValue -- inject a constant, config object, or mock
    {
      provide: 'APP_CONFIG',
      useValue: { maxRetries: 3, timeout: 5000 },
    },

    // useFactory -- dynamic creation, supports async and injected deps
    {
      provide: 'DATABASE_CONNECTION',
      useFactory: async (configService: ConfigService) => {
        const conn = await createConnection(configService.get('DB_URL'));
        return conn;
      },
      inject: [ConfigService],
    },

    // useExisting -- alias one token to another
    {
      provide: 'AliasedLogger',
      useExisting: LoggerService,
    },
  ],
})
export class AppModule {}
```

### Injection Tokens and `@Inject()`

When the type alone is not enough -- for example, injecting an interface (which has no runtime representation), a config object, or a string/symbol token -- use `@Inject()`:

```typescript
// Define a token
const CACHE_MANAGER = Symbol('CACHE_MANAGER');

@Injectable()
class UserService {
  constructor(
    @Inject(CACHE_MANAGER) private readonly cache: CacheManager,
    @Inject('APP_CONFIG') private readonly config: AppConfig,
  ) {}
}
```

Without `@Inject()`, NestJS would try to read the reflected type. For interfaces, that reflected type is `Object` (interfaces are erased at runtime), so the container cannot resolve it.

### What NestJS Abstracts from Node Core

Without a DI container, you manually wire everything:

```typescript
// Manual wiring -- what you'd do without NestJS
import { createServer } from 'node:http';

const logger = new LoggerService();
const config = new ConfigService();
const db = new DatabaseService(config);
const userRepo = new UserRepository(db, logger);
const userService = new UserService(userRepo, logger);
const userController = new UserController(userService);

const server = createServer((req, res) => {
  // Manually route to userController...
});
server.listen(3000);
```

This breaks down fast: reordering constructors causes bugs, testing requires manual mock injection, and adding a new dependency means editing every file that instantiates the chain. NestJS eliminates this by managing the object graph automatically.

### Module Encapsulation

Providers are **private to their module** by default. A provider must be listed in `exports` to be available to other modules that import it:

```typescript
@Module({
  providers: [UserService, UserRepository], // both available inside this module
  exports: [UserService], // only UserService is available to importers
})
export class UserModule {}

@Module({
  imports: [UserModule], // can use UserService, NOT UserRepository
})
export class OrderModule {}
```

This encapsulation prevents modules from reaching into each other's internals and enforces clear API boundaries.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Missing `emitDecoratorMetadata` silently breaks DI.** If you remove or never set this flag, NestJS receives `undefined` for parameter types and throws cryptic errors like "Nest can't resolve dependencies of X (?). Please make sure that the argument at index [0] is available." Always verify `tsconfig.json` includes both `experimentalDecorators` and `emitDecoratorMetadata`.

**2. Circular dependencies cause runtime crashes, not compile errors.** If `ServiceA` depends on `ServiceB` and vice versa, TypeScript compiles fine. At runtime, NestJS throws `CircularDependencyException`. The fix: use `forwardRef(() => ServiceB)` in the `@Inject()` decorator, or redesign the dependency graph (preferred).

**3. Forgetting `exports` leads to "unknown provider" errors that seem like bugs.** You register a provider in Module A, import Module A in Module B, but forget to list the provider in Module A's `exports`. Module B gets "Nest can't resolve dependencies" even though everything looks correct. Always check `exports` first.

**4. `useFactory` with missing `inject` array.** If your factory function expects dependencies but you forget to list them in `inject`, the parameters arrive as `undefined`. No error is thrown -- the factory just receives `undefined` arguments and may produce a broken instance that fails much later.
:::

## 🎯 Checkpoint

::: details Question 1 -- What does emitDecoratorMetadata actually emit?
**Q:** What happens at the JavaScript level when `emitDecoratorMetadata` is enabled in tsconfig?

**A:** TypeScript inserts calls to `__decorate` and `__metadata` helper functions that invoke `Reflect.defineMetadata` with the keys `design:type`, `design:paramtypes`, and `design:returntype`. For constructors, `design:paramtypes` stores an array of the constructor's parameter types as references to their constructor functions. Without this flag, no metadata is emitted, and NestJS cannot determine what to inject.
:::

::: details Question 2 -- Singleton cache vs request scope
**Q:** If `UserService` is registered normally (no scope specified), how many instances exist in a running NestJS app?

**A:** Exactly one. The default scope is `DEFAULT` (singleton). The DI container instantiates it once during module initialization and returns the same instance for every injection point. This is why you should never store request-specific state on a singleton provider.
:::

::: details Question 3 -- Why can't you inject by interface?
**Q:** Why does `constructor(private readonly repo: IUserRepository)` fail without `@Inject()`?

**A:** TypeScript interfaces are erased during compilation -- they produce no runtime artifact. `Reflect.getMetadata('design:paramtypes', ...)` sees `Object` instead of a specific class constructor. You must use `@Inject()` with a string or symbol token to tell the container which provider to use.
:::

## Key Mental Models

- **DI is automatic wiring.** Instead of manually constructing dependency chains, you declare what you need and the container builds the graph.
- **Metadata is the bridge.** `reflect-metadata` turns TypeScript's static types into runtime data that the container can read.
- **Modules are boundaries.** Providers are private by default; `exports` is the explicit public API of a module.
- **Custom providers decouple interface from implementation.** `useClass`, `useValue`, `useFactory`, and `useExisting` let you swap, mock, or dynamically create any dependency.
- **Tokens solve the interface erasure problem.** When a class reference isn't available at runtime, string or symbol tokens plus `@Inject()` fill the gap.

## Related

- [Request Lifecycle](./02-request-lifecycle)
- [Provider Scopes & CLS](./03-provider-scopes)
- [The Middleware Stack (Express)](/frameworks/express/01-middleware-stack)
