---
title: AI System Patterns — Chatbot, RAG, Agent
outline: deep
---

# AI System Patterns — Chatbot, RAG, Agent

🔥🔥🔥 Interview weight | Prerequisites: [Module 1 LLMs & Prompting](/ai-engineering/module-01/), [Module 2 Agents](/ai-engineering/module-02/)

## 🗣️ In Plain English

::: tip In Plain English
There are three fundamental ways to structure an AI system, and choosing the wrong one is expensive to undo.

**The Chatbot** is the simplest: a user sends a message, the LLM responds with its trained knowledge. Think of it as consulting a brilliant generalist who has read everything up to their training cutoff. They know an enormous amount, but they know nothing about your specific business, your customers, or what happened after they graduated. The moment you need answers about your own data, this pattern hits a wall.

**The RAG System** is the chatbot with a library card. Before answering, it searches your documents, your database, your knowledge base — and brings the relevant excerpts into the conversation. Now the LLM isn't just using training knowledge; it's synthesizing specific information about your business into natural language answers. The search-then-answer pattern is what most "smart document Q&A" systems are built on.

**The Agent System** is different in kind, not just in degree. The agent doesn't just answer — it *acts*. It can run a database query, send an email, call an API, read a file, write code, and then decide what to do next based on the result. The LLM is the decision-maker; the tools are its hands. But with agency comes risk: an agent can do wrong things, expensive things, irreversible things. The safety architecture for agents is a first-class engineering concern.

The pattern you choose determines your entire technical stack, your cost model, your failure modes, and your safety requirements. Most production AI applications are some combination of these three, but there's usually one dominant pattern.
:::

## ⚙️ Under the Hood

### Pattern 1: Chatbot

The simplest architecture — LLM with no external data access:

```
User → System Prompt + Chat History + User Message → LLM → Response
```

```
┌────────────────────────────────────────────────────┐
│                   Chatbot Architecture              │
│                                                     │
│  User Input                                         │
│      │                                              │
│      ▼                                              │
│  ┌─────────────────────┐                           │
│  │  Message Formatter  │ ← System Prompt (static)  │
│  │  + History Manager  │ ← Chat History (sliding)  │
│  └─────────┬───────────┘                           │
│             │                                       │
│             ▼                                       │
│  ┌──────────────────┐                              │
│  │    LLM API       │                              │
│  │  (GPT-4, Claude) │                              │
│  └──────────┬───────┘                              │
│              │                                      │
│              ▼                                      │
│         Response                                    │
└────────────────────────────────────────────────────┘
```

```typescript
// run: npx tsx chatbot.ts
import OpenAI from 'openai'

const client = new OpenAI()

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

class Chatbot {
  private history: Message[] = []
  private maxHistoryTokens = 4000

  constructor(private systemPrompt: string) {}

  async chat(userMessage: string): Promise<string> {
    this.history.push({ role: 'user', content: userMessage })

    // Trim history to stay within context window
    // Real implementation: count tokens with tiktoken
    if (this.history.length > 20) {
      this.history = this.history.slice(-20)
    }

    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: this.systemPrompt },
        ...this.history,
      ],
    })

    const reply = response.choices[0].message.content!
    this.history.push({ role: 'assistant', content: reply })
    return reply
  }
}

const bot = new Chatbot('You are a helpful assistant for TaskFlow customer support.')
const response = await bot.chat('How do I cancel my subscription?')
console.log(response)
```

**When to use chatbot pattern:**
- General-purpose assistant where training data is sufficient
- FAQ/documentation where docs can be embedded in system prompt
- Tasks requiring reasoning, summarization, or generation from given content
- **Not for**: company-specific data, real-time data, taking actions

### Pattern 2: RAG System

Retrieves relevant context before each LLM call:

```
User Query → Embed Query → Search Vector DB → Retrieve Docs
      → Compose Prompt [context + query] → LLM → Answer
```

```
┌────────────────────────────────────────────────────────────────────┐
│                       RAG Architecture                              │
│                                                                     │
│  User Query                         ┌─────────────────┐            │
│      │                              │   Knowledge Base │            │
│      ├──── Query Transformer        │                 │            │
│      │         │                    │  ┌───────────┐  │            │
│      │         ▼                    │  │ Vector DB │  │            │
│      │    Embed Query               │  │  (chunks) │  │            │
│      │         │                    │  └─────┬─────┘  │            │
│      │         ▼                    └────────│─────────┘            │
│      │    ┌─────────────────┐               │                      │
│      │    │  Retrieval      │◄──────────────┘                      │
│      │    │  Engine         │                                       │
│      │    └────────┬────────┘                                      │
│      │             │                                                │
│      └─────────────┤ (merge query + context)                       │
│                    ▼                                                │
│             ┌─────────────┐                                         │
│             │  LLM        │                                         │
│             └──────┬──────┘                                         │
│                    │                                                │
│                    ▼                                                │
│         Grounded Response + Citations                               │
└────────────────────────────────────────────────────────────────────┘
```

```typescript
// run: npx tsx rag_system.ts
import OpenAI from 'openai'

const client = new OpenAI()

interface Document {
  id: string
  content: string
  metadata: Record<string, unknown>
}

interface RetrievalResult {
  document: Document
  score: number
}

// Simplified RAG — in production: use pgvector, Pinecone, Qdrant, etc.
async function embedQuery(query: string): Promise<number[]> {
  const response = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: query,
  })
  return response.data[0].embedding
}

async function retrieve(
  query: string,
  vectorDb: RetrievalResult[],
  topK: number = 3
): Promise<RetrievalResult[]> {
  // In production: this is a vector DB similarity search call
  // Here we fake it for illustration
  return vectorDb.slice(0, topK)
}

async function ragQuery(
  userQuery: string,
  retrievedDocs: RetrievalResult[]
): Promise<string> {
  const context = retrievedDocs
    .map((r, i) => `[Source ${i + 1}]: ${r.document.content}`)
    .join('\n\n')

  const response = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content: `Answer questions using ONLY the provided context. If the context doesn't contain the answer, say so.
Always cite your sources using [Source N] notation.`,
      },
      {
        role: 'user',
        content: `Context:\n${context}\n\nQuestion: ${userQuery}`,
      },
    ],
  })

  return response.choices[0].message.content!
}
```

**When to use RAG pattern:**
- Company knowledge base, documentation, policy documents
- Product catalog, FAQ where content changes frequently
- Medical records, legal documents where the LLM needs specific context
- **Not for**: tasks requiring real-time actions, multi-step reasoning over results of previous steps

### Pattern 3: Agent System

The agent uses tools and takes multiple LLM calls to complete a task:

```
User Task → LLM → [think] → Tool Call → Tool Result → LLM → [think] → ... → Final Answer
```

```
┌──────────────────────────────────────────────────────────────────────┐
│                       Agent Architecture                              │
│                                                                       │
│  User Task                                                            │
│      │                                                                │
│      ▼                                                                │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    Agent Loop                                 │    │
│  │                                                               │    │
│  │   ┌────────────┐        ┌──────────────────┐                │    │
│  │   │   Memory   │        │   LLM (Planner)  │                │    │
│  │   │  (context) │◄──────►│   reasoning +    │                │    │
│  │   └────────────┘        │   tool selection │                │    │
│  │                         └────────┬─────────┘                │    │
│  │                                  │                            │    │
│  │                         Tool Call Decision                    │    │
│  │                                  │                            │    │
│  │          ┌───────────────────────┼────────────────────┐      │    │
│  │          ▼                       ▼                    ▼      │    │
│  │   ┌──────────┐           ┌───────────┐        ┌──────────┐  │    │
│  │   │Search DB │           │  Call API │        │ Run Code │  │    │
│  │   └──────────┘           └───────────┘        └──────────┘  │    │
│  │                                                               │    │
│  │   ← Tool Results feed back into context for next LLM call →  │    │
│  └───────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  Human Approval Gate (for sensitive actions)                          │
│      │                                                                │
│  Final Answer / Action                                                │
└──────────────────────────────────────────────────────────────────────┘
```

```typescript
// run: npx tsx agent_system.ts
import OpenAI from 'openai'

const client = new OpenAI()

// Define tools
const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_ticket',
      description: 'Look up a customer support ticket by ID',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string', description: 'The ticket ID' }
        },
        required: ['ticket_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_ticket_status',
      description: 'Update the status of a support ticket',
      parameters: {
        type: 'object',
        properties: {
          ticket_id: { type: 'string' },
          status: { type: 'string', enum: ['open', 'in_progress', 'resolved', 'closed'] },
          notes: { type: 'string', description: 'Internal notes' }
        },
        required: ['ticket_id', 'status']
      }
    }
  }
]

// Mock tool implementations
function executeTool(name: string, args: Record<string, unknown>): string {
  if (name === 'lookup_ticket') {
    return JSON.stringify({ id: args.ticket_id, status: 'open', priority: 'high', issue: 'Cannot login' })
  }
  if (name === 'update_ticket_status') {
    return JSON.stringify({ success: true, message: `Ticket ${args.ticket_id} updated to ${args.status}` })
  }
  return JSON.stringify({ error: 'Unknown tool' })
}

async function runAgent(userMessage: string): Promise<string> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: 'You are a customer support agent. Use tools to look up and update tickets.' },
    { role: 'user', content: userMessage }
  ]

  const maxIterations = 5  // prevent infinite loops

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',
    })

    const message = response.choices[0].message
    messages.push(message)

    if (response.choices[0].finish_reason === 'stop') {
      return message.content ?? 'No response'
    }

    if (response.choices[0].finish_reason === 'tool_calls' && message.tool_calls) {
      for (const toolCall of message.tool_calls) {
        const args = JSON.parse(toolCall.function.arguments)
        const result = executeTool(toolCall.function.name, args)

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        })
      }
    }
  }

  return 'Agent reached max iterations'
}

const result = await runAgent('Please look up ticket T-4821 and mark it as resolved with notes: "User reset password successfully"')
console.log(result)
```

### Pattern Selection Framework

| Dimension | Chatbot | RAG | Agent |
|-----------|---------|-----|-------|
| **Needs company data?** | No | Yes | Yes |
| **Takes actions?** | No | No | Yes |
| **Multi-step reasoning?** | Simple | Simple | Complex |
| **Latency** | Low (1 LLM call) | Medium (search + LLM) | High (multiple calls) |
| **Cost** | Lowest | Medium | Highest |
| **Risk surface** | Low | Low-medium | High (can act) |
| **Failure modes** | Hallucination | Retrieval failure | Wrong action |
| **Audit requirement** | Simple | Source citations | Full trace |

**Hybrid patterns are common:**
- **RAG + Agent**: agent decides what to retrieve, retrieves it, then acts
- **Chatbot + Guardrails**: pure LLM but with input/output safety filters
- **Hierarchical agents**: orchestrator agent calls specialized sub-agents

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Chatbot used for company-specific data:** An internal HR assistant uses a plain chatbot with a system prompt containing the policy document. The document is 50 pages and doesn't fit in context. The model hallucinates policy details. Switch: RAG over the policy documents — only retrieve the relevant section per question.

**RAG without proper retrieval evaluation:** A RAG system for legal contracts has a semantic retrieval step that "feels right" during demos. In production, complex queries about clauses with specific date ranges fail because the embedding model doesn't capture temporal semantics well. BM25 keyword search would have worked better for these queries. Fix: evaluate retrieval separately from generation (Recall@K, MRR); hybrid search.

**Agent without iteration limit:** A customer-facing agent enters an infinite reasoning loop when the underlying API returns unexpected data. After 50 LLM calls ($2 of compute), the request times out. The LLM kept retrying with different arguments trying to make the tool work. Always set `max_iterations`, log each step, and implement a circuit breaker.

**No human approval gate for irreversible actions:** An agent that sends emails, makes refunds, or modifies database records without any confirmation step. A prompt injection attack causes the agent to issue a $10,000 refund. Rule: any irreversible action (write, send, pay, delete) must pass through a human approval gate or have deterministic validation that cannot be influenced by LLM reasoning.
:::

## 🎯 Checkpoint

::: details Question 1 — Pattern selection
**Q:** You're building an AI system for a legal firm. Lawyers want to ask questions about case law, uploaded client contracts, and the firm's billing records. What pattern(s) do you use and why?

**A:** This requires a **combination**. Case law and uploaded contracts: RAG — documents change frequently, are too large for context windows, and require source citations for audit. The retrieval system must handle both semantic queries ("contracts with liquidated damages clauses") and keyword queries ("Section 12.3"). Billing records: either RAG over a document export, or agent with read-only SQL tool call — querying structured data is better handled by generating and executing SQL than by stuffing tabular data into context. Architecture: a unified orchestrator that determines the query type and routes to the appropriate retrieval path. Security: role-based access control at the retrieval layer so lawyers only access their own client documents. All queries logged for compliance.
:::

::: details Question 2 — Why agents are expensive
**Q:** An agent completes a task in 8 LLM calls averaging 5,000 tokens each (input + output). At $15/1M input tokens and $60/1M output tokens for GPT-4o, estimate the cost per task and explain when this is and isn't worth it.

**A:** Assuming 4,000 input + 1,000 output per call: input cost = 8 × 4,000 × $15/1M = $0.48; output cost = 8 × 1,000 × $60/1M = $0.48. Total: ~$0.96 per task. Worth it when: the automated task replaces human work worth $5-50+ (research, data compilation, complex customer service resolution). Not worth it when: simple FAQ queries that a RAG system would handle for $0.002; high-volume bulk operations where 1M tasks/month = $960K. The break-even analysis is: (human_labor_cost - agent_cost) > 0 per task. At $0.96/task, agents are cost-effective only for high-value per-task workflows.
:::

## Key Mental Models

- **Chatbot = LLM's training knowledge only** — no company data, no actions, lowest cost and risk.
- **RAG = retrieve then generate** — makes LLM responses grounded in specific documents; audit through source citations.
- **Agent = LLM + tools + iteration** — can act on the world; highest capability, highest risk, highest cost.
- **Every irreversible action needs a gate** — write/send/pay/delete operations must have deterministic controls outside the LLM.
- **Pattern choice drives your entire architecture** — chatbot vs RAG vs agent determines your data stores, latency budget, safety model, and cost.

## Related

- [8.2 Enterprise AI Architecture](./02-enterprise-ai-architecture) — the full production stack around these patterns
- [Module 2 Agents](/ai-engineering/module-02/) — the agent loop in depth
- [Module 9 LLMOps](/ai-engineering/module-09/) — evaluating these patterns in production
