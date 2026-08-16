---
title: 10 Design Case Studies
outline: deep
---

# 10 Design Case Studies

Interview weight: 🔥🔥🔥 | Prerequisites: [Modules 1--17](../index.md) | Covers: end-to-end RAG system design

## 🗣️ In Plain English

::: tip In Plain English
Designing a RAG system is like planning a restaurant kitchen — the menu determines the equipment, the prep workflow, and the service style. A sushi bar and a pizza shop both serve food, but their kitchens look nothing alike. These ten case studies show you ten different "kitchens" so you can recognize which layout fits the order your interviewer gives you.
:::

## Case Study Comparison

| Case | Corpus Size | Latency Target | Index Choice | Hybrid? | Reranker? | Key Risk |
|------|-------------|----------------|--------------|---------|-----------|----------|
| [Enterprise KB](case-enterprise-kb.md) | 500K docs, 2M chunks | < 3s answers, < 500ms search | pgvector + Elasticsearch | Yes (RRF) | Cross-encoder | ACL leak if post-filtered |
| [Airline Support Bot](case-airline.md#support-bot) | ~5K chunks (policies) | < 3s | pgvector + BM25 | Yes | Cross-encoder | Intent misclassification |
| [Airline Flight Status](case-airline.md#flight-status-assistant) | N/A (live API) | < 2s | No vector DB for real-time | RAG + API | No | Using RAG for real-time data |
| [Airline Booking](case-airline.md#booking-assistant) | ~5K chunks (policies) | Conversational | pgvector | RAG + Tools | No | Irreversible actions without HITL |
| [Legal](case-legal.md) | 500K+ docs | Batch-tolerant | pgvector + Elasticsearch | Yes (essential) | Fine-tuned legal | OCR quality on scanned docs |
| [Healthcare](case-healthcare.md) | Moderate (guidelines) | < 3s | Qdrant + Solr (on-prem) | Yes | PubMedBERT | HIPAA violation, PHI leak |
| [E-commerce](case-ecommerce.md) | 2M products, 50M reviews | < 500ms | PostgreSQL + pgvector | Structured + semantic | Lightweight | Showing out-of-stock items |
| [HR Policy](case-hr-policy.md) | ~2K chunks | < 2s | pgvector + keyword | Yes | Cross-encoder | ACL bypass (role/region) |
| [CSV/Excel Analytics](case-csv-excel.md) | Uploaded files | < 5s | DuckDB (SQL) | NL-to-SQL, not RAG | No | SQL generation errors |
| [Multimodal](case-multimodal.md) | 100K+ docs, 2.5M images | < 5s | pgvector (3 chunk types) | Yes | Cross-encoder | Vision LLM misdescribes charts |

## Individual Case Studies

- [Enterprise Knowledge Base](case-enterprise-kb.md) — Multi-tenant, ACL-filtered, hybrid search at scale
- [Airline (3 Variants)](case-airline.md) — Support bot, flight status (anti-pattern), and booking assistant
- [Legal Document Search](case-legal.md) — Clause-level chunking, boolean search, domain-specific reranking
- [Healthcare Document RAG](case-healthcare.md) — HIPAA compliance, on-prem LLM, PHI scrubbing
- [E-commerce Product Search](case-ecommerce.md) — Structured-first retrieval, personalization, real-time inventory
- [HR Policy Assistant](case-hr-policy.md) — Role/region filtering, sensitive topic blocking
- [CSV/Excel Analytics Assistant](case-csv-excel.md) — NL-to-SQL, not RAG (anti-pattern)
- [Multimodal Document Assistant](case-multimodal.md) — Tables, charts, images parsed and embedded

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Using RAG for real-time data.** Case Studies 3 and 9 show this: flight status and analytical queries over tabular data are not retrieval problems. Embedding and indexing data that changes every minute (flights) or has mathematical structure (spreadsheets) gives you a complex system that delivers wrong answers. Symptom: users report "the bot said my flight was on time but it was cancelled 2 hours ago." Root cause: stale embeddings. Fix: recognize that some data needs live API calls or SQL, not vector search.

**Skipping ACL pre-filtering.** Case Studies 1, 6, and 8 all require access control. A common mistake is to retrieve all chunks first and then filter by ACL in the application layer. This is both a security risk (chunks briefly exist in memory that the user shouldn't see) and a performance problem (you retrieved 40 chunks only to discard 30). Always push ACL filters into the database query.

**Treating all data as unstructured text.** E-commerce product data (Case Study 7) has structured fields (price, brand, rating). Tabular data (Case Study 9) has rows and columns. Embedding these as flat text destroys the structure. Symptom: "Show me boots under $150" returns boots at $200 because the embedding captured "boots" but not the price constraint. Fix: extract structured fields and use them as hard filters before semantic search.

**Hallucinating in high-stakes domains.** In legal (Case Study 5) and healthcare (Case Study 6), a fabricated clause or an incorrect drug interaction can have severe consequences. Symptom: the LLM "paraphrases" a contract clause, subtly changing its meaning. Fix: force the LLM to quote exact text from retrieved chunks, add confidence scoring, and always include "verify with a professional" disclaimers.
:::

## 🎯 Checkpoint

::: details Question 1 — Real-time vs. RAG
**Q:** An interviewer asks you to design a system that answers "What's the current price of AAPL stock?" and also "Explain Apple's dividend policy." How do you architect this, and why is a pure RAG approach insufficient?

**A:** This is a hybrid architecture — identical in pattern to Case Study 3 (Flight Status). The stock price question requires a live API call (Alpha Vantage, Yahoo Finance, or a market data provider) because stock prices change by the second. Embedding historical price data would be immediately stale and misleading. The dividend policy question, however, is a classic RAG use case — the policy is documented in SEC filings and changes infrequently. The architecture: a router agent classifies the query as `realtime` or `knowledge`, routing to the appropriate pipeline. For hybrid queries ("Is AAPL's current price above its 52-week average?"), the agent makes an API call for the current price and a RAG retrieval for the 52-week average (or better yet, an API call for both, since 52-week average is also real-time data). The key principle: RAG is for slowly-changing knowledge, not real-time data feeds.
:::

::: details Question 2 — ACL enforcement
**Q:** In the Enterprise Knowledge Base (Case Study 1), why must ACL filtering happen as a database pre-filter rather than an application-level post-filter? What specific failure mode does post-filtering create?

**A:** Post-filtering creates two problems. First, a security window: chunks the user shouldn't see are retrieved into application memory, transmitted over the network from DB to app server, and briefly held in process memory. Even if they are discarded before reaching the user, they exist in logs, memory dumps, and potentially in the LLM's context window if filtering happens after context construction. Second, a retrieval quality problem: if you retrieve top-20 chunks and 15 are filtered out by ACL, you are left with only 5 chunks — likely not the best 5 the user is authorized to see. Pre-filtering ensures the top-20 are all from the authorized set, maximizing both security and retrieval quality. Implementation: in pgvector, this means a `WHERE acl_groups && $user_groups` clause in the same query as the vector similarity search, using a GIN index on the ACL array column for performance.
:::

::: details Question 3 — Structured vs. unstructured
**Q:** A team proposes building a RAG system over their product catalog (2M products with price, brand, category, rating fields) by chunking product descriptions and embedding them. What will go wrong, and what is the correct architecture?

**A:** Embedding product descriptions as flat text destroys the structured fields. A query like "Nike running shoes under $100 with 4+ star rating" will fail because: (1) the embedding might find semantically similar products but cannot enforce the $100 price ceiling — embeddings don't understand numerical constraints, (2) filtering by brand requires exact match, not semantic similarity ("Nike" should not match "Adidas" even though both are athletic brands), (3) rating thresholds are numerical comparisons, not semantic operations. The correct architecture (Case Study 7): extract structured fields into a relational database, apply hard filters first (`brand=Nike AND price<100 AND rating>=4 AND in_stock=true`), then run semantic search over the filtered set for subjective qualities ("good arch support", "comfortable for long runs"). This is structured-first, semantic-second — the inverse of typical RAG where semantic search comes first and filters are applied after.
:::

## Key Mental Models

- **Not everything is a RAG problem.** Real-time data needs live APIs. Tabular data needs SQL. Know when RAG is the wrong tool.
- **ACL is a pre-filter, not a post-filter.** Push access control into the database query, never the application layer.
- **Structured data needs structured queries.** Embeddings cannot enforce numerical constraints, exact matches, or aggregations.
- **The architecture follows the data, not the hype.** Each case study's design is driven by the shape of its data, the nature of its queries, and its compliance requirements.
- **Hybrid architectures are the norm.** Almost every real system combines RAG with live APIs, structured queries, or tool use. Pure RAG is the exception.

## Related

- [Hybrid Search](../module-09/02-hybrid-search.md) — the retrieval strategy used in most case studies
- [Security & ACL](../module-14/01-security.md) — deep dive on access control patterns
- [Evaluation](../module-13/index.md) — how to measure the metrics referenced in each case study
- [Caching & Freshness](../module-17/01-caching-freshness.md) — staleness trade-offs discussed in Case Studies 1 and 3
- [Reference Implementation](02-implementation.md) — code for the patterns described here
- [Production Checklist](03-checklist.md) — verify your design covers everything
