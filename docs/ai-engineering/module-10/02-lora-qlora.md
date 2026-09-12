---
title: LoRA & QLoRA — Fine-Tuning Without the GPU Bill
outline: deep
---

# LoRA & QLoRA — Fine-Tuning Without the GPU Bill

Full fine-tuning Llama 3 8B required 80GB of VRAM. LoRA let us do it on a single 24GB GPU.

::: tip Plain English
Imagine you've hired a world-class consultant. You don't want to replace their entire knowledge base — that would take years. Instead, you give them a small overlay: a few extra pages of notes that adjust how they apply their existing expertise to your specific situation.

LoRA (Low-Rank Adaptation) is that overlay. Instead of updating every single parameter in the model (there are billions), LoRA adds a small set of new trainable parameters — a tiny "adapter" — on top of the frozen original model.

You train just the adapter. The original model weights don't change. The adapter is small, cheap to train, and can be swapped in and out. You can have multiple adapters for different tasks and switch between them without reloading the base model.
:::

## How LoRA works (without the math)

A model layer is essentially a large matrix of numbers — billions across all layers. Updating all of these during fine-tuning is expensive: it requires storing the gradients for every weight, which costs as much memory as the model itself.

LoRA's insight: for most fine-tuning tasks, you don't need to update all those weights independently. The changes needed can be captured by adding two small matrices (low-rank approximations) to each layer. Instead of updating a 4096×4096 matrix (16M parameters), you add two matrices of size 4096×8 and 8×4096 (65k parameters). You train those.

Result: the trainable parameters go from billions to millions. Memory requirement drops dramatically.

## What you get from LoRA

The output of LoRA fine-tuning is an **adapter file** — a small file (usually 10–200MB) that contains just the learned adjustments. The base model (which might be 15GB) stays unchanged.

To deploy:
- Load the base model once
- Load the adapter on top
- Inference proceeds as if it were a fine-tuned model

You can maintain multiple adapters for different purposes (one for response formatting, one for our billing specialist, one for technical support) and load whichever is appropriate per request. This is called multi-LoRA serving.

## QLoRA — even smaller

QLoRA combines LoRA with quantization. The base model is loaded in 4-bit quantized format (very low memory), and LoRA adapters are trained in 16-bit on top of it.

This lets you fine-tune models that you couldn't even fit in GPU memory in full precision:

| Setup | VRAM needed for Llama 3 8B fine-tune |
|-------|--------------------------------------|
| Full fine-tuning (FP16) | ~80GB |
| LoRA (FP16 base) | ~24GB |
| QLoRA (4-bit base + LoRA) | ~12GB |

With QLoRA, you can fine-tune a 13B model on a single 24GB GPU. A 70B model is feasible on two 24GB GPUs.

The quality tradeoff: QLoRA is very slightly below full LoRA, which is slightly below full fine-tuning. For most tasks, the difference is negligible.

## LoRA vs full fine-tuning

| | Full fine-tuning | LoRA | QLoRA |
|---|---|---|---|
| VRAM (8B model) | ~80GB | ~24GB | ~12GB |
| Training time | Slow | Faster | Fastest |
| Quality | Best | Very close | Slightly below LoRA |
| Flexibility | New model entirely | Adapter (swappable) | Adapter (swappable) |
| Use when | You have the resources and need maximum quality | Most fine-tuning use cases | Limited GPU, similar quality to LoRA |

## When to use LoRA vs full fine-tuning

::: tip Use LoRA/QLoRA when
- You don't have access to 4x A100s (most teams)
- You need multiple task-specific adapters from one base model
- You're experimenting and want to iterate quickly
- Budget is a constraint — LoRA is 5–10x cheaper to train
:::

::: tip Use full fine-tuning when
- You have the compute and need maximum possible quality
- You're preparing a production model that will be served at scale (merge the adapter, no overhead)
- The task requires very deep behavioral changes that LoRA struggles with
:::

For TaskFlow: we used QLoRA to train a billing intent classifier on top of a 7B model. Training took 4 hours on a single A10G GPU (rented for $1.50/hr = $6 total). The resulting adapter is 40MB and loads in under a second on top of the base model.

::: details Interview Question — LoRA mechanics
**Q:** Explain what LoRA does and why it reduces memory requirements during fine-tuning.

**A:** LoRA adds pairs of small trainable matrices (low-rank decomposition) to each attention layer of a frozen base model. Instead of computing gradients for billions of base model parameters, you only compute gradients for the much smaller LoRA matrices — typically reducing trainable parameters by 100–10,000x. This matters for memory because optimizer states (Adam stores two momentum values per trainable parameter) are the main fine-tuning memory cost. Fewer trainable parameters = much smaller optimizer state = fits in GPU memory. During inference, the LoRA matrices can be merged into the base model weights (adding their contribution back in) so there's zero inference overhead. Or they can be kept separate as an adapter, which allows swapping between different LoRA adapters without reloading the base model.
:::
