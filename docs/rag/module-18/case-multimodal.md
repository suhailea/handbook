---
title: "Case Study: Multimodal Document Assistant"
outline: deep
---

# Case Study 10 — Multimodal Document Assistant

**Scenario:** A consulting firm needs to search and query reports that contain mixed content: text, tables, charts, diagrams, and photographs. A typical report PDF has 50 pages with 15 tables, 10 charts, and embedded images.

**Requirements:**
- Extract information from tables, charts, and images — not just text.
- Queries like "What was the revenue trend shown in the chart on page 12?" must work.
- Maintain document layout fidelity (table structure, figure captions, page references).
- Support for 100K+ documents.

**Architecture:**

```text
┌──────────────┐     ┌──────────────────────────────────────────┐
│  Consultant  │────▶│  Multimodal RAG Orchestrator             │
└──────────────┘     └──────────┬──────────────────────────────┘
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Text Chunks     │  │  Table Chunks    │  │  Image/Chart     │
│  (pgvector)      │  │  (pgvector +     │  │  Descriptions    │
│                  │  │   structured)    │  │  (pgvector)      │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

**Ingestion Pipeline (the core challenge):**

```text
PDF ──▶ ┌──────────────────────────────────────────┐
        │  Step 1: Layout Analysis                 │
        │  (Document AI / LayoutLMv3 /             │
        │   unstructured.io)                       │
        │  Identifies: text blocks, tables,        │
        │    figures, headers, page numbers         │
        └──────┬──────────┬──────────┬─────────────┘
               ▼          ▼          ▼
        ┌────────────┐ ┌──────────┐ ┌──────────────┐
        │ Text       │ │ Tables   │ │ Images/Charts│
        │ Extraction │ │ to HTML/ │ │ to Vision LLM│
        │ to Markdown│ │ Markdown │ │ description  │
        └────────────┘ └──────────┘ └──────────────┘
               │          │              │
               ▼          ▼              ▼
        ┌──────────────────────────────────────┐
        │ Unified chunks with metadata:        │
        │ {content, type, page, position,      │
        │  parent_section, source_doc}         │
        └──────────────────────────────────────┘
```

**Table Handling:**
- Tables are extracted and stored in two forms:
  1. **Markdown representation** (for embedding and retrieval): the table rendered as a Markdown table.
  2. **Structured form** (for precise queries): rows and columns stored as JSON, enabling SQL-like queries ("What was the Q3 revenue in the APAC row?").
- Table captions and surrounding text are included in the chunk for context.

**Image and Chart Handling:**
- Images and charts are processed by a vision LLM (GPT-4o, Claude) to generate a textual description.
- Example: a bar chart becomes "Bar chart showing quarterly revenue from Q1 2024 to Q4 2024. Revenue grew from $12M to $18M, with the largest jump in Q3 (+$3M). APAC region contributed the most growth."
- The text description is embedded and searchable.
- The original image is stored and can be displayed alongside the generated answer.

**Retrieval Strategy:**
- Query runs against all three chunk types (text, table, image description) simultaneously.
- Results merged and reranked together.
- When a table or image chunk is retrieved, the surrounding text context is also fetched (parent section) for completeness.

**Reranking:**
- Cross-encoder reranker on the text content of all chunk types.
- Bonus scoring for chunks whose `page` metadata matches any page reference in the query.

**Generation:**
- Multimodal context: the LLM receives text chunks as text and can reference table data and image descriptions.
- For chart-related questions: the LLM receives the chart description + the original image (if using a vision-capable LLM) for verification.
- Citations include document name, page number, and element type (text/table/figure).

**Security:**
- Document-level access control: consultants only access their project's documents.
- Client confidentiality: documents tagged with `client_id`, retrieval filtered by authorized projects.

**Evaluation:**
- Table extraction accuracy: does the extracted table match the original? (Character-level comparison on a test set.)
- Chart description accuracy: does the generated description match what the chart shows? (Human evaluation.)
- Cross-modal retrieval: given a text query, does the system retrieve the relevant table or chart?

**Scaling:**
- Vision LLM processing is expensive (~$0.03 per image) — batch process during off-peak hours.
- Store generated descriptions; re-process only when the source document changes.
- For 100K documents with 25 visual elements each = 2.5M image processing calls. Budget: ~$75K one-time, plus incremental for new documents.

**Key Trade-offs:**
- Vision LLM descriptions are an approximation — complex charts may be described incorrectly. Always offer "view original" alongside the AI-generated description.
- Dual storage for tables (Markdown + structured) doubles storage but enables both semantic search and precise data queries.
- Layout analysis quality varies across PDF generators — invest in testing across document sources.
- **The lesson: multimodal RAG is really a parsing problem. The retrieval and generation are standard; the hard part is getting structured information out of unstructured documents.**
