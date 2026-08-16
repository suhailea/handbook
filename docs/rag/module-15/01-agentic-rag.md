---
title: Agentic RAG
outline: deep
---

# Agentic RAG

Interview weight: 🔥🔥🔥 | Prerequisites: [Retrieval fundamentals](/rag/module-09/), [Generation & prompting](/rag/module-12/)

## 🗣️ In Plain English

::: tip In Plain English
Basic RAG is like a one-shot library trip: you walk in, grab five books from the shelf, and write your essay. Agentic RAG is like having a research assistant who reads the first batch of books, realizes they need more, goes back for different ones, checks a database, and calls an expert -- all before writing the final answer. The LLM *decides* what to do, not a fixed pipeline.
:::

## ⚙️ Under the Hood

### Basic RAG vs Agentic RAG

| Dimension | Basic RAG | Agentic RAG |
|-----------|-----------|-------------|
| Pipeline | Fixed: embed → search → generate | Dynamic: LLM decides next step |
| Retrieval | Single pass, top-K | Multiple passes, different sources |
| Query | Used as-is | Decomposed, rewritten, refined |
| Error recovery | None (returns whatever it gets) | Self-correction, re-query |
| LLM calls | 1 | 2-10+ |
| Latency | 1-3s | 3-30s |
| Cost | Low | 3-10x higher |

---

### Architecture

```text
                    ┌────────────────────┐
                    │    User Query      │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │    AGENT / LLM     │◄──────────────────┐
                    │  (decides actions) │                    │
                    └─────────┬──────────┘                    │
                              │                              │
              ┌───────────────┼───────────────┐              │
              │               │               │              │
    ┌─────────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐      │
    │  Vector Search │ │  SQL Query  │ │  API Call   │      │
    │    (tool)      │ │   (tool)    │ │   (tool)    │      │
    └─────────┬──────┘ └──────┬──────┘ └──────┬──────┘      │
              │               │               │              │
              └───────────────┼───────────────┘              │
                              │ results                      │
                    ┌─────────▼──────────┐                   │
                    │  EVALUATE RESULTS  │───── not enough ──┘
                    │  (enough to answer?)│
                    └─────────┬──────────┘
                              │ yes
                    ┌─────────▼──────────┐
                    │  GENERATE ANSWER   │
                    └────────────────────┘
```

---

### Core Patterns

#### 1. Tool-Based Retrieval

The simplest form of agentic RAG: wrap retrieval as a "tool" the LLM can call.

```typescript
// run: npx tsx tool-retrieval.ts

interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

const retrievalTools: Tool[] = [
  {
    name: 'search_docs',
    description:
      'Search the knowledge base for relevant documents. Use when the user asks about company policies, products, or procedures.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query',
        },
        filter: {
          type: 'object',
          description: 'Optional metadata filters (category, date range)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_faq',
    description:
      'Search frequently asked questions. Use for common questions that likely have a direct answer.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
  },
  {
    name: 'query_database',
    description:
      'Run a read-only SQL query against the product database. Use for questions about specific orders, account details, or statistics.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SQL SELECT query' },
      },
      required: ['sql'],
    },
  },
  {
    name: 'no_retrieval_needed',
    description:
      'Use when the question can be answered from general knowledge or conversation context without searching.',
    parameters: {
      type: 'object',
      properties: {
        reason: { type: 'string' },
      },
      required: ['reason'],
    },
  },
];

// The LLM decides WHICH tool to call and WITH WHAT arguments
// This is routing + retrieval in one step
```

#### 2. Query Planning / Decomposition

For complex questions, the agent breaks the query into sub-queries:

```typescript
// run: npx tsx query-planning.ts

// User: "Compare our Q1 and Q2 revenue and explain the main drivers of change"

// Agent's internal plan:
const plan = [
  {
    step: 1,
    action: 'search_docs',
    query: 'Q1 2025 revenue report',
    reason: 'Need Q1 revenue data',
  },
  {
    step: 2,
    action: 'search_docs',
    query: 'Q2 2025 revenue report',
    reason: 'Need Q2 revenue data',
  },
  {
    step: 3,
    action: 'search_docs',
    query: 'revenue drivers analysis Q1 Q2 2025',
    reason: 'Need analysis of what changed',
  },
  {
    step: 4,
    action: 'synthesize',
    reason: 'Combine all retrieved data into comparison',
  },
];

// Planning prompt:
const planningPrompt = `Given the user's question, create a retrieval plan.
Break the question into sub-queries that can each be answered independently.

User question: {question}

For each sub-query, specify:
1. The search query to use
2. Which tool to search with (docs, faq, database)
3. Why this information is needed

Output as JSON array of steps.`;
```

#### 3. Multi-Step Retrieval (Iterative)

The agent retrieves, evaluates, and decides whether to retrieve more:

```typescript
// run: npx tsx iterative-retrieval.ts

interface AgentState {
  query: string;
  retrievedChunks: Array<{ text: string; source: string; score: number }>;
  reasoning: string[];
  stepCount: number;
  maxSteps: number;
}

async function agenticRetrieval(
  query: string,
  llm: LLMClient,
  tools: ToolSet,
): Promise<string> {
  const state: AgentState = {
    query,
    retrievedChunks: [],
    reasoning: [],
    maxSteps: 5,     // Budget: prevent infinite loops
    stepCount: 0,
  };

  while (state.stepCount < state.maxSteps) {
    state.stepCount++;

    // Ask the LLM: what should we do next?
    const decision = await llm.complete({
      prompt: `You are a research agent. Your task is to gather enough
information to answer the user's question.

User question: ${state.query}

Information gathered so far:
${state.retrievedChunks.map((c) => c.text).join('\n---\n') || 'None yet'}

Your reasoning so far:
${state.reasoning.join('\n') || 'Just starting'}

Decide your next action:
1. SEARCH: Need more information (specify query and source)
2. ANSWER: Have enough information to answer

Respond with JSON: { "action": "SEARCH" | "ANSWER", "query"?: string, "tool"?: string, "reasoning": string }`,
      temperature: 0,
    });

    const parsed = JSON.parse(decision);
    state.reasoning.push(parsed.reasoning);

    if (parsed.action === 'ANSWER') {
      // Generate final answer with all gathered context
      return await llm.complete({
        prompt: `Answer this question based on the information gathered:
Question: ${state.query}
Context: ${state.retrievedChunks.map((c) => c.text).join('\n---\n')}`,
      });
    }

    // Execute search
    const results = await tools.execute(
      parsed.tool ?? 'search_docs',
      { query: parsed.query },
    );
    state.retrievedChunks.push(...results);
  }

  // Budget exhausted — answer with what we have
  return await llm.complete({
    prompt: `Answer based on available information (retrieval budget exhausted):
Question: ${state.query}
Context: ${state.retrievedChunks.map((c) => c.text).join('\n---\n')}`,
  });
}
```

#### 4. Self-Correction

The agent evaluates its own retrieval quality and re-queries if results are poor:

```typescript
// run: npx tsx self-correction.ts

async function retrieveWithCorrection(
  query: string,
  llm: LLMClient,
  vectorDB: VectorDB,
): Promise<string[]> {
  // Initial retrieval
  let chunks = await vectorDB.search(query, { topK: 5 });

  // Self-evaluation
  const evaluation = await llm.complete({
    prompt: `Given this question and retrieved documents, assess retrieval quality.

Question: ${query}
Documents:
${chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n')}

Assessment:
1. Do the documents contain information relevant to the question? (yes/no)
2. Is any critical information likely missing? (yes/no)
3. If missing, what search query would find the missing information?

Respond JSON: { "relevant": bool, "missing": bool, "betterQuery"?: string }`,
    temperature: 0,
  });

  const assessment = JSON.parse(evaluation);

  if (!assessment.relevant || assessment.missing) {
    // Re-query with improved query
    const additionalChunks = await vectorDB.search(
      assessment.betterQuery ?? query,
      { topK: 5 },
    );

    // Deduplicate and merge
    const seen = new Set(chunks.map((c) => c.id));
    for (const chunk of additionalChunks) {
      if (!seen.has(chunk.id)) {
        chunks.push(chunk);
        seen.add(chunk.id);
      }
    }
  }

  return chunks.map((c) => c.text);
}
```

#### 5. Routing

The agent decides which data source to query -- or whether retrieval is needed at all:

```typescript
// run: npx tsx routing.ts

type Route =
  | 'vector_search'      // Semantic search over documents
  | 'sql_query'          // Structured data query
  | 'api_call'           // External API (weather, stock, etc.)
  | 'no_retrieval'       // Answer from general knowledge / conversation
  | 'clarification';     // Ask the user to clarify

async function routeQuery(
  query: string,
  llm: LLMClient,
): Promise<Route> {
  const response = await llm.complete({
    prompt: `Classify this query into the best retrieval strategy:

- vector_search: Questions about documents, policies, procedures
- sql_query: Questions about specific data (orders, accounts, metrics)
- api_call: Questions needing real-time external data
- no_retrieval: Greetings, clarifications, general knowledge
- clarification: Query is too vague to route

Query: "${query}"

Respond with just the route name.`,
    temperature: 0,
  });

  return response.trim() as Route;
}
```

---

### When Agentic RAG Is Worth the Complexity

| Scenario | Basic RAG | Agentic RAG |
|----------|-----------|-------------|
| Single-topic factual questions | Sufficient | Overkill |
| Multi-hop questions ("Who manages the person who approved policy X?") | Fails | Required |
| Questions spanning multiple data sources | Poor | Required |
| Ambiguous queries needing clarification | Returns bad results | Can ask for clarification |
| High-volume, low-latency requirements | Better fit | Too slow |
| Simple Q&A chatbot | Better fit | Unnecessary cost |

**Rule of thumb:** If >20% of your queries are multi-step or multi-source, agentic RAG is worth the investment. If <5%, basic RAG with good query rewriting is sufficient.

---

### Cost and Latency Budget

```text
Basic RAG:    1 embed + 1 search + 1 LLM call = ~$0.008, ~2s
Agentic RAG:  1 embed + 3 searches + 4 LLM calls = ~$0.03, ~8s

At 10,000 queries/day:
  Basic:   $80/day
  Agentic: $300/day
```

**Mitigation strategies:**
- Use a cheaper/faster model for routing and planning (e.g., Haiku/GPT-4o-mini), strong model only for final answer
- Cache routing decisions for similar queries
- Set strict step budgets (max 5 tool calls per request)
- Fallback to basic RAG after timeout

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Infinite retrieval loops.** An agent decided its retrieval was insufficient, re-queried with a slightly different phrasing, got the same results, decided they were still insufficient, and repeated. The request timed out after 60 seconds and 12 LLM calls ($0.15 for a single query). **Always set a hard step budget and a timeout. When budget is exhausted, answer with what you have.**

**Routing failures compound.** The router classified a product question as "sql_query." The SQL query returned no results (the data was in documents, not the database). Instead of falling back to vector search, the agent tried more SQL queries. **Implement fallback routing: if the chosen route returns empty results, try the next most likely route.**

**Planning overhead exceeds benefit.** A team added query decomposition to every request. Simple questions like "What is the return policy?" were decomposed into three sub-queries, each requiring an LLM call. Total latency went from 1.5s to 6s. **Classify query complexity first. Only decompose queries that actually need it.**
:::

## 🎯 Checkpoint

::: details Question 1 -- When to go agentic
**Q:** You are building a customer support RAG system. 70% of questions are simple FAQ-type questions, 20% require looking up order details in a database, and 10% are complex questions spanning policies and order history. Would you use agentic RAG? How would you architect it?

**A:** Use a **hybrid approach** -- not fully agentic for all queries. Architecture: (1) **Router** (fast, cheap LLM call): classify every query as simple/data-lookup/complex. (2) **Simple path** (70%): basic RAG -- embed, search FAQ/docs, generate. One LLM call, fast. (3) **Data path** (20%): basic RAG with a SQL tool -- embed, search docs + query database, generate. Two tool calls. (4) **Complex path** (10%): full agentic RAG with decomposition, multi-step retrieval, self-correction. Up to 5 tool calls.

This way, 70% of requests are fast and cheap, 20% are slightly more expensive but targeted, and only 10% incur the full agentic cost. The router must be fast (use a small model or a classifier) and must have fallback logic (if the simple path returns low-confidence results, escalate to the complex path).
:::

::: details Question 2 -- Self-correction tradeoffs
**Q:** An agent's self-correction loop evaluates retrieval quality and re-queries if results seem insufficient. What are the risks of this approach, and how do you mitigate them?

**A:** Risks: (1) **Infinite loops** -- the agent never considers results "sufficient" and keeps re-querying. Mitigation: hard step budget (max 3 correction attempts). (2) **Increased cost** -- each correction cycle is an LLM call (for evaluation) + a search. Mitigation: fast/cheap model for evaluation, budget tracking. (3) **Worse results from re-query** -- the "improved" query might be worse than the original, retrieving even less relevant documents. Mitigation: keep original results and merge with new results rather than replacing. (4) **Latency** -- each correction adds 1-3 seconds. Mitigation: timeout per request, stream partial results if available. (5) **False negatives** -- the self-evaluator incorrectly judges good results as insufficient. Mitigation: calibrate the evaluation prompt, measure correction rates, flag queries that always trigger correction for manual review.
:::

## Key Mental Models

- **Agentic RAG trades latency and cost for accuracy** -- only use it when basic RAG demonstrably fails on your query types.
- **Route first, then act** -- classify query complexity cheaply before committing to expensive multi-step retrieval.
- **Always set budgets** -- step limits, timeouts, and cost caps prevent runaway agent loops.
- **Self-correction needs guard rails** -- merge results instead of replacing them, cap retries, and measure how often correction actually helps.

## Related

- [GraphRAG](02-graphrag.md) -- another advanced pattern for relationship-heavy queries
- [MCP & Human-in-the-Loop](04-mcp-hitl.md) -- tool access patterns and human oversight for agent actions
- [Guardrails](/rag/module-14/02-guardrails.md) -- tool guardrails are critical for agentic systems
- [Evaluation](/rag/module-13/) -- measure whether agentic RAG actually improves your metrics
