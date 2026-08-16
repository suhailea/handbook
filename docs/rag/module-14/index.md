---
title: Module 14 — Security & Guardrails
outline: deep
---

# Module 14 — Security & Guardrails

RAG systems have a unique threat surface: they combine user input, retrieved documents, and LLM generation into a single pipeline. Each connection point is an attack vector. This module covers the security threats specific to RAG and the guardrails that protect the system at runtime.

## Why RAG Security Is Different

Traditional web security focuses on injection (SQL, XSS) and access control. RAG adds:

- **Prompt injection** -- users (or documents) can manipulate the LLM's behavior
- **Cross-tenant data leakage** -- retrieval can surface documents from the wrong user
- **The LLM is not a security boundary** -- it cannot reliably enforce access control

The core principle: **enforce security at the infrastructure layer, not the LLM layer.**

## Pages in This Module

| Page | Topic | Interview Weight |
|------|-------|-----------------|
| [RAG Security](01-security.md) | Prompt injection, data leakage, ACLs, PII, data poisoning | 🔥🔥🔥 |
| [Guardrails](02-guardrails.md) | Input, retrieval, output guardrails, runtime protection | 🔥🔥 |
| [Summary](summary.md) | Mental models and self-assessment |

## Prerequisites

- [Retrieval fundamentals](/rag/module-09/) -- understand metadata filtering
- [Generation & prompting](/rag/module-12/) -- understand how prompts are constructed
- Basic web security concepts (authentication, authorization)
