---
title: Chunk Size, Overlap & Evaluation
outline: deep
---

# Chunk Size, Overlap & Evaluation

**Interview weight:** 🔥🔥🔥 — interviewers test whether you understand the trade-offs or just memorized "use 500 tokens."

**Prerequisites:** [Chunking Strategies](01-chunking-strategies.md), [Embedding Models](/rag/module-07/01-embeddings-similarity.md)

## 🗣️ In Plain English

::: tip In Plain English
Chunk size is like choosing the size of sticky notes. Tiny notes hold one fact each — easy to find the exact note you need, but you might need five notes to get the full picture. Giant notes hold entire topics, but when you search for one fact, you get buried in irrelevant text. Overlap is the trick of letting each note repeat the last sentence of the previous one, so no idea gets cut in half.
:::

## ⚙️ Under the Hood

### Why "500 Tokens" Is Not a Rule

The commonly cited 500-token chunk size is a reasonable starting point for general prose with older 512-token embedding models. It is not a universal answer. The optimal chunk size depends on at least five interacting factors:

| Factor | How It Affects Chunk Size |
|--------|--------------------------|
| **Embedding model context** | Must stay under the model's max tokens. 512-token models demand small chunks; 8K-token models allow flexibility. |
| **Document type** | Technical docs with dense concepts → smaller. Narrative text with flowing arguments → larger. |
| **Query type** | Factual lookups ("what is X?") → smaller chunks for precision. Analytical questions ("compare X and Y") → larger chunks for context. |
| **Retrieval K** | Retrieving K=3 large chunks fills the LLM context differently than K=10 small chunks. |
| **LLM context window** | K chunks + system prompt + user query must fit. With 4K context, you have less room. With 128K, chunk size matters less. |

### The Size Spectrum

#### Small Chunks (200-300 tokens)

```
Pros:
  ✓ High retrieval precision — each chunk is tightly focused
  ✓ Less noise in retrieved context
  ✓ More chunks fit in LLM context (higher K)
  ✓ Better with rerankers (more candidates to rerank)

Cons:
  ✗ Loss of surrounding context — chunk may not make sense alone
  ✗ More vectors to store and search (cost + latency)
  ✗ Higher chance of splitting related information across chunks
  ✗ Anaphora problem: "it", "they", "the above" lose referents
```

**Best for:** FAQ systems, factual Q&A, sentence-level retrieval, parent-child child chunks.

#### Medium Chunks (400-600 tokens)

```
Pros:
  ✓ Balanced precision and recall
  ✓ Usually contains a complete paragraph or idea
  ✓ Manageable vector count

Cons:
  ✗ May include some irrelevant sentences alongside the target info
  ✗ No guarantee of self-contained meaning
```

**Best for:** General-purpose RAG, documentation, internal knowledge bases. The default when you have no data to guide the decision.

#### Large Chunks (800-1500 tokens)

```
Pros:
  ✓ High recall — more context captured per chunk
  ✓ Fewer chunks overall (less storage, faster search)
  ✓ Better for complex questions requiring multi-paragraph context

Cons:
  ✗ Dilutes relevance — irrelevant sentences drag down similarity
  ✗ Fewer chunks fit in LLM context at generation time
  ✗ Less benefit from reranking (fewer candidates)
  ✗ Higher token cost at generation time
```

**Best for:** Long-form analysis, legal/compliance review, documents where context is critical.

---

### Overlap: Preventing Information Loss at Boundaries

Overlap means each chunk repeats N tokens from the end of the previous chunk.

```
Chunk 1: [====================]
Chunk 2:              [====================]
                      ↑ overlap zone ↑
```

**Why overlap exists:** Without it, if an important concept spans a chunk boundary, it gets split between two chunks. Neither chunk contains the full concept. With overlap, the concept appears complete in at least one chunk.

#### Overlap sizing

| Overlap % | Tokens (for 500-token chunk) | Trade-off |
|-----------|------------------------------|-----------|
| 0% | 0 | No redundancy. Risk of boundary splits. |
| 10% | 50 | Minimal safety net. Good for well-structured documents. |
| 15-20% | 75-100 | **Standard recommendation.** Catches most boundary issues. |
| 30%+ | 150+ | Excessive redundancy. Duplicate information in search results. Storage bloat. |

**The math matters for storage:**
- 1,000 pages, avg 2,000 tokens/page, chunk size 500, overlap 100 → ~5,000 chunks
- Same with overlap 200 → ~6,667 chunks (33% more vectors!)
- At scale (millions of docs), overlap directly affects storage cost and query latency

**When to use zero overlap:**
- Structure-aware chunking (splitting on headers) — boundaries are already meaningful
- Parent-child chunking — context is recovered from the parent, not from overlap
- Semantic chunking — boundaries are at topic shifts, overlap would mix topics

---

### Chunk Size vs Embedding Model Max Tokens

This is a hard constraint, not a guideline.

| Model | Max Tokens | What Happens If You Exceed |
|-------|------------|---------------------------|
| OpenAI text-embedding-3-small | 8,191 | **Silent truncation.** Only the first 8,191 tokens are embedded. The rest is ignored. No error. |
| OpenAI text-embedding-ada-002 | 8,191 | Silent truncation |
| Cohere embed-v3 | 512 | Truncation (or error depending on API setting) |
| BGE-small-en | 512 | Truncation |
| Jina embeddings-v2 | 8,192 | Truncation |
| E5-large-v2 | 512 | Truncation |

**The danger of silent truncation:** If your chunk is 1,000 tokens and the model truncates at 512, the embedding represents only the first half. The second half is invisible to retrieval. You will never find information in the bottom half of oversized chunks. This is a silent, catastrophic failure — no error, no warning.

```typescript
// run: npx ts-node validate-chunk-size.ts
import { encoding_for_model } from 'tiktoken';

function validateChunkSize(
  chunk: string,
  maxModelTokens: number,
  modelName: string = 'text-embedding-3-small'
): { tokens: number; exceeds: boolean; truncatedAt: number | null } {
  const enc = encoding_for_model('gpt-4'); // tiktoken model for token counting
  const tokens = enc.encode(chunk).length;
  enc.free();

  return {
    tokens,
    exceeds: tokens > maxModelTokens,
    truncatedAt: tokens > maxModelTokens ? maxModelTokens : null,
  };
}
```

**Rule of thumb:** Set your chunk size to 80% of the embedding model's max tokens. This leaves room for contextual prepending (section titles, metadata) without hitting truncation.

---

### Chunk Size vs LLM Context Window

At generation time, the LLM must fit: system prompt + user query + K retrieved chunks + output tokens.

```
LLM context budget:
┌──────────────────────────────────────────────────────────────┐
│ System prompt (~200-500 tokens)                               │
│ User query (~50-200 tokens)                                   │
│ Retrieved chunks: K × chunk_size                              │
│ Output tokens (~500-2000 tokens)                              │
│ Safety margin (~200 tokens)                                   │
└──────────────────────────────────────────────────────────────┘

Example with GPT-4 (8K context):
  8,192 - 500 (system) - 100 (query) - 1,000 (output) - 200 (margin) = 6,392 tokens for chunks
  At chunk_size=500: can fit K=12 chunks
  At chunk_size=1000: can fit K=6 chunks
  At chunk_size=1500: can fit K=4 chunks

Example with GPT-4-turbo (128K context):
  128,000 - 500 - 100 - 2,000 - 200 = 125,200 tokens for chunks
  Context window is rarely the bottleneck. Quality and cost are.
```

**With large context windows, the constraint shifts from "how many chunks fit" to "how many chunks should I include before quality degrades."** Research shows that LLMs perform worse with too much context (the "lost in the middle" problem). Even with 128K tokens available, retrieving 50 large chunks is often worse than 5-10 highly relevant ones.

---

### Token Counting

You must count tokens using the right tokenizer for your embedding model. Characters and words are unreliable proxies.

```typescript
// run: npx ts-node token-count.ts
import { encoding_for_model, get_encoding } from 'tiktoken';

// For OpenAI models
const enc = encoding_for_model('gpt-4');
const text = 'The quick brown fox jumps over the lazy dog.';
const tokenCount = enc.encode(text).length;
console.log(`Tokens: ${tokenCount}`); // 10
enc.free();

// Approximation rules (English text):
// 1 token ≈ 4 characters
// 1 token ≈ 0.75 words
// 100 tokens ≈ 75 words

// WARNING: These approximations break for:
// - Code (more tokens per character due to syntax)
// - Non-English text (varies wildly by language)
// - Text with lots of numbers, URLs, special characters
```

**For non-OpenAI models:** Use the model's specific tokenizer. Hugging Face models use `AutoTokenizer`. Cohere has its own tokenizer. Using the wrong tokenizer gives wrong counts — and wrong counts lead to silent truncation.

---

### How to Evaluate Chunk Quality

Chunk size is an empirical decision. The only way to find the optimal size is to test multiple configurations against your actual queries and documents.

#### Step 1: Build a Test Set

```typescript
// Evaluation test set structure
interface ChunkEvalTestCase {
  query: string;
  // The chunk IDs that SHOULD be retrieved for this query
  relevantChunkIds: string[];
  // The expected answer (for end-to-end evaluation)
  expectedAnswer: string;
}

// You need 50-100 test cases minimum, covering:
// - Simple factual queries
// - Multi-hop questions (answer spans multiple chunks)
// - Queries about specific details (tests precision)
// - Broad analytical queries (tests recall)
```

#### Step 2: Test Multiple Configurations

```typescript
interface ChunkConfig {
  strategy: string;
  chunkSize: number;
  overlap: number;
}

const configs: ChunkConfig[] = [
  { strategy: 'recursive', chunkSize: 256, overlap: 25 },
  { strategy: 'recursive', chunkSize: 512, overlap: 50 },
  { strategy: 'recursive', chunkSize: 512, overlap: 100 },
  { strategy: 'recursive', chunkSize: 1024, overlap: 100 },
  { strategy: 'semantic', chunkSize: 0, overlap: 0 }, // size is dynamic
];
```

#### Step 3: Measure Retrieval Metrics

| Metric | What It Measures | Formula |
|--------|-----------------|---------|
| **Recall@K** | Of all relevant chunks, how many are in the top K results? | `(relevant ∩ retrieved) / relevant` |
| **Precision@K** | Of the top K results, how many are relevant? | `(relevant ∩ retrieved) / K` |
| **MRR** (Mean Reciprocal Rank) | How high does the first relevant chunk rank? | `1 / rank_of_first_relevant` |
| **NDCG@K** | Are relevant chunks ranked higher than irrelevant ones? | Normalized discounted cumulative gain |

```typescript
// run: npx ts-node eval-chunks.ts
function recallAtK(relevant: Set<string>, retrieved: string[], k: number): number {
  const topK = new Set(retrieved.slice(0, k));
  let hits = 0;
  for (const id of relevant) {
    if (topK.has(id)) hits++;
  }
  return relevant.size > 0 ? hits / relevant.size : 0;
}

function precisionAtK(relevant: Set<string>, retrieved: string[], k: number): number {
  const topK = retrieved.slice(0, k);
  let hits = 0;
  for (const id of topK) {
    if (relevant.has(id)) hits++;
  }
  return k > 0 ? hits / k : 0;
}

function mrr(relevant: Set<string>, retrieved: string[]): number {
  for (let i = 0; i < retrieved.length; i++) {
    if (relevant.has(retrieved[i])) return 1 / (i + 1);
  }
  return 0;
}
```

#### Step 4: Measure End-to-End Answer Quality

Retrieval metrics alone are not enough. Ultimately, you care about answer quality.

| Metric | How to Measure |
|--------|---------------|
| **Answer correctness** | LLM-as-judge: does the generated answer match the expected answer? |
| **Faithfulness** | Does the answer only use information from the retrieved chunks? (No hallucination) |
| **Relevance** | Are the retrieved chunks relevant to the query? |
| **Token cost** | Total tokens consumed (embedding + generation) per query |

**The evaluation loop:**
```
For each chunk config:
  1. Re-chunk all documents
  2. Re-embed all chunks
  3. Run all test queries
  4. Measure Recall@K, Precision@K, MRR
  5. Run generation with retrieved chunks
  6. Measure answer quality (LLM-as-judge)
  7. Measure cost (tokens, latency)
  → Pick the config with the best quality-cost trade-off
```

**This is expensive.** You are re-embedding your entire corpus for each configuration. For large corpora, test on a representative sample (1-5% of documents) first.

---

### Practical Sizing Recommendations

| Document Type | Recommended Size | Overlap | Strategy | Rationale |
|---------------|:---:|:---:|----------|-----------|
| FAQs, short-form | 200-300 tokens | 0-10% | Sentence / Paragraph | Each Q&A is self-contained |
| Technical documentation | 400-600 tokens | 15% | Recursive + structure-aware | Sections have natural boundaries |
| Legal contracts | 500-800 tokens | 20% | Structure-aware (clauses) | Clauses must not be split |
| Narrative/prose | 500-700 tokens | 15% | Recursive | Paragraphs carry coherent ideas |
| Code | Varies by function | 0% | AST-based | Functions are natural units |
| Tables | Full table or rows+headers | 0% | Table-aware | Structure must be preserved |
| Chat transcripts | 300-500 tokens | 10% | Turn-based | Each turn or exchange |
| Research papers | 500-800 tokens | 15% | Structure-aware (sections) | Sections = topics |

**Start with 500 tokens + 15% overlap + recursive splitting.** Measure. Adjust. There is no shortcut past evaluation.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Silent truncation from oversized chunks.**
You set chunk size to 1,000 tokens but your embedding model (e.g., an older 512-token model) silently truncates at 512. Half of every chunk is invisible to retrieval. Queries about information in the second half of chunks return zero results. No error in logs — the embedding API happily returns a vector. You only discover this weeks later when users complain about missing answers. **Fix:** Assert `chunk_token_count <= model_max_tokens` at ingestion time. Log and alert on any chunk that exceeds the limit.

**2. Overlap bloat in high-volume systems.**
With 10 million documents, 500-token chunks, and 20% overlap, you have roughly 30% more vectors than with zero overlap. At $0.02/GB/month for vector storage plus query latency impact, this adds up. Teams often set overlap without measuring whether it actually helps their retrieval metrics. **Fix:** A/B test with and without overlap on your actual queries. If recall barely changes, drop overlap and save the storage.

**3. Chunk size evaluated on the wrong queries.**
You optimized chunk size using 50 test queries written by engineers. In production, users ask completely different questions — longer, more ambiguous, multi-part. The "optimal" chunk size for your test set is wrong for real usage. **Fix:** Build your test set from actual user queries (anonymized). Log queries in production, sample them, and use them for evaluation. Update the test set quarterly.

**4. One size for all document types.**
You use 500-token chunks for everything — prose, code, tables, FAQs. Tables get destroyed, FAQs get merged together, code functions get split mid-logic. **Fix:** Route documents through type-specific chunking pipelines. Use document metadata (`document_type`) to select the appropriate strategy and size.

:::

## 🎯 Checkpoint

::: details Question 1 — Truncation Danger
**Q:** You are using `text-embedding-ada-002` (8,191 max tokens) and chunk size of 1,000 tokens. Is this safe? What if you switch to `BGE-small-en` (512 max tokens) without changing chunk size?

**A:** With ada-002 and 1,000-token chunks, you are well within the 8,191 limit — safe. Switching to BGE-small-en (512 max tokens) without reducing chunk size is a silent disaster. Every chunk above 512 tokens gets truncated. The embedding only represents the first 512 tokens; the rest is lost. Retrieval for information in the truncated portion will fail silently — the embedding API returns a valid vector, no error is raised. You must either reduce chunk size to ≤512 tokens or choose a different model. This is why `embedding_model` and `chunk_size` must be tracked together in metadata — they are coupled constraints.
:::

::: details Question 2 — Overlap Trade-off
**Q:** A colleague argues that 50% overlap gives the best retrieval quality because every piece of information appears in multiple chunks. What is wrong with this argument?

**A:** Three problems. First, storage and compute: 50% overlap nearly doubles the number of chunks and vectors, increasing storage cost, embedding cost, and query latency significantly. Second, search pollution: when a query matches a concept, you get multiple near-duplicate chunks in the top-K results, pushing genuinely different relevant chunks out of the result set. You need deduplication logic, which adds complexity. Third, the overlap itself becomes the majority of each chunk — at 50% overlap with 500-token chunks, 250 tokens in every chunk are repeated content, meaning only 250 tokens are unique per chunk. You are paying to embed and store the same content twice. In practice, 10-20% overlap captures most boundary cases. Beyond that, the redundancy costs outweigh the marginal retrieval benefit. If boundary splitting is a major concern, switch to a boundary-aware strategy (semantic, structure-aware) rather than throwing overlap at the problem.
:::

::: details Question 3 — Evaluation Design
**Q:** How would you design an experiment to find the optimal chunk size for a customer support RAG system?

**A:** (1) Collect 100+ real customer support queries from production logs, categorized by type (factual lookup, troubleshooting, policy questions). (2) For each query, manually annotate which document sections contain the correct answer — these become your ground truth. (3) Define configurations to test: chunk sizes 256, 512, 768, 1024 tokens, each with 0% and 15% overlap, using recursive splitting. That is 8 configurations. (4) For each configuration: re-chunk the corpus, re-embed, run all queries, measure Recall@5, Precision@5, and MRR. (5) For the top 2-3 configurations by retrieval metrics: run end-to-end generation and measure answer correctness via LLM-as-judge. (6) Factor in cost: total embedding tokens, storage size, average query latency. (7) Choose the configuration that maximizes answer quality within your cost constraints. Key pitfall: test on a representative sample of documents first (not the entire corpus) to keep re-embedding cost manageable. Re-run quarterly as your corpus and query patterns evolve.
:::

## Key Mental Models

- **Chunk size is an empirical decision, not a rule.** "Use 500 tokens" is a starting point. The optimal size depends on your documents, queries, and embedding model.
- **Silent truncation is the most dangerous chunk-sizing failure.** Always validate that chunks fit within your embedding model's max tokens.
- **Overlap is insurance, not a feature.** It prevents boundary splits but costs storage. If your chunking strategy has semantic boundaries, you may not need it.
- **Evaluate on real queries, not synthetic ones.** The test set determines whether your optimization is useful or misleading.
- **Chunk size and embedding model are coupled.** Changing one without reconsidering the other is a common source of silent failures.

## Related

- [Chunking Strategies](01-chunking-strategies.md) — which strategy determines where to cut
- [Embedding Models & Similarity](/rag/module-07/01-embeddings-similarity.md) — max tokens, model capabilities
- [Production Metadata Schema](/rag/module-06/01-metadata-schema.md) — storing chunk_size, chunking_strategy in metadata
- [Schema & Index Design](/rag/module-08/02-schema-design.md) — how chunks are stored in the database
