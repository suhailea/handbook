---
title: vLLM — High-Throughput Model Serving
outline: deep
---

# vLLM — High-Throughput Model Serving

Local runtimes serve one user well. Self-hosted production serves hundreds of concurrent requests against shared GPU memory, and naive serving falls over there in a way that's invisible at small scale. vLLM exists to solve exactly that problem.

::: tip Plain English
Imagine a kitchen that starts one dish completely from scratch for every single order, even when ten orders share the same first three steps. vLLM is a kitchen that notices the shared steps across all the orders in flight and batches the work, instead of repeating it per customer. The result is far more orders served per unit of GPU, not a faster GPU.
:::

## What it actually optimizes

**Continuous batching** — instead of processing one request at a time or waiting to form a fixed batch, vLLM dynamically adds new requests to an in-flight batch as GPU capacity frees up. Naive serving either processes requests one-by-one (wasteful) or waits to batch a fixed group (adds latency); continuous batching does neither.

**PagedAttention** — the technique vLLM is best known for. It manages the KV cache ([3.5](/ai-engineering/module-03/05-prompt-caching)) in fixed-size memory pages, similar to how an OS manages RAM, instead of allocating one large contiguous block per request. This dramatically reduces wasted GPU memory and lets far more concurrent requests fit in the same hardware.

```
Naive serving:      1 request → 1 large contiguous KV allocation → memory fragments, waste
vLLM PagedAttention: requests → KV cache split into pages → allocated flexibly, reused, less waste
```

## The practical effect

| | Naive serving | vLLM |
|---|---|---|
| Concurrent requests per GPU | Low | Significantly higher |
| Memory efficiency | Poor — fragmentation | Strong — paged allocation |
| Setup complexity | Simple | Moderate — real infra to run |
| Right for | Single-user, dev | Production, many concurrent users |

vLLM is the serving layer, not the model itself — you load a model (often as GGUF or a native format) into vLLM, and it handles the concurrency and memory management around it. This is where [9.1's](./01-model-serving-overview) self-hosting decision becomes a running production system rather than a local experiment.

::: warning Watch out
vLLM solves throughput and memory efficiency, not model quality — a self-hosted open model served through vLLM is still that model's quality ceiling, just served efficiently at scale. Don't expect vLLM to close a capability gap; it closes an infrastructure gap. Also budget real setup time: GPU provisioning, model loading, and tuning batch parameters is meaningfully more work than `ollama run`.
:::

::: details Interview Question — What problem does vLLM actually solve?
**Q:** What specific problem does vLLM solve that a naive model-serving setup doesn't?
**A:** GPU memory efficiency and throughput under concurrency. Naive serving allocates a large contiguous block of KV cache memory per request, which fragments quickly and limits how many requests can run simultaneously. vLLM's PagedAttention manages that memory in smaller, flexible pages — closer to how an OS manages RAM — which lets significantly more concurrent requests fit in the same GPU memory, plus continuous batching keeps the GPU busy rather than idling between fixed batches.
:::

::: details Interview Question — vLLM vs a cloud API
**Q:** If vLLM makes self-hosted serving efficient, does that mean self-hosting is now usually better than a cloud API?
**A:** No — vLLM makes self-hosting *viable at scale*, it doesn't change the underlying trade-off from [9.1](./01-model-serving-overview). You still need real GPU capacity, real ops effort, and an open model whose quality ceiling may trail frontier closed models. vLLM is the answer to "how do I serve efficiently once I've decided to self-host," not an argument for making that decision in the first place.
:::

## Key Mental Models

**vLLM optimizes throughput and memory, not model quality.** It's an infrastructure answer, not a capability answer.

**PagedAttention is memory management for the KV cache, borrowed from OS design.** Fixed-size pages instead of large contiguous allocations is the whole trick.

## Related

- [9.1 Model Serving Overview](./01-model-serving-overview) — the decision that leads here
- [3.5 Prompt Caching & the KV Cache](/ai-engineering/module-03/05-prompt-caching) — the KV cache concept vLLM manages at scale
- [11.2 Kubernetes for AI](/ai-engineering/module-11/02-kubernetes-for-ai) — running vLLM in production
