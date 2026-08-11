---
title: Module 5 Summary — Chunking
outline: deep
---

# Module 5 Summary — Chunking

## Mental Models

1. **Chunking is a retrieval decision.** Every split determines what the vector search can find and what context the LLM receives. Bad chunks produce bad answers regardless of everything else in the pipeline.

2. **No universal strategy exists.** Fixed-size is a prototype. Recursive is a solid default. Semantic and late chunking are premium options for high-value corpora. Structure-aware is mandatory for documents with headers/sections. Code and tables require specialized treatment.

3. **Contextual prepending is the highest-ROI improvement.** Adding section titles, document names, or LLM-generated summaries to each chunk dramatically improves retrieval quality at low cost.

4. **Parent-child is the architect's answer to "precision vs context."** Small chunks for search, large chunks for the LLM. More complex to build but solves the fundamental tension.

5. **Chunk size is empirical, not dogmatic.** "Use 500 tokens" is a starting point. The optimal size depends on your embedding model's max tokens, your document types, your query patterns, and your cost constraints. The only way to find it is to measure.

6. **Silent truncation is catastrophic.** If your chunks exceed your embedding model's max tokens, the tail of each chunk is invisible to retrieval. No error, no warning — just missing answers.

7. **Overlap is insurance with a cost.** 10-20% overlap prevents boundary splits but increases storage. Semantic and structure-aware strategies may not need it at all.

8. **Store your parameters.** `chunking_strategy`, `chunk_size`, `overlap` must live in chunk metadata. You will re-chunk. You need to know what you are re-chunking from.

## Self-Assessment Checklist

- [ ] I can name 6+ chunking strategies and explain when each is appropriate
- [ ] I can explain why recursive text splitting is a good default and when to move beyond it
- [ ] I understand the precision-vs-recall trade-off in chunk sizing
- [ ] I can design a parent-child chunking system and explain its query-time flow
- [ ] I know what silent truncation is and how to prevent it
- [ ] I can design a chunk evaluation experiment using Recall@K, Precision@K, and MRR
- [ ] I understand why overlap exists, when to use it, and when to skip it
- [ ] I can explain late chunking and why it produces better embeddings for reference-heavy documents
- [ ] I know why tables and code require specialized chunking strategies
