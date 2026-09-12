---
title: Cost & Token Accounting
outline: deep
---

# Cost & Token Accounting

TaskFlow's first monthly bill was 4.1× the forecast. Nobody could explain it. We knew the total, we knew roughly how many conversations we'd had, and that was the entire extent of our visibility. It took two days of log archaeology to find that a single enterprise customer's document-heavy tickets accounted for most of the overage — and by then we'd already had the uncomfortable meeting.

::: tip Plain English
Most infrastructure costs scale with something you can see coming. Servers cost the same whether they're busy or idle. Storage grows predictably. You can look at a graph and forecast next month.

Model costs scale with something invisible: how much text moves through, in both directions, per request. Two conversations that look identical in your analytics — same user, same feature, same duration — can differ by 50× in cost because one of them pasted a contract into the chat. Nothing in a request count tells you that.

So the discipline isn't cost *optimisation* first. It's cost *attribution* — being able to answer "which thing cost that" before you try to make it cheaper. Teams that skip straight to optimisation end up shaving 10% off something that wasn't the problem.
:::

## The shape of the cost model

Three properties drive almost everything.

**Input and output are priced differently.** Output typically runs 3–5× input per token. A prompt-heavy, answer-light workload behaves completely differently from a summarisation workload, and averaging them hides both.

**Cost is per token, not per request.** Your request count can be flat while spend triples. This is why request-based dashboards are actively misleading here.

**Agent runs multiply.** A single user message that triggers four tool calls means five model calls, and each one resends the *entire* growing conversation. The context is re-billed every iteration.

That last one is the effect people consistently underestimate:

| Iteration | Context sent | Cumulative input tokens |
|---|---|---|
| 1 | system + user | 1,200 |
| 2 | + tool result | 2,600 |
| 3 | + tool result | 4,300 |
| 4 | + tool result | 6,400 |
| 5 | + tool result | 8,900 |

Five iterations, but 8,900 input tokens billed rather than the ~2,000 of unique content. The growth is quadratic in conversation length, and it's the single largest lever on agent cost.

## Instrumenting properly

Every provider returns usage on the response. Capture it at the call site — not estimated later from text length, which drifts from the real tokeniser.

```typescript
// Node 22+, ESM.
const PRICING: Record<string, { in: number; out: number }> = {
  // USD per 1M tokens — illustrative; verify against current provider pricing
  'gpt-4o':      { in: 2.50, out: 10.00 },
  'gpt-4o-mini': { in: 0.15, out: 0.60 },
};

interface CallCost {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costUsd: number;
}

function priceCall(model: string, usage: Usage): CallCost {
  const p = PRICING[model] ?? { in: 0, out: 0 };
  const cached = usage.prompt_tokens_details?.cached_tokens ?? 0;
  const fresh = usage.prompt_tokens - cached;
  return {
    model,
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    cachedTokens: cached,
    // cached input is typically discounted heavily — price it separately
    costUsd: (fresh * p.in + cached * p.in * 0.1 + usage.completion_tokens * p.out) / 1e6,
  };
}
```

Pricing changes, so treat the table as configuration rather than a constant. What matters more is the dimensions you attach when you emit the record:

```typescript
metrics.record('llm.call', {
  ...priceCall(model, response.usage),
  runId, userId, tenantId,
  feature: 'support_agent',
  iteration: loopIndex,
});
```

`tenantId` and `feature` are what let you answer the 4.1× question in a query instead of two days of log reading. `iteration` is what exposes runaway agent loops. Adding dimensions later means backfilling data you didn't keep.

## The three questions your data must answer

**What does one unit of value cost?** Cost per resolved ticket, not cost per API call. If an agent costs $0.04 and deflects a $6 human interaction, expensive is the wrong frame. This is the number to bring to a budget conversation.

**Where is spend concentrated?** Almost always a small subset — one tenant, one feature, one prompt. TaskFlow's overage was 3% of users driving 60% of cost. You cannot find that without per-tenant attribution.

**What changed?** A step change in cost-per-request usually means a prompt edit, a model swap, or a retrieval change that widened context. Correlating cost with deploys turns a mystery into a diff.

## Where the money actually goes

In rough order of impact:

**Context you didn't need to send.** Full conversation history when the last three turns would do; ten retrieved chunks when three are relevant; a 2,000-token system prompt repeated on every one of five iterations. This is the biggest and most common source.

**Model over-provisioning.** Classification, routing and extraction rarely need a frontier model. Routing those to a small model is often a 10–20× reduction on that slice at equal quality — and it's the highest-leverage change most teams haven't made.

**Cache misses from prompt ordering.** Prompt caching keys on the *prefix*. Put anything variable — a timestamp, a user ID — near the front and you invalidate the cache on every request. Move static content first and variable content last and the same prompt gets dramatically cheaper. Covered in [3.5](./05-prompt-caching).

**Retry amplification.** Three retries on a failing call is 4× the cost for that request, and partial generations are billed even when they fail.

**Abandoned streams.** Generation continues after a client disconnects unless you propagate the abort. See [3.1](./01-streaming-and-sse).

## Budgets as a control, not a report

An alert that fires after the spend has happened is a notification, not a control. Enforce limits where they can still stop something:

**Per run** — a token ceiling that halts an agent loop. This is what catches a runaway agent before it becomes a line item rather than after.

**Per tenant** — a monthly cap with degradation at the threshold: drop to a cheaper model, or queue rather than refuse. Hard cutoffs turn a cost problem into an availability incident.

**Per feature** — so an experiment can't consume the production budget.

TaskFlow's median run is around $0.003. We alert on any single run above $0.05 — roughly 15× median — which has caught two loop bugs that would otherwise have been invisible until month end.

::: warning Watch out
**Estimating tokens from character counts drifts.** Different tokenisers split differently, and code, JSON and non-English text all cost more per character than English prose. Use the `usage` object the provider returns; it's authoritative and free.

**Averages hide the distribution that matters.** A mean cost per request of $0.004 is consistent with 95% of requests at $0.001 and 5% at $0.06. Track p50, p95 and p99 — the tail is where both the bugs and the budget live.

**Cheap models are not cheap if they need more attempts.** A model at 1/10th the price that requires two calls plus a repair loop, or produces answers that get escalated to a human, may cost more all-in. Compare cost per *successful outcome*, not cost per call.
:::

::: details Interview Question — Diagnosing a cost spike
**Q:** Month-over-month LLM spend rose 60% while request volume stayed flat. Walk through your diagnosis.

**A:** Flat requests with rising spend means tokens per request went up, so the whole investigation is about what widened.

First split input versus output. Rising input points at context: longer histories, more retrieved chunks, a bigger system prompt. Rising output points at generation: a prompt change encouraging verbosity, a removed length limit, or a format change.

Then segment. By model — did traffic shift toward a more expensive one, perhaps via a fallback path that's been quietly active? By tenant — is it concentrated, which is the common case? By feature — did one surface change? By iteration count — if mean iterations per agent run rose, a tool is failing and the agent is looping, which inflates cost quadratically because each iteration resends the whole context.

Then correlate with deploys. A step change on a specific date is a diff; a gradual slope is usage or data growth, like a knowledge base that got larger so retrieval returns more.

Also check cache hit rate. If prompt caching was working and a prompt edit moved variable content earlier in the prefix, hit rate collapses and input cost jumps with no visible change in behaviour. That one is easy to miss because nothing about the output looks different.

The prerequisite for all of this is per-call records with model, tenant, feature and iteration attached. Without those dimensions it's log archaeology.
:::

::: details Interview Question — Cutting cost without losing quality
**Q:** You're asked to halve agent costs without degrading user-visible quality. What do you do, and in what order?

**A:** Measure the distribution first — p50, p95, p99, and cost segmented by feature and tenant. Cutting into the wrong part of the distribution is how quality regressions happen.

Then, cheapest-risk first. Route non-user-facing steps — classification, routing, extraction, summarisation for internal use — to a small model. These are usually a meaningful share of calls and quality is measurable against a golden set, so the risk is bounded and verifiable.

Next, prompt caching. Reorder prompts so static content sits in the prefix and variable content at the end. This is a pure win with no quality effect at all, and if the ordering was wrong it can be a large one.

Then context discipline: trim conversation history with a sliding window plus a summary rather than sending everything; reduce retrieved chunks and rerank so fewer are needed; strip redundancy from the system prompt, which is billed on every iteration.

Then loop efficiency: lower max iterations, add loop detection, and fix tools that fail and trigger retries. Because context is re-sent each iteration, reducing iterations cuts cost super-linearly.

Keep frontier models for the final user-facing generation, which is where quality is perceived. And gate all of it on the evaluation suite — every change runs against the golden set before shipping, so "without degrading quality" is a measured claim rather than a hope.
:::

## Key Mental Models

**Attribution before optimisation.** You cannot reduce what you cannot locate, and the concentration is almost never where intuition says.

**Agent context is re-billed every iteration.** Cost grows quadratically with conversation length, which makes iteration count the highest-leverage variable.

**Cost per outcome, not cost per call.** A cheaper model that needs two attempts and an escalation is not cheaper.

**The tail is the budget.** Averages conceal the p99 runs where bugs and spend both live.

**A budget that only alerts is a report.** Enforce at run and tenant level, and degrade rather than cut off.

## Related

- [3.5 Prompt Caching & the KV Cache](./05-prompt-caching) — prefix ordering as a cost lever
- [3.6 Semantic Caching](./06-semantic-caching) — skipping the call entirely
- [3.3 Reliability & Fallbacks](./03-reliability-and-fallbacks) — retry amplification
- [6.1 Production Metrics](/ai-engineering/module-06/01-production-metrics) — cost as a tracked production signal
- [13.2 AI Metrics & ROI](/ai-engineering/module-13/02-ai-metrics-roi) — turning cost per outcome into a business case
