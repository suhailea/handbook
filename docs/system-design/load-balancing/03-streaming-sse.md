---
title: Streaming, SSE & proxy_buffering
outline: deep
---

# Streaming, SSE & proxy_buffering

<Badge type="tip" text="Interview: 🔥🔥🔥 (critical for LLM/AI applications)" /> <Badge type="info" text="Prereqs: nginx as Reverse Proxy, HTTP chunked encoding, SSE basics" />

## 🗣️ In Plain English

::: tip In Plain English
Imagine a translator working between a chef and a restaurant guest. Normally, the translator waits until the chef finishes the entire explanation of the dish before turning to the guest and repeating everything. This is buffering -- collect the whole response, then deliver it all at once. For a simple dish description, this works fine. The guest gets everything in one clean summary.

Now imagine the chef is narrating a live cooking demonstration, step by step, over the course of an hour. If the translator still waits for the chef to finish before speaking, the guest sits in silence for an hour and then gets a massive wall of text. That is exactly what happens when nginx buffers a streaming response -- the client sees nothing until the entire response is complete, which defeats the whole point of streaming.

The fix is to tell the translator: "Do not wait. As the chef says each sentence, repeat it to the guest immediately." In nginx, this is `proxy_buffering off`. Each chunk of data from the backend is forwarded to the client the instant it arrives.

This matters enormously in the age of LLMs. When ChatGPT or Claude streams tokens back to you word by word, there is almost certainly a reverse proxy between the LLM backend and your browser. If that proxy is buffering, you see nothing for 10-30 seconds and then the entire answer appears at once -- terrible user experience. With buffering disabled, each token appears on your screen as it is generated, creating that familiar "typing" effect.

The same principle applies to Server-Sent Events (SSE), where a server pushes a continuous stream of updates to a client, and to WebSockets, where both sides send messages freely. Any long-lived, incremental-delivery connection will break if a proxy in the middle tries to collect and hold the entire response.

This page covers exactly which nginx settings to change, the timeout traps that kill long-lived connections, and a production-ready configuration for proxying LLM streaming APIs.
:::

## ⚙️ Under the Hood

### nginx Buffering: Default Behavior

By default, nginx buffers the **entire upstream response** in memory (or on disk if it exceeds `proxy_buffer_size`) before sending anything to the client.

```
Client ←──── waits ────── nginx ←──── buffering ────── Backend
                          [████████████████████]
                          entire response collected
                          THEN sent to client
```

**Why nginx buffers by default:**
- The backend can send the response as fast as possible and free its resources immediately.
- nginx absorbs the speed mismatch between a fast backend and a slow client.
- For static or short responses, this improves throughput.

**Default buffer settings:**

```nginx
proxy_buffering on;                # default: ON
proxy_buffer_size 4k;              # buffer for the first part of the response (headers)
proxy_buffers 8 4k;                # 8 buffers of 4k each = 32k for the response body
proxy_busy_buffers_size 8k;        # how much can be sent to client while still buffering
proxy_temp_file_write_size 8k;     # if buffers overflow, write to disk
```

### Why Buffering Breaks Streaming

With streaming, SSE, or LLM token delivery, the response is not a fixed-size document. It is an open-ended stream of small chunks delivered over seconds or minutes. Buffering causes two problems:

1. **Delayed first byte.** The client sees nothing until nginx has collected enough data to fill its buffers or the upstream closes the connection.
2. **Timeout before completion.** For long-running streams, `proxy_read_timeout` (default 60s) may expire before the stream ends, killing the connection.

```
WITHOUT proxy_buffering off:
Client ←── 60s silence ── nginx ←── chunk chunk chunk ── Backend
                          [buffering........................]
                          timeout → 504 Gateway Timeout

WITH proxy_buffering off:
Client ←── chunk ←── chunk ←── chunk ── nginx ←── chunk ←── Backend
           instant forwarding, no buffering
```

### Disabling Buffering

#### Option 1: Global or per-location in nginx config

```nginx
location /api/stream {
    proxy_pass http://node_app;
    proxy_buffering off;             # forward chunks immediately
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
}
```

#### Option 2: Per-response via `X-Accel-Buffering` header

The backend application can control buffering on a per-response basis by sending this header:

```
X-Accel-Buffering: no
```

This is more granular than a global `proxy_buffering off`. Your backend can buffer normal API responses (fast, short) while disabling buffering only for streaming endpoints.

```javascript
// Node.js / Express example
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');    // tell nginx: do not buffer this response
  res.setHeader('Connection', 'keep-alive');

  // stream data...
});
```

nginx reads this header from the upstream response and disables buffering for that specific response. The header is not forwarded to the client.

### Chunked Transfer Encoding

HTTP/1.1 chunked transfer encoding allows a server to send a response in pieces without knowing the total size upfront. Each chunk is prefixed with its size in hexadecimal:

```
HTTP/1.1 200 OK
Transfer-Encoding: chunked

4\r\n
data\r\n
5\r\n
chunk\r\n
0\r\n
\r\n
```

With `proxy_buffering off`, nginx preserves chunked encoding and forwards each chunk as it arrives. No special configuration is needed beyond disabling buffering.

### Server-Sent Events (SSE) through nginx

SSE is a simple protocol where the server sends a stream of events to the client over a long-lived HTTP connection:

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: first event\n\n
data: second event\n\n
data: {"token": "Hello"}\n\n
```

**Complete nginx config for SSE:**

```nginx
location /api/events {
    proxy_pass http://node_app;

    # --- Disable buffering ---
    proxy_buffering off;
    proxy_cache off;

    # --- HTTP/1.1 with keepalive ---
    proxy_http_version 1.1;
    proxy_set_header Connection "";

    # --- Headers ---
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # --- Extended timeouts for long-lived connections ---
    proxy_read_timeout 3600s;        # 1 hour (default 60s is way too short)
    proxy_send_timeout 3600s;

    # --- Do NOT gzip SSE (defeats streaming) ---
    gzip off;
}
```

### WebSocket Proxying

WebSockets require an HTTP upgrade handshake. nginx must forward the `Upgrade` and `Connection` headers:

```nginx
location /ws {
    proxy_pass http://node_app;
    proxy_http_version 1.1;

    # --- WebSocket upgrade ---
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # --- Standard headers ---
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # --- Extended timeouts ---
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
}
```

**Important:** the `Connection` header for WebSockets is `"upgrade"` (literal string), not `""` (empty string used for keepalive). These are different use cases and must not be mixed.

### Timeout Configuration for Long-Lived Connections

| Directive | Default | What It Controls | Streaming Setting |
|---|---|---|---|
| `proxy_read_timeout` | 60s | Time nginx waits between two reads from upstream | 3600s or higher |
| `proxy_send_timeout` | 60s | Time nginx waits between two writes to the client | 3600s or higher |
| `proxy_connect_timeout` | 60s | Time to establish connection to upstream | 5s (keep short) |
| `keepalive_timeout` | 75s | How long idle client connections stay open | 3600s for SSE |
| `send_timeout` | 60s | Time between two writes to client (non-proxied) | 3600s for SSE |

**Critical detail:** `proxy_read_timeout` is the time between two successive reads, not the total connection duration. If your SSE stream sends a heartbeat comment (`:heartbeat\n\n`) every 30 seconds, a `proxy_read_timeout` of 60 seconds will never trigger because data arrives every 30 seconds. This is why SSE servers should send periodic heartbeats.

### LLM Streaming through nginx -- Production Configuration

A complete, production-ready config for proxying LLM API responses (OpenAI-compatible SSE):

```nginx
upstream llm_backend {
    least_conn;
    server 10.0.0.1:8000;
    server 10.0.0.2:8000;

    keepalive 32;
}

server {
    listen 443 ssl http2;
    server_name llm-gateway.example.com;

    ssl_certificate     /etc/nginx/ssl/llm-gateway.crt;
    ssl_certificate_key /etc/nginx/ssl/llm-gateway.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    # --- Non-streaming endpoints (normal buffering) ---
    location /v1/embeddings {
        proxy_pass http://llm_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        proxy_read_timeout 120s;     # embeddings can be slow but not streaming
    }

    # --- Streaming chat completions ---
    location /v1/chat/completions {
        proxy_pass http://llm_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # --- Streaming essentials ---
        proxy_buffering off;         # forward tokens immediately
        proxy_cache off;             # do not cache streaming responses
        chunked_transfer_encoding on;

        # --- Extended timeouts ---
        proxy_read_timeout 300s;     # 5 minutes for long completions
        proxy_send_timeout 300s;
        proxy_connect_timeout 10s;

        # --- Do NOT compress SSE ---
        gzip off;

        # --- Retry on connection errors, but NOT on timeouts ---
        # (retrying a timed-out LLM request could cause duplicate work)
        proxy_next_upstream error;
        proxy_next_upstream_tries 1;
    }

    # --- Health check ---
    location /health {
        proxy_pass http://llm_backend;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        access_log off;
    }
}
```

### Why NOT to gzip SSE

gzip compresses data in blocks. It collects data until it has enough to form an efficient compressed block, then emits it. This reintroduces buffering at the compression layer, defeating the purpose of `proxy_buffering off`.

Even if you flush the gzip stream after each chunk, the compression overhead adds latency for tiny payloads (individual LLM tokens are often just a few bytes). The bandwidth savings on such small payloads are negligible.

**Rule: always set `gzip off` for SSE and streaming endpoints.**

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. The 60-second SSE blackout**
*Symptoms:* LLM streaming endpoint works perfectly in development (direct connection to Node). In production behind nginx, users see nothing for exactly 60 seconds, then either get the entire response at once or a 504 timeout.
*Root cause:* `proxy_buffering` is on (default), and `proxy_read_timeout` is 60 seconds (default). nginx collects chunks silently, then either delivers them when the response completes or times out.
*Diagnosis:* Check `proxy_buffering` setting. If the response arrives all at once after a delay, buffering is the culprit. If you get a 504 after exactly 60 seconds, raise `proxy_read_timeout`. Fix: add `proxy_buffering off;` and `proxy_read_timeout 300s;` to the streaming location block.

**2. SSE streams dying silently after 75 seconds of idle**
*Symptoms:* Long-running SSE connections drop after ~75 seconds of no data. No error in nginx logs.
*Root cause:* `proxy_read_timeout` defaults to 60s; `keepalive_timeout` defaults to 75s. Whichever triggers first closes the connection. If the SSE stream has periods of silence (no heartbeat), nginx considers the upstream unresponsive.
*Diagnosis:* Add heartbeat comments (`: heartbeat\n\n`) from the backend every 15-30 seconds. Raise `proxy_read_timeout` to 3600s. The heartbeat resets the timeout counter.

**3. gzip re-buffering streaming responses**
*Symptoms:* `proxy_buffering off` is set, but clients still see delayed, bursty delivery instead of smooth token-by-token streaming.
*Root cause:* gzip is enabled globally (`gzip on` in the http block) and is compressing the SSE response. gzip collects data into compression blocks before emitting, reintroducing buffering after nginx's proxy layer already disabled it.
*Diagnosis:* Check the response headers -- if you see `Content-Encoding: gzip`, that is the problem. Fix: add `gzip off;` in the streaming location block.

**4. WebSocket connections dropping on idle**
*Symptoms:* WebSocket connections are established successfully but disconnect after 60 seconds if no messages are exchanged.
*Root cause:* `proxy_read_timeout` (60s default) applies to WebSockets too. No data in 60 seconds means nginx closes the connection.
*Diagnosis:* Implement WebSocket ping/pong frames at an interval shorter than the timeout (e.g., every 30 seconds). Raise `proxy_read_timeout` to 3600s.
:::

## 🎯 Checkpoint

::: details Question 1 -- Buffering diagnosis
**Q:** Your team deploys an LLM-powered chat feature. During testing on localhost, tokens stream smoothly. In production (behind nginx), the user sees a loading spinner for 8 seconds, then the entire answer appears at once. What is happening?

**A:** nginx is buffering the entire upstream response before forwarding it to the client. The 8-second delay is the time it takes for the LLM to generate the complete response. Once the backend closes the response (or the buffer fills), nginx sends everything at once. The fix is `proxy_buffering off;` in the nginx location block for the chat endpoint. Alternatively, the backend can send the `X-Accel-Buffering: no` header, which tells nginx to disable buffering for that specific response.
:::

::: details Question 2 -- X-Accel-Buffering vs proxy_buffering
**Q:** When would you use `X-Accel-Buffering: no` instead of `proxy_buffering off` in the nginx config?

**A:** Use `X-Accel-Buffering: no` when the same endpoint can return both buffered and streaming responses, or when different endpoints under the same location prefix have different buffering needs. For example, `/v1/chat/completions` with `stream: true` should not be buffered, but the same endpoint with `stream: false` benefits from buffering. The backend can check the request parameter and conditionally set the `X-Accel-Buffering` header. This is more granular than `proxy_buffering off`, which disables buffering for all responses matched by that location block.
:::

::: details Question 3 -- Timeout math with heartbeats
**Q:** Your SSE endpoint has `proxy_read_timeout 60s` in nginx. The backend sends a heartbeat comment every 45 seconds during idle periods. Will the connection survive indefinitely?

**A:** Yes. `proxy_read_timeout` is the maximum time between two successive reads from the upstream, not the total connection duration. Each heartbeat resets the 60-second timer. As long as the backend sends data (including heartbeat comments like `: heartbeat\n\n`) more frequently than every 60 seconds, the connection will not be closed by this timeout. However, it is better practice to set `proxy_read_timeout` to a much higher value (e.g., 3600s) as a safety net, and use heartbeats at a comfortable interval (every 15-30 seconds) rather than cutting it close.
:::

## 🏗️ Design It

::: details Scenario: LLM gateway with 60-second delay

**Problem:** Your LLM gateway streams tokens via SSE through nginx. Users report a 60-second delay before seeing any output. After the delay, they either see the entire response at once or get a "504 Gateway Timeout" error. Diagnose and fix.

---

**Worked Solution:**

**Step 1 -- Identify the two symptoms and their causes.**

| Symptom | Root Cause |
|---|---|
| 60-second delay then full response appears at once | `proxy_buffering on` (default). nginx collects the whole response. |
| 60-second delay then 504 | `proxy_read_timeout 60s` (default). LLM takes longer than 60s, nginx gives up. |

Both problems often occur together because the default config has both buffering enabled and a 60-second read timeout.

**Step 2 -- Fix the nginx configuration.**

Before (broken):
```nginx
location /v1/chat/completions {
    proxy_pass http://llm_backend;
    # all defaults: proxy_buffering on, proxy_read_timeout 60s
}
```

After (fixed):
```nginx
location /v1/chat/completions {
    proxy_pass http://llm_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # --- Fix 1: disable buffering ---
    proxy_buffering off;
    proxy_cache off;

    # --- Fix 2: extend timeouts ---
    proxy_read_timeout 300s;      # 5 minutes for long completions
    proxy_send_timeout 300s;
    proxy_connect_timeout 10s;    # keep connect timeout short

    # --- Fix 3: disable gzip ---
    gzip off;

    # --- Fix 4: chunked encoding ---
    chunked_transfer_encoding on;
}
```

**Step 3 -- Backend-side hardening.** Add a heartbeat from the LLM backend to prevent idle timeout during slow generation:

```
: heartbeat\n\n     ← SSE comment, sent every 15 seconds during generation pauses
data: {"token": "The"}\n\n
data: {"token": " answer"}\n\n
: heartbeat\n\n
data: {"token": " is"}\n\n
data: [DONE]\n\n
```

**Step 4 -- Verify.** Use `curl` to confirm streaming works:

```bash
curl -N -H "Accept: text/event-stream" https://llm-gateway.example.com/v1/chat/completions \
  -d '{"model": "gpt-4", "messages": [{"role": "user", "content": "Hello"}], "stream": true}'
```

The `-N` flag disables curl's own buffering. You should see tokens appear one by one. If they still appear in batches, check for other proxies in the chain (CDN, cloud load balancer) that may also be buffering.

**Step 5 -- Monitor.** Track `$upstream_response_time` to measure total generation time and `$request_time` for end-to-end latency. For streaming, these will be nearly identical (data is forwarded immediately, so nginx does not add delay).
:::

## Key Mental Models

- **Buffering trades latency for throughput.** It is the right default for short responses but the wrong default for streaming. Know which endpoints need which mode.
- **`proxy_buffering off` is necessary but not sufficient.** You also need extended timeouts, disabled gzip, and correct chunked encoding for a complete streaming setup.
- **`X-Accel-Buffering` gives per-response control.** Let the backend decide whether to buffer, rather than making a global nginx decision.
- **Heartbeats are timeout insurance.** A periodic SSE comment (`: heartbeat\n\n`) costs nothing but prevents proxy timeouts from killing long-lived connections.
- **Every proxy in the chain must be streaming-aware.** nginx, CDN, cloud load balancer -- if any one of them buffers, the client experience breaks.

## Related

- [nginx as Reverse Proxy](./02-nginx)
- [SSE & LLM Token Streaming](/nodejs/module-04/04-sse-streaming)
- [L4 vs L7 & Algorithms](./01-l4-vs-l7)
