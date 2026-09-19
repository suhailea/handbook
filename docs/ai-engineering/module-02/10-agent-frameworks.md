# Agent Framework Landscape — Choosing (or Skipping) a Framework

🔥🔥🔥 Interview weight | Prerequisites: [2.1 The Agent Loop](./01-agent-loop), [2.5 The Agent Harness](./05-agent-harness), [2.9 Durable Agents](./09-durable-agents)

::: info Plain English
An agent is a loop: call the model, run the tools it asks for, feed results back, repeat. You can write that loop in about 50 lines.

So why do frameworks exist? Because production agents need much more than the loop: state that survives crashes, human approvals, memory, streaming to a UI, tracing, multi-agent handoffs, and context management when conversations get long.

Frameworks package those pieces. The trade-off is that you adopt their abstractions, and when something goes wrong you're debugging their code as well as yours.

The interview question is rarely "which framework is best?" It's "**why did you choose this one, and what would make you switch?**"
:::

::: warning Fast-moving area
Frameworks in this space change quickly: APIs get renamed, features move between products, and projects merge. Treat this page as a map of the **categories and trade-offs**, and check each project's current docs before committing.
:::

## The Three Layers

It helps to sort tools by how much they decide for you:

| Layer | What you get | Examples |
| --- | --- | --- |
| **1. Model SDK / thin toolkit** | Tool calling, streaming, structured output, multi-provider | Vercel AI SDK, provider SDKs (OpenAI, Anthropic) |
| **2. Agent framework** | Agent abstraction, workflows/graphs, memory, handoffs, tracing | LangGraph, OpenAI Agents SDK, Mastra, Google ADK, CrewAI, Pydantic AI, Microsoft Agent Framework |
| **3. Agent harness** | A complete, opinionated agent: built-in tools, context compaction, subagents, permissions | Claude Agent SDK |

Higher layers give you more out of the box and less control. Pick the lowest layer that covers your hard problems.

## The Main Options

### LangGraph (Python, JS/TS)
- **Model:** you define a graph of nodes (functions) and edges (including conditional ones) over a shared, typed state.
- **Strengths:** explicit control flow; built-in checkpointers (resume, time-travel debugging); first-class human-in-the-loop via interrupts; model-agnostic; mature ecosystem with LangSmith for tracing and evals.
- **Weaknesses:** more boilerplate; graph abstractions can feel heavy for simple agents; the JS version historically trailed Python.
- **Choose when:** you need precise control over a complex, stateful workflow with approvals and branching.

### OpenAI Agents SDK (Python, TS)
- **Model:** lightweight primitives: agents with instructions and tools, **handoffs** between agents, **guardrails**, sessions, built-in tracing.
- **Strengths:** small API surface, quick to learn, clean multi-agent handoff pattern.
- **Weaknesses:** best experience with OpenAI models; less explicit control over complex flows than a graph.
- **Choose when:** you're on OpenAI models and want multi-agent handoffs without a heavy framework.

### Claude Agent SDK (Python, TS)
- **Model:** the harness behind Claude Code, as a library. You get an agent that already knows how to use files, a shell, web tools and MCP servers, with subagents, hooks, permission controls and automatic context compaction.
- **Strengths:** extremely capable out of the box for long-running, tool-heavy tasks (coding, research, document work); context management is handled for you.
- **Weaknesses:** Claude models only (available via Anthropic's API and major clouds); opinionated harness, less suited to tightly scripted business workflows.
- **Choose when:** the agent needs to work autonomously over many steps with files, code or a computer-like environment.

### Vercel AI SDK (TS)
- **Model:** provider-agnostic toolkit: `generateText` / `streamText` with tools and multi-step tool loops, structured outputs, and UI hooks for streaming chat in React, Vue and Svelte.
- **Strengths:** best-in-class streaming UI integration; swap providers with one line; minimal abstraction.
- **Weaknesses:** it's a toolkit, not a full agent platform; durability, memory and HITL are yours to build.
- **Choose when:** you're a TS/Next.js team building agent features into a product UI.

### Mastra (TS)
- **Model:** TypeScript agent framework built on the AI SDK: agents, graph-style workflows with suspend/resume, memory, RAG, evals and observability.
- **Strengths:** the most complete TS-native option; feels natural for Node/Next.js teams.
- **Weaknesses:** younger ecosystem than LangGraph; smaller community.
- **Choose when:** you want LangGraph-level features but your stack is TypeScript end to end.

### Others worth recognising

| Framework | Language | Notes |
| --- | --- | --- |
| **Google ADK** | Python (+ others) | Multi-agent toolkit, optimised for Gemini and Vertex AI deployment, but model-agnostic |
| **CrewAI** | Python | Role-based "crews" of agents plus event-driven Flows; fast to prototype |
| **Pydantic AI** | Python | Type-safe agents with Pydantic validation; good for Python backend teams |
| **Microsoft Agent Framework** | .NET, Python | Successor to AutoGen and Semantic Kernel; natural fit for Azure/.NET enterprises |

## Comparison Table

| | LangGraph | OpenAI Agents SDK | Claude Agent SDK | Vercel AI SDK | Mastra |
| --- | --- | --- | --- | --- | --- |
| Language | Py, TS | Py, TS | Py, TS | TS | TS |
| Model-agnostic | ✅ | Partly (adapters) | ❌ Claude only | ✅ | ✅ |
| Explicit control flow | ✅ Graph | Medium | Low (autonomous) | You write it | ✅ Workflows |
| Durable state / resume | ✅ Checkpointers | Sessions | Sessions | DIY | ✅ Suspend/resume |
| Human-in-the-loop | ✅ Interrupts | Via tools/guardrails | Hooks/permissions | DIY | ✅ |
| Built-in tools | Few | Hosted tools (OpenAI) | ✅ Many (files, shell, web) | None | Few |
| Streaming UI | Medium | Medium | Medium | ✅ Best | ✅ (via AI SDK) |
| Learning curve | Steep | Gentle | Gentle | Gentle | Medium |

## When to Use No Framework

A plain loop with a model SDK is often the right answer:

- One agent, fewer than ~10 tools, short runs.
- You need exact control over prompts and context.
- You're already running a job system (queue + DB) that gives you retries and state.

Many strong production teams write their own thin harness, because the loop is simple and the hard parts (tools, evals, context) are domain-specific anyway.

## Keep Your Domain Code Framework-Free

Whatever you choose, isolate your tools and business logic from the framework. Then switching frameworks becomes an adapter change, not a rewrite.

```typescript
// tools/refund.ts — pure domain code, no framework imports
import { z } from 'zod'

export const issueRefundSchema = z.object({
  customerId: z.string(),
  amount: z.number().positive(),
  reason: z.enum(['duplicate_charge', 'service_issue', 'goodwill']),
})

export async function issueRefund(input: z.infer<typeof issueRefundSchema>, ctx: { idempotencyKey: string }) {
  // Validation, business rules, payment API call...
  return { refundId: 'rf_123', status: 'pending' as const }
}

export const refundTool = {
  name: 'issue_refund',
  description: 'Refund a customer. Use only after verifying the charge exists.',
  schema: issueRefundSchema,
  execute: issueRefund,
}
```

```typescript
// adapters/ — one small file per framework
// Each adapter maps { name, description, schema, execute } to the framework's tool format.
// Evals, tests and business rules all target the domain layer, not the framework.
```

The same applies to prompts (keep them in versioned files), evals (run against your domain interface), and tracing (OpenTelemetry where possible, so the backend isn't locked in).

## How to Answer "Why This Framework?" in Interviews

Structure the answer around your constraints, not the framework's features:

1. **Language and stack:** "We're TypeScript end to end, so Python-first frameworks added a second runtime."
2. **Control needs:** "Payments require a fixed, auditable sequence, so we needed explicit control flow, not an autonomous agent."
3. **Durability and HITL:** "Refunds over a threshold wait for approval, sometimes for a day, so we needed checkpointing and interrupts."
4. **Model strategy:** "We route between two providers, so we needed model-agnostic tooling."
5. **Exit plan:** "Tools and evals are framework-independent, so migrating would take about a week."

::: danger Where It Bites
**Framework-first design:** A team picks a multi-agent framework, then designs five agents to use it. A single agent with good tools would have been cheaper, faster and easier to debug. Fix: start with the simplest architecture (see 8.1) and adopt a framework only for problems you actually have.

**Hidden prompts:** The framework adds its own system prompt text, or rewrites tool descriptions. Behaviour changes after a minor version bump. Fix: inspect the exact request sent to the model via tracing; pin framework versions; run evals before upgrading.

**Debugging through abstractions:** An agent loops forever, and the stack trace is 40 frames of framework internals. Fix: tracing that shows each model call and tool call; keep a way to reproduce a single step outside the framework.

**Lock-in via tools:** Tools are written as framework decorators with framework-specific context objects. Migrating means rewriting all of them. Fix: framework-free domain tools plus thin adapters.
:::

## Interview Questions

::: details Q1 — LangGraph or a plain loop for a customer support agent?
Depends on the flows. If the agent answers questions and performs a few low-risk actions, a plain loop with a model SDK, tracing and idempotent tools is simpler and easier to debug. If it has multi-step processes with branching, approval gates that can wait for hours, and needs resume after failure, LangGraph's checkpointing and interrupts save you from building that infrastructure yourself. I'd start simple and migrate when durability or HITL requirements appear, keeping tools framework-independent so the move is cheap.
:::

::: details Q2 — When would you choose an opinionated harness like the Claude Agent SDK over a workflow framework?
When the task is open-ended and long-horizon: the agent needs to explore, read files, run code, and decide its own steps, like coding, research, or data analysis. The harness already solves the hard generic problems (tool set, context compaction, subagents, permissions). For tightly scripted business processes with strict ordering and audit needs, a workflow framework with explicit control flow is a better fit.
:::

::: details Q3 — How do you avoid framework lock-in?
Keep domain logic (tools, business rules, prompts, evals) in framework-free modules with plain schemas; write thin adapters to the framework's tool and agent formats; use OpenTelemetry-compatible tracing; and pin framework versions with evals as the upgrade gate. Then a framework change mostly touches the adapter and orchestration layers.
:::

## Key Mental Models

- **Pick the lowest layer that solves your hard problems.** Toolkit → framework → harness, in order of control given up.
- **Frameworks solve infrastructure, not intelligence.** Tool design, context and evals are still your job.
- **Workflow frameworks for scripted processes; harnesses for open-ended work.**
- **Domain code stays framework-free.** Adapters make frameworks swappable.
- **Answer "why" with constraints.** Language, control, durability, model strategy, exit plan.

## Related

- [2.5 The Agent Harness](./05-agent-harness) — what a harness does under the hood
- [2.6 Multi-Agent Systems](./06-multi-agent) — when multiple agents are worth it
- [2.9 Durable Agents & Human-in-the-Loop](./09-durable-agents) — the problems many frameworks exist to solve
- [8.1 AI System Patterns](../module-08/01-ai-system-patterns) — choosing the simplest architecture first
