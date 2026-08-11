---
title: Schema & Index Design
outline: deep
---

# Schema & Index Design

**Interview weight:** 🔥🔥🔥 — interviewers want to see that you can design a real schema, not just call an API. Concrete SQL and configuration wins points.

**Prerequisites:** [Vector DB Internals](01-vector-db-internals.md), [Production Metadata Schema](/rag/module-06/01-metadata-schema.md), [Embedding Models](/rag/module-07/01-embeddings-similarity.md)

## 🗣️ In Plain English

::: tip In Plain English
A schema is the blueprint for how your data lives in the database — which columns exist, what types they hold, and which indexes make searching fast. Get the schema wrong and you get slow queries, wasted storage, or worse — silent data corruption when your embedding dimensions do not match your column definition.
:::

## ⚙️ Under the Hood

### PostgreSQL + pgvector

pgvector is the most pragmatic starting point for teams already using PostgreSQL. It adds vector types and indexes as a Postgres extension.

#### Table Schema

```sql
-- run: psql -f schema.sql

-- Enable the extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Main chunks table
CREATE TABLE chunks (
    -- Identity
    chunk_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     UUID NOT NULL,
    document_version TEXT NOT NULL,
    chunk_index     INTEGER NOT NULL,

    -- Content
    content         TEXT NOT NULL,
    content_hash    TEXT NOT NULL,  -- SHA-256 for deduplication

    -- Embedding (dimension MUST match your model)
    embedding       VECTOR(1536) NOT NULL,  -- text-embedding-3-small = 1536

    -- Source & Location
    source          TEXT NOT NULL,       -- 'confluence', 'gdrive', 's3'
    uri             TEXT,
    page            INTEGER,
    section         TEXT,

    -- Classification
    document_type   TEXT NOT NULL,       -- 'policy', 'api-doc', 'runbook'
    language        TEXT NOT NULL DEFAULT 'en',

    -- Access Control
    tenant_id       TEXT NOT NULL,
    department      TEXT,
    access_level    TEXT NOT NULL DEFAULT 'internal',

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Pipeline Provenance
    parser_version      TEXT,
    chunking_strategy   TEXT,
    chunk_size          INTEGER,
    overlap             INTEGER,
    embedding_model     TEXT NOT NULL,
    embedding_version   TEXT,
    embedding_dimension INTEGER NOT NULL DEFAULT 1536
);

-- Unique constraint: one chunk per position per document version
ALTER TABLE chunks ADD CONSTRAINT uq_chunk_position
    UNIQUE (document_id, document_version, chunk_index);
```

**Why `VECTOR(1536)` and not `VECTOR(3072)`?** The dimension MUST match your embedding model exactly. `text-embedding-3-small` produces 1536 dimensions. If you store a 1536-dim vector in a `VECTOR(3072)` column, Postgres will reject the insert with a dimension mismatch error. This is actually a safety feature — it prevents accidentally mixing vectors from different models.

#### Index Creation

```sql
-- HNSW index for vector similarity search
-- This is the most important index — without it, every query is a sequential scan
CREATE INDEX idx_chunks_embedding ON chunks
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 200);

-- vector_cosine_ops  → cosine distance (most common)
-- vector_l2_ops      → Euclidean distance
-- vector_ip_ops      → inner product (dot product, for normalized vectors)

-- Metadata indexes for filtering (GIN for JSONB, B-tree for scalars)
CREATE INDEX idx_chunks_tenant ON chunks (tenant_id);
CREATE INDEX idx_chunks_document ON chunks (document_id);
CREATE INDEX idx_chunks_access ON chunks (access_level);
CREATE INDEX idx_chunks_type ON chunks (document_type);
CREATE INDEX idx_chunks_updated ON chunks (updated_at);
CREATE INDEX idx_chunks_hash ON chunks (content_hash);

-- Composite index for the most common query pattern
CREATE INDEX idx_chunks_tenant_type ON chunks (tenant_id, document_type);
```

#### HNSW Parameters Explained

```sql
-- m = 16: each node connects to up to 16 neighbors per layer
--   Higher M → better recall, more memory, slower build
--   Range: 8–64. Default: 16. Rarely needs changing.

-- ef_construction = 200: search depth during index build
--   Higher → better graph quality, slower build
--   Range: 64–500. Default: 64 (too low for production).
--   Set to 200–400 for production indexes.

-- At query time, set ef_search:
SET hnsw.ef_search = 200;  -- per-session setting
--   Higher → better recall, slower queries
--   Must be ≥ K (the number of results you want)
--   Range: 40–500. Default: 40.
--   Set to 100–200 for production.
```

#### Production Queries

```sql
-- Basic similarity search with tenant isolation
SELECT chunk_id, content, section, uri, page,
       1 - (embedding <=> $1::vector) AS similarity  -- <=> is cosine distance
FROM chunks
WHERE tenant_id = $2
  AND access_level IN ('public', 'internal')
ORDER BY embedding <=> $1::vector
LIMIT 10;

-- With freshness filter
SELECT chunk_id, content, section, uri, page,
       1 - (embedding <=> $1::vector) AS similarity
FROM chunks
WHERE tenant_id = $2
  AND updated_at > NOW() - INTERVAL '30 days'
  AND document_type = 'runbook'
ORDER BY embedding <=> $1::vector
LIMIT 10;

-- Parent-child: retrieve children, then fetch parent content
WITH matched_children AS (
    SELECT chunk_id, document_id, chunk_index,
           1 - (embedding <=> $1::vector) AS similarity
    FROM chunks
    WHERE tenant_id = $2
    ORDER BY embedding <=> $1::vector
    LIMIT 20
)
SELECT DISTINCT ON (c.document_id)
    c.document_id,
    c.chunk_index,
    c.similarity,
    -- Fetch surrounding chunks (parent window)
    (SELECT string_agg(p.content, E'\n' ORDER BY p.chunk_index)
     FROM chunks p
     WHERE p.document_id = c.document_id
       AND p.chunk_index BETWEEN c.chunk_index - 2 AND c.chunk_index + 2
    ) AS expanded_content
FROM matched_children c
ORDER BY c.document_id, c.similarity DESC;
```

#### Connection Pooling

pgvector queries hold connections during vector computation. For concurrent RAG queries, connection pooling is essential.

```typescript
// run: npx ts-node pgvector-pool.ts
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.PG_HOST,
  database: 'rag_production',
  max: 20,                    // max connections in pool
  idleTimeoutMillis: 30000,   // close idle connections after 30s
  connectionTimeoutMillis: 5000, // fail if can't connect in 5s
});

async function similaritySearch(
  queryEmbedding: number[],
  tenantId: string,
  topK: number = 10
): Promise<ChunkResult[]> {
  const client = await pool.connect();
  try {
    // Set HNSW search parameter for this session
    await client.query('SET hnsw.ef_search = 200');

    const result = await client.query(
      `SELECT chunk_id, content, section, uri, page,
              1 - (embedding <=> $1::vector) AS similarity
       FROM chunks
       WHERE tenant_id = $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      [`[${queryEmbedding.join(',')}]`, tenantId, topK]
    );

    return result.rows;
  } finally {
    client.release(); // return connection to pool
  }
}
```

**Critical:** Use `pgBouncer` or similar in production. Each pgvector query uses significant CPU during vector computation. Without pooling, concurrent queries can exhaust Postgres connections.

---

### Pinecone

Fully managed, serverless vector database. No infrastructure to operate.

#### Collection Setup

```typescript
// run: npx ts-node pinecone-setup.ts
import { Pinecone } from '@pinecone-database/pinecone';

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });

// Create index (serverless)
await pinecone.createIndex({
  name: 'rag-production',
  dimension: 1536,  // MUST match embedding model
  metric: 'cosine', // 'cosine' | 'dotproduct' | 'euclidean'
  spec: {
    serverless: {
      cloud: 'aws',
      region: 'us-east-1',
    },
  },
});
```

#### Namespace Strategy

Pinecone namespaces partition data within an index. Each namespace is isolated — queries only search within their namespace.

```typescript
// Use namespaces for tenant isolation
const index = pinecone.index('rag-production');

// Each tenant gets a namespace
const tenantNamespace = index.namespace(`tenant-${tenantId}`);
```

#### Upsert Format

```typescript
// run: npx ts-node pinecone-upsert.ts
interface PineconeRecord {
  id: string;           // chunk_id
  values: number[];     // embedding vector
  metadata: {           // flat key-value metadata
    document_id: string;
    document_version: string;
    chunk_index: number;
    content: string;      // store chunk text in metadata for retrieval
    source: string;
    uri: string;
    page?: number;
    section?: string;
    document_type: string;
    language: string;
    access_level: string;
    department?: string;
    created_at: string;
    updated_at: string;
    content_hash: string;
    embedding_model: string;
    chunking_strategy: string;
    chunk_size: number;
  };
}

// Batch upsert (max 100 records per call for serverless)
async function batchUpsert(
  namespace: ReturnType<typeof index.namespace>,
  records: PineconeRecord[]
): Promise<void> {
  const BATCH_SIZE = 100;
  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    await namespace.upsert(records.slice(i, i + BATCH_SIZE));
  }
}
```

#### Query with Metadata Filtering

```typescript
// run: npx ts-node pinecone-query.ts
const results = await tenantNamespace.query({
  vector: queryEmbedding,
  topK: 10,
  includeMetadata: true,
  filter: {
    access_level: { $in: ['public', 'internal'] },
    document_type: { $eq: 'runbook' },
    updated_at: { $gte: '2025-01-01T00:00:00Z' },
  },
});

// results.matches: Array<{
//   id: string,
//   score: number,        // similarity score
//   metadata: Record<string, any>
// }>
```

**Pinecone metadata limits:**
- Max 40 KB metadata per vector
- String values max 512 bytes (for filtering — stored values can be longer)
- Metadata fields used in filters are automatically indexed

---

### Qdrant

Open-source vector database. Self-hosted or Qdrant Cloud.

#### Collection Configuration

```typescript
// run: npx ts-node qdrant-setup.ts
import { QdrantClient } from '@qdrant/js-client-rest';

const qdrant = new QdrantClient({ url: 'http://localhost:6333' });

await qdrant.createCollection('rag-production', {
  vectors: {
    size: 1536,         // MUST match embedding model
    distance: 'Cosine', // 'Cosine' | 'Dot' | 'Euclid'
  },
  // HNSW parameters
  hnsw_config: {
    m: 16,
    ef_construct: 200,
    full_scan_threshold: 10000, // use flat scan for small filtered sets
  },
  // Quantization for memory optimization
  quantization_config: {
    scalar: {
      type: 'int8',      // compress vectors from float32 to int8
      quantile: 0.99,
      always_ram: true,   // keep quantized vectors in RAM
    },
  },
});
```

#### Payload Indexes

```typescript
// Create indexes on fields you filter frequently
await qdrant.createPayloadIndex('rag-production', {
  field_name: 'tenant_id',
  field_schema: 'keyword',  // exact match
});

await qdrant.createPayloadIndex('rag-production', {
  field_name: 'document_type',
  field_schema: 'keyword',
});

await qdrant.createPayloadIndex('rag-production', {
  field_name: 'access_level',
  field_schema: 'keyword',
});

await qdrant.createPayloadIndex('rag-production', {
  field_name: 'updated_at',
  field_schema: 'datetime',  // supports range queries
});
```

#### Upsert and Query

```typescript
// Upsert
await qdrant.upsert('rag-production', {
  points: chunks.map((chunk, i) => ({
    id: chunk.metadata.chunk_id,  // UUID or integer
    vector: chunk.embedding,
    payload: {
      document_id: chunk.metadata.document_id,
      content: chunk.text,
      tenant_id: chunk.metadata.tenant_id,
      access_level: chunk.metadata.access_level,
      document_type: chunk.metadata.document_type,
      updated_at: chunk.metadata.updated_at,
      section: chunk.metadata.section,
      uri: chunk.metadata.uri,
      // ... all metadata fields
    },
  })),
});

// Query with filtering
const results = await qdrant.search('rag-production', {
  vector: queryEmbedding,
  limit: 10,
  filter: {
    must: [
      { key: 'tenant_id', match: { value: tenantId } },
      { key: 'access_level', match: { any: ['public', 'internal'] } },
    ],
    should: [
      { key: 'document_type', match: { value: 'runbook' } },
    ],
  },
  with_payload: true,
});
```

---

### Dimension Mismatch: The Silent Killer

The embedding dimension in your schema MUST match the embedding model exactly.

| Model | Dimensions | Schema Must Be |
|-------|:---:|----------------|
| text-embedding-3-small | 1536 | `VECTOR(1536)` / `size: 1536` / `dimension: 1536` |
| text-embedding-3-large | 3072 | `VECTOR(3072)` / `size: 3072` / `dimension: 3072` |
| text-embedding-3-large (reduced) | 1024 | `VECTOR(1024)` / `size: 1024` / `dimension: 1024` |
| Cohere embed-v3 | 1024 | `VECTOR(1024)` |
| BGE-large-en-v1.5 | 1024 | `VECTOR(1024)` |

**What happens on mismatch:**
- **pgvector:** Insert fails with `ERROR: expected 1536 dimensions, not 3072` — safe, you catch it immediately.
- **Pinecone:** Insert fails with a dimension mismatch error — safe.
- **Qdrant:** Insert fails — safe.

All major databases catch dimension mismatches at insert time. The real danger is creating the schema with the wrong dimension in the first place, then discovering the error after deploying.

---

### Migration: Changing Embedding Models

When you change embedding models, you need a new collection (the dimensions may differ, and even if they match, vectors from different models are incompatible).

#### Dual-Collection Strategy

```typescript
// run: npx ts-node dual-collection.ts
interface CollectionConfig {
  name: string;
  model: string;
  dimension: number;
  active: boolean;
}

// Application-level routing
class VectorStore {
  private collections: CollectionConfig[];

  constructor(collections: CollectionConfig[]) {
    this.collections = collections;
  }

  getActiveCollection(): CollectionConfig {
    const active = this.collections.find(c => c.active);
    if (!active) throw new Error('No active collection configured');
    return active;
  }

  async query(queryText: string, tenantId: string, topK: number = 10) {
    const active = this.getActiveCollection();

    // Embed with the model that matches the active collection
    const embedding = await embed(queryText, active.model);

    // Query the active collection
    return this.queryCollection(active.name, embedding, tenantId, topK);
  }

  // Migration: switch active collection after validation
  async switchActiveCollection(newCollectionName: string): Promise<void> {
    for (const col of this.collections) {
      col.active = col.name === newCollectionName;
    }
    // In production: this is a database/config update, not in-memory
  }
}
```

**Steps:**
1. Create new collection with new model's dimensions
2. Re-embed all documents into new collection (background job)
3. Validate: run eval set against new collection
4. Switch `active` flag to new collection (atomic config change)
5. Keep old collection for 14-30 days (rollback)
6. Delete old collection

---

### Partitioning Strategies

| Strategy | How | Pros | Cons | Best For |
|----------|-----|------|------|----------|
| **Single collection + filter** | All data in one collection, filter by metadata | Simple. One index. | Noisy neighbor. Pre-filter recall issues. | <100 tenants, low selectivity filters |
| **Collection per tenant** | `rag_tenant_123`, `rag_tenant_456` | Complete isolation. Optimal recall. | Operational overhead (N collections). | Compliance-driven isolation |
| **Collection per doc type** | `rag_policies`, `rag_code`, `rag_runbooks` | Queries scoped to doc type. | Cross-type queries need scatter-gather. | Distinct doc types with different schemas |
| **Namespace (Pinecone)** | One index, multiple namespaces | Near-isolation. Single index to manage. | Pinecone-specific. | Multi-tenant on Pinecone |
| **Date-based partitioning** | Monthly collections: `rag_2025_01`, `rag_2025_02` | Easy retention/archival. | Cross-month queries need merging. | Time-series documents, logs |

---

### Connection Pooling for pgvector

pgvector queries are CPU-intensive — each computes distances for thousands of vectors. Without connection pooling, concurrent RAG queries can exhaust Postgres connections.

```
Without pooling:
  20 concurrent RAG queries → 20 Postgres connections
  Each holds the connection during vector computation (50-200ms)
  Postgres max_connections = 100 → safe at 20, but add your application's
  other queries and you're at the limit fast

With PgBouncer (transaction mode):
  20 concurrent RAG queries → PgBouncer pool of 10 connections
  Each query acquires a connection, runs, releases
  Postgres sees max 10 connections, serves 20+ queries
```

```ini
; pgbouncer.ini
[databases]
rag_production = host=localhost port=5432 dbname=rag_production

[pgbouncer]
pool_mode = transaction  ; release connection after each transaction
max_client_conn = 200    ; clients can open 200 connections to PgBouncer
default_pool_size = 20   ; PgBouncer opens max 20 connections to Postgres
```

**Warning:** `SET hnsw.ef_search = 200` is a session-level setting. In transaction pooling mode, SET commands do not persist between queries (different queries may use different backend connections). Use `SET LOCAL` inside a transaction, or configure the default in `postgresql.conf`.

```sql
-- Option 1: SET LOCAL inside a transaction
BEGIN;
SET LOCAL hnsw.ef_search = 200;
SELECT ... ORDER BY embedding <=> $1::vector LIMIT 10;
COMMIT;

-- Option 2: Set the default in postgresql.conf
-- ALTER SYSTEM SET hnsw.ef_search = 200;
-- SELECT pg_reload_conf();
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. SET ef_search lost in connection pooling.**
You use PgBouncer in transaction mode. Your application runs `SET hnsw.ef_search = 200` at startup, but in transaction mode, each query can get a different backend connection. The SET applies to one connection; subsequent queries use other connections with the default ef_search=40. Recall drops intermittently — some queries get 97% recall, others get 88%. Debugging is maddening because it's non-deterministic. **Fix:** Use `SET LOCAL` inside a transaction, or set the default in `postgresql.conf`.

**2. No HNSW index on pgvector — sequential scan in production.**
A common mistake: create the table, insert millions of vectors, deploy to production, and never run `CREATE INDEX`. pgvector falls back to sequential scan (brute force). With 2M vectors, queries take 2-3 seconds. The system works but is unusably slow. No error message indicates the missing index. **Fix:** Include index creation in your migration script. Verify with `EXPLAIN ANALYZE` that the HNSW index is being used.

**3. Pinecone metadata value too long for filtering.**
You store full chunk content in Pinecone metadata (good for retrieval), then try to filter on it. Pinecone metadata values used in filters are limited to 512 bytes for strings. Your filter silently fails or returns unexpected results. **Fix:** Use short, structured values for filterable fields (tenant_id, access_level, document_type). Store long content in metadata for retrieval only, not for filtering.

**4. Wrong distance metric in index.**
You create an HNSW index with `vector_l2_ops` (Euclidean distance) but your application code expects cosine similarity. For normalized vectors this makes no practical difference in ranking, but for un-normalized vectors, the rankings are wrong. You get slightly off results that are hard to trace to the root cause. **Fix:** Match the index operator class to your similarity metric. Use `vector_cosine_ops` for cosine, `vector_ip_ops` for dot product, `vector_l2_ops` for Euclidean. Check your embedding model's documentation for the recommended metric.

:::

## 🎯 Checkpoint

::: details Question 1 — pgvector Schema
**Q:** Design a pgvector schema for a multi-tenant RAG system with 3 million chunks. Include the table, vector column, all necessary indexes, and explain your HNSW parameter choices.

**A:** Table: `chunks` with columns for identity (chunk_id UUID PK, document_id UUID, chunk_index INT), content (content TEXT, content_hash TEXT), embedding (VECTOR(1536) for text-embedding-3-small), metadata (source TEXT, uri TEXT, page INT, section TEXT, document_type TEXT, tenant_id TEXT, access_level TEXT), timestamps (created_at, updated_at, ingested_at TIMESTAMPTZ), and provenance (embedding_model TEXT, chunking_strategy TEXT). Indexes: (1) HNSW on embedding with `vector_cosine_ops`, M=16, ef_construction=200. M=16 is the standard for up to 10M vectors — each node connects to 16 neighbors, providing good recall without excessive memory. ef_construction=200 (higher than the default 64) ensures the graph is well-connected, which directly improves recall at query time. (2) B-tree on tenant_id — every query includes this filter, it must be fast. (3) B-tree on (tenant_id, document_type) — composite index for the most common filtered query pattern. (4) B-tree on document_id — for document-level operations (delete all chunks for a document). (5) B-tree on content_hash — for deduplication checks. At query time, set `hnsw.ef_search = 200` (via SET LOCAL or postgresql.conf) for 97-99% recall. Memory estimate: 3M vectors × 1536 dims × 4 bytes = ~17 GB for vectors, plus ~3-5 GB for HNSW graph overhead = ~20-22 GB. A 32 GB instance handles this with room for Postgres buffer cache.
:::

::: details Question 2 — Pinecone vs pgvector
**Q:** Compare Pinecone and pgvector for a production RAG system with 10 million vectors, 50 tenants, and a team of 3 engineers. Consider: operational burden, cost, filtering, and scaling.

**A:** **pgvector:** Operational burden is moderate — it's Postgres, which the team likely already manages. 10M vectors at 1536 dims ≈ 57 GB raw + HNSW overhead ≈ ~80 GB. Requires a large instance (128 GB RAM recommended for headroom). Filtering uses full SQL (very powerful — JOINs, complex WHERE, GIN indexes). Scaling: vertical only (read replicas for query throughput). Cost: Postgres hosting (~$500-1000/month for a large managed instance). Limitation: at 10M vectors, build time for HNSW index can take 30-60 minutes. **Pinecone:** Zero operational burden — fully managed, no infrastructure. Serverless scales automatically. Filtering uses key-value metadata filters (less powerful than SQL but covers most RAG needs). Cost: usage-based pricing (reads + writes + storage). At 10M vectors with moderate query load, roughly $70-200/month. No index build time to manage. Limitation: no SQL JOINs, metadata value limits, vendor lock-in. **Recommendation for this scenario:** Pinecone. With 3 engineers, operational overhead matters enormously. Managing a 128 GB Postgres instance, HNSW index builds, and query performance tuning takes engineering time away from product work. Pinecone eliminates the ops burden. The metadata filtering limitations rarely matter for RAG workloads. If the team has strong Postgres expertise and already runs a large instance, pgvector saves money but costs engineering time.
:::

::: details Question 3 — Migration Between Databases
**Q:** You are migrating from pgvector to Qdrant. You have 5 million vectors. How do you execute this migration with zero downtime?

**A:** The migration is analogous to the blue-green embedding migration but at the database layer. (1) Set up Qdrant (self-hosted or cloud) with matching collection configuration: dimension=1536, distance=Cosine, HNSW params (m=16, ef_construct=200). Create payload indexes for tenant_id, access_level, document_type, updated_at. (2) Write a migration worker that reads chunks from pgvector (SELECT chunk_id, content, embedding, and all metadata), transforms them into Qdrant point format, and upserts into Qdrant. Process in batches of 1000. Track progress (last processed chunk_id) for resumability. (3) During migration, continue writing new chunks to BOTH pgvector AND Qdrant (dual-write). This ensures the Qdrant collection stays current while the backfill runs. (4) After backfill completes, validate: run your retrieval eval set against both databases. Compare Recall@K, MRR, and latency. Results should be nearly identical (same vectors, same embeddings). (5) Switch the application's query path from pgvector to Qdrant (feature flag or config change). Keep writes dual for 7 days. (6) After confirming Qdrant is stable, stop dual-write and decommission pgvector. Key risks: (a) Dual-write adds latency and failure modes — write to Qdrant can fail while pgvector succeeds. Use an async queue for Qdrant writes so pgvector writes are not blocked. (b) Data consistency — verify vector counts and spot-check embeddings match between databases.
:::

## Key Mental Models

- **Dimension must match the model.** `VECTOR(1536)` for text-embedding-3-small, `VECTOR(3072)` for text-embedding-3-large. A mismatch is caught at insert time, but getting it wrong wastes deployment time.
- **Create the HNSW index explicitly.** pgvector without an index does brute-force scans. This is the most common pgvector performance mistake.
- **Connection pooling and SET LOCAL go together.** In transaction pooling mode, session-level SET commands do not persist. Use SET LOCAL or configure defaults in postgresql.conf.
- **Partitioning strategy depends on tenant count and isolation requirements.** Single collection + filter for few tenants, namespace/collection-per-tenant for many tenants or compliance needs.
- **Start with pgvector if you already use Postgres.** Migrate to a dedicated vector DB only when you hit concrete limits (corpus size, query latency, operational burden).

## Related

- [Vector DB Internals](01-vector-db-internals.md) — ANN algorithms and index types
- [Production Metadata Schema](/rag/module-06/01-metadata-schema.md) — metadata fields stored in the schema
- [Embedding Models](/rag/module-07/01-embeddings-similarity.md) — dimension and distance metric choices
- [Model Selection & Migration](/rag/module-07/02-model-selection.md) — re-indexing strategy when changing models
