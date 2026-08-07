---
title: Background Tasks, WebSockets & SSE
outline: deep
---

# Background Tasks, WebSockets & SSE

**Interview weight:** 🔥🔥 — not the most common interview topic, but frequently asked when the role involves real-time features, chat systems, or LLM-powered products. Interviewers want to know you understand the tradeoffs between the three communication patterns.

**Python version:** BackgroundTasks since FastAPI 0.50+. WebSocket support via Starlette since 0.12. SSE via `StreamingResponse` since FastAPI 0.60+. All examples target Python 3.12+ and `pip install "fastapi[standard]"`.

**Prerequisites:** [FastAPI Architecture](./01-architecture), [asyncio](/python/module-07/04-asyncio), [Dependency Injection](./03-dependency-injection)

---

## 🗣️ In Plain English

::: tip In Plain English
FastAPI's real-time features are like different communication styles in a restaurant.

**Background tasks** are like telling a busboy "clean table 5 when you get a chance." The waiter does not wait around holding dirty plates — they hand off the job, turn to the next customer, and say "here's your menu." The busboy gets to it eventually, but the waiter's job (sending a response) is already done. If the busboy calls in sick and nobody cleans the table, tough luck — there is no built-in backup plan. The waiter already told the customer everything is fine.

**WebSockets** are like a phone call between the kitchen and a customer. Once the call connects, both sides can talk freely — the kitchen says "your appetizer is ready," the customer says "actually, extra sauce please," and neither has to hang up and redial between messages. The call stays open until one side hangs up. It is a two-way, persistent conversation.

**Server-Sent Events (SSE)** are like a sports radio broadcast playing on a speaker in the restaurant. The kitchen announces "Order 42 ready! Order 43 ready!" and anyone tuned in hears it in real time. But customers cannot talk back through the speaker — they can only listen. If you have ever watched an AI chatbot type out its answer word by word, that is SSE: the server pushes a stream of small updates, and the client just receives them. Simple, one-directional, and perfect when you only need the server to talk.

The choice between them is about direction and persistence. Need to fire-and-forget some work after responding? Background task. Need a persistent two-way channel? WebSocket. Need to stream data from server to client? SSE. Each adds complexity, so pick the simplest one that fits your use case.
:::

---

## ⚙️ Under the Hood

### BackgroundTasks: Fire-and-Forget Work

FastAPI's `BackgroundTasks` lets you schedule work that runs **after** the response is sent to the client. The client does not wait for the background work to finish.

```python
# run: uvicorn app:app --reload
from fastapi import BackgroundTasks, FastAPI

app = FastAPI()


def write_log(message: str) -> None:
    """Runs AFTER the response is sent."""
    with open("log.txt", "a") as f:
        f.write(f"{message}\n")


async def send_email(to: str, subject: str) -> None:
    """Async background task — simulates sending an email."""
    import asyncio
    await asyncio.sleep(2)  # Simulate slow email API
    print(f"Email sent to {to}: {subject}")


@app.post("/users/", status_code=201)
async def create_user(
    email: str,
    background_tasks: BackgroundTasks,
) -> dict[str, str]:
    # Schedule work to happen AFTER the response
    background_tasks.add_task(write_log, f"User created: {email}")
    background_tasks.add_task(send_email, email, "Welcome!")

    # Response is sent immediately — client does not wait for email/log
    return {"email": email, "status": "created"}
```

**How it works internally:** Starlette's `BackgroundTask` machinery runs your functions after the ASGI `send` of the response body. The tasks execute sequentially in the same event loop (async tasks) or in the same thread (sync tasks). They share the same process memory.

**Common use cases:**
- Sending notification emails after signup
- Updating search indexes or caches
- Writing audit logs
- Post-processing uploaded files (thumbnails, virus scanning)
- Analytics event tracking

#### BackgroundTasks in Dependencies

You can inject `BackgroundTasks` into dependencies, and FastAPI merges them:

```python
# run: uvicorn app:app --reload
from fastapi import BackgroundTasks, Depends, FastAPI

app = FastAPI()


def log_operation(background_tasks: BackgroundTasks) -> None:
    """Dependency that adds its own background task."""
    background_tasks.add_task(print, "Dependency-level background task ran")


@app.post("/items/")
async def create_item(
    background_tasks: BackgroundTasks,
    _: None = Depends(log_operation),
) -> dict[str, str]:
    background_tasks.add_task(print, "Endpoint-level background task ran")
    return {"status": "ok"}
    # Both tasks run after the response is sent
```

#### Limitations of BackgroundTasks

| Limitation | Why it matters |
|-----------|---------------|
| **Same process** | If the process crashes, the task is lost |
| **No retry** | If the task fails, it fails silently (no automatic retry) |
| **No persistence** | Tasks are not stored anywhere — power loss = task gone |
| **Sequential execution** | Tasks run one after another, not in parallel |
| **No result tracking** | You cannot check if a background task completed |

**For serious work, use a task queue:** Celery, ARQ, TaskIQ, or Dramatiq. These provide persistence (Redis/RabbitMQ), retries, result backends, monitoring dashboards, and horizontal scaling across workers.

---

### WebSocket Endpoints

WebSockets provide a persistent, full-duplex communication channel over a single TCP connection.

```python
# run: uvicorn app:app --reload
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()  # Complete the WebSocket handshake
    try:
        while True:
            # Receive a message from the client
            data = await websocket.receive_text()
            # Echo it back (full-duplex — server can send anytime)
            await websocket.send_text(f"Echo: {data}")
    except WebSocketDisconnect:
        print("Client disconnected")
```

#### WebSocket Lifecycle

The lifecycle follows a strict pattern:

1. **Client sends HTTP upgrade request** with `Connection: Upgrade` and `Upgrade: websocket`
2. **Server calls `await websocket.accept()`** — completes the handshake, returns 101 Switching Protocols
3. **Message loop** — both sides send/receive freely
4. **Disconnect** — either side closes; server catches `WebSocketDisconnect`

#### Sending and Receiving Data

```python
# run: uvicorn app:app --reload
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()


@app.websocket("/ws/typed")
async def typed_websocket(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            # Receive — choose your format
            text: str = await websocket.receive_text()
            # json_data: dict = await websocket.receive_json()
            # raw: bytes = await websocket.receive_bytes()

            # Send — matching methods
            await websocket.send_text(f"Got: {text}")
            await websocket.send_json({"received": text, "length": len(text)})
            # await websocket.send_bytes(b"\x00\x01\x02")
    except WebSocketDisconnect:
        pass
```

#### Connection Manager Pattern

For multi-client features like chat rooms or live dashboards, you need to track active connections:

```python
# run: uvicorn app:app --reload
from fastapi import FastAPI, WebSocket, WebSocketDisconnect

app = FastAPI()


class ConnectionManager:
    """Tracks active WebSocket connections and broadcasts messages."""

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.active_connections.remove(websocket)

    async def send_personal(self, message: str, websocket: WebSocket) -> None:
        await websocket.send_text(message)

    async def broadcast(self, message: str) -> None:
        for connection in self.active_connections:
            await connection.send_text(message)


manager = ConnectionManager()


@app.websocket("/ws/chat/{client_id}")
async def chat_endpoint(websocket: WebSocket, client_id: int) -> None:
    await manager.connect(websocket)
    await manager.broadcast(f"Client #{client_id} joined the chat")
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(f"Client #{client_id}: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(f"Client #{client_id} left the chat")
```

#### WebSocket with Dependencies

`Depends()` works in WebSocket handlers, which is useful for extracting query parameters or shared resources:

```python
# run: uvicorn app:app --reload
from fastapi import Depends, FastAPI, Query, WebSocket, WebSocketDisconnect

app = FastAPI()


async def get_token(token: str = Query(...)) -> str:
    """Extract token from query string: ws://localhost:8000/ws?token=abc123"""
    # In production: validate the token, raise WebSocketException if invalid
    return token


@app.websocket("/ws/auth")
async def authenticated_ws(
    websocket: WebSocket,
    token: str = Depends(get_token),
) -> None:
    await websocket.accept()
    await websocket.send_text(f"Authenticated with token: {token}")
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"[{token[:6]}...] {data}")
    except WebSocketDisconnect:
        pass
```

#### WebSocket Authentication

WebSockets cannot use standard HTTP headers after the initial handshake. Two common patterns:

1. **Query parameter auth:** Pass the token in the URL: `ws://host/ws?token=eyJhb...`. Simple but the token appears in server logs and browser history.

2. **First-message auth:** Accept the connection, then require the first message to be a credentials payload. Close the connection if authentication fails.

```python
# run: uvicorn app:app --reload
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

app = FastAPI()

VALID_TOKENS = {"secret-token-123"}  # In production: verify JWTs


@app.websocket("/ws/first-msg-auth")
async def first_message_auth(websocket: WebSocket) -> None:
    await websocket.accept()

    # First message must be the auth token
    token = await websocket.receive_text()
    if token not in VALID_TOKENS:
        await websocket.send_json({"error": "Invalid token"})
        await websocket.close(code=1008)  # 1008 = Policy Violation
        return

    await websocket.send_json({"status": "authenticated"})
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Secure echo: {data}")
    except WebSocketDisconnect:
        pass
```

---

### Server-Sent Events (SSE)

SSE is a one-way streaming protocol: the server pushes events to the client over a long-lived HTTP connection. The client uses the standard `EventSource` browser API or any HTTP client that reads the stream.

#### SSE with StreamingResponse

FastAPI (via Starlette) supports SSE through `StreamingResponse` with an async generator:

```python
# run: uvicorn app:app --reload
import asyncio
from collections.abc import AsyncGenerator

from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


async def event_generator(request: Request) -> AsyncGenerator[str, None]:
    """Yields SSE-formatted events until client disconnects."""
    count = 0
    while True:
        # Check if client disconnected
        if await request.is_disconnected():
            print("Client disconnected, stopping SSE stream")
            break

        count += 1
        # SSE format: "data: <payload>\n\n" (double newline terminates event)
        yield f"data: Event #{count} at {asyncio.get_event_loop().time():.1f}\n\n"
        await asyncio.sleep(1)


@app.get("/events")
async def stream_events(request: Request) -> StreamingResponse:
    return StreamingResponse(
        event_generator(request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
```

#### SSE for LLM Token Streaming

One of the most practical uses of SSE today: streaming tokens from an LLM API to the browser, word by word.

```python
# run: pip install httpx && uvicorn app:app --reload
import asyncio
import json
from collections.abc import AsyncGenerator

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()


async def stream_llm_tokens(
    prompt: str,
    request: Request,
) -> AsyncGenerator[str, None]:
    """
    Stream tokens from an LLM API to the client via SSE.
    Handles client disconnect gracefully.
    """
    # Simulated LLM response — in production, use httpx to call OpenAI/Anthropic
    tokens = f"The answer to '{prompt}' is that you need to consider ".split()

    for token in tokens:
        if await request.is_disconnected():
            print("Client disconnected during LLM streaming")
            break

        # Send each token as an SSE event
        event_data = json.dumps({"token": token, "done": False})
        yield f"data: {event_data}\n\n"
        await asyncio.sleep(0.1)  # Simulate token generation delay
    else:
        # Send completion signal
        yield f"data: {json.dumps({'token': '', 'done': True})}\n\n"


@app.get("/chat/stream")
async def chat_stream(prompt: str, request: Request) -> StreamingResponse:
    return StreamingResponse(
        stream_llm_tokens(prompt, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

**Production LLM streaming pattern with httpx:**

```python
# run: pip install httpx && uvicorn app:app --reload
import json
from collections.abc import AsyncGenerator

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

app = FastAPI()

LLM_API_URL = "https://api.example.com/v1/chat/completions"
LLM_API_KEY = "your-api-key"  # Use environment variables in production


async def proxy_llm_stream(
    prompt: str,
    request: Request,
) -> AsyncGenerator[str, None]:
    """
    Proxy a streaming response from an LLM API.
    Cleans up the upstream connection if the client disconnects.
    """
    async with httpx.AsyncClient(timeout=60.0) as client:
        async with client.stream(
            "POST",
            LLM_API_URL,
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json={"prompt": prompt, "stream": True},
        ) as response:
            async for line in response.aiter_lines():
                if await request.is_disconnected():
                    # Client left — break triggers __aexit__,
                    # which closes the upstream connection
                    break

                if line.startswith("data: "):
                    yield f"{line}\n\n"

    # When we exit the `async with` blocks, httpx closes the upstream
    # connection automatically — no leaked sockets
```

---

### Comparing the Three Patterns

| Feature | BackgroundTasks | WebSocket | SSE |
|---------|----------------|-----------|-----|
| **Direction** | None (post-response work) | Bidirectional | Server → Client only |
| **Connection** | Standard HTTP (closes normally) | Persistent, upgraded connection | Persistent HTTP connection |
| **Client receives response** | Immediately (task runs after) | Messages arrive anytime | Events stream continuously |
| **Protocol** | HTTP | WebSocket (RFC 6455) | HTTP with `text/event-stream` |
| **Browser API** | `fetch` | `new WebSocket(url)` | `new EventSource(url)` |
| **Auto-reconnect** | N/A | No (must implement) | Yes (EventSource reconnects) |
| **Complexity** | Low | High | Medium |
| **Use case** | Email, logging, cleanup | Chat, gaming, collaboration | Live feeds, LLM streaming, notifications |
| **Scalability concern** | Process memory / crash risk | Connection count, memory per socket | Connection count (lighter than WS) |

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. BackgroundTasks silently swallow exceptions.**
If a background task raises an exception, the client has already received their response. The error appears in server logs (if you have logging configured), but nobody is notified. In production, a "send welcome email" task that fails means a user never gets onboarded. **Diagnosis:** you see successful 201 responses but users report never receiving emails. **Fix:** wrap background tasks in try/except with alerting, or use a proper task queue (Celery/ARQ) that provides retries and dead-letter queues.

**2. WebSocket connections leak memory without proper cleanup.**
Every active WebSocket holds memory. If your `ConnectionManager` does not call `disconnect()` on every exit path (including server-side errors, not just `WebSocketDisconnect`), you accumulate dead connections. Under load, this manifests as steadily increasing RSS memory and eventually OOM kills. **Diagnosis:** pod restarts with OOMKilled status, connection count metrics diverging from active user count. **Fix:** use `try/finally` to guarantee cleanup:

```python
@app.websocket("/ws")
async def safe_ws(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.broadcast(data)
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(websocket)  # ALWAYS runs
```

**3. SSE streams blocked by nginx buffering.**
By default, nginx buffers upstream responses. For SSE, this means the client sees nothing until the buffer fills (typically 4KB-8KB) or the connection closes. Your stream looks "frozen" even though the server is emitting events. **Diagnosis:** SSE works with `uvicorn` directly but breaks behind nginx. **Fix:** set `proxy_buffering off;` in your nginx location block, or send the `X-Accel-Buffering: no` header (as shown in the examples above). Also set `proxy_read_timeout` high enough for long-lived SSE connections.

**4. SSE client disconnect detection is not instantaneous.**
`request.is_disconnected()` in the async generator only detects disconnection when you actually check it. If your generator spends 30 seconds waiting on an upstream API call between checks, you keep the upstream connection alive for 30 seconds after the client is gone. **Fix:** use `asyncio.wait` or cancellation scopes to combine disconnect detection with your upstream awaits.
:::

---

## 🎯 Checkpoint

::: details Question 1 — BackgroundTasks vs Celery
**Q:** A FastAPI endpoint processes a user upload, generates a thumbnail, and sends a confirmation email. The team uses `BackgroundTasks` for both. After a deployment, users report that thumbnails sometimes appear but emails never arrive. What is the most likely cause, and what architectural change would you recommend?

**A:** `BackgroundTasks` executes tasks sequentially in the same process. If thumbnail generation is CPU-intensive and takes a long time, and the process is restarted (deployment rolling update, OOM, crash) before the email task runs, the email is lost forever because `BackgroundTasks` has no persistence or retry mechanism. The fix is to use `BackgroundTasks` only for lightweight, loss-tolerant work (like logging), and move the email sending to a persistent task queue (Celery with Redis/RabbitMQ, or ARQ). The task queue persists the job to a broker, provides automatic retries with backoff, and can be monitored independently.
:::

::: details Question 2 — WebSocket vs SSE for LLM streaming
**Q:** You are building a chat interface for an LLM. Should you use WebSockets or SSE for streaming the model's response tokens to the browser? What are the tradeoffs?

**A:** SSE is the better default choice for LLM token streaming. The communication pattern is inherently server-to-client during response generation — the model produces tokens and the client consumes them. SSE advantages: automatic browser reconnection via `EventSource`, works through HTTP/2 multiplexing, simpler server implementation, and no need for a custom ping/pong keepalive. The user's next message can be sent via a regular POST request, which is simpler than maintaining WebSocket state. WebSockets become worthwhile when you need true bidirectional streaming — for example, if the user can interrupt the model mid-generation (stop/cancel) without waiting for a round-trip, or if you need to push server-initiated messages (typing indicators, context updates) while the user is composing. The cost of WebSockets: more complex connection management, no automatic reconnection, harder to load-balance (sticky sessions or shared state), and you must implement your own message framing protocol.
:::

::: details Question 3 — SSE disconnect cleanup
**Q:** An SSE endpoint proxies tokens from an upstream LLM API using `httpx.AsyncClient.stream()`. If the browser tab is closed mid-stream, what happens to the upstream connection, and how do you ensure it is cleaned up?

**A:** When the browser closes the tab, the TCP connection to your server is severed. However, your async generator does not know this until it calls `await request.is_disconnected()`. Meanwhile, the `httpx` upstream connection remains open, consuming resources on both your server and the LLM API. The cleanup happens when you break out of the generator loop (triggered by the disconnect check), which exits the `async with client.stream(...)` context manager, which calls `response.aclose()`, which closes the upstream TCP connection. The key design requirement is that disconnect checks happen frequently — ideally on every iteration of the token loop. If the upstream API is slow to produce tokens, you should use `asyncio.wait` with a disconnect-checking task to avoid keeping the upstream connection alive long after the client is gone.
:::

---

## Key Mental Models

- **BackgroundTasks are convenience, not infrastructure.** They run in the same process with no persistence, retry, or monitoring. Use them for lightweight fire-and-forget work; use a real task queue for anything that matters.

- **WebSockets are phone calls; SSE is a radio broadcast.** Choose based on whether you need bidirectional communication or just server-to-client push.

- **SSE is just HTTP with a specific content type.** It works through proxies, load balancers, and CDNs with minimal configuration (disable buffering). WebSockets require upgrade support at every layer.

- **Disconnect detection is your responsibility.** Neither WebSocket nor SSE automatically cleans up server-side resources when the client vanishes. Check `is_disconnected()` or catch `WebSocketDisconnect` and put cleanup in `finally` blocks.

- **For LLM streaming, SSE is the pragmatic default.** The token-by-token pattern is inherently server-to-client, and SSE's simplicity (auto-reconnect, standard HTTP) outweighs WebSocket's bidirectional capability for most chat interfaces.

---

## Related

- [asyncio — Async/Await from Scratch](/python/module-07/04-asyncio) — the event loop that powers all three patterns
- [FastAPI Architecture](./01-architecture) — ASGI foundation that enables WebSocket and streaming support
- [Dependency Injection](./03-dependency-injection) — using `Depends()` in WebSocket handlers
- [Deployment & Production](./09-deployment) — configuring nginx for SSE passthrough and WebSocket upgrades
- [System Design — Queues](/system-design/queues/) — when BackgroundTasks are not enough
