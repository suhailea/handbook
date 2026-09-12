---
title: The Agent Harness
outline: deep
---

# The Agent Harness

The model decides what to do next. Something else has to actually run the loop, enforce limits, catch errors, and call tools safely. That something is the harness — and it's the part of an "agent" that's ordinary engineering, not model behaviour.

::: tip Plain English
If the model is the decision-maker, the harness is everything around it: the stage manager who enforces the schedule, cuts the scene if it runs too long, and makes sure props are handed over safely. None of that requires intelligence — it's control flow, and it's where most agent bugs actually live.
:::

## What the harness owns

- **The loop itself** — calling the model, executing returned tool calls, appending results, repeating
- **Turn and token limits** — the hard stop that [2.1](./01-agent-loop) depends on
- **Tool execution** — actually running the function the model requested, with its own error handling
- **Timeouts** — per-call and per-run, independent of what the model wants
- **State** — conversation history, memory, whatever persists between turns
- **Guardrail hooks** — where input/output checks plug in (see [Module 7](/ai-engineering/module-07/))

```typescript
async function runAgent(input: string, maxTurns = 12): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: input }];
  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await callModel(messages);          // "think"
    if (!response.toolCall) return response.text;          // done
    const result = await executeTool(response.toolCall);   // "act" — harness owns this
    messages.push(response.toAssistantMessage(), toolResultMessage(result));
  }
  return 'Reached turn limit without a final answer.';     // explicit, not a silent hang
}
```

Frameworks (LangGraph, custom loops, provider-native agent SDKs) all implement some version of this. The differences are mostly in how much control-flow flexibility you get versus how much is handled for you — a framework that hides the loop entirely also hides the place you'd add a turn limit or a custom guardrail.

## Build vs use a framework

| | Custom harness | Framework (e.g. LangGraph) |
|---|---|---|
| Control | Full | Bounded by the framework's model |
| Setup time | More | Less |
| Debuggability | You wrote it, you understand it | Depends on the abstraction |
| Right for | Non-standard flows, tight cost control | Standard patterns, faster to ship |

::: warning Watch out
The harness is where silent failures hide. A tool that throws and gets swallowed by a generic try/catch looks, from the outside, like the model just "decided" not to use it — and you'll spend an hour debugging the prompt for a bug that's in the plumbing. Log every tool execution's success/failure explicitly, separate from model reasoning.
:::

::: details Interview Question — Where does agent reliability actually come from?
**Q:** Is a reliable production agent mostly about prompt engineering or something else?
**A:** Mostly the harness. Turn limits, timeouts, tool error handling, and explicit failure states (like the turn-limit branch above, rather than a silent empty response) prevent most of the failures people blame on the model. Prompt quality matters for *what* the agent decides; the harness determines whether a bad decision becomes a contained failure or a production incident.
:::

::: details Interview Question — Debugging a "stuck" agent
**Q:** Users report the agent sometimes returns nothing. Where do you look first?
**A:** The harness's loop termination, not the model. Check whether the turn limit was hit without a final-answer branch returning something explicit — a loop that exits via `for` completing with no `return` inside it fails silently. Also check tool execution errors being swallowed by a catch block that doesn't log or surface them.
:::

## Key Mental Models

**The harness is where reliability engineering actually happens.** Prompting shapes decisions; the harness contains the consequences of bad ones.

**Every exit from the loop needs an explicit path.** A silent fallthrough is a bug waiting to be reported as "the agent didn't answer."

## Related

- [2.1 The Agent Loop](./01-agent-loop) — the loop the harness runs
- [3.3 Reliability & Fallbacks](/ai-engineering/module-03/03-reliability-and-fallbacks) — timeout and retry policy in detail
- [7.2 Agent Security](/ai-engineering/module-07/02-agent-security) — authorization gates as a harness responsibility
