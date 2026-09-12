---
title: Module 0 Summary — Mental Models
outline: deep
---

# Module 0 Summary — Mental Models

You don't need to understand the math to make good engineering decisions about AI systems. You need the right mental models. Here are the five that will serve you for everything that follows.

---

**Transformers read everything at once.** The attention mechanism lets every token look at every other token simultaneously to figure out context. This is why context window size matters — more tokens in the window means more context the model can reason over. It's also why long-context models are genuinely more capable, not just a marketing claim.

**Training happens once and costs millions; inference happens per-request and costs per-token.** These are two completely different problems with completely different optimization strategies. When your AI system is expensive or slow, ask which one you're actually dealing with before reaching for a solution. Conflating them leads you in the wrong direction.

**Embeddings are meaning-as-numbers.** Similar meaning means nearby vectors. This is the foundation of semantic search, RAG retrieval, clustering, and classification. Embedding models are separate from language models — smaller, faster, cheaper, and built for a different job. Use them for retrieval; use language models for generation.

**RLHF is why the model is helpful and not just capable.** A raw pre-trained model would be unpredictable and often unsafe. RLHF (and its modern variants like DPO) shapes raw language capability into assistant behavior. When you're fighting the model's refusals or compliance, you're navigating the downstream effects of alignment training — and understanding that helps you work with it rather than against it.

**The field moves fast and has real open questions.** We don't fully understand why large transformers are so capable at scale. We don't have perfect alignment techniques. Model behavior changes meaningfully between versions because of both capability and alignment updates. Holding your mental models loosely and testing empirically will serve you better than reasoning from first principles about what a model "should" do.

---

::: tip You're ready for Module 1
With these four concepts locked in, Module 1 will make a lot more sense. When we talk about token limits, you'll know it's about the attention mechanism's context window. When we talk about prompt engineering shaping model behavior, you'll know you're working with the grain of RLHF training. When we reach retrieval in Module 4, you'll know exactly why embeddings and generation are two different jobs.
:::

---

[← 0.4 RLHF & Alignment](/ai-engineering/module-00/04-rlhf) · [Module 1: LLMs & Prompting →](/ai-engineering/module-01/)
