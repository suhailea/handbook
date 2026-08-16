---
title: Scaling & Cost Optimization
outline: deep
---

# Scaling & Cost Optimization

Interview weight: 🔥🔥🔥 | Prerequisites: [Ingestion pipeline](/rag/module-03/), [Embeddings](/rag/module-07/), [Vector databases](/rag/module-08/), [Caching & freshness](01-caching-freshness.md)

## 🗣️ In Plain English

::: tip In Plain English
Running a RAG system is like running a restaurant. At 10 tables, one chef and one waiter work fine. At 1,000 tables, you need a bigger kitchen, more cooks, and someone managing the supply chain. Scaling is about adding capacity at the right bottleneck. Cost optimization is about not hiring a Michelin-star chef to make toast -- use the expensive model only when the question demands it.
:::

## ⚙️ Under the Hood

### Scaling from 100 to 10M+ Documents

The scaling challenges change dramatically at each order of magnitude.

| Scale | Documents | Chunks (~10/doc) | Index Size (1536-dim) | Key Challenge |
|-------|-----------|-------------------|-----------------------|--------------|
| Small | 100 | 1K | ~6 MB | Nothing -- single-node is fine |
| Medium | 10K | 100K | ~600 MB | Query latency starts mattering |
| Large | 100K | 1M | ~6 GB | Need dedicated vector DB, not just pgvector |
| Very Large | 1M | 10M | ~60 GB | Sharding, replication, tiered storage |
| Massive | 10M+ | 100M+ | ~600 GB+ | Multi-shard, approximate search, cost dominates |

### Index Scaling: When and How to Shard

```typescript
// Conceptual: shard assignment for multi-tenant RAG
interface ShardConfig {
  shardKey: 'tenant' | 'documentType' | 'dateRange';
  shardCount: number;
  replicationFactor: number; // read replicas per shard
}

// Strategy 1: Shard by tenant (multi-tenant SaaS)
// Each tenant's documents live on one shard
// Pros: perfect tenant isolation, easy to scale per-tenant
// Cons: hot tenants create imbalanced shards
function assignShardByTenant(tenantId: string, shardCount: number): number {
  // Consistent hashing to avoid reshuffling when adding shards
  const hash = simpleHash(tenantId);
  return hash % shardCount;
}

// Strategy 2: Shard by document hash (even distribution)
// Pros: balanced load across shards
// Cons: queries must fan out to all shards (scatter-gather)
function assignShardByDocument(documentId: string, shardCount: number): number {
  const hash = simpleHash(documentId);
  return hash % shardCount;
}

function simpleHash(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
```

**When to shard:**
- Single-node pgvector becomes slow above ~5M vectors (depends on hardware)
- Pinecone/Qdrant/Weaviate handle sharding internally but charge per pod/node
- If queries are tenant-scoped, shard by tenant to avoid scatter-gather
- If queries span all data, shard by hash and accept the fan-out cost

### Replication: Read Replicas for Vector DB

```text
                    ┌──────────────┐
     Writes ───────►│  Primary     │
                    │  (read/write)│
                    └──────┬───────┘
                           │ async replication
                    ┌──────┴───────┐
              ┌─────┤              ├─────┐
              ▼     ▼              ▼     ▼
         ┌────────┐ ┌────────┐ ┌────────┐
         │Replica │ │Replica │ │Replica │
         │  1     │ │  2     │ │  3     │
         └────────┘ └────────┘ └────────┘
              ▲          ▲          ▲
              └──────────┴──────────┘
                   Read queries
```

Read replicas absorb query load while the primary handles writes (ingestion). This is critical because ingestion and querying compete for the same resources. Adding replicas is the simplest way to scale read throughput without re-architecting.

### Horizontal Worker Scaling

```typescript
// run: npx ts-node worker-scaling.ts
interface WorkerScalingConfig {
  minWorkers: number;
  maxWorkers: number;
  targetQueueDepth: number; // scale up when queue exceeds this
  scaleUpCooldown: number;  // seconds between scale-up events
  scaleDownCooldown: number;
}

interface QueueMetrics {
  depth: number;       // messages waiting
  inFlight: number;    // messages being processed
  oldestMessageAge: number; // seconds
}

function calculateDesiredWorkers(
  metrics: QueueMetrics,
  config: WorkerScalingConfig,
  currentWorkers: number
): number {
  // Scale based on queue depth
  const depthBasedWorkers = Math.ceil(
    metrics.depth / config.targetQueueDepth
  );

  // Also consider message age -- if messages are old, we are behind
  const ageBasedWorkers = metrics.oldestMessageAge > 300
    ? currentWorkers * 2  // double if messages are > 5 min old
    : currentWorkers;

  const desired = Math.max(depthBasedWorkers, ageBasedWorkers);

  // Clamp to min/max
  return Math.min(config.maxWorkers, Math.max(config.minWorkers, desired));
}

// Embedding batching: batch multiple chunks per API call
async function batchEmbeddings(
  texts: string[],
  batchSize: number = 100, // OpenAI supports up to 2048 inputs per call
  embedFn: (batch: string[]) => Promise<number[][]>
): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const embeddings = await embedFn(batch);
    results.push(...embeddings);
  }

  return results;
}
```

### Complete Cost Breakdown

Here is a realistic cost breakdown for a RAG system at different scales.

#### Example: 1M Document Knowledge Base

**Assumptions:**
- 1M documents, avg 2,000 tokens each = 2B tokens total content
- 10 chunks per document = 10M chunks, avg 200 tokens each
- Embedding model: `text-embedding-3-small` ($0.02 / 1M tokens)
- LLM: `gpt-4o` ($2.50 / 1M input tokens, $10 / 1M output tokens)
- 10,000 queries per day
- Average 5 chunks retrieved per query (~1,000 context tokens)
- Average 300 output tokens per response

| Cost Category | Calculation | Monthly Cost |
|--------------|-------------|-------------:|
| **Initial embedding** | 2B tokens x $0.02/1M = $40 | $40 (one-time) |
| **Re-embedding (10% churn/month)** | 200M tokens x $0.02/1M | $4 |
| **Query embeddings** | 300K queries x 20 tokens x $0.02/1M | $0.12 |
| **LLM input tokens** | 300K queries x 1,500 tokens x $2.50/1M | $1,125 |
| **LLM output tokens** | 300K queries x 300 tokens x $10/1M | $900 |
| **Reranker** | 300K queries x $0.001/query | $300 |
| **Vector DB hosting** | Managed (e.g., Pinecone S1 pod) | $70-350 |
| **Redis (caching)** | Managed, ~10GB | $50-100 |
| **Compute (workers)** | 2-4 instances | $100-400 |
| **Object storage** | 1M docs, ~50GB | $1-5 |
| **Total** | | **~$2,500-3,200/mo** |

**The dominant cost is the LLM.** Input tokens (the context you send) cost more in aggregate than output tokens. This is why context compression and caching are the highest-leverage optimizations.

### Cost Optimization Strategies

#### 1. Model Routing: Use the Right Model for the Job

```typescript
// run: npx ts-node model-routing.ts
interface QueryClassification {
  complexity: 'simple' | 'moderate' | 'complex';
  requiresReasoning: boolean;
  requiresCitation: boolean;
}

interface ModelConfig {
  modelId: string;
  costPer1MInput: number;
  costPer1MOutput: number;
  latencyMs: number;
}

const models: Record<string, ModelConfig> = {
  fast: {
    modelId: 'gpt-4o-mini',
    costPer1MInput: 0.15,
    costPer1MOutput: 0.60,
    latencyMs: 500,
  },
  standard: {
    modelId: 'gpt-4o',
    costPer1MInput: 2.50,
    costPer1MOutput: 10.00,
    latencyMs: 1200,
  },
  reasoning: {
    modelId: 'o3-mini',
    costPer1MInput: 1.10,
    costPer1MOutput: 4.40,
    latencyMs: 3000,
  },
};

function selectModel(classification: QueryClassification): ModelConfig {
  if (classification.complexity === 'simple' && !classification.requiresReasoning) {
    return models.fast; // "What is our refund policy?" -> cheap model
  }
  if (classification.requiresReasoning) {
    return models.reasoning; // "Compare the pricing of plans A, B, C and recommend..." -> reasoning
  }
  return models.standard; // Most queries
}

// Cost impact: if 60% of queries are simple, routing saves ~80% on those queries
// 10K queries/day, 60% simple: saves ~$600/month on LLM costs alone
```

#### 2. Context Compression

```typescript
// run: npx ts-node context-compression.ts
interface RetrievedChunk {
  text: string;
  score: number;
  tokenCount: number;
}

// Strategy: Remove low-value chunks from context
function compressContext(
  chunks: RetrievedChunk[],
  maxTokens: number
): RetrievedChunk[] {
  // Sort by relevance score descending
  const sorted = [...chunks].sort((a, b) => b.score - a.score);

  const selected: RetrievedChunk[] = [];
  let totalTokens = 0;

  for (const chunk of sorted) {
    if (totalTokens + chunk.tokenCount > maxTokens) break;
    selected.push(chunk);
    totalTokens += chunk.tokenCount;
  }

  return selected;
}

// Strategy: Extract only relevant sentences from each chunk
function extractRelevantSentences(
  chunkText: string,
  query: string,
  maxSentences: number = 3
): string {
  const sentences = chunkText.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // Score each sentence by keyword overlap with query
  const queryWords = new Set(query.toLowerCase().split(/\s+/));
  const scored = sentences.map(s => {
    const words = s.toLowerCase().split(/\s+/);
    const overlap = words.filter(w => queryWords.has(w)).length;
    return { sentence: s.trim(), score: overlap / words.length };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, maxSentences).map(s => s.sentence).join('. ') + '.';
}
```

#### 3. Batch vs Real-Time Processing Costs

| Operation | Real-Time Cost | Batch Cost | Savings |
|-----------|---------------|------------|---------|
| Embedding (per chunk) | $0.02/1M tokens | $0.02/1M tokens (same, but fewer API calls = less overhead) | 10-20% on overhead |
| Re-ranking | $0.001/query | N/A (only at query time) | - |
| LLM generation | $2.50/1M input | N/A (only at query time) | - |
| Document parsing | On-demand compute | Spot instances / off-peak | 50-70% |

**Batch ingestion on spot instances** is one of the biggest cost saves. Parsing and embedding documents is not latency-sensitive -- do it on cheap compute during off-peak hours.

### Connection Pooling

```typescript
// run: npx ts-node connection-pooling.ts

// Problem: each query opens a new connection to vector DB, Redis, etc.
// At 100 QPS, that is 100 TCP handshakes + TLS negotiations per second

// Solution: connection pools
interface PoolConfig {
  min: number;     // keep this many connections warm
  max: number;     // never exceed this
  idleTimeout: number; // close idle connections after this (ms)
  acquireTimeout: number; // fail if can't get connection within this (ms)
}

const vectorDBPool: PoolConfig = {
  min: 5,
  max: 20,
  idleTimeout: 30_000,
  acquireTimeout: 5_000,
};

const redisPool: PoolConfig = {
  min: 3,
  max: 10,
  idleTimeout: 60_000,
  acquireTimeout: 3_000,
};

// For embedding API calls: use HTTP keep-alive and connection reuse
// Node's native fetch (undici) does this by default
// For explicit control:
import { Agent } from 'node:http';

const keepAliveAgent = new Agent({
  keepAlive: true,
  maxSockets: 10,       // max concurrent connections to embedding API
  maxFreeSockets: 5,    // keep 5 idle connections warm
  timeout: 30_000,
});
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**LLM costs spike on verbose context.** A developer sets `topK: 20` during retrieval "to be safe." Each chunk is ~200 tokens, so 20 chunks = 4,000 context tokens per query. At 10K queries/day with gpt-4o, that is $75/day just in input tokens. Reducing to `topK: 5` with a reranker that selects the best 5 cuts input cost by 75% with no quality loss. The reranker costs $10/day. Net savings: $55/day.

**Embedding API rate limits during bulk re-index.** You trigger a full re-index of 1M documents (10M chunks). At 100 chunks per batch, that is 100K API calls. OpenAI's rate limit for `text-embedding-3-small` is ~10K RPM for most tiers. Your ingestion workers overwhelm the rate limit, get 429s, retry aggressively, and make it worse. Fix: implement a token bucket rate limiter on your embedding client, batch 100 chunks per call, and scale workers to stay under the rate limit.

**Single-shard vector DB collapses under write + read contention.** The vector index is being updated by the ingestion pipeline while serving queries. On a single Qdrant node with 8M vectors, a batch write of 10K vectors locks segments and causes query latency to spike from 50ms to 2,000ms. Fix: use read replicas so queries hit replicas while writes go to the primary, or use a collection alias to swap between a live index and one being rebuilt.

**No cost alerting.** A prompt injection causes the LLM to generate extremely long outputs (10K tokens per response). Nobody notices for a week. LLM output costs jump from $900/month to $9,000/month. Fix: track token usage per query, set alerts on p95 output token count, and enforce a `max_tokens` parameter on every LLM call.

:::

## 🎯 Checkpoint

::: details Question 1 -- Cost analysis
**Q:** Your RAG system processes 50K queries/day. Each query embeds a 30-token query, retrieves 8 chunks (~1,600 context tokens), and generates a 200-token response using gpt-4o. What is the monthly LLM cost, and what is the single most effective optimization to reduce it?

**A:** Monthly: 1.5M queries. **Query embedding:** 1.5M x 30 tokens x $0.02/1M = $0.90 (negligible). **LLM input:** 1.5M x (1,600 context + ~200 prompt template) x $2.50/1M = $6,750. **LLM output:** 1.5M x 200 x $10/1M = $3,000. **Total: ~$9,750/month.** The single most effective optimization is **model routing** -- classify queries by complexity and route simple ones (FAQ-style, ~60% of traffic) to `gpt-4o-mini` ($0.15/1M input). This cuts LLM input cost on those queries by 94%, saving roughly $3,800/month. The second-best optimization is response caching, which eliminates the LLM call entirely for repeat queries.
:::

::: details Question 2 -- Scaling strategy
**Q:** You need to scale from 100K to 10M documents. Your current setup is a single pgvector instance. What changes do you need to make, and in what order?

**A:** In order of priority: (1) **Move to a dedicated vector database** (Qdrant, Weaviate, or Pinecone) -- pgvector on a single Postgres instance struggles with HNSW index builds above ~5M vectors and competes with transactional workloads. (2) **Add read replicas** to separate ingestion writes from query reads. (3) **Implement connection pooling** -- at scale, connection overhead becomes significant. (4) **Shard by tenant or document hash** if a single node cannot hold the full index in memory (10M vectors at 1536-dim = ~60GB, feasible on a single large node but leaves no headroom). (5) **Batch ingestion workers** with rate limiting to avoid overwhelming the embedding API. (6) **Add caching layers** (embedding cache, retrieval cache) to reduce load on the vector DB and embedding API.
:::

::: details Question 3 -- Batch sizing
**Q:** Why should you batch 100 chunks per embedding API call rather than sending them one at a time? What are the tradeoffs of very large batch sizes?

**A:** Batching reduces HTTP overhead -- each API call has ~50-100ms of network latency regardless of payload size. Sending 10M chunks one at a time means 10M API calls x 100ms = 11.5 days of sequential latency. At 100 per batch, that is 100K calls = ~2.7 hours. However, very large batches (2,000+) have tradeoffs: (1) if the batch fails, you retry 2,000 chunks, not 100; (2) large payloads may hit request size limits (OpenAI limits to ~8MB per request); (3) a single batch with 2,000 long texts may exceed the model's rate limit in tokens-per-minute. A batch size of 50-200 is the sweet spot: large enough to amortize network latency, small enough to handle failures gracefully and stay within rate limits.
:::

## Key Mental Models

- **LLM input tokens are the dominant cost.** Reducing context size (fewer chunks, shorter chunks, compression) has more cost impact than any other optimization.
- **Model routing is free money.** Not every question needs your most expensive model. Classify and route.
- **Scaling reads and writes separately.** Ingestion (writes) and queries (reads) have different resource profiles. Replicas let them scale independently.
- **Batch everything that is not latency-sensitive.** Ingestion, re-indexing, and embedding computation should run on cheap batch compute.
- **Monitor cost per query, not just total cost.** A per-query cost spike reveals problems (verbose outputs, missing caches) that total cost hides.

## Related

- [Caching & freshness](01-caching-freshness.md) -- caching as the primary cost reduction lever
- [Latency, failure & versioning](03-latency-failure.md) -- latency vs cost tradeoffs
- [Observability](04-observability.md) -- cost tracking per query
- [Vector databases](/rag/module-08/) -- index scaling and sharding details
- [Embeddings](/rag/module-07/) -- understanding embedding costs and batching
