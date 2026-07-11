---
title: Microservices Transports
outline: deep
---

# Microservices Transports

<Badge type="tip" text="Interview: Medium" /> <Badge type="warning" text="Prereqs: DI Container, Message Queues, gRPC basics" />

## 🗣️ In Plain English

::: tip In Plain English
Think of a universal remote control. You have one remote (NestJS's `@MessagePattern` and `@EventPattern` decorators) that works with any TV brand. Press "play" and it works whether the TV is a Samsung (Redis), an LG (Kafka), or a Sony (gRPC). You do not need to learn each brand's unique button layout -- the universal remote translates your intent into whatever signal that particular TV understands.

Your NestJS handler code stays the same regardless of which transport carries the message. You write `@MessagePattern('get_user')` once, and NestJS takes care of translating that into a Redis pub/sub subscription, a Kafka consumer, or a TCP socket listener depending on which transport you configure. Switching transports is a configuration change, not a code rewrite.

The remote supports two modes. The first is request-response: you press a button and wait for the TV to respond (like changing the channel and waiting for confirmation). This is `@MessagePattern` -- the caller sends a message and expects a reply. The second is fire-and-forget: you press the power button and walk away without waiting to see if the TV turned on. This is `@EventPattern` -- you emit an event and do not wait for a response.

You can even build a hybrid setup: your app handles both HTTP requests (the TV's built-in controls) and microservice messages (the remote control) simultaneously. One NestJS application, two communication styles.

The trade-off is the same as any universal remote: it covers the common buttons perfectly, but it does not have the special buttons that each brand's original remote offers. Kafka's consumer groups, Redis streams, NATS JetStream -- these brand-specific features may require you to reach past the abstraction and use the native client alongside NestJS's transport layer.
:::

## ⚙️ Under the Hood

### Architecture Overview

The `@nestjs/microservices` package provides a transport-agnostic layer over messaging. It has two sides:

- **Server side:** your NestJS app listens for messages and dispatches them to decorated handlers
- **Client side:** `ClientProxy` sends messages to other microservices

```typescript
// Server: handles incoming messages
// run: npx ts-node main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

const app = await NestFactory.createMicroservice<MicroserviceOptions>(
  AppModule,
  {
    transport: Transport.TCP,
    options: { host: '0.0.0.0', port: 3001 },
  },
);
await app.listen();
```

### Built-in Transports

| Transport | Use Case | Ordering | Delivery Guarantee | Throughput |
|---|---|---|---|---|
| **TCP** | Simple RPC between services | Per-connection | At-most-once | Medium |
| **Redis** | Pub/sub, lightweight eventing | None | At-most-once | High |
| **NATS** | Low-latency messaging | None (NATS core) | At-most-once | Very high |
| **MQTT** | IoT, constrained devices | Per-topic (QoS 1+) | At-least-once (QoS 1+) | Medium |
| **gRPC** | Strongly-typed service-to-service | Per-stream | At-most-once | Very high |
| **Kafka** | Event streaming, audit logs | Per-partition | At-least-once | Very high |
| **RabbitMQ** | Work queues, complex routing | Per-queue | At-least-once | High |

### The Message Pattern

NestJS provides two handler decorators for microservice communication:

#### Request-Response (`@MessagePattern`)

The caller sends a message and waits for a reply. Behaves like an RPC call:

```typescript
import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller()
export class UserController {
  constructor(private readonly userService: UserService) {}

  @MessagePattern('get_user')
  async getUser(@Payload() data: { id: number }) {
    return this.userService.findById(data.id);
    // Return value is sent back to the caller
  }

  @MessagePattern({ cmd: 'create_user' }) // object patterns also work
  async createUser(@Payload() data: CreateUserDto) {
    return this.userService.create(data);
  }
}
```

Client side -- sending a request and receiving a response:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class OrderService {
  constructor(
    @Inject('USER_SERVICE') private readonly userClient: ClientProxy,
  ) {}

  async getUser(userId: number) {
    // send() returns an Observable; use firstValueFrom to await it
    const user = await firstValueFrom(
      this.userClient.send('get_user', { id: userId }),
    );
    return user;
  }
}
```

Register the client in a module:

```typescript
import { Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';

@Module({
  imports: [
    ClientsModule.register([
      {
        name: 'USER_SERVICE',
        transport: Transport.TCP,
        options: { host: 'user-service', port: 3001 },
      },
    ]),
  ],
  providers: [OrderService],
})
export class OrderModule {}
```

#### Event-Based (`@EventPattern`)

Fire and forget. The sender emits an event and does not wait for a response:

```typescript
@Controller()
export class NotificationController {
  @EventPattern('user_created')
  async handleUserCreated(@Payload() data: { userId: number; email: string }) {
    await this.emailService.sendWelcomeEmail(data.email);
    // No return value -- the sender doesn't wait for this
  }
}

// Sender side
@Injectable()
export class UserService {
  constructor(
    @Inject('NOTIFICATION_SERVICE') private readonly client: ClientProxy,
  ) {}

  async createUser(dto: CreateUserDto) {
    const user = await this.userRepo.save(dto);

    // emit() returns an Observable but doesn't wait for a response
    this.client.emit('user_created', {
      userId: user.id,
      email: user.email,
    });

    return user;
  }
}
```

### Hybrid Applications

A single NestJS app can serve both HTTP and microservice traffic:

```typescript
// run: npx ts-node main.ts
import { NestFactory } from '@nestjs/core';
import { Transport, MicroserviceOptions } from '@nestjs/microservices';
import { AppModule } from './app.module.js';

const app = await NestFactory.create(AppModule);

// Add a microservice transport alongside HTTP
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.REDIS,
  options: { host: 'localhost', port: 6379 },
});

// You can connect multiple transports
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.NATS,
  options: { servers: ['nats://localhost:4222'] },
});

await app.startAllMicroservices(); // start microservice listeners
await app.listen(3000);           // start HTTP listener
```

The same controllers can have both `@Get()` (HTTP) and `@MessagePattern()` (microservice) handlers.

### Serialization and Deserialization

By default, NestJS serializes messages as JSON. You can customize this by implementing the `Serializer` and `Deserializer` interfaces:

```typescript
import { Serializer, OutgoingRequest } from '@nestjs/microservices';

export class MsgPackSerializer implements Serializer {
  serialize(value: OutgoingRequest): Buffer {
    return msgpack.encode(value);
  }
}

// Apply to client
ClientsModule.register([
  {
    name: 'USER_SERVICE',
    transport: Transport.TCP,
    options: {
      host: 'user-service',
      port: 3001,
      serializer: new MsgPackSerializer(),
      deserializer: new MsgPackDeserializer(),
    },
  },
]);
```

For gRPC, serialization is handled by Protocol Buffers (protobuf) automatically. You define `.proto` files and NestJS generates the types:

```typescript
app.connectMicroservice<MicroserviceOptions>({
  transport: Transport.GRPC,
  options: {
    package: 'user',
    protoPath: './proto/user.proto',
    url: '0.0.0.0:5000',
  },
});
```

### Custom Transport Strategies

When NestJS does not support your transport out of the box, implement the `Server` and `ClientProxy` abstract classes:

```typescript
import { Server, CustomTransportStrategy } from '@nestjs/microservices';

export class PulsarServer extends Server implements CustomTransportStrategy {
  async listen(callback: () => void): Promise<void> {
    // Set up Pulsar consumer
    const client = new Pulsar.Client({ serviceUrl: 'pulsar://localhost:6650' });
    const consumer = await client.subscribe({
      topic: 'my-topic',
      subscription: 'my-sub',
      listener: (msg, msgConsumer) => {
        const pattern = msg.getProperties()['pattern'];
        const handler = this.getHandlerByPattern(pattern);
        if (handler) {
          handler(msg.getData());
        }
        msgConsumer.acknowledge(msg);
      },
    });
    callback();
  }

  async close(): Promise<void> {
    // Clean up Pulsar connections
  }
}

// Usage
const app = await NestFactory.createMicroservice(AppModule, {
  strategy: new PulsarServer(),
});
```

### What NestJS Abstracts from Node Core

Without NestJS microservices, you would wire transports manually:

```typescript
// Raw Redis pub/sub -- no NestJS
import { createClient } from 'redis';

const subscriber = createClient();
await subscriber.connect();

await subscriber.subscribe('get_user', async (message) => {
  const data = JSON.parse(message);
  const user = await userService.findById(data.id);
  // How do you send the reply? You need a separate channel.
  const publisher = createClient();
  await publisher.connect();
  await publisher.publish(`reply:${data.replyTo}`, JSON.stringify(user));
});
```

NestJS handles the reply channel management, serialization, error propagation, and connection lifecycle for you. The `ClientProxy` abstraction manages connection pooling, reconnection, and timeout logic.

### Trade-offs of the Abstraction

| Advantage | Limitation |
|---|---|
| Transport-agnostic handlers | Hides transport-specific features |
| Unified error handling | Kafka consumer groups need manual config |
| Simple client proxy API | Redis Streams not supported (only pub/sub) |
| Built-in serialization | NATS JetStream needs custom strategy |
| Decorator-based routing | gRPC streaming requires additional setup |

For production Kafka deployments, you will likely need to configure consumer groups, partition assignment strategies, and offset management beyond what the NestJS transport exposes. Be prepared to access the underlying `KafkaJS` client directly for advanced scenarios.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. `ClientProxy.send()` returns a cold Observable.** If you do not subscribe (or `await firstValueFrom()`), the message is never sent. This is the most common NestJS microservices bug -- calling `this.client.send(...)` without subscribing and wondering why nothing happens. Always use `firstValueFrom()` or `lastValueFrom()` to convert to a Promise.

**2. No built-in retry or dead-letter queue.** NestJS transports provide at-most-once delivery for most transports. If a handler throws, the message is lost (TCP, Redis) or needs manual acknowledgment logic (Kafka, RabbitMQ). You must implement retry logic, dead-letter queues, and idempotency yourself or use a library like BullMQ for job queues.

**3. Hybrid apps share the same module graph.** If a module has both HTTP controllers and microservice handlers, REQUEST-scoped providers behave differently for each context. The `@Inject(REQUEST)` token provides an Express `Request` for HTTP handlers but a different object for microservice handlers. This causes runtime type errors if your code assumes the Express shape.

**4. gRPC error codes do not map cleanly to HTTP status codes.** If you throw an `HttpException` from a gRPC handler, the client receives it as a generic `INTERNAL` gRPC error. Use `RpcException` with gRPC status codes for microservice handlers, and `HttpException` only for HTTP handlers.
:::

## 🎯 Checkpoint

::: details Question 1 -- send vs emit
**Q:** What is the difference between `client.send()` and `client.emit()` in NestJS microservices?

**A:** `send()` implements request-response: it sends a message and returns an Observable that emits the handler's return value. The handler uses `@MessagePattern()`. `emit()` implements fire-and-forget: it sends an event with no reply expected. The handler uses `@EventPattern()`. A critical difference: `send()` returns a cold Observable (must be subscribed to), while `emit()` also returns a cold Observable but the handler's return value is ignored.
:::

::: details Question 2 -- Transport swap
**Q:** You need to switch your microservice communication from TCP to Kafka. What changes in your handler code?

**A:** Nothing in the handler code changes. The `@MessagePattern` and `@EventPattern` decorators remain identical. You change only the transport configuration in `NestFactory.createMicroservice()` (server side) and `ClientsModule.register()` (client side). This is the core value of NestJS's transport abstraction -- handler logic is transport-agnostic. However, you may need to add Kafka-specific configuration (consumer group, partition assignment) in the transport options.
:::

::: details Question 3 -- Cold Observable trap
**Q:** You call `this.client.send('process_order', order)` but the message never arrives at the other service. What is the most likely cause?

**A:** `send()` returns a cold Observable. Cold Observables do not execute until subscribed. If you call `send()` without subscribing (e.g., without using `firstValueFrom()`, `.subscribe()`, or returning the Observable from a controller), the message is never actually sent. Fix: `await firstValueFrom(this.client.send('process_order', order))`.
:::

## Key Mental Models

- **Transport is configuration, not code.** Your handlers are transport-agnostic. Switching from Redis to Kafka is a config change, not a refactor.
- **`send()` is RPC, `emit()` is fire-and-forget.** Choose based on whether the caller needs a response.
- **Cold Observables require subscription.** If you do not subscribe, nothing happens. Always `await firstValueFrom()` for `send()`.
- **The abstraction covers 80% of use cases.** For transport-specific features (Kafka consumer groups, NATS JetStream, Redis Streams), plan to access the underlying client directly.
- **Hybrid apps unify HTTP and messaging.** One NestJS process can handle both, but be mindful of scope and exception differences between contexts.

## Related

- [Provider Scopes & CLS](./03-provider-scopes)
- [Sync vs Async Communication](/system-design/microservices/01-communication)
- [Message Queues](/system-design/queues/)
- [Redis Queues & BullMQ](/system-design/queues/02-redis-bullmq)
