---
title: Context Engineering
outline: deep
---

# Context Engineering

Prompt engineering is what you say to the model. Context engineering is everything else you hand it — conversation history, retrieved documents, tool results, user data — and getting that mix wrong breaks agents that have a perfectly good prompt.

::: tip Plain English
Good prompting is choosing your words carefully. Context engineering is choosing what's on the table in front of you before you speak. You can be perfectly articulate and still give a wrong answer if the only documents in front of you are the wrong ones, or if there are so many that the relevant one gets lost in the pile.
:::

## What's competing for space

Every token in the context window is doing one of these jobs: system prompt, conversation history, retrieved knowledge, tool definitions, tool results. They all cost the same per token and all compete for a limited, priced budget — a bloated system prompt isn't free just because it "sets the tone."

**Position matters, not just presence.** Models don't weight all positions in a long context equally — information buried in the middle of a long document is used less reliably than information near the start or end. This is sometimes called "lost in the middle." Practical implication: put the most important instruction or fact either first or last, not centered in a wall of text.

**More retrieved content isn't better.** Ten retrieved chunks with the seventh being the actually-relevant one is worse than three chunks with the relevant one first — both for accuracy and for cost. This is why reranking exists as a step in RAG pipelines.

```
Bad ordering:   [static system prompt] [user history, growing] [retrieved docs] [query]
                                          ↑ pushes the cache-friendly prefix out of position

Better:         [static system prompt] [retrieved docs, most relevant first] [recent history] [query]
                                          ↑ static content stays a stable prefix for caching
```

## The recurring failure modes

| Symptom | Likely cause |
|---|---|
| Model ignores an instruction stated early in a long prompt | Position — it's buried; move it later or repeat it near the query |
| Answers drift as conversation grows | Irrelevant history accumulating; window or summarize (see [Agent Memory](/ai-engineering/module-02/03-agent-memory)) |
| Retrieved doc is relevant but ignored | Too many other chunks diluting it; rerank and trim |
| Costs rising with no behavior change | Static content isn't positioned as a stable prefix, breaking prompt cache hits |

::: warning Watch out
Adding more context to "give the model more to work with" is the default instinct and often the wrong move. Past a point, more content doesn't add information, it adds noise the model has to work around — measure whether trimming context improves accuracy before assuming more is safer.
:::

::: details Interview Question — "Lost in the middle" and what to do about it
**Q:** You've retrieved the correct document for a RAG query, but the answer still misses key information — the document was included. Why, and what would you change?
**A:** Likely a position effect — if that document landed in the middle of a long context stuffed with other retrieved chunks, the model may have under-weighted it relative to content nearer the edges. Fix by reranking so the most relevant chunk is placed first (or last, right before the query), and by trimming the total number of chunks rather than passing everything retrieval returned.
:::

::: details Interview Question — Context engineering vs prompt engineering
**Q:** How would you explain the difference between prompt engineering and context engineering to someone who conflates them?
**A:** Prompt engineering shapes the instructions — wording, examples, format requests. Context engineering shapes everything else in the window — what history, documents, and tool results are included, in what order, and how much. A well-worded prompt can still fail if the context around it is bloated, badly ordered, or missing the one fact that mattered; that failure isn't a wording problem.
:::

## Key Mental Models

**Every token in context is competing for a limited, priced budget.** Nothing is free just because it feels helpful to include.

**Position affects how well content is used, not just whether it's present.** Put critical content first or last, not buried in the middle.

**More context is not inherently safer.** Past a point it adds noise, not signal.

## Related

- [1.2 Prompt Engineering](./02-prompt-engineering) — the instructions layered on top of this context
- [2.3 Agent Memory](/ai-engineering/module-02/03-agent-memory) — managing conversation history specifically
- [3.5 Prompt Caching](/ai-engineering/module-03/05-prompt-caching) — why prefix ordering also affects cost
