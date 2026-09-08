---
title: Module 5 — Production
outline: deep
---

# Module 5 — Production

The agent was in production. Now we needed to know: Is it working? Is it safe? How do we catch failures before users do?

TaskFlow's agent had been live for two weeks. Users were happy — mostly. Then we started getting escalations. A user got wrong advice that made their problem worse. Another user found a way to get the agent to discuss competitors. We had no logs, no traces, no way to replay what happened.

We were flying blind.

This module is about not flying blind. Observability, evaluation, and guardrails — the three systems that make the difference between a demo and a production agent.

## Pages in this module

1. [Agent Observability — Seeing Inside the Black Box](./01-agent-observability) — tracing, logging, cost tracking
2. [Agent Evaluation — How Do You Know It's Working?](./02-agent-evaluation) — LLM-as-judge, golden datasets, metrics
3. [Guardrails — Keeping the Agent in Bounds](./03-guardrails) — input/output filtering, hard stops
4. [Summary](./summary) — 4 mental models to take forward
