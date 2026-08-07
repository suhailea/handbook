---
title: Deployment & Production
outline: deep
---

# Deployment & Production

**Interview weight:** 🔥🔥 — interviewers at the senior level expect you to know the difference between development and production configurations, why you need a process manager, and how containerization fits into the picture. Often combined with system design questions about scaling.

**Python version:** All examples target Python 3.12+. `pip install "fastapi[standard]" pydantic-settings`. Uvicorn, Gunicorn, and Docker examples use current stable versions.

**Prerequisites:** [FastAPI Architecture](./01-architecture), [Middleware, CORS & Error Handling](./04-middleware-errors), [asyncio](/python/module-07/04-asyncio)

---

## 🗣️ In Plain English

::: tip In Plain English
Deploying a FastAPI app is like opening a restaurant to the public. During development, you were the only one in the kitchen with the lights on dim and a single burner going — that is `uvicorn --reload`, where the server restarts every time you change a file. Convenient for tasting as you cook, but wildly inappropriate for two hundred dinner guests.

For production, you need several things. A **bouncer at the door** who manages the queue and makes sure nobody storms the kitchen — that is your process manager (Gunicorn) or container orchestrator (Kubernetes). **Multiple chefs working in parallel** so one slow order does not block everyone — those are your Uvicorn workers, each handling requests independently. A **fire safety system** — health check endpoints that let the building manager (K8s, your load balancer) know whether the kitchen is operational or needs to be evacuated and replaced. **Security cameras** — structured logging that records every order, every error, every slow response in a format that monitoring tools can parse. And a **building inspector's certificate** — your Docker image, pinned to a specific base, built in layers so rebuilds are fast, running as a non-root user so a break-in cannot compromise the whole building.

You do not just flip the "Open" sign. You ensure the building can handle two hundred guests, recover from a kitchen fire (graceful shutdown, rolling restarts), and that someone is watching the dashboards at all times.
:::

---

## ⚙️ Under the Hood

### Uvicorn: The ASGI Server

Uvicorn is the server that actually runs your FastAPI app. It implements the ASGI protocol, manages the event loop, and handles incoming connections.

```bash
# Development — auto-reload on file changes
uvicorn app:app --reload --host 127.0.0.1 --port 8000

# Production — single worker (rarely used alone)
uvicorn app:app --host 0.0.0.0 --port 8000 --workers 4 --log-level info --no-access-log
```

**Key Uvicorn options:**

| Option | Purpose | Dev | Prod |
|--------|---------|-----|------|
| `--reload` | Restart on code changes | Yes | **Never** |
| `--host` | Bind address | `127.0.0.1` | `0.0.0.0` |
| `--port` | Listen port | `8000` | `8000` (or set by orchestrator) |
| `--workers` | Number of worker processes | `1` | `2-4` per CPU core |
| `--log-level` | Logging verbosity | `debug` | `info` or `warning` |
| `--access-log` / `--no-access-log` | Log every request | Yes | Often disabled (use middleware instead) |
| `--timeout-keep-alive` | Keep-alive timeout (seconds) | `5` | `65` (longer than LB timeout) |
| `--limit-concurrency` | Max concurrent connections | None | Set based on capacity |

### Gunicorn + Uvicorn Workers

In production, Gunicorn acts as the process manager and Uvicorn handles the async work inside each worker:

```bash
# Production deployment with Gunicorn managing Uvicorn workers
gunicorn app:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers 4 \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --graceful-timeout 30 \
    --keep-alive 65 \
    --access-logfile - \
    --error-logfile -
```

**Why not just `uvicorn --workers`?** Gunicorn provides battle-tested process management: it monitors worker health, restarts crashed workers, handles graceful reloads (SIGHUP), and supports pre-fork and other process models. Uvicorn's built-in `--workers` flag (since 0.16) works but lacks Gunicorn's maturity in handling edge cases like worker timeouts and memory leaks.

**Worker count formula:**

```python
# CPU-bound work (heavy computation in endpoint handlers)
workers = (2 * cpu_cores) + 1

# I/O-bound work (most FastAPI apps — DB queries, API calls)
workers = (2 * cpu_cores) + 1  # Same starting point, but each worker handles
                                # thousands of concurrent I/O operations via asyncio

# In containers (K8s): often 2-4 workers per pod, scale horizontally with more pods
# rather than cramming many workers into one pod
```

### Lifespan Events

The `lifespan` context manager handles startup and shutdown logic — initializing database pools, cache connections, ML models, and cleaning them up:

```python
# run: uvicorn app:app --reload
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """
    Startup: everything before `yield` runs when the app starts.
    Shutdown: everything after `yield` runs when the app stops.
    """
    # --- Startup ---
    print("Starting up: initializing DB pool, loading ML model...")
    # db_pool = await create_db_pool()
    # redis = await aioredis.from_url("redis://localhost")
    # app.state.db_pool = db_pool
    # app.state.redis = redis
    print("Startup complete.")

    yield  # App is running and handling requests

    # --- Shutdown ---
    print("Shutting down: closing connections...")
    # await app.state.db_pool.close()
    # await app.state.redis.close()
    print("Shutdown complete.")


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def root() -> dict[str, str]:
    return {"status": "running"}
```

**Important:** the old `@app.on_event("startup")` and `@app.on_event("shutdown")` decorators are deprecated in favor of `lifespan`. The lifespan approach is better because resources can be shared via closure scope, and cleanup is guaranteed by the context manager.

### Health Check Endpoints

Two types of health checks, each serving a different purpose:

```python
# run: uvicorn app:app --reload
from fastapi import FastAPI
from fastapi.responses import JSONResponse

app = FastAPI()

# Simulated shared state
db_ready = True


@app.get("/health")
async def health_check() -> dict[str, str]:
    """
    Liveness probe: is the process alive and responsive?
    K8s uses this to decide whether to RESTART the pod.
    Should be cheap — no DB queries, no external calls.
    """
    return {"status": "alive"}


@app.get("/ready")
async def readiness_check() -> JSONResponse:
    """
    Readiness probe: can this instance handle traffic?
    K8s uses this to decide whether to ROUTE traffic to this pod.
    Should check critical dependencies (DB, cache, etc.).
    """
    checks: dict[str, str] = {}

    # Check database
    try:
        # await db.execute("SELECT 1")
        checks["database"] = "ok" if db_ready else "unavailable"
    except Exception:
        checks["database"] = "unavailable"

    all_ok = all(v == "ok" for v in checks.values())
    return JSONResponse(
        status_code=200 if all_ok else 503,
        content={"status": "ready" if all_ok else "not ready", "checks": checks},
    )
```

**K8s probe configuration (for reference):**

```yaml
# In your Kubernetes deployment spec:
livenessProbe:
  httpGet:
    path: /health
    port: 8000
  initialDelaySeconds: 5
  periodSeconds: 10
  failureThreshold: 3     # Restart after 3 consecutive failures

readinessProbe:
  httpGet:
    path: /ready
    port: 8000
  initialDelaySeconds: 10
  periodSeconds: 5
  failureThreshold: 2     # Stop routing after 2 consecutive failures
```

### Structured Logging

Production logs must be machine-parseable. JSON logging with request context:

```python
# run: uvicorn app:app --reload
import logging
import sys
import time
import uuid

from fastapi import FastAPI, Request

# Configure JSON logging
logging.basicConfig(
    level=logging.INFO,
    format='{"time":"%(asctime)s","level":"%(levelname)s","message":"%(message)s"}',
    stream=sys.stdout,
)
logger = logging.getLogger("app")

app = FastAPI()


@app.middleware("http")
async def log_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Log every request with timing and a unique request ID."""
    request_id = str(uuid.uuid4())[:8]
    start = time.perf_counter()

    # Attach request_id for downstream use
    request.state.request_id = request_id

    response = await call_next(request)

    duration_ms = (time.perf_counter() - start) * 1000
    logger.info(
        '{"request_id":"%s","method":"%s","path":"%s","status":%d,"duration_ms":%.1f}',
        request_id,
        request.method,
        request.url.path,
        response.status_code,
        duration_ms,
    )

    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "hello"}
```

### Graceful Shutdown

When a process receives SIGTERM (which K8s sends before killing a pod), it should finish in-flight requests before exiting:

```python
# run: uvicorn app:app --reload
import asyncio
import signal
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI

# Track in-flight requests
in_flight = 0
shutting_down = False


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Handle graceful shutdown."""
    global shutting_down

    yield

    # Shutdown phase: wait for in-flight requests to complete
    shutting_down = True
    print(f"Shutdown initiated. Waiting for {in_flight} in-flight requests...")
    while in_flight > 0:
        await asyncio.sleep(0.1)
    print("All requests drained. Shutting down.")


app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def track_requests(request, call_next):  # type: ignore[no-untyped-def]
    global in_flight
    in_flight += 1
    try:
        response = await call_next(request)
        return response
    finally:
        in_flight -= 1


@app.get("/")
async def root() -> dict[str, str]:
    return {"status": "running", "shutting_down": shutting_down}
```

**K8s graceful shutdown timeline:**

1. Pod receives SIGTERM
2. K8s removes pod from Service endpoints (no new traffic)
3. `terminationGracePeriodSeconds` countdown begins (default: 30s)
4. App drains in-flight requests
5. If still alive after grace period, K8s sends SIGKILL

Set `--graceful-timeout` in Gunicorn and `terminationGracePeriodSeconds` in K8s to allow enough time for long requests.

### Production Dockerfile

```dockerfile
# ---- Build stage ----
FROM python:3.12-slim AS builder

WORKDIR /app

# Install dependencies first (cached layer if requirements unchanged)
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---- Runtime stage ----
FROM python:3.12-slim AS runtime

# Security: run as non-root user
RUN groupadd --gid 1001 appgroup && \
    useradd --uid 1001 --gid 1001 --no-create-home appuser

WORKDIR /app

# Copy installed packages from build stage
COPY --from=builder /install /usr/local

# Copy application code (after dependencies for better layer caching)
COPY ./app ./app

# Switch to non-root user
USER appuser

# Expose the port (documentation — actual binding is in CMD)
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')" || exit 1

# Use exec form so signals (SIGTERM) go directly to the process
CMD ["gunicorn", "app.main:app", \
     "--worker-class", "uvicorn.workers.UvicornWorker", \
     "--workers", "4", \
     "--bind", "0.0.0.0:8000", \
     "--timeout", "120", \
     "--graceful-timeout", "30", \
     "--keep-alive", "65", \
     "--access-logfile", "-", \
     "--error-logfile", "-"]
```

**Key Dockerfile decisions:**

| Decision | Why |
|----------|-----|
| Multi-stage build | Keeps build tools out of the runtime image (smaller, more secure) |
| `COPY requirements.txt` before code | Dependencies layer is cached; code changes do not re-install packages |
| Non-root user | Limits damage if the container is compromised |
| `CMD` in exec form (`[...]`) | Process receives SIGTERM directly (no shell wrapper eating the signal) |
| `python:3.12-slim` | Smaller base than full `python:3.12` (~150MB vs ~900MB) |

### Environment Configuration with pydantic-settings

```python
# run: uvicorn app:app --reload
# file: app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.
    Pydantic validates types and provides defaults.
    """

    model_config = SettingsConfigDict(
        env_file=".env",           # Load from .env file in development
        env_file_encoding="utf-8",
        case_sensitive=False,       # DATABASE_URL == database_url
    )

    # Required — app won't start without these
    database_url: str
    secret_key: str

    # Optional with defaults
    debug: bool = False
    app_name: str = "My FastAPI App"
    allowed_origins: list[str] = ["http://localhost:3000"]

    # Deployment
    workers: int = 4
    log_level: str = "info"

    # External services
    redis_url: str = "redis://localhost:6379"
    smtp_host: str = "localhost"
    smtp_port: int = 587


# Singleton — import this wherever you need settings
settings = Settings()  # type: ignore[call-arg]
# Raises ValidationError at startup if required vars are missing
```

```bash
# .env file (never commit this — add to .gitignore)
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/mydb
SECRET_KEY=your-secret-key-here
DEBUG=true
ALLOWED_ORIGINS=["http://localhost:3000","http://localhost:5173"]
```

### HTTPS and TLS Termination

In production, TLS is terminated at the reverse proxy (nginx, cloud load balancer), not at Uvicorn:

```
Client (HTTPS) → nginx/ALB (TLS termination) → Uvicorn (plain HTTP, port 8000)
```

```nginx
# nginx configuration for FastAPI
upstream fastapi {
    server 127.0.0.1:8000;
    keepalive 32;  # Connection pool to upstream
}

server {
    listen 443 ssl;
    server_name api.example.com;

    ssl_certificate /etc/letsencrypt/live/api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.example.com/privkey.pem;

    location / {
        proxy_pass http://fastapi;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Keep-alive to upstream
        proxy_http_version 1.1;
        proxy_set_header Connection "";
    }

    # SSE / streaming — disable buffering
    location /events {
        proxy_pass http://fastapi;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;  # Long-lived SSE connections
        proxy_set_header Connection "";
        proxy_http_version 1.1;
    }

    # WebSocket upgrade
    location /ws {
        proxy_pass http://fastapi;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
}
```

### Performance Tuning

| Setting | Where | Dev | Prod |
|---------|-------|-----|------|
| `--reload` | Uvicorn | On | **Off** |
| `--workers` | Uvicorn/Gunicorn | 1 | `(2 * CPU) + 1` |
| `--timeout-keep-alive` | Uvicorn | 5s | 65s (> LB timeout) |
| `--limit-concurrency` | Uvicorn | None | Based on load testing |
| `--timeout` | Gunicorn | 30s | 120s (for slow endpoints) |
| `--graceful-timeout` | Gunicorn | 0 | 30s |
| `proxy_buffering` | nginx | on | off (for SSE/streaming) |
| `proxy_read_timeout` | nginx | 60s | 3600s (for WebSocket/SSE) |
| `keepalive` | nginx upstream | 0 | 32-64 |
| JSON logging | App | Off | On |
| Access log | Uvicorn | On | Off (use middleware) |

### Development vs Production Comparison

| Aspect | Development | Production |
|--------|-------------|------------|
| **Server** | `uvicorn --reload` | Gunicorn + UvicornWorker |
| **Workers** | 1 | 4-8 per pod |
| **Reload** | On (watch files) | Off |
| **Debug** | On (detailed errors) | Off (generic errors) |
| **Database** | SQLite / local Postgres | Managed Postgres (RDS, Cloud SQL) |
| **Logging** | Console, human-readable | JSON, structured, shipped to aggregator |
| **HTTPS** | Not needed (localhost) | TLS at load balancer |
| **Config** | `.env` file | Environment variables from secrets manager |
| **Errors** | Stack traces in response | Generic 500 + logged stack trace |
| **Health checks** | Not needed | `/health` + `/ready` |
| **Containers** | Optional (local Python) | Docker image, CI/CD pipeline |
| **Process manager** | None | Gunicorn or K8s |

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. `--reload` left on in production.**
It seems obvious, but it happens: a Dockerfile or startup script includes `--reload`, and the production server restarts every time a log file is written or a temp file is created. **Symptoms:** random 502 errors, brief downtime every few seconds, worker restart logs in Gunicorn. **Fix:** never use `--reload` outside development. In Docker, hardcode the production command in `CMD` without `--reload`. Use environment-specific startup scripts.

**2. Keep-alive mismatch between nginx and Uvicorn.**
Nginx's default `keepalive_timeout` is 75 seconds. If Uvicorn's `--timeout-keep-alive` is lower (default: 5 seconds), Uvicorn closes the connection while nginx still thinks it is alive. The next request nginx sends on that connection gets a "connection reset by peer" error, which surfaces as a 502 to the client. **Diagnosis:** intermittent 502 errors under moderate load, particularly after idle periods. **Fix:** set Uvicorn's `--timeout-keep-alive 65` (higher than nginx's `keepalive_timeout` but lower than the load balancer's idle timeout).

**3. SIGTERM not reaching the Python process in Docker.**
If your `CMD` uses shell form (`CMD uvicorn app:app`) instead of exec form (`CMD ["uvicorn", "app:app"]`), the shell (PID 1) receives SIGTERM but does not forward it to Uvicorn. The process never gracefully shuts down — after `terminationGracePeriodSeconds`, K8s sends SIGKILL and in-flight requests are dropped. **Diagnosis:** pods take exactly 30 seconds (the default grace period) to terminate instead of shutting down quickly. Client errors during deployments. **Fix:** use exec form in Dockerfile, or use `exec` in shell scripts (`exec uvicorn app:app`), or use `tini` as an init process.
:::

---

## 🎯 Checkpoint

::: details Question 1 — Worker count and architecture
**Q:** You are deploying a FastAPI app that primarily makes async HTTP calls to external APIs (database queries, third-party services). You have a 4-core machine. How many Gunicorn workers would you configure, and why? What changes if the app does CPU-heavy image processing in some endpoints?

**A:** For the I/O-bound case, start with `(2 * 4) + 1 = 9` workers. Each worker runs its own asyncio event loop and can handle thousands of concurrent I/O-bound requests via `await`. The workers exist to utilize multiple CPU cores for the synchronous parts of request handling (parsing, serialization, middleware). If some endpoints do CPU-heavy image processing, those endpoints block the event loop for the duration of the computation. Options: (1) offload CPU work to `asyncio.to_thread()` or a `ProcessPoolExecutor` so the event loop stays responsive; (2) separate the CPU-heavy endpoints into a dedicated service with more workers but fewer concurrent connections; (3) use a task queue (Celery) for the image processing and return a job ID immediately. Simply adding more workers helps but hits diminishing returns — each worker is a full Python process consuming memory.
:::

::: details Question 2 — Graceful shutdown
**Q:** During a rolling deployment in Kubernetes, users report occasional 502 errors. The app handles about 100 requests per second with an average latency of 200ms. What is the most likely cause, and how would you configure the deployment to eliminate these errors?

**A:** The most likely cause is that the old pod is killed before it finishes draining in-flight requests. The fix involves three coordinations: (1) **K8s readiness probe:** once the pod receives SIGTERM, the readiness probe should start failing, so K8s stops routing new traffic. (2) **Gunicorn graceful timeout:** set `--graceful-timeout 30` so Gunicorn gives workers 30 seconds to finish in-flight requests before forcing shutdown. (3) **K8s `terminationGracePeriodSeconds`:** set to at least 45 seconds (longer than Gunicorn's graceful timeout). (4) **preStop hook:** add a `sleep 5` preStop hook to give K8s time to update iptables rules across all nodes before the app starts rejecting connections. The 502 errors happen in the gap between "SIGTERM sent" and "iptables updated" — during this window, the load balancer still sends requests to a pod that is shutting down.
:::

::: details Question 3 — Docker layer caching
**Q:** A team's Docker build takes 4 minutes because it reinstalls all Python dependencies on every code change. How would you restructure the Dockerfile to make code-only changes build in under 10 seconds?

**A:** The issue is that `COPY . .` (or copying the entire app) happens before `pip install`, invalidating the dependency layer on every code change. Restructure the Dockerfile to copy `requirements.txt` first, install dependencies, then copy the application code. Since Docker caches layers sequentially, a code change only invalidates the `COPY ./app ./app` layer — the `pip install` layer is cached and skipped. Additionally, use a multi-stage build to keep the build tools out of the final image, and use `--no-cache-dir` with pip to avoid storing the download cache in the image layer.
:::

---

## Key Mental Models

- **Uvicorn serves; Gunicorn manages.** Uvicorn handles the async event loop and ASGI protocol. Gunicorn handles process lifecycle: spawning workers, restarting crashed ones, graceful reloads.

- **Lifespan replaces on_event.** The `@asynccontextmanager` lifespan pattern guarantees cleanup via context manager semantics — resources initialized before `yield` are cleaned up after it.

- **Health checks are contracts.** `/health` tells the orchestrator "this process is alive" (restart if not). `/ready` tells it "this process can handle traffic" (stop routing if not). They serve different purposes and must be separate endpoints.

- **Signals must reach the Python process.** Use exec form `CMD ["..."]` in Docker so SIGTERM goes directly to Gunicorn/Uvicorn, not to a shell wrapper that ignores it.

- **Keep-alive timeouts must be layered correctly.** The chain is: client < load balancer < nginx < Uvicorn. Each layer's timeout must be shorter than the layer behind it to prevent "connection reset" errors.

---

## Related

- [FastAPI Architecture](./01-architecture) — the ASGI foundation that Uvicorn implements
- [Middleware, CORS & Error Handling](./04-middleware-errors) — middleware ordering in production
- [Background Tasks, WebSockets & SSE](./07-background-websockets) — nginx configuration for streaming and WebSocket proxying
- [Testing FastAPI Applications](./08-testing) — testing with lifespan events and production-like configuration
- [System Design — Scaling](/system-design/scaling/) — horizontal scaling, rate limiting, K8s HPA
- [System Design — Load Balancing](/system-design/load-balancing/) — nginx reverse proxy, L4 vs L7, TLS termination
