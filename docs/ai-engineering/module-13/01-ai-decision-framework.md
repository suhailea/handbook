---
title: The AI Decision Framework — Is AI the Right Tool?
outline: deep
---

# The AI Decision Framework — Is AI the Right Tool?

🔥🔥🔥 Interview weight — asked in every senior AI engineer loop. Prerequisites: [LLMs & Tokens](../module-01/01-llms-and-tokens), [Fine-Tuning Overview](../module-04/01-fine-tuning-overview).

## 🗣️ In Plain English

::: tip In Plain English
Imagine you run a restaurant and you're thinking about hiring a chef. Before you post the job listing, you need to ask some basic questions. Do you actually need a chef, or do you just need someone who can follow a recipe? Is the food you'll be making complex enough to justify a full salary, or could a cheaper solution do the job? Do you have enough customers to make the chef worth it? Can you even afford one right now?

Hiring a chef when all you needed was a microwave is a failure — not because the chef isn't talented, but because you chose the wrong tool for the job.

AI projects fail the same way. The technology works; the decision to use it was wrong. Someone saw a demo, got excited, and said "let's add AI to this." Six months and $200,000 later, they have a system that's slower, less reliable, and harder to maintain than the rule-based system it replaced — because nobody stopped to ask whether AI was actually the right tool.

The AI Decision Framework is the set of questions you ask *before* building anything. It's not pessimistic about AI — it's how you make sure that when you do use AI, it's for the right reasons, and you can tell whether it worked.
:::

## ⚙️ Under the Hood

### The five questions to ask before any AI project

Work through these in order. A "no" at any step is a signal to stop or rethink — not necessarily a hard stop, but a prompt to examine your assumptions.

#### 1. What problem are you actually solving?

This sounds obvious. It isn't. "Add AI to customer support" is not a problem statement. These are:

- "30% of support tickets are answered incorrectly on first contact, causing a second ticket and 2× the handling cost"
- "The average time-to-first-response is 4 hours, and customers churn within 48 hours of submitting a ticket"
- "Support agents spend 40% of their time looking up answers in a knowledge base that could be automated"

A good problem statement includes: the symptom, the frequency, the cost, and who feels it.

#### 2. Why AI? (And why not something simpler?)

AI is expensive, probabilistic, and hard to test. Before reaching for it, genuinely ask whether:

| Alternative | When it's better than AI |
|---|---|
| Rule-based system | When inputs are structured, cases are enumerable, and correctness is binary |
| Better search/retrieval | When users can't find information that already exists |
| Process change | When the problem is organizational, not technical |
| Hiring people | When volume is low and quality is paramount |
| Simple ML (not LLM) | When input is tabular/structured and the task is classification or regression |

The honest version of "why AI": AI is worth it when the input is **unstructured** (natural language, images, audio), the task requires **understanding context** rather than matching patterns, or the decision space is **too large to enumerate** with rules.

#### 3. Do you have the data?

Every AI project needs data — for training, for evaluation, or both. Ask:

- **For RAG:** Do you have the documents? Are they clean, up-to-date, and accessible? Who maintains them?
- **For fine-tuning:** Do you have labelled examples? How many? Who labelled them? Are they representative of production traffic?
- **For evaluation:** Do you have a golden dataset? How was it created? Is it representative?

A project with no evaluation data is a project you can never prove works.

#### 4. Build vs buy vs fine-tune?

```
                    Can a general LLM (GPT-4o, Claude) do it
                    with good prompting + RAG?
                              │
                    ┌─────────┴─────────┐
                   YES                  NO
                    │                   │
              Use cloud API         Does it need
              + RAG/prompting       custom behavior,
                                   style, or domain
                                   knowledge?
                                         │
                                   ┌─────┴─────┐
                                  YES           NO
                                   │             │
                             Fine-tune      Consider a
                             or use a       specialist
                             specialist     model or
                             model          different
                                            approach
```

The key insight: **most problems don't need fine-tuning**. The cost and complexity of fine-tuning is justified only when prompting + RAG demonstrably fail — not as a first instinct.

**Buy vs build decision matrix:**

| Factor | Lean toward buying | Lean toward building |
|---|---|---|
| Core differentiator? | No — commodity feature | Yes — competitive moat |
| Data privacy | Can share with vendor | Must stay internal |
| Customization needed | Low | High |
| Time to market | Urgent | Can invest |
| Maintenance burden | Want to offload | Can handle |
| Vendor lock-in tolerance | Acceptable | Unacceptable |

#### 5. What are the risks if it goes wrong?

AI is probabilistic — it will produce wrong outputs. The question is: what happens when it does?

| Risk level | Example | Mitigation |
|---|---|---|
| Low | Wrong FAQ answer | User notices, asks again |
| Medium | Wrong support escalation | Delays resolution, bad experience |
| High | Wrong financial calculation | Direct monetary loss |
| Critical | Wrong medical dosage | Patient harm |

For high and critical risk: AI should not be the final authority. Use AI to assist and recommend; keep a human or a deterministic system in the approval chain.

### The full decision checklist

Before greenlighting any AI project, answer all of these:

```
□ Problem statement with symptoms, frequency, and cost
□ Why AI instead of a simpler alternative
□ Data availability confirmed (training, eval, or knowledge corpus)
□ Build/buy/fine-tune decision made with explicit rationale
□ Risk level assessed — who/what is affected if the model is wrong
□ Success metric defined (what does "working" look like?)
□ Fallback plan if AI underperforms
□ Cost estimate (API costs, infra, engineering time)
□ Human-in-the-loop requirements identified
□ Timeline to first meaningful evaluation
```

A project that can't answer these questions is not ready to start.

### Framing the answer in an interview

If asked "how would you approach deciding whether to use AI for X?", walk through:

1. **Problem clarity** — restate the problem with metrics
2. **Simpler alternatives** — name two and explain why they don't fit
3. **Data audit** — confirm you have what you need for both training and evaluation
4. **Build/buy/fine-tune** — make a decision and justify it
5. **Risk + fallback** — acknowledge failure modes and how they're handled
6. **Success metric** — name one primary metric and how you'd measure it

This is the structure of a senior-level answer. Mid-level answers skip steps 2, 3, and 5.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Shipping with no evaluation dataset.** Team builds a RAG-based support bot, demos well in testing, ships to production. Three weeks later, support tickets go up — the bot is giving wrong answers that customers escalate. There's no golden dataset to measure against, so nobody can tell whether the system degraded or was always bad. Fix: before writing any code, create a golden dataset of 50–200 representative question/answer pairs. This is the single most important investment in any AI project.

**Fine-tuning when prompting would have worked.** Team spends 6 weeks collecting training data, fine-tuning a model, and evaluating it — only to discover that adding three well-crafted few-shot examples to the system prompt achieves the same quality. Fine-tuning had a 6-week opportunity cost for zero benefit. Fix: always exhaustively try prompting + RAG before even considering fine-tuning. Fine-tuning is rarely the answer.

**Vendor lock-in after choosing "buy" with no exit strategy.** AI vendor provides a RAG product that abstracts away all infrastructure. Team integrates deeply — custom metadata, proprietary APIs, non-standard chunking. Vendor raises prices 3× or gets acquired. Migration is a full rewrite. Fix: when buying, always abstract vendor-specific APIs behind an interface you control. Prove you can swap vendors by building a thin adapter layer from day one.

**Measuring the wrong metric.** Team measures "model accuracy on golden dataset" at 92% and declares success. Production shows 30% of users are frustrated and abandoning the bot. The golden dataset wasn't representative of real user queries — it was created by engineers who knew the system, not by users who didn't. Fix: measure user outcomes (task completion rate, escalation rate, CSAT) in addition to model quality metrics. Both matter.

:::

## 🎯 Checkpoint

::: details Question 1 — When would you not use AI for a problem?
**Q:** You're asked to "add AI" to a system that routes inbound support tickets to the right team. When would you recommend against using AI, and what would you use instead?

**A:** Recommend against AI if:

1. **The routing logic is enumerable and rule-based** — if there are 10 teams and the routing decision is based on a category the user already selects (billing, technical, account), a rules engine handles this perfectly. AI adds latency, cost, and unpredictability with no benefit.

2. **You have no labelled training data** — routing classification requires examples. If you're launching a new product with no historical tickets, you can't train or evaluate a classifier.

3. **The cost of misrouting is high** — if a ticket routed to the wrong team sits for 48 hours before being noticed, AI's error rate (even at 95% accuracy) means 5% of tickets get delayed. Rules-based routing at 100% accuracy on known categories is better.

What to use instead: a structured intake form (user selects category), keyword matching for known intents, or a simple logistic regression classifier trained on historical tickets. Only graduate to an LLM-based router when the ticket content is unstructured, the category space is large and fuzzy, and you have historical labelled data to evaluate against.
:::

::: details Question 2 — When do you fine-tune vs prompt engineer?
**Q:** Your team wants to build a support bot that always responds in a specific formal tone, uses your brand's terminology, and refuses to answer off-topic questions. A colleague says "we need to fine-tune for this." Do you agree?

**A:** No — this is a prompting problem, not a fine-tuning problem.

Tone and brand terminology can be specified in the system prompt with examples. A well-written system prompt with 3–5 few-shot demonstrations of the desired tone will match fine-tuned quality for stylistic tasks. Off-topic refusal is a guardrail problem — handled by a classification check or an output filter, not fine-tuning.

Fine-tuning is justified when: the task requires knowledge not in the base model, prompting and RAG demonstrably fail after exhaustive iteration, the desired behavior is fundamentally different from what prompting can produce, or you have thousands of high-quality labelled examples.

Fine-tuning is expensive (data collection, training compute, ongoing maintenance), has no versioning or prompt flexibility, and makes A/B testing harder. Exhaust prompting first. The rule of thumb: if you can describe the desired behavior in words, you can probably achieve it in a prompt.
:::

## Key Mental Models

**"Why AI?" is the most important question — ask it before anything else.** AI is expensive, probabilistic, and hard to maintain. A simpler solution that works is always better.

**No evaluation dataset = no project.** You cannot know if an AI system works without something to measure it against. Creating the golden dataset is the first engineering task, not the last.

**Most AI problems don't need fine-tuning.** Prompting + RAG solves 80–90% of use cases. Fine-tuning is a specialist tool for when those fail.

**Risk level determines the role of AI in the decision chain.** Low-risk: AI decides. High-risk: AI recommends, human approves. Critical: AI assists, deterministic system controls.

**Measure user outcomes, not just model metrics.** A model that's 95% accurate on your golden dataset but frustrates 40% of users has the wrong metric as its north star.

## Related

- [Fine-Tuning Overview](../module-04/01-fine-tuning-overview) — when fine-tuning is actually warranted
- [AI Metrics & ROI](./02-ai-metrics-roi) — how to measure whether the AI project succeeded
- [Guardrails](../module-05/03-guardrails) — handling the risk when AI gets it wrong
- [Agent Evaluation](../module-05/02-agent-evaluation) — building the evaluation pipeline
