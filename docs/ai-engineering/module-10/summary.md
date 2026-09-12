---
title: Module 4 Summary — Fine-Tuning
outline: deep
---

# Module 4 Summary

Four things to remember from this module as TaskFlow's agent matures.

## Mental Models

**1. Fine-tuning changes how the model behaves — not what it knows.** This is the single most important distinction. Use fine-tuning for consistent behavior, tone, and format. Use RAG for knowledge. Confusing these is the most common (and expensive) mistake in AI engineering.

**2. Try prompting first, always.** Fine-tuning is surgery. Prompting is physical therapy. Almost every behavior problem can be significantly improved with few-shot examples and explicit instructions before you need to retrain the model. The bar for fine-tuning should be "prompting demonstrably doesn't solve this" — not "this might be better with fine-tuning."

**3. LoRA and QLoRA make fine-tuning accessible without expensive hardware.** Training only the adapter parameters rather than the full model reduces VRAM requirements by 5–10x. A meaningful fine-tune is achievable on a single A10G or even a high-end consumer GPU. The quality cost is small and usually acceptable.

**4. The strongest use case for fine-tuning is cost optimization, not quality.** Fine-tune a small model to do a specific high-volume task (classification, formatting) that currently runs on a large expensive model. This is a real engineering win: same quality, 10–50x cheaper per call.

## What's next

Module 5 is about operating the agent in production. The agent is built and running — now how do we know it's working, catch failures before users do, and keep it from going off the rails?
