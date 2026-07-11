---
title: "HTTP, Keep-Alive & Pooling"
outline: deep
---

# HTTP, Keep-Alive & Pooling

> **Interview weight:** :fire::fire::fire: — connection pooling behavior, Agent defaults, and the difference between `node:http` and `undici`/`fetch` are staple senior-level questions.
>
> **Node version notes:** All examples run on Node 22+. Native `fetch` (powered by undici) is stable since Node 21. `http.Agent` `keepAlive` defaults changed to `true` in Node 19+. Earlier versions defaulted to `false`.
>
> **Prerequisites:** [TCP with node:net](./01-tcp-net), [The libuv Threadpool](/nodejs/module-02/04-threadpool)

## :speaking_head: In Plain English

::: tip In Plain English
Think of calling a customer service line. In the early days of the web (HTTP/1.0), every single question required a full phone call: dial, wait for someone to pick up, ask your question, get the answer, hang up. If you had five questions, you made five separate phone calls. Each call involved the overhead of dialing, ringing, greeting, and hanging up.

HTTP/1.1 introduced keep-alive, which is like staying on the line after your first question. "While I have you, I have another question." The phone call stays connected, and you ask all five questions one after the other on the same connection. You save the overhead of four extra dial-wait-greet cycles. That is connection reuse.

But there is a catch. Even with keep-alive, you can only ask one question at a time on a single phone call. You ask, wait for the answer, then ask the next one. If you want to ask five questions simultaneously, you need five phone lines open at the same time. That is connection pooling: maintaining a set of open phone lines so multiple requests can fly in parallel.

Node.js manages this pool through something called an Agent. The Agent is like a switchboard operator. When your code says "make an HTTP request to api.example.com," the Agent checks: "Do I already have an open phone line to that host? Is it idle?" If yes, it reuses that line. If not, it opens a new one. The Agent also enforces limits — you can configure the maximum number of simultaneous phone lines to a single host and across all hosts.

Before Node 19, the Agent would hang up after every call by default, defeating the purpose of keep-alive. You had to explicitly opt in. Starting with Node 19, keep-alive is on by default, matching what every other HTTP client has done for years.

Then there is undici, the engine behind Node's built-in `fetch`. If `http.Agent` is a traditional switchboard operator, undici is a modern call center. It manages connections more aggressively, uses HTTP pipelining (sending the next question before the previous answer arrives), and handles connection lifecycle with less overhead. When you use `fetch()` in Node 18+, you are using undici under the hood, not `node:http`.
:::

## :gear: Under the Hood

### What `node:http` adds on top of `node:net`

`node:http` wraps `node:net` sockets with HTTP protocol parsing. Each `http.IncomingMessage` is backed by a `net.Socket`. The HTTP layer adds:

- **Request/response framing** — headers, status codes, `Content-Length` / `Transfer-Encoding: chunked`.
- **Connection management** — the `Agent` decides when to create, reuse, or destroy underlying TCP connections.
- **Header parsing** — the C++ `llhttp` parser (successor to `http_parser`) handles HTTP/1.1 parsing off the main thread's critical path.

```typescript
// run: node --experimental-strip-types http-over-net.ts
import { createServer, request, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";

const server = createServer((req, res) => {
  // req.socket is the underlying net.Socket
  const socket: Socket = req.socket;
  console.log(
    `Request on socket ${socket.remoteAddress}:${socket.remotePort}, ` +
      `localPort=${socket.localPort}`
  );

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end(`Hello from server. Your port: ${socket.remotePort}`);
});

server.listen(3000, () => {
  // Make two requests — observe whether the same socket is reused
  const makeRequest = (label: string): Promise<void> =>
    new Promise((resolve) => {
      const req = request("http://localhost:3000", (res: IncomingMessage) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          console.log(
            `${label} response: ${Buffer.concat(chunks).toString()}`
          );
          console.log(
            `${label} socket reused: ${req.reusedSocket}`
          );
          resolve();
        });
      });
      req.end();
    });

  // Sequential requests to observe connection reuse
  await makeRequest("Request 1");
  await makeRequest("Request 2"); // Should show reusedSocket: true (Node 19+)

  server.close();
});
```

### HTTP/1.1 keep-alive and connection reuse

Keep-alive is negotiated via the `Connection` header. In HTTP/1.1, keep-alive is the default — connections stay open unless the client or server sends `Connection: close`.

The keep-alive lifecycle:

1. Client sends a request on a new or idle socket.
2. Server processes the request and sends a response.
3. The socket remains open. The Agent returns it to the idle pool.
4. The next request to the same `host:port` grabs the idle socket instead of opening a new TCP connection.
5. If the socket is idle for longer than `keepAliveTimeout`, the Agent closes it.

```typescript
// run: node --experimental-strip-types keep-alive-demo.ts
import {
  createServer,
  request,
  Agent,
  type IncomingMessage,
} from "node:http";

const server = createServer((req, res) => {
  res.writeHead(200).end("ok");
});

server.listen(3001, async () => {
  // Create an agent with explicit keep-alive settings
  const agent = new Agent({
    keepAlive: true, // Default in Node 19+; explicit for clarity
    keepAliveMsecs: 1000, // TCP keep-alive probe interval (ms)
    maxSockets: 5, // Max concurrent sockets per host:port
    maxFreeSockets: 2, // Max idle sockets to keep in pool per host:port
    timeout: 10_000, // Socket timeout (ms)
  });

  const makeRequest = (id: number): Promise<void> =>
    new Promise((resolve) => {
      const req = request(
        "http://localhost:3001",
        { agent },
        (res: IncomingMessage) => {
          res.resume(); // Consume the body
          res.on("end", () => {
            console.log(
              `Request ${id}: reused=${req.reusedSocket}, ` +
                `socket.localPort=${req.socket?.localPort}`
            );
            resolve();
          });
        }
      );
      req.end();
    });

  // Sequential: should all reuse the same socket
  for (let i = 1; i <= 5; i++) {
    await makeRequest(i);
  }

  // Check agent status
  const status = agent.status;
  console.log("\nAgent status:", JSON.stringify(status, null, 2));

  agent.destroy();
  server.close();
});
```

### The Agent class: options and behavior

| Option | Default (Node 22) | Purpose |
|---|---|---|
| `keepAlive` | `true` | Keep sockets around for future requests. |
| `keepAliveMsecs` | `1000` | Initial delay for TCP keep-alive probes (ms). |
| `maxSockets` | `Infinity` | Max concurrent sockets per `host:port`. Requests beyond this queue. |
| `maxTotalSockets` | `Infinity` | Max concurrent sockets across all hosts. |
| `maxFreeSockets` | `256` | Max idle sockets kept in the pool per `host:port`. |
| `timeout` | `0` (no timeout) | Socket-level timeout. |
| `scheduling` | `"lifo"` | `"lifo"` reuses the most recently freed socket (better for keep-alive). `"fifo"` uses the oldest. |

**`maxSockets` creates invisible queuing:**

```typescript
// run: node --experimental-strip-types max-sockets.ts
import { createServer, request, Agent, type IncomingMessage } from "node:http";

// Server that takes 500ms to respond
const server = createServer((req, res) => {
  setTimeout(() => res.writeHead(200).end("ok"), 500);
});

server.listen(3002, async () => {
  // Agent limited to 2 concurrent sockets
  const agent = new Agent({ keepAlive: true, maxSockets: 2 });

  const start = Date.now();

  const makeRequest = (id: number): Promise<void> =>
    new Promise((resolve) => {
      const req = request(
        "http://localhost:3002",
        { agent },
        (res: IncomingMessage) => {
          res.resume();
          res.on("end", () => {
            console.log(
              `Request ${id} done at ${Date.now() - start}ms`
            );
            resolve();
          });
        }
      );
      req.end();
    });

  // Fire 6 requests simultaneously
  // With maxSockets=2, they execute in batches of 2
  await Promise.all([1, 2, 3, 4, 5, 6].map(makeRequest));
  // Expect: 2 at ~500ms, 2 at ~1000ms, 2 at ~1500ms

  agent.destroy();
  server.close();
});
```

### Undici architecture (Node 18+ native fetch)

When you call `fetch()` in Node, you are not using `node:http`. You are using undici, a high-performance HTTP client written from scratch for Node.js.

Key differences from `node:http`:

| Aspect | `node:http` | undici / `fetch` |
|---|---|---|
| Parser | `llhttp` (C++) | `llhttp` (same parser, different integration) |
| Connection pooling | `Agent` class | `Pool`, `Client`, `Dispatcher` hierarchy |
| HTTP pipelining | Not supported | Supported (multiple requests on one socket without waiting for responses) |
| DNS | `dns.lookup` (threadpool) | `dns.lookup` by default; configurable |
| Request body | Streams only | Streams, `Blob`, `FormData`, `ReadableStream` |
| Default pool | `globalAgent` (per-protocol) | Global dispatcher with per-origin pools |

```typescript
// run: node --experimental-strip-types undici-pool.ts
import { createServer } from "node:http";
import { Agent, setGlobalDispatcher } from "undici";

const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ts: Date.now() }));
});

server.listen(3003, async () => {
  // Configure undici's global dispatcher
  const agent = new Agent({
    keepAliveTimeout: 5_000, // Close idle connections after 5s
    keepAliveMaxTimeout: 30_000, // Max time a connection stays in the pool
    connections: 10, // Max connections per origin
    pipelining: 1, // Pipelining depth (1 = no pipelining, >1 = pipeline)
  });
  setGlobalDispatcher(agent);

  // Use native fetch — backed by undici
  const results = await Promise.all(
    Array.from({ length: 5 }, async (_, i) => {
      const res = await fetch("http://localhost:3003");
      const data = await res.json();
      return { request: i + 1, ...data };
    })
  );

  console.log("Results:", results);
  console.log("\nAll 5 requests used undici's connection pool.");

  agent.close();
  server.close();
});
```

### Measuring connection reuse

In production, you need to know whether connections are being reused or created fresh. Wasted connections mean wasted TCP handshakes and potential `dns.lookup` threadpool pressure.

```typescript
// run: node --experimental-strip-types measure-reuse.ts
import { createServer, request, Agent, type IncomingMessage } from "node:http";

const server = createServer((req, res) => {
  res.writeHead(200).end("ok");
});

server.listen(3004, async () => {
  const agent = new Agent({ keepAlive: true, maxSockets: 4 });

  let created = 0;
  let reused = 0;

  const makeRequest = (): Promise<void> =>
    new Promise((resolve) => {
      const req = request(
        "http://localhost:3004",
        { agent },
        (res: IncomingMessage) => {
          if (req.reusedSocket) {
            reused++;
          } else {
            created++;
          }
          res.resume();
          res.on("end", resolve);
        }
      );
      req.end();
    });

  // Run 20 sequential requests
  for (let i = 0; i < 20; i++) {
    await makeRequest();
  }

  console.log(`Created: ${created}, Reused: ${reused}`);
  console.log(
    `Reuse rate: ${((reused / (created + reused)) * 100).toFixed(1)}%`
  );
  // Expect: Created: 1, Reused: 19 → 95% reuse rate

  // Inspect pool state
  const keys = Object.keys(agent.freeSockets);
  console.log(`\nFree socket pools: ${keys.join(", ") || "(none)"}`);
  for (const key of keys) {
    console.log(
      `  ${key}: ${agent.freeSockets[key]?.length ?? 0} idle sockets`
    );
  }

  agent.destroy();
  server.close();
});
```

### Pool saturation and head-of-line blocking

When `maxSockets` is reached, new requests queue inside the Agent. This is HTTP/1.1 head-of-line blocking at the connection pool level: a slow response on one socket holds up requests queued behind it, even though other sockets to the same host are available for different requests.

```typescript
// run: node --experimental-strip-types pool-saturation.ts
import { createServer, request, Agent, type IncomingMessage } from "node:http";

// Server: /slow takes 2s, /fast takes 10ms
const server = createServer((req, res) => {
  const delay = req.url === "/slow" ? 2000 : 10;
  setTimeout(() => res.writeHead(200).end(req.url), delay);
});

server.listen(3005, async () => {
  // Only 1 socket allowed — forces head-of-line blocking
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const start = Date.now();

  const makeRequest = (path: string): Promise<void> =>
    new Promise((resolve) => {
      const req = request(
        `http://localhost:3005${path}`,
        { agent },
        (res: IncomingMessage) => {
          res.resume();
          res.on("end", () => {
            console.log(
              `${path} done at ${Date.now() - start}ms`
            );
            resolve();
          });
        }
      );
      req.end();
    });

  // Fire slow then fast — fast must wait for slow with maxSockets=1
  await Promise.all([makeRequest("/slow"), makeRequest("/fast")]);
  // /fast completes at ~2010ms, not ~10ms

  agent.destroy();
  server.close();
});
```

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. Default `maxSockets: Infinity` causes connection storms**
- **Symptoms:** Upstream service reports thousands of concurrent connections from your Node service. DNS resolution slows down. File descriptor limits are hit.
- **Root cause:** With `maxSockets: Infinity` (the default), a burst of outgoing requests opens a new connection for each one. A spike of 500 concurrent requests opens 500 TCP connections to the same host, each requiring a DNS lookup (threadpool thread) and a TLS handshake.
- **Fix:** Set `maxSockets` to a sane value (e.g., 50-100 per host) based on the upstream's capacity. This queues excess requests in the Agent rather than flooding the upstream. Monitor queue length via `agent.requests` to detect when the pool is saturated.

**2. Idle sockets sit behind a dead load balancer**
- **Symptoms:** After a deployment or load balancer restart, requests on reused connections fail with `ECONNRESET`. The errors come in bursts, then resolve as connections are recreated.
- **Root cause:** Keep-alive sockets in the pool are connected to the old load balancer endpoint. The load balancer has closed its side, but the Agent has not detected this because TCP keep-alive probes have not fired yet. The next request on the stale socket gets a RST.
- **Fix:** Handle `ECONNRESET` with retry logic. Set `maxFreeSockets` to a lower value to limit the blast radius. Use the `scheduling: "lifo"` option (default in Node 19+) so the most recently used socket is picked first — older, potentially stale sockets are less likely to be chosen.

**3. `node:http` Agent and `fetch` have separate pools**
- **Symptoms:** You configure `http.globalAgent` with `maxSockets: 20`, but outgoing traffic still exceeds expectations. `fetch` calls bypass the `http.Agent` entirely.
- **Root cause:** `fetch()` uses undici's global dispatcher, which has its own connection pool with its own limits. Configuring `http.globalAgent` has zero effect on `fetch`. The two pools operate independently.
- **Fix:** Configure undici's global dispatcher separately via `import { setGlobalDispatcher, Agent } from 'undici'`. If your codebase mixes `http.request` and `fetch`, you have two pools to manage.
:::

## :dart: Checkpoint

::: details Question 1 — Keep-alive default change
**Q:** A Node.js service upgraded from Node 16 to Node 22 and immediately saw a 40% reduction in outgoing DNS resolution. Nothing else changed. Explain why.

**A:** In Node 16, `http.Agent` defaulted to `keepAlive: false`. Every request opened a new TCP connection and required a fresh `dns.lookup`. In Node 19+, `keepAlive` defaults to `true`, so connections are returned to the pool and reused for subsequent requests to the same host. Reused connections skip both the TCP handshake and the DNS lookup. With typical microservice traffic patterns, a large fraction of requests hit the same few hosts repeatedly, leading to significant DNS reduction.
:::

::: details Question 2 — maxSockets queuing
**Q:** Your service makes outgoing requests to a payment API with `maxSockets: 5`. The payment API averages 200ms response times. What is the maximum steady-state throughput, and what happens when you exceed it?

**A:** With 5 sockets and 200ms average response time, each socket handles 5 requests per second, giving a maximum of 25 requests per second. Requests that arrive beyond this rate queue inside the Agent. The queue is unbounded by default, so memory grows and latency increases linearly. With 50 requests per second, the queue grows by 25 per second. Within minutes, tail latency becomes seconds. The fix is to either increase `maxSockets`, detect queue buildup and reject excess requests (circuit breaker), or shed load upstream.
:::

::: details Question 3 — fetch vs http.request pools
**Q:** You set `http.globalAgent = new Agent({ maxSockets: 10 })` to limit connections to an upstream. But monitoring shows 60+ connections during traffic spikes. Your codebase uses both `http.request` and `fetch`. What is happening?

**A:** `fetch()` uses undici's internal connection pool, completely separate from `http.globalAgent`. The `maxSockets: 10` limit only applies to `http.request` calls. `fetch` calls open additional connections via undici's default dispatcher, which has its own per-origin limits (defaulting to higher values). To limit both, configure undici's dispatcher with `setGlobalDispatcher(new Agent({ connections: 10 }))` and set `http.globalAgent` separately. Better yet, standardize on one client library.
:::

## Key Mental Models

- **Keep-alive saves handshakes, not sockets.** The connection stays open and idle, avoiding the cost of TCP + TLS setup on the next request. The socket itself still consumes a file descriptor.
- **`maxSockets` is your connection-level concurrency limit.** Anything beyond it queues. An unbounded queue means unbounded latency. Pair with a circuit breaker.
- **`node:http` and `fetch` maintain separate pools.** Configuring one does not affect the other. If your codebase uses both, you have two pools to tune.
- **LIFO scheduling favors fresh connections.** The most recently used socket is warmer (less likely to have been closed by the remote) and keeps a smaller number of sockets active.
- **Connection reuse reduces threadpool pressure.** Each new connection triggers `dns.lookup` (threadpool). Reusing connections skips this entirely.

## Related

- [TCP with node:net](./01-tcp-net) — the transport layer that HTTP connections are built on
- [Timeouts & Slowloris](./03-timeouts-slowloris) — what happens when keep-alive interacts with timeout settings
- [The libuv Threadpool](/nodejs/module-02/04-threadpool) — DNS lookups for new connections consume threadpool threads
- [HTTP/2, TLS & WebSockets](./04-http2-tls-websockets) — HTTP/2 multiplexing eliminates connection pooling concerns
