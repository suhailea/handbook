---
title: 60 AI Engineering Interview Questions
outline: deep
---

# 60 AI Engineering Interview Questions

A question bank covering every module in this track. Answers are hidden behind details blocks — use these for self-testing before revisiting the module they're drawn from.

## Mental Models & LLM Fundamentals

::: details Q1. Why do transformers scale better than RNNs despite higher per-token cost?
**A:** RNNs carry context in a fixed-size hidden state passed sequentially, so long-range dependencies degrade with distance and training can't parallelize across the sequence. Attention lets every token consult every other token directly, so distant context is exactly as reachable as adjacent context, and the whole sequence can be processed in parallel during training. The cost is quadratic in sequence length — but that cost is what buys long-range accuracy, and parallelism made it affordable at scale. See [0.1](/ai-engineering/module-00/01-how-transformers-work).
:::

::: details Q2. What's the difference between training and inference, and why does it matter operationally?
**A:** Training updates model weights; inference only generates text from fixed weights and never learns from a conversation. Training is parallel across the sequence; inference is sequential — each token depends on every token before it, including ones just generated. This is why generation streams naturally, why longer outputs take proportionally longer, and why nothing said in a chat persists into the model afterward. See [0.2](/ai-engineering/module-00/02-training-vs-inference).
:::

::: details Q3. What does RLHF actually add that pretraining doesn't?
**A:** Pretraining buys capability — the ability to produce plausible text. RLHF (or DPO) buys judgement — which of several plausible answers a human would actually prefer. Without it, a model imitates whatever register its training data implies for a given prompt, including registers no product wants. It also explains most refusal and hedging behavior, and why preference tuning creates a structural bias toward confident phrasing, part of why hallucinations read as fluent rather than obviously wrong. See [0.4](/ai-engineering/module-00/04-rlhf).
:::

::: details Q4. Why does the same conversation cost more in some languages than others?
**A:** Tokenizers are trained predominantly on English corpora, so English text tokenizes more efficiently — fewer tokens per unit of meaning. The same content in Arabic or Japanese commonly needs more tokens to represent, which increases cost proportionally even though nothing about the interaction changed. See [1.1](/ai-engineering/module-01/01-llms-and-tokens).
:::

::: details Q5. Why does "lost in the middle" matter for prompt design?
**A:** Models don't weight all context positions equally — information buried in the middle of a long input is used less reliably than information near the start or end. Practical implication: put the most important instruction or fact first or last, and don't assume a fact is "in context" just because it's technically present in the token stream. See [1.3](/ai-engineering/module-01/03-context-engineering).
:::

## Agents

::: details Q6. What actually makes an agent different from a single LLM call?
**A:** A loop: think, decide whether a tool is needed, act, observe the result, repeat — versus one question, one answer. The intelligence is in the repetition and the tool access, not any single step being smarter. See [2.1](/ai-engineering/module-02/01-agent-loop).
:::

::: details Q7. How do you prevent an agent from looping indefinitely?
**A:** Layered defenses: a hard max-turns limit, per-tool-call timeout, loop detection on repeated identical calls, and a total token budget per run. Max-turns plus loop detection catches nearly everything in practice. See [2.1](/ai-engineering/module-02/01-agent-loop).
:::

::: details Q8. How should you design a tool that performs a write action (refund, delete, send)?
**A:** Separate read tools (given freely) from write tools (gated). For writes, have the agent propose the action and route it through a confirmation step — auto-approve low-stakes ones, require human approval for high-stakes ones. Make write tools idempotent so a retry can't double-apply. See [2.2](/ai-engineering/module-02/02-tools-and-tool-calling).
:::

::: details Q9. What are the different kinds of agent memory and when does each apply?
**A:** Working memory (current session, lives in context), episodic (past conversation records), semantic (durable facts like plan tier, looked up rather than carried in every prompt), procedural (learned strategies, rare in production). Matching type to lifespan is the actual design decision — carrying everything in working memory is a cost problem, not just a UX one. See [2.3](/ai-engineering/module-02/03-agent-memory).
:::

::: details Q10. When does multi-agent architecture actually pay for itself?
**A:** When a single agent's instructions genuinely conflict across domains — not just when complexity is high. Every hop is a full model call re-sending context, so multi-agent trades latency and cost for specialization, not speed. Try a well-structured single agent first. See [2.6](/ai-engineering/module-02/06-multi-agent).
:::

::: details Q11. What is the agent harness responsible for, and why does it matter more than prompt quality for reliability?
**A:** The harness owns the loop, turn/token limits, tool execution, timeouts, state, and guardrail hooks — the control flow around the model's decisions. Most production agent failures trace to harness bugs (silent tool failures, missing turn limits, no explicit failure path) rather than the model reasoning badly. See [2.5](/ai-engineering/module-02/05-agent-harness).
:::

::: details Q12. What does MCP actually standardize?
**A:** Tool discovery and exposure across a client-server protocol, not the tool-calling mechanism itself — the model still just sees "tools." It lets a tool built once (e.g., a GitHub MCP server) be reused by any MCP-compatible agent. A third-party MCP server is a new trust boundary — treat its outputs as untrusted input. See [2.7](/ai-engineering/module-02/07-mcp).
:::

## The Application Layer

::: details Q13. Why does streaming feel faster even when total latency is identical?
**A:** Users experience time-to-first-token (TTFT), not total latency. A 4-second response with 300ms TTFT feels fast; a 2-second response with 2-second TTFT feels slow. Streaming doesn't reduce total time, it changes when the first token appears. See [3.1](/ai-engineering/module-03/01-streaming-and-sse).
:::

::: details Q14. Streaming works locally but arrives all at once in production. What's the likely cause?
**A:** Proxy buffering — nginx and similar reverse proxies buffer responses by default and will accumulate an entire SSE stream before forwarding it. Confirm with `curl -N` directly against the app versus through the proxy. Fix with `X-Accel-Buffering: no` on the response, or disable proxy buffering for that route. See [3.1](/ai-engineering/module-03/01-streaming-and-sse).
:::

::: details Q15. What's the difference between JSON mode and schema-constrained structured output?
**A:** JSON mode guarantees syntactically valid JSON but not the right shape — fields can be missing, misnamed, or wrongly typed. Schema-constrained generation masks the token sampler so only schema-valid tokens can be produced, guaranteeing both valid JSON and correct structure. Neither guarantees the *content* is correct — structure and accuracy are separate problems. See [3.2](/ai-engineering/module-03/02-structured-outputs).
:::

::: details Q16. Why does field order matter in a structured output schema?
**A:** JSON is generated in order, so a field placed earlier is generated first and everything after it is conditioned on it. Put a `reasoning` field first if you want the model to think before committing to a decision field — put it last and it becomes post-hoc justification of an answer already chosen. See [3.2](/ai-engineering/module-03/02-structured-outputs).
:::

::: details Q17. How should a repair loop for failed structured output be bounded?
**A:** Cap attempts (2 is typical) and feed back the actual validation error, not just "try again" — a model that fails validation twice with the error in hand is unlikely to succeed on a third paid attempt. See [3.2](/ai-engineering/module-03/02-structured-outputs).
:::

::: details Q18. How do you classify which failures are worth retrying?
**A:** 429 and 5xx are transient and worth retrying with backoff. 400, 401/403, and content-filter refusals are deterministic for that input — retrying wastes money and floods logs without changing the outcome. Sustained 5xx should route to a fallback provider rather than more retries against the same failing one. See [3.3](/ai-engineering/module-03/03-reliability-and-fallbacks).
:::

::: details Q19. Why is jitter necessary in a retry backoff strategy?
**A:** Without randomized jitter, every request that hit the same rate limit retries at the same computed delay, creating a synchronized stampede that re-triggers the very limit being backed off from. Jitter spreads retries across a window instead. See [3.3](/ai-engineering/module-03/03-reliability-and-fallbacks).
:::

::: details Q20. Does a client-side timeout stop the provider from billing you?
**A:** No. Abandoning a request client-side doesn't automatically tell the provider to stop generating — only a propagated `AbortController` signal that actually reaches the SDK's upstream call does both. A timeout alone protects your latency, not your invoice. See [3.3](/ai-engineering/module-03/03-reliability-and-fallbacks).
:::

::: details Q21. Why does agent cost grow faster than conversation length would suggest?
**A:** Each iteration of an agent loop resends the entire growing conversation as context, so cost grows roughly quadratically with the number of iterations, not linearly. Reducing iteration count is one of the highest-leverage cost levers available. See [3.4](/ai-engineering/module-03/04-cost-and-token-accounting).
:::

::: details Q22. Why can prompt caching silently stop working after a routine change?
**A:** Caching keys on an exact prefix match. Any edit to the cached portion — even one character — produces a different prefix and invalidates the cache with no error message, just a quiet cost increase. Keeping variable content (timestamps, user IDs) out of the prefix and edited deliberately avoids this. See [3.5](/ai-engineering/module-03/05-prompt-caching).
:::

## Retrieval, Evaluation & Observability

::: details Q23. When is a problem a retrieval problem versus a prompting problem?
**A:** If the model lacks the information entirely — it was never in training data and isn't in context — no prompt wording fixes that; it needs RAG. If the model has the knowledge but phrases or formats it inconsistently, that's a prompting problem. Confusing the two produces more confident wrong answers instead of a fix. See [4.1](/ai-engineering/module-04/01-when-you-need-retrieval).
:::

::: details Q24. Why is agent evaluation harder than evaluating a single model response?
**A:** There's usually no single ground-truth answer, the same response can be good or bad depending on user context, and fluency is independent of accuracy — a confidently wrong answer often scores better on surface quality than a correctly hedged one. This is why agent evaluation needs paired techniques (golden datasets, calibrated LLM-as-judge, outcome metrics) rather than one metric. See [5.2](/ai-engineering/module-05/02-evaluation-pipeline).
:::

::: details Q25. What does calibrating an LLM-as-judge actually involve?
**A:** Sampling real conversations, scoring them with both the judge and a human on the same rubric, and checking agreement — if they disagree on more than roughly 15-20%, the judge isn't a reliable signal yet. Recheck periodically, since judge behavior drifts when the judge model changes. See [5.2](/ai-engineering/module-05/02-evaluation-pipeline).
:::

::: details Q26. Why is optimizing for quality scores alone dangerous?
**A:** A system can produce highly-rated, well-written responses that don't actually solve the user's problem, with every quality dashboard green while the real outcome — task completion, escalation rate — quietly worsens. Always pair a quality metric with an outcome metric that can contradict it. See [5.2](/ai-engineering/module-05/02-evaluation-pipeline).
:::

::: details Q27. How do you diagnose a bad agent answer in production?
**A:** Find the run by correlation ID, replay the full trace, and read the *inputs* to each LLM call, not just outputs — the bug is usually visible there: stale context, a wrong tool result, or missing information a human would have needed. Distinguishing "context bug" from "model bug" is the key branch, and it's only visible from the input side. See [6.1](/ai-engineering/module-06/01-production-metrics).
:::

## Security, Architecture & Serving

::: details Q28. Why do guardrails belong in code, not just in the prompt, for high-stakes actions?
**A:** A prompt instruction is a request to a probabilistic system — it can be bypassed by adversarial input. A harness-level check (validated arguments, hard limits, confirmation gates) is a guarantee that doesn't depend on model behavior. For anything with financial or legal consequence, the enforcement layer needs to be outside the model. See [7.1](/ai-engineering/module-07/01-ai-security).
:::

::: details Q29. What's the difference between a hard stop and a soft redirect in guardrail design?
**A:** A hard stop refuses to respond at all — reserved for genuine safety or policy violations. A soft redirect responds, but to a reframed, in-scope version of the request. Most out-of-scope cases should get a soft redirect; over-using hard stops produces invisible false positives, since blocked users simply leave rather than complain. See [7.1](/ai-engineering/module-07/01-ai-security).
:::

::: details Q30. When does self-hosting a model actually make sense over a cloud API?
**A:** Mainly data residency/compliance constraints that prohibit sending data to a third party, or sustained volume high enough that fixed GPU cost undercuts per-token pricing — a crossover point usually higher than intuition suggests once engineering and ops time are included. See [9.1](/ai-engineering/module-09/01-model-serving-overview).
:::

::: details Q31. What problem does vLLM specifically solve?
**A:** GPU memory efficiency and throughput under concurrency, via PagedAttention (managing KV cache in flexible pages rather than large contiguous blocks) and continuous batching. It's an infrastructure answer to serving efficiently, not a capability improvement — the underlying model's quality ceiling is unchanged. See [9.3](/ai-engineering/module-09/03-vllm).
:::

::: details Q32. Why isn't fine-tuning the right tool for teaching a model new facts?
**A:** Fine-tuning bakes behavior into weights at a point in time. Facts that change — pricing, policies, current events — would need retraining every time they update, which doesn't scale. That's what retrieval is for; fine-tuning is better suited to durable style, tone, and domain-pattern shifts. See [10.3](/ai-engineering/module-10/03-when-to-fine-tune).
:::

::: details Q33. How does LoRA make fine-tuning affordable on ordinary hardware?
**A:** It freezes the entire pretrained model and trains only small, low-rank adapter matrices injected alongside the original weights — often under 1% of total parameters — so memory and compute scale with the adapter, not the full model. QLoRA compounds this by loading the frozen base in 4-bit precision. See [10.2](/ai-engineering/module-10/02-lora-qlora).
:::

## Cost, Strategy & Judgment

::: details Q34. Month-over-month LLM spend rose 60% with flat request volume. What's your diagnosis path?
**A:** Flat requests with rising spend means tokens per request grew. Split input vs output growth first, then segment by tenant, feature, and model. Check iteration count per agent run — a rising average points at a looping tool. Correlate with deploys for step changes; check cache hit rate for gradual drift. All of this requires per-call attribution data captured up front. See [3.4](/ai-engineering/module-03/04-cost-and-token-accounting).
:::

::: details Q35. How do you cut agent costs without a measurable quality regression?
**A:** Cheapest-risk first: route non-user-facing steps (classification, routing) to a smaller model, since risk there is bounded and verifiable against a golden set. Then prompt caching order fixes, which are pure wins. Then context trimming and loop-efficiency fixes. Gate every change on the evaluation suite so "without degrading quality" is measured, not assumed. See [3.4](/ai-engineering/module-03/04-cost-and-token-accounting).
:::

::: details Q36. A newer model benchmarks better across the board, but users say the product "got worse." How?
**A:** Benchmarks measure capability; alignment calibration (refusal rate, hedging, verbosity, format habits) changes between versions independently of capability and isn't captured by standard benchmarks. Prompts tuned to the old model's defaults can under-specify against the new one. Fix: run the golden dataset against both versions before switching, and expect to re-tune prompts rather than assuming portability. See [0.4](/ai-engineering/module-00/04-rlhf).
:::

## Key Mental Models to carry into an interview

**Architecture explains behavior, not capability.** Test empirically rather than reasoning from first principles about what a model can do.

**Every module in this track exists because the previous one created a problem it had to solve.** If you can explain *why* a technique exists, not just what it does, you're answering at the depth these questions are testing for.

**Cost, security, and reliability all converge on the same principle:** anything with real consequence belongs in code, not in a prompt instruction.
