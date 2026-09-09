---
title: Enterprise AI Architecture — The Full Stack
outline: deep
---

# Enterprise AI Architecture — The Full Stack

🔥🔥🔥 Interview weight | Prerequisites: [8.1 AI System Patterns](./01-ai-system-patterns)

## 🗣️ In Plain English

::: tip In Plain English
A production AI system is like a well-designed building: the exciting part (the LLM) is just one floor. The building also needs a lobby that controls who enters (API Gateway), a security desk that checks IDs (Auth/RBAC), an elevator that routes people to the right floor (Orchestrator), a filing system (data stores), emergency exits (fallback/failover), and a security camera system (observability).

Most developers start by wiring a user directly to an LLM. That works for demos. It fails for production because:

- Anyone can call it (no auth)
- Any amount can be spent (no rate limiting)
- There's no record of what happened (no observability)
- One LLM failure brings everything down (no fallback)
- The LLM can return anything (no guardrails)
- Every team builds their own integration (no reuse)

The enterprise AI architecture solves all of these. It's a layered system where each layer has one job. The API Gateway handles traffic and authentication. The Orchestrator handles AI logic and routing. The LLM layer handles inference. Guardrails handle safety. Business systems handle the actual data and actions. Redis handles caching and rate limiting. Every layer emits telemetry into an observability system.

Understanding this architecture is the difference between an AI engineer who can build demos and one who can build systems that run in production at scale.
:::

## ⚙️ Under the Hood

### The Full Enterprise Stack

```
                        ┌─────────────────────────────────────┐
                        │           Clients                    │
                        │  Web / Mobile / API / Internal Tools │
                        └──────────────┬──────────────────────┘
                                       │
                        ┌──────────────▼──────────────────────┐
                        │         API Gateway                  │
                        │  • TLS termination                   │
                        │  • Rate limiting (per user/tenant)   │
                        │  • Request validation                │
                        │  • JWT authentication                │
                        │  • Routing to services               │
                        │  • Request/response logging          │
                        └──────────────┬──────────────────────┘
                                       │
                     ┌─────────────────▼─────────────────────┐
                     │           Auth / RBAC Layer             │
                     │  • Token validation                     │
                     │  • Permission checks                    │
                     │  • Tenant isolation                     │
                     │  • Audit logging                        │
                     └─────────────────┬─────────────────────┘
                                       │
                     ┌─────────────────▼─────────────────────┐
                     │         Orchestrator Service            │
                     │  • Session management                   │
                     │  • Prompt construction                  │
                     │  • Tool routing                         │
                     │  • Result aggregation                   │
                     │  • Agent loop management                │
                     │  • Context window management            │
                     └──┬───────────────┬──────────────┬──────┘
                        │               │              │
             ┌──────────▼──┐  ┌─────────▼──┐  ┌──────▼──────┐
             │  RAG Engine │  │   Agents   │  │  Direct LLM  │
             │  Retrieval  │  │   (Tools)  │  │   (Simple)   │
             └──────┬──────┘  └────┬───────┘  └──────────────┘
                    │              │
     ┌──────────────▼──────────────▼─────────────────────────┐
     │                    LLM Layer                            │
     │   Primary: Azure OpenAI / Anthropic Claude              │
     │   Fallback: Secondary provider (automatic)              │
     │   Local: vLLM on GPU nodes (for sensitive data)         │
     └────────────────────────┬──────────────────────────────┘
                              │
     ┌────────────────────────▼──────────────────────────────┐
     │                  Guardrails Layer                       │
     │  • Input: PII detection, prompt injection detection     │
     │  • Output: content filtering, hallucination detection   │
     │  • Business rules: scope enforcement                    │
     └────────────────────────┬──────────────────────────────┘
                              │
     ┌────────────────────────▼──────────────────────────────┐
     │              Business Systems Layer                     │
     │  CRM / ERP / Database / External APIs                  │
     └───────────────────────────────────────────────────────┘

     ┌─────────────────────────────────────────────────────┐
     │ Cross-cutting: Redis (cache/rate limit), PostgreSQL  │
     │ (conversations/audit), Observability (traces/metrics)│
     └─────────────────────────────────────────────────────┘
```

### API Gateway Layer

The gateway is the entry point for all AI requests. In enterprise deployments, this is typically Azure API Management, Kong, or AWS API Gateway.

```typescript
// run: npx tsx api_gateway_config.ts
// Illustrative: not a real gateway implementation

interface RateLimitConfig {
  tenantId: string
  requestsPerMinute: number
  tokensPerDay: number
  concurrentRequests: number
}

interface GatewayMiddleware {
  validateAuth(token: string): Promise<{ userId: string; tenantId: string; permissions: string[] }>
  checkRateLimit(tenantId: string): Promise<boolean>
  validateRequest(body: unknown): { valid: boolean; errors: string[] }
  logRequest(req: Record<string, unknown>): void
}

// Real implementation uses Kong plugins, APIM policies, or custom NestJS guards:
// @UseGuards(JwtAuthGuard, RateLimitGuard, TenantGuard)
// @Post('/ai/chat')
// async chat(@User() user: AuthUser, @Body() dto: ChatDto) { ... }
```

### Auth and RBAC for AI

AI-specific RBAC goes beyond basic user roles:

```typescript
// run: npx tsx ai_rbac.ts

interface AIPermissions {
  // Feature access
  canUseAgents: boolean
  canUseRAG: boolean
  maxContextLength: number

  // Data access for RAG
  allowedDocumentCollections: string[]
  allowedDataSources: string[]

  // Agent tool permissions
  allowedTools: string[]
  canTriggerExternalAPIs: boolean

  // Cost controls
  monthlyTokenBudget: number
  maxSingleRequestCost: number
}

const rolePermissions: Record<string, AIPermissions> = {
  'basic_user': {
    canUseAgents: false,
    canUseRAG: true,
    maxContextLength: 8000,
    allowedDocumentCollections: ['public_docs'],
    allowedDataSources: ['public_kb'],
    allowedTools: [],
    canTriggerExternalAPIs: false,
    monthlyTokenBudget: 100_000,
    maxSingleRequestCost: 0.10,
  },
  'power_user': {
    canUseAgents: true,
    canUseRAG: true,
    maxContextLength: 32_000,
    allowedDocumentCollections: ['public_docs', 'internal_docs'],
    allowedDataSources: ['public_kb', 'crm_readonly'],
    allowedTools: ['search', 'read_ticket', 'read_customer'],
    canTriggerExternalAPIs: false,
    monthlyTokenBudget: 1_000_000,
    maxSingleRequestCost: 1.00,
  },
  'admin': {
    canUseAgents: true,
    canUseRAG: true,
    maxContextLength: 128_000,
    allowedDocumentCollections: ['*'],
    allowedDataSources: ['*'],
    allowedTools: ['*'],
    canTriggerExternalAPIs: true,
    monthlyTokenBudget: 10_000_000,
    maxSingleRequestCost: 10.00,
  }
}

class AIPermissionGuard {
  checkToolPermission(userId: string, role: string, toolName: string): boolean {
    const perms = rolePermissions[role]
    if (!perms) return false
    if (perms.allowedTools.includes('*')) return true
    return perms.allowedTools.includes(toolName)
  }

  checkDocumentAccess(userId: string, role: string, collection: string): boolean {
    const perms = rolePermissions[role]
    if (!perms) return false
    if (perms.allowedDocumentCollections.includes('*')) return true
    return perms.allowedDocumentCollections.includes(collection)
  }
}
```

### Orchestrator Service

The orchestrator is the "brain" of the AI system. It:
- Receives the user request
- Determines which AI path to take (chatbot, RAG, agent)
- Manages the conversation context
- Routes tool calls
- Handles fallbacks when LLMs fail

```typescript
// run: npx tsx orchestrator.ts
import { OpenAI } from 'openai'

interface OrchestratorConfig {
  primaryModel: string
  fallbackModel: string
  maxRetries: number
  timeoutMs: number
}

class AIOrchestrator {
  private client: OpenAI
  private config: OrchestratorConfig

  constructor(config: OrchestratorConfig) {
    this.client = new OpenAI()
    this.config = config
  }

  async chat(params: {
    userId: string
    sessionId: string
    message: string
    permissions: string[]
    conversationHistory: OpenAI.ChatCompletionMessageParam[]
  }): Promise<{ response: string; tokensUsed: number; model: string; latencyMs: number }> {
    const startTime = Date.now()

    // Try primary model with fallback
    for (const model of [this.config.primaryModel, this.config.fallbackModel]) {
      try {
        const response = await Promise.race([
          this.client.chat.completions.create({
            model,
            messages: params.conversationHistory,
            max_tokens: 2000,
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), this.config.timeoutMs)
          )
        ]) as OpenAI.ChatCompletion

        return {
          response: response.choices[0].message.content ?? '',
          tokensUsed: response.usage?.total_tokens ?? 0,
          model,
          latencyMs: Date.now() - startTime,
        }
      } catch (err) {
        console.error(`Model ${model} failed:`, err)
        if (model === this.config.fallbackModel) throw err
        // Continue to fallback
      }
    }

    throw new Error('All models failed')
  }
}
```

### Redis as Cross-Cutting Infrastructure

Redis serves multiple roles in enterprise AI:

```typescript
// run: npx tsx redis_ai.ts
import { createClient } from 'redis'

const redis = createClient({ url: process.env.REDIS_URL })
await redis.connect()

class AIRedisLayer {
  // 1. Rate limiting: sliding window per user
  async checkRateLimit(userId: string, limitPerMinute: number): Promise<boolean> {
    const key = `ratelimit:${userId}:${Math.floor(Date.now() / 60_000)}`
    const count = await redis.incr(key)
    if (count === 1) await redis.expire(key, 60)
    return count <= limitPerMinute
  }

  // 2. Token budget tracking per user/month
  async trackTokenUsage(userId: string, tokensUsed: number): Promise<number> {
    const monthKey = `tokens:${userId}:${new Date().toISOString().slice(0, 7)}`
    const total = await redis.incrBy(monthKey, tokensUsed)
    if (total === tokensUsed) await redis.expire(monthKey, 60 * 60 * 24 * 35) // 35 days
    return total
  }

  // 3. Semantic cache: cache LLM responses for identical/similar queries
  async getCachedResponse(cacheKey: string): Promise<string | null> {
    return redis.get(`llm_cache:${cacheKey}`)
  }

  async setCachedResponse(cacheKey: string, response: string, ttlSeconds: number): Promise<void> {
    await redis.setEx(`llm_cache:${cacheKey}`, ttlSeconds, response)
  }

  // 4. Session state: conversation history for stateless services
  async getConversationHistory(sessionId: string): Promise<unknown[]> {
    const data = await redis.get(`session:${sessionId}`)
    return data ? JSON.parse(data) : []
  }

  async saveConversationHistory(sessionId: string, history: unknown[]): Promise<void> {
    await redis.setEx(`session:${sessionId}`, 3600, JSON.stringify(history)) // 1hr TTL
  }
}
```

### LLM Failover and Multi-Provider Setup

```typescript
// run: npx tsx llm_failover.ts
import OpenAI from 'openai'
import Anthropic from '@anthropic-ai/sdk'

interface LLMProvider {
  name: string
  call(messages: Array<{ role: string; content: string }>): Promise<string>
}

const openaiProvider: LLMProvider = {
  name: 'openai-gpt4o',
  async call(messages) {
    const client = new OpenAI()
    const res = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: messages as OpenAI.ChatCompletionMessageParam[],
    })
    return res.choices[0].message.content ?? ''
  }
}

const anthropicProvider: LLMProvider = {
  name: 'anthropic-claude',
  async call(messages) {
    const client = new Anthropic()
    const res = await client.messages.create({
      model: 'claude-opus-4-5',
      max_tokens: 2000,
      messages: messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    })
    return res.content[0].type === 'text' ? res.content[0].text : ''
  }
}

async function callWithFailover(
  messages: Array<{ role: string; content: string }>,
  providers: LLMProvider[] = [openaiProvider, anthropicProvider]
): Promise<{ response: string; provider: string }> {
  for (const provider of providers) {
    try {
      const response = await provider.call(messages)
      return { response, provider: provider.name }
    } catch (err) {
      console.error(`Provider ${provider.name} failed:`, err)
    }
  }
  throw new Error('All providers failed')
}
```

### Observability and Audit

Every AI request must be traceable for compliance, debugging, and cost attribution:

```typescript
// run: npx tsx ai_observability.ts
interface AITrace {
  traceId: string
  userId: string
  tenantId: string
  sessionId: string
  timestamp: string

  request: {
    message: string
    model: string
    systemPrompt: string
    context?: string  // RAG retrieved context
  }

  response: {
    content: string
    model: string          // may differ from requested if fallback
    inputTokens: number
    outputTokens: number
    latencyMs: number
    cost: number           // computed from token counts
  }

  tools?: Array<{          // for agent traces
    name: string
    args: Record<string, unknown>
    result: string
    latencyMs: number
    success: boolean
  }>

  guardrails?: {
    inputFlags: string[]   // e.g., ['pii_detected', 'prompt_injection_attempt']
    outputFlags: string[]
    blocked: boolean
  }
}

class AIAuditLogger {
  async logTrace(trace: AITrace): Promise<void> {
    // Write to PostgreSQL for queryable audit trail
    // Also stream to observability platform (Datadog, Grafana)
    // For compliance: immutable append-only storage required
    console.log('[AUDIT]', JSON.stringify({
      traceId: trace.traceId,
      userId: trace.userId,
      cost: trace.response.cost,
      latency: trace.response.latencyMs,
      blocked: trace.guardrails?.blocked ?? false,
    }))
  }
}
```

### Cost Management Architecture

```typescript
// run: npx tsx cost_management.ts
const TOKEN_COSTS = {
  'gpt-4o': { input: 0.0025 / 1000, output: 0.01 / 1000 },           // per token
  'gpt-4o-mini': { input: 0.000150 / 1000, output: 0.000600 / 1000 },
  'claude-opus-4-5': { input: 0.015 / 1000, output: 0.075 / 1000 },
  'claude-haiku-3-5': { input: 0.00025 / 1000, output: 0.00125 / 1000 },
} as const

type ModelName = keyof typeof TOKEN_COSTS

function computeCost(model: ModelName, inputTokens: number, outputTokens: number): number {
  const costs = TOKEN_COSTS[model]
  return costs.input * inputTokens + costs.output * outputTokens
}

// Route to cheapest model that meets quality requirements
function selectModel(requirements: {
  qualityRequired: 'high' | 'medium' | 'low'
  maxLatencyMs: number
  maxCostDollars: number
  estimatedInputTokens: number
}): ModelName {
  if (requirements.qualityRequired === 'high' || requirements.maxCostDollars > 0.50) {
    return 'gpt-4o'
  }
  if (requirements.qualityRequired === 'medium' && requirements.estimatedInputTokens < 10_000) {
    return 'gpt-4o-mini'
  }
  return 'gpt-4o-mini'
}

// Example: estimate cost before making the call
const model: ModelName = 'gpt-4o'
const estimatedCost = computeCost(model, 5_000, 1_000)
console.log(`Estimated cost: $${estimatedCost.toFixed(4)}`)  // ~$0.023
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**No rate limiting on LLM endpoints:** A customer with a free trial discovers the endpoint and runs bulk automation. 50,000 requests in an hour consuming $800 of LLM credits before the alert fires. Fix: per-user rate limits in Redis (sliding window), per-tenant monthly token budgets, spending alerts at 50/80/100% of budget, request queuing for burst traffic.

**Multi-tenant data leakage via shared context:** An orchestrator accidentally includes another tenant's conversation history in the context window due to a session ID collision bug. One user sees another user's private data in the LLM's "memory". Root cause: session IDs not namespaced by tenant. Fix: always namespace all Redis keys, DB queries, and context by `{tenantId}:{userId}:{sessionId}`. Integration tests that verify tenant isolation.

**Fallback model produces different behavior:** Primary model (GPT-4o) is circuit-broken; fallback (GPT-4o-mini) responds. Mini has a shorter context window — long conversation history is truncated. The model "forgets" earlier conversation context. User sees the assistant forgetting what was said 10 messages ago. Fix: track the current model's context limit and trim history before the call; use different truncation strategies per model.

**Observability gap for compliance audit:** A regulated financial firm runs an AI advisor. A user claims the AI gave them specific investment advice. The firm has no logs of the exact LLM input/output — only the final displayed response. They can't prove what the model actually said vs what the user heard. Fix: immutable audit logs of every LLM call (input messages, output, model, timestamp, userId) stored with WORM (Write Once Read Many) semantics.
:::

## 🎯 Checkpoint

::: details Question 1 — Architecture design
**Q:** You're designing an enterprise AI assistant for a bank. The assistant needs to answer questions about customer accounts, apply GDPR data access rights (some data hidden from some employees), and escalate to human agents. Describe the architecture.

**A:** Key components: (1) **API Gateway** with mutual TLS, JWT auth, DDoS protection, audit logging of all requests. (2) **Auth/RBAC service**: role-based document collection access (branch staff see only their branch's customers; analysts see anonymized aggregate data). GDPR right-to-access checks before any data retrieval. (3) **Orchestrator**: routes to RAG for account FAQs, routes to SQL agent (read-only, parameterized queries only) for account data, routes to escalation handler when confidence is low or topic is out-of-scope. (4) **LLM layer**: Azure OpenAI (data residency in EU for GDPR compliance). No third-party models that would require data leaving the tenant boundary. (5) **Guardrails**: PII detection on outputs (mask account numbers before display), scope enforcement (no investment advice, refer to qualified advisors), confidence scoring. (6) **Human escalation**: structured handoff with conversation summary to human agent when escalation triggered. (7) **Audit**: immutable log every LLM call with user ID, timestamp, exact input/output. Retain for 7 years (financial compliance).
:::

::: details Question 2 — Semantic caching
**Q:** How would you implement semantic caching for an AI assistant where identical or very similar questions from different users should return cached responses?

**A:** Semantic caching has three steps: (1) **Embed the incoming query** with the same embedding model used for retrieval. (2) **Search the cache** (Redis or a vector index) for cached responses whose embeddings are within a cosine similarity threshold (e.g., 0.95) of the incoming query. If found and not expired, return the cached response without an LLM call. (3) **Cache misses** go to the LLM; the response is stored with its query embedding, TTL, and any contextual metadata. Key design decisions: threshold tuning (too low → false cache hits; too high → no cache benefit); TTL per content type (pricing info: 5 min; policy docs: 24 hr; general knowledge: 7 days); cache invalidation when underlying documents change (webhook → purge affected cache entries). Semantic cache is most effective for high-volume assistants with predictable query patterns (FAQ, common policy questions). Redis with vector search extension or a dedicated vector cache can serve sub-millisecond lookup.
:::

## Key Mental Models

- **Every LLM endpoint needs rate limiting, auth, and cost attribution** — the minimum viable production layer before exposing any AI to real users.
- **Redis is the nervous system of AI infrastructure** — rate limits, session state, semantic cache, token budget tracking.
- **Fallback models must handle different context window sizes** — trim history before the call, not inside the LLM.
- **Audit logs are a compliance requirement** — immutable, tamper-evident logs of every AI interaction for regulated industries.
- **RBAC for AI includes data access, tool permissions, and cost limits** — not just feature toggles.

## Related

- [8.1 AI System Patterns](./01-ai-system-patterns) — the patterns this architecture wraps
- [Module 9 LLMOps](/ai-engineering/module-09/) — monitoring and evaluating the systems built here
- [Module 11 Security](/ai-engineering/module-11/) — security considerations for this architecture
