---
title: Module 10 — Query Processing
outline: deep
---

# Module 10 — Query Processing

This module covers everything that happens to a user's query before it hits the retrieval engine — rewriting, expansion, decomposition, HyDE (Hypothetical Document Embeddings), classification, and routing. These transformations bridge the gap between how humans ask questions and how retrieval systems find answers.

## Why This Module Matters

Users ask messy questions: vague, ambiguous, multi-part, full of pronouns referencing earlier conversation. The retrieval engine needs clean, specific queries. Query processing is the translator between human intent and machine retrieval. Skip it, and you leave 20-40% of recall on the table.

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|-----------------|
| [Query Transformations](01-query-transformations.md) | Rewriting, expansion, decomposition, HyDE, multi-query | 🔥🔥🔥 |
| [Routing & Classification](02-routing-classification.md) | Classification, routing, the decision pipeline | 🔥🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |

## Prerequisites

- [Retrieval Strategies](../module-09/01-retrieval-strategies.md) — understand what retrieval pipelines expect
- [Embedding Models](../module-07/01-embeddings-similarity.md) — how queries and documents are embedded
