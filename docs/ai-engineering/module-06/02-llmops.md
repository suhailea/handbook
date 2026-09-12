---
title: LLMOps — Prompt Versioning, Model Versioning, A/B Testing
outline: deep
---

# LLMOps — Prompt Versioning, Model Versioning, A/B Testing

🔥🔥 Interview weight | Prerequisites: [5.2 Evaluation Pipeline](/ai-engineering/module-05/02-evaluation-pipeline)

## 🗣️ In Plain English

::: tip In Plain English
Traditional software deployment is deterministic: you change the code, you test it, you deploy it, and if something breaks you can see exactly which line of code caused it. You can roll back to the previous version in seconds.

AI systems are messier. Changing a single word in a system prompt can improve answers to one query type while degrading a dozen others. Upgrading from GPT-4o version 0409 to version 0513 might improve math reasoning but slightly change the tone of customer support responses. A new model that's better on benchmarks might be worse on your specific data distribution.

LLMOps is the discipline of managing these changes safely — borrowing the rigor of software engineering (versioning, CI/CD, monitoring) and adapting it to the probabilistic, non-deterministic nature of LLM systems.

**Prompt versioning** treats system prompts like code: stored in version control, tested before deployment, rolled back when something breaks. When you're debugging a quality regression, you need to know exactly which prompt was running at what time.

**Model versioning** means pinning the exact model version you're using (GPT-4o-2024-05-13, not just GPT-4o) so that model updates don't silently change your system's behavior. It also means having a process for evaluating and migrating to new models when they're genuinely better.

**A/B testing AI systems** is fundamentally different from A/B testing a button color. You can't just measure click rates. You need to measure quality, which requires LLM-as-Judge or human evaluation. Sample sizes need to be large because AI quality has high variance. And the "right" answer often depends on domain-specific judgment.

The goal is the same as traditional DevOps: deploy with confidence, observe everything, fail safely, and iterate quickly.
:::

## ⚙️ Under the Hood

### Prompt Versioning

```typescript
// run: npx tsx prompt_versioning.ts
// Store prompts in database with versioning

interface PromptVersion {
  id: string
  promptId: string           // logical name: "customer_support_system_prompt"
  version: string            // semver: "2.1.0"
  content: string
  description: string        // what changed and why
  author: string
  createdAt: Date
  evaluationScore?: number   // from eval pipeline before promotion
  status: 'draft' | 'testing' | 'production' | 'deprecated'
  metadata: {
    targetModel: string
    maxTokens: number
    temperature: number
    tags: string[]
  }
}

class PromptRegistry {
  private prompts: Map<string, PromptVersion[]> = new Map()

  getActiveVersion(promptId: string, tenantId?: string): PromptVersion | null {
    const versions = this.prompts.get(promptId) ?? []
    // Tenant-level override: some tenants test new prompts before GA
    // Otherwise: find latest 'production' status
    return versions.find(v => v.status === 'production') ?? null
  }

  async promoteToProduction(
    promptId: string,
    version: string,
    minEvalScore: number = 0.85
  ): Promise<{ success: boolean; reason: string }> {
    const versions = this.prompts.get(promptId) ?? []
    const target = versions.find(v => v.version === version)

    if (!target) return { success: false, reason: 'Version not found' }
    if (!target.evaluationScore) return { success: false, reason: 'Not evaluated yet' }
    if (target.evaluationScore < minEvalScore) {
      return {
        success: false,
        reason: `Eval score ${target.evaluationScore} below minimum ${minEvalScore}`
      }
    }

    // Deprecate current production
    const currentProd = versions.find(v => v.status === 'production')
    if (currentProd) currentProd.status = 'deprecated'

    // Promote target
    target.status = 'production'
    return { success: true, reason: `Promoted v${version} to production` }
  }
}

// Prompt template with variable injection
class PromptTemplate {
  constructor(private template: string) {}

  render(variables: Record<string, string>): string {
    let result = this.template
    for (const [key, value] of Object.entries(variables)) {
      result = result.replaceAll(`{{${key}}}`, value)
    }
    // Warn about unresolved variables
    const unresolved = result.match(/\{\{[^}]+\}\}/g)
    if (unresolved) {
      console.warn(`Unresolved variables: ${unresolved.join(', ')}`)
    }
    return result
  }
}

const SYSTEM_PROMPT_V2 = new PromptTemplate(`
You are a helpful customer support agent for {{company_name}}.

Your capabilities:
- Answer questions about {{company_name}} products and services
- Look up order status and account information
- Process refunds for orders within {{refund_window}} days

Tone: {{tone}}
Language: {{language}}

Important: Only provide information about {{company_name}}. Do not discuss competitors or provide advice outside our product scope.
`)

const rendered = SYSTEM_PROMPT_V2.render({
  company_name: 'TaskFlow',
  refund_window: '30',
  tone: 'professional and empathetic',
  language: 'English',
})
console.log(rendered)
```

### Model Versioning and Migration

```typescript
// run: npx tsx model_versioning.ts
import OpenAI from 'openai'

// NEVER use floating model aliases in production
// Bad:  "gpt-4o" (silently updates when OpenAI releases new version)
// Good: "gpt-4o-2024-11-20" (pinned version)

const MODEL_CONFIG = {
  production: {
    primary: 'gpt-4o-2024-11-20',
    fallback: 'gpt-4o-mini-2024-07-18',
    pinDate: '2025-01-01',      // when this pin was set
    nextReviewDate: '2025-04-01', // when to evaluate upgrading
  },
  canary: {
    primary: 'gpt-4o-2025-01-01',  // hypothetical new version being tested
    weight: 0.05,  // 5% of traffic for canary testing
  }
}

// Model evaluation before migration
interface ModelMigrationEval {
  baselineModel: string
  candidateModel: string
  tasks: string[]  // task categories
  results: {
    task: string
    baselineScore: number
    candidateScore: number
    delta: number
    recommendation: 'upgrade' | 'hold' | 'downgrade'
  }[]
  overallRecommendation: 'upgrade' | 'hold'
  costImpact: number  // relative cost change (-0.2 = 20% cheaper)
  latencyImpactMs: number
}

async function evaluateModelMigration(
  baselineModel: string,
  candidateModel: string,
  goldenDataset: Array<{ query: string; groundTruth: string }>
): Promise<ModelMigrationEval> {
  const client = new OpenAI()

  const results = []
  for (const example of goldenDataset.slice(0, 50)) { // test subset
    const [baselineRes, candidateRes] = await Promise.all([
      client.chat.completions.create({ model: baselineModel, messages: [{ role: 'user', content: example.query }] }),
      client.chat.completions.create({ model: candidateModel, messages: [{ role: 'user', content: example.query }] }),
    ])

    // Simplified scoring — in real impl: use LLM-as-Judge
    const baselineScore = baselineRes.choices[0].message.content?.includes(example.groundTruth) ? 1.0 : 0.5
    const candidateScore = candidateRes.choices[0].message.content?.includes(example.groundTruth) ? 1.0 : 0.5

    results.push({
      task: 'general',
      baselineScore,
      candidateScore,
      delta: candidateScore - baselineScore,
      recommendation: (candidateScore >= baselineScore) ? 'upgrade' : 'hold' as const,
    })
  }

  const avgDelta = results.reduce((sum, r) => sum + r.delta, 0) / results.length
  return {
    baselineModel,
    candidateModel,
    tasks: ['general'],
    results,
    overallRecommendation: avgDelta >= 0 ? 'upgrade' : 'hold',
    costImpact: 0,
    latencyImpactMs: 0,
  }
}
```

### A/B Testing AI Systems

AI A/B testing is more complex than web A/B testing because:
1. Quality is subjective and requires judgment (LLM-as-Judge or human eval)
2. High variance: same user with same query might get different quality from the same variant
3. Position effects: users might prefer the first answer they see regardless of quality
4. Measurement delay: quality problems may not show up in immediate metrics

```typescript
// run: npx tsx ab_testing.ts
import { createHash } from 'node:crypto'

interface ABTest {
  id: string
  name: string
  variants: Array<{
    id: string
    weight: number           // 0-1, must sum to 1.0
    promptVersion?: string
    model?: string
    temperature?: number
  }>
  startDate: Date
  endDate?: Date
  targetMetric: string     // "overall_quality_score" | "task_completion_rate" | "user_thumbs_up"
  minimumSampleSize: number
}

class ABTestRouter {
  assignVariant(
    userId: string,
    testId: string,
    variants: ABTest['variants']
  ): string {
    // Deterministic assignment: same user always gets same variant
    // Uses hash to ensure uniform distribution
    const hash = createHash('sha256')
      .update(`${userId}:${testId}`)
      .digest('hex')
    const hashNum = parseInt(hash.slice(0, 8), 16) / 0xFFFFFFFF  // 0-1

    let cumulative = 0
    for (const variant of variants) {
      cumulative += variant.weight
      if (hashNum < cumulative) return variant.id
    }

    return variants[variants.length - 1].id
  }

  // Statistical significance test (z-test for proportions)
  isSignificant(
    variantA: { successes: number; total: number },
    variantB: { successes: number; total: number },
    alpha: number = 0.05
  ): { significant: boolean; pValue: number; winner?: 'A' | 'B' } {
    const pA = variantA.successes / variantA.total
    const pB = variantB.successes / variantB.total
    const pooled = (variantA.successes + variantB.successes) / (variantA.total + variantB.total)

    const se = Math.sqrt(pooled * (1 - pooled) * (1/variantA.total + 1/variantB.total))
    if (se === 0) return { significant: false, pValue: 1.0 }

    const z = (pA - pB) / se
    // Approximate p-value from z-score
    const pValue = 2 * (1 - normalCDF(Math.abs(z)))

    return {
      significant: pValue < alpha,
      pValue,
      winner: pValue < alpha ? (pA > pB ? 'A' : 'B') : undefined,
    }
  }
}

function normalCDF(z: number): number {
  // Approximation of normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(z))
  const d = 0.3989423 * Math.exp(-z * z / 2)
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))))
  return z > 0 ? 1 - p : p
}

// Example A/B test setup
const test: ABTest = {
  id: 'prompt_v2_test',
  name: 'Testing new more empathetic system prompt',
  variants: [
    { id: 'control', weight: 0.50, promptVersion: '2.0.0' },
    { id: 'treatment', weight: 0.50, promptVersion: '2.1.0' },  // new empathetic prompt
  ],
  startDate: new Date('2025-01-01'),
  targetMetric: 'user_thumbs_up',
  minimumSampleSize: 500,  // per variant, for 80% power at α=0.05
}

// Check results
const router = new ABTestRouter()
const controlResults = { successes: 312, total: 550 }   // 56.7% positive
const treatmentResults = { successes: 341, total: 550 }  // 62.0% positive

const significance = router.isSignificant(controlResults, treatmentResults)
console.log(`Significant: ${significance.significant}`)
console.log(`p-value: ${significance.pValue.toFixed(4)}`)
console.log(`Winner: ${significance.winner ?? 'No winner yet'}`)
```

### Shadow Mode Deployment

Before exposing a new model/prompt to users, run it in shadow mode:

```typescript
// run: npx tsx shadow_mode.ts

async function shadowTest(
  userRequest: string,
  productionFn: (input: string) => Promise<string>,
  shadowFn: (input: string) => Promise<string>,
  logger: (data: object) => void
): Promise<string> {
  // Always return production response immediately
  const [productionResult, shadowResult] = await Promise.allSettled([
    productionFn(userRequest),
    shadowFn(userRequest),  // runs in background, result discarded
  ])

  const production = productionResult.status === 'fulfilled' ? productionResult.value : 'ERROR'
  const shadow = shadowResult.status === 'fulfilled' ? shadowResult.value : 'ERROR'

  // Log both for offline comparison
  logger({
    requestHash: userRequest.slice(0, 20),  // don't log full PII
    productionResponse: production.slice(0, 100),
    shadowResponse: shadow.slice(0, 100),
    timestamp: new Date().toISOString(),
  })

  // Return production response to user
  return production
}
```

### Canary Deployment for AI

```typescript
// run: npx tsx canary_deployment.ts

interface CanaryConfig {
  productionVersion: string
  canaryVersion: string
  canaryWeight: number    // 0.05 = 5% of traffic
  rollbackThreshold: {
    minQualityScore: number
    maxErrorRate: number
    maxLatencyP99Ms: number
  }
}

class CanaryController {
  private metricsWindow: Map<string, number[]> = new Map()

  shouldRollback(config: CanaryConfig): boolean {
    const canaryMetrics = this.metricsWindow.get(config.canaryVersion)
    if (!canaryMetrics || canaryMetrics.length < 100) return false  // not enough data

    const avgScore = canaryMetrics.reduce((a, b) => a + b, 0) / canaryMetrics.length
    return avgScore < config.rollbackThreshold.minQualityScore
  }

  incrementWeight(config: CanaryConfig): number {
    if (this.shouldRollback(config)) {
      return 0  // rollback: send canary weight back to 0
    }

    // Progressive rollout: 5% → 10% → 25% → 50% → 100%
    const schedule = [0.05, 0.10, 0.25, 0.50, 1.0]
    const current = schedule.indexOf(config.canaryWeight)
    return current < schedule.length - 1 ? schedule[current + 1] : 1.0
  }
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Prompt deployed to production without evaluation gate:** An engineer updates the system prompt to add a new product feature description, pushes directly to production. The change accidentally removes a key instruction ("never discuss competitor pricing"). Over the next week, 3% of conversations mention competitors. No regression in latency or error rate — nothing alerted. The prompt change is discovered only when a customer screenshots the AI discussing a competitor. Fix: all prompt changes must go through the evaluation pipeline; system prompts are code and require code review + eval gate before deployment.

**Model pin breaking on provider API change:** The team pins to "gpt-4o-2024-05-13". OpenAI deprecates this version after 6 months, routing requests to a newer version. The team doesn't notice until response quality and cost metrics shift. Fix: subscribe to model deprecation announcements; set calendar alerts at `pinDate + 3 months` to evaluate migration; maintain a list of all model pins across all environments.

**A/B test with insufficient sample size:** Team runs an A/B test for 3 days, gets 100 samples per variant, declares the treatment winner (60% vs 55% positive rate). In production, the treatment performs at 53% — not better than control. The 3-day test had high variance (Monday-Wednesday, not representative of weekly traffic patterns; 100 samples gives insufficient power for detecting a 5% difference). Fix: calculate required sample size before starting: `n = 2 * (z_α/2 + z_β)² * p(1-p) / δ²` where δ is the minimum detectable effect; run for at least one full week.

**Shadow mode has different latency profile:** Shadow mode runs both production and new model in parallel. The shadow model is 3× slower. Under load, the extra 2 goroutines/threads per request exhaust the connection pool, causing production requests to queue. Shadow testing at 100% of production traffic with a slow new model inadvertently DDoSes production. Fix: rate-limit shadow traffic to 20% of production; run shadow with a timeout shorter than production timeout; shadow responses that time out are logged as "shadow_timeout" but don't affect users.
:::

## 🎯 Checkpoint

::: details Question 1 — Why pin model versions?
**Q:** A team uses "gpt-4o" (unversioned) in their production customer support AI. OpenAI releases a new gpt-4o snapshot that is smarter but has slightly different refusal behavior — it refuses to discuss specific pricing details that the old model would answer. What are the symptoms, how would they discover the problem, and how would they prevent it?

**A:** Symptoms: guardrail block rate increases; user satisfaction drops for pricing queries; support tickets increase. The change is invisible at the API error level (no 5xx, no timeouts). Discovery: monitoring of per-category success rate alerts on "billing" category dropping below 90%; a golden dataset regression test catches "What is the price of the Pro plan?" failing with refusal. Prevention: (1) Pin model version in all environments — `"gpt-4o-2024-11-20"` not `"gpt-4o"`. (2) Subscribe to OpenAI changelog; model updates send alerts. (3) Evaluation pipeline runs nightly against production prompts using pinned model; notifies when baseline model behavior changes. (4) Any model version change requires running full evaluation suite and getting explicit sign-off from the AI team lead.
:::

::: details Question 2 — A/B test quality metric
**Q:** You want to A/B test two system prompt versions. What metric do you measure as the primary outcome, and why can't you use traditional conversion metrics like "session length" or "button clicks"?

**A:** Primary outcome for quality: **LLM-as-Judge score on sampled conversations** combined with **user-provided explicit feedback** (thumbs up/down if surfaced). Secondary: **task completion rate** (did the user's question get resolved without escalation or follow-up?). Why traditional metrics fail: "Session length" might increase because the AI gave a bad answer and the user had to ask 5 follow-up questions to clarify — a worse experience looks like higher engagement. "Messages per session" similarly correlates with confusion. "Return rate" (user came back) might increase because the AI was bad and they had to retry, or because they liked it and came back for more — indistinguishable. Click-through on citations doesn't measure answer quality. The fundamental problem: for AI systems, engagement and quality are often inversely correlated — a perfect one-shot answer produces a short session. You need quality metrics that measure the actual helpfulness of responses, not proxies that work for recommendation systems.
:::

## Key Mental Models

- **Prompt is code — version, review, and gate it** — any un-reviewed prompt change can silently degrade quality with no technical error signal.
- **Pin model versions to avoid silent upgrades** — "gpt-4o" is not a stable identifier; pin to dated snapshots.
- **Shadow mode before canary before GA** — risk ladder: shadow (0% user exposure) → canary (5%) → gradual rollout → GA.
- **A/B tests need statistical power** — calculate minimum sample size before starting; run for at least one full weekly cycle.
- **Task completion rate is the AI equivalent of conversion rate** — but it requires AI-specific measurement (LLM judge or human annotation), not click tracking.

## Related

- [5.2 Evaluation Pipeline](/ai-engineering/module-05/02-evaluation-pipeline) — the eval pipeline that gates prompt promotions
- [6.1 Production Metrics](./01-production-metrics) — metrics monitored during A/B tests
- [Module 4 Fine-Tuning](/ai-engineering/module-10/) — model versioning considerations during fine-tuning
