---
title: Module 2 Summary — System Requirements
outline: deep
---

# Module 2 Summary — System Requirements

## Mental Models to Carry Forward

1. **Requirements eliminate architectures.** Every answered question removes options. By the time you finish the eight-category framework, the architecture is 80% decided.

2. **The latency budget is arithmetic.** Embedding (50-100ms) + search (10-50ms) + reranking (100-300ms) + LLM (1-3s) + network (50-100ms). If the sum exceeds your P95 target, a component must go. Do this math before writing code.

3. **Compliance is a day-one decision.** HIPAA, GDPR, multi-tenancy, data residency — retrofitting any of these is 10x more expensive than designing for them from the start.

4. **Cost per query is the true metric.** Monthly cost / monthly queries. This number must be in your requirements document. If it is not, you will have a surprise when traffic scales.

5. **Start with the hardest constraint.** The tightest requirement (compliance, latency, cost, or freshness) eliminates the most architecture options. Resolve it first and the rest follows.

6. **Three example archetypes.** Enterprise KB (moderate scale, ACLs, conversational), customer support bot (high QPS, caching, multilingual, cost-sensitive), legal search (massive corpus, zero hallucination tolerance, multi-tenant, compliance-heavy). Know which archetype your project resembles.

## Self-Assessment Checklist

Before moving to Module 3, you should be able to:

- [ ] List the eight requirement categories from memory and explain why each matters
- [ ] Calculate a latency budget for a RAG system and identify which components to cut when the budget is tight
- [ ] Estimate monthly cost for a RAG system given corpus size, QPS, and model pricing
- [ ] Explain how HIPAA compliance changes the architecture (specifically: embedding API, vector DB, and LLM choices)
- [ ] Describe three approaches to multi-tenancy in vector databases with trade-offs
- [ ] Write a requirements document for a given business scenario (in an interview, this is the first 5-10 minutes)
- [ ] Explain how freshness requirements drive the choice between batch, event-driven, and streaming ingestion

## What Comes Next

[Module 3 — Data Ingestion](../module-03/index.md) takes the freshness, reliability, and scale requirements you defined here and translates them into concrete ingestion architectures: batch, streaming, event-driven, with queues, workers, and monitoring.
