---
title: The Agent Loop — How an Agent Actually Runs
outline: deep
---

# The Agent Loop — How an Agent Actually Runs

We gave TaskFlow's agent a tool to look up tickets. But how does it decide when to use it? How does it know when it's done? That's the agent loop.

::: tip Plain English
A single LLM call is like asking a question and getting an answer. That's it — one in, one out.

An agent is different. It's a loop. The model thinks, decides to do something, does it, sees the result, and then thinks again. It keeps going until it has an answer or hits a limit.

Think of it like a detective. You don't just hand a detective a case file and wait. They read the file, then make a call, then follow up on what they learn, then look at something else, then form a conclusion. Each step informs the next. That's the agent loop.
:::

## The Think → Act → Observe cycle

```
User message
     ↓
  Think (LLM call)
     ↓
 Need a tool? ──── Yes ──→ Call tool ──→ Observe result ──┐
     ↓ No                                                   │
  Respond                                              back to Think
```

Each iteration of the loop:

1. **Think** — The model sees the conversation + any tool results so far, and produces either a tool call or a final response.
2. **Act** — If the model produced a tool call, the harness executes it (calls your actual function/API).
3. **Observe** — The result of the tool call is added to the conversation as a new message, and the loop repeats.

For TaskFlow:
- User: "Can you check on ticket #4821?"
- Think: "I need the lookup_ticket tool for this."
- Act: Call `lookup_ticket(id="4821")`
- Observe: `{ status: "open", priority: "high", assigned_to: "Sarah" }`
- Think: "I have the info. I can answer now."
- Respond: "Ticket #4821 is open and assigned to Sarah, marked high priority."

That was one tool call. A complex ticket might require three or four.

## When does the loop stop?

The loop stops when one of these happens:

1. **The model produces a final answer** (no tool call in its output)
2. **Max turns is hit** — you set a limit (e.g., 10 iterations) and the loop stops regardless
3. **An error occurs** — a tool fails and you decide not to retry
4. **A guardrail triggers** — the harness detects something wrong and halts

::: warning Watch out
Without a max turns limit, agents can loop forever. We've seen this happen with TaskFlow: the agent would call lookup_ticket, get an unexpected status code, try to interpret it, call another tool to get more context, get confused, try the first tool again... and spin indefinitely.

Always set a max turns limit. 10–15 is usually plenty for support tickets. If an agent needs more than that to answer a question, the question is probably too complex for a single agent run anyway.
:::

## Single LLM call vs agent

| | Single call | Agent loop |
|---|---|---|
| Turns | 1 | Multiple |
| Can use tools | No | Yes |
| Can adapt | No — fixed input/output | Yes — observes results and adjusts |
| Cost | Predictable | Variable (more tools = more tokens) |
| Latency | Predictable | Variable |
| Best for | Simple Q&A, formatting, classification | Multi-step tasks, tasks needing real data |

## The risk of infinite loops

Three things cause runaway agents:

1. **A tool that always fails** — the agent keeps retrying because it thinks the tool is the answer
2. **The model misreading tool output** — it doesn't realize it already has what it needs
3. **Circular reasoning** — "I need X to get Y, I need Y to get X"

Defenses: max turns, timeout per tool call, detect repeated tool calls with identical inputs and break the loop.

::: details Interview Question — Agent termination
**Q:** How do you prevent an agent from running indefinitely or wasting tokens in a loop?

**A:** Defense in depth: (1) Hard max-turns limit — no matter what, stop after N iterations (10–15 for most tasks). (2) Per-tool-call timeout — each tool call has a timeout so a slow external API can't stall the agent. (3) Loop detection — if the same tool is called with the same arguments twice, you're in a loop; break out. (4) Token budget — set a max total token usage per agent run and halt if exceeded. (5) Cost tracking per run — alert if a single agent run exceeds a cost threshold. In practice, max-turns + loop detection catches 99% of cases.
:::
