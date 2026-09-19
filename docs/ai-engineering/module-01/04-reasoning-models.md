# Reasoning Models & Test-Time Compute

🔥🔥 Interview weight | Prerequisites: [0.2 Training vs Inference](../module-00/02-training-vs-inference), [1.1 LLMs & Tokens](./01-llms-and-tokens), [1.2 Prompt Engineering](./02-prompt-engineering)

::: info Plain English
A standard LLM starts writing its answer immediately. A **reasoning model** first "thinks": it generates a long internal chain of reasoning, checks its own work, tries alternatives, and only then answers.

The key idea is **test-time compute**: instead of only making models smarter by training them bigger, you let them spend more computation *while answering*. More thinking tokens usually means better answers on hard problems, like maths, complex code, multi-step planning and tricky analysis.

The catch: thinking tokens cost money and time. A question that a standard model answers in 1 second for a fraction of a cent might take a reasoning model 30 seconds and 20× the tokens.

As an engineer, your job is deciding **when thinking is worth paying for**, and how much.
:::

## How Reasoning Models Differ

| | Standard model | Reasoning model |
| --- | --- | --- |
| How it answers | Answers directly | Generates reasoning tokens first, then answers |
| Trained with | Pretraining + instruction tuning + preference tuning | The same, plus reinforcement learning on verifiable tasks (maths, code) that rewards correct final answers |
| Latency | Low (fast first token) | Higher, sometimes much higher |
| Cost | Output tokens only | Output tokens **plus** reasoning tokens (billed as output) |
| Strength | Speed, style, simple extraction, chat | Multi-step logic, planning, code, analysis, ambiguous tasks |

Most major providers now offer this, either as separate reasoning models or as **hybrid models** where you switch thinking on or off per request.

## The Control Knobs

Providers expose reasoning through parameters like:

- **Reasoning effort** (e.g. low / medium / high): the model decides how much to think within that band.
- **Thinking budget** (a token cap): the maximum number of reasoning tokens allowed.
- **Thinking on/off**: for hybrid models.

Exact parameter names differ by provider and change over time, so keep them behind your own abstraction:

```typescript
// model-config.ts
export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high'

export interface ModelCall {
  tier: 'fast' | 'reasoning'
  reasoning: ReasoningLevel
  maxOutputTokens: number
}

// Map your abstraction to provider-specific params in ONE place
export function toProviderParams(call: ModelCall) {
  // e.g. reasoning effort for one provider, a thinking token budget for another
  // Keep model IDs in env/config, never hard-coded in business logic
  return {
    model: call.tier === 'fast' ? process.env.FAST_MODEL! : process.env.REASONING_MODEL!,
    // ...provider-specific reasoning params derived from call.reasoning
  }
}
```

## When to Use Reasoning (and When Not To)

| Use reasoning | Skip reasoning |
| --- | --- |
| Multi-step planning (agent deciding a strategy) | Classification, routing, extraction |
| Complex code generation, debugging, refactoring | Rewriting, summarising, translating |
| Maths, finance calculations, logic puzzles | Simple RAG Q&A over retrieved text |
| Analysing contracts or policies against rules | Chit-chat, tone-sensitive replies |
| Ambiguous tasks needing self-checking | Anything with a tight latency budget (voice, autocomplete) |

**Rule of thumb:** if a smart human would answer instantly, skip reasoning. If they'd grab a notepad, use it.

For money and dates, reasoning helps but isn't enough. Deterministic calculations belong in tools (see [12.4 HR/Payroll Agent](../module-12/04-hr-payroll-agent)).

## Routing: Pay for Thinking Only Where It Helps

A common production pattern: a fast model handles most requests, and hard ones escalate to reasoning.

```typescript
// router.ts
interface RouteDecision { tier: 'fast' | 'reasoning'; reasoning: ReasoningLevel }

export function routeRequest(task: { type: string; inputTokens: number; failedOnce?: boolean }): RouteDecision {
  if (task.failedOnce) return { tier: 'reasoning', reasoning: 'high' }       // Escalate after failure
  switch (task.type) {
    case 'classify':
    case 'extract':
    case 'summarize':
      return { tier: 'fast', reasoning: 'none' }
    case 'plan':
    case 'code':
    case 'policy_check':
      return { tier: 'reasoning', reasoning: task.inputTokens > 20_000 ? 'high' : 'medium' }
    default:
      return { tier: 'fast', reasoning: 'low' }
  }
}
```

In agents, a useful split is: **reasoning model as planner/orchestrator, fast model as worker** for sub-tasks like summarising search results.

## Prompting Reasoning Models

What changes compared to standard models:

- **Don't say "think step by step".** They already do; it adds nothing and can interfere.
- **State the goal, constraints and success criteria clearly**, and let the model work out the approach. Over-prescribing steps can make results worse.
- **Few-shot examples matter less** and can over-constrain the reasoning. Try zero-shot first.
- **Ask for the output format explicitly.** The reasoning is separate; the final answer should be concise and structured.

## Reasoning Inside Agent Loops

Reasoning models are strong at agentic tasks: many can think between tool calls (**interleaved thinking**), reflecting on each tool result before choosing the next action.

Two engineering details matter:

1. **Preserve reasoning across turns as the provider requires.** Some APIs require you to pass back reasoning or thinking blocks (sometimes encrypted or signed) with tool results in multi-turn tool use. Dropping them can cause errors or degrade quality. Check your provider's docs.
2. **Budget per run, not per call.** A 20-step agent with high reasoning effort can burn a large number of tokens. Track cumulative reasoning tokens per run, and set a run-level cap.

## Measuring the Trade-off

Don't guess the right effort level. Measure it on your eval set:

| Effort | Accuracy | p50 latency | Cost / 1k tasks |
| --- | --- | --- | --- |
| none | 71% | 1.2s | $2 |
| low | 83% | 4s | $6 |
| medium | 89% | 11s | $15 |
| high | 90% | 28s | $38 |

*(Illustrative numbers.)* The jump from medium to high buys 1 point of accuracy for 2.5× cost and latency. That's rarely worth it, except for high-stakes tasks. Plot this curve for each task type.

::: danger Where It Bites
**Reasoning everywhere:** A team switches every call to a reasoning model "for quality". Costs rise 8×, p95 latency hits 40s, and user satisfaction drops because the chat feels slow. Fix: route by task type; reasoning only where evals show it pays.

**Invisible token spend:** Dashboards track output tokens but not reasoning tokens (or they're reported in a separate field). The bill doesn't match the dashboard. Fix: log reasoning tokens explicitly per call and per run.

**Timeouts:** An HTTP gateway with a 30s timeout kills high-effort requests. Fix: stream responses, raise timeouts for reasoning routes, or run long reasoning jobs asynchronously.

**Over-prescriptive prompts:** A carefully tuned 12-step prompt from a standard model performs worse on a reasoning model. Fix: re-evaluate prompts when switching model families; simplify to goals and constraints.

**Trusting the reasoning as an explanation:** The visible reasoning (or its summary) may not faithfully reflect how the model reached its answer. Fix: don't use it as an audit trail for compliance; log tool calls and inputs instead.
:::

## Interview Questions

::: details Q1 — What is test-time compute, and why does it matter?
It's spending more computation at inference time (more reasoning tokens, or multiple attempts plus verification) to get better answers, rather than relying only on a bigger trained model. It matters because it gives engineers a per-request quality dial: you can pay for more thinking on hard problems and less on easy ones, which makes routing and effort selection a core cost/quality lever.
:::

::: details Q2 — Your agent uses a reasoning model for every step and costs are too high. What do you do?
Profile the steps by type. Keep reasoning for planning and hard decisions; move classification, extraction, summarisation of tool results and formatting to a fast model. Lower effort where evals show no quality drop, cap reasoning tokens per run, and add escalation (retry with higher effort only on failure or low confidence). Validate every change against the eval set.
:::

::: details Q3 — How does prompting change for reasoning models?
Less instruction on *how* to think, more clarity on *what* success looks like. Drop chain-of-thought instructions, simplify step-by-step procedures into goals and constraints, try zero-shot before few-shot, and explicitly specify the final output format. Then re-run evals, because prompts tuned for standard models often don't transfer.
:::

## Key Mental Models

- **Thinking is a paid feature, not a default.** Buy it where evals show it helps.
- **Route by task type.** Fast model for simple work, reasoning for planning and hard analysis.
- **Measure the effort curve.** Accuracy often plateaus well before maximum effort.
- **Budget per run.** Agent loops multiply reasoning costs.
- **Goals over procedures.** Tell reasoning models what, not how.

## Related

- [1.3 Context Engineering](./03-context-engineering) — reasoning tokens also compete for context
- [3.4 Cost & Token Accounting](../module-03/04-cost-and-token-accounting) — tracking reasoning token spend
- [2.4 Planning & Reflection](../module-02/04-planning-and-reflection) — explicit planning vs built-in reasoning
