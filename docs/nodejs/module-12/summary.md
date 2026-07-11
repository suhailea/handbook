---
title: "Module 12 Summary"
outline: deep
---

# Module 12 — Authentication & Authorization Patterns: Summary

Module 12 covers the full identity and access control stack — from cryptographic token mechanics to session management to fine-grained authorization. Every pattern connects back to Node.js runtime fundamentals: crypto for hashing and signing, HTTP for cookies and headers, AsyncLocalStorage for request-scoped identity propagation.

## Mental Models Gained

- **JWTs are integrity-protected envelopes, not secrets.** The payload is readable by anyone; the signature guarantees it hasn't been tampered with. Use short-lived access tokens (15 min) for stateless verification and stateful refresh tokens (in Redis) for revocation. Token families with reuse detection catch stolen refresh tokens.
- **OAuth is delegation, not authentication.** OAuth 2.0 answers "what can this app do on the user's behalf?" — it doesn't reliably tell you who the user is. OpenID Connect adds the identity layer via the `id_token`. PKCE binds each authorization flow to a per-session secret, preventing code interception even if the client secret leaks.
- **Sessions are references; JWTs are values.** Sessions give you instant revocation at the cost of a shared store (Redis). JWTs give you stateless verification at the cost of difficult revocation. The choice depends on your revocation requirements — most production systems use both (JWT for API auth, sessions for web apps).
- **Cookie attributes are your security perimeter.** `HttpOnly` blocks XSS cookie theft, `Secure` blocks MITM, `SameSite=Lax` blocks CSRF while allowing OAuth redirects. Omitting any one opens a specific, exploitable attack vector.
- **Authorization is a separate concern from authentication.** A valid token proves identity; it says nothing about permissions. RBAC works for static role-permission mappings. ABAC is needed when permissions depend on relationships (user's department, resource ownership, time of day).
- **IDOR is the most common authorization vulnerability.** Always verify ownership at the data query level (`WHERE userId = ?`), not just at the route level. Return 404, not 403, for unauthorized resources.
- **Password hashing should be deliberately slow.** Argon2id is preferred over bcrypt: it's memory-hard (resists GPU attacks), has no password length limit, and has configurable parameters. Target 500ms-1000ms per hash on your hardware.

## Self-Assessment Checklist

### 12.1 — JWT: Access Tokens, Refresh Tokens & Rotation
- [ ] Can you explain the three segments of a JWT and what the signature protects?
- [ ] Do you know when to use HS256 vs ES256 vs RS256?
- [ ] Can you implement refresh token rotation with reuse detection using token families?
- [ ] Can you explain the `none` algorithm attack and how to prevent it?
- [ ] Do you understand the trade-offs of token storage (httpOnly cookie vs localStorage vs memory)?
- [ ] Can you describe how JWKS endpoints enable key rotation in microservices?

### 12.2 — OAuth 2.0 & Social Login
- [ ] Can you walk through the Authorization Code + PKCE flow step by step?
- [ ] Do you know why the Implicit flow is deprecated and what replaces it?
- [ ] Can you explain what PKCE protects against that `client_secret` alone does not?
- [ ] Do you understand the difference between OAuth 2.0 and OpenID Connect?
- [ ] Can you explain the `state` parameter's role in preventing CSRF?
- [ ] Do you know when to use Client Credentials vs Authorization Code?

### 12.3 — Session Management & Cookies
- [ ] Can you list all security-relevant cookie attributes and explain each one?
- [ ] Do you know why `SameSite=Strict` breaks OAuth flows?
- [ ] Can you explain session fixation and how `regenerate()` prevents it?
- [ ] Can you compare sessions and JWTs across revocation, scalability, and security?
- [ ] Do you understand why `saveUninitialized: false` matters in production?
- [ ] Can you implement CSRF protection using both the synchronizer token and double-submit cookie patterns?

### 12.4 — RBAC, ABAC & Authorization Patterns
- [ ] Can you explain the difference between 401 and 403 and when to use each?
- [ ] Can you identify when RBAC is insufficient and ABAC is needed?
- [ ] Can you explain IDOR and demonstrate three prevention strategies?
- [ ] Do you know why argon2id is preferred over bcrypt and what parameters to use?
- [ ] Can you explain timing-safe comparison and where it matters?
- [ ] Can you implement role-based authorization as Express middleware and NestJS guards?
