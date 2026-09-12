---
title: AI Engineering Crash Sheet
outline: deep
---

# AI Engineering Crash Sheet

Last-minute interview prep. Scan this in 10 minutes. Every bullet is a fact you should be able to state confidently.

---

## The build line

```text
Mental Models → Prompting → Agents → App Layer → RAG → Evaluation
    (0)            (1)         (2)       (3)       (4)      (5)
         → Observability → Security → Architecture → Serving
                (6)            (7)         (8)          (9)
         → Fine-Tuning → Infrastructure → Case Studies → Strategy
             (10)              (11)            (12)         (13)
```

- **Evaluation (5) is the hinge:** everything before is construction, everything after operates a system you can measure
- **Theory lives in [ML Foundations](/ml-foundations/):** stats, linear algebra, neural nets — linked on demand, not a prerequisite

---

## Mental Models

- Attention: every token attends to every other token directly — no fixed-size summary bottleneck like RNNs had
- Cost: quadratic in sequence length — this is why context pricing and prompt caching exist
- Training = parallel, weights update. Inference = sequential, weights fixed, nothing persists between calls
- RLHF/DPO adds judgement on top of raw capability — explains refusals, hedging, and why hallucinations sound confident
- Embeddings: vectors where similar meaning = nearby points; cosine similarity measures the angle, not raw distance

---

## Prompting & Context

- Tokens ≠ words. Non-English and code tokenize less efficiently than English prose
- Show format with examples, don't describe it in prose — few-shot beats verbal instruction for consistency
- "Lost in the middle": position affects reliability, not just presence — put critical content first or last
- A hallucination from missing knowledge needs RAG, not better prompting

---

## Agents

- Agent = loop: Think → Act → Observe → repeat, until final answer, turn limit, or guardrail halt
- Always cap max-turns (10-15 typical) + loop detection on repeated identical tool calls
- Tools: model requests, your code executes — never trust a tool call as safe by default
- Narrow tools > broad tools. Separate read (free) from write (gated + confirmation)
- Memory types: working (session), episodic (past runs), semantic (durable facts, looked up not carried)
- Multi-agent trades latency/cost for specialization — not a speed optimization
- The harness (loop, limits, timeouts, tool execution) is where reliability actually lives, more than prompt quality
- MCP standardizes tool *discovery*, not the tool-calling mechanism itself

---

## Application Layer

- TTFT (time to first token) is what users feel; total latency is what dashboards show
- SSE for one-directional token streaming; WebSockets only if the client needs to push mid-stream
- Proxy/CDN buffering is the #1 cause of "streams locally, doesn't in prod" — check `X-Accel-Buffering: no`
- JSON mode = valid syntax guaranteed. Schema-constrained = valid syntax **and** shape guaranteed. Neither guarantees correctness
- Field order in a schema = generation order — put `reasoning` before the decision field, not after
- Classify failures before retrying: 429/5xx → retry; 400/401/403 → don't
- Jitter on backoff prevents synchronized retry stampedes
- Client-side timeout ≠ provider stops billing — only a propagated `AbortController` does both
- Agent cost grows ~quadratically with iterations — full context re-sent every loop turn
- Prompt caching keys on exact prefix match — variable content (timestamps, IDs) breaks it if placed early

---

## Evaluation & Observability

- No single ground truth for most agent tasks — use golden datasets + calibrated LLM-as-judge + outcome metrics together
- Calibrate judges against human scores; <80% agreement means the judge isn't trustworthy yet
- Quality metrics (fluency, tone) ≠ outcome metrics (task completion, escalation rate) — track both, they can diverge
- Trace every run: LLM calls, tool calls, correlation IDs — debug from the *input* side, not just output
- Regression testing: run golden set before/after every prompt or model change, pairwise-compare when scores are close

---

## Security & Guardrails

- Alignment reduces bad output probability; it's not a security boundary — enforce high-stakes actions in code
- Hard stop (refuse entirely) for real violations; soft redirect (reframe + answer) for most out-of-scope requests
- Guardrail false positives are invisible — users who get blocked leave, they don't file a report. Measure the rate
- Treat all tool outputs and MCP server results as untrusted input — same class of risk as user input

---

## Serving, Fine-Tuning & Infra

- Self-host mainly for compliance/data-residency, or genuinely high sustained volume — crossover point is usually higher than expected
- vLLM: PagedAttention (paged KV cache memory) + continuous batching = throughput/memory efficiency, not quality
- Quantization: INT8 ≈ free; INT4 needs validation against your golden set, especially for code/numerical tasks
- Fine-tuning = last rung of the ladder (prompt → context → RAG → fine-tune). Good for style/format, bad for facts
- LoRA: freeze base weights, train small adapter matrices (~<1% of params) — swap adapters, keep one base model
- Fine-tuning can cause catastrophic forgetting — always check general capability, not just the target task

---

## Cost & Strategy

- Attribute before optimizing: cost is almost always concentrated in a small slice (one tenant, one feature)
- Cost per outcome, not cost per call — a cheap model needing 2 attempts can cost more than one that doesn't
- p50/p95/p99, not just the mean — averages hide the tail where both bugs and budget live
- Budgets should enforce (per-run token cap) not just alert — an alert after the spend already happened is a report

---

## One-liner answers, if pressed

- **"Why does context cost so much?"** → Quadratic attention cost, billed per token, re-sent every agent iteration.
- **"Why did the new model break our prompts?"** → Alignment calibration shifted independent of capability; re-tune, don't assume portability.
- **"RAG or fine-tune?"** → Facts that change → RAG. Durable style/format → fine-tune. Default to RAG.
- **"How do you know it's actually working?"** → Golden dataset + calibrated judge + outcome metric, all three, not one.
