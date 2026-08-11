---
title: Module 4 — Document Parsing
outline: deep
---

# Module 4 — Document Parsing

Garbage in, garbage out. If the parser misreads a PDF table, flattens a multi-column layout into nonsense, or strips headings that provide context, no embedding model or reranker can recover that information. Parsing is the unglamorous foundation that determines whether your RAG system returns useful answers or plausible-sounding fiction.

This module covers format-specific extraction strategies and the critical mistake of treating structured data (CSV, Excel) as unstructured text.

## Pages in This Module

| # | Page | What You Will Learn |
|---|------|---------------------|
| 1 | [Parsing Every Format](01-parsing-formats.md) | Format-by-format extraction: PDF, HTML, images, audio, code — tools, challenges, and RAG strategies for each |
| 2 | [CSV, Excel & Structured Data](02-csv-excel.md) | Why naive chunking destroys tabular data, and the right approach: NL-to-SQL, hybrid architectures, and knowing when embeddings are the wrong tool |
| — | [Summary](summary.md) | Mental models and self-assessment checklist |

## Prerequisites

- [Module 3 — Data Ingestion](../module-03/index.md): parsing is a stage within the ingestion pipeline.

## The Core Principle

The parser's job is to produce **clean, structured text with preserved semantics**. A table should remain a table. A heading should remain a heading. A list should remain a list. The moment structure is lost, retrieval quality drops — because the chunker and embedder downstream receive nonsense instead of meaning.
