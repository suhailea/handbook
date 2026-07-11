---
title: "OAuth 2.0 & Social Login"
outline: deep
---

# OAuth 2.0 & Social Login

> **Interview weight:** 🔥🔥🔥 — OAuth flows, PKCE, and the difference between OAuth and OIDC are standard senior-level questions.
> **Node version:** All examples target Node 22+ with native `fetch` and `crypto`.
> **Prereqs:** [JWT: Access Tokens & Refresh Tokens](./01-jwt-tokens) · [HTTP Internals](/nodejs/module-05/)

## 🗣️ In Plain English

::: tip In Plain English
You want to let users log in to your app with their Google account. But you absolutely do not want to handle their Google password — that's Google's job. OAuth is the protocol that makes this delegation work.

Think of it like a **valet key for a car**. You're at a hotel and the valet needs to park your car. You don't hand them your house keys, your office keys, and your car key all on one ring. Instead, you give them a **valet key** — a special key that can start the engine and drive, but can't open the trunk or the glove compartment. OAuth works the same way: the user tells Google "give this app a valet key that lets it read my name and email, but nothing else."

Here's how the handshake works, in human terms:

1. Your app says to the user: "Go talk to Google and tell them you trust me."
2. The user goes to Google, logs in, and sees a screen: "This app wants to read your name and email. Allow?"
3. The user clicks Allow. Google gives the user a **one-time code** (like a claim ticket at a coat check).
4. The user brings that code back to your app.
5. Your app takes that code directly to Google's back office (server-to-server, the user never sees this) and exchanges it for the valet key (an access token).
6. Your app uses the valet key to ask Google: "What's this user's name and email?"

Why the detour with the code instead of giving the valet key directly to the user? Because the user's browser is not a secure place — anyone watching the URL bar could grab a token. The code is useless without your app's secret, which never leaves your server. That's the core security insight of the Authorization Code flow.

**PKCE** adds one more layer: before step 1, your app generates a random secret and sends a hashed version of it to Google. In step 5, your app proves it's the same app by revealing the original secret. This prevents anyone who intercepted the code from using it — they don't have the original secret. PKCE was invented for mobile apps that can't safely store a client secret, but it's now recommended for all apps.
:::

## ⚙️ Under the Hood

### OAuth 2.0 Grant Types

| Flow | Use Case | Client Secret Required? | PKCE? |
|---|---|---|---|
| **Authorization Code + PKCE** | Web apps, SPAs, mobile apps | Optional (recommended for web) | Yes |
| **Client Credentials** | Service-to-service (no user) | Yes | No |
| **Device Authorization** | CLI tools, TVs, IoT | No (displays code for user) | No |
| ~~Implicit~~ | ~~SPAs (deprecated)~~ | No | No |

**Why Implicit is deprecated:** it returns the access token directly in the URL fragment (`#access_token=...`). This is visible in browser history, referrer headers, and proxy logs. Authorization Code + PKCE is strictly better — it keeps the token off the URL.

### Authorization Code + PKCE: Step by Step

```
┌──────────┐     ┌──────────┐     ┌────────────────┐
│  Browser │     │ Your App │     │ Auth Provider  │
│ (Client) │     │ (Server) │     │ (Google/GitHub)│
└────┬─────┘     └────┬─────┘     └───────┬────────┘
     │                │                    │
     │ 1. Click       │                    │
     │ "Login with    │                    │
     │  Google"       │                    │
     │───────────────>│                    │
     │                │                    │
     │                │ 2. Generate:       │
     │                │ code_verifier      │
     │                │ (random 43-128ch)  │
     │                │ code_challenge =   │
     │                │ SHA256(verifier)   │
     │                │ state = random     │
     │                │ Store verifier +   │
     │                │ state in session   │
     │                │                    │
     │ 3. 302 Redirect to:                │
     │ auth.google.com/authorize?          │
     │   response_type=code&               │
     │   client_id=YOUR_ID&                │
     │   redirect_uri=YOUR_CALLBACK&       │
     │   scope=openid email profile&       │
     │   state=RANDOM&                     │
     │   code_challenge=HASH&              │
     │   code_challenge_method=S256        │
     │<───────────────│                    │
     │                                     │
     │ 4. User logs in, consents           │
     │────────────────────────────────────>│
     │                                     │
     │ 5. 302 Redirect to:                │
     │ YOUR_CALLBACK?code=AUTH_CODE&state=RANDOM
     │<────────────────────────────────────│
     │                                     │
     │ 6. Forward code + state             │
     │───────────────>│                    │
     │                │                    │
     │                │ 7. Verify state    │
     │                │ matches session    │
     │                │                    │
     │                │ 8. POST /token     │
     │                │ {code, verifier,   │
     │                │  client_id,        │
     │                │  client_secret,    │
     │                │  redirect_uri}     │
     │                │───────────────────>│
     │                │                    │
     │                │ 9. Returns:        │
     │                │ {access_token,     │
     │                │  id_token,         │
     │                │  refresh_token}    │
     │                │<───────────────────│
     │                │                    │
     │                │ 10. Verify         │
     │                │ id_token (JWT)     │
     │                │ Extract user info  │
     │                │ Create session     │
     │                │                    │
     │ 11. Set cookie │                    │
     │<───────────────│                    │
```

### PKCE Implementation

```typescript
// run: npx tsx pkce-demo.ts
import { createHash, randomBytes } from 'node:crypto';

// Step 1: Generate code_verifier (43-128 characters, URL-safe)
function generateCodeVerifier(): string {
  // 32 bytes → 43 base64url characters
  return randomBytes(32)
    .toString('base64url');
}

// Step 2: Derive code_challenge = BASE64URL(SHA256(code_verifier))
function generateCodeChallenge(verifier: string): string {
  return createHash('sha256')
    .update(verifier)
    .digest('base64url');
}

const codeVerifier = generateCodeVerifier();
const codeChallenge = generateCodeChallenge(codeVerifier);

console.log('code_verifier:', codeVerifier);      // sent in token exchange (step 8)
console.log('code_challenge:', codeChallenge);     // sent in authorize URL (step 3)
console.log('verifier length:', codeVerifier.length); // 43

// Why this works:
// - The authorization request sends the HASH (code_challenge)
// - The token exchange sends the ORIGINAL (code_verifier)
// - The auth server hashes the verifier and compares to the stored challenge
// - An attacker who intercepted the authorization code does NOT have the verifier
// - They can't reverse SHA-256 to get the verifier from the challenge
```

### Full OAuth Login Flow in Node.js

```typescript
// run: npx tsx oauth-server.ts
// Requires: npm install jose
// Set environment: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { URL, URLSearchParams } from 'node:url';
import { jwtVerify, createRemoteJWKSet } from 'jose';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'your-client-id';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? 'your-client-secret';
const REDIRECT_URI = 'http://localhost:3200/callback';

// In production, use Redis or encrypted session cookies
const sessions = new Map<string, {
  codeVerifier: string;
  state: string;
  user?: { sub: string; email: string; name: string };
}>();

// Google's JWKS for verifying ID tokens
const googleJWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

  // ── Step 1: Initiate login ──
  if (url.pathname === '/login') {
    const sessionId = randomBytes(16).toString('hex');
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const state = randomBytes(16).toString('hex');

    sessions.set(sessionId, { codeVerifier, state });

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('scope', 'openid email profile');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('nonce', randomBytes(16).toString('hex'));

    // Set session cookie so we can retrieve the verifier later
    res.writeHead(302, {
      'Location': authUrl.toString(),
      'Set-Cookie': `sid=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    });
    res.end();
    return;
  }

  // ── Step 5-10: Handle callback ──
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');

    // Extract session ID from cookie
    const cookies = (req.headers.cookie ?? '').split(';').reduce<Record<string, string>>(
      (acc, c) => {
        const [k, v] = c.trim().split('=');
        if (k && v) acc[k] = v;
        return acc;
      }, {},
    );

    const session = sessions.get(cookies.sid ?? '');
    if (!session) {
      res.writeHead(400).end('No session found');
      return;
    }

    // Verify state parameter (CSRF protection)
    if (returnedState !== session.state) {
      res.writeHead(400).end('State mismatch — possible CSRF attack');
      return;
    }

    // Exchange code for tokens (server-to-server)
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code ?? '',
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: session.codeVerifier, // PKCE: prove we initiated this flow
      }).toString(),
    });

    const tokens = await tokenResponse.json() as {
      access_token: string;
      id_token: string;
      refresh_token?: string;
    };

    // Verify ID token (OIDC layer — this is a JWT)
    const { payload } = await jwtVerify(tokens.id_token, googleJWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: CLIENT_ID,
    });

    // Extract user info from verified ID token
    session.user = {
      sub: payload.sub as string,
      email: payload.email as string,
      name: payload.name as string,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Logged in', user: session.user }));
    return;
  }

  res.writeHead(404).end('Not found');
});

server.listen(3200, () => {
  console.log('OAuth demo: http://localhost:3200/login');
});
```

### OpenID Connect (OIDC): Identity on Top of OAuth

OAuth 2.0 is an **authorization** protocol — it tells you what the user allowed, not *who the user is*. OIDC adds an identity layer:

| OAuth 2.0 Alone | With OIDC |
|---|---|
| Returns `access_token` only | Also returns `id_token` (a JWT) |
| Must call `/userinfo` to learn who the user is | User identity is in the `id_token` claims |
| No standard user claims | Standardized claims: `sub`, `email`, `name`, `picture` |
| `scope=read write` | `scope=openid email profile` |

The `id_token` is a JWT signed by the provider. You verify it the same way as any JWT (signature + `iss` + `aud` + `exp`). Key claims:

- `sub` — stable user identifier (don't use `email` as primary key — users can change emails)
- `nonce` — binds the token to your authentication request (replay protection)
- `at_hash` — hash of the access token (ensures the tokens were issued together)

### Client Credentials Flow (Service-to-Service)

```typescript
// run: npx tsx client-credentials.ts
// For service-to-service auth — no user involved

async function getServiceToken(): Promise<string> {
  const response = await fetch('https://auth.example.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.SERVICE_CLIENT_ID ?? 'billing-service',
      client_secret: process.env.SERVICE_CLIENT_SECRET ?? 'secret',
      scope: 'orders:read invoices:write',
    }).toString(),
  });

  const data = await response.json() as { access_token: string; expires_in: number };
  return data.access_token;
}

// Cache the token and refresh before expiry
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

async function getOrRefreshToken(): Promise<string> {
  const now = Date.now();
  // Refresh 60 seconds before actual expiry to avoid edge-case failures
  if (cachedToken && now < tokenExpiresAt - 60_000) {
    return cachedToken;
  }

  const response = await fetch('https://auth.example.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'billing-service',
      client_secret: 'secret',
      scope: 'orders:read',
    }).toString(),
  });

  const data = await response.json() as { access_token: string; expires_in: number };
  cachedToken = data.access_token;
  tokenExpiresAt = now + data.expires_in * 1000;
  return cachedToken;
}
```

### Device Authorization Flow (CLI/TV)

```typescript
// run: npx tsx device-flow.ts
// For devices without a browser or with limited input (CLI tools, smart TVs)

async function deviceLogin(): Promise<void> {
  // Step 1: Request a device code
  const deviceResponse = await fetch('https://auth.example.com/oauth/device/code', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'cli-tool',
      scope: 'openid profile',
    }).toString(),
  });

  const device = await deviceResponse.json() as {
    device_code: string;
    user_code: string;       // e.g., "WDJB-MJHT"
    verification_uri: string; // e.g., "https://auth.example.com/device"
    interval: number;         // polling interval in seconds
    expires_in: number;
  };

  // Step 2: Show the user code — they enter it on their phone/computer
  console.log(`\nOpen: ${device.verification_uri}`);
  console.log(`Enter code: ${device.user_code}\n`);

  // Step 3: Poll until the user completes authorization
  const deadline = Date.now() + device.expires_in * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, device.interval * 1000));

    const tokenResponse = await fetch('https://auth.example.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: device.device_code,
        client_id: 'cli-tool',
      }).toString(),
    });

    if (tokenResponse.ok) {
      const tokens = await tokenResponse.json() as { access_token: string };
      console.log('Authenticated! Token:', tokens.access_token.slice(0, 20) + '...');
      return;
    }

    const error = await tokenResponse.json() as { error: string };
    if (error.error === 'authorization_pending') continue;
    if (error.error === 'slow_down') {
      // Increase polling interval
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }
    throw new Error(`Device flow error: ${error.error}`);
  }

  throw new Error('Device authorization timed out');
}
```

### Passport.js vs Building Your Own

| Factor | Passport.js | Custom Implementation |
|---|---|---|
| **Time to market** | Fast — strategies for 500+ providers | Slower — write each provider flow |
| **Abstraction level** | High — hides OAuth details | Low — you see every HTTP call |
| **Session coupling** | Tightly coupled to `express-session` | You choose session strategy |
| **Type safety** | Poor (written pre-TypeScript, callbacks) | Full control |
| **Debugging** | Hard — magic in `serializeUser`/`deserializeUser` | Transparent |
| **Recommendation** | Quick prototypes, many providers | Production apps, when you need control |

For a senior engineer: understand the protocol first (which this page teaches), then decide whether Passport saves you time or hides bugs. In NestJS, `@nestjs/passport` wraps Passport with decorators but inherits its session model.

### Security Checklist for OAuth

1. **Always use PKCE** — even for server-side apps. It's defense in depth.
2. **Validate the `state` parameter** — it prevents CSRF. Generate it randomly, store it in the session, compare on callback.
3. **Validate `redirect_uri` exactly** — the auth server should reject URLs not in your registered list. Never use wildcard redirects.
4. **Verify the `nonce` in the ID token** — prevents token replay attacks.
5. **Use `sub` as the user identifier**, not `email` — emails can change; `sub` is stable per provider.
6. **Exchange the code server-side** — never expose `client_secret` to the browser.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Open redirect via unvalidated `redirect_uri`.** If your auth server accepts arbitrary redirect URIs (or does prefix matching like `https://app.com.evil.com`), an attacker can intercept the authorization code by redirecting the callback to their server. Always use exact-match validation for registered redirect URIs. No wildcard subdomains. No path prefixes.

**2. CSRF via missing `state` parameter.** Without `state`, an attacker can initiate an OAuth flow with their own account and trick a victim into completing it — linking the attacker's social account to the victim's session. The victim's app is now connected to the attacker's Google account. Always generate a random `state`, store it in the session, and reject callbacks where `state` doesn't match.

**3. Token leakage through referrer headers.** After the OAuth callback, if your page loads external resources (images, scripts), the browser sends the full URL — including the `code` parameter — in the `Referer` header. Mitigate: redirect away from the callback URL immediately after extracting the code, and set `Referrer-Policy: no-referrer` on the callback response.

**4. Race condition in code exchange.** Authorization codes are one-time-use. If your server crashes between receiving the code and exchanging it (or if a retry mechanism sends the exchange request twice), the auth server rejects the second attempt, and the user sees an error. Handle this gracefully — show "please try logging in again" instead of a 500.
:::

## 🎯 Checkpoint

::: details Question 1 — Why PKCE matters
**Q:** A colleague argues that PKCE is unnecessary for server-rendered web apps because the `client_secret` already proves the app's identity during the token exchange. Is this correct? When does PKCE add security even for server-side apps?

**A:** The colleague is partially right — `client_secret` does authenticate the app. But PKCE protects against a different attack vector: **authorization code interception**. If an attacker intercepts the authorization code (via a compromised TLS-terminating proxy, browser extension, or open redirect), they still can't exchange it without the `code_verifier`, which never left the server's memory. The `client_secret` alone doesn't help here because the attacker could have also obtained it (e.g., from a leaked environment variable or a compromised CI pipeline). PKCE provides **per-session proof** of intent — even with a stolen secret, the attacker needs the verifier for that specific flow. This is why the OAuth 2.1 draft makes PKCE mandatory for all clients.
:::

::: details Question 2 — OAuth vs OIDC
**Q:** What does OpenID Connect add on top of OAuth 2.0? Why can't you use a plain OAuth 2.0 access token to identify a user?

**A:** OAuth 2.0 is an **authorization** framework — the access token represents a grant of permissions, not an identity. The access token is opaque to the client (it might be a random string, not a JWT), and its intended audience is the resource server, not the client app. Using it to identify the user requires calling the `/userinfo` endpoint, which adds latency and a point of failure.

OIDC adds: (1) the `id_token` — a JWT containing standardized identity claims (`sub`, `email`, `name`, `picture`) signed by the provider, verifiable without an extra HTTP call; (2) a standard `/userinfo` endpoint for fetching additional claims; (3) the `nonce` mechanism for replay protection; (4) a discovery document (`/.well-known/openid-configuration`) so clients can auto-configure endpoints.

The critical rule: use the `id_token` for authentication (who is this person?) and the `access_token` for authorization (what can they access on the resource server?). Never use the access token's contents to identify a user — it wasn't designed for that.
:::

::: details Question 3 — Client Credentials caching
**Q:** In a service-to-service Client Credentials flow, your service fetches a new token for every outgoing request. What's wrong with this approach, and how do you fix it?

**A:** Each token request is a round-trip to the auth server, adding latency (typically 50-200ms) to every outgoing call. Under load, this also hammers the auth server and can trigger rate limiting or cause cascading failures if the auth server goes down.

Fix: **cache the token in memory** with a TTL slightly shorter than `expires_in` (e.g., refresh 60 seconds before expiry). Use a single shared instance (or module-level variable) so all request handlers reuse the same token. For extra resilience, implement a **stale-while-revalidate** pattern: continue using the cached token for a grace period if the refresh request fails, and retry with exponential backoff. In a multi-instance deployment, each instance can cache independently — there's no need to share client credential tokens across instances.
:::

## Key Mental Models

- **OAuth is authorization (what can you do?), OIDC is authentication (who are you?).** OAuth alone cannot reliably tell you who logged in — you need the `id_token` from OIDC for that.
- **The authorization code is a one-time claim ticket, not a key.** It's useless without the client secret and PKCE verifier, which is exactly the point.
- **PKCE is per-session proof-of-intent.** Even if your client secret leaks, each flow is bound to a unique verifier that the attacker doesn't have.
- **`state` prevents CSRF, `nonce` prevents replay, `redirect_uri` validation prevents interception.** All three are mandatory. Skipping any one opens a distinct attack vector.
- **Use `sub` as the stable identifier, not `email`.** Emails change. Provider-issued subject identifiers don't.

## Related

- [JWT: Access Tokens, Refresh Tokens & Rotation](./01-jwt-tokens) — the token format used by OIDC
- [Session Management & Cookies](./03-sessions) — what you create after the OAuth flow completes
- [HTTP Hardening](/nodejs/module-08/) — TLS, header security, and redirect safety
