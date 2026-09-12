---
title: When to Fine-Tune (and When Not To)
outline: deep
---

# When to Fine-Tune (and When Not To)

We almost fine-tuned when a better system prompt would have done the job. Here's the decision tree.

::: tip Plain English
Fine-tuning is like surgery. It can fix real problems. But you don't go straight to surgery when the problem might be fixed with rest and physical therapy. You exhaust the simpler options first.

For most problems you encounter building an AI agent, the simpler option — a better prompt, a RAG setup, a different model — will solve it faster, cheaper, and with less risk than fine-tuning.

Use this decision tree before even opening a Colab notebook.
:::

## The decision tree

```
What kind of problem is it?

Is it a KNOWLEDGE problem?
(The model doesn't know facts about your domain, product, or data)
  └─ Yes → Use RAG. Fine-tuning won't reliably solve this.
  └─ No ↓

Is it a BEHAVIOR / FORMAT / STYLE problem?
(Tone, structure, following a specific process, using your terminology)
  └─ Yes → Try prompting first.
          └─ Prompting fixed it? → Done. Ship it.
          └─ Prompting not enough? → Consider fine-tuning.
  └─ No ↓

Is it a COST / SPEED problem?
(The model is too slow or too expensive for this task)
  └─ Yes → Fine-tune a small model to do the specific task.
           (Replace big-model usage with cheap fine-tuned small model)
  └─ No ↓

Is it a REASONING problem?
(The model reasons incorrectly about domain-specific concepts)
  └─ Yes → Fine-tuning rarely fixes this. Try chain-of-thought,
           better context, or a different base model.
```

## The three-column comparison

| | Prompt Engineering | RAG | Fine-tuning |
|---|---|---|---|
| What it's for | Behavior, tone, instructions | Knowledge retrieval | Behavior, format, cost optimization |
| Cost to implement | Hours | Days to weeks | Days to weeks (+ training cost) |
| Updates easily? | Yes — edit the prompt | Yes — update the database | No — requires retraining |
| Handles knowledge? | Somewhat (via context) | Yes — that's its job | Poorly |
| Handles format? | Yes | No | Yes |
| Requires data? | No | Your documents | Training pairs (100+) |
| Model quality ceiling | High | High | Depends on base model |

## When fine-tuning is clearly the right answer

**1. You need a cheaper/faster model for a specific task at scale**

You currently use GPT-4o to classify support tickets as billing/technical/account. At 100,000 requests/day, that's expensive. Fine-tune Llama 3 3B on 2,000 labeled examples from your historical tickets. Same classification quality, 50x cheaper per call.

**2. Consistent format that prompting can't enforce reliably**

Your ticketing system requires a specific JSON format with 12 fields. Even with extensive prompting, the model occasionally misses a field or uses the wrong format. Fine-tuning on 500 examples of correct format produces near-100% format adherence.

**3. Deep domain-specific response style**

You have a very specific way of handling escalations — specific phrases, specific structure, specific tone. It's subtle enough that a 3-paragraph system prompt doesn't capture it, but 200 examples of "correct" escalation handling would.

## When fine-tuning is clearly NOT the answer

**You expect it to learn facts.** Fine-tuned knowledge is unreliable and goes stale. Use RAG.

**The base behavior changes over time.** If what "correct" looks like changes frequently, fine-tuning is expensive to maintain. Prompts update in minutes; fine-tunes take hours/days.

**You haven't tried prompting yet.** Seriously — a well-written system prompt with 5 few-shot examples often achieves 90% of what fine-tuning achieves. Start there.

**You have fewer than ~100 high-quality examples.** Fine-tuning on small, low-quality data produces an overfit mess. More data, better quality, or don't fine-tune.

## For TaskFlow specifically

After going through this decision tree, our fine-tuning roadmap:

| Problem | Solution | Why |
|---------|----------|-----|
| Doesn't know product features | RAG on help docs | Knowledge problem |
| Says "the software" instead of "TaskFlow" | System prompt | 5-minute fix |
| Escalation message format | Fine-tune small model | Format consistency at scale |
| Ticket intent classification | Fine-tune small model | Cost — 100k/day requests |
| Complex reasoning on technical issues | Better prompting (CoT) | Fine-tuning won't fix reasoning |

::: details Interview Question — Fine-tune decision
**Q:** You're building a support agent. The model's responses are technically correct but consistently too formal for your brand voice — like a legal document. How do you fix this?

**A:** Start with the cheapest fix: update the system prompt. Add explicit tone instructions with 2–3 examples of the desired voice — casual, warm, direct. This is a 20-minute change and often works completely. If the prompt doesn't hold the tone consistently across diverse inputs (especially under adversarial or unusual questions), the next step is few-shot examples in the prompt — add 8–10 complete examples of question → ideal-tone response. If that still doesn't produce reliable consistency (rare), then fine-tuning becomes justified: collect 200–500 real examples of correct-tone responses, fine-tune a model (possibly a smaller one), and use that for response generation. The investment is days of work and training costs. For most teams, the system prompt fix is enough and fine-tuning is never needed for tone alone.
:::
