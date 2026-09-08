---
title: Multi-Agent Systems — When One Agent Isn't Enough
outline: deep
---

# Multi-Agent Systems — When One Agent Isn't Enough

TaskFlow's agent was trying to handle billing questions, technical bugs, and account management all at once. It was mediocre at everything. We split it into three specialists.

::: tip Plain English
Imagine a customer service department where every rep handles billing, technical support, and account management. They're all generalists. Each one knows a little about everything and does a mediocre job at all of it.

Now split them into specialists. Billing reps know billing cold. Technical reps know the product inside out. Account managers know the commercial side. You also add a receptionist who hears what the customer needs and routes them to the right person.

That's multi-agent. Instead of one agent trying to do everything, you have specialists — and an orchestrator that decides who handles what.
:::

## Why one agent isn't always enough

**Specialization:** A billing agent can have a detailed, highly-tuned system prompt with billing rules, refund policies, and payment edge cases. You can't put all of that, plus technical troubleshooting depth, plus account management workflows, into one prompt without it getting diluted.

**Token limits:** Complex workflows hit context window limits. One agent trying to do a 30-step troubleshooting flow will run out of context. Multiple specialized agents each handle a focused slice.

**Parallelism:** Some tasks can run concurrently. While the billing agent looks up payment history, the technical agent can simultaneously check the system status page. One agent can't do two things at once.

**Isolation:** A bug in the billing agent doesn't take down technical support. Specialists fail independently.

## Patterns

### Orchestrator + workers

The most common pattern. One agent — the orchestrator — reads the user's message, decides which specialist to route to, and hands off. The specialist handles the work and returns a result to the orchestrator, which synthesizes the response.

```
User: "I'm being charged twice and my exports stopped working."

Orchestrator: This has both a billing issue and a technical issue.
              Route the billing part → Billing Agent
              Route the technical part → Technical Agent
              Synthesize both responses → Reply to user
```

**Pros:** Clean routing, specialists stay focused, easy to add new specialists.

**Cons:** The orchestrator needs to understand enough about each domain to route correctly. Wrong routing = user bounced to the wrong specialist.

### Peer-to-peer (agent mesh)

Agents can call each other directly without a central orchestrator. The billing agent, if it realizes it's actually a technical issue, hands off to the technical agent.

**Pros:** More flexible. No single point of failure at the orchestrator.

**Cons:** Much harder to debug. Tracing a request through multiple agents that talk to each other is a nightmare. Avoid this unless you genuinely need it.

## When NOT to do multi-agent

::: warning Watch out
Multi-agent systems add significant complexity: more LLM calls, more failure points, harder debugging, harder tracing, more cost. Before splitting into multiple agents, ask:

1. Is the single agent actually failing? Or are we just assuming it needs to be split?
2. Would a better system prompt and better tools solve the problem?
3. Do we have the observability to debug a multi-agent system?

For TaskFlow's initial launch, we ran a single agent. We only split when we had clear evidence of quality problems that were caused by the agent trying to do too much.
:::

## Pros and cons table

| | Single agent | Multi-agent |
|---|---|---|
| Complexity | Low | High |
| Debugging | Straightforward | Harder (need tracing across agents) |
| Cost | Lower | Higher (more LLM calls) |
| Specialization quality | Limited | High |
| Parallelism | No | Yes |
| Failure isolation | No | Yes |
| Good for | Most use cases | Complex workflows, clear domain split |

## Routing strategies

The orchestrator needs to classify incoming messages:

1. **Keyword/rule-based routing:** Fast and cheap. Works when domains are clearly distinct ("charge", "invoice" → billing; "bug", "error", "not working" → technical).

2. **Small LLM classifier:** Use a fast, cheap model to classify intent. More accurate than keywords, still fast.

3. **Embedding similarity:** Embed the message and find which domain's training examples it's closest to. Good when you have labeled historical data.

For TaskFlow we use a small LLM classifier. One API call to a cheap, fast model before routing to the specialist. Total overhead: ~50ms and 0.1 cents.

::: details Interview Question — Orchestrator vs peer-to-peer
**Q:** Compare orchestrator-worker and peer-to-peer patterns for multi-agent systems. When would you choose each?

**A:** Orchestrator-worker has a central coordinator that decomposes tasks and routes to specialists. It's predictable, easy to trace (one place where routing decisions are made), and easy to extend (add a new worker without changing other workers). The downside is the orchestrator becomes a bottleneck and a single point of failure. Peer-to-peer lets agents call each other directly — more resilient, more flexible, enables emergent behaviors. The downsides are substantial: request tracing requires distributed correlation IDs, circular dependencies can cause loops, and debugging is dramatically harder. Choose orchestrator-worker for 90% of use cases. Choose peer-to-peer only when you have mature observability, the use case genuinely benefits from the flexibility, and you have the engineering bandwidth to debug a distributed agent mesh.
:::
