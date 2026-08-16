---
title: 10 Design Case Studies
outline: deep
---

# 10 Design Case Studies

Interview weight: 🔥🔥🔥 | Prerequisites: [Modules 1--17](../index.md) | Covers: end-to-end RAG system design

## 🗣️ In Plain English

::: tip In Plain English
Designing a RAG system is like planning a restaurant kitchen — the menu determines the equipment, the prep workflow, and the service style. A sushi bar and a pizza shop both serve food, but their kitchens look nothing alike. These ten case studies show you ten different "kitchens" so you can recognize which layout fits the order your interviewer gives you.
:::

## ⚙️ Under the Hood

### Case Study 1 — Enterprise Knowledge Base

**Scenario:** A 10,000-employee company wants employees to search internal docs — Confluence wikis, HR policies, engineering runbooks, product specs — through a chat interface. Multiple departments, strict access control.

**Requirements:**
- Multi-tenant: each department's docs isolated; users only see what they are authorized to access.
- Sources: Confluence, Google Drive, SharePoint, internal wikis, PDF uploads.
- Freshness: policy docs change quarterly; runbooks change weekly.
- Latency: < 3 s for answers; < 500 ms for search results.
- Scale: ~500K documents, ~2M chunks, ~5K daily queries.

**Architecture:**

```
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

---

### Case Study 2 — Airline Customer Support Bot

**Scenario:** An airline deploys a customer-facing chatbot that answers questions about baggage policies, refund rules, flight change procedures, loyalty programs, and can look up existing bookings.

**Requirements:**
- Mix of static knowledge (policies) and dynamic data (booking lookups).
- Must cite the specific policy section in answers.
- Handles 50K conversations/day with sub-3s response time.
- Multi-language support (English, Spanish, Arabic, Japanese).
- Escalation path to human agents for complex cases.

**Architecture:**

```
┌──────────┐    ┌───────────────┐    ┌───────────────────────┐
│ Customer │───▶│  Chat Gateway │───▶│  Orchestrator         │
│ (Web/App)│    │  (WebSocket)  │    │  (LangGraph Agent)    │
└──────────┘    └───────────────┘    └───────┬───────────────┘
                                             │
                          ┌──────────────────┼──────────────────┐
                          ▼                  ▼                  ▼
                 ┌─────────────┐   ┌─────────────────┐  ┌────────────┐
                 │ RAG: Policy │   │ Booking API     │  │ Escalation │
                 │ Vector Store│   │ (live lookup)   │  │ Queue      │
                 └─────────────┘   └─────────────────┘  └────────────┘
```

**Data Flow:**
1. User message enters an intent classifier (is this a policy question, booking lookup, or complaint?).
2. Policy questions go to the RAG pipeline against the policy document corpus.
3. Booking lookups require user authentication, then a tool call to the booking API with PNR/booking reference.
4. Complaints or edge cases escalate to a human agent with full conversation context attached.

**Ingestion Strategy:**
- Policy documents are versioned and ingested via CI/CD pipeline — when the legal team publishes a new policy PDF, it triggers re-ingestion.
- Documents chunked with aggressive metadata: `policy_name`, `section_number`, `effective_date`, `language`, `policy_category` (baggage/refund/loyalty/etc.).
- Multi-language: each policy exists in all supported languages; chunks tagged with `language` field.

**Retrieval Strategy:**
- Query routed by detected language; retrieval filtered to matching language chunks.
- Hybrid search: dense embeddings (multilingual model like `multilingual-e5-large`) + BM25 for exact policy numbers.
- Category filter applied when intent classifier identifies the topic.

**Reranking:**
- Cross-encoder reranker, top 3 policy sections passed to LLM.
- Policy sections include `effective_date` — if a policy was superseded, the newer version ranks higher.

**Generation:**
- System prompt: "You are [Airline] support. Answer using ONLY the provided policy excerpts. Cite the policy name and section number. If the policy doesn't cover this, say so and offer to connect to an agent."
- For booking lookups: LLM generates a tool call, orchestrator executes against booking API, LLM summarizes the result.
- Response language matches the user's detected language.

**Security:**
- Booking lookups require authentication (OAuth token or verified PNR + last name).
- PII (passport numbers, payment info) never stored in vector DB.
- All conversations logged with 90-day retention per airline compliance.

**Evaluation:**
- Customer satisfaction score (CSAT) from post-chat surveys.
- Retrieval accuracy: does the cited policy section actually answer the question?
- Escalation rate: target < 15% of conversations needing human takeover.
- Hallucination rate: weekly audit of 500 random responses.

**Scaling:**
- Stateless orchestrator behind a load balancer; conversation state in Redis.
- Policy corpus is small (~5K chunks) — a single pgvector instance handles it.
- Booking API is the bottleneck; circuit breaker pattern for API failures.

**Key Trade-offs:**
- Mixing RAG (static policies) with live API (bookings) adds complexity but is unavoidable — customers ask both types of questions in one conversation.
- Multilingual embeddings have lower accuracy than English-only models; accept this trade-off for coverage.
- Intent classification errors route questions to the wrong pipeline — invest heavily in the classifier.

---

### Case Study 3 — Airline Flight-Status Assistant

**Scenario:** Passengers want to ask "Is my flight on time?" or "What gate is UA 247 departing from?" and get real-time answers.

**Requirements:**
- Real-time data: flight status changes by the minute.
- Answers must reflect the *current* state, not a cached snapshot.
- High volume during irregular operations (storms, cancellations).

**Why RAG Is Wrong for This:**

This is the most important lesson in this case study: **RAG is fundamentally the wrong architecture for real-time data.** RAG works by pre-computing embeddings over a static or slowly-changing corpus. Flight status changes every few minutes — by the time you embed and index a status update, it may already be stale. You would be building an expensive, complex system to deliver *wrong answers*.

The correct architecture for flight status is a **direct API call**: query the airline's operational database (or a flight-status API like FlightAware) at request time and return the live result.

**Hybrid Architecture (RAG + API):**

However, passengers don't only ask real-time questions. They also ask:
- "What's your cancellation policy during weather delays?" — RAG (static policies)
- "Can I rebook for free if my flight is cancelled?" — RAG (static policies)
- "Is UA 247 on time?" — Live API
- "What gate does my flight leave from?" — Live API
- "If my flight is delayed more than 3 hours, am I entitled to a hotel?" — RAG (policies) + API (check delay duration)

```
┌───────────┐    ┌──────────────────────────────────────────────┐
│  User     │───▶│          LangGraph Router Agent              │
└───────────┘    └──────┬─────────────┬──────────────┬──────────┘
                        ▼             ▼              ▼
               ┌──────────────┐ ┌──────────┐ ┌────────────────┐
               │ RAG Pipeline │ │ Flight   │ │ Hybrid:        │
               │ (policies)   │ │ Status   │ │ API + RAG      │
               │              │ │ API      │ │ (policy+status)│
               └──────────────┘ └──────────┘ └────────────────┘
```

**Data Flow:**
1. User query hits the LLM-based router that classifies it as: `policy_question`, `realtime_lookup`, or `hybrid`.
2. `policy_question` feeds into the standard RAG pipeline against airline policy corpus.
3. `realtime_lookup` triggers a tool call to the flight status API; the LLM formats the response.
4. `hybrid` runs in parallel: fetch flight status from API AND retrieve relevant policy chunks, then the LLM combines both.

**Key Design Decisions:**
- No caching of flight status responses — staleness is unacceptable.
- API timeout: 2 seconds max, with fallback message: "I couldn't fetch your flight status right now. Please check the departures board or airline app."
- Rate limiting on the flight status API to prevent abuse.

**Security:**
- Flight status is public data — no authentication needed for status queries.
- But booking-specific status (e.g., "Is my checked bag on the flight?") requires authentication.

**Evaluation:**
- Accuracy of real-time answers: compare against ground truth from operational DB.
- Router accuracy: does the classifier correctly distinguish policy vs. real-time questions?
- Latency: real-time answers must be < 2s (API + LLM formatting).

**Key Trade-offs:**
- The router adds latency (~200ms) but prevents the catastrophic failure of using RAG for real-time data.
- Maintaining two systems (RAG + API) costs more than a pure RAG system, but the alternative is serving stale flight data, which is worse than no answer at all.
- **The lesson: not every AI assistant needs RAG. Know when NOT to use it.**

---

### Case Study 4 — Airline Booking Assistant

**Scenario:** A conversational assistant that helps passengers search for flights, book tickets, select seats, add baggage, and manage existing reservations. This involves sensitive actions (charging credit cards, changing bookings) that require careful guardrails.

**Requirements:**
- Conversational: multi-turn dialogue with context retention.
- Tool use: search flights, create bookings, modify bookings, process payments.
- Human-in-the-loop (HITL) for irreversible actions (payment, cancellation).
- Must handle ambiguity ("I want to fly to Paris next Tuesday" — which Paris? CDG or ORY?).

**Architecture:**

```
┌──────────┐    ┌──────────────┐    ┌──────────────────────────────┐
│ Customer │───▶│ Chat Gateway │───▶│  LangGraph Stateful Agent    │
└──────────┘    └──────────────┘    │  ┌────────────────────────┐  │
                                    │  │ Conversation State     │  │
                                    │  │ (Redis + checkpointing)│  │
                                    │  └────────────────────────┘  │
                                    └──────┬───────────────────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
          ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
          │ RAG: Policies    │  │ MCP Tool Server  │  │ HITL Approval    │
          │ (baggage, fare   │  │ - search_flights │  │ Gateway          │
          │  rules, loyalty) │  │ - create_booking │  │ (confirmation UI)│
          └──────────────────┘  │ - modify_booking │  └──────────────────┘
                                │ - select_seat    │
                                │ - add_baggage    │
                                └──────────────────┘
```

**Data Flow:**
1. User: "I want to book a flight from NYC to London next Friday."
2. Agent extracts: origin=NYC (JFK/EWR/LGA), destination=LHR, date=next Friday.
3. Agent asks for clarification: "Which NYC airport do you prefer — JFK, Newark, or LaGuardia?"
4. User: "JFK."
5. Agent calls `search_flights(origin=JFK, destination=LHR, date=2026-08-14)` via MCP tool.
6. Tool returns flight options; Agent presents them conversationally.
7. User selects a flight. Agent calls `create_booking()` with a **HITL gate**: "I'll book flight BA 117, JFK to LHR, Aug 14, Economy, $847. Shall I proceed?"
8. User confirms. Booking created, confirmation number returned.

**MCP (Model Context Protocol) Tools:**
- Each tool has a JSON schema defining required/optional parameters.
- Tools are hosted on a separate MCP server; the agent calls them via the MCP protocol.
- Tool responses include structured data (not just text) so the agent can reason over results.

**Human-in-the-Loop (HITL):**
- **Tier 1 (informational):** No HITL — search flights, check policies, view booking. Agent acts autonomously.
- **Tier 2 (reversible):** Soft HITL — select seat, add baggage. Agent confirms with user but executes without agent handoff.
- **Tier 3 (irreversible):** Hard HITL — create booking (charges money), cancel booking (may incur fees), change flight (fare difference). Agent presents a confirmation card with full details; user must explicitly approve.

**Conversation State:**
- Stored in Redis with LangGraph checkpointing.
- State includes: extracted entities (origin, destination, dates, passengers), selected flight, booking reference, conversation history.
- Session timeout: 30 minutes of inactivity triggers state archival to database.

**Generation:**
- System prompt constrains the agent: "Never fabricate flight options. Never confirm a booking without explicit user approval. If unsure about fare rules, retrieve the policy first."
- RAG is used when the user asks about baggage allowances, fare rules, or loyalty program benefits.

**Security:**
- User authentication required before any booking actions.
- Tool calls are logged with user ID, action, parameters, and result.
- Rate limiting: max 10 booking attempts per user per hour.
- Prompt injection defense: user input is separated from system instructions; tool parameters are validated against schemas.

**Evaluation:**
- Task completion rate: percentage of booking intents that result in a completed booking.
- Clarification efficiency: average number of turns to resolve ambiguity.
- HITL accuracy: how often users confirm vs. reject the proposed action.
- Error rate: bookings made with incorrect parameters.

**Scaling:**
- Stateless agent instances behind load balancer; state in Redis.
- MCP tool server scaled independently (it wraps the airline's existing booking APIs).
- During peak booking periods, auto-scale agent instances based on active conversations.

**Key Trade-offs:**
- HITL adds friction (extra confirmation step) but prevents costly errors (wrong booking).
- MCP tool server adds an abstraction layer but decouples the agent from the booking API — the API can change without retraining the agent.
- Conversation state in Redis means state loss if Redis fails — mitigated by checkpointing to persistent storage.
- **The lesson: RAG is a supporting player here, not the star. The core challenge is tool orchestration and safety, not retrieval.**

---

### Case Study 5 — Legal Document Search

**Scenario:** A law firm wants to search across 500K+ contracts, court filings, case law, and legal memos. Lawyers need to find *exact clauses* — not just semantically similar content, but the precise wording of a contractual obligation or legal precedent.

**Requirements:**
- Exact clause matching is critical (e.g., "find all contracts with an indemnification clause covering IP infringement").
- Long documents (contracts are 50--200 pages).
- Citation precision: every answer must reference the exact document, page, and section.
- Boolean search capability (AND, OR, NOT) alongside natural language.
- Privilege and confidentiality: some documents are client-privileged.

**Architecture:**

```
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

---

### Case Study 6 — Healthcare Document RAG

**Scenario:** A hospital system wants clinicians to query clinical guidelines, drug interaction databases, and internal protocols. HIPAA compliance is non-negotiable.

**Requirements:**
- HIPAA compliance: PHI (Protected Health Information) must never leak.
- On-premises or private cloud only — no data sent to public LLM APIs.
- Audit trail for every query and response.
- Sources: clinical guidelines (UpToDate-style), drug databases, internal hospital protocols, formulary.
- Disclaimer: system must never be the sole basis for clinical decisions.

**Architecture:**

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────────────┐
│  Clinician   │────▶│  Auth + Audit│────▶│  RAG Orchestrator        │
│  (EMR-       │     │  Gateway     │     │  (on-prem FastAPI)       │
│   embedded)  │     └──────────────┘     └───────────┬──────────────┘
└──────────────┘                                      │
                                    ┌─────────────────┼──────────────┐
                                    ▼                 ▼              ▼
                          ┌──────────────┐  ┌──────────────┐ ┌────────────┐
                          │ Vector DB    │  │ Keyword Index │ │ On-prem LLM│
                          │ (on-prem     │  │ (on-prem     │ │ (Llama 3   │
                          │  Qdrant)     │  │  Solr/ES)    │ │  70B, vLLM)│
                          └──────────────┘  └──────────────┘ └────────────┘
```

**Ingestion Strategy:**
- Clinical guidelines: structured XML/HTML from publisher APIs, parsed with section-level granularity.
- Drug databases: structured data (drug name, interactions, contraindications, dosing) stored as both structured records and embedded text chunks.
- Internal protocols: PDF/Word documents from the hospital's quality department, parsed via `unstructured`, manually reviewed for PHI before indexing.
- **PHI scrubbing**: before any document enters the RAG pipeline, it passes through a NER-based PHI detector (patient names, MRNs, dates of birth). Documents containing PHI are either scrubbed or rejected.

**Retrieval Strategy:**
- Hybrid search with medical synonym expansion (e.g., "heart attack" maps to "myocardial infarction" maps to "MI").
- Drug interaction queries route to the structured drug database first, with RAG as fallback for guideline-level context.
- Metadata filters: `source_type`, `specialty`, `last_reviewed_date` (clinical guidelines have review dates — outdated guidelines are deprioritized).

**Reranking:**
- Domain-specific reranker trained on medical text (PubMedBERT-based cross-encoder).
- Higher weight for guidelines reviewed within the last 2 years.

**Generation:**
- On-premises LLM (Llama 3 70B served via vLLM) — no data leaves the hospital network.
- Every response includes: the answer, cited sources with URLs, and a mandatory disclaimer: "This information is for clinical reference only. Always verify with current guidelines and exercise clinical judgment."
- Confidence scoring: if retrieval scores are low, the system says "I found limited information on this topic" rather than generating a low-confidence answer.

**Security:**
- **HIPAA Technical Safeguards:**
  - Encryption at rest (AES-256) and in transit (TLS 1.3).
  - Access controls: role-based (physicians see different content than nurses).
  - Audit trail: immutable log of every query, retrieved chunks, generated response, user ID, timestamp.
  - Automatic session timeout.
- PHI never enters the vector database or the LLM prompt.
- On-prem deployment eliminates data-in-transit risk to cloud providers.
- BAA (Business Associate Agreement) with any third-party software vendor whose code touches the data.

**Evaluation:**
- Clinical accuracy: reviewed by medical professionals quarterly.
- Retrieval recall for known guidelines: given a clinical question, does the system retrieve the correct guideline section?
- PHI leak detection: automated scanning of all stored chunks and generated responses for PHI patterns.
- Disclaimer compliance: every response must contain the disclaimer.

**Scaling:**
- On-prem GPU cluster for LLM inference (4x A100 or equivalent).
- Scaling is constrained by hardware budget — optimize with quantization (AWQ/GPTQ), batching, and KV-cache management.
- Expected load is moderate (~1K queries/day) — scaling is less of a concern than compliance.

**Key Trade-offs:**
- On-prem LLM has lower quality than GPT-4o/Claude, but HIPAA compliance is non-negotiable.
- PHI scrubbing may remove contextually important information (e.g., a patient name in a case study) — accept the loss for compliance.
- Clinical accuracy requires ongoing human review — you cannot fully automate evaluation.
- **The lesson: compliance requirements drive every architectural decision. Start with the constraints, not the features.**

---

### Case Study 7 — E-commerce Product Search

**Scenario:** An online retailer with 2M products wants a conversational search that understands natural language queries ("waterproof hiking boots under $150 with good arch support") and can show relevant products with images.

**Requirements:**
- Multimodal: products have images, descriptions, specs, and reviews.
- Structured data: price, brand, category, ratings, inventory status.
- Faceted filtering: price range, brand, category, rating threshold.
- Personalization: search results influenced by user's purchase history and preferences.
- Real-time inventory: don't recommend out-of-stock items.
- Scale: 2M products, 50M review chunks, 100K queries/day.

**Architecture:**

```
┌──────────┐    ┌──────────────────────────────────────────────────┐
│ Shopper  │───▶│              Search Orchestrator                 │
└──────────┘    │  ┌──────────┐  ┌────────────┐  ┌─────────────┐  │
                │  │ Query    │  │ Structured │  │ Vector      │  │
                │  │ Parser   │  │ Filter     │  │ Search      │  │
                │  │ (extract │  │ (price,    │  │ (semantic   │  │
                │  │  facets) │  │  brand...) │  │  matching)  │  │
                │  └──────────┘  └────────────┘  └─────────────┘  │
                └──────────────────────────────────────────────────┘
                         │                │               │
                         ▼                ▼               ▼
                ┌──────────────┐  ┌─────────────┐  ┌────────────┐
                │ Product DB   │  │ Inventory   │  │ Review     │
                │ (PostgreSQL) │  │ Service     │  │ Vector DB  │
                └──────────────┘  └─────────────┘  └────────────┘
```

**Data Flow:**
1. "Waterproof hiking boots under $150 with good arch support" hits the Query parser, which extracts: `category=hiking_boots`, `feature=waterproof`, `price_max=150`, `semantic_query="good arch support"`.
2. Structured filters applied to product DB: `category=hiking_boots AND waterproof=true AND price<=150 AND in_stock=true`.
3. Filtered product IDs sent to vector search: semantic match on "good arch support" against product descriptions + review embeddings.
4. Results combined and ranked: product relevance + review sentiment for "arch support" + personalization score.
5. Top 10 products returned with images, prices, ratings, and a generated summary of why each matches.

**Ingestion Strategy:**
- Product catalog: ingested from the product database via CDC (Change Data Capture) — real-time updates when products change.
- Each product generates multiple embeddings: one from the description, one from aggregated review text, one from specs.
- Reviews: chunked per-review (each review is a chunk), embedded with metadata: `product_id`, `rating`, `verified_purchase`, `date`.
- Images: embedded using CLIP or similar multimodal model for image-to-text matching.

**Retrieval Strategy:**
- **Structured-first, semantic-second**: apply hard filters (price, brand, category, inventory) in the database, then semantic search over the filtered set.
- This is the opposite of a typical RAG system where semantic search comes first — in e-commerce, hard filters are non-negotiable (don't show $200 boots when the user said $150).
- Review-based retrieval: for subjective queries ("comfortable", "good for wide feet"), search review embeddings, not just product descriptions.

**Reranking:**
- Lightweight reranker that combines: semantic relevance score, product rating, review count, personalization score (based on user history), and recency.
- No heavyweight cross-encoder — latency budget is tight for e-commerce (< 500ms total).

**Generation:**
- For each recommended product, generate a 2-sentence summary: why it matches the query, pulled from the most relevant review snippets.
- "Based on 47 reviews mentioning arch support, the Salomon X Ultra gets consistently high marks for cushioning and stability."

**Security:**
- Product data is public — no ACL concerns.
- User purchase history is PII — personalization model runs server-side, user data never sent to LLM.
- Rate limiting to prevent scraping.

**Evaluation:**
- Click-through rate (CTR) on recommended products.
- Conversion rate: does the search lead to purchases?
- Query understanding accuracy: does the parser correctly extract facets?
- Zero-result rate: percentage of queries that return no results (should be < 5%).

**Key Trade-offs:**
- Structured filters before semantic search reduces recall but ensures hard constraints are met.
- Multiple embeddings per product (description + reviews + image) increase storage and ingestion cost but dramatically improve retrieval for subjective queries.
- Real-time inventory checks add latency but prevent the terrible UX of recommending out-of-stock items.
- **The lesson: e-commerce search is a hybrid of structured queries and semantic search. Pure RAG over unstructured text would miss the mark entirely.**

---

### Case Study 8 — HR Policy Assistant

**Scenario:** A company's HR department deploys an internal assistant for employees to ask about PTO policies, benefits, expense rules, promotion criteria, and company handbook content.

**Requirements:**
- Access-level filtering: managers see different content than individual contributors (e.g., termination procedures, salary bands).
- Employees should get answers instantly instead of emailing HR and waiting 2 days.
- Sensitive topics: the assistant must not answer questions about specific employees, ongoing investigations, or legal matters — redirect to HR.
- Multi-region: different policies for US, UK, EU, India offices.

**Architecture:**

```
┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐
│  Employee    │───▶│  SSO + Role  │───▶│  RAG Orchestrator    │
│  (Slack bot  │    │  Resolver    │    │  (filters by role +  │
│   or Web UI) │    │  (Okta/AD)   │    │   region)            │
└──────────────┘    └──────────────┘    └──────────┬───────────┘
                                                    │
                                    ┌───────────────┼──────────┐
                                    ▼               ▼          ▼
                          ┌──────────────┐  ┌────────────┐  ┌──────┐
                          │ Vector DB    │  │ Keyword    │  │ LLM  │
                          │ (pgvector)   │  │ Search     │  │      │
                          │ + role/region│  │            │  │      │
                          │   metadata   │  │            │  │      │
                          └──────────────┘  └────────────┘  └──────┘
```

**Ingestion Strategy:**
- HR policy documents ingested with rich metadata: `policy_category`, `region` (US/UK/EU/India), `access_level` (all_employees/managers/hr_only/executives), `effective_date`, `supersedes` (link to previous version).
- Versioning: when a policy is updated, the old version is soft-deleted (marked `superseded=true`) but retained for audit purposes.
- Chunking: section-level within each policy document. Each chunk inherits the document's access metadata.

**Retrieval Strategy:**
- Two mandatory filters applied before retrieval:
  1. `region`: matches the employee's office location (from SSO profile).
  2. `access_level`: matches the employee's role (IC, manager, HR, executive).
- Example: A US-based IC asking "How many PTO days do I get?" only retrieves US employee-level PTO policy, not the UK policy or the manager-level policy that includes details about approving direct reports' PTO.
- Hybrid search for queries that include policy numbers or specific terms.

**Reranking:**
- Standard cross-encoder reranker. Policy corpus is small (~2K chunks), so reranking is fast.
- Prefer newer policies when multiple versions exist.

**Generation:**
- System prompt includes a blocklist of topics: "Do not answer questions about specific employees, ongoing HR investigations, salary information for other employees, or legal matters. For these topics, respond: 'Please contact HR directly at hr@company.com for assistance with this matter.'"
- Region-appropriate answers: if a US employee asks about parental leave, cite the US policy, not the UK one.
- Citations reference the policy document name and section.

**Security:**
- Access-level filtering is enforced at the database query level (pre-filter).
- The LLM never sees chunks the user isn't authorized to access.
- Sensitive topic detection: a classifier checks if the query is about a blocked topic before executing retrieval.
- All queries logged with employee ID for audit.

**Evaluation:**
- HR team reviews a sample of answers weekly for correctness.
- Employee satisfaction survey: is the assistant helpful?
- Deflection rate: how many queries were resolved by the assistant vs. escalated to HR?
- Access violation testing: red-team exercise where ICs try to access manager-only content.

**Scaling:**
- Small corpus, moderate query volume (~500 queries/day) — a single instance handles this easily.
- The main scaling concern is organizational: keeping policies up-to-date as they change.

**Key Trade-offs:**
- Role-based filtering reduces recall (managers get broader results) but is required for confidentiality.
- Maintaining region-specific policies multiplies content management effort.
- Blocking sensitive topics means the assistant can't help with everything — but attempting to answer legal or personnel matters is far riskier than declining.
- **The lesson: HR assistants are ACL problems disguised as RAG problems. Get the access control right first.**

---

### Case Study 9 — CSV/Excel Analytics Assistant

**Scenario:** Business analysts want to ask natural-language questions about data in CSV and Excel files: "What were our top 10 customers by revenue last quarter?" or "Show me the month-over-month growth rate for the EMEA region."

**Requirements:**
- Input: CSV/Excel files uploaded by users.
- Queries are analytical (aggregations, filters, joins) not document-search.
- Results should include tables, charts, and explanations.
- Data can be large (millions of rows).

**Why RAG Is Wrong Here:**

This is the second case study where naive RAG is the wrong approach. Consider what happens if you chunk a CSV file and embed it:
- Row 47 gets embedded as "Acme Corp, 2024-Q3, $1,247,000, EMEA". The embedding captures semantic similarity but not the mathematical structure.
- "What were our top 10 customers by revenue?" requires a `GROUP BY customer ORDER BY SUM(revenue) DESC LIMIT 10` — an operation that embedding similarity search cannot perform.
- Chunking a spreadsheet destroys the tabular structure. Row 47 in one chunk has no connection to the column headers in another chunk.

**The Correct Approach: NL-to-SQL (Text-to-SQL):**

```
┌──────────┐    ┌──────────────┐    ┌──────────────────────────────┐
│ Analyst  │───▶│  File Upload │───▶│  Analytics Orchestrator      │
│          │    │  + Schema    │    │  ┌──────────────────────┐    │
│          │    │  Extraction  │    │  │ NL-to-SQL Generator  │    │
└──────────┘    └──────────────┘    │  │ (LLM + schema context)   │
                                    │  └──────────┬───────────┘    │
                                    └─────────────┼────────────────┘
                                                  │
                                    ┌─────────────┼───────────────┐
                                    ▼             ▼               ▼
                          ┌──────────────┐ ┌────────────┐ ┌────────────┐
                          │  DuckDB /    │ │ Result     │ │ Chart      │
                          │  SQLite      │ │ Formatter  │ │ Generator  │
                          │  (query      │ │ (LLM)      │ │ (matplotlib│
                          │   engine)    │ │            │ │  / plotly) │
                          └──────────────┘ └────────────┘ └────────────┘
```

**Data Flow:**
1. Analyst uploads a CSV/Excel file.
2. System loads the file into DuckDB (an in-process analytical database).
3. Schema extraction: column names, types, sample values, and basic statistics (min, max, unique count) are extracted and formatted as context.
4. User asks: "What were our top 10 customers by revenue last quarter?"
5. LLM receives: the schema context, the user's question, and instructions to generate a SQL query.
6. LLM generates: `SELECT customer, SUM(revenue) as total_revenue FROM sales WHERE quarter = 'Q3-2024' GROUP BY customer ORDER BY total_revenue DESC LIMIT 10`.
7. SQL is executed against DuckDB; results returned as a table.
8. LLM generates a natural-language summary of the results + optionally a chart.

**Where RAG Does Help (Hybrid):**
- RAG over the schema: if the user asks "What does the 'ARR' column mean?", RAG can retrieve the data dictionary or column descriptions.
- RAG over previous analyses: if analysts have written reports about this data, RAG can retrieve relevant context.
- But the core analytical capability is NL-to-SQL, not retrieval-augmented generation.

**Security:**
- SQL injection prevention: the generated SQL runs in a sandboxed DuckDB instance with read-only access.
- Row-level security: if the CSV contains sensitive data, access is controlled at the upload level.
- File size limits: max 500MB per upload to prevent resource exhaustion.
- Query timeout: 30 seconds max execution time.

**Generation:**
- Two-step generation: first generate SQL (validated and executed), then generate the explanation/summary from the query results.
- If the generated SQL fails, the LLM receives the error message and retries (up to 3 attempts).
- Self-correction: the LLM checks if the SQL makes sense given the schema before execution.

**Evaluation:**
- SQL correctness: does the generated SQL produce the right answer? (Evaluated against a test suite of question-SQL pairs.)
- Execution success rate: percentage of generated SQL queries that execute without errors.
- Answer accuracy: does the natural-language summary correctly reflect the query results?

**Key Trade-offs:**
- NL-to-SQL is fragile: ambiguous column names, inconsistent data formats, and complex queries (multi-table joins, window functions) have high failure rates.
- DuckDB is fast for analytics but doesn't scale to truly large datasets (>10GB) — for those, connect to a data warehouse (BigQuery, Snowflake).
- Showing the generated SQL to the analyst builds trust (they can verify it) but adds complexity to the UI.
- **The lesson: know your data shape. Tabular data needs SQL, not embeddings. Use the right tool for the job.**

---

### Case Study 10 — Multimodal Document Assistant

**Scenario:** A consulting firm needs to search and query reports that contain mixed content: text, tables, charts, diagrams, and photographs. A typical report PDF has 50 pages with 15 tables, 10 charts, and embedded images.

**Requirements:**
- Extract information from tables, charts, and images — not just text.
- Queries like "What was the revenue trend shown in the chart on page 12?" must work.
- Maintain document layout fidelity (table structure, figure captions, page references).
- Support for 100K+ documents.

**Architecture:**

```
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

```
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

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Using RAG for real-time data.** Case Studies 3 and 9 show this: flight status and analytical queries over tabular data are not retrieval problems. Embedding and indexing data that changes every minute (flights) or has mathematical structure (spreadsheets) gives you a complex system that delivers wrong answers. Symptom: users report "the bot said my flight was on time but it was cancelled 2 hours ago." Root cause: stale embeddings. Fix: recognize that some data needs live API calls or SQL, not vector search.

**Skipping ACL pre-filtering.** Case Studies 1, 6, and 8 all require access control. A common mistake is to retrieve all chunks first and then filter by ACL in the application layer. This is both a security risk (chunks briefly exist in memory that the user shouldn't see) and a performance problem (you retrieved 40 chunks only to discard 30). Always push ACL filters into the database query.

**Treating all data as unstructured text.** E-commerce product data (Case Study 7) has structured fields (price, brand, rating). Tabular data (Case Study 9) has rows and columns. Embedding these as flat text destroys the structure. Symptom: "Show me boots under $150" returns boots at $200 because the embedding captured "boots" but not the price constraint. Fix: extract structured fields and use them as hard filters before semantic search.

**Hallucinating in high-stakes domains.** In legal (Case Study 5) and healthcare (Case Study 6), a fabricated clause or an incorrect drug interaction can have severe consequences. Symptom: the LLM "paraphrases" a contract clause, subtly changing its meaning. Fix: force the LLM to quote exact text from retrieved chunks, add confidence scoring, and always include "verify with a professional" disclaimers.
:::

## 🎯 Checkpoint

::: details Question 1 — Real-time vs. RAG
**Q:** An interviewer asks you to design a system that answers "What's the current price of AAPL stock?" and also "Explain Apple's dividend policy." How do you architect this, and why is a pure RAG approach insufficient?

**A:** This is a hybrid architecture — identical in pattern to Case Study 3 (Flight Status). The stock price question requires a live API call (Alpha Vantage, Yahoo Finance, or a market data provider) because stock prices change by the second. Embedding historical price data would be immediately stale and misleading. The dividend policy question, however, is a classic RAG use case — the policy is documented in SEC filings and changes infrequently. The architecture: a router agent classifies the query as `realtime` or `knowledge`, routing to the appropriate pipeline. For hybrid queries ("Is AAPL's current price above its 52-week average?"), the agent makes an API call for the current price and a RAG retrieval for the 52-week average (or better yet, an API call for both, since 52-week average is also real-time data). The key principle: RAG is for slowly-changing knowledge, not real-time data feeds.
:::

::: details Question 2 — ACL enforcement
**Q:** In the Enterprise Knowledge Base (Case Study 1), why must ACL filtering happen as a database pre-filter rather than an application-level post-filter? What specific failure mode does post-filtering create?

**A:** Post-filtering creates two problems. First, a security window: chunks the user shouldn't see are retrieved into application memory, transmitted over the network from DB to app server, and briefly held in process memory. Even if they are discarded before reaching the user, they exist in logs, memory dumps, and potentially in the LLM's context window if filtering happens after context construction. Second, a retrieval quality problem: if you retrieve top-20 chunks and 15 are filtered out by ACL, you are left with only 5 chunks — likely not the best 5 the user is authorized to see. Pre-filtering ensures the top-20 are all from the authorized set, maximizing both security and retrieval quality. Implementation: in pgvector, this means a `WHERE acl_groups && $user_groups` clause in the same query as the vector similarity search, using a GIN index on the ACL array column for performance.
:::

::: details Question 3 — Structured vs. unstructured
**Q:** A team proposes building a RAG system over their product catalog (2M products with price, brand, category, rating fields) by chunking product descriptions and embedding them. What will go wrong, and what is the correct architecture?

**A:** Embedding product descriptions as flat text destroys the structured fields. A query like "Nike running shoes under $100 with 4+ star rating" will fail because: (1) the embedding might find semantically similar products but cannot enforce the $100 price ceiling — embeddings don't understand numerical constraints, (2) filtering by brand requires exact match, not semantic similarity ("Nike" should not match "Adidas" even though both are athletic brands), (3) rating thresholds are numerical comparisons, not semantic operations. The correct architecture (Case Study 7): extract structured fields into a relational database, apply hard filters first (`brand=Nike AND price<100 AND rating>=4 AND in_stock=true`), then run semantic search over the filtered set for subjective qualities ("good arch support", "comfortable for long runs"). This is structured-first, semantic-second — the inverse of typical RAG where semantic search comes first and filters are applied after.
:::

## Key Mental Models

- **Not everything is a RAG problem.** Real-time data needs live APIs. Tabular data needs SQL. Know when RAG is the wrong tool.
- **ACL is a pre-filter, not a post-filter.** Push access control into the database query, never the application layer.
- **Structured data needs structured queries.** Embeddings cannot enforce numerical constraints, exact matches, or aggregations.
- **The architecture follows the data, not the hype.** Each case study's design is driven by the shape of its data, the nature of its queries, and its compliance requirements.
- **Hybrid architectures are the norm.** Almost every real system combines RAG with live APIs, structured queries, or tool use. Pure RAG is the exception.

## Related

- [Hybrid Search](../module-09/02-hybrid-search.md) — the retrieval strategy used in most case studies
- [Security & ACL](../module-14/01-security.md) — deep dive on access control patterns
- [Evaluation](../module-13/index.md) — how to measure the metrics referenced in each case study
- [Caching & Freshness](../module-17/01-caching-freshness.md) — staleness trade-offs discussed in Case Studies 1 and 3
- [Reference Implementation](02-implementation.md) — code for the patterns described here
- [Production Checklist](03-checklist.md) — verify your design covers everything
