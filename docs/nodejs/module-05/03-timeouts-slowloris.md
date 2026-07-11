---
title: "Timeouts & Slowloris"
outline: deep
---

# Timeouts & Slowloris

<span class="badge interview-hot">Interview 🔥🔥🔥</span> <span class="badge">Node 18.0+ (requestTimeout default)</span> <span class="badge">Security-critical</span>

**Prerequisites:** [HTTP & Keep-Alive](./02-http-keep-alive) · [TCP in node:net](./01-tcp-net)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you own a small restaurant with ten tables. A customer walks in, sits down, and starts reading the menu. Five minutes pass. Ten minutes. An hour. They haven't ordered. They're just sitting there, slowly turning pages, occasionally asking "what's this word?" Meanwhile, nine other tables are occupied by real diners, and a queue is forming outside.

That customer is a **slowloris attacker**. They open a connection to your server and send the HTTP request *agonizingly slowly* — one byte every few seconds — just enough to keep the connection alive, but never finishing the request. Your server has a limited number of connections it can handle simultaneously. Fill them all with slow readers, and legitimate users can't get in.

**Timeouts** are your restaurant's answer: a policy that says "if you haven't ordered within five minutes, we're giving your table away." But the tricky part is that you need *different* timers for different stages. There's a timer for how long someone can take to sit down and open the menu (socket idle timeout). A timer for how long they can spend reading it (headers timeout). A timer for placing their full order (request timeout). And a timer for how long the kitchen can take to deliver the food (response timeout, though that's on you, not the customer).

Node.js has separate timeout knobs for each of these stages, and getting them wrong — or leaving them at defaults — is one of the most common ways production servers become vulnerable. The defaults have changed over Node versions, and the relationship between Node's timeouts and your reverse proxy's timeouts is a coordination problem that trips up even experienced teams.
:::

## ⚙️ Under the Hood

### The timeline of an HTTP request

Every HTTP/1.1 request goes through these stages, each with its own timeout:

```
TCP connect → Send headers → Send body → Server processes → Send response → Keep-alive idle
|            |               |            |                  |               |
|  socket    | headersTimeout| requestTimeout                |  server-side  | keepAliveTimeout
|  timeout   |               |                               |  (no built-in)|
```

### `server.headersTimeout` *(Node 18.0+ default: 60000ms)*

Time allowed between socket connection and the complete receipt of HTTP headers (the blank line `\r\n\r\n` after headers). If headers are not fully received within this window, Node destroys the socket with a `408 Request Timeout` response.

```typescript
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('OK');
});

// Must be greater than requestTimeout (Node enforces this since v19)
server.headersTimeout = 30_000; // 30 seconds to send headers
server.listen(3000);
// run: node --experimental-strip-types headers-timeout.ts
```

Before Node 18, `headersTimeout` defaulted to `60_000` but was not enforced as strictly. Since Node 18, it is the **primary defense against slowloris**.

### `server.requestTimeout` *(Node 18.0+ default: 300000ms)*

Time allowed from socket connection to the **complete receipt of the entire request** (headers + body). This is the outer envelope. If the client hasn't finished sending within this window, the socket is destroyed.

```typescript
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    res.writeHead(200).end(`Received ${Buffer.concat(chunks).length} bytes`);
  });
});

server.requestTimeout = 120_000;  // 2 minutes for the full request
server.headersTimeout = 30_000;   // Must be < requestTimeout
server.listen(3000);
// run: node --experimental-strip-types request-timeout.ts
```

**Constraint since Node 19:** `headersTimeout` must be less than `requestTimeout`, or Node throws on startup. This prevents a misconfiguration where headers are allowed more time than the entire request.

### `server.keepAliveTimeout` *(default: 5000ms)*

After a response is sent on a keep-alive connection, this is how long the server waits for the *next* request before closing the idle socket. If no new request arrives within this window, the connection is closed.

```typescript
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200).end('Hello');
});

server.keepAliveTimeout = 30_000; // 30 seconds idle between requests
server.listen(3000);
// run: node --experimental-strip-types keepalive-timeout.ts
```

**Critical coordination with reverse proxies:** Your upstream proxy (nginx, ALB) also has a keep-alive timeout. If the proxy's timeout is *longer* than Node's, the proxy may try to reuse a connection that Node has already closed, producing **502 Bad Gateway** errors. Rule of thumb: **Node's `keepAliveTimeout` should be longer than the proxy's** by a few seconds.

### `socket.setTimeout()` — the per-socket idle timer

This is a lower-level timeout on the raw TCP socket. It fires after the socket has been *idle* (no reads or writes) for the specified duration. It does **not** automatically destroy the socket — it only emits a `'timeout'` event. You must destroy it yourself:

```typescript
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  // Per-request socket idle timeout
  req.socket.setTimeout(10_000); // 10 seconds of inactivity
  req.socket.on('timeout', () => {
    console.log('Socket idle for 10s, destroying');
    req.socket.destroy();
  });

  // Simulate slow processing
  setTimeout(() => {
    res.writeHead(200).end('Done');
  }, 5_000);
});

server.listen(3000);
// run: node --experimental-strip-types socket-timeout.ts
```

### The complete timeout hierarchy

```typescript
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200).end('OK');
});

// Layer 1: How long to wait for complete headers
server.headersTimeout = 20_000;

// Layer 2: How long to wait for the complete request (headers + body)
server.requestTimeout = 120_000;

// Layer 3: How long to keep idle keep-alive connections open
server.keepAliveTimeout = 65_000; // > nginx's default 60s

// Layer 4: TCP-level connection timeout (via server event)
server.on('connection', (socket) => {
  socket.setTimeout(300_000); // 5 minute absolute socket timeout
  socket.on('timeout', () => socket.destroy());
});

server.listen(3000, () => {
  console.log('Server with full timeout config on :3000');
});
// run: node --experimental-strip-types full-timeouts.ts
```

### The slowloris attack, mechanically

Slowloris exploits the gap between "connection accepted" and "request fully received." Here's exactly how it works:

1. The attacker opens many TCP connections to the server.
2. On each connection, they send a partial HTTP request — for example, just `GET / HTTP/1.1\r\nHost: target.com\r\n` — but never the terminating `\r\n`.
3. Periodically (every 10-20 seconds), they send another header line (`X-Garbage-42: keep-alive\r\n`) to reset any idle timers.
4. The server keeps the connection open, waiting for the blank line that signals "headers complete."
5. With enough connections held open, the server's connection pool is exhausted. Legitimate clients get `ECONNREFUSED` or hang forever.

**Why Node is somewhat resistant (since Node 18):** The `headersTimeout` of 60 seconds means the attacker must complete headers within a minute or lose the connection. But 60 seconds is still long enough to hold many connections if the `maxConnections` is low.

**Defense in depth:**

```typescript
import { createServer } from 'node:http';

const server = createServer((req, res) => {
  res.writeHead(200).end('OK');
});

// Aggressive headers timeout — slowloris defense
server.headersTimeout = 10_000; // 10 seconds to send headers

// Limit total concurrent connections
server.maxConnections = 1024;

// Short request timeout
server.requestTimeout = 30_000;

// Track connections per IP (application-level rate limiting)
const connectionsPerIP = new Map<string, number>();

server.on('connection', (socket) => {
  const ip = socket.remoteAddress ?? 'unknown';
  const count = (connectionsPerIP.get(ip) ?? 0) + 1;
  connectionsPerIP.set(ip, count);

  if (count > 50) {
    // Too many concurrent connections from one IP
    console.log(`Rate limiting ${ip}: ${count} connections`);
    socket.destroy();
    connectionsPerIP.set(ip, count - 1);
    return;
  }

  socket.on('close', () => {
    const current = connectionsPerIP.get(ip) ?? 1;
    if (current <= 1) connectionsPerIP.delete(ip);
    else connectionsPerIP.set(ip, current - 1);
  });
});

server.listen(3000);
// run: node --experimental-strip-types slowloris-defense.ts
```

### Timeout configuration with reverse proxies

In production, Node typically sits behind nginx or a cloud load balancer. The timeout values must be coordinated:

| Timeout | nginx | Node | Rule |
|---------|-------|------|------|
| Connection idle | `keepalive_timeout 60s` | `keepAliveTimeout = 65_000` | Node > nginx (prevents 502) |
| Headers | `client_header_timeout 20s` | `headersTimeout = 30_000` | nginx < Node (nginx rejects first) |
| Body | `client_body_timeout 60s` | `requestTimeout = 120_000` | nginx < Node |
| Upstream read | `proxy_read_timeout 60s` | *(response time)* | nginx > expected processing time |

```nginx
# nginx.conf — coordinated timeouts
upstream node_app {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;

    # Client-facing timeouts (first line of defense)
    client_header_timeout 20s;
    client_body_timeout 60s;

    # Upstream timeouts
    proxy_read_timeout 120s;    # How long to wait for Node's response
    proxy_send_timeout 60s;     # How long to send the request to Node
    proxy_connect_timeout 5s;   # TCP connect to Node

    location / {
        proxy_pass http://node_app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";   # enable keep-alive to upstream
    }
}
```

### Detecting timeout issues programmatically

```typescript
import { createServer } from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';

const server = createServer(async (req, res) => {
  const start = performance.now();

  // Monitor for client timeout/disconnect during processing
  let clientGone = false;
  req.on('close', () => {
    clientGone = true;
    const elapsed = (performance.now() - start).toFixed(0);
    if (!res.writableFinished) {
      console.log(`Client disconnected after ${elapsed}ms before response completed`);
    }
  });

  // Simulate slow work
  await sleep(5_000);

  if (clientGone) {
    // Don't bother writing — socket is already dead
    return;
  }

  res.writeHead(200).end('Done');
});

server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 65_000;

// Log when Node itself times out a connection
server.on('timeout', (socket) => {
  console.log(`Server-level timeout on socket from ${socket.remoteAddress}`);
});

server.listen(3000);
// run: node --experimental-strip-types timeout-monitor.ts
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. 502 Bad Gateway from keep-alive mismatch.** nginx's default `keepalive_timeout` is 75 seconds. Node's default `keepAliveTimeout` is 5 seconds. nginx sends a request on a connection it believes is alive; Node has already closed it. Result: 502 error for the next request on that connection. Fix: set `server.keepAliveTimeout` to at least 5 seconds more than nginx's `keepalive_timeout`. This is the single most common production timeout bug.

**2. Slowloris exhaustion on Node < 18.** Before Node 18, `headersTimeout` was not strictly enforced, and `requestTimeout` did not exist. A Node 16 server with default settings is fully vulnerable to slowloris. Symptom: `EMFILE` (too many open files) or connection pool exhaustion — new clients hang indefinitely. Diagnosis: `ss -s` shows thousands of connections in `ESTABLISHED` state; `netstat` shows connections to the server port from few source IPs.

**3. Long-running uploads killed mid-transfer.** A file upload endpoint accepts 500MB uploads, but `requestTimeout` is set to 30 seconds. Large uploads over slow connections are destroyed mid-transfer. The client receives an abrupt connection reset with no error body. Fix: increase `requestTimeout` for upload routes, or move uploads to a dedicated server with relaxed timeouts.

**4. SSE/WebSocket connections killed by request timeout.** `server.requestTimeout` applies to the *entire* request lifecycle. An SSE connection open for 10 minutes violates a 5-minute `requestTimeout`. Since Node 19, this is handled better (the timeout is cleared once headers are received and the response has started), but on older versions, long-lived connections need `req.socket.setTimeout(0)` to disable the socket-level timeout.
:::

## 🎯 Checkpoint

::: details Question 1 — Timeout ordering
**Q:** You set `headersTimeout = 60_000` and `requestTimeout = 30_000` on a Node 19+ server. What happens on startup?

**A:** Node throws an error at startup. Since Node 19, Node enforces that `headersTimeout < requestTimeout`. The rationale: `headersTimeout` is a subset of `requestTimeout` (headers must arrive before the full request). If `headersTimeout` is 60s and `requestTimeout` is 30s, the headers timeout would never trigger because the request timeout fires first, making the headers timeout meaningless and indicating a configuration error. The fix: either reduce `headersTimeout` below 30s or increase `requestTimeout` above 60s.
:::

::: details Question 2 — The 502 problem
**Q:** Your Node server sits behind nginx. Users report intermittent 502 errors that happen more frequently during low-traffic periods. What is the likely cause and the fix?

**A:** During low-traffic periods, keep-alive connections sit idle longer between requests. Node's `keepAliveTimeout` (default 5s) is shorter than nginx's `keepalive_timeout` (default 75s). After 5 seconds of idle, Node closes the connection. When the next request arrives seconds later, nginx — which believes the connection is still valid — sends the request on the dead connection and receives a RST, returning 502 to the client. During high traffic, connections are reused quickly and rarely hit the idle timeout, masking the problem. Fix: set `server.keepAliveTimeout = 80_000` (or any value comfortably above nginx's timeout). Also set `server.maxHeadersCount` and consider adding the nginx directive `proxy_next_upstream error timeout` to allow retries on the next upstream.
:::

::: details Question 3 — Slowloris mitigation
**Q:** Beyond setting `headersTimeout`, name three additional defenses against slowloris at different layers of the stack.

**A:** (1) **Connection-level rate limiting:** Track concurrent connections per IP using the `server.on('connection')` event and `socket.remoteAddress`. Destroy new sockets from IPs exceeding a threshold (e.g., 50 concurrent connections). (2) **Reverse proxy as first defense:** nginx's `limit_conn` module limits concurrent connections per IP at the proxy layer before traffic reaches Node. Combined with `client_header_timeout` (e.g., 10s), nginx rejects slow clients before they consume Node connections. (3) **OS-level: `iptables` / `nftables` rate limiting:** Use `connlimit` to cap connections per source IP at the kernel level (`iptables -A INPUT -p tcp --dport 80 -m connlimit --connlimit-above 50 -j DROP`). This stops the connections before they even reach user space. (4) **Cloud load balancer:** Services like AWS ALB have built-in slow-client protection and idle timeouts that act as an additional layer.
:::

## Key Mental Models

- **Every stage of an HTTP request deserves its own timeout.** Socket connect, headers, full request, keep-alive idle, and response — leaving any one unguarded creates an attack surface.
- **Slowloris is a resource-exhaustion attack, not a bandwidth attack.** It uses almost no bandwidth. It just holds connections open. The defense is *time limits*, not *rate limits* on data.
- **The keep-alive timeout coordination rule: Node > proxy.** If Node closes before the proxy, the proxy sends requests into dead sockets. 502s follow.
- **`requestTimeout` was added in Node 18 for a reason.** Before it existed, the only defense was `headersTimeout` + manual `socket.setTimeout()`. Upgrade and set both.
- **Timeouts are a contract between layers.** Document them in your infrastructure as explicitly as you document API schemas.

## Related

- [HTTP & Keep-Alive](./02-http-keep-alive) — the keep-alive mechanism that makes `keepAliveTimeout` necessary
- [HTTP/2, TLS & WebSockets](./04-http2-tls-websockets) — HTTP/2's multiplexing changes the timeout calculus
- [nginx as Reverse Proxy](/system-design/load-balancing/02-nginx) — the other side of the timeout coordination
- [Security & Hardening](/nodejs/module-08/) — broader server hardening including header/body limits
