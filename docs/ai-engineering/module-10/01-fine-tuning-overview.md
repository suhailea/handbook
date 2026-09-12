---
title: Fine-Tuning Overview
outline: deep
---

# Fine-Tuning Overview

Prompting and RAG cover most needs. Fine-tuning is the expensive last rung of the adaptation ladder — actually updating a model's weights on your own data, rather than shaping what goes into its context. It's real training, at a smaller scale than pretraining, with real cost and real risk.

::: tip Plain English
If RAG is handing someone the right reference book before they answer, fine-tuning is sending them back to school for a focused course. It changes what they inherently know how to do, not what's on the desk in front of them — and like actual schooling, it's slower, more expensive, and harder to undo than just handing over a better reference.
:::

## What actually happens

You take a pretrained model and continue training it on a smaller, task-specific dataset — thousands to low-millions of examples, versus the trillions used in pretraining. The weights genuinely shift. This is the same category of process covered in [0.2 Training vs Inference](/ai-engineering/module-00/02-training-vs-inference), just later in the pipeline and on your own data instead of the original training corpus.

```
Pretraining  → general capability, trillions of tokens, run by the lab
Fine-tuning  → your data, thousands–millions of examples, run by you
                shifts style, format, domain vocabulary, task-specific behavior
```

## What it's actually good for

**Consistent style or format** — a specific tone, a specific output structure, applied reliably without needing few-shot examples in every prompt.

**Domain vocabulary and patterns** — legal, medical, or highly technical domains where the base model's general training under-represents the specific terminology and conventions.

**Reducing prompt length at scale** — if you're currently achieving a behavior through a long, carefully engineered prompt repeated on every call, fine-tuning can bake that behavior in and shrink the prompt, which also reduces per-call cost.

**What it's poor at:** teaching new facts (see [4.1](/ai-engineering/module-04/01-when-you-need-retrieval) — that's RAG's job, since facts change and fine-tuning doesn't update easily), and it won't reliably fix a model that's fundamentally the wrong size or capability tier for the task.

| Need | Fine-tuning fit |
|---|---|
| Consistent tone/format at scale | Good |
| Domain-specific terminology | Good |
| Teaching new, changing facts | Poor — use RAG |
| Fixing weak base reasoning | Poor — different model needed |

::: warning Watch out
Fine-tuning can quietly degrade general capability — a model tuned hard on narrow support-ticket data can get measurably better at that task while getting worse at everything else, a failure called catastrophic forgetting. Always evaluate the fine-tuned model on both the target task *and* a general capability check before shipping, not just the target task in isolation.
:::

::: details Interview Question — Fine-tuning vs a longer prompt
**Q:** A team achieves a specific output style through a long, carefully engineered system prompt. When would you recommend fine-tuning instead?
**A:** When that prompt is repeated on every call at real volume and the cost of the extra tokens outweighs the fine-tuning investment, or when the style needs to be more reliable than prompting achieves even with careful engineering. Fine-tuning bakes the behavior into weights, so the prompt can shrink dramatically. It's not worth it at low volume — the fine-tuning setup and evaluation cost exceeds the token savings.
:::

::: details Interview Question — Detecting catastrophic forgetting
**Q:** How would you check whether a fine-tuned model has lost general capability while gaining task-specific performance?
**A:** Run the fine-tuned model against both your target-task golden dataset and a separate, general-capability evaluation set unrelated to the fine-tuning task, then compare both to the base model's scores. A model that improved on the target task but dropped meaningfully on general tasks is exhibiting catastrophic forgetting — the fix is usually a lower learning rate, fewer training epochs, or techniques like LoRA ([10.2](./02-lora-qlora)) that constrain how much the weights can shift.
:::

## Key Mental Models

**Fine-tuning changes weights; it's real training, at smaller scale.** Different category of thing than prompting or context.

**It's for behavior and style, not facts.** Facts belong in retrieval, which can be updated without retraining.

**Always evaluate general capability, not just the target task.** Narrow improvement can hide broad regression.

## Related

- [10.2 LoRA & QLoRA](./02-lora-qlora) — the practical, affordable way most fine-tuning happens
- [10.3 When to Fine-Tune](./03-when-to-fine-tune) — the fuller decision framework
- [4.1 When You Need Retrieval](/ai-engineering/module-04/01-when-you-need-retrieval) — the other branch of this decision
