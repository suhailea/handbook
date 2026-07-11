---
title: "Socket.IO: Rooms, Namespaces & Scaling"
outline: deep
---

# Socket.IO: Rooms, Namespaces & Scaling

Interview weight: 🔥🔥 | Node 22+ | Prerequisites: [WebSocket Fundamentals](./01-websocket-fundamentals), [Load Balancing](/system-design/load-balancing/01-l4-vs-l7)

## 🗣️ In Plain English

::: tip In Plain English
The raw `ws` library gives you a WebSocket connection — a pipe between two machines. But building a real-time app on raw WebSockets is like building a house with only lumber and nails. You need to handle reconnection when the network hiccups, you need a way to group users (this chat room, that game lobby), and you need a way to send a message to one specific user or broadcast to everyone.

Socket.IO is the framing and plumbing kit. It wraps the raw WebSocket and adds four things you would otherwise build yourself: **automatic reconnection** (if the connection drops, the client reconnects and re-subscribes without you writing retry logic), **rooms** (named groups that you can broadcast to — "send this message to everyone in room `project-42`"), **namespaces** (separate communication channels on the same connection — `/chat` and `/notifications` behave like independent servers), and **acknowledgements** (request-response patterns over the WebSocket — "send this message and call me back when the server confirms it was saved").

The trade-off is that Socket.IO is not a standard WebSocket — it adds its own framing on top. A raw WebSocket client cannot talk to a Socket.IO server. You must use the Socket.IO client library on the other end. This is usually fine for your own frontend, but it means third-party integrations (mobile SDKs, IoT devices) must also use Socket.IO client libraries.

When you need to run multiple server instances, the challenge is that rooms only exist in the memory of one server. If user A is connected to server 1 and user B is connected to server 2, a broadcast to room `project-42` only reaches users on the broadcasting server. The **Redis adapter** solves this by publishing room broadcasts through Redis pub/sub, so every server instance receives and delivers the message.
:::

## ⚙️ Under the Hood

### Basic Socket.IO Server

```typescript
// run: npx tsx socketio-server.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: {
    origin: ['http://localhost:5173'], // Vite dev server
    methods: ['GET', 'POST'],
  },
  // Transport negotiation: start with polling, upgrade to websocket
  transports: ['polling', 'websocket'],
  // Ping interval/timeout (heartbeat)
  pingInterval: 25000,
  pingTimeout: 20000,
  // Max payload
  maxHttpBufferSize: 1e6, // 1MB
});

io.on('connection', (socket: Socket) => {
  console.log(`Connected: ${socket.id} (transport: ${socket.conn.transport.name})`);

  // Transport upgrade detection
  socket.conn.on('upgrade', (transport) => {
    console.log(`${socket.id} upgraded to ${transport.name}`);
  });

  // Listen for custom events
  socket.on('chat:message', (data: { room: string; text: string }) => {
    console.log(`Message from ${socket.id}: ${data.text}`);
    // Broadcast to everyone in the room EXCEPT the sender
    socket.to(data.room).emit('chat:message', {
      from: socket.id,
      text: data.text,
      timestamp: Date.now(),
    });
  });

  socket.on('disconnect', (reason: string) => {
    console.log(`Disconnected: ${socket.id} reason: ${reason}`);
    // reason: 'client namespace disconnect', 'transport close',
    //         'transport error', 'ping timeout', 'server namespace disconnect'
  });
});

httpServer.listen(3000, () => console.log('Socket.IO on :3000'));
```

### Rooms: Join, Leave, Broadcast

Rooms are server-side groupings. A socket can be in multiple rooms simultaneously. Every socket is automatically in a room matching its own `socket.id`.

```typescript
// run: npx tsx socketio-rooms.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer);

io.on('connection', (socket: Socket) => {
  // Join a room
  socket.on('room:join', async (roomName: string) => {
    await socket.join(roomName);
    console.log(`${socket.id} joined ${roomName}`);

    // Notify others in the room
    socket.to(roomName).emit('room:user-joined', {
      userId: socket.id,
      room: roomName,
    });

    // Send room member count
    const members = await io.in(roomName).fetchSockets();
    io.to(roomName).emit('room:members', {
      room: roomName,
      count: members.length,
    });
  });

  // Leave a room
  socket.on('room:leave', async (roomName: string) => {
    await socket.leave(roomName);
    socket.to(roomName).emit('room:user-left', { userId: socket.id });
  });

  // Broadcast to a room (including sender)
  socket.on('room:broadcast', (data: { room: string; event: string; payload: unknown }) => {
    io.to(data.room).emit(data.event, data.payload);
  });

  // Send to a specific user (via their socket.id room)
  socket.on('dm', (data: { targetId: string; text: string }) => {
    io.to(data.targetId).emit('dm', {
      from: socket.id,
      text: data.text,
    });
  });

  // Clean up rooms on disconnect
  socket.on('disconnecting', () => {
    // socket.rooms is a Set of rooms the socket is currently in
    for (const room of socket.rooms) {
      if (room !== socket.id) {
        socket.to(room).emit('room:user-left', { userId: socket.id });
      }
    }
  });
});

httpServer.listen(3000);
```

### Namespaces: Logical Separation

```typescript
// run: npx tsx socketio-namespaces.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer);

// Default namespace: /
io.on('connection', (socket: Socket) => {
  console.log(`Main namespace: ${socket.id}`);
});

// Chat namespace: /chat
const chatNs = io.of('/chat');
chatNs.on('connection', (socket: Socket) => {
  console.log(`Chat namespace: ${socket.id}`);

  socket.on('message', (text: string) => {
    chatNs.emit('message', { from: socket.id, text });
  });
});

// Admin namespace: /admin (with auth middleware)
const adminNs = io.of('/admin');

// Namespace-level middleware — runs on every connection to this namespace
adminNs.use((socket, next) => {
  const token = socket.handshake.auth.token as string | undefined;
  if (!token || !isAdminToken(token)) {
    next(new Error('Unauthorized'));
    return;
  }
  (socket as any).adminUser = decodeAdminToken(token);
  next();
});

adminNs.on('connection', (socket: Socket) => {
  const user = (socket as any).adminUser;
  console.log(`Admin namespace: ${user.name} connected`);

  socket.on('broadcast', (message: string) => {
    // Broadcast to ALL namespaces (rare, but possible)
    io.emit('system:announcement', { message });
  });
});

function isAdminToken(token: string): boolean {
  return token.startsWith('admin-');
}

function decodeAdminToken(token: string): { name: string } {
  return { name: 'Admin User' };
}

httpServer.listen(3000);
```

**Namespaces vs rooms:** Namespaces are separate communication channels — a client connects to a specific namespace, and each namespace can have its own middleware, event handlers, and rooms. Rooms exist *within* a namespace. Use namespaces for feature separation (`/chat`, `/notifications`, `/live-data`). Use rooms for grouping within a feature (`project-42`, `game-lobby-7`).

### Acknowledgements: Request-Response over WebSocket

```typescript
// run: npx tsx socketio-ack.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer);

io.on('connection', (socket: Socket) => {
  // With acknowledgement callback — client gets confirmation
  socket.on(
    'chat:send',
    async (data: { room: string; text: string }, ack: (response: { ok: boolean; id?: string; error?: string }) => void) => {
      try {
        // Simulate saving to database
        const messageId = `msg-${Date.now()}`;

        // Broadcast to room
        socket.to(data.room).emit('chat:message', {
          id: messageId,
          from: socket.id,
          text: data.text,
          timestamp: Date.now(),
        });

        // Acknowledge to sender: "message saved and delivered"
        ack({ ok: true, id: messageId });
      } catch (err) {
        ack({ ok: false, error: (err as Error).message });
      }
    },
  );

  // With timeout — server emits and expects ack from client
  socket.timeout(5000).emit('server:ping', { ts: Date.now() }, (err: Error | null, response: unknown) => {
    if (err) {
      console.log(`Client ${socket.id} did not acknowledge within 5s`);
    } else {
      console.log(`Client ${socket.id} acknowledged:`, response);
    }
  });
});

httpServer.listen(3000);
```

### Socket.IO Middleware (Auth, Logging)

```typescript
// run: npx tsx socketio-middleware.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer);

// Server-level middleware — runs on every connection attempt
io.use((socket, next) => {
  const token = socket.handshake.auth.token as string | undefined;

  if (!token) {
    next(new Error('Authentication required'));
    return;
  }

  try {
    const user = verifyJWT(token);
    (socket as any).user = user;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

// Logging middleware — wraps every incoming event
io.use((socket, next) => {
  const originalOnevent = (socket as any).onevent;
  (socket as any).onevent = function (packet: any) {
    const [event, ...args] = packet.data ?? [];
    console.log(`[${socket.id}] Event: ${event}`, args.length > 0 ? args[0] : '');
    originalOnevent.call(this, packet);
  };
  next();
});

io.on('connection', (socket: Socket) => {
  const user = (socket as any).user;
  console.log(`Authenticated: ${user.name} (${socket.id})`);
});

function verifyJWT(token: string): { name: string; id: string } {
  // Replace with real JWT verification
  return { name: 'Suhail', id: 'user-1' };
}

httpServer.listen(3000);
```

### Scaling with Redis Adapter

```typescript
// run: npx tsx socketio-redis.ts
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

async function startServer(port: number): Promise<void> {
  const httpServer = createServer();
  const io = new Server(httpServer);

  // Create two Redis clients: one for publishing, one for subscribing
  const pubClient = createClient({ url: 'redis://localhost:6379' });
  const subClient = pubClient.duplicate();

  await Promise.all([pubClient.connect(), subClient.connect()]);

  // Attach the Redis adapter
  io.adapter(createAdapter(pubClient, subClient));

  io.on('connection', (socket) => {
    console.log(`[Server :${port}] Client connected: ${socket.id}`);

    socket.on('room:join', async (room: string) => {
      await socket.join(room);
      // This broadcast reaches clients on ALL server instances
      // because the Redis adapter publishes to the pub/sub channel
      io.to(room).emit('room:user-joined', {
        userId: socket.id,
        server: port,
      });
    });

    socket.on('chat:message', (data: { room: string; text: string }) => {
      // This reaches all clients in the room across all servers
      io.to(data.room).emit('chat:message', {
        from: socket.id,
        text: data.text,
        timestamp: Date.now(),
      });
    });
  });

  httpServer.listen(port, () => {
    console.log(`Socket.IO server running on :${port}`);
  });
}

// In production, each server instance runs on a different port/container
startServer(3000);
```

**How the Redis adapter works:**

1. Server 1 calls `io.to('room-x').emit('event', data)`.
2. The adapter publishes a message to a Redis pub/sub channel: `socket.io#/#room-x#` containing the event name, data, and metadata.
3. Every other server instance (subscribed to that channel) receives the message.
4. Each server checks if it has local sockets in `room-x` and delivers the event to them.
5. The broadcasting server also delivers locally.

This means every `io.to().emit()` becomes a Redis `PUBLISH`, and every server has an active `SUBSCRIBE`. Redis handles the fan-out across servers.

### Socket.IO with NestJS

```typescript
// run: conceptual — NestJS application context required
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  handleConnection(client: Socket): void {
    console.log(`Connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    console.log(`Disconnected: ${client.id}`);
  }

  @SubscribeMessage('room:join')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() roomName: string,
  ): Promise<{ joined: boolean }> {
    await client.join(roomName);
    client.to(roomName).emit('room:user-joined', { userId: client.id });

    // Return value is sent as acknowledgement
    return { joined: true };
  }

  @SubscribeMessage('chat:message')
  handleMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { room: string; text: string },
  ): void {
    this.server.to(data.room).emit('chat:message', {
      from: client.id,
      text: data.text,
      timestamp: Date.now(),
    });
  }
}
```

NestJS `@WebSocketGateway` wraps Socket.IO (or raw ws via an adapter). The `@SubscribeMessage` decorator registers event handlers. Return values from handlers are automatically sent as acknowledgements.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Sticky sessions missing — clients randomly fail.**
Socket.IO's default transport starts with HTTP long-polling, then upgrades to WebSocket. The polling phase sends multiple HTTP requests that must reach the *same* server (they carry a session ID). Without sticky sessions (via cookie, IP hash, or consistent hashing), requests hit different servers, and the handshake fails with `{"code":1,"message":"Session ID unknown"}`. Symptom: connections succeed for some clients (lucky routing) and fail for others. Fix: configure sticky sessions in your load balancer, OR set `transports: ['websocket']` to skip polling entirely (but lose the fallback).

**2. Redis adapter with high message volume — pub/sub backlog.**
Every room broadcast becomes a Redis PUBLISH. With 10K messages/second across rooms, every server instance receives 10K messages/second via SUBSCRIBE — even if most messages are for rooms with no local members. Symptom: Redis CPU spikes, increasing latency on broadcasts. Fix: use `@socket.io/redis-streams-adapter` for high-throughput scenarios (uses Redis Streams instead of pub/sub, with better backpressure), or shard by namespace/room prefix.

**3. Namespace middleware error leaks connection state.**
If your namespace auth middleware calls `next(new Error('...'))`, Socket.IO rejects the connection and emits a `connect_error` event on the client. But if the middleware throws synchronously (uncaught exception), the connection may be partially established — the socket is in memory but never fully authenticated. Fix: always wrap middleware logic in try/catch and call `next(error)`, never let exceptions propagate.

**4. Memory leak from event listeners on reconnection.**
If the client reconnects and your server-side code adds event listeners without cleaning up the old socket's listeners, you accumulate listeners. After 100 reconnections, the server has 100 listener registrations for the same event on different (dead) socket objects. Symptom: `MaxListenersExceededWarning` in logs, growing memory. Fix: ensure cleanup in the `disconnect` event, and register listeners only in the `connection` handler (which fires on the *new* socket).
:::

## 🎯 Checkpoint

::: details Question 1 — Namespace vs room
**Q:** When would you use a Socket.IO namespace instead of a room? Give a concrete example where using a room would be wrong.

**A:** Use namespaces when you need **separate middleware stacks, event handlers, or authentication rules**. Example: a SaaS app with a `/chat` namespace (any authenticated user) and an `/admin` namespace (only admin-role users, with a stricter auth middleware). If you used rooms instead (`room:chat`, `room:admin`), all sockets share the same event handlers and middleware — you cannot enforce different auth rules per room without manual checks in every handler. Additionally, namespaces provide isolation: events emitted on `/chat` are never received by `/admin` listeners, even if they share the same underlying HTTP server. Rooms within a namespace are for grouping within a single auth/handler context (e.g., different chat channels within `/chat`).
:::

::: details Question 2 — Redis adapter consistency
**Q:** Two users in room `project-42` are connected to different servers. User A sends a message. Describe the path the message takes to reach User B. What happens if the Redis pub/sub message is lost?

**A:** Path: (1) User A's `chat:message` event hits Server 1. (2) Server 1's handler calls `io.to('project-42').emit('chat:message', data)`. (3) The Redis adapter on Server 1 publishes a message to Redis channel `socket.io#/#project-42#` containing the event data. (4) Server 1 also delivers locally to any sockets in `project-42` on that server. (5) Server 2 (subscribed to the channel) receives the Redis message. (6) Server 2 checks its local sockets for membership in `project-42`, finds User B, and delivers the event. If the Redis pub/sub message is lost (network partition, Redis restart): Server 2 never receives it, and User B never gets the message. Redis pub/sub is **fire-and-forget** with no persistence or delivery guarantees. If message delivery must be reliable, persist messages to a database and use Socket.IO only as a notification channel — clients fetch missed messages on reconnection.
:::

## Key Mental Models

- **Socket.IO = WebSocket + reconnection + rooms + acknowledgements.** It is not a standard WebSocket — it adds a protocol layer. Both client and server must use Socket.IO libraries.
- **Namespaces separate concerns; rooms group users within a concern.** Namespaces have independent middleware and handlers; rooms are just broadcast groups.
- **The Redis adapter makes rooms global across servers.** Every broadcast becomes a Redis PUBLISH. Every server subscribes. This scales to moderate message volumes; very high volumes need sharding or Redis Streams.
- **Sticky sessions are mandatory for the default polling transport.** Skip the problem entirely by forcing WebSocket-only transport, at the cost of losing the HTTP polling fallback.
- **Acknowledgements give you request-response semantics.** The callback-based ack pattern lets you confirm message delivery or return errors, which raw WebSocket events cannot do natively.

## Related

- [WebSocket Fundamentals](./01-websocket-fundamentals) — the raw `ws` layer that Socket.IO wraps
- [L4 vs L7 & Algorithms](/system-design/load-balancing/01-l4-vs-l7) — load balancer sticky sessions for WebSocket/Socket.IO
- [Real-Time Patterns](./03-realtime-patterns) — application patterns built on top of Socket.IO
- [Scaling WebSockets in Production](./04-scaling-websockets) — operational concerns at scale
