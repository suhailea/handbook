---
title: What Is RAG & When to Use It
outline: deep
---

# What Is RAG & When to Use It

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** Basic understanding of LLMs and embeddings | **Builds toward:** [RAG vs Alternatives](02-rag-vs-alternatives.md), [Ingestion Pipelines](../module-03/01-ingestion-pipelines.md)

## 🗣️ In Plain English

::: tip In Plain English
RAG is an open-book exam for an LLM. Instead of relying on what it memorized during training, you hand it the relevant pages right before it answers. The system searches your documents, grabs the best matches, stuffs them into the prompt, and lets the LLM write a grounded answer. If the textbook is wrong or missing pages, the answer will be too — retrieval quality is the ceiling.
:::

## ⚙️ Under the Hood

### What RAG Actually Is

**Retrieval-Augmented Generation** (Lewis et al., 2020) is an architecture pattern, not a product. It has three steps:

1. **Retrieve** — given a user query, find the most relevant pieces of information from an external knowledge source.
2. **Augment** — inject those pieces into the LLM's prompt as context.
3. **Generate** — the LLM produces an answer grounded in the provided context.

The key insight: the LLM's parametric knowledge (what it learned during training) is supplemented by non-parametric knowledge (the retrieved documents) at inference time, without retraining.

### The Two Paths: Offline Ingestion & Online Query

Every RAG system has two distinct data paths:

```text
┌─────────────────────────────────────────────────────────┐
│                   OFFLINE PATH (Ingestion)              │
│                                                         │
│  Source Docs ──► Parser ──► Chunker ──► Embedder ──►    │
│  (PDF, HTML,    (extract   (split     (text →       │
│   CSV, etc.)    text)      into       vectors)      │
│                            pieces)                  │
│                                        │            │
│                                        ▼            │
│                                   Vector DB         │
│                                   (store &          │
│                                    index)           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                   ONLINE PATH (Query)                   │
│                                                         │
│  User Query ──► Embed ──► Vector Search ──► Rerank ──►  │
│                 query     (find top-k      (refine      │
│                           similar          ranking)     │
│                           chunks)                       │
│                              │                 │        │
│                              ▼                 ▼        │
│                         Retrieved Chunks                │
│                              │                          │
│                              ▼                          │
│                   Prompt Construction                   │
│                   (system msg + context + query)        │
│                              │                          │
│                              ▼                          │
│                         LLM Generate                    │
│                              │                          │
│                              ▼                          │
│                      Response + Citations               │
└─────────────────────────────────────────────────────────┘
```

### The RAG Lifecycle End-to-End

#### Offline Phase

| Step | What Happens | Key Decisions |
|------|-------------|---------------|
| **1. Collect** | Gather documents from sources (S3, databases, APIs, file shares) | Which sources? How often? Auth? |
| **2. Parse** | Extract text from raw formats (PDF → text, HTML → clean text) | Which parser? How to handle tables, images? |
| **3. Clean** | Remove boilerplate, headers/footers, duplicates | What counts as noise? |
| **4. Chunk** | Split documents into retrieval-sized pieces | Chunk size? Overlap? Semantic vs fixed? |
| **5. Enrich** | Add metadata (source, date, section, author) | Which metadata enables filtering? |
| **6. Embed** | Convert chunks to dense vectors via embedding model | Which model? Dimensions? |
| **7. Index** | Store vectors + metadata + original text in vector DB | Which DB? Index type? |

#### Online Phase

| Step | What Happens | Key Decisions |
|------|-------------|---------------|
| **1. Receive** | Accept user query | Streaming? Auth? Rate limiting? |
| **2. Transform** | Rewrite query for better retrieval (HyDE, decomposition) | How much query processing? |
| **3. Embed** | Convert query to vector using same embedding model | Must match ingestion model |
| **4. Search** | Find top-k similar chunks via ANN search | k=? Distance metric? Filters? |
| **5. Rerank** | Re-score results with cross-encoder for precision | Reranker model? Latency budget? |
| **6. Construct** | Build prompt: system message + retrieved context + query | Context window budget? Order? |
| **7. Generate** | LLM produces answer from context | Model choice? Temperature? |
| **8. Post-process** | Add citations, filter hallucinations, format response | Citation format? Guardrails? |

### The Taxonomy: Naive → Advanced → Modular

```text
Naive RAG                Advanced RAG              Modular RAG
──────────               ────────────              ───────────
embed → search →         query rewrite →           routing →
stuff into prompt →      hybrid search →             ├─ vector path
generate                 rerank →                    ├─ SQL path
                         prompt compression →        ├─ knowledge graph
                         generate + cite             └─ web search
                                                   adaptive retrieval →
                                                   self-reflection →
                                                   generate + verify
```

- **Naive RAG:** Embed query, retrieve top-k, stuff into prompt, generate. Works for demos. Falls apart in production (wrong chunks retrieved, no citations, no handling of ambiguous queries).
- **Advanced RAG:** Adds pre-retrieval optimization (query rewriting, HyDE), retrieval optimization (hybrid search, reranking), and post-retrieval optimization (context compression, citation extraction). This is the production baseline.
- **Modular RAG:** Treats each component as a pluggable module. Adds routing (send different query types to different retrieval backends), iterative retrieval (retrieve → generate → retrieve again if needed), and self-reflection (check if retrieved context actually answers the query). This is the frontier.

### When to Use RAG

RAG is the right tool when:

| Condition | Why RAG Helps |
|-----------|---------------|
| Data changes frequently | No retraining needed — update the index |
| Data is private/proprietary | LLM never saw it during training |
| Citations/provenance required | Retrieved chunks are traceable to source |
| Large corpus (>1M tokens) | Cannot fit in context window economically |
| Domain-specific vocabulary | Retrieval finds exact terminology |
| Multi-tenant access control | Metadata filters enforce per-user visibility |

### When NOT to Use RAG

| Scenario | Better Alternative | Why |
|----------|-------------------|-----|
| Fully structured data (transactions, metrics) | SQL queries, dashboards | Embeddings destroy row/column relationships |
| Real-time transactional data | Direct DB queries | Embedding lag makes data stale |
| Pure reasoning / math | Chain-of-thought prompting | No external knowledge needed |
| Style/tone adaptation | Fine-tuning | RAG adds knowledge, not behavior |
| Tiny corpus (<50 pages) | Stuff into context window | Retrieval overhead not worth it |
| Exact keyword matching | Full-text search (Elasticsearch) | Embeddings are semantic, not lexical |

### Decision Flowchart

```text
Does the LLM need external knowledge to answer?
│
├─ NO → Do you need to change the model's behavior/style?
│        ├─ YES → Fine-tuning
│        └─ NO  → Prompt engineering
│
└─ YES → Is the data structured (SQL tables, APIs)?
          │
          ├─ YES → Is the query analytical (aggregations, filters)?
          │        ├─ YES → NL-to-SQL / direct database queries
          │        └─ NO  → Hybrid (SQL + RAG for text columns)
          │
          └─ NO → Does the corpus fit in the context window (<100K tokens)?
                   │
                   ├─ YES → Is cost/latency critical?
                   │        ├─ YES → RAG (cheaper per query)
                   │        └─ NO  → Long-context stuffing (simpler)
                   │
                   └─ NO → RAG
                            │
                            └─ Does the query require multi-step reasoning
                               or tool use?
                               ├─ YES → Agentic RAG
                               └─ NO  → Standard RAG pipeline
```

### The Retrieval Quality Ceiling

This is the most important mental model in RAG:

> **Generation quality can never exceed retrieval quality.**

If the retriever returns irrelevant chunks, the LLM will either hallucinate or produce a vague non-answer. No amount of prompt engineering fixes bad retrieval. This is why production RAG engineering is 80% retrieval optimization and 20% generation tuning.

```python
# run: python demo_basic_rag.py
# Requires: pip install openai chromadb

from openai import OpenAI
import chromadb

client = OpenAI()
chroma = chromadb.Client()
collection = chroma.create_collection("demo")

# Offline: ingest documents
documents = [
    "The refund policy allows returns within 30 days of purchase.",
    "Premium members get free shipping on all orders over $50.",
    "Our customer support hours are 9 AM to 6 PM EST, Monday to Friday.",
    "Warranty covers manufacturing defects for 12 months from purchase date.",
]

collection.add(
    documents=documents,
    ids=[f"doc-{i}" for i in range(len(documents))],
)

# Online: query
query = "How long do I have to return an item?"

results = collection.query(query_texts=[query], n_results=2)
retrieved_chunks = results["documents"][0]

prompt = f"""Answer the question based ONLY on the following context.
If the context doesn't contain the answer, say "I don't have that information."

Context:
{chr(10).join(f'- {chunk}' for chunk in retrieved_chunks)}

Question: {query}
"""

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": prompt}],
    temperature=0,
)

print(f"Query: {query}")
print(f"Retrieved: {retrieved_chunks}")
print(f"Answer: {response.choices[0].message.content}")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. The "works in demo, fails in production" trap.**
Naive RAG with 50 documents works great. The same pipeline with 500K documents retrieves irrelevant chunks because the embedding space is crowded. Symptom: answer quality degrades as corpus grows. Fix: add reranking, hybrid search, metadata filtering — move from naive to advanced RAG.

**2. Stale index, fresh questions.**
Users ask about something updated yesterday, but the ingestion pipeline runs weekly. The LLM confidently answers with outdated information because the old chunk is still in the index. Symptom: correct-sounding but factually wrong answers. Fix: define freshness SLAs, implement incremental ingestion, add "last updated" metadata to citations.

**3. The hallucination-on-partial-context failure.**
The retriever returns chunks that are *related* to the query but don't actually contain the answer. The LLM, trying to be helpful, synthesizes a plausible but fabricated answer from partial context. Symptom: answers that sound authoritative but are wrong. Fix: add a "confidence" check — if retrieved chunks have low relevance scores, return "I don't know" instead of guessing.

**4. Cost surprise at scale.**
Each query embeds the query (cheap), calls the vector DB (cheap), then sends retrieved chunks + query to the LLM (expensive). With 5 chunks of 500 tokens each, you are sending ~3K tokens per query. At 10K queries/day, that is 30M input tokens/day. With GPT-4o at $2.50/M input tokens, that is $75/day just for input. Symptom: month-end bill shock. Fix: budget tokens per query, use smaller models for simple queries (routing), cache frequent queries.

:::

## 🎯 Checkpoint

::: details Question 1 — Retrieval quality ceiling
**Q:** Your RAG system retrieves the correct document 70% of the time (recall@5 = 0.70). Your LLM has a 95% accuracy rate when given the correct context. What is the approximate upper bound of end-to-end answer accuracy, and what should you optimize first?

**A:** The upper bound is approximately 0.70 x 0.95 = 66.5%. The retrieval quality is the bottleneck. Improving the LLM to 99% accuracy only raises the ceiling to 69.3%. Improving retrieval recall to 90% with the same LLM gives 85.5%. Always optimize retrieval first — it has the highest leverage. Practical improvements: add a reranker (often boosts recall@5 by 10-15%), use hybrid search (BM25 + dense), improve chunking strategy, add query rewriting.
:::

::: details Question 2 — RAG vs long-context
**Q:** Your corpus is 80K tokens of internal documentation that changes monthly. A colleague says "just stuff it all into Claude's 200K context window — no need for RAG." Argue for and against this approach.

**A:** **For long-context stuffing:** Simpler architecture (no vector DB, no chunking, no embedding pipeline), no retrieval errors (all context is present), faster to build, lower operational overhead, and modern LLMs handle 80K tokens well. **Against:** Cost per query is high (~$0.24 per query with Claude at $3/M input tokens vs ~$0.01 with RAG retrieving 3K tokens), latency is higher (processing 80K tokens takes 2-5 seconds vs sub-second for RAG), the "lost in the middle" problem means accuracy drops for information in the middle of long contexts, and it does not scale — when the corpus grows to 500K tokens, stuffing stops being an option. **Verdict:** For this specific case (80K tokens, monthly updates, low QPS), long-context is probably the right starting point. Switch to RAG when the corpus exceeds the context window, when query volume makes per-query cost matter, or when you need metadata filtering (e.g., per-user access control).
:::

::: details Question 3 — Offline vs online path
**Q:** An engineer on your team wants to embed documents on-the-fly when a user uploads them and immediately make them queryable. What are the risks of skipping the offline ingestion path?

**A:** Several risks: (1) **Latency** — embedding a large document takes seconds to minutes; the user is waiting synchronously. (2) **Failure handling** — if the embedding API call fails mid-document, you have a partially indexed document with no easy way to retry. (3) **Resource contention** — embedding API rate limits mean concurrent uploads can queue up or fail. (4) **No quality gate** — there is no opportunity for parsing validation, deduplication, or chunking quality checks. (5) **Index consistency** — if you are using an index that requires rebuilding (like HNSW), adding single vectors on the fly may degrade search quality. The correct pattern: accept the upload, return immediately, queue the ingestion job, process asynchronously, notify the user when the document is searchable. This is the offline path, just triggered by an event rather than a cron job.
:::

## Key Mental Models

- **Open-book exam:** RAG gives the LLM relevant pages at test time instead of relying on memorized training data. The quality of the pages determines the quality of the answer.
- **Two paths, one system:** Offline ingestion (parse → chunk → embed → index) and online query (embed → search → rerank → generate) are separate pipelines with different scaling, latency, and reliability concerns.
- **Retrieval quality ceiling:** Generation can never compensate for bad retrieval. Optimizing the retriever has the highest ROI in any RAG system.
- **Naive → Advanced → Modular:** Production systems need query rewriting, hybrid search, reranking, and citation extraction — naive embed-and-search is a starting point, not a destination.
- **RAG adds knowledge, not behavior:** If you need the model to write in a specific style, fine-tune. If you need it to know specific facts, use RAG.

## Related

- [RAG vs Alternatives](02-rag-vs-alternatives.md) — deeper comparison with fine-tuning, long-context, SQL, and agents
- [Ingestion Pipelines](../module-03/01-ingestion-pipelines.md) — how the offline path works in production
- [Designing Before Building](../module-02/01-requirements.md) — system requirements before choosing any RAG component
