---
title: Semantic Caching — Caching by Meaning, Not by Text
outline: deep
---

# Semantic Caching — Caching by Meaning, Not by Text

🔥🔥🔥 Interview weight — appears in both LLMOps and system design rounds. Prerequisites: [KV Cache](./04-kv-cache), [Embeddings](/ai-engineering/module-00/03-embeddings).

## 🗣️ In Plain English

::: tip In Plain English
A library has a reference desk. Every day, hundreds of students walk up and ask questions. A smart librarian starts noticing patterns: ten different students asked "who wrote Romeo and Juliet?" in ten different ways — "who's the author of Romeo and Juliet?", "Shakespeare wrote Romeo and Juliet, right?", "which playwright wrote Romeo and Juliet?" — and she had to look up the same answer ten times.

A savvy librarian writes the answer on a card and keeps it on the desk. Next time a student asks anything *about who wrote Romeo and Juliet*, she checks her card instead of going to the shelves.

That's semantic caching. Traditional caching checks whether two questions are **word-for-word identical**. Semantic caching checks whether two questions **mean the same thing** — even if they're phrased completely differently. The "card" is stored by meaning, not by exact text.

For AI systems, this matters enormously. LLM calls are expensive — often 50–500ms and $0.001–$0.01 per query. If 30% of your users are essentially asking the same question in different words, you can serve them all from cache and save 30% of your LLM cost and latency with zero loss in answer quality.
:::

## ⚙️ Under the Hood

Semantic caching sits between your application and the LLM. Instead of forwarding every query to the model, it first checks whether a semantically similar query has already been answered.

### How it works mechanically

```
User query
    │
    ▼
Embed the query → [0.23, -0.81, 0.44, ...]
    │
    ▼
Search vector cache for similar embeddings
    │
    ├─ Similarity ≥ threshold? ──► Return cached answer
    │
    └─ Similarity < threshold? ──► Call LLM
                                        │
                                        ▼
                                   Store (embedding, answer) in cache
                                        │
                                        ▼
                                   Return answer to user
```

The cache stores pairs of `(embedding vector, LLM response)`. Lookup is a nearest-neighbour search — find the stored embedding closest to the query embedding, check if the similarity score passes a threshold, and if so, return the stored response.

### The similarity threshold — the critical tuning knob

The threshold controls the trade-off between cache hit rate and answer accuracy:

| Threshold | Behaviour |
|-----------|-----------|
| Too low (0.70) | High hit rate but wrong answers — "what is VaR?" matches "what is VAT?" |
| Too high (0.99) | Almost never hits — only exact rephrasing benefits |
| Sweet spot (0.90–0.95) | Catches genuine paraphrases, rejects semantically different questions |

The right value is domain-dependent. Financial queries require higher thresholds (0.93+) because "buy" and "sell" are similar words but opposite instructions. Customer support FAQ queries can use lower thresholds (0.88) safely.

### Implementation with Redis + pgvector

```typescript
// run: npx ts-node semantic-cache.ts
import OpenAI from 'openai'
import { createClient } from 'redis'

// Assumes Redis Stack (with vector search) or a separate vector DB
// Production: use Qdrant, Weaviate, or pgvector for scale

interface CacheEntry {
  queryEmbedding: number[]
  response: string
  model: string
  cachedAt: number
  ttlSeconds: number
}

class SemanticCache {
  private client: ReturnType<typeof createClient>
  private openai: OpenAI
  private threshold: number
  private ttlSeconds: number

  constructor(threshold = 0.92, ttlSeconds = 3600) {
    this.client = createClient({ url: process.env.REDIS_URL })
    this.openai = new OpenAI()
    this.threshold = threshold
    this.ttlSeconds = ttlSeconds
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    })
    return response.data[0].embedding
  }

  cosineSimilarity(a: number[], b: number[]): number {
    const dot = a.reduce((sum, ai, i) => sum + ai * b[i], 0)
    const magA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0))
    const magB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0))
    return dot / (magA * magB)
  }

  async get(query: string): Promise<string | null> {
    const queryEmbedding = await this.embed(query)

    // In production, this is a vector similarity search in your vector DB.
    // Here simplified as scanning stored embeddings.
    const keys = await this.client.keys('semantic-cache:*')

    let bestMatch: { similarity: number; response: string } | null = null

    for (const key of keys) {
      const raw = await this.client.get(key)
      if (!raw) continue
      const entry: CacheEntry = JSON.parse(raw)

      const similarity = this.cosineSimilarity(queryEmbedding, entry.queryEmbedding)
      if (similarity >= this.threshold) {
        if (!bestMatch || similarity > bestMatch.similarity) {
          bestMatch = { similarity, response: entry.response }
        }
      }
    }

    return bestMatch?.response ?? null
  }

  async set(query: string, response: string, model: string): Promise<void> {
    const queryEmbedding = await this.embed(query)
    const key = `semantic-cache:${crypto.randomUUID()}`
    const entry: CacheEntry = {
      queryEmbedding,
      response,
      model,
      cachedAt: Date.now(),
      ttlSeconds: this.ttlSeconds,
    }
    await this.client.setEx(key, this.ttlSeconds, JSON.stringify(entry))
  }
}
```

### Semantic caching vs prompt caching vs KV caching

These three are often confused. They solve different problems at different layers:

| | KV Cache | Prompt Caching | Semantic Cache |
|---|---|---|---|
| **Where** | Inside the GPU (inference server) | API provider level | Your application layer |
| **What it caches** | Intermediate tensor computations | Token prefixes (system prompts) | Full query → response pairs |
| **Trigger** | Automatic, by inference engine | Identical token sequence prefix | Semantically similar queries |
| **You control it?** | No (vLLM does it) | Partially (structure prompts for it) | Yes — you build it |
| **Saves** | Compute within one request | Re-processing repeated system prompts | Full LLM round-trip |
| **Cost reduction** | 10–50% per token | 50–90% for prefix tokens | 0–80% of total requests |

Use all three. They stack.

### TTL strategy — when to invalidate

Semantic cache entries go stale when the underlying facts change:

```typescript
// Domain-aware TTL strategy
function getTtl(queryType: string): number {
  const ttls: Record<string, number> = {
    'pricing':        300,    // 5 minutes — prices change fast
    'faq':            86400,  // 1 day — stable content
    'product-info':   3600,   // 1 hour
    'market-data':    60,     // 1 minute — volatile
    'documentation':  604800, // 1 week — very stable
  }
  return ttls[queryType] ?? 3600
}
```

For RAG systems: when you re-ingest documents, invalidate cache entries related to those documents. Tag entries with source document IDs and bulk-delete on re-ingestion.

### When semantic caching helps most

High-value scenarios:

- **Customer support bots** — "how do I reset my password?" has 50 phrasings, one answer
- **Internal knowledge assistants** — employees ask the same policy questions repeatedly
- **Product Q&A** — limited question space over a product catalogue
- **RAG systems** — retrieval + generation for the same document set repeatedly

Low-value / risky scenarios:

- **Personalized queries** — "what's my account balance?" must never be cached across users
- **Time-sensitive queries** — "what's the price of AAPL right now?" stales in seconds
- **Ambiguous short queries** — short queries embed poorly and produce false matches

Always scope the cache **per-user or per-tenant** for any query that touches user-specific data.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Cross-user data leakage from a global cache.** If you cache without a user/tenant scope, User A's answer to "what's my account status?" gets served to User B who asks "what's the state of my account?" — same embedding, different correct answers. Fatal in any multi-tenant system. Fix: always namespace cache keys by user ID or tenant ID for any query that could return personalized data. Only use a shared cache for genuinely public, identical-answer queries.

**Threshold set too low on a financial domain.** "buy 100 shares" and "sell 100 shares" are semantically close (same domain vocabulary, similar embedding). A threshold of 0.88 on a trading assistant can serve the wrong cached answer with high confidence. Symptom: users report the chatbot "getting confused about direction." Fix: set thresholds conservatively (0.95+) for high-stakes domains; add a post-cache sanity check that extracts key discriminating terms (buy/sell, long/short) and verifies they match before serving from cache.

**Cache poisoning from a bad LLM response.** If the LLM hallucinated on query N, that hallucination gets cached and served to all semantically similar queries until TTL. Symptom: the same wrong answer appears across many users' conversations. Fix: implement a quality gate before caching — either a confidence score check, a faithfulness check against retrieved documents, or a minimum human-approval threshold for sensitive domains.

**Embedding model mismatch after upgrade.** You upgrade from `text-embedding-ada-002` to `text-embedding-3-small`. Old cached embeddings are in a different vector space. All similarity checks return garbage, causing either no cache hits or false hits. Symptom: cache hit rate drops to zero or weird wrong answers appear after the upgrade. Fix: version your cache by embedding model; invalidate and rebuild when the model changes.

:::

## 🎯 Checkpoint

::: details Question 1 — Explain the three caching layers in an LLM system
**Q:** A senior engineer asks you to "add caching to reduce LLM costs." Describe the three distinct caching mechanisms available, where each operates, and which you'd implement first.

**A:** Three distinct layers:

1. **KV Cache (inference-server level)** — operated automatically by vLLM or llama.cpp inside the GPU. Stores intermediate attention key-value tensors so identical token prefixes don't re-compute. You get this for free if you're self-hosting; you can't directly control it. Impact: 10–50% compute reduction per request.

2. **Prompt Caching (API provider level)** — providers like Anthropic and OpenAI cache your system prompt tokens server-side if they're identical across requests. You enable it by structuring prompts so the stable prefix is as large as possible. Impact: 50–90% cost reduction on prefix tokens; ~3× cheaper for long system prompts.

3. **Semantic Cache (application level)** — your code, your vector DB. You embed incoming queries, do a similarity search, and serve cached LLM responses for semantically equivalent queries. Impact: 0–80% of full LLM round-trips eliminated, depending on query repetition rate.

Priority: start with prompt caching (zero infrastructure cost, immediate savings on system prompt tokens). Add semantic caching when you have evidence that >20% of queries are semantically repeated. KV cache is automatic if you're self-hosting.
:::

::: details Question 2 — How do you handle cache invalidation for a RAG-based semantic cache?
**Q:** Your semantic cache sits in front of a RAG system. The underlying document corpus gets updated weekly. How do you handle cache invalidation?

**A:** Tag every cache entry with the IDs of the source documents that contributed to the answer at cache-write time. When documents are updated or re-ingested, look up all cache entries tagged with those document IDs and delete them.

Implementation: store cache entries in the vector DB with a `source_doc_ids` metadata field. On re-ingestion of document D, run `DELETE FROM cache WHERE source_doc_ids CONTAINS D`. This is surgical — only stale entries are evicted, not the entire cache.

Additionally: apply a conservative TTL (e.g., 24h) as a backstop so even untracked changes expire. For high-frequency corpus updates, consider setting TTL equal to the re-ingestion interval so the cache auto-expires in sync with updates.
:::

## Key Mental Models

**Semantic caching saves full LLM round-trips; KV caching saves computation within a round-trip.** They operate at different levels and stack multiplicatively.

**The threshold is a precision/recall dial.** Too low and you serve wrong answers confidently. Too high and the cache never hits. Tune it per domain, not globally.

**Always scope by user/tenant for personalized data.** A global semantic cache across users is a data leakage vulnerability, not an optimization.

**Cache the answer, not just the query.** You need both the embedding (for lookup) and the full response (to return). The embedding alone is useless.

**Tag entries with data provenance.** Knowing which documents contributed to a cached answer is what makes invalidation surgical rather than a full cache flush.

## Related

- [KV Cache](./04-kv-cache) — the complementary caching layer inside the inference server
- [Embeddings](/ai-engineering/module-00/03-embeddings) — how queries become vectors for similarity search
- [RAG Caching](/rag/module-17/01-caching-freshness) — caching strategies in the RAG pipeline
- [Production Metrics](../module-09/02-production-metrics) — measuring cache hit rate and cost reduction
