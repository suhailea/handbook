---
title: AI Engineering
outline: deep
---

# AI Engineering

This track covers the full spectrum of AI engineering — from the mathematical foundations of machine learning through production LLM systems, infrastructure, security, and domain-specific AI in energy trading.

It is split into two arcs:

**Arc 1 — Building AI Systems (Modules 0–4):** Start here if you want to build LLM-powered products. We build **TaskFlow's customer support agent** from scratch, hitting every real decision an AI engineer faces: choosing a model, writing prompts that don't hallucinate, giving the agent tools and memory, running it without sending customer data to a third party, and knowing when it breaks.

**Arc 2 — Engineering Depth (Modules 8–13):** Go deeper into the production concerns that separate senior AI engineers from prompt engineers. Covers enterprise architecture, LLMOps, cloud infrastructure, security, domain-specific AI, and the business strategy questions senior engineers are expected to answer.

## Who this is for

Backend engineers who can already build APIs and want to understand how to build AI systems that actually work in production — not just demos.

## All 11 Modules

| Module | Arc | What you'll learn |
|--------|-----|-------------------|
| [Module 0 — Mental Models](/ai-engineering/module-00/) | 1 | How Transformers work, training vs inference, embeddings, RLHF |
| [Module 1 — LLMs & Prompting](/ai-engineering/module-01/) | 1 | What are we actually calling? How does prompting work? |
| [Module 2 — Agents](/ai-engineering/module-02/) | 1 | Tools, memory, planning, reflection, multi-agent, MCP |
| [Module 3 — Model Serving](/ai-engineering/module-03/) | 1 | Cloud vs local vs self-hosted; vLLM, KV cache, quantization |
| [Module 4 — Fine-Tuning](/ai-engineering/module-04/) | 1 | LoRA, QLoRA, when to fine-tune vs prompt |
| [Module 8 — AI Architecture](/ai-engineering/module-08/) | 2 | System patterns, enterprise AI stack, data architecture |
| [Module 9 — LLMOps & Evaluation](/ai-engineering/module-09/) | 2 | RAG metrics, production metrics, evaluation pipelines, prompt versioning |
| [Module 10 — AI Infrastructure & Cloud](/ai-engineering/module-10/) | 2 | Docker, Kubernetes, AKS & Azure OpenAI, GPU infrastructure |
| [Module 11 — Security & Responsible AI](/ai-engineering/module-11/) | 2 | Prompt injection, agent security, bias, fairness, GDPR |
| [Module 12 — Energy Trading AI](/ai-engineering/module-12/) | 2 | Energy markets, AI trading architecture, LLM + quant models |
| [Module 13 — AI Business Strategy](/ai-engineering/module-13/) | 2 | Build vs buy, AI decision frameworks, ROI metrics, org-level strategy |

Start with Module 0 and follow Arc 1 end-to-end, then continue into Arc 2 for production depth.

> **Note:** observability, evaluation and guardrails were previously a separate Module 5. They now live with their full treatments in [Module 9 — LLMOps & Evaluation](/ai-engineering/module-09/) and [Module 11 — Security & Responsible AI](/ai-engineering/module-11/). Module numbering is renumbered to close the gap in a later pass.

> **Theory lives elsewhere.** ML fundamentals, statistics, linear algebra, neural networks and NLP moved to the [ML Foundations](/ml-foundations/) reference track. This track links there on demand — you don't need to read it first.
