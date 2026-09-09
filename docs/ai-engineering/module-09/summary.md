---
title: Module 9 Summary — LLMOps & Evaluation
outline: deep
---

# Module 9 Summary — LLMOps & Evaluation

## What you built

The measurement and operational discipline for AI systems in production: how to measure retrieval quality, generation quality, and operational health; how to build an evaluation pipeline that acts as a CI gate; and how to safely deploy changes to prompts, models, and architectures.

## 6 Mental Models to Take Forward

1. **RAG has two independent failure modes**: retrieval failure (wrong documents found) and generation failure (wrong answer from right documents). Measure both separately — a single quality score hides which component broke.

2. **Faithfulness ≠ Correctness**: a faithful answer to a wrong document is still wrong. You need both: faithfulness (LLM stuck to context) and correctness (context was right). Monitor source document quality separately.

3. **Golden dataset = unit tests for AI quality**: curated, human-verified test cases that must be run before every deployment. Version them alongside system prompts.

4. **LLM-as-Judge scales, but biases must be managed**: calibrate against human labels, use fixed judge model versions, score dimensions separately (correctness, faithfulness, relevance) to reduce holistic bias.

5. **Prompt is code — treat it that way**: version control, code review, evaluation gate before promotion to production. Un-gated prompt changes are the most common source of silent quality regressions.

6. **A/B tests need statistical power and quality metrics** — task completion rate and LLM judge score, not session length or click metrics which measure engagement rather than quality.

## Self-Assessment Checklist

- [ ] Can you explain the difference between Recall@K and MRR and give a scenario where each is the better metric?
- [ ] Can you explain the difference between faithfulness and correctness in RAG evaluation?
- [ ] Can you describe the three components of a production AI evaluation pipeline?
- [ ] Can you explain why you pin model versions and what happens if you don't?
- [ ] Can you calculate the minimum sample size for an A/B test given a detectable effect size?
- [ ] Can you describe how to run a red team sweep and what categories it must cover?

## Next Module

[Module 10 — AI Infrastructure & Cloud](../module-10/) covers the infrastructure that runs these systems at scale: Docker for AI workloads, Kubernetes for AI services, Azure OpenAI and AKS, and GPU-based model serving.
