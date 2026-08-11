---
title: Module 10 Summary — Query Processing
outline: deep
---

# Module 10 Summary — Query Processing

## Mental Models Gained

1. **Query processing is the translator** between human intent and machine retrieval. Raw user queries are messy, ambiguous, and context-dependent. The retrieval engine needs clean, specific input.

2. **Conversational rewriting is mandatory** for multi-turn RAG. Without resolving pronouns and implicit references from chat history, retrieval receives meaningless queries like "what about it?"

3. **Classification enables routing.** Not every query should go to the vector database. Aggregation queries need SQL, real-time data needs APIs, and out-of-scope queries need polite refusal.

4. **Multi-query and decomposition boost recall at the cost of latency.** Generating 3-5 query variants finds documents that a single query misses, but multiplies retrieval cost. Cap variants and set hard latency budgets.

5. **HyDE bridges the register gap** between how users ask (questions) and how documents are written (statements), but fails when the LLM cannot approximate the answer domain.

6. **Every LLM call in the pipeline adds latency.** Budget 500-1500ms total. Skip stages based on query type — simple factual queries do not need decomposition or HyDE.

7. **Query processing is the highest-ROI intervention** in most RAG systems. At ~$0.001/query, even small recall improvements pay for themselves many times over.

## Self-Assessment Checklist

- [ ] I can implement conversational rewriting that resolves pronouns using chat history
- [ ] I can explain the difference between query expansion, multi-query, and query decomposition
- [ ] I can design a query classification system with concrete categories and routing rules
- [ ] I can describe when HyDE helps vs hurts, and the failure modes of a wrong hypothesis
- [ ] I can build a complete query processing pipeline with classification-driven routing
- [ ] I can articulate the latency and cost trade-offs of each query processing stage
- [ ] I can detect and handle topic shifts in conversational rewriting
- [ ] I can evaluate whether query processing is worth its cost using recall and business metrics
