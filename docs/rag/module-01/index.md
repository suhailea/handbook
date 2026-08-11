---
title: Module 1 — RAG Fundamentals
outline: deep
---

# Module 1 — RAG Fundamentals

This module builds the conceptual foundation. Before you choose a vector database, an embedding model, or a chunking strategy, you need a precise mental model of what RAG actually does, when it is the right tool, and when something simpler (or more complex) is the better choice.

Every engineering decision in later modules traces back to the concepts here. If you cannot explain to an interviewer why RAG beats fine-tuning for a live knowledge base, or why a 200K-context window does not eliminate the need for retrieval at scale, revisit this module.

## Pages in This Module

| # | Page | What You Will Learn |
|---|------|---------------------|
| 1 | [What Is RAG & When to Use It](01-what-is-rag.md) | The core loop (retrieve → augment → generate), offline vs online paths, decision flowchart for when RAG is and is not the right tool |
| 2 | [RAG vs Alternatives](02-rag-vs-alternatives.md) | Head-to-head comparisons: fine-tuning, long-context LLMs, traditional search, SQL, agents — with a decision matrix |
| — | [Summary](summary.md) | Mental models and self-assessment checklist |

## Prerequisites

- You should understand what an LLM is and how prompt-based generation works.
- Familiarity with embeddings (even at a high level: "text → vector → similarity") is helpful but not required — Module 5 covers embeddings in depth.

## What This Module Does NOT Cover

- How to chunk documents (Module 5)
- Which vector database to choose (Module 7)
- How to evaluate retrieval quality (Module 10)

Those are engineering decisions. This module is about understanding the *problem shape* so those decisions make sense.
