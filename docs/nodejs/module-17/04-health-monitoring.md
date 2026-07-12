---
title: Health Checks, Monitoring & Alerting
outline: deep
---

# Health Checks, Monitoring & Alerting

🔥🔥🔥 **Interview weight** | **Node 22+** | **Prereqs:** [OpenTelemetry](/nodejs/module-09/03-opentelemetry), [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you're managing a fleet of delivery trucks. You need to know two things about each truck: "Is the engine running?" (liveness) and "Is it ready to take a delivery?" (readiness). A truck with a running engine but a flat tire is *alive* but not *ready*. You don't scrap it (kill the process) — you fix the tire (wait for the dependency to recover).

Health checks are how your orchestrator (K8s) asks these questions. Liveness: "Should I restart this process?" Readiness: "Should I send traffic to this process?" Getting these wrong is dangerous — a liveness check that depends on the database will restart your app every time the database hiccups, making a bad situation worse.

Monitoring is your dashboard of gauges and warning lights. You track the metrics that matter: how many requests per second, how fast they're served, how many fail, and how hard the engine (event loop) is working. Alerting is the alarm that wakes you up when a gauge crosses a threshold — but only for things that actually need human attention.
:::

## ⚙️ Under the Hood

### Health Check Endpoints

```typescript
// run: node --experimental-strip-types health.ts
import { createServer } from 'node:http';

let isReady = false;
let isShuttingDown = false;

// Simulate dependency checks
async function checkDependencies(): Promise<{ db: boolean; redis: boolean }> {
  // In real code: ping DB and Redis with short timeouts
  return { db: true, redis: true };
}

const server = createServer(async (req, res) => {
  if (req.url === '/healthz') {
    // LIVENESS: Is the process alive and not stuck?
    // Do NOT check external dependencies here
    if (isShuttingDown) {
      res.writeHead(503).end('shutting down');
    } else {
      res.writeHead(200).end('ok');
    }
    return;
  }

  if (req.url === '/readyz') {
    // READINESS: Can this instance handle traffic?
    // Check external dependencies here
    if (isShuttingDown) {
      res.writeHead(503).end('draining');
      return;
    }
    const deps = await checkDependencies();
    const allHealthy = Object.values(deps).every(Boolean);
    res.writeHead(allHealthy ? 200 : 503);
    res.end(JSON.stringify(deps));
    return;
  }

  res.writeHead(200).end('Hello');
});

process.on('SIGTERM', () => {
  isShuttingDown = true;
  // Readiness immediately returns 503
  // Liveness stays 200 during drain period
  server.close(() => process.exit(0));
});

server.listen(3000);
isReady = true;
```

### K8s Probe Configuration

```yaml
spec:
  containers:
    - name: api
      livenessProbe:
        httpGet:
          path: /healthz
          port: 3000
        initialDelaySeconds: 10  # Wait for app to boot
        periodSeconds: 15
        failureThreshold: 3      # 3 failures → restart
        timeoutSeconds: 3
      readinessProbe:
        httpGet:
          path: /readyz
          port: 3000
        initialDelaySeconds: 5
        periodSeconds: 5
        failureThreshold: 2      # 2 failures → stop sending traffic
        timeoutSeconds: 3
```

### Prometheus Metrics with prom-client

```typescript
// run: npm install prom-client && node --experimental-strip-types metrics.ts
import { collectDefaultMetrics, Registry, Counter, Histogram, Gauge } from 'prom-client';

const register = new Registry();
collectDefaultMetrics({ register }); // CPU, memory, event loop lag, GC

// Custom metrics
const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'] as const,
  registers: [register],
});

const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

const activeConnections = new Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
  registers: [register],
});

// Middleware (Express-style)
function metricsMiddleware(req: any, res: any, next: () => void) {
  const start = performance.now();
  activeConnections.inc();

  res.on('finish', () => {
    const duration = (performance.now() - start) / 1000;
    const route = req.route?.path || req.url;
    httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode });
    httpRequestDuration.observe({ method: req.method, route }, duration);
    activeConnections.dec();
  });

  next();
}

// Expose /metrics endpoint for Prometheus scraping
// GET /metrics → register.metrics()
```

### Key Metrics to Monitor

| Metric | Why | Alert Threshold |
|--------|-----|-----------------|
| Request rate (req/s) | Baseline for anomaly detection | Sudden drop > 50% |
| Error rate (5xx/total) | Service health | > 1% sustained |
| Latency p50/p95/p99 | User experience | p99 > 2s |
| Event Loop Utilization | Node.js-specific saturation | > 0.8 |
| Heap used (MB) | Memory leak detection | > 80% of limit |
| Active handles/requests | Connection leak detection | Monotonically growing |
| Queue depth (if applicable) | Backlog buildup | > 10K or growing |

### Event Loop Utilization as a Metric

```typescript
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';

// ELU — the single best metric for Node.js health
function trackELU(register: Registry) {
  const eluGauge = new Gauge({
    name: 'nodejs_elu',
    help: 'Event loop utilization (0-1)',
    registers: [register],
  });

  let prev = performance.eventLoopUtilization();

  setInterval(() => {
    const curr = performance.eventLoopUtilization(prev);
    eluGauge.set(curr.utilization);
    prev = performance.eventLoopUtilization();
  }, 5000);
}
```

### Alerting Best Practices

1. **Alert on symptoms, not causes.** Alert on "error rate > 1%" not "database CPU > 80%."
2. **Every alert needs a runbook.** If the on-call engineer doesn't know what to do, the alert is useless.
3. **Use severity levels.** P1 (pages someone at 3 AM): data loss, full outage. P2 (Slack notification): degraded performance. P3 (ticket): non-urgent.
4. **Avoid alert fatigue.** Too many alerts = all alerts get ignored. If an alert fires daily and nobody acts on it, delete it.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
1. **Liveness checking the database:** If your liveness probe checks DB connectivity, a database blip restarts all your pods simultaneously. Liveness should only check "is the process responsive?" — nothing external.

2. **Missing `initialDelaySeconds`:** Without it, K8s checks health before the app finishes booting, gets a failure, and restarts it — creating a boot loop. Set it to at least your app's startup time.

3. **Cardinality explosion in metrics:** Using the full URL path as a label (`/users/123`, `/users/456`) creates infinite time series. Use route patterns (`/users/:id`) instead.

4. **Alert on percentage with low volume:** "Error rate > 5%" at 2 AM when there are only 3 requests means 1 error triggers the alert. Use minimum request thresholds: "Error rate > 5% AND request count > 100."
:::

## 🎯 Checkpoint

::: details Question 1 — Liveness vs readiness
**Q:** What's the difference between liveness and readiness probes, and what happens if you get them wrong?

**A:** Liveness answers "should K8s restart this container?" — only check if the process is alive and not deadlocked. Readiness answers "should K8s send traffic here?" — check external dependencies (DB, Redis, migrations). If you put a DB check in liveness, a DB outage causes all pods to restart simultaneously, making recovery impossible. If you skip readiness, K8s sends traffic to pods that haven't finished connecting to the database, causing errors during startup.
:::

::: details Question 2 — ELU vs CPU
**Q:** Why is Event Loop Utilization a better health metric than CPU percentage for Node.js?

**A:** CPU percentage doesn't distinguish between useful work and wasted work (spinning, GC). A Node process at 30% CPU could have an ELU of 0.9 (saturated event loop, most time blocked on I/O callbacks waiting to run) or 0.1 (mostly idle, CPU used by a worker thread). ELU directly measures what matters: what fraction of time the event loop is busy vs idle. An ELU above 0.8 means callbacks are waiting too long — latency is rising even if CPU looks fine.
:::

## Key Mental Models

- **Liveness = "restart me?" Readiness = "send traffic?"** Never check external deps in liveness.
- **ELU is the Node.js vital sign.** CPU percentage lies. Event loop utilization tells the truth.
- **Alert on symptoms, attach runbooks.** Every alert that pages someone at 3 AM must have a clear action plan.
- **Monitor the four golden signals.** Latency, traffic, errors, saturation — everything else is secondary.

## Related

- [Config & Secrets](./03-config-secrets)
- [Docker for Node.js](./01-docker)
- [OpenTelemetry](/nodejs/module-09/03-opentelemetry)
- [Structured Logging](/nodejs/module-09/02-structured-logging)
- [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown)
