---
title: Planning & Reflection
outline: deep
---

# Planning & Reflection

Give an agent a hard multi-step ticket and it can charge straight into the first tool call that seems relevant, then get stuck when that path doesn't pan out. Planning and reflection are what let it think before, and check after.

::: tip Plain English
Most people don't solve a hard problem in one pass — they sketch a rough plan, try a step, notice it's not working, and adjust. An agent that only reacts turn-by-turn skips the sketching and the noticing. Planning is giving it room to sketch; reflection is giving it room to notice.
:::

## Two techniques, one purpose

**ReAct (Reason + Act)** interleaves explicit reasoning with each action, rather than jumping straight to a tool call:

```
Thought: The user wants a refund but their plan is annual, not monthly.
         I need to check the annual refund policy before acting.
Action:  search_policy("annual plan refund")
Observation: Annual refunds are prorated after 30 days.
Thought: They're at day 45, so this is a prorated refund, not full.
Action:  calculate_refund(plan="annual", days_used=45)
```

The visible "Thought" step is not decoration — it materially improves reliability on multi-step tasks, because the model commits to reasoning before committing to an action, rather than pattern-matching straight to a plausible-looking tool call.

**Reflection** adds a self-check after producing a draft answer, before it goes to the user: does this actually address what was asked, is anything unverified, does it contradict something learned earlier in the run. This costs an extra LLM call, so it's worth reserving for high-stakes or complex responses, not every turn.

## When to add each

| Technique | Add it when |
|---|---|
| ReAct-style reasoning | Multi-step tasks where the right tool isn't obvious upfront |
| Upfront planning | The task has a known structure (e.g. "checklist" tasks) |
| Reflection pass | High-stakes or long responses where an error is costly |
| Neither | Simple single-tool lookups — the overhead isn't worth it |

::: warning Watch out
Planning and reflection both add latency and cost — each is roughly one more model call. Applying them to every turn of a simple agent is the most common over-engineering mistake in this area. Reserve them for tasks that are actually hard; a ticket status lookup doesn't need a plan.
:::

::: details Interview Question — When ReAct helps and when it doesn't
**Q:** Would you add ReAct-style reasoning to every agent turn?
**A:** No. It helps most on tasks with real branching — where the right tool depends on information not yet known. For a single deterministic lookup, the reasoning step is pure overhead: extra tokens, extra latency, no change in outcome. Measure task complexity, not just "agents are supposed to reason."
:::

::: details Interview Question — Catching a bad answer before it ships
**Q:** How would you use reflection to reduce wrong answers without doubling every response's latency?
**A:** Apply it conditionally, not universally — trigger a reflection pass only for responses above a length or stakes threshold (financial figures, policy claims, escalation decisions), and skip it for routine acknowledgments. That keeps the added cost proportional to the risk.
:::

## Key Mental Models

**Reasoning before acting reduces wrong turns, at a cost.** It's a trade, not a free upgrade.

**Match the technique to the task's actual difficulty.** Most turns in a working agent are simple and don't need either.

## Related

- [2.1 The Agent Loop](./01-agent-loop) — where a reasoning step sits inside Think
- [2.5 The Agent Harness](./05-agent-harness) — where to gate reflection by stakes
