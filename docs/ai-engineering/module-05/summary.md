---
title: Module 5 Summary — Production
outline: deep
---

# Module 5 Summary

Four things to remember from this module — the difference between a demo and a production agent.

## Mental Models

**1. If you can't replay what happened, you can't debug it.** Trace every LLM call, every tool call, every input and output. The trace is your audit log, your debugging tool, and your cost monitor. Building observability after the fact is 5x harder than building it from the start. Add it before your first production deployment.

**2. Evaluation is continuous, not a launch gate.** Your golden dataset is your regression test suite. Run it before every deployment. Add new cases every time you see a failure in production. LLM-as-judge scales evaluation to your real traffic; human review calibrates it. Neither alone is enough.

**3. Measure outcomes, not just output quality.** A beautifully worded response that doesn't solve the user's problem is a failure. The metrics that matter are task completion rate, first-contact resolution, and user satisfaction — not just "did the response sound good?" Connect your evaluation to outcome metrics.

**4. Guardrails are defense in depth — not a complete solution.** Input guardrails catch problems before they reach the model. Output guardrails catch problems before they reach the user. Neither is foolproof. Build them as part of a layered defense that also includes good system prompts, limited tool permissions, and human-in-the-loop flows for high-stakes actions. A guardrail that blocks 5% of legitimate requests is a product bug, not a safety feature.

## You've built TaskFlow's agent

You started with a blank page and the OpenAI API. Five modules later, you understand:
- What the model is actually doing when you call it
- How to build an agent loop with tools, memory, and planning
- How to serve a model privately when cloud APIs aren't an option
- When (and when not) to fine-tune
- How to observe, evaluate, and guard your agent in production

That's the full AI engineering stack. Everything else is depth on these foundations.
