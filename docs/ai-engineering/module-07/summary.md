---
title: Module 7 Summary — Deep Learning & NLP
outline: deep
---

# Module 7 Summary — Deep Learning & NLP

## What you built

A working mental model of how neural networks learn, why specialized architectures (CNN, RNN, LSTM) evolved, why Transformers superseded them, and the NLP pipeline that feeds text into all these systems.

## 5 Mental Models to Take Forward

1. **Non-linearity is the essential ingredient** — stack linear layers without activation functions and you have one linear layer. ReLU is the standard activation for hidden layers in modern networks.

2. **Transformers beat RNNs because attention is direct, not sequential** — every word connects to every other word in O(1) path length, no information bottleneck, and the whole sequence processes in parallel.

3. **Subword tokenization is the universal pre-processing step** — always count tokens (not words) for cost estimates; different languages have different token-per-word ratios.

4. **Semantic similarity requires embeddings, not keywords** — "puncture repair" and "fix flat tire" have zero keyword overlap but similar embeddings. Hybrid search uses both.

5. **CNN weight sharing is efficiency at scale** — the same filter detects an edge regardless of where it appears. This parameter sharing is why vision models are so efficient relative to their depth.

## Self-Assessment Checklist

- [ ] Can you explain why a network without activation functions is just linear regression?
- [ ] Can you explain the LSTM cell state and why it improves on plain RNN gradient flow?
- [ ] Can you describe the Transformer attention computation as matrix operations?
- [ ] Can you explain BPE tokenization and when a word becomes multiple tokens?
- [ ] Can you choose between semantic similarity and keyword search for a given retrieval task?
- [ ] Can you identify the sequence of NLP preprocessing steps for a production pipeline?

## Next Module

[Module 8 — AI Architecture](../module-08/) takes these building blocks and shows how to combine them into production enterprise systems: API gateways, orchestrators, guardrails, and data architectures that power real AI applications.
