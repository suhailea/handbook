---
title: Tools — Giving the Agent Hands
outline: deep
---

# Tools — Giving the Agent Hands

Our agent could only answer from its training data. It didn't know about real TaskFlow tickets. We gave it a `lookup_ticket` tool. That changed everything.

::: tip Plain English
Without tools, the model is a brilliant person locked in a room with no phone, no computer, and no windows. It can only tell you what it already knows from before it was locked in.

A tool is like handing that person a phone with one specific app. Now they can look things up. Give them another tool and they can send a message. Another and they can check a calendar.

The model doesn't actually run the tool — you do. The model says "please look up ticket #4821," and your code makes the API call and brings back the result. The model just knows how to ask.
:::

## What tool calling actually is

Under the hood, tools are structured JSON output. You tell the model: "These are the tools you can use. They work like this." The model, when it decides to use a tool, outputs a structured request instead of a normal text response:

```json
{
  "tool_call": {
    "name": "lookup_ticket",
    "arguments": {
      "ticket_id": "4821"
    }
  }
}
```

Your code (the harness) intercepts this, calls your actual `lookup_ticket` function, and feeds the result back into the conversation. The model never touches your database directly — it just asks, and you do the calling.

## Defining a tool

Every provider has slightly different syntax, but the structure is the same: name, description, parameters.

```json
{
  "name": "lookup_ticket",
  "description": "Look up a TaskFlow support ticket by ID. Returns the ticket status, priority, assigned agent, and last update.",
  "parameters": {
    "type": "object",
    "properties": {
      "ticket_id": {
        "type": "string",
        "description": "The TaskFlow ticket ID (e.g. '4821')"
      }
    },
    "required": ["ticket_id"]
  }
}
```

The description matters. The model reads it to decide when and how to use the tool. A good description answers: "What does this do? When should I use it? What does it return?"

## Tool design principles

**Name it clearly.** `lookup_ticket` is better than `get_data`. `escalate_to_human` is better than `escalate`. The model uses the name to decide when to call it.

**Keep inputs simple.** If your tool needs 8 parameters, the model will often get some of them wrong or omit them. Design tools with 1–3 required inputs. If you need more, split into multiple tools or have your code look things up internally.

**Return useful output.** The model reads the tool result and uses it to reason. Return structured data with clear field names, not a raw dump. Include the key fields upfront; don't make the model parse through noise.

**One tool, one job.** A `lookup_and_escalate_ticket` tool that does two things is harder for the model to reason about than two separate tools. Split concerns.

## What we gave TaskFlow's agent

```
lookup_ticket(ticket_id)       → status, priority, assignee, last_update
list_user_tickets(user_email)  → array of open tickets
escalate_to_human(ticket_id, reason) → confirmation
search_help_docs(query)        → top 3 relevant doc sections
```

Four tools. Clear names, simple inputs, focused purposes.

## When NOT to give the agent a tool

::: warning Watch out
Not every capability should be a tool. Ask:

**"What's the worst case if the model calls this incorrectly?"**

- `lookup_ticket` — worst case: looks up wrong ticket. Low risk. Give it.
- `delete_ticket` — worst case: deletes a real ticket. **Do not give this as an autonomous tool.** Put a human confirmation step in the loop.
- `send_email_to_user` — worst case: sends wrong message to real customer. Require confirmation or make it human-in-the-loop.
- `issue_refund` — do not give this to an agent without human approval in the middle.

The model is not reliable enough for irreversible high-stakes actions to be fully autonomous. Design tools that are reversible, or build confirmation flows for the ones that aren't.
:::

## When to use tools vs just prompting

| Situation | Approach |
|-----------|----------|
| Answer requires real-time data (ticket status, user plan) | Tool |
| Answer is based on knowledge the model has | Just prompt |
| You need to take an action (send email, update status) | Tool + confirmation |
| You need to search documentation | Tool (search_help_docs) or RAG |
| Simple formatting or classification | Just prompt |

::: details Interview Question — Tool design for safety
**Q:** You're building an agent that can update records in a database. How do you design the tools safely?

**A:** Separate read tools from write tools, and add a confirmation layer for writes. Pattern: (1) Give the agent read-only lookup tools freely. (2) For write tools, the agent produces a "proposed action" that your harness intercepts and either auto-approves (for low-stakes updates) or routes to human review. (3) Design write tools to be idempotent — the same call twice shouldn't cause double updates. (4) Log every tool call with the full arguments so you have an audit trail. (5) For high-stakes writes (deletes, financial changes), require the agent to call a `request_confirmation` tool first, which triggers a human approval flow before the actual write tool is enabled for that session.
:::
