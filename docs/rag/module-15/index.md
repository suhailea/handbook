---
title: Module 15 — Advanced RAG Patterns
outline: deep
---

# Module 15 — Advanced RAG Patterns

Basic RAG follows a fixed pipeline: embed query, search vectors, pass chunks to LLM, return answer. This module covers architectures that go beyond this linear flow -- systems where the LLM decides *how* to retrieve, where knowledge graphs supplement vector search, where multiple modalities (images, audio, video) are indexed, and where external tools and human oversight are integrated.

## When You Need Advanced Patterns

Do not reach for these patterns by default. Start with basic RAG and add complexity only when you hit specific limitations:

| Limitation | Pattern |
|-----------|---------|
| Complex queries need multiple retrieval steps | [Agentic RAG](01-agentic-rag.md) |
| Questions about relationships between entities | [GraphRAG](02-graphrag.md) |
| Documents contain images, tables, audio | [Multimodal RAG](03-multimodal.md) |
| System needs to take actions, not just answer | [MCP (Model Context Protocol) & Human-in-the-Loop](04-mcp-hitl.md) |

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|-----------------|
| [Agentic RAG](01-agentic-rag.md) | Tool-based retrieval, multi-step, self-correction, routing | 🔥🔥🔥 |
| [GraphRAG](02-graphrag.md) | Knowledge graphs, entity extraction, graph + vector hybrid | 🔥🔥 |
| [Multimodal RAG](03-multimodal.md) | Images, OCR, audio, video, tables | 🔥🔥 |
| [MCP & Human-in-the-Loop](04-mcp-hitl.md) | Model Context Protocol, approval workflows, escalation | 🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |

## Prerequisites

- [Retrieval fundamentals](/rag/module-09/) -- understand basic retrieval before adding complexity
- [Generation & prompting](/rag/module-12/) -- understand how the LLM uses context
- [Evaluation](/rag/module-13/) -- you need metrics to justify the added complexity
