---
title: Chunking Strategies
outline: deep
---

# Chunking Strategies

**Interview weight:** 🔥🔥🔥 — asked in nearly every RAG design interview. You must know the trade-offs, not just the names.

**Prerequisites:** [Document Parsing](/rag/module-03/), [Text Extraction](/rag/module-04/)

## 🗣️ In Plain English

::: tip In Plain English
Imagine cutting a book into index cards so you can find the right card when someone asks a question. Cut too small and each card is meaningless. Cut too big and you hand over entire chapters when they only needed one paragraph. The art of chunking is choosing where to cut so that each card holds one complete idea — and can stand on its own.
:::

## ⚙️ Under the Hood

### The Problem Chunking Solves

Embedding models have a maximum input length (typically 512 to 8,192 tokens). Documents are longer. You must split documents into pieces that:

1. **Fit the embedding model's context window** — exceeding it causes silent truncation
2. **Carry a single coherent idea** — so cosine similarity is meaningful
3. **Contain enough context** — so the LLM can answer using the chunk alone
4. **Are small enough for precise retrieval** — so irrelevant content doesn't dilute the signal

There is inherent tension between points 2-3 (want bigger) and point 4 (want smaller). Every strategy below is a different bet on where the sweet spot lies.

---

### Strategy 1: Fixed-Size Chunking

Split text every N characters or N tokens, regardless of content.

```typescript
// run: npx ts-node fixed-chunk.ts
function fixedCharChunk(text: string, size: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + size));
    start += size - overlap;
  }
  return chunks;
}

// Token-based variant uses a tokenizer (tiktoken, etc.)
// Character-based is a proxy — 1 token ≈ 4 chars for English
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Every N chars/tokens |
| **Avg size** | Exactly N (except last chunk) |
| **Pros** | Dead simple, predictable sizes, fast |
| **Cons** | Splits mid-sentence, mid-word, mid-table. Destroys meaning at boundaries. |
| **Best for** | Prototyping, homogeneous prose with overlap to mitigate boundary issues |

**When to use:** First pass, baseline comparison, or when document structure is absent/unreliable. Always pair with overlap (10-20%) to reduce boundary damage.

---

### Strategy 2: Sentence-Based Chunking

Split on sentence boundaries (periods, question marks, exclamation marks), group N sentences per chunk.

```typescript
// run: npx ts-node sentence-chunk.ts
function sentenceChunk(text: string, sentencesPerChunk: number): string[] {
  // Simple sentence split — production code uses NLP tokenizers (e.g., nltk, spaCy)
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  const chunks: string[] = [];
  for (let i = 0; i < sentences.length; i += sentencesPerChunk) {
    chunks.push(sentences.slice(i, i + sentencesPerChunk).join(' ').trim());
  }
  return chunks;
}
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Sentence endings |
| **Avg size** | Variable (depends on sentence length) |
| **Pros** | Never splits mid-sentence, grammatically coherent |
| **Cons** | Highly variable chunk sizes. Abbreviations ("Dr.", "U.S.") break naive splitting. |
| **Best for** | Well-structured prose, legal documents, articles |

**Gotcha:** Sentence detection is harder than `text.split('.')`. Use a proper NLP sentence tokenizer for production (spaCy, NLTK punkt, or a regex-based tokenizer that handles abbreviations).

---

### Strategy 3: Paragraph-Based Chunking

Split on double newlines (`\n\n`), treating each paragraph as a chunk.

| Aspect | Detail |
|--------|--------|
| **Boundary** | Double newlines / blank lines |
| **Avg size** | Highly variable (50 to 2000+ tokens) |
| **Pros** | Respects author's natural groupings, easy to implement |
| **Cons** | Paragraphs vary wildly in length. Some are 1 sentence, some are 20. |
| **Best for** | Blog posts, documentation, anything with consistent paragraph formatting |

**Production note:** Often combined with a max-size cap — if a paragraph exceeds N tokens, fall back to sentence-based splitting within that paragraph.

---

### Strategy 4: Recursive Character Text Splitting

LangChain's `RecursiveCharacterTextSplitter` made this popular. It tries a hierarchy of separators, falling back to the next when a chunk is too large.

```typescript
// run: npx ts-node recursive-chunk.ts
const SEPARATORS = ['\n\n', '\n', '. ', ' ', ''];

function recursiveChunk(
  text: string,
  maxSize: number,
  separators: string[] = SEPARATORS
): string[] {
  const chunks: string[] = [];
  const sep = separators.find(s => text.includes(s)) ?? '';
  const parts = sep ? text.split(sep) : [text];

  let current = '';
  for (const part of parts) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length > maxSize && current) {
      chunks.push(current.trim());
      current = part;
    } else if (candidate.length > maxSize && !current) {
      // This single part exceeds maxSize — recurse with next separator
      const nextSeps = separators.slice(separators.indexOf(sep) + 1);
      if (nextSeps.length > 0) {
        chunks.push(...recursiveChunk(part, maxSize, nextSeps));
      } else {
        chunks.push(part.slice(0, maxSize)); // hard cut as last resort
      }
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Tries `\n\n` → `\n` → `. ` → ` ` → character |
| **Avg size** | Close to target (within separator granularity) |
| **Pros** | Respects structure when possible, degrades gracefully, good default |
| **Cons** | Still heuristic — doesn't understand meaning, just whitespace patterns |
| **Best for** | General-purpose. The most common production default. |

**Why it works:** Most documents have structure (paragraphs, sections). By trying the largest separators first, you preserve that structure. You only fall back to word/character splitting for dense blocks without whitespace structure.

---

### Strategy 5: Semantic Chunking (Kamradt Method)

Embed individual sentences, then split where the cosine similarity between consecutive sentences drops below a threshold.

```
Sentence 1  ──embed──→  [0.23, 0.87, ...]  ┐
                                              ├── similarity: 0.91 (same topic)
Sentence 2  ──embed──→  [0.25, 0.85, ...]  ┘
                                              ├── similarity: 0.42 (topic shift!) ← SPLIT HERE
Sentence 3  ──embed──→  [0.71, 0.12, ...]  ┐
                                              ├── similarity: 0.88 (same topic)
Sentence 4  ──embed──→  [0.69, 0.15, ...]  ┘
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Where semantic similarity drops (threshold or percentile-based) |
| **Avg size** | Variable — depends on topic density |
| **Pros** | Chunks align with actual topic boundaries, not arbitrary positions |
| **Cons** | Requires embedding every sentence (slow, costly). Threshold tuning. Variable sizes. |
| **Best for** | High-value corpora where chunk quality justifies compute cost |

**Breakpoint methods:**
- **Percentile:** Split at the bottom N% of similarity scores (e.g., bottom 25%)
- **Standard deviation:** Split where similarity drops more than 1-2 standard deviations below mean
- **Gradient:** Split where the rate of similarity change is steepest

**Production consideration:** This is expensive at ingestion time. You are making one embedding API call per sentence. For a 10,000-page corpus, that can be millions of sentences. Use it selectively — for your highest-value documents, not for bulk ingestion.

---

### Strategy 6: Structure-Aware Chunking

Parse the document's structure (Markdown headers, HTML tags, document outline) and chunk along structural boundaries.

```typescript
// run: npx ts-node structure-chunk.ts
function markdownChunk(markdown: string): Array<{ heading: string; content: string }> {
  const sections = markdown.split(/(?=^#{1,3}\s)/m);
  return sections
    .filter(s => s.trim())
    .map(section => {
      const lines = section.split('\n');
      const heading = lines[0]?.replace(/^#+\s*/, '') ?? 'Untitled';
      const content = lines.slice(1).join('\n').trim();
      return { heading, content };
    });
}

// For HTML: use a DOM parser (cheerio, jsdom) to split by <h1>-<h3>, <section>, <article>
// For PDF: use extracted outline/TOC to identify section boundaries
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Document structure: headers, sections, HTML tags |
| **Avg size** | Variable — depends on document structure |
| **Pros** | Semantically meaningful boundaries, preserves context hierarchy |
| **Cons** | Requires structured input. Flat documents (no headers) get no benefit. |
| **Best for** | Documentation, technical manuals, knowledge bases with consistent structure |

**Key insight:** You can (and should) prepend the section heading hierarchy to each chunk for context. A chunk that says "Use `--force` to override" is useless without knowing it's from "Git > Push > Options."

---

### Strategy 7: Code Chunking

Split code by syntactic units: functions, classes, methods, or AST nodes.

```typescript
// Conceptual — real implementation uses tree-sitter or language-specific parsers
interface CodeChunk {
  type: 'function' | 'class' | 'method' | 'module';
  name: string;
  language: string;
  content: string;
  startLine: number;
  endLine: number;
  docstring?: string;
}

// Strategy: parse AST → extract top-level declarations → each becomes a chunk
// For large classes: split into method-level chunks with class context prepended
// Always include: imports, type definitions that the chunk references
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | AST nodes: function, class, method boundaries |
| **Avg size** | Variable — one function could be 5 lines or 500 |
| **Pros** | Each chunk is a complete, meaningful code unit |
| **Cons** | Requires language-specific parsers (tree-sitter). Large functions still need splitting. |
| **Best for** | Code search, developer documentation, code Q&A systems |

**Production pattern:** For code RAG, prepend metadata context:
```
File: src/auth/jwt.ts
Class: JwtService
Method: validateToken
---
async validateToken(token: string): Promise<TokenPayload> { ... }
```

---

### Strategy 8: Table Chunking

Tables are the hardest content type to chunk. Naive text splitting destroys row-column relationships.

**Strategies:**
1. **Full table as one chunk** — works if tables are small. Prepend the table caption/title.
2. **Row-by-row with headers** — repeat column headers with each row or row group.
3. **Serialize to natural language** — convert each row to a sentence: "Product X has price $50 and rating 4.5."
4. **Structured extraction** — store tables as JSON/CSV in metadata, use a different retrieval path.

| Aspect | Detail |
|--------|--------|
| **Boundary** | Table boundaries, optionally row groups |
| **Avg size** | Varies — small tables fit in one chunk, large tables need splitting |
| **Pros** | Preserves tabular structure that text splitting destroys |
| **Cons** | Requires table detection in the parser. Row-by-row creates many small chunks. |
| **Best for** | Financial reports, product catalogs, data-heavy PDFs |

**The cardinal rule:** Never let a generic text splitter run through a table. It will interleave headers with data from different rows and produce nonsense.

---

### Strategy 9: Parent-Child / Hierarchical Chunking

Create two levels of chunks: small chunks for retrieval precision, linked to larger parent chunks for context.

```
Document
└── Parent chunk (e.g., full section, ~1500 tokens)
    ├── Child chunk 1 (e.g., paragraph, ~300 tokens)  ← embed & search this
    ├── Child chunk 2 (~300 tokens)                    ← embed & search this
    └── Child chunk 3 (~300 tokens)                    ← embed & search this

At query time:
1. Search child chunks → find Child chunk 2
2. Return Parent chunk (or the full section) to the LLM
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Two-tier: parent (section/page) and child (paragraph/sentence) |
| **Avg size** | Child: 200-400 tokens. Parent: 800-2000 tokens. |
| **Pros** | Precise retrieval + rich context. Best of both worlds. |
| **Cons** | More complex indexing. Must store parent-child relationships. More storage. |
| **Best for** | When retrieval precision and answer quality are both critical |

**Implementation:** Store child chunks with a `parent_id` field in metadata. At query time, retrieve top-K children, deduplicate by parent, fetch parent content.

---

### Strategy 10: Contextual Chunking

Prepend contextual information to each chunk: the document title, section heading hierarchy, or a short document summary.

```
BEFORE (raw chunk):
"Use --force to override the safety check. This skips pre-push hooks."

AFTER (contextual chunk):
"Document: Git Reference Manual | Section: Push > Options |
Use --force to override the safety check. This skips pre-push hooks."
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Same as underlying strategy (any of the above) |
| **Avg size** | Underlying size + 20-100 tokens of context |
| **Pros** | Dramatically improves retrieval — the embedding now captures topic, not just content |
| **Cons** | Increases chunk size. Context prepending adds token cost. |
| **Best for** | Always. This is a near-universal improvement applied on top of any strategy. |

**Anthropic's "Contextual Retrieval" paper** showed that prepending a short LLM-generated context summary to each chunk reduced retrieval failure by 49%. The cost is one LLM call per chunk at ingestion time — expensive, but the quality gain is massive.

---

### Strategy 11: Late Chunking (Jina AI)

Conventional chunking splits text first, then embeds each chunk independently. Late chunking reverses this: embed the full document, then chunk the embeddings.

```
Conventional:
Document → split into chunks → embed each chunk independently

Late Chunking:
Document → embed full document (all tokens get contextual embeddings)
         → split the token embeddings at chunk boundaries
         → pool each chunk's token embeddings into one vector
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Any boundary method (applied after embedding, not before) |
| **Avg size** | Same as chosen boundary method |
| **Pros** | Each chunk's embedding benefits from full-document context. Pronouns, references resolved. |
| **Cons** | Requires models that output per-token embeddings + long context. Not all models support this. |
| **Best for** | Documents with heavy cross-references, pronouns, anaphora |

**Why it matters:** In conventional chunking, a chunk that says "He increased it by 50%" embeds poorly because "he" and "it" have no referent. With late chunking, the embedding model saw the full document, so the token embeddings for "he" already encode "the CEO" and "it" encodes "the marketing budget."

---

### Strategy 12: Sentence-Window Retrieval

Embed individual sentences for maximum retrieval precision. At generation time, expand the window to include N surrounding sentences.

```
Index: embed each sentence individually
Query: find the best-matching sentence
Return to LLM: the matched sentence ± 2-5 surrounding sentences
```

| Aspect | Detail |
|--------|--------|
| **Boundary** | Single sentences (for retrieval), expanded window (for generation) |
| **Avg size** | 1 sentence for index; 3-10 sentences at generation |
| **Pros** | Maximum retrieval precision. Context expands only when needed. |
| **Cons** | Massive number of vectors (one per sentence). Storage + query cost. |
| **Best for** | FAQ systems, fact-heavy domains, precise question answering |

---

### Strategy Comparison Table

| Strategy | Boundary | Avg Size | Semantic Coherence | Implementation Complexity | Compute Cost | Best For |
|----------|----------|----------|-------------------|--------------------------|--------------|----------|
| Fixed-size | N chars/tokens | Exact | Low | Trivial | None | Prototyping |
| Sentence | Sentence endings | Variable | Medium | Low | None | Prose documents |
| Paragraph | Double newlines | Variable | Medium-High | Low | None | Blogs, docs |
| Recursive | Multi-level separators | ~Target | Medium | Low | None | General-purpose default |
| Semantic | Similarity drop | Variable | High | Medium | High (embed every sentence) | High-value corpora |
| Structure-aware | Headers/tags | Variable | High | Medium | None | Technical docs |
| Code | AST nodes | Variable | High | High (needs parser) | None | Code search |
| Table | Table boundaries | Variable | High | Medium | None | Data-heavy documents |
| Parent-child | Two-tier | Child: small, Parent: large | High | Medium | None | Precision + context |
| Contextual | Any + prepended context | Base + 20-100 tokens | Very High | Low | Medium (LLM call per chunk) | Nearly everything |
| Late chunking | Post-embedding | Same as boundary method | Very High | High | High (long-context embedding) | Reference-heavy docs |
| Sentence-window | Sentence → expand | 1 sentence → N sentences | High | Medium | High (many vectors) | Fact-dense Q&A |

---

### Choosing a Strategy: Decision Framework

```
Start here:
│
├── Prototyping / quick baseline?
│   └── Recursive with 500 tokens, 10% overlap
│
├── Documents have clear structure (headers, sections)?
│   └── Structure-aware + contextual prepending
│
├── Code repository?
│   └── AST-based code chunking
│
├── Tables / financial data?
│   └── Table-aware chunking (serialize or row-with-headers)
│
├── Need high precision AND rich context?
│   └── Parent-child hierarchical
│
├── High-value corpus, budget for compute?
│   └── Semantic chunking OR late chunking
│
└── General production system?
    └── Recursive + contextual prepending + parent-child for critical docs
```

**In practice, production systems combine strategies.** A document pipeline might:
1. Detect document type (code, table, prose, structured)
2. Apply the appropriate strategy per document type
3. Add contextual prepending to all chunks
4. Store parent-child links for key documents

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. The "it depends" chunk that answers nothing.**
A user asks "What is the refund policy?" and the top chunk is: "For details, see the policy described above." This happens when chunks are too small and lose referential context. The information was in the *previous* chunk. **Fix:** Use contextual prepending, parent-child retrieval, or increase chunk size. Test with real queries.

**2. Table destruction.**
A financial analyst asks "What was Q3 revenue?" and the retriever returns a chunk that contains row headers from Q1 interleaved with data from Q3 because a fixed-size splitter ran through a table. The LLM hallucinates a number. **Fix:** Detect tables during parsing. Apply table-specific chunking. Never let generic text splitters touch tabular data.

**3. The "re-chunking crisis."**
Six months in, you realize your chunking strategy is wrong. But you have 2 million chunks in production. Re-chunking means re-parsing, re-embedding, re-indexing everything. If you didn't store `chunking_strategy` and `chunk_size` in metadata, you don't even know what the current chunks look like. **Fix:** Always store chunking parameters in metadata. Build your pipeline to support re-ingestion from source documents.

**4. Code context loss.**
A developer asks "How does the auth middleware work?" and gets a chunk containing just the function body — no imports, no class name, no file path. The LLM can't tell what framework or language it's even looking at. **Fix:** Always prepend file path, class name, and critical imports to code chunks.

:::

## 🎯 Checkpoint

::: details Question 1 — Recursive vs Semantic
**Q:** You have 50,000 internal documentation pages (Markdown with headers). You need a chunking strategy that balances quality and ingestion cost. Would you choose recursive text splitting or semantic chunking? Justify your answer.

**A:** Recursive text splitting is the better choice here. The documents already have structural boundaries (Markdown headers), which recursive splitting leverages effectively. Semantic chunking would require embedding every sentence across 50,000 pages — potentially millions of embedding API calls — just for chunk boundary detection. The marginal quality improvement rarely justifies that cost for structured documents. A better investment: use recursive splitting with structure-aware separators (split on `##` before `\n\n`), then apply contextual prepending (add section heading hierarchy to each chunk). This gets 80-90% of the benefit of semantic chunking at a fraction of the cost.
:::

::: details Question 2 — Parent-Child Trade-offs
**Q:** Explain the parent-child chunking strategy. What problem does it solve that plain chunking cannot, and what are the operational costs?

**A:** Parent-child chunking solves the precision-vs-context dilemma. Small chunks (200-300 tokens) are embedded and searched for high retrieval precision. Each small chunk stores a `parent_id` linking to a larger parent chunk (800-2000 tokens). At query time, you search child chunks, deduplicate by parent, and pass the parent content to the LLM. This gives you precise vector matching AND enough context for good answers. The costs: (1) double storage — you store both levels, (2) more complex indexing pipeline — you must track parent-child relationships, (3) an extra fetch at query time — retrieve children, then fetch parents, (4) deduplication logic — if multiple children from the same parent match, you need to collapse them. It's worth it when answer quality is critical and documents are long enough that full-document retrieval would dilute relevance.
:::

::: details Question 3 — Late Chunking
**Q:** What is late chunking, and why does it produce better embeddings than conventional chunking for documents with many pronouns and cross-references?

**A:** In conventional chunking, you split the document into chunks first, then embed each chunk independently. Each chunk's embedding is computed in isolation — the embedding model never sees the full document. If a chunk says "He increased it by 50%," the model has no way to resolve "he" or "it," so the embedding captures vague meaning. Late chunking reverses the order: you pass the full document through a long-context embedding model, which produces per-token embeddings where each token's vector is informed by the entire document context. Then you split the token embeddings at chunk boundaries and pool them into per-chunk vectors. The embedding for "He increased it by 50%" now encodes the full referential context because the model saw the whole document when computing token representations. The limitation: it requires embedding models that support long contexts and output per-token embeddings (not all do), and it's more compute-intensive than conventional chunking.
:::

## Key Mental Models

- **Chunking is a retrieval decision, not a text-processing decision.** Every split affects what the vector search can find and what the LLM will see.
- **There is no universal best strategy.** The right approach depends on document type, query patterns, and budget. Production systems combine strategies.
- **Contextual prepending is the highest-ROI improvement** you can apply on top of any chunking strategy. Adding section titles and document context to each chunk is almost always worth it.
- **Tables and code need special treatment.** Generic text splitters destroy the structure that makes these content types useful.
- **Store your chunking parameters in metadata.** You will re-chunk. Make sure you know what you're re-chunking from.

## Related

- [Chunk Size, Overlap & Evaluation](02-chunk-size.md) — how to pick the right size and measure quality
- [Production Metadata Schema](/rag/module-06/01-metadata-schema.md) — storing chunking parameters for auditability
- [Embedding Models & Similarity](/rag/module-07/01-embeddings-similarity.md) — how chunk content affects embedding quality
- [Vector DB Internals](/rag/module-08/01-vector-db-internals.md) — how chunks become searchable vectors
