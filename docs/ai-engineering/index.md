---
title: AI Engineering
outline: deep
---

# AI Engineering

This track teaches you to build, ship and operate LLM-powered systems, following one story end to end: **TaskFlow's customer support agent**, from first API call to the strategy conversation about what to build next.

It is a build line, not a reference manual. Each module exists because the previous one created a problem it has to solve.

## The story

> I need to understand what I'm calling *(Module 0)* → I learn to talk to it *(1)* → I make it act *(2)* → I build a real application around it *(3)* → I give it knowledge *(4)* → **I find out whether it works** *(5)* → I watch it and keep it safe *(6, 7)* → I architect it properly *(8)* → I outgrow the API *(9, 10)* → I run it at scale *(11)* → I see how others did it *(12)* → I decide what's worth building *(13)*.

Evaluation at Module 5 is the hinge. Everything before it is construction; everything after it operates a system you can actually measure.

## Who this is for

Backend engineers who can already build APIs and want to build AI systems that survive production — not demos.

## The 14 modules

| Module | What you'll learn |
|--------|-------------------|
| [0 — Mental Models](/ai-engineering/module-00/) | Transformers, training vs inference, embeddings, RLHF — the intuitions everything else assumes |
| [1 — LLMs & Prompting](/ai-engineering/module-01/) | Tokens, context windows, prompt and context engineering |
| [2 — Agents](/ai-engineering/module-02/) | The agent loop, tools, memory, planning, multi-agent, MCP, A2A |
| [3 — The Application Layer](/ai-engineering/module-03/) | Streaming, structured outputs, reliability, cost, prompt and semantic caching |
| [4 — RAG, The Bridge](/ai-engineering/module-04/) | When retrieval is the answer — then hand off to the RAG track |
| [5 — Evaluation](/ai-engineering/module-05/) | Metrics, golden datasets, LLM-as-judge, regression gates, red teaming |
| [6 — Observability & LLMOps](/ai-engineering/module-06/) | Tracing agent runs, latency, cost, prompt and model versioning |
| [7 — Security & Guardrails](/ai-engineering/module-07/) | Prompt injection, agent authorization, guardrails, responsible AI |
| [8 — AI Architecture](/ai-engineering/module-08/) | System patterns, the enterprise stack, data architecture |
| [9 — Model Serving](/ai-engineering/module-09/) | Cloud vs local vs self-hosted, GGUF, vLLM, quantization |
| [10 — Fine-Tuning](/ai-engineering/module-10/) | LoRA, QLoRA, and when fine-tuning is the wrong answer |
| [11 — Infrastructure & Cloud](/ai-engineering/module-11/) | Docker, Kubernetes, AKS, GPU infrastructure patterns |
| [12 — Case Studies](/ai-engineering/module-12/) | Full worked systems, starting with AI in energy trading |
| [13 — AI Business Strategy](/ai-engineering/module-13/) | Build vs buy, ROI, and the questions senior engineers get asked |

## Two tracks you'll be sent to

**[Production RAG](/rag/)** — 18 modules on retrieval. Module 4 hands you over and tells you when to come back.

**[ML Foundations](/ml-foundations/)** — statistics, linear algebra, neural networks, optimization. A reference track, linked on demand. You don't need it first, and for most engineering work you won't need it at all.

Start at [Module 0](/ai-engineering/module-00/).

## Interview prep

- [60 Interview Questions](/ai-engineering/questions) — self-test bank covering every module
- [Crash Sheet](/ai-engineering/crash-sheet) — 10-minute scan before an interview
- [Interview Answer Framework](/ai-engineering/interview-framework) — a structured approach for AI system design questions
