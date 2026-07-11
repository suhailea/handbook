---
title: "Module 14 — Real-World Middleware"
outline: deep
---

# Module 14 — Real-World Middleware

Middleware is the connective tissue of any HTTP application. Every request passes through layers of validation, security enforcement, rate limiting, and context enrichment before it ever reaches your business logic. This module dissects the middleware you will actually deploy in production — not the toy `(req, res, next)` examples, but the battle-tested patterns that protect your API surface, shape your error responses, and give every request an identity you can trace across services.

Each page ties back to Node.js runtime fundamentals from earlier modules — AsyncLocalStorage for request context, streams for body parsing, the event loop for rate-limiting timers — showing that middleware is not "framework magic" but a thin orchestration layer over core Node capabilities.

## Pages

- [Request Validation with Zod](./01-request-validation) — schemas for body/params/query, type-safe middleware, coercion, discriminated unions, OpenAPI generation, NestJS integration
- [CORS, Compression & Security Headers](./02-cors-compression-security) — preflight mechanics, compression trade-offs (SSE, small payloads), Helmet.js header-by-header, clickjacking & sniffing prevention
- [Rate Limiting Middleware](./03-rate-limiting-middleware) — express-rate-limit, Redis-backed distributed limiting, sliding vs fixed window, per-route strategies, 429 + Retry-After, NestJS ThrottlerModule
- [Request Context, Tracing & Body Parsing](./04-request-context) — X-Request-Id, AsyncLocalStorage propagation, pino-http, body parsers (JSON/urlencoded/raw/multipart), size limits, slow request detection, NestJS ClsModule
- [Module 14 Summary](./summary)
