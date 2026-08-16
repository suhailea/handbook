---
title: Embedding Models & Similarity Metrics
outline: deep
---

# Embedding Models & Similarity Metrics

**Interview weight:** 🔥🔥🔥 — fundamental to any RAG discussion. Interviewers expect you to explain similarity metrics precisely and compare models with real trade-offs.

**Prerequisites:** [Chunking Strategies](/rag/module-05/01-chunking-strategies.md)

## 🗣️ In Plain English

::: tip In Plain English
An embedding turns a sentence into a list of numbers — a coordinate in a high-dimensional space. Sentences with similar meanings land near each other. To find relevant content, you convert the question into coordinates too, then look for the nearest neighbors. The "distance" formula you use to measure "near" is the similarity metric.
:::

## ⚙️ Under the Hood

### What an Embedding Actually Is

An embedding is a dense vector of floating-point numbers that represents the semantic meaning of text in N-dimensional space. The model is trained so that semantically similar inputs produce vectors that are close together.

```typescript
// Conceptual example
const embedding = await openai.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'How do I reset my password?',
});

// Result: a vector of 1536 floats
// [0.0123, -0.0456, 0.0789, ..., -0.0234]  // 1536 numbers
//
// Similar query → similar vector:
// "I forgot my password and need to change it"
// → [0.0119, -0.0461, 0.0792, ..., -0.0228]  // very close numerically
//
// Unrelated query → distant vector:
// "What are your business hours?"
// → [0.0891, 0.0234, -0.0567, ..., 0.0456]  // very different
```

**Key property:** The model compresses semantic meaning into a fixed-size numeric representation. Two texts can be compared purely by comparing their vectors — no text matching, no keyword overlap needed.

---

### Dense vs Sparse Embeddings

| Property | Dense Embeddings | Sparse Embeddings |
|----------|-----------------|-------------------|
| **What they are** | Learned continuous vectors (every dimension has a value) | Mostly zeros, non-zero values at positions representing specific terms/concepts |
| **How produced** | Neural network (transformer) | Term frequency (BM25), learned sparse (SPLADE, neural) |
| **Dimensions** | 384–3072 (all non-zero) | Vocabulary-size (30,000+), 99%+ zeros |
| **Captures** | Semantic meaning, synonyms, paraphrases | Exact term matches, keyword relevance |
| **Strengths** | Understands meaning: "automobile" ≈ "car" | Precise keyword matching: "RBAC" finds "RBAC" |
| **Weaknesses** | May miss exact terms, acronyms, rare words | No semantic understanding: "car" ≠ "automobile" |
| **Examples** | OpenAI text-embedding-3, BGE, E5 | BM25, TF-IDF, SPLADE |

**Production insight:** The best retrieval systems use both. Dense embeddings catch semantic similarity; sparse embeddings catch exact terms. This is **hybrid search** — covered in the retrieval module.

---

### Similarity Metrics

Three metrics dominate vector search. Understanding when to use each is critical.

#### Cosine Similarity

Measures the angle between two vectors, ignoring magnitude.

```text
                    A · B
cos(θ) = ─────────────────────
          ‖A‖ × ‖B‖

Range: [-1, 1]
  1.0 = identical direction (most similar)
  0.0 = orthogonal (unrelated)
 -1.0 = opposite direction (most dissimilar)
```

```typescript
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

**When to use:** Default choice for text embeddings. Works regardless of whether vectors are normalized. Most embedding models are designed with cosine similarity in mind.

**Why it's the default:** Cosine similarity ignores vector magnitude (length). Two documents about the same topic produce vectors pointing in the same direction, even if one is longer or was embedded with more "confidence." By measuring angle, not length, cosine focuses purely on meaning direction.

#### Dot Product (Inner Product)

```text
dot(A, B) = A · B = Σ(aᵢ × bᵢ)

Range: (-∞, +∞)
Higher = more similar
```

**When to use:** When vectors are already normalized (unit length). For normalized vectors, dot product = cosine similarity, but dot product is faster to compute (no division by norms).

**OpenAI embeddings are normalized by default.** If you use OpenAI text-embedding-3-small/large, dot product and cosine similarity give identical results. Use dot product for speed.

**When magnitude matters:** Some models intentionally vary vector magnitude to encode "confidence" or "importance." In those cases, dot product captures both direction and magnitude, which can be useful.

#### Euclidean Distance (L2)

```text
L2(A, B) = √(Σ(aᵢ - bᵢ)²)

Range: [0, ∞)
Lower = more similar (it's a distance, not similarity)
```

**When to use:** Rarely for text embeddings. More common in image/audio embeddings or when the absolute position in vector space matters (e.g., clustering). For normalized text embeddings, L2 distance rankings are equivalent to cosine similarity rankings — they just give different scores.

#### Metric Comparison

| Metric | Computation | Range | Affected by Magnitude? | Default in |
|--------|-------------|-------|:---:|------------|
| **Cosine similarity** | angle | [-1, 1] | No | Most vector DBs |
| **Dot product** | Σ(aᵢ×bᵢ) | (-∞, +∞) | Yes | Pinecone, pgvector |
| **Euclidean (L2)** | √(Σ(aᵢ-bᵢ)²) | [0, +∞) | Yes | Faiss, some image search |

**Rule of thumb:** Use cosine similarity unless you have a specific reason not to. If your vectors are normalized (OpenAI, most modern models), use dot product for slightly faster computation with identical results.

---

### Embedding Dimensions

The number of dimensions determines how much semantic nuance the vector can capture.

| Dimensions | Storage per Vector | Nuance | Speed | Models |
|:---:|:---:|----------|-------|--------|
| 384 | 1.5 KB | Good for simple tasks | Fastest | all-MiniLM-L6-v2, BGE-small |
| 768 | 3 KB | Strong general purpose | Fast | BGE-base, E5-base, GTE-base |
| 1024 | 4 KB | High quality | Moderate | Cohere embed-v3, BGE-large |
| 1536 | 6 KB | Very high quality | Moderate | OpenAI text-embedding-3-small |
| 3072 | 12 KB | Maximum nuance | Slowest | OpenAI text-embedding-3-large |

**Storage math at scale:**
```text
1 million vectors × 1536 dimensions × 4 bytes/float = 5.7 GB (vectors only)
1 million vectors × 3072 dimensions × 4 bytes/float = 11.4 GB
```

Add metadata, indexes (HNSW can 2-4x the raw vector size), and overhead — a 1M-vector 1536-dimension collection uses ~15-25 GB in practice.

**More dimensions ≠ always better.** On the MTEB benchmark, 768-dimensional models often score within 1-2% of 1536-dimensional models for retrieval tasks. The marginal quality gain from doubling dimensions rarely justifies doubling storage and halving speed.

---

### Vector Normalization

Normalization scales a vector to unit length (magnitude = 1).

```typescript
function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map(v => v / magnitude);
}

// After normalization:
// ‖vector‖ = 1
// cosine_similarity(a, b) = dot_product(a, b)  // when both are normalized
```

**Which models normalize by default:**

| Model | Auto-Normalized? |
|-------|:---:|
| OpenAI text-embedding-3-small/large | Yes |
| OpenAI text-embedding-ada-002 | Yes |
| Cohere embed-v3 | Yes |
| BGE models | No (normalize yourself) |
| E5 models | No |
| Jina embeddings-v2 | Yes |

**If your model does not auto-normalize:** Normalize at ingestion time before storing. Then use dot product for faster queries. If you forget to normalize and use dot product, vectors with larger magnitudes will be ranked higher regardless of semantic relevance.

---

### Model Comparison Table

| Model | Dimensions | Max Tokens | MTEB Retrieval | Cost (per 1M tokens) | Latency | Multilingual | Notes |
|-------|:---:|:---:|:---:|:---:|:---:|:---:|-------|
| **OpenAI text-embedding-3-small** | 1536 | 8,191 | ~67 | $0.02 | Low | Moderate | Best cost/quality ratio for English. Supports dimension reduction. |
| **OpenAI text-embedding-3-large** | 3072 | 8,191 | ~69 | $0.13 | Low | Moderate | Highest quality from OpenAI. Matryoshka support (can truncate to 256-3072). |
| **Cohere embed-v3** | 1024 | 512 | ~68 | $0.10 | Low | Strong (100+ languages) | Excellent multilingual. Input type prefix (search_query vs search_document). Short context. |
| **Voyage voyage-3** | 1024 | 32,000 | ~69 | $0.06 | Low | Good | Long context. Strong for code (voyage-code-3). |
| **BGE-large-en-v1.5** | 1024 | 512 | ~64 | Free (self-hosted) | Varies | English only | Open source. Strong for its size. Needs normalization. |
| **BGE-M3** | 1024 | 8,192 | ~68 | Free (self-hosted) | Varies | Strong (100+ languages) | Supports dense + sparse + ColBERT in one model. |
| **E5-large-v2** | 1024 | 512 | ~63 | Free (self-hosted) | Varies | English only | Requires "query: " / "passage: " prefix. Solid open-source option. |
| **E5-Mistral-7B** | 4096 | 32,768 | ~70 | Free (self-hosted) | High (7B model) | Good | LLM-based embeddings. Highest quality but very expensive to run. |
| **GTE-large** | 1024 | 512 | ~63 | Free (self-hosted) | Varies | Moderate | Alibaba DAMO. Good general purpose. |
| **Jina embeddings-v3** | 1024 | 8,192 | ~67 | $0.02 | Low | Good | Task-specific LoRA adapters. Matryoshka support. |

**MTEB scores are approximate and vary by retrieval subset.** Always benchmark on your own data.

---

### Instruction-Tuned Embeddings

Some models produce better embeddings when you prepend a task-specific instruction or prefix to the input.

| Model | Query Prefix | Document Prefix |
|-------|-------------|----------------|
| E5 | `"query: "` | `"passage: "` |
| BGE | `"Represent this sentence for searching: "` | (none) |
| Cohere embed-v3 | `input_type="search_query"` | `input_type="search_document"` |
| Jina v3 | `task="retrieval.query"` | `task="retrieval.passage"` |

**If a model requires prefixes and you forget them:** Retrieval quality drops 5-15%. This is a silent failure — the API returns valid embeddings, just worse ones.

---

### Open-Source vs API Embeddings

| Factor | API (OpenAI, Cohere, Voyage) | Open-Source (BGE, E5, GTE) |
|--------|------------------------------|---------------------------|
| **Privacy** | Data sent to third-party API | Data stays on your infrastructure |
| **Cost at scale** | Per-token pricing adds up. 100M tokens/month = $2,000+ | GPU cost (inference server). Fixed cost regardless of volume. |
| **Latency** | Network round-trip (~50-200ms) | Local inference (~10-50ms with GPU) |
| **Throughput** | Rate-limited (3,000-10,000 RPM) | Limited by your GPU capacity |
| **Quality** | Generally higher MTEB scores | Competitive for top open-source models |
| **Operational burden** | Zero — managed API | Significant — inference server, GPU allocation, model updates |
| **Startup speed** | Immediate — API key and go | Days-weeks — set up inference infrastructure |

**Decision heuristic:**
- Prototyping / <10M tokens/month → API
- Production with privacy requirements → Open-source
- Production at >100M tokens/month → Open-source (cost crossover)
- Need the absolute best quality → Benchmark both, choose the winner on your data

---

### Domain-Specific Embeddings

General-purpose models are trained on broad web corpora. Domain-specific models or fine-tuned models can significantly outperform them in specialized domains.

| Domain | Why General Models Struggle | Solutions |
|--------|---------------------------|-----------|
| **Legal** | Legal terminology, citation formats, clause structure | Fine-tune on legal corpora, or use models trained on legal text |
| **Medical** | Medical abbreviations, drug names, diagnostic codes | PubMedBERT-based embeddings, fine-tune on clinical notes |
| **Code** | Syntax-heavy, variable names matter, cross-file references | Voyage-code-3, CodeBERT, StarCoder embeddings |
| **Finance** | Ticker symbols, financial jargon, tabular data | Fine-tune on SEC filings, financial reports |
| **Multilingual** | Low-resource languages, script differences | BGE-M3, Cohere embed-v3, multilingual E5 |

**When to fine-tune vs use a general model:**
- If your domain has unique vocabulary that general models haven't seen → fine-tune
- If your retrieval eval on domain data shows general models perform well → don't fine-tune
- Fine-tuning requires: ~1,000+ query-document pairs (positive + hard negatives), and the engineering effort to train and serve the model

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Forgetting instruction prefixes kills retrieval quality.**
You deploy an E5 model without adding `"query: "` and `"passage: "` prefixes. The API works fine — embeddings are returned, cosine similarities are computed, results are returned. But retrieval quality is 10-15% worse than benchmarks promised. No error, no warning. You blame the model or the chunking strategy, not realizing the fix is two string prefixes. **Fix:** Read the model documentation. Wrap the embedding call in a function that always applies the correct prefix based on whether the input is a query or a document.

**2. Mixing embeddings from different models in one collection.**
During a model migration, some chunks are embedded with the old model and some with the new one. Vectors from different models exist in incompatible spaces — their cosine similarity is meaningless. Queries return a mix of reasonable results (from the correct model) and random noise (from the other model). **Fix:** Never mix models in one collection. Use separate collections and the `embedding_model` metadata field to track provenance.

**3. Using cosine similarity on un-normalized vectors with dot product index.**
You configure your vector database to use dot product (for speed) but your embedding model (e.g., BGE) does not auto-normalize. Longer chunks produce vectors with larger magnitudes that consistently rank higher, regardless of relevance. **Fix:** Either normalize vectors at ingestion time or use cosine similarity distance in the DB configuration. Check your model's documentation for auto-normalization.

**4. 512-token model with 1000-token chunks.**
Your embedding model has a 512-token max context (Cohere embed-v3, BGE, E5). Your chunks are 800-1000 tokens. The model silently truncates at 512 tokens. The bottom half of every chunk is invisible to retrieval. **Fix:** Validate `chunk_tokens <= model_max_tokens` at ingestion. Alert on violations.

:::

## 🎯 Checkpoint

::: details Question 1 — Cosine vs Dot Product
**Q:** When does cosine similarity give different results from dot product? When are they equivalent? Which should you use for OpenAI embeddings?

**A:** Cosine similarity and dot product are equivalent when vectors are normalized to unit length. For normalized vectors, cosine similarity = dot product because the denominator (product of norms) equals 1. They differ when vectors have varying magnitudes: cosine measures only direction (angle), while dot product is influenced by both direction and magnitude. A longer vector gets a higher dot product score even if its direction is no more relevant. OpenAI embeddings (text-embedding-3-small/large) are normalized by default, so cosine and dot product give identical rankings. Use dot product for OpenAI embeddings — it is computationally cheaper (no norm calculation) and produces the same results. For models that do NOT auto-normalize (BGE, E5), either normalize manually and use dot product, or use cosine similarity directly.
:::

::: details Question 2 — Dimension Trade-offs
**Q:** You are choosing between text-embedding-3-small (1536 dims) and text-embedding-3-large (3072 dims) for a 5-million-document corpus. What are the concrete trade-offs?

**A:** Storage: 5M vectors at 1536 dims = ~28.7 GB raw vectors; at 3072 dims = ~57.4 GB. With HNSW index overhead (2-4x), that is ~60-115 GB vs ~115-230 GB. Query latency increases with dimension count — each similarity computation does more math, and the HNSW index is larger (more memory, more cache misses). Cost: text-embedding-3-large costs 6.5x more per token to embed ($0.13 vs $0.02 per 1M tokens). For 5M documents, initial embedding cost could be substantial. Quality: on MTEB retrieval benchmarks, the quality difference is ~2 percentage points (67 vs 69). Whether that 2% matters depends on the application — for a customer support chatbot, probably not; for a medical or legal system where every missed result has consequences, possibly. Recommendation: Start with text-embedding-3-small. Measure retrieval quality on your eval set. Only upgrade to large if the quality gap justifies the doubled storage and 6.5x embedding cost. OpenAI's Matryoshka support means you can even reduce text-embedding-3-large to 1024 or 512 dimensions, getting some quality benefit at reduced storage.
:::

::: details Question 3 — Dense vs Sparse
**Q:** A user searches for "RBAC configuration" in your documentation RAG system. A dense-only embedding search returns results about "role-based access control setup" and "permissions configuration" but misses the one document that actually has the acronym "RBAC" in its title. Why? How do you fix this?

**A:** Dense embeddings capture semantic meaning. The model knows "RBAC" relates to "role-based access control," but the cosine similarity between a short acronym and a long passage is often lower than the similarity between semantically related longer texts. The document titled "RBAC Configuration Guide" might score lower than "Setting Up Role-Based Permissions" because the latter has more semantic overlap with the query despite not containing the exact acronym. The fix is hybrid search: combine dense vector search (semantic similarity) with sparse/keyword search (BM25 or SPLADE). BM25 gives a high score to the exact term "RBAC" appearing in the document. By combining dense and sparse scores (e.g., weighted sum with Reciprocal Rank Fusion), you get semantic understanding AND exact keyword matching. Most production RAG systems use hybrid search for exactly this reason. Acronyms, product names, error codes, and technical terms are where dense-only search fails.
:::

## Key Mental Models

- **Embeddings are lossy compression of meaning.** They capture semantic direction in N-dimensional space, but they lose exact terms, acronyms, and rare words. Hybrid search compensates.
- **Cosine similarity is the safe default.** It ignores magnitude and measures pure directional similarity. For normalized vectors, dot product is equivalent and faster.
- **More dimensions ≠ always better.** The quality-to-cost ratio often peaks at 768-1024 dimensions. Benchmark on your data before doubling storage for marginal gains.
- **Instruction prefixes are not optional.** Models that require them (E5, BGE, Cohere) produce meaningfully worse embeddings without them. This is a silent failure.
- **Your embedding model is a long-term commitment.** Changing it means re-embedding your entire corpus. Choose carefully, version everything, and design for migration from day one.

## Related

- [Model Selection & Migration](02-model-selection.md) — choosing a model and living with the choice
- [Chunking Strategies](/rag/module-05/01-chunking-strategies.md) — what you embed depends on how you chunk
- [Chunk Size & Evaluation](/rag/module-05/02-chunk-size.md) — chunk size must fit embedding model max tokens
- [Vector DB Internals](/rag/module-08/01-vector-db-internals.md) — how embeddings are indexed and searched
- [Production Metadata Schema](/rag/module-06/01-metadata-schema.md) — storing embedding_model and embedding_version
