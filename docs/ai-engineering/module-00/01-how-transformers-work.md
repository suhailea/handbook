---
title: How Transformers Work — Attention in Plain English
outline: deep
---

# How Transformers Work — Attention in Plain English

Everyone says "it's just predicting the next word." That's true but incomplete. A parrot predicts the next word too — it just does it badly. Here's what actually makes transformers special.

## The problem with reading left to right

Before transformers, the dominant approach was RNNs — Recurrent Neural Networks. An RNN reads a sentence the way a person might if they were only allowed to glance at one word at a time and had to summarize everything they'd seen so far in a single sticky note before moving on.

By the time you get to the end of a long sentence, that sticky note is pretty full. Early words get compressed, overwritten, and effectively forgotten. Ask an RNN what "bank" means in "The man who grew up near the river where his father used to fish on summer mornings made a deposit at the bank," and it's probably lost the river context by the time it hits the last word.

This was the core limitation: sequential processing meant distant context was hard to retain.

## What attention actually does

Transformers threw out sequential reading entirely. Instead, every word looks at every other word simultaneously and votes on which ones are relevant to understanding it.

Think of it like a meeting where everyone can talk to everyone else at once, instead of passing a note around the table one seat at a time. When the model is trying to figure out what "bank" means, it doesn't have to remember a summary of everything before — it just directly looks at "river" and "deposit" and weights them accordingly.

This mechanism is called **attention** because each word is essentially asking: *which other words in this sentence should I pay attention to?* The answer gets computed mathematically, but the intuition is exactly that simple.

The result: "the bank by the river" and "the bank transfer" get completely different internal representations for the word "bank," because the surrounding words vote differently in each case.

## Why this matters for engineers

Three practical consequences flow from this architecture:

**Long context works.** Because attention spans the entire input at once, transformers can handle thousands of tokens without losing the thread. That's why modern models can take an entire codebase or a 100-page document as input.

**Training is parallelizable.** Because you're not waiting for word 1 to finish before processing word 2, you can train on massive datasets using thousands of GPUs working in parallel. This is a big part of why transformers scaled so well.

**Transfer learning works.** The same pre-trained model, having learned rich representations of language, can be fine-tuned for many downstream tasks. You don't train from scratch for every new use case.

## The part nobody fully understands

Here's the honest part: at some scale, models started doing things nobody explicitly trained them to do. Reasoning through multi-step problems. Writing working code. Drawing analogies across domains they'd never seen combined. We call this "emergent capability."

::: warning Keep honest
We don't fully understand why large transformers are so capable. That's not a cop-out — it's the actual state of the field. Researchers have theories (the models are learning compressed world models, or doing implicit Bayesian inference, or...) but nobody has a complete mechanistic explanation. When someone tells you they fully understand why GPT-4 can reason, they're overconfident. The empirical results are real; the theory is still catching up.
:::

The practical implication: you can't always predict what a model will or won't be able to do from first principles. Empirical testing matters more than reasoning from the architecture.

---

::: details Interview Question — What is attention and why does it matter?

**Q:** Explain what the attention mechanism does in a transformer, and why it was an improvement over previous approaches.

**A:** Attention lets every token in the input look at every other token simultaneously to compute contextual representations. Instead of reading sequentially (like RNNs did, losing early context by the end of long sequences), a transformer processes the whole input in parallel — each token attends to all others and learns which ones are most relevant for understanding its meaning.

This is why "bank" means something different in "river bank" versus "bank transfer" — the attention mechanism reads the full context at once and weights surrounding words accordingly. The practical payoffs: longer context windows become feasible, training can be massively parallelized (faster, cheaper at scale), and the representations learned are rich enough to transfer across tasks. The architecture is also why scaling works — more parameters means more expressive attention patterns, which is the root cause of emergent capabilities at large scale.

:::

---

[← Module Overview](/ai-engineering/module-00/) · [Next: 0.2 Training vs Inference →](/ai-engineering/module-00/02-training-vs-inference)
