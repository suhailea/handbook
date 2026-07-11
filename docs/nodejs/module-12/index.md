---
title: "Module 12 — Authentication & Authorization Patterns"
outline: deep
---

# Module 12 — Authentication & Authorization Patterns

This module covers the full spectrum of identity and access control in Node.js applications — from cryptographic token mechanics to session management to fine-grained authorization models. Every page connects back to the Node.js runtime concepts from earlier modules (streams, crypto, HTTP internals, AsyncLocalStorage) and shows how frameworks like Express and NestJS build abstractions on top.

## What you will learn

- How JWTs work at the byte level — signing, verification, rotation, and revocation strategies
- OAuth 2.0 flows from Authorization Code + PKCE to Client Credentials, and how OpenID Connect layers identity on top
- Server-side session management with cookies, Redis-backed stores, and CSRF protection
- RBAC and ABAC authorization models, from middleware to NestJS guards to CASL policies

## Pages

- [JWT: Access Tokens, Refresh Tokens & Rotation](./01-jwt-tokens.md)
- [OAuth 2.0 & Social Login](./02-oauth.md)
- [Session Management & Cookies](./03-sessions.md)
- [RBAC, ABAC & Authorization Patterns](./04-rbac-authorization.md)
- [Module 12 Summary](./summary.md)

## Prerequisites

- [HTTP Internals](/nodejs/module-05/) — you need to understand cookies, headers, and TLS
- [Security & Hardening](/nodejs/module-08/) — threat models, header hardening, prototype pollution
- [AsyncLocalStorage](/nodejs/module-03/05-async-local-storage) — request-scoped context propagation (used heavily in auth middleware)
