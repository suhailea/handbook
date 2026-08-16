---
title: Retrieval & Generation Metrics
outline: deep
---

# Retrieval & Generation Metrics

Interview weight: 🔥🔥🔥 | Prerequisites: [Retrieval fundamentals](/rag/module-09/), basic statistics

## 🗣️ In Plain English

::: tip In Plain English
Imagine you ask a librarian for the five most relevant books on a topic. **Retrieval metrics** measure how good the librarian is -- did they find the right books, and did they put the best one on top? **Generation metrics** measure the essay you write from those books -- did you stick to what the books actually say, or did you make stuff up? **System metrics** measure the library itself -- how long did you wait, how much did it cost, and how often was the library closed?
:::

## ⚙️ Under the Hood

### Retrieval Metrics

Every retrieval metric answers the same fundamental question: **given a query, how well did the retriever find the relevant documents?** To evaluate, you need a **ground-truth set** -- a mapping of queries to their known-relevant documents.

---

#### Recall@K

**What it measures:** Of all the documents that *should* have been retrieved, what fraction did we actually retrieve in the top K results?

**Formula:**

```text
Recall@K = |Relevant ∩ Retrieved@K| / |Relevant|
```

**Worked example:**

- Relevant documents for query: {D1, D2, D3, D5}
- Retrieved top-5: {D1, D3, D7, D9, D2}
- Relevant ∩ Retrieved = {D1, D3, D2} → 3 documents
- Recall@5 = 3 / 4 = **0.75**

**What "good" looks like:** Recall@10 >= 0.90 for most production RAG systems. Recall@5 >= 0.80 is a reasonable target. If recall is low, you are losing relevant documents before the LLM ever sees them.

**How to improve:**
- Increase K (retrieve more, filter later with reranking)
- Use hybrid retrieval (vector + keyword) to catch different match types
- Improve chunking -- smaller chunks may match more precisely
- Try different embedding models

---

#### Precision@K

**What it measures:** Of the K documents we retrieved, what fraction are actually relevant?

**Formula:**

```text
Precision@K = |Relevant ∩ Retrieved@K| / K
```

**Worked example:**

- Relevant documents: {D1, D2, D3, D5}
- Retrieved top-5: {D1, D3, D7, D9, D2}
- Relevant ∩ Retrieved = {D1, D3, D2} → 3 documents
- Precision@5 = 3 / 5 = **0.60**

**What "good" looks like:** Precision@5 >= 0.60 is typical. Precision matters when LLM context windows are limited or when you pay per token -- every irrelevant document wastes tokens and potentially confuses the model.

**How to improve:**
- Add a reranker after initial retrieval
- Set a minimum similarity threshold (drop low-scoring results)
- Reduce K (but watch recall drop)

---

#### Hit Rate (Hit@K)

**What it measures:** Did *at least one* relevant document appear in the top K? Binary -- 1 or 0 per query, then averaged across queries.

**Formula:**

```text
Hit@K = 1 if |Relevant ∩ Retrieved@K| > 0, else 0
Average Hit Rate@K = sum(Hit@K for all queries) / number of queries
```

**Worked example:**

- Query 1: relevant docs {D1, D2}, retrieved {D1, D5, D8} → Hit@3 = 1
- Query 2: relevant docs {D4}, retrieved {D7, D8, D9} → Hit@3 = 0
- Query 3: relevant docs {D3, D6}, retrieved {D6, D1, D2} → Hit@3 = 1
- Average Hit Rate@3 = (1 + 0 + 1) / 3 = **0.667**

**What "good" looks like:** Hit Rate@5 >= 0.95. If you cannot even get *one* relevant doc in the top 5, the system is fundamentally broken for that query class.

**How to improve:** Same strategies as Recall -- this metric catches total retrieval failures.

---

#### MRR (Mean Reciprocal Rank)

**What it measures:** How high up does the *first* relevant document appear? Rewards retrievers that put the best result at position 1.

**Formula:**

```text
Reciprocal Rank = 1 / rank_of_first_relevant_document
MRR = mean(Reciprocal Rank across all queries)
```

**Worked example:**

- Query 1: first relevant doc at position 1 → RR = 1/1 = 1.0
- Query 2: first relevant doc at position 3 → RR = 1/3 = 0.333
- Query 3: first relevant doc at position 2 → RR = 1/2 = 0.5
- MRR = (1.0 + 0.333 + 0.5) / 3 = **0.611**

**What "good" looks like:** MRR >= 0.70. High MRR means users typically see the right answer in position 1 or 2. Critical for systems where only the top-1 chunk is used.

**How to improve:**
- Reranking (a cross-encoder reranker specifically optimizes ranking order)
- Query expansion/rewriting to better match the top document
- Fine-tune embeddings on your domain

---

#### NDCG (Normalized Discounted Cumulative Gain)

**What it measures:** The most sophisticated retrieval metric. Unlike Recall/Precision (binary relevance), NDCG handles **graded relevance** (a document can be "highly relevant" = 3, "somewhat relevant" = 1, "irrelevant" = 0) and **rewards putting more relevant documents higher**.

**Formula:**

```text
DCG@K = Σ (2^rel_i - 1) / log₂(i + 1)  for i = 1 to K

IDCG@K = DCG@K for the ideal ranking (sort by relevance, descending)

NDCG@K = DCG@K / IDCG@K
```

**Worked example:**

Retrieved ranking with relevance scores: [3, 0, 2, 1, 0]

```text
DCG@5 = (2³-1)/log₂(2) + (2⁰-1)/log₂(3) + (2²-1)/log₂(4) + (2¹-1)/log₂(5) + (2⁰-1)/log₂(6)
       = 7/1 + 0/1.585 + 3/2 + 1/2.322 + 0/2.585
       = 7.0 + 0.0 + 1.5 + 0.431 + 0.0
       = 8.931

Ideal ranking: [3, 2, 1, 0, 0]
IDCG@5 = 7/1 + 3/1.585 + 1/2 + 0/2.322 + 0/2.585
        = 7.0 + 1.893 + 0.5 + 0.0 + 0.0
        = 9.393

NDCG@5 = 8.931 / 9.393 = 0.951
```

### Worked Example

NDCG@5 by hand. One query, 5 retrieved docs with graded relevance scores: [3, 2, 0, 1, 0].

**Log₂ discount table:**

| Position (i) | log₂(i+1) |
|:---:|:---:|
| 1 | log₂(2) = 1.000 |
| 2 | log₂(3) = 1.585 |
| 3 | log₂(4) = 2.000 |
| 4 | log₂(5) = 2.322 |
| 5 | log₂(6) = 2.585 |

**DCG@5** (using the simpler rel/log₂ formula):

```text
DCG@5 = rel₁/log₂(2) + rel₂/log₂(3) + rel₃/log₂(4) + rel₄/log₂(5) + rel₅/log₂(6)
      = 3/1.000 + 2/1.585 + 0/2.000 + 1/2.322 + 0/2.585
      = 3.000 + 1.262 + 0 + 0.431 + 0
      = 4.693
```

**Ideal ranking** (sort by relevance descending): [3, 2, 1, 0, 0]

```text
IDCG@5 = 3/1.000 + 2/1.585 + 1/2.000 + 0/2.322 + 0/2.585
       = 3.000 + 1.262 + 0.500 + 0 + 0
       = 4.762
```

**NDCG@5:**

```text
NDCG@5 = DCG / IDCG = 4.693 / 4.762 = 0.986
```

**Interpretation:** Our ranking is nearly ideal — the only issue is that the relevance-1 document sits at position 4 instead of position 3. Swapping positions 3 and 4 would give a perfect NDCG of 1.0.

---

**What "good" looks like:** NDCG@10 >= 0.80. An NDCG of 1.0 means your ranking is perfect.

**How to improve:**
- Reranking is the single biggest lever for NDCG
- NDCG is the metric to optimize when document relevance is not binary

---

### Retrieval Metrics Comparison Table

| Metric | Relevance Type | Position-Aware? | Best For |
|--------|---------------|-----------------|----------|
| Recall@K | Binary | No | "Did we find everything?" |
| Precision@K | Binary | No | "Did we avoid junk?" |
| Hit Rate@K | Binary | No | "Did we find at least one?" |
| MRR | Binary | Yes (first hit) | "Is the best result on top?" |
| NDCG@K | Graded | Yes (all positions) | "Is the full ranking good?" |

---

### Generation Metrics

Generation metrics evaluate the **LLM's output** given the retrieved context. These are harder to compute than retrieval metrics because there is no simple formula -- you typically need another LLM to judge.

---

#### Faithfulness / Groundedness

**What it measures:** Does the generated answer *only* contain information that can be supported by the retrieved context? This is the anti-hallucination metric.

**How it works (RAGAS approach):**

1. Decompose the generated answer into individual **claims** (statements of fact).
2. For each claim, check: can this claim be **inferred** from the provided context?
3. Faithfulness = number of supported claims / total claims.

**Worked example:**

- Context: "Python was created by Guido van Rossum and first released in 1991."
- Answer: "Python was created by Guido van Rossum in 1991. It is the most popular programming language."
- Claims: (1) "Python was created by Guido van Rossum" -- supported. (2) "first released in 1991" -- supported. (3) "It is the most popular programming language" -- NOT in context.
- Faithfulness = 2 / 3 = **0.667**

**What "good" looks like:** Faithfulness >= 0.90 for production systems. Below 0.80 means the LLM is routinely adding unsupported information.

**How to improve:**
- Stronger system prompts: "Only answer based on the provided context"
- Use citation-forcing prompts: require the LLM to quote sources
- Reduce temperature to near 0
- Provide more relevant context so the LLM does not need to fill gaps

---

#### Answer Relevance

**What it measures:** Does the answer actually address the user's question? An answer can be perfectly faithful to context but completely miss what the user asked.

**How it works (RAGAS approach):**

1. Generate N synthetic questions that the answer *would* be a good response to.
2. Compute cosine similarity between the original question and each synthetic question.
3. Answer Relevance = mean of these similarities.

**Worked example:**

- Original question: "What is the capital of France?"
- Answer: "France is a country in Western Europe with a rich cultural heritage."
- Generated questions from answer: "What is France?", "Where is France located?"
- Cosine similarity to original: 0.65, 0.45
- Answer Relevance = (0.65 + 0.45) / 2 = **0.55** (low -- the answer does not address the actual question)

**What "good" looks like:** Answer Relevance >= 0.85. Low relevance often means the retrieved context was about the right topic but the wrong aspect.

**How to improve:**
- Improve query understanding (query rewriting)
- Better retrieval (the LLM can only answer from what it receives)
- More specific system prompts

---

#### Answer Correctness

**What it measures:** Is the answer factually correct? Unlike faithfulness (which only checks against retrieved context), correctness checks against the **ground-truth answer**.

**How it works:**

1. Compare generated answer to a ground-truth answer.
2. Identify: True Positives (correct claims in both), False Positives (claims in generated but not in ground truth), False Negatives (claims in ground truth but missing from generated).
3. Compute F1 score from these, often combined with a semantic similarity score.

**Formula:**

```text
F1 = 2 * (Precision * Recall) / (Precision + Recall)

where:
  Precision = TP / (TP + FP)
  Recall = TP / (TP + FN)

Answer Correctness = w1 * F1 + w2 * semantic_similarity
(typical weights: w1 = 0.75, w2 = 0.25)
```

**Worked example:**

- Ground truth: "Python was created by Guido van Rossum in 1991. It uses indentation for scoping."
- Generated: "Python was created by Guido van Rossum in 1991. It is dynamically typed."
- TP = 2 (creator, year), FP = 1 (dynamically typed -- not in ground truth), FN = 1 (indentation scoping -- missing)
- Precision = 2/3 = 0.667, Recall = 2/3 = 0.667
- F1 = 2 * (0.667 * 0.667) / (0.667 + 0.667) = **0.667**

**What "good" looks like:** Correctness >= 0.80.

---

#### Citation Correctness

**What it measures:** When the answer cites a source (e.g., "[Source 2]"), does that source actually support the claim?

**Formula:**

```text
Citation Correctness = correct citations / total citations
```

**Worked example:**

- Answer: "The API rate limit is 1000 req/s [Source 1]. Retry with exponential backoff [Source 3]."
- Source 1 says: "Rate limit: 1000 requests per second" -- correct
- Source 3 says: "Use caching to reduce load" -- does NOT mention backoff
- Citation Correctness = 1 / 2 = **0.50**

**What "good" looks like:** >= 0.90. Wrong citations erode trust faster than no citations.

---

#### Citation Completeness

**What it measures:** Of all the claims that *could* be cited (because supporting sources exist in the context), how many actually *are* cited?

**Formula:**

```text
Citation Completeness = cited claims / citable claims
```

**What "good" looks like:** >= 0.80. Missing citations are less harmful than wrong citations but still reduce verifiability.

---

### Generation Metrics Comparison Table

| Metric | Needs Ground Truth? | Needs LLM Judge? | What It Catches |
|--------|-------------------|------------------|-----------------|
| Faithfulness | No (uses context) | Yes | Hallucination |
| Answer Relevance | No | Yes | Off-topic answers |
| Answer Correctness | Yes | Yes | Wrong answers |
| Citation Correctness | No (uses context) | Yes | Wrong attributions |
| Citation Completeness | No (uses context) | Yes | Missing attributions |

---

### System Metrics

System metrics measure the **operational health** of the RAG pipeline. These are standard observability metrics applied to the RAG context.

---

#### Latency

| Percentile | What It Measures | Target |
|-----------|-----------------|--------|
| P50 | Median response time | < 2s for simple queries |
| P95 | 95th percentile -- what slow users experience | < 5s |
| P99 | 99th percentile -- worst case excluding outliers | < 10s |

**Break down latency by stage** to find bottlenecks:

```text
Total Latency = Embedding Latency
              + Retrieval Latency
              + Reranking Latency
              + LLM Generation Latency (TTFT + token streaming)
```

Typical breakdown in production:
- Embedding: 20-50ms
- Vector search: 10-50ms (depends on index size and type)
- Reranking: 50-200ms (cross-encoder on 20 docs)
- LLM generation: 500ms-3s (dominates total latency)

---

#### Throughput

```text
QPS = queries processed per second
```

**What "good" looks like:** Depends entirely on your scale. A single Node.js process with streaming can handle 50-100 concurrent RAG queries if the bottleneck is the LLM API. Throughput is usually limited by LLM rate limits, not your infrastructure.

---

#### Cost Per Query

```text
Cost/Query = Embedding Cost + Retrieval Cost + Reranking Cost + LLM Cost

LLM Cost = (input_tokens * input_price + output_tokens * output_price)
```

**Worked example (approximate, mid-2025 pricing):**

- Embedding (OpenAI text-embedding-3-small): 100 tokens * $0.02/1M = $0.000002
- Vector search (managed Pinecone): ~$0.00001 per query
- Reranker (Cohere): ~$0.001 per 20 documents
- LLM (Claude Sonnet, 2000 input tokens + 500 output tokens): ~$0.0075
- **Total: ~$0.009 per query** (LLM dominates by 100x)

---

#### Token Usage

Track input and output tokens separately:
- **Input tokens** = system prompt + retrieved context + user query + conversation history
- **Output tokens** = generated answer

Monitor for: context window overflow, runaway conversation history, unnecessarily large chunks.

---

#### Cache Hit Rate

```text
Cache Hit Rate = cache hits / total queries
```

**What "good" looks like:** 20-40% for semantic cache, 5-15% for exact-match cache. Higher in customer support (many users ask the same questions), lower in research/analysis use cases.

---

#### Error Rate

```text
Error Rate = failed queries / total queries
```

Track by error type:
- LLM API errors (rate limits, timeouts)
- Vector DB errors (connection failures, index issues)
- Guardrail rejections (may or may not count as "errors")
- Empty retrieval (no documents above threshold)

**What "good" looks like:** < 1% for infrastructure errors. Guardrail rejections are separate.

---

### Choosing Your Metric Dashboard

For a production RAG system, instrument **at minimum**:

| Category | Must-Have Metrics |
|----------|-----------------|
| Retrieval | Recall@10 (offline eval), Hit Rate@5 (offline eval) |
| Generation | Faithfulness (sampled, LLM-judged) |
| System | P95 latency, error rate, cost per query, token usage |
| Business | User satisfaction (thumbs up/down), escalation rate |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Optimizing the wrong metric.** A team optimized Recall@20 to 0.98 by retrieving 20 chunks -- but the LLM's context window was overwhelmed with irrelevant text, and faithfulness dropped from 0.85 to 0.60. They were measuring retrieval in isolation while degrading the end-to-end system. **Always measure retrieval and generation together.**

**Metric gaming with LLM judges.** Using GPT-4 to judge faithfulness, a team found that verbose answers scored higher because the judge LLM had more text to match against. Short, correct answers scored lower. They discovered this only when human evaluation showed the opposite pattern. **Calibrate LLM judges against human labels regularly.**

**Ignoring latency distribution.** A team reported "average latency 1.2s" but P99 was 15s. The long-tail queries were ones that triggered agentic re-retrieval loops. Users experiencing 15s waits churned. **Always report percentiles, not averages.**

**No per-stage metrics.** When end-to-end quality dropped, the team could not tell if retrieval degraded (new documents poorly chunked) or generation degraded (LLM provider changed model weights). They had to rebuild the evaluation pipeline to add per-stage metrics. **Instrument each stage from day one.**
:::

## 🎯 Checkpoint

::: details Question 1 — Recall vs Precision tradeoff
**Q:** You increase K from 5 to 20 in your retrieval step. Recall@20 goes from 0.75 to 0.95. But your RAG system's answer quality (faithfulness) drops. Explain why and how you would fix it.

**A:** Increasing K improves recall because you retrieve more documents, increasing the chance of including relevant ones. However, you also retrieve more *irrelevant* documents. When all 20 chunks are stuffed into the LLM prompt, the noise dilutes the signal -- the LLM may latch onto irrelevant information or get confused by contradictions. Faithfulness drops because the LLM starts generating claims from irrelevant chunks.

**Fix:** Retrieve K=20 for high recall, then apply a **reranker** to re-score and select the top 5. This gives you the recall benefit of K=20 with the precision of K=5. Alternatively, set a similarity score threshold and drop low-scoring results regardless of K.
:::

::: details Question 2 — NDCG vs MRR
**Q:** When would you choose NDCG over MRR as your primary retrieval metric?

**A:** MRR only cares about the position of the **first** relevant document. It is ideal when you only use the top-1 result (e.g., a "I'm Feeling Lucky" search). NDCG evaluates the **entire ranking** and handles **graded relevance** (some documents are more relevant than others). Choose NDCG when: (1) you pass multiple chunks to the LLM and their quality matters, (2) documents have varying degrees of relevance (not just relevant/irrelevant), or (3) you want to optimize the ordering of all retrieved results. In most RAG systems, NDCG is the more informative metric because you pass 3-10 chunks and their relative quality affects generation.
:::

::: details Question 3 — Faithfulness vs Correctness
**Q:** A RAG system has faithfulness of 0.95 but answer correctness of 0.40. What is happening and how do you diagnose it?

**A:** High faithfulness means the LLM is sticking to the retrieved context -- it is not hallucinating. Low correctness means the answers are wrong compared to ground truth. This means the **retrieved context itself is wrong or incomplete**. The LLM is faithfully reproducing bad information.

Diagnosis: Check Recall@K. If recall is low, the retriever is not finding the right documents. If recall is high, the documents themselves may be outdated, incorrect, or the chunks may be cutting off critical information. The root cause is in the retrieval or ingestion pipeline, not the generation step.
:::

## Key Mental Models

- **Recall finds, precision filters, NDCG ranks** -- these are three different questions about retrieval quality, and you likely need all three.
- **Faithfulness is the RAG-specific metric** -- it uniquely measures whether the LLM is grounded in retrieved context, not just "correct" in general.
- **LLM cost dominates everything** -- embedding and retrieval costs are typically 100x cheaper than LLM generation. Optimize generation token usage first.
- **Percentiles over averages** -- P95 and P99 reveal the user experience that averages hide.
- **Per-stage metrics are non-negotiable** -- without them, debugging a quality regression becomes a guessing game.

## Related

- [Evaluation Frameworks & Datasets](02-frameworks.md) -- how to run these metrics at scale
- [Retrieval fundamentals](/rag/module-09/) -- the retrieval mechanisms these metrics evaluate
- [Reranking](/rag/module-11/) -- the primary lever for improving ranking metrics
