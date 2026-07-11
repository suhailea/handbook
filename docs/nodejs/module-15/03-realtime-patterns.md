---
title: "Real-Time Patterns: Chat, Notifications, Live Data"
outline: deep
---

# Real-Time Patterns: Chat, Notifications, Live Data

Interview weight: 🔥🔥 | Node 22+ | Prerequisites: [Socket.IO](./02-socketio-rooms), [SSE & LLM Streaming](/nodejs/module-04/04-sse-streaming)

## 🗣️ In Plain English

::: tip In Plain English
WebSocket and Socket.IO give you a pipe. What you pump through the pipe — and how you manage the flow — is what turns raw connectivity into a real-time feature.

Think of a town square with a bulletin board. A **presence system** is the list of people currently in the square — it updates the moment someone arrives or leaves. A **chat room** is a circle of people who can hear each other talk. A **notification system** is a postal worker who finds you wherever you are in the square and hands you a letter; if you have left the square, the letter goes into your mailbox for later. A **live dashboard** is a scoreboard that someone updates every few seconds — but they are smart enough not to repaint the entire board if only one number changed.

Each of these patterns solves a different coordination problem: presence solves "who is here?", chat solves "how do I reach a group?", notifications solve "how do I reach one person even if they are offline?", and live dashboards solve "how do I push changing data without drowning the client in updates?"

The common thread is that the server must maintain state — who is connected, what rooms they are in, what they have already seen — and must push the *right* data to the *right* clients at the *right* frequency. Get any of those wrong and you get ghost users, missed messages, or a dashboard that flickers 60 times a second.
:::

## ⚙️ Under the Hood

### Presence System: Who Is Online

A presence system tracks which users are currently connected. The challenge is accuracy: clients disconnect silently, networks drop, and servers restart.

```typescript
// run: npx tsx presence-system.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import Redis from 'ioredis';

const httpServer = createServer();
const io = new Server(httpServer);
const redis = new Redis();

const PRESENCE_TTL = 60; // seconds — user is "online" as long as key exists
const HEARTBEAT_INTERVAL = 30_000; // 30s — half the TTL

interface UserPresence {
  userId: string;
  socketId: string;
  server: string;
  lastSeen: number;
}

// Key pattern: presence:{userId}
// Value: JSON of UserPresence
// TTL: 60 seconds, refreshed on every heartbeat

io.on('connection', async (socket: Socket) => {
  const userId = (socket as any).user?.id as string;
  if (!userId) return;

  // Mark user as online
  const presence: UserPresence = {
    userId,
    socketId: socket.id,
    server: process.env.HOSTNAME ?? 'local',
    lastSeen: Date.now(),
  };

  await redis.setex(`presence:${userId}`, PRESENCE_TTL, JSON.stringify(presence));

  // Also add to a Redis SET for "get all online users" queries
  await redis.sadd('online-users', userId);

  // Notify others that this user came online
  socket.broadcast.emit('presence:online', { userId });

  // Heartbeat: refresh presence TTL periodically
  const heartbeat = setInterval(async () => {
    presence.lastSeen = Date.now();
    await redis.setex(`presence:${userId}`, PRESENCE_TTL, JSON.stringify(presence));
  }, HEARTBEAT_INTERVAL);

  // Handle disconnection
  socket.on('disconnect', async () => {
    clearInterval(heartbeat);

    // Remove presence (with a short delay to handle reconnection)
    setTimeout(async () => {
      const current = await redis.get(`presence:${userId}`);
      if (current) {
        const parsed: UserPresence = JSON.parse(current);
        // Only remove if it is still this socket (user may have reconnected on new socket)
        if (parsed.socketId === socket.id) {
          await redis.del(`presence:${userId}`);
          await redis.srem('online-users', userId);
          io.emit('presence:offline', { userId });
        }
      }
    }, 5000); // 5s grace period for reconnection
  });

  // Query: who is online?
  socket.on('presence:list', async (callback: (users: string[]) => void) => {
    const onlineUsers = await redis.smembers('online-users');
    callback(onlineUsers);
  });
});

httpServer.listen(3000);
```

**Why Redis SET + per-user key with TTL?**
- The per-user key with TTL acts as a distributed heartbeat. If a server crashes without running the `disconnect` handler, the key expires naturally after 60 seconds — the user appears offline automatically.
- The Redis SET (`online-users`) enables O(1) lookups for "is user X online?" and O(n) for "list all online users."
- The 5-second grace period on disconnect prevents flicker when a client briefly loses connectivity and reconnects.

### Chat Rooms: Message Fan-Out and Persistence

```typescript
// run: npx tsx chat-room.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import Redis from 'ioredis';

const httpServer = createServer();
const io = new Server(httpServer);
const redis = new Redis();

interface ChatMessage {
  id: string;
  room: string;
  userId: string;
  text: string;
  timestamp: number;
}

io.on('connection', (socket: Socket) => {
  const userId = (socket as any).user?.id ?? socket.id;

  // Join room and load history
  socket.on('chat:join', async (room: string, ack: (history: ChatMessage[]) => void) => {
    await socket.join(room);

    // Load last 50 messages from Redis (most recent first)
    const messages = await redis.lrange(`chat:${room}:messages`, -50, -1);
    const history = messages.map((m) => JSON.parse(m) as ChatMessage);

    ack(history);
  });

  // Send message
  socket.on(
    'chat:send',
    async (
      data: { room: string; text: string },
      ack: (result: { ok: boolean; id: string }) => void,
    ) => {
      const message: ChatMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        room: data.room,
        userId,
        text: data.text,
        timestamp: Date.now(),
      };

      // Persist to Redis list (capped at 1000 messages per room)
      const pipeline = redis.pipeline();
      pipeline.rpush(`chat:${data.room}:messages`, JSON.stringify(message));
      pipeline.ltrim(`chat:${data.room}:messages`, -1000, -1); // Keep last 1000
      await pipeline.exec();

      // Broadcast to room (including sender — they see it via the ack)
      socket.to(data.room).emit('chat:message', message);

      // Acknowledge with message ID
      ack({ ok: true, id: message.id });
    },
  );

  // Read receipts
  socket.on('chat:read', async (data: { room: string; messageId: string }) => {
    // Store last-read message ID per user per room
    await redis.hset(`chat:${data.room}:read`, userId, data.messageId);

    // Notify room that this user has read up to messageId
    socket.to(data.room).emit('chat:read-receipt', {
      userId,
      messageId: data.messageId,
    });
  });

  // Typing indicator
  socket.on('chat:typing', (room: string) => {
    socket.to(room).emit('chat:typing', { userId });
  });

  socket.on('chat:stop-typing', (room: string) => {
    socket.to(room).emit('chat:stop-typing', { userId });
  });
});

httpServer.listen(3000);
```

### Live Notifications: Per-User Channels + Offline Queue

```typescript
// run: npx tsx notification-system.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import Redis from 'ioredis';

const httpServer = createServer();
const io = new Server(httpServer);
const redis = new Redis();

interface Notification {
  id: string;
  type: 'message' | 'mention' | 'system';
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

// Map of userId -> Set of socket IDs (user can have multiple tabs/devices)
const userSockets = new Map<string, Set<string>>();

io.on('connection', (socket: Socket) => {
  const userId = (socket as any).user?.id as string;
  if (!userId) return;

  // Track user's sockets
  if (!userSockets.has(userId)) {
    userSockets.set(userId, new Set());
  }
  userSockets.get(userId)!.add(socket.id);

  // On connect: deliver queued offline notifications
  socket.on('notifications:sync', async (ack: (notifications: Notification[]) => void) => {
    const pending = await redis.lrange(`notifications:${userId}:pending`, 0, -1);
    const notifications = pending.map((n) => JSON.parse(n) as Notification);

    ack(notifications);

    // Clear the pending queue (they have been delivered)
    if (pending.length > 0) {
      await redis.del(`notifications:${userId}:pending`);
    }
  });

  // Mark notification as read
  socket.on('notification:read', async (notificationId: string) => {
    await redis.sadd(`notifications:${userId}:read`, notificationId);
  });

  socket.on('disconnect', () => {
    const sockets = userSockets.get(userId);
    if (sockets) {
      sockets.delete(socket.id);
      if (sockets.size === 0) {
        userSockets.delete(userId);
      }
    }
  });
});

// Service function: send a notification to a user
// Called from business logic (e.g., when someone mentions a user)
export async function sendNotification(
  targetUserId: string,
  notification: Omit<Notification, 'id' | 'timestamp' | 'read'>,
): Promise<void> {
  const fullNotification: Notification = {
    ...notification,
    id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    read: false,
  };

  const targetSockets = userSockets.get(targetUserId);

  if (targetSockets && targetSockets.size > 0) {
    // User is online — deliver immediately to all their sockets
    for (const socketId of targetSockets) {
      io.to(socketId).emit('notification', fullNotification);
    }
  } else {
    // User is offline — queue for later delivery
    await redis.rpush(
      `notifications:${targetUserId}:pending`,
      JSON.stringify(fullNotification),
    );
    // Cap the queue (don't let it grow forever)
    await redis.ltrim(`notifications:${targetUserId}:pending`, -500, -1);
  }

  // Also persist to notification history (for "all notifications" view)
  await redis.lpush(
    `notifications:${targetUserId}:history`,
    JSON.stringify(fullNotification),
  );
  await redis.ltrim(`notifications:${targetUserId}:history`, 0, 999);
}

httpServer.listen(3000);
```

### Live Dashboards: Throttled Delta Updates

```typescript
// run: npx tsx live-dashboard.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer);

interface DashboardState {
  activeUsers: number;
  requestsPerSecond: number;
  errorRate: number;
  avgResponseTime: number;
  topEndpoints: Array<{ path: string; count: number }>;
}

// Current state — updated by background metrics collection
let currentState: DashboardState = {
  activeUsers: 0,
  requestsPerSecond: 0,
  errorRate: 0,
  avgResponseTime: 0,
  topEndpoints: [],
};

let previousState: DashboardState = { ...currentState };

// Compute delta between current and previous state
function computeDelta(
  prev: DashboardState,
  curr: DashboardState,
): Partial<DashboardState> | null {
  const delta: Partial<DashboardState> = {};
  let hasChanges = false;

  for (const key of Object.keys(curr) as (keyof DashboardState)[]) {
    if (JSON.stringify(prev[key]) !== JSON.stringify(curr[key])) {
      (delta as any)[key] = curr[key];
      hasChanges = true;
    }
  }

  return hasChanges ? delta : null;
}

// Push updates at most once per second (throttled)
const UPDATE_INTERVAL = 1000; // 1 second

setInterval(() => {
  const subscriberCount = io.of('/').sockets.size;
  if (subscriberCount === 0) return; // No one is watching

  const delta = computeDelta(previousState, currentState);

  if (delta) {
    // Send only changed fields
    io.emit('dashboard:update', {
      type: 'delta',
      data: delta,
      timestamp: Date.now(),
    });

    previousState = { ...currentState };
  }
}, UPDATE_INTERVAL);

io.on('connection', (socket: Socket) => {
  // New client: send full state immediately
  socket.emit('dashboard:update', {
    type: 'full',
    data: currentState,
    timestamp: Date.now(),
  });
});

// Simulate metrics changes
setInterval(() => {
  currentState = {
    activeUsers: Math.floor(Math.random() * 1000),
    requestsPerSecond: Math.floor(Math.random() * 5000),
    errorRate: Math.random() * 5,
    avgResponseTime: 50 + Math.random() * 200,
    topEndpoints: [
      { path: '/api/users', count: Math.floor(Math.random() * 1000) },
      { path: '/api/orders', count: Math.floor(Math.random() * 500) },
      { path: '/api/products', count: Math.floor(Math.random() * 300) },
    ],
  };
}, 200); // Internal state updates at 5/s, but we push to clients at 1/s

httpServer.listen(3000);
```

**Key pattern: throttle + delta.** Internal state can change 100 times per second, but clients only need 1 update per second. Computing and sending only the changed fields (delta) reduces bandwidth. New clients receive the full state on connect, then receive deltas.

### Collaborative Editing Concepts: OT vs CRDT

Collaborative editing (Google Docs-style) is a deep topic. Here are the two fundamental approaches:

**Operational Transformation (OT):**
- Each edit is an "operation" (insert 'a' at position 5, delete at position 3).
- When two users edit simultaneously, a central server transforms conflicting operations so they converge to the same result regardless of arrival order.
- Requires a central server to coordinate. Used by Google Docs.
- Complex to implement correctly (the transformation functions have subtle edge cases).

**CRDTs (Conflict-free Replicated Data Types):**
- Data structures designed so that any order of merge produces the same result.
- No central coordinator needed — peers can merge directly.
- Types: G-Counter, LWW-Register, RGA (for text sequences), Automerge, Yjs.
- Higher memory overhead (each character has a unique ID), but simpler correctness guarantees.

```typescript
// Conceptual: using Yjs (CRDT) with Socket.IO for collaborative text
// import * as Y from 'yjs';
// const doc = new Y.Doc();
// const text = doc.getText('shared');
//
// doc.on('update', (update: Uint8Array) => {
//   // Broadcast the update to all connected clients
//   socket.broadcast.emit('doc:update', Buffer.from(update));
// });
//
// socket.on('doc:update', (data: Buffer) => {
//   Y.applyUpdate(doc, new Uint8Array(data));
// });
```

For production collaborative editing, use established libraries (Yjs, Automerge) rather than implementing OT/CRDT from scratch. The transport layer (Socket.IO/WebSocket) is the easy part; the merge algorithm is where complexity lives.

### Real-Time Search/Typeahead with Debounce and Cancellation

```typescript
// run: npx tsx realtime-search.ts
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

const httpServer = createServer();
const io = new Server(httpServer);

// Simulated search database
const products = Array.from({ length: 10000 }, (_, i) => ({
  id: i,
  name: `Product ${i} ${['Widget', 'Gadget', 'Tool', 'Device'][i % 4]}`,
  category: ['electronics', 'clothing', 'food', 'tools'][i % 4],
}));

io.on('connection', (socket: Socket) => {
  // Track the current search AbortController per socket
  let currentSearch: AbortController | null = null;

  socket.on('search:query', async (query: string, ack: (results: typeof products) => void) => {
    // Cancel previous search if still running
    if (currentSearch) {
      currentSearch.abort();
    }

    const controller = new AbortController();
    currentSearch = controller;

    try {
      // Simulate async search (database query, Elasticsearch, etc.)
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, 50); // Simulated 50ms query

        controller.signal.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new DOMException('Search cancelled', 'AbortError'));
        });
      });

      // Check if this search was cancelled while waiting
      if (controller.signal.aborted) return;

      const lowerQuery = query.toLowerCase();
      const results = products
        .filter((p) => p.name.toLowerCase().includes(lowerQuery))
        .slice(0, 20);

      ack(results);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Silently ignore cancelled searches
        return;
      }
      throw err;
    } finally {
      if (currentSearch === controller) {
        currentSearch = null;
      }
    }
  });

  socket.on('disconnect', () => {
    // Cancel any in-progress search on disconnect
    currentSearch?.abort();
  });
});

httpServer.listen(3000);
```

**Client-side pattern:** The client debounces keystrokes (e.g., 300ms) so a search is only sent after the user stops typing. The server cancels previous in-flight searches via `AbortController` so it does not waste resources on stale queries.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Presence ghost users — the disconnect handler never runs.**
If the server process crashes (OOM, segfault, `kill -9`), the `disconnect` event never fires. Redis presence keys for all users on that server remain until their TTL expires. Symptom: users who reconnected to a different server appear online on both the old (ghost) and new entries. Fix: always use TTL-based presence (key expires automatically), not just SET/DELETE in the disconnect handler.

**2. Chat message ordering under load.**
Two users send messages at nearly the same time. Due to network latency and server processing order, different clients may receive the messages in different orders. Symptom: user A sees "Hello" then "Hi", user B sees "Hi" then "Hello." Fix: use server-assigned timestamps or monotonically increasing IDs, and have the client sort messages by this field, not by arrival order.

**3. Notification queue grows forever for inactive users.**
A user signs up, receives a welcome notification, and never returns. Your notification queue for that user grows as system notifications accumulate. After a year, you have millions of never-delivered notification entries in Redis. Symptom: Redis memory grows linearly with registered (not active) user count. Fix: cap the queue with `LTRIM` (keep only the last 100-500), and set a TTL on the queue key itself (expire after 30 days of inactivity).

**4. Live dashboard overwhelms clients with updates.**
You push every state change to every connected dashboard client. With 50 metrics changing 10 times per second, that is 500 events/second per client. Mobile clients on 3G cannot keep up; the browser tab freezes. Fix: throttle to 1 update/second, compute and send deltas (only changed fields), and let the client request full state on reconnect.
:::

## 🎯 Checkpoint

::: details Question 1 — Presence TTL design
**Q:** Your presence system uses a Redis key with 60-second TTL and a 30-second heartbeat. A user has a stable connection. Describe the state of the Redis key over 3 minutes. What happens if the server crashes at t=90s?

**A:** Timeline with stable connection: t=0 key created (TTL=60s). t=30s heartbeat refreshes key (TTL reset to 60s). t=60s heartbeat refreshes (TTL=60s). t=90s heartbeat refreshes (TTL=60s). The key never expires because the heartbeat runs at half the TTL interval — each refresh happens well before expiry. If the server crashes at t=90s: the last heartbeat set TTL to 60s at t=90s. No more heartbeats come. At t=150s (90+60), the key expires. The user appears offline. During the 60-second window (t=90s to t=150s), the user appears as "online" even though they are not. This is the worst-case ghost duration — equal to the TTL. To reduce it, lower the TTL (and heartbeat interval proportionally), at the cost of more Redis writes.
:::

::: details Question 2 — Delta vs full state updates
**Q:** A live dashboard sends full state (2KB JSON) every second to 500 connected clients. How much bandwidth does this consume per minute? How would delta updates reduce this, and what is the cold-start problem?

**A:** Full state: 2KB x 500 clients x 60 seconds = 60MB/minute outbound. With delta updates, if only 1-2 fields change per second (say 200 bytes), bandwidth drops to 200 bytes x 500 x 60 = 6MB/minute — a 90% reduction. The cold-start problem: when a new client connects, it has no previous state to apply deltas to. The server must send the full 2KB state to the new client, then switch to deltas. If the server only stores the current delta (not the full state), it must maintain the complete current state separately for new-client bootstrap. The solution is to always keep the latest full state in memory and send it on `connection`, then push deltas from that point forward.
:::

::: details Question 3 — AbortController for search cancellation
**Q:** Without server-side cancellation via `AbortController`, what resources are wasted when a user types quickly in a search field?

**A:** Each keystroke (or debounced batch) triggers a search query on the server. If the user types "node.js" and the client sends "n", "no", "nod", "node", "node.", "node.j", "node.js" — that is 7 queries. Without cancellation, all 7 execute against the database/search engine simultaneously. Only the last result ("node.js") is relevant; the other 6 results are computed, serialized, and sent over the network but immediately discarded by the client. Wasted resources: 6 unnecessary database queries (contending for DB connections, CPU, and I/O), 6 unnecessary serializations, and 6 unnecessary network writes that consume the WebSocket send buffer. With `AbortController`, each new query cancels the previous in-flight query, so at most 1-2 queries execute at any time.
:::

## Key Mental Models

- **Presence is a heartbeat problem, not a connection-tracking problem.** Use TTL-based keys so presence is eventually correct even when servers crash.
- **Chat needs persistence alongside real-time delivery.** WebSocket is the notification channel; the database/Redis is the source of truth. Clients fetch history on join and receive new messages via events.
- **Notifications need an offline fallback.** If the user is not connected, queue it. On reconnect, drain the queue. Cap the queue so inactive users do not consume unbounded storage.
- **Throttle outbound updates to match client capacity.** Internal state can change 100x/second, but push to clients 1x/second with delta compression. Full state on connect, deltas thereafter.
- **Cancel stale work on the server side.** `AbortController` is not just for HTTP requests — use it to cancel any in-progress work that a newer request has superseded.

## Related

- [Socket.IO: Rooms, Namespaces & Scaling](./02-socketio-rooms) — the transport layer for these patterns
- [SSE & LLM Streaming](/nodejs/module-04/04-sse-streaming) — alternative server-push mechanism when full WebSocket is overkill
- [AbortController & AbortSignal](/nodejs/module-03/03-abort-controller) — cancellation mechanics used in the search pattern
- [Caching Patterns](/system-design/caching/01-patterns) — cache-aside pattern parallels notification offline queue
