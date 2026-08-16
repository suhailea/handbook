---
title: Model Selection, Re-embedding & Migration
outline: deep
---

# Model Selection, Re-embedding & Migration

**Interview weight:** 🔥🔥 — asked when interviewers probe operational maturity. Anyone can pick a model; few can explain how to migrate when the model changes.

**Prerequisites:** [Embedding Models & Similarity Metrics](01-embeddings-similarity.md), [Production Metadata Schema](/rag/module-06/01-metadata-schema.md)

## 🗣️ In Plain English

::: tip In Plain English
Choosing an embedding model is like choosing a language for your filing system. Once you have filed a million documents in French, you cannot suddenly switch to German — every label would be gibberish. Switching models means re-labeling everything. The trick is to plan for the move before you start filing.
:::

## ⚙️ Under the Hood

### Decision Framework

Choosing an embedding model is a multi-variable optimization. Here is the evaluation order — start with hard constraints, then optimize soft preferences:

```text
Step 1: Hard constraints (eliminate models that don't qualify)
  ├── Privacy: Can data leave your infrastructure? No → open-source only
  ├── Language: Need multilingual? → Cohere, BGE-M3, multilingual E5
  ├── Context length: Documents > 512 tokens? → Exclude 512-token models
  └── Compliance: Regulatory requirements? → May dictate deployment model

Step 2: Quality (benchmark on YOUR data, not MTEB)
  ├── Build a retrieval eval set (50-100 query-document pairs)
  ├── Embed with candidate models
  ├── Measure Recall@5, Recall@10, MRR
  └── The best model on MTEB may NOT be best on your data

Step 3: Operational trade-offs
  ├── Cost: per-token pricing × expected volume
  ├── Latency: p50/p99 embedding latency
  ├── Throughput: max embeddings/second (batch size × RPM)
  ├── Dimension: storage cost at your corpus size
  └── Reliability: API uptime, rate limits, deprecation risk
```

#### Evaluation Scorecard

```typescript
// run: npx ts-node model-scorecard.ts
interface ModelScorecard {
  model: string;
  // Hard constraints (pass/fail)
  privacyCompliant: boolean;
  languageSupport: boolean;
  maxTokensSufficient: boolean;

  // Quality (measured on your eval set)
  recallAt5: number;    // 0-1
  recallAt10: number;   // 0-1
  mrr: number;          // 0-1

  // Operational
  costPer1MTokens: number;   // USD
  p50LatencyMs: number;
  p99LatencyMs: number;
  maxBatchSize: number;
  dimensions: number;
  storageCostPerMVector: number; // GB per million vectors
}

// Example comparison
const candidates: ModelScorecard[] = [
  {
    model: 'text-embedding-3-small',
    privacyCompliant: true, languageSupport: true, maxTokensSufficient: true,
    recallAt5: 0.82, recallAt10: 0.91, mrr: 0.78,
    costPer1MTokens: 0.02, p50LatencyMs: 45, p99LatencyMs: 120,
    maxBatchSize: 2048, dimensions: 1536, storageCostPerMVector: 5.7,
  },
  {
    model: 'bge-large-en-v1.5',
    privacyCompliant: true, languageSupport: false, maxTokensSufficient: false,
    recallAt5: 0.79, recallAt10: 0.88, mrr: 0.75,
    costPer1MTokens: 0, p50LatencyMs: 15, p99LatencyMs: 40,
    maxBatchSize: 512, dimensions: 1024, storageCostPerMVector: 3.8,
  },
];
```

---

### The Embedding Lock-In Problem

This is the most under-discussed operational challenge in RAG systems:

**Your vector index is permanently tied to the model that created it.**

Vectors from different models exist in incompatible vector spaces. You cannot:
- Query a collection embedded with Model A using a query embedded with Model B
- Mix vectors from different models in the same collection
- Upgrade your model without re-embedding every document

```text
Model A vector space:          Model B vector space:
    * doc1                         * doc3
  * doc2    * doc3               * doc1
      * doc4                   * doc2     * doc4

Same documents, completely different positions.
Cosine similarity between Model A and Model B vectors is meaningless.
```

**Triggers for model changes:**
- A better model is released (quality improvement)
- Your current model is deprecated (OpenAI has deprecated ada-002)
- You need to reduce costs (switch to smaller/cheaper model)
- You need multilingual support (switch to multilingual model)
- You need to self-host (switch from API to open-source)

---

### Re-Embedding Strategy

When you must change models, you need a strategy that avoids downtime and data loss.

#### Blue-Green Re-Embedding

```text
Phase 1: Embed into new collection (background)
┌────────────────┐     ┌──────────────┐     ┌──────────────┐
│ Source Documents│────→│ New Embedding│────→│ New Collection│
│                │     │   Model B    │     │  (staging)   │
└────────────────┘     └──────────────┘     └──────────────┘

Phase 2: Validate
  - Run eval set against new collection
  - Compare Recall@K, MRR, answer quality vs old collection
  - If quality meets or exceeds old: proceed
  - If worse: investigate, adjust, or abort

Phase 3: Switch (atomic)
┌──────────────┐
│ Application  │──→ Old Collection (active)  ← STOP queries
│   Layer      │──→ New Collection (staging)  ← START queries
└──────────────┘

Phase 4: Cleanup
  - Keep old collection for 7-30 days (rollback safety)
  - Delete old collection after confirming no issues
```

```typescript
// run: npx ts-node blue-green-migration.ts
interface MigrationConfig {
  oldCollection: string;
  newCollection: string;
  newModel: string;
  batchSize: number;
  concurrency: number;
}

async function blueGreenMigration(config: MigrationConfig): Promise<void> {
  // Phase 1: Re-embed all documents into new collection
  const documents = await getSourceDocuments(); // from your document store, NOT from the old collection
  const batches = chunk(documents, config.batchSize);

  for (const batch of batches) {
    // Chunk documents (may use same or different chunking strategy)
    const chunks = batch.flatMap(doc => chunkDocument(doc));

    // Embed with new model
    const embeddings = await embedBatch(chunks, config.newModel);

    // Upsert into new collection with updated metadata
    await vectorDb.upsert(config.newCollection, embeddings.map((emb, i) => ({
      id: chunks[i].metadata.chunk_id,
      vector: emb,
      metadata: {
        ...chunks[i].metadata,
        embedding_model: config.newModel,
        embedding_version: new Date().toISOString(),
      },
    })));
  }

  // Phase 2: Validate
  const evalResults = await runEvalSet(config.newCollection);
  console.log('New collection eval:', evalResults);

  // Phase 3: Switch (application-level config change)
  // This is typically a feature flag or environment variable
  // await setActiveCollection(config.newCollection);

  // Phase 4: Keep old collection for rollback (do NOT delete immediately)
}
```

**Critical: Re-embed from source documents, not from the old collection.** The old collection contains chunks — you want to re-process from the original documents so you can also update chunking strategy if needed.

---

### Index Migration: Dual-Collection Pattern

For zero-downtime migration, run both collections simultaneously during the transition:

```typescript
// During migration: query both collections, merge results
async function dualCollectionQuery(
  query: string,
  activeCollection: string,
  migrationCollection: string | null,
  topK: number = 10
): Promise<SearchResult[]> {
  if (!migrationCollection) {
    // Normal operation: single collection
    const embedding = await embed(query, getCurrentModel());
    return vectorDb.query(activeCollection, embedding, topK);
  }

  // During migration: query active collection only
  // (new collection may be incomplete)
  const embedding = await embed(query, getCurrentModel());
  return vectorDb.query(activeCollection, embedding, topK);

  // DO NOT query both and merge — vectors from different models are incomparable
}
```

**Important:** You cannot merge results from two collections using different embedding models. The similarity scores are in different spaces and cannot be compared. The migration is an atomic switch, not a gradual blend.

---

### Embedding Versioning

Store the embedding model and version on every chunk. This is the only way to know which vectors need re-embedding.

```typescript
// Metadata fields for embedding versioning
const metadata = {
  embedding_model: 'text-embedding-3-small',
  embedding_version: '2024-01-25',  // model release date or your deployment version
  embedding_dimension: 1536,
};

// When upgrading: query for chunks with old model version
const chunksToReEmbed = await vectorDb.query({
  filter: {
    embedding_model: { $ne: 'text-embedding-3-small' },
    // or: embedding_version: { $lt: '2024-01-25' }
  },
});
```

---

### Batching for Cost and Throughput

Never embed one chunk at a time. Batch embedding dramatically reduces cost (fewer API calls) and improves throughput.

```typescript
// run: npx ts-node batch-embed.ts

// WRONG: one API call per chunk
for (const chunk of chunks) {
  const embedding = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: chunk.text, // 1 API call per chunk!
  });
}
// 10,000 chunks = 10,000 API calls = slow + rate-limited

// RIGHT: batch up to the API limit
const BATCH_SIZE = 2048; // OpenAI max batch size

async function batchEmbed(texts: string[], model: string): Promise<number[][]> {
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model,
      input: batch, // up to 2048 texts in one call
    });

    // Response embeddings are in the same order as input
    results.push(...response.data.map(d => d.embedding));
  }

  return results;
}
// 10,000 chunks = 5 API calls = fast + efficient
```

**Rate limiting:** Even with batching, you may hit rate limits at scale. Implement exponential backoff and respect the API's `Retry-After` header.

---

### Caching Query Embeddings

For repeated or common queries, caching the query embedding avoids redundant API calls.

```typescript
// run: npx ts-node cache-embedding.ts
import { createHash } from 'node:crypto';

class EmbeddingCache {
  private cache: Map<string, { embedding: number[]; expiresAt: number }>;
  private ttlMs: number;

  constructor(ttlMs: number = 3600000) { // 1 hour default
    this.cache = new Map();
    this.ttlMs = ttlMs;
  }

  private key(text: string, model: string): string {
    return createHash('sha256').update(`${model}:${text}`).digest('hex');
  }

  get(text: string, model: string): number[] | null {
    const entry = this.cache.get(this.key(text, model));
    if (!entry || Date.now() > entry.expiresAt) return null;
    return entry.embedding;
  }

  set(text: string, model: string, embedding: number[]): void {
    this.cache.set(this.key(text, model), {
      embedding,
      expiresAt: Date.now() + this.ttlMs,
    });
  }
}

// For production: use Redis instead of in-memory Map
// Key: sha256(model + text)
// Value: serialized float array
// TTL: 1-24 hours (query embeddings don't change unless model changes)
```

**Caveat:** Only cache exact-match queries. Embedding models are deterministic (same input → same output for the same model version), so exact-match caching is safe. Do NOT try to cache "similar" queries — the point of embeddings is to compute similarity, not to skip it.

---

### Dimension Reduction: Matryoshka Representations

OpenAI's `text-embedding-3` models support Matryoshka Representation Learning (MRL). You can truncate the embedding to fewer dimensions while retaining most of the quality.

```typescript
// OpenAI API supports dimension parameter
const response = await openai.embeddings.create({
  model: 'text-embedding-3-large', // native: 3072 dims
  input: 'sample text',
  dimensions: 1024, // truncate to 1024 dims
});

// The returned embedding has 1024 dimensions instead of 3072
// Quality loss is small: ~1-2% on MTEB for 3072→1024
```

**Dimension vs Quality Trade-off (text-embedding-3-large):**

| Dimensions | MTEB Retrieval (approx) | Storage per 1M vectors | Relative Quality |
|:---:|:---:|:---:|:---:|
| 3072 (native) | ~69 | 11.4 GB | 100% |
| 1536 | ~68.5 | 5.7 GB | ~99% |
| 1024 | ~67.5 | 3.8 GB | ~98% |
| 512 | ~65.5 | 1.9 GB | ~95% |
| 256 | ~62 | 0.95 GB | ~90% |

**When to use dimension reduction:**
- You want text-embedding-3-large quality at text-embedding-3-small storage cost → use 3-large at 1536 dims
- You have millions of vectors and storage is a concern → reduce to 1024 or 768
- You need fast ANN queries (smaller vectors = faster distance computation)

**Important:** You must choose the dimension at embedding time. You cannot truncate already-stored vectors — the remaining dimensions would need re-normalization to be correct. Embed at your target dimension from the start.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Model deprecation with no migration plan.**
OpenAI deprecated `text-embedding-ada-002`. You have 10 million chunks embedded with it. You now need to re-embed everything with `text-embedding-3-small` before the deprecation deadline. At $0.02/1M tokens and ~500 tokens/chunk, that is 5 billion tokens = $100 in embedding cost. Manageable for cost — but the operational effort (re-embed, validate, switch) takes engineering weeks if you have no automation. **Fix:** Build your ingestion pipeline to support re-embedding from day one. Store source documents separately from vectors. Track `embedding_model` in metadata so you know what needs re-embedding.

**2. Embedding one-at-a-time in production.**
A developer embeds chunks one per API call in a for loop. At 10,000 chunks per document batch and 200ms per API call, ingestion takes 33 minutes per batch. With batching (2048 per call), the same batch takes 5 API calls = ~1 second of API time. **Fix:** Always batch. Set batch size to the API maximum (2048 for OpenAI). Add concurrent batch processing for large corpora.

**3. Switching models without re-embedding.**
A team "upgrades" from ada-002 to text-embedding-3-small by changing the model in their query code but not re-embedding the stored documents. Queries are now embedded with a different model than documents. Cosine similarity between the two models' vectors is meaningless. Retrieval quality drops to near-random. **Fix:** Model change = full re-embed. There are no shortcuts. Use the blue-green pattern.

**4. Caching embeddings across model versions.**
Your Redis cache stores query embeddings keyed by query text. You upgrade the embedding model, but the cache still serves old-model embeddings for cached queries. These old embeddings query a new-model collection. Results are garbage for cached queries, fine for uncached ones — an intermittent bug that is maddening to debug. **Fix:** Include the model name in the cache key: `sha256(model_name + query_text)`. When the model changes, all cache keys change automatically, forcing re-computation.

:::

## 🎯 Checkpoint

::: details Question 1 — Migration Strategy
**Q:** You have 5 million chunks embedded with text-embedding-ada-002 in Pinecone. You want to migrate to text-embedding-3-small. Describe your migration strategy to achieve zero downtime.

**A:** Blue-green migration. (1) Create a new Pinecone index (or namespace) with the same schema. (2) Run a background job that reads source documents from your document store (not from Pinecone — you want to re-chunk from source), chunks them, embeds with text-embedding-3-small, and upserts into the new index. Track progress in a migration table. (3) Validate: run your retrieval eval set against the new index. Compare Recall@5, MRR, and answer quality against the old index. The new model should match or beat the old. (4) Atomic switch: update the application-layer config to point queries at the new index. This is a feature flag or environment variable change. (5) Keep the old index for 14-30 days as rollback insurance. (6) Update the embedding cache: either flush it or ensure cache keys include the model name so old-model embeddings are not served against the new index. (7) Monitor: watch retrieval quality metrics for the first week. If quality degrades, rollback by switching the config back to the old index.
:::

::: details Question 2 — Matryoshka Dimensions
**Q:** You are using text-embedding-3-large at full 3072 dimensions for a 10-million-vector corpus. Your CTO wants to reduce storage costs. How can you use Matryoshka representations, and what are the risks?

**A:** Text-embedding-3-large supports Matryoshka Representation Learning, which allows embedding at reduced dimensions (e.g., 1024 or 1536) while retaining most quality. To use it: set `dimensions: 1024` in the embedding API call. This produces 1024-dim vectors instead of 3072, reducing storage from ~114 GB to ~38 GB (3x reduction). The quality loss at 1024 dims is approximately 1-2% on MTEB retrieval benchmarks. Risks: (1) You must re-embed the entire corpus at the new dimension — you cannot simply truncate stored 3072-dim vectors because the truncated vectors need re-normalization. This means running the full blue-green migration. (2) The 1-2% MTEB quality loss is an average; on your specific data, the loss could be larger or smaller. Benchmark on your eval set before committing. (3) You must update the HNSW index configuration (dimension parameter) in your vector database. (4) A better first step: benchmark at 1536 dims (the same as text-embedding-3-small) — you may get text-embedding-3-large quality at text-embedding-3-small storage cost.
:::

## Key Mental Models

- **Embedding model change = full re-embed.** There is no shortcut. Vectors from different models are incompatible. Design your pipeline for this from day one.
- **Blue-green is the only zero-downtime migration pattern.** Embed into a new collection, validate, switch atomically, keep the old collection for rollback.
- **Batch embedding is not optional.** One-at-a-time embedding is orders of magnitude slower and hits rate limits. Always batch.
- **Cache keys must include the model name.** Otherwise a model upgrade serves stale embeddings from the old model against the new index.
- **Matryoshka dimensions are a storage lever, not a free lunch.** You trade quality for storage. Benchmark the trade-off on your data, and remember it requires a full re-embed.

## Related

- [Embedding Models & Similarity Metrics](01-embeddings-similarity.md) — model comparison and metrics
- [Production Metadata Schema](/rag/module-06/01-metadata-schema.md) — embedding_model and embedding_version fields
- [Schema & Index Design](/rag/module-08/02-schema-design.md) — vector dimension in database schema
- [Vector DB Internals](/rag/module-08/01-vector-db-internals.md) — index types and their dimension implications
