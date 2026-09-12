---
title: Embeddings
outline: deep
---

# Embeddings

RAG, semantic search, and semantic caching all rest on one idea: turning text into a list of numbers such that similar meaning ends up as similar numbers. That's an embedding, and everything built on top of it is really just doing arithmetic on meaning.

::: tip Plain English
Imagine plotting every word or sentence as a point in space, positioned so that similar meanings land near each other — "dog" and "puppy" close together, "dog" and "spreadsheet" far apart. An embedding is exactly that point's coordinates, except the space has hundreds or thousands of dimensions instead of two. "Similarity" becomes something you can actually calculate: how close two points are.
:::

## What you're actually getting back

Call an embedding model with text, get back a fixed-length vector of numbers — typically 384 to 3,072 dimensions depending on the model. The vector by itself means nothing to a human; what matters is its relationship to other vectors.

```
embed("How do I cancel my subscription?")
  → [0.021, -0.183, 0.442, ..., 0.019]   (1,536 numbers)

embed("What's the process to end my plan?")
  → [0.019, -0.176, 0.438, ..., 0.024]   (very close to the vector above)

embed("What's the weather today?")
  → [-0.402, 0.118, -0.056, ..., 0.301]  (far from both)
```

Similarity is computed with cosine similarity — the angle between two vectors, not their raw distance, because it captures "pointing the same direction" (same meaning) regardless of magnitude. Nearly 1.0 means near-identical meaning; near 0 means unrelated.

## Where this actually shows up in your stack

**RAG retrieval** — embed the user's query, embed every document chunk in advance, find the chunks whose vectors are closest to the query's. This is the entire retrieval mechanism underneath the term "vector search."

**Semantic caching** ([3.6](/ai-engineering/module-03/06-semantic-caching)) — embed an incoming question, check if a sufficiently similar question was answered before, skip the model call entirely if so.

**Classification and routing** — embed a ticket, compare it to embeddings of known categories, route by nearest match — often cheaper and more consistent than an LLM call for simple routing.

| Task | Uses embeddings for |
|---|---|
| RAG retrieval | Finding relevant document chunks |
| Semantic caching | Matching near-duplicate questions |
| Deduplication | Finding near-identical content |
| Clustering / routing | Grouping similar items without an LLM call |

::: warning Watch out
Embedding models are not interchangeable — vectors from two different embedding models live in unrelated spaces, so comparing an embedding from Model A against one from Model B produces meaningless similarity scores. If you switch embedding models, you must re-embed your entire document store, not just new content going forward.
:::

::: details Interview Question — Why cosine similarity, not Euclidean distance?
**Q:** Why do embedding-based systems typically use cosine similarity rather than plain distance between vectors?
**A:** Cosine similarity measures the angle between two vectors, which captures directional alignment — "pointing the same way in meaning-space" — independent of vector magnitude. Two vectors can have different lengths (which can result from factors like text length or normalization differences) but still represent very similar meaning; Euclidean distance would penalize that magnitude difference even when the direction, which is what actually encodes meaning, is nearly identical.
:::

::: details Interview Question — Migrating embedding models
**Q:** You want to switch your RAG system from one embedding model to a newer, better one. What's involved beyond changing the API call?
**A:** Every existing document embedding must be regenerated with the new model — old and new embeddings aren't comparable, so mixing them silently breaks retrieval with no obvious error, just quietly worse results. For a large document store this is a real migration: re-embed everything, likely re-index the vector database, and validate retrieval quality against a test set before cutting over, rather than switching live.
:::

## Key Mental Models

**Embeddings turn "similar meaning" into "nearby vectors."** Every semantic search feature is built on that translation.

**Vectors from different models aren't comparable.** A model change means a full re-embedding, not an incremental one.

## Related

- [0.1 How Transformers Work](./01-how-transformers-work) — the attention mechanism that produces these representations
- [3.6 Semantic Caching](/ai-engineering/module-03/06-semantic-caching) — embeddings used to skip model calls
- [ML 1.5 Linear Algebra for AI](/ml-foundations/module-01/05-linear-algebra-for-ai) — the vector math underneath
