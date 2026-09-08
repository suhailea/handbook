---
title: Agent Evaluation — How Do You Know It's Working?
outline: deep
---

# Agent Evaluation — How Do You Know It's Working?

We launched. The agent answered 94% of questions. But were the answers good? We had no way to know until a user escalated.

::: tip Plain English
If your recommendation algorithm increases click-through rate by 3%, you can measure that. The metric is clear and objective.

Agent evaluation is harder because there's often no single right answer. "What's a good response to a frustrated customer about a billing error?" is not a question with one correct answer — there's a range of good and bad answers.

Evaluation for agents means defining what "good" looks like, creating ways to check if responses meet that standard, and running those checks continuously rather than waiting for user complaints.
:::

## Why evaluation is hard

**No ground truth for most responses.** A frustrated user could be handled well in many different ways. You can't just compare to a "correct" answer.

**Context matters enormously.** A response that's perfect for a new user might be wrong for a power user who knows the product inside out.

**The model can sound confident while being wrong.** Fluency and accuracy are independent. A hallucinated answer in a confident tone is a bad response that might score highly on surface-quality metrics.

## The three evaluation approaches

### 1. LLM-as-judge

Use a second, often larger model to evaluate the output of your agent. You give the judge model the question, the agent's response, and a rubric.

```
You are an expert at evaluating customer support responses.

Evaluate this response on:
1. Accuracy (1-5): Does it correctly answer the question?
2. Tone (1-5): Is it appropriate for a frustrated customer?
3. Completeness (1-5): Did it address all parts of the question?
4. Safety (pass/fail): Did it make any promises we can't keep?

Question: [user's question]
Response: [agent's response]

Return JSON: {"accuracy": N, "tone": N, "completeness": N, "safety": "pass/fail", "notes": "..."}
```

LLM-as-judge scales to thousands of evaluations per day. It's not perfect — the judge model makes mistakes, especially on domain-specific accuracy — but it catches large classes of problems: tone failures, obvious inaccuracies, safety issues.

**Calibration matters:** before using LLM-as-judge at scale, run 100 examples through it and have a human compare the judge's scores to what they would score. If the judge disagrees with humans on 20% of cases, you have a measurement problem.

### 2. Golden datasets

A set of hand-curated test cases: question + expected behavior (sometimes a specific answer, sometimes a set of criteria it must meet).

For TaskFlow:
- 50 billing questions with expected outcomes
- 30 technical troubleshooting scenarios with known solutions
- 20 escalation cases that should always escalate

Run the agent against these before every deployment. If the pass rate drops, don't deploy.

Golden datasets are the equivalent of integration tests for your agent. They catch regressions when you change your prompt, switch models, or update your tools.

### 3. Human review

The most expensive but most reliable. Sample N% of real conversations (we use 2%) and have a human rate them on the same rubric as LLM-as-judge.

Two purposes:
1. **Ground truth for calibration** — keep your LLM-as-judge calibrated by comparing it to human scores quarterly
2. **Catching what automated evaluation misses** — humans notice things models don't: responses that are technically correct but feel dismissive, correct answers that miss the emotional subtext of a frustrated user

## The metrics that matter

Don't evaluate just response quality in isolation. Measure outcomes:

| Metric | What it measures | How to get it |
|--------|-----------------|---------------|
| Task completion rate | Did the user's problem get solved? | User survey, or track if they come back with the same issue |
| Escalation rate | How often does the agent give up? | Log every escalation |
| Escalation accuracy | When it escalates, was it right to? | Human review of escalated tickets |
| User satisfaction (CSAT) | Did the user feel helped? | Post-conversation survey |
| First-contact resolution | Solved without human follow-up? | Link support tickets to conversations |

For TaskFlow: our most important metric is first-contact resolution rate — did the user's problem get solved without needing a human? We track this weekly. When our agent model improved, this metric went from 67% to 79%.

::: warning Watch out
Optimizing for response quality metrics without measuring outcomes can lead you astray. The agent can produce beautifully written, well-rated responses that don't actually help users. Connect your evaluation to real outcomes.
:::

::: details Interview Question — Evaluation strategy
**Q:** How do you know if an agent regression introduced by a new prompt version is actually worse, and not just different?

**A:** Three layers: (1) **Golden dataset** — run both versions against your fixed test set and compare scores. If the new version scores lower on cases that the old version passed, that's a regression. (2) **LLM-as-judge comparison** — for each test case, show the judge both responses and ask "which is better?" A/B comparison is often more reliable than absolute scoring. (3) **Shadow deployment** — run both versions in parallel on real traffic (without showing both responses to users), collect LLM-as-judge scores on real inputs, and compare distributions after 1,000 conversations. Different is not always worse — but regression in your golden dataset is a red flag. Changes in outcome metrics (escalation rate, CSAT) over a week of shadow deployment is the closest thing to ground truth you can get before committing.
:::
