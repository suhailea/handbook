---
title: Module 7 — Embeddings
outline: deep
---

# Module 7 — Embeddings

Embeddings are the bridge between human language and machine-searchable vectors. This module covers how they work, which metrics compare them, how to choose a model, and the operational reality of living with your choice.

## Why This Module Matters

- **Your embedding model is your retrieval bottleneck.** No retrieval strategy can find what the embeddings did not capture.
- **Model choice is a long-term commitment.** Changing embedding models means re-embedding your entire corpus — a costly operation.
- **Similarity metrics matter more than people think.** Using the wrong distance function silently degrades retrieval quality.

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|:---:|
| [Embedding Models & Similarity Metrics](01-embeddings-similarity.md) | Dense vs sparse, distance metrics, model comparison | 🔥🔥🔥 |
| [Model Selection, Re-embedding & Migration](02-model-selection.md) | Decision framework, lock-in, blue-green migration | 🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |  |

## Prerequisites

- [Module 5 — Chunking](/rag/module-05/) — chunks are what you embed
- [Module 6 — Metadata](/rag/module-06/) — embedding_model stored as metadata
