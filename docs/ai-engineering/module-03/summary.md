---
title: Module 3 Summary — Model Serving
outline: deep
---

# Module 3 Summary

Five things to remember from this module as we continue building TaskFlow's agent.

## Mental Models

**1. You have three choices for where your model lives — each with very different tradeoffs.** Cloud API (someone else's GPU, easy, data leaves your servers), self-hosted GPU (your GPU, more ops, data stays with you), local CPU (your machine, slow, fully private). The right choice depends on data sensitivity, volume, latency requirements, and team ops capacity.

**2. GGUF is a format for running models on regular hardware — not a model or an engine.** It's packaging. llama.cpp is the engine that reads it. Ollama wraps llama.cpp for developer convenience. The format enables quantized models to run on CPUs and Apple Silicon, but at the cost of speed and concurrency.

**3. vLLM's superpower is continuous batching + PagedAttention.** Continuous batching means the GPU is never idle — requests share it in real-time. PagedAttention means KV cache memory is used efficiently. Together, these produce 5–10x better throughput than naive inference on the same hardware.

**4. KV cache means you don't pay to re-read what you've already read.** Prompt caching (Anthropic/OpenAI feature) lets you cache the system prompt so you only pay full price once per cache window. This is one of the highest-ROI optimizations for production agents with large system prompts.

**5. Quantization trades precision for size — and the tradeoff is usually worth it.** INT4 at Q4_K_M quality is typically indistinguishable from FP16 for conversational tasks while using 4x less memory. Always measure on your specific use case rather than assuming the quality drop is or isn't acceptable.

## What's next

Module 4 goes deeper: what if the model is good but it needs to know TaskFlow-specific things that no public model knows? That's when fine-tuning enters the picture.
