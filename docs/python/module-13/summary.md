---
title: Module 13 Summary — FastAPI
outline: deep
---

# Module 13 Summary — FastAPI

Congratulations on completing the full FastAPI track. You have gone from understanding the ASGI foundation to deploying a production-ready API with authentication, database integration, testing, and real-time features. This summary consolidates the mental models, gives you a self-assessment checklist, and provides quick reference tables for the patterns you will use daily.

---

## Mental Models Gained

1. **ASGI is the contract; FastAPI is the convenience layer.** Every FastAPI feature — routing, middleware, WebSockets, streaming — is ultimately an ASGI application. Starlette implements the machinery; FastAPI adds type-driven automation on top. When debugging, look at the Starlette layer.

2. **Type hints drive everything.** Path parameters, query parameters, request bodies, response models, dependency injection, and OpenAPI documentation are all derived from your Python type annotations. If you get the types right, FastAPI generates validation, serialization, and docs for free.

3. **Dependency injection is a tree, not a list.** `Depends()` functions can depend on other `Depends()` functions, forming a DAG. FastAPI resolves the tree per-request, caches results within the same request, and runs `yield`-based teardown in reverse order. This is how you manage database sessions, auth, and shared resources without global state.

4. **Middleware is an onion.** Requests pass through middleware from outside in; responses pass back out from inside to outside. The order you add middleware matters. CORS middleware must wrap everything; GZip should be outermost; auth middleware sits close to the routes.

5. **JWT auth is stateless verification, not session lookup.** The server never stores the token. It signs a payload on login and verifies the signature on every request. Revocation is the hard part — you need a denylist, short expiry, or token rotation to handle it.

6. **Async database sessions must be scoped to requests.** A `yield`-based dependency creates a session, gives it to the endpoint, and closes it in teardown. If the session leaks (no cleanup), you exhaust the connection pool. If it is shared across requests (wrong scope), you get data corruption.

7. **Testing with dependency overrides is the killer feature.** You replace any node in the dependency tree — database, auth, external services — with a test double. This makes FastAPI tests fast (no real DB), isolated (no shared state), and reliable (no network calls).

8. **Production is not development with more users.** It requires a process manager (Gunicorn), multiple workers, structured logging, health checks, graceful shutdown, TLS termination at the reverse proxy, and a properly layered Docker image. Each of these exists to handle a specific failure mode.

9. **BackgroundTasks are convenience, not infrastructure.** They run in the same process with no persistence or retry. For anything that must not be lost (emails, billing, notifications), use a task queue with a persistent broker.

10. **SSE and WebSockets serve different communication patterns.** SSE is server-to-client push over plain HTTP (ideal for LLM streaming). WebSockets are bidirectional over an upgraded connection (ideal for chat). Choose based on direction, not fashion.

---

## Self-Assessment Checklist

Before considering this module complete, you should be able to answer "yes" to all of these:

- [ ] I can explain the ASGI protocol and how Starlette, Pydantic, and FastAPI relate to each other
- [ ] I can define path, query, and body parameters using type hints and Pydantic models, and I understand how FastAPI generates 422 validation errors
- [ ] I can build a dependency tree with `Depends()`, including sub-dependencies and `yield`-based teardown, and I know what happens if teardown raises an exception
- [ ] I can describe the middleware execution order (onion model) and configure CORS correctly for a frontend on a different origin
- [ ] I can implement JWT authentication with `OAuth2PasswordBearer`, create and verify tokens, and protect endpoints with dependency-based auth
- [ ] I can integrate SQLAlchemy async with FastAPI, manage sessions via `yield` dependencies, and explain why `expire_on_commit=False` matters for async sessions
- [ ] I can explain the differences between BackgroundTasks, WebSockets, and SSE, and choose the right one for a given use case
- [ ] I can write a WebSocket endpoint with proper accept/receive/send/disconnect handling and a connection manager for broadcasting
- [ ] I can test FastAPI endpoints using `TestClient`, override dependencies with `app.dependency_overrides`, and structure a test suite with fixtures
- [ ] I can configure Gunicorn with Uvicorn workers, explain the worker count formula, and describe why Gunicorn manages processes while Uvicorn handles async
- [ ] I can write a production Dockerfile with multi-stage build, non-root user, proper layer caching, and exec-form CMD
- [ ] I can set up health check endpoints (`/health` and `/ready`), explain the difference between liveness and readiness probes, and configure graceful shutdown

---

## Quick Reference

### FastAPI Architecture Layers

| Layer | Library | Responsibility |
|-------|---------|---------------|
| **ASGI protocol** | ASGI spec | Defines the interface: `async def app(scope, receive, send)` |
| **ASGI server** | Uvicorn | Runs the event loop, manages connections, speaks HTTP/WebSocket |
| **ASGI toolkit** | Starlette | Routing, middleware, request/response objects, WebSocket support |
| **Data validation** | Pydantic v2 | Schema validation, serialization, coercion (Rust core) |
| **API framework** | FastAPI | Type-hint-driven parameter extraction, DI, OpenAPI generation |
| **Process manager** | Gunicorn | Spawns/monitors multiple Uvicorn workers, handles signals |

### Dependency Injection Patterns

| Pattern | Use Case | Example |
|---------|----------|---------|
| **Simple function** | Shared logic, config | `def get_settings(): return Settings()` |
| **`yield` dependency** | Resource lifecycle (DB sessions) | `yield session; session.close()` |
| **Sub-dependencies** | Composing auth + DB | `get_current_user(db=Depends(get_db))` |
| **Class dependency** | Stateful or parameterized deps | `class Paginator: def __init__(self, skip, limit)` |
| **Override** | Testing | `app.dependency_overrides[get_db] = mock_db` |

### Authentication Flow (JWT + OAuth2 Password)

| Step | Component | Action |
|------|-----------|--------|
| 1 | Client | POST `/token` with username + password |
| 2 | Endpoint | Verify credentials against DB |
| 3 | Endpoint | Create JWT with `sub`, `exp`, sign with `SECRET_KEY` |
| 4 | Client | Store token, send as `Authorization: Bearer <token>` |
| 5 | `OAuth2PasswordBearer` | Extract token from header |
| 6 | `get_current_user` dep | Decode JWT, verify signature + expiry, load user |
| 7 | Endpoint | Receives verified user via `Depends(get_current_user)` |

### Deployment Commands

```bash
# Development
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Production (single machine)
gunicorn app.main:app \
    --worker-class uvicorn.workers.UvicornWorker \
    --workers 4 \
    --bind 0.0.0.0:8000 \
    --timeout 120 \
    --graceful-timeout 30 \
    --keep-alive 65

# Docker build
docker build -t myapp:latest .

# Docker run
docker run -p 8000:8000 \
    -e DATABASE_URL=postgresql+asyncpg://user:pass@host/db \
    -e SECRET_KEY=your-secret \
    myapp:latest

# Health check
curl http://localhost:8000/health
curl http://localhost:8000/ready
```

### Communication Pattern Decision Table

| Need | Pattern | Why |
|------|---------|-----|
| Fire-and-forget post-response work | `BackgroundTasks` | Simplest, no infrastructure needed |
| Reliable async job processing | Celery / ARQ / TaskIQ | Persistence, retries, monitoring |
| Server pushes updates to client | SSE (`StreamingResponse`) | Simple, auto-reconnect, works through proxies |
| Bidirectional real-time messaging | WebSocket | Both sides send/receive freely |
| LLM token streaming | SSE | Server-to-client only, standard HTTP |

---

## What's Next

You have completed the full **Python + FastAPI track** — from Python fundamentals through concurrency, type systems, testing, and now production-grade API development.

**Recommended next steps:**

- **[System Design — Queues](/system-design/queues/)** — when BackgroundTasks are not enough: Redis-backed queues, delivery semantics, idempotency
- **[System Design — Load Balancing](/system-design/load-balancing/)** — nginx reverse proxy configuration, L4 vs L7, SSE/streaming passthrough
- **[System Design — Scaling](/system-design/scaling/)** — horizontal scaling, rate limiting with Redis, K8s HPA
- **[System Design — Caching](/system-design/caching/)** — cache-aside, stampede protection, Redis data structures
- **[Python Track Overview](/python/)** — revisit any module for deeper review
- **[Interview Crash Sheet — System Design](/interview/crash-sheet-system-design)** — rapid review of design patterns

The FastAPI knowledge you have built connects directly to system design: dependency injection maps to service boundaries, middleware maps to API gateway concerns, health checks map to orchestration, and streaming maps to real-time architecture. Use these connections when whiteboarding designs.
