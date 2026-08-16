---
title: Vector DB Internals
outline: deep
---

# Vector DB Internals

**Interview weight:** 🔥🔥🔥 — interviewers expect you to explain HNSW, understand ANN trade-offs, and compare database options with real reasoning.

**Prerequisites:** [Embedding Models & Similarity](/rag/module-07/01-embeddings-similarity.md), [Production Metadata Schema](/rag/module-06/01-metadata-schema.md)

## 🗣️ In Plain English

::: tip In Plain English
Finding the most similar vector by checking every single one is like searching for your friend in a stadium by walking up to every seat. An approximate nearest neighbor index is like dividing the stadium into sections — you check a few nearby sections and accept that your friend might be in a section you skipped. You trade a small chance of missing the exact best match for finishing in seconds instead of hours.
:::

## ⚙️ Under the Hood

### Why Brute Force Fails at Scale

Exact nearest neighbor search (brute force) compares the query vector against every vector in the database.

```text
Query vector: [0.12, -0.34, 0.56, ...]

For each of N stored vectors:
  compute cosine_similarity(query, stored_vector)

Sort by similarity → return top K

Time complexity: O(N × D)
  N = number of vectors
  D = dimension count
```

| Corpus Size | Dimensions | Comparisons per Query | Latency (approx) |
|:---:|:---:|:---:|:---:|
| 10,000 | 1536 | 10,000 | ~1ms |
| 100,000 | 1536 | 100,000 | ~10ms |
| 1,000,000 | 1536 | 1,000,000 | ~100ms |
| 10,000,000 | 1536 | 10,000,000 | ~1s |
| 100,000,000 | 1536 | 100,000,000 | ~10s |

**At 1 million vectors, brute force is borderline.** At 10 million, it is unusable for interactive applications. At 100 million, it is out of the question.

**When brute force IS fine:**
- Less than ~100K vectors
- Batch processing (not real-time queries)
- Development/testing environments
- When you need exact results and can tolerate latency

---

### ANN: Approximate Nearest Neighbor

ANN algorithms trade a small amount of accuracy (recall) for dramatic speed improvements. Instead of checking every vector, they use an index structure to find the approximately nearest neighbors.

```text
Exact NN:   100% recall, O(N) time
ANN:        95-99% recall, O(log N) or O(√N) time
```

**Recall** in the ANN context means: of the true top-K nearest neighbors, how many does the algorithm actually find? A recall of 0.95 means it finds 95% of the true nearest neighbors. The other 5% are slightly less relevant results that replace the missed ones.

For RAG, 95-99% recall is almost always acceptable. You are retrieving top-10 chunks to feed an LLM — missing the 10th-best chunk in favor of the 12th-best has negligible impact on answer quality.

---

### HNSW (Hierarchical Navigable Small World)

The most common ANN index in production vector databases. Used by default in pgvector, Qdrant, Weaviate, and Pinecone.

#### How It Works

HNSW builds a multi-layer graph where each vector is a node, and edges connect nodes to their nearest neighbors.

```text
Layer 2 (sparse):    A ──── F ──── K
                     │              │
Layer 1 (medium):    A ─ C ─ F ─ H ─ K ─ M
                     │   │   │   │   │   │
Layer 0 (dense):     A B C D E F G H I J K L M N O
                     ─────────────────────────────
                     All vectors connected to neighbors
```

**Search process:**
1. Start at the top layer (sparse, few nodes) — find the approximate region
2. Move down to the next layer — refine the region
3. At layer 0 (all nodes) — greedily traverse to find nearest neighbors
4. At each layer, traverse edges to find closer nodes (greedy best-first)

**This is like GPS navigation:** start zoomed out (country level), narrow to region, then city, then street. Each layer doubles the resolution.

#### Build-Time Parameters

| Parameter | What It Controls | Effect of Increasing | Typical Value |
|-----------|-----------------|---------------------|:---:|
| **M** | Max edges per node per layer | More edges = better recall, more memory, slower build | 16 |
| **efConstruction** | Search depth during index build | Deeper search = better graph quality, slower build | 200 |

**M** determines graph connectivity. Higher M means each node connects to more neighbors, creating more paths for the search algorithm. More paths = higher recall, but more memory (each edge stores a vector ID and distance).

**efConstruction** determines how carefully the index is built. Higher values mean the build process searches more thoroughly to find the best neighbors for each new node. The index takes longer to build but produces better recall at query time.

#### Query-Time Parameters

| Parameter | What It Controls | Effect of Increasing | Typical Value |
|-----------|-----------------|---------------------|:---:|
| **ef** (efSearch) | Number of candidates explored during search | More candidates = better recall, slower queries | 100 |

**ef must be ≥ K** (the number of results you want). If you want top-10, ef must be at least 10. In practice, ef = 100-200 gives 95-99% recall for most corpora.

#### HNSW Trade-offs

```yaml
Pros:
  ✓ Fast queries: O(log N) typical
  ✓ High recall at reasonable speed (95-99% at ~1ms for 1M vectors)
  ✓ No training step — index builds incrementally (supports real-time inserts)
  ✓ Well-supported across all major vector DBs

Cons:
  ✗ High memory: stores the full graph in RAM. Vectors + edges = 2-4x raw vector size.
  ✗ Slow to build: O(N × log N × M × efConstruction)
  ✗ Expensive updates: deleting a node requires graph reconstruction
  ✗ Memory scales linearly with corpus size
```

**Memory estimation:**
```text
HNSW memory ≈ N × (D × 4 bytes + M × 2 × 8 bytes)
            = N × (vector_bytes + edge_bytes)

For 1M vectors, 1536 dims, M=16:
  1M × (1536 × 4 + 16 × 2 × 8) = 1M × (6144 + 256) = ~6.1 GB

For 10M vectors: ~61 GB (must fit in RAM for fast queries)
```

---

### IVF (Inverted File Index)

IVF partitions the vector space into clusters (Voronoi cells) and searches only the nearest clusters at query time.

#### How It Works

```text
Build time:
  1. Run K-means clustering on all vectors → create nlist centroids
  2. Assign each vector to its nearest centroid
  3. Store vectors in inverted lists (one list per centroid)

Query time:
  1. Compare query to all nlist centroids → find nprobe nearest centroids
  2. Search only vectors in those nprobe clusters (brute force within clusters)
  3. Return top-K results
```

```text
                    ┌────────────┐
                    │ nlist=100  │
                    │ centroids  │
                    └─┬──┬──┬───┘
                      │  │  │
             ┌────────┘  │  └────────┐
             │           │           │
        ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
        │Cluster 1│ │Cluster 2│ │Cluster 3│  ... 97 more
        │ 10K vecs│ │ 8K vecs │ │ 12K vecs│
        └─────────┘ └─────────┘ └─────────┘

Query: compare to 100 centroids, search top nprobe=10 clusters
       → search ~100K vectors instead of 1M (10x speedup)
```

#### IVF Parameters

| Parameter | What It Controls | Typical Value |
|-----------|-----------------|:---:|
| **nlist** | Number of clusters | √N to 4×√N (1000 for 1M vectors) |
| **nprobe** | Number of clusters to search at query time | 5-20% of nlist |

#### IVF Trade-offs

```yaml
Pros:
  ✓ Lower memory than HNSW (no graph edges)
  ✓ Can work with disk-based storage (vectors don't all need to fit in RAM)
  ✓ Training (K-means) produces good partitions for uniformly distributed data

Cons:
  ✗ Requires training step (K-means on the full corpus) — no incremental inserts
  ✗ Adding new vectors after training degrades quality (clusters become imbalanced)
  ✗ Lower recall than HNSW at the same query speed
  ✗ Performance degrades with highly clustered (non-uniform) data
```

**IVF is less common in modern vector databases.** HNSW has largely replaced IVF as the default index type. IVF is still used in combination with Product Quantization (IVF-PQ) for memory-constrained environments.

---

### Product Quantization (PQ)

PQ compresses vectors to reduce memory, trading accuracy for storage efficiency.

#### How It Works

```text
Original vector (1536 dims, 6 KB):
  [0.12, -0.34, 0.56, ..., 0.23]

Split into m=96 sub-vectors (each 16 dims):
  [0.12, -0.34, ...] [0.56, 0.78, ...] ... [0.23, -0.11, ...]
       sub-vec 1          sub-vec 2              sub-vec 96

Each sub-vector → quantize to nearest centroid (8-bit code):
  [42] [187] ... [91]  ← 96 bytes instead of 6,144 bytes (64x compression!)

At query time: approximate distances using centroid distances (precomputed table)
```

| Aspect | Detail |
|--------|--------|
| **Compression** | 32-64x typical (6 KB → ~100 bytes per vector) |
| **Recall impact** | 5-15% recall drop vs uncompressed |
| **Use case** | When vectors don't fit in RAM |
| **Common combo** | IVF-PQ: cluster first, then compress vectors within each cluster |

---

### Flat Index (Brute Force)

No indexing at all. Compute exact distances for every query.

| Aspect | Detail |
|--------|--------|
| **Recall** | 100% (exact results) |
| **Speed** | O(N × D) per query |
| **Memory** | Raw vectors only (no index overhead) |
| **When to use** | <100K vectors, testing/validation, when exact results matter |

**pgvector without a HNSW/IVF index runs flat (sequential scan).** This is fine for development but not for production at scale.

---

### Index Type Comparison

| Index | Recall | Query Speed | Memory | Build Speed | Incremental Insert | Best For |
|-------|:---:|:---:|:---:|:---:|:---:|----------|
| **Flat** | 100% | O(N) | 1x | None | Yes | <100K vectors, testing |
| **HNSW** | 95-99% | O(log N) | 2-4x | Slow | Yes | Production default |
| **IVF** | 90-98% | O(√N) | 1.1x | Moderate (K-means) | No (degrades) | Memory-constrained |
| **IVF-PQ** | 85-95% | O(√N) | 0.1x | Slow | No | Billions of vectors, low RAM |

---

### Pre-Filter vs Post-Filter

How metadata filtering interacts with ANN search is a critical implementation detail:

```yaml
Pre-filter:
  [1M vectors] → filter by metadata → [50K matching] → HNSW search on 50K → [top K]
  ✓ Always returns K results (if ≥K match the filter)
  ✗ HNSW graph was built on 1M vectors — searching a 50K subset means traversing
    a sparse subgraph (some edges lead to filtered-out nodes), degrading recall

Post-filter:
  [1M vectors] → HNSW search → [top K' candidates] → filter by metadata → [≤K results]
  ✓ HNSW runs on the full graph (optimal traversal)
  ✗ May return fewer than K results after filtering
  ✗ Must over-fetch (K'=K×10?) to compensate — how much to over-fetch is unknowable
```

**The pre-filter recall problem:**
When a filter is very selective (e.g., `tenant_id=X` matches 0.1% of vectors), the HNSW graph becomes extremely sparse after filtering. The search algorithm hits dead ends where all neighboring nodes are filtered out. Recall drops dramatically.

**Solutions:**
- **Pinecone/Qdrant approach:** Build optimized metadata indexes alongside the vector index. Apply filters efficiently during traversal, not as a separate step.
- **pgvector approach:** Pre-filter with a SQL WHERE clause, then scan vectors. For small filtered sets, this becomes a flat scan (fast). For large filtered sets, the HNSW index helps.
- **Partitioned HNSW:** Build separate HNSW indexes per partition (per tenant, per document type). Each sub-index is a fully connected graph. Higher operational complexity but optimal recall per partition.

---

### Vector Database Comparison

| Database | Hosting | Index Types | Metadata Filtering | Hybrid Search | Scaling | Cost Model | Best For |
|----------|---------|-------------|-------------------|:---:|---------|------------|----------|
| **PostgreSQL + pgvector** | Self-hosted, managed Postgres | HNSW, IVF | Full SQL (WHERE, JOIN, GIN indexes) | Via ts_vectors (BM25) | Single node (read replicas) | Postgres hosting cost | Teams already on Postgres, <10M vectors, SQL joins needed |
| **Pinecone** | Fully managed (serverless or pods) | Proprietary (HNSW-like) | Key-value filters | Sparse-dense hybrid | Serverless auto-scales | Per-query + storage | Fastest to production, no ops burden |
| **Qdrant** | Self-hosted, Qdrant Cloud | HNSW | Payload indexes, rich filtering | Sparse vectors | Horizontal sharding | Self-hosted: infra cost. Cloud: per-vector | Open-source, self-hosted production |
| **Weaviate** | Self-hosted, Weaviate Cloud | HNSW + PQ | Property-based filters | BM25 + vector | Horizontal sharding | Self-hosted: infra cost | Schema-first, GraphQL API |
| **Milvus** | Self-hosted, Zilliz Cloud | HNSW, IVF, DiskANN | Attribute filtering | Sparse + dense | Distributed (disaggregated storage/compute) | Self-hosted: infra cost | Billion-scale, distributed |
| **Elasticsearch / OpenSearch** | Self-hosted, managed | HNSW | Full Lucene query DSL | Native BM25 + vector | Horizontal sharding | Self-hosted or managed | Already running ES, need to add vector search |

### Decision Heuristic

```text
Already using PostgreSQL?
  └── <5M vectors → pgvector (add extension, done)
  └── >5M vectors → consider dedicated vector DB

Want zero ops burden?
  └── Pinecone serverless

Need self-hosted (privacy/compliance)?
  └── Qdrant or Milvus

Already running Elasticsearch?
  └── Add vector search to existing ES

Billion-scale?
  └── Milvus / Zilliz

Need the richest filtering and SQL joins?
  └── pgvector (it's just Postgres)
```

---

### Scaling Patterns

#### Sharding

Split vectors across multiple nodes by some partition key.

```text
Shard by tenant_id:
  Node 1: tenants A-M (500K vectors)
  Node 2: tenants N-Z (500K vectors)

Shard by hash:
  Node 1: hash(chunk_id) % 3 == 0
  Node 2: hash(chunk_id) % 3 == 1
  Node 3: hash(chunk_id) % 3 == 2
```

**Tenant-based sharding** is natural for multi-tenant RAG — each query hits one shard (no scatter-gather). Hash-based sharding distributes evenly but requires querying all shards and merging results.

#### Replication

Read replicas for query throughput. Writes go to the primary; reads can hit any replica.

```text
Write path: Application → Primary node → replicate to replicas
Read path:  Application → Load balancer → any replica
```

**pgvector scaling:** Use Postgres read replicas. Writes (upserts) go to primary; queries (SELECT with vector similarity) go to replicas. This is standard Postgres scaling — no special vector DB knowledge needed.

#### Memory vs Disk

| Approach | Latency | Throughput | Cost |
|----------|:---:|:---:|:---:|
| **All in RAM** | ~1ms p50 | Highest | Expensive (RAM is 10-20x disk cost) |
| **Vectors on disk, index in RAM** | ~5-10ms p50 | Good | Moderate |
| **Everything on disk (DiskANN)** | ~10-50ms p50 | Lower | Cheapest |

**Milvus DiskANN** and **Qdrant on-disk storage** support disk-based vector storage for cost optimization at the expense of latency.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. HNSW index not created — running flat scans in production.**
You set up pgvector, create a table with a vector column, insert 2 million vectors, and queries take 2-3 seconds. You check the query plan: sequential scan. You never ran `CREATE INDEX ... USING hnsw`. Without the index, pgvector does brute-force comparison against every row. **Fix:** Always create the HNSW index after loading data. Monitor query plans (`EXPLAIN ANALYZE`) to verify the index is being used. Set `ivfflat.probes` or `hnsw.ef_search` in the session.

**2. Pre-filter recall collapse on selective filters.**
A multi-tenant system with 100 tenants and 10 million total vectors. Tenant X has 5,000 vectors. A query with `WHERE tenant_id = 'X'` activates 0.05% of the HNSW graph. The search algorithm cannot find good paths — most neighbors are filtered out. Recall drops to 60%. **Fix:** For highly selective filters, fall back to flat scan on the filtered subset (pgvector does this naturally with a small WHERE result set). Or use per-tenant partitions/collections with dedicated HNSW indexes.

**3. HNSW parameters never tuned.**
Default parameters (M=16, efConstruction=64, ef=40) are conservative. For a high-stakes medical RAG system, these defaults give 92% recall — missing 8% of relevant results. Increasing efConstruction to 200 and ef to 200 raises recall to 99% with a 2x query latency increase (1ms → 2ms). The latency trade-off is irrelevant for the quality gain. **Fix:** Tune parameters based on your recall requirements. Build, measure recall on a test set, and adjust. Do not use defaults for production.

**4. Running out of memory with growing corpus.**
You start with 1M vectors in HNSW (6 GB RAM). The corpus grows to 10M vectors (60 GB). Your server has 64 GB RAM. The HNSW index no longer fits in memory. Query latency jumps from 1ms to 500ms as the OS swaps. **Fix:** Monitor memory usage relative to vector count. Plan capacity for 2-3x growth. Consider Product Quantization (PQ) for compression, or disk-based indexes if latency requirements allow 10-50ms.

:::

## 🎯 Checkpoint

::: details Question 1 — HNSW Mechanics
**Q:** Explain how HNSW search works. Why does it have multiple layers, and what do the parameters M, efConstruction, and ef control?

**A:** HNSW builds a multi-layer navigable graph. Each vector is a node. Edges connect nodes to their approximate nearest neighbors. The top layer is sparse (few nodes, long-range connections), and each subsequent layer is denser, with the bottom layer containing all nodes. Search starts at the top layer and greedily traverses edges to find the closest node, then drops to the next layer and repeats with finer granularity. This hierarchical structure enables O(log N) search — the top layers skip large regions of the space, and the bottom layer does precise local search. **M** controls the maximum number of edges per node per layer — higher M means more connections, better recall, but more memory (each edge stores a reference). **efConstruction** controls how many candidates are explored when adding a new node during index build — higher values produce a better-connected graph (higher recall) at the cost of slower build time. **ef** (efSearch) controls how many candidates are explored during query time — higher values check more candidates, improving recall but increasing latency. The key trade-off: M and efConstruction are set once at build time and affect memory and build speed; ef is set per query and trades latency for recall.
:::

::: details Question 2 — Pre-Filter vs Post-Filter
**Q:** Your RAG system has 10 million vectors across 200 tenants. Tenant A has 100,000 vectors, Tenant B has 500 vectors. How does metadata filtering affect search quality for each tenant?

**A:** For Tenant A (100,000 vectors = 1% of index): pre-filtering reduces the HNSW graph to 100K nodes, which is still dense enough for good graph traversal. Recall will be slightly lower than searching the full index (maybe 93% instead of 97%) but still acceptable. For Tenant B (500 vectors = 0.005% of index): pre-filtering leaves a tiny subset of the HNSW graph. The graph structure is almost entirely pruned — most edges lead to filtered-out nodes. The search algorithm cannot find efficient paths. Recall could drop to 50-70%, which is unacceptable. The fix for Tenant B: either use flat scan (brute force on 500 vectors is trivially fast) or create a separate per-tenant HNSW index. Most databases handle this automatically — pgvector will use a sequential scan when the WHERE clause is selective enough (the query planner knows 500 rows don't justify an index scan). Pinecone and Qdrant have optimized pre-filter implementations that handle small subsets better. The general lesson: pre-filter performance is a function of filter selectivity relative to corpus size.
:::

::: details Question 3 — Database Selection
**Q:** You are building a RAG system for a startup. You have 500K documents, use PostgreSQL for your application database, and have a small ops team. Which vector database should you use and why?

**A:** pgvector. Reasons: (1) You already have PostgreSQL — adding the pgvector extension is a one-line migration. No new infrastructure, no new database to operate, no new backup strategy. (2) 500K documents ≈ 2-5M chunks ≈ 2-5M vectors. pgvector handles 5M vectors comfortably on a moderate instance (32 GB RAM with HNSW). (3) You get full SQL: JOIN chunk results with your application data (users, permissions, documents), use existing connection pooling, use existing monitoring. (4) Small ops team: one database is dramatically easier to operate than two. (5) Limitations to accept: pgvector scales vertically (read replicas help with query throughput but not with write throughput or corpus size). If you grow to 50M+ vectors or need horizontal sharding, you would migrate to a dedicated vector database. But that is a problem for later — premature infrastructure is a larger risk than premature optimization. Start with pgvector, measure, and migrate only when you hit concrete limits.
:::

## Key Mental Models

- **HNSW is the production default.** It offers the best recall-speed trade-off for most workloads. Understand its parameters (M, efConstruction, ef) and memory characteristics.
- **ANN recall is usually fine for RAG.** Missing the 10th-best chunk in favor of the 12th-best has negligible impact on LLM answer quality. Optimize for speed unless your domain demands exactness.
- **Pre-filter recall degrades with selectivity.** Highly selective filters (small tenants, rare document types) break HNSW graph traversal. Plan for this with per-partition indexes or flat-scan fallbacks.
- **pgvector is the right starting point for most teams.** It adds vector search to your existing Postgres with zero new infrastructure. Migrate to a dedicated vector DB only when you hit concrete limits.
- **Memory is the HNSW constraint.** Vectors + graph edges must fit in RAM for fast queries. Plan capacity for 2-3x growth.

## Related

- [Schema & Index Design](02-schema-design.md) — concrete production schemas and index creation
- [Embedding Models & Similarity](/rag/module-07/01-embeddings-similarity.md) — dimensions and distance metrics that affect index design
- [Production Metadata Schema](/rag/module-06/01-metadata-schema.md) — metadata filtering depends on DB capabilities
- [Model Selection & Migration](/rag/module-07/02-model-selection.md) — re-indexing when changing embedding models
