# Agent Trajectory Evaluation — Tools, Steps & Final State

🔥🔥🔥 Interview weight | Prerequisites: [5.2 Evaluation Pipeline](./02-evaluation-pipeline), [2.1 The Agent Loop](../module-02/01-agent-loop), [2.2 Tools & Tool Calling](../module-02/02-tools-and-tool-calling)

::: info Plain English
The evaluation pipeline in 5.2 grades the **final answer**. For a chatbot, that's enough. For an agent, it isn't.

An agent can reach the right answer the wrong way. It might call the refund tool twice, look up the wrong customer and get lucky, or take 14 steps for a 3-step task. It can also give a perfect-sounding reply while the database is left in the wrong state.

**Trajectory evaluation** grades the *path*, not just the destination. Did the agent pick the right tools, pass the right arguments, do things in a sensible order, and leave the world in the correct state?

Think of it like grading a maths exam. The final answer matters, but a teacher also checks the working, because correct working is what makes the answer repeatable.
:::

## The Four Layers of Agent Evaluation

| Layer | Question | How to check | Cost |
| --- | --- | --- | --- |
| **1. Final state** | Is the world correct afterwards? (DB rows, tickets, emails sent) | Deterministic assertions on the environment | Cheap |
| **2. Tool calls** | Right tools, right arguments? | Compare against expected calls | Cheap |
| **3. Trajectory** | Sensible order, no loops, efficient? | Match rules + step budgets | Cheap |
| **4. Final response** | Is the reply correct, grounded, well-toned? | LLM-as-judge (see 5.2) | Expensive |

**Final state is the strongest signal.** Benchmarks like τ-bench grade agents mainly by comparing the database state after a conversation to the expected state. It's hard to fake, and it's what the business actually cares about.

## Recording the Trajectory

You can't evaluate what you didn't record. Every agent run should produce a structured trace:

```typescript
// trajectory.ts
export interface ToolCallRecord {
  name: string
  args: Record<string, unknown>
  result: unknown
  error?: string
  latencyMs: number
}

export interface Trajectory {
  runId: string
  input: string
  toolCalls: ToolCallRecord[]
  finalResponse: string
  totalTokens: number
  totalCostUsd: number
  steps: number          // LLM turns in the loop
  terminatedBy: 'final_answer' | 'max_steps' | 'error' | 'human_handoff'
}
```

In production this usually comes from your tracing tool (Langfuse, LangSmith, OpenTelemetry spans). In eval runs, wrap your tool executor so every call gets appended to the trajectory.

## Defining the Expected Trajectory

A golden example for an agent includes the expected tools, the expected final state, and constraints. It usually does **not** include the exact wording of the reply.

```typescript
// golden-agent-examples.ts
import type { FakeDb } from './fake-db' // your in-memory test environment

export type MatchMode = 'exact' | 'in_order' | 'any_order' | 'subset'

export interface ExpectedToolCall {
  name: string
  // Only assert args that matter. Partial match: extra args are allowed.
  args?: Record<string, unknown>
}

export interface AgentGoldenExample {
  id: string
  input: string
  expectedTools: ExpectedToolCall[]
  matchMode: MatchMode
  forbiddenTools?: string[]            // e.g. 'issue_refund' for a non-refundable case
  maxSteps: number                     // efficiency budget
  expectedState?: (db: FakeDb) => boolean
  expectedOutcome: 'resolved' | 'escalated' | 'refused'
}

export const goldenExamples: AgentGoldenExample[] = [
  {
    id: 'refund_duplicate_charge_001',
    input: 'I was charged twice for March. Account email: sara@example.com',
    expectedTools: [
      { name: 'lookup_account', args: { email: 'sara@example.com' } },
      { name: 'list_charges' },
      { name: 'issue_refund', args: { reason: 'duplicate_charge' } },
    ],
    matchMode: 'in_order',
    maxSteps: 6,
    expectedState: (db) => db.refunds.filter(r => r.email === 'sara@example.com').length === 1,
    expectedOutcome: 'resolved',
  },
  {
    id: 'refund_outside_window_002',
    input: 'Refund my subscription from last year please',
    expectedTools: [{ name: 'lookup_account' }],
    matchMode: 'subset',
    forbiddenTools: ['issue_refund'],
    maxSteps: 5,
    expectedOutcome: 'escalated',
  },
]
```

### Choosing a match mode

| Mode | Passes when | Use for |
| --- | --- | --- |
| `exact` | Same tools, same order, nothing extra | Strict, regulated flows (payments) |
| `in_order` | Expected tools appear in order; extra calls allowed | Most workflows |
| `any_order` | All expected tools appear, any order | Parallel lookups |
| `subset` | Expected tools appear at least once | Exploratory or research agents |

Start with `in_order`. Use `exact` only when an extra call is itself a bug, because `exact` makes tests brittle against harmless changes (like an extra read-only lookup).

## The Trajectory Scorer

```typescript
// score-trajectory.ts
import type { Trajectory } from './trajectory'
import type { AgentGoldenExample, ExpectedToolCall } from './golden-agent-examples'
import type { FakeDb } from './fake-db'

function argsMatch(expected: ExpectedToolCall, actual: { name: string; args: Record<string, unknown> }) {
  if (expected.name !== actual.name) return false
  if (!expected.args) return true
  return Object.entries(expected.args).every(
    ([key, value]) => JSON.stringify(actual.args[key]) === JSON.stringify(value),
  )
}

function matchesInOrder(expected: ExpectedToolCall[], actual: Trajectory['toolCalls']) {
  let i = 0
  for (const call of actual) {
    if (i < expected.length && argsMatch(expected[i], call)) i++
  }
  return i === expected.length
}

export interface TrajectoryScore {
  toolSelection: boolean
  noForbiddenTools: boolean
  withinStepBudget: boolean
  noLoops: boolean
  finalStateCorrect: boolean | null
  toolErrorRate: number
  pass: boolean
}

export function scoreTrajectory(
  ex: AgentGoldenExample,
  t: Trajectory,
  db: FakeDb,
): TrajectoryScore {
  const actual = t.toolCalls

  const toolSelection =
    ex.matchMode === 'in_order'
      ? matchesInOrder(ex.expectedTools, actual)
      : ex.matchMode === 'exact'
        ? actual.length === ex.expectedTools.length &&
          ex.expectedTools.every((e, i) => argsMatch(e, actual[i]))
        : ex.expectedTools.every(e => actual.some(a => argsMatch(e, a))) // any_order / subset

  const noForbiddenTools = !actual.some(a => ex.forbiddenTools?.includes(a.name))

  // Loop detection: same tool + same args called 3+ times
  const signatures = actual.map(a => `${a.name}:${JSON.stringify(a.args)}`)
  const noLoops = !signatures.some(sig => signatures.filter(s => s === sig).length >= 3)

  const withinStepBudget = t.steps <= ex.maxSteps
  const finalStateCorrect = ex.expectedState ? ex.expectedState(db) : null
  const toolErrorRate = actual.length ? actual.filter(a => a.error).length / actual.length : 0

  return {
    toolSelection,
    noForbiddenTools,
    withinStepBudget,
    noLoops,
    finalStateCorrect,
    toolErrorRate,
    // Hard gates: forbidden tools and wrong final state always fail
    pass: toolSelection && noForbiddenTools && noLoops && finalStateCorrect !== false,
  }
}
```

Note that `withinStepBudget` is reported but isn't a hard gate. Efficiency regressions should warn, not block, unless cost is critical.

## Consistency: pass@k vs pass^k

Agents are non-deterministic. One passing run proves little.

- **pass@k**: at least one of k runs succeeds. Useful for coding agents where a human picks the best attempt.
- **pass^k**: *all* k runs succeed. This is the right metric for customer-facing agents, because every user gets one run.

An agent with 90% single-run success has roughly 0.9⁴ ≈ 66% pass^4. Reporting pass^k reveals flakiness that a single run hides.

```typescript
// pass-hat-k.ts
import type { FakeDb } from './fake-db'
import type { Trajectory } from './trajectory'
import type { AgentGoldenExample } from './golden-agent-examples'
import { scoreTrajectory } from './score-trajectory'

export async function passHatK(
  ex: AgentGoldenExample,
  runAgent: (input: string) => Promise<{ trajectory: Trajectory; db: FakeDb }>,
  k = 4,
) {
  const results = await Promise.all(
    Array.from({ length: k }, () => runAgent(ex.input)),
  )
  const scores = results.map(r => scoreTrajectory(ex, r.trajectory, r.db))
  return {
    passAtK: scores.some(s => s.pass),
    passHatK: scores.every(s => s.pass),
    singleRunRate: scores.filter(s => s.pass).length / k,
  }
}
```

## Environments: Fake the World, Not the Model

To check final state, the agent needs a world to act on. Three options:

| Approach | Pros | Cons |
| --- | --- | --- |
| **In-memory fakes** (`FakeDb`, fake email sender) | Fast, deterministic, free | Can drift from real API behaviour |
| **Sandboxed real services** (test DB, Stripe test mode) | Realistic | Slower, needs reset between runs |
| **Recorded responses** (replay fixtures) | Cheap, reproducible | Breaks when the agent calls something new |

Use fakes for CI, sandboxes for nightly runs. Reset state before **every** example, because a leftover refund from example 3 will silently pass example 7.

Use the real model in evals. Mocking the LLM tests your plumbing, not your agent.

## LLM-as-Judge for Trajectories

Some things rules can't check: "Was asking the user for their order ID a reasonable clarification, or should the agent have looked it up?" For these, give the judge the whole trajectory:

```typescript
const judgePrompt = (t: Trajectory, task: string) => `
You are reviewing an AI agent's actions.

Task: ${task}

Tool calls, in order:
${t.toolCalls.map((c, i) => `${i + 1}. ${c.name}(${JSON.stringify(c.args)}) -> ${c.error ?? 'ok'}`).join('\n')}

Final response: ${t.finalResponse}

Rate each 1-5 and explain briefly:
- necessity: were all calls needed?
- clarification: did it ask the user only when information was truly missing?
- recovery: when a tool failed, did it recover sensibly?
Return JSON: {"necessity": n, "clarification": n, "recovery": n, "reasoning": "..."}`
```

Keep the judge model pinned in config (for example `EVAL_JUDGE_MODEL`), not hard-coded, so upgrading it is an explicit, recalibrated change.

## Public Benchmarks Worth Knowing

You won't run these on your own agent, but interviewers reference them and they're good design inspiration:

| Benchmark | Measures |
| --- | --- |
| **τ-bench** | Customer-service agents with tools and policies; graded on final DB state; introduced pass^k |
| **SWE-bench (Verified)** | Coding agents fixing real GitHub issues; graded by tests |
| **BFCL** | Function-calling accuracy (Berkeley Function Calling Leaderboard) |
| **GAIA** | General assistant tasks needing search, tools and reasoning |
| **WebArena / OSWorld** | Browser and computer-use agents in realistic environments |
| **Terminal-Bench** | Agents completing tasks in a terminal |

::: danger Where It Bites
**Over-specified trajectories:** You assert the exact order of 6 tool calls. A new model does two lookups in parallel and swaps their order. 40% of tests fail, but nothing is actually broken. Fix: use `in_order` or `any_order`, and assert only the calls that matter.

**Lucky final answers:** The agent looks up the wrong customer, but both customers happen to have the same plan, so the answer is correct. Response-only evals pass. Fix: assert tool arguments (`email: 'sara@example.com'`), not just tool names.

**State leaking between examples:** Tests pass in sequence but fail when run in parallel or reordered. Fix: build a fresh environment per example; never share a mutable fake.

**Single-run optimism:** The suite shows 92% pass. Users report the agent is "flaky". Fix: run critical examples k=4 times and track pass^k.

**Ignoring the harness:** Scores drop after a model upgrade, and the team rewrites prompts for a week. The real cause was the new model emitting parallel tool calls the harness handled incorrectly. Fix: check `toolErrorRate` and `terminatedBy` before blaming the prompt.
:::

## Interview Questions

::: details Q1 — How is evaluating an agent different from evaluating a RAG chatbot?
A chatbot is one input → one output, so you grade the response. An agent is a sequence of decisions with side effects, so you grade four layers: final environment state (strongest signal, deterministic), tool selection and arguments, trajectory quality (order, loops, efficiency), and finally the response. Agents are also stochastic across many steps, so a single run is weak evidence; you measure pass^k for consistency. You also need a resettable environment for the agent to act on, which chatbot evals don't.
:::

::: details Q2 — Your agent passes 95% of evals but production escalations went up. What do you check?
First, representativeness: sample recent production traces and compare them to the golden set. New intents or phrasings are the most common cause. Second, consistency: run the failing production inputs with k=5 to see if it's flakiness rather than systematic failure. Third, environment realism: fakes may return clean data, while production APIs return partial records, timeouts and pagination. Fourth, outcome versus quality: evals may score response quality while escalations are an outcome metric. Feed the failing production traces back into the golden set as new examples.
:::

::: details Q3 — When would you use exact trajectory matching?
When an extra or reordered call is itself a defect: payments (never refund before verifying identity), compliance workflows with required steps, or irreversible actions. Everywhere else, exact matching makes the suite brittle to harmless changes like parallel lookups, so prefer in-order matching with explicit forbidden tools.
:::

## Key Mental Models

- **Grade the path and the destination.** Final state proves the outcome; tool calls prove it wasn't luck.
- **Final state beats final text.** A DB row is harder to fake than a well-written paragraph.
- **Assert what matters, allow the rest.** Partial argument matching and in-order matching keep tests robust.
- **pass^k is the user's experience.** Every user gets one run; measure consistency, not best case.
- **Fake the world, never the model.** Deterministic environments, real LLM calls.

## Related

- [5.2 Evaluation Pipeline](./02-evaluation-pipeline) — golden datasets, judges, CI gates
- [2.9 Durable Agents & Human-in-the-Loop](../module-02/09-durable-agents) — approval gates you'll also want to test
- [6.1 Production Metrics](../module-06/01-production-metrics) — feeding production traces back into evals
