---
title: Production Metrics — Latency, TTFT, Cost, Error Rate
outline: deep
---

# Production Metrics — Latency, TTFT, Cost, Error Rate

🔥🔥🔥 Interview weight | Prerequisites: [8.2 Enterprise AI Architecture](../module-08/02-enterprise-ai-architecture)

## 🗣️ In Plain English

::: tip In Plain English
Production AI systems fail in ways that are invisible without the right measurements. Your AI might technically return an answer for every request — but if it's taking 30 seconds, costing $5 per conversation, or refusing 20% of legitimate queries, you have serious problems that your uptime dashboard won't tell you.

Traditional web services care about: is it up, is it fast, are there errors? AI systems add three more dimensions.

**Token usage and cost** are the AI equivalent of database query cost. A SQL query that scans 10 million rows when it only needs 1,000 is a bug — even if it returns the right answer. Similarly, an LLM call that sends 50,000 tokens of context when 2,000 would do is a cost bug. You need to measure, attribute, and alert on token usage.

**Time to First Token (TTFT)** is specific to streaming AI responses. When a user asks a question, there's a delay before the first word appears. This is the TTFT. A 5-second TTFT feels like the system is broken even if the total response is 8 seconds. The perception of speed starts with the first token, not the last.

**Success rate** for AI isn't just "did the server return 200?". It's "did the AI actually complete the task?" An agent that times out after 10 LLM calls and says "I couldn't help with that" returned HTTP 200 but failed the user. You need AI-specific success/failure classification.

**Hallucination rate**, **refusal rate**, and **scope adherence** are quality metrics that have no analogs in traditional software. A model that refuses 30% of legitimate questions is over-filtered. A model that confidently answers questions outside its scope is under-filtered.

These metrics tell you different things. Latency tells you about speed. Cost tells you about efficiency. Success rate tells you about capability. Quality metrics tell you about accuracy. You need all of them.
:::

## ⚙️ Under the Hood

### Latency Metrics for AI Systems

AI latency has more dimensions than traditional API latency:

```typescript
// run: npx tsx latency_metrics.ts

interface AILatencyMetrics {
  // Time from user message received to first token streamed back
  timeToFirstTokenMs: number

  // Time from first token to last token (generation speed)
  timeToLastTokenMs: number

  // Total wall-clock time (TTFT + generation)
  totalLatencyMs: number

  // For RAG: time spent retrieving documents
  retrievalLatencyMs?: number

  // For agents: time spent in each tool call
  toolCallLatencies?: Array<{ tool: string; latencyMs: number }>

  // Number of LLM calls (for agents)
  llmCallCount: number
}

class LatencyTracker {
  private marks: Map<string, number> = new Map()

  mark(name: string): void {
    this.marks.set(name, Date.now())
  }

  elapsed(fromMark: string, toMark?: string): number {
    const from = this.marks.get(fromMark) ?? Date.now()
    const to = toMark ? (this.marks.get(toMark) ?? Date.now()) : Date.now()
    return to - from
  }
}

// Example: measuring TTFT in a streaming response
async function streamWithMetrics(prompt: string): Promise<AILatencyMetrics> {
  const tracker = new LatencyTracker()
  tracker.mark('request_start')

  // Simulated streaming response
  const metrics: Partial<AILatencyMetrics> = { llmCallCount: 1 }

  let firstToken = false
  // In real code: iterate over the stream
  // for await (const chunk of stream) {
  //   if (!firstToken) {
  //     tracker.mark('first_token')
  //     firstToken = true
  //   }
  // }

  tracker.mark('first_token')  // simulated
  tracker.mark('last_token')   // simulated

  return {
    timeToFirstTokenMs: tracker.elapsed('request_start', 'first_token'),
    timeToLastTokenMs: tracker.elapsed('first_token', 'last_token'),
    totalLatencyMs: tracker.elapsed('request_start', 'last_token'),
    llmCallCount: 1,
  }
}
```

**Latency SLO targets (typical):**
| Scenario | TTFT Target | Total Latency Target |
|----------|------------|---------------------|
| Chat (streaming) | < 1s | < 10s |
| RAG question answering | < 2s | < 8s |
| Background agent task | N/A | < 60s |
| Real-time voice | < 300ms | < 2s |

### Token Usage and Cost Tracking

```typescript
// run: npx tsx token_cost_tracking.ts
import { Pool } from 'pg'

interface TokenUsageRecord {
  traceId: string
  userId: string
  tenantId: string
  model: string
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number   // OpenAI prompt caching
  costUsd: number
  timestamp: Date
}

const TOKEN_COSTS: Record<string, { input: number; output: number; cachedInput?: number }> = {
  'gpt-4o': { input: 0.0025, output: 0.010, cachedInput: 0.00125 },  // per 1K tokens
  'gpt-4o-mini': { input: 0.00015, output: 0.0006, cachedInput: 0.0000750 },
  'claude-opus-4-5': { input: 0.015, output: 0.075 },
  'claude-haiku-3-5': { input: 0.00025, output: 0.00125 },
}

function computeCost(model: string, usage: {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}): number {
  const costs = TOKEN_COSTS[model]
  if (!costs) return 0

  const regularInputCost = (usage.inputTokens - (usage.cachedInputTokens ?? 0)) * costs.input / 1000
  const cachedInputCost = (usage.cachedInputTokens ?? 0) * (costs.cachedInput ?? costs.input) / 1000
  const outputCost = usage.outputTokens * costs.output / 1000

  return regularInputCost + cachedInputCost + outputCost
}

// Cost attribution: which features are most expensive?
async function getCostByFeature(pool: Pool, tenantId: string, startDate: Date): Promise<any[]> {
  const result = await pool.query(`
    SELECT
      metadata->>'feature' AS feature,
      SUM(input_tokens) AS total_input_tokens,
      SUM(output_tokens) AS total_output_tokens,
      SUM(cost_usd) AS total_cost,
      COUNT(*) AS request_count,
      AVG(cost_usd) AS avg_cost_per_request
    FROM ai_messages
    WHERE tenant_id = $1
      AND created_at >= $2
      AND role = 'assistant'
    GROUP BY metadata->>'feature'
    ORDER BY total_cost DESC
  `, [tenantId, startDate])

  return result.rows
}

// Cost efficiency metrics
function tokensPerDollar(inputTokens: number, outputTokens: number, costUsd: number): number {
  return (inputTokens + outputTokens) / costUsd
}

// Alert if single request exceeds budget
const MAX_COST_PER_REQUEST = 0.50  // $0.50
const cost = computeCost('gpt-4o', { inputTokens: 50_000, outputTokens: 2_000 })
console.log(`Cost: $${cost.toFixed(4)}`)  // ~$0.145
if (cost > MAX_COST_PER_REQUEST) {
  console.warn(`ALERT: Request cost $${cost.toFixed(4)} exceeds limit $${MAX_COST_PER_REQUEST}`)
}
```

### Error Rate and Success Rate

AI systems need two error rate concepts:

```typescript
// run: npx tsx success_metrics.ts

enum AIOutcome {
  SUCCESS = 'success',
  // Technical failures
  LLM_API_ERROR = 'llm_api_error',
  TIMEOUT = 'timeout',
  CONTEXT_LENGTH_EXCEEDED = 'context_length_exceeded',
  // AI-specific failures
  TASK_FAILED = 'task_failed',          // Agent couldn't complete the task
  BLOCKED_BY_GUARDRAIL = 'blocked_by_guardrail',
  OUT_OF_SCOPE = 'out_of_scope',
  MAX_ITERATIONS_REACHED = 'max_iterations_reached',
  // Soft failures (responded but poorly)
  LOW_CONFIDENCE_RESPONSE = 'low_confidence_response',
  ESCALATED_TO_HUMAN = 'escalated_to_human',
}

interface AIRequestResult {
  traceId: string
  outcome: AIOutcome
  httpStatus: number   // always 200 for AI-specific failures!
  responseTimeMs: number
  userFeedback?: 'thumbs_up' | 'thumbs_down'
}

// Traditional error rate = count(5xx) / total — useless for AI
function technicalErrorRate(results: AIRequestResult[]): number {
  return results.filter(r => r.httpStatus >= 500).length / results.length
}

// AI success rate = count(actually helpful responses) / total
function aiSuccessRate(results: AIRequestResult[]): number {
  const successful = results.filter(r => r.outcome === AIOutcome.SUCCESS).length
  return successful / results.length
}

// Task completion rate = exclude blocks and escalations from denominator
function taskCompletionRate(results: AIRequestResult[]): number {
  const attempts = results.filter(r =>
    r.outcome !== AIOutcome.BLOCKED_BY_GUARDRAIL &&
    r.outcome !== AIOutcome.OUT_OF_SCOPE
  )
  const completed = attempts.filter(r => r.outcome === AIOutcome.SUCCESS)
  return completed.length / attempts.length
}

// Guardrail block rate (should be low for legitimate users)
function guardrailBlockRate(results: AIRequestResult[]): number {
  return results.filter(r => r.outcome === AIOutcome.BLOCKED_BY_GUARDRAIL).length / results.length
}
```

### Dashboard Metrics: What to Track

```typescript
// run: npx tsx dashboard_metrics.ts

interface AIMetricsDashboard {
  // Volume
  requestsPerMinute: number
  activeUsers24h: number

  // Latency (always use percentiles, not average)
  p50LatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  p50TtftMs: number        // Time to first token
  p95TtftMs: number

  // Quality
  successRate: number
  taskCompletionRate: number
  guardrailBlockRate: number
  userThumbsUpRate: number  // from explicit feedback

  // Cost
  totalCostToday: number
  avgCostPerRequest: number
  costByModel: Record<string, number>
  tokenEfficiency: number  // useful tokens / total tokens

  // Errors (technical)
  errorRate: number
  llmProviderErrorRate: number
  timeoutRate: number

  // Model performance
  avgInputTokens: number
  avgOutputTokens: number
  cacheHitRate: number     // semantic cache + prompt cache
}

// Alert thresholds
const ALERTS = {
  p99LatencyMs: { warning: 15_000, critical: 30_000 },
  successRate: { warning: 0.90, critical: 0.80 },      // below = alert
  guardrailBlockRate: { warning: 0.05, critical: 0.10 }, // above = alert
  costPerDay: { warning: 1_000, critical: 2_000 },
  errorRate: { warning: 0.01, critical: 0.05 },
}

function checkAlerts(metrics: AIMetricsDashboard): string[] {
  const alerts: string[] = []

  if (metrics.p99LatencyMs > ALERTS.p99LatencyMs.critical) {
    alerts.push(`CRITICAL: p99 latency ${metrics.p99LatencyMs}ms exceeds ${ALERTS.p99LatencyMs.critical}ms`)
  }
  if (metrics.successRate < ALERTS.successRate.critical) {
    alerts.push(`CRITICAL: success rate ${(metrics.successRate * 100).toFixed(1)}% below threshold`)
  }
  if (metrics.guardrailBlockRate > ALERTS.guardrailBlockRate.critical) {
    alerts.push(`CRITICAL: guardrail block rate ${(metrics.guardrailBlockRate * 100).toFixed(1)}% — possible attack or misconfiguration`)
  }

  return alerts
}
```

### Prompt Cache Hit Rate

Many LLM providers (OpenAI, Anthropic) cache the prefix of repeated prompts. This reduces latency and cost significantly:

```typescript
// run: npx tsx prompt_cache_metrics.ts

interface PromptCacheMetrics {
  // Prompt caching (provider-level)
  promptCacheReadTokens: number   // tokens served from cache (discounted cost)
  promptCacheWriteTokens: number  // tokens written to cache (standard cost first time)
  cacheHitRatio: number           // read / (read + total input)

  // Semantic cache (application-level)
  semanticCacheHits: number
  semanticCacheMisses: number
  semanticCacheHitRatio: number
  semanticCacheSavingsUsd: number
}

// Prompt caching works when the beginning of prompts is identical
// High cache hit ratio = system prompt is stable, beneficial
// Example: system prompt of 5000 tokens, user message of 200 tokens
// If system prompt is cached: pay for 200 input tokens instead of 5200
const cachedCostSavings = 5000 * 0.0025 / 1000 * 0.5  // 50% discount for cached tokens
console.log(`Savings per request from prompt cache: $${cachedCostSavings.toFixed(5)}`)
// At 100K requests/day: 100_000 * cachedCostSavings = significant savings
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**TTFT is high because retrieval is synchronous:** A RAG system retrieves documents synchronously before calling the LLM. The user sees nothing for 3 seconds (retrieval: 1.5s + LLM start: 1.5s) before streaming begins. Fix: start the LLM call with a placeholder context as soon as the query arrives, then update it when retrieval completes (requires a more complex orchestration); or parallelize retrieval and prompt construction; or use streaming retrieval if supported by the vector DB.

**Cost spike from runaway agent:** An agent encounters an unexpected error response from a tool, enters a retry loop, and makes 50 LLM calls over 2 minutes. The task costs $12 and fails. Traditional error rate monitoring never fires (no HTTP errors). Cost spike alert fires 10 minutes later. Fix: per-request cost cap enforced at orchestrator level before each LLM call; abort if projected cost exceeds limit; hard iteration cap (never > 15 for any agent task).

**Guardrail block rate spikes to 25%:** An overly aggressive content policy update blocks "How do I cancel my subscription?" as potentially harmful. 25% of legitimate queries are refused. User satisfaction drops, support tickets spike. Root cause: guardrail regex matched "cancel" (in the context of "cancel subscription") and flagged it. Fix: monitor guardrail block rate by category; use semantic intent classification rather than keyword matching for guardrails; add whitelist for known-safe intents.

**Average latency misleads:** Average latency is 2.5 seconds. p99 latency is 45 seconds. 1% of users wait 45+ seconds and abandon. Average looks fine, but 1% of your highest-value users (often enterprise accounts with complex queries) are having a terrible experience. Always monitor percentiles (p50, p95, p99). Alert on p99, not average.
:::

## 🎯 Checkpoint

::: details Question 1 — TTFT optimization
**Q:** Your RAG system has a TTFT of 4 seconds. Describe three architectural changes you could make to reduce it to under 1 second, and what tradeoffs each involves.

**A:** (1) **Parallelize retrieval and LLM initialization**: Start the LLM API call immediately with an empty or minimal context, then inject retrieved context via prompt caching or streaming. Complex but reduces TTFT to ~max(retrieval_time, LLM_startup_time). Tradeoff: requires LLM provider support for context injection mid-stream; increases implementation complexity. (2) **Move retrieval to background**: On query receipt, immediately start streaming a "thinking" indicator from a cached cheap model response, while retrieval happens in the background. When retrieval completes, either re-prompt or append context. Tradeoff: user sees fake progress; response quality may suffer if context arrives late. (3) **Pre-retrieve on query prediction**: If users type queries incrementally (like a search box), start retrieval after 3 words with the partial query and update as they finish. By the time they submit, retrieval is partially done. Tradeoff: wasted retrieval calls for abandoned queries; only works for interactive interfaces. For all three: measure separately `retrieval_ms` and `llm_first_token_ms` to know which is the actual bottleneck.
:::

::: details Question 2 — Cost attribution
**Q:** You're managing a multi-tenant AI platform. Tenant A has 10 users and spent $8,000 last month. Tenant B has 200 users and spent $1,200. What does this tell you, and what actions do you take?

**A:** Tenant A averages $800/user/month vs Tenant B's $6/user/month — a 133× difference. Possible causes: (1) Tenant A uses agents with many LLM calls; Tenant B uses simple chatbot. (2) Tenant A sends very long contexts (large document processing); Tenant B sends short queries. (3) Tenant A's prompt is inefficient (redundant system prompt content); Tenant B's is optimized. (4) Tenant A could be misusing the platform (bulk automation). Actions: (a) Break down Tenant A's cost by feature, model, average input tokens per request. (b) If long contexts: audit their system prompt for redundancy; implement prompt compression. (c) If many agent calls: check for inefficient tool loops; increase iteration limits only if legitimate. (d) If bulk automation beyond their tier: throttle and discuss pricing. (e) Set per-tenant monthly budget alerts so you know before month-end. (f) Consider tiered pricing based on token consumption rather than user count for heavy users.
:::

## Key Mental Models

- **Track TTFT separately from total latency** — users perceive the start of a response, not just the end; TTFT drives perceived responsiveness.
- **AI success rate ≠ HTTP 200 rate** — define and track AI-specific outcomes (task completed, escalated, blocked, failed).
- **Always monitor cost per request, not just total cost** — a cost spike might be new traffic (good) or runaway agent loop (bad); per-request cost distinguishes them.
- **Alert on p99 latency, not average** — average hides the worst user experiences which are often your most demanding users.
- **Guardrail block rate should be low** — high block rate means either you're under attack or your policy is over-filtering.

## Related

- [9.1 RAG Evaluation Metrics](./01-rag-evaluation-metrics) — quality metrics to complement these operational metrics
- [9.3 Evaluation Pipeline](./03-evaluation-pipeline) — how to automate measurement
- [8.2 Enterprise AI Architecture](../module-08/02-enterprise-ai-architecture) — where these metrics are collected
