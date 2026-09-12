---
title: AI Metrics & ROI — How to Know if It's Working
outline: deep
---

# AI Metrics & ROI — How to Know if It's Working

🔥🔥🔥 Interview weight — separates senior from mid-level in architecture rounds. Prerequisites: [LLMOps & Evaluation](/ai-engineering/module-06/02-llmops), [The AI Decision Framework](./01-ai-decision-framework).

## 🗣️ In Plain English

::: tip In Plain English
Your company installed a new automated checkout system at the supermarket. Management wants to know: is it working?

A bad answer: "The software is running and customers are using it." That tells you it's on — not whether it's good.

A good answer: "Checkout time dropped from 4 minutes to 90 seconds. Queue length at peak hours dropped by 60%. Customer satisfaction scores for checkout went from 3.2 to 4.1 out of 5. We're processing the same number of customers with two fewer staff per shift, saving £18,000 per month. Implementation cost was £120,000 — we'll break even in 7 months."

That's what ROI looks like. It connects the system's behaviour to actual business outcomes in numbers, with a timeline.

AI projects fail this test constantly. Teams ship a chatbot, measure that it "handles 1,000 conversations a day," and declare success. But they never measured whether those conversations actually *resolved* the customers' problems, whether customers came back anyway to call support, or whether the bot's answers were accurate. The AI was running — but nobody knew if it was working.

Metrics and ROI for AI are the discipline of connecting what the model does (generated a response) to what the business cares about (customer problem solved, cost reduced, revenue protected).
:::

## ⚙️ Under the Hood

### The three layers of AI metrics

Every AI project has metrics at three distinct levels. You need all three — they measure different things and tell you different things when they go wrong.

#### Layer 1 — Model quality metrics

These measure what the model *itself* is doing. Computed offline, against a golden dataset.

**For generation (LLM output quality):**

| Metric | What it measures | How computed |
|---|---|---|
| Faithfulness | Does the answer contradict the source documents? | LLM-as-a-Judge against retrieved context |
| Answer correctness | Is the answer factually right? | Compare to golden answer |
| Answer relevance | Does the answer address the question? | LLM-as-a-Judge or embedding similarity |
| Hallucination rate | % of answers that include fabricated facts | Human eval or automated pipeline |

**For retrieval (RAG):**

| Metric | What it measures | Formula |
|---|---|---|
| Recall@K | Of relevant docs, how many were in top K? | Relevant retrieved / Total relevant |
| Precision@K | Of top K retrieved, how many were relevant? | Relevant retrieved / K |
| MRR | How highly were relevant docs ranked? | Mean(1 / rank of first relevant) |
| NDCG | Graded relevance accounting for rank order | Normalized discounted cumulative gain |

**For classification (routing, intent detection):**

```
Accuracy  = (TP + TN) / (TP + TN + FP + FN)
Precision = TP / (TP + FP)       # of what we flagged, how much was right
Recall    = TP / (TP + FN)       # of what should be flagged, how much did we catch
F1        = 2 × (P × R) / (P + R)  # harmonic mean — balanced measure
```

Layer 1 metrics can be high while the product fails. A model with 95% faithfulness still produces wrong answers 5% of the time — at 10,000 requests/day that's 500 wrong answers.

#### Layer 2 — Product metrics

These measure what the *product* is doing — the AI system as seen by users.

| Metric | Definition | Good signal |
|---|---|---|
| Task completion rate | % of sessions where user goal was achieved | Rising |
| Escalation rate | % of AI sessions that escalated to human | Falling |
| Containment rate | % of support volume handled without human | Rising |
| Deflection rate | Tickets avoided because AI answered the question | Rising |
| Session abandonment | % of users who left without resolving | Falling |
| Repeat contact rate | % who contacted again within 48h on same issue | Falling |

Layer 2 tells you whether the AI is actually helping users — regardless of how high your model quality scores are.

#### Layer 3 — Business metrics

These connect to money, risk, and strategic goals.

| Metric | Definition |
|---|---|
| Cost per resolved ticket | Total support cost / Resolved tickets |
| Support cost reduction | (Baseline cost − Current cost) / Baseline |
| Time saved per interaction | Avg human handle time × Deflection rate × Volume |
| Revenue impact | Churn reduction × Average customer value |
| Error rate | % of AI decisions that caused measurable harm |
| Compliance events | Count of AI outputs that violated policy |

### ROI calculation

A structured ROI estimate for an AI project:

```typescript
interface AiProjectRoi {
  // Costs
  buildCost: number          // Engineering time, infra setup
  monthlyCost: number        // API costs + infra + maintenance

  // Benefits per month
  ticketsDeflected: number   // Volume handled by AI without human
  avgCostPerTicket: number   // Fully-loaded cost of a human-handled ticket
  timeSavedHours: number     // Agent time saved per month
  agentHourlyCost: number    // Fully-loaded hourly cost of a support agent

  // Risk
  errorRate: number          // % of AI decisions that cause harm
  avgErrorCost: number       // Average cost to remediate one error
}

function calculateMonthlyRoi(p: AiProjectRoi): {
  monthlySavings: number
  monthlyRisk: number
  netMonthlyBenefit: number
  breakEvenMonths: number
} {
  const ticketSavings = p.ticketsDeflected * p.avgCostPerTicket
  const timeSavings = p.timeSavedHours * p.agentHourlyCost
  const monthlySavings = ticketSavings + timeSavings

  const monthlyRisk = (p.ticketsDeflected * p.errorRate) * p.avgErrorCost
  const netMonthlyBenefit = monthlySavings - p.monthlyCost - monthlyRisk

  const breakEvenMonths = netMonthlyBenefit > 0
    ? p.buildCost / netMonthlyBenefit
    : Infinity

  return { monthlySavings, monthlyRisk, netMonthlyBenefit, breakEvenMonths }
}

// Example: TaskFlow support bot
const taskflowRoi = calculateMonthlyRoi({
  buildCost: 80_000,          // ~2 engineers × 2 months
  monthlyCost: 3_000,         // API costs + infra

  ticketsDeflected: 2_000,    // 40% of 5,000 monthly tickets
  avgCostPerTicket: 12,       // fully-loaded cost per human-handled ticket

  timeSavedHours: 120,        // remaining tickets resolved faster
  agentHourlyCost: 35,

  errorRate: 0.03,            // 3% wrong answers
  avgErrorCost: 25,           // cost to fix a bad AI interaction
})

// monthlySavings: £28,200
// monthlyRisk: £1,500
// netMonthlyBenefit: £23,700
// breakEvenMonths: ~3.4 months
```

### The adoption metric — often forgotten

A technically excellent AI system that users don't use has zero ROI. Measure adoption explicitly:

- **Opt-in rate** — what % of users who could use the AI actually do?
- **Return rate** — of users who tried it, what % came back?
- **Satisfaction score (CSAT)** — per-session rating
- **Net Promoter Score delta** — did overall NPS change after rollout?

Low adoption despite high model quality usually means: users don't trust it, the UX is poor, or the AI is solving the wrong problem.

### Monitoring in production

After launch, metrics must be tracked continuously — not just at launch:

```typescript
// Metrics to emit per AI interaction
interface AiInteractionMetrics {
  sessionId: string
  userId: string
  timestamp: Date

  // Performance
  ttft: number           // time to first token (ms)
  totalLatency: number   // end-to-end (ms)
  inputTokens: number
  outputTokens: number
  cost: number           // estimated API cost

  // Quality signals
  userRated: boolean
  userRating?: 1 | 2 | 3 | 4 | 5
  escalatedToHuman: boolean
  sessionAbandoned: boolean
  taskCompleted: boolean

  // Guardrail signals
  blockedByGuardrail: boolean
  guardRailType?: string
}
```

Track these in a time-series store (Grafana, Datadog). Alert on: escalation rate spike, task completion drop, latency p95 increase, cost per session increase.

### The regression test pipeline

Every model or prompt change should run against your golden dataset before shipping:

```
PR opened
   │
   ▼
Run eval pipeline against golden dataset
   │
   ├─ Faithfulness < 0.90? ──► Block PR
   ├─ Answer correctness < 0.85? ──► Block PR
   ├─ Retrieval Recall@5 < 0.80? ──► Block PR
   └─ All pass ──► Approve for staging
                        │
                        ▼
               A/B test in staging (10% traffic)
                        │
                ├─ Product metrics stable? ──► Full rollout
                └─ Escalation rate up? ──► Rollback
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Measuring model quality while ignoring product outcomes.** Team celebrates 94% faithfulness on their golden dataset. Four weeks post-launch, support volume is up 15% — users are contacting again because the bot answers weren't actually resolving their problems. The model was faithful to its documents; the documents were incomplete. Fix: instrument product metrics (escalation rate, repeat contact rate, task completion) from day one. Model quality metrics are necessary but not sufficient.

**No baseline measurement before launch.** Team launches and then tries to prove impact. They didn't measure ticket volume, handle time, or CSAT before. They have no denominator for ROI. Fix: spend one week before any AI build capturing baseline metrics on the process you're automating. You cannot prove improvement without a starting point.

**API cost creeping past ROI threshold.** Month 1: 10,000 requests at $0.02 each = $200. Month 6: 150,000 requests at $0.02 = $3,000. Nobody re-ran the ROI calculation. The project is now losing money because costs scaled faster than deflection savings. Fix: set a cost budget per request and alert when actual cost exceeds it. Re-run the ROI model monthly as volume changes.

**Treating escalation rate as a failure metric without context.** Team targets "zero escalations" and optimizes for it — bot stops acknowledging edge cases and hallucinates confident wrong answers instead of escalating. Escalation rate drops; complaint rate soars. Fix: escalation is not a failure — it's the correct outcome for hard cases. Measure escalation rate *alongside* the quality of escalated vs bot-handled resolutions. A well-calibrated bot escalates the right 10%, handles the rest correctly.

:::

## 🎯 Checkpoint

::: details Question 1 — How do you measure whether an AI support bot is working?
**Q:** You've shipped a customer support bot. Your manager asks "is it working?" What do you measure and how?

**A:** Measure across all three layers:

**Layer 1 — Model quality (offline):** Run your golden dataset weekly. Track faithfulness, answer correctness, and retrieval recall. These tell you if the model is degrading — not whether it's helping users.

**Layer 2 — Product metrics (live):** Task completion rate (did the user's problem get solved?), escalation rate (how often did it give up to a human?), containment rate (% of volume handled end-to-end by AI), session abandonment (did users leave mid-conversation?). These tell you whether users are succeeding.

**Layer 3 — Business metrics (monthly):** Cost per resolved ticket (is AI cheaper than human-handled?), deflection rate (how many tickets never reached a human?), repeat contact rate (are people calling back about the same issue?). These tell you the ROI.

The answer to "is it working?" requires all three. A model with 95% faithfulness that users abandon 60% of the time is not working.
:::

::: details Question 2 — Walk me through an ROI calculation for an AI project
**Q:** You're proposing an AI system that will partially automate a process that currently costs your company £500,000/year in staff time. How do you structure the ROI case?

**A:** Structure it as: costs, savings, risk, and timeline.

**Costs:** Engineering build (estimate in weeks × engineer cost), ongoing infra and API costs (estimate per request × projected volume), maintenance (ongoing engineering allocation).

**Savings:** Identify the % of the process that AI can automate reliably. Be conservative — 40% automation is more defensible than 80%. Savings = automated % × current cost. Add time-savings for the non-automated remainder if AI assists (faster per task).

**Risk:** Estimate error rate × cost per error. For a 3% error rate on 10,000 automated decisions per month with a £50 remediation cost = £15,000/month risk.

**Timeline:** Net monthly benefit = Monthly savings − Monthly costs − Monthly risk. Break-even = Build cost / Net monthly benefit.

For a £100,000 build cost, £20,000/month net benefit → break-even in 5 months. For £500,000/year process with 40% automation → £200,000/year gross saving, minus running costs and risk.

Always present a conservative, base, and optimistic scenario. Never present only the optimistic.
:::

## Key Mental Models

**Three layers of metrics — model, product, business — and you need all three.** Model quality alone proves nothing. Business metrics alone don't point to what to fix.

**Baseline first, then build.** You cannot prove improvement without measuring the starting point.

**ROI = (savings − costs − risk).** All three terms matter. A project with great savings and uncontrolled risk is not a good project.

**Adoption is a metric.** An AI system that works perfectly but nobody uses has zero ROI.

**Monitor continuously, not just at launch.** Costs drift up. Usage patterns change. Model quality degrades with distribution shift. Set alerts, review monthly.

## Related

- [The AI Decision Framework](./01-ai-decision-framework) — deciding whether to build at all
- [AI Strategy for Engineers](./03-ai-strategy) — the organizational context
- [LLMOps](/ai-engineering/module-06/02-llmops) — the operational pipeline behind these metrics
- [Evaluation Pipeline](/ai-engineering/module-05/02-evaluation-pipeline) — evaluation frameworks and golden datasets
