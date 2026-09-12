---
title: Module 10 — Fine-Tuning
outline: deep
---

# Module 10 — Fine-Tuning

The model was good. But it didn't know TaskFlow's internal terminology, tone, or specific workflows. We considered fine-tuning.

Our support agent kept calling the product "the software." It would suggest menu paths that didn't exist in TaskFlow's actual UI. When users asked about TaskFlow-specific features like "Task Streams" or "Workspace Templates," the agent guessed — sometimes correctly, often not.

The instinct: fine-tune the model on our data. But fine-tuning is expensive, complicated, and often the wrong answer. This module covers when it's actually the right call.

## Pages in this module

1. [Fine-Tuning — Teaching the Model New Tricks](./01-fine-tuning-overview) — what fine-tuning does and what it doesn't
2. [LoRA & QLoRA — Fine-Tuning Without the GPU Bill](./02-lora-qlora) — efficient adaptation techniques
3. [When to Fine-Tune (and When Not To)](./03-when-to-fine-tune) — the decision tree
4. [Summary](./summary) — 4 mental models to take forward
