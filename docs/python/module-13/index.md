---
title: Module 13 — FastAPI
outline: deep
---

# Module 13 — FastAPI

> From first endpoint to production deployment — the most popular Python web framework for building APIs.

FastAPI has become the dominant choice for building Python APIs, and for good reason: it is fast, it catches bugs at development time through type hints, and it generates interactive documentation automatically. But FastAPI is not magic — it is a carefully designed layer on top of **two foundational libraries**:

- **Starlette** — the ASGI toolkit that handles everything related to HTTP: accepting connections, routing requests, running middleware, sending responses. Starlette is to FastAPI what the engine and chassis are to a car.
- **Pydantic** — the data validation library that ensures every piece of data entering or leaving your API conforms to the shape you declared. Pydantic v2 rewrote its core in Rust for dramatic speed improvements.

Understanding these layers is the key to using FastAPI effectively. When something goes wrong — a mysterious 422 error, middleware not firing in the order you expect, a database session leaking — the answer almost always lives in Starlette or Pydantic, not in FastAPI itself. This module teaches you what FastAPI abstracts and how it works under the hood, so you can debug confidently and make architectural decisions that hold up in production.

**Prerequisites:** [Module 7 — asyncio](/python/module-07/), [Module 10 — Type Hints](/python/module-10/), [Module 12 — Testing](/python/module-12/)

## What You'll Learn

- How ASGI replaced WSGI and why that matters for async Python
- The Starlette → FastAPI layering and the full request lifecycle
- Routing, path/query/body parameter extraction, and Pydantic validation — all driven by type hints
- FastAPI's dependency injection system: `Depends()`, sub-dependencies, yield-based teardown
- Middleware, CORS, and structured error handling
- Authentication patterns: JWT, OAuth2 password flow, API keys
- Async database integration with SQLAlchemy, session management, and the repository pattern
- Background tasks, WebSocket endpoints, and Server-Sent Events (SSE) streaming
- Testing FastAPI apps with `TestClient`, async tests, and dependency overrides
- Production deployment with Uvicorn, Gunicorn, Docker, health checks, and structured logging

## Pages in This Module

| # | Page | Topic |
|---|------|-------|
| 13.1 | [FastAPI Architecture](01-architecture) | Starlette, ASGI, Pydantic foundation |
| 13.2 | [Routing, Params & Validation](02-routing-validation) | Path/query/body params, Pydantic models, response models |
| 13.3 | [Dependency Injection](03-dependency-injection) | `Depends()`, sub-dependencies, yields, scopes |
| 13.4 | [Middleware, CORS & Error Handling](04-middleware-errors) | ASGI middleware, exception handlers, CORS |
| 13.5 | [Auth — JWT, OAuth2 & Security](05-auth-security) | OAuth2 password flow, JWT, API keys, scopes |
| 13.6 | [Database Integration](06-database-integration) | SQLAlchemy async, sessions, migrations, repository pattern |
| 13.7 | [Background Tasks, WebSockets & SSE](07-background-websockets) | BackgroundTasks, WebSocket endpoints, SSE streaming |
| 13.8 | [Testing FastAPI Applications](08-testing) | TestClient, async testing, dependency overrides |
| 13.9 | [Deployment & Production](09-deployment) | Uvicorn, Gunicorn, Docker, health checks, structured logging |
