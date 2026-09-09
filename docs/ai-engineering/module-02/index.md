---
title: Module 2 — Agents
outline: deep
---

# Module 2 — Agents

Now we understand the model. Time to give it agency — let it take actions, remember things, make plans.

TaskFlow's agent has been answering questions from its training data. That's limited: it doesn't know about actual TaskFlow tickets, account states, or user history. To fix that, we need to give it tools. And once it has tools, we need it to know how to decide when to use them, how to remember context across turns, and how to handle complex multi-step problems.

That turns a simple chatbot into an agent.

## Pages in this module

1. [The Agent Loop — How an Agent Actually Runs](./01-agent-loop) — the Think → Act → Observe cycle
2. [Tools — Giving the Agent Hands](./02-tools-and-tool-calling) — function calling, tool design
3. [Agent Memory — Making It Remember](./03-agent-memory) — four types of memory
4. [Planning & Reflection — Thinking Before Acting](./04-planning-and-reflection) — ReAct, chain-of-thought
5. [The Agent Harness — The Runtime Around Your Agent](./05-agent-harness) — what manages the loop
6. [Multi-Agent Systems — When One Agent Isn't Enough](./06-multi-agent) — orchestrators and specialists
7. [MCP — Model Context Protocol](./07-mcp) — a standard for tool connectivity
8. [A2A — Agent-to-Agent Protocol](./08-a2a) — how agents talk to other agents
9. [Summary](./summary) — 6 mental models to take forward
