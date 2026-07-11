---
title: "Module 14 Summary"
outline: deep
---

# Module 14 Summary — Real-World Middleware

## Mental Models Gained

1. **Middleware is a pipeline of boundary guards.** Each middleware layer handles one concern — validation, security, rate limiting, context — and either passes the request forward or terminates it with an error response. Order matters: rate limiting before body parsing, body parsing before validation, context setup before logging.

2. **Validate at the edge, trust inside.** Zod schemas at the middleware boundary mean your handlers and services never re-check data shapes. The schema is both the runtime validator and the TypeScript type — zero drift between what you check and what the compiler knows.

3. **CORS is a browser contract, not a server shield.** Your server declares which origins may access it; the browser enforces the declaration. Server-to-server calls bypass CORS entirely. Misconfigured CORS (wildcard + credentials, missing preflight caching) causes silent failures that only appear in browser environments.

4. **Rate limiting protects your infrastructure from the outside.** In-memory limiters are a development convenience; production needs Redis-backed distributed state. Design for Redis failure (fail open + alert), apply limiting before expensive middleware, and always return `Retry-After` headers.

5. **Request context follows the async chain, not the call stack.** `AsyncLocalStorage` lets any function in the request's async chain access the request ID, user, and timing data without passing them as parameters. This is the foundation for structured logging, distributed tracing, and OpenTelemetry propagation.

6. **Body parsing is content-type dispatch.** JSON, URL-encoded, raw bytes, and multipart streams each require a different parser. Getting the order wrong (JSON parser before webhook raw body capture) causes subtle, hard-to-debug failures like broken signature verification.

## Self-Assessment Checklist

- [ ] I can write a Zod schema with nested objects, arrays, coercion, discriminated unions, and custom refinements
- [ ] I can build a generic Express validation middleware that validates body, params, and query separately
- [ ] I understand why `z.object()` strips unknown keys by default and when to use `.passthrough()` or `.strict()`
- [ ] I can explain the CORS preflight flow (OPTIONS → actual request) and why `*` breaks with credentials
- [ ] I know when to enable compression and when it hurts (SSE, small payloads, already-compressed assets)
- [ ] I can list what each Helmet.js header protects against (CSP, HSTS, X-Content-Type-Options, X-Frame-Options)
- [ ] I can configure express-rate-limit with per-route strategies and different key generators (IP, user ID, API key)
- [ ] I understand fixed-window vs sliding-window rate limiting trade-offs and can implement a Redis-backed sliding window
- [ ] I can implement request ID middleware using `AsyncLocalStorage` and propagate IDs to downstream services
- [ ] I know the difference between `express.json()`, `express.raw()`, and `multer` — and when each is needed
- [ ] I can explain why webhook signature verification needs raw bytes, not `JSON.stringify(req.body)`
- [ ] I understand why NestJS CLS is preferred over request-scoped providers for request context

## What Comes Next

- **Module 15 — WebSockets & Real-Time** builds on the middleware concepts here (authentication middleware for WebSocket connections, rate limiting WebSocket messages, request context for WebSocket events)
- **Module 9 — Testing & Observability** shows how the request context infrastructure from this module feeds into OpenTelemetry spans and structured logging
- **Track 3 — Frameworks** explores how NestJS abstracts these middleware patterns into guards, interceptors, and pipes
