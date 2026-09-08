---
title: Training vs Inference — Two Very Different Problems
outline: deep
---

# Training vs Inference — Two Very Different Problems

When we call the OpenAI API, are we training the model? No. But understanding the difference explains why AI costs what it costs, why some things are fast and some are slow, and why your intuitions from traditional software sometimes lead you astray.

## The studying and the practicing

Here's the analogy that makes this stick: training is like putting someone through medical school. Inference is like seeing a patient.

Medical school takes years. You read millions of pages, run thousands of experiments, get feedback on what you got wrong, and slowly update your understanding of how medicine works. The process is expensive, intensive, and happens once. At the end, a set of knowledge is baked into your brain — your "weights."

After that, when a patient walks in, you don't re-read every textbook. You just apply what you already know to this specific situation. That's inference. The expensive learning already happened; now you're just running the result.

**Training a large language model works exactly like this.** The model sees billions of sentences, predicts the next word in each one, gets feedback on whether it was right, and adjusts its billions of internal numbers (weights) accordingly. This process runs for weeks or months on thousands of high-end GPUs and costs millions of dollars. OpenAI, Anthropic, and Google do this. You do not.

**When you call the API, you are doing inference.** The weights are frozen. You hand the model some input, it runs a single forward pass through its network, and it produces output. Fast, cheap by comparison — but it still adds up.

## Why inference is still expensive at scale

"Cheap by comparison" is doing a lot of work in that sentence. Here's the reality:

A model like GPT-4 has hundreds of billions of parameters — numbers stored in memory. Every single token it generates requires your input to be multiplied against all of those numbers. That's not a figure of speech; it's literally what the forward pass computes.

This is why VRAM (GPU memory) is the bottleneck for inference. You need the entire model to fit in GPU memory to generate at useful speed. A 70B-parameter model at full precision takes around 140GB of VRAM just to load — that's multiple high-end GPUs before you've even started generating a single token.

Scale this to billions of API calls per day across all users, and you start to understand why frontier model inference costs are what they are, and why the per-token pricing structure exists.

## The three phases, simply

It helps to know that there are actually three distinct phases:

**Pre-training** is the expensive one. Learn language from a huge chunk of the internet. Predict next tokens. Billions of examples, weeks of compute, millions of dollars. This produces a base model that knows a lot about the world but isn't particularly useful as an assistant.

**Fine-tuning** takes that base model and continues training on a much smaller, curated dataset to specialize behavior — either for a domain (coding, medicine) or for assistant-style interaction. Much cheaper than pre-training, but still not something you run on your laptop. This is where techniques like LoRA and QLoRA come in (covered in Module 4).

**Inference** is what runs every time you call the API. The weights are frozen. No learning happens. You're paying for compute time, not training.

::: tip What this means for your architecture
Fine-tuning is sometimes the right call — but it's not your first move. Prompt engineering and RAG (retrieval-augmented generation) are cheaper, faster to iterate, and often solve the same problem. You reach for fine-tuning when you need the model to learn a style, format, or domain knowledge that's hard to put in a prompt. Module 4 covers when to actually make that call.
:::

## The practical takeaway

When something feels slow or expensive in your AI system, ask: is this a training cost or an inference cost? They have completely different solutions. Training costs come down by reducing parameters, using more efficient architectures, or training for fewer steps. Inference costs come down by using smaller models, quantization, batching requests, or caching common outputs.

Conflating them leads to nonsensical optimization strategies — like trying to "train less" when your cost problem is actually inference volume.

---

::: details Interview Question — Why does a larger model cost more to run, even after training is done?

**Q:** You've finished training a 70B-parameter model. Training is over. Why is inference still more expensive than running a 7B-parameter model?

**A:** During inference, every token generated requires a full forward pass through the model — meaning your input gets multiplied through every layer, every attention head, every parameter. A 70B model has ten times as many parameters as a 7B model, so each forward pass requires roughly ten times as much computation and, critically, ten times as much memory bandwidth to load the weights from VRAM.

Memory bandwidth is often the actual bottleneck for inference (not raw compute), because GPUs can multiply fast but have limited bandwidth for reading weights from memory. Larger models also require more VRAM just to fit in memory — a 70B model at fp16 needs ~140GB VRAM, requiring multiple GPUs and adding coordination overhead. The result: higher latency per token, lower throughput per GPU, and higher cost per request. This is why quantization (reducing weight precision) is so valuable for inference — same model, smaller memory footprint, faster reads.

:::

---

[← 0.1 How Transformers Work](/ai-engineering/module-00/01-how-transformers-work) · [Next: 0.3 Embeddings →](/ai-engineering/module-00/03-embeddings)
