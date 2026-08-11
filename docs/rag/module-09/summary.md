---
title: Module 9 Summary — Retrieval & Hybrid Search
outline: deep
---

# Module 9 Summary — Retrieval & Hybrid Search

## Mental Models Gained

1. **Dense retrieval finds meaning; BM25 finds words.** Neither alone covers all query types in production RAG.

2. **Every retrieval strategy trades latency, recall, and precision.** Multi-query and HyDE boost recall at latency cost. Metadata filtering boosts precision at recall cost. Know which lever you are pulling.

3. **Hybrid search is the production default.** Running dense + BM25 in parallel and fusing results covers the complementary failure modes of each approach.

4. **RRF is the safe fusion default.** It uses only rank positions, sidestepping the score normalization problem. Weighted fusion is more expressive but requires calibrated normalization and tuned alpha.

5. **Score normalization is non-negotiable.** Raw scores from different engines are on different scales. Combining without normalizing effectively ignores the lower-scale retriever.

6. **HyDE bridges the register gap** between questions and documents but fails when the LLM cannot approximate the answer domain.

7. **Retrieval quality is the ceiling for RAG quality.** No amount of reranking, prompt engineering, or model capability compensates for failing to retrieve the right document.

## Self-Assessment Checklist

- [ ] I can explain the failure modes of dense-only and BM25-only retrieval with concrete examples
- [ ] I can implement BM25 scoring from the formula and explain each component (TF, IDF, length normalization)
- [ ] I can explain when to use hierarchical retrieval vs parent-document retrieval
- [ ] I can describe HyDE, when it helps, and when it hurts
- [ ] I can compute RRF scores by hand given two ranked lists
- [ ] I can explain why raw scores from different engines cannot be directly combined
- [ ] I know when to use min-max vs z-score normalization
- [ ] I can implement hybrid search in PostgreSQL using pgvector + tsvector
- [ ] I can explain the trade-offs between PostgreSQL hybrid and dedicated vector databases
- [ ] I can design a retrieval strategy for a system that handles both semantic and exact-term queries
