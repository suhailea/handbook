---
title: "SSE & LLM Token Streaming"
outline: deep
---

# SSE & LLM Token Streaming

<span class="badge interview-hot">Interview 🔥🔥🔥</span> <span class="badge">Node 18+ (native fetch)</span> <span class="badge">Highly relevant to AI/LLM backends</span>

**Prerequisites:** [Streams & Backpressure](./02-streams-backpressure) · [AbortController](/nodejs/module-03/03-abort-controller)

## 🗣️ In Plain English

::: tip In Plain English
Picture a sports commentator on the radio. You tune in, and they talk — one sentence at a time — for as long as the match lasts. You don't send messages back; you just listen. If you turn off the radio, the commentator doesn't know immediately, but eventually the station notices your receiver disconnected and stops directing the signal your way.

That is **Server-Sent Events (SSE)**. The browser (or any client) opens a single, long-lived HTTP connection, and the server pushes small text messages down it, one by one. Unlike WebSockets, traffic flows in only one direction: server to client. The protocol is embarrassingly simple — each message is just a few lines of plain text ending with a blank line.

Now imagine the commentator is an AI model generating a long answer. The model doesn't produce the entire answer at once; it spits out one word (one *token*) at a time. Instead of making the user stare at a spinner for thirty seconds, you relay each token the instant it arrives. That is **LLM token streaming** — and SSE is the most common transport for it.

The tricky part is cleanup. If the user closes their browser tab mid-answer, you're still paying the LLM provider for tokens nobody will read. A well-built server detects the disconnect and *aborts the upstream LLM request*, stopping the meter. A careless server keeps streaming into the void until the model finishes. The difference can be hundreds of dollars a day at scale.

So SSE is really three problems in one: (1) the wire format, (2) pushing data without overwhelming the client, and (3) knowing when to stop.
:::

## ⚙️ Under the Hood

### The SSE wire format

SSE is defined in the [WHATWG HTML spec, section 9.2](https://html.spec.whatwg.org/multipage/server-sent-events.html). The server responds with:

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

Each message is one or more field lines followed by a **blank line** (`\n\n`):

```
data: Hello, world

data: {"token": "The"}

event: token
data: {"text": "quick"}
id: 42

: this is a comment, ignored by the client

data: line one
data: line two

```

Field types: `data`, `event`, `id`, `retry`. Only `data` is required. Multi-line data uses repeated `data:` fields — the client concatenates them with `\n`.

### Implementing SSE with `node:http`

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

function sendSSE(res: ServerResponse, event: string, data: string, id?: string): void {
  let message = '';
  if (event !== 'message') message += `event: ${event}\n`;
  if (id) message += `id: ${id}\n`;
  // Handle multi-line data
  for (const line of data.split('\n')) {
    message += `data: ${line}\n`;
  }
  message += '\n'; // blank line terminates the message
  res.write(message);
}

const server = createServer((req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/events') {
    // SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    });

    // Heartbeat to detect dead connections
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15_000);

    let counter = 0;
    const interval = setInterval(() => {
      sendSSE(res, 'update', JSON.stringify({ count: ++counter }), String(counter));
    }, 1_000);

    // Disconnect detection
    req.on('close', () => {
      clearInterval(interval);
      clearInterval(heartbeat);
      console.log('Client disconnected, cleaned up');
    });

    return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(3000, () => console.log('SSE server on :3000'));
// run: node --experimental-strip-types sse-server.ts
```

Key points:
- **No `res.end()`** — the response stays open.
- The `req` `'close'` event fires when the client disconnects (browser tab closed, network drop, `EventSource.close()`).
- The heartbeat comment (`: heartbeat\n\n`) keeps the TCP connection alive through proxies and load balancers that drop idle connections.
- `X-Accel-Buffering: no` tells nginx to disable response buffering for this endpoint — critical for real-time delivery.

### Backpressure with SSE

`res.write()` returns `false` when the kernel send buffer is full (the client is reading slowly). Ignoring this wastes memory:

```typescript
import { createServer, type ServerResponse } from 'node:http';

async function streamWithBackpressure(res: ServerResponse, chunks: string[]): Promise<void> {
  for (const chunk of chunks) {
    const canContinue = res.write(`data: ${chunk}\n\n`);
    if (!canContinue) {
      // Wait for the buffer to drain before sending more
      await new Promise<void>((resolve) => res.once('drain', resolve));
    }
  }
}

const server = createServer(async (req, res) => {
  if (req.url !== '/stream') { res.writeHead(404).end(); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });

  const data = Array.from({ length: 10_000 }, (_, i) => `chunk-${i}`);
  await streamWithBackpressure(res, data);
  res.end();
});

server.listen(3001);
// run: node --experimental-strip-types backpressure-sse.ts
```

### LLM token streaming (OpenAI-compatible format)

The de facto standard set by OpenAI's API uses SSE with JSON `data:` payloads. Each chunk looks like:

```
data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"index":0}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"index":0}]}

data: [DONE]

```

The terminal `data: [DONE]` signals stream completion. Here is a proxy that streams from an upstream LLM API to the client with disconnect detection:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

interface ChatRequest {
  model: string;
  messages: Array<{ role: string; content: string }>;
}

async function proxyLLMStream(
  chatReq: ChatRequest,
  clientRes: ServerResponse,
  signal: AbortSignal,
): Promise<void> {
  const upstreamRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ ...chatReq, stream: true }),
    signal, // abort propagates upstream
  });

  if (!upstreamRes.ok || !upstreamRes.body) {
    clientRes.writeHead(upstreamRes.status).end(upstreamRes.statusText);
    return;
  }

  clientRes.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no',
  });

  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      // Forward raw SSE chunks — they're already in the correct format
      const canContinue = clientRes.write(text);
      if (!canContinue) {
        await new Promise<void>((resolve) => clientRes.once('drain', resolve));
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Client disconnected — expected, not an error
      return;
    }
    throw err;
  } finally {
    clientRes.end();
  }
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST' || req.url !== '/v1/chat') {
    res.writeHead(404).end();
    return;
  }

  // Create an AbortController tied to client disconnect
  const ac = new AbortController();
  req.on('close', () => ac.abort());

  const body = await new Promise<string>((resolve) => {
    let data = '';
    req.on('data', (chunk: Buffer) => { data += chunk.toString(); });
    req.on('end', () => resolve(data));
  });

  const chatReq: ChatRequest = JSON.parse(body);
  await proxyLLMStream(chatReq, res, ac.signal);
});

server.listen(3002, () => console.log('LLM proxy on :3002'));
// run: OPENAI_API_KEY=sk-... node --experimental-strip-types llm-proxy.ts
```

### Parsing SSE on the client (Node consumer)

When your Node service is the *client* consuming an SSE stream (e.g., calling an LLM API), you need to parse the chunked text. Chunks from `fetch` do not align with SSE message boundaries — a single `read()` may contain half a message or three messages:

```typescript
async function* parseSSE(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<{ event: string; data: string; id: string }> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop()!; // last part may be incomplete

      for (const part of parts) {
        if (!part.trim()) continue;

        let event = 'message';
        let data = '';
        let id = '';

        for (const line of part.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data += (data ? '\n' : '') + line.slice(6);
          else if (line.startsWith('id: ')) id = line.slice(4);
          // lines starting with ':' are comments — skip
        }

        if (data) yield { event, data, id };
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// Usage:
// for await (const msg of parseSSE(response.body!)) {
//   if (msg.data === '[DONE]') break;
//   const chunk = JSON.parse(msg.data);
//   process.stdout.write(chunk.choices[0]?.delta?.content ?? '');
// }
// run: node --experimental-strip-types parse-sse.ts
```

### Reconnection and `Last-Event-ID`

The browser's `EventSource` API auto-reconnects on disconnection. It sends the last received `id` as the `Last-Event-ID` header. Your server can use this to resume:

```typescript
import { createServer } from 'node:http';

const eventLog: Array<{ id: number; data: string }> = [];

const server = createServer((req, res) => {
  if (req.url !== '/events') { res.writeHead(404).end(); return; }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
  });

  // Resume from where the client left off
  const lastId = parseInt(req.headers['last-event-id'] as string, 10) || 0;
  const missed = eventLog.filter((e) => e.id > lastId);

  for (const e of missed) {
    res.write(`id: ${e.id}\ndata: ${e.data}\n\n`);
  }

  // Set reconnection interval (milliseconds)
  res.write('retry: 3000\n\n');

  // Continue with live events...
  const interval = setInterval(() => {
    const entry = { id: eventLog.length + 1, data: JSON.stringify({ ts: Date.now() }) };
    eventLog.push(entry);
    res.write(`id: ${entry.id}\ndata: ${entry.data}\n\n`);
  }, 2_000);

  req.on('close', () => clearInterval(interval));
});

server.listen(3003);
// run: node --experimental-strip-types sse-reconnect.ts
```

The `retry:` field tells the client how long to wait before reconnecting (default is typically 3 seconds, but varies by browser).

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Orphaned LLM requests burning money.** The user closes the tab, but the server keeps streaming tokens from the LLM API. Without `req.on('close')` wired to an `AbortController` that cancels the upstream `fetch`, every abandoned request runs to completion. At scale (thousands of concurrent users), this adds up to hundreds of dollars in wasted API costs per day. Symptom: LLM API billing is 2-3x higher than expected relative to completed responses.

**2. nginx/ALB buffering eats your stream.** The server sends tokens in real-time, but the user sees nothing for 30 seconds, then the entire response appears at once. Cause: a reverse proxy is buffering the response body. Fix: set `X-Accel-Buffering: no` in the response headers (nginx), or configure `proxy_buffering off` in the nginx location block. For AWS ALB, ensure the target group is not using response decompression that interferes with streaming.

**3. Heartbeat-less connections get reaped.** Cloud load balancers (ALB, GCP LB) and proxies have idle timeouts (typically 60-120 seconds). If the LLM model is "thinking" and produces no tokens for 90 seconds, the proxy kills the connection. The client sees a network error mid-stream. Fix: send SSE comment heartbeats (`: keep-alive\n\n`) every 15-30 seconds during idle periods.

**4. Memory exhaustion from slow clients.** The LLM produces tokens fast, but a client on a slow mobile connection reads slowly. Without backpressure handling (checking `res.write()` return value), Node buffers the entire response in memory. With hundreds of concurrent streams, this leads to heap exhaustion and process crashes. Symptom: RSS climbs steadily, OOMKilled in K8s. Diagnosis: heap snapshot shows large numbers of buffered `WriteReq` objects on socket handles.
:::

## 🎯 Checkpoint

::: details Question 1 — Wire format
**Q:** An SSE message has `event: token`, `data: {"t":"hi"}`, and `id: 7`. Write the exact bytes the server sends, including the terminating blank line.

**A:**
```
event: token\n
id: 7\n
data: {"t":"hi"}\n
\n
```
Four lines: the `event` field, the `id` field, the `data` field, and a blank line (just `\n`). The blank line is the message delimiter. The order of `event`, `id`, and `data` fields within a message does not matter per the spec, but `data` must come after any field it might reference. Each field line ends with `\n`. The message is terminated by the second consecutive `\n` (the blank line). Total: the bytes `event: token\nid: 7\ndata: {"t":"hi"}\n\n`.
:::

::: details Question 2 — Abort propagation
**Q:** In an LLM streaming proxy, the client disconnects. Describe the chain of events from TCP FIN to the upstream request being cancelled, naming the Node APIs involved.

**A:** (1) The client's TCP stack sends a FIN packet. (2) Node's underlying libuv detects the socket closure and emits `'close'` on the `IncomingMessage` (the `req` object). (3) The `req.on('close')` handler fires, which calls `ac.abort()` on the `AbortController` whose signal was passed to the upstream `fetch()`. (4) The `AbortSignal` transitions to aborted state, which causes the `fetch` internals (undici) to destroy the upstream socket and reject the pending `reader.read()` promise with an `AbortError`. (5) The `catch` block in the streaming loop catches the `AbortError` and exits cleanly. (6) The `finally` block calls `res.end()` (which is a no-op since the client socket is already closed, but ensures cleanup). The key insight is that cancellation is *cooperative*: without explicitly passing the signal to `fetch`, the upstream request runs to completion.
:::

::: details Question 3 — Reconnection semantics
**Q:** A client was receiving events with IDs 1 through 50, then lost connection at ID 42 (received 42, never got 43+). It reconnects. What header does it send, and what must the server do?

**A:** The client sends the header `Last-Event-ID: 42`. The server reads this header from `req.headers['last-event-id']`, converts it to a number, and replays all events with ID > 42 (i.e., events 43 through whatever is current) before switching to live events. If the server does not persist events, it cannot replay — in which case it should either send a special "reset" event telling the client that history is lost, or simply start from the current point. The `retry:` field sent earlier determines how long the client waited before reconnecting (default ~3 seconds). Note: `Last-Event-ID` only works if the server actually set the `id:` field on its messages — if no IDs were sent, the header is empty and no replay is possible.
:::

## Key Mental Models

- **SSE is HTTP with the door held open.** No upgrade, no new protocol — just `text/event-stream`, a long-lived response, and a trivial text format.
- **Disconnect detection is your money switch.** `req.on('close')` wired to `AbortController.abort()` is the difference between paying for tokens that get delivered and paying for tokens that go nowhere.
- **Backpressure applies to SSE too.** `res.write()` returns a boolean. Ignoring it means buffering the entire LLM response in Node's memory when clients are slow.
- **Proxies are your enemy by default.** nginx, ALB, CloudFront all buffer responses unless explicitly told not to. SSE endpoints need `proxy_buffering off` or `X-Accel-Buffering: no`.
- **Heartbeats keep the channel alive.** Without periodic comment frames, idle timeout on any intermediate proxy will kill the connection.

## Related

- [Streams & Backpressure](./02-streams-backpressure) — the Node streaming primitives SSE is built on
- [Streaming & proxy_buffering](/system-design/load-balancing/03-streaming-sse) — nginx and load-balancer configuration for SSE
- [AbortController & AbortSignal](/nodejs/module-03/03-abort-controller) — the cooperative cancellation mechanism used for disconnect cleanup
- [Production LLM Gateway](/nodejs/module-10/03-llm-gateway) — the capstone that builds a full gateway around these patterns
