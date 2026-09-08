---
title: Agent Memory — Making It Remember
outline: deep
---

# Agent Memory — Making It Remember

Every time a user came back, our agent forgot everything. "I explained this three times already!" — a real user complaint. We needed memory.

::: tip Plain English
By default, every conversation starts fresh. The model has no idea you talked to it yesterday. It's like a customer service rep with amnesia — professional, capable, but starts every interaction knowing nothing about you.

To make an agent remember, you have to explicitly decide what to store, where to store it, and how to bring it back. Memory isn't something the model does — it's something your system does, and you feed the results to the model.

There are four kinds of memory, each solving a different problem. You often need more than one.
:::

## The four types of memory

### 1. In-context memory — the simplest kind

Just include previous conversation turns in the context window.

```
[system prompt]
[turn 1: user said X, agent said Y]
[turn 2: user said A, agent said B]
[turn 3: user's current message]
```

The model "remembers" because it can see the history. No database needed.

**Pros:** Simple. No extra infrastructure. Works immediately.

**Cons:** Context window fills up. Gets expensive for long conversations. When the window is full, you have to drop old messages — and the model forgets them.

**Use when:** Conversations are short (under ~20 turns), or you're prototyping and want simplicity.

### 2. External memory — store and retrieve

When conversations get long, store key information in a database and retrieve it when needed.

For TaskFlow: when a user explains their setup in session 1, we extract and store: "User is on Pro plan, using Chrome, has 3 open tickets." In session 2, we pull that record and include it in the context.

```python
# Rough pseudocode
user_facts = db.get("user_memory", user_id)
context = build_context(system_prompt, user_facts, current_message)
response = llm.call(context)
```

**Pros:** Scales to any conversation length. Persists across sessions. Cheap to store.

**Cons:** You have to decide what to store. Retrieval logic can be tricky — what if the stored facts are outdated? Adds latency.

**Use when:** You need memory to persist across sessions, or conversations routinely get long.

### 3. Episodic memory — remembering past conversations

Instead of storing facts, store summaries of past conversations and retrieve the relevant ones.

For TaskFlow: "User contacted us 3 times about the export feature. Each time they were frustrated. The issue was never resolved." The agent reads this summary at the start of the session and can acknowledge the history.

Implementation: after each conversation ends, use the model to write a short summary. Store it tagged with user ID and timestamp. At the start of new conversations, retrieve the last N summaries.

**Pros:** Gives the agent human-like memory of what happened before. Dramatically improves experience for repeat users.

**Cons:** Requires a summarization step after each conversation. Summary quality affects retrieval quality. Can surface outdated or incorrect past episodes.

**Use when:** Users return regularly and past context matters (support, coaching, personal assistants).

### 4. Semantic memory — facts about entities

A structured store of facts: who this user is, what their plan is, what their preferences are.

For TaskFlow:
```json
{
  "user_id": "u_4821",
  "plan": "pro",
  "onboarding_completed": true,
  "preferred_contact": "email",
  "open_tickets": 2,
  "known_issues": ["export bug reported twice"]
}
```

This is distinct from episodic memory (what happened) — it's a curated fact store about the entity. The agent reads it at the start of every session.

**Pros:** Very compact. Always relevant. Easy to update programmatically.

**Cons:** Requires curation — who decides what goes in and when it's stale? Manual or automated extraction needed.

**Use when:** You have structured, persistent facts about users or accounts that should always be available.

## Comparison table

| Memory type | Where stored | When retrieved | Best for |
|------------|--------------|----------------|----------|
| In-context | Context window | Always present | Short sessions |
| External | Database | On request or always | Long/returning users |
| Episodic | Database (summaries) | Start of session | Repeat interaction history |
| Semantic | Database (structured) | Start of session | User facts, preferences |

## What we built for TaskFlow

```
Session start:
  1. Load semantic memory (user plan, open tickets)   → always in context
  2. Load last 3 episode summaries                    → in context if returning user
  3. Conversation starts

During session:
  4. Full message history kept in context             → up to 20 turns

Session end:
  5. Summarize conversation → store as new episode
  6. Update semantic memory (any new facts learned)
```

::: warning Watch out
Memory can go stale. If you store "user is on Pro plan" and they downgrade, your stored fact is wrong. For facts that can change (plan, ticket count, account status), always check live via a tool rather than relying on stored memory. Stored memory is good for stable facts and historical context — not for real-time state.
:::

::: details Interview Question — Memory architecture
**Q:** A user comes back after 3 months. How does your agent handle the conversation without asking them to repeat themselves?

**A:** Three layers: (1) **Semantic memory** — pull their profile (plan, known preferences, account state) from your database and include it in the system prompt prefix. This gives the agent baseline context. (2) **Episodic memory** — retrieve the last few conversation summaries and include them so the agent knows the history of past interactions. (3) **Live tool calls** — for anything that changes (current open tickets, current plan status), use a tool to fetch fresh data rather than relying on stored memory. The goal is: the agent greets the user as if it knows them, because it does — not because it pretends to, but because it actually read their history.
:::
