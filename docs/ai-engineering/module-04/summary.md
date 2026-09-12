---
title: Module 4 Summary — RAG, The Bridge
outline: deep
---

# Module 4 Summary — RAG, The Bridge

## What you built

Not a RAG system — a decision. This module is the adaptation ladder that tells you when prompting or added context is enough, when the knowledge base is large or changing enough to need retrieval, and when the behavior you want is durable enough to justify fine-tuning instead. It's deliberately short: retrieval itself is a large enough subject to have its own 18-module track.

## 2 Mental Models to Take Forward

1. **Most "the model doesn't know X" problems are retrieval problems, not fine-tuning problems.** Facts change; fine-tuning bakes a snapshot into weights that doesn't update itself. If the knowledge is stable and small, add it to context. If it's large or changing, that's RAG.

2. **RAG is for when you don't know exactly which record you need.** If you do — a ticket ID, a known account — that's a direct tool call, not a similarity search. Reaching for retrieval when a lookup would do adds latency and unreliability for no benefit.

## Self-Assessment Checklist

- [ ] Can you walk through the adaptation ladder and give a concrete example that fits each rung?
- [ ] Can you explain why RAG is preferred over fine-tuning for a fact that changes monthly?
- [ ] Can you distinguish a retrieval problem from a direct-lookup problem in a real tool design?

## Next Module

Once retrieval is in place — using the [Production RAG](/rag/) track — come back to [Module 5 — Evaluation](/ai-engineering/module-05/). This is where RAG-grounded agents and pure agents converge: both need the same answer to "is this actually working."
