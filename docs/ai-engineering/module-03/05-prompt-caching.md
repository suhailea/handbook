---
title: Prompt Caching & the KV Cache
outline: deep
---

# Prompt Caching & the KV Cache

TaskFlow's system prompt is re-sent on every single call — and on every iteration of a multi-turn agent loop. Re-running the same 800 tokens through the model a million times is a million times the same computation. Caching is how you stop paying for work you've already done.

::: tip Plain English
When you read a long book chapter, and then someone asks you a question about it, you don't re-read the whole chapter before answering. You remember it. Your brain cached the reading.

LLMs don't naturally do this. Every time you send a message, the model processes every token in your context from scratch — including the same system prompt it processed for the last million requests.

KV cache is a way to store the model's "reading" of tokens it's already processed, so it doesn't have to redo that work. It's not about memorizing answers — it's about not repeating mathematical computations the model already did.
:::

## What KV stands for

During the attention mechanism inside the model, every token produces two values: a **Key** and a **Value**. These are the intermediate computations that let the model figure out how much attention to pay to each token when generating the next one.

Computing these Key-Value pairs is expensive. If you have a 5,000-token system prompt and 1,000 concurrent users, you're computing those KV pairs 1,000 times — all identical, all wasteful.

KV caching stores those computed K and V tensors. On the next request with the same prefix, you skip the computation and use the stored results. Only the new tokens need fresh computation.

## Two kinds of KV caching

### In-server KV cache (automatic)

This happens inside your inference server (vLLM, llama.cpp) automatically. As tokens are processed for a request, the KV values are stored in GPU memory. If another request arrives with the same prefix, the cached values are reused.

This is why the second request in a conversation is often faster than the first — part of the context is already cached.

### Prompt caching (API-level)

Both Anthropic and OpenAI offer explicit prompt caching as a feature. You mark a portion of your context as "cacheable," and the provider stores it on their servers for reuse across requests.

**Anthropic (Claude):** You add `"cache_control": {"type": "ephemeral"}` to a content block. The cache lives for ~5 minutes (ephemeral) or longer. You pay full price the first time, then 10% of the input token price for cached reads.

**OpenAI:** Automatic — no explicit marking needed. Any prompt prefix over 1,024 tokens that matches a recent request gets a 50% discount on those tokens.

For TaskFlow: our system prompt is ~800 tokens and is identical for every request. With Anthropic prompt caching enabled, we pay full price on the first request in each cache window, and 10% on all subsequent requests. At our volume, this cut our input token costs by ~70%.

## The math

Without caching (800-token system prompt, 200-token user message):
```
Cost per request = (800 + 200) tokens × full price
```

With prompt caching (800-token prefix cached):
```
Cost per request = (800 tokens × 10% price) + (200 tokens × full price)
= 80 + 200 effective tokens
```

At high volume, this is a very significant saving.

## When to use prompt caching

::: tip Use prompt caching when
- Your system prompt is large (>200 tokens) and the same across many requests
- You include large static documents (documentation, policy text) in every request
- You're doing many requests in a short time window (the cache needs to be hit often to be worth it)
:::

::: warning When it doesn't help
- Highly dynamic contexts where nothing repeats across requests
- Very low volume (the cache isn't hit enough to pay off the setup cost)
- When your inputs are mostly unique per user (the prefix that's identical is small)
:::

## Ordering is the whole game

Caching keys on the **prefix** — everything must match exactly, in order, from the start. Put anything variable (a timestamp, a user ID, today's date) near the front of the prompt and you invalidate the cache on every single request, silently, with no error to tell you.

```
Cache-breaking:  [user_id: 4821] [timestamp: ...] [static system prompt] [query]
                    ↑ varies every request → static content never gets a stable prefix

Cache-friendly:  [static system prompt] [static docs] [user_id + timestamp] [query]
                    ↑ static content is a stable, matching prefix every time
```

This is the same ordering principle covered in [context engineering](/ai-engineering/module-01/03-context-engineering) — static content first, variable content last — but here the payoff is a direct line item on the invoice, not just answer quality.

| Symptom | Likely cause |
|---|---|
| Cache hit rate near 100% at low volume | Working as intended |
| Cache hit rate near 0% despite a repeated system prompt | Variable content sits before the static prefix |
| Hit rate dropped after a prompt edit | Any change to the cached prefix — even whitespace — invalidates it |

::: details Interview Question — Debugging a silent cache hit-rate collapse
**Q:** Prompt caching was working, input costs were down significantly. After a routine prompt update, costs jumped back up with no code errors. What happened?
**A:** Any edit to the cached prefix — even a single character — produces a different prefix, so it stops matching cached entries and every request pays full price again. Check whether the edit touched the system prompt or any content before the variable, per-request part of the input. The fix is usually reordering so genuinely static content forms a stable prefix that survives minor edits elsewhere, and treating that prefix as something to change deliberately, not casually.
:::

::: details Interview Question — KV cache and cost
**Q:** What is KV cache and why does it matter for cost?

**A:** KV cache stores the intermediate Key-Value attention computations for tokens that have already been processed. Without it, every request recomputes these values for the full context from scratch — including any static content like system prompts. With caching, static prefixes are computed once and reused. This matters for cost in two ways: (1) Direct cost reduction — providers like Anthropic charge 10% of normal price for cached tokens, so a large static system prompt becomes much cheaper. (2) Throughput — by skipping recomputation of cached prefixes, inference servers can process new requests faster, increasing the number of requests per GPU per second. For a support agent with a large consistent system prompt, prompt caching is one of the highest-ROI optimizations available. You change two lines of code and cut input costs by 50–80%.
:::
