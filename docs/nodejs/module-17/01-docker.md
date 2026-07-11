---
title: "Docker for Node.js"
outline: deep
---

# Docker for Node.js

| Interview weight | Node version | Prerequisites |
|---|---|---|
| 🔥🔥🔥 | Node 22+ | [Process Lifecycle](/nodejs/module-01/02-process-lifecycle), [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown) |

## 🗣️ In Plain English

::: tip In Plain English
Imagine you are shipping a fish tank to someone across the country. You could send just the fish and a note saying "please buy a tank, fill it with water at exactly 76 degrees, add these specific chemicals, and place these plants in this arrangement." The recipient would probably get something wrong, and the fish would not survive.

The better approach: ship the entire tank -- fish, water, plants, heater, filter, everything -- inside a sealed, self-contained box. The recipient plugs it in, and it works identically to how it worked in your living room. They do not need to know anything about fish care. They do not need to install anything. It just runs.

That is what Docker does for your application. Instead of saying "install Node 22, install these npm packages, set these environment variables, and run this command," you package everything into a single image: the right version of Node, your code, all dependencies, and the instructions to start it. Anyone with Docker can run your app, and it behaves exactly the same as it does on your machine.

The container -- the running instance of the image -- is isolated from the host machine. It has its own filesystem, its own network interfaces, its own process tree. If it crashes, nothing else is affected. If it has a memory leak, the container runtime kills it and starts a fresh one. This isolation is what makes containers so powerful for production: you can run dozens of applications on the same machine without them interfering with each other.

The trick with Node.js specifically is that containers behave differently from regular servers in a few critical ways: signals are forwarded differently (which affects graceful shutdown), the process runs as root by default (a security risk), and the image can be unnecessarily huge if you include dev dependencies and build tools. Getting these details right is the difference between a Docker image that works and one that works well in production.
:::

## ⚙️ Under the Hood

### Multi-Stage Dockerfile

The most important optimization: use a multi-stage build. The build stage has everything needed to compile TypeScript and install native modules. The production stage has only the runtime and production dependencies.

```dockerfile
# ---- Build stage ----
FROM node:22-slim AS build

WORKDIR /app

# Copy package files first — Docker caches this layer
# If package.json hasn't changed, npm ci is skipped on rebuild
COPY package.json package-lock.json ./

# npm ci is deterministic (uses lockfile exactly) and faster than npm install
RUN npm ci

# Now copy source code — this layer changes frequently
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript (if using tsc; skip if using --experimental-strip-types at runtime)
RUN npm run build

# ---- Production stage ----
FROM node:22-slim AS production

# Security: don't run as root
RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --create-home appuser

WORKDIR /app

# Copy only production dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built output from build stage
COPY --from=build /app/dist ./dist

# Switch to non-root user
USER appuser

# Expose the port your app listens on
EXPOSE 3000

# Health check — K8s can also do this, but this is a Docker-native fallback
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => { if (!r.ok) process.exit(1) })"

# Use exec form (JSON array) — NOT shell form
# Shell form: CMD node dist/main.js  ← runs as /bin/sh -c "node dist/main.js"
# Exec form: CMD ["node", "dist/main.js"]  ← node is PID 1, receives signals directly
CMD ["node", "dist/main.js"]
```

### Layer Caching: Why Order Matters

Docker builds images layer by layer. Each instruction (`COPY`, `RUN`) creates a layer. If a layer has not changed, Docker reuses the cached version and skips everything from that point backward.

```dockerfile
# BAD — any source change invalidates the npm ci cache
COPY . .
RUN npm ci
RUN npm run build

# GOOD — npm ci is cached unless package files change
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
```

With the good ordering, changing a `.ts` file only re-runs `COPY . .` and `npm run build`. The `npm ci` layer (which takes 30-60 seconds) is cached.

### .dockerignore

Without `.dockerignore`, `COPY . .` sends everything to the Docker daemon, including `node_modules`, `.git`, test files, and documentation.

```
# .dockerignore
node_modules
.git
.gitignore
*.md
tests/
coverage/
.env*
.vscode/
.idea/
docker-compose*.yml
Dockerfile
.dockerignore
```

### Base Image Choices

| Image | Size | Use when |
|---|---|---|
| `node:22` | ~1 GB | Need full tooling (build-essential, python, etc.) — only for build stages |
| `node:22-slim` | ~200 MB | Production default — Debian-based, glibc, most native modules work |
| `node:22-alpine` | ~130 MB | Size-critical environments — uses musl libc instead of glibc |

**Alpine warning:** Alpine uses musl libc. Some native Node modules (e.g., `sharp`, `bcrypt`, Prisma engine binaries) are compiled against glibc and will segfault or fail to load on Alpine. If you use native modules, either:
- Use `node:22-slim` (glibc-based), or
- Ensure the native module provides a musl-compatible build (sharp does, Prisma does via specific engine targets).

### Running as Non-Root

By default, containers run as root. If an attacker exploits a vulnerability in your app, they have root access to the container filesystem and can potentially escape to the host.

```dockerfile
# Create a dedicated user and group
RUN groupadd --system appgroup && \
    useradd --system --gid appgroup --create-home appuser

# After copying files, switch to the non-root user
USER appuser
```

Ensure file permissions are correct: the `appuser` needs read access to the application files and write access to any data directories (e.g., `/app/uploads`).

### Signal Handling: Exec Form vs Shell Form

This is the most common source of graceful shutdown failures in Docker:

```dockerfile
# Shell form — BAD for signal handling
CMD node dist/main.js
# Docker runs: /bin/sh -c "node dist/main.js"
# sh is PID 1. node is a child process.
# SIGTERM goes to sh, which ignores it. node never knows.

# Exec form — GOOD
CMD ["node", "dist/main.js"]
# Docker runs: node dist/main.js
# node is PID 1. SIGTERM goes directly to node.
# Your process.on('SIGTERM', ...) handler fires.
```

**The PID 1 zombie reaping problem:** When Node runs as PID 1, it is responsible for reaping zombie child processes (a responsibility normally handled by `init`). If your app spawns child processes, use `tini` as an init system:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends tini && rm -rf /var/lib/apt/lists/*

ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/main.js"]
# tini is PID 1, forwards signals to node, reaps zombies
```

### Docker Compose for Local Development

```yaml
# docker-compose.yml
services:
  app:
    build:
      context: .
      target: build  # use the build stage for dev (has devDependencies)
    ports:
      - "3000:3000"
      - "9229:9229"  # Node.js debugger
    volumes:
      - .:/app           # mount source for hot reload
      - /app/node_modules # anonymous volume — don't override container's node_modules
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/myapp
      - REDIS_URL=redis://redis:6379
    command: npx tsx watch src/main.ts  # hot reload in dev
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  db:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: myapp
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

### ARG vs ENV

```dockerfile
# ARG — build-time only. Not available at runtime.
ARG NODE_VERSION=22
FROM node:${NODE_VERSION}-slim

# ENV — available at build time AND runtime.
ENV NODE_ENV=production
# process.env.NODE_ENV === 'production' in your app

# ARG can set ENV — the value is baked into the image
ARG APP_VERSION=1.0.0
ENV APP_VERSION=${APP_VERSION}
```

### Image Size Optimization

```bash
# Check image size
docker images myapp

# Analyze layers
docker history myapp:latest

# Multi-stage build + slim base + clean cache = small image
# Typical sizes:
# Without optimization: 1.2 GB
# node:22-slim + multi-stage: 200-300 MB
# node:22-alpine + multi-stage: 130-200 MB
```

Key optimizations:
1. Multi-stage build (exclude devDependencies and build tools from final image).
2. `npm ci --omit=dev` (no devDependencies in production).
3. `npm cache clean --force` (remove npm cache from the layer).
4. `.dockerignore` (exclude unnecessary files from build context).
5. Use `--no-install-recommends` with `apt-get` to avoid pulling in suggested packages.

### Security Scanning

```bash
# Docker Scout (built into Docker Desktop)
docker scout cve myapp:latest

# Trivy (open source, CI-friendly)
trivy image myapp:latest

# Scan for HIGH and CRITICAL only
trivy image --severity HIGH,CRITICAL myapp:latest
```

Integrate scanning into CI: fail the build if critical vulnerabilities are found. Pin your base image to a specific digest (`node:22-slim@sha256:abc123...`) for reproducibility, and update it regularly.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Shell form CMD prevents graceful shutdown.** `CMD node server.js` runs Node under `/bin/sh`. When Kubernetes sends SIGTERM, `sh` receives it and ignores it. Node never gets the signal. After 30 seconds (the default `terminationGracePeriodSeconds`), Kubernetes sends SIGKILL. In-flight requests are dropped, database transactions are left open, WebSocket connections are severed without cleanup. Symptom: 502 errors during deployments, database connection leaks. Fix: use exec form `CMD ["node", "server.js"]` or `tini`.

**2. Running as root inside the container.** A path traversal vulnerability lets an attacker read `/etc/shadow` inside the container. If the container runs as root, they can also write to the filesystem, install tools, and attempt container escapes via kernel exploits. Symptom: you may not notice until a security audit or an actual breach. Fix: always set `USER appuser` in the Dockerfile.

**3. node_modules in the build context.** Without `.dockerignore`, `COPY . .` copies the host's `node_modules` (which may be compiled for macOS) into the Linux container. Native modules like `bcrypt` or `sharp` crash with `Error: ... was compiled against a different Node.js version`. Even if they work, you are copying hundreds of MBs unnecessarily. Fix: add `node_modules` to `.dockerignore`.

**4. Alpine breaks native modules silently.** You switch from `node:22-slim` to `node:22-alpine` to save 70 MB. The image builds successfully. In production, `bcrypt.hash()` segfaults because the prebuilt binary expects glibc. The process crashes with no useful error message -- just `Segmentation fault (core dumped)`. Symptom: random crashes under load, only in production (your Mac uses a different binary). Fix: test with Alpine before committing, or stick with `node:22-slim`.
:::

## 🎯 Checkpoint

::: details Question 1 — Signal forwarding
**Q:** Explain why `CMD node server.js` and `CMD ["node", "server.js"]` behave differently when Kubernetes sends SIGTERM. What is the practical impact on a rolling deployment?

**A:** `CMD node server.js` (shell form) is executed as `/bin/sh -c "node server.js"`. The shell (`sh`) becomes PID 1 and spawns `node` as a child process. When Kubernetes sends SIGTERM to PID 1, `sh` receives it. Most shell implementations do not forward SIGTERM to child processes -- they simply ignore it. Node never receives the signal, so `process.on('SIGTERM', ...)` never fires. The application continues running, unaware that it should shut down. After `terminationGracePeriodSeconds` (default 30s), Kubernetes sends SIGKILL, which is uncatchable. The process is killed immediately: in-flight HTTP requests get no response (502 errors from the load balancer), database connections are not closed cleanly, and any shutdown logic (flushing logs, deregistering from service discovery) is skipped.

`CMD ["node", "server.js"]` (exec form) runs `node` directly as PID 1. SIGTERM is delivered to `node`. The `process.on('SIGTERM', ...)` handler fires, the server stops accepting new connections, drains in-flight requests, closes database pools, and exits cleanly. Zero downtime during rolling deployments.
:::

::: details Question 2 — Layer caching
**Q:** A developer's Dockerfile copies all source files before running `npm ci`. Every code change triggers a full `npm ci` (60 seconds). How would you restructure the Dockerfile to avoid this, and why does it work?

**A:** Restructure to copy `package.json` and `package-lock.json` first, run `npm ci`, then copy the source:

```dockerfile
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
```

This works because Docker's layer caching is sequential and invalidation cascades forward. Each `COPY` or `RUN` instruction creates a layer identified by its inputs. If the inputs have not changed since the last build, Docker reuses the cached layer and all subsequent layers -- until it hits one that has changed, at which point every layer from that point forward is rebuilt.

When `package.json` and `package-lock.json` have not changed (which is most code changes), the `COPY package*.json` layer is cached, so the `RUN npm ci` layer is also cached. Only `COPY . .` and `RUN npm run build` are re-executed. This reduces build time from 60+ seconds to 5-10 seconds for typical code changes.
:::

::: details Question 3 — Alpine compatibility
**Q:** Your team switches from `node:22-slim` to `node:22-alpine` and deploys. The application starts fine but crashes under load with `Segmentation fault`. How do you diagnose this?

**A:** The most likely cause is a native Node.js addon compiled against glibc (used by Debian-based images like `node:22-slim`) that is incompatible with musl libc (used by Alpine). Common offenders include `bcrypt`, `sharp`, `canvas`, and Prisma engine binaries.

Diagnosis steps: (1) Check `npm ls` for native addons -- look for packages with `node-gyp` build steps or prebuilt binaries. (2) Run the container interactively (`docker run -it --entrypoint sh myapp:alpine`) and try `node -e "require('bcrypt')"` for each suspect module. (3) Check if the module provides a musl-compatible build (e.g., `sharp` ships both glibc and musl binaries). (4) If the module does not support musl, either switch back to `node:22-slim`, install `gcompat` (a glibc compatibility layer for Alpine, though not always reliable), or find an alternative pure-JS module (e.g., `bcryptjs` instead of `bcrypt`).
:::

## Key Mental Models

- **Multi-stage builds separate build concerns from runtime.** The build stage has compilers, devDependencies, and build tools. The production stage has only the runtime, production dependencies, and compiled output.
- **Layer order determines cache efficiency.** Copy things that change rarely (package files) before things that change often (source code). Docker's cache invalidation cascades forward.
- **Exec form CMD is non-negotiable for Node.js.** Shell form prevents signal delivery, breaking graceful shutdown. Always use `CMD ["node", "..."]` or `tini`.
- **Non-root is a security baseline.** Running as root inside a container is an unnecessary privilege escalation vector. Create a dedicated user.
- **Alpine is smaller but not always compatible.** The glibc vs musl difference breaks native modules silently. Test before committing to Alpine in production.

## Related

- [Graceful Shutdown](/nodejs/module-07/03-graceful-shutdown) — the shutdown logic that depends on correct signal forwarding from Docker
- [Process Lifecycle](/nodejs/module-01/02-process-lifecycle) — PID 1 behavior, exit codes, and signal handling in Node.js
- [CI/CD Pipelines](./02-cicd) — building and pushing Docker images in automated workflows
- [Health Checks & Monitoring](./04-health-monitoring) — the `/health` endpoint that Docker's HEALTHCHECK and K8s probes call
