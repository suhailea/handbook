---
title: LLMs & Tokens
outline: deep
---

# LLMs & Tokens

Every API call is priced, limited, and sometimes broken by tokens — not words, not characters. Get an intuition for tokens and half of what confuses people about context windows, pricing, and truncation stops being mysterious.

::: tip Plain English
A token is roughly a word-piece — "unbelievable" might split into "un", "believ", "able". Common English words are usually one token; rare words, code, and non-English text often split into more pieces than you'd expect from their length. The model doesn't see words at all — it sees a sequence of these pieces, and everything about cost and context limits is counted in them, not in characters.
:::

## Why this trips people up

**Non-English costs more.** The same sentence in Arabic or Japanese can take 2–3× the tokens of its English equivalent, because tokenizers are trained predominantly on English text. This matters directly for TaskFlow's UAE customer base — a support conversation in Arabic costs measurably more per exchange than the same conversation in English.

**Code is token-dense.** Punctuation-heavy, non-natural-language text tokenizes less efficiently than prose. A code review agent burns through context faster than a support agent for the same character count.

**Context windows are token limits, not word limits.** "200K context" means 200,000 tokens — commonly 120,000–150,000 English words, but much less for code or non-English content.

```
"unbelievable"           → ["un", "believ", "able"]        3 tokens
"the cat sat"             → ["the", " cat", " sat"]         3 tokens
"مرحبا كيف حالك"          → often 2-3x the token count of an equivalent English phrase
```

## What actually depends on this

| Depends on tokens | Why |
|---|---|
| Pricing | Billed per input and output token, not per request |
| Context window | Literally a token count ceiling |
| Latency | Roughly proportional to tokens processed and generated |
| Truncation | When you hit the limit, oldest tokens get cut, not oldest "messages" cleanly |

::: warning Watch out
Don't estimate token counts from character length — it drifts, especially across languages and for code. Use the actual tokenizer (`tiktoken` for OpenAI models, or the provider's usage response) rather than a rule of thumb like "4 characters per token," which is only roughly true for English prose and wrong enough elsewhere to cause real budgeting errors.
:::

::: details Interview Question — Why does the same question cost more in one language than another?
**Q:** A support agent costs noticeably more per conversation for Arabic-speaking users than English-speaking ones, with similar conversation length. Why?
**A:** Tokenizers are trained on corpora dominated by English, so English text tokenizes more efficiently — fewer tokens per character. The same semantic content in Arabic (or most non-Latin-script languages) needs more tokens to represent, which directly increases both input and output cost per conversation even though nothing else about the interaction changed.
:::

::: details Interview Question — Debugging unexpected truncation
**Q:** A long conversation suddenly loses early context mid-session. What's happening?
**A:** The conversation exceeded the model's token-count context window, and either the provider or your own truncation logic dropped the oldest tokens to fit. This isn't a bug in the traditional sense — it's the system doing exactly what a fixed context window requires. The fix is proactive context management (see [Agent Memory](/ai-engineering/module-02/03-agent-memory)) — summarizing or windowing before you hit the limit, not reacting after truncation already happened silently.
:::

## Key Mental Models

**Tokens, not words or characters, are the real unit.** Pricing, limits, and truncation all operate on tokens.

**Language and content type change the exchange rate.** English prose is the cheapest case; code and non-Latin scripts cost more per character of meaning.

## Related

- [0.1 How Transformers Work](/ai-engineering/module-00/01-how-transformers-work) — why context length is quadratically expensive
- [3.4 Cost & Token Accounting](/ai-engineering/module-03/04-cost-and-token-accounting) — turning token counts into a cost model
- [1.3 Context Engineering](./03-context-engineering) — deciding what tokens are worth spending on
