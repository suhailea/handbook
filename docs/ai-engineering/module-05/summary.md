---
title: Module 5 Summary — Evaluation
outline: deep
---

# Module 5 Summary — Evaluation

## What you built

The measurement and operational discipline for AI systems in production: how to measure retrieval quality, generation quality, and operational health; how to build an evaluation pipeline that acts as a CI gate; and how to safely deploy changes to prompts, models, and architectures.

## 5 Mental Models to Take Forward

1. **RAG has two independent failure modes**: retrieval failure (wrong documents found) and generation failure (wrong answer from right documents). Measure both separately — a single quality score hides which component broke.

2. **Faithfulness ≠ Correctness**: a faithful answer to a wrong document is still wrong. You need both: faithfulness (LLM stuck to context) and correctness (context was right).

3. **Golden dataset = unit tests for AI quality**: curated, human-verified test cases that must be run before every deployment. Version them alongside system prompts.

4. **LLM-as-Judge scales, but biases must be managed**: calibrate against human labels, use fixed judge model versions, score dimensions separately to reduce holistic bias.

5. **A regression gate beats a vibe check**: run the golden dataset before and after every prompt or model change, and pairwise-compare when scores are close — "feels better" isn't a measurement.

## Self-Assessment Checklist

- [ ] Can you explain the difference between Recall@K and MRR and give a scenario where each is the better metric?
- [ ] Can you explain the difference between faithfulness and correctness in RAG evaluation?
- [ ] Can you describe the three components of a production AI evaluation pipeline?
- [ ] Can you calibrate an LLM-as-judge against human labels and explain what agreement threshold means the judge isn't trustworthy yet?
- [ ] Can you describe how to run a red team sweep and what categories it must cover?

## Next Module

[Module 6 — Observability & LLMOps](/ai-engineering/module-06/) covers what happens once evaluation says a system works: tracing agent runs in production, operational metrics, and safely deploying changes to prompts and models.
