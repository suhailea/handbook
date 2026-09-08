---
title: Agent Observability — Seeing Inside the Black Box
outline: deep
---

# Agent Observability — Seeing Inside the Black Box

A user complained the agent gave wrong advice. We had no idea what happened — no logs, no traces. Never again.

::: tip Plain English
If your web API fails, you check the logs. You see the request, the error, the stack trace. You know exactly what happened.

Agents are harder. They make multiple LLM calls, call tools, make decisions, loop back. Without tracing, a complaint becomes an unsolvable mystery: "What did the agent actually say? What tools did it call? What did the model get as input? Why did it make that decision?"

Agent observability is the practice of making all of this visible — logging every step so you can replay exactly what happened, measure what's working, and catch problems before users do.
:::

## What to trace

For every agent run, you want to capture:

**Every LLM call:**
- Input messages (system prompt, conversation history, tool results)
- Output (the response or tool call)
- Model used
- Token count (input + output)
- Latency
- Cost

**Every tool call:**
- Tool name
- Input arguments
- Return value
- Latency
- Success or failure

**The run overall:**
- Total tokens used
- Total cost
- Total latency (wall clock)
- Number of loop iterations
- Final outcome (answered, escalated, failed)
- User ID, session ID, correlation ID

This is what a traced run looks like in practice:

```
Run ID: run_abc123
User: user_4821
Session: sess_xyz

Step 1 (LLM call)  — 450ms, 1,200 tokens
  Input: [system prompt, user message]
  Output: tool_call(lookup_ticket, {id: "4821"})

Step 2 (Tool call) — 85ms
  Tool: lookup_ticket
  Args: {id: "4821"}
  Result: {status: "open", priority: "high", assigned: null}

Step 3 (LLM call)  — 380ms, 1,400 tokens
  Input: [system prompt, user message, tool result]
  Output: "Your ticket is open and high priority..."

Total: 915ms, 2,600 tokens, $0.004
```

Without this trace, the complaint "the agent gave wrong advice" is a mystery. With it, you can see exactly what the model received and what it said.

## Tools for observability

**LangSmith** (from LangChain): If you're using LangChain or LangGraph, LangSmith integrates automatically. It provides a trace viewer, evaluation tools, and a dataset manager. Good first choice if you're in the LangChain ecosystem.

**LangFuse**: Open-source alternative to LangSmith. Supports any LLM framework, not just LangChain. Can be self-hosted (important for privacy-sensitive deployments). Growing ecosystem.

**Custom logging**: For full control, log your traces as structured JSON to your existing observability stack (Datadog, Grafana, CloudWatch). More setup, but integrates with your existing tooling and has no external data dependencies.

For TaskFlow's enterprise customers (who can't send data to third-party tools): we built a lightweight custom tracer that writes structured JSON to our logging infrastructure.

## Structured logs for agent runs

At minimum, emit structured log events at each step:

```json
{
  "event": "llm_call",
  "run_id": "run_abc123",
  "session_id": "sess_xyz",
  "user_id": "user_4821",
  "step": 1,
  "model": "gpt-4o",
  "input_tokens": 1200,
  "output_tokens": 45,
  "latency_ms": 450,
  "cost_usd": 0.002,
  "timestamp": "2026-09-08T14:23:01Z"
}
```

With structured logs, you can run queries: "Show me all runs for user_4821 in the last 7 days." "What's our average agent cost per request?" "Which runs took more than 5 seconds?"

## Cost tracking

Agents can be expensive. Without tracking, you won't know until the bill arrives.

Track per run:
- Input tokens × input price
- Output tokens × output price
- Tool API costs (if applicable)
- Aggregate to: per user, per session type, per day

Set alerts: if a single agent run costs more than $X, investigate. If daily costs jump 30%, something changed (higher volume, longer contexts, infinite loop bug).

For TaskFlow: our median agent run costs $0.003. We alert if any single run exceeds $0.05. This has caught two bugs where the agent looped excessively.

::: details Interview Question — Debugging in production
**Q:** How do you debug an agent that gave a wrong answer to a user in production?

**A:** With good observability: (1) Find the run by correlation ID or user/time. (2) Replay the trace — look at exactly what the model received as input for each LLM call. Often the problem is visible immediately: wrong tool result fed back in, stale cached data, missing context. (3) Check if the same input was given to the model that a human would give it — sometimes the issue is in how you assembled the context. (4) Look at the tool call inputs and outputs — did a tool return bad data? (5) If needed, re-run the same inputs through the model manually to see if it's a model reasoning failure or a data/context problem. Without a trace: you're guessing. You ask the user to reproduce it. You try similar inputs and hope you hit the same failure. It's much harder. Observability is not optional for production agents.
:::
