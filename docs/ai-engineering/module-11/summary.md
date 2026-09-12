---
title: Module 11 Summary — AI Infrastructure & Cloud
outline: deep
---

# Module 11 Summary — AI Infrastructure & Cloud

## What you built

A complete picture of AI infrastructure: how to containerize AI workloads correctly, orchestrate them in Kubernetes, deploy on Azure (AKS + Azure OpenAI), and optimize GPU-based model serving for throughput and cost.

## 6 Mental Models to Take Forward

1. **Model weights don't belong in Docker layers** — fetch from object storage at container startup; bake weights into images only for air-gapped environments, and use a separate rarely-changing layer.

2. **Startup probe ≠ Readiness probe ≠ Liveness probe** — they have distinct roles: startup prevents liveness restarts during warm-up; readiness gates traffic; liveness detects deadlocks. All three are needed for AI services.

3. **Azure OpenAI = GPT-4 in your tenant** — same model, Azure data residency, no secrets needed with Workload Identity, PTU for predictable throughput. The right choice for enterprise AI in 90% of cases.

4. **GPU VRAM = weights + KV cache + activations** — quantization reduces weights; FP8 KV cache reduces the second term; reducing max concurrent sequences reduces the third. Always calculate before provisioning hardware.

5. **Continuous batching is the key vLLM innovation** — keeping the GPU full with dynamically-added requests gives 20-40× better throughput than static batching. Use vLLM, not a custom inference server.

6. **GPU node pools should scale to zero** — A100/H100 nodes cost $25-50/hour; leave them running idle and you'll spend $18K-$36K/month. Design for cold start or use scheduled pre-provisioning.

## Self-Assessment Checklist

- [ ] Can you write a Dockerfile for an AI service with correct layer ordering and startup probe?
- [ ] Can you explain the three Kubernetes probes and configure them for a model-serving container?
- [ ] Can you describe the difference between Azure OpenAI and OpenAI direct API from a data residency perspective?
- [ ] Can you calculate GPU memory requirements for a 13B model with 16K context and 32 concurrent users?
- [ ] Can you explain how continuous batching improves GPU throughput over static batching?
- [ ] Can you describe when to use tensor parallelism vs pipeline parallelism?

## Next Module

[Module 12 — Case Studies](/ai-engineering/module-12/) puts the whole track together in worked systems, starting with AI in energy trading.
