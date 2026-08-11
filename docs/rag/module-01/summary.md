---
title: Module 1 Summary — RAG Fundamentals
outline: deep
---

# Module 1 Summary — RAG Fundamentals

## Mental Models to Carry Forward

1. **Open-book exam.** RAG gives the LLM relevant pages at inference time. The quality of those pages is the ceiling for answer quality.

2. **Two paths, one system.** Offline ingestion (parse → chunk → embed → index) and online query (embed → search → rerank → generate) have completely different scaling, latency, and reliability requirements. Design them separately.

3. **Retrieval quality ceiling.** Generation quality cannot exceed retrieval quality. If your retriever has 70% recall, your end-to-end accuracy is capped below 70% regardless of how good the LLM is.

4. **RAG adds knowledge, fine-tuning adds behavior.** Need the model to know new facts? RAG. Need it to write in a specific style? Fine-tune. Need both? Combine them.

5. **Long-context is not a RAG killer — it is a complement.** For small corpora and low QPS, stuffing the context window is simpler. For large corpora, high QPS, or multi-tenant scenarios, RAG wins on cost, latency, and scalability by orders of magnitude.

6. **Structured data does not belong in embeddings.** If the data lives in rows and columns and the query is analytical, use SQL. Embeddings destroy the relationships that make structured data valuable.

7. **Start simple, add complexity only when measured failures demand it.** Naive RAG → Advanced RAG → Agentic RAG is a progression driven by evidence, not ambition.

## Self-Assessment Checklist

Before moving to Module 2, you should be able to:

- [ ] Draw the full RAG lifecycle (offline + online) from memory, labeling each component
- [ ] Explain to a non-technical stakeholder why RAG reduces hallucination (without using the word "embedding")
- [ ] Given a business scenario, decide whether RAG, fine-tuning, long-context, SQL, or an agent is the right tool — and justify with cost, latency, and accuracy trade-offs
- [ ] Explain the retrieval quality ceiling and why optimizing the retriever has higher ROI than optimizing the generator
- [ ] Describe the "lost in the middle" effect and calculate when RAG becomes cheaper than long-context stuffing
- [ ] Give an example where agentic RAG is necessary and standard RAG fails
- [ ] Identify when RAG is overkill (small corpus, structured data, pure reasoning tasks)

## What Comes Next

[Module 2 — System Requirements](../module-02/index.md) teaches you to define requirements *before* choosing any technology. The decisions from this module (RAG vs alternatives) become concrete when you specify data volume, latency targets, freshness SLAs, and security constraints.
