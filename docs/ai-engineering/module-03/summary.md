---
title: Module 3 Summary — The LLM Application Layer
outline: deep
---

# Module 3 Summary — The LLM Application Layer

## What you built

The layer between "the model can do it" and "users can rely on it": streaming responses so users see progress instead of silence, structured outputs so downstream code doesn't crash on malformed JSON, reliability patterns so a provider outage degrades gracefully instead of failing hard, cost attribution so spend is traceable rather than mysterious, and prompt/semantic caching so none of that costs more than it has to.

## 6 Mental Models to Take Forward

1. **TTFT is what users feel; total latency is what dashboards show.** Streaming doesn't make responses faster — it changes when the first token appears, and that's the number that determines whether an interaction feels responsive.

2. **Structure is not correctness.** Schema-constrained output guarantees shape, never content. Well-formed nonsense passes validation just as easily as a well-formed correct answer — you still need evaluation.

3. **Classify failures before retrying.** Not every error deserves a retry; retrying a malformed request three times just triples the noise for zero benefit.

4. **A timeout protects latency; only a propagated abort protects cost.** Client-side cancellation doesn't automatically stop the provider from generating and billing.

5. **Agent cost grows with iterations, not just requests.** Every loop turn resends the full accumulated context, so iteration count is the highest-leverage cost lever in an agentic system.

6. **Prompt caching keys on an exact prefix.** Any edit to cached content — even one character — silently breaks the cache with no error, just a quiet cost increase.

## Self-Assessment Checklist

- [ ] Can you explain why a stream that works locally can arrive all-at-once in production, and how you'd confirm the cause?
- [ ] Can you explain the difference between JSON mode and schema-constrained generation, and when each is sufficient?
- [ ] Can you design a bounded repair loop for a structured-output failure?
- [ ] Can you classify a set of API errors into retry / fail / fallback and explain why?
- [ ] Can you explain why jitter matters in a retry backoff strategy?
- [ ] Can you diagnose a month-over-month cost spike with flat request volume?

## Next Module

[Module 4 — RAG, The Bridge](/ai-engineering/module-04/) is short and deliberate: it tells you when your agent needs retrieval, then hands you to the dedicated RAG track for the full pipeline — before returning to evaluation in Module 5.
