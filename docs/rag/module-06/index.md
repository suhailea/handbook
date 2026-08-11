---
title: Module 6 — Metadata
outline: deep
---

# Module 6 — Metadata

Vectors alone are not enough. In production, metadata is what makes the difference between a toy demo and a real system — it enables filtering, security, citations, versioning, and auditability.

This module covers a complete production metadata schema and shows how every field earns its place.

## Why This Module Matters

- **Security is not optional.** Without tenant_id and access_level filters, your RAG system leaks data across users. This is not a "nice to have" — it is a compliance requirement.
- **Citations build trust.** Users will not adopt a system that says "here is the answer" without showing where it came from.
- **Metadata filtering is your cheapest performance win.** Narrowing the search space before vector similarity runs cuts latency and improves relevance.

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|:---:|
| [Production Metadata Schema](01-metadata-schema.md) | Complete schema design with filtering, security, citations, versioning | 🔥🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |  |

## Prerequisites

- [Module 5 — Chunking](/rag/module-05/) — metadata attaches to chunks
- [Module 8 — Vector Databases](/rag/module-08/) — metadata filtering depends on DB capabilities
