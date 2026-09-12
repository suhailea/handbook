---
title: Agent Memory
outline: deep
---

# Agent Memory

Every TaskFlow conversation started from zero. A returning user who'd explained their issue yesterday had to explain it again today. Memory is what fixes that — at a cost, because everything you remember is something you have to store, retrieve, and pay to re-send.

::: tip Plain English
A single conversation without memory is like a stranger who forgets you the moment you walk away. Memory gives an agent different kinds of forgetting: some things it should only remember for the next five minutes, some for the whole conversation, and some — like your subscription plan — it should never forget at all. Picking the wrong kind for a given fact is how agents end up either forgetful or creepily over-informed.
:::

## Four kinds of memory

**Working memory** — the current conversation's message history. Lives entirely in the context window; gone when the session ends unless you persist it.

**Episodic memory** — records of past conversations or runs, retrievable later. "What did this user ask about last week?" This is usually just a database of past transcripts, sometimes summarised.

**Semantic memory** — durable facts about the user or domain: their plan tier, their timezone, their preferred name. Stored as structured data, not transcript.

**Procedural memory** — learned patterns about *how* to handle something, closer to a cached strategy than a fact. Least common in production agents; mostly relevant to systems that self-improve over many runs.

| Type | Lifespan | Where it lives |
|---|---|---|
| Working | One session | Context window |
| Episodic | Indefinite | Database of past runs |
| Semantic | Indefinite | Structured user/account store |
| Procedural | Indefinite | Rare — learned strategies |

## The real design problem

Context windows are finite and every token costs money on every turn — so "remember everything" isn't a strategy, it's a cost model with no limit. Working memory in a long conversation needs active management: a sliding window of recent turns, plus a running summary of what fell off the front.

```typescript
// Summarize-and-truncate: keep the last N turns verbatim,
// compress everything older into a running summary.
if (messages.length > MAX_TURNS) {
  const [old, recent] = [messages.slice(0, -MAX_TURNS), messages.slice(-MAX_TURNS)];
  const summary = await summarize(old);
  messages = [{ role: 'system', content: `Earlier context: ${summary}` }, ...recent];
}
```

Semantic memory should be looked up, not carried in every prompt — fetch the user's plan tier from your database when needed rather than repeating it in every system message.

::: warning Watch out
Summarizing loses detail, and you won't know what until it's missing. A summary written after turn 10 might drop a constraint the user stated in turn 2 that turns out to matter at turn 20. For anything load-bearing — a stated hard requirement, a confirmed identity — extract it into semantic memory explicitly rather than trusting it survives compression.
:::

::: details Interview Question — Managing a long-running conversation
**Q:** A support conversation runs 40 turns. How do you keep it within context limits without losing important information?
**A:** Sliding window for recent turns (verbatim, since recency matters most for coherence), summarization for everything older, and explicit extraction of durable facts (stated preferences, confirmed account details) into semantic memory rather than relying on them surviving in the summary. Re-inject extracted facts each turn instead of carrying full history.
:::

::: details Interview Question — Memory vs RAG
**Q:** How is agent memory different from RAG?
**A:** RAG retrieves from a fixed knowledge base (docs, policies) that doesn't change per-user. Memory is about *this specific user or session* — their history, preferences, and current context. They often sit side by side: RAG answers "what's our refund policy," memory answers "what did this user already tell me."
:::

## Key Mental Models

**Not all memory needs the same lifespan.** Matching type to purpose is the actual design decision.

**Everything remembered is re-billed every turn.** Working memory management is a cost problem as much as a UX one.

## Related

- [2.1 The Agent Loop](./01-agent-loop) — where memory gets read and written each iteration
- [3.4 Cost & Token Accounting](/ai-engineering/module-03/04-cost-and-token-accounting) — quadratic growth of re-sent context
- [1.3 Context Engineering](/ai-engineering/module-01/03-context-engineering) — what belongs in the window at all
