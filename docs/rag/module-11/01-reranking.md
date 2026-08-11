---
title: Reranking
outline: deep
---

# Reranking

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [Retrieval Strategies](../module-09/01-retrieval-strategies.md), [Hybrid Search](../module-09/02-hybrid-search.md), [Embedding Models](../module-07/01-embeddings-similarity.md) | **Builds toward:** [Context Construction](02-context-construction.md), [Grounded Generation](../module-12/01-grounded-generation.md)

## 🗣️ In Plain English

::: tip In Plain English
First-stage retrieval is like a librarian quickly pulling 50 books off the shelf that look relevant. Reranking is a subject expert carefully reading each one and putting the 5 most useful on your desk. The librarian is fast but rough; the expert is slow but precise. You need both.
:::

## ⚙️ Under the Hood

### Why Reranking Exists

First-stage retrieval (bi-encoder) embeds query and documents **separately**, then compares them with a distance metric. This is fast (pre-compute all document embeddings, search with ANN) but approximate — the query and document never "see" each other during encoding.

Reranking (cross-encoder) processes the query and document **together** as a single input, allowing full cross-attention between query tokens and document tokens. This is much more accurate but slow — you cannot pre-compute anything, because the output depends on the specific query-document pair.

```
┌──────────────────────────────────────────────────┐
│           BI-ENCODER (First Stage)                │
│                                                    │
│  Query ──► Encoder ──► query_vec ─┐               │
│                                    ├─► cosine sim  │
│  Doc   ──► Encoder ──► doc_vec  ──┘               │
│                                                    │
│  ✅ Fast: doc vectors pre-computed                 │
│  ✅ Scalable: ANN search over millions             │
│  ❌ Approximate: no query-doc interaction          │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│           CROSS-ENCODER (Reranker)                │
│                                                    │
│  [CLS] query tokens [SEP] doc tokens [SEP]       │
│         │                                          │
│         ▼                                          │
│    Full Transformer (cross-attention)              │
│         │                                          │
│         ▼                                          │
│    Relevance Score (0.0 - 1.0)                    │
│                                                    │
│  ✅ Precise: full query-doc interaction            │
│  ❌ Slow: must run for every query-doc pair        │
│  ❌ Not scalable: can't pre-compute                │
└──────────────────────────────────────────────────┘
```

This is the two-stage retrieval pattern:

```
Query ──► Retrieve Top 50-100 (bi-encoder, fast)
              │
              ▼
         Rerank (cross-encoder, precise)
              │
              ▼
         Top 5 ──► LLM Generation
```

### Bi-Encoder vs Cross-Encoder: The Core Trade-off

| Property | Bi-Encoder | Cross-Encoder |
|----------|-----------|---------------|
| **Encoding** | Query and doc encoded separately | Query + doc encoded together |
| **Pre-computation** | Document embeddings computed once at index time | Nothing pre-computable |
| **Latency per pair** | ~1ms (just distance calculation) | ~10-50ms (full forward pass) |
| **Scaling** | Millions of docs via ANN | Only feasible for 50-200 candidates |
| **Accuracy** | Good (semantic similarity) | Better (full cross-attention) |
| **Training data** | Contrastive pairs | Binary relevance labels |
| **Use case** | First-stage retrieval (recall) | Second-stage reranking (precision) |

### Cross-Encoder Reranker Models

| Model | Provider | Latency (50 docs) | Quality | Notes |
|-------|----------|-------------------|---------|-------|
| Cohere Rerank v3 | Cohere API | ~200ms | Excellent | Hosted API, easy to integrate |
| Jina Reranker v2 | Jina API / self-hosted | ~150ms | Very good | Open weights available |
| BGE Reranker v2 (large) | BAAI / self-hosted | ~300ms | Very good | Open source, runs locally |
| cross-encoder/ms-marco-MiniLM | HuggingFace | ~100ms | Good | Lightweight, fast, good baseline |
| ColBERT v2 | Self-hosted | ~50ms | Good | Late interaction, faster than full cross-encoder |

### Using Cohere Rerank

```typescript
// run: npx tsx cohere-rerank.ts
// Requires: npm install cohere-ai

import { CohereClient } from 'cohere-ai';

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

interface RetrievedChunk {
  id: string;
  text: string;
  metadata: Record<string, unknown>;
}

async function rerankWithCohere(
  query: string,
  candidates: RetrievedChunk[],
  topK: number = 5
): Promise<RetrievedChunk[]> {
  const response = await cohere.v2.rerank({
    model: 'rerank-v3.5',
    query,
    documents: candidates.map(c => c.text),
    topN: topK,
    returnDocuments: false,
  });

  // Map reranked indices back to original chunks
  return response.results.map(result => ({
    ...candidates[result.index],
    relevanceScore: result.relevanceScore,
  }));
}

// Example usage
const query = "How does NestJS handle dependency injection?";

const candidates: RetrievedChunk[] = [
  { id: 'c1', text: 'NestJS uses decorators to mark injectable classes...', metadata: {} },
  { id: 'c2', text: 'Express middleware is a function that receives req, res, next...', metadata: {} },
  { id: 'c3', text: 'The IoC container resolves the dependency graph at module init...', metadata: {} },
  { id: 'c4', text: 'Angular was the inspiration for NestJS module system...', metadata: {} },
  { id: 'c5', text: 'reflect-metadata stores constructor parameter types...', metadata: {} },
  // ... imagine 50 candidates from retrieval
];

const reranked = await rerankWithCohere(query, candidates, 3);
console.log('Top 3 after reranking:');
for (const chunk of reranked) {
  console.log(`  ${chunk.id}: ${chunk.text.slice(0, 60)}...`);
}
// c3 and c5 likely rank highest — they directly address DI internals
```

### LLM Reranking

Use the LLM itself to score relevance. More expensive and slower than dedicated rerankers, but can leverage instruction-following for domain-specific relevance criteria.

**Approaches:**

1. **Pointwise scoring:** Score each document independently (0-10 relevance)
2. **Listwise ranking:** Give the LLM all candidates and ask it to sort by relevance
3. **Pairwise comparison:** Compare documents in pairs (expensive: O(n^2))

```typescript
// run: npx tsx llm-reranking.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

interface ScoredChunk {
  id: string;
  text: string;
  relevanceScore: number;
}

async function llmPointwiseRerank(
  query: string,
  candidates: Array<{ id: string; text: string }>,
  topK: number = 5
): Promise<ScoredChunk[]> {
  // Score each candidate independently — can be parallelized
  const scoringPromises = candidates.map(async (candidate) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You are a relevance scorer. Given a query and a document,
score how relevant the document is to answering the query.
Return JSON: { "score": <0-10>, "reasoning": "<one sentence>" }
Score 0 = completely irrelevant. Score 10 = directly answers the query.`,
        },
        {
          role: 'user',
          content: `Query: ${query}\n\nDocument: ${candidate.text}`,
        },
      ],
      max_tokens: 100,
    });

    const result = JSON.parse(response.choices[0].message.content!);
    return {
      id: candidate.id,
      text: candidate.text,
      relevanceScore: result.score as number,
    };
  });

  const scored = await Promise.all(scoringPromises);
  return scored
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, topK);
}
```

### Dedicated Reranker vs LLM Reranking

| Property | Dedicated Reranker (Cohere, BGE) | LLM Reranking (GPT-4o-mini) |
|----------|--------------------------------|----------------------------|
| **Latency (50 docs)** | 100-300ms (single API call) | 2-5s (50 parallel API calls) |
| **Cost (50 docs)** | $0.0002 | $0.005-0.01 |
| **Accuracy** | Trained specifically for relevance | Good, but not specialized |
| **Customization** | Limited (model is fixed) | High (custom scoring criteria via prompt) |
| **Domain adaptation** | Fine-tuning required | Prompt engineering sufficient |
| **Batch efficiency** | Scores all docs in one call | One call per document (or batched with limits) |
| **When to use** | Default choice for most systems | When you need domain-specific scoring criteria |

### Choosing Candidate Count and Final K

The two-stage pipeline has three numbers to tune:

```
Retrieve N candidates → Rerank → Return top K
```

| Parameter | Typical Range | Trade-off |
|-----------|---------------|-----------|
| **N (retrieve)** | 50-100 | Higher N = better recall, more reranking cost |
| **K (final)** | 3-10 | Higher K = more context for LLM, more tokens, higher cost |
| **Ratio N:K** | 10:1 to 20:1 | Standard: retrieve 10-20x what you need |

**Why these numbers:**
- **N = 50-100:** Retrieval recall@50 is typically 90-95% for a well-tuned system. Going beyond 100 rarely adds relevant documents but adds reranking cost.
- **K = 3-5 for factual queries:** The LLM needs few highly relevant chunks.
- **K = 5-10 for synthesis queries:** When the answer spans multiple sources.
- **N:K ratio of 10:1:** Below this, the reranker does not have enough candidates to differentiate. Above 20:1, the marginal benefit of additional candidates decreases.

### Latency Impact

Reranking adds 100-500ms to the pipeline:

| Component | Latency |
|-----------|---------|
| Embedding the query | 20-50ms |
| ANN vector search | 10-50ms |
| BM25 search | 10-30ms |
| **Reranking (50 docs, Cohere)** | **100-300ms** |
| **Reranking (50 docs, LLM)** | **2000-5000ms** |
| LLM generation | 500-3000ms |

**When reranking is worth the latency:**
- High-stakes answers (legal, medical, financial) where precision matters more than speed
- The first-stage retrieval returns noisy results (broad queries, large corpus)
- You can afford 200ms added latency (most users tolerate 1-3s total response time)

**When to skip reranking:**
- Latency budget is < 500ms total
- First-stage retrieval is already precise (small, curated corpus)
- Simple keyword/ID lookups where BM25 alone is sufficient

### Domain-Specific Reranking Strategies

| Domain | Strategy | Why |
|--------|----------|-----|
| **Customer support** | Rerank by relevance + recency bias | Recent policy updates should rank higher than outdated docs |
| **Legal** | Rerank by exact clause matching + jurisdiction | Clause 14.3(b) must rank above vaguely related clauses |
| **Enterprise (multi-tenant)** | ACL filter first → then rerank | Never rerank (and risk surfacing) documents the user cannot access |
| **E-commerce** | Rerank by relevance + product availability | Don't surface discontinued products |
| **Medical** | Rerank by evidence grade + relevance | Systematic reviews rank above case reports |

```typescript
// run: npx tsx domain-reranking.ts
// Example: customer support with recency boost

interface RankedChunk {
  id: string;
  text: string;
  relevanceScore: number;  // from reranker
  updatedAt: Date;
  metadata: Record<string, unknown>;
}

function applyRecencyBoost(
  chunks: RankedChunk[],
  recencyWeight: number = 0.2
): RankedChunk[] {
  const now = Date.now();
  const maxAge = 365 * 24 * 60 * 60 * 1000; // 1 year in ms

  return chunks
    .map(chunk => {
      const age = now - chunk.updatedAt.getTime();
      const recencyScore = Math.max(0, 1 - age / maxAge); // 1.0 for today, 0.0 for 1yr+

      const boostedScore =
        (1 - recencyWeight) * chunk.relevanceScore +
        recencyWeight * recencyScore;

      return { ...chunk, relevanceScore: boostedScore };
    })
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
}
```

### The Full Reranking Pipeline

```typescript
// run: npx tsx full-reranking-pipeline.ts
import { CohereClient } from 'cohere-ai';

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

interface Chunk {
  id: string;
  text: string;
  docId: string;
  updatedAt: Date;
  accessLevel: string[];
}

interface RerankConfig {
  candidateCount: number;    // N: how many to retrieve
  rerankTopN: number;        // reranker output size
  finalTopK: number;         // K: how many to send to LLM
  recencyWeight: number;     // 0.0-1.0
  userAccessLevel: string[];
}

async function rerankPipeline(
  query: string,
  candidates: Chunk[],
  config: RerankConfig
): Promise<Chunk[]> {
  // Step 1: ACL filtering (security — must happen before reranking)
  const accessible = candidates.filter(chunk =>
    chunk.accessLevel.some(level => config.userAccessLevel.includes(level))
  );

  if (accessible.length === 0) {
    return []; // No accessible documents
  }

  // Step 2: Cross-encoder reranking
  const rerankResponse = await cohere.v2.rerank({
    model: 'rerank-v3.5',
    query,
    documents: accessible.map(c => c.text),
    topN: config.rerankTopN,
    returnDocuments: false,
  });

  // Step 3: Map scores back and apply domain-specific boosts
  const reranked = rerankResponse.results.map(result => ({
    ...accessible[result.index],
    relevanceScore: result.relevanceScore,
  }));

  // Step 4: Recency boost (domain-specific)
  const now = Date.now();
  const maxAge = 365 * 24 * 60 * 60 * 1000;

  const boosted = reranked.map(chunk => {
    const age = now - chunk.updatedAt.getTime();
    const recency = Math.max(0, 1 - age / maxAge);
    const finalScore =
      (1 - config.recencyWeight) * chunk.relevanceScore +
      config.recencyWeight * recency;
    return { ...chunk, relevanceScore: finalScore };
  });

  // Step 5: Source diversity — don't return 5 chunks from the same document
  const diversified = diversifySources(boosted, config.finalTopK);

  return diversified;
}

function diversifySources(
  chunks: Array<Chunk & { relevanceScore: number }>,
  topK: number
): Array<Chunk & { relevanceScore: number }> {
  const result: Array<Chunk & { relevanceScore: number }> = [];
  const docCounts = new Map<string, number>();
  const maxPerDoc = Math.ceil(topK / 2); // at most half from one doc

  const sorted = chunks.sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const chunk of sorted) {
    if (result.length >= topK) break;
    const count = docCounts.get(chunk.docId) ?? 0;
    if (count < maxPerDoc) {
      result.push(chunk);
      docCounts.set(chunk.docId, count + 1);
    }
  }

  return result;
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Reranking surfaces documents the user should not see.** A team applies reranking before ACL filtering. The cross-encoder scores a confidential HR document as highly relevant, and it makes it into the final context. The LLM generates an answer citing confidential salary data. Fix: always filter by access control before reranking. Security filters are not optional post-processing — they are mandatory pre-processing.

**LLM reranking blows latency.** A team uses GPT-4o to score 100 candidates individually. Each scoring call takes 200ms, and even with parallelism, the reranking step takes 3-5 seconds. Users complain about slow responses. Fix: use a dedicated reranker (Cohere, BGE) for the standard case. Reserve LLM reranking for cases where you need custom scoring criteria that a standard reranker cannot express.

**Reranker and embedding model are trained on different data.** The bi-encoder was trained on general web data, the cross-encoder on MS-MARCO (question-answer pairs). A document scores high in retrieval but low in reranking (or vice versa) because the two models have different notions of "relevance." Fix: use models from the same family where possible, or fine-tune both on your domain data.

**Over-relying on reranking to fix bad retrieval.** A team retrieves 200 candidates with poor recall and hopes the reranker will find the relevant ones. But if the relevant document was never retrieved (not in the top 200), the reranker cannot rescue it. Reranking improves precision among retrieved candidates — it does not improve recall. Fix: fix retrieval first (hybrid search, better embeddings, query processing), then add reranking for precision.
:::

## 🎯 Checkpoint

::: details Question 1 — Bi-encoder vs cross-encoder
**Q:** Why can't you use a cross-encoder for first-stage retrieval over millions of documents? What architectural property makes it prohibitively expensive?

**A:** A cross-encoder processes the query and document together as a single input through the full transformer. This means you cannot pre-compute document representations — every query requires a fresh forward pass for every document. For 1M documents, that is 1M forward passes per query at ~10-50ms each, totaling ~3-14 hours per query. A bi-encoder, by contrast, embeds documents once at index time and only needs to embed the query at search time, then compute fast distance calculations. The architectural difference: bi-encoder produces independent representations (separable), cross-encoder produces a joint representation (inseparable). This is why two-stage retrieval exists — bi-encoder for recall over the full corpus, cross-encoder for precision over a small candidate set.
:::

::: details Question 2 — Candidate count tuning
**Q:** You are building a RAG system for a legal research tool. Currently you retrieve 20 candidates and rerank to top 5. Lawyers report that relevant cases are often missing from the results. What would you change and why?

**A:** Increase the candidate count (N) from 20 to 50-100. The symptom — relevant documents missing — indicates a recall problem at the retrieval stage. The reranker can only reorder what it receives; it cannot find documents that were never retrieved. With N=20, retrieval recall may only be 70-80%, meaning 20-30% of relevant documents never reach the reranker. With N=100, recall@100 is typically 90-95%+, giving the reranker a much better candidate pool. The trade-off: reranking 100 documents instead of 20 adds ~100-200ms latency (for a dedicated reranker), which is acceptable for legal research where accuracy matters more than sub-second response times. Additionally, consider hybrid search (BM25 catches exact case citations that dense search misses) and verify the embedding model is appropriate for legal text.
:::

::: details Question 3 — When to skip reranking
**Q:** In what scenarios would adding a reranker actually hurt your RAG system's performance?

**A:** (1) Latency-critical applications where the 100-300ms reranking overhead pushes total response time beyond user tolerance (e.g., autocomplete, real-time chat with <500ms budget). (2) Small, curated corpora where first-stage retrieval is already precise — the top 5 from a 500-document FAQ corpus are usually correct without reranking, and reranking might reorder them incorrectly if the reranker is not tuned for the domain. (3) Simple keyword/ID lookups where BM25 returns an exact match with high confidence — reranking a single exact-match result adds cost without benefit. (4) When the reranker is trained on a very different domain than your data — a reranker trained on web search queries may have poor calibration on internal enterprise documents, potentially demoting relevant results.
:::

## Key Mental Models

- **Two-stage retrieval is the production pattern.** Bi-encoder for recall (fast, over millions), cross-encoder for precision (slow, over dozens). Neither alone is sufficient.
- **Reranking improves precision, not recall.** If the relevant document is not in the candidate set, the reranker cannot find it. Fix retrieval first.
- **Dedicated rerankers beat LLM reranking** on cost and latency for standard relevance scoring. Use LLM reranking only when you need custom scoring criteria.
- **Security filtering must happen before reranking.** Never let a reranker surface documents the user should not access.
- **The N:K ratio matters.** Retrieve 10-20x what you need as candidates. Below 10x, the reranker lacks enough candidates to differentiate.

## Related

- [Retrieval Strategies](../module-09/01-retrieval-strategies.md) — first-stage retrieval that feeds the reranker
- [Hybrid Search & Fusion](../module-09/02-hybrid-search.md) — combining retrieval methods before reranking
- [Context Construction](02-context-construction.md) — what happens after reranking selects the final chunks
- [Embedding Models](../module-07/01-embeddings-similarity.md) — the bi-encoder architecture used in first-stage retrieval
