---
title: Module 17 Summary — Operations
outline: deep
---

# Module 17 Summary — Operations

## Mental Models

### Caching & Freshness
- **Three layers, three TTLs.** Embedding cache (days), retrieval cache (minutes), LLM response cache (hours with semantic matching). Each layer has different invalidation requirements.
- **Cache keys are security boundaries.** A missing tenant ID in a cache key is a cross-tenant data leak.
- **If it changes faster than your TTL, it does not belong in RAG.** Flight status, inventory, and transaction data need live API calls, not cached embeddings.

### Scaling & Cost
- **LLM input tokens dominate cost.** Reducing context size has more impact than any other cost optimization.
- **Model routing is the highest-leverage optimization.** Route simple queries to cheap models, complex ones to expensive models. Free money.
- **Scale reads and writes independently.** Use read replicas for queries, let the primary handle ingestion writes.

### Latency & Failure Handling
- **LLM generation is the latency floor.** Streaming hides it from the user; caching eliminates it entirely on cache hits.
- **Every component needs a fallback, and every fallback needs a metric.** Silent degradation is worse than loud failure.
- **Never mix embedding models in the same index.** Vectors from different models live in different embedding spaces. Similarity scores between them are meaningless.

### Observability
- **Correlation IDs are non-negotiable.** Without them, debugging a bad answer across services is impossible.
- **Log metadata, not content.** Chunk IDs, scores, latencies -- never raw text that might contain PII.
- **Five critical alerts, not fifty.** Error rate, p95 latency, fallback rate, cost spike, empty retrieval rate.

## Self-Assessment Checklist

- [ ] I can design a three-layer caching system with appropriate TTLs and invalidation strategies
- [ ] I can explain why certain data types (real-time inventory, flight status) should not be in RAG
- [ ] I can calculate the monthly cost of a RAG system given document count, query volume, and model pricing
- [ ] I can design a model routing strategy that reduces LLM costs by 50%+ without quality loss
- [ ] I can create a latency budget and identify the highest-leverage optimizations
- [ ] I can design fallback chains for every RAG component and explain the user experience at each degradation level
- [ ] I can describe the dual-write/blue-green process for embedding model migration
- [ ] I can define structured logging for a RAG pipeline -- what to log and what to explicitly exclude
- [ ] I can design a distributed tracing strategy that follows a query through embedding, retrieval, reranking, and generation
- [ ] I can set up cost-per-query tracking and alerting that catches regressions without alert fatigue

## What Comes Next

With operations covered, the next module addresses **production architecture patterns** -- putting all operational concerns together into a deployable system with CI/CD, testing, and rollout strategies.

- [Module 18 — Case Studies & Implementation](/rag/module-18/) -- CI/CD, testing, deployment patterns
