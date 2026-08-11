---
title: Module 16 Summary — Production Architecture
outline: deep
---

# Module 16 Summary — Production Architecture

## Mental Models Gained

1. **Query path = latency-sensitive, ingestion path = throughput-sensitive.** Design them differently. Query path: minimize sequential steps, cache aggressively, stream responses. Ingestion path: queue-based, batch operations, scale workers independently.

2. **The LLM is a dependency, not the system.** Build fallbacks (secondary provider), monitor availability, and do not let a single API outage bring down your product. Route simple queries to cheaper models.

3. **Start monolith, extract when forced.** Premature microservices slow small teams. A modular monolith with clear boundaries can be split later. Extract services when you have a concrete scaling or team-ownership need.

4. **Ingestion is always async.** Accept the upload, return immediately, process in background workers. This is non-negotiable regardless of architecture style.

5. **Instrument from day one.** Per-stage latency, token usage, cost per query, and quality metrics. You cannot optimize what you cannot measure, and retroactively adding instrumentation is painful.

## Self-Assessment Checklist

- [ ] Can you draw the full system architecture diagram from memory?
- [ ] Can you explain the role of every component (gateway, auth, orchestrator, embedding, retrieval, reranker, LLM, cache, queue, workers)?
- [ ] Can you walk through the query path step by step with latency estimates?
- [ ] Can you walk through the ingestion path and explain why it must be async?
- [ ] Can you argue for monolith vs microservices for a given team size and scale?
- [ ] Can you choose between BullMQ, SQS, RabbitMQ, and Kafka for a given use case?
- [ ] Can you design a blue-green migration strategy for changing embedding models?
- [ ] Can you explain what metrics to instrument and why?

## Architecture Decision Quick Reference

| Decision | Small Team (1-4) | Medium Team (5-10) | Large Team (10+) |
|----------|-----------------|-------------------|-----------------|
| Architecture | Modular monolith | Monolith + async workers | Microservices |
| Queue | BullMQ (Redis) | BullMQ or SQS | Kafka or SQS |
| Vector DB | pgvector | pgvector or Pinecone | Dedicated (Pinecone, Qdrant) |
| LLM | Single provider + fallback | Multi-provider routing | Self-hosted + API fallback |
| Observability | Pino + basic metrics | Prometheus + Grafana | Full OTel + ELK + Grafana |
