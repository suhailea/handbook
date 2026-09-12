---
title: Multi-Agent Systems
outline: deep
---

# Multi-Agent Systems

TaskFlow's single agent could handle billing and technical tickets fine on its own. Once we wanted specialist handling — a billing expert, a technical expert, a triage step to route between them — one agent with one giant prompt started buckling. Multi-agent is splitting that up.

::: tip Plain English
One generalist doing everything eventually knows a little about a lot and struggles with depth. A small team of specialists, plus someone to route work to the right one, usually beats a generalist on hard, varied work — as long as the routing is good. Multi-agent systems are that team, built out of LLM calls instead of people.
:::

## The common patterns

**Orchestrator–worker** — one agent triages and routes, specialist agents handle their domain, results return to the orchestrator for a final response. This is what TaskFlow uses: a router classifies the ticket, hands it to a billing or technical sub-agent, and the orchestrator composes the reply.

**Pipeline** — fixed sequence, each agent's output feeds the next (extract → classify → draft → review). No dynamic routing; the order is always the same.

**Debate/critique** — two agents argue or one critiques the other's output before it ships. Expensive — doubles or triples the calls — and best reserved for high-stakes generation where the extra cost is justified.

```
User ticket
    │
    ▼
Orchestrator (classify + route)
    │
    ├──billing──▶ Billing Agent ──┐
    │                              ├──▶ Orchestrator (compose reply)
    └──technical─▶ Tech Agent ────┘
```

## The real cost

Every hop is a full model call with its own context. A three-agent pipeline isn't 3× the latency of one call by accident — it's the honest cost of splitting work that a single well-prompted agent might have done in one pass. Multi-agent buys specialization and modularity, not speed or cost savings.

| | Single agent | Multi-agent |
|---|---|---|
| Latency | Lower | Higher — each hop is a call |
| Cost | Lower | Higher |
| Prompt complexity per agent | High (does everything) | Lower (narrow domain) |
| Debuggability | One place to look | Failure could be at any hop |

::: warning Watch out
Multi-agent is not automatically better — it's a real complexity and cost trade, and teams reach for it before trying a well-structured single agent first. If one agent with a good prompt and the right tools solves it, that's simpler to build, debug, and pay for. Split only when a single prompt is genuinely straining under conflicting instructions for different domains.
:::

::: details Interview Question — When to split into multiple agents
**Q:** Your single agent's prompt has grown to handle five different ticket types and is getting unreliable. Do you split it into multiple agents?
**A:** Probably, but check the cause first — sometimes the fix is better tool descriptions or context engineering, not more agents. Split when the *instructions* genuinely conflict across domains (billing tone vs technical precision) such that one prompt can't serve both well. Route with a cheap classifier upfront rather than asking the orchestrator to do deep reasoning about routing.
:::

::: details Interview Question — Debugging a multi-agent failure
**Q:** A multi-agent pipeline produces a wrong final answer. How do you find which agent is responsible?
**A:** Trace the full run (see [Module 6](/ai-engineering/module-06/01-production-metrics)) and inspect each hop's input and output independently. The failure is usually visible at the boundary where one agent's output doesn't match what the next agent needed — a classification that was subtly wrong, or a handoff that dropped context. Check inputs before blaming reasoning.
:::

## Key Mental Models

**Multi-agent trades latency and cost for specialization.** It's not a speed optimization.

**Try a single well-designed agent first.** Reach for multi-agent when conflicting instructions, not just complexity, force the split.

## Related

- [2.5 The Agent Harness](./05-agent-harness) — orchestrating multiple agents is still harness work
- [2.7 MCP](./07-mcp) — how agents expose tools to each other in a standard way
- [3.4 Cost & Token Accounting](/ai-engineering/module-03/04-cost-and-token-accounting) — each hop re-bills context
