---
title: Observability
outline: deep
---

# Observability

Interview weight: 🔥🔥 | Prerequisites: [Full system architecture](/rag/module-16/01-system-architecture.md), [Latency & failure handling](03-latency-failure.md)

## 🗣️ In Plain English

::: tip In Plain English
Observability for RAG is like having security cameras, speedometers, and health monitors throughout a factory. Logs tell you what happened (the security footage), metrics tell you how fast and how often (the speedometers), and traces follow one product through every station on the assembly line. Without all three, when something goes wrong, you are guessing.
:::

## ⚙️ Under the Hood

### The Three Pillars for RAG

RAG systems need standard observability (logs, metrics, traces) plus LLM-specific observability (prompt traces, token usage, retrieval quality). The three standard pillars are necessary but not sufficient.

```
┌─────────────────────────────────────────────────────────────┐
│                    RAG Observability Stack                    │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────┐ │
│  │  Logs    │  │ Metrics  │  │ Traces   │  │ LLM-Specific│ │
│  │ (what    │  │ (how     │  │ (one     │  │ (prompt,    │ │
│  │ happened)│  │  much)   │  │  request │  │  retrieval, │ │
│  │          │  │          │  │  path)   │  │  quality)   │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────┘ │
│       │              │             │              │          │
│  ELK/Datadog   Prometheus/    Jaeger/Tempo   LangSmith/    │
│                Grafana                       Langfuse       │
└─────────────────────────────────────────────────────────────┘
```

### Structured Logging: What to Log and What NOT to Log

```typescript
// run: npx ts-node rag-logging.ts
import { randomUUID } from 'node:crypto';

interface RAGLogEntry {
  // Identity
  correlationId: string;  // trace through entire request
  tenantId: string;
  timestamp: string;
  stage: string;

  // Timing
  durationMs: number;

  // Stage-specific data
  data: Record<string, unknown>;
}

function logRAGStage(entry: RAGLogEntry): void {
  // Structured JSON logging (pino-compatible format)
  const log = {
    level: 'info',
    time: entry.timestamp,
    correlationId: entry.correlationId,
    tenantId: entry.tenantId,
    stage: entry.stage,
    durationMs: entry.durationMs,
    ...entry.data,
  };
  console.log(JSON.stringify(log));
}

// Example: full request lifecycle logging
async function processQueryWithLogging(
  query: string,
  tenantId: string
): Promise<void> {
  const correlationId = randomUUID();
  const requestStart = performance.now();

  // Stage 1: Query processing
  const queryStart = performance.now();
  // ... process query ...
  logRAGStage({
    correlationId,
    tenantId,
    timestamp: new Date().toISOString(),
    stage: 'query_processing',
    durationMs: performance.now() - queryStart,
    data: {
      queryLength: query.length,
      queryTokenCount: estimateTokens(query),
      // DO NOT log the raw query if it could contain PII
      queryHash: hashForDedup(query),
    },
  });

  // Stage 2: Embedding
  const embedStart = performance.now();
  // ... embed query ...
  logRAGStage({
    correlationId,
    tenantId,
    timestamp: new Date().toISOString(),
    stage: 'embedding',
    durationMs: performance.now() - embedStart,
    data: {
      model: 'text-embedding-3-small',
      cached: false,
      dimension: 1536,
    },
  });

  // Stage 3: Retrieval
  const retrievalStart = performance.now();
  // ... retrieve chunks ...
  logRAGStage({
    correlationId,
    tenantId,
    timestamp: new Date().toISOString(),
    stage: 'retrieval',
    durationMs: performance.now() - retrievalStart,
    data: {
      vectorResultCount: 15,
      bm25ResultCount: 12,
      mergedResultCount: 20,
      topScore: 0.87,
      bottomScore: 0.42,
      // Log chunk IDs for debugging, NOT chunk text
      chunkIds: ['chunk-abc', 'chunk-def', 'chunk-ghi'],
    },
  });

  // Stage 4: Reranking
  const rerankStart = performance.now();
  // ... rerank ...
  logRAGStage({
    correlationId,
    tenantId,
    timestamp: new Date().toISOString(),
    stage: 'reranking',
    durationMs: performance.now() - rerankStart,
    data: {
      inputCount: 20,
      outputCount: 5,
      topScoreBefore: 0.87,
      topScoreAfter: 0.94,
      // Which chunks moved up/down -- critical for debugging quality
      promotedChunks: ['chunk-ghi'], // was rank 5, now rank 1
      demotedChunks: ['chunk-abc'],  // was rank 1, now rank 4
    },
  });

  // Stage 5: LLM generation
  const llmStart = performance.now();
  // ... generate ...
  logRAGStage({
    correlationId,
    tenantId,
    timestamp: new Date().toISOString(),
    stage: 'llm_generation',
    durationMs: performance.now() - llmStart,
    data: {
      model: 'gpt-4o-2024-08-06',
      inputTokens: 1842,
      outputTokens: 287,
      firstTokenMs: 340,
      finishReason: 'stop',
      // Log the prompt template VERSION, not the full prompt
      promptTemplateVersion: 'v3.2',
      // DO NOT log the full prompt -- it contains retrieved context
      // which may include sensitive customer data
    },
  });

  // Stage 6: Total request
  logRAGStage({
    correlationId,
    tenantId,
    timestamp: new Date().toISOString(),
    stage: 'request_complete',
    durationMs: performance.now() - requestStart,
    data: {
      totalLatencyMs: performance.now() - requestStart,
      cacheHit: false,
      fallbackUsed: false,
      sourceCount: 5,
    },
  });
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // rough approximation
}

function hashForDedup(text: string): string {
  const { createHash } = require('node:crypto');
  return createHash('sha256').update(text).digest('hex').substring(0, 16);
}
```

### What NOT to Log

| Data | Why Not | Alternative |
|------|---------|-------------|
| Raw user query text | May contain PII (names, emails, account numbers) | Log a hash for deduplication, or log only in a PII-safe logging tier |
| Full prompt with context | Contains retrieved documents that may have sensitive data | Log prompt template version and token counts |
| Auth tokens / API keys | Security -- if logs are compromised, keys are exposed | Log token type and expiry, never the token itself |
| Full LLM response text | May contain PII reflected from context, and is expensive to store | Log response length, token count, and finish reason |
| Embedding vectors | Huge (6KB each), no human can read them, waste of storage | Log the cache hit/miss status and model used |

### Metrics: What to Measure

```typescript
// run: npx ts-node rag-metrics.ts

// Define the metrics a RAG system should expose
// Using Prometheus client conventions

interface RAGMetrics {
  // Latency (histograms)
  queryEmbeddingLatency: number;     // ms per query embedding
  vectorSearchLatency: number;       // ms per vector search
  bm25SearchLatency: number;         // ms per keyword search
  rerankingLatency: number;          // ms per reranking call
  llmFirstTokenLatency: number;      // ms to first LLM token
  llmTotalLatency: number;           // ms for complete LLM response
  totalQueryLatency: number;         // ms end-to-end

  // Throughput (counters)
  queriesTotal: number;              // total queries processed
  embeddingsComputed: number;        // total embeddings generated
  documentsIngested: number;         // documents processed in ingestion

  // Cache (gauges + counters)
  embeddingCacheHitRate: number;     // % of queries with cached embedding
  retrievalCacheHitRate: number;     // % of queries with cached retrieval
  responseCacheHitRate: number;      // % of queries with cached LLM response
  cacheSize: number;                 // current cache memory usage

  // Quality (gauges) -- harder to compute, critical to track
  retrievalRelevanceScore: number;   // avg top-k relevance score
  rerankingLift: number;             // avg score improvement from reranking
  emptyRetrievalRate: number;        // % of queries with 0 results
  fallbackRate: number;              // % of queries using fallback path

  // Cost (counters)
  embeddingTokensUsed: number;       // total tokens sent to embedding API
  llmInputTokensUsed: number;        // total input tokens to LLM
  llmOutputTokensUsed: number;       // total output tokens from LLM
  estimatedCostUsd: number;          // running cost estimate

  // Errors (counters)
  embeddingErrors: number;
  vectorDbErrors: number;
  llmErrors: number;
  rerankingErrors: number;
  timeoutErrors: number;
}

// Prometheus metric definitions (pseudo-code, using prom-client conventions)
const metricDefinitions = [
  {
    name: 'rag_query_duration_seconds',
    type: 'histogram',
    help: 'End-to-end query latency',
    labels: ['tenant', 'cache_status', 'model'],
    buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  },
  {
    name: 'rag_stage_duration_seconds',
    type: 'histogram',
    help: 'Latency per pipeline stage',
    labels: ['stage'], // embedding, retrieval, reranking, llm
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  },
  {
    name: 'rag_cache_hits_total',
    type: 'counter',
    help: 'Cache hit count by layer',
    labels: ['layer'], // embedding, retrieval, response
  },
  {
    name: 'rag_cache_misses_total',
    type: 'counter',
    help: 'Cache miss count by layer',
    labels: ['layer'],
  },
  {
    name: 'rag_llm_tokens_total',
    type: 'counter',
    help: 'LLM token usage',
    labels: ['direction', 'model'], // direction: input/output
  },
  {
    name: 'rag_errors_total',
    type: 'counter',
    help: 'Error count by component',
    labels: ['component', 'error_type'],
  },
  {
    name: 'rag_retrieval_score',
    type: 'histogram',
    help: 'Top retrieval relevance score distribution',
    labels: ['retrieval_type'], // vector, bm25, hybrid
    buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  },
  {
    name: 'rag_fallback_activations_total',
    type: 'counter',
    help: 'Fallback path activations',
    labels: ['component', 'fallback_type'],
  },
  {
    name: 'rag_cost_usd',
    type: 'counter',
    help: 'Estimated cost in USD',
    labels: ['component'], // embedding, llm, reranker
  },
];
```

### Key Dashboard Panels

| Panel | Metric | Alert Threshold |
|-------|--------|:---:|
| **P95 query latency** | `rag_query_duration_seconds` | > 3s for 5 min |
| **Error rate** | `rag_errors_total / rag_queries_total` | > 1% for 5 min |
| **Cache hit rate** | `hits / (hits + misses)` per layer | < 20% (embedding), < 10% (response) |
| **LLM token burn rate** | `rate(rag_llm_tokens_total[1h])` | > 2x baseline |
| **Empty retrieval rate** | queries with 0 results / total | > 5% |
| **Fallback activation rate** | `rag_fallback_activations_total` | > 5% over 15 min |
| **Cost per query** | `rag_cost_usd / rag_queries_total` | > $0.05 per query |
| **Reranker skip rate** | reranker fallbacks / total queries | > 0% (any skip is notable) |

### Distributed Tracing: Following a Query Through the Pipeline

```typescript
// run: npx ts-node distributed-tracing.ts
// Conceptual OpenTelemetry instrumentation for RAG

interface SpanConfig {
  name: string;
  attributes: Record<string, string | number | boolean>;
}

// Trace structure for a single RAG query:
//
// [rag.query]──────────────────────────────────────────────────── 1,850ms
//   ├─[rag.cache_check]─── 2ms
//   ├─[rag.query_processing]─── 15ms
//   │   └─[rag.guardrail.input]─── 10ms
//   ├─[rag.embedding]─── 95ms
//   │   └─[http.request POST /embeddings]─── 90ms
//   ├─[rag.retrieval]─── 75ms  (parallel children)
//   │   ├─[rag.vector_search]─── 55ms
//   │   │   └─[db.query qdrant.search]─── 50ms
//   │   └─[rag.bm25_search]─── 65ms
//   │       └─[http.request POST /search]─── 60ms
//   ├─[rag.reranking]─── 195ms
//   │   └─[http.request POST /rerank]─── 190ms
//   ├─[rag.context_assembly]─── 8ms
//   ├─[rag.llm_generation]─── 1,350ms
//   │   ├─[rag.prompt_construction]─── 5ms
//   │   └─[http.request POST /chat/completions]─── 1,340ms
//   │       ├─ attribute: first_token_ms=310
//   │       ├─ attribute: input_tokens=1842
//   │       └─ attribute: output_tokens=287
//   └─[rag.guardrail.output]─── 12ms

// Span attributes specific to RAG (beyond standard HTTP/DB spans)
const ragSpanAttributes = {
  // Query span
  'rag.query.token_count': 24,
  'rag.query.cache_hit': false,
  'rag.query.tenant_id': 'tenant-abc',

  // Retrieval span
  'rag.retrieval.vector_count': 15,
  'rag.retrieval.bm25_count': 12,
  'rag.retrieval.merged_count': 20,
  'rag.retrieval.top_score': 0.87,

  // Reranking span
  'rag.reranking.input_count': 20,
  'rag.reranking.output_count': 5,
  'rag.reranking.model': 'cross-encoder/ms-marco-MiniLM-L-6-v2',
  'rag.reranking.top_score_before': 0.87,
  'rag.reranking.top_score_after': 0.94,

  // LLM span
  'rag.llm.model': 'gpt-4o-2024-08-06',
  'rag.llm.input_tokens': 1842,
  'rag.llm.output_tokens': 287,
  'rag.llm.first_token_ms': 310,
  'rag.llm.finish_reason': 'stop',
  'rag.llm.prompt_template_version': 'v3.2',

  // Cost (computed from token counts)
  'rag.cost.embedding_usd': 0.0000005,
  'rag.cost.llm_input_usd': 0.0046,
  'rag.cost.llm_output_usd': 0.00287,
  'rag.cost.total_usd': 0.0075,
};
```

### Retrieval Traces: Debugging Quality Issues

When answer quality drops, you need to see exactly which chunks were retrieved and how reranking changed the order.

```typescript
// run: npx ts-node retrieval-traces.ts

interface RetrievalTrace {
  correlationId: string;
  query: string; // store in PII-safe tier only
  retrievalResults: {
    chunkId: string;
    documentId: string;
    documentTitle: string;
    vectorScore: number | null;  // null if not from vector search
    bm25Score: number | null;    // null if not from BM25
    fusedScore: number;          // after RRF merge
    rerankScore: number | null;  // after reranking
    rankBefore: number;          // rank after fusion, before reranking
    rankAfter: number;           // rank after reranking
    usedInContext: boolean;      // was this chunk sent to the LLM?
  }[];
  contextTokenCount: number;
  timestamp: string;
}

// Example retrieval trace output (what you see in LangSmith/Langfuse)
const exampleTrace: RetrievalTrace = {
  correlationId: 'req-abc-123',
  query: 'What is the refund policy for enterprise plans?',
  retrievalResults: [
    {
      chunkId: 'chunk-445',
      documentId: 'doc-policies-v3',
      documentTitle: 'Enterprise Refund Policy 2024',
      vectorScore: 0.82,
      bm25Score: 0.71,
      fusedScore: 0.78,
      rerankScore: 0.96,  // reranker boosted this -- it is the right chunk
      rankBefore: 3,
      rankAfter: 1,       // promoted from rank 3 to rank 1
      usedInContext: true,
    },
    {
      chunkId: 'chunk-112',
      documentId: 'doc-policies-v3',
      documentTitle: 'Enterprise Refund Policy 2024',
      vectorScore: 0.88,  // highest vector score
      bm25Score: null,     // not in BM25 results
      fusedScore: 0.85,
      rerankScore: 0.72,  // reranker demoted -- this is the TOC, not content
      rankBefore: 1,
      rankAfter: 4,       // demoted from rank 1 to rank 4
      usedInContext: true,
    },
    // ... more results
  ],
  contextTokenCount: 1842,
  timestamp: '2026-08-06T10:30:00Z',
};

// This trace tells you:
// 1. Vector search thought chunk-112 was best (score 0.88) but it was a TOC page
// 2. Reranker correctly identified chunk-445 as the actual answer (score 0.96)
// 3. Without the reranker, the LLM would have received a table of contents
//    as its top context -- explaining why quality was bad before reranking was added
```

### LLM-Specific Observability Tools

| Tool | What It Does | Best For |
|------|-------------|----------|
| **LangSmith** (LangChain) | Traces LLM chains, logs prompts/responses, evaluations | Teams using LangChain, need prompt versioning |
| **Langfuse** (open source) | Trace logging, prompt management, cost tracking, evaluations | Self-hosted, privacy-sensitive deployments |
| **Helicone** | LLM API proxy that logs all calls, cost tracking | Simple setup, just change the API base URL |
| **OpenTelemetry + custom spans** | General-purpose, integrates with existing infra | Teams with existing Prometheus/Grafana/Jaeger |
| **Datadog LLM Observability** | Integrated with Datadog APM, auto-instruments LLM SDKs | Teams already using Datadog |

### Cost Tracking Per Query

```typescript
// run: npx ts-node cost-tracking.ts

interface ModelPricing {
  inputPer1MTokens: number;
  outputPer1MTokens: number;
}

const pricing: Record<string, ModelPricing> = {
  'text-embedding-3-small': { inputPer1MTokens: 0.02, outputPer1MTokens: 0 },
  'text-embedding-3-large': { inputPer1MTokens: 0.13, outputPer1MTokens: 0 },
  'gpt-4o': { inputPer1MTokens: 2.50, outputPer1MTokens: 10.00 },
  'gpt-4o-mini': { inputPer1MTokens: 0.15, outputPer1MTokens: 0.60 },
  'claude-sonnet-4-20250514': { inputPer1MTokens: 3.00, outputPer1MTokens: 15.00 },
};

interface QueryCostBreakdown {
  correlationId: string;
  embeddingCost: number;
  rerankingCost: number;
  llmInputCost: number;
  llmOutputCost: number;
  totalCost: number;
  timestamp: string;
}

function calculateQueryCost(
  embeddingModel: string,
  embeddingTokens: number,
  llmModel: string,
  llmInputTokens: number,
  llmOutputTokens: number,
  rerankingCost: number = 0.001 // flat per-query reranker cost
): QueryCostBreakdown {
  const embPricing = pricing[embeddingModel];
  const llmPricing = pricing[llmModel];

  const embeddingCostUsd = (embeddingTokens / 1_000_000) * embPricing.inputPer1MTokens;
  const llmInputCostUsd = (llmInputTokens / 1_000_000) * llmPricing.inputPer1MTokens;
  const llmOutputCostUsd = (llmOutputTokens / 1_000_000) * llmPricing.outputPer1MTokens;

  return {
    correlationId: '',
    embeddingCost: embeddingCostUsd,
    rerankingCost,
    llmInputCost: llmInputCostUsd,
    llmOutputCost: llmOutputCostUsd,
    totalCost: embeddingCostUsd + rerankingCost + llmInputCostUsd + llmOutputCostUsd,
    timestamp: new Date().toISOString(),
  };
}

// Example: typical query cost
const typicalCost = calculateQueryCost(
  'text-embedding-3-small',
  30,       // query tokens
  'gpt-4o',
  1800,     // input tokens (prompt + context)
  300,      // output tokens
);

// typicalCost.totalCost ≈ $0.0078 per query
// At 10K queries/day = ~$78/day = ~$2,340/month
// LLM output cost dominates: $0.003 of the $0.0078
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**PII in logs causes a compliance incident.** A developer logs the full user query for debugging. A user asks "My account john.doe@company.com was charged twice, order #12345." The query -- containing a name, email, and order number -- is now in Elasticsearch with a 90-day retention policy. A compliance audit finds PII in logs that should be PII-free. Fix: never log raw queries in the standard logging tier. Hash queries for deduplication, or use a PII-safe logging tier with strict access controls and short retention.

**No per-query cost tracking hides a runaway model.** A developer switches the LLM from gpt-4o-mini to gpt-4o "temporarily" for testing and forgets to revert. Nobody notices because total monthly cost is watched but not per-query cost. At 10K queries/day, the switch costs an extra $55/day ($1,650/month) before anyone spots it in the monthly bill. Fix: track cost per query as a metric, alert when p50 cost per query exceeds the baseline by more than 20%.

**Missing correlation IDs make debugging impossible.** A user reports a bad answer. The support team has the query timestamp and the response, but cannot find the corresponding retrieval results, reranking decisions, or LLM prompt because logs from different services use different request identifiers. Fix: generate a correlation ID at the API gateway and propagate it through every service and every log line. Use OpenTelemetry trace context propagation.

**Alert fatigue from noisy metrics.** The team sets up 50 alerts on day one. Within a week, they are ignoring all of them because the thresholds are too tight. When a real reranker outage happens, the alert is lost in noise. Fix: start with 5-7 critical alerts (error rate, p95 latency, fallback rate, cost spike, empty retrieval rate). Tune thresholds based on observed baselines. Add more alerts only when you have a specific incident that would have been caught.

:::

## 🎯 Checkpoint

::: details Question 1 -- What to log
**Q:** You are designing the logging strategy for a multi-tenant RAG system. What do you log at the retrieval stage, and what do you explicitly exclude?

**A:** **Log:** correlation ID, tenant ID, retrieval type (vector/BM25/hybrid), number of results returned, relevance scores (top, bottom, mean), chunk IDs of retrieved results, latency in milliseconds, cache hit/miss status, any filters applied (document type, date range). **Exclude:** the raw query text (may contain PII), the chunk text content (may contain sensitive customer data), any auth tokens, and embedding vectors (too large, not human-readable). Log chunk IDs instead of text -- you can look up the text from the chunk store if needed during debugging, with proper access controls.
:::

::: details Question 2 -- Distributed tracing
**Q:** A user reports that queries are taking 5+ seconds intermittently. You have distributed tracing enabled. Describe how you would use traces to diagnose the issue.

**A:** First, filter traces by latency > 5s in Jaeger/Tempo to find affected requests. Look at the span waterfall for a slow request to identify which stage consumed the most time. Common findings: (1) **LLM span is 4s+** -- the LLM provider is having latency spikes; check their status page, consider model routing to a backup. (2) **Vector search span is 2s+** -- the vector DB is under load; check if a re-indexing job is running concurrently; look at DB metrics for memory pressure or segment merging. (3) **Embedding span is 1s+** -- the embedding API is being rate-limited (429 responses followed by retries); check the retry count in span attributes. (4) **Gap between spans** -- time not accounted for in any span indicates network latency or queueing; check connection pool exhaustion. Compare slow traces with normal traces to isolate the differing component.
:::

::: details Question 3 -- Cost alerting
**Q:** Design a cost alerting system for a RAG pipeline. What metrics do you track, what thresholds do you set, and how do you avoid false positives?

**A:** Track three cost metrics: (1) **Per-query cost** (sum of embedding + reranker + LLM input + LLM output costs) -- alert when p50 exceeds 150% of the 7-day rolling baseline. This catches model changes and prompt regressions. (2) **Hourly token burn rate** -- alert when the hourly rate exceeds 200% of the same hour last week (accounts for daily traffic patterns). This catches traffic spikes and prompt injection attacks that generate long outputs. (3) **Daily total cost** -- alert when projected daily cost (based on first 4 hours) exceeds 150% of the 7-day average. This is the backstop. To avoid false positives: use relative thresholds (% of baseline) rather than absolute values, so natural traffic growth does not trigger alerts. Require the condition to persist for at least 15 minutes before alerting. Group related alerts so a single incident does not fire 5 separate notifications.
:::

## Key Mental Models

- **Correlation IDs are non-negotiable.** Without them, you cannot connect a bad answer to the retrieval that caused it.
- **Log metadata, not content.** Log chunk IDs, scores, token counts, and latencies. Never log raw text that might contain PII.
- **Five critical alerts, not fifty.** Start with error rate, p95 latency, fallback rate, cost spike, and empty retrieval rate. Add more only when a real incident demands it.
- **Retrieval traces are the quality debugger.** When answers are wrong, the problem is almost always in which chunks were retrieved and how reranking reordered them.
- **Cost per query is a first-class metric.** Total monthly cost hides per-query regressions that compound into massive overruns.

## Related

- [Latency & failure handling](03-latency-failure.md) -- the fallbacks that observability must track
- [Scaling & cost](02-scaling-cost.md) -- cost tracking that feeds into cost optimization
- [Caching & freshness](01-caching-freshness.md) -- cache hit rate as a key operational metric
- [Full system architecture](/rag/module-16/01-system-architecture.md) -- the components being observed
