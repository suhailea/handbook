---
title: Module 9 — Retrieval & Hybrid Search
outline: deep
---

# Module 9 — Retrieval & Hybrid Search

This module covers the full spectrum of retrieval strategies — from dense vector search to sparse BM25 (a keyword-ranking algorithm), metadata filtering, hierarchical retrieval, HyDE (Hypothetical Document Embeddings), and graph traversal — then shows how to combine them with hybrid search and fusion algorithms for production-grade recall.

## Why This Module Matters

Retrieval quality is the ceiling for RAG answer quality. The best LLM in the world cannot produce a good answer from bad context. Most RAG failures trace back to retrieval: the right document existed in the corpus, but the retrieval pipeline did not surface it. This module gives you every lever to fix that.

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|-----------------|
| [Retrieval Strategies](01-retrieval-strategies.md) | Dense, sparse, BM25, metadata, hierarchical, HyDE, graph retrieval | 🔥🔥🔥 |
| [Hybrid Search & Fusion](02-hybrid-search.md) | RRF (Reciprocal Rank Fusion), weighted fusion, score normalization, production architectures | 🔥🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |

## Prerequisites

- [Embedding Models](../module-07/01-embeddings-similarity.md) — understand how text becomes vectors
- [Vector DB Internals](../module-08/01-vector-db-internals.md) — ANN indexes, HNSW, IVF
- [Chunking Strategies](../module-05/01-chunking-strategies.md) — how documents are split before retrieval
