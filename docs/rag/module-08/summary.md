---
title: Module 8 Summary — Vector Databases
outline: deep
---

# Module 8 Summary — Vector Databases

## Mental Models

1. **HNSW is the production default.** It offers O(log N) queries with 95-99% recall. Understand its three parameters: M (graph connectivity), efConstruction (build quality), and ef (query recall-latency trade-off).

2. **Brute force is fine under 100K vectors.** Do not over-engineer. A flat scan on 50K vectors takes ~5ms. Add an HNSW index when you need it, not before.

3. **Pre-filter recall degrades with selectivity.** When your metadata filter selects a tiny subset of the HNSW graph, the search algorithm runs out of valid paths. Plan for this with per-partition indexes or flat-scan fallbacks on small subsets.

4. **Dimension must match the model.** This is a hard constraint, not a guideline. `VECTOR(1536)` for text-embedding-3-small, `VECTOR(3072)` for text-embedding-3-large. Mismatches are caught at insert time.

5. **pgvector is the pragmatic starting point.** If you already run PostgreSQL, adding pgvector is a one-line extension. You get full SQL (JOINs, complex filters, GIN indexes) with zero new infrastructure. Migrate to a dedicated vector DB only when you hit concrete limits.

6. **No HNSW index = sequential scan.** The most common pgvector mistake. Without `CREATE INDEX ... USING hnsw`, every query scans every row. Always verify with `EXPLAIN ANALYZE`.

7. **Connection pooling requires SET LOCAL.** In PgBouncer transaction mode, session-level `SET hnsw.ef_search` does not persist across queries. Use `SET LOCAL` inside a transaction or configure the default in postgresql.conf.

8. **Migration is a blue-green operation.** Whether changing embedding models or vector databases, the pattern is: build new alongside old, validate, switch atomically, keep old for rollback.

## Self-Assessment Checklist

- [ ] I can explain HNSW graph structure and how search traverses layers
- [ ] I understand M, efConstruction, and ef — what each controls and how to tune them
- [ ] I can compare HNSW, IVF, IVF-PQ, and flat indexes with trade-offs
- [ ] I know when pre-filter vs post-filter causes recall problems
- [ ] I can design a pgvector schema with table, vector column, HNSW index, and metadata indexes
- [ ] I can explain Pinecone namespace strategy for multi-tenant isolation
- [ ] I can configure a Qdrant collection with payload indexes and quantization
- [ ] I understand why dimension must match the embedding model exactly
- [ ] I can design a zero-downtime migration between vector databases
- [ ] I know why connection pooling matters for pgvector and how SET LOCAL fixes the ef_search problem
