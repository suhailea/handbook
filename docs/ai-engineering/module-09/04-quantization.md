---
title: Quantization — Making Models Smaller Without Breaking Them
outline: deep
---

# Quantization

A model's weights are stored as numbers — typically 16-bit floats. Quantization stores them with less precision instead, and the trade is real but usually smaller than it sounds: often a large size and speed win for a small, measurable quality cost.

::: tip Plain English
Storing a price as $19.99 versus $20 is a precision trade — you lose two digits, gain a simpler number, and for most purposes nobody notices. Quantization does the same thing to a model's weights: represent each number with fewer bits, shrink the whole model, and — if you don't push too far — the outputs barely change.
:::

## The common precision levels

| Precision | Relative size | Typical quality impact |
|---|---|---|
| FP16 (16-bit, baseline) | 100% | None — this is the reference point |
| INT8 (8-bit) | ~50% | Minimal, often imperceptible |
| INT4 (4-bit) | ~25% | Noticeable on some tasks, usually acceptable |
| INT2/lower | ~12% | Significant degradation — rarely worth it |

Smaller weights mean less GPU memory required, which directly means either running a bigger model on the same hardware, or running the same model on smaller/cheaper hardware — this is often what makes self-hosting a given model feasible at all on a specific GPU budget.

## Why it mostly works

Neural network weights are surprisingly tolerant of reduced precision — most of the "information" in a weight isn't in its last few decimal digits. INT8 quantization is close to free in practice; INT4 starts trading measurable quality for the extra compression, and where that trade is acceptable depends entirely on the task.

```
FP16 weight: 0.734521...   (16 bits of precision)
INT8 weight: 0.73          (8 bits — close enough for most tasks)
INT4 weight: 0.75          (4 bits — coarser, sometimes matters)
```

Quantization-aware training (adjusting during training to compensate) generally preserves quality better than quantizing a model after the fact, but post-training quantization is far more common in practice because it doesn't require retraining.

::: warning Watch out
Quality impact isn't uniform across tasks — precise numerical reasoning and code generation tend to degrade faster under aggressive quantization than conversational tasks do. Never assume "INT4 was fine last time" generalizes to a new task; benchmark the quantized model against your actual golden dataset ([5.1](/ai-engineering/module-05/01-metrics)) before shipping it, since the failure mode is subtle degradation, not an obvious break.
:::

::: details Interview Question — Choosing a quantization level
**Q:** You need to fit a model onto a smaller GPU than it was designed for. How do you decide how aggressively to quantize?
**A:** Start from the task's tolerance for imprecision, not the hardware constraint alone. INT8 is close to a free win for most tasks and a safe default. INT4 buys more compression but needs validation — run the quantized model against your golden dataset and compare scores to the unquantized baseline, specifically on tasks sensitive to precision like numerical reasoning or code, rather than assuming conversational quality metrics generalize to those.
:::

::: details Interview Question — Quantization vs a smaller model
**Q:** Would you rather run a large model quantized to 4-bit, or a smaller model at full precision, for the same memory budget?
**A:** Depends on the task, but a well-quantized larger model often outperforms a smaller full-precision one at similar memory footprint, because the larger model's extra capacity tends to survive quantization better than a genuinely undersized model performs at full precision. The honest answer is to benchmark both against the actual task — this isn't reliably predictable from first principles, and the gap varies by model family and quantization method.
:::

## Key Mental Models

**Quantization trades precision for size and speed, often cheaply.** INT8 is close to free; INT4 needs validation.

**Impact is task-dependent, not uniform.** Numerical and code tasks degrade faster than conversational ones — always validate against real evaluation, not assumption.

## Related

- [9.2 GGUF & Local LLMs](./02-gguf-and-local-llms) — the format that typically carries quantized weights
- [9.1 Model Serving Overview](./01-model-serving-overview) — the hardware-budget decision this feeds
- [5.1 Metrics](/ai-engineering/module-05/01-metrics) — validating quality after quantizing
