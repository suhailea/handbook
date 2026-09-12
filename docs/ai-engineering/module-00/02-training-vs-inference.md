---
title: Training vs Inference
outline: deep
---

# Training vs Inference

Two completely different processes get referred to as "running the model," and confusing them is why people misjudge what's expensive, what's fixed, and what an API call can and can't change.

::: tip Plain English
Training is like years of school — expensive, slow, happens once (well, occasionally, for a new model version), and it's when the model actually learns anything. Inference is answering one question on a test — fast, cheap per-question, and the model isn't learning from it at all. Every API call you make is inference. You are never, ever training the model by talking to it.
:::

## Two different economics

| | Training | Inference |
|---|---|---|
| What happens | Weights are adjusted from data | Weights are fixed; text is generated |
| Cost | Millions of dollars, weeks to months | Fractions of a cent per call |
| Frequency | Occasional — a new model version | Every single API call |
| Does the model learn? | Yes | No — weights never change |
| Hardware | Thousands of GPUs in parallel | One request, far less compute |

The "the model is fixed" fact matters more than it sounds. A conversation that seems to teach the model something mid-session isn't updating weights — it's just adding tokens to the context that influence *this* response. Close the session and that "learning" is gone entirely; nothing persisted.

## Why inference is still sequential

Training processes a whole sequence in parallel — that's what made transformers viable at scale (see [0.1](./01-how-transformers-work)). Inference doesn't get that shortcut: to generate token 50, the model needs tokens 1–49 already decided, so generation happens one token at a time, each depending on everything before it.

```
Training:  entire sequence processed at once, in parallel   → fast per example
Inference: token 1 → token 2 → token 3 → ... → token N      → sequential, unavoidable
```

This single fact explains streaming (there's genuinely nothing to send early except each token as it's produced), why longer outputs take proportionally longer, and why inference optimization (KV caching, batching, quantization — [Module 9](/ai-engineering/module-09/)) is its own large engineering discipline distinct from training.

::: warning Watch out
"Fine-tuning" and "in-context learning" both sound like the model learning, and they're not the same thing at all. Fine-tuning genuinely updates weights (real training, smaller-scale). In-context learning — giving examples in a prompt — changes nothing about the weights; it only shapes this one response. Confusing the two leads to wrong assumptions about what persists.
:::

::: details Interview Question — Does the model remember previous conversations?
**Q:** A user asks the agent to "remember" a preference for future conversations. Can the model do that on its own?
**A:** No — inference never updates weights, so nothing said in a conversation persists into the model itself once that session ends. Anything that needs to persist has to be stored explicitly outside the model, in a database, and re-injected into context on future calls — that's exactly what [semantic memory](/ai-engineering/module-02/03-agent-memory) is for. "Remembering" in a product sense is always an engineered retrieval step, never the model learning.
:::

::: details Interview Question — Why can't inference be parallelized the way training is?
**Q:** Training processes sequences in parallel across GPUs; why doesn't the same apply to generating a single response?
**A:** Autoregressive generation is inherently sequential — each token is sampled conditioned on every token before it, including ones the model just generated itself, so token 50 literally doesn't exist to condition on until token 49 has been produced. Training can parallelize because it processes complete, already-known sequences at once; inference is producing an unknown sequence one committed step at a time.
:::

## Key Mental Models

**Training changes weights; inference never does.** Every API call is inference, and nothing about it persists into the model.

**Inference is sequential by necessity, training is parallel by design.** That asymmetry drives streaming, latency, and most serving optimizations.

## Related

- [0.1 How Transformers Work](./01-how-transformers-work) — why training can parallelize and inference can't
- [10.1 Fine-Tuning Overview](/ai-engineering/module-10/01-fine-tuning-overview) — the version of "training" you'll actually touch
- [3.1 Streaming & SSE](/ai-engineering/module-03/01-streaming-and-sse) — the direct product of sequential generation
