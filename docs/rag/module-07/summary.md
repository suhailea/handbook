---
title: Module 7 Summary — Embeddings
outline: deep
---

# Module 7 Summary — Embeddings

## Mental Models

1. **Embeddings are lossy semantic compression.** They capture meaning direction in N-dimensional space but lose exact terms, acronyms, and rare vocabulary. Hybrid search (dense + sparse) compensates for what dense embeddings miss.

2. **Cosine similarity is the safe default.** It measures direction, ignoring magnitude. For normalized vectors (OpenAI, Cohere, Jina), dot product is equivalent and faster. Use it.

3. **More dimensions ≠ always better.** The quality-to-cost ratio often peaks at 768-1024 dimensions. Double the dimensions for a 1-2% MTEB improvement is rarely worth double the storage and slower queries.

4. **Instruction prefixes are load-bearing.** Models that require "query:" / "passage:" prefixes produce meaningfully worse embeddings without them. This is a silent quality degradation with no error.

5. **Your embedding model is infrastructure, not a config option.** Changing it requires re-embedding your entire corpus — a costly, multi-day operation. Choose carefully, version everything, and build your pipeline for migration from the start.

6. **Blue-green is the only safe migration pattern.** Embed into a new collection, validate with your eval set, switch atomically, keep the old collection for rollback. Never mix vectors from different models.

7. **Batch everything.** One embedding per API call is orders of magnitude slower. Batch to the API maximum (2048 for OpenAI) and add concurrency for large corpora.

8. **Cache query embeddings by model+text.** Deterministic models produce the same vector for the same input. Cache with model name in the key so model upgrades automatically invalidate stale entries.

## Self-Assessment Checklist

- [ ] I can explain dense vs sparse embeddings and why production systems use both
- [ ] I understand cosine similarity, dot product, and Euclidean distance — and when each applies
- [ ] I can compare 5+ embedding models on dimensions, max tokens, quality, cost, and language support
- [ ] I know which models require instruction prefixes and what happens when you omit them
- [ ] I can design a blue-green embedding migration with zero downtime
- [ ] I understand the embedding lock-in problem and how to prepare for model changes
- [ ] I can implement batched embedding with rate-limit handling
- [ ] I know how Matryoshka representations work and when to use dimension reduction
- [ ] I can design an embedding cache with correct cache keys (model-aware)
