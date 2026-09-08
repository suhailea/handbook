---
title: Embeddings — Turning Words Into Numbers the Model Can Reason With
outline: deep
---

# Embeddings — Turning Words Into Numbers the Model Can Reason With

When we added semantic search to TaskFlow's support system, we needed it to understand that "my subscription expired" and "my account is cancelled" mean roughly the same thing — even though they share zero words. Classic keyword search fails here. Embeddings are how we solved it.

## What an embedding actually is

Every word, sentence, or document can be represented as a list of numbers — a **vector**. The trick is that this list isn't arbitrary. It's computed by a neural network trained to put similar meanings close together in the mathematical space those numbers define.

Think of it like a map, but for meaning. Cities geographically close to each other tend to be culturally, climatically, and economically similar too — proximity encodes real relationships. An embedding space works the same way: texts with similar meanings end up near each other, and texts with different meanings end up far apart.

So "subscription expired" and "account cancelled" end up close together in this space, even though they use different words, because they encode the same user situation. A keyword search can't see that. An embedding-based search can.

## The famous example that makes it click

Here's the one that tends to stop people: if you take the embedding vector for "King", subtract the vector for "Man", and add the vector for "Woman", you get a vector very close to "Queen."

That's not a trick or a coincidence — it's the system working as intended. The embedding space has learned that the relationship between "King" and "Queen" is the same as the relationship between "Man" and "Woman." Gender is encoded as a direction in the space. Royalty is encoded as another direction. The arithmetic works because the geometry reflects real semantic structure.

This is why embeddings aren't just "words turned into numbers." They're words turned into numbers *in a way that preserves and exposes meaning*.

## Embedding models vs language models

This is a distinction that trips up a lot of engineers.

A **language model** (GPT-4, Claude, Llama) generates text. You give it a prompt, it gives you back words, one token at a time. It's expensive per query, slow at scale, and sized for generation.

An **embedding model** (OpenAI's text-embedding-3-small, Cohere Embed, sentence-transformers) does something entirely different: you give it text, it gives you back a fixed-size list of numbers. No text generation. No token-by-token output. Just a vector. It's fast, cheap, and purpose-built for search and similarity.

The practical rule: use embedding models for retrieval, use language models for generation. In a RAG system, you use both — embeddings to find the relevant documents, a language model to synthesize the answer.

## What the numbers actually mean (and don't)

A typical embedding from OpenAI's text-embedding-3-small is a list of 1,536 numbers. Each number is a float between -1 and 1. No single number means anything on its own — meaning lives in the relationships between vectors (distances and angles), not in individual values.

More dimensions generally means more nuance. A 256-dimension embedding can distinguish broad topics; a 3,072-dimension embedding can distinguish subtle stylistic differences. But more dimensions also means more storage, more memory during retrieval, and slower similarity searches. You pick based on what your use case actually needs.

::: tip When you use embeddings in practice
Every RAG system follows the same pattern: at index time, you chunk your documents and generate an embedding for each chunk, storing them in a vector database (Pinecone, Qdrant, pgvector). At query time, you embed the user's question using the same model, then find the stored vectors closest to it. Those closest chunks are your retrieved context. The language model never sees your whole document library — just the relevant chunks the embeddings surfaced.
:::

## The gotcha engineers hit

Embeddings are model-specific. An embedding from OpenAI's model and an embedding from Cohere's model live in completely different spaces — you cannot mix them, compare them, or store them interchangeably. If you switch embedding models, you need to re-embed your entire document store. Plan for this before you go to production with a large corpus.

---

::: details Interview Question — What's the difference between an embedding model and a language model?

**Q:** A colleague suggests using GPT-4 for semantic search — just ask it "does this document match this query?" for each document. What's wrong with this approach, and what would you use instead?

**A:** The approach works in principle but doesn't scale. For a corpus of 10,000 documents, you'd make 10,000 API calls per query, each incurring latency and token cost for a full LLM forward pass. It would be slow (seconds to minutes per query) and expensive.

The right tool is an embedding model. At index time, you embed all 10,000 documents once and store the vectors. At query time, you embed only the query (one fast call) and run approximate nearest-neighbor search over the stored vectors — this takes milliseconds. The embedding model doesn't generate text; it encodes meaning into a fixed-size vector. Similarity search over vectors is a solved, fast problem. The language model only gets involved after retrieval, to synthesize an answer from the top-k retrieved chunks. Separation of concerns: embedding model for retrieval, language model for generation.

:::

---

[← 0.2 Training vs Inference](/ai-engineering/module-00/02-training-vs-inference) · [Next: 0.4 RLHF & Alignment →](/ai-engineering/module-00/04-rlhf)
