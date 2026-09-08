---
title: GGUF & Local LLMs — Running Models on Your Machine
outline: deep
---

# GGUF & Local LLMs — Running Models on Your Machine

We tested a local Llama 3 model for internal tools. The format the model came in was a `.gguf` file. What even is that?

::: tip Plain English
A model is just a huge file — billions of numbers that represent what the model "knows." Like how a song can be stored as an MP3 or a FLAC file, a model can be stored in different formats. The format affects how big the file is, how fast it loads, and what software can read it.

GGUF is a format invented for running models efficiently on regular computers — laptops, desktops, machines without expensive AI-specific GPUs. It's optimized to be small and fast on the hardware most developers actually have.

llama.cpp is the engine that reads GGUF files and runs the model. Ollama is a friendly wrapper around llama.cpp that makes it feel like Docker — pull a model, run it, get an API.
:::

## What GGUF is

GGUF (originally GGML Unified Format) is a binary file format for storing large language models. It was created by the llama.cpp project and is specifically designed for:

- Efficient loading on CPUs and Apple Silicon (M1/M2/M3)
- Memory-mapped access (the file doesn't all load into RAM at once)
- Including everything in one file — model weights, tokenizer, metadata

When you download a Llama 3 model from Hugging Face for local use, you download a `.gguf` file.

## GGUF quantization names decoded

GGUF files come in different sizes because of quantization (covered in more depth on the [next page](./05-quantization)):

| Name | What it means | Size (8B model) | Quality |
|------|---------------|-----------------|---------|
| Q2_K | 2-bit quantized | ~3GB | Noticeably worse |
| Q4_K_M | 4-bit, K-quant, Medium | ~5GB | Good for most uses |
| Q5_K_M | 5-bit, K-quant, Medium | ~6GB | Better quality |
| Q8_0 | 8-bit | ~9GB | Near-full quality |
| F16 | Full 16-bit | ~16GB | Full quality |

The pattern: `Q{bits}_K_M` means 4-bit, K-quant method (smarter than basic quantization), Medium size variant. For most uses, `Q4_K_M` is the sweet spot — small enough to run on a MacBook Pro, good enough for real tasks.

## llama.cpp and Ollama

**llama.cpp** is the C++ library that runs GGUF models. It's what does the actual computation. You can use it directly, but it's low-level.

**Ollama** wraps llama.cpp in a developer-friendly interface:

```bash
# Pull a model (like docker pull)
ollama pull llama3

# Run it interactively
ollama run llama3

# Or call its API (OpenAI-compatible)
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "llama3", "messages": [{"role": "user", "content": "Hello"}]}'
```

Ollama exposes an OpenAI-compatible API. Your agent code doesn't need to know it's talking to a local model vs OpenAI — just change the base URL.

## When local LLMs make sense

::: tip Use local LLMs when
- **Development** — no API costs, no rate limits, works offline
- **Internal tools** where latency is acceptable (a 5-second response is fine for a developer productivity tool)
- **Air-gapped environments** — secure facilities, offline systems
- **Privacy-first prototypes** — test before committing to cloud or GPU infrastructure
- **Experimentation** — try different models quickly without paying per token
:::

::: warning When NOT to use local LLMs
- **Production with multiple concurrent users** — a single llama.cpp instance handles one request at a time on CPU. 10 concurrent users means 10x the wait time.
- **When quality matters** — even a well-quantized 8B model is meaningfully worse than GPT-4o or Llama 3 70B on complex reasoning.
- **Latency-sensitive applications** — CPU inference takes seconds. Cloud APIs take milliseconds.
:::

For TaskFlow: we used Ollama during development so engineers weren't burning API credits every time they tested a prompt change. Production runs on the cloud API (or self-hosted vLLM for enterprise).

::: details Interview Question — Ollama vs OpenAI API
**Q:** When would you use Ollama over the OpenAI API in a production setting?

**A:** In very few production scenarios. Ollama is excellent for development, internal tools, and fully offline environments. For production, the main case for Ollama is an air-gapped environment where no external API call is possible — but even there, you'd typically want vLLM instead of llama.cpp for throughput. The practical comparison: Ollama (llama.cpp) handles one request at a time on CPU, produces responses in seconds, and runs quantized small models. vLLM handles hundreds of concurrent requests on GPU, produces responses in milliseconds, and can run full-quality large models. If you need production serving, use vLLM. If you need a quick local model for development or a single-user internal tool, Ollama is perfect.
:::
