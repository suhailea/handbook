---
title: Module 12 — Generation & Hallucination
outline: deep
---

# Module 12 — Generation & Hallucination

This module covers the final stage of the RAG pipeline: grounded generation and the hallucination problem. How to make the LLM stay faithful to retrieved context, how to detect when it drifts, and how to build layered defenses against fabrication.

## Why This Module Matters

Generation is where value is created — and where trust is destroyed. A single hallucinated fact in a legal, medical, or financial RAG system can have real consequences. Understanding how to ground generation, detect hallucination, and build defense-in-depth is what separates toy demos from production systems.

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|-----------------|
| [Grounded Generation](01-grounded-generation.md) | System prompts, citation, abstention, temperature, structured output | 🔥🔥🔥 |
| [Hallucination — Causes, Detection & Mitigation](02-hallucination.md) | Types, root causes, detection pipelines, mitigation strategies | 🔥🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |

## Prerequisites

- [Context Construction](../module-11/02-context-construction.md) — how the prompt is assembled
- [Reranking](../module-11/01-reranking.md) — ensuring high-quality context
- [Retrieval Strategies](../module-09/01-retrieval-strategies.md) — retrieval failures cause hallucination
