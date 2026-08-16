---
title: "Case Study: Enterprise Knowledge Base"
outline: deep
---

# Case Study 1 — Enterprise Knowledge Base

**Scenario:** A 10,000-employee company wants employees to search internal docs — Confluence wikis, HR policies, engineering runbooks, product specs — through a chat interface. Multiple departments, strict access control.

**Requirements:**
- Multi-tenant: each department's docs isolated; users only see what they are authorized to access.
- Sources: Confluence, Google Drive, SharePoint, internal wikis, PDF uploads.
- Freshness: policy docs change quarterly; runbooks change weekly.
- Latency: < 3 s for answers; < 500 ms for search results.
- Scale: ~500K documents, ~2M chunks, ~5K daily queries.

**Architecture:**

```text
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Chat UI    │────▶│  API Gateway │────▶│  RAG Orchestrator│
│  (React)    │     │  (Auth/ACL)  │     │  (FastAPI)       │
└─────────────┘     └──────────────┘     └────────┬─────────┘
                                                   │
                    ┌──────────────────────────────┤
                    ▼                              ▼
          ┌─────────────────┐           ┌──────────────────┐
          │  Vector DB      │           │  Keyword Index   │
          │  (pgvector)     │           │  (Elasticsearch) │
          │  + ACL metadata │           │  + ACL filter    │
          └─────────────────┘           └──────────────────┘
                    │                              │
                    └──────────┬───────────────────┘
                               ▼
                    ┌──────────────────┐
                    │  Reranker        │
                    │  (Cross-encoder) │
                    └────────┬─────────┘
                             ▼
                    ┌──────────────────┐
                    │  LLM Generation  │
                    │  (GPT-4o/Claude) │
                    └──────────────────┘
```

**Ingestion Strategy:**
- Connectors for each source (Confluence API, Google Drive API) running on a scheduled cron (hourly for wikis, daily for policies).
- Each connector emits normalized `Document` objects with metadata: `source`, `department`, `acl_groups[]`, `last_modified`, `author`.
- Change-detection via `last_modified` timestamps or webhook triggers; only re-ingest changed docs.
- Parsing: Confluence HTML to Markdown via `markdownify`; PDFs via `unstructured`; Google Docs via export API.

**Chunking:**
- Recursive text splitter: 512 tokens, 64-token overlap.
- Metadata inheritance: every chunk carries the parent document's ACL groups, department, and source URL.
- Section-aware splitting: respect heading boundaries so chunks align with logical sections.

**Retrieval Strategy:**
- Hybrid search: pgvector cosine similarity + Elasticsearch BM25, fused via Reciprocal Rank Fusion (RRF).
- **ACL filtering is a pre-filter, not post-filter** — the query includes a `WHERE acl_groups && user_groups` clause so unauthorized chunks never leave the database.
- Top-k: retrieve 20 candidates from each index (40 total), fuse, take top 15.

**Reranking:**
- Cross-encoder reranker (Cohere Rerank or a fine-tuned model) on the 15 fused results.
- Final top 5 passed to generation.

**Generation:**
- System prompt enforces citation format: every claim must reference `[Source: doc_title, section]`.
- Streaming response via SSE.
- If no relevant chunks found (reranker scores all below threshold), return "I don't have information on that" instead of hallucinating.

**Security:**
- ACL enforcement at the database query level — defense in depth.
- Prompt injection defense: input/output guardrails, system prompt not exposed.
- Audit log: every query, retrieved chunks, and generated response logged with user ID.

**Evaluation:**
- Weekly eval suite: 200 curated Q&A pairs across departments.
- Metrics: retrieval recall@5, answer correctness (LLM-as-judge), citation accuracy, latency p95.
- A/B test new embedding models or chunking strategies against the eval suite before deploying.

**Scaling:**
- pgvector with IVFFlat index, partitioned by department for faster filtered queries.
- Read replicas for vector search under high load.
- Embedding generation is batched and async (queue-based).

**Key Trade-offs:**
- Pre-filtering ACLs reduces recall slightly (fewer candidates) but is non-negotiable for compliance.
- Elasticsearch adds operational cost but dramatically improves retrieval for exact-match queries (policy numbers, error codes).
- Hourly sync means up to 60 minutes of staleness — acceptable for most enterprise docs.
