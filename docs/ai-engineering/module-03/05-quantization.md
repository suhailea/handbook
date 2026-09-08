---
title: Quantization — Making Models Smaller Without Breaking Them
outline: deep
---

# Quantization — Making Models Smaller Without Breaking Them

Llama 3 70B needed 140GB of VRAM. We didn't have that. Quantization let us run it in 40GB.

::: tip Plain English
A model is a collection of billions of numbers. Each number represents a tiny piece of what the model learned. By default, each number is stored with high precision — like writing "3.14159265" when you could write "3.14" and lose very little information for most purposes.

Quantization is the process of reducing that precision. Instead of storing each number as a 32-bit or 16-bit decimal, you store it as an 8-bit or even 4-bit integer.

The tradeoff: smaller numbers take less memory and compute faster, but with slightly less precision, the model's answers drift a little from the original. A well-quantized model at 4-bit is usually indistinguishable from the original for everyday tasks. For edge cases and complex reasoning, there's a small but real quality drop.

The practical win is massive: a model that needed 140GB of VRAM now fits in 40GB. You can run it on hardware you actually have.
:::

## The number formats

**FP32 (32-bit floating point):** The original high-precision format. 4 bytes per weight. Used in training; almost never in inference anymore.

**FP16 (16-bit float) / BF16:** The standard inference format. 2 bytes per weight. Near-identical quality to FP32. This is what most GPU-hosted models use.

**INT8 (8-bit integer):** 1 byte per weight. ~2x smaller than FP16. Quality is very close to FP16 for most models. Some models are sensitive; measure before assuming.

**INT4 (4-bit integer):** 0.5 bytes per weight. ~4x smaller than FP16. This is where you really see quality differences on complex reasoning, but everyday tasks are usually fine. Most GGUF models and many self-hosted models use this.

**INT2/1-bit:** Experimental territory. Significant quality degradation. Only relevant for research or extremely constrained hardware.

## Comparison table

| Format | Bytes per weight | 70B model VRAM | Quality vs FP16 | Common use |
|--------|------------------|----------------|-----------------|------------|
| FP32 | 4 bytes | 280GB | Baseline | Training only |
| FP16 / BF16 | 2 bytes | 140GB | Same | Standard GPU serving |
| INT8 | 1 byte | 70GB | ~99% | GPU serving, quality-sensitive |
| INT4 | 0.5 bytes | 35–40GB | ~95-98% | Most local/self-hosted use |
| INT2 | 0.25 bytes | ~18GB | ~80-90% | Experimental |

## GGUF quantization names

When you see a GGUF filename like `Llama-3-8B-Instruct-Q4_K_M.gguf`, here's what it means:

- `Q4` — 4-bit quantization
- `K` — K-quant method (smarter than basic quantization; mixes precision across layers)
- `M` — Medium variant (there's also S for Small and L for Large within the same bit width)

K-quants are generally better than basic quantization at the same bit width — they identify which model layers are more sensitive and give them slightly higher precision.

The hierarchy (best to worst quality at 4-bit): `Q4_K_L > Q4_K_M > Q4_K_S > Q4_0`.

## Quantization methods

**Post-training quantization (PTQ):** Apply quantization to a trained model without retraining. Simple, no data needed, slight quality loss. This is what GGUF files use.

**Quantization-aware training (QAT):** Train the model with quantization in mind, so the weights adapt to the lower precision. Better quality, but requires access to the training pipeline. Used by some model providers.

**GPTQ / AWQ:** Advanced PTQ methods that calibrate on a small dataset to minimize quality loss. Better than basic PTQ, more work than GGUF-style quantization.

## When to quantize

::: tip Quantize when
- You need to run a model that doesn't fit in available VRAM at full precision
- Latency needs to improve (lower precision = faster compute)
- You're on CPU/Apple Silicon (GGUF INT4 is what makes this practical)
- Cost reduction is a priority (smaller model = cheaper GPU or less GPU time)
:::

::: warning When to avoid quantization
- Your use case has complex reasoning and you observe quality drops
- You have access to enough VRAM to run FP16 — prefer it unless you need to save memory
- You're doing fine-tuning (quantization during training requires QAT, not PTQ)
:::

For TaskFlow's self-hosted deployment: we ran INT4 quantized Llama 3 70B (Q4_K_M) on two A100 40GB GPUs. Quality was indistinguishable from FP16 for support ticket responses. We saved ~2 GPU-hours per day and halved our GPU memory requirement.

::: details Interview Question — Quantization tradeoffs
**Q:** A colleague suggests using INT4 quantization to cut GPU costs. What are the tradeoffs and how would you evaluate whether it's safe to do?

**A:** The tradeoffs: INT4 reduces memory by ~4x vs FP16 and speeds up compute, but introduces rounding errors across billions of weights — the cumulative effect is a slight quality drop, typically 1–5% on benchmarks, sometimes more on tasks requiring precise factual recall or complex multi-step reasoning. To evaluate whether it's safe: (1) Run your actual use case through both FP16 and INT4 and compare outputs side by side — benchmarks can miss domain-specific degradation. (2) Use your evaluation set (golden examples) to score both versions. (3) Test specifically on edge cases and complex examples, where quantization hurts most. (4) For a support agent, Q4_K_M is almost always acceptable — the tasks are conversational, not high-precision reasoning. For a medical diagnosis tool, I'd want INT8 at minimum. The key is: don't assume, measure on your specific use case.
:::
