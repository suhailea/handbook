---
title: The Agent Loop
outline: deep
---

# The Agent Loop

TaskFlow's agent had a tool to look up tickets. The question was how it decides *when* to use it, and how it knows it's done. That's the agent loop.

::: tip Plain English
A single LLM call is one question, one answer. An agent is a loop: think, maybe act, observe the result, think again — like a detective who reads a file, makes a call, follows up on what they learn, then forms a conclusion. Each step informs the next.
:::

## Think → Act → Observe

```
User message → Think (LLM call) → tool needed? ─yes─→ Act → Observe ─┐
                    ↑no                                               │
                 Respond                                    back to Think
```

For TaskFlow: user asks about ticket #4821 → model decides it needs `lookup_ticket` → harness calls it → result comes back as a new message → model now has enough to answer. One tool call here; a complex ticket might take three or four.

## When it stops

1. The model returns a final answer with no tool call
2. Max turns is hit (set one — 10–15 is plenty for support tasks)
3. A tool errors and you choose not to retry
4. A guardrail halts it

| | Single call | Agent loop |
|---|---|---|
| Turns | 1 | Multiple |
| Uses tools | No | Yes |
| Cost/latency | Predictable | Variable |
| Best for | Simple Q&A, classification | Multi-step tasks needing real data |

For TaskFlow, a simple "what's your refund policy" question never enters the loop at all — it's answered in one call. A ticket that requires checking account status, then cross-referencing a policy document, then possibly escalating, genuinely needs the loop: each step depends on what the previous one found.

::: warning Watch out
Without a turn limit, agents loop forever — a failing tool, misread output, or circular reasoning ("I need X to get Y, I need Y to get X") can spin indefinitely. Defenses: hard max-turns, per-tool timeout, and loop detection (same tool, same arguments twice = break).
:::

::: details Interview Question — Preventing runaway agents
**Q:** How do you stop an agent from looping indefinitely or burning tokens?
**A:** Layered: hard max-turns (10–15 typical), per-tool-call timeout, loop detection on repeated identical calls, a total token budget per run, and cost alerts per run. Max-turns plus loop detection catches nearly everything in practice.
:::

::: details Interview Question — Single call vs agent
**Q:** When would you deliberately avoid making something an agent?
**A:** When the task is one-shot and doesn't need real-time data or actions — classification, formatting, simple Q&A. Agents add latency and cost variance for no benefit there; reserve the loop for tasks that genuinely need multiple steps or external state.
:::

## Key Mental Models

**An agent is a loop, not a smarter call.** The intelligence is in the repetition, not any single step.

**Always cap turns.** An uncapped loop is a production incident waiting for a bad tool response.

## Related

- [2.2 Tools & Tool Calling](./02-tools-and-tool-calling) — what Act actually invokes
- [2.5 The Agent Harness](./05-agent-harness) — where turn limits and timeouts live
- [3.3 Reliability & Fallbacks](/ai-engineering/module-03/03-reliability-and-fallbacks) — retry policy inside the loop
