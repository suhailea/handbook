---
title: Latency Optimization, Failure Handling & Versioning
outline: deep
---

# Latency Optimization, Failure Handling & Versioning

Interview weight: 🔥🔥🔥 | Prerequisites: [Full system architecture](/rag/module-16/01-system-architecture.md), [Retrieval](/rag/module-06/), [Reranking](/rag/module-07/)

## 🗣️ In Plain English

::: tip In Plain English
A RAG query passes through a dozen components, each adding latency and each capable of failing. Think of it like a relay race with six runners -- if any runner trips, you need a backup plan, and the total race time is the sum of all legs. Latency optimization is about making runners faster or running some legs in parallel. Failure handling is about having a substitute ready for every runner. Versioning is about swapping runners without stopping the race.
:::

## ⚙️ Under the Hood

### Latency Budget

Every RAG query must complete within a time budget. Here is a realistic breakdown for a 2-second target.

```
Total budget: 2,000 ms
┌──────────────────────────────────────────────────────────────────┐
│ Query processing & validation          │    50 ms  │  2.5%      │
│ Query embedding                        │   100 ms  │  5.0%      │
│ Vector search (ANN)                    │    50 ms  │  2.5%      │
│ BM25 / keyword search                  │    50 ms  │  2.5%      │
│ Reranking (cross-encoder, top 20→5)    │   200 ms  │ 10.0%      │
│ Context construction & prompt assembly │    50 ms  │  2.5%      │
│ LLM generation (first token)          │   300 ms  │ 15.0%      │
│ LLM generation (streaming)            │   900 ms  │ 45.0%      │
│ Overhead (network, serialization)      │   300 ms  │ 15.0%      │
└──────────────────────────────────────────────────────────────────┘
```

**Key insight:** LLM generation consumes 60% of the budget. No amount of retrieval optimization eliminates that. Streaming is the primary UX strategy -- the user sees tokens arriving after ~400ms instead of waiting 1,200ms for the complete response.

### Parallel Retrieval

The biggest latency win in the retrieval stage is running vector search and keyword search simultaneously.

```typescript
// run: npx ts-node parallel-retrieval.ts
interface RetrievalResult {
  chunkId: string;
  score: number;
  source: 'vector' | 'bm25';
  text: string;
}

async function parallelRetrieval(
  query: string,
  queryEmbedding: number[],
  options: { topK: number; tenantId: string }
): Promise<RetrievalResult[]> {
  // Run both searches in parallel -- saves 50ms vs sequential
  const [vectorResults, bm25Results] = await Promise.all([
    vectorSearch(queryEmbedding, options),
    keywordSearch(query, options),
  ]);

  // Merge results using Reciprocal Rank Fusion
  return reciprocalRankFusion(vectorResults, bm25Results);
}

// Placeholder implementations
async function vectorSearch(
  embedding: number[],
  options: { topK: number; tenantId: string }
): Promise<RetrievalResult[]> {
  // Vector DB ANN search, typically 20-80ms
  return [];
}

async function keywordSearch(
  query: string,
  options: { topK: number; tenantId: string }
): Promise<RetrievalResult[]> {
  // Elasticsearch/OpenSearch BM25 search, typically 30-80ms
  return [];
}

function reciprocalRankFusion(
  ...resultSets: RetrievalResult[][]
): RetrievalResult[] {
  const k = 60; // RRF constant
  const scores = new Map<string, { score: number; result: RetrievalResult }>();

  for (const results of resultSets) {
    results.forEach((result, rank) => {
      const rrfScore = 1 / (k + rank + 1);
      const existing = scores.get(result.chunkId);
      if (existing) {
        existing.score += rrfScore;
      } else {
        scores.set(result.chunkId, { score: rrfScore, result });
      }
    });
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ result, score }) => ({ ...result, score }));
}
```

### Streaming: Start Sending Before You Finish

```typescript
// run: npx ts-node streaming-response.ts
import { Readable } from 'node:stream';

interface RAGStreamOptions {
  query: string;
  onSourcesReady: (sources: string[]) => void;
  onToken: (token: string) => void;
  onComplete: (metadata: { totalTokens: number; latencyMs: number }) => void;
}

async function streamRAGResponse(options: RAGStreamOptions): Promise<void> {
  const start = performance.now();

  // Steps 1-4 happen before streaming starts
  const queryEmbedding = await embedQuery(options.query); // 100ms
  const retrievalResults = await parallelRetrieval(
    options.query, queryEmbedding, { topK: 20, tenantId: 'default' }
  );
  const reranked = await rerank(options.query, retrievalResults); // 200ms
  const context = buildContext(reranked.slice(0, 5));

  // Notify client of sources before LLM starts generating
  options.onSourcesReady(reranked.slice(0, 5).map(r => r.chunkId));

  // Step 5: Stream LLM response token-by-token
  let totalTokens = 0;

  // Pseudocode for streaming LLM call
  // const stream = await llm.chat({
  //   messages: [{ role: 'user', content: buildPrompt(options.query, context) }],
  //   stream: true,
  // });
  // for await (const chunk of stream) {
  //   options.onToken(chunk.content);
  //   totalTokens += 1;
  // }

  options.onComplete({
    totalTokens,
    latencyMs: performance.now() - start,
  });
}

// Placeholder functions
async function embedQuery(query: string): Promise<number[]> { return []; }
async function rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> { return results; }
function buildContext(chunks: RetrievalResult[]): string { return chunks.map(c => c.text).join('\n\n'); }
function buildPrompt(query: string, context: string): string {
  return `Context:\n${context}\n\nQuestion: ${query}\n\nAnswer based on the context above.`;
}
```

### Additional Latency Optimizations

| Optimization | Latency Saved | Tradeoff |
|-------------|:---:|----------|
| Embedding cache hit | ~100ms | Memory for cache storage |
| Retrieval cache hit | ~150ms | Risk of stale results |
| Response cache hit | ~1,200ms | Risk of stale/wrong answers |
| Smaller candidate set (topK 20 → 10) | ~50ms on reranking | May miss relevant chunks |
| Faster/smaller LLM (gpt-4o-mini) | ~400ms | Lower quality on complex queries |
| Connection pooling | ~20-50ms per component | Pool management overhead |
| Edge embedding (local model) | ~80ms (eliminates network) | Lower quality embeddings |

### Failure Handling: What Happens When Each Component Dies

Every external dependency can fail. The table below defines the fallback for each.

```typescript
// run: npx ts-node failure-handling.ts
type ComponentStatus = 'healthy' | 'degraded' | 'unavailable';

interface FallbackChain {
  component: string;
  fallbacks: {
    action: string;
    quality: 'full' | 'degraded' | 'minimal';
    description: string;
  }[];
}

const fallbackChains: FallbackChain[] = [
  {
    component: 'Vector DB',
    fallbacks: [
      {
        action: 'use_read_replica',
        quality: 'full',
        description: 'Route to read replica if primary is down',
      },
      {
        action: 'bm25_only',
        quality: 'degraded',
        description: 'Fall back to keyword search only (no semantic matching)',
      },
      {
        action: 'cached_results',
        quality: 'degraded',
        description: 'Serve cached retrieval results if available',
      },
    ],
  },
  {
    component: 'Embedding service',
    fallbacks: [
      {
        action: 'use_cached_embedding',
        quality: 'full',
        description: 'Use cached query embedding if exact match exists',
      },
      {
        action: 'bm25_only',
        quality: 'degraded',
        description: 'Skip embedding, use keyword search only',
      },
      {
        action: 'queue_for_retry',
        quality: 'minimal',
        description: 'Queue the query and notify user of delay',
      },
    ],
  },
  {
    component: 'LLM',
    fallbacks: [
      {
        action: 'fallback_model',
        quality: 'degraded',
        description: 'Switch to backup LLM provider (e.g., Anthropic → OpenAI)',
      },
      {
        action: 'cached_response',
        quality: 'degraded',
        description: 'Serve semantically cached response if similarity > 0.95',
      },
      {
        action: 'return_sources_only',
        quality: 'minimal',
        description: 'Return retrieved documents without LLM synthesis',
      },
    ],
  },
  {
    component: 'Reranker',
    fallbacks: [
      {
        action: 'skip_reranking',
        quality: 'degraded',
        description: 'Use raw retrieval scores (vector similarity + BM25 RRF)',
      },
    ],
  },
  {
    component: 'Document parser (ingestion)',
    fallbacks: [
      {
        action: 'dead_letter_queue',
        quality: 'degraded',
        description: 'Send unparseable document to DLQ, alert, continue pipeline',
      },
    ],
  },
];
```

### Handling Edge Cases in Retrieval

```typescript
// run: npx ts-node edge-cases.ts

interface QueryResult {
  status: 'success' | 'no_results' | 'conflicting' | 'low_confidence';
  answer?: string;
  sources: string[];
  confidence: number;
  metadata: Record<string, unknown>;
}

async function handleRetrievalEdgeCases(
  query: string,
  retrievedChunks: { text: string; score: number; source: string }[]
): Promise<QueryResult> {
  // Case 1: No results found
  if (retrievedChunks.length === 0) {
    return {
      status: 'no_results',
      answer: "I don't have information about this topic in the knowledge base.",
      sources: [],
      confidence: 0,
      metadata: { reason: 'empty_retrieval' },
    };
  }

  // Case 2: All results have very low relevance scores
  const maxScore = Math.max(...retrievedChunks.map(c => c.score));
  if (maxScore < 0.3) {
    // Attempt query broadening
    return {
      status: 'low_confidence',
      answer: "I found some potentially related information, but I'm not confident it answers your question.",
      sources: retrievedChunks.map(c => c.source),
      confidence: maxScore,
      metadata: { reason: 'low_relevance_scores', maxScore },
    };
  }

  // Case 3: Conflicting information across sources
  // Detect if retrieved chunks contain contradictory statements
  // This requires the LLM to identify conflicts
  if (hasConflictingInformation(retrievedChunks)) {
    return {
      status: 'conflicting',
      answer: undefined, // Let the LLM present both sides with citations
      sources: retrievedChunks.map(c => c.source),
      confidence: maxScore,
      metadata: {
        reason: 'conflicting_sources',
        instruction: 'Present both viewpoints with source citations',
      },
    };
  }

  return {
    status: 'success',
    sources: retrievedChunks.map(c => c.source),
    confidence: maxScore,
    metadata: {},
  };
}

function hasConflictingInformation(
  chunks: { text: string; score: number }[]
): boolean {
  // Simplified: in practice, this uses the LLM or a dedicated NLI model
  // to detect entailment vs contradiction between top chunks
  return false;
}
```

### LLM Timeout and Partial Response Handling

```typescript
// run: npx ts-node llm-timeout.ts

interface LLMStreamConfig {
  timeoutMs: number;           // total timeout for the entire generation
  firstTokenTimeoutMs: number; // timeout waiting for the first token
  maxTokens: number;
}

async function* streamWithTimeout(
  llmStream: AsyncIterable<string>,
  config: LLMStreamConfig
): AsyncGenerator<string> {
  const startTime = performance.now();
  let firstTokenReceived = false;
  let tokenCount = 0;

  for await (const token of llmStream) {
    const elapsed = performance.now() - startTime;

    // Check first-token timeout
    if (!firstTokenReceived) {
      if (elapsed > config.firstTokenTimeoutMs) {
        throw new Error(`LLM first token timeout after ${elapsed}ms`);
      }
      firstTokenReceived = true;
    }

    // Check total timeout
    if (elapsed > config.timeoutMs) {
      // Yield a truncation marker and stop
      yield '\n\n[Response truncated due to timeout]';
      return;
    }

    // Check max tokens
    tokenCount++;
    if (tokenCount >= config.maxTokens) {
      yield '\n\n[Response truncated: maximum length reached]';
      return;
    }

    yield token;
  }
}

const defaultConfig: LLMStreamConfig = {
  timeoutMs: 30_000,
  firstTokenTimeoutMs: 10_000,
  maxTokens: 2_000,
};
```

### Versioning: What Needs Version Tracking

A production RAG system has many independently versioned components. Changing any one can affect output quality.

| Component | What Changes | Impact of Change |
|-----------|-------------|------------------|
| Source documents | Content added/updated/deleted | Retrieved context changes |
| Document parser | Parsing logic, extraction rules | Chunk content changes |
| Chunking strategy | Chunk size, overlap, splitting rules | All chunks change |
| Embedding model | Model version or provider | All vectors change (incompatible) |
| Embedding dimension | 1536 → 3072 or reduced via MRL | Index must be rebuilt |
| Vector index | Index type (HNSW params), distance metric | Search results may change |
| Reranker | Model version | Reranking order changes |
| Prompt template | System prompt, few-shot examples | LLM output changes |
| LLM model | Model version (gpt-4o-2024-05-13 → gpt-4o-2024-08-06) | Output style/quality changes |

### Safe Embedding Model Migration (Dual-Write, Blue-Green)

Changing the embedding model is the most disruptive migration. Old embeddings are incompatible with the new model -- you cannot mix them in the same index.

```
Phase 1: Dual-Write
┌─────────────────────────────────────────────┐
│  New documents are embedded with BOTH models │
│  Indexed into BOTH collections              │
│                                              │
│  ┌──────────────┐    ┌──────────────┐       │
│  │ Collection A  │    │ Collection B  │       │
│  │ (old model)   │    │ (new model)   │       │
│  │ 10M vectors   │    │ growing...    │       │
│  └──────────────┘    └──────────────┘       │
│         ▲                   ▲                │
│         └───── writes ──────┘                │
│                                              │
│  Queries still go to Collection A            │
└─────────────────────────────────────────────┘

Phase 2: Backfill
┌─────────────────────────────────────────────┐
│  Re-embed all existing documents with new    │
│  model, write to Collection B               │
│                                              │
│  ┌──────────────┐    ┌──────────────┐       │
│  │ Collection A  │    │ Collection B  │       │
│  │ (old model)   │    │ (new model)   │       │
│  │ 10M vectors   │    │ 10M vectors   │       │
│  └──────────────┘    └──────────────┘       │
│                                              │
│  Queries still go to Collection A            │
│  Shadow queries go to B for quality comparison│
└─────────────────────────────────────────────┘

Phase 3: Blue-Green Swap
┌─────────────────────────────────────────────┐
│  Swap the alias: queries now go to           │
│  Collection B (new model)                    │
│                                              │
│  ┌──────────────┐    ┌──────────────┐       │
│  │ Collection A  │    │ Collection B  │       │
│  │ (old model)   │    │ (new model)   │       │
│  │ STANDBY       │    │ ACTIVE ◄──── │       │
│  └──────────────┘    └──────────────┘       │
│                                              │
│  Keep A for rollback (1-2 weeks)             │
└─────────────────────────────────────────────┘
```

```typescript
// run: npx ts-node version-config.ts

interface RAGVersionConfig {
  // Document processing
  parserVersion: string;        // e.g., 'v2.1'
  chunkingStrategy: string;     // e.g., 'semantic-v2'
  chunkSize: number;
  chunkOverlap: number;

  // Embedding
  embeddingModel: string;       // e.g., 'text-embedding-3-small'
  embeddingDimension: number;

  // Retrieval
  vectorIndexType: string;      // e.g., 'hnsw'
  distanceMetric: string;       // e.g., 'cosine'
  rerankerModel: string;        // e.g., 'cross-encoder/ms-marco-MiniLM-L-6-v2'

  // Generation
  llmModel: string;             // e.g., 'gpt-4o-2024-08-06'
  promptTemplateVersion: string; // e.g., 'v3.2'
  maxTokens: number;
  temperature: number;
}

// Version compatibility matrix
// Embedding model change → requires full re-index
// Chunking strategy change → requires re-chunk + re-embed
// Reranker change → no re-index needed
// LLM/prompt change → no re-index needed

interface CompatibilityCheck {
  requiresReindex: boolean;
  requiresRechunk: boolean;
  requiresReembed: boolean;
  safeHotSwap: boolean;
}

function checkCompatibility(
  current: RAGVersionConfig,
  next: RAGVersionConfig
): CompatibilityCheck {
  const chunkingChanged =
    current.chunkingStrategy !== next.chunkingStrategy ||
    current.chunkSize !== next.chunkSize ||
    current.chunkOverlap !== next.chunkOverlap;

  const embeddingChanged =
    current.embeddingModel !== next.embeddingModel ||
    current.embeddingDimension !== next.embeddingDimension;

  const parserChanged = current.parserVersion !== next.parserVersion;

  return {
    requiresRechunk: chunkingChanged || parserChanged,
    requiresReembed: embeddingChanged || chunkingChanged || parserChanged,
    requiresReindex: embeddingChanged, // new vectors need new index
    safeHotSwap: !embeddingChanged && !chunkingChanged && !parserChanged,
    // LLM, prompt, reranker changes are safe hot swaps
  };
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**LLM provider goes down and there is no fallback.** The entire RAG system returns 503 for all queries because the single LLM endpoint (OpenAI) is experiencing an outage. Users get nothing. Fix: configure at least two LLM providers (e.g., OpenAI primary, Anthropic fallback). Use a circuit breaker that flips to the fallback after 3 consecutive failures. Test the failover path regularly -- an untested fallback is not a fallback.

**Embedding model migration corrupts the index.** An engineer updates the embedding model in the config but forgets to re-index existing documents. The vector index now contains a mix of old-model and new-model embeddings. Query embeddings (from the new model) have meaningless similarity to old-model vectors. Retrieval quality drops to near-random. Users report "the search is broken." Fix: embedding model changes must trigger a full re-index via the dual-write/blue-green process. Never mix embeddings from different models in the same collection.

**Reranker failure silently degrades quality.** The reranker service times out, and the fallback silently skips reranking and uses raw retrieval scores. This is correct behavior -- but nobody notices that reranking has been disabled for 3 days. During this time, answer quality drops because less-relevant chunks are used as context. Fix: emit a metric (`reranker_fallback_count`) and alert when the fallback rate exceeds 5% over a 15-minute window.

**No timeout on LLM streaming causes hung connections.** A streaming LLM response stalls mid-generation (the provider stops sending tokens but does not close the connection). The client holds the HTTP connection open indefinitely, eventually exhausting the connection pool. Fix: implement both a first-token timeout (10s) and a between-token timeout (5s). If no token arrives within the window, abort the stream, close the connection, and retry or return a partial response.

:::

## 🎯 Checkpoint

::: details Question 1 -- Latency optimization
**Q:** Your RAG system has a p95 latency of 3,200ms against a 2,000ms target. The breakdown is: embedding 120ms, vector search 60ms, BM25 80ms, reranking 250ms, LLM first token 800ms, LLM streaming 1,600ms, overhead 290ms. Which optimizations would you apply, and what is the expected impact?

**A:** The LLM dominates. Optimizations in priority order: (1) **Run vector search and BM25 in parallel** -- saves ~60ms (they currently add sequentially: 60+80=140ms becomes ~80ms). (2) **Add embedding cache** -- saves ~120ms on cache hits (common queries). (3) **Switch to a faster LLM for simple queries** (model routing) -- gpt-4o-mini has ~400ms first-token latency vs 800ms, saving ~400ms on ~60% of queries. (4) **Reduce reranking candidate set** from 20 to 10 -- saves ~100ms on reranking. (5) **Enable retrieval caching** for repeat queries -- saves ~200ms. Combined, these bring p95 under 2,000ms. The biggest single win is model routing for the LLM, because the LLM consumes 75% of the budget.
:::

::: details Question 2 -- Failure handling design
**Q:** Design the fallback strategy for a RAG system where the vector database becomes unavailable. What is the user experience at each degradation level?

**A:** Three levels: **Level 1 (transparent):** Route to a read replica. The user notices nothing. This handles single-node failures. **Level 2 (degraded):** Fall back to BM25 keyword search only. The user gets answers, but semantic matching is gone -- queries that require understanding intent ("how to handle errors gracefully") will match poorly compared to exact keyword queries ("error handling"). The response should include a notice: "Results may be less relevant due to temporary system degradation." **Level 3 (minimal):** If BM25 is also down, serve from the response cache (semantic or exact match). The user gets potentially stale answers, with a notice. **Level 4 (honest failure):** If nothing works, return "I'm temporarily unable to search the knowledge base. Please try again shortly." Never hallucinate an answer when retrieval fails -- returning "I don't know" is always better than returning fabricated information.
:::

::: details Question 3 -- Embedding model migration
**Q:** You need to migrate from `text-embedding-ada-002` (1536 dims) to `text-embedding-3-large` (3072 dims) on an index with 5M vectors. Describe the migration process and the risks at each step.

**A:** **Phase 1 -- Dual-write (1-2 days):** Create a new collection (Collection B) with 3072-dim configuration. Modify the ingestion pipeline to embed new/updated documents with both models and write to both collections. Risk: double the embedding API cost and double the write load during this phase. **Phase 2 -- Backfill (days to weeks):** Batch-process all 5M existing documents through the new embedding model and write to Collection B. Risk: this is expensive (5M chunks x ~200 tokens x $0.13/1M tokens for 3-large = ~$130) and time-consuming. Rate limit to avoid API throttling. **Phase 3 -- Shadow testing:** Route a percentage of queries to both collections, compare retrieval quality. Risk: the new model might actually perform worse on your specific data. Measure recall and precision before committing. **Phase 4 -- Swap:** Update the collection alias so queries go to Collection B. Keep Collection A for 2 weeks as rollback. Risk: the query embedding endpoint must also switch to the new model simultaneously -- if the alias swaps but the query embedding still uses ada-002, all searches will be meaningless.
:::

## Key Mental Models

- **LLM generation is the latency floor.** Optimize everything else first, then use streaming to hide LLM latency from the user.
- **Every component needs a fallback, and every fallback needs a metric.** Silent degradation is worse than loud failure because nobody knows to fix it.
- **Embedding model changes are the hardest migration.** They invalidate the entire vector index. Plan for dual-write and blue-green swaps.
- **Never mix embedding models in the same index.** The similarity scores between vectors from different models are meaningless.
- **Timeouts are not optional.** Every network call needs a timeout. Every streaming response needs a between-token timeout. Untimed operations become hung connections.

## Related

- [Caching & freshness](01-caching-freshness.md) -- cache hits as the fastest latency optimization
- [Scaling & cost](02-scaling-cost.md) -- latency vs cost tradeoffs in model selection
- [Observability](04-observability.md) -- measuring latency per stage and tracking fallback activations
- [Full system architecture](/rag/module-16/01-system-architecture.md) -- the components whose failures are handled here
- [Embeddings deep dive](/rag/module-03/) -- understanding why embedding model migration is hard
