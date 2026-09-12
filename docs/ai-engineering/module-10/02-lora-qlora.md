---
title: LoRA & QLoRA
outline: deep
---

# LoRA & QLoRA

Full fine-tuning updates every weight in a model — for a large model, that's an enormous amount of GPU memory and compute, out of reach for most teams. LoRA is why fine-tuning became practical on ordinary hardware.

::: tip Plain English
Full fine-tuning is renovating an entire building. LoRA is adding a small, targeted addition instead — you leave the original structure completely untouched and attach a small, trainable piece that adjusts behavior. Far cheaper, much faster to build, and if it doesn't work out, you just remove the addition — the original building was never touched.
:::

## How it actually works

Instead of updating the full weight matrices, LoRA freezes the entire pretrained model and injects small, trainable low-rank matrices alongside the original weights. Only those small matrices get trained — typically under 1% of the total parameter count.

```
Full fine-tuning:  update ALL weights (billions of parameters) — expensive, needs a lot of GPU memory
LoRA:              freeze original weights, train small adapter matrices (millions of parameters)
                   → far less memory, faster training, original model stays untouched
```

**QLoRA** adds quantization on top: the frozen base model is loaded in reduced precision (typically 4-bit), while the small LoRA adapters still train at higher precision. This is what makes fine-tuning feasible on a single consumer-grade GPU rather than requiring a data center.

## Why "the original stays untouched" matters practically

Because the base weights are frozen, you can train multiple LoRA adapters for different tasks against the *same* base model, and swap between them without reloading the whole model — one base model, several lightweight task-specific adapters, loaded independently. This is a meaningfully different deployment shape than full fine-tuning, where each fine-tuned variant is a separate full-size model.

| | Full fine-tuning | LoRA | QLoRA |
|---|---|---|---|
| Trainable parameters | 100% | Often <1% | Often <1% |
| GPU memory needed | Very high | Much lower | Lowest — fits on one consumer GPU |
| Multiple task variants | Separate full models each | Swap lightweight adapters | Swap lightweight adapters |
| Training speed | Slow | Faster | Faster |

::: warning Watch out
LoRA's efficiency comes with a real trade: because only a small adapter is trained, it's not always sufficient for tasks needing deep behavioral change — it excels at style, tone, and format shifts, and is weaker for tasks that need the model to reason fundamentally differently. If LoRA-tuned results plateau below what the task needs, that's a signal to reconsider whether fine-tuning is even the right layer, not necessarily to jump straight to full fine-tuning.
:::

::: details Interview Question — Why LoRA made fine-tuning accessible
**Q:** Explain why LoRA reduced the resource requirements for fine-tuning so dramatically.
**A:** Full fine-tuning requires storing gradients and optimizer state for every parameter in the model, which for a multi-billion-parameter model demands enormous GPU memory. LoRA freezes the original weights entirely and only trains small, low-rank adapter matrices injected alongside them — often under 1% of total parameters — so the memory and compute needed scales with the tiny adapter, not the full model. QLoRA compounds this by also loading the frozen base model in 4-bit precision, which is why fine-tuning that once needed a GPU cluster can now run on a single consumer GPU.
:::

::: details Interview Question — LoRA adapters vs separate fine-tuned models
**Q:** A product needs fine-tuned behavior for three different customer segments. How does LoRA change the deployment approach compared to full fine-tuning?
**A:** With full fine-tuning, each segment needs its own complete fine-tuned model — three full-size models to store and serve. With LoRA, you keep one shared base model and train three small, separate adapters, one per segment, then swap the active adapter per request without reloading the base model. This is both cheaper to store and faster to switch between than maintaining three independent full models.
:::

## Key Mental Models

**LoRA trains a small addition, not the whole model.** The original weights stay frozen and untouched.

**One base model can serve many task-specific adapters.** That's a fundamentally lighter deployment shape than full fine-tuning.

## Related

- [10.1 Fine-Tuning Overview](./01-fine-tuning-overview) — the broader decision this technique serves
- [9.4 Quantization](/ai-engineering/module-09/04-quantization) — the technique QLoRA borrows for the frozen base
- [10.3 When to Fine-Tune](./03-when-to-fine-tune) — deciding if you need this at all
