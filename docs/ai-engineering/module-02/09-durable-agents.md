# Durable Agents & Human-in-the-Loop

🔥🔥 Interview weight | Prerequisites: [2.1 The Agent Loop](./01-agent-loop), [2.5 The Agent Harness](./05-agent-harness), [3.3 Reliability & Fallbacks](../module-03/03-reliability-and-fallbacks)

::: info Plain English
A chatbot request lasts a few seconds. If it fails, the user clicks "retry".

A real agent task can last minutes, hours or days. It might process 200 invoices, wait for a manager to approve a refund, or pause until a customer replies to an email. During that time, servers restart, deploys happen, and APIs time out.

If your agent loop lives in the memory of one Node process, all of that work is lost when the process dies. Worse, when you retry, the agent might **send the same email twice or issue the same refund twice**.

A **durable agent** saves its progress after every step, so it can resume exactly where it stopped. **Human-in-the-loop (HITL)** means the agent can pause, ask a person to approve something, and continue when they answer, even if that takes two days.
:::

## Why the Simple Loop Breaks

The basic agent loop from 2.1:

```typescript
while (steps < maxSteps) {
  const response = await callModel(messages)
  if (response.done) return response.text
  const results = await executeTools(response.toolCalls)
  messages.push(response, ...results)
  steps++
}
```

Failure modes in production:

| Problem | What happens |
| --- | --- |
| Process crash / deploy mid-run | All state lost; task silently abandoned |
| Retrying the whole run | Side effects repeat (duplicate refund, duplicate email) |
| Waiting for a human | You can't hold an HTTP request or a process open for 2 days |
| Rate limit on step 37 of 50 | Either crash, or retry everything from step 1 |
| Debugging | No record of what the agent saw at each step |

Durability solves this with three ideas: **persisted state**, **idempotent side effects**, and **resumable waits**.

## Idea 1: Checkpoint After Every Step

Persist the agent's state (messages, step count, pending actions) after each model turn and each tool result. On restart, load the latest checkpoint and continue.

```typescript
// checkpoint.ts
export interface AgentCheckpoint {
  runId: string
  step: number
  messages: Message[]
  status: 'running' | 'awaiting_approval' | 'completed' | 'failed'
  pendingAction?: { toolName: string; args: Record<string, unknown>; idempotencyKey: string }
  updatedAt: string
}

export async function runDurableAgent(runId: string, store: CheckpointStore) {
  let cp = await store.load(runId)

  while (cp.status === 'running' && cp.step < MAX_STEPS) {
    const response = await withRetry(() => callModel(cp.messages))

    if (response.done) {
      cp = { ...cp, status: 'completed', messages: [...cp.messages, response.message] }
      await store.save(cp)
      return
    }

    for (const call of response.toolCalls) {
      if (requiresApproval(call)) {
        cp = {
          ...cp,
          status: 'awaiting_approval',
          pendingAction: { toolName: call.name, args: call.args, idempotencyKey: `${runId}:${cp.step}:${call.id}` },
        }
        await store.save(cp)
        await notifyApprover(cp)   // Slack message, email, dashboard task
        return                     // Process exits. Nothing is held in memory.
      }
      const result = await executeTool(call, { idempotencyKey: `${runId}:${cp.step}:${call.id}` })
      cp.messages.push(toolResultMessage(call, result))
    }

    cp = { ...cp, step: cp.step + 1, updatedAt: new Date().toISOString() }
    await store.save(cp)            // Checkpoint after every step
  }
}
```

Note the `return` on approval. The agent doesn't wait in memory. It saves state and stops. An approval webhook later sets the status back to `running` and re-invokes `runDurableAgent`.

## Idea 2: Idempotent Side Effects

A retry must never repeat a real-world action. The pattern is an **idempotency key** that is deterministic for a given run and step:

```typescript
// execute-tool.ts
export async function executeTool(call: ToolCall, opts: { idempotencyKey: string }) {
  const existing = await db.toolExecutions.findUnique({ where: { key: opts.idempotencyKey } })
  if (existing) return existing.result   // Already done: return the stored result

  const result = await tools[call.name](call.args, { idempotencyKey: opts.idempotencyKey })
  await db.toolExecutions.create({ data: { key: opts.idempotencyKey, result } })
  return result
}
```

Many payment and messaging APIs accept idempotency keys natively (Stripe does, for example). Pass your key through so the protection holds even if your own DB write fails after the external call.

**Rule of thumb:** read-only tools can be retried freely. Every tool that writes, sends, pays or deletes needs an idempotency key.

## Idea 3: Resumable Waits (Human-in-the-Loop)

Decide which actions need approval using a **policy**, not the model's judgment:

```typescript
// approval-policy.ts
const APPROVAL_RULES: Record<string, (args: any) => boolean> = {
  issue_refund: (a) => a.amount > 500,     // Small refunds auto-approved
  send_email: (a) => a.recipients.length > 10 || a.external === true,
  delete_record: () => true,               // Always approve deletions
  update_salary: () => true,
}

export const requiresApproval = (call: ToolCall) =>
  APPROVAL_RULES[call.name]?.(call.args) ?? false
```

The approval UI should show the approver **exactly what will execute**: tool name, full arguments, and the agent's reasoning. The approver can approve, reject (the rejection reason is fed back to the agent as a tool result), or edit the arguments.

```typescript
// approval-webhook.ts
export async function handleApproval(runId: string, decision: { approved: boolean; editedArgs?: object; reason?: string; reviewer: string }) {
  const cp = await store.load(runId)
  if (cp.status !== 'awaiting_approval' || !cp.pendingAction) throw new Error('Nothing to approve')

  const { toolName, args, idempotencyKey } = cp.pendingAction
  const result = decision.approved
    ? await executeTool({ name: toolName, args: decision.editedArgs ?? args }, { idempotencyKey })
    : { rejected: true, reason: decision.reason ?? 'Rejected by reviewer' }

  await auditLog.write({ runId, toolName, args, decision })   // Who approved what, and when
  cp.messages.push(toolResultMessage({ name: toolName }, result))
  await store.save({ ...cp, status: 'running', pendingAction: undefined })

  await queue.enqueue('resume-agent', { runId })   // Continue asynchronously
}
```

## Using a Durable Execution Engine

Building checkpointing yourself is fine for simple agents. For complex, long-running ones, a **durable execution engine** handles persistence, retries, timers and waits for you.

| Option | Model | Good fit |
| --- | --- | --- |
| **Temporal** | Workflows replay from an event history; activities do the side effects | Complex, long-running, business-critical flows |
| **Inngest** | Step functions triggered by events; each `step` is memoized | Serverless/Next.js stacks, simpler ops |
| **Trigger.dev** | Long-running TypeScript background tasks | TS teams wanting managed background jobs |
| **LangGraph checkpointers** | Graph state saved per node; `interrupt` for HITL | Already using LangGraph |
| **Queue + DB (DIY)** | BullMQ/SQS + Postgres checkpoints | Few agent types, full control |

A Temporal workflow with an approval wait looks like this:

```typescript
// agent-workflow.ts (Temporal)
import { proxyActivities, defineSignal, setHandler, condition } from '@temporalio/workflow'
import type * as activities from './activities'

const { callModel, executeTool, notifyApprover } = proxyActivities<typeof activities>({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 5, initialInterval: '2s', backoffCoefficient: 2 },
})

export const approvalSignal = defineSignal<[{ approved: boolean; reviewer: string }]>('approval')

export async function supportAgentWorkflow(input: string): Promise<string> {
  const messages: Message[] = [{ role: 'user', content: input }]
  let decision: { approved: boolean; reviewer: string } | undefined
  setHandler(approvalSignal, (d) => { decision = d })

  for (let step = 0; step < 20; step++) {
    const response = await callModel(messages)        // Retried automatically, result recorded
    if (response.done) return response.text

    for (const call of response.toolCalls) {
      if (requiresApproval(call)) {
        await notifyApprover({ call })
        decision = undefined
        const answered = await condition(() => decision !== undefined, '48 hours') // Durable wait
        if (!answered || !decision?.approved) {
          messages.push(toolResultMessage(call, { rejected: true }))
          continue
        }
      }
      messages.push(toolResultMessage(call, await executeTool(call)))
    }
  }
  return 'Stopped: step limit reached'
}
```

The 48-hour wait costs nothing while it waits. If a worker crashes, Temporal replays the recorded history, skipping activities that already completed, and resumes at the same line.

Temporal workflow code must be **deterministic**: no direct network calls, `Date.now()`, or random numbers inside the workflow itself. All LLM calls and tool calls go in activities.

## Decision Guide

| Situation | Recommendation |
| --- | --- |
| Runs finish in < 30s, no side effects | Plain loop with retries is fine |
| Side effects (payments, emails, DB writes) | Idempotency keys, always |
| Needs human approval | Checkpoint + status + webhook, at minimum |
| Runs last hours/days, many steps, business-critical | Durable execution engine |
| Hundreds of concurrent long runs | Engine or queue-based workers; never in-request |

::: danger Where It Bites
**Non-idempotent retries:** A timeout on `issue_refund` triggers a retry. The first call actually succeeded. The customer gets refunded twice. Fix: idempotency keys derived from `runId + step + toolCallId`, passed to the downstream API.

**Approving blind:** The approval message says "Agent wants to issue a refund. Approve?" The reviewer clicks yes without seeing it's AED 45,000 to a different account. Fix: show full arguments, the customer context, and the agent's reasoning; highlight anomalies.

**Stale approvals:** A refund waits 3 days for approval. Meanwhile the customer already got a manual refund from support. Fix: re-validate preconditions right before executing an approved action, and give approvals an expiry.

**Context drift after a long pause:** The agent resumes after 2 days with a conversation that references "today". Fix: inject the current time and any changed facts into the context on resume.

**Non-deterministic workflow code (Temporal):** Calling the LLM directly inside the workflow function instead of an activity breaks replay. Fix: all I/O in activities.
:::

## Interview Questions

::: details Q1 — Your agent processes a batch of 500 invoices and crashes at #312. How should the system behave?
It should resume at #312 without redoing earlier ones, and without re-executing any side effect from #312 that already completed. That requires checkpointing progress per item (or per step), idempotency keys on every write, and a worker that picks up incomplete runs on restart. For very long batches, fan out: one parent workflow spawns a child run per invoice, so one failure doesn't block the rest and progress is naturally tracked.
:::

::: details Q2 — How do you decide which agent actions need human approval?
With an explicit, code-level policy based on risk: irreversibility, financial amount, blast radius (number of recipients or records), and external visibility. Don't let the model decide whether something needs approval, because a prompt injection could convince it not to ask. Start strict, measure approval rates and rejection rates, and relax rules where humans approve nearly 100% of the time.
:::

::: details Q3 — When is a durable execution engine overkill?
When runs are short (seconds), have no side effects, and a failed run can simply be retried by the user, like a Q&A chatbot. The engine adds operational overhead and constraints (deterministic workflow code). Idempotency keys are never overkill for side effects, though.
:::

## Key Mental Models

- **Save state, not processes.** An agent waiting for a human should cost nothing and hold nothing in memory.
- **Every write gets an idempotency key.** Retries are guaranteed; duplicate side effects shouldn't be.
- **Approval is policy, not model judgment.** Code decides what needs a human; the model can't opt out.
- **Show the approver exactly what will run.** Full arguments, context and reasoning.
- **Re-validate on resume.** The world changes while the agent waits.

## Related

- [2.5 The Agent Harness](./05-agent-harness) — where the loop, tools and limits live
- [7.2 Agent Security](../module-07/02-agent-security) — least privilege and why approval gates stop injection damage
- [5.3 Agent Trajectory Evaluation](../module-05/03-agent-trajectory-evaluation) — testing that approval gates actually fire
