# Multi-Cloud AI — Azure, AWS Bedrock & Google Vertex AI

🔥🔥 Interview weight | Prerequisites: [11.3 AKS & Azure](./03-aks-and-azure), [11.4 AI Infrastructure Patterns](./04-ai-infrastructure-patterns), [3.3 Reliability & Fallbacks](../module-03/03-reliability-and-fallbacks)

::: info Plain English
Module 11.3 focuses on Azure, which is a strong choice in the UAE. But in practice you'll meet all three big clouds: a bank on Azure, an airline on AWS, a retailer on Google Cloud. Many companies use more than one.

Each cloud offers the same basic idea: **managed access to LLMs inside the cloud account the company already trusts**, with its security, billing, networking and compliance controls. They differ in which models they offer, their agent and RAG tooling, and which regions have which models.

You don't need to master all three. You need to know **what each offers, how they map to each other, and how to design so switching isn't a rewrite**.
:::

::: warning Fast-changing catalogues
Model catalogues, product names and regional availability change frequently. Check current docs, especially for which models are available in UAE or other Middle East regions.
:::

## Why Use a Cloud Platform Instead of the Model Provider's API?

| Reason | Detail |
| --- | --- |
| **Existing contracts and billing** | Spend counts against committed cloud spend; no new vendor approval |
| **Security and networking** | Private endpoints, VPC/VNet integration, the company's IAM |
| **Data residency** | In-region deployment (see [8.4](../module-08/04-arabic-and-sovereign-ai)) |
| **Compliance** | Inherits the cloud's certifications and audit tooling |
| **Model choice** | Several model families behind one account |

Trade-offs: new models and features sometimes reach the provider's own API first, quotas can be tighter, and APIs differ slightly from the provider's native API.

## The Three Platforms at a Glance

| Capability | Azure (Azure AI Foundry / Microsoft Foundry) | AWS (Amazon Bedrock) | Google Cloud (Vertex AI) |
| --- | --- | --- | --- |
| **Flagship models** | OpenAI models (Azure OpenAI), plus a broad catalogue of other vendors' and open models | Anthropic Claude, Amazon Nova, Meta Llama, Mistral and others | Gemini, plus Claude and open models via Model Garden |
| **Unified model API** | Foundry model inference APIs | Converse API (one request format across models) | Vertex AI APIs / Gen AI SDK |
| **Managed RAG** | Azure AI Search + "on your data" patterns | Bedrock Knowledge Bases | Vertex AI Search, RAG Engine, Vector Search |
| **Agents** | Foundry Agent Service; Microsoft Agent Framework | Bedrock Agents; AgentCore for running custom agents | Agent Engine; Agent Development Kit (ADK) |
| **Guardrails / safety** | Azure AI Content Safety | Bedrock Guardrails | Model safety settings; Model Armor |
| **Evaluation** | Foundry evaluation tools | Bedrock model evaluation | Vertex AI evaluation service |
| **Self-hosted GPUs** | AKS, Azure ML | EKS, SageMaker | GKE, Vertex endpoints |
| **Typical strength** | Microsoft-centric enterprises, OpenAI access, strong Gulf enterprise presence | Broadest AWS-native ecosystem, Claude access, mature infra | Gemini, long context and multimodal, data/analytics integration |

## Mapping Concepts Across Clouds

When moving between clouds, most concepts translate one-to-one:

| Concept | Azure | AWS | GCP |
| --- | --- | --- | --- |
| Identity for services | Managed Identity / Entra ID | IAM roles | Service accounts |
| Private network access | Private Endpoint | VPC endpoint (PrivateLink) | Private Service Connect |
| Secrets | Key Vault | Secrets Manager | Secret Manager |
| Kubernetes | AKS | EKS | GKE |
| Vector search | AI Search | OpenSearch / Aurora pgvector / S3 Vectors | Vector Search / AlloyDB pgvector |
| Observability | Azure Monitor / App Insights | CloudWatch / X-Ray | Cloud Monitoring / Trace |

**Portable default:** Postgres with pgvector is available on all three clouds (and on-prem). It's a solid choice when portability matters more than peak vector-search features.

## Designing for Portability

Put a thin **model gateway** between your application and any provider:

```typescript
// llm-gateway.ts
export interface ChatRequest {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  tools?: ToolDefinition[]
  maxTokens: number
  logicalModel: 'fast' | 'smart' | 'reasoning'   // Business code never names a vendor model
}

export interface ChatResponse {
  text: string
  toolCalls: ToolCall[]
  usage: { inputTokens: number; outputTokens: number }
  provider: string
}

export interface LLMProvider {
  name: string
  chat(req: ChatRequest): Promise<ChatResponse>
}

// One adapter per platform: AzureFoundryProvider, BedrockProvider, VertexProvider, SelfHostedVllmProvider
const ROUTES: Record<ChatRequest['logicalModel'], LLMProvider[]> = {
  fast:      [bedrockFast, azureFast],        // Primary, then fallback
  smart:     [azureSmart, vertexSmart],
  reasoning: [bedrockReasoning],
}

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const providers = ROUTES[req.logicalModel]
  let lastError: unknown
  for (const p of providers) {
    try {
      return await p.chat(req)
    } catch (err) {
      lastError = err
      if (!isRetryableAcrossProviders(err)) throw err   // e.g. don't fail over on a content-policy block
    }
  }
  throw lastError
}
```

You can build this yourself or use an open-source gateway (such as LiteLLM) deployed inside your own network.

Portability rules:
- **Logical model names** in business code (`fast`, `smart`), mapped to vendor models in config.
- **Provider-neutral tool definitions** (JSON Schema), converted per adapter.
- **Evals per provider:** a fallback model that scores 15% worse is not a real fallback. Run your eval suite against every model in a route.
- **Prompt variants:** keep per-model prompt overrides where a model family needs different phrasing.
- **Data residency per route:** a fallback must not send regulated data to a region it isn't allowed in.

## Choosing in Practice

Usually the choice is made for you by the company's existing cloud. When it isn't:

| Situation | Leaning |
| --- | --- |
| Company runs on Microsoft 365, Entra ID, .NET | Azure |
| Need OpenAI models with enterprise controls | Azure |
| Existing AWS estate; want Claude with AWS controls | AWS Bedrock |
| Want Gemini (long context, multimodal) or deep BigQuery integration | Google Vertex AI |
| Strict sovereignty, local provider mandated | Local sovereign cloud or self-hosted, see [8.4](../module-08/04-arabic-and-sovereign-ai) |
| Need best model per task across vendors | Multi-cloud behind a gateway |

::: danger Where It Bites
**Quota surprise at launch:** Load testing used a personal API key; production uses a cloud deployment with a much lower default quota. Launch day hits throttling. Fix: request quota increases early; load test on the real production deployment; configure fallbacks.

**"Same model", different behaviour:** The same model family on two platforms differs in version, default parameters or supported features (e.g. some caching or tool features arrive later). Fix: pin model versions explicitly and run evals on each platform deployment.

**Fallback breaks residency:** An outage triggers failover to a model in another region, sending regulated data abroad. Fix: residency constraints are part of routing config; restricted data has only compliant fallbacks, or fails closed.

**Leaky abstraction:** The gateway supports only the lowest common denominator, so the team can't use prompt caching or structured outputs. Fix: allow provider-specific features via optional capabilities flags, with a graceful path when unavailable.
:::

## Interview Questions

::: details Q1 — Why run models through a cloud platform instead of the provider's direct API?
Enterprise controls: existing contracts and committed spend, IAM and private networking, in-region deployment for residency, and inherited compliance certifications. The trade-offs are that new features may lag the direct API, quotas need managing, and the API surface differs slightly, which is why a gateway abstraction helps.
:::

::: details Q2 — How would you design an LLM layer that can move between Azure and AWS?
A gateway with logical model names and provider adapters; provider-neutral tool schemas; per-model prompt overrides; evals run against every model in each route so fallbacks are proven; residency constraints encoded in routing; and portable supporting infra (Postgres + pgvector, OpenTelemetry tracing, Kubernetes) so the rest of the stack isn't tied to one cloud.
:::

::: details Q3 — Your primary model provider has a regional outage. What should happen?
The gateway fails over to the next provider in the route, but only if that provider meets the request's data classification and residency constraints, and only for retryable errors (not content-policy blocks). Streaming responses in progress are failed cleanly. Alerts fire, and quality is monitored because the fallback model may score differently. For restricted data with no compliant fallback, fail closed with a clear user message and queue work where possible.
:::

## Key Mental Models

- **The company's cloud usually decides.** Know all three well enough to map concepts.
- **Logical models in code, vendor models in config.**
- **A fallback isn't real until it passes your evals.**
- **Residency is a routing constraint.** Failover must never break it.
- **pgvector + Kubernetes + OpenTelemetry travel everywhere.**

## Related

- [11.3 AKS & Azure](./03-aks-and-azure) — the Azure deep dive
- [3.3 Reliability & Fallbacks](../module-03/03-reliability-and-fallbacks) — retry and fallback patterns
- [8.4 Arabic LLMs & Sovereign AI](../module-08/04-arabic-and-sovereign-ai) — residency requirements
- [2.10 Agent Framework Landscape](../module-02/10-agent-frameworks) — cloud agent services vs frameworks
