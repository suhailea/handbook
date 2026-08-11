---
title: Full System Architecture
outline: deep
---

# Full System Architecture

Interview weight: 🔥🔥🔥 | Prerequisites: All previous RAG modules, [System design fundamentals](/system-design/)

## 🗣️ In Plain English

::: tip In Plain English
A production RAG system is not one service -- it is a dozen components working together. Think of it like a restaurant: there is a front desk (API gateway), a kitchen manager (orchestrator), multiple prep stations (embedding, retrieval, reranking), the actual cooking (LLM generation), a pantry (vector DB, object storage), a supply chain (ingestion pipeline), and a health inspector (monitoring). This page maps every component and how they connect.
:::

## ⚙️ Under the Hood

### Complete Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EXTERNAL CLIENTS                                  │
│                    Web App / Mobile App / API Consumers                      │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │ HTTPS
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            API GATEWAY                                      │
│  • Rate limiting          • Authentication (JWT)                            │
│  • Request validation     • TLS termination                                 │
│  • Load balancing         • Request/response logging                        │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                    ┌────────────┼────────────────┐
                    │            │                 │
                    ▼            ▼                 ▼
          ┌──────────────┐ ┌──────────┐  ┌──────────────────┐
          │ Auth Service │ │ Query    │  │ Ingestion API    │
          │ (JWT verify, │ │ Service  │  │ (upload docs,    │
          │  user perms) │ │ (below)  │  │  trigger index)  │
          └──────────────┘ └────┬─────┘  └────────┬─────────┘
                                │                  │
                                ▼                  ▼
                    ┌────────────────────┐  ┌──────────────┐
                    │   ORCHESTRATOR     │  │ Message Queue│
                    │   (query path)     │  │ (Kafka/SQS/  │
                    │                    │  │  BullMQ)     │
                    │ • Input guardrails │  └──────┬───────┘
                    │ • Query rewriting  │         │
                    │ • Retrieval coord. │         ▼
                    │ • Context assembly │  ┌──────────────┐
                    │ • LLM call         │  │  Ingestion   │
                    │ • Output guardrails│  │  Workers     │
                    │ • Caching          │  │ (below)      │
                    └────┬──┬──┬──┬──────┘  └──────────────┘
                         │  │  │  │
          ┌──────────────┘  │  │  └──────────────┐
          ▼                 │  │                  ▼
  ┌───────────────┐        │  │         ┌────────────────┐
  │  Embedding    │        │  │         │  LLM Service   │
  │  Service      │        │  │         │  (OpenAI /     │
  │  (query embed)│        │  │         │   Anthropic /  │
  └───────┬───────┘        │  │         │   self-hosted) │
          │                │  │         └────────────────┘
          ▼                │  │
  ┌───────────────┐        │  │
  │  Retrieval    │        │  │
  │  Layer        │◄───────┘  │
  │               │           │
  │ ┌───────────┐ │           │
  │ │ Vector DB │ │           │
  │ │ (pgvector/│ │           │
  │ │ Pinecone) │ │           │
  │ └───────────┘ │           │
  │ ┌───────────┐ │           │
  │ │ Keyword   │ │           │
  │ │ Search    │ │           │
  │ │(Elastic)  │ │           │
  │ └───────────┘ │           │
  └───────┬───────┘           │
          │                   │
          ▼                   │
  ┌───────────────┐           │
  │  Reranker     │◄──────────┘
  │  Service      │
  │  (Cohere /    │
  │   cross-enc.) │
  └───────────────┘

         DATA STORES                      INGESTION PATH
  ┌───────────────────┐            ┌─────────────────────────┐
  │ PostgreSQL        │            │  Ingestion Workers      │
  │ • User data       │            │  1. Parse document      │
  │ • Conversations   │            │  2. Extract text/images │
  │ • Feedback        │            │  3. PII redaction       │
  │ • Eval results    │            │  4. Chunk               │
  │ • Document meta   │            │  5. Embed chunks        │
  ├───────────────────┤            │  6. Store in Vector DB  │
  │ Redis             │            │  7. Update metadata     │
  │ • Response cache  │            └─────────────────────────┘
  │ • Session state   │
  │ • Rate limit      │             OBSERVABILITY
  │   counters        │            ┌─────────────────────────┐
  ├───────────────────┤            │ Prometheus + Grafana    │
  │ Object Storage    │            │ • Latency (P50/P95/P99) │
  │ (S3 / GCS)        │            │ • Error rates           │
  │ • Raw documents   │            │ • Token usage           │
  │ • Document backups│            │ • Cost per query        │
  └───────────────────┘            │ • Cache hit rate        │
                                   │ • Retrieval quality     │
   CI/CD                           │ • Guardrail block rate  │
  ┌───────────────────┐            ├─────────────────────────┤
  │ Eval Pipeline     │            │ Structured Logging      │
  │ • Run on deploy   │            │ (Pino → ELK / Datadog) │
  │ • Regression gate │            ├─────────────────────────┤
  │ • A/B comparison  │            │ OpenTelemetry Traces    │
  └───────────────────┘            │ (end-to-end request)    │
                                   └─────────────────────────┘
```

---

### Component-by-Component Breakdown

#### API Gateway

**Role:** Single entry point for all client requests. Handles cross-cutting concerns before they reach application logic.

| Responsibility | Implementation |
|---------------|---------------|
| Authentication | Validate JWT, extract user ID and permissions |
| Rate limiting | Token bucket per user (Redis-backed) |
| Request validation | Schema validation, query length limits |
| TLS termination | HTTPS → HTTP internally |
| Load balancing | Round-robin or least-connections to backend pods |
| Logging | Request/response metadata (not body) for audit |

**Options:** Kong, AWS API Gateway, nginx + custom middleware, Express middleware (small scale).

---

#### Auth Service

**Role:** Validate tokens and resolve user permissions. The orchestrator needs to know *who* the user is and *what they can access* to construct ACL filters.

```typescript
// run: npx tsx auth-flow.ts

interface AuthContext {
  userId: string;
  tenantId: string;
  groups: string[];
  clearanceLevel: 'public' | 'internal' | 'confidential';
  permissions: string[];
}

// The API gateway passes the JWT. The auth service resolves it to an AuthContext.
// The orchestrator uses AuthContext to build retrieval filters.
// The LLM never sees auth information.
```

---

#### Orchestrator (Query Service)

**Role:** The brain of the query path. Coordinates all steps from query to response.

```typescript
// run: npx tsx orchestrator.ts

async function handleQuery(
  query: string,
  auth: AuthContext,
): Promise<QueryResponse> {
  // 1. Input guardrails
  const inputCheck = await runInputGuardrails(query);
  if (!inputCheck.pass) {
    return { answer: inputCheck.message, blocked: true };
  }

  // 2. Cache check
  const cached = await checkCache(query, auth.tenantId);
  if (cached) return cached;

  // 3. Query rewriting (optional)
  const rewrittenQuery = await rewriteQuery(query);

  // 4. Embedding
  const queryEmbedding = await embeddingService.embed(rewrittenQuery);

  // 5. Retrieval (parallel: vector + keyword)
  const [vectorResults, keywordResults] = await Promise.all([
    vectorDB.search(queryEmbedding, {
      topK: 20,
      filter: buildACLFilter(auth),
    }),
    elasticSearch.search(rewrittenQuery, {
      size: 10,
      filter: buildACLFilter(auth),
    }),
  ]);

  // 6. Merge and deduplicate
  const merged = mergeResults(vectorResults, keywordResults);

  // 7. Retrieval guardrails
  const filteredChunks = await runRetrievalGuardrails(merged, auth);
  if (filteredChunks.length === 0) {
    return {
      answer: "I don't have enough information to answer this question.",
      sources: [],
    };
  }

  // 8. Reranking
  const reranked = await rerankerService.rerank(rewrittenQuery, filteredChunks);
  const topChunks = reranked.slice(0, 5);

  // 9. Context assembly + LLM call
  const prompt = assemblePrompt(query, topChunks);
  const answer = await llmService.generate(prompt);

  // 10. Output guardrails
  const outputCheck = await runOutputGuardrails(answer, topChunks);
  const finalAnswer = outputCheck.pass ? answer : outputCheck.fallbackAnswer;

  // 11. Cache result
  await cacheResult(query, auth.tenantId, finalAnswer);

  // 12. Log for evaluation
  await logQueryForEval({
    query,
    rewrittenQuery,
    retrievedDocs: topChunks.map((c) => c.id),
    answer: finalAnswer,
    latencyMs: Date.now() - startTime,
    tokenUsage: llmResponse.usage,
  });

  return {
    answer: finalAnswer,
    sources: topChunks.map((c) => ({
      title: c.metadata.title,
      page: c.metadata.page,
      score: c.score,
    })),
  };
}
```

---

#### Embedding Service

**Role:** Convert text to vectors. Used by both the query path (embed the query) and the ingestion path (embed chunks).

**Key decisions:**
- **Shared vs separate models for query and document?** Most embedding models use the same model for both. Some (e.g., E5, BGE) use different prefixes ("query: " vs "passage: ").
- **Batching:** Ingestion embeds thousands of chunks -- batch for throughput. Query embeds one query -- optimize for latency.
- **Hosting:** API (OpenAI, Cohere) for simplicity, self-hosted (sentence-transformers) for cost at scale.

---

#### Retrieval Layer

**Role:** Find relevant chunks from the corpus. Typically combines vector search and keyword search.

| Component | Technology | Best For |
|-----------|-----------|----------|
| Vector DB | pgvector, Pinecone, Qdrant, Weaviate | Semantic similarity |
| Keyword Search | Elasticsearch, OpenSearch | Exact matches, acronyms, codes |
| Hybrid | Combine with RRF (Reciprocal Rank Fusion) | Best overall retrieval |

**Scaling considerations:**
- pgvector: scales with PostgreSQL. Good up to ~10M vectors. Beyond that, consider dedicated vector DBs.
- Pinecone: managed, scales automatically. Higher cost, lower ops burden.
- Elasticsearch: already deployed in most companies. BM25 keyword search is production-hardened.

---

#### Reranker Service

**Role:** Re-score retrieved results using a cross-encoder model for higher-quality ranking.

**Latency budget:** 50-200ms for reranking 20 documents. This is a significant portion of total latency -- monitor it.

**Options:** Cohere Rerank API, self-hosted cross-encoder (ms-marco-MiniLM), Jina Reranker.

---

#### LLM Service

**Role:** Generate the final answer from the assembled context.

**Key architectural decisions:**

| Decision | Options | Recommendation |
|----------|---------|---------------|
| Provider | OpenAI, Anthropic, self-hosted | Start managed, self-host for cost/compliance |
| Streaming | Yes/No | Yes for chat UX (time-to-first-token matters) |
| Fallback | Secondary provider | Yes -- if primary is down, route to secondary |
| Model selection | Per-query routing | Use fast/cheap model for simple queries, strong model for complex |

```typescript
// run: npx tsx llm-with-fallback.ts

async function generateWithFallback(
  prompt: string,
): Promise<LLMResponse> {
  try {
    return await primaryLLM.generate(prompt, { timeout: 10_000 });
  } catch (error) {
    console.error('Primary LLM failed, falling back:', error);
    return await fallbackLLM.generate(prompt, { timeout: 15_000 });
  }
}
```

---

#### Ingestion Workers

**Role:** Process uploaded documents into searchable chunks. This is the write path of the system.

```
Document Upload → Queue → Worker picks up → Process:

1. PARSE:        PDF/DOCX/HTML → raw text + images + tables
2. EXTRACT:      OCR for scanned pages, vision LLM for images
3. CLEAN:        Remove boilerplate, headers/footers, PII redaction
4. CHUNK:        Split into overlapping chunks (512-1024 tokens)
5. EMBED:        Batch embed all chunks
6. STORE:        Write vectors to Vector DB, metadata to PostgreSQL
7. INDEX:        Write text to Elasticsearch for keyword search
8. NOTIFY:       Mark document as "indexed", notify user
```

**Why async:** Document processing is CPU/GPU-intensive and variable in duration (a 200-page PDF takes minutes). Synchronous processing would block the API. Queue-based workers allow:
- Independent scaling (add more workers for large backlogs)
- Retry on failure (worker crashes mid-processing, another picks up)
- Backpressure (queue depth = load signal)

---

#### Data Stores

| Store | What It Holds | Why This Store |
|-------|--------------|---------------|
| **PostgreSQL** | User accounts, conversations, document metadata, evaluation results, feedback | Relational data, transactions, proven reliability |
| **Vector DB** | Chunk embeddings + chunk text + metadata | Optimized for ANN search |
| **Elasticsearch** | Chunk text + metadata | Optimized for BM25 keyword search |
| **Redis** | Response cache, session state, rate limit counters, queue (BullMQ) | Low-latency key-value, pub/sub, TTL |
| **Object Storage (S3)** | Raw uploaded documents, backups | Cheap, durable, large files |

---

#### Observability Stack

**The three pillars applied to RAG:**

| Pillar | Tool | What to Track |
|--------|------|--------------|
| **Metrics** | Prometheus + Grafana | P50/P95/P99 latency, QPS, error rate, token usage, cost/query, cache hit rate, guardrail block rate |
| **Logs** | Pino → ELK / Datadog | Every query with: user ID, query text, retrieved doc IDs, answer hash, latency breakdown, guardrail results |
| **Traces** | OpenTelemetry | End-to-end request trace: gateway → auth → embed → search → rerank → LLM → guardrails |

**RAG-specific metrics to instrument:**

```typescript
// run: npx tsx rag-metrics.ts

// Latency breakdown per stage
const metrics = {
  // Per-request
  total_latency_ms: histogram(),
  embedding_latency_ms: histogram(),
  retrieval_latency_ms: histogram(),
  reranking_latency_ms: histogram(),
  llm_latency_ms: histogram(),       // TTFT and total
  guardrail_latency_ms: histogram(),

  // Throughput
  queries_per_second: counter(),
  ingestion_docs_per_minute: counter(),

  // Quality (sampled)
  retrieval_hit_rate: gauge(),       // from eval pipeline
  faithfulness_score: gauge(),       // from LLM judge

  // Cost
  input_tokens_total: counter(),
  output_tokens_total: counter(),
  estimated_cost_dollars: counter(),

  // Health
  error_rate: counter(),
  cache_hit_rate: gauge(),
  guardrail_block_rate: gauge(),
  empty_retrieval_rate: gauge(),     // queries with no results above threshold
};
```

---

#### Evaluation Pipeline

**Role:** Automated quality measurement, runs in CI/CD and on a schedule.

```
On deploy:
  1. Run evaluation dataset (300 QA pairs) through new code
  2. Compute: Recall@10, Faithfulness, Answer Correctness
  3. Compare to baseline (previous deploy)
  4. If any metric drops > 5%: FAIL the deploy

On schedule (daily):
  1. Sample 100 production queries from logs
  2. Run LLM-as-judge on faithfulness
  3. Aggregate scores, push to dashboard
  4. Alert if scores drop below threshold
```

---

### Data Flow: Query Path

```
1. Client sends query
2. API Gateway: authenticate, rate limit, validate
3. Orchestrator: input guardrails
4. Orchestrator: check cache → hit? return cached response
5. Embedding Service: embed query → vector
6. Retrieval Layer: parallel vector search + keyword search
7. Orchestrator: merge results, apply retrieval guardrails
8. Reranker: re-score top 20 → select top 5
9. Orchestrator: assemble prompt (system prompt + chunks + query)
10. LLM Service: generate answer (streaming)
11. Orchestrator: output guardrails
12. Orchestrator: cache response, log for evaluation
13. Client receives streamed response + source citations
```

**Typical latency breakdown:**

| Step | Time |
|------|------|
| Auth + validation | 5ms |
| Input guardrails | 10-50ms |
| Embedding | 20-50ms |
| Vector search | 10-50ms |
| Keyword search | 10-30ms |
| Reranking | 50-200ms |
| LLM (TTFT) | 200-800ms |
| LLM (full) | 1-3s |
| Output guardrails | 10-50ms |
| **Total (no cache)** | **1.5-4s** |
| **Total (cache hit)** | **10-20ms** |

### Data Flow: Ingestion Path

```
1. Client uploads document via Ingestion API
2. API validates format, size, permissions
3. Store raw document in Object Storage (S3)
4. Create metadata record in PostgreSQL (status: "processing")
5. Enqueue processing job in message queue
6. Ingestion Worker picks up job:
   a. Download document from S3
   b. Parse (PDF/DOCX → text + images)
   c. OCR if needed
   d. PII redaction
   e. Chunk (512-1024 tokens, with overlap)
   f. Batch embed all chunks
   g. Store vectors + metadata in Vector DB
   h. Store text + metadata in Elasticsearch
   i. Update PostgreSQL metadata (status: "indexed", chunk_count, etc.)
7. Notify client (webhook or status poll) that document is searchable
```

**Typical timing:**

| Step | Time |
|------|------|
| Upload + store raw | 1-5s |
| Queue wait | 0s - minutes (depends on backlog) |
| Parse + OCR | 5-60s per document |
| Chunk | < 1s |
| Embed (batch) | 2-10s (depends on chunk count) |
| Store vectors | 1-5s |
| **Total per document** | **10s - 2min** |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**No LLM fallback.** A team used a single LLM provider (OpenAI). During an API outage, 100% of queries failed for 45 minutes. Their SLA was 99.9% uptime (43 minutes of downtime per month). One outage consumed the entire monthly budget. **Always have a fallback LLM provider. Even a weaker model returning answers is better than returning errors.**

**Synchronous ingestion blocking the API.** A team processed document uploads synchronously in the query API server. A user uploaded a 500-page PDF, which consumed CPU for 3 minutes and caused query latency to spike for all users. **Ingestion must be async. Accept the upload, return immediately, process in background workers.**

**Vector DB and Elasticsearch out of sync.** After a partial ingestion failure, 2,000 chunks were in the vector DB but not in Elasticsearch (or vice versa). Hybrid search returned inconsistent results -- some queries found documents via vector search but not keyword search. **Use a transactional approach: write to both stores in the same job, and if either fails, retry the entire job. Track sync status in metadata.**

**No cost tracking.** A team deployed with GPT-4 for all queries. Monthly cost was $45,000. They discovered that 60% of queries were simple FAQ lookups that a much cheaper model could handle. **Route queries by complexity: use a cheap/fast model for simple queries and reserve the expensive model for complex ones.**
:::

## 🎯 Checkpoint

::: details Question 1 -- System design interview
**Q:** Design a RAG system for a customer support platform serving 100,000 queries/day across 50 tenants, each with 1,000-50,000 documents. Walk through the architecture.

**A:** **Query Path:** API Gateway (Kong/nginx) → Auth Service (validate JWT, extract tenant_id and permissions) → Orchestrator (Node.js/NestJS). Orchestrator runs input guardrails (length, PII, content safety), checks Redis cache, then embeds the query via Embedding Service. Parallel retrieval: pgvector (vector search with tenant_id filter) + Elasticsearch (BM25 with tenant_id filter). Merge with RRF, apply retrieval guardrails (ACL, relevance threshold), rerank top-20 to top-5 via Cohere API. Assemble prompt, call Claude/GPT-4o with streaming. Output guardrails (PII scan, grounding check). Cache result in Redis (TTL 1 hour, keyed by query hash + tenant_id). Log to PostgreSQL for evaluation.

**Ingestion Path:** Ingestion API accepts documents, stores in S3, enqueues job in SQS/BullMQ. Worker pool (auto-scaled by queue depth) processes: parse → chunk → embed (batch) → store in pgvector + Elasticsearch → update PostgreSQL metadata.

**Scale math:** 100K queries/day = ~1.2 QPS average, ~10 QPS peak. Single orchestrator instance can handle this. LLM rate limits are the real constraint -- at 10 QPS with streaming, you need sufficient rate limit allocation from the provider. Embedding: one instance handles 50+ QPS. pgvector: a single PostgreSQL instance with pgvector handles 10M+ vectors easily.

**Multi-tenancy:** Tenant isolation via mandatory metadata filter on every query. Separate Elasticsearch indices per tenant for cleaner isolation. Shared pgvector with tenant_id column (simpler ops, filter on every query).

**Cost:** At 100K queries/day with Claude Sonnet (~$0.008/query): ~$800/day = ~$24K/month. Add caching (30% hit rate): ~$17K/month. Route 50% of simple queries to a cheaper model: ~$12K/month.
:::

::: details Question 2 -- Ingestion failure handling
**Q:** An ingestion worker crashes after embedding 500 of 1,000 chunks from a document but before writing any to the vector DB. How should the system handle this?

**A:** **Detection:** The message queue's visibility timeout expires (the worker did not acknowledge the job). The job becomes visible again. **Re-processing:** Another worker picks up the same job and processes the entire document from scratch. The previous 500 embeddings are lost (they were in the crashed worker's memory), but no partial data was written to the vector DB, so there is no inconsistency.

**Design for this:** (1) Jobs should be **idempotent** -- re-processing a document should produce the same result. Use document_id to delete existing chunks before inserting new ones (upsert semantics). (2) Use **checkpointing** for large documents: after every 100 chunks, write them to the vector DB and update a progress marker. If the worker crashes, the next worker resumes from the last checkpoint rather than starting over. (3) Set the **visibility timeout** longer than the maximum expected processing time (e.g., 10 minutes for a large document). If it is too short, two workers process the same document simultaneously. (4) Track **processing status** in PostgreSQL: "queued" → "processing" → "completed" / "failed". If a document stays in "processing" for too long, alert.
:::

## Key Mental Models

- **The query path is latency-sensitive, the ingestion path is throughput-sensitive** -- architect them differently. Query path: minimize sequential steps, cache aggressively. Ingestion path: batch, queue, scale workers horizontally.
- **The LLM is a dependency, not the system** -- it is one component among many. Build fallbacks, monitor its availability, and do not let a provider outage bring down your entire product.
- **Multi-tenancy is a database concern, not an LLM concern** -- enforce tenant isolation at the storage layer. The LLM should never be trusted with access control.
- **Instrument from day one** -- per-stage latency, token usage, cost per query, and quality metrics. You cannot optimize what you do not measure.

## Related

- [Microservices & Async Processing](02-microservices.md) -- how to split this architecture into services
- [Evaluation](/rag/module-13/) -- the evaluation pipeline component in detail
- [Security](/rag/module-14/) -- where security controls live in this architecture
