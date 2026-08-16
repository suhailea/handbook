---
title: Caching & Freshness
outline: deep
---

# Caching & Freshness

Interview weight: 🔥🔥🔥 | Prerequisites: [Embeddings](/rag/module-07/), [Retrieval](/rag/module-09/), [Ingestion pipeline](/rag/module-03/)

## 🗣️ In Plain English

::: tip In Plain English
A RAG system has three expensive operations -- embedding the question, searching for answers, and asking the LLM -- and caching lets you skip ones you have already done. Think of it like a librarian who remembers: "Someone asked this exact question yesterday, here are the same books I pulled." But the danger is serving yesterday's answer when the books have been updated overnight. Freshness is knowing when to throw away the librarian's memory and look again.
:::

## ⚙️ Under the Hood

### Three Caching Layers

A production RAG pipeline has three distinct points where caching provides value, each with different key strategies, TTLs, and invalidation requirements.

```text
Query → [Embedding Cache] → [Retrieval Cache] → [LLM Response Cache] → Answer
         exact-match           exact-match          semantic-match
         TTL: long             TTL: short           TTL: medium
```

### Layer 1: Embedding Cache

Cache the embedding vector for a query string. The same query text always produces the same embedding (deterministic for a given model), so this is a safe exact-match cache.

```typescript
// run: npx ts-node embedding-cache.ts
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';

const redis = new Redis();

interface EmbeddingCacheConfig {
  prefix: string;
  ttlSeconds: number;
  modelId: string; // include model in key -- different models produce different embeddings
}

function buildEmbeddingCacheKey(
  text: string,
  config: EmbeddingCacheConfig
): string {
  // Hash the text to keep keys manageable length
  const textHash = createHash('sha256').update(text).digest('hex');
  return `${config.prefix}:${config.modelId}:${textHash}`;
}

async function getOrComputeEmbedding(
  text: string,
  config: EmbeddingCacheConfig,
  computeFn: (text: string) => Promise<number[]>
): Promise<{ embedding: number[]; cached: boolean }> {
  const key = buildEmbeddingCacheKey(text, config);

  // Check cache
  const cached = await redis.getBuffer(key);
  if (cached) {
    // Store embeddings as binary Float32Array -- 4x smaller than JSON
    const embedding = Array.from(new Float32Array(
      cached.buffer, cached.byteOffset, cached.byteLength / 4
    ));
    return { embedding, cached: true };
  }

  // Compute and cache
  const embedding = await computeFn(text);
  const buffer = Buffer.from(new Float32Array(embedding).buffer);
  await redis.setex(key, config.ttlSeconds, buffer);

  return { embedding, cached: false };
}

// Usage
const config: EmbeddingCacheConfig = {
  prefix: 'emb',
  ttlSeconds: 86400 * 7, // 7 days -- embeddings don't change for same model
  modelId: 'text-embedding-3-small',
};
```

**Key design decisions:**
- Include the model ID in the cache key. If you upgrade `text-embedding-3-small` to `text-embedding-3-large`, cached embeddings from the old model are useless (different dimensionality).
- Store embeddings as binary `Float32Array`, not JSON. A 1536-dim embedding is ~6KB as binary vs ~25KB as JSON.
- TTL can be long (days to weeks) because the same text with the same model always produces the same embedding.

### Layer 2: Retrieval Cache

Cache the list of retrieved chunk IDs and scores for a given query. This avoids the vector search and keyword search operations.

```typescript
// run: npx ts-node retrieval-cache.ts
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';

const redis = new Redis();

interface RetrievalResult {
  chunkId: string;
  score: number;
  text: string;
  metadata: Record<string, unknown>;
}

interface RetrievalCacheConfig {
  prefix: string;
  ttlSeconds: number;
  tenantId: string;  // CRITICAL: tenant isolation
  indexVersion: string; // invalidate when index changes
}

function buildRetrievalCacheKey(
  query: string,
  config: RetrievalCacheConfig,
  filters: Record<string, unknown>
): string {
  // Include filters in the key -- same query with different filters = different results
  const payload = JSON.stringify({ query, filters });
  const hash = createHash('sha256').update(payload).digest('hex');
  return `ret:${config.tenantId}:${config.indexVersion}:${hash}`;
}

async function getCachedRetrieval(
  query: string,
  config: RetrievalCacheConfig,
  filters: Record<string, unknown>
): Promise<RetrievalResult[] | null> {
  const key = buildRetrievalCacheKey(query, config, filters);
  const cached = await redis.get(key);
  if (!cached) return null;
  return JSON.parse(cached) as RetrievalResult[];
}

async function cacheRetrieval(
  query: string,
  config: RetrievalCacheConfig,
  filters: Record<string, unknown>,
  results: RetrievalResult[]
): Promise<void> {
  const key = buildRetrievalCacheKey(query, config, filters);
  // Short TTL -- documents change more often than embedding models
  await redis.setex(key, config.ttlSeconds, JSON.stringify(results));
}

// Short TTL because index content changes
const config: RetrievalCacheConfig = {
  prefix: 'ret',
  ttlSeconds: 300, // 5 minutes
  tenantId: 'tenant-abc',
  indexVersion: 'v3', // bump on re-index
};
```

**Why short TTL:** the retrieval cache depends on the vector index content. When documents are added, updated, or deleted, the same query might return different chunks. A 5-minute TTL is a reasonable balance between cost savings and freshness for most applications.

### Layer 3: LLM Response Cache (Semantic Cache)

This is the most impactful cache -- it skips the entire LLM call. But it is also the most dangerous because you need to match *semantically similar* queries, not just exact matches.

```typescript
// run: npx ts-node semantic-cache.ts
import { createHash } from 'node:crypto';
import { Redis } from 'ioredis';

const redis = new Redis();

interface SemanticCacheEntry {
  query: string;
  queryEmbedding: number[];
  response: string;
  sources: string[];
  createdAt: number;
  tenantId: string;
}

// Approach 1: Exact-match response cache (safe, simple)
async function exactMatchLLMCache(
  query: string,
  contextChunkIds: string[], // include context in key -- same query, different context = different answer
  tenantId: string
): Promise<string | null> {
  const payload = JSON.stringify({
    query: query.toLowerCase().trim(),
    chunks: contextChunkIds.sort(), // sort for deterministic key
    tenant: tenantId,
  });
  const hash = createHash('sha256').update(payload).digest('hex');
  const key = `llm:exact:${hash}`;
  return redis.get(key);
}

// Approach 2: Semantic cache using embedding similarity
// Store response embeddings in a separate vector index
// On query, embed the query, search the cache index
// If similarity > threshold, return cached response
async function semanticCacheLookup(
  queryEmbedding: number[],
  tenantId: string,
  similarityThreshold: number = 0.95 // high threshold -- don't serve wrong answers
): Promise<SemanticCacheEntry | null> {
  // Pseudocode -- uses your vector DB
  // const results = await vectorDB.search({
  //   collection: 'semantic_cache',
  //   vector: queryEmbedding,
  //   filter: { tenantId },
  //   topK: 1,
  // });
  // if (results[0]?.score >= similarityThreshold) {
  //   return results[0].metadata as SemanticCacheEntry;
  // }
  // return null;

  // In practice, the threshold must be tuned per use case.
  // 0.95 is conservative. 0.90 might serve wrong answers.
  return null;
}
```

**Semantic cache risks:**
- **Threshold too low**: "What is the refund policy?" matches "What is the return policy?" -- these might have different answers.
- **Cross-tenant leakage**: If you forget the tenant filter, user A sees user B's cached answer. This is a security incident.
- **Stale answers**: A cached answer about pricing from last week is wrong if prices changed.

### Cache Invalidation

When a source document changes, you must invalidate all caches that depend on it.

```typescript
// run: npx ts-node cache-invalidation.ts
import { Redis } from 'ioredis';

const redis = new Redis();

interface DocumentChangeEvent {
  documentId: string;
  tenantId: string;
  changeType: 'created' | 'updated' | 'deleted';
  timestamp: number;
}

async function handleDocumentChange(event: DocumentChangeEvent): Promise<void> {
  const { documentId, tenantId, changeType } = event;

  // Strategy 1: Targeted invalidation using reverse index
  // When caching retrieval results, also maintain a mapping:
  //   document -> [cache keys that included this document]
  const affectedKeys = await redis.smembers(
    `doc-cache-map:${tenantId}:${documentId}`
  );

  if (affectedKeys.length > 0) {
    // Delete all cache entries that used this document
    await redis.del(...affectedKeys);
    // Clean up the reverse index
    await redis.del(`doc-cache-map:${tenantId}:${documentId}`);
  }

  // Strategy 2: Tenant-wide version bump (simpler but coarser)
  // Increment the tenant's index version -- all existing cache keys
  // include the old version and will naturally miss
  await redis.incr(`index-version:${tenantId}`);

  // Strategy 3: For semantic cache, delete entries whose sources
  // include the changed document
  // This requires the semantic cache to store source document IDs
  // in metadata, and supports filtered deletion

  console.log(
    `Invalidated ${affectedKeys.length} cache entries for ` +
    `document ${documentId} (${changeType})`
  );
}

// When caching a retrieval result, register in reverse index
async function cacheWithReverseIndex(
  cacheKey: string,
  tenantId: string,
  result: { chunkId: string; documentId: string }[],
  ttlSeconds: number
): Promise<void> {
  const pipeline = redis.pipeline();

  // Cache the result
  pipeline.setex(cacheKey, ttlSeconds, JSON.stringify(result));

  // Register this cache key under each document it references
  for (const chunk of result) {
    const docKey = `doc-cache-map:${tenantId}:${chunk.documentId}`;
    pipeline.sadd(docKey, cacheKey);
    pipeline.expire(docKey, ttlSeconds); // expire with the cache entry
  }

  await pipeline.exec();
}
```

### Freshness: Data That Should NOT Be in RAG

Not all data belongs in a retrieval system. Some data changes too fast for any caching or indexing strategy to keep up.

| Data Type | Update Frequency | RAG Suitable? | Alternative |
|-----------|-----------------|:---:|-------------|
| Company policies | Monthly | Yes | Standard RAG with event-driven re-index |
| Product documentation | Weekly | Yes | Incremental indexing on change |
| Pricing | Daily | Maybe | RAG for structure, live API for values |
| Inventory / stock levels | Minutes | No | Live database query via tool call |
| Flight status | Seconds | No | Real-time API via tool call |
| Transaction history | Real-time | No | Database query via tool call |
| User session state | Real-time | No | Session store, not RAG |

**The right pattern for fast-changing data:** Use the LLM as a reasoning engine with tool calling. The LLM decides it needs current inventory, calls a `getInventory(sku)` tool that hits the live database, and incorporates the real-time result into its response. RAG provides the product description; the tool provides the current stock count.

### Incremental Indexing and Document Versioning

```typescript
// run: npx ts-node incremental-indexing.ts
import { createHash } from 'node:crypto';

interface DocumentVersion {
  documentId: string;
  contentHash: string; // SHA-256 of document content
  version: number;
  indexedAt: number;
  embeddingModel: string;
  chunkingStrategy: string;
}

function computeContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

async function shouldReindex(
  documentId: string,
  newContent: string,
  currentVersion: DocumentVersion | null
): Promise<{ reindex: boolean; reason: string }> {
  const newHash = computeContentHash(newContent);

  if (!currentVersion) {
    return { reindex: true, reason: 'new document' };
  }

  if (currentVersion.contentHash !== newHash) {
    return { reindex: true, reason: 'content changed' };
  }

  // Content unchanged, but embedding model might have changed
  if (currentVersion.embeddingModel !== 'text-embedding-3-small') {
    return { reindex: true, reason: 'embedding model upgraded' };
  }

  // Content unchanged, but chunking strategy might have changed
  if (currentVersion.chunkingStrategy !== 'semantic-v2') {
    return { reindex: true, reason: 'chunking strategy changed' };
  }

  return { reindex: false, reason: 'up to date' };
}

// Delete event propagation
async function handleDocumentDeletion(
  documentId: string,
  tenantId: string
): Promise<void> {
  // 1. Delete chunks from vector DB
  // await vectorDB.deleteByFilter({ documentId, tenantId });

  // 2. Delete from keyword index
  // await elasticClient.deleteByQuery({ query: { term: { documentId } } });

  // 3. Invalidate caches (as shown above)
  // await handleDocumentChange({ documentId, tenantId, changeType: 'deleted', timestamp: Date.now() });

  // 4. Delete document version record
  // await db.documentVersions.delete({ documentId });

  // 5. Log for audit trail
  console.log(`Deleted all artifacts for document ${documentId}`);
}
```

### Re-indexing Strategies

| Strategy | When to Use | Tradeoff |
|----------|-------------|----------|
| **Event-driven incremental** | Document CRUD events trigger re-indexing of affected docs only | Fast, but complex to build and test |
| **Scheduled full re-index** | Nightly rebuild of entire index | Simple, but stale during the day and expensive |
| **Dual-write** | Write to both old and new index during migration | No downtime, but double the write cost |
| **Content-hash diffing** | Compare content hashes to find changed docs, re-index only those | Efficient for batch updates, requires version tracking |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Cross-tenant cache poisoning.** A retrieval cache key is built without including the tenant ID. Tenant A asks "What is the refund policy?" and the response is cached. Tenant B asks the same question and gets Tenant A's answer -- which references Tenant A's specific refund terms. This is a data leak. Every cache key must include the tenant identifier, and semantic cache lookups must filter by tenant.

**Stale semantic cache serves outdated answers.** The company changed its pricing last Tuesday. The semantic cache has a 24-hour TTL, so queries about pricing return the old prices for up to a day. But the semantic cache uses embedding similarity, and "How much does the Pro plan cost?" matches the cached "What's the price of Pro?" at 0.97 similarity. The cached answer confidently states the old price. Fix: invalidate semantic cache entries when their source documents change, not just on TTL expiry.

**Embedding cache survives model migration.** You upgrade from `text-embedding-ada-002` to `text-embedding-3-small`. The embedding cache still has ada-002 vectors. Queries hit the cache and return 1536-dim vectors, but the vector index now contains 1536-dim vectors from a different model. The cosine similarity is meaningless -- you are comparing vectors from two different embedding spaces. Fix: include the model ID in every cache key.

**RAG answers with stale data that a live API would have gotten right.** A user asks "Is item X in stock?" The RAG system retrieves a product catalog page indexed yesterday that says "In Stock." The item sold out this morning. The answer is wrong. This data type should never be in RAG -- it should be a tool call to the inventory database.

:::

## 🎯 Checkpoint

::: details Question 1 -- Cache key design
**Q:** You are designing a retrieval cache for a multi-tenant RAG system. What fields must be included in the cache key, and why?

**A:** The cache key must include: (1) **tenant ID** -- to prevent cross-tenant data leakage, (2) **the query text** (or its hash) -- to match the input, (3) **any retrieval filters** (document type, date range, tags) -- because the same query with different filters returns different results, and (4) **the index version** -- so that cache entries are automatically invalidated when the index is re-built. Optionally include the embedding model ID if the retrieval path depends on it. Missing any of these leads to cache poisoning (wrong tenant), stale results (wrong version), or incorrect results (wrong filters).
:::

::: details Question 2 -- What should not be in RAG?
**Q:** A RAG system for a travel company answers questions about flight status, baggage policies, and destination guides. Which of these should use RAG retrieval, and which should use a different mechanism? Why?

**A:** **Destination guides** are ideal for RAG -- they change infrequently and benefit from semantic search. **Baggage policies** are good for RAG with event-driven re-indexing when policies update. **Flight status** should absolutely not use RAG. Flight status changes every few minutes (delays, gate changes, cancellations). Even with a 5-minute cache TTL, the answer could be dangerously wrong. Flight status should be handled by a tool call that queries the airline's real-time API. The LLM uses RAG to understand the question context and tool calling to fetch the live data.
:::

::: details Question 3 -- Semantic cache threshold
**Q:** You set a semantic cache similarity threshold of 0.88 and notice users occasionally receive incorrect cached answers. What is happening and how do you fix it?

**A:** At 0.88 similarity, queries that are semantically related but have different correct answers are matching. For example, "What is the cancellation policy for monthly plans?" (0.89 similarity) matches a cached answer for "What is the cancellation policy for annual plans?" -- but the policies are different. The fix is to raise the threshold (0.95+ is typical for production) and add additional filters. Beyond the threshold, include the query's key entities (plan type, product name) as structured metadata in the cache entry and require those to match exactly. The tradeoff is lower cache hit rate but higher correctness. In production, correctness wins.
:::

## Key Mental Models

- **Three layers, three TTLs.** Embedding cache is long-lived (model determines it), retrieval cache is short-lived (index content determines it), LLM response cache is medium but dangerous (answer correctness determines it).
- **Cache keys are security boundaries.** Missing a tenant ID in a cache key is a data leak, not a bug.
- **If it changes faster than your TTL, it does not belong in RAG.** Real-time data needs live API calls via tool use, not cached embeddings.
- **Invalidation is harder than caching.** Building the cache is easy. Knowing when to throw it away requires a reverse index from documents to cache entries.

## Related

- [Embeddings deep dive](/rag/module-07/) -- understanding what the embedding cache stores
- [Retrieval strategies](/rag/module-09/) -- the operations being cached in layer 2
- [Full system architecture](/rag/module-16/01-system-architecture.md) -- where caching fits in the overall system
- [Scaling & cost optimization](02-scaling-cost.md) -- caching as the primary cost reduction lever
