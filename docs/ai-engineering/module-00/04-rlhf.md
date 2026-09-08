---
title: RLHF — How Models Learn to Be Helpful (Not Just Accurate)
outline: deep
---

# RLHF — How Models Learn to Be Helpful (Not Just Accurate)

A model trained only on internet text would be helpful, harmful, and rude in equal measure — because the internet is. RLHF is what turned raw language capability into something you can actually ship to users.

## The problem with "just predict the next word"

Pre-training produces a model that is, in a weird sense, *too good* at mimicking the internet. Ask it something, and it might respond the way a Reddit argument would. Or a how-to guide. Or a fiction forum. Or a conspiracy theory thread. It has seen all of these and can do all of them.

What it hasn't learned is: *which of these is the right response to give a user who needs help?* Predicting the next word doesn't teach you to be helpful. It teaches you to be statistically plausible.

This is the problem RLHF solves.

## The three phases of building an assistant

**Phase 1 — Pre-training.** The model learns language from a massive text corpus. Billions of tokens. It learns grammar, facts, reasoning patterns, coding conventions, everything — but without any sense of what "good assistant behavior" looks like. This produces the base model.

**Phase 2 — Supervised Fine-Tuning (SFT).** Human contractors write examples of good conversations: a question asked, a high-quality answer given. The model trains on these examples. This shifts its behavior from "generate statistically plausible text" toward "generate the kind of response a thoughtful human would give." It's still crude — the training data is finite and expensive to produce — but it gets the model into the right ballpark.

**Phase 3 — RLHF.** This is where it gets clever. Instead of writing ideal answers (expensive), humans are shown two or more model outputs and asked to *rank* them — which answer was better? Ranking is much faster than writing.

Those rankings train a separate model called a **reward model**, whose job is to predict which outputs humans would prefer. Then, using reinforcement learning, the original language model gets nudged toward outputs that score highly with the reward model. It's a feedback loop: generate output, score it, adjust toward higher scores, repeat.

The result is a model that, over many iterations, learns to give answers that humans consistently rate as more helpful, accurate, and appropriate.

## Why this matters when you're fighting the model

RLHF is why models refuse harmful requests. It's why they format responses helpfully. It's why they say "I don't know" instead of hallucinating confidently (at least more often). It's also why they sometimes refuse things that are obviously fine, or add unnecessary disclaimers to straightforward answers.

When you're wrestling with a model that won't do something reasonable, or that's being overly cautious in ways that hurt your product, you're experiencing the downstream effects of alignment training. The model isn't being randomly weird — it's been tuned to err on the side of caution when uncertain, and sometimes that calibration is off.

Understanding this helps you craft prompts that work with the alignment rather than against it. You're not trying to "jailbreak" anything — you're providing context that shifts the model's assessment of what a helpful response looks like.

::: warning The alignment tax
Making a model safer and more helpful requires tradeoffs. Over-align it and it becomes useless — refusing too much, adding endless caveats, hedging every answer. Under-align it and it's unpredictable and potentially harmful. Every frontier lab navigates this constantly, which is why model behavior changes noticeably between versions. When Claude 3.5 Sonnet behaves differently from Claude 3 Opus, a big part of that difference is alignment tuning, not just capability.
:::

## The modern alternatives

**DPO (Direct Preference Optimization)** is now more common than classic RLHF in many settings. Instead of training a separate reward model and running a full RL loop, DPO uses preference data directly to fine-tune the language model in a single step. Simpler pipeline, similar results, less instability. Most fine-tuned models you see today use DPO or a variant.

**RLAIF (RL from AI Feedback)** replaces human raters with another AI model. Instead of paying humans to rank outputs, you use a capable model (like GPT-4) to generate the preference data. Cheaper, scales better, but the quality depends on the judge model's own alignment — you can get subtle biases in the AI-rated data that wouldn't exist with human raters.

---

::: details Interview Question — What is RLHF and why can't you skip it?

**Q:** A pre-trained language model scores well on benchmarks for factual accuracy and reasoning. Why isn't that sufficient to deploy it as a user-facing assistant? What does RLHF add?

**A:** Benchmark performance measures capability — whether the model *can* produce correct answers. RLHF shapes behavior — whether the model *does* produce helpful, appropriate, safe answers in real-world conditions.

A pre-trained base model, even a highly capable one, has no concept of what a "good assistant response" looks like. It's optimized to be statistically plausible given its training data, which includes harmful content, low-quality content, and content written in inappropriate registers for a user-facing product. Left to its own devices, it might respond to "how do I cancel my subscription?" by continuing the question rather than answering it, or respond to a sensitive question the way a shock-forum would.

RLHF teaches the model preferences: what humans consider helpful vs unhelpful, appropriate vs inappropriate, honest vs evasive. It instills the refusal behavior that blocks harmful requests, the formatting habits that make answers readable, and the calibration that leads to "I'm not certain" instead of confident hallucination. You can't skip it without either accepting unpredictable output, or manually filtering everything — neither of which is viable at scale.

:::

---

[← 0.3 Embeddings](/ai-engineering/module-00/03-embeddings) · [Next: Module 0 Summary →](/ai-engineering/module-00/summary)
