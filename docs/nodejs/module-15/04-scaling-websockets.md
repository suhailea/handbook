---
title: Scaling WebSockets in Production
outline: deep
---

# Scaling WebSockets in Production

🔥🔥🔥 **Interview weight** | **Node 22+** | **Prereqs:** [Socket.IO](./02-socketio-rooms), [Load Balancing](/system-design/load-balancing/01-l4-vs-l7)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you're running a chain of coffee shops where regulars have "their" barista — someone who knows their order, remembers their name, and is mid-conversation with them. Now you want to open more locations. The problem: you can't just send a regular to *any* shop because their barista is at *one specific* shop. That's the sticky session problem.

With normal web requests, any server can answer because the request contains all the info needed. But a WebSocket is an ongoing conversation — it lives on one specific server. If you have three servers and Alice is connected to Server 1, a message meant for Alice *must* reach Server 1.

There are two ways to solve this. First, you can make sure each customer always goes to the same shop (sticky sessions via load balancer). Second, you can give all the baristas walkie-talkies (Redis pub/sub) so when a message arrives at any shop, it gets relayed to the right one.

In practice, you use both: sticky sessions so the initial connection reaches the right server, and a message bus so any server can broadcast to any connected user. When you deploy new code, you need to gracefully move customers to the new shops without dropping their conversations — that's connection draining.
:::

## ⚙️ Under the Hood

### The Sticky Session Problem

WebSocket connections are stateful — they persist on one server. A load balancer must route subsequent requests from the same client to the same backend.

**L7 sticky sessions with nginx:**

```nginx
upstream ws_backend {
    ip_hash;  # or use cookie-based affinity
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;
}

server {
    location /socket.io/ {
        proxy_pass http://ws_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Long timeouts for WebSocket
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

### Cross-Server Messaging with Redis Pub/Sub

When Server 1 needs to send a message to a user on Server 2:

```typescript
// run: npx ts-node server.ts
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const httpServer = createServer();
const io = new Server(httpServer, { cors: { origin: '*' } });

// Every server subscribes to the same Redis channels
const pubClient = createClient({ url: 'redis://localhost:6379' });
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);
io.adapter(createAdapter(pubClient, subClient));

// Now io.to('room').emit() works across ALL servers
io.on('connection', (socket) => {
  socket.join('global');

  socket.on('chat', (msg: string) => {
    // This reaches ALL clients in 'global', even on other servers
    io.to('global').emit('chat', msg);
  });
});

const PORT = parseInt(process.env.PORT || '3000');
httpServer.listen(PORT, () => console.log(`WS server on :${PORT}`));
```

**How it works:** When `io.to('room').emit()` is called on Server 1, the Redis adapter publishes the event to a Redis channel. All servers subscribed to that channel receive it and deliver to their local clients in that room.

### Connection Limits and Memory

| Metric | Typical Value |
|--------|---------------|
| Max connections per Node process | 10K–50K (depends on message rate) |
| Memory per idle connection | ~2–10 KB |
| Memory per active connection (with buffers) | ~50–100 KB |
| File descriptor limit (default) | 1024 (increase with `ulimit -n`) |

**Capacity planning:**

```typescript
// Monitor connection count and memory
import { memoryUsage } from 'node:process';

setInterval(() => {
  const conns = io.engine.clientsCount;
  const mem = memoryUsage();
  console.log({
    connections: conns,
    heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
    rssUsedMB: Math.round(mem.rss / 1024 / 1024),
    memPerConnKB: conns > 0 ? Math.round(mem.heapUsed / conns / 1024) : 0,
  });
}, 10_000);
```

### Graceful Reconnection

Clients must handle disconnections gracefully:

```typescript
// Client-side reconnection with exponential backoff + jitter
function connectWithBackoff(url: string, maxRetries = 10): WebSocket {
  let attempt = 0;

  function connect(): WebSocket {
    const ws = new WebSocket(url);

    ws.onopen = () => {
      attempt = 0; // Reset on successful connection
      console.log('Connected');
    };

    ws.onclose = () => {
      if (attempt < maxRetries) {
        const baseDelay = Math.min(1000 * 2 ** attempt, 30_000);
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;

        console.log(`Reconnecting in ${Math.round(delay)}ms (attempt ${attempt + 1})`);
        setTimeout(() => { attempt++; connect(); }, delay);
      }
    };

    return ws;
  }

  return connect();
}
```

### Connection Draining During Deploys

During rolling deploys, you need to move connections without dropping them:

1. **Signal the old pod** (SIGTERM)
2. **Stop accepting new connections** (`server.close()`)
3. **Notify connected clients** (send "reconnect" event)
4. **Wait for clients to reconnect** to new pods
5. **Force-close remaining** after grace period

```typescript
process.on('SIGTERM', () => {
  // Stop accepting new connections
  httpServer.close();

  // Tell all clients to reconnect (they'll hit a new pod)
  io.emit('reconnect_please');

  // Force disconnect after grace period
  setTimeout(() => {
    io.disconnectSockets(true);
    process.exit(0);
  }, 10_000);
});
```

### WebSocket vs SSE Decision Matrix

| Factor | WebSocket | SSE |
|--------|-----------|-----|
| Direction | Bidirectional | Server → Client only |
| Protocol | Upgrade from HTTP | Regular HTTP |
| Reconnection | Manual | Built-in (`EventSource`) |
| Binary data | Yes | No (text only) |
| Load balancer config | Needs sticky sessions + upgrade | Standard HTTP (no special config) |
| Scaling complexity | High (sticky sessions, Redis pub/sub) | Low (stateless) |
| **Use when** | Chat, gaming, collaborative editing | Notifications, live feeds, LLM streaming |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
1. **Thundering reconnect:** When a server restarts, all its clients reconnect simultaneously to other servers. Without jitter in reconnection delay, this spike can cascade. Always add random jitter.

2. **Redis pub/sub backlog:** If a server is slow processing messages, the Redis subscription buffer grows. At ~32MB default, Redis disconnects the subscriber. Monitor `client-output-buffer-limit` in Redis.

3. **File descriptor exhaustion:** Each WebSocket connection uses a file descriptor. Default `ulimit -n` is 1024. With 5,000 connections, the server silently stops accepting new ones. Set `ulimit -n 65536` in your Dockerfile/systemd.

4. **Zombie connections:** Clients that disappear without closing (network loss, mobile background) leave connections open on the server. Without ping/pong heartbeats, these accumulate and consume memory. Set `pingTimeout` and `pingInterval` in Socket.IO.
:::

## 🎯 Checkpoint

::: details Question 1 — Why can't you round-robin WebSocket connections?
**Q:** Why does a standard round-robin load balancer break WebSocket connections?

**A:** WebSocket starts as an HTTP upgrade request. After the upgrade, the connection is persistent and stateful — it lives on one specific server. If the load balancer routes a reconnection attempt (which starts as a new HTTP request) to a different server, the client loses its room memberships, authentication state, and any server-side context. The load balancer must use sticky sessions (IP hash or cookie-based affinity) to route the same client to the same backend.
:::

::: details Question 2 — Redis adapter scaling limit
**Q:** What happens when your Socket.IO Redis adapter can't keep up with message volume?

**A:** Redis pub/sub is a broadcast — every message goes to every subscriber (server). With N servers and M messages/second, each server processes N×M messages. At high scale, this becomes a bottleneck. Solutions: 1) Shard rooms across Redis channels to reduce fan-out, 2) Use Redis Streams instead of pub/sub for persistent ordering, 3) Move to a dedicated message broker (NATS, Kafka) for very high throughput. Socket.IO also supports `@socket.io/redis-streams-adapter` for this reason.
:::

## Key Mental Models

- **WebSocket connections are pets, not cattle.** Each lives on one server and carries state. This fundamentally changes how you scale compared to stateless HTTP.
- **Sticky sessions + message bus = the scaling recipe.** Sticky sessions route clients to their server. The message bus (Redis) broadcasts across servers.
- **Reconnection is the client's job; draining is the server's job.** Clients must retry with backoff + jitter. Servers must drain gracefully during deploys.
- **SSE is often enough.** If you only need server-to-client push (notifications, live feeds, LLM streaming), SSE avoids the entire sticky session and scaling complexity.

## Related

- [Socket.IO & Rooms](./02-socketio-rooms)
- [Real-Time Patterns](./03-realtime-patterns)
- [Load Balancing](/system-design/load-balancing/01-l4-vs-l7)
- [Horizontal vs Vertical Scaling](/system-design/scaling/01-horizontal-vertical)
- [SSE & LLM Token Streaming](/nodejs/module-04/04-sse-streaming)
