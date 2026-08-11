---
title: Interview Answer Framework
outline: deep
---

# Interview Answer Framework

A structured, repeatable approach for answering RAG system design questions in interviews. This framework ensures you cover every critical dimension without rambling or missing key areas.

## The 16-Step Framework

Most candidates lose RAG system design interviews not because they lack knowledge, but because they lack structure. They jump to solutions, skip requirements, and forget failure modes. This framework prevents that.

### Step 1: Clarify Requirements

Before drawing a single box, ask questions. This signals seniority.

- **Data volume:** How many documents? How large? How often do they change?
- **Query types:** Factual lookup? Summarization? Comparison? Analytics?
- **Users:** How many concurrent? Internal or external? Technical or non-technical?
- **Latency:** What is the acceptable response time? Streaming or batch?
- **Freshness:** How stale can answers be? Minutes, hours, days?
- **Security:** Multi-tenant? PII? Compliance requirements (SOC 2, GDPR, HIPAA)?
- **Accuracy:** What is the cost of a wrong answer? (Medical vs marketing)

::: warning What the interviewer is really testing
Can you resist the urge to jump to a solution? Do you understand that a RAG system for a hospital (where wrong answers can kill) is fundamentally different from one for an internal FAQ?
:::

### Step 2: Identify Data Sources and Types

List every data source and classify its type:
- **Unstructured text:** PDFs, docs, wiki pages, emails
- **Semi-structured:** HTML, markdown, JSON/XML with text fields
- **Structured:** CSV, databases, API responses
- **Multimodal:** images, diagrams, charts in documents
- **Real-time:** data that changes frequently (prices, inventory, status)

Each type needs a different ingestion strategy. Saying "we will chunk everything" is a red flag.

### Step 3: Identify Query Types

Different queries need different retrieval strategies:
- **Factual:** "What is the refund policy?" -- single document lookup
- **Summarization:** "Summarize the Q3 earnings report" -- full document needed
- **Comparison:** "Compare policy A vs policy B" -- multi-document retrieval
- **Analytical:** "What was our top-selling product last quarter?" -- needs SQL, not RAG
- **Navigational:** "Where do I find the API docs?" -- metadata search

::: warning What the interviewer is really testing
Do you understand that RAG is not the right tool for every query type? Saying "we will use SQL for analytical queries" is a strong signal.
:::

### Step 4: Identify Source of Truth

For each query type, determine the right data path:
- **RAG** for unstructured knowledge retrieval
- **SQL/API** for structured data and analytics
- **Live API** for real-time data (stock prices, flight status)
- **Hybrid** for queries combining structured and unstructured data

The query router classifies incoming queries and sends them to the right pipeline.

### Step 5: Design the Ingestion Pipeline

Cover the full pipeline from raw data to indexed chunks:
1. **Document loading:** source connectors (S3, database, API, file system)
2. **Parsing:** format-specific extraction (PDF parser, HTML stripper, OCR)
3. **Cleaning:** remove headers/footers, normalize whitespace, fix encoding
4. **Chunking:** strategy selection (recursive, semantic, structure-aware)
5. **Metadata extraction:** title, date, author, category, access level
6. **Embedding:** model selection, batching, error handling
7. **Indexing:** vector database insertion with metadata
8. **Deduplication:** content hashing to detect and skip duplicate documents

Mention: idempotency (re-running the pipeline produces the same result), error handling (what if one document fails to parse?), and monitoring (ingestion lag, failure rate).

### Step 6: Design Storage

Two storage systems working together:
- **Vector database:** stores embeddings + minimal metadata for filtered search
- **Document store:** stores full document text, detailed metadata, ACLs (traditional DB or object storage)

Justify your vector DB choice based on requirements: pgvector for simplicity and existing Postgres, Pinecone for managed zero-ops, Qdrant for advanced filtering and self-hosting.

### Step 7: Design Retrieval

The retrieval strategy makes or breaks the system:
- **Dense retrieval:** embedding-based semantic search (good for natural language queries)
- **Sparse retrieval:** BM25/keyword search (good for exact terms, codes, names)
- **Hybrid:** both combined via RRF (the right default for production)
- **Metadata filtering:** pre-filter by date, category, access level
- **Query processing:** rewriting, expansion, HyDE for difficult queries

State your top-K value and justify it based on the context window budget.

### Step 8: Design Reranking

Explain the two-stage retrieval pattern:
1. Retrieve N candidates cheaply (bi-encoder, N=30-50)
2. Rerank with a cross-encoder to get top K (K=5-10)

Justify whether reranking is needed for this use case (it adds 100-500ms latency).

### Step 9: Design Generation

Cover the full generation configuration:
- **System prompt:** grounding instruction, abstention instruction, citation format
- **Context template:** how retrieved chunks are presented (numbered, with source metadata)
- **Temperature:** 0-0.3 for factual, higher only for creative tasks
- **Output format:** plain text, markdown, structured JSON
- **Streaming:** stream tokens for perceived latency improvement

### Step 10: Security

::: warning What the interviewer is really testing
Mentioning security unprompted is a strong senior signal. Most candidates skip it entirely.
:::

- **Access control:** ACLs enforced at the retrieval layer via metadata pre-filtering. Never rely on the LLM to enforce access control.
- **Prompt injection defense:** strong context delimiters, meta-instructions, input/output scanning
- **PII handling:** redact during ingestion, detect in output, audit trail
- **Multi-tenancy:** tenant isolation at the collection or namespace level

### Step 11: Evaluation

- **Offline metrics:** Recall@K, NDCG, faithfulness, answer relevancy (RAGAS framework)
- **Online metrics:** user satisfaction, follow-up rate, abstention rate, latency
- **Evaluation dataset:** 200+ query-answer-source triples, updated monthly
- **Regression testing:** nightly evaluation pipeline with quality gates

### Step 12: Scaling

Think about what breaks at 10x and 100x:
- **10x documents:** ingestion becomes a pipeline problem, need incremental updates
- **10x queries:** need caching, read replicas, model routing
- **10x users:** need rate limiting, queue management, graceful degradation
- **10x latency pressure:** need faster models, fewer retrieval rounds, aggressive caching

### Step 13: Cost Analysis

Show you understand the business side:
- **Per-query cost:** embedding + retrieval + reranking + LLM generation
- **Infrastructure cost:** vector DB hosting, compute for self-hosted models
- **Ingestion cost:** one-time embedding + ongoing re-embedding
- **Optimization levers:** smaller models, caching, reduced context, batching

### Step 14: Latency Budget

Break down the time budget across the pipeline:
| Stage | Target | Notes |
|-------|--------|-------|
| Query embedding | 50ms | Cache repeated queries |
| Vector search | 30ms | HNSW in-memory |
| Reranking | 200ms | Biggest variable |
| Context assembly | 5ms | Template rendering |
| LLM TTFT | 500ms | Model-dependent |
| **Total TTFT** | **~800ms** | Before streaming starts |

### Step 15: Failure Handling

Cover every component's failure mode:
| Component | Failure | Fallback |
|-----------|---------|----------|
| Embedding service | Timeout/error | Return error, do not generate without retrieval |
| Vector DB | Down | Serve cached responses for common queries |
| Reranker | Down | Skip reranking, use bi-encoder results |
| LLM | Down | Return raw retrieved chunks with a disclaimer |
| Ingestion | Document parse failure | Dead-letter queue, alert, continue with others |

### Step 16: Trade-offs

Every design decision has trade-offs. State them explicitly:
- "I chose pgvector over Pinecone because we already run Postgres and the dataset is small. The trade-off is weaker ANN performance at scale."
- "I chose hybrid search over dense-only. The trade-off is implementation complexity, but it handles our mixed query patterns."
- "I set temperature to 0. The trade-off is less natural-sounding responses, but faithfulness is critical for this use case."

::: warning What the interviewer is really testing
Can you defend your choices? A candidate who explains trade-offs demonstrates that they have considered alternatives. A candidate who presents their design as the only option demonstrates that they have not.
:::

---

## Worked Example 1: "Design a RAG system for an airline"

**Scenario:** An airline wants a customer-facing chatbot that answers questions about flights, baggage policies, loyalty programs, and booking changes.

### Step 1: Clarify Requirements

- **Data:** ~5K policy documents, 50K FAQ entries, route database (structured), loyalty program rules. Updated weekly except routes (daily).
- **Users:** 100K daily queries from passengers, all public-facing.
- **Latency:** < 3 seconds to first token (customer-facing, patience is low).
- **Languages:** English, Spanish, Arabic (top 3 passenger languages).
- **Accuracy:** High -- wrong policy answers create liability and angry customers.
- **Security:** No PII in knowledge base, but query logs may contain booking references.

### Step 2-4: Data Sources, Query Types, Source of Truth

| Data Source | Type | Query Path |
|-------------|------|------------|
| Policy PDFs | Unstructured | RAG |
| FAQ database | Semi-structured | RAG |
| Flight schedules | Structured (DB) | SQL API |
| Booking details | Structured (API) | Live API |
| Loyalty program rules | Unstructured | RAG |

**Query routing:** "What is the baggage limit?" -> RAG. "Is flight AA123 on time?" -> Live API. "How many miles do I have?" -> Live API with auth.

### Step 5: Ingestion Pipeline

```
Policy PDFs -> PDF Parser (layout-aware) -> Chunk by section/clause
FAQ entries -> Clean HTML -> Each FAQ as one chunk (already small)
Loyalty rules -> Markdown parser -> Chunk by rule/tier
                            |
                            v
                  Embed (multilingual model)
                            |
                            v
                  pgvector (with metadata: category, language, effective_date)
```

- **Chunking:** Policies chunked by section with headers preserved. FAQs kept whole. Loyalty rules chunked by tier/benefit category.
- **Idempotency:** Content hash per document. Re-ingest weekly; skip unchanged documents.

### Step 6-8: Storage, Retrieval, Reranking

- **Storage:** pgvector (already running Postgres for the main app, dataset is small, need relational metadata for effective dates)
- **Retrieval:** Hybrid search. BM25 for flight numbers, policy codes, exact terms. Dense for natural language queries. RRF to combine.
- **Reranking:** Cohere Rerank API. Retrieve 30, rerank to top 5. Cross-lingual reranking handles language mixing.
- **Metadata filtering:** Filter by language (match user's detected language), filter by effective date (only current policies).

### Step 9: Generation

```
System prompt:
You are an airline customer service assistant. Answer ONLY using the provided
context. If the context does not contain the answer, say "I don't have that
information. Please contact our support team at 1-800-XXX-XXXX."
Cite the source policy or FAQ for every factual claim.
Respond in the same language as the user's question.
```

Temperature: 0. Streaming enabled. Citation format: `[Source: Policy Name, Section X]`.

### Step 10: Security

- No PII in the knowledge base (policies are public).
- Query logs scrubbed of booking references after 30 days.
- Prompt injection defense: strong context delimiters, output scanning for unexpected URLs or instructions.
- Rate limiting: 10 queries per minute per session to prevent abuse.

### Step 11-12: Evaluation and Scaling

- **Evaluation:** 200 Q&A pairs curated by customer service managers, covering each policy category and common edge cases. Nightly automated evaluation. Target: Recall@5 >= 90%, faithfulness >= 95%.
- **Scaling:** Semantic caching for common questions ("what is the baggage limit?" asked 500x/day). Read replicas during peak booking hours. Model routing: GPT-4o-mini for simple FAQs, GPT-4o for complex policy questions.

### Step 15: Failure Handling

- Vector DB down: return "I'm temporarily unable to search our policies. Please call 1-800-XXX-XXXX." Never generate without retrieval for policy questions.
- LLM down: return the top 3 retrieved FAQ/policy sections directly with "Our AI summary is temporarily unavailable."
- Flight API down: "I can't access real-time flight information right now. Please check our flight status page at [URL]."

### Key Trade-offs Stated

- pgvector over Pinecone: lower operational complexity, sufficient scale, but will need to revisit if we exceed 1M chunks.
- Hybrid search over dense-only: handles flight codes and policy numbers that dense retrieval misses, but adds BM25 index maintenance.
- Cohere Rerank API over self-hosted: simpler, but adds a vendor dependency and per-query cost.

---

## Worked Example 2: "How would you handle CSV data in a RAG system?"

**Scenario:** An internal analytics platform has 500 CSV files with sales data, inventory, and pricing. Business users want to ask natural language questions.

### The Trap

The interviewer wants to see if you recognize that **RAG is not the primary tool for structured data**. Many candidates will describe chunking CSVs and embedding rows, which is the wrong approach.

::: warning What the interviewer is really testing
Do you understand the boundary between RAG (unstructured knowledge retrieval) and other data access patterns (SQL, APIs)? Can you design a hybrid system?
:::

### The Right Approach

**Step 1: Classify the queries.** Business users asking about CSV data have three query types:

1. **Analytical queries** (70% of queries): "What was Q3 revenue in EMEA?" "Which product had the highest margin last month?" These need SQL, not RAG.
2. **Contextual queries** (20%): "What is our pricing strategy for enterprise customers?" "Why did we change the inventory reorder threshold?" These need documentation, not data.
3. **Hybrid queries** (10%): "How does our current churn rate compare to the target in our Q2 strategy document?" These need both SQL and RAG.

**Step 2: Build a multi-path system.**

```
User Query
    |
    v
Query Router (LLM classifier)
    |
    +-- Analytical --> Text-to-SQL --> Execute SQL --> Format result
    |
    +-- Contextual --> RAG pipeline --> Retrieve docs --> Generate answer
    |
    +-- Hybrid -----> Both paths --> Combine results --> Generate answer
```

**Step 3: For the analytical path (text-to-SQL):**
- Load all CSVs into PostgreSQL tables with proper schemas and types.
- Build a schema catalog: table descriptions, column descriptions with units, sample values, relationships between tables.
- Use the schema catalog as context for the LLM to generate SQL.
- Execute the SQL, format the result, and present it with the query for transparency.
- Safety: read-only database user, query timeout, row limit.

**Step 4: For the RAG path:**
- Do NOT embed individual CSV rows (they lack context).
- Instead, create documents that describe the data: schema documentation, column definitions, business logic explanations, data dictionaries.
- Embed these descriptions. When a contextual query matches, retrieve the explanation.

**Step 5: For the hybrid path:**
- Route to both paths in parallel.
- Combine: "According to the Q2 strategy document [RAG], the churn target was 5%. Current churn rate is 4.2% [SQL], which is below target."

### Key Points to Make

- "I would not chunk CSV rows because a row like `ACME,12500,2024-Q3,EMEA` is meaningless without column headers and business context."
- "Text-to-SQL is the right tool for analytical queries over structured data. RAG is for unstructured knowledge."
- "The query router is critical -- misrouting an analytical query to RAG gives a terrible answer."
- "I would generate natural language summaries of each CSV for the RAG index, so the system can answer 'what data do we have about X' questions."

---

## Worked Example 3: "Your RAG system has a 15% hallucination rate. How do you fix it?"

**Scenario:** Users report that 15% of RAG responses contain information not found in the source documents.

### The Trap

The interviewer wants you to diagnose before prescribing. Jumping straight to "add a better prompt" shows you do not understand the multiple failure modes that cause hallucination.

::: warning What the interviewer is really testing
Can you systematically diagnose a production issue? Do you understand that "hallucination" has multiple root causes that require different fixes?
:::

### Step 1: Categorize the Hallucinations

Sample 100 hallucinated responses and classify each into one of four categories:

| Category | Description | Typical Share |
|----------|-------------|---------------|
| A. Generation failure | Right document retrieved, LLM added unsupported claims | ~40% |
| B. Retrieval failure | Wrong document retrieved, LLM faithfully used it | ~30% |
| C. Coverage gap | No relevant document exists in the knowledge base | ~20% |
| D. Grounding leak | LLM mixed context with training data | ~10% |

### Step 2: Fix Each Category

**Category A -- Generation failure (right context, wrong answer):**
- Strengthen the grounding prompt: "Answer ONLY using the provided context. Do not add any information not found in the context."
- Add few-shot examples showing correct abstention.
- Reduce temperature to 0.
- Add post-generation NLI check: decompose the answer into claims, verify each against the context.
- Reduce context size -- fewer, more relevant chunks reduce the chance of the model confabulating between them.

**Category B -- Retrieval failure (wrong context):**
- Inspect the failing queries: are they matching irrelevant chunks because of semantic ambiguity?
- Add hybrid search if using dense-only (BM25 handles exact terms the embedding misses).
- Add a reranker if not using one.
- Improve chunking: inspect the chunks for failing queries. Are they too broad, mixing topics? Are they too narrow, missing necessary context?
- Lower the similarity threshold: if the best match scores 0.5 when good matches typically score 0.8, abstain instead of retrieving.

**Category C -- Coverage gap (answer does not exist):**
- Implement a retrieval confidence threshold: if the top retrieval score is below a threshold, bypass generation and return "I don't have information about this."
- Identify topic gaps by clustering failed queries, then ingest documents covering those topics.
- Add a fallback response for known gap areas: "For questions about [topic], please contact [team]."

**Category D -- Grounding leak (mixing context with training data):**
- Strengthen context delimiters: use XML tags or clear markers separating context from instructions.
- Add explicit meta-instruction: "Do not use any information from your training data. The context below is your ONLY source of information."
- Use a smaller, less "opinionated" model that has less training data to confabulate from.
- Verify citations: require the model to cite a source for every claim, then check that the cited source exists and supports the claim.

### Step 3: Prioritize and Measure

Fix in order of impact: Category A first (40% of hallucinations, cheapest to fix -- prompt engineering), then B (retrieval improvements), then C (content gap analysis), then D.

After each fix, re-run the evaluation on the same 100 examples plus the full evaluation dataset. Track hallucination rate weekly:
- Week 0: 15% baseline
- Week 1 (prompt fixes): target 10%
- Week 2 (retrieval fixes): target 7%
- Week 3 (coverage + grounding): target 5%

### Key Points to Make

- "I would not immediately change the prompt. First, I need to understand which type of hallucination dominates -- a retrieval problem and a generation problem require completely different fixes."
- "15% hallucination rate means I need to sample at least 100 failing cases to get statistically meaningful category distributions."
- "The most impactful fix is often the simplest: a stronger grounding prompt and temperature 0 can cut generation-caused hallucinations in half."
- "For production, I would add a post-generation faithfulness check using NLI, which catches hallucinations before they reach the user."
- "I would set up a regression test so this never silently creeps back up."

---

## Quick Reference: Signals That Impress Interviewers

| Signal | What to say |
|--------|-------------|
| **Requirements first** | "Before I design anything, let me clarify the requirements..." |
| **Query routing** | "Not every query should go through RAG. Analytical queries need SQL." |
| **Hybrid search** | "Dense-only retrieval misses exact terms. I would use hybrid with RRF." |
| **Security unprompted** | "Access control must be enforced at the retrieval layer, not the LLM." |
| **Evaluation** | "How do we know this works? Here's my evaluation pipeline..." |
| **Failure modes** | "If the vector DB goes down, the system should return an error, not hallucinate." |
| **Cost awareness** | "At 10K queries/day with GPT-4, that's ~$200/day. We could use GPT-4o-mini for simple queries." |
| **Trade-off articulation** | "I chose X over Y because... The trade-off is..." |

## Quick Reference: Red Flags to Avoid

| Red flag | Why it is bad |
|----------|---------------|
| Jumping to architecture without requirements | Shows lack of system design maturity |
| "We'll just use RAG for everything" | Ignores that structured data needs SQL |
| Ignoring chunking strategy | Chunking is the most underrated component |
| No mention of evaluation | How do you know it works? |
| ACLs in the prompt | "Tell the LLM not to mention unauthorized data" is not access control |
| No failure handling | Every component will fail in production |
| No cost discussion | Shows you have never operated a system at scale |
| "We'll use GPT-4 for everything" | Model routing shows cost and latency awareness |
