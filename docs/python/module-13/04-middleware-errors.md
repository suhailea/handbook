---
title: Middleware, CORS & Error Handling
outline: deep
---

# Middleware, CORS & Error Handling

Interview weight: 🔥🔥 | FastAPI 0.100+ / Starlette 0.27+ | Prerequisites: [Request & Response Model](./02-routing-validation.md), [Dependency Injection](./03-dependency-injection.md)

## 🗣️ In Plain English

::: tip In Plain English
Think of middleware in FastAPI as **airport security checkpoints**.

Every passenger (request) arriving at the airport must pass through each checkpoint in a fixed order on the way IN to the terminal. At each checkpoint, something happens: one stamps your passport (adds a header), another scans your bags (logs the request), another checks your boarding pass against the allowed-destination list (CORS policy).

Once you reach your gate and board your flight (the route handler runs), you come back through those same checkpoints **in reverse order** on the way OUT, this time carrying your luggage (the response). The checkpoint that stamped your passport on the way in now has a chance to inspect your return stamp. The one that started a timer can stop it and note how long you spent inside.

The key insight: **checkpoints don't change your destination**. They wrap around your journey. The first checkpoint you hit on the way in is the last one you pass on the way out. They form layers, like nested envelopes around your actual trip.

Now, what about CORS? Imagine the airport is international, and some countries have treaties allowing free travel while others don't. When a passenger from an untrusted country (a different browser origin) tries to enter, the CORS checkpoint sends them to a preliminary desk first: "Let me call ahead and confirm you're allowed" (the preflight OPTIONS request). Only if the confirmation comes back positive does the passenger proceed. Passengers from trusted countries (same origin) walk right through.

And errors? If you set off an alarm at any checkpoint — say your passport is forged (an exception is raised) — you don't continue to the gate. You're redirected to a **special handling desk** (the exception handler). That desk decides what happens: maybe you get a polite rejection letter (a 403 JSON response), maybe you're escorted out with an explanation (a custom error body). The important thing is that normal processing stops, and a designated handler takes over.
:::

## ⚙️ Under the Hood

### ASGI Middleware: The Wrapping Pattern

Every ASGI application is a callable with the signature `(scope, receive, send)`. Middleware is simply an ASGI app that wraps another ASGI app — it intercepts the `scope`, `receive`, and `send` callables, does work before and/or after, then delegates to the inner app.

```python
# run: uvicorn app:app --reload
from starlette.types import ASGIApp, Receive, Scope, Send


class RawASGIMiddleware:
    """Bare ASGI middleware — wraps the next app manually."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            print(f"[RAW] Before request: {scope['path']}")
        await self.app(scope, receive, send)
        if scope["type"] == "http":
            print(f"[RAW] After request: {scope['path']}")
```

This is the foundation. Every Starlette/FastAPI middleware — `CORSMiddleware`, `GZipMiddleware`, your custom ones — follows this wrapping pattern internally.

### The Simple Middleware Pattern: `@app.middleware("http")`

FastAPI provides a convenient decorator that hides the raw ASGI plumbing:

```python
# run: uvicorn app:app --reload
import time
import uuid

from fastapi import FastAPI, Request, Response

app = FastAPI()


@app.middleware("http")
async def add_timing_header(request: Request, call_next) -> Response:
    """Measure how long the route handler (and inner middleware) takes."""
    start = time.perf_counter()
    response: Response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"
    return response


@app.middleware("http")
async def add_request_id(request: Request, call_next) -> Response:
    """Stamp every request/response with a unique correlation ID."""
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    request.state.request_id = request_id
    response: Response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


@app.middleware("http")
async def log_requests(request: Request, call_next) -> Response:
    """Log method, path, and status code for every request."""
    print(f"--> {request.method} {request.url.path}")
    response: Response = await call_next(request)
    print(f"<-- {request.method} {request.url.path} [{response.status_code}]")
    return response


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "hello"}
```

The `call_next` function is the boundary: everything before it runs during the **request phase**, everything after runs during the **response phase**. The response object returned by `call_next` is a `StreamingResponse` whose body has already been wired up but not yet fully consumed — you can read and modify headers, but reading the body requires care (you'd need to consume and reconstruct the stream).

### Middleware Execution Order

This is where most people get confused. In FastAPI (Starlette), **the last `@app.middleware("http")` you register is the outermost wrapper**. When using `app.add_middleware(...)`, **the first one you add is the outermost**.

With the decorators above, execution flows like this:

```
Request arrives
  → log_requests (request phase)    ← registered last, so outermost
    → add_request_id (request phase)
      → add_timing_header (request phase)
        → route handler executes
      ← add_timing_header (response phase)
    ← add_request_id (response phase)
  ← log_requests (response phase)
Response sent
```

| Registration style | Outermost (processes request first) |
|---|---|
| `@app.middleware("http")` | The **last** decorated function |
| `app.add_middleware(Cls)` | The **first** added class |

This matters when one middleware depends on state set by another (e.g., the logger wants the request ID).

### Starlette Built-in Middleware

Starlette ships several middleware classes ready to use:

```python
# run: uvicorn app:app --reload
from fastapi import FastAPI
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.middleware.httpsredirect import HTTPSRedirectMiddleware
from starlette.middleware.gzip import GZipMiddleware

app = FastAPI()

# Reject requests whose Host header isn't in the allow-list.
# Prevents host-header attacks.
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["example.com", "*.example.com"])

# 301-redirect any HTTP request to HTTPS.
# Only enable this when TLS termination is handled upstream (nginx, ALB).
app.add_middleware(HTTPSRedirectMiddleware)

# Compress responses larger than minimum_size bytes.
# Negotiates via Accept-Encoding header.
app.add_middleware(GZipMiddleware, minimum_size=500)


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "hello"}
```

### CORSMiddleware: Cross-Origin Resource Sharing

CORS is a **browser-enforced** security policy. Servers declare which foreign origins may access their resources. Without the right headers, the browser blocks the response — the server still processes the request, but the browser refuses to hand the data to JavaScript.

```python
# run: uvicorn app:app --reload
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    # Origins allowed to make requests. Use ["*"] for public APIs,
    # explicit list for private ones. "*" cannot be used with credentials.
    allow_origins=["https://frontend.example.com", "http://localhost:3000"],
    # Allow cookies / Authorization headers to be sent cross-origin.
    allow_credentials=True,
    # HTTP methods allowed. ["*"] means all.
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    # Request headers the browser is allowed to send.
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    # Response headers the browser is allowed to read in JavaScript.
    expose_headers=["X-Process-Time-Ms", "X-Request-ID"],
    # How long (seconds) the browser caches preflight results.
    max_age=600,
)


@app.get("/api/data")
async def get_data() -> dict[str, str]:
    return {"data": "cross-origin accessible"}
```

**How CORS works under the hood:**

1. **Simple requests** (GET, HEAD, POST with simple content types): the browser sends the request directly. The server's response must include `Access-Control-Allow-Origin` matching the request's `Origin` header, or the browser discards the response.

2. **Non-simple requests** (PUT, DELETE, custom headers, `application/json`): the browser first sends an **OPTIONS preflight** request with `Access-Control-Request-Method` and `Access-Control-Request-Headers`. The server responds with what it allows. Only if the preflight passes does the browser send the actual request.

```
Browser                          Server
  |                                |
  |-- OPTIONS /api/data ---------->|   Preflight
  |   Origin: https://frontend     |
  |   Access-Control-Request-      |
  |     Method: DELETE             |
  |                                |
  |<- 200 OK ---------------------|
  |   Access-Control-Allow-Origin  |
  |   Access-Control-Allow-Methods |
  |   Access-Control-Max-Age: 600  |
  |                                |
  |-- DELETE /api/data ----------->|   Actual request
  |   Origin: https://frontend     |
  |                                |
  |<- 200 OK ---------------------|
  |   Access-Control-Allow-Origin  |
```

**Critical rule:** `allow_origins=["*"]` and `allow_credentials=True` are **mutually exclusive**. The CORS spec forbids `Access-Control-Allow-Origin: *` when credentials are involved. Starlette's CORSMiddleware handles this correctly by reflecting the specific origin when credentials are enabled.

### Exception Handlers

FastAPI lets you register custom handlers for specific exception classes:

```python
# run: uvicorn app:app --reload
from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

app = FastAPI()


# --- Custom exception class ---
class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int = 60) -> None:
        self.retry_after = retry_after


@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"error": "rate_limit_exceeded", "retry_after": exc.retry_after},
        headers={"Retry-After": str(exc.retry_after)},
    )


# --- Override the default HTTPException handler ---
@app.exception_handler(HTTPException)
async def custom_http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": True,
            "status": exc.status_code,
            "message": exc.detail,
            "path": str(request.url),
        },
    )


# --- Override 422 validation error responses ---
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Replace FastAPI's default 422 response with a cleaner format."""
    errors: list[dict[str, str]] = []
    for err in exc.errors():
        errors.append({
            "field": " → ".join(str(loc) for loc in err["loc"]),
            "message": err["msg"],
            "type": err["type"],
        })
    return JSONResponse(
        status_code=422,
        content={"error": "validation_failed", "details": errors},
    )


@app.get("/items/{item_id}")
async def get_item(item_id: int) -> dict[str, int]:
    if item_id == 0:
        raise RateLimitExceeded(retry_after=30)
    if item_id < 0:
        raise HTTPException(status_code=404, detail="Item not found")
    return {"item_id": item_id}
```

### HTTPException In Depth

FastAPI's `HTTPException` extends Starlette's version with an additional `detail` that can be any JSON-serializable value (not just a string):

```python
from fastapi import HTTPException

# String detail — most common
raise HTTPException(status_code=404, detail="User not found")

# Dict detail — richer error bodies
raise HTTPException(
    status_code=409,
    detail={"code": "DUPLICATE_EMAIL", "message": "This email is already registered"},
)

# Custom headers (e.g., WWW-Authenticate for 401)
raise HTTPException(
    status_code=401,
    detail="Invalid or expired token",
    headers={"WWW-Authenticate": "Bearer"},
)
```

### Unhandled Exceptions and ServerErrorMiddleware

When an exception isn't caught by any handler, Starlette's `ServerErrorMiddleware` (installed by default) catches it and returns a **500 Internal Server Error**. In debug mode (`FastAPI(debug=True)`), the response includes a full traceback as HTML. In production mode, you get a plain 500 response. The exception is also logged to stderr.

```python
from fastapi import FastAPI

# Debug mode: shows tracebacks in browser. NEVER enable in production.
app = FastAPI(debug=True)
```

### Middleware vs Dependencies: When to Use Which

This is a design decision that comes up constantly:

| Concern | Use Middleware | Use Dependency |
|---|---|---|
| Timing / metrics | Yes | No |
| Request ID injection | Yes | No |
| CORS headers | Yes | No |
| Compression (GZip) | Yes | No |
| Authentication | Maybe (basic token check) | Yes (with user lookup, scopes) |
| Authorization per route | No | Yes |
| Database session | No | Yes |
| Input validation | No | Yes (Pydantic handles it) |
| Rate limiting | Either | Either |

**Rule of thumb:** middleware is for **cross-cutting concerns** that apply to every request regardless of route. Dependencies are for **per-route logic** that varies by endpoint. If you need access to path parameters, query parameters, or the request body in a typed way, use a dependency — middleware only sees the raw request.

A subtle technical difference: middleware wraps the entire ASGI app, including routing. Dependencies run **after** routing has matched a handler. This means middleware executes even for 404 routes, while dependencies only run for matched routes.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Reading the response body in middleware silently empties it.**
When you call `await call_next(request)`, the returned `Response` is a `StreamingResponse`. Its body is a one-shot async iterator. If your middleware reads `response.body` (consuming the stream), the client receives an empty body. The fix: consume the body into bytes, then return a new `Response` with those bytes. This is expensive for large responses and easy to miss because tests with small payloads may appear to work fine.

```python
@app.middleware("http")
async def log_response_body(request: Request, call_next) -> Response:
    response = await call_next(request)
    # BAD: response.body may not exist on StreamingResponse
    # CORRECT: read the stream and reconstruct
    body = b""
    async for chunk in response.body_iterator:
        body += chunk
    print(f"Response body: {body[:200]}")
    return Response(
        content=body,
        status_code=response.status_code,
        headers=dict(response.headers),
        media_type=response.media_type,
    )
```

**2. CORS misconfiguration: `allow_origins=["*"]` with `allow_credentials=True`.**
This combination is forbidden by the CORS specification. Starlette silently works around it by reflecting the specific `Origin` header, but this effectively allows all origins with credentials — a security hole. The symptom: your security audit flags it, or worse, you think you're restricting origins but aren't. Always use an explicit origin list when credentials are enabled.

**3. Exception handlers don't catch exceptions in middleware.**
If your middleware (not a route handler) raises an exception, `@app.exception_handler` does **not** catch it. Exception handlers only cover exceptions raised during route handling (inside the Starlette routing layer). Middleware exceptions bubble up to `ServerErrorMiddleware` and produce a raw 500. You must use try/except within your middleware code.

**4. Middleware ordering causes silent failures.**
If your logging middleware depends on `request.state.request_id` set by the request-ID middleware, but the logging middleware is outermost (runs first on request), the attribute won't exist yet. The fix: understand the onion order and register middleware accordingly. Use `app.add_middleware()` with the outermost first.
:::

## 🎯 Checkpoint

::: details Question 1 — Middleware execution order
**Q:** You register three middleware using `@app.middleware("http")` in this order: A, B, C. A request arrives. In what order do the request phases execute, and in what order do the response phases execute?

**A:** With `@app.middleware("http")`, the **last registered** is the outermost. So C is outermost, B is middle, A is innermost. Request phase order: **C → B → A → handler**. Response phase order: **A → B → C**. This is because each middleware calls `call_next`, which invokes the next inner middleware. The response flows back up the call stack. This is the opposite of what most people expect — they assume "first registered = first to run," but the decorator-based registration reverses the order because each new middleware wraps the previous app.
:::

::: details Question 2 — CORS preflight
**Q:** A frontend at `https://app.example.com` sends a `DELETE` request with a custom `X-Tenant-ID` header to your API at `https://api.example.com`. What happens before the actual DELETE reaches your route handler, and what configuration must be in place?

**A:** The browser sends a **preflight OPTIONS request** because DELETE is not a simple method and `X-Tenant-ID` is a custom header. The preflight includes `Origin: https://app.example.com`, `Access-Control-Request-Method: DELETE`, and `Access-Control-Request-Headers: X-Tenant-ID`. CORSMiddleware must be configured with `allow_origins` including `https://app.example.com`, `allow_methods` including `DELETE`, and `allow_headers` including `X-Tenant-ID`. The middleware responds to the OPTIONS with the appropriate `Access-Control-Allow-*` headers. Only then does the browser send the actual DELETE. If any of those three settings is missing, the preflight fails and the browser never sends the DELETE — your route handler never executes.
:::

::: details Question 3 — Exception handler scope
**Q:** You have a custom `@app.exception_handler(ValueError)` registered. Your middleware raises a `ValueError`. Does the handler catch it? Why or why not?

**A:** **No.** Exception handlers registered with `@app.exception_handler()` only catch exceptions raised within the route handling layer — specifically, inside the `ServerErrorMiddleware` → routing → endpoint chain. Middleware sits **outside** this chain (it wraps the app). When middleware raises a `ValueError`, the exception propagates up through the ASGI middleware stack until `ServerErrorMiddleware` catches it as an unhandled exception and returns a generic 500 response. To handle exceptions in middleware, you must use a standard `try`/`except` block within the middleware itself.
:::

## Key Mental Models

- **Middleware is an onion.** Each layer wraps the next — request flows inward, response flows outward. The outermost layer touches both first and last.
- **CORS is browser-enforced, not server-enforced.** The server only declares policy via headers; the browser decides whether to honor the response. A `curl` request ignores CORS entirely.
- **Exception handlers live inside the routing layer.** They catch route-level errors. Middleware errors require their own try/except.
- **`call_next` returns a streaming response.** The body is a one-shot iterator. Consuming it means reconstructing a new response if you want the client to receive it.
- **Middleware for cross-cutting, dependencies for per-route.** If it applies to every request regardless of route, it's middleware. If it varies by endpoint or needs typed request data, it's a dependency.

## Related

- [Dependency Injection](./03-dependency-injection.md) — the per-route alternative to middleware for request processing logic
- [Auth — JWT, OAuth2 & Security](./05-auth-security.md) — authentication middleware and security dependencies in practice
- [Request & Response Model](./02-routing-validation.md) — understanding Request and Response objects that middleware manipulates
