---
title: Module 11 Summary — Reranking & Context Construction
outline: deep
---

# Module 11 Summary — Reranking & Context Construction

## Mental Models Gained

1. **Two-stage retrieval is the production pattern.** Bi-encoder for recall (fast, over millions), cross-encoder for precision (slow, over dozens). Neither alone is sufficient for production RAG.

2. **Reranking improves precision, not recall.** If the relevant document was never retrieved, the reranker cannot find it. Fix retrieval first, then add reranking for precision.

3. **Security filtering must happen before reranking.** Never let a reranker score (and risk surfacing) documents the user should not access.

4. **Context is not "more is better."** The optimal context is the minimum needed for a correct answer. Excess context adds noise, cost, latency, and triggers quality degradation.

5. **Lost-in-the-middle is real.** LLMs attend most to the beginning and end of context. Place the most important chunks at positions 1 and K, not only at position 1.

6. **Deduplication is mandatory** after hybrid search and multi-query retrieval. Without it, the same information occupies multiple context slots.

7. **Citation labels enable verifiability.** Assign them as the final step after all filtering and ordering to avoid label-source mismatches.

## Self-Assessment Checklist

- [ ] I can explain the architectural difference between bi-encoder and cross-encoder and why this creates the two-stage pattern
- [ ] I can name specific reranker models and compare their trade-offs (Cohere Rerank, BGE, cross-encoder/ms-marco)
- [ ] I can describe when LLM reranking is better than dedicated rerankers
- [ ] I can calculate a token budget and select the right number of chunks
- [ ] I can explain the lost-in-the-middle effect and implement attention-optimized ordering
- [ ] I can implement deduplication at three levels: ID match, content hash, semantic similarity
- [ ] I can enforce source diversity across retrieved chunks
- [ ] I can assemble a final prompt with system message, citation-labeled context, and output instructions
- [ ] I can explain why security filtering must precede reranking
- [ ] I can design a domain-specific reranking strategy (e.g., recency boost for customer support)
