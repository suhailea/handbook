---
title: Module 4 Summary — Document Parsing
outline: deep
---

# Module 4 Summary — Document Parsing

## Mental Models to Carry Forward

1. **Structure is information.** Headings, tables, lists, and formatting carry meaning. When the parser strips them, data is deleted — not just decoration. Preserve every structure that helps the LLM reason about the content.

2. **Route by format.** A universal "convert to text" function hides format-specific failures. PDF tables need pdfplumber. HTML needs boilerplate removal. Scanned docs need OCR. Each format has a dedicated parser that understands its structure.

3. **Tables are not text.** Flattening a table into a paragraph destroys the row-column relationships that give it meaning. Preserve tables as Markdown, or better yet, load them into a database and use SQL.

4. **Structured data needs structured tools.** CSVs and Excel files should be loaded into PostgreSQL/SQLite and queried with SQL for analytical questions. Embed only the free-text columns. Route queries by type: analytical to SQL, semantic to vector search, mixed to hybrid.

5. **Detect, do not assume.** Is the PDF scanned or digital? Does the Excel have merged cells? Is the HTML content or boilerplate? Detection before parsing prevents silent failures.

6. **Headers are meaning.** Without column headers, "95000" is meaningless. Without section headings, a paragraph loses its context. Never separate data from its structural context.

## Self-Assessment Checklist

Before moving to Module 5, you should be able to:

- [ ] Choose the right PDF parser for a given document type (PyMuPDF vs pdfplumber vs OCR vs vision LLM)
- [ ] Explain why naive chunking of CSV data produces wrong answers, with a specific example
- [ ] Design a hybrid architecture for a dataset with both structured and text columns
- [ ] Implement a query router that classifies questions as analytical, text search, or hybrid
- [ ] Handle Excel-specific challenges: multiple sheets, merged cells, formulas
- [ ] Extract main content from HTML while removing boilerplate
- [ ] Build a universal parser that routes to format-specific extractors
- [ ] Explain the trade-offs between OCR (Tesseract) and vision LLMs (GPT-4o) for image extraction

## What Comes Next

[Module 5 — Chunking Strategies](../module-05/index.md) takes the parsed text from this module and splits it into retrieval-sized pieces. The chunking strategy directly determines what the retriever can find — chunk too large and you waste context window; chunk too small and you lose meaning. Module 5 covers fixed-size, semantic, recursive, and document-aware chunking with production trade-offs.
