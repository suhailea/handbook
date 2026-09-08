---
title: Module 0 — ML Foundations
outline: deep
---

# Module 0 — ML Foundations

Before we touch the API, let's understand what we're working with. Not the math — the mental model.

You're about to build TaskFlow's AI support agent. You'll be calling endpoints, wiring up streaming responses, handling tool calls, and designing retry logic. But at some point you'll run into weird behavior and ask: *why did it say that? Why does this model cost twice as much? Why is this faster than that?* If you don't have the right mental model of what's happening under the hood, those questions will feel like black-box mysteries.

This module is the antidote. Four short pages, no equations, no academic jargon. Just the concepts you need to reason clearly about AI systems as an engineer.

## What's in this module

- **[0.1 — How Transformers Work](/ai-engineering/module-00/01-how-transformers-work)** — What makes the architecture special, and why "predicting the next word" undersells it
- **[0.2 — Training vs Inference](/ai-engineering/module-00/02-training-vs-inference)** — Two very different problems with very different cost profiles
- **[0.3 — Embeddings](/ai-engineering/module-00/03-embeddings)** — How meaning becomes math, and why that powers semantic search and RAG
- **[0.4 — RLHF & Alignment](/ai-engineering/module-00/04-rlhf)** — How raw capability gets shaped into something you can actually ship to users

::: tip Why this comes first
Every other module in this track assumes you have these four mental models. When Module 2 talks about context windows, that's about transformer attention. When Module 3 talks about inference cost, that's training-vs-inference. When Module 4 talks about fine-tuning, that's the RLHF pipeline. This isn't background reading — it's the load-bearing foundation.
:::

---

[Next: 0.1 How Transformers Work →](/ai-engineering/module-00/01-how-transformers-work)
