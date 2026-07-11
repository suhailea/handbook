---
title: WebSocket Fundamentals
outline: deep
---

# WebSocket Fundamentals

Interview weight: 🔥🔥🔥 | Node 22+ | Prerequisites: [HTTP/2, TLS & WebSockets](/nodejs/module-05/04-http2-tls-websockets), [TCP with node:net](/nodejs/module-05/01-tcp-net)

## 🗣️ In Plain English

::: tip In Plain English
HTTP is like sending letters. You write a letter (request), mail it, wait for a reply (response), and the conversation is over. If you want to ask another question, you write another letter. This works fine when the client drives all the communication, but it falls apart when the server has something to say and nobody asked.

A WebSocket is like picking up the telephone. You dial once (the upgrade handshake), and once the call is connected, both sides can talk whenever they want, for as long as they want. The server can say "hey, a new message just arrived" the instant it happens — no need for the client to keep asking "anything new? anything new? anything new?"

The phone line stays open until one side hangs up. While the line is open, both sides can send messages of any size — short text or long data — at any time. There is no request-response structure; it is a free-form, two-way stream.

The catch is that a phone call ties up a line. If you have 10,000 users, you have 10,000 open phone lines, and your server must remember who is on each one. This is fundamentally different from HTTP, where the server forgets about you the moment it sends the response. That statefulness is both the power and the operational challenge of WebSockets.
:::

## ⚙️ Under the Hood

### The Upgrade Handshake

A WebSocket connection starts as a regular HTTP/1.1 request with special headers:

```
GET /chat HTTP/1.1
Host: server.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

The server responds with `101 Switching Protocols`:

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

`Sec-WebSocket-Accept` is computed by concatenating `Sec-WebSocket-Key` with the magic GUID `258EAFA5-E914-47DA-95CA-5AB5DC11505A`, taking the SHA-1 hash, and base64-encoding it. This is not security — it is a protocol compliance check to ensure both sides understand WebSocket framing.

After the `101`, the TCP connection is no longer HTTP. Both sides speak the WebSocket frame protocol.

### ws Library: Server Setup

```typescript
// run: npx tsx ws-server.ts
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';

const server = createServer();

const wss = new WebSocketServer({
  server, // Share the HTTP server (allows WS + REST on same port)
  path: '/ws', // Only upgrade requests to /ws

  // Backpressure: max payload size (prevents memory exhaustion)
  maxPayload: 1024 * 1024, // 1MB max message size

  // Per-message deflate compression (optional, trades CPU for bandwidth)
  perMessageDeflate: false, // Disable unless bandwidth is expensive
});

// Connection event fires after successful upgrade
wss.on('connection', (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`Client connected from ${clientIp}`);

  // Message event — data is string or Buffer depending on frame type
  ws.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (isBinary) {
      console.log(`Binary message: ${(data as Buffer).length} bytes`);
      // Echo binary back
      ws.send(data, { binary: true });
    } else {
      const message = data.toString();
      console.log(`Text message: ${message}`);

      // Parse and handle
      try {
        const parsed = JSON.parse(message);
        ws.send(JSON.stringify({ type: 'ack', id: parsed.id }));
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      }
    }
  });

  // Close event — code and reason
  ws.on('close', (code: number, reason: Buffer) => {
    console.log(`Client disconnected: ${code} ${reason.toString()}`);
    // 1000 = normal closure
    // 1001 = going away (page navigation)
    // 1006 = abnormal closure (no close frame received)
    // 1011 = server error
  });

  // Error event — always fires before close
  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err.message);
  });

  // Send a welcome message
  ws.send(JSON.stringify({ type: 'welcome', timestamp: Date.now() }));
});

server.listen(3000, () => console.log('WebSocket server on ws://localhost:3000/ws'));
```

### Message Framing: Text vs Binary, Ping/Pong

WebSocket frames have an opcode that indicates the message type:

| Opcode | Type | Use |
|---|---|---|
| `0x1` | Text | UTF-8 encoded strings (JSON, plain text) |
| `0x2` | Binary | Raw bytes (images, protobuf, msgpack) |
| `0x8` | Close | Connection teardown with code + reason |
| `0x9` | Ping | Heartbeat request (server → client usually) |
| `0xA` | Pong | Heartbeat response (client → server) |

The `ws` library handles ping/pong at the protocol level, but you must implement the *application-level* heartbeat to detect dead connections:

```typescript
// run: npx tsx ws-heartbeat.ts
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';

const server = createServer();
const wss = new WebSocketServer({ server });

// Track alive state on each connection
interface AliveWebSocket extends WebSocket {
  isAlive: boolean;
}

wss.on('connection', (ws: AliveWebSocket) => {
  ws.isAlive = true;

  // When the client responds to a ping, mark as alive
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('close', () => {
    ws.isAlive = false;
  });
});

// Heartbeat interval: ping every client every 30 seconds
const heartbeatInterval = setInterval(() => {
  for (const client of wss.clients) {
    const ws = client as AliveWebSocket;

    if (!ws.isAlive) {
      // Did not respond to the last ping — terminate
      console.log('Terminating dead connection');
      ws.terminate(); // Hard close, no close frame
      continue;
    }

    ws.isAlive = false;  // Reset flag
    ws.ping();           // Send ping, expect pong before next interval
  }
}, 30_000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(3000);
```

**Why heartbeats matter:** TCP keepalive operates at intervals of minutes (default 2 hours on Linux). Without application-level pings, a client whose network drops silently (mobile switching from Wi-Fi to cellular, laptop lid closed) will appear connected for hours. The server holds memory and state for a ghost connection. Heartbeats detect dead connections within one interval (30-60 seconds).

### Backpressure in WebSockets

```typescript
// run: npx tsx ws-backpressure.ts
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:http';

const server = createServer();
const wss = new WebSocketServer({ server });

wss.on('connection', (ws: WebSocket) => {
  // bufferedAmount: bytes queued but not yet sent over the network
  // When the client is slow, bufferedAmount grows

  function sendWithBackpressure(data: string): boolean {
    // If more than 1MB is buffered, the client cannot keep up
    if (ws.bufferedAmount > 1024 * 1024) {
      console.warn(
        `Backpressure: ${ws.bufferedAmount} bytes buffered, dropping message`,
      );
      return false;
    }

    ws.send(data, (err) => {
      if (err) console.error('Send error:', err.message);
    });
    return true;
  }

  // Simulate high-frequency data (e.g., live stock tickers)
  const interval = setInterval(() => {
    const data = JSON.stringify({
      type: 'tick',
      price: Math.random() * 1000,
      timestamp: Date.now(),
    });

    if (!sendWithBackpressure(data)) {
      // Client too slow — consider throttling, dropping, or disconnecting
      console.warn('Client cannot keep up, consider throttling');
    }
  }, 10);

  ws.on('close', () => clearInterval(interval));
});

server.listen(3000);
```

**Key insight:** Unlike Node.js streams, WebSocket `send()` does not return a boolean for backpressure. You must check `ws.bufferedAmount` yourself. If you ignore it and send thousands of messages to a slow client, Node's memory grows unboundedly until the process is OOM-killed.

### Authentication on Connect

WebSocket connections cannot set custom headers from browser JavaScript (the `WebSocket` constructor only accepts protocols, not arbitrary headers). Authentication strategies:

```typescript
// run: npx tsx ws-auth.ts
import { WebSocketServer, WebSocket } from 'ws';
import { createServer, type IncomingMessage } from 'node:http';
import { URL } from 'node:url';

const server = createServer();

// Strategy 1: Token in query parameter (most common for browser clients)
const wss = new WebSocketServer({
  noServer: true, // Manual upgrade handling for auth
});

server.on('upgrade', (req: IncomingMessage, socket, head) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token || !verifyToken(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Attach user info to the request for use in connection handler
  (req as any).userId = decodeToken(token).userId;

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
  const userId = (req as any).userId;
  console.log(`Authenticated user ${userId} connected`);

  // Strategy 2: Auth in first message (alternative for when tokens are large)
  // ws.once('message', (data) => {
  //   const { token } = JSON.parse(data.toString());
  //   if (!verifyToken(token)) { ws.close(4001, 'Invalid token'); return; }
  //   // Proceed with authenticated session
  // });
});

// Token verification stubs
function verifyToken(token: string): boolean {
  return token.length > 0; // Replace with JWT verification
}

function decodeToken(token: string): { userId: string } {
  return { userId: 'user-123' }; // Replace with JWT decode
}

server.listen(3000);
```

**Security note:** Tokens in query parameters appear in access logs and browser history. Use short-lived tokens (< 60 seconds) specifically for the WebSocket upgrade. The pattern: client requests a one-time WS token via authenticated REST API, then uses it to open the WebSocket connection.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Ghost connections consume memory for hours.**
A client's network drops (mobile tunnel, flaky Wi-Fi). TCP sees no error because no packets are being sent. The server holds the WebSocket object, any per-connection state (user data, subscriptions), and buffers indefinitely. Symptom: server memory grows linearly over days; `wss.clients.size` reports 50K connections but only 5K are actually alive. Fix: implement application-level heartbeats (ping/pong every 30s) and terminate connections that miss two consecutive pongs.

**2. Missing backpressure crashes the server.**
A live-data service pushes 100 messages/second to each client. One client on a slow 3G connection cannot receive that fast. `ws.send()` buffers messages in memory. After 30 minutes, `bufferedAmount` is 500MB for that one connection, and the server OOM-kills. Fix: check `ws.bufferedAmount` before each `send()`. If it exceeds a threshold, drop messages, throttle, or disconnect the slow client.

**3. Authentication token in query string logged everywhere.**
The WebSocket URL `wss://api.example.com/ws?token=eyJhbG...` appears in nginx access logs, CDN logs, and browser history. An attacker reading logs gets valid session tokens. Fix: use short-lived (30-60 second) single-use tokens for the upgrade handshake. After the connection is established, the token is useless.

**4. Load balancer drops idle WebSocket connections.**
AWS ALB has an idle timeout (default 60 seconds). If no data crosses the WebSocket for 60 seconds, ALB closes the connection. Symptom: clients randomly disconnect, reconnect, disconnect in a 60-second cycle. Fix: send a ping/pong heartbeat more frequently than the LB's idle timeout. Set ALB idle timeout to 300-3600 seconds for WebSocket target groups.
:::

## 🎯 Checkpoint

::: details Question 1 — Upgrade handshake purpose
**Q:** Why does the WebSocket protocol require an HTTP upgrade handshake instead of starting directly on a raw TCP connection?

**A:** Three reasons: (1) **Port sharing.** By starting as HTTP, WebSocket servers can share port 80/443 with regular HTTP services. The `Upgrade` header tells the server which connections to hand off to the WebSocket handler. (2) **Proxy and firewall traversal.** HTTP traffic passes through corporate firewalls, proxies, and CDNs that would block unknown TCP protocols. The initial HTTP request looks normal to intermediaries. After the `101 Switching Protocols` response, the connection is transparent. (3) **Protocol negotiation.** The `Sec-WebSocket-Key`/`Sec-WebSocket-Accept` exchange ensures both sides understand WebSocket framing. The `Sec-WebSocket-Version: 13` header prevents version mismatches. The key exchange is *not* for security (the magic GUID is public) — it prevents accidental upgrade of non-WebSocket requests.
:::

::: details Question 2 — bufferedAmount vs Node streams
**Q:** How does backpressure work differently in WebSockets (`ws.bufferedAmount`) compared to Node.js writable streams (`writable.write()` returning `false`)?

**A:** Node.js writable streams have built-in backpressure signaling: `write()` returns `false` when the internal buffer exceeds `highWaterMark`, and the `'drain'` event fires when it is safe to write again. This gives the producer a clear signal to pause. WebSocket `ws.send()` has no such mechanism — it always accepts the message and returns `undefined` (or calls the callback). Backpressure information is only available by reading `ws.bufferedAmount`, a numeric property showing bytes queued in the send buffer. The producer must *poll* this value before each send and decide what to do (skip, throttle, disconnect). There is no `'drain'` event equivalent on the `ws` library's WebSocket object. This makes WebSocket backpressure an application-level responsibility — the library will not apply it automatically, and ignoring `bufferedAmount` leads to unbounded memory growth.
:::

::: details Question 3 — Heartbeat interval design
**Q:** Your WebSocket server runs behind an AWS ALB with a 300-second idle timeout. How do you design your heartbeat interval, and what happens if you choose 600 seconds?

**A:** Set the heartbeat interval to less than half the ALB idle timeout — around 120 seconds. This ensures that even if a pong response takes time, there is traffic on the connection well before the 300-second threshold. With a 600-second interval, the connection sits idle for 600 seconds between pings, but the ALB closes it after 300 seconds of inactivity. The client sees a sudden disconnection with no close frame (TCP RST from the ALB). If the client has auto-reconnect logic, it reconnects, sits idle for 300 seconds, gets killed again — creating a cycle of connect/disconnect every 5 minutes. The heartbeat must be more frequent than the *most aggressive* idle timeout in the network path (load balancer, firewall, NAT, proxy).
:::

## Key Mental Models

- **WebSocket is a protocol upgrade, not a replacement for HTTP.** It starts as HTTP, then becomes a persistent bidirectional frame stream. Use it when the server needs to push data proactively.
- **Stateful connections require active liveness checking.** TCP keepalive is too slow. Application-level ping/pong at 30-60 second intervals is the standard.
- **Backpressure is the developer's job.** Unlike Node streams, `ws.send()` never refuses data. Check `bufferedAmount` or face OOM.
- **Authentication happens at upgrade time.** Browser WebSocket cannot send custom headers. Use query-string tokens (short-lived) or authenticate in the first message.
- **Every open connection is a resource commitment.** Each WebSocket holds memory (buffers, state, event listeners). Plan for memory-per-connection in your capacity model.

## Related

- [HTTP/2, TLS & WebSockets](/nodejs/module-05/04-http2-tls-websockets) — the HTTP-level view of the upgrade handshake
- [TCP with node:net](/nodejs/module-05/01-tcp-net) — the transport layer underneath WebSockets
- [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure) — Node stream backpressure mechanics for comparison
- [Socket.IO: Rooms, Namespaces & Scaling](./02-socketio-rooms) — the abstraction layer built on top of ws
