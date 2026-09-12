---
title: Model Serving — Cloud vs Local vs Self-Hosted
outline: deep
---

# Model Serving — Cloud vs Local vs Self-Hosted

Every module so far assumed you're calling a provider's API. That's the right default — but at some point cost, latency, data residency, or scale pushes teams toward running the model themselves. This page is the decision, not the implementation.

::: tip Plain English
Calling OpenAI or Anthropic's API is like ordering from a restaurant — no equipment, no staff, pay per meal, someone else handles quality and uptime. Self-hosting is running your own kitchen — real upfront cost and real operational burden, but full control and, at high enough volume, cheaper per meal. Most teams should stay in the restaurant far longer than instinct suggests.
:::

## The three options

| | Cloud API | Self-hosted (cloud GPU) | Local / on-prem |
|---|---|---|---|
| Setup effort | Minutes | Days–weeks | Weeks+ |
| Cost model | Per-token, scales with usage | Fixed GPU cost, scales with capacity | Fixed hardware cost |
| Data leaves your infra | Yes | Depends on provider | No |
| Model quality ceiling | Frontier models | Whatever you can run | Whatever fits your hardware |
| Ops burden | None | Real — scaling, uptime, upgrades | Highest |

## When self-hosting actually makes sense

**Data residency or compliance** requires prompts and outputs to never leave your infrastructure — TaskFlow's enterprise tier fits this, since some customer contracts prohibit sending data to third parties.

**Sustained high volume** where the fixed cost of GPUs undercuts per-token API pricing — this crossover point is usually much higher than teams initially estimate; do the actual math before assuming self-hosting is cheaper.

**Latency-critical paths** where a round trip to a provider's servers is unacceptable and co-locating the model with your infrastructure matters.

**A narrow, well-defined task** that a smaller open model handles adequately — classification, extraction — where you don't need frontier-model reasoning.

::: warning Watch out
Self-hosting trades a per-token bill for an operations team. GPU capacity planning, model upgrades, scaling under load, and uptime all become your responsibility — and open models generally trail frontier closed models on general reasoning, so you're often trading quality for control. Run the honest cost comparison, including engineering time, before committing.
:::

::: details Interview Question — Justifying self-hosting to a skeptical stakeholder
**Q:** Your team wants to self-host a model instead of using the OpenAI API. How do you evaluate whether that's actually justified?
**A:** Start from the constraint, not the cost. If it's driven by data residency or compliance, that's often non-negotiable and settles it regardless of price. If it's driven by cost, calculate the real crossover volume — fixed GPU cost plus engineering time for scaling, monitoring and upgrades — against current API spend at realistic growth, not current volume. Teams frequently underestimate the ops burden and overestimate near-term savings.
:::

::: details Interview Question — Choosing self-hosted vs API per task
**Q:** Would you self-host for every task in an application, or mix approaches?
**A:** Mix. Frontier-quality reasoning (complex support conversations, nuanced generation) stays on a cloud API where quality matters most. Narrow, high-volume, well-defined tasks (classification, simple extraction) are strong self-hosting candidates, since a smaller open model often performs adequately there at a fraction of the cost. Routing by task, not an all-or-nothing switch, usually wins.
:::

## Key Mental Models

**Self-hosting trades per-token cost for ops burden.** The crossover point is usually higher volume than intuition suggests.

**Data residency, not cost, is the most common real reason to self-host.** Compliance requirements often settle the question before economics do.

## Related

- [9.2 GGUF & Local LLMs](./02-gguf-and-local-llms) — running smaller models locally
- [9.3 vLLM](./03-vllm) — the serving layer for self-hosted throughput
- [11.2 Kubernetes for AI](/ai-engineering/module-11/02-kubernetes-for-ai) — operationalizing self-hosted serving
