---
title: FastAPI Architecture — What's Under the Hood
outline: deep
---

# FastAPI Architecture — What's Under the Hood

**Interview weight:** 🔥🔥🔥 | **Python 3.12+** | **FastAPI 0.110+, Pydantic v2** | **Prerequisites:** [Module 7 — asyncio](/python/module-07/), [Module 10 — Type Hints](/python/module-10/)

## 🗣️ In Plain English

::: tip In Plain English
FastAPI is like a high-end restaurant built on top of two things: a professional kitchen and a strict quality inspector.

The **kitchen** is Starlette. It handles all the plumbing — receiving orders from customers (HTTP requests), figuring out which chef should handle each order (routing), and sending the finished plates back out (responses). Starlette has been doing this job for years and is extremely good at handling many orders at once without breaking a sweat.

The **quality inspector** is Pydantic. Before any ingredient enters the kitchen, the inspector checks it against a strict checklist: Is this actually a number? Is this string short enough? Does this JSON have all the required fields? And before any plate leaves, the inspector verifies it matches the menu description exactly. Nothing invalid gets in, and nothing malformed goes out.

**FastAPI itself** is the head chef who designed the menu and coordinates everything. You, the developer, write the menu — your route handlers and their type annotations. From those annotations alone, FastAPI figures out what the inspector should check, what the kitchen should expect, and even generates a printed menu with pictures (the automatic API documentation) that customers can browse.

There is one more piece: **ASGI**. Think of ASGI as the building code the kitchen was constructed to follow. It specifies how orders arrive from the outside world and how the kitchen handles multiple orders simultaneously. An older building code, WSGI, required a separate cook for every single order — if you had 100 customers, you needed 100 cooks. ASGI lets one cook juggle many orders at once by working on whichever dish needs attention right now, instead of standing idle while the oven heats up.

**Uvicorn** is the front door and the waiter — the server that actually listens for customers arriving (TCP connections), takes their orders (parses HTTP), and hands them to the kitchen (your ASGI app). Without Uvicorn, the kitchen has no way to hear from the outside world.

So when a request arrives: Uvicorn receives it, hands it to the ASGI kitchen (Starlette), which routes it to the right handler. Along the way, Pydantic inspects every input and output. FastAPI orchestrates all of this through your type-annotated function signatures. That is the entire architecture in a nutshell.
:::

## ⚙️ Under the Hood

### Install

```bash
pip install "fastapi[standard]"
# This installs FastAPI + Uvicorn + other standard extras
```

### The ASGI Spec: Why WSGI Was Not Enough

WSGI (Web Server Gateway Interface, PEP 3333) defined how Python web servers talk to Python web applications. Its contract is simple:

```python
# WSGI callable — synchronous, one request at a time per worker
def wsgi_app(environ: dict, start_response) -> Iterable[bytes]:
    start_response("200 OK", [("Content-Type", "text/plain")])
    return [b"Hello, World!"]
```

The problem: WSGI is fundamentally synchronous. Each worker process handles one request at a time. If your handler awaits a database query for 50ms, the worker sits idle for 50ms. To handle 100 concurrent requests, you need 100 worker processes.

ASGI (Asynchronous Server Gateway Interface) replaced WSGI with an async-native protocol. An ASGI application is an async callable with three parameters:

```python
# ASGI callable — async, handles connections concurrently
async def asgi_app(scope: dict, receive, send) -> None:
    """
    scope  — dict describing the connection (type, path, headers, etc.)
    receive — async callable to receive incoming data (request body chunks)
    send   — async callable to send outgoing data (response headers, body)
    """
    assert scope["type"] == "http"

    body = b"Hello from raw ASGI!"
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": [
            [b"content-type", b"text/plain"],
        ],
    })
    await send({
        "type": "http.response.body",
        "body": body,
    })

# run: uvicorn raw_asgi:asgi_app
```

Key differences:

| Aspect | WSGI | ASGI |
|--------|------|------|
| Concurrency model | Sync — one request per worker | Async — many requests per worker |
| Protocol support | HTTP only | HTTP, WebSocket, HTTP/2, lifespan events |
| Long-lived connections | Not supported | Native (WebSockets, SSE) |
| Calling convention | `app(environ, start_response)` | `await app(scope, receive, send)` |
| Worker efficiency | Blocks during I/O | Yields during I/O, serves other requests |

### Starlette: The ASGI Toolkit

FastAPI does not implement HTTP handling, routing, middleware, or request/response objects from scratch. It inherits all of that from **Starlette**. Here is a pure Starlette app:

```python
# starlette_demo.py
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route


async def homepage(request: Request) -> JSONResponse:
    return JSONResponse({"message": "Hello from Starlette"})


app = Starlette(routes=[
    Route("/", homepage),
])

# run: uvicorn starlette_demo:app --reload
```

Starlette provides:
- **`Request`** — wraps the ASGI `scope` and `receive` into a friendly object with `.query_params`, `.path_params`, `.json()`, `.body()`, `.headers`, `.cookies`
- **`Response` / `JSONResponse` / `HTMLResponse` / `StreamingResponse`** — wraps `send` into a high-level interface
- **`Router` / `Route`** — URL pattern matching and dispatch
- **Middleware** — ASGI middleware classes (CORS, GZip, Sessions, etc.)
- **`Starlette` app class** — ties routing, middleware, lifespan events together

FastAPI's `FastAPI` class directly subclasses `Starlette`:

```python
# This is (simplified) what FastAPI does internally:
from starlette.applications import Starlette

class FastAPI(Starlette):
    # Adds: route decorators with type inspection,
    #        dependency injection, OpenAPI schema generation,
    #        Pydantic integration for param validation
    ...
```

### Pydantic v2: The Validation Layer

Pydantic v2 rewrote its validation core in Rust (via the `pydantic-core` crate), making it 5-50x faster than v1. FastAPI uses Pydantic for:

1. **Request validation** — parsing path params, query params, headers, and JSON bodies
2. **Response serialization** — converting your return value to JSON, filtering fields
3. **OpenAPI schema generation** — each model produces a JSON Schema for the docs

```python
# pydantic_demo.py
from pydantic import BaseModel, Field, field_validator


class CreateUser(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    email: str = Field(pattern=r"^[\w.+-]+@[\w-]+\.[\w.]+$")
    age: int = Field(ge=0, le=150)

    @field_validator("name")
    @classmethod
    def name_must_not_be_empty_whitespace(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("Name cannot be only whitespace")
        return v.strip()


# Valid
user = CreateUser(name="Alice", email="alice@example.com", age=30)
print(user.model_dump())
# {'name': 'Alice', 'email': 'alice@example.com', 'age': 30}

# Invalid — raises ValidationError with structured details
try:
    CreateUser(name="", email="not-an-email", age=-1)
except Exception as e:
    print(e)

# run: python3 pydantic_demo.py
```

Pydantic models also produce JSON Schema, which FastAPI feeds directly into the OpenAPI spec:

```python
import json
print(json.dumps(CreateUser.model_json_schema(), indent=2))
```

### How FastAPI Connects Them: The Route Registration

When you write `@app.get("/items/{item_id}")`, here is what happens at import time (not at request time):

```python
# architecture_trace.py
from fastapi import FastAPI

app = FastAPI()

@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str | None = None):
    return {"item_id": item_id, "q": q}

# What @app.get("/items/{item_id}") does internally (simplified):
#
# 1. Creates an APIRoute object:
#    route = APIRoute(
#        path="/items/{item_id}",
#        endpoint=read_item,       # your function
#        methods=["GET"],
#    )
#
# 2. APIRoute inspects read_item's signature using inspect.signature():
#    - item_id: int             → path parameter (because it's in the path string)
#    - q: str | None = None     → query parameter (not in path, has default)
#
# 3. For each parameter, it creates a "dependant" model:
#    - item_id gets a Pydantic field: int, required
#    - q gets a Pydantic field: Optional[str], default None
#
# 4. The route is added to the Starlette Router
#
# 5. An OpenAPI operation is registered for GET /items/{item_id}

# run: uvicorn architecture_trace:app --reload
# Then visit: http://127.0.0.1:8000/docs
```

### The Full Request Lifecycle

Here is exactly what happens when a `GET /items/42?q=hello` request arrives:

```
Client sends: GET /items/42?q=hello HTTP/1.1

 1. Uvicorn (ASGI server)
    ├── Accepts TCP connection
    ├── Parses HTTP request into ASGI scope:
    │   scope = {
    │       "type": "http",
    │       "method": "GET",
    │       "path": "/items/42",
    │       "query_string": b"q=hello",
    │       "headers": [...],
    │   }
    └── Calls: await app(scope, receive, send)

 2. FastAPI app (which IS a Starlette app)
    ├── Runs ASGI middleware stack (in order of app.add_middleware)
    │   └── e.g., CORSMiddleware, GZipMiddleware
    └── Passes to Router

 3. Router
    ├── Matches path "/items/42" against registered routes
    ├── Finds: Route("/items/{item_id}", read_item, methods=["GET"])
    ├── Extracts path_params: {"item_id": "42"}
    └── Passes to APIRoute's request handler

 4. APIRoute request handler (FastAPI-specific logic)
    ├── Resolves the dependency tree (Depends() chain)
    │   └── (none in this simple example)
    ├── Extracts and validates parameters:
    │   ├── item_id: "42" → int(42) via Pydantic  ✓
    │   └── q: "hello" → str("hello")              ✓
    │   (If validation fails → 422 Unprocessable Entity)
    ├── Calls: result = await read_item(item_id=42, q="hello")
    │   └── Returns: {"item_id": 42, "q": "hello"}
    └── Serializes response:
        ├── If response_model is set → validate output through Pydantic
        └── Wraps in JSONResponse (Starlette)

 5. Response travels back
    ├── Through middleware stack (in reverse)
    ├── Through Uvicorn
    └── Back to client as HTTP response
```

### A Minimal App Traced End to End

```python
# minimal_app.py
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(
    title="Minimal API",
    version="0.1.0",
    description="Tracing the architecture",
)


class Item(BaseModel):
    name: str
    price: float
    in_stock: bool = True


class ItemResponse(BaseModel):
    id: int
    name: str
    price: float
    in_stock: bool


# In-memory store for demonstration
_items: dict[int, Item] = {}
_counter: int = 0


@app.post("/items", response_model=ItemResponse, status_code=201)
async def create_item(item: Item):
    """
    What happens when POST /items is called with {"name": "Widget", "price": 9.99}:

    1. Uvicorn receives the TCP connection, parses HTTP
    2. FastAPI middleware stack runs (none added here)
    3. Router matches POST /items
    4. FastAPI sees `item: Item` in the signature:
       - Item is a Pydantic BaseModel → it's a request body parameter
       - Reads request body via await request.json()
       - Validates: Item(name="Widget", price=9.99)
       - If validation fails (e.g., price="abc") → 422 with details
    5. Calls this function with the validated Item instance
    6. Return value is validated against response_model=ItemResponse
    7. Serialized to JSON, wrapped in JSONResponse with status 201
    """
    global _counter
    _counter += 1
    _items[_counter] = item
    return ItemResponse(id=_counter, **item.model_dump())


@app.get("/items/{item_id}", response_model=ItemResponse)
async def get_item(item_id: int):
    if item_id not in _items:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Item not found")
    return ItemResponse(id=item_id, **_items[item_id].model_dump())


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

# run: python3 minimal_app.py
# Then visit: http://127.0.0.1:8000/docs for Swagger UI
#             http://127.0.0.1:8000/redoc for ReDoc
#             http://127.0.0.1:8000/openapi.json for raw OpenAPI schema
```

### Uvicorn: The ASGI Server

Uvicorn is the process that actually listens on a TCP port. It:

1. **Binds to a socket** (e.g., `0.0.0.0:8000`)
2. **Accepts TCP connections** using `asyncio` (or `uvloop` for performance)
3. **Parses HTTP/1.1** (or HTTP/2 with `h2`) into ASGI scope/receive/send
4. **Calls your ASGI app** — `await app(scope, receive, send)`
5. **Sends the HTTP response** back over the socket

Uvicorn itself does no routing, validation, or business logic. It is a pure transport layer.

```bash
# Development (auto-reload on file changes):
uvicorn minimal_app:app --reload --host 0.0.0.0 --port 8000

# Production (multiple workers via Uvicorn):
uvicorn minimal_app:app --workers 4 --host 0.0.0.0 --port 8000

# Production (Gunicorn managing Uvicorn workers):
gunicorn minimal_app:app -w 4 -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
```

### Auto-Generated Documentation

FastAPI generates a complete OpenAPI 3.1 schema from your code:

- **Every route** becomes an OpenAPI path operation
- **Every Pydantic model** becomes a JSON Schema component
- **Every parameter** (path, query, header, cookie, body) is documented with its type, constraints, and whether it is required
- **Every response model** documents what the API returns

This schema is served at `/openapi.json` and powers two interactive UIs:

| UI | URL | Source |
|----|-----|--------|
| Swagger UI | `/docs` | Interactive — try requests from the browser |
| ReDoc | `/redoc` | Read-only — better for documentation consumers |

The documentation is never out of sync with the code because it IS the code.

### How Type Hints Drive Everything

This is FastAPI's central insight. A single function signature:

```python
@app.get("/users/{user_id}")
async def get_user(
    user_id: int,                          # path param (in URL template)
    include_posts: bool = False,           # query param (has default)
    x_request_id: str | None = Header(),   # header (explicit)
) -> UserResponse:                         # response model (return type)
    ...
```

...drives four systems simultaneously:

| System | What the type hint provides |
|--------|-----------------------------|
| **Parameter extraction** | Where to find the value (path, query, header, body) |
| **Validation** | What type to coerce to, what constraints to enforce |
| **Serialization** | What shape the response must have (via return type / `response_model`) |
| **Documentation** | Parameter names, types, required/optional, descriptions — all in OpenAPI |

No decorators listing parameters. No separate schema files. No manual documentation. The function signature is the single source of truth.

### FastAPI vs Flask vs Django REST Framework

| Feature | Flask | Django REST Framework | FastAPI |
|---------|-------|----------------------|---------|
| **Async support** | Bolt-on (Flask 2.0+, limited) | No (sync only) | Native — built on ASGI |
| **Type-driven validation** | No (manual or Marshmallow) | Serializers (explicit) | Yes — from function signatures |
| **Auto API docs** | No (Flask-RESTx adds it) | Browsable API | OpenAPI + Swagger/ReDoc built-in |
| **Dependency injection** | No (manual or Flask-Injector) | No (manual) | Built-in `Depends()` system |
| **Performance** | Moderate (WSGI) | Moderate (WSGI) | High (ASGI + async) |
| **Data validation** | Manual | DRF Serializers | Pydantic (Rust core in v2) |
| **WebSocket support** | Flask-SocketIO (Socket.IO) | Django Channels (separate) | Built-in (Starlette) |
| **Learning curve** | Low | Medium–High | Low–Medium |
| **Maturity / ecosystem** | Very mature, huge ecosystem | Very mature, Django ecosystem | Younger, fast-growing |
| **ORM integration** | SQLAlchemy (manual) | Django ORM (tight) | SQLAlchemy (manual, async) |
| **Best for** | Simple apps, microservices | Full web apps with admin | APIs, microservices, async workloads |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Confusing FastAPI with the server — no Uvicorn, no listening.**
FastAPI is an ASGI application, not a server. A common mistake in Docker deployments is running `python app.py` without the `if __name__` block or without Uvicorn. The process starts, Python exits, the container dies. The fix seems obvious but bites teams migrating from Flask (where the dev server is built in). Always ensure your Dockerfile runs `uvicorn` or `gunicorn` explicitly:
```dockerfile
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
```

**2. Blocking the event loop with sync code.**
Because FastAPI runs on async, calling synchronous blocking code (CPU-heavy computation, synchronous database drivers, `time.sleep()`) inside an `async def` handler freezes the entire event loop — no other request gets served until the blocking call returns. Symptoms: all endpoints suddenly spike to multi-second latency even though only one is slow; health checks start failing; Kubernetes kills the pod.

FastAPI has a safety net for `def` (non-async) handlers — it runs them in a threadpool automatically. But if you write `async def` and then call blocking code inside it, you bypass that safety net. Rule: if your handler calls anything blocking, either make it a plain `def` handler (FastAPI will threadpool it) or use `asyncio.to_thread()` explicitly.

**3. Pydantic v1 vs v2 migration breakage.**
FastAPI 0.100+ requires Pydantic v2. If you upgrade FastAPI without upgrading your Pydantic models, you get import errors and silent behavior changes (`.dict()` becomes `.model_dump()`, `validator` becomes `field_validator`, `Config` class becomes `model_config` dict). The build passes, but validators silently stop running because the old decorator names are ignored. Always upgrade Pydantic models and FastAPI together, and run your test suite — do not rely on the build succeeding.
:::

## 🎯 Checkpoint

::: details Question 1 — ASGI vs WSGI
**Q:** Why can't a WSGI application natively handle WebSocket connections, and how does ASGI solve this?

**A:** WSGI's contract is a single synchronous function call: the server calls `app(environ, start_response)`, the app returns an iterable of bytes, and the connection is done. This is a request-response model — there is no mechanism for the application to receive further data from the client after the initial request, and no mechanism for long-lived bidirectional communication. WebSockets require the connection to stay open with both sides sending frames independently.

ASGI solves this by providing `receive` and `send` as async callables that the application can call repeatedly. For a WebSocket connection, `scope["type"]` is `"websocket"`, and the app can `await receive()` to get incoming frames and `await send()` to push frames — in any order, for as long as the connection lives. The async nature means the event loop is not blocked while waiting for either side.
:::

::: details Question 2 — Blocking in async handlers
**Q:** A team has a FastAPI endpoint defined as `async def process(data: Input)` that calls a synchronous machine learning inference function taking 2 seconds. Under load, all other endpoints become unresponsive. Explain the mechanism and two ways to fix it.

**A:** The mechanism: `async def` handlers run directly on the asyncio event loop. The synchronous ML inference call blocks the event loop thread for 2 seconds. During that time, no other coroutine can make progress — no other request is read, no response is sent, no health check responds. The event loop is single-threaded, so one blocking call stalls everything.

Fix 1: Change the handler to `def process(data: Input)` (plain `def`, not `async def`). FastAPI automatically runs plain `def` handlers in a threadpool (`anyio.to_thread.run_sync`), so the event loop stays free. This is the simplest fix.

Fix 2: Keep `async def` but explicitly offload the blocking call: `result = await asyncio.to_thread(ml_inference, data)`. This moves the blocking work to a thread and awaits its completion without blocking the loop.

For truly CPU-heavy work (not just blocking I/O), a third option is better: send the work to a separate process via `ProcessPoolExecutor` or a task queue (Celery, ARQ), because Python's GIL limits true CPU parallelism in threads.
:::

::: details Question 3 — Where does FastAPI end and Starlette begin?
**Q:** If you look at the FastAPI source code, `class FastAPI(Starlette)`. What does FastAPI actually add on top of Starlette? Could you build an API with just Starlette?

**A:** You absolutely can build an API with just Starlette — and many teams do for simpler services. What FastAPI adds on top is:

1. **Automatic parameter extraction from type hints** — Starlette gives you `request.path_params["id"]` as a string; FastAPI inspects your function signature, sees `id: int`, and validates/converts automatically.
2. **Pydantic integration for request validation and response serialization** — Starlette has no opinion on validation; FastAPI makes Pydantic models the default for request bodies and response shapes.
3. **The `Depends()` dependency injection system** — Starlette has no DI; FastAPI's DI is its most powerful unique feature.
4. **Automatic OpenAPI schema generation** — Starlette does not generate API documentation; FastAPI builds a complete OpenAPI 3.1 spec from your routes, models, and type hints, serving Swagger UI and ReDoc.
5. **The `APIRouter`** with richer metadata (tags, response models, status codes) for organizing large APIs.

What FastAPI does NOT add: HTTP parsing, routing mechanics, middleware, Request/Response objects, WebSocket support, static files, test client — all of these are Starlette.
:::

## Key Mental Models

- **FastAPI = Starlette (transport) + Pydantic (validation) + type-hint-driven glue.** It does not reimplement HTTP handling — it delegates to Starlette.
- **ASGI is async WSGI.** The `async app(scope, receive, send)` contract enables concurrent handling and long-lived connections that WSGI cannot support.
- **Your function signature IS the API contract.** Parameter location, types, validation rules, and documentation all flow from the type hints you write on your handler.
- **`async def` means you own the event loop.** If you block it, everything stops. Use plain `def` for sync work — FastAPI will threadpool it for you.
- **The auto-generated docs are never stale** because they are generated from the same code that handles requests — there is no separate spec file to maintain.

## Related

- [Module 7 — asyncio](/python/module-07/) — the async runtime that Uvicorn and your handlers run on
- [Module 10 — Type Hints](/python/module-10/) — the type system that drives FastAPI's magic
- [13.2 Routing, Params & Validation](02-routing-validation) — deep dive into parameter extraction and Pydantic models
- [13.3 Dependency Injection](03-dependency-injection) — FastAPI's most powerful unique feature
- [13.4 Middleware, CORS & Error Handling](04-middleware-errors) — the Starlette middleware stack in detail
- [13.9 Deployment & Production](09-deployment) — Uvicorn, Gunicorn, and running FastAPI in production
