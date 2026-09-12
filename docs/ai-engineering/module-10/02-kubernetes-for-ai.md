---
title: Kubernetes for AI — Pods, Deployments, HPA, Probes
outline: deep
---

# Kubernetes for AI — Pods, Deployments, HPA, Probes

🔥🔥🔥 Interview weight | Prerequisites: [10.1 Docker for AI](./01-docker-for-ai)

## 🗣️ In Plain English

::: tip In Plain English
Kubernetes is a system that runs your containers at scale. It handles the operational work you'd otherwise do manually: starting containers, restarting failed ones, spreading load across machines, adding more instances when traffic increases, and removing them when traffic drops.

Think of it as a smart hospital administrator. You give the administrator your requirements: "I need at least 3 doctors on duty at all times, no more than 10, and add one more whenever the waiting room has more than 20 patients per doctor." The administrator handles scheduling, monitors capacity, calls in reinforcements when needed, and sends people home when it's quiet — without you doing anything.

The building blocks:

A **Pod** is the smallest unit — it wraps one or more containers that run together and share a network. Like a doctor and their assistant, they must work in the same room.

A **Deployment** manages multiple identical Pods. When you say "I need 3 replicas," the Deployment ensures there are always 3 running — restarting them if they crash, updating them when you push new code (rolling update: replace one pod at a time so there's no downtime).

A **Service** gives the Pods a stable address. Pods are ephemeral — they come and go, their IP addresses change. A Service says "no matter which 3 Pods are currently running, this fixed address will reach one of them." It's the reception desk that routes to whoever's available.

A **HorizontalPodAutoscaler (HPA)** watches metrics and adjusts the replica count automatically. For AI services, this is critical because LLM inference load is highly variable.

**Probes** are how Kubernetes knows if a container is actually ready to serve traffic. For AI containers, this matters enormously — a container might take 90 seconds to load the model before it can handle requests. A readiness probe prevents traffic from being routed to a pod that's still warming up.
:::

## ⚙️ Under the Hood

### Pod Specification for AI Services

```yaml
# pod-spec-ai.yaml
apiVersion: v1
kind: Pod
metadata:
  name: ai-orchestrator
  labels:
    app: ai-orchestrator
    version: "2.1.0"
spec:
  containers:
  - name: orchestrator
    image: myregistry.azurecr.io/ai-orchestrator:2.1.0

    resources:
      requests:                     # Minimum guaranteed resources
        memory: "512Mi"
        cpu: "250m"                 # 0.25 CPU cores
      limits:                       # Maximum allowed
        memory: "2Gi"
        cpu: "2000m"                # 2 CPU cores

    env:
    - name: OPENAI_API_KEY
      valueFrom:
        secretKeyRef:               # Pull from K8s Secret, never hardcode
          name: ai-secrets
          key: openai-api-key
    - name: REDIS_URL
      valueFrom:
        configMapKeyRef:
          name: ai-config
          key: redis-url

    ports:
    - containerPort: 3000
      protocol: TCP

    # Readiness probe: is the container ready to receive traffic?
    # AI services need extra start-up time for model loading
    readinessProbe:
      httpGet:
        path: /health/ready
        port: 3000
      initialDelaySeconds: 30      # Wait 30s before first probe
      periodSeconds: 10            # Check every 10s
      failureThreshold: 5          # Fail 5 times before marking unready
      successThreshold: 1

    # Liveness probe: is the container alive? (restart if not)
    livenessProbe:
      httpGet:
        path: /health/live
        port: 3000
      initialDelaySeconds: 60      # Give more time for initial startup
      periodSeconds: 15
      failureThreshold: 3          # Restart after 3 consecutive failures
      timeoutSeconds: 5

    # Startup probe: for slow-starting containers (model loading)
    # Disables liveness probe until startup probe passes
    startupProbe:
      httpGet:
        path: /health/started
        port: 3000
      failureThreshold: 30         # 30 * 10s = 5 minutes max startup time
      periodSeconds: 10

  # Node affinity: prefer nodes in the same zone as the DB
  affinity:
    nodeAffinity:
      preferredDuringSchedulingIgnoredDuringExecution:
      - weight: 1
        preference:
          matchExpressions:
          - key: topology.kubernetes.io/zone
            operator: In
            values: ["eastus-1"]
```

### Health Check Endpoints for AI

```typescript
// run: npx tsx health_endpoints.ts
import express from 'express'

const app = express()
let modelLoaded = false
let dbConnected = false

// Startup probe: has initialization completed?
// Returns 200 only after model is loaded and DB is connected
app.get('/health/started', (req, res) => {
  if (modelLoaded && dbConnected) {
    res.status(200).json({ status: 'started' })
  } else {
    res.status(503).json({
      status: 'starting',
      modelLoaded,
      dbConnected,
    })
  }
})

// Readiness probe: ready to serve traffic?
// More strict than liveness — might fail temporarily under load
app.get('/health/ready', async (req, res) => {
  try {
    // Check dependencies that are required for serving
    const redisOk = await checkRedisConnection()
    const dbOk = await checkDatabaseConnection()

    if (redisOk && dbOk && modelLoaded) {
      res.status(200).json({ status: 'ready' })
    } else {
      res.status(503).json({ status: 'not ready', redisOk, dbOk, modelLoaded })
    }
  } catch {
    res.status(503).json({ status: 'error' })
  }
})

// Liveness probe: is the process alive and not deadlocked?
// Should be very simple — just checks the process is responding
app.get('/health/live', (req, res) => {
  res.status(200).json({ status: 'alive', uptime: process.uptime() })
})

async function checkRedisConnection(): Promise<boolean> { return true } // simplified
async function checkDatabaseConnection(): Promise<boolean> { return true } // simplified
```

### Deployment with Rolling Update

```yaml
# deployment-ai.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-orchestrator
  namespace: ai-production
spec:
  replicas: 3

  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1           # Allow 1 extra pod during update (4 total temporarily)
      maxUnavailable: 0     # Never reduce below desired count (zero-downtime)

  selector:
    matchLabels:
      app: ai-orchestrator

  template:
    metadata:
      labels:
        app: ai-orchestrator
        version: "2.1.0"
    spec:
      # Graceful shutdown: LLM requests in-flight shouldn't be killed
      terminationGracePeriodSeconds: 120  # 2 minutes for in-flight requests

      containers:
      - name: orchestrator
        image: myregistry.azurecr.io/ai-orchestrator:2.1.0
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "4Gi"
            cpu: "2000m"

        # Pre-stop hook: stop accepting new requests before termination
        lifecycle:
          preStop:
            exec:
              command: ["/bin/sh", "-c", "sleep 10"]  # drain in-flight requests

        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
          failureThreshold: 3

        startupProbe:
          httpGet:
            path: /health/started
            port: 3000
          failureThreshold: 18  # 3 minutes (18 * 10s)
          periodSeconds: 10

      # Pod disruption budget: minimum 2 pods available during node maintenance
      # (set separately as a PodDisruptionBudget resource)
```

### Service and Ingress

```yaml
# service-ai.yaml
apiVersion: v1
kind: Service
metadata:
  name: ai-orchestrator-svc
  namespace: ai-production
spec:
  selector:
    app: ai-orchestrator
  ports:
  - port: 80
    targetPort: 3000
    protocol: TCP
  type: ClusterIP    # Internal only; Ingress handles external access

---
# ingress-ai.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ai-ingress
  namespace: ai-production
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"    # 5min for long LLM responses
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-buffering: "off"       # Disable for SSE streaming
    nginx.ingress.kubernetes.io/enable-cors: "true"
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - ai-api.mycompany.com
    secretName: ai-api-tls
  rules:
  - host: ai-api.mycompany.com
    http:
      paths:
      - path: /api/ai
        pathType: Prefix
        backend:
          service:
            name: ai-orchestrator-svc
            port:
              number: 80
```

### HorizontalPodAutoscaler (HPA) for AI

```yaml
# hpa-ai.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ai-orchestrator-hpa
  namespace: ai-production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ai-orchestrator

  minReplicas: 2    # Always keep at least 2 for availability
  maxReplicas: 20   # Cost cap: max 20 replicas

  metrics:
  # Scale on CPU (for CPU-bound workloads like prompt construction)
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70  # Scale up when average CPU > 70%

  # Scale on memory
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80

  # Custom metric: scale on queue depth (requests waiting)
  # Requires: Prometheus + prometheus-adapter
  - type: External
    external:
      metric:
        name: ai_request_queue_depth
        selector:
          matchLabels:
            service: ai-orchestrator
      target:
        type: AverageValue
        averageValue: "5"  # Scale up when >5 requests queued per pod

  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60    # Wait 60s before scaling up again
      policies:
      - type: Pods
        value: 2                        # Add max 2 pods at a time
        periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300   # Wait 5 min before scaling down (avoid flapping)
      policies:
      - type: Pods
        value: 1                        # Remove max 1 pod at a time
        periodSeconds: 120
```

### GPU Pod Specification

```yaml
# gpu-pod.yaml — For self-hosted model serving (vLLM)
apiVersion: apps/v1
kind: Deployment
metadata:
  name: vllm-server
  namespace: ai-production
spec:
  replicas: 1      # GPU resources don't scale horizontally as easily
  selector:
    matchLabels:
      app: vllm-server
  template:
    metadata:
      labels:
        app: vllm-server
    spec:
      # GPU nodes have taints to prevent non-GPU workloads from scheduling there
      tolerations:
      - key: "nvidia.com/gpu"
        operator: "Exists"
        effect: "NoSchedule"

      nodeSelector:
        accelerator: "nvidia-a100"    # Must match label on GPU node

      containers:
      - name: vllm
        image: vllm/vllm-openai:v0.6.0

        command:
        - python3
        - -m
        - vllm.entrypoints.openai.api_server
        - --model
        - /models/mistral-7b-instruct
        - --host
        - "0.0.0.0"
        - --port
        - "8000"
        - --tensor-parallel-size
        - "1"               # 1 GPU
        - --max-model-len
        - "32768"           # 32K context

        resources:
          limits:
            nvidia.com/gpu: "1"   # Request 1 GPU
            memory: "60Gi"        # A100 has 80GB VRAM; leave headroom
            cpu: "8"
          requests:
            nvidia.com/gpu: "1"
            memory: "40Gi"
            cpu: "4"

        volumeMounts:
        - name: model-storage
          mountPath: /models
          readOnly: true

        startupProbe:
          httpGet:
            path: /health
            port: 8000
          failureThreshold: 60    # 10 minutes for large model loading
          periodSeconds: 10

        readinessProbe:
          httpGet:
            path: /health
            port: 8000
          initialDelaySeconds: 300  # 5 minutes min for model load
          periodSeconds: 30

      volumes:
      - name: model-storage
        persistentVolumeClaim:
          claimName: model-weights-pvc   # Pre-downloaded model weights
```

### ConfigMap and Secret Management

```yaml
# ai-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ai-config
  namespace: ai-production
data:
  redis-url: "redis://redis-service:6379"
  max-context-tokens: "32000"
  default-model: "gpt-4o-2024-11-20"
  rate-limit-rpm: "100"

---
# ai-secrets.yaml (stored in Azure Key Vault, synced to K8s via CSI driver)
apiVersion: v1
kind: Secret
metadata:
  name: ai-secrets
  namespace: ai-production
type: Opaque
# In production: use ExternalSecret or Azure Key Vault CSI driver
# NEVER commit actual secrets to source control
data:
  openai-api-key: <base64-encoded-secret>
  azure-openai-api-key: <base64-encoded-secret>
  database-password: <base64-encoded-secret>
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Pod killed mid-LLM-call because terminationGracePeriodSeconds too short:** Kubernetes sends SIGTERM to a pod during a rolling update. The pod has an active LLM streaming response to a user. The default `terminationGracePeriodSeconds: 30` forces the process to exit after 30 seconds, terminating the in-flight streaming response. User sees an error mid-stream. Fix: `terminationGracePeriodSeconds: 120` for AI services; implement signal handler that stops accepting new requests on SIGTERM, then finishes in-flight requests before exit.

**HPA thrashing due to short stabilization window:** Traffic is spiky — 2-minute bursts of LLM queries. HPA scales up to 10 pods, then scale-down window (default 5 minutes) hasn't elapsed. Traffic bursts again. HPA tries to scale to 15 pods while 10 are already spinning up, causing overprovisioning. Fix: tune `stabilizationWindowSeconds` based on your traffic patterns; for AI workloads, `scaleDown.stabilizationWindowSeconds: 600` (10 minutes) is more appropriate.

**GPU pod scheduled on CPU node:** GPU Deployment lacks `nodeSelector` for GPU nodes. Kubernetes schedules the pod on a CPU node (which has capacity). Container starts, model loading fails silently (falls back to CPU), serving requests at 1000× expected latency. Customers report extreme slowness. No error in logs — just timeouts. Fix: always add `nodeSelector: { accelerator: "nvidia-gpu" }` AND tolerations for the GPU taint; add an assertion that `nvidia.com/gpu: 1` is in the container resource limits.

**Readiness probe too aggressive during high load:** Under peak load, the AI service takes > 5 seconds to respond to the readiness health check (it's waiting for the LLM API). The readiness probe has `timeoutSeconds: 3` — it times out and marks the pod unready. Traffic shifts to fewer pods, which increases load, causing more readiness failures. The deployment spirals down to 0 ready pods. Fix: readiness probe should check local state (is the service initialized?), not external dependencies (LLM API latency). External dependency checks belong in application logic with circuit breakers, not readiness probes.
:::

## 🎯 Checkpoint

::: details Question 1 — Readiness vs Liveness vs Startup probes
**Q:** Explain the three Kubernetes probes and when you'd use each for an AI service that takes 3 minutes to load a model before it can serve requests.

**A:** **Startup probe**: Runs first; disables liveness probe until it passes. For slow-starting containers. For a 3-minute model load: `failureThreshold: 24, periodSeconds: 10` = 4 minutes max. Once startup probe passes, it stops running. **Readiness probe**: Is the pod ready to receive traffic from the Service? After model loading, the readiness probe checks that the model is loaded AND all dependencies (DB, Redis) are accessible. A pod can fail readiness transiently (during upstream DB issues) without being restarted — K8s just routes traffic elsewhere until it recovers. `initialDelaySeconds: 180` (after model load), `periodSeconds: 10`. **Liveness probe**: Is the process alive? Should NOT check external dependencies — if DB goes down, you don't want all pods restarted (that makes it worse). Only checks if the process itself is responsive. A failed liveness probe triggers a container restart. `initialDelaySeconds: 200` (after startup probe would have passed), `periodSeconds: 15`, `failureThreshold: 3`. Key insight: readiness gates traffic; liveness triggers restarts. Failing liveness when external dependencies are down causes cascading failures — use it only for deadlock/crash detection.
:::

::: details Question 2 — HPA for LLM services
**Q:** Why is CPU utilization a poor autoscaling metric for LLM inference services, and what custom metric would you use instead?

**A:** LLM inference (calling OpenAI API) is primarily I/O-bound, not CPU-bound. The Node.js/Python orchestrator spends most of its time awaiting the LLM response — CPU utilization stays low even with 100 concurrent requests. HPA on CPU would report 5% utilization and never scale up, while the request queue grows. Better metrics: (1) **Request queue depth**: number of requests waiting to be processed. Scale up when queue depth > N per pod. Requires Prometheus + custom metrics adapter. (2) **Active concurrent LLM calls**: track how many LLM API calls are in-flight. Scale when average > threshold per pod. (3) **P95 latency**: scale up when p95 response time exceeds SLO. This is the most business-relevant metric but requires Prometheus scraping latency histograms. (4) **Requests per second with target**: HPA External metric pointing to Prometheus `rate(http_requests_total[2m])` — scale when RPS per pod exceeds target. Implementation: emit custom metrics to a Prometheus endpoint; configure Prometheus adapter to expose them as Kubernetes external metrics for HPA.
:::

## Key Mental Models

- **Startup probe = allow warm-up time; Readiness probe = traffic gate; Liveness probe = crash detector** — each has a distinct role.
- **`terminationGracePeriodSeconds` must exceed your longest request** — for streaming LLM responses, this is 60-120 seconds.
- **GPU pods require both `nvidia.com/gpu` limit and `nodeSelector`** — neither alone is sufficient.
- **HPA scale-down should be conservative for AI** — model-loaded pods are expensive to spin up; keep them a few minutes after load drops.
- **Readiness probes should check local state, not external dependencies** — external dependency failures should trigger circuit breakers, not pod restarts.

## Related

- [10.3 AKS and Azure](./03-aks-and-azure) — running these K8s workloads on Azure
- [10.1 Docker for AI](./01-docker-for-ai) — the containers that run in these pods
- [Module 9.2 Production Metrics](/ai-engineering/module-09/02-production-metrics) — tracing and metrics for pods serving AI workloads
