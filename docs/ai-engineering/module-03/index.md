---
title: Module 3 — Model Serving
outline: deep
---

# Module 3 — Model Serving

Our agent worked great with OpenAI. Then product said: "We can't send customer data to OpenAI." We had to think about model serving.

TaskFlow's enterprise customers started asking about data privacy. Their support tickets contained confidential business information. Sending that to a third-party API — even OpenAI — was a non-starter for their compliance teams. We needed to run a model ourselves.

That opens a completely different set of questions: which model? In what format? On what hardware? With what serving engine? How do we handle 100 concurrent users?

This module covers those decisions.

## Pages in this module

1. [Model Serving — Cloud vs Local vs Self-Hosted](./01-model-serving-overview) — the three options and when to choose each
2. [GGUF & Local LLMs — Running Models on Your Machine](./02-gguf-and-local-llms) — file formats, Ollama, llama.cpp
3. [vLLM — High-Throughput Model Serving](./03-vllm) — production inference for multiple users
4. [KV Cache — Why Inference Is Expensive (and How to Cheat)](./04-kv-cache) — prompt caching, cost reduction
5. [Quantization — Making Models Smaller Without Breaking Them](./05-quantization) — FP16, INT8, INT4
6. [Summary](./summary) — 5 mental models to take forward
