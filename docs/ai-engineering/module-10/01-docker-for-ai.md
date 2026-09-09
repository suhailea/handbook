---
title: Docker for AI Workloads
outline: deep
---

# Docker for AI Workloads

🔥🔥 Interview weight | Prerequisites: Basic Docker knowledge

## 🗣️ In Plain English

::: tip In Plain English
A Docker container is a sealed box that contains your application and everything it needs to run: the code, the runtime, the system libraries, the environment variables. No more "it works on my machine" — the box runs identically everywhere.

For AI workloads, the challenge is that these boxes contain unusually heavy cargo. A Python ML service needs NumPy, PyTorch, and dozens of their dependencies — gigabytes of binary files. A model serving container might include the model weights themselves, which can be 7GB to 70GB+. A GPU-accelerated container needs specific CUDA libraries that match both the code and the physical hardware.

Think of it like packing a van for a move. A normal web service is like moving books and clothes — quick to pack, standard equipment. An AI service is like moving a grand piano: special equipment (GPU support), specific positioning (CUDA version compatibility), and much more planning to avoid the model weights being packed from scratch every time the van needs to make another trip.

Three practical concerns dominate AI container design:

**Layer caching** is about packing efficiently. Docker builds images in layers. If the model weights go in the last layer and the code changes, you only re-upload the code layer — not the 7GB model. If you pack them in the wrong order, every code change triggers a full multi-gigabyte upload.

**Multi-stage builds** let you use a heavy build environment (with compilers, dev dependencies) to produce a lightweight runtime container. You build the Python wheels in a fat container, then copy only the compiled wheels into a slim Python base image. The final container is much smaller.

**GPU containers** require that the NVIDIA Container Toolkit is installed on the host machine, and that the CUDA version in your container matches what the driver on the host supports. Get this wrong and the GPU is invisible to your code.
:::

## ⚙️ Under the Hood

### Base Images for AI Services

The right base image depends on what you're running:

```dockerfile
# Option 1: API service (no GPU needed — calls external LLM API)
FROM node:22-slim
# Or: FROM python:3.12-slim

# Option 2: ML inference with CPU (lighter)
FROM python:3.12-slim
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Option 3: GPU-accelerated inference (vLLM, local models)
FROM nvidia/cuda:12.4.0-cudnn-runtime-ubuntu22.04
RUN apt-get update && apt-get install -y python3.12 python3-pip && rm -rf /var/lib/apt/lists/*

# Option 4: Pre-built vLLM image (recommended for production)
FROM vllm/vllm-openai:latest
# Includes: CUDA, cuDNN, Python, vLLM, OpenAI-compatible server
```

### Multi-Stage Dockerfile for AI Services

```dockerfile
# Dockerfile.ai-service
# Stage 1: Build dependencies (fat, has compilers)
FROM python:3.12 AS builder

WORKDIR /app

# Install build dependencies first (for compiled packages)
COPY requirements.txt .
RUN pip install --no-cache-dir --user --extra-index-url https://download.pytorch.org/whl/cpu \
    -r requirements.txt

# Stage 2: Runtime image (slim)
FROM python:3.12-slim AS runtime

# Security: run as non-root
RUN groupadd -r aiuser && useradd -r -g aiuser aiuser

# Copy only compiled packages from builder
COPY --from=builder /root/.local /root/.local
WORKDIR /app

# Copy application code (changes frequently — at end for cache efficiency)
COPY --chown=aiuser:aiuser . .

USER aiuser

# Health check: AI services need LLM warm-up time
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD python -c "import requests; r = requests.get('http://localhost:8000/health'); exit(0 if r.status_code == 200 else 1)"

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Layer Caching Strategy for AI

```dockerfile
# BAD: model weights baked into image (7GB layer rebuilt on every code change)
FROM python:3.12-slim
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY model_weights/ /app/model_weights/  # 7GB — don't do this
COPY src/ /app/src/

# GOOD: model weights loaded at runtime from a volume or object storage
FROM python:3.12-slim
COPY requirements.txt .
RUN pip install -r requirements.txt         # cached unless requirements.txt changes
COPY src/ /app/src/                        # only this rebuilds when code changes
# Model weights fetched at startup:
# ENV MODEL_PATH=az://ml-models/llm/mistral-7b-v2.gguf
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

# If you MUST include weights (air-gapped environment):
# Use a separate image layer that rarely changes:
FROM base-image-with-weights:mistral-7b-v2 AS weights_layer
FROM python:3.12-slim AS runtime
COPY --from=weights_layer /app/model_weights /app/model_weights
COPY requirements.txt . && RUN pip install -r requirements.txt
COPY src/ /app/src/
```

### GPU Container Setup

```dockerfile
# Dockerfile.gpu-inference
# Base: CUDA 12.4, cuDNN runtime (not dev — smaller)
FROM nvidia/cuda:12.4.0-cudnn-runtime-ubuntu22.04

# System dependencies
RUN apt-get update && apt-get install -y \
    python3.12 python3-pip python3.12-dev \
    libgomp1 \                    # OpenMP for PyTorch parallel ops
    && rm -rf /var/lib/apt/lists/*

# PyTorch with CUDA 12.4 support
RUN pip3 install --no-cache-dir \
    torch==2.5.0 \
    torchvision==0.20.0 \
    --index-url https://download.pytorch.org/whl/cu124

# vLLM for efficient inference
RUN pip3 install --no-cache-dir vllm==0.6.0

WORKDIR /app
COPY serve.py .

# GPU memory configuration
ENV CUDA_VISIBLE_DEVICES=all
ENV NCCL_DEBUG=WARN

# EXPOSE 8000 for OpenAI-compatible API
EXPOSE 8000
CMD ["python3", "-m", "vllm.entrypoints.openai.api_server", \
     "--model", "/models/mistral-7b", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--tensor-parallel-size", "1"]
```

```yaml
# docker-compose.gpu.yml — for local GPU testing
version: '3.8'
services:
  llm-server:
    build:
      context: .
      dockerfile: Dockerfile.gpu-inference
    runtime: nvidia                    # requires nvidia-container-toolkit
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,utility
    volumes:
      - /mnt/models:/models:ro         # model weights from host
    ports:
      - "8000:8000"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
```

### Docker Compose for Full AI Stack (Development)

```yaml
# docker-compose.yml — local AI development stack
version: '3.8'

services:
  # AI API service (NestJS/Node)
  ai-api:
    build:
      context: ./ai-api
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - REDIS_URL=redis://redis:6379
      - DATABASE_URL=postgresql://postgres:password@postgres:5432/aidb
      - LOCAL_LLM_URL=http://llm-server:8000
    depends_on:
      - redis
      - postgres
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  # Vector database (pgvector inside postgres)
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: aidb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql

  # Redis (rate limiting, caching, sessions)
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data

  # Local LLM server (CPU mode for development)
  llm-server:
    image: ghcr.io/ggerganov/llama.cpp:server
    ports:
      - "8080:8080"
    volumes:
      - ./models:/models
    command: -m /models/mistral-7b-q4_k_m.gguf --host 0.0.0.0 --port 8080 -c 4096

volumes:
  postgres_data:
  redis_data:
```

### Container Security for AI

```dockerfile
# Security hardening for production AI containers

FROM python:3.12-slim

# 1. Non-root user
RUN groupadd --gid 1000 appgroup && \
    useradd --uid 1000 --gid 1000 --no-create-home appuser

# 2. Read-only filesystem where possible
WORKDIR /app

# 3. No new privileges
USER appuser

# 4. Minimal image attack surface
# Don't install curl, wget, ssh in production images
# Use distroless or slim base

# 5. Secrets via environment, never in image
# BAD:  ENV OPENAI_API_KEY=sk-...
# GOOD: OPENAI_API_KEY injected via K8s Secret at runtime

# 6. Scan for vulnerabilities before deployment
# Docker Scout: docker scout cves myimage:latest
# Trivy: trivy image myimage:latest

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "4", "--no-access-log"]
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Model weights in the image layer:** A team builds a Docker image with a 13GB model embedded. Every CI build takes 45 minutes just to push the layer. If the CI runner doesn't cache layers (common with ephemeral runners), every build re-downloads 13GB from the registry. Production deployments take 20 minutes to pull. Fix: store model weights in Azure Blob / S3, fetch at startup via `MODEL_PATH` environment variable, or use Kubernetes PersistentVolumeClaims to mount weights as a volume.

**CUDA version mismatch:** Container built with CUDA 12.2, deployed to node with CUDA 11.8 driver. PyTorch fails: `RuntimeError: CUDA error: no kernel image is available for execution on the device`. This is often silent until inference — health checks pass (CPU code runs), but the first GPU operation crashes. Fix: pin CUDA base image to match your cluster's driver version; document the required driver version; add a startup check that verifies CUDA availability before marking the container healthy.

**Missing --start-period in HEALTHCHECK:** An LLM server takes 90 seconds to load the model. The default health check starts at 30 seconds with retries every 10 seconds — the container is killed as unhealthy before it's done loading. Fix: `HEALTHCHECK --start-period=120s` to give the container time to warm up before health checks begin.

**GPU container on CPU node:** A GPU container deployed to a node without GPU access (forgot the node selector). The container starts successfully (CUDA libraries load without error on CPU), but the first inference call runs on CPU at 100× expected latency. No error — just 10-minute responses. Fix: Kubernetes node selector or toleration to ensure GPU containers only schedule on GPU nodes; add a startup assertion `assert torch.cuda.is_available()`.
:::

## 🎯 Checkpoint

::: details Question 1 — Layer ordering for AI images
**Q:** You have a Python AI service with: 50MB of Python app code, a 5GB trained model file, a requirements.txt with 30 dependencies, and 200MB of compiled C++ extensions. In what order should you COPY these in a Dockerfile to maximize layer caching efficiency?

**A:** Optimal order (most stable to least stable): (1) System dependencies (apt-get install) — change least often; (2) requirements.txt + pip install — changes when dependencies are added/updated; (3) Compiled C++ extensions (if separately managed) — change rarely; (4) Model weights (5GB) — change on model upgrades, but not every code push. **Ideally, don't include model weights in the image** — fetch from object storage at startup. If you must include them: (5) Application code (50MB) — changes most frequently, goes last. With this ordering: code changes only rebuild from step 5 (seconds). Dependency changes rebuild from step 2 (minutes). Model changes only happen on model upgrades (rare). Without proper ordering, a code change would re-upload 5GB+ to the registry on every commit.
:::

::: details Question 2 — GPU container in Kubernetes
**Q:** Explain the resource declaration required to run a GPU-accelerated container in Kubernetes, and what happens if you don't specify GPU resource limits.

**A:** GPU resources are declared as limits (not requests, because GPU resources are not oversubscribed by design): `resources: { limits: { nvidia.com/gpu: "1" } }`. Without this declaration: (1) The container is scheduled on any node, likely a CPU node with no GPU — inference silently falls back to CPU or crashes on first GPU operation. (2) If scheduled on a GPU node, the container doesn't get exclusive GPU access — multiple containers sharing the GPU without limits leads to out-of-memory errors as they compete for VRAM. (3) The NVIDIA Device Plugin (which provides the `nvidia.com/gpu` resource type) doesn't mount the CUDA device files into the container — `/dev/nvidia*` is absent, CUDA init fails. Additionally: add `nodeSelector: { accelerator: "nvidia-gpu" }` or tolerations to ensure GPU containers only schedule on GPU nodes; the node must have the NVIDIA Device Plugin DaemonSet installed and the CUDA driver version must match the container's CUDA version.
:::

## Key Mental Models

- **Model weights don't belong in Docker layers** — fetch from object storage at startup; use volumes for local development.
- **Layer order is cache order** — least-changing code at top, most-changing code at bottom.
- **CUDA version must match host driver** — container CUDA ≤ host driver CUDA; mismatches silently fail at inference time.
- **AI containers need longer start periods** — model loading takes 30-120 seconds; health checks must account for this.
- **GPU resources are limits, not requests in K8s** — always declare `nvidia.com/gpu: "1"` or the GPU is invisible.

## Related

- [10.2 Kubernetes for AI](./02-kubernetes-for-ai) — orchestrating these containers at scale
- [10.3 AKS and Azure](./03-aks-and-azure) — running GPU containers on Azure Kubernetes Service
- [Module 3.3 vLLM](/ai-engineering/module-03/03-vllm) — vLLM running inside these containers
