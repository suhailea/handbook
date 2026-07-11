---
title: "JWT: Access Tokens, Refresh Tokens & Rotation"
outline: deep
---

# JWT: Access Tokens, Refresh Tokens & Rotation

> **Interview weight:** 🔥🔥🔥 — JWT mechanics, token rotation, and the stateless-vs-stateful debate appear in almost every backend interview.
> **Node version:** All examples target Node 22+ with native `crypto` and the `jose` library.
> **Prereqs:** [HTTP Internals](/nodejs/module-05/) · [Security & Hardening](/nodejs/module-08/)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you visit a theme park. At the entrance, they check your ID and give you a **wristband** with your name, ticket tier (VIP or standard), and today's date printed on it. Every ride operator glances at your wristband and lets you on — they never radio back to the front gate to ask "is this person allowed here?" That's a JWT: a self-contained pass that carries your identity and permissions, signed by the gate so no one can forge it.

The signature is the tamper-evident seal. If you tried to scratch out "standard" and write "VIP," the seal would break and every ride operator would reject the band. That's what the cryptographic signature does — it proves the data hasn't been altered since the park issued it.

Now, wristbands have a problem: you can't revoke them easily. If someone steals your wristband, the park has no fast way to tell every ride operator "reject wristband #4827" — because the operators don't check a central list, they just look at the band. This is the fundamental trade-off of JWTs: speed and independence from a central database, at the cost of difficult revocation.

To deal with theft risk, the park gives you a **short-lived wristband** (good for 15 minutes) and a separate **locker key** (a refresh token). Every 15 minutes, you go back to a special booth, hand in your locker key, and get a fresh wristband. If the park discovers your locker key was stolen, they can invalidate it at that single booth — much easier than alerting every ride operator. That's **refresh token rotation**: the locker key is one-time-use, and if someone tries to reuse an old one, the park knows something is wrong and kills the whole family of keys.
:::

## ⚙️ Under the Hood

### JWT Structure

A JWT is three Base64URL-encoded segments separated by dots:

```
header.payload.signature
```

| Segment | Contents | Example |
|---|---|---|
| **Header** | Algorithm (`alg`) and token type (`typ`) | `{"alg":"ES256","typ":"JWT"}` |
| **Payload** | Claims — registered (`iss`, `sub`, `exp`, `iat`, `jti`) + custom | `{"sub":"user_123","role":"admin","exp":1720000000}` |
| **Signature** | HMAC or asymmetric signature over `base64url(header).base64url(payload)` | Binary, Base64URL-encoded |

The payload is **not encrypted** — anyone can decode it. The signature only guarantees **integrity and authenticity**. If you need confidentiality, use JWE (JSON Web Encryption).

### Signing Algorithms: When to Use Each

```typescript
// run: npx tsx jwt-algorithms.ts
// Requires: npm install jose

import { SignJWT, jwtVerify, generateKeyPair, generateSecret } from 'jose';

// ── HS256: Symmetric (shared secret) ──
// Use when: single service signs AND verifies (monolith, internal APIs)
// Danger: every service that verifies can also forge tokens
const secret = await generateSecret('HS256');

const hs256Token = await new SignJWT({ sub: 'user_123', role: 'admin' })
  .setProtectedHeader({ alg: 'HS256' })
  .setIssuedAt()
  .setExpirationTime('15m')
  .setIssuer('https://auth.example.com')
  .setJti(crypto.randomUUID()) // unique token ID for revocation
  .sign(secret);

console.log('HS256 token:', hs256Token);

// Verify
const { payload } = await jwtVerify(hs256Token, secret, {
  issuer: 'https://auth.example.com',
});
console.log('Verified payload:', payload);
```

```typescript
// run: npx tsx jwt-asymmetric.ts
// Requires: npm install jose

import { SignJWT, jwtVerify, generateKeyPair, exportJWK } from 'jose';

// ── RS256 (RSA) vs ES256 (ECDSA) ──
// Use asymmetric when: auth server signs, many services verify
// Verifiers only need the PUBLIC key — they cannot forge tokens

// ES256 is preferred over RS256 in modern systems:
// - Smaller keys (256-bit vs 2048-bit)
// - Smaller signatures (64 bytes vs 256 bytes)
// - Faster signing
// - RS256 exists mainly for legacy compatibility

const { privateKey, publicKey } = await generateKeyPair('ES256');

const token = await new SignJWT({
  sub: 'user_456',
  role: 'editor',
  orgId: 'org_789',
})
  .setProtectedHeader({ alg: 'ES256', kid: 'key-2024-07' }) // kid = key ID
  .setIssuedAt()
  .setExpirationTime('15m')
  .setIssuer('https://auth.example.com')
  .setAudience('https://api.example.com')
  .sign(privateKey);

// Any service with the public key can verify — but not forge
const { payload } = await jwtVerify(token, publicKey, {
  issuer: 'https://auth.example.com',
  audience: 'https://api.example.com',
});
console.log('ES256 verified:', payload);

// Export public key as JWK for JWKS endpoint
const jwk = await exportJWK(publicKey);
console.log('Public JWK:', { ...jwk, kid: 'key-2024-07', use: 'sig', alg: 'ES256' });
```

| Algorithm | Type | Key Size | Signature Size | Use Case |
|---|---|---|---|---|
| **HS256** | Symmetric | 256-bit secret | 32 bytes | Single-service, internal |
| **RS256** | Asymmetric (RSA) | 2048-bit+ | 256 bytes | Legacy systems, AWS/GCP integrations |
| **ES256** | Asymmetric (ECDSA) | 256-bit (P-256) | 64 bytes | Modern default, microservices |
| **EdDSA** | Asymmetric (Ed25519) | 256-bit | 64 bytes | Cutting edge, fastest verify *(Node 18+)* |

### Access Token vs Refresh Token

```
┌─────────────────────────────────────────────────┐
│ Login: POST /auth/login {email, password}       │
│                                                 │
│ Server returns:                                 │
│   accessToken  (JWT, 15min, in response body)   │
│   refreshToken (opaque or JWT, 7-30d, httpOnly  │
│                 cookie or secure storage)        │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ API call: GET /api/data                         │
│   Authorization: Bearer <accessToken>           │
│                                                 │
│ Server: verify JWT signature + exp → allow/deny │
│ No database lookup needed (stateless)           │
└─────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────┐
│ Access token expired → 401                      │
│ Client: POST /auth/refresh                      │
│   Cookie: refreshToken=<old_token>              │
│                                                 │
│ Server:                                         │
│   1. Validate refresh token in DB/Redis         │
│   2. Issue NEW access token + NEW refresh token │
│   3. Invalidate old refresh token               │
│   4. Return both                                │
└─────────────────────────────────────────────────┘
```

Why the split?
- **Access tokens** are sent on every request, so they travel over the network constantly. Short expiry limits damage if intercepted.
- **Refresh tokens** are sent only to the `/auth/refresh` endpoint. They're validated against a database (stateful), so they're revocable.

### Refresh Token Rotation & Reuse Detection

```typescript
// run: npx tsx refresh-rotation.ts
// Requires: npm install jose

import { SignJWT, jwtVerify, generateKeyPair } from 'jose';

// In production, this is Redis or a database table
const tokenStore = new Map<string, {
  userId: string;
  family: string;    // all tokens from one login session
  used: boolean;
  createdAt: number;
}>();

const { privateKey, publicKey } = await generateKeyPair('ES256');

async function issueTokenPair(userId: string, family?: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const tokenFamily = family ?? crypto.randomUUID();
  const refreshTokenId = crypto.randomUUID();

  // Store refresh token metadata (the token itself is a JWT, but we
  // track its ID server-side for rotation and reuse detection)
  tokenStore.set(refreshTokenId, {
    userId,
    family: tokenFamily,
    used: false,
    createdAt: Date.now(),
  });

  const accessToken = await new SignJWT({ sub: userId, role: 'user' })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(privateKey);

  const refreshToken = await new SignJWT({
    sub: userId,
    jti: refreshTokenId,
    family: tokenFamily,
  })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(privateKey);

  return { accessToken, refreshToken };
}

async function rotateRefreshToken(oldRefreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  // Verify the JWT signature and expiry
  const { payload } = await jwtVerify(oldRefreshToken, publicKey);
  const tokenId = payload.jti as string;
  const record = tokenStore.get(tokenId);

  if (!record) {
    throw new Error('Refresh token not found — already revoked or invalid');
  }

  // ── REUSE DETECTION ──
  // If this token was already used, an attacker may have stolen it.
  // Invalidate the ENTIRE family (all tokens from this login session).
  if (record.used) {
    console.error(`🚨 REUSE DETECTED for family ${record.family} — revoking all tokens`);
    for (const [id, entry] of tokenStore) {
      if (entry.family === record.family) {
        tokenStore.delete(id);
      }
    }
    throw new Error('Refresh token reuse detected — session invalidated');
  }

  // Mark the old token as used (one-time use)
  record.used = true;

  // Issue a new pair in the same family
  return issueTokenPair(record.userId, record.family);
}

// Demo flow
const pair1 = await issueTokenPair('user_123');
console.log('Initial tokens issued');

const pair2 = await rotateRefreshToken(pair1.refreshToken);
console.log('Rotated successfully');

// Attacker tries to reuse the old refresh token
try {
  await rotateRefreshToken(pair1.refreshToken);
} catch (err) {
  console.log('Caught:', (err as Error).message);
  // "Refresh token reuse detected — session invalidated"
  // pair2's refresh token is ALSO now invalid — entire family killed
}
```

**Token families** are the key insight: every refresh token issued from a single login event shares a `family` ID. When reuse is detected, you revoke every token in that family, forcing the legitimate user to re-authenticate. This limits the damage window of a stolen refresh token.

### Token Storage: Where to Keep Tokens on the Client

| Storage | XSS-Safe? | CSRF-Safe? | Sent Automatically? | Best For |
|---|---|---|---|---|
| **httpOnly cookie** | Yes (JS can't read) | No (sent on every request to domain) | Yes | Web apps with CSRF protection |
| **localStorage** | No (JS can read) | Yes (not sent automatically) | No (manual `Authorization` header) | SPAs where CSRF is harder; acceptable if strong CSP |
| **sessionStorage** | No | Yes | No | Tab-scoped flows |
| **In-memory variable** | Yes | Yes | No | Short sessions; lost on refresh |

The recommended pattern for web apps: **access token in memory, refresh token in httpOnly secure cookie**. The access token lives only in a JavaScript variable — it survives API calls but not page refreshes. On refresh, the app silently calls `/auth/refresh` using the cookie-stored refresh token to get a new access token.

### Token Revocation Strategies

Since JWTs are stateless, revocation requires adding state back:

```typescript
// run: npx tsx token-revocation.ts
// Requires: npm install jose ioredis

// Strategy 1: Short-lived access tokens + refresh token revocation
// The simplest approach. Access tokens can't be revoked but expire in 15 minutes.
// Refresh tokens are checked against a database on every use.

// Strategy 2: Token blocklist in Redis
// For immediate revocation (e.g., user clicks "log out of all devices")

// Pseudocode using Redis
import { SignJWT, jwtVerify, generateKeyPair } from 'jose';

const { privateKey, publicKey } = await generateKeyPair('ES256');

// Simulated Redis blocklist (use ioredis in production)
const blocklist = new Set<string>();

async function revokeToken(jti: string, expiresInSeconds: number): Promise<void> {
  // Store the token ID in Redis with TTL = remaining token lifetime
  // No point keeping it after the token naturally expires
  blocklist.add(jti);
  // In Redis: await redis.setex(`blocklist:${jti}`, expiresInSeconds, '1');
}

async function verifyAccessToken(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, publicKey);

  // Check blocklist AFTER signature verification (cheaper to verify sig first
  // if blocklist is in Redis — avoid network hop for invalid tokens)
  if (payload.jti && blocklist.has(payload.jti as string)) {
    throw new Error('Token has been revoked');
  }

  return payload as Record<string, unknown>;
}

// Strategy 3: Token versioning
// Store a `tokenVersion` counter per user in the database.
// Include it in the JWT payload. On verify, compare against the DB version.
// Increment the version to invalidate ALL tokens for a user.
// Cost: one DB read per request (partially defeats the "stateless" benefit).

const tokenWithVersion = await new SignJWT({
  sub: 'user_123',
  tokenVersion: 3, // must match user.tokenVersion in DB
})
  .setProtectedHeader({ alg: 'ES256' })
  .setIssuedAt()
  .setExpirationTime('15m')
  .sign(privateKey);

console.log('Token with version field:', tokenWithVersion);
```

### JWKS: Key Distribution for Microservices

When using asymmetric algorithms, the auth server publishes its public keys at a well-known endpoint (`/.well-known/jwks.json`). Verifying services fetch keys from there.

```typescript
// run: npx tsx jwks-server.ts
// Requires: npm install jose

import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT, createRemoteJWKSet, jwtVerify } from 'jose';

// Auth server: generate keys and expose JWKS endpoint
const { privateKey, publicKey } = await generateKeyPair('ES256');
const publicJwk = await exportJWK(publicKey);

const jwks = {
  keys: [{
    ...publicJwk,
    kid: 'key-2024-07',
    use: 'sig',
    alg: 'ES256',
  }],
};

const server = createServer((req, res) => {
  if (req.url === '/.well-known/jwks.json') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(jwks));
    return;
  }
  res.writeHead(404).end();
});

server.listen(3100, async () => {
  console.log('JWKS endpoint: http://localhost:3100/.well-known/jwks.json');

  // Issue a token
  const token = await new SignJWT({ sub: 'user_123' })
    .setProtectedHeader({ alg: 'ES256', kid: 'key-2024-07' })
    .setIssuedAt()
    .setExpirationTime('15m')
    .setIssuer('https://auth.example.com')
    .sign(privateKey);

  // Verifying service: fetch public keys from JWKS endpoint
  // jose caches the keys and respects Cache-Control headers
  const JWKS = createRemoteJWKSet(new URL('http://localhost:3100/.well-known/jwks.json'));

  const { payload } = await jwtVerify(token, JWKS, {
    issuer: 'https://auth.example.com',
  });
  console.log('Verified via JWKS:', payload);

  server.close();
});
```

**Key rotation with JWKS:** add a new key to the JWKS array, start signing with it (using its `kid`), and remove the old key after all outstanding tokens signed with it have expired. Verifying services automatically pick up new keys because `createRemoteJWKSet` refreshes periodically.

### The Stateless vs Stateful JWT Debate

| Dimension | Stateless JWT | Stateful (session-like JWT) |
|---|---|---|
| **Verify cost** | Signature check only (CPU) | Signature + DB/Redis lookup |
| **Revocation** | Hard — blocklist or wait for expiry | Easy — delete from store |
| **Scalability** | Excellent — no shared state | Requires shared store (Redis) |
| **Token size** | Can grow large with claims | Minimal (just a session ID in JWT) |
| **Best for** | Microservices, short-lived tokens | Apps needing instant revocation |

The pragmatic answer: use **short-lived stateless access tokens** (15 min) paired with **stateful refresh tokens** stored in Redis. You get the scalability of stateless verification for 99% of requests and the revocability of stateful tokens for security-critical operations.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. The `none` algorithm attack.** Older JWT libraries accepted `{"alg":"none"}` in the header, which means no signature at all — the attacker just base64-encodes whatever claims they want. The `jose` library rejects `none` by default, but always explicitly specify allowed algorithms during verification: `jwtVerify(token, key, { algorithms: ['ES256'] })`. Never trust the `alg` header blindly.

**2. Symmetric key confusion with asymmetric tokens.** If your verification code accepts both HS256 and RS256, an attacker can take your public RSA key (which is, by definition, public), use it as the HS256 secret to sign a forged token, and set `alg: "HS256"`. The verifier uses the RSA public key as the HMAC secret, and the signature matches. Fix: always pin the expected algorithm. `jose` mitigates this by tying the key type to the algorithm.

**3. Refresh token stored in localStorage, stolen via XSS.** If an attacker injects script into your page (via a compromised dependency, user-generated content, etc.), they can read `localStorage`, exfiltrate the refresh token, and mint new access tokens from their own machine indefinitely. httpOnly cookies are immune to this because JavaScript cannot access them. If you must use localStorage, enforce strict Content-Security-Policy and Subresource Integrity.

**4. Refresh token rotation without reuse detection.** If you rotate tokens but don't track whether an old token was already used, a stolen token can be silently used in parallel with the legitimate user. Both get valid tokens, and you never know the token was compromised. Always implement token families and reuse detection.
:::

## 🎯 Checkpoint

::: details Question 1 — Algorithm choice
**Q:** You're building a microservices system where an auth service issues JWTs and five downstream services verify them. Which signing algorithm do you choose and why? What would change if it were a single monolithic application?

**A:** For microservices, use an **asymmetric algorithm** like ES256 (ECDSA with P-256). The auth service holds the private key and signs tokens. The five downstream services each hold only the public key (distributed via a JWKS endpoint) and can verify but never forge tokens. This follows the principle of least privilege — a compromised downstream service cannot issue fake tokens. ES256 is preferred over RS256 because it produces smaller signatures (64 bytes vs 256 bytes) and has faster signing.

For a monolith, HS256 (HMAC-SHA256) is simpler and faster. There's a single service that both signs and verifies, so sharing a symmetric secret is not a security risk. The secret stays in one process's memory. However, if the monolith might later be split into services, starting with ES256 avoids a migration.
:::

::: details Question 2 — Reuse detection mechanism
**Q:** Explain how refresh token reuse detection works using token families. What happens to the legitimate user when an attacker uses a stolen (already-rotated) refresh token?

**A:** When a user logs in, a **token family** is created — a unique identifier shared by all refresh tokens descended from that login event. Each refresh token is one-time-use: when the client exchanges a refresh token for a new pair, the server marks the old token as "used" and issues a new token in the same family.

If an attacker steals a refresh token that the legitimate user has already rotated (meaning it's marked as "used"), the server detects reuse: the same token is being presented a second time. The server then **revokes every token in that family** — both the attacker's stolen token and the legitimate user's current valid token. Both parties are forced to re-authenticate.

This means the legitimate user experiences a forced logout, which is an acceptable security trade-off: it's better to inconvenience one user than to let an attacker maintain persistent access. The user logs in again, gets a new family, and continues. The attacker is locked out.
:::

::: details Question 3 — Stateless revocation
**Q:** A user reports their account compromised. You need to immediately invalidate all their active access tokens, but your access tokens are stateless JWTs with 15-minute expiry. What are your options, and what's the trade-off of each?

**A:** Three options, in order of increasing complexity:

1. **Wait for expiry.** If tokens expire in 15 minutes, do nothing for access tokens and just revoke all refresh tokens. The attacker can operate for at most 15 minutes. Trade-off: unacceptable for sensitive systems (financial, healthcare).

2. **Token blocklist in Redis.** Store the `jti` (token ID) of every revoked token in Redis with a TTL equal to the token's remaining lifetime. Every verification checks Redis. Trade-off: adds a network hop (Redis lookup) to every request, partially negating the "stateless" benefit. But it's a fast O(1) lookup, and you only need to store entries for the 15-minute window.

3. **Token versioning.** Store a `tokenVersion` counter per user in the database. Include it in the JWT payload. On every request, compare the JWT's version against the DB. Increment the version to invalidate everything. Trade-off: requires a DB read on every request (similar cost to sessions), but it's a simple integer comparison and works without tracking individual token IDs.

The most common production pattern is option 2 (Redis blocklist) for the rare revocation event, combined with short expiry so the blocklist stays small.
:::

## Key Mental Models

- **JWTs are integrity-protected, not secret.** Anyone can read the payload; the signature only prevents tampering. Use JWE if the claims themselves are sensitive.
- **Short access tokens + stateful refresh tokens is the pragmatic middle ground.** You get stateless verification speed for routine requests and revocation capability for security events.
- **Token families make reuse detection possible.** Without family tracking, stolen refresh tokens are invisible. With it, any reuse triggers a full session revocation.
- **The algorithm is part of the security contract.** Always pin the expected algorithm on the verification side. Never let the token's header dictate which algorithm to use.
- **Asymmetric signing is a microservice requirement, not an option.** The moment more than one service touches tokens, the signing key and verification key must be different.

## Related

- [OAuth 2.0 & Social Login](./02-oauth) — how tokens are issued in delegated auth flows
- [Session Management & Cookies](./03-sessions) — the stateful alternative to JWTs
- [HTTP Hardening](/nodejs/module-08/) — securing the transport layer that carries tokens
- [Caching (Redis)](/system-design/caching/) — the infrastructure behind token blocklists
