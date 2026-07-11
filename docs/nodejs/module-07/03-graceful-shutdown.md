---
title: "Graceful Shutdown (K8s, SIGTERM, Draining)"
outline: deep
---

# Graceful Shutdown (K8s, SIGTERM, Draining)

**Interview weight:** 🔥🔥🔥 | **Node 22+** | Prerequisites: [Process Lifecycle](/nodejs/module-01/02-process-lifecycle), [Child Processes](./02-child-processes)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you run a busy barber shop. At the end of the day, you do not flip the sign to "CLOSED" and throw customers out of the chair mid-haircut. Instead, you follow a sequence:

1. **Lock the front door** — no new customers can enter.
2. **Finish the haircuts in progress** — every customer in a chair gets their full cut.
3. **Clean up your station** — rinse the tools, sweep the floor, close the register.
4. **Turn off the lights and leave.**

If you do not finish within the building's closing time, the landlord physically shuts off the power — mid-cut or not.

That is exactly what graceful shutdown is for a server:

1. **Stop accepting new connections** — the load balancer is told "this instance is going away."
2. **Drain in-flight requests** — every request currently being processed gets a proper response.
3. **Close resources** — database pools, Redis connections, message queue consumers, open file handles.
4. **Exit the process.**

If the process does not finish all this within the grace period, the orchestrator (Kubernetes) sends an unblockable kill signal and the process dies immediately — in-flight requests get no response, half-written transactions are left hanging.

Getting this right is the difference between "zero-downtime deploys" and "we get errors every time we deploy." It sounds simple, but the details are full of traps: race conditions between the load balancer removing you and your server refusing connections, database queries that take longer than the grace period, WebSocket connections that never close, and health checks that report "healthy" while you are mid-shutdown.
:::

## ⚙️ Under the Hood

### Signal Handling in Node

On POSIX systems, process termination is communicated via **signals**. The two that matter for shutdown:

| Signal | Number | Default behavior | Catchable? |
|---|---|---|---|
| `SIGTERM` | 15 | Terminate process | Yes — Node lets you register a handler |
| `SIGKILL` | 9 | Terminate process immediately | **No** — cannot be caught, ignored, or handled |

```typescript
// run: node --experimental-strip-types signal-handler.ts
// Then in another terminal: kill -TERM <pid>

console.log(`PID: ${process.pid} — send SIGTERM to trigger shutdown`);

process.on('SIGTERM', () => {
  console.log('Received SIGTERM — starting graceful shutdown');
  // Do cleanup here, then exit
  process.exit(0);
});

// SIGINT is Ctrl+C — same pattern
process.on('SIGINT', () => {
  console.log('Received SIGINT (Ctrl+C)');
  process.exit(0);
});

// Keep the process alive
setInterval(() => {}, 10_000);
```

**Critical detail:** Once you register a `SIGTERM` handler, Node **no longer terminates automatically** on SIGTERM. Your handler must eventually call `process.exit()` or the process will hang — and K8s will SIGKILL it after the grace period.

### The Kubernetes Termination Lifecycle

When K8s decides to terminate a pod (deployment update, scale-down, node drain), this sequence happens:

```
1. Pod is marked "Terminating" in API server
2. Endpoints controller removes pod from Service endpoints (async)
3. preStop hook runs (if defined) — BLOCKS before SIGTERM
4. SIGTERM sent to PID 1 in the container
5. Grace period countdown begins (default: 30 seconds)
6. If process exits → done
7. If grace period expires → SIGKILL (uncatchable, immediate death)
```

The critical race condition: step 2 (removing from endpoints) and step 4 (SIGTERM) happen **in parallel**. The load balancer may still send traffic to your pod for a few seconds after SIGTERM. This is why a `preStop` hook with a small sleep is common practice:

```yaml
# K8s deployment snippet
spec:
  terminationGracePeriodSeconds: 60  # total time budget
  containers:
    - name: api
      lifecycle:
        preStop:
          exec:
            command: ["sh", "-c", "sleep 5"]
            # Wait 5 seconds for endpoints controller to propagate
            # SIGTERM arrives AFTER this sleep completes
```

### Full Graceful Shutdown Implementation

```typescript
// run: node --experimental-strip-types graceful-shutdown.ts
import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';

// Simulate a database pool
class FakeDbPool {
  async end(): Promise<void> {
    console.log('[shutdown] Closing database pool...');
    await new Promise((r) => setTimeout(r, 500)); // simulate drain
    console.log('[shutdown] Database pool closed');
  }
}

// Simulate a Redis client
class FakeRedis {
  async quit(): Promise<void> {
    console.log('[shutdown] Closing Redis connection...');
    await new Promise((r) => setTimeout(r, 200));
    console.log('[shutdown] Redis connection closed');
  }
}

const db = new FakeDbPool();
const redis = new FakeRedis();

let isShuttingDown = false;

const server: Server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Reject new requests during shutdown
  if (isShuttingDown) {
    res.writeHead(503, {
      'Connection': 'close',
      'Retry-After': '5',
    });
    res.end('Service is shutting down\n');
    return;
  }

  // Simulate a request that takes 1-3 seconds
  const duration = 1000 + Math.random() * 2000;
  await new Promise((r) => setTimeout(r, duration));

  res.writeHead(200);
  res.end(`OK — processed in ${duration.toFixed(0)} ms\n`);
});

server.listen(3000, () => {
  console.log(`Server listening on :3000 (PID ${process.pid})`);
});

// --- Shutdown logic ---

async function shutdown(signal: string): Promise<void> {
  if (isShuttingDown) return; // prevent double shutdown
  isShuttingDown = true;

  console.log(`\n[shutdown] Received ${signal} — starting graceful shutdown`);

  // 1. STOP ACCEPTING new connections
  //    server.close() stops the server from accepting new connections.
  //    It does NOT kill existing connections — they continue until done.
  server.close(() => {
    console.log('[shutdown] HTTP server closed (all connections drained)');
  });

  // 2. Set a hard deadline — if cleanup takes too long, force exit
  const forceExitTimer = setTimeout(() => {
    console.error('[shutdown] Timed out — forcing exit');
    process.exit(1);
  }, 25_000); // 25 seconds — leave 5s buffer before K8s SIGKILL at 30s

  forceExitTimer.unref(); // don't let this timer keep the process alive

  // 3. Close resources in parallel (order matters only if there are dependencies)
  try {
    await Promise.allSettled([
      db.end(),
      redis.quit(),
    ]);
    console.log('[shutdown] All resources closed');
  } catch (err) {
    console.error('[shutdown] Error during cleanup:', err);
  }

  // 4. Exit
  console.log('[shutdown] Exiting cleanly');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

### Draining HTTP Connections in Detail

`server.close()` does two things:
1. Stops calling `accept()` on the listening socket — no new TCP connections
2. Waits for all existing connections to finish (all sockets to close)

The callback fires only when all in-flight connections are done. But HTTP keep-alive connections can stay open indefinitely. You need to actively close idle keep-alive connections:

```typescript
// run: node --experimental-strip-types drain-keepalive.ts
import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';

const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(200);
  res.end('OK\n');
});

// Track all open sockets
const activeSockets = new Set<Socket>();

server.on('connection', (socket: Socket) => {
  activeSockets.add(socket);
  socket.on('close', () => activeSockets.delete(socket));
});

server.listen(3000);

process.on('SIGTERM', () => {
  console.log('Shutting down...');

  server.close(() => {
    console.log('All connections drained');
    process.exit(0);
  });

  // Tell keep-alive connections to close after their current response
  // by setting Connection: close header on subsequent responses
  server.on('request', (_req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Connection', 'close');
  });

  // Force-close connections that are idle (not processing a request)
  for (const socket of activeSockets) {
    // Idle sockets have no outstanding HTTP parser state
    // A simple heuristic: destroy sockets after a timeout
  }

  // Hard deadline
  setTimeout(() => {
    console.log(`Force-closing ${activeSockets.size} remaining sockets`);
    for (const socket of activeSockets) {
      socket.destroy();
    }
    process.exit(1);
  }, 10_000);
});
```

### Health Check During Shutdown

During the window between SIGTERM and actual exit, your health endpoint should signal unhealthy to prevent the load balancer from sending more traffic:

```typescript
// Health check handler pattern
function healthHandler(
  _req: IncomingMessage,
  res: ServerResponse,
  isShuttingDown: boolean,
): void {
  if (isShuttingDown) {
    res.writeHead(503);
    res.end('shutting down');
    return;
  }

  // Check actual health — DB reachable, heap OK, etc.
  res.writeHead(200);
  res.end('ok');
}
```

K8s liveness vs readiness probes during shutdown:

| Probe | During shutdown | Why |
|---|---|---|
| **Readiness** | Return 503 | Removes pod from Service endpoints, stops new traffic |
| **Liveness** | Return 200 | Avoid restart during graceful shutdown — you *want* the pod to exit naturally |

### Shutdown with Queues and Background Jobs

Message queue consumers need special handling — you must stop consuming new messages but finish processing current ones:

```typescript
// Conceptual pattern for BullMQ-style workers
async function shutdownWorker(worker: { close: () => Promise<void> }): Promise<void> {
  // worker.close() stops picking up new jobs
  // but waits for the current job to complete
  await worker.close();
  console.log('Queue worker drained');
}
```

For consumers using `async` iterators or event-based patterns, the key is to break the consumption loop on SIGTERM and let the current iteration complete.

### PID 1 Problem in Containers

When Node runs as PID 1 in a Docker container, it does not receive signals by default because PID 1 has special signal handling in Linux. Solutions:

```dockerfile
# Option 1: Use --init flag (Docker adds tini as PID 1)
# docker run --init myapp

# Option 2: Use tini in Dockerfile
FROM node:22-slim
RUN apt-get update && apt-get install -y tini
ENTRYPOINT ["tini", "--"]
CMD ["node", "server.js"]

# Option 3: Use exec form (Node becomes PID 1 but handles signals itself)
# Only works if your app registers SIGTERM handler
CMD ["node", "server.js"]
# NOT: CMD node server.js  (this runs sh -c "node server.js" — shell is PID 1)
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. 502 errors during deploys from the SIGTERM/endpoints race.**
Symptom: every deployment produces a spike of 502 errors in the load balancer logs, lasting 2-5 seconds. Root cause: K8s sends SIGTERM and updates endpoints in parallel. The load balancer still routes traffic to the pod for a few seconds after the pod starts rejecting connections. Fix: add a `preStop` hook with `sleep 5` to delay SIGTERM until endpoints are updated. The pod continues accepting and serving traffic during the sleep.

**2. Process hangs after SIGTERM — never exits, gets SIGKILL after 30 seconds.**
Symptom: K8s pod stays in `Terminating` state for exactly 30 seconds, then disappears. Logs show "Received SIGTERM" but no "exit" message. Root cause: `server.close()` waits for all connections to drain, but keep-alive connections with no timeout never close. Or a database query in cleanup hangs indefinitely. Fix: implement a hard deadline timer (e.g., 25 seconds) that calls `process.exit(1)` — always leave a buffer before the K8s grace period expires. Set `server.keepAliveTimeout` to a reasonable value (5 seconds).

**3. Node as PID 1 ignores SIGTERM in Docker.**
Symptom: `docker stop` takes exactly 10 seconds (the Docker default grace period) and then kills the container. The application never receives SIGTERM. Root cause: Node is PID 1 and the default PID 1 signal behavior in Linux ignores signals that do not have an explicit handler installed at the C level. Fix: use `tini` or `--init`, or ensure your code registers a `SIGTERM` handler (Node *does* forward the signal to JS-land if a handler is registered, even as PID 1).

**4. Database transactions left dangling on SIGKILL.**
Symptom: after a deployment, some database rows are locked for minutes until the database's idle transaction timeout kicks in. Root cause: in-flight database transactions are interrupted by SIGKILL without a chance to ROLLBACK. The database holds the locks until it detects the client connection is dead (TCP keepalive timeout). Fix: set short `idle_in_transaction_session_timeout` in PostgreSQL. In application code, use short transaction durations and ensure cleanup happens within the grace period.
:::

## 🎯 Checkpoint

::: details Question 1 — The endpoints race
**Q:** Explain why a `preStop: sleep 5` prevents 502 errors during K8s rolling deployments. What would happen without it?

**A:** When K8s terminates a pod, two things happen concurrently: (1) the endpoints controller removes the pod's IP from the Service endpoints, and (2) SIGTERM is sent to the pod. The endpoints update must propagate through the kube-proxy / iptables / IPVS rules on every node and through any external load balancer. This propagation takes 1-5 seconds. Without `preStop`, SIGTERM arrives immediately, the app calls `server.close()`, and the server stops accepting connections. But during those 1-5 seconds, the load balancer still has the old endpoints and routes traffic to the pod — getting connection refused or TCP reset, which it reports as a 502. With `preStop: sleep 5`, the pod continues running and accepting traffic for 5 seconds before SIGTERM arrives, giving the endpoints update time to propagate. By the time the app starts shutting down, no more traffic is being routed to it.
:::

::: details Question 2 — server.close() semantics
**Q:** After calling `server.close()`, can the server still send responses? What exactly does `server.close()` stop?

**A:** `server.close()` calls `close(2)` on the **listening socket** — the socket that accepts new TCP connections. It does **not** close any existing connected sockets. Existing connections continue normally: the server can still read requests and send responses on them. The `server.close()` callback fires only when the last connected socket closes (all in-flight requests are complete). This is exactly the behavior needed for graceful shutdown — you stop accepting new work but finish work already in progress. However, HTTP/1.1 keep-alive connections can remain open indefinitely waiting for a new request, which is why you need to either set `Connection: close` on responses or force-close idle sockets after a timeout.
:::

::: details Question 3 — Liveness vs readiness during shutdown
**Q:** During graceful shutdown, should the liveness probe return healthy or unhealthy? What about the readiness probe? Explain the consequences of getting this wrong.

**A:** The **readiness probe** should return unhealthy (503) during shutdown. This tells K8s to remove the pod from Service endpoints, stopping new traffic. The **liveness probe** should continue returning healthy (200) during shutdown. If the liveness probe returns unhealthy, K8s will restart the pod — killing it immediately and starting a fresh container instead of letting the graceful shutdown complete. The restarted pod would then be terminated again (it is still scheduled for deletion), creating a futile restart loop that produces more errors than a clean shutdown. The principle: readiness controls traffic routing, liveness controls restart decisions. During shutdown, you want to stop traffic but do not want restarts.
:::

## Key Mental Models

- **Shutdown is a sequence, not an event.** Stop accepting, drain in-flight, close resources, exit — in that order.
- **Always set a hard deadline.** Your cleanup code must finish before the orchestrator loses patience and sends SIGKILL. Budget 80% of the grace period for cleanup, keep 20% as buffer.
- **preStop sleep bridges the endpoints race.** Without it, there is an unavoidable window where traffic arrives at a shutting-down pod.
- **Readiness goes unhealthy; liveness stays healthy.** This is the only combination that gives you clean shutdown without spurious restarts.
- **Registering a SIGTERM handler means you own the exit.** Node will not auto-exit on SIGTERM once you have a handler — your code must call `process.exit()`.

## Related

- [Child Processes](./02-child-processes) — spawning and killing child processes during shutdown
- [Process Lifecycle](/nodejs/module-01/02-process-lifecycle) — exit codes, signals, and how Node terminates
- [Error Doctrine](/nodejs/module-03/06-error-doctrine) — deciding when to crash vs. when to recover
