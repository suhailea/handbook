---
title: Hybrid Search & Fusion
outline: deep
---

# Hybrid Search & Fusion

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [Retrieval Strategies](01-retrieval-strategies.md), [Embedding Models](../module-07/01-embeddings-similarity.md) | **Builds toward:** [Reranking](../module-11/01-reranking.md), [Context Construction](../module-11/02-context-construction.md)

## 🗣️ In Plain English

::: tip In Plain English
Hybrid search is like asking two librarians to find your book independently — one searches by meaning, the other by exact words — and then merging their recommendation lists into one. You get the best of both: semantic understanding plus exact keyword matching.
:::

## ⚙️ Under the Hood

### Why Hybrid Search Exists

Dense vector search and sparse BM25 search have complementary failure modes:

| Query Type | Dense Vector | BM25 |
|-----------|-------------|------|
| "How to handle errors in Express?" | Finds docs about error handling even if they say "exception" | Misses if docs say "exception" instead of "error" |
| "Error code ERR_HTTP_HEADERS_SENT" | Maps to generic "error code" region — wrong results | Exact token match — finds the right doc instantly |
| "What is the warranty for product X-4291?" | Returns generic warranty info | Matches "X-4291" precisely |
| "best practices for scaling microservices" | Finds relevant docs using different terminology | Misses docs that say "horizontal scaling" or "auto-scaling" |

The pattern: dense search catches semantic similarity but misses exact terms. BM25 catches exact terms but misses semantic similarity. Hybrid search runs both in parallel and fuses the results.

### Production Architecture

```text
                    User Query
                        │
              ┌─────────┴──────────┐
              ▼                    ▼
        Vector Search          BM25 Search
        (top 50)               (top 50)
              │                    │
              ▼                    ▼
        Vector Scores          BM25 Scores
        (cosine sim:           (BM25 score:
         0.0 to 1.0)           0 to 25+)
              │                    │
              ▼                    ▼
        ┌─────────────────────────────┐
        │     Score Normalization     │
        │  (make scores comparable)   │
        └─────────────────────────────┘
              │                    │
              ▼                    ▼
        Normalized               Normalized
        Vector Scores            BM25 Scores
        (0.0 to 1.0)            (0.0 to 1.0)
              │                    │
              └─────────┬──────────┘
                        ▼
              ┌───────────────────┐
              │   Fusion (RRF     │
              │   or Weighted)    │
              └───────────────────┘
                        │
                        ▼
              ┌───────────────────┐
              │   Deduplication   │
              └───────────────────┘
                        │
                        ▼
                   Top K Results
```

### Score Normalization

Raw scores from different engines are not comparable. Cosine similarity ranges from -1 to 1 (usually 0 to 1 for positive embeddings). BM25 scores range from 0 to unbounded. You cannot add or average them without normalization.

**Min-Max Normalization:**

```text
normalized_score = (score - min_score) / (max_score - min_score)
```

Maps all scores to `[0, 1]`. Simple, but sensitive to outliers — a single very high BM25 score compresses all others toward 0.

**Z-Score Normalization:**

```text
normalized_score = (score - mean) / std_dev
```

Centers scores around 0 with unit variance. More robust to outliers but produces negative values, requiring further rescaling.

**Practical choice:** Min-max is the most common in production. If you see score compression (most scores near 0), switch to z-score or percentile-rank normalization.

```typescript
// run: npx tsx score-normalization.ts

function minMaxNormalize(scores: number[]): number[] {
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min;
  if (range === 0) return scores.map(() => 1.0); // all same score
  return scores.map(s => (s - min) / range);
}

function zScoreNormalize(scores: number[]): number[] {
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const std = Math.sqrt(
    scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length
  );
  if (std === 0) return scores.map(() => 0);
  return scores.map(s => (s - mean) / std);
}

// Example: BM25 scores are on a completely different scale than vector scores
const vectorScores = [0.92, 0.87, 0.85, 0.71, 0.65];
const bm25Scores = [18.3, 12.1, 9.7, 4.2, 1.1];

console.log('Vector (min-max):', minMaxNormalize(vectorScores));
// [1.0, 0.81, 0.74, 0.22, 0.0]

console.log('BM25 (min-max):', minMaxNormalize(bm25Scores));
// [1.0, 0.64, 0.50, 0.18, 0.0]
```

### Reciprocal Rank Fusion (RRF)

RRF merges ranked lists without using raw scores at all — only positions matter. This elegantly sidesteps the score normalization problem.

**Formula:**

```text
RRF_score(doc) = Σ  1 / (k + rank_i(doc))
                 i∈rankers
```

Where `k` is a constant (typically 60) that dampens the influence of high ranks, and `rank_i(doc)` is the document's position (1-based) in ranker i's result list.

**Worked Example:**

Suppose dense retrieval and BM25 each return their top 5:

| Rank | Dense Results | BM25 Results |
|------|--------------|-------------|
| 1 | Doc A | Doc C |
| 2 | Doc B | Doc A |
| 3 | Doc C | Doc E |
| 4 | Doc D | Doc B |
| 5 | Doc E | Doc F |

RRF scores with k=60:

| Document | Dense Rank | BM25 Rank | RRF Score |
|----------|-----------|-----------|-----------|
| Doc A | 1 | 2 | 1/(60+1) + 1/(60+2) = 0.01639 + 0.01613 = **0.03252** |
| Doc B | 2 | 4 | 1/(60+2) + 1/(60+4) = 0.01613 + 0.01563 = **0.03176** |
| Doc C | 3 | 1 | 1/(60+3) + 1/(60+1) = 0.01587 + 0.01639 = **0.03226** |
| Doc D | 4 | - | 1/(60+4) + 0 = **0.01563** |
| Doc E | 5 | 3 | 1/(60+5) + 1/(60+3) = 0.01538 + 0.01587 = **0.03125** |
| Doc F | - | 5 | 0 + 1/(60+5) = **0.01538** |

**Final ranking by RRF:** A (0.03252) > C (0.03226) > B (0.03176) > E (0.03125) > D (0.01563) > F (0.01538)

Doc A wins because it appeared highly in both lists. Doc D and F ranked low because they appeared in only one list.

```typescript
// run: npx tsx rrf-fusion.ts

interface RankedResult {
  docId: string;
  rank: number;  // 1-based
}

function reciprocalRankFusion(
  rankedLists: RankedResult[][],
  k: number = 60
): Map<string, number> {
  const scores = new Map<string, number>();

  for (const rankedList of rankedLists) {
    for (const result of rankedList) {
      const current = scores.get(result.docId) ?? 0;
      scores.set(result.docId, current + 1 / (k + result.rank));
    }
  }

  return scores;
}

// Example: two retrieval sources
const denseResults: RankedResult[] = [
  { docId: 'doc-a', rank: 1 },
  { docId: 'doc-b', rank: 2 },
  { docId: 'doc-c', rank: 3 },
  { docId: 'doc-d', rank: 4 },
  { docId: 'doc-e', rank: 5 },
];

const bm25Results: RankedResult[] = [
  { docId: 'doc-c', rank: 1 },
  { docId: 'doc-a', rank: 2 },
  { docId: 'doc-e', rank: 3 },
  { docId: 'doc-b', rank: 4 },
  { docId: 'doc-f', rank: 5 },
];

const fused = reciprocalRankFusion([denseResults, bm25Results]);
const sorted = [...fused.entries()].sort((a, b) => b[1] - a[1]);

console.log('RRF Results:');
for (const [docId, score] of sorted) {
  console.log(`  ${docId}: ${score.toFixed(5)}`);
}
// doc-a: 0.03252
// doc-c: 0.03226
// doc-b: 0.03175
// doc-e: 0.03125
// doc-d: 0.01563
// doc-f: 0.01538
```

### Weighted Fusion

When you trust one retriever more than the other, use weighted linear combination of normalized scores:

```text
final_score = α * norm_vector_score + (1 - α) * norm_bm25_score
```

| α Value | Behavior |
|---------|----------|
| 1.0 | Pure vector search |
| 0.7 | Favors semantic (good default for conversational queries) |
| 0.5 | Equal weight (good starting point) |
| 0.3 | Favors BM25 (good for technical/keyword-heavy queries) |
| 0.0 | Pure BM25 |

**Tuning alpha:**
1. Build an evaluation set of query-document relevance pairs
2. Sweep alpha from 0.0 to 1.0 in 0.1 increments
3. Measure recall@K and nDCG@K at each point
4. Pick the alpha with the best metric on your evaluation set

In practice, alpha is often query-dependent: semantic queries benefit from higher alpha, exact-term queries from lower alpha. Advanced systems classify the query first and route to different alpha values.

```typescript
// run: npx tsx weighted-fusion.ts

interface ScoredResult {
  docId: string;
  score: number;
}

function weightedFusion(
  vectorResults: ScoredResult[],
  bm25Results: ScoredResult[],
  alpha: number = 0.5
): ScoredResult[] {
  // Normalize both score sets
  const normVector = normalizeScores(vectorResults);
  const normBm25 = normalizeScores(bm25Results);

  // Merge into a single map
  const combined = new Map<string, number>();

  for (const r of normVector) {
    combined.set(r.docId, alpha * r.score);
  }
  for (const r of normBm25) {
    const current = combined.get(r.docId) ?? 0;
    combined.set(r.docId, current + (1 - alpha) * r.score);
  }

  return [...combined.entries()]
    .map(([docId, score]) => ({ docId, score }))
    .sort((a, b) => b.score - a.score);
}

function normalizeScores(results: ScoredResult[]): ScoredResult[] {
  if (results.length === 0) return [];
  const scores = results.map(r => r.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;
  return results.map(r => ({
    docId: r.docId,
    score: (r.score - min) / range,
  }));
}
```

### Candidate Merging and Deduplication

When results come from multiple sources, duplicates are inevitable — the same chunk appears in both the vector and BM25 result lists.

**Deduplication strategies:**

1. **Exact ID match** — same `chunk_id` in both lists. Trivial.
2. **Content hash** — SHA-256 of chunk text. Catches identical content stored with different IDs.
3. **Near-duplicate detection** — cosine similarity > 0.95 between chunk embeddings. Catches overlapping chunks from different chunking runs or slightly modified versions.

```typescript
// run: npx tsx deduplication.ts
import { createHash } from 'node:crypto';

interface FusedResult {
  docId: string;
  chunkId: string;
  text: string;
  score: number;
  sources: string[];  // which retrievers found this
}

function deduplicateResults(results: FusedResult[]): FusedResult[] {
  const seen = new Map<string, FusedResult>();

  for (const result of results) {
    const contentHash = createHash('sha256')
      .update(result.text.trim().toLowerCase())
      .digest('hex');

    const existing = seen.get(contentHash);
    if (existing) {
      // Keep the higher-scored version, merge source lists
      if (result.score > existing.score) {
        result.sources = [...new Set([...existing.sources, ...result.sources])];
        seen.set(contentHash, result);
      } else {
        existing.sources = [...new Set([...existing.sources, ...result.sources])];
      }
    } else {
      seen.set(contentHash, result);
    }
  }

  return [...seen.values()].sort((a, b) => b.score - a.score);
}
```

### PostgreSQL: Hybrid in One Database (pgvector + tsvector)

PostgreSQL can do both vector search and full-text search natively, making it an attractive option for hybrid search without additional infrastructure.

```sql
-- Schema: vectors and full-text search in the same table
CREATE TABLE chunks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id     UUID NOT NULL REFERENCES documents(id),
  content    TEXT NOT NULL,
  embedding  vector(1536) NOT NULL,       -- pgvector
  tsv        tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  metadata   JSONB DEFAULT '{}'
);

-- Indexes
CREATE INDEX idx_chunks_embedding ON chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
CREATE INDEX idx_chunks_tsv ON chunks USING gin (tsv);

-- Hybrid search query: combine vector similarity and BM25-like text ranking
WITH vector_results AS (
  SELECT id, content, metadata,
         1 - (embedding <=> $1::vector) AS vector_score,  -- cosine similarity
         ROW_NUMBER() OVER (ORDER BY embedding <=> $1::vector) AS vector_rank
  FROM chunks
  WHERE metadata->>'tenant_id' = $3  -- pre-filter by tenant
  ORDER BY embedding <=> $1::vector
  LIMIT 50
),
text_results AS (
  SELECT id, content, metadata,
         ts_rank_cd(tsv, plainto_tsquery('english', $2)) AS text_score,
         ROW_NUMBER() OVER (
           ORDER BY ts_rank_cd(tsv, plainto_tsquery('english', $2)) DESC
         ) AS text_rank
  FROM chunks
  WHERE tsv @@ plainto_tsquery('english', $2)
    AND metadata->>'tenant_id' = $3
  LIMIT 50
),
combined AS (
  SELECT
    COALESCE(v.id, t.id) AS id,
    COALESCE(v.content, t.content) AS content,
    COALESCE(v.metadata, t.metadata) AS metadata,
    -- RRF fusion
    COALESCE(1.0 / (60 + v.vector_rank), 0) +
    COALESCE(1.0 / (60 + t.text_rank), 0) AS rrf_score
  FROM vector_results v
  FULL OUTER JOIN text_results t ON v.id = t.id
)
SELECT id, content, metadata, rrf_score
FROM combined
ORDER BY rrf_score DESC
LIMIT 10;
```

**Advantages:** Single database, ACID transactions, no sync between vector DB and search engine, simpler infrastructure.

**Limitations:** pgvector HNSW performance degrades beyond ~5M vectors. PostgreSQL's `ts_rank` is not true BM25 (it is a simpler tf-idf variant). For large-scale production, dedicated systems outperform.

### Weaviate Native Hybrid Search

Weaviate has built-in hybrid search that combines dense and sparse in a single query:

```typescript
// run: npx tsx weaviate-hybrid.ts
// Requires: npm install weaviate-client

import weaviate from 'weaviate-client';

const client = await weaviate.connectToLocal();

const collection = client.collections.get('Document');

const result = await collection.query.hybrid('error handling in NestJS', {
  alpha: 0.7,      // 0.7 = favor vector, 0.3 = favor BM25
  limit: 10,
  returnMetadata: ['score', 'explainScore'],
  filters: collection.filter.byProperty('tenant_id').equal('acme-corp'),
});

for (const obj of result.objects) {
  console.log(`Score: ${obj.metadata?.score} | ${obj.properties.content}`);
}
```

### Qdrant Hybrid with Sparse Vectors

Qdrant supports sparse vectors natively (SPLADE or BM25-as-sparse-vector):

```typescript
// run: npx tsx qdrant-hybrid.ts
// Requires: npm install @qdrant/js-client-rest

import { QdrantClient } from '@qdrant/js-client-rest';

const client = new QdrantClient({ url: 'http://localhost:6333' });

// Qdrant query with both dense and sparse vectors + fusion
const results = await client.query('documents', {
  prefetch: [
    {
      query: denseVector,     // from your embedding model
      using: 'dense',
      limit: 50,
    },
    {
      query: {               // sparse vector (e.g., from SPLADE)
        indices: [103, 2987, 4512],
        values: [1.2, 0.8, 0.5],
      },
      using: 'sparse',
      limit: 50,
    },
  ],
  query: { fusion: 'rrf' },  // Qdrant applies RRF automatically
  limit: 10,
});
```

### Elasticsearch: kNN + BM25

Elasticsearch combines traditional BM25 with vector search via kNN:

```json
// Elasticsearch hybrid query
{
  "query": {
    "bool": {
      "should": [
        {
          "match": {
            "content": {
              "query": "error handling in NestJS",
              "boost": 0.3
            }
          }
        }
      ],
      "filter": [
        { "term": { "tenant_id": "acme-corp" } }
      ]
    }
  },
  "knn": {
    "field": "embedding",
    "query_vector": [0.12, -0.34, ...],
    "k": 50,
    "num_candidates": 100,
    "boost": 0.7
  },
  "size": 10
}
```

Elasticsearch internally combines the BM25 score and kNN score using the `boost` values. This is not true RRF (which ignores scores) — it is weighted score combination. For RRF, use Elasticsearch's `sub_searches` with the `rank` aggregation.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Score scales silently destroy fusion quality.** A team combines raw cosine similarity (0.0-1.0) with raw BM25 scores (0-25) using weighted average without normalization. BM25 dominates every fusion because its raw values are 25x larger. Results look like pure BM25 with vector search adding nothing. Fix: always normalize before fusion, or use RRF (which ignores scores entirely).

**Alpha is tuned on the wrong dataset.** Alpha is set to 0.7 (favoring vector) based on evaluation with conversational queries. Then the system goes live and half the real queries are exact ID lookups. Those queries fail because BM25 is weighted too low. Fix: either tune alpha on representative production queries, or classify queries at runtime and use different alpha values.

**Deduplication misses near-duplicates.** Two chunks from different document versions have slightly different text (a typo was fixed, a date was updated) but convey the same information. Both appear in the final results, wasting context window tokens. Fix: use embedding-based near-duplicate detection (cosine > 0.95) in addition to exact matching.

**PostgreSQL hybrid crumbles at scale.** pgvector HNSW works well at 500K vectors but latency spikes to 200ms+ at 5M vectors, especially with pre-filtering on low-cardinality fields. The team assumed "one database for everything" would scale. Fix: at >1M vectors, evaluate dedicated vector databases. Use PostgreSQL hybrid for prototyping and moderate scale, not as a universal solution.
:::

## 🎯 Checkpoint

::: details Question 1 — RRF vs weighted fusion
**Q:** Why might you choose Reciprocal Rank Fusion over weighted score fusion? When would weighted fusion be better?

**A:** RRF uses only rank positions, not scores, so it works without score normalization — you can fuse results from any retrieval system regardless of score scale. This makes it robust and simple to implement. However, RRF treats all rank positions equally across retrievers (a rank-1 from a poor retriever counts the same as rank-1 from a great retriever). Weighted fusion is better when you know one retriever is more reliable and want to explicitly boost it (e.g., for keyword-heavy queries, weight BM25 higher). Weighted fusion requires correct score normalization and calibrated alpha, making it more brittle but more expressive.
:::

::: details Question 2 — Normalization failure
**Q:** A colleague reports that their hybrid search "always returns the same results as BM25 alone — adding vector search made no difference." What is the most likely bug?

**A:** They are combining raw scores without normalization. BM25 scores range from 0-25+ while cosine similarity ranges from 0-1. In a weighted average like `0.5 * vector_score + 0.5 * bm25_score`, a BM25 score of 15.0 overwhelms a vector score of 0.92. The vector component contributes < 6% of the final score. Fix: normalize both score sets to [0, 1] using min-max normalization before combining, or use RRF which ignores raw scores entirely.
:::

::: details Question 3 — PostgreSQL hybrid limits
**Q:** When is it appropriate to use PostgreSQL (pgvector + tsvector) for hybrid search, and when should you use a dedicated vector database?

**A:** PostgreSQL hybrid is appropriate when: (1) the corpus is under ~1M vectors, (2) you already use PostgreSQL and want to avoid infrastructure complexity, (3) you need ACID guarantees on your vector data (e.g., chunks must be consistent with source documents), (4) query latency requirements are relaxed (50-100ms acceptable). Switch to dedicated systems when: (1) vector count exceeds 1-5M, (2) you need sub-10ms vector search latency, (3) you need advanced features like native hybrid fusion (Weaviate), built-in sparse vectors (Qdrant), or multi-tenancy at scale, (4) write throughput is high (frequent re-indexing).
:::

## Key Mental Models

- **Hybrid search exists because no single retrieval method handles all query types.** Dense search finds meaning, BM25 finds words — hybrid covers both failure modes.
- **RRF is the safe default** for fusion because it ignores raw scores and only uses rank positions, sidestepping the normalization problem entirely.
- **Always normalize before fusing scores.** Raw cosine similarity and raw BM25 scores are on incomparable scales — combining them without normalization effectively ignores the lower-scale retriever.
- **Alpha is not universal.** The optimal blend of vector vs BM25 depends on your query distribution, and ideally adapts per query.
- **PostgreSQL hybrid is the "right-sizing" choice** for small-to-medium scale. Do not prematurely adopt dedicated vector databases, but do not assume PostgreSQL scales infinitely either.

## Related

- [Retrieval Strategies](01-retrieval-strategies.md) — the individual retrieval methods that hybrid search combines
- [Reranking](../module-11/01-reranking.md) — the next stage after fusion
- [Query Rewriting](../module-10/01-query-rewriting.md) — query transformations that improve both dense and sparse retrieval
- [Vector DB Internals](../module-08/01-vector-db-internals.md) — HNSW and IVF indexes powering the vector search side
