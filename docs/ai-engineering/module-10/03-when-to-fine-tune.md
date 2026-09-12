---
title: When to Fine-Tune
outline: deep
---

# When to Fine-Tune

Fine-tuning is the most over-reached-for tool in this track — teams jump to it when a better prompt or a retrieval layer would have solved the problem for a tenth of the cost and none of the retraining overhead.

::: tip Plain English
Fine-tuning is a genuinely useful tool that's also genuinely expensive to reach for prematurely — like hiring a specialist consultant when a clearer set of instructions to your existing team would have solved it. Worth doing when the problem actually calls for it; wasteful when a cheaper fix was available and nobody checked.
:::

## The decision, in order

Work through cheaper options first — this is the full version of the ladder introduced in [4.1](/ai-engineering/module-04/01-when-you-need-retrieval):

1. **Better prompting** — is the model capable of this but phrasing or formatting it wrong? Fix the prompt first; it's nearly free to iterate on.
2. **More context** — does it just need the right information at request time? Add it directly if the set is small and stable.
3. **RAG** — does it need access to a large or changing knowledge base? Retrieval, not retraining.
4. **Fine-tuning** — does it need a genuine, consistent shift in *behavior*, *style*, or *format* that the above can't achieve reliably?

Reach step 4 only after steps 1–3 have been genuinely tried, not assumed insufficient.

## Signals it's actually time

- The same behavior is being coaxed through an increasingly long, brittle prompt, and it's still inconsistent
- The task needs domain-specific patterns (legal phrasing, medical terminology) the base model under-represents
- You're at high enough volume that shrinking the prompt via fine-tuning meaningfully cuts cost
- The knowledge involved is stable, not changing week to week — otherwise it belongs in retrieval

| Signal | Points toward |
|---|---|
| "The model just doesn't have this information" | RAG |
| "The model has the knowledge but won't format/phrase it right, consistently" | Fine-tuning |
| "It works with examples in the prompt but not without" | Fine-tuning (bake in the pattern) |
| "It's wrong sometimes, in ways that seem random" | Better prompting or evaluation first — diagnose before assuming it needs retraining |

::: warning Watch out
Fine-tuning locks in a snapshot. If the underlying task, tone, or policy changes, the fine-tuned model doesn't update itself — you retrain. This is exactly why fine-tuning is wrong for anything that changes regularly (pricing, policies, current events) and right mainly for durable behavior (tone, format, domain conventions) that isn't expected to shift often.
:::

::: details Interview Question — A team wants to fine-tune to "teach the model our product"
**Q:** A team wants to fine-tune a model on your product documentation so it "knows the product." Is that the right approach?
**A:** Usually not — that's a knowledge problem, and knowledge that can change (features, pricing, docs updates) belongs in RAG, not baked into weights via fine-tuning. Fine-tuning would need to be re-run every time the documentation changes, which doesn't scale. Redirect toward RAG for the factual grounding, and reserve fine-tuning for something else entirely — like teaching consistent formatting or tone in how the product is discussed.
:::

::: details Interview Question — Justifying fine-tuning against a real cost estimate
**Q:** How would you build the case for fine-tuning to a stakeholder skeptical of the added complexity?
**A:** Show that cheaper options were tried first and genuinely fell short — not assumed to. Present concrete evidence: prompt engineering plateaued at some measured quality level, or per-call cost is high enough at current volume that a shrunk fine-tuned prompt pays for the training cost within a defined period. Ground it in the golden dataset scores before and after prompting attempts, not "the prompt feels long."
:::

## Key Mental Models

**Fine-tuning is the last step, not the first.** Most problems attributed to "the model doesn't know this" are solved by prompting or retrieval.

**It's for durable behavior, not changing knowledge.** Anything that updates regularly belongs in retrieval instead.

## Related

- [4.1 When You Need Retrieval](/ai-engineering/module-04/01-when-you-need-retrieval) — the earlier rungs of this same ladder
- [10.1 Fine-Tuning Overview](./01-fine-tuning-overview) — what fine-tuning is actually good for
- [1.2 Prompt Engineering](/ai-engineering/module-01/02-prompt-engineering) — the cheapest rung, tried first
