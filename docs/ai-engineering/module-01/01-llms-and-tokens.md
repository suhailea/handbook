---
title: LLMs & Tokens — What You're Actually Calling
outline: deep
---

# LLMs & Tokens — What You're Actually Calling

We just signed up for the OpenAI API. We're about to send our first message to build TaskFlow's support agent. But before we do — what exactly happens when we send that request?

::: tip Plain English
An LLM is an extremely sophisticated autocomplete. It has read most of the text on the internet, and it's very good at predicting what word comes next given what came before.

That's genuinely all it is. There's no understanding, no memory between conversations, no reasoning in the human sense. Just: "Given everything I've seen before, what is the most likely next word?"

The magic is that when you train on enough text, "predict the next word really well" ends up producing something that can answer questions, write code, and hold a conversation — because human text is structured that way.

**A token is not a word.** It's roughly a syllable or a few characters. "TaskFlow" is 2 tokens. "I" is 1 token. "unprecedented" is 3 tokens. Models don't read words — they read tokens. This matters because you pay per token and the model has a maximum number of tokens it can process at once.

**The context window is the model's working memory.** Everything you send in a request — your instructions, the conversation history, any documents — has to fit in the context window. When the conversation gets long enough that it doesn't fit, you have to throw old messages away. The model has no memory of what didn't fit.
:::

## What's actually in a model call

When you call the API, you send:

1. **A system prompt** — your standing instructions ("You are a helpful TaskFlow support agent...")
2. **The conversation history** — all previous messages, in order
3. **The user's current message**

The model reads all of this together and produces a response. It has no other context — no database, no files, no previous sessions. Just what you send.

```
[system: "You are TaskFlow support..."]
[user: "How do I export my tasks?"]
[assistant: "You can export by going to..."]
[user: "What about recurring tasks?"]   ← model sees ALL of the above
```

## Tokens in practice

Here's a rough feel for token counts:

| Text | Approximate tokens |
|------|-------------------|
| "Hi" | 1 |
| "How do I reset my password?" | 7 |
| A typical system prompt | 200–500 |
| A full support ticket | 300–800 |
| GPT-4o context window | 128,000 |
| Claude 3.5 Sonnet context window | 200,000 |

The cost implication: if you stuff your system prompt with 10,000 tokens of documentation "just in case", you're paying for those tokens on every single request.

## Temperature and top-p

Two parameters control how "creative" the model is:

**Temperature** controls randomness. At `temperature: 0`, the model always picks the highest-probability next token — completely deterministic. At `temperature: 1`, it samples more freely from likely options. At `temperature: 2`, it gets weird.

For a support agent, you want low temperature (`0.1`–`0.3`). You want consistent, predictable answers — not creative ones.

**Top-p** (nucleus sampling) is a different knob for the same idea. Instead of scaling all probabilities, it only samples from the most likely tokens that together make up `p` probability mass. `top_p: 0.9` means "only pick from tokens that together account for 90% of the probability."

::: warning Watch out
Don't adjust both temperature and top-p at the same time. Pick one. Most teams just use temperature and leave top-p at its default (1.0).
:::

## Small model vs large model

| | Small models (GPT-4o-mini, Haiku) | Large models (GPT-4o, Sonnet, Opus) |
|---|---|---|
| Cost | 10–50x cheaper | Expensive at scale |
| Speed | Fast (200–500ms) | Slower (1–3s typical) |
| Quality | Good for simple tasks | Better at complex reasoning |
| Context handling | Sometimes loses track in long contexts | Better at long-context tasks |
| Best for | Classification, simple Q&A, formatting | Complex support tickets, multi-step reasoning |

**When to use GPT-4-class:** reasoning over a complex support ticket, deciding whether to escalate, generating a detailed response that cites specific documentation.

**When to use smaller models:** classifying the intent of a message ("is this billing or technical?"), formatting output, simple lookups and confirmations.

For TaskFlow's agent, we'll use a large model for the main response and a small model for routing and classification.

::: details Interview Question — Temperature vs top-p
**Q:** What's the difference between temperature and top-p? When would you use each?

**A:** Both control output randomness but work differently. Temperature scales the probability distribution of all tokens — low temperature makes the highest-probability token much more dominant, high temperature flattens the distribution. Top-p (nucleus sampling) ignores tokens outside the top-p cumulative probability mass entirely, then samples from the remainder.

In practice: temperature is simpler and more intuitive to tune. Top-p is better if you want to avoid very low-probability "weird" tokens while still allowing creativity. For production support agents, low temperature (`0.1`–`0.2`) is usually right — you want consistency, not creativity. OpenAI's own guidance says don't set both; adjust one and leave the other at its default.
:::

## When to use which model size

::: tip When to use large models
- The task requires multi-step reasoning
- The context is long and the model needs to track multiple things
- The response quality directly affects user satisfaction
- You're doing it rarely enough that cost doesn't matter
:::

::: tip When to use small models
- You're doing it at high volume (classification, routing)
- The task is simple and well-defined
- Latency matters more than maximum quality
- You can validate the output with a quick check
:::
