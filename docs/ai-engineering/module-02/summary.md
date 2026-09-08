---
title: Module 2 Summary — Agents
outline: deep
---

# Module 2 Summary

Six things to remember from this module as we continue building TaskFlow's agent.

## Mental Models

**1. An agent is a loop, not a call.** A single LLM call produces text. An agent loops: think, act, observe, repeat. The harness runs that loop; the model drives it. Understanding this distinction is the foundation of everything else in agent engineering.

**2. Tools are structured JSON output — your code does the actual work.** The model never calls your API. It produces a structured request; you call the API and bring back the result. The model is the decider; your harness is the executor. This distinction matters for security, for error handling, and for designing what tools should and shouldn't do.

**3. There are four kinds of memory and you usually need more than one.** In-context for short sessions. External storage for persistence. Episodic for past conversation history. Semantic for structured facts about users and entities. Pick the right type for the right problem.

**4. Planning (ReAct, CoT) helps with complex tasks but adds cost and latency.** Don't add it uniformly. Classify first — is this a simple or complex request? — and only invoke the planning loop for requests that actually need it.

**5. The harness is where production concerns live.** Max turns, timeouts, retries, cost tracking, guardrails, tracing — none of this comes from the model. You build it (or use a framework that provides it). Choosing between LangGraph and a custom harness is a real engineering decision; start with frameworks, know when to graduate off them.

**6. Multi-agent adds complexity — justify it.** Split agents when a single agent demonstrably fails due to domain overload or context limits. Not before. The orchestrator + workers pattern is far easier to debug than peer-to-peer mesh.

## What's next

Module 3 asks a harder question: what if we can't send TaskFlow's customer data to OpenAI at all? That takes us into model serving — cloud APIs, self-hosted inference, and the tradeoffs between them.
