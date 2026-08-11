---
title: Module 13 — Evaluation
outline: deep
---

# Module 13 — Evaluation

You can build the most sophisticated RAG pipeline in the world, but without measurement you are flying blind. This module teaches you how to **quantify** retrieval quality, generation quality, and system performance -- and how to build evaluation into a continuous feedback loop.

## Why Evaluation Is Hard in RAG

RAG systems have **two stages** that can fail independently:

1. **Retrieval** can return the wrong documents (the LLM never sees the right context).
2. **Generation** can hallucinate even when given perfect context.

A single end-to-end metric ("was the answer correct?") cannot tell you *which stage* broke. You need metrics at each stage, and you need frameworks to run them at scale.

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|-----------------|
| [Retrieval & Generation Metrics](01-metrics.md) | Recall@K, MRR, NDCG, Faithfulness, system metrics | 🔥🔥🔥 |
| [Evaluation Frameworks & Datasets](02-frameworks.md) | RAGAS, LLM-as-judge, human eval, A/B testing | 🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |

## Prerequisites

- [Retrieval fundamentals](/rag/module-05/) -- understand what retrieval returns
- [Generation & prompting](/rag/module-08/) -- understand how context becomes answers
- Basic statistics (mean, percentiles, ranking)
