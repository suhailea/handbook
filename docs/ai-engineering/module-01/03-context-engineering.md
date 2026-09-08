---
title: Context Engineering — What You Put in the Window
outline: deep
---

# Context Engineering — What You Put in the Window

Our agent had a 128k context window. We stuffed everything in it. Costs tripled and responses got worse. Here's what we learned.

Week two of building TaskFlow's agent, we hit a problem: the agent needed to know about our features. So we dumped the entire help documentation — 400 pages — into the system prompt. It fit. Technically.

But two things happened: our API bill tripled overnight, and the agent started giving worse answers. It was getting lost in the noise.

::: tip Plain English
Context engineering is not prompt engineering. Prompt engineering is about *how* you say things to the model. Context engineering is about *what information* you include at all.

Think of the context window like a whiteboard in a meeting room. You can write anything on it — but the bigger it gets, the harder it is to find the one thing that actually matters right now.

Putting your entire product documentation on that whiteboard doesn't help the agent. It gives the agent more to get confused by. The skill is figuring out: for this specific user question, what's the minimum information the model needs to give a great answer?
:::

## The three problems with big contexts

**1. Cost scales linearly.** Every token in your context costs money, every request. If you put 20,000 tokens of documentation in the system prompt and you handle 100,000 requests/day, you're paying for 2 billion tokens of documentation per day — most of which is irrelevant to most requests.

**2. Quality degrades.** Models have a "lost in the middle" problem — information at the very start and very end of a long context is recalled better than information in the middle. Burying the relevant paragraph in 400 pages of docs doesn't help.

**3. Latency increases.** Processing more tokens takes longer. A 128k-token context takes significantly longer than a 2k-token context.

## The three approaches

### Full context — just put it all in

Works when:
- The total relevant knowledge is small (under ~5,000 tokens)
- Every request is likely to need all of it
- You want simplicity over optimization

For TaskFlow's "how do I export?" type questions, a focused 3,000-token guide covering the top 50 features is worth just including. Not the entire 400-page docs.

### RAG — retrieve only what's relevant

Instead of putting all docs in context, you:
1. When a question comes in, search your docs for the relevant sections
2. Pull only the top 3–5 matching chunks
3. Add those chunks to the context for this specific request

A user asking about exports gets the export documentation. A user asking about billing gets the billing documentation. Neither gets 400 pages.

This is covered in depth in the [Production RAG track](/rag/). For now: RAG is the right answer when your knowledge base is large and only a subset is relevant per request.

### Prompt caching — pay once, reuse

If you have content that's the same across many requests — like your system prompt or a large document you always include — some providers let you "cache" it. You pay full price the first time, and a fraction (10–25%) of the price on subsequent requests where the prefix matches.

**Anthropic prompt caching** requires that the cacheable content is at the start of the context and marked explicitly. The cache persists for a few minutes to an hour.

**OpenAI prompt caching** happens automatically for context prefixes longer than 1,024 tokens that match a previous request within a session.

For TaskFlow: our 800-token system prompt is always the same. With caching enabled, we pay full price once and ~10% of the price for subsequent requests in the same cache window.

## Dynamic context assembly

The pattern we ended up using for TaskFlow:

```
[System prompt — always the same, cached]
[User's profile — their plan, open tickets count, last login]
[Relevant docs — 3-5 chunks retrieved based on their question]
[Conversation history — last 10 messages only]
[User's current message]
```

Each piece is assembled dynamically per request. The profile comes from our database. The docs come from our vector search. The conversation history is trimmed when it gets too long.

## When to use what

| Approach | Use when | Don't use when |
|----------|----------|----------------|
| Full context | Knowledge base is small (<5k tokens) | Docs are large and only partially relevant |
| RAG | Large docs, question determines what's relevant | You always need all the info (overkill complexity) |
| Prompt caching | Same content repeated across many requests | Content changes frequently |
| Trimmed history | Long conversations | You need the model to reference old context |

::: warning Watch out
The most common mistake is treating context like free space. It's not. Every token is a cost and a potential distraction. The question to ask for every piece of context you're adding: "Would a smart support agent need to read this before answering this type of question?" If the answer is "sometimes," don't always include it.
:::

::: details Interview Question — Context window limits
**Q:** A conversation has been going for 2 hours and the context is now too long for the model. How do you handle it?

**A:** Several strategies, often combined: (1) **Sliding window** — drop the oldest messages first, always keeping the system prompt and recent messages. Simple, loses early context. (2) **Summarization** — when approaching the limit, use the model to summarize the conversation so far, replace the raw messages with the summary. More expensive but preserves semantic content. (3) **External memory** — store key facts extracted from the conversation in a database and retrieve them as needed, rather than keeping the raw message history. (4) **Session boundaries** — tell the user "this is a new session" and start fresh, relying on external memory for persistence. For TaskFlow, we used a hybrid: summarize after 20 messages, and store key facts (user's plan, their open issues) in a semantic memory store.
:::
