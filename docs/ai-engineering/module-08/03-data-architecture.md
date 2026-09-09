---
title: Data Architecture for AI — Choosing the Right Storage
outline: deep
---

# Data Architecture for AI — Choosing the Right Storage

🔥🔥🔥 Interview weight | Prerequisites: [8.1 AI System Patterns](./01-ai-system-patterns)

## 🗣️ In Plain English

::: tip In Plain English
Every AI system needs to store and retrieve information. But not all information is the same shape, and reaching for the wrong storage system is one of the most common architectural mistakes.

Think of it this way: you're building a hospital. Different information needs different systems.

**PostgreSQL** is your central medical records system: structured, transactional, queryable. Patient name, date of birth, insurance ID, appointment history — all with strict rules, relationships, and the ability to query precisely. If you need "all diabetic patients over 50 who haven't had a checkup in a year", this is your tool.

**Vector Databases** (Pinecone, Qdrant, pgvector) are your semantic filing system. You have thousands of medical research papers and treatment guidelines. A doctor asks "what are the current best practices for managing hypertension in elderly patients?" You can't keyword-search that — you need semantic understanding. The vector database stores documents as directions in meaning-space and finds the most relevant ones by concept, not keyword.

**Elasticsearch** is your fast full-text search. You need to find all patient notes that mention "ibuprofen" or "NSAIDs" or "anti-inflammatory" — specific terms, exact matches, ranked by relevance. Elasticsearch excels at this hybrid of keyword matching and relevance scoring.

**Graph Databases** (Neo4j, Azure Cosmos DB) are your relationship maps. "Show me all the doctors who trained under Dr. Smith, who now see patients who share insurance with patients who had complications from drug X." Pure relational databases struggle with these multi-hop relationship queries; graph databases are designed for them.

**Data Lakehouses** (Azure Data Lake + Delta Lake, Databricks) are your warehouse of everything. Raw data, processed data, historical records, audit logs — petabytes of it, queryable at scale for analytics and ML training. Not for real-time queries; for historical analysis, model training, and reporting.

In production AI systems, you typically use all five — each for what it's best at. The architecture decision is knowing which query goes to which store.
:::

## ⚙️ Under the Hood

### PostgreSQL — The Transactional Backbone

PostgreSQL stores structured, relational, ACID-compliant data. In an AI system, PostgreSQL typically stores:

```sql
-- Core tables in an enterprise AI system

-- Conversations and messages (audit trail)
CREATE TABLE ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    session_id VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE TABLE ai_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES ai_conversations(id),
    role VARCHAR(50) NOT NULL,         -- 'user', 'assistant', 'system', 'tool'
    content TEXT NOT NULL,
    model VARCHAR(100),                -- model used for this message
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd DECIMAL(10, 6),
    latency_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Token budget tracking
CREATE TABLE ai_usage (
    user_id VARCHAR(255) NOT NULL,
    tenant_id VARCHAR(255) NOT NULL,
    month DATE NOT NULL,               -- first day of month
    total_tokens BIGINT DEFAULT 0,
    total_cost_usd DECIMAL(10, 4) DEFAULT 0,
    PRIMARY KEY (user_id, month)
);

-- Document registry (metadata; content in vector DB)
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id VARCHAR(255) NOT NULL,
    title TEXT,
    source VARCHAR(500),
    collection VARCHAR(255),
    version INTEGER DEFAULT 1,
    content_hash VARCHAR(64),          -- detect duplicates/changes
    ingested_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_docs_tenant_collection ON documents(tenant_id, collection);
CREATE INDEX idx_messages_conversation ON ai_messages(conversation_id);
CREATE INDEX idx_usage_tenant_month ON ai_usage(tenant_id, month);
```

**When to use PostgreSQL for AI:**
- Conversation history and audit logs (structured, queryable)
- User/tenant metadata and permissions
- Document registry and ingestion tracking
- Token usage and cost accounting
- Any data requiring ACID transactions (billing, quota enforcement)

### pgvector — Vector Search Inside PostgreSQL

For many systems, adding the `pgvector` extension to existing PostgreSQL eliminates the need for a separate vector database:

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Document chunks with embeddings
CREATE TABLE document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL,
    collection VARCHAR(255) NOT NULL,
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),            -- OpenAI text-embedding-3-small
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- IVFFlat index for approximate nearest neighbor search
-- lists: ~sqrt(n_rows); balance build time vs query time
CREATE INDEX ON document_chunks
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100);

-- HNSW index (faster queries, slower builds, more memory)
-- CREATE INDEX ON document_chunks
--     USING hnsw (embedding vector_cosine_ops)
--     WITH (m = 16, ef_construction = 64);
```

```typescript
// run: npx tsx pgvector_search.ts
// Semantic search with pgvector
import { Pool } from 'pg'
import OpenAI from 'openai'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const openai = new OpenAI()

async function semanticSearch(
  query: string,
  tenantId: string,
  collection: string,
  topK: number = 5,
  minSimilarity: number = 0.7
): Promise<Array<{ content: string; similarity: number; documentId: string }>> {
  // Embed the query
  const embeddingResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  const queryEmbedding = embeddingResponse.data[0].embedding

  // Vector search with metadata filter (hybrid: filter then similarity)
  const result = await pool.query(`
    SELECT
      content,
      document_id,
      1 - (embedding <=> $1::vector) AS similarity
    FROM document_chunks
    WHERE tenant_id = $2
      AND collection = $3
      AND 1 - (embedding <=> $1::vector) > $4
    ORDER BY embedding <=> $1::vector
    LIMIT $5
  `, [JSON.stringify(queryEmbedding), tenantId, collection, minSimilarity, topK])

  return result.rows.map(row => ({
    content: row.content,
    similarity: parseFloat(row.similarity),
    documentId: row.document_id,
  }))
}
```

**pgvector vs dedicated vector DB tradeoffs:**

| Aspect | pgvector | Pinecone / Qdrant |
|--------|---------|-------------------|
| **Operational complexity** | Low (existing Postgres) | Medium (new service) |
| **Scalability** | ~10M vectors | 1B+ vectors |
| **Query speed at scale** | Slower | Faster |
| **Hybrid filter + vector** | Excellent | Good |
| **Cost** | Existing DB cost | Separate per-vector cost |
| **Transactions with metadata** | Yes (same DB) | No (separate stores) |
| **Start with** | Yes | When > 10M chunks or latency critical |

### Elasticsearch — Keyword and Hybrid Search

Elasticsearch (or OpenSearch) excels at:
- Full-text search with BM25 relevance
- Faceted filtering (filter by date, author, category)
- Aggregations (how many documents per department?)
- Exact term matching (legal citations, product codes, serial numbers)

```typescript
// run: npx tsx elasticsearch_search.ts
// pip install elasticsearch; npm: @elastic/elasticsearch

import { Client } from '@elastic/elasticsearch'

const es = new Client({ node: process.env.ELASTICSEARCH_URL })

// Index a document
await es.index({
  index: 'documents',
  document: {
    title: 'Q3 2024 Revenue Report',
    content: 'Total revenue increased by 23% year-over-year...',
    department: 'finance',
    date: '2024-10-15',
    tags: ['revenue', 'quarterly', 'finance'],
    tenant_id: 'acme_corp',
  }
})

// BM25 full-text search
const keywordResult = await es.search({
  index: 'documents',
  query: {
    bool: {
      must: [
        { match: { content: { query: 'revenue quarterly report' } } }
      ],
      filter: [
        { term: { tenant_id: 'acme_corp' } },
        { term: { department: 'finance' } },
        { range: { date: { gte: '2024-01-01' } } }
      ]
    }
  },
  size: 10,
})

// Hybrid search: combine BM25 + vector similarity (Elasticsearch 8.x kNN)
const hybridResult = await es.search({
  index: 'documents',
  knn: {
    field: 'embedding',              // requires dense_vector field type
    query_vector: [/* embedding array */],
    k: 10,
    num_candidates: 100,
    filter: [{ term: { tenant_id: 'acme_corp' } }]
  },
  query: {
    match: { content: 'quarterly revenue' }
  },
  size: 10,
})
```

**When to use Elasticsearch over vector DB:**
- Legal: exact citation matching + semantic understanding
- E-commerce: product search with filters (price, brand, category) + semantic
- Log analysis: searching structured + unstructured log data at scale
- Documents with rich metadata that you want to facet on

### Graph Databases — Relationships and Knowledge Graphs

Graph databases excel at multi-hop relationship queries that are expensive in SQL:

```
SQL for "friends of friends who bought product X":
SELECT DISTINCT u.* FROM users u
JOIN friendships f1 ON u.id = f1.friend_id
JOIN friendships f2 ON f1.user_id = f2.friend_id
JOIN purchases p ON u.id = p.user_id
WHERE f2.friend_id = $current_user AND p.product_id = $product_id
-- Gets exponentially complex with more hops

Cypher (Neo4j) equivalent:
MATCH (me:User {id: $current_user})-[:FRIEND*2..2]-(other:User)-[:BOUGHT]->(p:Product {id: $product_id})
RETURN DISTINCT other
```

**GraphRAG** uses a knowledge graph as the retrieval layer for a RAG system:

```
User Query → Extract entities (NER) → Find entities in graph
          → Traverse graph (multi-hop) → Retrieve subgraph
          → Serialize subgraph to text → LLM generates answer
```

```python
# run: python graphrag_example.py
# pip install neo4j

from neo4j import GraphDatabase

driver = GraphDatabase.driver("bolt://localhost:7687", auth=("neo4j", "password"))

def get_related_context(entity: str, hops: int = 2) -> list[dict]:
    """Get all facts within N hops of an entity in the knowledge graph"""
    with driver.session() as session:
        result = session.run("""
            MATCH path = (start {name: $entity})-[*1..$hops]-(related)
            RETURN DISTINCT related.name AS entity,
                   related.description AS description,
                   labels(related) AS types,
                   length(path) AS distance
            ORDER BY distance
            LIMIT 50
        """, entity=entity, hops=hops)
        return [dict(record) for record in result]

# Example: energy trading knowledge graph
# Oil Price -[CORRELATED_WITH]-> USD/EUR Rate
# Brent Crude -[IS_DERIVATIVE_OF]-> Crude Oil
# Crude Oil -[TRADED_ON]-> ICE Exchange
# ICE Exchange -[REGULATED_BY]-> FCA

context = get_related_context("Brent Crude", hops=2)
for item in context:
    print(f"  [{item['types']}] {item['entity']}: {item['description']} (hops: {item['distance']})")
```

**When to use graph databases:**
- Knowledge graphs (entities + relationships)
- Recommendation systems (collaborative filtering, user-item graphs)
- Fraud detection (transaction relationship networks)
- Supply chain (multi-hop dependency tracking)
- GraphRAG (reasoning about connected knowledge)

### Data Lakehouse — The Analytics Foundation

A data lakehouse combines the scale of a data lake with the structure of a data warehouse:

```
Raw Sources → Data Lake (Azure Data Lake / S3) → Delta Lake / Iceberg format
           → Serving Layer (Databricks / Synapse) → Analytics + ML Training
```

```python
# run: python lakehouse_example.py
# pip install delta-spark pyspark

# In Databricks / Azure Synapse:
from pyspark.sql import SparkSession
from delta import DeltaTable

spark = SparkSession.builder \
    .appName("AI Data Pipeline") \
    .config("spark.sql.extensions", "io.delta.sql.DeltaSparkSessionExtension") \
    .getOrCreate()

# Write AI traces to Delta Lake (time-travel, ACID, schema evolution)
traces_df = spark.createDataFrame([
    ("trace_001", "user_123", "gpt-4o", 1500, 300, 0.0225),
    ("trace_002", "user_456", "gpt-4o-mini", 800, 200, 0.00022),
], ["trace_id", "user_id", "model", "input_tokens", "output_tokens", "cost_usd"])

traces_df.write.format("delta").mode("append").save("/data/ai_traces")

# Query with SQL
spark.sql("SELECT model, SUM(cost_usd) FROM delta.`/data/ai_traces` GROUP BY model").show()

# Time travel: query data as of 7 days ago
spark.read.format("delta") \
    .option("timestampAsOf", "2024-01-01") \
    .load("/data/ai_traces") \
    .show()
```

**Lakehouse role in AI:**
- Storing all AI traces for compliance and analysis
- Training data for fine-tuning models
- Feature store for ML pipelines
- Historical analysis: cost trends, model performance over time

### Storage Selection Decision Tree

```
New piece of data for AI system:
├── Is it transactional? (user accounts, billing, permissions)
│   └── → PostgreSQL
│
├── Is it for semantic search? (documents, knowledge base)
│   ├── < 5M chunks and existing PostgreSQL?
│   │   └── → pgvector
│   └── > 5M chunks or need vector-native features?
│       └── → Pinecone / Qdrant / Weaviate
│
├── Is it for keyword/hybrid search? (logs, product search, faceted)
│   └── → Elasticsearch / OpenSearch
│
├── Is it relationship data? (knowledge graph, network analysis)
│   └── → Neo4j / Azure Cosmos DB (Graph API)
│
└── Is it for analytics / ML training? (bulk historical, scale)
    └── → Delta Lake / Databricks Lakehouse
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Vector DB cold start on first query:** A new tenant uploads 500 documents and immediately makes a search. The pgvector IVFFlat index hasn't been rebuilt yet — it falls back to sequential scan. First few queries are 100× slower than expected (10ms vs 1000ms). Fix: rebuild the index after ingestion completes (`REINDEX CONCURRENT INDEX`); set minimum chunk count before activating fast path; use HNSW index (no build phase required, but more memory).

**Elasticsearch mapping explosion:** An AI system indexes documents with a JSONB `metadata` field that contains arbitrary keys (one document has "invoice_number", another has "serial_number", etc.). Elasticsearch dynamically maps each new field, creating thousands of mappings. Query performance degrades; Elasticsearch hits mapping limit (1000 fields) and rejects new documents. Fix: use a fixed schema with a `metadata.value` nested structure, or use `flattened` field type to prevent dynamic mapping expansion.

**Graph database N+1 in knowledge retrieval:** A GraphRAG system fetches entity data by running one Cypher query per entity extracted from the query. A query mentioning 10 entities triggers 10 separate graph queries. Latency: 10 × 50ms = 500ms just for graph traversal. Fix: single parameterized Cypher query for all entities (`WHERE entity.name IN $entity_list`); batch all entity lookups; cache hot graph neighborhoods in Redis.

**Lakehouse latency for real-time queries:** An AI system query routes to a Delta Lake table for "recent customer interactions". Delta Lake is optimized for batch analytics — query latency is 500ms-2s. The AI context window construction is now on the critical path taking 2+ seconds. Fix: Delta Lake is for analytics, not real-time serving. Mirror recent data to PostgreSQL or Redis for the serving path; use the lakehouse only for historical analysis and model training.
:::

## 🎯 Checkpoint

::: details Question 1 — Vector DB vs Elasticsearch
**Q:** A legal AI system needs to search case law for clauses with "indemnification for gross negligence". Both embedding similarity and keyword matching are important. How do you architect the search?

**A:** Use hybrid search combining both. (1) **BM25 keyword leg** (Elasticsearch or pgvector tsvector): searches for exact legal terms "indemnification", "gross negligence" — legal writing uses precise terminology and exact term matching is essential for legal accuracy. (2) **Dense vector leg** (embedding): captures semantic paraphrases — "hold harmless for serious misconduct" would be missed by keyword search but captured by embedding similarity. (3) **Reciprocal Rank Fusion (RRF)**: merge and re-rank results from both legs. RRF formula: score = Σ 1/(k + rank_i) where k=60 (constant). This gives a combined ranking that uses both signals without tuning a linear combination weight. (4) Post-retrieval: NER to identify party names, dates, jurisdiction; use these as hard filters (filter before vector search for efficiency). Store both BM25 index and vector embeddings for each clause chunk.
:::

::: details Question 2 — Knowledge Graph vs RAG
**Q:** When should you use GraphRAG over standard vector RAG? What types of questions does each answer better?

**A:** **Standard RAG** excels at: "What does document X say about Y?" — it retrieves semantically similar text and synthesizes. Questions answered by individual documents or closely related chunks. **GraphRAG** excels at: multi-hop relationship questions that require connecting information across many documents. Examples: "What are all the counterparties that have traded with entities sanctioned by OFAC, and what is their total exposure?" (financial compliance) — requires traversing a relationship graph; no single document answers this. "Which drug compounds have the same metabolic pathway as compound X and what side effects do they share?" (pharmaceutical). **Rule of thumb**: if the question requires "find A, then find all things related to A, then find all things related to those..." — that's a graph traversal and GraphRAG will outperform. If the question is "tell me about X" — standard RAG is simpler and sufficient. The cost of GraphRAG: building and maintaining the knowledge graph (entity extraction, relationship extraction, deduplication) is significant engineering work.
:::

## Key Mental Models

- **PostgreSQL for structure, Vector DB for semantics, Elasticsearch for keywords, Graph for relationships** — choose by query type, not by what's trendy.
- **pgvector is the right starting point** — avoid the operational complexity of a separate vector DB until you hit scale limits (~5M chunks).
- **Hybrid search = keyword + semantic** — neither alone is sufficient for production search quality.
- **Lakehouse is for analytics and training, not serving** — never put a lakehouse query on the critical path of a real-time AI response.
- **GraphRAG trades engineering complexity for multi-hop reasoning** — only worth it for genuinely relational knowledge domains.

## Related

- [8.1 AI System Patterns](./01-ai-system-patterns) — what queries these databases serve
- [RAG Module 8 — Vector Databases](/rag/module-08/) — vector database internals
- [RAG Module 9 — Hybrid Search](/rag/module-09/02-hybrid-search) — hybrid search implementation
- [Module 12.3 LLM + Quant](/ai-engineering/module-12/03-llm-plus-quant) — knowledge graph usage in energy trading AI
