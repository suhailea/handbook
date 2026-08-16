---
title: "Case Study: Legal Document Search"
outline: deep
---

# Case Study 5 — Legal Document Search

**Scenario:** A law firm wants to search across 500K+ contracts, court filings, case law, and legal memos. Lawyers need to find *exact clauses* — not just semantically similar content, but the precise wording of a contractual obligation or legal precedent.

**Requirements:**
- Exact clause matching is critical (e.g., "find all contracts with an indemnification clause covering IP infringement").
- Long documents (contracts are 50--200 pages).
- Citation precision: every answer must reference the exact document, page, and section.
- Boolean search capability (AND, OR, NOT) alongside natural language.
- Privilege and confidentiality: some documents are client-privileged.

**Architecture:**

```text
┌──────────────┐     ┌──────────────────────────────────────┐
│  Lawyer UI   │────▶│  Search / QA Orchestrator            │
│  (Query +    │     │  ┌───────────┐  ┌─────────────────┐  │
│   Filters)   │     │  │ NL Query  │  │ Boolean Query   │  │
└──────────────┘     │  │ Pipeline  │  │ Pipeline        │  │
                     │  └─────┬─────┘  └────────┬────────┘  │
                     └────────┼─────────────────┼───────────┘
                              ▼                 ▼
                     ┌──────────────┐  ┌──────────────────┐
                     │  pgvector    │  │  Elasticsearch   │
                     │  (semantic)  │  │  (exact + BM25)  │
                     └──────┬───────┘  └────────┬─────────┘
                            └────────┬──────────┘
                                     ▼
                            ┌──────────────────┐
                            │  Cross-encoder   │
                            │  Reranker        │
                            └────────┬─────────┘
                                     ▼
                            ┌──────────────────┐
                            │  LLM (answer +   │
                            │  clause extract)  │
                            └──────────────────┘
```

**Ingestion Strategy:**
- OCR pipeline for scanned documents (many legacy contracts are scanned PDFs).
- Layout-aware parsing: preserve table structure, numbered clauses, section hierarchy.
- Chunking: **clause-level splitting** — each numbered clause or section is a chunk, not arbitrary token windows. Hierarchical: a clause chunk knows its parent section, parent document, and page range.
- Metadata: `document_type` (contract/case_law/memo), `client_id`, `matter_id`, `date_signed`, `parties[]`, `jurisdiction`, `privilege_status`.

**Retrieval Strategy:**
- **Hybrid search is essential, not optional.** A query like "indemnification for IP infringement" requires both:
  - Semantic search (understands that "hold harmless from intellectual property claims" is semantically equivalent).
  - Keyword search (finds the exact term "indemnification" even in contexts where the embedding misses it).
- Elasticsearch with custom legal analyzers (synonym expansion for legal terms).
- Boolean mode: lawyers can write `indemnification AND "intellectual property" NOT "bodily injury"` and get Elasticsearch results directly, without the vector path.
- RRF fusion of semantic + keyword results.

**Reranking:**
- Cross-encoder fine-tuned on legal text (domain-specific rerankers significantly outperform general-purpose ones on legal corpora).
- Top 10 results after reranking; all 10 shown as search results (lawyers want to see multiple results, not just one answer).

**Generation:**
- Two modes: **search mode** (return ranked results with snippets) and **QA mode** (synthesize an answer with citations).
- In QA mode: LLM extracts and quotes the exact clause text, provides the citation (document, section, page), and explains how it answers the question.
- Confidence indicator: if the retrieved clauses don't clearly answer the question, flag as "low confidence — manual review recommended."

**Security:**
- Client-matter privilege: chunks tagged with `client_id` and `matter_id`; retrieval filtered by the lawyer's authorized client-matters.
- Ethical wall enforcement: certain lawyers must not access certain client matters (conflict of interest).
- Audit trail: every search logged for compliance and malpractice defense.

**Evaluation:**
- Precision@10: legal search demands high precision (returning an irrelevant contract clause wastes expensive lawyer time).
- Exact clause retrieval: given a known clause, does the system find it?
- Citation accuracy: does the cited document/section actually contain the referenced text?

**Key Trade-offs:**
- Clause-level chunking produces uneven chunk sizes (some clauses are 20 tokens, others 2000) — but semantic coherence is more important than uniform size.
- OCR quality on old scanned documents is imperfect — invest in OCR quality scoring and flagging low-confidence parses.
- Fine-tuned legal reranker requires labeled data (expensive to create) but delivers 15-20% better precision than general-purpose rerankers.
- **The lesson: in domains where exact wording matters, hybrid search is not a nice-to-have — it is the core of the system.**
