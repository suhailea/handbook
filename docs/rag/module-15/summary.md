---
title: Module 15 Summary — Advanced RAG Patterns
outline: deep
---

# Module 15 Summary — Advanced RAG Patterns

## Mental Models Gained

1. **Complexity is a cost, not a feature.** Every advanced pattern (agentic, graph, multimodal, MCP) adds latency, cost, and failure modes. Only adopt when basic RAG demonstrably fails on your specific queries. Measure the improvement.

2. **Agentic RAG trades latency for accuracy.** The LLM decides what to retrieve, evaluates results, and iterates. Powerful for complex multi-hop queries, overkill for simple FAQ. Route queries by complexity to avoid paying the agentic cost for easy questions.

3. **Graphs capture structure, vectors capture meaning.** Vector search finds semantically similar content. Graph search follows explicit relationships. Use graphs when questions are about connections between entities, not about content similarity.

4. **Describe-then-embed is the pragmatic default for multimodal.** Converting images, tables, and charts to text descriptions and using standard text embeddings is simpler, more accurate for text queries, and fits existing infrastructure. Use multimodal embeddings only when visual similarity search is required.

5. **MCP is a protocol, HITL is a policy.** MCP standardizes how LLMs access tools. HITL defines which tool uses require human approval. They are complementary layers, not alternatives.

## Self-Assessment Checklist

- [ ] Can you explain when agentic RAG is worth the complexity vs basic RAG?
- [ ] Can you design an agent with query decomposition, self-correction, and routing?
- [ ] Can you explain why vector search fails on multi-hop relational queries?
- [ ] Can you outline a knowledge graph construction pipeline (entity extraction, relationship extraction, entity resolution)?
- [ ] Can you compare describe-then-embed vs multimodal embeddings and recommend for a given use case?
- [ ] Can you design a PDF processing pipeline that handles text, images, and tables?
- [ ] Can you explain the difference between MCP tools and resources?
- [ ] Can you design a HITL policy with risk-appropriate approval levels?

## Pattern Selection Guide

| Your Problem | Pattern | Complexity | Latency Impact |
|-------------|---------|-----------|----------------|
| Simple factual Q&A | Basic RAG | Low | Baseline |
| Multi-step or multi-source queries | Agentic RAG | High | 3-10x |
| Relationship/connection queries | GraphRAG | High | 1.5-3x |
| Documents with images/tables | Multimodal RAG | Medium | 1.2-2x |
| System needs to take actions | MCP + HITL | Medium | Variable |
| All of the above | Hybrid (route by query type) | Very High | Query-dependent |
