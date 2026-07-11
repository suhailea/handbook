---
title: "Session Management & Cookies"
outline: deep
---

# Session Management & Cookies

> **Interview weight:** 🔥🔥🔥 — Session vs JWT is a classic debate question. Cookie security attributes are expected knowledge for any backend role.
> **Node version:** All examples target Node 22+ with native `crypto`. Express examples use `express-session`.
> **Prereqs:** [JWT: Access Tokens & Refresh Tokens](./01-jwt-tokens) · [HTTP Internals](/nodejs/module-05/)

## 🗣️ In Plain English

::: tip In Plain English
A JWT is like a wristband with your name printed on it — you carry your identity with you, and anyone can read it without calling headquarters. A **session** is the opposite: you carry a **coat check ticket** — a random number that means nothing on its own. When you hand it to the server, the server looks up your ticket number in a filing cabinet behind the counter and pulls out everything it knows about you.

The filing cabinet is the **session store** — it might be the server's own memory (fast, but lost when the server restarts), Redis (fast and shared across servers), or a database (durable, but slower). The ticket is the **session ID**, delivered to your browser inside a **cookie**.

Cookies are just sticky notes the server puts on your browser. Every time your browser visits that server, it automatically sends the sticky note back. The server writes the session ID on the sticky note, and adds instructions: "Don't let JavaScript read this" (`httpOnly`), "Only send this over HTTPS" (`secure`), "Don't send this when another website triggers a request to me" (`sameSite`). These instructions are the cookie's **attributes**, and they're your first line of defense against session theft.

The biggest danger is **session fixation**: imagine an attacker hands you a pre-written coat check ticket before you log in. You walk in, show the ticket, and the coat check attendant says "OK, this is now your ticket." The attacker has a copy of that same ticket. After you log in and hang your coat (with your wallet in it), the attacker walks up with their copy and collects your coat. The fix is simple: every time your authentication state changes (login, logout, privilege escalation), destroy the old ticket and issue a new one. The attacker's copy becomes worthless.

Sessions are fundamentally **stateful** — the server must remember every active session. That means you need a shared store in a multi-server deployment. JWTs trade statefulness for revocation difficulty. Sessions trade scalability for control. Neither is universally better; the right choice depends on your revocation requirements and infrastructure.
:::

## ⚙️ Under the Hood

### How Server-Side Sessions Work

```
┌─────────┐     Cookie: sid=abc123         ┌──────────┐
│ Browser │ ─────────────────────────────> │  Server  │
│         │                                │          │
│         │                                │ Look up  │
│         │                                │ abc123   │
│         │                                │ in store │
│         │                                │    │     │
│         │                                │    ▼     │
│         │                                │ {userId: │
│         │                                │  "u_42", │
│         │     200 OK + user data         │  role:   │
│         │ <───────────────────────────── │  "admin"}│
└─────────┘                                └──────────┘
```

The session ID is the **only** thing sent to the client. All session data lives server-side. This is fundamentally different from JWTs, where claims travel with the token.

### Cookie Attributes Deep Dive

```typescript
// run: npx tsx cookie-demo.ts
// Requires: npm install express @types/express

import express from 'express';
import { randomBytes, createHmac } from 'node:crypto';

const app = express();

// Demonstrating cookie attribute effects
app.get('/set-cookie', (req, res) => {
  const sessionId = randomBytes(32).toString('hex');

  res.setHeader('Set-Cookie', [
    // Session cookie — correct security attributes
    `sid=${sessionId}; ` +
    'HttpOnly; ' +        // JavaScript cannot read via document.cookie
    'Secure; ' +          // Only sent over HTTPS
    'SameSite=Lax; ' +    // Not sent on cross-origin subrequests (POST, iframe)
    'Path=/; ' +          // Scoped to entire site
    'Max-Age=86400',      // 24 hours (omit for "session cookie" that dies with browser)

    // CSRF double-submit cookie — intentionally NOT httpOnly
    // JavaScript needs to read this and send it as a header
    `csrf=${randomBytes(32).toString('hex')}; ` +
    'Secure; ' +
    'SameSite=Strict; ' + // Strict = never sent on cross-origin navigations either
    'Path=/; ' +
    'Max-Age=86400',
  ]);

  res.json({ message: 'Cookies set' });
});

app.listen(3300, () => console.log('http://localhost:3300/set-cookie'));
```

| Attribute | Purpose | Omission Risk |
|---|---|---|
| `HttpOnly` | Block `document.cookie` access | XSS steals session ID |
| `Secure` | HTTPS only | MITM intercepts cookie on HTTP |
| `SameSite=Lax` | Block cross-origin POST/iframe | CSRF via form submission |
| `SameSite=Strict` | Block all cross-origin sends | Breaks OAuth redirect flows (cookie not sent on redirect from auth provider) |
| `Path=/` | Scope to path | Cookie sent only to subpath |
| `Domain` | Scope to domain (+ subdomains) | Omit to restrict to exact origin (safer) |
| `Max-Age` / `Expires` | TTL | Session cookie (dies with browser tab — but browsers restore them) |

**`SameSite=Lax` vs `Strict`:** Lax allows the cookie on top-level GET navigations (clicking a link), which is why OAuth callbacks work with Lax but break with Strict. Use Lax for session cookies, Strict for CSRF tokens.

### Session Store Options

```typescript
// run: npx tsx session-stores.ts
// Requires: npm install express express-session connect-redis ioredis @types/express

import express from 'express';
import session from 'express-session';
import { Redis } from 'ioredis';
import RedisStore from 'connect-redis';

const app = express();

// ── Option 1: In-memory (default) ──
// Only for development. Data lost on restart. Cannot share across instances.
app.use(session({
  secret: 'dev-only-secret',
  resave: false,
  saveUninitialized: false,
}));

// ── Option 2: Redis (recommended for production) ──
const redisClient = new Redis({
  host: '127.0.0.1',
  port: 6379,
  // enableReadyCheck: true,
  // retryDelayOnFailover: 100,
});

app.use(session({
  store: new RedisStore({
    client: redisClient,
    prefix: 'sess:',        // key prefix in Redis
    ttl: 86400,             // 24 hours in seconds
    disableTouch: false,    // update TTL on every request (sliding window)
  }),
  name: 'sid',              // cookie name (change from default 'connect.sid')
  secret: process.env.SESSION_SECRET ?? 'change-me-in-production',
  resave: false,            // don't save session if unmodified
  saveUninitialized: false, // don't create session until something is stored
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours in ms
  },
}));
```

| Store | Latency | Shared? | Durable? | Use Case |
|---|---|---|---|---|
| **Memory** | ~0ms | No | No (lost on restart) | Development only |
| **Redis** | ~1ms | Yes (all instances) | Configurable (AOF/RDB) | Production default |
| **PostgreSQL/MySQL** | ~5-20ms | Yes | Yes | When Redis is not available |
| **MongoDB** | ~5-15ms | Yes | Yes | Already using MongoDB |

### Session Fixation Prevention

```typescript
// run: npx tsx session-fixation.ts
// Requires: npm install express express-session @types/express

import express from 'express';
import session from 'express-session';

const app = express();
app.use(express.json());
app.use(session({
  secret: 'keyboard-cat',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));

app.post('/login', (req, res) => {
  const { username, password } = req.body as { username: string; password: string };

  // Verify credentials (simplified)
  if (username === 'admin' && password === 'password') {
    // ── CRITICAL: Regenerate session ID on authentication state change ──
    // This destroys the old session and creates a new one with a new ID,
    // preserving the session data. Any pre-login session ID is now invalid.
    const oldData = { ...req.session };

    req.session.regenerate((err) => {
      if (err) {
        res.status(500).json({ error: 'Session regeneration failed' });
        return;
      }

      // Restore any pre-login data you want to keep
      // (e.g., shopping cart from anonymous session)
      Object.assign(req.session, oldData);

      // Set authenticated user
      (req.session as Record<string, unknown>).userId = 'user_42';
      (req.session as Record<string, unknown>).role = 'admin';
      (req.session as Record<string, unknown>).authenticatedAt = Date.now();

      req.session.save((saveErr) => {
        if (saveErr) {
          res.status(500).json({ error: 'Session save failed' });
          return;
        }
        res.json({ message: 'Logged in', sessionId: req.sessionID });
      });
    });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/logout', (req, res) => {
  // Destroy the session entirely — not just clear the data
  req.session.destroy((err) => {
    if (err) {
      res.status(500).json({ error: 'Session destruction failed' });
      return;
    }
    // Clear the cookie on the client side
    res.clearCookie('connect.sid', { path: '/' });
    res.json({ message: 'Logged out' });
  });
});

app.listen(3400, () => console.log('http://localhost:3400'));
```

### CSRF Protection

Cross-Site Request Forgery exploits the fact that cookies are sent automatically. Two defense patterns:

```typescript
// run: npx tsx csrf-protection.ts
// Requires: npm install express express-session @types/express

import express from 'express';
import session from 'express-session';
import { randomBytes, timingSafeEqual } from 'node:crypto';

const app = express();
app.use(express.json());
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' },
}));

// ── Pattern 1: Synchronizer Token ──
// Server generates a token, stores it in the session, and sends it to the client.
// Client includes it in a hidden form field or custom header on every mutating request.
// Server compares the submitted token to the session-stored token.

function generateCsrfToken(req: express.Request): string {
  const token = randomBytes(32).toString('hex');
  (req.session as Record<string, unknown>).csrfToken = token;
  return token;
}

function verifyCsrfToken(req: express.Request): boolean {
  const sessionToken = (req.session as Record<string, unknown>).csrfToken as string | undefined;
  const submittedToken = req.headers['x-csrf-token'] as string | undefined;

  if (!sessionToken || !submittedToken) return false;

  // Timing-safe comparison prevents timing attacks
  const a = Buffer.from(sessionToken);
  const b = Buffer.from(submittedToken);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Pattern 2: Double-Submit Cookie ──
// Server sets a random token as a non-httpOnly cookie.
// Client reads the cookie via JavaScript and sends it as a header.
// Server compares the header value to the cookie value.
// Works because: an attacker site cannot read cookies from another domain.

app.get('/csrf-token', (req, res) => {
  const token = generateCsrfToken(req);
  // Also set as a cookie (readable by JS) for double-submit pattern
  res.cookie('csrf', token, {
    httpOnly: false,  // JS needs to read this
    secure: true,
    sameSite: 'strict',
  });
  res.json({ csrfToken: token });
});

// Apply CSRF check to all state-changing methods
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }

  if (!verifyCsrfToken(req)) {
    res.status(403).json({ error: 'CSRF token validation failed' });
    return;
  }
  next();
});

app.post('/transfer', (req, res) => {
  res.json({ message: 'Transfer executed (CSRF validated)' });
});

app.listen(3500, () => console.log('http://localhost:3500'));
```

**`SameSite` cookies reduce but don't eliminate CSRF.** `SameSite=Lax` blocks cross-origin POST requests but allows GET. If a state-changing operation is triggered via GET (bad design, but it happens), SameSite alone won't save you. Use both `SameSite` and a CSRF token for defense in depth.

### Session vs JWT: The Comparison Table

| Dimension | Server-Side Sessions | Stateless JWTs |
|---|---|---|
| **State** | Server stores session data | Client carries all claims |
| **Storage cost** | ~200 bytes per session in Redis | Zero server-side (per token) |
| **Network cost** | ~32-byte cookie | ~800-byte+ Authorization header |
| **Revocation** | Delete from store — instant | Requires blocklist or version check |
| **Scalability** | Requires shared store (Redis) | No shared state needed |
| **Cross-domain** | Hard (cookies scoped to domain) | Easy (Authorization header) |
| **Data visibility** | Opaque to client | Client can decode payload |
| **XSS impact** | Session ID theft (if httpOnly: mitigated) | Token theft (if in localStorage: game over) |
| **Replay attacks** | Session ID is a reference — server controls validity | Token is self-contained — valid until expiry |
| **Best for** | Traditional web apps, apps needing instant revocation | Microservices, cross-domain, API-first |

### Sliding Window Expiration

```typescript
// Sliding window: session expiry resets on every request
// The user stays logged in as long as they're active

// In express-session with Redis:
// - `rolling: true` resets the cookie maxAge on every response
// - Redis TTL is updated on every request (via `touch`)

import express from 'express';
import session from 'express-session';

const app = express();
app.use(session({
  secret: 'secret',
  resave: false,
  saveUninitialized: false,
  rolling: true,  // ← reset expiry on every response
  cookie: {
    maxAge: 30 * 60 * 1000, // 30 minutes of INACTIVITY
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// With rolling: true:
// - User makes request at T+0: cookie expires at T+30min
// - User makes request at T+10min: cookie expires at T+40min
// - User goes inactive: session expires 30 min after last request
```

### Concurrent Session Limits

```typescript
// run: npx tsx concurrent-sessions.ts
// Limiting users to N active sessions (e.g., 3 devices)

// In Redis, maintain a sorted set per user:
// Key: `user_sessions:user_42`
// Members: session IDs, scored by creation timestamp

import { randomBytes } from 'node:crypto';

const MAX_SESSIONS = 3;

// Simulated Redis sorted set
const userSessions = new Map<string, Array<{ sessionId: string; createdAt: number }>>();

function createSession(userId: string): string {
  const sessionId = randomBytes(32).toString('hex');
  const sessions = userSessions.get(userId) ?? [];

  sessions.push({ sessionId, createdAt: Date.now() });

  // If over limit, evict the oldest session
  if (sessions.length > MAX_SESSIONS) {
    sessions.sort((a, b) => a.createdAt - b.createdAt);
    const evicted = sessions.shift()!;
    console.log(`Evicted oldest session ${evicted.sessionId.slice(0, 8)}... for ${userId}`);
    // In production: also delete from session store
    // await redis.del(`sess:${evicted.sessionId}`);
  }

  userSessions.set(userId, sessions);
  return sessionId;
}

// Demo: create 4 sessions for one user
const s1 = createSession('user_42');
const s2 = createSession('user_42');
const s3 = createSession('user_42');
const s4 = createSession('user_42'); // evicts s1

console.log('Active sessions:', userSessions.get('user_42')?.length); // 3
```

### Session Invalidation on Password Change

```typescript
// When a user changes their password, invalidate ALL their sessions
// except the current one (so they stay logged in on this device)

async function changePassword(
  userId: string,
  currentSessionId: string,
  newPasswordHash: string,
): Promise<void> {
  // 1. Update password in database
  // await db.users.update(userId, { passwordHash: newPasswordHash });

  // 2. Get all sessions for this user from Redis
  // const sessionKeys = await redis.keys(`sess:*`);
  // For each key, check if the session belongs to this user
  // and delete it — EXCEPT the current session

  // Better approach: maintain a user→sessions index (sorted set)
  // await redis.smembers(`user_sessions:${userId}`)
  //   .then(sessionIds => sessionIds
  //     .filter(id => id !== currentSessionId)
  //     .map(id => redis.del(`sess:${id}`))
  //   );

  // 3. Regenerate the current session ID (defense in depth)
  // req.session.regenerate(...)

  console.log(`Password changed for ${userId}. All other sessions invalidated.`);
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Session fixation after OAuth login.** You implement OAuth, and after the callback, you set `req.session.userId = googleUser.sub` without calling `req.session.regenerate()`. If the attacker set a session cookie on the victim's browser before the login flow (e.g., via a link to your site), they have the same session ID. After the victim logs in, the attacker's cookie gives them full access. Always regenerate the session ID at every authentication state transition.

**2. `connect.sid` as the default cookie name.** The default `express-session` cookie name immediately reveals your tech stack to attackers. Change it with the `name` option: `name: 'sid'` or `name: '__Host-sid'` (the `__Host-` prefix enforces Secure + Path=/ + no Domain, per browser spec). This is defense in depth, not security through obscurity.

**3. In-memory session store in production with multiple instances.** You deploy to Kubernetes with 3 replicas. User logs in and gets a session on pod A. Next request hits pod B (no sticky sessions). Session not found. User is logged out. Symptom: random logouts under load, especially after deployments. Fix: use Redis as the session store, or configure sticky sessions at the load balancer (less desirable — uneven load distribution).

**4. Missing `saveUninitialized: false`.** With the default `saveUninitialized: true`, `express-session` creates a session for every single request — even unauthenticated ones, health checks, and bot crawlers. This floods Redis with empty sessions, wastes memory, and can cause Redis OOM events. Always set `saveUninitialized: false` and `resave: false`.
:::

## 🎯 Checkpoint

::: details Question 1 — SameSite and OAuth
**Q:** You set `SameSite=Strict` on your session cookie. Users report that logging in via Google OAuth always fails — they end up on the callback page without a session. What's happening and how do you fix it?

**A:** When Google redirects the user back to your callback URL, it's a **cross-site navigation** — the request originates from `accounts.google.com`. With `SameSite=Strict`, the browser refuses to send cookies on any cross-site request, including top-level navigations. Your callback handler receives the request without the session cookie, so it can't find the PKCE code verifier or state parameter stored in the session.

Fix: use `SameSite=Lax` instead of `Strict` for the session cookie. Lax allows cookies on top-level GET navigations (like the OAuth redirect) but blocks them on cross-origin POST requests and subresource loads (iframes, images). This preserves CSRF protection for the dangerous cases while allowing OAuth flows to work. If you need Strict-level protection, store the PKCE state in a separate Lax cookie instead of the session.
:::

::: details Question 2 — Session vs JWT for revocation
**Q:** Your application has a "log out of all devices" feature. Compare the implementation complexity of this feature with server-side sessions vs stateless JWTs.

**A:** **Sessions:** trivially simple. Maintain a per-user index of session IDs (e.g., a Redis set `user_sessions:user_42`). On "logout all," iterate the set and delete each session key from the store. Cost: O(N) Redis DEL commands where N is the number of active sessions (typically < 10). Immediate effect — the next request with any of those session IDs gets a 401.

**JWTs:** significantly harder. Stateless JWTs can't be individually invalidated. Options: (1) Store a `tokenVersion` per user in the database, increment it, and check it on every request — this adds a DB read to every request, largely negating the "stateless" benefit. (2) Maintain a Redis blocklist of revoked `jti` values with TTL equal to the token's remaining lifetime — this is essentially reinventing server-side sessions for the revocation case. (3) Wait for all access tokens to expire (up to 15 minutes of continued access after "logout all"). None of these are as clean as the session approach.

This is the core trade-off: sessions make revocation trivial at the cost of requiring a shared store. JWTs make verification cheap at the cost of making revocation expensive.
:::

::: details Question 3 — CSRF and APIs
**Q:** Your REST API only accepts `Content-Type: application/json`. A colleague argues this makes CSRF protection unnecessary because HTML forms can't submit JSON. Is this safe?

**A:** It's **mostly** safe but not bulletproof. HTML forms can only submit `application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`. They cannot set `Content-Type: application/json`, so a cross-origin form submission would be rejected by your server's body parser.

However, this relies on your server **strictly rejecting** non-JSON content types on all endpoints. If any middleware or framework auto-negotiates content types, or if a developer adds a URL-encoded endpoint without CSRF protection, the defense breaks. Additionally, if CORS is misconfigured (e.g., `Access-Control-Allow-Origin: *` with `credentials: true` — which browsers actually block, but bugs happen), `fetch()` from an attacker page could send JSON cross-origin.

Best practice: treat content-type checking as defense in depth, not a replacement for CSRF tokens. Use `SameSite=Lax` cookies as the primary defense, and add synchronizer tokens for critical state-changing operations (password change, money transfer).
:::

## Key Mental Models

- **Sessions are references; JWTs are values.** A session ID is a pointer to server-side state — the server has full control. A JWT carries its own claims — once issued, the server has limited control.
- **Cookie attributes are your security surface.** `HttpOnly` blocks XSS cookie theft, `Secure` blocks MITM, `SameSite` blocks CSRF. Omitting any one opens a specific attack vector.
- **Regenerate the session ID on every auth state change.** Login, logout, privilege escalation — any transition is a session fixation opportunity.
- **`SameSite=Lax` is the right default.** Strict breaks OAuth redirects. None is effectively no protection. Lax blocks cross-origin POST while allowing navigation.
- **Sessions don't scale themselves — Redis does.** The moment you have more than one server instance, sessions need a shared store. Redis is the standard answer.

## Related

- [JWT: Access Tokens, Refresh Tokens & Rotation](./01-jwt-tokens) — the stateless alternative
- [OAuth 2.0 & Social Login](./02-oauth) — session creation after the OAuth flow
- [RBAC, ABAC & Authorization Patterns](./04-rbac-authorization) — what you check after authenticating
- [Caching (Redis)](/system-design/caching/) — the infrastructure behind session stores
