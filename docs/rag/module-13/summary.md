---
title: Module 13 Summary — Evaluation
outline: deep
---

# Module 13 Summary — Evaluation

## Mental Models Gained

1. **Two-stage diagnosis:** RAG failures can be retrieval failures or generation failures. Per-stage metrics tell you which. End-to-end metrics alone leave you guessing.

2. **Retrieval metric hierarchy:** Hit Rate asks "did we find anything?", Recall asks "did we find everything?", Precision asks "did we avoid junk?", MRR asks "is the best on top?", NDCG asks "is the full ranking good?" Choose based on what matters for your system.

3. **Faithfulness is the RAG-native metric:** It uniquely measures whether the LLM stayed grounded in retrieved context. Correctness measures something different -- whether the answer matches ground truth (which requires ground truth to exist).

4. **LLM judges need calibration:** Automated evaluation is scalable but drifts. Human evaluation is expensive but provides ground truth. Use both -- LLM judges for 100% coverage, humans for 5-10% calibration.

5. **Eval datasets are infrastructure:** A well-maintained evaluation dataset with diverse, adversarial, and realistic questions is more valuable than any particular framework.

## Self-Assessment Checklist

- [ ] Can you write the formula for Recall@K, Precision@K, MRR, and NDCG from memory?
- [ ] Can you compute NDCG by hand given a ranked list with graded relevance?
- [ ] Can you explain why faithfulness can be high while correctness is low?
- [ ] Can you design an evaluation prompt for LLM-as-judge with calibration mitigations?
- [ ] Can you outline a continuous evaluation pipeline (offline + online)?
- [ ] Can you design an A/B test comparing two chunking strategies with statistical rigor?
- [ ] Can you explain when human evaluation is worth the cost?

## Quick Reference

| Metric | Type | Needs Ground Truth | Position-Aware |
|--------|------|-------------------|----------------|
| Recall@K | Retrieval | Yes | No |
| Precision@K | Retrieval | Yes | No |
| Hit Rate@K | Retrieval | Yes | No |
| MRR | Retrieval | Yes | Yes (first hit) |
| NDCG@K | Retrieval | Yes | Yes (all) |
| Faithfulness | Generation | No | N/A |
| Answer Relevance | Generation | No | N/A |
| Answer Correctness | Generation | Yes | N/A |
