---
title: "TCP with node:net"
outline: deep
---

# TCP with node:net

> **Interview weight:** :fire::fire: — understanding TCP internals separates candidates who can debug connection issues from those who cannot. Frequently asked alongside HTTP and WebSocket questions.
>
> **Node version notes:** All examples run on Node 22+. The `node:net` API has been stable since Node 0.x; recent additions include `server.close()` returning a promise (Node 20+).
>
> **Prerequisites:** [What Node Actually Is](/nodejs/module-01/01-what-node-is), [libuv Phases](/nodejs/module-02/01-libuv-phases)

## :speaking_head: In Plain English

::: tip In Plain English
Imagine two people who want to have a phone call. Before anyone speaks, the caller dials, the receiver picks up and says "hello," and the caller says "I hear you." That three-step greeting is the TCP three-way handshake: SYN, SYN-ACK, ACK. Only after those three steps does the actual conversation begin.

Once the call is connected, either side can talk at any time. The phone line stays open and both sides can send messages back and forth. That is a TCP connection: a persistent, two-way channel between two machines. Each side has a buffer (like a voicemail inbox) that collects incoming data until the application is ready to read it.

Now, imagine the caller wants to send short, rapid messages — individual words, one at a time. Without any optimization, the phone system would wait a moment after each word to see if more words are coming, then batch them together before transmitting. That batching is Nagle's algorithm. It reduces the number of small packets on the wire, but it adds latency. If you need every word delivered instantly (like in a real-time game), you turn batching off.

When the conversation is over, both sides go through a polite goodbye. One side says "I am done talking" (FIN), the other acknowledges and says "I am done too" (FIN), and both confirm. That is the four-step teardown. If one side just hangs up without the goodbye (a reset), the other side gets a sudden error.

In Node.js, `node:net` gives you direct access to this phone line. You can create a server that listens for incoming calls, or create a client that dials out. You handle the raw bytes yourself — there is no HTTP, no JSON, no framing. You decide what the bytes mean. That power is why lower-level protocols, custom binary services, and database drivers are built on `node:net`.

Keep-alive at the TCP level is different from HTTP keep-alive. TCP keep-alive is a heartbeat probe: if the line goes silent for too long, the operating system sends a tiny "are you still there?" packet. If no reply comes back, the OS declares the connection dead. Without it, a connection to a crashed machine can sit idle forever, leaking resources.
:::

## :gear: Under the Hood

### The three-way handshake and teardown

When `net.createConnection` is called, the OS initiates a TCP handshake:

1. **SYN** — the client sends a synchronization packet to the server.
2. **SYN-ACK** — the server acknowledges and sends its own SYN.
3. **ACK** — the client acknowledges the server's SYN. Connection established.

The `connect` event on the socket fires after step 3 completes. Until then, data written to the socket is buffered in memory.

Teardown uses a four-step sequence (FIN, ACK, FIN, ACK). Calling `socket.end()` sends a FIN. Calling `socket.destroy()` sends a RST — an abrupt teardown that discards any buffered data.

### Creating a TCP server and client

```typescript
// run: node --experimental-strip-types tcp-echo.ts
import { createServer, createConnection, type Socket } from "node:net";

// --- Server: echoes everything back in uppercase ---
const server = createServer((socket: Socket) => {
  console.log(
    `Client connected: ${socket.remoteAddress}:${socket.remotePort}`
  );

  socket.on("data", (chunk: Buffer) => {
    console.log(`Received ${chunk.length} bytes`);
    // Echo back in uppercase
    socket.write(chunk.toString().toUpperCase());
  });

  socket.on("end", () => {
    console.log("Client sent FIN (graceful close)");
  });

  socket.on("error", (err: Error) => {
    console.error(`Socket error: ${err.message}`);
  });

  socket.on("close", (hadError: boolean) => {
    console.log(`Connection closed. Had error: ${hadError}`);
  });
});

server.listen(4000, () => {
  console.log("TCP server listening on :4000");

  // --- Client: connect, send data, then close ---
  const client = createConnection({ port: 4000 }, () => {
    console.log("Client connected to server");
    client.write("hello tcp world");
  });

  client.on("data", (chunk: Buffer) => {
    console.log(`Server replied: ${chunk.toString()}`);
    client.end(); // Graceful close — sends FIN
  });

  client.on("end", () => {
    console.log("Server acknowledged close");
    server.close();
  });
});
```

### Socket events and lifecycle

The lifecycle of a `net.Socket` follows a strict order:

| Event | When it fires | Notes |
|---|---|---|
| `connect` | Handshake complete | Only on client sockets. Server-side sockets arrive already connected. |
| `ready` | Immediately after `connect` | Alias; useful for readability. |
| `data` | Incoming bytes available | Fires multiple times. No framing — a single `write` may arrive as multiple `data` events, or multiple `write` calls may merge into one. |
| `drain` | Write buffer has been flushed | Fires after `socket.write()` returns `false` (backpressure). Safe to resume writing. |
| `end` | Remote side sent FIN | The remote called `socket.end()`. You may still write to the socket (half-open state) unless `allowHalfOpen` is `false` (the default). |
| `error` | Any error | Connection refused, reset, timeout. Always followed by `close`. |
| `close` | Socket fully closed | `hadError` boolean argument indicates whether the close was due to an error. |

### Nagle's algorithm and `setNoDelay`

Nagle's algorithm batches small outgoing packets into a single larger packet to reduce overhead. It holds a small write in the buffer until either (a) the previous packet is acknowledged or (b) enough data accumulates to fill a segment.

This is great for throughput but terrible for latency-sensitive protocols.

```typescript
// run: node --experimental-strip-types nagle-demo.ts
import { createServer, createConnection, type Socket } from "node:net";

const server = createServer((socket: Socket) => {
  const chunks: Buffer[] = [];
  socket.on("data", (chunk: Buffer) => {
    chunks.push(chunk);
    console.log(
      `Server received chunk #${chunks.length}: ` +
        `${chunk.length} bytes — "${chunk.toString().trim()}"`
    );
  });
  socket.on("end", () => {
    console.log(`Total chunks received: ${chunks.length}`);
    socket.end();
    server.close();
  });
});

server.listen(4001, () => {
  const client = createConnection({ port: 4001 }, () => {
    // Disable Nagle's algorithm — each write becomes its own packet
    client.setNoDelay(true);

    // Send 5 tiny messages in rapid succession
    for (let i = 0; i < 5; i++) {
      client.write(`msg-${i}\n`);
    }
    // With setNoDelay(true): expect ~5 chunks on the server
    // With setNoDelay(false): Nagle may merge them into 1-2 chunks

    client.end();
  });
});
```

**When to use `setNoDelay(true)`:**
- Interactive protocols (chat, gaming, real-time collaboration)
- Request-response protocols where you send a single small message and wait for a reply
- Any situation where latency matters more than bandwidth efficiency

### TCP keep-alive

TCP keep-alive is an OS-level heartbeat. If a connection is idle for a configurable period, the OS sends a probe packet. If no response arrives after several retries, the connection is considered dead and the socket emits an `error`.

```typescript
// run: node --experimental-strip-types tcp-keepalive.ts
import { createServer, type Socket } from "node:net";

const server = createServer((socket: Socket) => {
  // Enable TCP keep-alive with a 30-second initial delay
  socket.setKeepAlive(true, 30_000);

  console.log("Client connected with keep-alive enabled (30s)");

  socket.on("error", (err: Error) => {
    // If the remote crashes silently, keep-alive will eventually
    // detect the dead connection and fire this error
    console.error(`Keep-alive detected dead connection: ${err.message}`);
  });

  socket.on("close", () => {
    console.log("Connection closed");
    server.close();
  });
});

server.listen(4002, () => {
  console.log("Server with keep-alive on :4002");
});
```

Without keep-alive, a connection to a machine that has crashed (not gracefully closed) will remain open indefinitely, consuming file descriptors and memory.

### Connection timeouts

```typescript
// run: node --experimental-strip-types tcp-timeout.ts
import { createConnection } from "node:net";

// Connect to a non-routable IP to demonstrate connection timeout
const socket = createConnection({
  host: "10.255.255.1", // Non-routable — will hang
  port: 80,
  timeout: 3000, // Connection timeout in ms
});

socket.on("timeout", () => {
  console.log("Connection timed out after 3 seconds");
  socket.destroy(); // Must manually destroy — timeout does not close the socket
});

socket.on("error", (err: Error) => {
  console.error(`Error: ${err.message}`);
});

socket.on("close", () => {
  console.log("Socket closed");
});
```

**Important:** The `timeout` event is advisory. It does not destroy the socket. You must call `socket.destroy()` in the handler.

### Building a basic protocol on raw TCP

TCP is a byte stream — it has no concept of messages. If you send "hello" followed by "world," the receiver might get "helloworld" in one chunk, or "hel" and "loworld" in two. You need a framing protocol.

A common approach is length-prefix framing: prepend each message with a 4-byte unsigned integer indicating the message length.

```typescript
// run: node --experimental-strip-types length-prefix.ts
import { createServer, createConnection, type Socket } from "node:net";

// --- Framing helpers ---
function frameMessage(data: string): Buffer {
  const payload = Buffer.from(data, "utf-8");
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

class MessageParser {
  private buffer = Buffer.alloc(0);
  private readonly onMessage: (msg: string) => void;

  constructor(onMessage: (msg: string) => void) {
    this.onMessage = onMessage;
  }

  feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const msgLen = this.buffer.readUInt32BE(0);

      if (this.buffer.length < 4 + msgLen) {
        break; // Wait for more data
      }

      const message = this.buffer.subarray(4, 4 + msgLen).toString("utf-8");
      this.buffer = this.buffer.subarray(4 + msgLen);
      this.onMessage(message);
    }
  }
}

// --- Server ---
const server = createServer((socket: Socket) => {
  const parser = new MessageParser((msg: string) => {
    console.log(`Server received message: "${msg}"`);
    // Reply with the reversed string
    socket.write(frameMessage(msg.split("").reverse().join("")));
  });

  socket.on("data", (chunk: Buffer) => parser.feed(chunk));
  socket.on("end", () => server.close());
});

server.listen(4003, () => {
  const client = createConnection({ port: 4003 }, () => {
    // Send three framed messages
    client.write(frameMessage("hello"));
    client.write(frameMessage("TCP framing"));
    client.write(frameMessage("works correctly"));
  });

  const parser = new MessageParser((msg: string) => {
    console.log(`Client received reply: "${msg}"`);
  });

  let replies = 0;
  client.on("data", (chunk: Buffer) => {
    parser.feed(chunk);
    replies++;
    if (replies >= 3) {
      client.end();
    }
  });
});
```

### Server backlog and the `connection` event

When a TCP server calls `listen`, the OS allocates a backlog queue for incoming connections that have completed the handshake but have not yet been accepted by the application. The default backlog in Node is 511 (libuv's default).

```typescript
// Increase the backlog for high-connection-rate servers
server.listen({ port: 4000, backlog: 2048 });
```

If the backlog fills up, new connection attempts are silently dropped at the OS level — the client sees a timeout, not a rejection.

## :boom: Where It Bites (Production Lens)

::: warning Where It Bites

**1. No message framing leads to data corruption**
- **Symptoms:** Your custom TCP protocol works fine locally but produces garbled messages under load or over WAN connections.
- **Root cause:** TCP is a byte stream, not a message stream. Under high throughput or network fragmentation, multiple `write` calls merge into a single `data` event, or a single `write` splits across multiple events. Without length-prefix framing (or a delimiter protocol), the receiver cannot determine where one message ends and the next begins.
- **Fix:** Always implement explicit framing. Length-prefix is the most common pattern. Never assume one `write` equals one `data` event.

**2. Forgetting to destroy on timeout leaks sockets**
- **Symptoms:** File descriptor exhaustion (`EMFILE` errors) after running for days. `lsof` shows thousands of established connections in ESTABLISHED state.
- **Root cause:** The `timeout` event on a `net.Socket` is advisory. It does not close or destroy the socket. If your handler only logs the timeout without calling `socket.destroy()`, the socket remains open indefinitely.
- **Fix:** Always call `socket.destroy()` (or at minimum `socket.end()`) inside the `timeout` handler.

**3. Missing TCP keep-alive lets dead connections accumulate**
- **Symptoms:** After a network partition or remote host crash, connections remain in ESTABLISHED state for hours or days. File descriptors and memory are consumed by connections that will never receive another byte.
- **Root cause:** Without TCP keep-alive enabled, the OS has no mechanism to detect a silently dead peer. The connection appears healthy because no error has been reported.
- **Fix:** Enable `socket.setKeepAlive(true, 30000)` on all long-lived connections. Combine with application-level heartbeats for faster detection.

**4. Backlog overflow causes silent connection drops**
- **Symptoms:** Under burst traffic, some clients experience connection timeouts even though the server process is healthy and CPU is low. No errors appear in application logs.
- **Root cause:** The OS listen backlog is full. New handshakes complete at the kernel level but are dropped before the application can accept them. The default backlog of 511 is insufficient for high-connection-rate services.
- **Fix:** Increase the backlog in `server.listen()` and verify with `ss -ltn` that the `Send-Q` value reflects your setting. Also tune the OS `somaxconn` sysctl.
:::

## :dart: Checkpoint

::: details Question 1 — TCP framing
**Q:** You build a TCP service that sends JSON objects separated by newlines. Under load, clients occasionally parse invalid JSON. The server code looks correct. What is the most likely cause?

**A:** TCP is a byte stream. A single `data` event may contain a partial JSON object (the newline delimiter has not arrived yet) or multiple JSON objects concatenated together. Under low load, each `write` often maps to one `data` event by coincidence, masking the bug. Under high load or network fragmentation, chunks split or merge unpredictably. The fix is to buffer incoming data and split on the newline delimiter, handling the case where the buffer contains a partial line at the end. Alternatively, switch to length-prefix framing, which avoids the cost of scanning for delimiters.
:::

::: details Question 2 — Nagle and latency
**Q:** A multiplayer game server built on `node:net` sends small position updates (40 bytes each) every 50ms. Players report 200ms input lag. Network RTT is under 10ms. What is wrong?

**A:** Nagle's algorithm is enabled by default. It holds small packets in the send buffer until the previous packet is acknowledged or enough data accumulates. For 40-byte writes at 50ms intervals, Nagle may batch 2-4 writes together, adding 100-200ms of latency. The fix is `socket.setNoDelay(true)`, which disables Nagle and sends each write immediately. This increases packet overhead (each 40-byte payload gets a 40-byte TCP/IP header), but for a real-time game the latency reduction is worth the bandwidth cost.
:::

::: details Question 3 — Keep-alive vs heartbeats
**Q:** Your service connects to an upstream TCP server through a NAT gateway that has a 5-minute idle timeout. Connections are idle between requests. After a period of inactivity, the next request fails. How do you fix this?

**A:** The NAT gateway silently drops the connection mapping after 5 minutes of inactivity. Neither side knows the mapping is gone until one tries to send data, at which point the packet is either dropped or rejected. Two complementary fixes: (1) Enable TCP keep-alive with an interval shorter than 5 minutes (`socket.setKeepAlive(true, 120000)` for 2-minute probes) so that the NAT mapping is refreshed by probe traffic. (2) Implement application-level heartbeats (ping/pong messages) at a similar interval, which also validate that the remote application is responsive, not just that the TCP stack is alive.
:::

## Key Mental Models

- **TCP is a byte stream, not a message stream.** Never assume one `write` produces one `data` event. Always implement framing.
- **`timeout` is advisory, not automatic.** The socket stays open after a timeout event. You must destroy it yourself.
- **Nagle trades latency for throughput.** Call `setNoDelay(true)` for interactive or request-response protocols; leave it on for bulk transfer.
- **TCP keep-alive is a heartbeat, not a guarantee.** It detects dead connections after the probe interval, which can be minutes. Use application-level pings for faster detection.
- **The listen backlog is finite and silent.** When it overflows, connections are dropped with no log entry on the server. Monitor the OS accept queue under load.

## Related

- [HTTP, Keep-Alive & Pooling](./02-http-keep-alive) — what `node:http` builds on top of `node:net`
- [Timeouts & Slowloris](./03-timeouts-slowloris) — timeout strategies at every layer above TCP
- [libuv Phases](/nodejs/module-02/01-libuv-phases) — how the event loop processes socket events via poll
- [The libuv Threadpool](/nodejs/module-02/04-threadpool) — network I/O does not use the threadpool, but DNS lookups do
