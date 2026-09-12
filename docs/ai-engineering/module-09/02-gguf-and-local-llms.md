---
title: GGUF & Local LLMs
outline: deep
---

# GGUF & Local LLMs

Once self-hosting is the right call, you need a model file format and a runtime that can actually run on the hardware you have. GGUF is the format that made running LLMs on ordinary machines — laptops, single GPUs, even CPUs — practical.

::: tip Plain English
A model trained by a lab exists as huge floating-point weight files, sized for a data center's GPU cluster. GGUF is a packaging format designed to run those same models on far more ordinary hardware — compressed, single-file, and readable by lightweight runtimes without the heavy dependency stack a training environment needs.
:::

## What GGUF actually is

A binary file format bundling model weights, metadata (architecture, tokenizer), and quantization info into one portable file. Runtimes like `llama.cpp` and `ollama` read GGUF files directly, without needing the full Python/PyTorch stack a model was trained in — which is a large part of why it's approachable for local use.

```bash
# ollama makes this close to one command
ollama pull llama3.2:8b
ollama run llama3.2:8b "Summarize this ticket: ..."
```

## Where this fits, realistically

| Use case | Fit |
|---|---|
| Prototyping without API costs | Good |
| Offline / air-gapped environments | Good — sometimes the only option |
| Privacy-sensitive dev/test | Good |
| Production, high-concurrency serving | Poor — [vLLM](./03-vllm) is built for that |
| Frontier-quality reasoning | Poor — open local models trail closed frontier models |

`llama.cpp`-based runtimes are optimized for running on limited hardware, not for serving many concurrent users efficiently — that's a different problem with a different tool ([vLLM](./03-vllm)). Reaching for `ollama` in a production API path is a common mismatch: right tool for a laptop, wrong tool for concurrent production traffic.

::: warning Watch out
GGUF and quantization ([9.4](./04-quantization)) are often bundled together, but they're separate concerns — GGUF is the *container format*, quantization is a *compression technique* applied to the weights inside it. A GGUF file can hold weights at various quantization levels, and the level chosen is what actually trades quality for size and speed, not the format itself.
:::

::: details Interview Question — GGUF for local dev vs production serving
**Q:** A team is happily using `ollama` with a GGUF model for local development. Should they use the same setup in production?
**A:** Generally no. `ollama` and `llama.cpp`-based runtimes are optimized for single-user, resource-constrained use — great for a laptop or offline environment. Production serving with real concurrency needs a throughput-optimized server like vLLM, which handles batching and memory management for many simultaneous requests in a way these tools aren't designed for. Keep GGUF/ollama for dev, switch runtimes for production load.
:::

::: details Interview Question — GGUF vs quantization, precisely
**Q:** Explain the relationship between GGUF and quantization.
**A:** GGUF is a file format — a container holding weights, tokenizer, and architecture metadata in one portable file. Quantization is a separate technique that reduces the numerical precision of the weights themselves (e.g., 16-bit down to 4-bit) to shrink size and speed up inference. A GGUF file is typically quantized, but the two are independently variable — you choose a quantization level, and GGUF is just how that quantized model gets packaged and distributed.
:::

## Key Mental Models

**GGUF made local LLM inference practical on ordinary hardware.** It's the format, not the speed technique.

**Local runtimes are for dev and single-user cases, not production concurrency.** Production serving needs a different tool entirely.

## Related

- [9.1 Model Serving Overview](./01-model-serving-overview) — when self-hosting is the right call at all
- [9.3 vLLM](./03-vllm) — the production-concurrency alternative
- [9.4 Quantization](./04-quantization) — the compression technique GGUF files carry
