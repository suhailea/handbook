---
title: Tools & Tool Calling
outline: deep
---

# Tools & Tool Calling

Without tools, TaskFlow's agent could only answer from what it learned in training — nothing about real tickets, real account states, real anything. Tools are how it reaches out of its own head.

::: tip Plain English
A tool is a function the model can ask you to run, with arguments it fills in. The model never executes anything itself — it says "call `lookup_ticket` with id 4821," your code runs it, and the result goes back into the conversation. The model is choosing which door to open; your code is the one that opens it.
:::

## How it actually works

You describe each tool with a name, a description, and a JSON schema for its arguments — the description is doing most of the work, since it's how the model decides *when* to reach for that tool at all.

```typescript
const tools = [{
  name: 'lookup_ticket',
  description: 'Fetch current status, priority, and assignee for a support ticket by ID.',
  parameters: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Ticket ID, e.g. "4821"' } },
    required: ['id'],
  },
}];
```

The model doesn't call the function — it returns a structured request to call it. Your harness executes the real function, appends the result as a new message, and the loop continues. This is exactly [structured output](/ai-engineering/module-03/02-structured-outputs) under a different name: the schema constrains what the model can ask for.

## Designing tools that work

**Narrow beats broad.** `lookup_ticket(id)` is easier for the model to use correctly than `query_database(sql)`. A narrow tool has one obvious use; a broad one invites malformed or dangerous calls.

**Descriptions are the interface.** The model picks tools by reading descriptions, not by inspecting your code. A vague description gets called at the wrong time or not at all.

**Separate read from write.** Read tools can be given freely. Write tools — anything that sends, deletes, or charges — need a stricter path.

| Situation | Approach |
|---|---|
| Needs real-time data (ticket status) | Tool |
| Answer is general knowledge | Just prompt |
| Takes an action (refund, email) | Tool + confirmation |
| Searches documentation | Tool, or hand off to RAG |

::: warning Watch out
The model is not reliable enough for irreversible high-stakes actions to run fully autonomously. Don't give an agent `issue_refund` without a human-approval step in between. Design write tools to be idempotent too — a retried call shouldn't double-charge or double-update.
:::

::: details Interview Question — Designing write tools safely
**Q:** You're building an agent that can update database records. How do you keep that safe?
**A:** Split reads from writes. Reads are freely available. Writes go through a `request_confirmation`-style flow: the agent proposes an action, the harness either auto-approves low-stakes ones or routes to a human for high-stakes ones (deletes, financial changes). Make writes idempotent so a retry can't double-apply, and log every call with full arguments for an audit trail.
:::

::: details Interview Question — Tool description quality
**Q:** An agent keeps calling the wrong tool, or not calling one it should. What's the likely cause?
**A:** Usually the description, not the model. If two tools sound similar, or a description doesn't state clearly *when* to use it, the model guesses. Fix by tightening descriptions with concrete trigger conditions and examples, and by narrowing overlapping tools into one, rather than adding more prompt instructions telling it to "be careful."
:::

## Key Mental Models

**The model requests; your code executes.** It never runs anything directly — treat every tool call as untrusted input.

**Narrow, well-described tools get used correctly.** Broad tools invite misuse.

**Reads are cheap to expose; writes need a gate.** The blast radius is what determines how much friction belongs in front of a tool.

## Related

- [2.1 The Agent Loop](./01-agent-loop) — where tool calls fit in the cycle
- [3.2 Structured Outputs](/ai-engineering/module-03/02-structured-outputs) — the same constrained-generation mechanism
- [7.2 Agent Security](/ai-engineering/module-07/02-agent-security) — authorization gates for write tools
