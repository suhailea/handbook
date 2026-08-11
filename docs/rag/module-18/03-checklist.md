---
title: Production Checklist
outline: deep
---

# Production Checklist

Interview weight: 🔥🔥🔥 | Prerequisites: [Case Studies](01-case-studies.md), [Reference Implementation](02-implementation.md) | Use: pre-launch audit for any RAG system

## 🗣️ In Plain English

::: tip In Plain English
This is the pre-flight checklist that pilots run before takeoff. No single item is complicated, but missing any one of them can bring the whole system down. Print it, tape it to your monitor, and go through it before every RAG deployment.
:::

## ⚙️ Under the Hood

### Data

- [ ] All data sources identified and documented (APIs, databases, file stores, crawlers)
- [ ] Data ownership and licensing verified — you have the right to ingest and serve this content
- [ ] PII/PHI audit completed — sensitive data identified and handling strategy defined (scrub, encrypt, or exclude)
- [ ] Data volume estimated: total documents, total chunks, expected growth rate per month
- [ ] Data freshness requirements defined: which sources need real-time sync vs. daily vs. weekly
- [ ] Deduplication strategy in place — content hashing to prevent duplicate documents

### Ingestion

- [ ] Ingestion pipeline is idempotent — re-ingesting the same document produces the same result, not duplicates
- [ ] Change detection implemented — only re-process documents that have actually changed (hash comparison or `last_modified`)
- [ ] Ingestion is asynchronous — API returns immediately, processing happens in background workers
- [ ] Failed ingestion retries with exponential backoff; poison documents are sent to a dead-letter queue
- [ ] Ingestion throughput tested: can you process your full corpus in a reasonable time? (Hours, not weeks)
- [ ] Rollback capability: can you revert to the previous version of a document's chunks if ingestion produces bad results?

### Parsing

- [ ] Parser handles all expected file types: PDF, DOCX, HTML, Markdown, TXT, PPTX, XLSX
- [ ] PDF parsing tested on scanned documents (OCR quality), digital-native PDFs, and mixed PDFs
- [ ] Table extraction tested — tables are parsed as structured data, not flattened to gibberish text
- [ ] Image/chart handling defined: skip, OCR, or vision-LLM description
- [ ] Encoding issues handled: UTF-8, Latin-1, Windows-1252, BOM markers
- [ ] Parsing errors logged with document ID for debugging; failures don't crash the pipeline

### Chunking

- [ ] Chunk size tuned and justified (not just the default) — tested with your actual queries
- [ ] Chunk overlap configured to prevent information loss at boundaries
- [ ] Section-aware splitting: chunks respect heading/section boundaries where possible
- [ ] Metadata inherited from parent document to every chunk (source, ACL, timestamps)
- [ ] Chunk size distribution analyzed: no pathologically small (< 50 tokens) or large (> 2000 tokens) chunks
- [ ] Special content types handled: code blocks kept intact, tables chunked as units, lists not split mid-item

### Metadata

- [ ] Every chunk carries: `document_id`, `source`, `tenant_id`, `acl_groups`, `created_at`
- [ ] Domain-specific metadata defined: `section_title`, `page_number`, `category`, `language`, `version`
- [ ] Metadata is queryable: indexed columns, not buried in a JSON blob (for filtering performance)
- [ ] Metadata schema documented and enforced at ingestion time

### Embeddings

- [ ] Embedding model selected with justification (dimension, performance on your domain, cost)
- [ ] Embedding model version pinned — model upgrades require re-embedding the full corpus
- [ ] Batch embedding implemented with retry logic and rate-limit handling
- [ ] Embedding latency measured: how long to embed your full corpus? How long for a single query?
- [ ] Dimensionality and storage cost calculated: dimensions x chunks x 4 bytes = total vector storage
- [ ] Fallback for embedding API outages: queue and retry, or use a local model

### Vector Database

- [ ] Vector DB selected with justification (pgvector, Pinecone, Qdrant, Weaviate, Milvus)
- [ ] Index type chosen and configured (IVFFlat vs. HNSW for pgvector; understand recall/speed trade-off)
- [ ] Index rebuild/maintenance scheduled (IVFFlat requires periodic retraining as data grows)
- [ ] Backup and restore tested — you can recover your vector data
- [ ] Connection pooling configured for the expected concurrent query load
- [ ] Query latency benchmarked at target scale (not just with 1000 chunks — test at production volume)

### Keyword Search

- [ ] Full-text search index created (tsvector/GIN for PostgreSQL, or Elasticsearch/OpenSearch)
- [ ] Language-appropriate text analysis configured (stemming, stop words, synonyms)
- [ ] Exact-match capability available for codes, IDs, and technical terms that should not be stemmed
- [ ] Keyword search tested independently — does it return relevant results before fusion?

### Hybrid Search

- [ ] Fusion strategy implemented (RRF is the safe default; test weighted fusion if you have eval data)
- [ ] Relative weights between vector and keyword search tuned on your domain
- [ ] Both search paths return results in the same schema for clean fusion
- [ ] Hybrid search latency acceptable (both searches can run in parallel)

### Query Processing

- [ ] Query expansion or rewriting tested (does it help or hurt on your query distribution?)
- [ ] Multi-query retrieval considered for complex questions (decompose into sub-queries)
- [ ] Query length limits enforced — prevent abuse with extremely long queries
- [ ] Empty/gibberish query handling: return a helpful message, not an error

### Retrieval

- [ ] Top-k value tuned: too low misses relevant chunks, too high adds noise and latency
- [ ] Retrieval recall measured on a labeled test set — you know your baseline
- [ ] Metadata filters applied as pre-filters (in the DB query), not post-filters
- [ ] No-results handling: graceful message when nothing relevant is found (do not pass empty context to LLM)
- [ ] Retrieval latency budget defined and met (typically < 500ms including both search paths)

### Reranking

- [ ] Reranker selected (Cohere Rerank, cross-encoder, or fine-tuned model)
- [ ] Relevance threshold set — chunks below the threshold are excluded, not just deprioritized
- [ ] Reranker latency measured and within budget (typically < 300ms for 20 candidates)
- [ ] Fallback for reranker API outages: skip reranking and use fusion scores, or use a local model
- [ ] Domain-specific reranker evaluated if your domain is specialized (legal, medical, etc.)

### Context Construction

- [ ] Deduplication of near-identical chunks before sending to LLM
- [ ] Chunks ordered for coherence (by document, then by position), not randomly
- [ ] Citation IDs assigned to each chunk (`[1]`, `[2]`, etc.) for LLM to reference
- [ ] Token budget enforced — context does not exceed the LLM's effective window
- [ ] Surrounding context optionally fetched for short chunks (parent section or adjacent chunks)

### LLM / Generation

- [ ] System prompt instructs: cite sources, don't fabricate, say "I don't know" when appropriate
- [ ] Temperature set low (0.0--0.2) for factual Q&A
- [ ] Streaming implemented for responsive UX (SSE or WebSocket)
- [ ] Model selected with justification (cost vs. quality vs. latency)
- [ ] Fallback model configured for primary model outages
- [ ] Max output tokens capped to prevent runaway generation costs

### Citations

- [ ] Every claim in the generated answer includes a citation reference (`[1]`, `[2]`)
- [ ] Citations are verifiable: user can click through to the source document/section
- [ ] Citation metadata displayed: document title, section, page number, source URL
- [ ] Hallucinated citations detected: cross-check that the cited chunk actually supports the claim

### Security

- [ ] Authentication required for all API endpoints
- [ ] Rate limiting on query and ingestion endpoints
- [ ] Input validation: query length limits, file size limits, allowed file types
- [ ] HTTPS/TLS for all communication
- [ ] API keys and secrets stored in environment variables or a secret manager, not in code
- [ ] CORS configured to allow only trusted origins

### ACL (Access Control)

- [ ] ACL metadata stored on every chunk, not just the parent document
- [ ] ACL filtering is a database pre-filter — unauthorized chunks never leave the DB
- [ ] ACL groups resolved at query time from the identity provider (SSO/LDAP/OAuth)
- [ ] ACL changes propagated: when a user's groups change, cached results are invalidated
- [ ] Red-team tested: verified that users cannot access documents outside their authorization

### Prompt Injection Defense

- [ ] User input separated from system instructions (not concatenated naively)
- [ ] Input guardrails: classifier or regex to detect injection attempts before sending to LLM
- [ ] Output guardrails: check generated response for policy violations, PII leakage, or off-topic content
- [ ] System prompt not exposed to users in any error message or response
- [ ] Tested with known prompt injection attacks (jailbreaks, instruction override, data exfiltration)

### Guardrails

- [ ] Topic boundaries defined: what the system should and should not answer
- [ ] Refusal behavior implemented: clear, helpful message when declining to answer
- [ ] Toxicity/hate speech filtering on both input and output
- [ ] PII detection on output: prevent the system from leaking PII in generated responses
- [ ] Content moderation API integrated if user-generated content is involved

### Evaluation

- [ ] Golden test set created: 100+ question-answer pairs with labeled correct chunks
- [ ] Retrieval metrics measured: recall@k, precision@k, MRR, NDCG
- [ ] Generation metrics measured: answer correctness (LLM-as-judge), faithfulness, relevance
- [ ] Citation accuracy measured: do citations actually support the claims?
- [ ] Evaluation runs automated in CI — regression detection on every change
- [ ] Human evaluation scheduled: periodic review of random production responses

### Caching

- [ ] Query result caching implemented (Redis or equivalent)
- [ ] Cache key includes query + tenant + ACL groups (not just query text)
- [ ] TTL set appropriately for your freshness requirements
- [ ] Cache invalidation strategy defined for document updates
- [ ] Cache hit rate monitored — if below 10%, the cache may not be worth the complexity
- [ ] Embedding cache: avoid re-embedding the same query within a session

### Freshness

- [ ] Stale content detection: how do you know when a source document has changed?
- [ ] Re-ingestion triggered by content changes (webhook, polling, or manual)
- [ ] Old chunks deleted when a document is re-ingested (not left as orphans)
- [ ] Freshness SLA defined and monitored: "content updates reflected within X hours"
- [ ] Version history maintained: ability to see what the system would have answered yesterday

### Versioning

- [ ] Embedding model version tracked — switching models requires full re-embedding
- [ ] Chunk schema versioned — schema changes require migration, not silent corruption
- [ ] Prompt versions tracked — changes to system prompts are logged and reversible
- [ ] API versioning in place for consumer-facing endpoints
- [ ] Configuration versioned: chunk size, overlap, top-k, temperature — all tracked as code

### Observability

- [ ] Structured logging: every query logged with query text, user ID, tenant, latency, chunk IDs retrieved, model used
- [ ] Metrics exported: query latency (p50/p95/p99), ingestion throughput, cache hit rate, error rate
- [ ] Distributed tracing: a single trace ID follows a query through retrieval, reranking, and generation
- [ ] Alerting configured: latency spike, error rate increase, embedding API failure, LLM API failure
- [ ] Dashboard: real-time view of system health, query volume, and quality metrics
- [ ] Feedback collection: mechanism for users to flag bad answers (thumbs down, report)

### Scaling

- [ ] Stateless application tier — can horizontally scale behind a load balancer
- [ ] Database connection pooling sized for expected concurrency
- [ ] Vector DB scaled for your corpus size (partitioning, sharding, or managed service)
- [ ] Embedding generation parallelized for bulk ingestion
- [ ] Auto-scaling configured based on query volume or CPU/memory utilization
- [ ] Load tested at 2-3x expected peak traffic

### Latency

- [ ] End-to-end latency budget defined and allocated: embedding (100ms) + search (200ms) + rerank (200ms) + generation (1-3s)
- [ ] Slowest component identified and optimized (usually LLM generation)
- [ ] Streaming enabled so users see partial responses quickly
- [ ] Cold-start latency measured and acceptable (first query after deploy)
- [ ] Database query plans analyzed: no sequential scans on large tables

### Cost

- [ ] Monthly cost estimated: embedding API calls + LLM API calls + vector DB hosting + compute
- [ ] Cost per query calculated: embedding ($0.0001) + reranking ($0.001) + LLM ($0.01-0.10) = total
- [ ] Cost optimization levers identified: smaller model, fewer retrieved chunks, caching, shorter prompts
- [ ] Budget alerts configured: notification when monthly spend exceeds threshold
- [ ] Cost scaling modeled: what happens to cost at 10x current query volume?

### Failure Handling

- [ ] Embedding API failure: queue and retry, or fallback to cached/local embeddings
- [ ] LLM API failure: retry with backoff, fallback to a different model/provider, or return "temporarily unavailable"
- [ ] Reranker API failure: skip reranking and return fusion-scored results
- [ ] Database failure: read replica failover, connection retry logic
- [ ] Graceful degradation: system returns partial results rather than a complete failure
- [ ] Circuit breakers on all external API calls

### CI/CD

- [ ] Evaluation suite runs on every PR that changes retrieval logic, prompts, or chunking
- [ ] Embedding model changes trigger a full re-embedding job (not silently deployed)
- [ ] Prompt changes reviewed as code (stored in version control, not a UI)
- [ ] Canary deployments for changes that affect generation quality
- [ ] Rollback procedure documented and tested
- [ ] Infrastructure as code: Docker, Terraform, or equivalent — no manual server configuration

### Disaster Recovery

- [ ] Vector database backed up on a schedule (daily minimum)
- [ ] Backup restoration tested — you have actually restored from a backup
- [ ] Source documents stored independently of the vector DB — you can re-ingest from scratch
- [ ] Recovery Time Objective (RTO) defined: how long can the system be down?
- [ ] Recovery Point Objective (RPO) defined: how much data loss is acceptable?
- [ ] Runbook documented: step-by-step instructions for recovering from each failure mode

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Checklist items skipped "for launch."** The most common failure pattern: the team skips ACL testing, evaluation automation, or cache invalidation "because we need to ship" and never comes back to it. Six months later, a user accesses confidential documents through the chatbot, and the incident response reveals that ACL pre-filtering was never actually implemented — the TODO in the code was forgotten. Fix: treat security and evaluation items as launch blockers, not post-launch nice-to-haves.

**Evaluation suite not maintained.** The golden test set was created at launch with 50 questions. Over six months, the corpus doubled, new document types were added, and chunking parameters changed. The eval suite still tests the same 50 questions and passes every time — but production quality has degraded because the test set no longer represents real queries. Fix: add new questions monthly, sample from production query logs, and track metrics over time (not just pass/fail).

**Observability gaps hide gradual degradation.** Without retrieval quality metrics in production (not just latency and error rate), you won't notice that recall dropped from 0.85 to 0.60 over three months as the corpus grew and the IVFFlat index became stale. Users notice ("the bot used to be better") but the dashboards show green. Fix: log retrieval scores, track user feedback (thumbs down rate), and alert on quality metric degradation, not just availability.
:::

## 🎯 Checkpoint

::: details Question 1 — Checklist priorities
**Q:** You are launching a RAG system in 2 weeks and can only complete 60% of this checklist. Which categories do you prioritize, and which do you defer? Justify your choices.

**A:** Prioritize (launch blockers): **Security** (authentication, rate limiting, input validation), **ACL** (pre-filter enforcement, red-team testing), **Prompt Injection Defense** (input/output guardrails), **Evaluation** (golden test set, basic retrieval metrics), **Failure Handling** (graceful degradation for API outages), and **Observability** (structured logging, basic alerting). Defer (post-launch): advanced caching optimization, cost optimization, auto-scaling (start with manual scaling), CI/CD automation of eval suite (run manually), disaster recovery testing (have backups, test restore later), and advanced query processing (expansion, multi-query). The principle: launch with a system that is secure, measurable, and fails gracefully. Optimize for performance and cost after you have real production data.
:::

::: details Question 2 — Cache key design
**Q:** A developer proposes caching query results with the key `hash(query_text)`. What security vulnerability does this create in a multi-tenant system?

**A:** If the cache key is only the query hash, two users in different tenants asking the same question ("What is our refund policy?") will get the same cached result — which may contain chunks from the other tenant's confidential documents. This is a cross-tenant data leak. The cache key must include the tenant ID and the user's ACL groups: `hash(query_text + tenant_id + sorted(acl_groups))`. This ensures that users with different access levels always get independently cached results. Additionally, when a user's group membership changes, their old cached results (keyed to the old group set) will naturally not match the new cache key, preventing stale ACL enforcement.
:::

::: details Question 3 — Embedding model upgrades
**Q:** You want to upgrade from `text-embedding-ada-002` to `text-embedding-3-small` for better performance. What does the checklist tell you about this process, and what can go wrong if you just swap the model name?

**A:** The checklist item under Embeddings states: "Embedding model version pinned — model upgrades require re-embedding the full corpus." If you swap the model name without re-embedding, your stored vectors (generated by ada-002, 1536 dimensions) will be compared against query vectors (generated by 3-small, 1536 dimensions). Even though the dimensions match, the vector spaces are completely different — ada-002 and 3-small were trained independently, so cosine similarity between their vectors is meaningless. Retrieval will return effectively random results. The correct process: (1) generate new embeddings for the full corpus using the new model, (2) store them in a parallel column or table, (3) run the evaluation suite against both old and new embeddings, (4) if the new model improves metrics, switch the query path to use the new embeddings, (5) drop the old embeddings after confirming the new ones are stable.
:::

## Key Mental Models

- **A checklist is a forcing function.** It doesn't make you smarter — it makes sure you don't skip things you already know.
- **Security and evaluation are launch blockers.** Everything else is a post-launch optimization.
- **Observability without quality metrics is incomplete.** Latency and uptime tell you the system is running; retrieval scores and user feedback tell you it is working.
- **Every external dependency needs a failure plan.** Embedding API, LLM API, reranker, database — each will fail, and your system must handle it gracefully.
- **The checklist grows with your system.** Add items as you discover new failure modes in production.

## Related

- [10 Design Case Studies](01-case-studies.md) — each case study's design should pass this checklist
- [Reference Implementation](02-implementation.md) — code that implements many of these items
- [Observability](../module-17/04-observability.md) — deep dive on logging, metrics, and tracing
- [Security & ACL](../module-14/01-security.md) — detailed security patterns
- [Evaluation](../module-15/index.md) — how to build the evaluation suite referenced here
