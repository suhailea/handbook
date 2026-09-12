---
title: Interview Answer Framework
outline: deep
---

# Interview Answer Framework

A structured, repeatable approach for AI system design questions — "design an AI support agent," "build a document-processing agent," "how would you architect an internal copilot." Most candidates lose these interviews not from lacking knowledge, but from lacking structure: they jump to "use an agent with RAG" before establishing what the system actually needs to do.

## The 10-Step Framework

### Step 1: Clarify Requirements

Before naming a single tool or model, ask:

- **Task shape:** Single-turn Q&A, multi-step agentic task, or a pipeline with a fixed sequence?
- **Data needs:** Does it need retrieval, real-time lookups, both, or neither?
- **Stakes:** What's the cost of a wrong answer? A hallucinated fact vs. an unauthorized refund are different risk classes.
- **Volume & latency:** Requests per day, and what latency is tolerable? This decides cloud-API vs. self-hosted before anything else does.
- **Autonomy:** Fully autonomous, or human-in-the-loop for some actions?

::: warning What the interviewer is really testing
Can you resist jumping straight to "build an agent"? Many of these tasks don't need one — a single well-prompted call, or a fixed pipeline, is simpler and more reliable when the task doesn't genuinely branch.
:::

### Step 2: Decide Single Call vs. Agent vs. Pipeline

- **Single call:** task is one-shot, no external data or actions needed
- **Fixed pipeline:** task has a known, unchanging sequence of steps
- **Agent loop:** task needs dynamic tool use where the right next step depends on what was just learned

Default to the simplest shape that fits; escalate only when the task genuinely requires it. See [2.1](/ai-engineering/module-02/01-agent-loop).

### Step 3: Design the Knowledge Layer

- Does the model need facts it wasn't trained on? → RAG, not fine-tuning
- Is the needed information a small, stable set? → put it directly in context
- Is it a known record (ticket ID, account)? → direct tool lookup, not retrieval
- Sketch what's out of scope explicitly — this is where interviewers probe

See [4.1](/ai-engineering/module-04/01-when-you-need-retrieval) and the [RAG track](/rag/) for the deep version.

### Step 4: Design the Tools

- List tools by name, purpose, and read/write classification
- For every write tool: what's the confirmation or approval path?
- State the schema for each tool's arguments — this is where "I'd just prompt it to output JSON" is a red flag; say schema-constrained output instead

::: warning What the interviewer is really testing
Do you separate reads from writes by default, or do you treat every tool the same? Production systems don't.
:::

### Step 5: Handle Failure

- What happens when a tool call fails? Retry, fallback, or fail the run?
- What's the max-turns limit, and what happens when it's hit?
- What's the fallback chain if the primary model is unavailable?

See [3.3](/ai-engineering/module-03/03-reliability-and-fallbacks).

### Step 6: Address Cost

- Rough cost per request, and how it scales with agent iterations
- Where would you route a cheaper model (classification, routing) vs. keep frontier quality (final user-facing generation)?
- What would trigger a budget alert or a per-run cap?

::: warning What the interviewer is really testing
Do you understand that agent cost is roughly quadratic in iterations, not linear in requests? This is the single most commonly missed point in cost discussions.
:::

### Step 7: Design Evaluation

- What does "working correctly" mean for this system, concretely?
- Golden dataset — what's in it, how is it maintained?
- Quality metric and outcome metric — name one of each, and explain why you need both

See [5.1](/ai-engineering/module-05/01-metrics) and [5.2](/ai-engineering/module-05/02-evaluation-pipeline).

### Step 8: Address Security

- What's the worst thing an adversarial user could get this system to do?
- Where are the guardrails — input, output, or both?
- What's enforced in the prompt vs. enforced in code? (High-stakes actions must be the latter.)

See [7.1](/ai-engineering/module-07/01-ai-security) and [7.2](/ai-engineering/module-07/02-agent-security).

### Step 9: Address Observability

- What gets logged per run, and what correlation IDs tie it together?
- How would you debug a specific bad response reported by a user?

See [6.1](/ai-engineering/module-06/01-production-metrics).

### Step 10: Discuss Trade-offs Explicitly

Close by naming what you deliberately didn't optimize for, and why — latency vs. cost, autonomy vs. safety, build vs. buy. Interviewers read this as seniority signal more reliably than any individual technical choice.

## A worked skeleton: "Design a support agent"

```text
1. Requirements   → multi-step, moderate stakes (refunds involved), 10k req/day
2. Shape          → agent loop (branches on ticket type)
3. Knowledge      → RAG over policy docs; direct tool lookup for account/ticket data
4. Tools          → lookup_ticket (read), search_policy (read), issue_refund (write, gated)
5. Failure        → 3 retries w/ backoff on 429/5xx, fallback to secondary model, max 12 turns
6. Cost           → route classification to small model; cap tokens/run; alert above 15x median
7. Evaluation     → golden set of 200 real tickets; outcome metric = first-contact resolution
8. Security       → refund tool requires confirmation step; output PII filter; prompt injection defenses
9. Observability  → full trace per run, tenant + feature tagged, alert on cost/latency p99
10. Trade-offs    → chose cloud API over self-hosting (data residency not required, volume too low
                     to justify ops burden); chose single orchestrator over multi-agent (domains don't
                     genuinely conflict at this scale)
```

## Common failure patterns to avoid

- **Jumping to "agent + RAG" before establishing the task needs either.** Simpler shapes are often right.
- **No mention of cost until asked.** Bring it up unprompted at step 6 — it signals production experience.
- **Guardrails as an afterthought.** Mention security while designing tools, not as a bolt-on at the end.
- **No explicit evaluation plan.** "We'd monitor it" is not an evaluation strategy — name a metric and a dataset.
- **Silence on trade-offs.** Every design has one. Naming it is the signal; pretending there isn't one is the red flag.
