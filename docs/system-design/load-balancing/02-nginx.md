---
title: nginx as Reverse Proxy
outline: deep
---

# nginx as Reverse Proxy

<Badge type="tip" text="Interview: 🔥🔥🔥" /> <Badge type="info" text="Prereqs: L4 vs L7 & Algorithms, HTTP basics, TLS fundamentals" />

## 🗣️ In Plain English

::: tip In Plain English
Think of nginx as a highly efficient receptionist sitting in the lobby of a large office building. Every visitor (HTTP request) walks up to the receptionist, who decides which department (backend server) should handle the visit. The receptionist does not do the actual work -- she routes, screens, and occasionally translates.

What makes this receptionist extraordinary is how she works. Most receptionists handle one visitor at a time: greet them, walk them to the right floor, wait until they are settled, walk back, greet the next person. That is the traditional "one thread per connection" model. nginx's receptionist instead has a clipboard (an event loop). She writes down each visitor's request, sends a runner to the right department, and immediately turns to the next visitor. When a runner comes back with an answer, she checks her clipboard, matches it to the waiting visitor, and hands over the response. She never stands idle waiting.

This is why a single nginx worker process can handle thousands of simultaneous visitors. And nginx runs one such receptionist per CPU core, all managed by a head receptionist (the master process) who reads the building directory (configuration), hires and supervises the floor receptionists (worker processes), and handles shift changes (config reloads) without ever closing the lobby doors.

Beyond routing, the receptionist also handles a few critical tasks: she checks visitor IDs (TLS termination), enforces visitor limits (rate limiting), maintains a list of departments that are open (health checks), keeps a speed-dial line open to each department so she does not have to redial every time (keepalive connections), and stamps each visitor's paperwork with tracking numbers (request headers like `X-Forwarded-For`).

This page shows you exactly how to configure that receptionist -- with real nginx config blocks you can drop into production.
:::

## ⚙️ Under the Hood

### nginx Architecture

```
                    ┌──────────────────────────┐
                    │      Master Process       │
                    │  - Reads config           │
                    │  - Binds ports            │
                    │  - Manages workers        │
                    └────────┬─────────────────┘
                             │ fork
            ┌────────────────┼────────────────┐
            │                │                │
     ┌──────▼──────┐  ┌─────▼───────┐  ┌─────▼───────┐
     │  Worker #1   │  │  Worker #2   │  │  Worker #3   │
     │  (1 thread)  │  │  (1 thread)  │  │  (1 thread)  │
     │  event loop  │  │  event loop  │  │  event loop  │
     │  ~10k conns  │  │  ~10k conns  │  │  ~10k conns  │
     └──────────────┘  └─────────────┘  └─────────────┘
```

- **Master process:** reads configuration, binds to ports 80/443, forks worker processes. Does not handle traffic.
- **Worker processes:** one per CPU core (`worker_processes auto;`). Each runs a single-threaded event loop using `epoll` (Linux) or `kqueue` (macOS). Each worker can handle thousands of concurrent connections.
- **Config reload:** `nginx -s reload` tells the master to re-read config and gracefully replace workers. Existing connections finish on old workers; new connections go to new workers. Zero downtime.

```nginx
# /etc/nginx/nginx.conf -- top-level settings
worker_processes auto;           # one worker per CPU core
worker_rlimit_nofile 65535;      # raise file descriptor limit

events {
    worker_connections 10240;    # max connections per worker
    multi_accept on;             # accept multiple connections at once
    use epoll;                   # Linux; use kqueue on macOS/BSD
}
```

### Upstream Configuration

The `upstream` block defines a pool of backend servers. The `server` block tells nginx how to route incoming requests to that pool.

```nginx
upstream node_app {
    least_conn;                          # algorithm: least connections

    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
    server 127.0.0.1:3003;

    keepalive 64;                        # connection cache size (NOT a timeout)
}

server {
    listen 80;
    server_name api.example.com;

    location / {
        proxy_pass http://node_app;

        # --- Critical headers ---
        proxy_http_version 1.1;
        proxy_set_header Connection "";              # enable keepalive to upstream
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # --- Timeouts ---
        proxy_connect_timeout 5s;        # time to establish connection to upstream
        proxy_read_timeout 60s;          # time to wait for upstream response
        proxy_send_timeout 60s;          # time to send request to upstream
    }
}
```

### TLS Termination

nginx decrypts HTTPS and forwards plaintext HTTP to backends.

```nginx
server {
    listen 443 ssl http2;
    server_name api.example.com;

    # --- Certificates ---
    ssl_certificate     /etc/nginx/ssl/api.example.com.crt;
    ssl_certificate_key /etc/nginx/ssl/api.example.com.key;

    # --- TLS hardening ---
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # --- OCSP stapling ---
    ssl_stapling on;
    ssl_stapling_verify on;
    ssl_trusted_certificate /etc/nginx/ssl/chain.pem;
    resolver 8.8.8.8 8.8.4.4 valid=300s;

    # --- HSTS ---
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;

    location / {
        proxy_pass http://node_app;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Redirect HTTP to HTTPS
server {
    listen 80;
    server_name api.example.com;
    return 301 https://$host$request_uri;
}
```

### Keep-Alive: The Most Misunderstood Directive

The `keepalive` directive inside an `upstream` block is a **connection cache size**, not a timeout and not a maximum connection limit.

```nginx
upstream node_app {
    least_conn;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;

    keepalive 64;              # cache up to 64 idle connections PER WORKER
}
```

**How it works:**

1. A worker finishes a request to an upstream server.
2. Instead of closing the TCP connection, it puts it in the cache.
3. When the next request needs an upstream connection, the worker grabs one from the cache instead of opening a new one.
4. If the cache is full (64 idle connections), the oldest cached connection is closed.

**Requirements for keepalive to work:**

| Setting | Why |
|---|---|
| `proxy_http_version 1.1;` | HTTP/1.0 closes connections by default |
| `proxy_set_header Connection "";` | Clears the `Connection: close` header so upstream keeps the connection open |

**Common misconfiguration:** setting `keepalive 2` and wondering why nginx opens hundreds of connections under load. The cache is too small -- idle connections get evicted immediately, and nginx opens fresh ones. Set `keepalive` to roughly 2x the number of backend servers for moderate traffic, higher for high-throughput services.

### Connection Limits and Rate Limiting

```nginx
# Define shared memory zones (in http block)
limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;
limit_req_zone  $binary_remote_addr zone=req_per_ip:10m rate=100r/s;

server {
    listen 443 ssl http2;
    server_name api.example.com;

    # --- Connection limit: max 50 simultaneous connections per IP ---
    limit_conn conn_per_ip 50;
    limit_conn_status 429;

    # --- Request rate limit: 100 req/s per IP, burst 50 ---
    limit_req zone=req_per_ip burst=50 nodelay;
    limit_req_status 429;

    location / {
        proxy_pass http://node_app;
        # ... headers ...
    }
}
```

**Key parameters:**

- `rate=100r/s`: sustained rate of 100 requests per second per IP.
- `burst=50`: allow up to 50 extra requests to queue up during a spike.
- `nodelay`: process burst requests immediately instead of spacing them out. Without `nodelay`, burst requests are delayed to match the rate -- good for smoothing traffic, bad for user experience.
- `limit_conn_status` and `limit_req_status`: return 429 (Too Many Requests) instead of the default 503.

### Logging and Monitoring

```nginx
# Custom log format with upstream timing
log_format upstream_log
    '$remote_addr - $remote_user [$time_local] '
    '"$request" $status $body_bytes_sent '
    '"$http_referer" "$http_user_agent" '
    'upstream=$upstream_addr '
    'upstream_status=$upstream_status '
    'upstream_response_time=$upstream_response_time '
    'request_time=$request_time '
    'request_id=$request_id';

server {
    access_log /var/log/nginx/api_access.log upstream_log;
    error_log  /var/log/nginx/api_error.log warn;

    # Generate a request ID if the client does not send one
    map $http_x_request_id $request_id {
        default $http_x_request_id;
        ""      $request_id;
    }

    location / {
        proxy_pass http://node_app;
        proxy_set_header X-Request-ID $request_id;
        # ... other headers ...
    }
}
```

**Key metrics to watch:**

| Variable | What It Tells You |
|---|---|
| `$upstream_response_time` | How long the backend took to respond (seconds). High values = backend bottleneck. |
| `$request_time` | Total time from client request to response delivery. Includes network time. |
| `$upstream_addr` | Which backend handled the request. Useful for diagnosing per-server issues. |
| `$upstream_status` | HTTP status from the backend (vs `$status` which is what nginx sent to the client). |

### Common Mistakes

| Mistake | What Goes Wrong | Fix |
|---|---|---|
| Missing `proxy_set_header Host $host` | Backend sees `Host: node_app` (the upstream name) instead of the real hostname. Virtual hosts, cookie domains, and redirect URLs break. | Always set `Host $host`. |
| Not clearing `Connection` header | Every request opens a new TCP connection to the backend. Under load, you exhaust file descriptors or ports. | `proxy_set_header Connection "";` with `proxy_http_version 1.1;`. |
| Missing `X-Forwarded-For` | Backend sees nginx's IP as the client IP. Rate limiting, geo-lookup, and audit logs are wrong. | `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`. |
| `keepalive 2` on a busy service | Connection cache is too small. nginx opens and closes connections rapidly, causing TIME_WAIT socket buildup. | Set `keepalive` to at least 2x the number of upstream servers. |
| Forgetting `X-Forwarded-Proto` | Backend thinks all requests are HTTP, generates insecure redirect URLs. | `proxy_set_header X-Forwarded-Proto $scheme;`. |
| Default `worker_connections 512` | nginx runs out of connections under moderate load. Each proxied request uses 2 connections (client + upstream). | Set `worker_connections 10240` or higher. Raise `worker_rlimit_nofile` to match. |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Ephemeral port exhaustion from missing keepalive**
*Symptoms:* nginx logs show `connect() failed (99: Cannot assign requested address)`. Backends are healthy but new connections fail.
*Root cause:* Without keepalive, nginx opens and closes a TCP connection for every proxied request. Closed connections enter `TIME_WAIT` state for 60 seconds. At high throughput, you run out of ephemeral ports (default range: 32768-60999 = ~28k ports).
*Diagnosis:* `ss -s` shows thousands of connections in `TIME_WAIT`. Fix: enable keepalive in the upstream block, set `proxy_http_version 1.1`, and clear the `Connection` header. Also consider `net.ipv4.tcp_tw_reuse = 1` as a kernel-level safety net.

**2. Silent request drops from `worker_connections` limit**
*Symptoms:* Under load, some clients get connection timeouts, but nginx error log shows no upstream errors. CPU and memory are fine.
*Root cause:* `worker_connections` is set too low (default 512). Each proxied request uses 2 file descriptors (client-side + upstream-side). With 4 workers at 512 connections each, the real limit is ~1024 concurrent proxied requests.
*Diagnosis:* Check `nginx -T | grep worker_connections`. Check `worker_rlimit_nofile` -- the OS file descriptor limit must be higher than `worker_connections`. Fix: raise both.

**3. Mysterious 502s during deploy**
*Symptoms:* Brief spikes of 502 Bad Gateway errors during backend rolling deploys.
*Root cause:* nginx sends a request on a keepalive connection to a backend that has just shut down. The backend resets the connection, nginx returns 502.
*Diagnosis:* Correlate 502 timestamps with deploy events. Fix: backends should stop accepting new connections, finish in-flight requests, then shut down (graceful shutdown). On the nginx side, `proxy_next_upstream error timeout http_502;` retries the request on another backend.
:::

## 🎯 Checkpoint

::: details Question 1 -- keepalive semantics
**Q:** In the following config, what does `keepalive 32` actually control? Is it a timeout, a maximum number of connections, or something else?

```nginx
upstream backend {
    server 10.0.0.1:3000;
    server 10.0.0.2:3000;
    keepalive 32;
}
```

**A:** `keepalive 32` sets the **connection cache size per worker process** -- it is the maximum number of idle keepalive connections to upstream servers that each worker will preserve in its cache. It is not a timeout and it is not a maximum connection limit. When a request completes, the connection is placed in the cache. When the cache is full, the oldest idle connection is closed. Under load, nginx can (and will) open far more than 32 connections to upstreams -- the cache only governs how many idle connections are kept warm for reuse.
:::

::: details Question 2 -- header propagation
**Q:** A Node.js backend behind nginx logs `req.ip` and always sees `127.0.0.1`. What is wrong and how do you fix it?

**A:** nginx is not forwarding the real client IP. Two things need to happen. First, the nginx config must include `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` and `proxy_set_header X-Real-IP $remote_addr;`. Second, the Node.js app (e.g., Express) must be configured to trust the proxy: `app.set('trust proxy', true);` -- otherwise Express ignores `X-Forwarded-For` and reports the direct connection IP (nginx at 127.0.0.1). With both pieces in place, `req.ip` will return the real client IP.
:::

::: details Question 3 -- connection math
**Q:** You have `worker_processes 4` and `worker_connections 1024`. What is the theoretical maximum number of simultaneous clients nginx can proxy to backends?

**A:** Each proxied request requires 2 connections: one from the client to nginx, and one from nginx to the upstream backend. So each worker can handle at most 1024 / 2 = 512 simultaneous proxied requests. With 4 workers, the total is 4 x 512 = 2048 simultaneous clients. In practice the limit is slightly lower because some connections are used for health checks, logging, and the listen socket itself. To serve 10,000 simultaneous clients, you need `worker_connections 5120` or higher (plus a corresponding `worker_rlimit_nofile`).
:::

## 🏗️ Design It

::: details Scenario: 10,000 concurrent connections with TLS, rate limiting, and health checks

**Problem:** Configure nginx to handle 10,000 concurrent connections to 4 Node.js backends with TLS termination, rate limiting at 100 req/s per IP, and health checks.

---

**Worked Solution:**

**Step 1 -- Calculate worker settings.** 10,000 proxied connections = 20,000 file descriptors (2 per proxied request). With `worker_processes auto` on a 4-core machine, that is 4 workers needing 5,000 connections each. Set `worker_connections 8192` for headroom.

**Step 2 -- Full configuration:**

```nginx
worker_processes auto;
worker_rlimit_nofile 65535;

events {
    worker_connections 8192;
    multi_accept on;
    use epoll;
}

http {
    # --- Rate limiting ---
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/s;
    limit_conn_zone $binary_remote_addr zone=conn_limit:10m;

    # --- Upstream pool ---
    upstream node_app {
        least_conn;

        server 10.0.0.1:3000 max_fails=3 fail_timeout=30s;
        server 10.0.0.2:3000 max_fails=3 fail_timeout=30s;
        server 10.0.0.3:3000 max_fails=3 fail_timeout=30s;
        server 10.0.0.4:3000 max_fails=3 fail_timeout=30s;

        keepalive 128;
    }

    # --- Logging ---
    log_format proxy_log
        '$remote_addr [$time_local] "$request" $status '
        'upstream=$upstream_addr rt=$request_time '
        'urt=$upstream_response_time';

    # --- HTTPS server ---
    server {
        listen 443 ssl http2;
        server_name api.example.com;

        ssl_certificate     /etc/nginx/ssl/api.example.com.crt;
        ssl_certificate_key /etc/nginx/ssl/api.example.com.key;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
        ssl_prefer_server_ciphers on;
        ssl_session_cache shared:SSL:10m;
        ssl_session_timeout 1d;
        ssl_stapling on;
        ssl_stapling_verify on;

        access_log /var/log/nginx/api_access.log proxy_log;
        error_log  /var/log/nginx/api_error.log warn;

        # --- Rate and connection limits ---
        limit_req zone=api_limit burst=50 nodelay;
        limit_req_status 429;
        limit_conn conn_limit 50;
        limit_conn_status 429;

        location / {
            proxy_pass http://node_app;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            proxy_connect_timeout 5s;
            proxy_read_timeout 60s;
            proxy_send_timeout 60s;

            proxy_next_upstream error timeout http_502 http_503;
            proxy_next_upstream_tries 2;
        }

        # --- Health check endpoint (pass-through) ---
        location /health {
            proxy_pass http://node_app;
            proxy_http_version 1.1;
            proxy_set_header Connection "";
            access_log off;
        }
    }

    # --- HTTP redirect ---
    server {
        listen 80;
        server_name api.example.com;
        return 301 https://$host$request_uri;
    }
}
```

**Step 3 -- OS tuning.** Ensure the system supports the required file descriptors:

```bash
# /etc/sysctl.conf
net.core.somaxconn = 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535

# /etc/security/limits.conf
nginx soft nofile 65535
nginx hard nofile 65535
```

**Step 4 -- Verify.** Use `nginx -t` to validate config, then `nginx -s reload`. Monitor with `stub_status` module and check `$upstream_response_time` in logs.
:::

## Key Mental Models

- **Master/worker architecture is the foundation.** The master manages config and process lifecycle; workers handle traffic independently with event loops. This is why nginx reloads are zero-downtime.
- **keepalive is a connection cache, not a limit.** Misunderstanding this directive causes either port exhaustion (too low) or wasted memory (too high).
- **Every proxied request costs 2 connections.** Double your `worker_connections` relative to your target concurrent client count.
- **Headers tell the backend the truth.** Without `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`, the backend is blind to the real client and protocol.
- **Graceful shutdown prevents 502s during deploys.** Backends must drain connections; nginx should retry on the next upstream.

## Related

- [L4 vs L7 & Algorithms](./01-l4-vs-l7)
- [Streaming, SSE & proxy_buffering](./03-streaming-sse)
- [Timeouts & Slowloris](/nodejs/module-05/03-timeouts-slowloris)
