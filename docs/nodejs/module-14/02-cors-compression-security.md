---
title: "CORS, Compression & Security Headers"
outline: deep
---

# CORS, Compression & Security Headers

Interview weight: 🔥🔥🔥 | Node 22+ | Prerequisites: [HTTP, Keep-Alive & Pooling](/nodejs/module-05/02-http-keep-alive), [HTTP Hardening](/nodejs/module-08/04-http-hardening)

## 🗣️ In Plain English

::: tip In Plain English
Think of your API server as an office building. Three separate security systems protect it, each solving a different problem.

**CORS** is the visitor badge system. When someone from a different company (a different website's JavaScript) wants to enter your building, the front desk calls your office first: "Company X wants to send a delivery — do you accept deliveries from them?" If you say yes, the visitor gets a badge. If you say no, the delivery is turned away at the lobby. The browser is the front desk — it enforces the rules, not your server. Your server just posts the guest list.

**Compression** is the mail room. Before sending a thick envelope out, the mail room runs it through a compactor that shrinks the contents. The recipient has a matching expander. Smaller packages travel faster across the network. But you would not compress a letter that is already one page — the compacting machine takes longer to run than the time you would save. And you definitely would not compress a live audio feed, because the recipient needs each word the moment it is spoken, not in one compressed batch at the end.

**Security headers** are the building's structural defenses — reinforced doors, locks on the ventilation shafts, cameras. They tell the browser "do not let anyone embed my pages in a frame" (preventing clickjacking), "only load scripts from these approved domains" (preventing XSS), and "always use the encrypted entrance" (HSTS). Each header closes one specific attack vector. Without them, the building is technically functional but trivially breakable.
:::

## ⚙️ Under the Hood

### CORS: Cross-Origin Resource Sharing

CORS is a browser-enforced security policy. Servers declare which origins may access their resources; browsers enforce the declaration. Server-to-server requests are unaffected — CORS is purely a browser concept.

**The same-origin policy** blocks JavaScript on `https://app.example.com` from reading responses from `https://api.example.com` — different origins (scheme + host + port). CORS relaxes this selectively.

#### Simple vs Preflighted Requests

A request is "simple" (no preflight) if it uses GET/HEAD/POST with only CORS-safelisted headers and `Content-Type` is `application/x-www-form-urlencoded`, `multipart/form-data`, or `text/plain`. Everything else triggers a preflight.

```typescript
// run: npx tsx cors-demo.ts
import express from 'express';
import cors from 'cors';

const app = express();

// Permissive: allow all origins (development only)
// Sets Access-Control-Allow-Origin: *
app.use(cors());

// Production: explicit origin list
const allowedOrigins = [
  'https://app.example.com',
  'https://staging.example.com',
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, curl, mobile apps)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'X-RateLimit-Remaining'],
    credentials: true, // Allow cookies/auth headers
    maxAge: 86400, // Cache preflight for 24h
  }),
);

app.get('/api/data', (_req, res) => {
  res.json({ message: 'CORS-protected response' });
});

app.listen(3000, () => console.log('Listening on :3000'));
```

#### Why Wildcard Breaks with Credentials

The CORS spec forbids `Access-Control-Allow-Origin: *` when `credentials: true`. The browser rejects the response. This is by design — a wildcard with credentials would let *any* site make authenticated requests on behalf of the user, defeating the purpose of the same-origin policy. You must echo the specific requesting origin.

#### Preflight Flow (OPTIONS)

```
Browser → OPTIONS /api/resource
  Origin: https://app.example.com
  Access-Control-Request-Method: PUT
  Access-Control-Request-Headers: Content-Type, Authorization

Server → 204 No Content
  Access-Control-Allow-Origin: https://app.example.com
  Access-Control-Allow-Methods: GET, PUT, DELETE
  Access-Control-Allow-Headers: Content-Type, Authorization
  Access-Control-Max-Age: 86400

Browser → PUT /api/resource  (actual request, only if preflight succeeded)
```

The `Max-Age` header is critical for performance — without it, every non-simple request requires two round trips. Chrome caps this at 2 hours; Firefox at 24 hours.

### Compression Middleware

```typescript
// run: npx tsx compression-demo.ts
import express from 'express';
import compression from 'compression';

const app = express();

app.use(
  compression({
    // Only compress responses larger than 1KB
    threshold: 1024,

    // Brotli preferred over gzip (better ratio, slightly slower)
    // Node 22 supports brotli natively via node:zlib
    // The compression package uses zlib under the hood

    // Filter: skip compression for certain content types
    filter: (req, res) => {
      // Never compress SSE — it must stream frame by frame
      if (req.headers.accept === 'text/event-stream') return false;

      // Never compress already-compressed formats
      const contentType = res.getHeader('Content-Type') as string | undefined;
      if (contentType?.match(/image\/(png|jpeg|webp|gif)|video|audio|\.zip|\.gz/)) {
        return false;
      }

      // Use default filter for everything else
      return compression.filter(req, res);
    },

    // Compression level: 1 (fastest, least compression) to 9 (slowest, best)
    // Level 6 is a good default; level 1 for real-time APIs where latency matters
    level: 6,
  }),
);

app.get('/api/large-payload', (_req, res) => {
  const data = Array.from({ length: 10000 }, (_, i) => ({
    id: i,
    name: `Item ${i}`,
    description: 'A repeated string that compresses very well',
  }));
  res.json(data);
  // Without compression: ~750KB
  // With gzip level 6: ~15KB (95% reduction for repetitive JSON)
});

app.listen(3000);
```

**When NOT to compress:**
- **SSE / streaming responses**: Compression buffers output. A compressed SSE stream delivers nothing until the buffer fills or the connection closes — defeating the purpose of streaming. Set `proxy_buffering off` in nginx and skip compression middleware for SSE routes.
- **Already-compressed assets**: PNG, JPEG, WebP, MP4, ZIP, gzip — compressing them again wastes CPU and may increase size.
- **Small responses** (< 1KB): The compression header overhead and CPU cost exceed the bandwidth savings.
- **High-throughput, low-latency APIs**: At 50K+ rps, compression CPU can become the bottleneck before network bandwidth does. Benchmark before enabling.

### Security Headers with Helmet.js

Helmet sets HTTP response headers that instruct browsers to activate built-in security mechanisms.

```typescript
// run: npx tsx helmet-demo.ts
import express from 'express';
import helmet from 'helmet';

const app = express();

// Helmet with production configuration
app.use(
  helmet({
    // Content-Security-Policy: restricts where the browser can load resources from
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.example.com'],
        styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline needed for many CSS-in-JS libs
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.example.com', 'wss://ws.example.com'],
        fontSrc: ["'self'", 'https://fonts.googleapis.com'],
        objectSrc: ["'none'"],       // Block <object>, <embed>, <applet>
        frameAncestors: ["'none'"],  // Equivalent to X-Frame-Options: DENY
        upgradeInsecureRequests: [], // Auto-upgrade http:// to https://
      },
    },

    // Strict-Transport-Security: force HTTPS for this domain
    // max-age=31536000 (1 year), includeSubDomains, preload
    strictTransportSecurity: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },

    // X-Content-Type-Options: nosniff
    // Prevents the browser from MIME-sniffing a response away from the declared Content-Type
    // Without this: browser might execute a .txt file as JavaScript if it looks like JS
    xContentTypeOptions: true, // enabled by default

    // X-Frame-Options: DENY (legacy; CSP frame-ancestors supersedes this)
    // Prevents your page from being embedded in an iframe (clickjacking protection)
    frameguard: { action: 'deny' },

    // Referrer-Policy: strict-origin-when-cross-origin
    // Controls how much referrer information is sent with requests
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },

    // X-DNS-Prefetch-Control: off
    // Prevents browsers from doing DNS prefetching (minor privacy measure)
    dnsPrefetchControl: { allow: false },

    // Permissions-Policy (formerly Feature-Policy)
    // Disable browser features you don't use
    // Not directly in helmet — use helmet.permittedCrossDomainPolicies or set manually
  }),
);

// Manual Permissions-Policy header
app.use((_req, res, next) => {
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  next();
});

app.get('/api/secure', (_req, res) => {
  res.json({ secure: true });
});

app.listen(3000);
```

#### Header-by-Header Breakdown

| Header | Prevents | What happens without it |
|---|---|---|
| `Content-Security-Policy` | XSS, data injection | Browser loads scripts/styles from anywhere |
| `Strict-Transport-Security` | SSL stripping, downgrade attacks | First visit can be intercepted over HTTP |
| `X-Content-Type-Options: nosniff` | MIME confusion attacks | Browser guesses Content-Type, may execute data as code |
| `X-Frame-Options: DENY` | Clickjacking | Your page can be embedded in attacker's iframe |
| `Referrer-Policy` | URL/query leaks to third parties | Full URL (with tokens) sent in Referer header |
| `Permissions-Policy` | Unauthorized feature access | Embedded content can access camera/mic/location |

### Content-Type Sniffing Attack

Without `X-Content-Type-Options: nosniff`, a browser may "sniff" the content of a response and override the declared `Content-Type`. An attacker uploads a file named `avatar.jpg` that actually contains `<script>alert('xss')</script>`. If the browser sniffs it as HTML/JS instead of trusting the `image/jpeg` Content-Type, the script executes. The `nosniff` header forces the browser to trust the server's Content-Type declaration.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. CORS credentials + wildcard = silent rejection.**
You set `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Credentials: true`. The browser silently blocks the response — no error in the network tab, just a CORS error in the console. Symptom: authenticated API calls fail from the frontend but work perfectly from Postman/curl (which ignores CORS). Fix: echo the specific `Origin` header value instead of `*`.

**2. Missing preflight caching destroys latency.**
Without `Access-Control-Max-Age`, every PUT/PATCH/DELETE requires an OPTIONS round trip first — doubling your perceived latency. On mobile networks with 200ms RTT, this means 400ms before the actual request even starts. Set `maxAge` to at least 3600 (1 hour).

**3. Compression + SSE = frozen stream.**
You enable `compression()` globally, then add an SSE endpoint. The compression middleware buffers the entire response, so the client receives nothing until the connection closes or the buffer fills (typically 16KB). Symptom: SSE clients show no events for minutes, then receive a burst. Fix: filter SSE routes out of compression (check `Accept: text/event-stream`), or set `Content-Encoding: identity` on the SSE response.

**4. CSP blocks legitimate resources in production.**
You deploy a strict CSP in production. Third-party analytics, error tracking (Sentry), or a CDN-served font suddenly stops loading. The browser blocks it and logs a CSP violation report. Symptom: partial page rendering, missing styles/fonts, broken tracking. Fix: start with `Content-Security-Policy-Report-Only` to collect violations without blocking, then tighten the policy iteratively.
:::

## 🎯 Checkpoint

::: details Question 1 — Preflight trigger conditions
**Q:** A frontend makes a `POST` request with `Content-Type: application/json` and an `Authorization` header to a cross-origin API. Will the browser send a preflight? Why?

**A:** Yes, the browser sends a preflight (OPTIONS). Two conditions trigger it: (1) `Content-Type: application/json` is not in the CORS-safelisted set (`application/x-www-form-urlencoded`, `multipart/form-data`, `text/plain`), and (2) the `Authorization` header is not a CORS-safelisted request header. Either condition alone would trigger a preflight. The browser sends `OPTIONS` with `Access-Control-Request-Method: POST` and `Access-Control-Request-Headers: content-type, authorization`. The server must respond with appropriate `Access-Control-Allow-*` headers for the actual POST to proceed.
:::

::: details Question 2 — Compression and CPU trade-off
**Q:** Your API serves 50K requests/second with an average response size of 500 bytes. Should you enable gzip compression? What about for 2K rps with 200KB average responses?

**A:** For 50K rps / 500 bytes: **No.** The responses are below the typical compression threshold (1KB). The CPU cost of compressing 50K tiny payloads per second is substantial, while the bandwidth savings are negligible (500 bytes might compress to 400 bytes — saving 5MB/s but costing significant CPU). For 2K rps / 200KB: **Yes.** Each response compresses well (JSON typically achieves 85-95% reduction), saving ~340MB/s of bandwidth. At 2K rps the CPU cost is manageable. The rule: compress when response size is large relative to CPU budget, not when throughput is high and payloads are small.
:::

::: details Question 3 — HSTS preload consequences
**Q:** What happens if you set HSTS with `preload: true` and then need to serve your domain over HTTP? How do you recover?

**A:** HSTS with preload means your domain is submitted to the HSTS preload list, which is hardcoded into browsers (Chrome, Firefox, Safari, Edge). Once preloaded, browsers will *never* connect to your domain over HTTP — they upgrade to HTTPS before the request leaves the browser, without even checking for a server response. If you need to revert to HTTP: (1) Remove the `preload` directive and set `max-age: 0` to clear the HSTS policy for returning visitors, (2) Submit a removal request to hstspreload.org, (3) Wait for the next browser release cycle (weeks to months) for the removal to propagate. During this waiting period, users with the preloaded list cannot access your site over HTTP. This is why `preload` should only be enabled when you are certain HTTPS is permanent.
:::

## Key Mental Models

- **CORS is a browser policy, not a server defense.** curl and server-to-server calls bypass it entirely. CORS protects the *user's browser* from malicious JavaScript on other origins.
- **Preflight is the negotiation; the actual request is the delivery.** Cache preflight responses aggressively to avoid doubling round trips.
- **Compress large text, never compress streams or tiny payloads.** The break-even point is roughly 1KB response / low-to-moderate throughput.
- **Security headers are defense in depth.** Each one closes a specific attack vector. None of them replace input validation or authentication — they are complementary browser-side protections.
- **CSP in report-only mode first.** Deploy `Content-Security-Policy-Report-Only` before enforcing, or you will break production assets.

## Related

- [HTTP Hardening & LLM Threats](/nodejs/module-08/04-http-hardening) — server-side HTTP security (body limits, decompression bombs)
- [SSE & LLM Streaming](/nodejs/module-04/04-sse-streaming) — why compression must be disabled for streaming
- [The Middleware Stack](/frameworks/express/01-middleware-stack) — how Express processes middleware ordering
