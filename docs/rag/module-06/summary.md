---
title: Module 6 Summary — Metadata
outline: deep
---

# Module 6 Summary — Metadata

## Mental Models

1. **Metadata is the control plane.** Vectors find similar content; metadata controls who sees it, when it was written, where it came from, and how it was processed. Without metadata, you have a search engine. With it, you have a production system.

2. **Security is a database-layer concern.** Access control enforced via metadata filters is a hard boundary. Access control in the LLM prompt is a suggestion that can be bypassed. Never rely on the LLM for security.

3. **Citations require granular location metadata.** "Source: Employee Handbook" is useless. "Source: Employee Handbook, page 14, section Sick Leave > Eligibility" is actionable. Store `page`, `section`, `row_range` at ingestion time.

4. **Pipeline provenance enables debugging and migration.** When something goes wrong — or when you upgrade your chunking strategy or embedding model — you need to know exactly how each chunk was produced. Store `parser_version`, `chunking_strategy`, `chunk_size`, `embedding_model`, `embedding_version`.

5. **content_hash is your deduplication key.** Hash each chunk's text. Use it to skip re-embedding unchanged content and detect what changed between document versions.

6. **Flat schemas are universally supported.** Vector databases have limited metadata capabilities compared to relational databases. Stick to flat key-value pairs with simple types.

## Self-Assessment Checklist

- [ ] I can design a production metadata schema and justify every field
- [ ] I understand pre-filter vs post-filter and their implications for result quality
- [ ] I can implement multi-tenant isolation using metadata filters
- [ ] I know why access control must be enforced at the database layer, not the prompt
- [ ] I can build a citation system using source, uri, page, and section metadata
- [ ] I understand how content_hash enables deduplication and incremental re-indexing
- [ ] I can explain why pipeline provenance metadata is essential for auditability
