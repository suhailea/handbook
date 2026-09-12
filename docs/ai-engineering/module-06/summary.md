---
title: Module 6 Summary — Observability & LLMOps
outline: deep
---

# Module 6 Summary — Observability & LLMOps

## What you built

The operational layer that sits on top of evaluation: how to trace a live agent run well enough to debug a specific bad answer, what production metrics actually matter, and how to change prompts and models safely once real traffic depends on them.

## 4 Mental Models to Take Forward

1. **Debug from the input side, not the output side.** A bad answer's cause is almost always visible in what the model was actually given — stale context, a wrong tool result — not in the answer itself.

2. **Cost, latency, and error rate are three different signals.** A system can be fast and cheap while quietly failing, or slow and expensive while working correctly. Track all three, not one as a proxy for the others.

3. **Prompt and model changes need the same discipline as code changes.** Version them, gate them behind the evaluation suite from [Module 5](/ai-engineering/module-05/), and roll out gradually rather than switching all traffic at once.

4. **Observability is what makes evaluation trustworthy in production.** A golden dataset tells you the system worked in a test; tracing tells you it's still working on real traffic, which is a different and ongoing question.

## Self-Assessment Checklist

- [ ] Can you describe what should be captured for every LLM call and every tool call in a trace?
- [ ] Can you explain the difference between TTFT and total latency, and why both matter?
- [ ] Can you walk through diagnosing a user-reported bad answer using only traces?
- [ ] Can you describe how you'd safely roll out a prompt change to production traffic?

## Next Module

[Module 7 — Security & Guardrails](/ai-engineering/module-07/) covers what to do when the system is being watched by someone trying to break it: prompt injection, agent authorization, guardrails, and responsible AI.
