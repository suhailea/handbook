---
title: Fine-Tuning — Teaching the Model New Tricks
outline: deep
---

# Fine-Tuning — Teaching the Model New Tricks

The base model kept calling our product "the software" instead of "TaskFlow." It didn't know our support playbook. Should we fine-tune?

We almost did. We spent a week preparing training data before someone asked the question that stopped us: "What exactly do we want the model to learn?"

The answer was "use the right product name and follow our escalation policy." That's a behavior and format problem. Not a knowledge problem.

We fixed it in 20 minutes with a better system prompt.

::: tip Plain English
Fine-tuning is like sending an employee to a training program that changes how they think and respond — not just what they read before a meeting.

A system prompt is like giving that employee a briefing document before each meeting. It tells them the rules, the context, and what to do. Most of the time, the briefing is enough.

Fine-tuning is for when you need the employee to have genuinely internalized a skill — not just follow instructions. When the skill needs to be effortless, consistent, and embedded in how they operate, not referenced from a document.

The most common mistake: people fine-tune when a better briefing document (system prompt) would have solved the problem in an afternoon.
:::

## What fine-tuning actually does

Fine-tuning is continued training on your data. You take a pre-trained model and run more training steps on examples you provide — input/output pairs that demonstrate the behavior you want.

The model's weights change. It learns patterns from your data at the parameter level. This is different from prompting, where you're just providing context.

**What fine-tuning is good at:**

- **Consistent tone and style** — if you want the model to always respond in a specific voice (formal, casual, your brand voice), fine-tuning embeds it at the weight level so it's consistent without needing a long style guide in every prompt
- **Output format** — always respond in a specific JSON structure, always use bullet points, always include a greeting
- **Domain-specific response patterns** — handling support tickets in exactly the way your playbook describes
- **Smaller, faster inference** — fine-tune a small model (3B, 7B) to do a specific task that currently requires a large general-purpose model

**What fine-tuning is NOT good at:**

- **Injecting factual knowledge** — if you fine-tune on "TaskFlow has feature X," the model may or may not recall this correctly, and it can still hallucinate. Use RAG for knowledge.
- **Fixing reasoning** — if the model reasons poorly about something, fine-tuning usually doesn't fix the underlying reasoning ability
- **One-off behavior changes** — if you just need the agent to say "TaskFlow" instead of "the software," that's a system prompt fix, not a fine-tuning job

## The common mistake

::: warning Watch out
The most common fine-tuning mistake is using it to inject knowledge.

Teams will take their product documentation, convert it to Q&A pairs, and fine-tune a model on it — expecting the model to now "know" their product. This usually fails:

1. The model may generate plausible-sounding but wrong answers about your product (it doesn't know which facts it "learned" are reliable)
2. When your product changes, the fine-tuned model has stale knowledge and needs retraining
3. RAG solves this better — put your documentation in a vector store, retrieve the relevant section at query time, and the model cites accurate, up-to-date information

Fine-tuning is for behavior. RAG is for knowledge.
:::

## When fine-tuning actually makes sense for TaskFlow

After our analysis, the legitimate use cases were:

1. **Training a small classifier** — fine-tune a tiny model to classify support intent (billing/technical/account) at very high accuracy. Fast, cheap to serve, no need for a big general model just for this step.

2. **Response format consistency** — we have very specific rules for how escalation messages should be written. Fine-tuning a small model to always follow this format exactly is more reliable than prompting.

3. **Cost optimization** — fine-tune a 7B model to handle the 70% of tickets that are simple and routine. Reserve the big model (GPT-4o / Llama 3 70B) for complex cases. Significant cost reduction at scale.

::: details Interview Question — Fine-tuning vs RAG
**Q:** A customer asks you to fine-tune the model on their 10,000-page product manual so the model "knows" their product. How do you respond?

**A:** Politely redirect. Fine-tuning on knowledge doesn't work reliably — the model may recall fine-tuned facts inconsistently, can still confabulate, and the fine-tune becomes stale whenever the manual changes (requiring expensive retraining). RAG is the right architecture: chunk the manual, embed it, store in a vector database, retrieve relevant sections at query time. The model then reads the actual source document when answering — which is accurate, up-to-date, and citable. Fine-tuning is what you do if you want to change *how* the model responds (format, tone, style, specific behavioral patterns). It's not for making the model know facts.
:::
