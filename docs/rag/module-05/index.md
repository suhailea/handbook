---
title: Module 5 — Chunking
outline: deep
---

# Module 5 — Chunking

Chunking is where your RAG pipeline either preserves meaning or destroys it. You are deciding what unit of text becomes a single row in your vector database — and therefore what the LLM sees when it answers a question. Get this wrong, and no amount of fancy retrieval can save you.

This module covers every production-relevant chunking strategy, how to choose chunk size, why overlap exists, and how to evaluate whether your chunks are actually working.

## Why This Module Matters

- **Chunking is the highest-leverage knob in RAG.** Changing your chunking strategy often improves answer quality more than swapping embedding models or vector databases.
- **There is no universal best strategy.** The right approach depends on your document types, query patterns, and embedding model.
- **Bad chunks are invisible failures.** Unlike a crash or a timeout, a poorly chunked document silently degrades answer quality. You only catch it with evaluation.

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|:---:|
| [Chunking Strategies](01-chunking-strategies.md) | Every strategy from fixed-size to late chunking, with trade-offs | 🔥🔥🔥 |
| [Chunk Size, Overlap & Evaluation](02-chunk-size.md) | Sizing decisions, overlap math, benchmarking approach | 🔥🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |  |

## Prerequisites

- [Module 3 — Document Parsing](/rag/module-03/) — you need parsed text before you can chunk it
- [Module 4 — Text Extraction](/rag/module-04/) — understanding what your raw text looks like
