---
title: The Agent Harness — The Runtime Around Your Agent
outline: deep
---

# The Agent Harness — The Runtime Around Your Agent

The LLM is the brain. But the brain needs a body — something to run the loop, manage tools, handle errors, enforce limits. That's the harness.

::: tip Plain English
Think of a pilot and an airplane. The pilot decides where to go — but the airplane provides everything around that decision: engines, instruments, fuel management, communication systems, autopilot, emergency systems.

The LLM is the pilot. The harness is the airplane.

Without a harness, you have a smart thing with no way to act on the world, no way to handle errors, no way to enforce limits, and no way to know what happened. A raw LLM is a function call. A harness turns it into a system.
:::

## What a harness does

**Running the agent loop**
The harness calls the LLM, checks if the response is a tool call or a final answer, routes accordingly, and loops until done or until a limit is hit.

**Tool execution**
When the model requests a tool, the harness maps the tool name to your actual function, validates the arguments, calls the function, handles errors, and returns the result as a message.

**State management**
The harness maintains the conversation history. It adds new messages (user, assistant, tool results) in the right order and in the right format for the model.

**Retries and timeouts**
LLM calls can fail. Tool calls can time out. The harness handles transient errors with backoff, and enforces per-call timeouts so nothing hangs indefinitely.

**Token and cost tracking**
Each call costs money. The harness tracks cumulative token usage per run, flags expensive runs, and can halt if a cost budget is exceeded.

**Guardrails**
Before sending a message to the user, the harness can check it against output guardrails — topic filters, PII detection, hallucination checks. (Covered in Module 5.)

**Human-in-the-loop triggers**
Some actions require human approval. The harness is the right place to intercept them — check if an action needs review, pause the loop, send a notification, resume when approved.

**Tracing**
Every LLM call, every tool call, every input and output gets logged with timestamps and metadata. This is how you debug agents in production.

## LangGraph vs rolling your own

Most teams hit this question early: should we use LangGraph (or LangChain, CrewAI, AutoGen) or write our own harness?

| | LangGraph / frameworks | Custom harness |
|---|---|---|
| Time to first working agent | Fast | Slower |
| Flexibility | Limited — you work within the framework's model | Full — you control everything |
| Debugging | Harder — abstraction layers obscure errors | Easier — it's your code |
| Observability | Built-in (LangSmith) | You build it |
| Upgrade path | Depends on framework versioning | Yours to manage |
| Production stability | Framework bugs can block you | Your bugs |

For TaskFlow, we started with LangGraph because it was fast to prototype. We hit its edges within 6 weeks — the memory model didn't match ours, and we needed control over the exact tool execution order that LangGraph abstracted away. We rewrote the harness in about 400 lines of code.

::: tip When to use a framework
Prototyping, evaluating whether an agent-based approach works at all, and teams without time to build infrastructure. LangGraph's graph-based state machine model is genuinely useful for complex branching agent flows.
:::

::: tip When to roll your own
You need precise control over the loop, your state model is custom, you're hitting framework limitations, or you want to minimize dependencies in a production system.
:::

## The core of a minimal custom harness

```python
# Pseudocode — not production code
def run_agent(user_message, tools, max_turns=10):
    messages = [system_prompt, user_message]

    for turn in range(max_turns):
        response = llm.call(messages, tools=tools)

        if response.is_final_answer:
            return response.content

        if response.is_tool_call:
            tool_name = response.tool_call.name
            args = response.tool_call.arguments

            result = execute_tool(tool_name, args)  # your code

            messages.append(response)                 # assistant's tool request
            messages.append(tool_result(result))     # tool response

    return "I wasn't able to complete this in time. Escalating..."
```

This is genuinely close to what most production harnesses look like at their core. The extra 350 lines are error handling, logging, cost tracking, and guardrails.

::: details Interview Question — What LangGraph doesn't give you
**Q:** LangGraph gives you orchestration — what does it NOT give you automatically?

**A:** Several things you still have to build: (1) **Observability** — LangGraph integrates with LangSmith, but you still have to set up structured logging, cost tracking, and your own alerting. (2) **Production guardrails** — LangGraph runs tools; it doesn't check if the agent's responses are on-topic or safe. (3) **Memory that matches your schema** — LangGraph has its own state model; if your memory needs are different, you're adapting around it. (4) **Cost controls** — no built-in per-run budget enforcement. (5) **Human-in-the-loop flows** — LangGraph supports interrupts, but the approval flow, notification, and resume logic is yours to build. (6) **Custom retry logic** — the default retry behavior may not match your SLA requirements. The framework handles the plumbing; you still own the production concerns.
:::
