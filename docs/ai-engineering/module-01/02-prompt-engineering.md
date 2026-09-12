---
title: Prompt Engineering
outline: deep
---

# Prompt Engineering

TaskFlow's first prompt was one paragraph: "You're a helpful support agent, answer questions about tickets." It worked on easy tickets and fell apart on ambiguous ones — inconsistent tone, made-up policy details, no clear escalation behavior. Prompt engineering is closing that gap deliberately instead of by trial and error.

::: tip Plain English
A vague instruction to a new employee ("handle customer issues") gets vague, inconsistent results. A clear one — what to check first, what tone to use, when to escalate, an example of a good response — gets consistent ones. Models respond to the same principle: specificity and structure beat a well-meaning paragraph.
:::

## What actually moves the needle

**Role and scope, stated plainly.** Not "be helpful" — what domain, what tone, what's explicitly out of scope.

**Few-shot examples.** One or two examples of ideal input/output pairs, especially for format-sensitive or tone-sensitive tasks, generally outperform lengthy verbal instructions describing the same thing.

**Explicit structure for the output.** If you need consistent formatting, show the format rather than describing it in prose — see [structured outputs](/ai-engineering/module-03/02-structured-outputs) for the version with a schema guarantee.

**Chain-of-thought, when the task needs it.** "Think step by step before answering" measurably helps on tasks with real reasoning steps (multi-step math, policy application with exceptions). It's pure overhead on simple lookups.

```
Weak:   "Answer customer billing questions helpfully."

Better: "You are TaskFlow's billing support agent.
         Scope: billing questions only — redirect technical issues to lookup_ticket.
         Tone: concise, no corporate hedging language.
         Before answering, check the customer's plan tier via get_account.
         If a request involves a refund over $500, escalate — don't approve it yourself.

         Example:
         User: My card was charged twice this month.
         You: [checks account] I see two charges on the 3rd — one looks like
              a duplicate. I've flagged it for refund, expect it in 3-5 days."
```

## Iteration is the actual method

Prompt engineering isn't writing one good prompt — it's running the same prompt against a fixed set of real or representative inputs, seeing where it fails, and adjusting. Doing this without a fixed test set means you're tuning against your own memory of what "seemed better," which is unreliable across sessions. This is the direct precursor to the golden dataset covered in [Module 5](/ai-engineering/module-05/01-metrics).

| Symptom | Likely fix |
|---|---|
| Inconsistent tone | Add few-shot examples showing the tone |
| Wrong format | Show the format, don't describe it; or use structured output |
| Ignores instructions under load | Instructions are probably too long or buried; shorten and move critical rules near the end |
| Hallucinated facts | The prompt is asking for knowledge the model doesn't reliably have — needs [RAG](/ai-engineering/module-04/), not a better prompt |

::: warning Watch out
A hallucination is not always a prompting problem. If the model doesn't have the information at all — a specific policy number, a real-time account state — no amount of prompt tuning fixes it, because there's nothing correct to retrieve from its training. That's a retrieval problem, and better wording of the prompt will just produce more confident wrong answers.
:::

::: details Interview Question — Debugging inconsistent output format
**Q:** Your prompt asks for a specific response format, but the model follows it only about 80% of the time. What do you try first?
**A:** Move from describing the format to showing it — add one or two few-shot examples of the exact desired output. If that's still not reliable enough for a downstream parser, switch to schema-constrained structured output rather than continuing to tune prompt wording, since that gives a guarantee instead of a probability.
:::

::: details Interview Question — Why iteration needs a fixed test set
**Q:** A colleague keeps tweaking a prompt and says it "feels better" each time. What's wrong with that process?
**A:** Without a fixed set of representative inputs to test against, each change is evaluated against memory rather than measurement — you can't tell if a change genuinely improved the failure cases or just happened to look better on whatever example was tried that session, potentially regressing something else. A small golden dataset run consistently before and after each change turns "feels better" into a comparable score.
:::

## Key Mental Models

**Show, don't describe, for anything format-sensitive.** Examples generally beat prose instructions for consistency.

**Not every failure is a prompting problem.** Missing knowledge needs retrieval, not better wording.

**Iterate against a fixed test set, not memory.** Otherwise you can't tell improvement from noise.

## Related

- [1.3 Context Engineering](./03-context-engineering) — what surrounds the prompt, not just its wording
- [3.2 Structured Outputs](/ai-engineering/module-03/02-structured-outputs) — guaranteed format instead of requested format
- [5.1 Metrics](/ai-engineering/module-05/01-metrics) — measuring whether a prompt change actually helped
