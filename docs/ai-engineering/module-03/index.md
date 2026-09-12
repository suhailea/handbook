---
title: Module 3 — The LLM Application Layer
outline: deep
---

# Module 3 — The LLM Application Layer

The agent works in a notebook. Now it has to survive contact with users.

TaskFlow's agent could reason and call tools, but the first real deployment exposed everything the notebook hid: responses arrived as a four-second wall of silence, a malformed JSON reply crashed the ticket parser, one provider outage took the whole feature down, and nobody could say what any of it cost per conversation.

None of those are model problems. They're application problems — the layer between "the model can do it" and "users can rely on it."

## Pages in this module

1. [Streaming & SSE](./01-streaming-and-sse) — TTFT, SSE, backpressure, disconnect cleanup
2. [Structured Outputs](./02-structured-outputs) — schema-constrained generation, validation, repair loops
3. [Reliability & Fallbacks](./03-reliability-and-fallbacks) — retries, timeouts, provider fallback, circuit breakers
4. [Cost & Token Accounting](./04-cost-and-token-accounting) — attribution, the cost model, budgets as controls
5. [Prompt Caching & the KV Cache](./05-prompt-caching) — why prefix order decides your bill
6. [Semantic Caching](./06-semantic-caching) — skipping the model entirely for repeat questions
