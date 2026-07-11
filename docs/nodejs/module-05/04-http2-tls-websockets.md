---
title: "HTTP/2, TLS & WebSockets"
outline: deep
---

# HTTP/2, TLS & WebSockets

<span class="badge interview-hot">Interview 🔥🔥</span> <span class="badge">Node 10+ (http2 stable)</span> <span class="badge">Node 22 (WebSocket client flag removed)</span>

**Prerequisites:** [TCP in node:net](./01-tcp-net) · [Timeouts & Slowloris](./03-timeouts-slowloris)

## 🗣️ In Plain English

::: tip In Plain English
Think of HTTP/1.1 as a single-lane country road between two towns. If a truck (a large response) is on the road, every car behind it waits — even if they're going to different destinations. You can build more roads (open more TCP connections), but each road costs money and time to build.

**HTTP/2** turns that country road into a multi-lane highway on the *same* road. Multiple cars and trucks travel simultaneously in both directions, weaving around each other, each tagged with a lane number so they arrive at the right destination. This is called **multiplexing**: many requests and responses share a single TCP connection without blocking each other.

Now, **TLS** is the tollbooth-and-tunnel system that encrypts everything traveling on the road. Before any traffic flows, the server shows the driver a certificate ("I really am the bank, not an imposter"), they agree on a shared secret, and from then on every byte is scrambled. In HTTP/2, the tunnel is mandatory in practice — browsers refuse HTTP/2 without it.

**WebSockets** are something else entirely. Imagine you and a friend are on a phone call. Either person can talk at any time — no "you ask, I answer" pattern. A WebSocket starts life as a regular HTTP request that says "hey, let's upgrade this connection to a phone call." If the server agrees, the HTTP layer steps aside and the connection becomes a raw, full-duplex data pipe. Both sides can send messages at will, in any order, for as long as they want.

So: HTTP/2 solves "how to send many HTTP requests efficiently." TLS solves "how to make any connection private." WebSockets solve "how to have a real-time, two-way conversation."
:::

## ⚙️ Under the Hood

### HTTP/2 multiplexing

HTTP/1.1 suffers from **head-of-line (HOL) blocking**: on a single connection, the second request cannot be sent until the first response completes. Browsers work around this by opening 6-8 connections per origin — expensive in TCP handshakes and TLS negotiations.

HTTP/2 introduces **streams** — virtual channels within a single TCP connection. Each request/response pair occupies its own stream, identified by a numeric stream ID. Frames from different streams are interleaved on the wire.

```typescript
import { createSecureServer, type Http2ServerRequest, type Http2ServerResponse } from 'node:http2';
import { readFileSync } from 'node:fs';

const server = createSecureServer({
  key: readFileSync('localhost-key.pem'),
  cert: readFileSync('localhost-cert.pem'),
  // ALPN negotiation: prefer h2, fall back to http/1.1
  allowHTTP1: true,
});

server.on('request', (req: Http2ServerRequest, res: Http2ServerResponse) => {
  console.log(`${req.method} ${req.url} via ${req.httpVersion}`);

  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end(`Hello over HTTP/${req.httpVersion}`);
});

server.listen(3000, () => {
  console.log('HTTP/2 server on https://localhost:3000');
});
// run: node --experimental-strip-types http2-server.ts
// (Requires TLS certs — generate with: mkcert localhost)
```

**Key HTTP/2 concepts:**

| Concept | Description |
|---------|-------------|
| **Stream** | A bidirectional flow of frames within a connection, carrying one request/response |
| **Frame** | The smallest unit of communication (HEADERS, DATA, SETTINGS, PUSH_PROMISE, etc.) |
| **HPACK** | Header compression — HTTP/2 compresses headers using a shared dictionary, massive savings for repetitive headers like `Cookie` |
| **Flow control** | Per-stream and per-connection flow control via WINDOW_UPDATE frames — prevents fast senders from overwhelming slow receivers |
| **Stream priority** | Clients can hint which streams matter more (deprecated in HTTP/2, replaced by Extensible Priorities in HTTP/3) |

### HTTP/2 client in Node

```typescript
import { connect } from 'node:http2';

const client = connect('https://jsonplaceholder.typicode.com');

// Multiple requests on ONE TCP connection — multiplexed
const paths = ['/posts/1', '/posts/2', '/posts/3'];

for (const path of paths) {
  const req = client.request({ ':path': path, ':method': 'GET' });

  let data = '';
  req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
  req.on('end', () => {
    const parsed = JSON.parse(data);
    console.log(`${path}: "${parsed.title?.slice(0, 40)}..."`);
  });
  req.end();
}

// Close after all streams finish
client.on('close', () => console.log('Connection closed'));
setTimeout(() => client.close(), 5_000);
// run: node --experimental-strip-types http2-client.ts
```

All three requests travel over a single TCP connection. No head-of-line blocking at the HTTP layer (though TCP-level HOL blocking still exists — HTTP/3 with QUIC solves that).

### Server push (and why it's mostly dead)

HTTP/2 server push allows the server to preemptively send resources the client hasn't asked for:

```typescript
import { createSecureServer } from 'node:http2';
import { readFileSync } from 'node:fs';

const server = createSecureServer({
  key: readFileSync('localhost-key.pem'),
  cert: readFileSync('localhost-cert.pem'),
});

server.on('stream', (stream, headers) => {
  if (headers[':path'] === '/') {
    // Push the CSS before the client asks for it
    stream.pushStream({ ':path': '/style.css' }, (err, pushStream) => {
      if (err) return;
      pushStream.respond({ ':status': 200, 'content-type': 'text/css' });
      pushStream.end('body { color: navy; }');
    });

    // Respond with the HTML
    stream.respond({ ':status': 200, 'content-type': 'text/html' });
    stream.end('<html><head><link rel="stylesheet" href="/style.css"></head><body>Hi</body></html>');
  }
});

server.listen(3000);
// run: node --experimental-strip-types http2-push.ts
```

**In practice, server push is rarely used.** Chrome removed push support in 2022. The problem: the server guesses what the client needs, but the client may already have it cached, wasting bandwidth. `103 Early Hints` is the modern replacement for hinting resources.

### TLS in Node (`node:tls`, `node:https`)

TLS operates at the transport layer, wrapping TCP sockets in encryption. Node's `node:tls` module exposes this directly:

```typescript
import { createServer, type TLSSocket } from 'node:tls';
import { readFileSync } from 'node:fs';

const server = createServer(
  {
    key: readFileSync('server-key.pem'),
    cert: readFileSync('server-cert.pem'),
    // Minimum TLS version — reject TLS 1.1 and below
    minVersion: 'TLSv1.2',
    // Cipher suite control (Node uses secure defaults, but you can restrict further)
    // ciphers: 'TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256',
  },
  (socket: TLSSocket) => {
    console.log('Client connected:', {
      protocol: socket.getProtocol(),       // 'TLSv1.3'
      cipher: socket.getCipher().name,      // 'TLS_AES_256_GCM_SHA384'
      servername: socket.servername,         // SNI hostname
      authorized: socket.authorized,        // mTLS: was client cert valid?
    });

    socket.write('Hello over TLS\n');
    socket.end();
  },
);

server.listen(8443, () => console.log('TLS server on :8443'));
// run: node --experimental-strip-types tls-server.ts
```

**The TLS handshake (simplified):**

1. **ClientHello:** Client sends supported TLS versions, cipher suites, and a random value. With TLS 1.3, the client also sends key-share material speculatively (0-RTT).
2. **ServerHello:** Server selects the TLS version and cipher suite, sends its certificate.
3. **Certificate verification:** Client checks the certificate chain against its trust store.
4. **Key exchange:** Both sides derive a shared secret (using ECDHE in modern setups).
5. **Finished:** Encrypted communication begins.

TLS 1.3 (default in Node 12+) completes this in **one round-trip** (vs two in TLS 1.2).

### SNI (Server Name Indication)

SNI lets a single IP/port serve multiple TLS certificates — the client sends the hostname in the ClientHello, and the server picks the right certificate:

```typescript
import { createSecureContext, createServer } from 'node:tls';
import { readFileSync } from 'node:fs';

const certs: Record<string, ReturnType<typeof createSecureContext>> = {
  'api.example.com': createSecureContext({
    key: readFileSync('api-key.pem'),
    cert: readFileSync('api-cert.pem'),
  }),
  'app.example.com': createSecureContext({
    key: readFileSync('app-key.pem'),
    cert: readFileSync('app-cert.pem'),
  }),
};

const server = createServer(
  {
    SNICallback: (servername, callback) => {
      const ctx = certs[servername];
      callback(ctx ? null : new Error(`No cert for ${servername}`), ctx ?? undefined);
    },
  },
  (socket) => {
    socket.end(`Hello, ${socket.servername}\n`);
  },
);

server.listen(443);
// run: sudo node --experimental-strip-types sni-server.ts
```

### WebSocket: the upgrade handshake

WebSockets begin life as an HTTP/1.1 request with special headers:

```
GET /chat HTTP/1.1
Host: server.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
```

The server responds:

```
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

The `Sec-WebSocket-Accept` is derived from the client's key: `base64(sha1(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))`. This proves the server understands WebSocket, not just arbitrary upgrade requests.

After the 101 response, the TCP connection sheds its HTTP framing and becomes a raw bidirectional message channel using the WebSocket frame format.

### WebSocket server with `node:http` and raw upgrade handling

```typescript
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import type { Socket } from 'node:net';

const MAGIC_STRING = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

const server = createServer((req, res) => {
  res.writeHead(200).end('Use WebSocket endpoint at /ws');
});

server.on('upgrade', (req, socket: Socket, head: Buffer) => {
  if (req.url !== '/ws') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  // Compute the accept hash
  const accept = createHash('sha1')
    .update(key + MAGIC_STRING)
    .digest('base64');

  // Send the 101 Switching Protocols response
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    '\r\n',
  );

  // At this point, `socket` is a raw duplex stream speaking WebSocket frames.
  // A real implementation would parse WebSocket frames (opcode, masking, payload length).
  // For production, use the `ws` library — this is just to show the handshake.

  console.log('WebSocket connection established');

  socket.on('data', (data: Buffer) => {
    // Raw WebSocket frame — would need unmasking and frame parsing
    console.log('Received raw frame:', data.length, 'bytes');
  });

  socket.on('close', () => console.log('WebSocket closed'));
});

server.listen(3000, () => console.log('Upgrade-aware server on :3000'));
// run: node --experimental-strip-types ws-upgrade.ts
```

### Production WebSockets with the `ws` library

The raw handshake above is educational; in production, use the `ws` package which handles frame parsing, masking, ping/pong, and backpressure:

```typescript
// npm install ws @types/ws
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'node:https';
import { readFileSync } from 'node:fs';

// WSS (WebSocket Secure) — WebSocket over TLS
const httpsServer = createServer({
  key: readFileSync('localhost-key.pem'),
  cert: readFileSync('localhost-cert.pem'),
});

const wss = new WebSocketServer({ server: httpsServer });

wss.on('connection', (ws: WebSocket, req) => {
  const ip = req.socket.remoteAddress;
  console.log(`New WSS connection from ${ip}`);

  // Ping/pong for connection health
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, 30_000);

  ws.on('pong', () => {
    // Client is alive — could update a "lastSeen" timestamp
  });

  ws.on('message', (data: Buffer, isBinary: boolean) => {
    const message = isBinary ? data : data.toString();
    console.log('Received:', message);

    // Echo with backpressure awareness
    if (ws.bufferedAmount > 1024 * 1024) {
      console.warn('Client slow, dropping message');
      return;
    }
    ws.send(`Echo: ${message}`);
  });

  ws.on('close', (code: number, reason: Buffer) => {
    clearInterval(pingInterval);
    console.log(`Closed: ${code} ${reason.toString()}`);
  });

  ws.on('error', (err: Error) => {
    console.error('WS error:', err.message);
    clearInterval(pingInterval);
  });
});

httpsServer.listen(3000, () => console.log('WSS on wss://localhost:3000'));
// run: node --experimental-strip-types wss-server.ts
```

### HTTP/2 vs HTTP/1.1 vs WebSocket — when to use what

| Scenario | Protocol | Why |
|----------|----------|-----|
| REST API with many concurrent requests | HTTP/2 | Multiplexing eliminates connection overhead |
| Server-to-client push (notifications, SSE) | HTTP/2 or SSE over HTTP/1.1 | Unidirectional push; SSE is simpler if HTTP/2 is not available |
| Real-time bidirectional (chat, games) | WebSocket | Full-duplex, low-overhead framing |
| File uploads | HTTP/1.1 or HTTP/2 | Standard request/response; HTTP/2 adds flow control |
| LLM token streaming | SSE (HTTP/1.1 or HTTP/2) | Unidirectional, reconnection built into EventSource |

### Native WebSocket in Node *(experimental, Node 22+)*

Node 22 includes a built-in `WebSocket` client (the browser-compatible API), no longer behind a flag:

```typescript
// Node 22+ — no npm package needed for the CLIENT side
const ws = new WebSocket('wss://echo.websocket.org');

ws.addEventListener('open', () => {
  console.log('Connected');
  ws.send('Hello from Node!');
});

ws.addEventListener('message', (event) => {
  console.log('Received:', event.data);
  ws.close();
});

ws.addEventListener('close', () => console.log('Disconnected'));
// run: node --experimental-strip-types ws-client.ts
```

Note: this is the *client* API only. The server-side WebSocket implementation still requires the `ws` package or manual upgrade handling.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. HTTP/2 without `allowHTTP1: true` breaks health checks.** Your K8s liveness probe sends HTTP/1.1 requests. Your Node server only speaks HTTP/2. The probe fails, K8s restarts the pod in a loop. Symptom: pods in `CrashLoopBackOff` with healthy application logs. Fix: always set `allowHTTP1: true` on `createSecureServer` unless you're certain all clients speak HTTP/2.

**2. WebSocket connections silently die behind proxies.** nginx's default `proxy_read_timeout` is 60 seconds. A WebSocket connection with no traffic for 60 seconds is killed by nginx. The client doesn't receive a close frame — the connection just drops. Symptom: clients reconnect every minute. Fix: implement ping/pong at the application level (every 30 seconds) and set `proxy_read_timeout 3600s` in the nginx location block for WebSocket endpoints.

**3. TLS certificate rotation crashes the server.** You load certificates at startup with `readFileSync`. When the cert is renewed (Let's Encrypt), the server keeps using the old, now-expired cert. Clients get `CERT_HAS_EXPIRED`. Fix: use `server.setSecureContext({ key, cert })` to reload certs without restart, triggered by a file watcher or SIGHUP handler.

**4. HTTP/2 connection coalescing causes surprise routing.** HTTP/2 allows a client to reuse a connection for multiple hostnames if they share the same IP and TLS certificate (a wildcard cert). This can cause requests intended for `api.example.com` to be sent on a connection established for `cdn.example.com` if they share a cert and IP. In microservice architectures with shared wildcards, this produces bizarre cross-service routing. Diagnosis: examine the `GOAWAY` frames and connection logs. Fix: use distinct certificates per service or set `Alt-Svc` headers to control coalescing.
:::

## 🎯 Checkpoint

::: details Question 1 — Multiplexing vs connection pooling
**Q:** How does HTTP/2 multiplexing differ from HTTP/1.1's strategy of opening multiple TCP connections? What problem does multiplexing NOT solve?

**A:** HTTP/1.1 opens multiple TCP connections (typically 6-8 per origin in browsers) to achieve concurrency, because each connection handles one request/response at a time (head-of-line blocking). HTTP/2 multiplexing sends many requests/responses as interleaved frames on a *single* TCP connection, using stream IDs to demultiplex them. This eliminates HTTP-level head-of-line blocking and saves the cost of multiple TCP handshakes and TLS negotiations. However, multiplexing does **not** solve TCP-level head-of-line blocking: if a single TCP packet is lost, the kernel's TCP implementation stalls delivery of *all* data on that connection until the lost packet is retransmitted, affecting all streams. This is why HTTP/3 uses QUIC (a UDP-based transport) which provides independent stream delivery at the transport layer.
:::

::: details Question 2 — The upgrade handshake
**Q:** Why does the WebSocket handshake use `Sec-WebSocket-Key` and a magic string to produce `Sec-WebSocket-Accept`? What attack does this prevent?

**A:** The `Sec-WebSocket-Accept` value proves the server understood the request as a WebSocket upgrade, not just a generic HTTP request it happened to respond to with `101`. Without this check, a malicious script could trick a non-WebSocket server (or a caching proxy) into treating a regular HTTP response as a WebSocket connection. The magic string `258EAFA5-E914-47DA-95CA-C5AB0DC85B11` is a fixed GUID defined in RFC 6455; its purpose is simply to be a value that no server would accidentally produce. The server computes `base64(sha1(key + GUID))` and returns it. The client verifies the hash. This is *not* a security mechanism for authentication or encryption — it's purely a protocol correctness check ensuring both sides agree they're speaking WebSocket. TLS (wss://) provides the actual security.
:::

::: details Question 3 — TLS version impact
**Q:** What is the practical difference between TLS 1.2 and TLS 1.3 in terms of connection latency? How does this affect Node server performance?

**A:** TLS 1.2 requires two round-trips to complete the handshake (ClientHello/ServerHello, then key exchange/Finished). TLS 1.3 completes in one round-trip because the client sends its key-share in the ClientHello speculatively, and the server can derive the shared secret and send encrypted data immediately in its first response. For resumed sessions, TLS 1.3 supports 0-RTT (zero round-trip) resumption, where the client sends encrypted application data in the very first packet. In Node, TLS 1.3 is the default since Node 12. The performance impact is most significant for short-lived connections (APIs with many new TLS connections). For long-lived connections (WebSockets, HTTP/2 with keep-alive), the handshake cost is amortized and the difference is negligible. The 0-RTT feature requires careful consideration of replay attacks — the first request in 0-RTT can be replayed by an attacker, so it should only be used for idempotent operations.
:::

## Key Mental Models

- **HTTP/2 is multiplexing over one TCP connection.** Many logical streams, one physical pipe. It solves HTTP-level head-of-line blocking but not TCP-level.
- **WebSocket is a protocol *upgrade*, not a separate protocol from scratch.** It starts as HTTP, then sheds the HTTP framing via a 101 handshake. After that, it's bidirectional frames on raw TCP.
- **TLS 1.3 = one fewer round-trip.** For high-connection-churn services, this matters. For persistent connections, it doesn't.
- **SNI is how one IP serves many certificates.** Without SNI, you need one IP per HTTPS domain — which is why SNI support is mandatory in modern TLS.
- **Ping/pong keeps WebSocket connections alive through proxies.** Without it, idle-timeout reaping silently kills connections.

## Related

- [Timeouts & Slowloris](./03-timeouts-slowloris) — timeout management for all HTTP versions
- [TCP in node:net](./01-tcp-net) — the transport layer underneath HTTP/2 and WebSocket
- [Streaming & SSE](/system-design/load-balancing/03-streaming-sse) — proxy configuration for long-lived connections
- [SSE & LLM Token Streaming](/nodejs/module-04/04-sse-streaming) — the SSE alternative to WebSocket for server-to-client push
