---
title: Retrieval Strategies
outline: deep
---

# Retrieval Strategies

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [Embedding Models](../module-07/01-embeddings-similarity.md), [Vector DB Internals](../module-08/01-vector-db-internals.md) | **Builds toward:** [Hybrid Search](02-hybrid-search.md), [Reranking](../module-11/01-reranking.md)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you need to find a specific book in a massive library. You could search by meaning ("books about heartbreak"), by exact words ("contains the phrase 'broken heart'"), by catalog metadata ("published after 2020, fiction section"), or by asking the librarian to rephrase your vague request into something more searchable. Each retrieval strategy is a different way to search that library — and the best systems use several at once.
:::

## ⚙️ Under the Hood

### 1. Dense Vector Retrieval

**What:** Encode the query into an embedding vector, then find the K nearest vectors in the index using ANN (Approximate Nearest Neighbor) search.

**How it works:**
```text
query → embedding model → query_vector (768/1536-dim)
                                ↓
                    ANN search (HNSW/IVF) over pre-indexed doc vectors
                                ↓
                         top-K results by cosine similarity
```

**When to use:**
- Semantic similarity — "What is the refund policy?" matches "Customers may return items within 30 days"
- The query and documents use different words for the same concept
- Exploratory or conversational queries

**When NOT to use:**
- Exact keyword matching — dense retrieval often fails on product codes (`SKU-48291`), policy numbers, people's names, flight numbers
- The corpus is tiny (< 100 docs) — brute-force exact search is faster
- You need deterministic, reproducible ranking (embedding models are opaque)

**Limitations:**
- Embedding model quality is the ceiling — a bad model embeds unrelated concepts close together
- High-dimensional vectors require significant memory (1M docs * 1536 dims * 4 bytes = ~6 GB)
- ANN is approximate: recall@100 is typically 95-99%, meaning 1-5% of true matches are missed

**Example:**
```typescript
// run: npx tsx dense-retrieval.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

async function denseRetrieval(query: string, documents: string[]) {
  // Embed query
  const queryRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  });
  const queryVec = queryRes.data[0].embedding;

  // Embed documents (in production, pre-computed and indexed)
  const docRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: documents,
  });

  // Cosine similarity
  const scores = docRes.data.map((d, i) => ({
    index: i,
    score: cosineSimilarity(queryVec, d.embedding),
    text: documents[i],
  }));

  return scores.sort((a, b) => b.score - a.score).slice(0, 5);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

---

### 2. Sparse Retrieval (BM25)

**What:** Score documents by term frequency, inverse document frequency, and document length. The classic information retrieval algorithm. No neural network, no embeddings — pure statistics.

**How it works:**

BM25 scores each document D for query Q:

```text
score(D, Q) = Σ IDF(qi) * (f(qi, D) * (k1 + 1)) / (f(qi, D) + k1 * (1 - b + b * |D|/avgdl))
```

Where:
- `f(qi, D)` = term frequency of query term qi in document D
- `IDF(qi)` = inverse document frequency (how rare the term is across all documents)
- `|D|` = document length, `avgdl` = average document length
- `k1` (default 1.2) = term frequency saturation
- `b` (default 0.75) = length normalization

**When to use:**
- Exact term matching: product codes, policy numbers, names, IDs, error codes
- Technical domains with precise terminology (medical codes, legal statute references)
- When you need interpretable, deterministic ranking
- As a complement to dense retrieval in hybrid search

**When NOT to use:**
- Semantic similarity with vocabulary mismatch ("automobile" vs "car")
- Short queries against long documents (BM25 struggles with single-word queries)
- Multilingual search where the query and document are in different languages

**Limitations:**
- No semantic understanding — "dog" and "canine" are completely unrelated to BM25
- Sensitive to tokenization (stemming, stopwords)
- Vocabulary mismatch is the fundamental failure mode

**Example:**
```typescript
// run: npx tsx bm25-retrieval.ts
// Simplified BM25 implementation for illustration

interface BM25Index {
  docs: string[][];           // tokenized documents
  df: Map<string, number>;    // document frequency per term
  avgdl: number;              // average document length
  N: number;                  // total documents
}

function buildBM25Index(documents: string[]): BM25Index {
  const docs = documents.map(d => d.toLowerCase().split(/\s+/));
  const df = new Map<string, number>();

  for (const doc of docs) {
    const seen = new Set(doc);
    for (const term of seen) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const avgdl = docs.reduce((sum, d) => sum + d.length, 0) / docs.length;
  return { docs, df, avgdl, N: docs.length };
}

function bm25Score(
  query: string[],
  docIndex: number,
  index: BM25Index,
  k1 = 1.2,
  b = 0.75
): number {
  const doc = index.docs[docIndex];
  let score = 0;

  for (const term of query) {
    const docFreq = index.df.get(term) ?? 0;
    if (docFreq === 0) continue;

    const idf = Math.log((index.N - docFreq + 0.5) / (docFreq + 0.5) + 1);
    const tf = doc.filter(t => t === term).length;
    const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * doc.length / index.avgdl));

    score += idf * tfNorm;
  }

  return score;
}

function search(query: string, index: BM25Index, topK = 5) {
  const queryTerms = query.toLowerCase().split(/\s+/);
  const results = index.docs.map((_, i) => ({
    index: i,
    score: bm25Score(queryTerms, i, index),
  }));
  return results.sort((a, b) => b.score - a.score).slice(0, topK);
}
```

---

### 3. Keyword Search

**What:** Simple text matching — exact substring, regex, or full-text search indexes. Not statistically weighted like BM25, just "does this term appear?"

**When to use:**
- Filtering before vector search: find all documents containing "GDPR" before ranking by semantic relevance
- Known-item search: user knows the exact title or ID
- Autocomplete and typeahead

**When NOT to use:**
- Ranking by relevance (no scoring mechanism)
- Semantic matching across vocabulary

**Limitations:**
- No ranking quality — returns unordered matches
- Exact match only (unless you add stemming/fuzzy)
- Typically a pre-filter, not a primary retrieval method in RAG

---

### 4. Metadata Filtering

**What:** Restrict the search space using structured attributes before (pre-filtering) or after (post-filtering) similarity search.

**Common filters:**
| Filter Type | Example |
|-------------|---------|
| Tenant isolation | `tenant_id = "acme-corp"` |
| Date range | `updated_at > "2024-01-01"` |
| Document type | `doc_type IN ("policy", "faq")` |
| Access control | `department IN user.departments` |
| Source | `source = "legal-docs"` |
| Language | `language = "en"` |

**Pre-filtering vs post-filtering:**

```text
Pre-filtering:  filter first → ANN search on filtered subset
                ✅ Always returns K results from the valid set
                ❌ May require separate indexes per filter combination
                ❌ Small filtered sets can degrade ANN quality

Post-filtering: ANN search on all → filter results
                ✅ Single index, simpler
                ❌ May return fewer than K results (filtered out)
                ❌ Wastes compute searching irrelevant documents
```

**When to use:**
- Multi-tenant systems (mandatory — never leak data across tenants)
- Time-sensitive data (only search recent documents)
- Access control enforcement
- Narrowing search scope for performance

**Limitations:**
- Pre-filtering on high-cardinality fields requires careful index design
- Over-filtering can leave too few candidates for meaningful ranking

---

### 5. Hierarchical Retrieval

**What:** Index small chunks for precision, but retrieve their parent document (or a larger surrounding chunk) for context.

**Architecture:**
```text
Document: "Company Policy Manual" (50 pages)
    ├── Section: "Leave Policy" (5 pages)
    │    ├── Chunk 1: "Annual leave is 24 days..." (200 tokens)
    │    ├── Chunk 2: "Sick leave requires a certificate..." (200 tokens)
    │    └── Chunk 3: "Maternity leave is 26 weeks..." (200 tokens)
    └── Section: "Expenses Policy" (3 pages)
         ├── Chunk 4: "Travel expenses must be pre-approved..." (200 tokens)
         └── Chunk 5: "Meal allowance is $50/day..." (200 tokens)

Search matches Chunk 2 → Return Section "Leave Policy" (all 3 chunks)
```

**When to use:**
- Documents where context spans multiple chunks (legal contracts, technical manuals)
- The answer to a question depends on surrounding paragraphs
- You want small chunks for precision but large chunks for generation

**When NOT to use:**
- FAQ-style documents where each chunk is self-contained
- When token budget is tight (parent chunks are large)

**Limitations:**
- Requires maintaining parent-child relationships in metadata
- Returning large parent chunks can exhaust the token budget quickly
- Parent chunk may contain irrelevant sections alongside the relevant one

---

### 6. Parent-Document Retrieval

**What:** Index document summaries or section headers, but retrieve the full document when matched.

**How it differs from hierarchical:**
- Hierarchical: index small chunks, retrieve their parent section
- Parent-document: index a *summary* of the whole document, retrieve the *full document*

**When to use:**
- Small corpus of long, dense documents (legal briefs, research papers)
- Queries that require understanding the full document, not just a snippet
- When you can afford to send a full document (or large section) to the LLM

**When NOT to use:**
- Large corpus (indexing summaries of millions of documents is expensive to generate)
- When answers are localized to a paragraph

**Limitations:**
- Summary quality determines retrieval quality — bad summary = missed document
- Full documents can blow the token budget
- Generating good summaries requires an LLM call per document at ingestion time

---

### 7. Multi-Query Retrieval

**What:** Generate multiple variants of the user's query using an LLM, retrieve results for each variant, then merge and deduplicate.

**How it works:**
```text
User query: "How do I handle errors in NestJS?"
    ↓ LLM generates variants
Query 1: "NestJS exception handling"
Query 2: "NestJS error filters and middleware"
Query 3: "how to catch errors in NestJS controllers"
    ↓ retrieve top-K for each
Results 1: [A, B, C, D, E]
Results 2: [B, F, G, H, I]
Results 3: [A, C, J, K, L]
    ↓ merge + deduplicate + rank
Final: [A, B, C, F, G, D, J, ...]
```

**When to use:**
- Ambiguous queries where different phrasings surface different relevant documents
- Broad topic queries ("tell me about caching") where multiple angles exist
- When recall matters more than latency

**When NOT to use:**
- Simple, specific queries ("what is the default port for Redis?")
- Latency-sensitive applications (3-5x retrieval cost + LLM call for variant generation)

**Limitations:**
- Adds 200-500ms latency (LLM call for variant generation)
- Merging results requires a fusion strategy (e.g., RRF — see [Hybrid Search](02-hybrid-search.md))
- More candidates to rerank downstream
- Cost: one extra LLM call per user query

---

### 8. Query Expansion

**What:** Add synonyms, related terms, or acronym expansions to the query before retrieval. Can be rule-based (synonym dictionary) or LLM-powered.

**How it differs from multi-query:**
- Multi-query: generate entirely new queries, retrieve separately, merge results
- Query expansion: enrich a single query with additional terms, run one retrieval

**Example:**
```yaml
Original: "K8s pod crash"
Expanded: "K8s Kubernetes pod crash CrashLoopBackOff restart failure OOMKilled"
```

**When to use:**
- Domain-specific acronyms and abbreviations
- Queries with specialized jargon that may not match document vocabulary
- As a lightweight alternative to multi-query (no separate retrievals needed)

**When NOT to use:**
- When expansion adds noise (expanding "Python" might add "snake" in a general corpus)
- Dense retrieval already handles synonyms well via embeddings

**Limitations:**
- Over-expansion dilutes the query and hurts precision
- Rule-based expansion needs a maintained synonym dictionary
- LLM expansion adds latency

---

### 9. HyDE (Hypothetical Document Embedding)

**What:** Instead of embedding the query directly, ask an LLM to generate a hypothetical answer, then embed *that answer* and search for similar documents. The hypothesis is closer in "register" to the actual documents than the question is.

**How it works:**
```yaml
Query: "How does NestJS handle dependency injection?"
    ↓ LLM generates hypothetical answer
Hypothesis: "NestJS uses a built-in IoC container that reads constructor
parameter types via reflect-metadata. When a module is initialized, the
container resolves the dependency graph, instantiates providers in
topological order, and injects them via constructor parameters..."
    ↓ embed the hypothesis (not the query)
    ↓ ANN search finds real documents similar to this hypothesis
```

**Why it works:** User queries are short and in "question register." Documents are long and in "answer register." Embedding a fake answer bridges this register gap — the fake answer's vector lands closer to real answers than the question's vector would.

**When to use:**
- The query and documents are in very different registers (questions vs technical docs)
- The user asks conceptual questions about a corpus of detailed explanations
- You have a capable LLM available for the hypothesis generation step

**When NOT to use:**
- Exact term lookup (HyDE generates prose, not keywords)
- The LLM might hallucinate a misleading hypothesis that pulls retrieval in the wrong direction
- Latency-sensitive paths (adds 300-1000ms for the LLM generation step)

**Limitations:**
- If the LLM's hypothesis is wrong, retrieval goes in the wrong direction — garbage in, garbage out
- Costs one LLM call per query
- Does not help when the query is already well-formed and in the same register as documents

**Example:**
```typescript
// run: npx tsx hyde-retrieval.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

async function hydeRetrieval(query: string) {
  // Step 1: Generate hypothetical answer
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content: 'Write a short, factual paragraph answering the question. ' +
                 'Write as if from a technical document, not a conversation.',
      },
      { role: 'user', content: query },
    ],
    temperature: 0.0,
    max_tokens: 300,
  });

  const hypothesis = completion.choices[0].message.content!;

  // Step 2: Embed the hypothesis (not the original query)
  const embeddingRes = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: hypothesis,
  });

  const searchVector = embeddingRes.data[0].embedding;

  // Step 3: Use searchVector for ANN search in your vector DB
  // return vectorDB.search(searchVector, { topK: 20 });
  return { hypothesis, searchVector: searchVector.slice(0, 5) }; // truncated for display
}
```

---

### 10. Graph Retrieval

**What:** Traverse a knowledge graph to find related entities and their relationships, then retrieve documents connected to those entities.

**Architecture:**
```yaml
Query: "What drugs interact with metformin?"
    ↓ entity extraction
Entity: "metformin" → Node in knowledge graph
    ↓ graph traversal
metformin --[interacts_with]--> warfarin
metformin --[interacts_with]--> alcohol
metformin --[treats]--> type_2_diabetes
warfarin  --[documented_in]--> doc_47, doc_112
    ↓ retrieve linked documents
Results: [doc_47, doc_112, ...]
```

**When to use:**
- Domains with rich entity relationships (biomedical, legal, financial)
- Multi-hop questions ("Who manages the team that built the billing service?")
- When relationships between entities matter more than text similarity
- Combining with vector search for hybrid entity + semantic retrieval

**When NOT to use:**
- No existing knowledge graph (building one from scratch is expensive)
- Simple factoid questions answerable from a single chunk
- Unstructured domains without clear entity relationships

**Limitations:**
- Requires building and maintaining a knowledge graph (entity extraction, relationship definition, updates)
- Graph quality determines retrieval quality — missing edges = missing answers
- Multi-hop traversal can be slow on large graphs
- Not all questions map to graph traversal patterns

---

### Strategy Selection Matrix

| Strategy | Latency | Recall Strength | Best For | Worst For |
|----------|---------|----------------|----------|-----------|
| Dense vector | Low | Semantic similarity | Conceptual questions | Exact terms, IDs |
| BM25 | Low | Exact term match | Names, codes, IDs | Synonym matching |
| Keyword | Very low | Exact substring | Pre-filtering, known items | Ranking |
| Metadata filter | Very low | Scope restriction | Multi-tenant, ACL, dates | Relevance ranking |
| Hierarchical | Low | Context preservation | Long docs needing context | Self-contained FAQs |
| Parent-document | Medium | Full-document context | Research papers, briefs | Large corpora |
| Multi-query | High | Broad recall | Ambiguous queries | Simple questions |
| Query expansion | Low-Medium | Term coverage | Acronyms, jargon | Noise-sensitive domains |
| HyDE | High | Register bridging | Question→doc mismatch | Exact term lookup |
| Graph | Medium-High | Relationship traversal | Multi-hop, entity-rich | Unstructured text |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Dense retrieval fails on exact identifiers.** User asks "What is the status of order ORD-58291?" Dense search returns documents about "order status" in general, not the specific order. The embedding model maps "ORD-58291" to a generic "order identifier" region of the vector space. Fix: hybrid search with BM25, or metadata filtering by order ID.

**HyDE generates a misleading hypothesis.** The LLM's hypothetical answer contains incorrect assumptions, pulling retrieval toward the wrong documents. A query about "Python 3.12 pattern matching" gets a hypothesis mentioning "match/case syntax" but the LLM incorrectly describes semantics, and the embedding now points toward wrong explanations. Fix: use HyDE only when the register gap is clear, and always rerank the results.

**Multi-query explosion.** Generating 5 query variants and retrieving 20 results each means 100 candidates to deduplicate and rerank. Latency balloons from 100ms to 800ms. Fix: cap variant count at 3, retrieve fewer candidates per variant (top 10), and set a hard latency budget.

**Metadata filters return too few results.** Pre-filtering by `department = "legal" AND created_after = "2024-01-01"` leaves only 12 documents. ANN search over 12 vectors is basically brute-force and may miss relevant older documents. Fix: use post-filtering with over-retrieval, or relax date filters with a fallback.
:::

## 🎯 Checkpoint

::: details Question 1 — Dense vs BM25 failure modes
**Q:** A user searches for "What is the status of claim CLM-2024-00847?" in a RAG system using only dense vector retrieval. The correct document exists in the corpus. Why might retrieval fail, and how would you fix it?

**A:** Dense retrieval maps the claim number to a generic "claim identifier" region in embedding space — all claim numbers cluster together because they share the same syntactic pattern. The specific claim number `CLM-2024-00847` has no semantic distinction from `CLM-2024-00123` in embedding space. Fix: add BM25 or keyword search to the pipeline (hybrid search), where exact token matching will surface the right document. Alternatively, extract the claim number and use metadata filtering (`claim_id = "CLM-2024-00847"`) before vector search.
:::

::: details Question 2 — HyDE trade-offs
**Q:** When would HyDE hurt retrieval quality rather than help it? Give a concrete scenario.

**A:** HyDE hurts when the LLM's hypothetical answer is factually wrong or based on incorrect assumptions. Example: the user asks about an internal company policy that the LLM has no training data about. The LLM generates a hypothesis based on generic corporate practices, but the company's actual policy is unusual. The hypothesis embedding now points toward "standard" documents rather than the company's specific policy. HyDE also hurts for exact-term queries (searching for a specific error code) where the hypothesis adds irrelevant prose that dilutes the search signal. The core failure mode: HyDE assumes the LLM can produce a reasonable approximation of the answer — when it cannot, retrieval degrades.
:::

::: details Question 3 — Strategy combination
**Q:** You are building a RAG system for a legal firm. Queries range from "summarize the precedent for wrongful termination in California" (semantic) to "find clause 14.3(b) in the Smith v. Jones contract" (exact). Design the retrieval strategy.

**A:** Use a multi-strategy pipeline: (1) Metadata filtering to restrict by case/contract/jurisdiction first. (2) Hybrid search combining dense retrieval (for semantic queries) and BM25 (for exact clause references). (3) Hierarchical retrieval — index at the clause level for precision, but retrieve the full section for context during generation. (4) Query classification to detect whether the query is semantic or exact-reference, and weight the hybrid fusion accordingly (high alpha for semantic, low alpha for exact). (5) Reranking with a cross-encoder to ensure the final top-5 are truly relevant. The key insight is that no single strategy covers both query types — the system must detect query intent and adapt.
:::

## Key Mental Models

- **Dense retrieval finds meaning; BM25 finds words.** Neither alone is sufficient for production RAG — you almost always want both.
- **Every strategy trades off latency, recall, and precision.** Multi-query and HyDE boost recall at the cost of latency. Metadata filtering boosts precision at the cost of recall.
- **The retrieval strategy should match the query type.** A system that routes exact-term queries to BM25 and semantic queries to dense search outperforms either alone.
- **HyDE bridges the register gap** between how users ask (questions) and how documents are written (statements), but it fails when the LLM cannot approximate the answer domain.
- **Retrieval quality is the ceiling for RAG quality.** No amount of prompt engineering or reranking can recover a document that was never retrieved.

## Related

- [Hybrid Search & Fusion](02-hybrid-search.md) — how to combine multiple retrieval strategies
- [Reranking](../module-11/01-reranking.md) — refining retrieval results after the first stage
- [Query Rewriting & Routing](../module-10/01-query-rewriting.md) — transforming queries before retrieval
- [Embedding Models](../module-07/01-embeddings-similarity.md) — the models powering dense retrieval
- [Vector DB Internals](../module-08/01-vector-db-internals.md) — ANN indexes that make dense retrieval fast
