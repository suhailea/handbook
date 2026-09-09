---
title: Module 8 Summary — AI Architecture
outline: deep
---

# Module 8 Summary — AI Architecture

## What you built

A system-level view of how production AI systems are structured: the three fundamental patterns, the enterprise layer stack from API gateway to business systems, and which data store to use for which type of query.

## 5 Mental Models to Take Forward

1. **Chatbot, RAG, Agent — choose before building** — the pattern drives your data stores, latency budget, safety model, and cost structure. Switching patterns mid-project is expensive.

2. **The LLM is one floor of a multi-story building** — auth, rate limiting, observability, caching, fallover, and guardrails are all load-bearing floors. A bare LLM endpoint is a demo, not a product.

3. **Redis is the nervous system of AI infrastructure** — rate limits, session state, semantic cache, and token budgets all live here. If Redis is down, the whole AI system degrades gracefully (no auth, no limits, no cache).

4. **PostgreSQL + pgvector covers 80% of AI storage needs** — avoid adding new services until you hit their limits. A vector DB is justified only when chunk count exceeds ~5M or vector-specific features are needed.

5. **Every irreversible action needs a gate outside the LLM** — write/send/pay/delete operations must have deterministic validation that is not part of the LLM's reasoning. This principle appears in financial AI, agent systems, and security design.

## Self-Assessment Checklist

- [ ] Can you draw the three AI system patterns and list when to use each?
- [ ] Can you describe the layers in an enterprise AI stack and what each one does?
- [ ] Can you explain how Redis serves rate limiting, session state, and caching in AI?
- [ ] Can you choose between PostgreSQL, pgvector, Elasticsearch, and a graph DB for a given query?
- [ ] Can you explain what a human approval gate is and when it is mandatory?
- [ ] Can you design the RBAC for an AI system with data-level access control?

## Next Module

[Module 9 — LLMOps & Evaluation](../module-09/) covers how to measure whether your AI system is working: retrieval metrics, generation metrics, evaluation pipelines, and the operational practices for managing LLMs in production.
