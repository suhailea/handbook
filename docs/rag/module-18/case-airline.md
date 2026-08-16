---
title: "Case Study: Airline (3 Variants)"
outline: deep
---

# Case Study — Airline RAG Systems (3 Variants)

Three distinct assistants for the same airline, each with fundamentally different architectures because they solve different problems.

## Support Bot

### Case Study 2 — Airline Customer Support Bot

**Scenario:** An airline deploys a customer-facing chatbot that answers questions about baggage policies, refund rules, flight change procedures, loyalty programs, and can look up existing bookings.

**Requirements:**
- Mix of static knowledge (policies) and dynamic data (booking lookups).
- Must cite the specific policy section in answers.
- Handles 50K conversations/day with sub-3s response time.
- Multi-language support (English, Spanish, Arabic, Japanese).
- Escalation path to human agents for complex cases.

**Architecture:**

```text
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

## Flight-Status Assistant

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

```text
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

## Booking Assistant

### Case Study 4 — Airline Booking Assistant

**Scenario:** A conversational assistant that helps passengers search for flights, book tickets, select seats, add baggage, and manage existing reservations. This involves sensitive actions (charging credit cards, changing bookings) that require careful guardrails.

**Requirements:**
- Conversational: multi-turn dialogue with context retention.
- Tool use: search flights, create bookings, modify bookings, process payments.
- Human-in-the-loop (HITL) for irreversible actions (payment, cancellation).
- Must handle ambiguity ("I want to fly to Paris next Tuesday" — which Paris? CDG or ORY?).

**Architecture:**

```text
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
