---
title: Designing Before Building
outline: deep
---

# Designing Before Building

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [Module 1 — RAG Fundamentals](../module-01/index.md) | **Builds toward:** [Ingestion Pipelines](../module-03/01-ingestion-pipelines.md), all subsequent modules

## 🗣️ In Plain English

::: tip In Plain English
You would not build a house without blueprints. A RAG system needs the same treatment — how much data, how fast, how fresh, how secure, how accurate. Get these wrong and you will rebuild from scratch. Get them right and every technology choice becomes obvious.
:::

## ⚙️ Under the Hood

### The Requirements Framework

Before writing a single line of code, answer these eight categories of questions. Each one eliminates options and narrows the design space.

```text
Requirements Framework for RAG Systems

  ┌──────────────────────────────────────────────┐
  │               1. DATA PROFILE                │
  │  Volume, formats, languages, update freq     │
  ├──────────────────────────────────────────────┤
  │              2. QUERY PROFILE                │
  │  Types, complexity, expected output format   │
  ├──────────────────────────────────────────────┤
  │           3. TRAFFIC & LATENCY               │
  │  QPS, concurrency, P50/P95/P99 targets       │
  ├──────────────────────────────────────────────┤
  │              4. FRESHNESS                    │
  │  Staleness tolerance, update SLA             │
  ├──────────────────────────────────────────────┤
  │         5. ACCURACY & QUALITY                │
  │  Hallucination tolerance, citation needs     │
  ├──────────────────────────────────────────────┤
  │              6. SECURITY                     │
  │  Multi-tenancy, ACLs, PII, compliance        │
  ├──────────────────────────────────────────────┤
  │               7. COST                        │
  │  Budget, cost-per-query target, infra budget │
  ├──────────────────────────────────────────────┤
  │         8. AVAILABILITY & DR                 │
  │  SLA, failover, backup, RPO/RTO              │
  └──────────────────────────────────────────────┘
```

---

### 1. Data Profile

| Question | Why It Matters | Architecture Impact |
|----------|---------------|-------------------|
| How many documents? | 100 docs vs 10M docs = different indexing strategies | <1K: in-memory index. 1K-1M: managed vector DB. >1M: sharded/distributed |
| Total corpus size in tokens? | Determines if long-context is viable as alternative | <100K tokens: consider stuffing. >100K: RAG required |
| What formats? (PDF, HTML, CSV, images) | Each format needs different parsers | Multi-format → parsing pipeline with format detection |
| Are there tables, charts, images in docs? | These need special extraction (OCR, vision models) | Tables → structure-preserving parsing. Images → vision LLM or OCR |
| What languages? | Multilingual needs multilingual embeddings | Single language → specialized model. Multi → multilingual model (e.g., `multilingual-e5-large`) |
| How often does data change? | Drives ingestion strategy (batch vs streaming) | Daily → batch cron. Hourly → event-driven. Real-time → streaming |
| Average document length? | Affects chunking strategy | Short docs (<500 tokens) → may not need chunking. Long (>10K) → must chunk |
| Is there existing metadata? | Metadata enables filtering, reduces search space | Rich metadata → metadata-first filtering. None → must extract or generate |

### 2. Query Profile

| Question | Why It Matters | Architecture Impact |
|----------|---------------|-------------------|
| What types of queries? | Factual lookup ≠ summarization ≠ comparison | Factual → simple RAG. Comparison → multi-retrieval. Summarization → map-reduce |
| Expected output format? | Short answer vs detailed report vs structured JSON | Short → single retrieval. Report → iterative retrieval + synthesis |
| Will users ask follow-up questions? | Requires conversation history + context management | Yes → session state, query rewriting with chat history |
| Are queries in natural language or structured? | Affects query processing | NL → embed and search. Structured → may need SQL or filters |
| How ambiguous are typical queries? | Ambiguous queries need clarification or query expansion | High ambiguity → query decomposition, HyDE, multi-query retrieval |
| Do queries need real-time data? | RAG retrieves pre-indexed data; real-time needs different approach | Real-time → API calls or live DB queries, not vector search |

### 3. Traffic & Latency

| Question | Why It Matters | Architecture Impact |
|----------|---------------|-------------------|
| Expected QPS (queries per second)? | Sizing compute, vector DB, LLM throughput | <1 QPS → serverless viable. 10-100 → dedicated infra. >100 → horizontal scaling |
| Peak vs average ratio? | Burst handling strategy | High burst → auto-scaling + queue. Steady → fixed capacity |
| P50/P95/P99 latency targets? | Determines which components are viable | P95 <2s → no reranker or use fast reranker. P95 <500ms → aggressive caching |
| Streaming required? | Users see tokens as they generate? | Yes → SSE/WebSocket, chunked response |
| Concurrent users? | Session state management, connection pooling | High concurrency → stateless design, connection pooling |

**Latency budget breakdown for a typical RAG query:**

```yaml
Target: P95 < 3 seconds end-to-end

  Query embedding:        50-100ms   (API call to embedding model)
  Vector search:          10-50ms    (depends on DB and index type)
  Reranking:              100-300ms  (cross-encoder on top-20 results)
  Prompt construction:    5-10ms     (string formatting)
  LLM generation:         1-3s      (depends on output length, model)
  Network overhead:       50-100ms   (round trips)
                          ─────────
  Total:                  1.2-3.6s

  If P95 must be <1s: drop reranker, use faster/smaller LLM,
  cache frequent queries, or pre-compute answers.
```

### 4. Freshness

| Staleness Tolerance | Ingestion Strategy | Complexity |
|--------------------|-------------------|------------|
| Days to weeks | Batch (daily/weekly cron job) | Low |
| Hours | Scheduled batch (every 1-4 hours) | Low-Medium |
| Minutes | Event-driven (webhook/S3 trigger → queue → process) | Medium |
| Seconds | Streaming (Kafka/Kinesis → near-real-time embed + index) | High |
| Real-time (zero lag) | Not suitable for RAG — query the source directly | N/A |

### 5. Accuracy & Quality

| Question | Why It Matters | Architecture Impact |
|----------|---------------|-------------------|
| Hallucination tolerance? | Medical/legal = zero tolerance. Casual Q&A = some tolerance | Zero tolerance → citation verification, confidence scoring, human-in-loop |
| Are citations required? | Must trace answer to source document? | Yes → store chunk-to-source mapping, return with response |
| What recall target? | % of relevant docs that must appear in retrieved set | >90% recall → hybrid search (BM25 + dense), reranking |
| Who evaluates quality? | Manual review, automated metrics, user feedback? | Automated → need eval pipeline (RAGAS, DeepEval). Manual → annotation UI |
| What happens on "I don't know"? | Should the system admit uncertainty or always try to answer? | Admit → confidence thresholds on retrieval scores. Always answer → higher hallucination risk |

### 6. Security

| Question | Why It Matters | Architecture Impact |
|----------|---------------|-------------------|
| Multi-tenant? | Different users see different documents | Yes → metadata filtering per tenant on every query |
| Document-level ACLs? | Some docs restricted to specific roles/users | Yes → ACL metadata on every chunk, filter at query time |
| PII in documents? | Personally identifiable information handling | Yes → PII detection + redaction in ingestion pipeline |
| Compliance (GDPR, HIPAA, SOC2)? | Regulatory requirements on data handling | HIPAA → on-prem or BAA-covered cloud, no external embedding APIs |
| Data residency? | Where can data be stored and processed? | EU data → EU-region vector DB, EU-region LLM endpoint |
| Audit trail? | Must log who asked what and what was retrieved? | Yes → structured logging of queries, retrieved chunks, responses |

**Security requirements cascade into architecture decisions:**

```text
HIPAA Compliance Required?
│
├─ YES ──► External embedding APIs (OpenAI, etc.)?
│          ├─ Only with BAA signed
│          └─ Otherwise: self-hosted embeddings
│              (e.g., sentence-transformers on your infra)
│
│          ──► Vector DB?
│              ├─ Self-hosted (Qdrant, Weaviate, Milvus on your infra)
│              └─ Managed with BAA (Pinecone Enterprise, etc.)
│
│          ──► LLM?
│              ├─ Azure OpenAI with BAA
│              ├─ Self-hosted (vLLM, TGI)
│              └─ Anthropic/OpenAI with BAA
│
└─ NO ──► Use any managed service (simpler, cheaper)
```

### 7. Cost

| Cost Component | Typical Range | How to Estimate |
|---------------|--------------|----------------|
| Embedding API | $0.02-0.13 per 1M tokens | corpus_tokens / 1M * price |
| Vector DB (managed) | $50-2000/month | Depends on vectors stored + QPS |
| Vector DB (self-hosted) | $200-1000/month | VM cost for the instance |
| LLM inference (input) | $0.15-15 per 1M tokens | (context_tokens + query_tokens) * QPS * 86400 / 1M * price |
| LLM inference (output) | $0.60-60 per 1M tokens | output_tokens * QPS * 86400 / 1M * price |
| Reranker API | $0.10-2.00 per 1M tokens | top_k_tokens * QPS * 86400 / 1M * price |
| Compute (ingestion workers) | $100-500/month | Depends on ingestion volume and frequency |
| Storage (documents + chunks) | $10-100/month | Corpus size, typically negligible |

**Quick cost estimation formula:**

```typescript
// run: npx tsx cost_estimate.ts

interface CostEstimate {
  embedding_ingestion: number;
  embedding_queries: number;
  llm_input: number;
  llm_output: number;
  vector_db: number;
  total_monthly: number;
}

function estimateMonthlyCost(options: {
  corpusTokens: number;
  queriesPerDay: number;
  contextTokensPerQuery?: number;
  outputTokensPerQuery?: number;
  embeddingPricePerM?: number;
  llmInputPricePerM?: number;
  llmOutputPricePerM?: number;
  vectorDbMonthly?: number;
  reindexFrequencyPerMonth?: number;
}): CostEstimate {
  const {
    corpusTokens,
    queriesPerDay,
    contextTokensPerQuery = 3000,
    outputTokensPerQuery = 500,
    embeddingPricePerM = 0.02,   // text-embedding-3-small
    llmInputPricePerM = 2.50,    // gpt-4o
    llmOutputPricePerM = 10.00,
    vectorDbMonthly = 100.0,
    reindexFrequencyPerMonth = 1,
  } = options;

  // One-time (amortized monthly) embedding cost
  const embeddingCost =
    (corpusTokens / 1_000_000) * embeddingPricePerM * reindexFrequencyPerMonth;

  // Query embedding cost (negligible but included)
  const queryEmbeddingCost =
    ((queriesPerDay * 30 * 50) / 1_000_000) * embeddingPricePerM;

  // LLM cost
  const monthlyQueries = queriesPerDay * 30;
  const llmInputCost =
    (monthlyQueries * contextTokensPerQuery) / 1_000_000 * llmInputPricePerM;
  const llmOutputCost =
    (monthlyQueries * outputTokensPerQuery) / 1_000_000 * llmOutputPricePerM;

  const total =
    embeddingCost + queryEmbeddingCost + llmInputCost + llmOutputCost + vectorDbMonthly;

  return {
    embedding_ingestion: Math.round(embeddingCost * 100) / 100,
    embedding_queries: Math.round(queryEmbeddingCost * 100) / 100,
    llm_input: Math.round(llmInputCost * 100) / 100,
    llm_output: Math.round(llmOutputCost * 100) / 100,
    vector_db: vectorDbMonthly,
    total_monthly: Math.round(total * 100) / 100,
  };
}

// Example: Enterprise knowledge base
const enterprise = estimateMonthlyCost({
  corpusTokens: 50_000_000,   // 50M tokens (~25K pages)
  queriesPerDay: 1000,
});
console.log("Enterprise KB:", enterprise);

// Example: Customer support bot
const support = estimateMonthlyCost({
  corpusTokens: 5_000_000,    // 5M tokens (~2.5K pages)
  queriesPerDay: 5000,
});
console.log("Support bot:", support);

// Example: Legal search
const legal = estimateMonthlyCost({
  corpusTokens: 500_000_000,  // 500M tokens (~250K pages)
  queriesPerDay: 200,
  llmInputPricePerM: 3.00,    // Claude Sonnet
  llmOutputPricePerM: 15.00,
  vectorDbMonthly: 500.0,     // larger index
});
console.log("Legal search:", legal);
```

### 8. Availability & Disaster Recovery

| Question | Low Criticality | High Criticality |
|----------|----------------|-----------------|
| SLA target | 99% (7h downtime/month) | 99.9% (43min/month) or 99.99% |
| Failover | Manual restart | Automatic failover, multi-region |
| Backup | Daily snapshots | Continuous replication |
| RPO (data loss tolerance) | 24 hours | < 1 hour |
| RTO (recovery time) | Hours | Minutes |
| Degraded mode | Return "service unavailable" | Fall back to keyword search |

---

### Example 1: Enterprise Knowledge Base

```text
┌─────────────────────────────────────────────────────┐
│  REQUIREMENTS DOCUMENT: Enterprise Knowledge Base   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  DATA PROFILE                                       │
│  - 25,000 documents (Confluence, Google Docs, PDFs) │
│  - ~50M tokens total                                │
│  - Formats: HTML (60%), PDF (30%), DOCX (10%)       │
│  - Languages: English only                          │
│  - Update frequency: ~200 docs/day modified         │
│  - Rich metadata: author, team, last_modified,      │
│    access_level, document_type                      │
│                                                     │
│  QUERY PROFILE                                      │
│  - Factual lookup (60%): "What is our PTO policy?"  │
│  - How-to (25%): "How do I set up VPN?"             │
│  - Comparison (10%): "Diff between plan A and B?"   │
│  - Analytics (5%): → route to SQL, not RAG          │
│  - Follow-up questions: yes (conversational)        │
│                                                     │
│  TRAFFIC & LATENCY                                  │
│  - 1,000 queries/day (~0.7 QPS average)             │
│  - Peak: 5 QPS (Monday mornings)                    │
│  - P50 < 2s, P95 < 4s, P99 < 8s                    │
│  - Streaming: yes (token-by-token)                  │
│                                                     │
│  FRESHNESS                                          │
│  - Documents updated today should be searchable     │
│    within 1 hour                                    │
│  - Ingestion: event-driven (webhook from Confluence │
│    + scheduled crawl every 4 hours as fallback)     │
│                                                     │
│  ACCURACY                                           │
│  - Must cite source document with link              │
│  - Acceptable hallucination: low (enterprise trust) │
│  - Must say "I don't know" when context insufficient│
│  - Target: 85% answer accuracy (measured by user    │
│    thumbs-up/down)                                  │
│                                                     │
│  SECURITY                                           │
│  - Multi-tenant: no (single company)                │
│  - ACLs: yes — respect Confluence space permissions  │
│  - PII: minimal (internal docs)                     │
│  - Compliance: SOC2                                 │
│  - Audit: log all queries + retrieved docs          │
│                                                     │
│  COST                                               │
│  - Budget: $2,000/month                             │
│  - Target cost per query: < $0.05                   │
│                                                     │
│  AVAILABILITY                                       │
│  - SLA: 99.5% (business hours)                      │
│  - Failover: redirect to Confluence search          │
│  - Backup: daily vector DB snapshots                │
└─────────────────────────────────────────────────────┘
```

**Architecture implications:**
- Event-driven ingestion with hourly fallback crawl → needs a queue (SQS or BullMQ)
- ACLs → every chunk needs `access_level` metadata, filtered at query time
- Conversational → session management, query rewriting with chat history
- $2K/month budget → use `gpt-4o-mini` or `claude-3.5-haiku` for generation, `text-embedding-3-small` for embeddings, managed Qdrant or Pinecone on starter tier

---

### Example 2: Airline Customer Support Bot

```text
┌─────────────────────────────────────────────────────┐
│  REQUIREMENTS DOCUMENT: Airline Support Bot          │
├─────────────────────────────────────────────────────┤
│                                                     │
│  DATA PROFILE                                       │
│  - 500 FAQ documents + 50 policy documents          │
│  - ~2M tokens total                                 │
│  - Formats: HTML (FAQ pages), PDF (policy manuals)  │
│  - Languages: English, Spanish, French, German      │
│  - Update frequency: policies change quarterly,     │
│    FAQs updated weekly                              │
│  - Metadata: category, language, effective_date     │
│                                                     │
│  QUERY PROFILE                                      │
│  - Factual (70%): "What's the baggage allowance?"   │
│  - Procedural (20%): "How do I change my flight?"   │
│  - Account-specific (10%): "Where's my refund?"     │
│    → route to booking system API, not RAG            │
│  - High ambiguity: customers use informal language   │
│  - Follow-ups: yes (multi-turn conversations)       │
│                                                     │
│  TRAFFIC & LATENCY                                  │
│  - 50,000 queries/day (~35 QPS average)             │
│  - Peak: 200 QPS (flight disruption events)         │
│  - P50 < 1.5s, P95 < 3s (customer patience is low) │
│  - Streaming: yes                                   │
│                                                     │
│  FRESHNESS                                          │
│  - Policy changes must be live within 30 minutes    │
│  - FAQ updates within 2 hours                       │
│                                                     │
│  ACCURACY                                           │
│  - Must be correct (wrong baggage info = angry      │
│    customers at the gate)                           │
│  - Citations: link to FAQ page                      │
│  - Escalation: if confidence < threshold, transfer  │
│    to human agent                                   │
│                                                     │
│  SECURITY                                           │
│  - No PII in knowledge base (policies are public)   │
│  - PII in queries (booking refs) → do not log       │
│  - GDPR: EU customer data handling                  │
│  - Multi-tenant: no                                 │
│                                                     │
│  COST                                               │
│  - Budget: $10,000/month                            │
│  - Target cost per query: < $0.01                   │
│  - ROI metric: % of queries resolved without human  │
│                                                     │
│  AVAILABILITY                                       │
│  - SLA: 99.9% (24/7 — flights are global)           │
│  - Failover: fallback to FAQ keyword search         │
│  - Must handle 10x traffic spikes (disruptions)     │
└─────────────────────────────────────────────────────┘
```

**Architecture implications:**
- 200 QPS peak → horizontal scaling, response caching for common queries (top-100 queries are likely 50% of traffic)
- Cost target $0.01/query → must use smallest viable models (`gpt-4o-mini`, `text-embedding-3-small`), aggressive caching
- Multilingual → multilingual embedding model, or embed in English + translate queries
- 10x spike handling → auto-scaling, queue-based architecture, circuit breakers
- Small corpus (2M tokens) → could consider long-context for some query types, but QPS makes RAG mandatory for cost
- Account-specific queries → route to booking API, not RAG

---

### Example 3: Legal Document Search

```text
┌─────────────────────────────────────────────────────┐
│  REQUIREMENTS DOCUMENT: Legal Document Search        │
├─────────────────────────────────────────────────────┤
│                                                     │
│  DATA PROFILE                                       │
│  - 2 million documents (contracts, case law,        │
│    regulations, memos)                              │
│  - ~500M tokens total                               │
│  - Formats: PDF (80%), DOCX (15%), scanned PDF (5%) │
│  - Languages: English (primary), some bilingual docs│
│  - Update frequency: 500-1000 new docs/day          │
│  - Complex structure: sections, subsections,        │
│    cross-references, footnotes, exhibits            │
│  - Metadata: practice_area, jurisdiction, date,     │
│    parties, document_type, confidentiality_level    │
│                                                     │
│  QUERY PROFILE                                      │
│  - Precedent search (40%): "Find cases about        │
│    breach of fiduciary duty in Delaware"            │
│  - Clause comparison (25%): "How does the           │
│    indemnification clause in contract A compare     │
│    to contract B?"                                  │
│  - Regulatory lookup (20%): "What are the SEC       │
│    requirements for Form 10-K disclosures?"         │
│  - Summarization (15%): "Summarize the key terms    │
│    of this 200-page merger agreement"               │
│  - Follow-ups: yes (research sessions)              │
│                                                     │
│  TRAFFIC & LATENCY                                  │
│  - 500 queries/day (~0.35 QPS average)              │
│  - Peak: 5 QPS (deal deadlines, court filings)      │
│  - P50 < 5s, P95 < 10s (lawyers expect thorough    │
│    results, not instant ones)                       │
│  - Streaming: yes (for long summaries)              │
│                                                     │
│  FRESHNESS                                          │
│  - New case law: within 24 hours                    │
│  - New contracts: within 4 hours of upload          │
│                                                     │
│  ACCURACY                                           │
│  - ZERO hallucination tolerance for legal citations │
│  - Must cite exact document + section/paragraph     │
│  - Must surface ALL relevant precedents (recall     │
│    matters more than precision)                     │
│  - Confidence scoring: flag low-confidence answers  │
│                                                     │
│  SECURITY                                           │
│  - Multi-tenant: yes (multiple law firms or         │
│    practice groups with strict data isolation)      │
│  - Document ACLs: matter-level access control       │
│  - PII: yes (client names, financial data)          │
│  - Compliance: attorney-client privilege, SOC2,     │
│    data residency (US-only)                         │
│  - Audit: complete query + response logging with    │
│    retention policy                                 │
│                                                     │
│  COST                                               │
│  - Budget: $25,000/month                            │
│  - Lawyers bill $500+/hr — even small time savings  │
│    justify significant infrastructure cost          │
│                                                     │
│  AVAILABILITY                                       │
│  - SLA: 99.9% (legal deadlines are non-negotiable)  │
│  - Failover: multi-AZ deployment                    │
│  - Backup: continuous replication, 1-hour RPO       │
│  - Degraded mode: keyword search fallback           │
└─────────────────────────────────────────────────────┘
```

**Architecture implications:**
- 2M documents → distributed vector DB (Qdrant cluster or Milvus), sharded by practice area
- Scanned PDFs → OCR pipeline (Tesseract or AWS Textract), significant ingestion compute
- Multi-tenant with strict isolation → tenant ID on every chunk, enforce in every query, consider separate collections per tenant for strongest isolation
- Zero hallucination for citations → citation verification step (check that cited text actually exists in source), confidence scoring, never generate without retrieved context
- Recall-focused → hybrid search (BM25 + dense), high top-k (50+), reranking, possibly multiple retrieval strategies per query
- Clause comparison → need to retrieve from multiple documents and present side-by-side
- PII + privilege → self-hosted or BAA-covered services, encryption at rest, access logging
- $25K budget with low QPS → can afford larger, more accurate models (Claude Sonnet, GPT-4o) and expensive rerankers

---

### How Requirements Change the Architecture

| Requirement | Low Complexity | High Complexity |
|-------------|---------------|----------------|
| **Data volume** <1K docs | In-memory FAISS, single-node | — |
| **Data volume** >1M docs | — | Distributed vector DB, sharding, batch ingestion |
| **Freshness** <24h | Daily batch cron | — |
| **Freshness** <1min | — | Streaming ingestion (Kafka), event-driven |
| **QPS** <1 | Serverless (Lambda), managed services | — |
| **QPS** >100 | — | Horizontal scaling, caching layer, CDN for static |
| **Compliance** none | Any managed service | — |
| **Compliance** HIPAA/SOC2 | — | Self-hosted embeddings, BAA, encryption, audit logs |
| **Multi-tenant** no | Single collection, no filters | — |
| **Multi-tenant** yes | — | Tenant metadata on every chunk, query-time filtering |
| **Accuracy** low tolerance | Reranking, hybrid search, confidence scoring | — |
| **Accuracy** zero tolerance | — | Citation verification, human-in-loop, answer grounding |
| **Budget** <$1K/month | Smallest models, aggressive caching, serverless | — |
| **Budget** >$10K/month | — | Best models, full pipeline, dedicated infra |

```typescript
// run: npx tsx requirements_to_architecture.ts
// Conceptual: how requirements map to architecture decisions

interface RAGRequirements {
  docCount: number;
  totalTokens: number;
  queriesPerDay: number;
  peakQps: number;
  p95LatencyMs: number;
  freshnessMinutes: number;
  hallucinationTolerance: "high" | "medium" | "low" | "zero";
  multiTenant: boolean;
  compliance: string[];  // ["HIPAA", "SOC2", "GDPR"]
  monthlyBudget: number;
}

function recommendArchitecture(req: RAGRequirements): Record<string, string> {
  const arch: Record<string, string> = {};

  // Vector DB
  if (req.docCount < 1_000) {
    arch.vector_db = "In-memory FAISS or ChromaDB";
  } else if (req.docCount < 1_000_000) {
    arch.vector_db = "Managed Qdrant Cloud or Pinecone";
  } else {
    arch.vector_db = "Distributed Qdrant/Milvus cluster";
  }

  // Ingestion
  if (req.freshnessMinutes > 1440) {  // > 1 day
    arch.ingestion = "Daily batch cron";
  } else if (req.freshnessMinutes > 60) {
    arch.ingestion = "Event-driven (webhook → queue → worker)";
  } else {
    arch.ingestion = "Streaming (Kafka → consumer → embed → index)";
  }

  // LLM
  if (req.compliance.includes("HIPAA")) {
    arch.llm = "Azure OpenAI (with BAA) or self-hosted (vLLM)";
    arch.embeddings = "Self-hosted sentence-transformers";
  } else if (req.monthlyBudget < 1000) {
    arch.llm = "gpt-4o-mini or claude-3.5-haiku";
    arch.embeddings = "text-embedding-3-small";
  } else {
    arch.llm = "gpt-4o or claude-sonnet";
    arch.embeddings = "text-embedding-3-large";
  }

  // Caching
  if (req.peakQps > 50) {
    arch.caching = "Redis cache for frequent queries + LLM responses";
  } else {
    arch.caching = "Optional — in-memory LRU may suffice";
  }

  // Search strategy
  if (req.hallucinationTolerance === "low" || req.hallucinationTolerance === "zero") {
    arch.search = "Hybrid (BM25 + dense) + cross-encoder reranking";
  } else {
    arch.search = "Dense vector search, reranking optional";
  }

  // Security
  if (req.multiTenant) {
    arch.security = "Tenant ID on every chunk, query-time metadata filter";
  } else {
    arch.security = "Standard auth, no per-doc filtering";
  }

  return arch;
}

// Example: Enterprise KB
const enterprise: RAGRequirements = {
  docCount: 25_000,
  totalTokens: 50_000_000,
  queriesPerDay: 1_000,
  peakQps: 5,
  p95LatencyMs: 4000,
  freshnessMinutes: 60,
  hallucinationTolerance: "low",
  multiTenant: false,
  compliance: ["SOC2"],
  monthlyBudget: 2000,
};

console.log("Enterprise KB Architecture:");
for (const [component, recommendation] of Object.entries(recommendArchitecture(enterprise))) {
  console.log(`  ${component}: ${recommendation}`);
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. "We'll figure out multi-tenancy later."**
A team builds a single-collection RAG system. Six months in, the product needs per-customer data isolation. Retrofitting tenant metadata onto millions of existing chunks, re-indexing everything, and adding query-time filters to every code path takes 3 months. If they had known from day one, it would have been a metadata field from the start. Symptom: a "quick" feature request that turns into a quarter-long migration.

**2. The latency budget that does not add up.**
Product says "P95 under 2 seconds." Engineering adds a reranker (300ms), uses a large LLM (2-3s generation), and embeds queries via an external API (100ms). The math gives P95 of 2.5-3.5s before any network variance. Symptom: the system never meets SLA, and the team spends months optimizing the wrong component. Fix: do the latency budget arithmetic *before* choosing components.

**3. Compliance surprise.**
A health-tech startup builds the entire RAG pipeline on OpenAI embeddings + Pinecone + GPT-4. During the security review before launch, compliance flags that patient data is being sent to external APIs without a BAA. The entire embedding pipeline must be rebuilt with self-hosted models. Symptom: 2-month launch delay. Fix: check compliance requirements in week one, not month six.

**4. Cost model that collapses at scale.**
The prototype costs $50/month at 100 queries/day. Product launches to 10,000 queries/day and the LLM bill alone hits $7,500/month. Nobody modeled the cost per query during requirements. Symptom: emergency cost-cutting, degraded model quality. Fix: run the cost estimation before choosing your LLM.

:::

## 🎯 Checkpoint

::: details Question 1 — Requirements interview
**Q:** You are in a system design interview. The prompt is: "Design a RAG system for a healthcare company that wants doctors to search medical literature." What are the first 10 questions you ask before drawing any architecture?

**A:** (1) How many documents in the medical literature corpus? (100K papers vs 10M). (2) What formats? (PDFs with tables/figures? HTML from PubMed?). (3) How often is new literature added? (daily from PubMed feeds? quarterly manual uploads?). (4) What types of queries? (drug interactions? treatment protocols? diagnostic criteria?). (5) Is HIPAA compliance required? (are patient cases mixed with literature?). (6) Expected users and QPS? (10 doctors vs 10,000). (7) Latency requirements? (is this for point-of-care decisions during patient visits?). (8) Must answers cite specific papers with page/section? (9) Multi-institutional? (do different hospitals see different subsets?). (10) Budget? (academic institution vs well-funded health-tech startup — determines model and infrastructure choices). These questions eliminate 80% of possible architectures before you draw a single box.
:::

::: details Question 2 — Freshness vs cost trade-off
**Q:** Your RAG system indexes a news corpus. The business wants articles searchable within 5 minutes of publication. Currently, batch ingestion runs every 4 hours. What changes are needed, and what are the cost implications?

**A:** Moving from 4-hour batch to 5-minute freshness requires: (1) **Event-driven ingestion** — replace cron with a webhook or RSS feed listener that triggers on new articles. (2) **Message queue** — add SQS/Kafka between the listener and the embedding worker for reliability and backpressure. (3) **Always-on workers** — batch cron can run on spot instances; 5-minute SLA needs persistent workers or auto-scaling with fast cold start. (4) **Incremental indexing** — the vector DB must support real-time upserts without requiring a full re-index. Cost implications: compute cost increases from ~$50/month (spot instances for daily batch) to ~$300-500/month (persistent workers). Queue costs are negligible (~$5/month). The embedding API cost stays the same (same number of documents, just processed sooner). The significant hidden cost is **operational complexity** — monitoring ingestion lag, handling failures in real-time (DLQ), and ensuring the queue does not grow unbounded during traffic spikes.
:::

::: details Question 3 — Multi-tenant architecture
**Q:** Your RAG system serves 500 enterprise customers, each with their own document corpus (average 10K docs per customer). What are the three main approaches to multi-tenancy in a vector database, and what are the trade-offs?

**A:** (1) **Single collection with tenant metadata filter:** All 5M vectors in one collection. Every chunk has a `tenant_id` metadata field. Every query includes `filter={"tenant_id": "customer_123"}`. Pros: simplest to manage, single index. Cons: one large index (slower as it grows), security risk if filter is forgotten (data leak), noisy-neighbor performance issues. (2) **Separate collection per tenant:** 500 collections, each with ~10K vectors. Pros: strong isolation (no accidental cross-tenant access), per-tenant performance tuning, easy to delete a tenant (drop collection). Cons: 500 collections to manage, connection overhead, harder to do cross-tenant analytics. (3) **Separate database/cluster per tenant:** Each customer gets their own vector DB instance. Pros: strongest isolation, per-tenant SLAs, compliance-friendly. Cons: expensive (500 instances), operational nightmare, cannot share resources. **Recommendation for this scenario:** Start with option 2 (separate collections). 500 collections is manageable for most vector DBs (Qdrant supports thousands of collections). It gives strong isolation without the operational cost of separate clusters. Move high-value or compliance-heavy tenants to option 3 if needed.
:::

## Key Mental Models

- **Requirements eliminate architectures.** Every answered question removes options. By the time you have finished this framework, the architecture is 80% decided — you are just naming the components.
- **The latency budget is arithmetic, not vibes.** Add up each component's P95 latency. If the sum exceeds the target, something must go — do this math before writing code.
- **Compliance is a day-one decision.** Retrofitting HIPAA, GDPR, or multi-tenancy is 10x more expensive than building it in from the start.
- **Cost per query is the true metric.** Total monthly cost divided by total queries. If this number is not in your requirements document, you will have a surprise.
- **Start with the hardest constraint.** The tightest requirement (often compliance, latency, or cost) eliminates the most options — resolve it first.

## Related

- [Module 1 — RAG Fundamentals](../module-01/index.md) — the conceptual foundation these requirements build on
- [Ingestion Pipelines](../module-03/01-ingestion-pipelines.md) — how freshness requirements translate into ingestion architecture
- [Reliability & Monitoring](../module-03/02-reliability.md) — how availability requirements translate into operational practices
