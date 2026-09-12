---
title: ML Foundations
outline: deep
---

# ML Foundations

The mathematical and algorithmic layer underneath modern AI systems: statistics, linear algebra, classical ML algorithms, optimization, neural networks, and NLP.

This is a **reference track**, not a build-along. The [AI Engineering](/ai-engineering/) track teaches you to ship AI systems and links here whenever the underlying theory matters. You do not need to read this track first — and for most engineering work, you shouldn't. Come here when a concept in the build line stops making sense, or when you want the foundations properly rather than just enough to proceed.

## Who this is for

Engineers who can already use an LLM API and want to understand what's happening underneath — why a model is confident about a wrong answer, what a loss function is actually minimizing, why gradient descent works at all, and what the numbers mean when you evaluate model quality.

It assumes no ML background and no PhD ambitions. Concepts are taught as things an engineer needs in order to reason about AI systems, not as formulas to memorize.

## The two modules

| Module | What you'll learn |
|--------|------------------|
| [Module 1 — ML Fundamentals & Statistics](/ml-foundations/module-01/) | Supervised vs unsupervised, train/validation/test, classical algorithms, statistics, linear algebra, metrics, optimization |
| [Module 2 — Deep Learning & NLP](/ml-foundations/module-02/) | Neural networks, CNNs/RNNs/LSTMs and why Transformers replaced them, NLP fundamentals |

## How this connects to AI Engineering

Read in this order if you're following the build line and hit something you want grounded:

| When you're reading | Come here for |
|---|---|
| [Module 0 — Mental Models](/ai-engineering/module-00/) (transformers, embeddings) | [Linear Algebra for AI](/ml-foundations/module-01/05-linear-algebra-for-ai), [Neural Networks](/ml-foundations/module-02/01-neural-networks) |
| [Module 9 — LLMOps & Evaluation](/ai-engineering/module-09/) (metrics, judges) | [ML Metrics](/ml-foundations/module-01/06-ml-metrics), [Statistics for AI](/ml-foundations/module-01/04-statistics-for-ai) |
| [Module 4 — Fine-Tuning](/ai-engineering/module-04/) (LoRA, training) | [Optimization](/ml-foundations/module-01/07-optimization), [Train/Validation/Test](/ml-foundations/module-01/02-training-validation-test) |

Start with [Module 1](/ml-foundations/module-01/) if you're reading straight through.
