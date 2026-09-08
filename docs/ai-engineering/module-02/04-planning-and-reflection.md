---
title: Planning & Reflection — Thinking Before Acting
outline: deep
---

# Planning & Reflection — Thinking Before Acting

Our agent kept taking wrong first steps on complex tickets. It would look up the wrong thing, get stuck, and give up. We added planning. It got dramatically better.

::: tip Plain English
Imagine an intern who, the moment a task lands in their inbox, immediately starts working — without reading it fully or thinking about what they actually need to do. They look busy, but they often do the wrong thing first and have to backtrack.

Planning is what you add to stop that. Before the agent takes any action, it thinks out loud: "What is this person actually asking? What do I need to know to answer it? What's the right order of steps?"

This sounds obvious — it's what humans do automatically. But models don't do it by default. They're trained to be helpful immediately. Sometimes being helpful means thinking first.
:::

## ReAct — Reasoning and Acting together

ReAct is the most common pattern for adding planning to agents. The name stands for **Re**asoning + **Act**ing. The idea: before each action, the model writes out its reasoning. This forces it to think before it acts.

A ReAct-style agent might produce:

```
Thought: The user is asking about ticket #4821 and seems frustrated.
         I should look up the ticket first to understand the current state
         before saying anything.

Action: lookup_ticket(ticket_id="4821")

Observation: { status: "open", priority: "high", last_update: "3 days ago",
               assigned_to: null }

Thought: The ticket is open, high priority, and unassigned for 3 days.
         That's why the user is frustrated. I should escalate this
         rather than just give a status update.

Action: escalate_to_human(ticket_id="4821", reason="High priority, unassigned 3 days")
```

The "Thought" steps aren't shown to the user — they're internal reasoning the model does before each action. But they dramatically improve the quality of the actions it takes.

## Chain-of-thought

Chain-of-thought (CoT) is simpler than ReAct: you tell the model to think step-by-step before answering, even when no tools are involved.

```
Before giving your answer, briefly think through:
- What is the user actually asking?
- What do I know that's relevant?
- Is there anything I'm unsure about that I should flag?

Then give your answer.
```

For complex support questions — diagnosing a technical issue, figuring out why a feature isn't working — this produces noticeably better responses than just asking for an answer directly.

## Self-reflection

After generating a response, the agent checks its own work:

```
Draft response: "Your export should work if you go to File > Export > CSV."

Reflection: Wait — this user is on the mobile app. File > Export is a
            desktop-only menu. My answer is wrong for their context.

Revised response: "On mobile, export works differently — you'll find it under..."
```

This is expensive (it's an extra LLM call), but for high-stakes responses — complex technical troubleshooting, anything the agent isn't confident about — it's worth it.

## When planning helps vs when it's overkill

| Situation | Use planning? |
|-----------|--------------|
| Simple Q&A ("How do I reset my password?") | No — adds latency for no gain |
| Multi-step troubleshooting | Yes — ReAct or CoT |
| Complex ticket requiring multiple tool calls | Yes — ReAct |
| Deciding whether to escalate | Light CoT |
| Routing a message to the right department | No — use a classifier, not a planner |

::: warning Watch out
Planning adds tokens and latency. Every "Thought" step is tokens the model generates before doing anything useful. For a support agent handling high volume, adding ReAct to every simple question doubles your costs with no quality benefit.

The fix: **conditional planning**. Classify the request first (simple/complex). Simple requests get a direct response. Complex requests go through the ReAct loop. A small, fast classifier making this routing decision is much cheaper than making all requests think out loud.
:::

::: details Interview Question — ReAct vs chain-of-thought
**Q:** What's the difference between ReAct and chain-of-thought prompting? When would you use each?

**A:** Chain-of-thought is about reasoning quality for a single LLM call — you're asking the model to show its work before giving an answer. No tools, no loop. It improves accuracy on reasoning tasks by forcing intermediate steps. ReAct combines reasoning with action — the model alternates between thinking and calling tools, with each observation feeding back into the next thought. Use CoT for single-call reasoning tasks where quality matters. Use ReAct when the agent needs to plan a sequence of tool calls, adapt based on results, and handle multi-step problems where the next step depends on what you learned in the previous one. For TaskFlow, we use CoT for generating complex responses and ReAct for the multi-tool diagnostic flows.
:::
