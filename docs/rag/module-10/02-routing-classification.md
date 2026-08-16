---
title: Routing & Classification
outline: deep
---

# Routing & Classification — The Decision Pipeline

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [Query Transformations](01-query-transformations.md), [Retrieval Strategies](../module-09/01-retrieval-strategies.md) | **Builds toward:** [Reranking](../module-11/01-reranking.md)

## 🗣️ In Plain English

::: tip In Plain English
Not every question belongs in the same pipeline. "What is the refund policy?" should search documents. "How many tickets were created last week?" should query a database. "What's the weather?" should be politely refused. Classification figures out what kind of question it is; routing sends it to the right place. Think of it as the receptionist in a hospital — they do not treat you, but they make sure you end up in the right department.
:::

## ⚙️ Under the Hood

### 7. Query Classification

**What:** Detect the type of query so downstream components can handle it appropriately. Not all queries need the same treatment.

**Common query types:**

| Type | Example | Handling | Cost & Latency Added |
|------|---------|----------|---------------------|
| Factual | "What is the max file upload size?" | Standard retrieval → direct answer | 1 LLM call, 50-150ms |
| Comparison | "Compare Plan A vs Plan B pricing" | Decompose → retrieve for each → tabulate | 1 LLM call, 50-150ms |
| Summarization | "Summarize the Q3 report" | Retrieve full document → summarize | 1 LLM call, 50-150ms |
| Temporal | "What changed since last update?" | Filter by date, retrieve multiple versions | 1 LLM call, 50-150ms |
| Aggregation | "How many support tickets last month?" | Route to SQL/analytics, not vector DB | 1 LLM call, 50-150ms |
| Conversational | "Tell me more about that" | Rewrite with history first | 1 LLM call, 50-150ms |
| Out-of-scope | "What's the weather today?" | Polite refusal, no retrieval | 1 LLM call, 50-150ms |

Note: classification itself always costs at least 1 LLM call (50-150ms, ~$0.0001). The cost compounds when classification triggers further processing (decomposition, multi-query, etc.).

```typescript
// run: npx tsx query-classification.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

type QueryType =
  | 'factual'
  | 'comparison'
  | 'summarization'
  | 'temporal'
  | 'aggregation'
  | 'conversational'
  | 'out_of_scope';

interface ClassifiedQuery {
  type: QueryType;
  confidence: number;
  reasoning: string;
}

async function classifyQuery(query: string): Promise<ClassifiedQuery> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Classify the user query into one of these types:
- factual: seeking a specific fact or answer
- comparison: comparing two or more things
- summarization: asking for a summary of a document or topic
- temporal: asking about changes over time
- aggregation: asking for counts, statistics, or analytics
- conversational: follow-up that needs history context
- out_of_scope: unrelated to the knowledge base

Return JSON: { "type": "...", "confidence": 0.0-1.0, "reasoning": "..." }`,
      },
      { role: 'user', content: query },
    ],
    max_tokens: 150,
  });

  return JSON.parse(response.choices[0].message.content!) as ClassifiedQuery;
}

const result = await classifyQuery("How many tickets were created last week?");
console.log(result);
// { type: "aggregation", confidence: 0.95, reasoning: "Asking for a count with a time range" }
```

---

### 8. Query Routing

**What:** Based on the classification, route the query to the appropriate backend. Not everything should go to the vector database.

**Routing decisions:**

```text
                    Classified Query
                          │
            ┌─────────────┼──────────────┐
            ▼             ▼              ▼
      factual /      aggregation    out_of_scope
      comparison /                       │
      summarization                      ▼
            │                      Polite refusal
            ▼                      (no retrieval)
      ┌─────┴──────┐
      │ Needs       │
      │ structured  │
      │ data?       │
      ├─ YES ──►  SQL Database
      ├─ NO ───►  Vector DB + BM25
      └─ LIVE ──► External API (real-time data)
```

```typescript
// run: npx tsx query-router.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

type RouteTarget = 'vector_search' | 'sql_database' | 'live_api' | 'refusal';

interface RoutingDecision {
  target: RouteTarget;
  rewrittenQuery: string;
  sqlQuery?: string;
  apiEndpoint?: string;
}

async function routeQuery(
  query: string,
  queryType: string
): Promise<RoutingDecision> {
  // Rule-based routing for clear cases
  if (queryType === 'out_of_scope') {
    return {
      target: 'refusal',
      rewrittenQuery: query,
    };
  }

  if (queryType === 'aggregation') {
    // Generate SQL for structured data queries
    const sqlResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.0,
      messages: [
        {
          role: 'system',
          content: `Convert the user question into a SQL query against the following schema:
- tickets(id, created_at, status, priority, assigned_to, category)
- users(id, name, department)
Return ONLY the SQL query.`,
        },
        { role: 'user', content: query },
      ],
      max_tokens: 200,
    });

    return {
      target: 'sql_database',
      rewrittenQuery: query,
      sqlQuery: sqlResponse.choices[0].message.content!.trim(),
    };
  }

  // Default: semantic retrieval
  return {
    target: 'vector_search',
    rewrittenQuery: query,
  };
}

// Example routing decisions:
// "What is the refund policy?" → vector_search
// "How many tickets last week?" → sql_database (with generated SQL)
// "What's the weather?" → refusal
```

---

### The Complete Pipeline: Putting It All Together

```typescript
// run: npx tsx complete-query-pipeline.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

interface ProcessedQuery {
  originalQuery: string;
  rewrittenQuery: string;
  queryType: string;
  routeTarget: string;
  retrievalQueries: string[];  // may be multiple (multi-query or decomposed)
}

async function processQuery(
  rawQuery: string,
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<ProcessedQuery> {

  // Step 1: Conversational rewriting (if history exists)
  let query = rawQuery;
  if (chatHistory.length > 0) {
    query = await rewriteWithContext(rawQuery, chatHistory);
  }

  // Step 2: Basic query cleanup (typos, abbreviations)
  query = await cleanupQuery(query);

  // Step 3: Classify query type
  const classification = await classifyQueryType(query);

  // Step 4: Route
  if (classification.type === 'out_of_scope') {
    return {
      originalQuery: rawQuery,
      rewrittenQuery: query,
      queryType: classification.type,
      routeTarget: 'refusal',
      retrievalQueries: [],
    };
  }

  if (classification.type === 'aggregation') {
    return {
      originalQuery: rawQuery,
      rewrittenQuery: query,
      queryType: classification.type,
      routeTarget: 'sql_database',
      retrievalQueries: [query], // SQL generation happens downstream
    };
  }

  // Step 5: For retrieval queries — expand or decompose
  let retrievalQueries: string[];

  if (classification.type === 'comparison') {
    // Decompose comparison queries
    retrievalQueries = await decomposeIntoSubQueries(query);
  } else {
    // Multi-query expansion for better recall
    retrievalQueries = await generateVariants(query, 3);
  }

  return {
    originalQuery: rawQuery,
    rewrittenQuery: query,
    queryType: classification.type,
    routeTarget: 'vector_search',
    retrievalQueries,
  };
}

// Simplified helper functions (full implementations in Query Transformations page)
async function rewriteWithContext(
  query: string,
  history: Array<{ role: string; content: string }>
): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    messages: [
      {
        role: 'system',
        content: 'Rewrite the follow-up question as a standalone question. Output ONLY the question.',
      },
      {
        role: 'user',
        content: `History:\n${history.map(m => `${m.role}: ${m.content}`).join('\n')}\n\nFollow-up: ${query}`,
      },
    ],
    max_tokens: 150,
  });
  return response.choices[0].message.content!.trim();
}

async function cleanupQuery(query: string): Promise<string> {
  // In production: fast model or rule-based for typo/abbreviation handling
  return query; // simplified
}

async function classifyQueryType(query: string): Promise<{ type: string }> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Classify: factual, comparison, summarization, temporal, aggregation, out_of_scope.
Return JSON: {"type": "..."}`,
      },
      { role: 'user', content: query },
    ],
    max_tokens: 50,
  });
  return JSON.parse(response.choices[0].message.content!);
}

async function decomposeIntoSubQueries(query: string): Promise<string[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    messages: [
      {
        role: 'system',
        content: 'Break into sub-questions. One per line. No numbering.',
      },
      { role: 'user', content: query },
    ],
    max_tokens: 200,
  });
  return response.choices[0].message.content!.trim().split('\n').filter(Boolean);
}

async function generateVariants(query: string, count: number): Promise<string[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content: `Generate ${count} search query variants. One per line. No numbering.`,
      },
      { role: 'user', content: query },
    ],
    max_tokens: 200,
  });
  const variants = response.choices[0].message.content!.trim().split('\n').filter(Boolean);
  return [query, ...variants];
}

// Example usage
const result = await processQuery(
  "what about its warranty?",
  [
    { role: 'user', content: 'Tell me about the iPhone 15 Pro' },
    { role: 'assistant', content: 'The iPhone 15 Pro features...' },
  ]
);
console.log(JSON.stringify(result, null, 2));
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Query routing misclassifies and drops valid queries.** The classifier marks "How do I reset my password?" as out-of-scope because it looks like a generic internet question, but the RAG system is a customer support assistant that absolutely should answer this. Fix: tune the classifier on your actual query distribution, not generic examples. "Out-of-scope" should be very narrowly defined.

**Routing confidence threshold too aggressive.** A team sets confidence threshold at 0.9 for routing. Queries at 0.85 confidence (still quite sure) get sent to a generic fallback path that produces worse answers. Fix: use tiered confidence thresholds — above 0.8 route directly, between 0.5-0.8 route to both backends and let the generation model pick the best context, below 0.5 ask the user for clarification.

**Single-route architecture for ambiguous queries.** "How is our error rate?" could mean "what is the current error rate metric?" (SQL) or "why is our error rate high?" (knowledge base). Forcing a single route loses half the answer. Fix: for ambiguous queries, route to multiple backends in parallel and let the LLM synthesize both the metric value and the explanatory context.
:::

## 🎯 Checkpoint

::: details Question 1 — Routing architecture
**Q:** Design a query routing system for a RAG application that serves both a knowledge base (vector search) and a metrics dashboard (SQL). Some queries are ambiguous ("how is our error rate?") — could mean "what is our error rate metric" (SQL) or "why is our error rate high?" (knowledge base). How do you handle this?

**A:** For ambiguous queries, route to both backends and let the generation model synthesize. Step 1: classify the query. If classification confidence is above 0.8, route to the predicted backend. If confidence is below 0.8 (ambiguous), route to both: execute the SQL query for the metric and vector search for explanatory documents. Step 2: pass both results to the LLM — the metric value and the retrieved context about error causes. The LLM can then answer comprehensively: "Your error rate is 2.3% (from metrics), which is above the 1% SLA. Common causes include timeout errors in the payment service (from knowledge base)." The key insight: routing does not have to be exclusive. For ambiguous queries, multi-source retrieval with LLM synthesis is better than forcing a single route.
:::

::: details Question 2 — Classification failure modes
**Q:** Your query classifier has a 92% accuracy rate. The remaining 8% of queries are misrouted. What are the likely failure patterns, and how would you improve?

**A:** The 8% misclassification likely clusters into predictable patterns: (1) Domain-specific ambiguity — queries that look generic but are domain-specific (e.g., "How do I reset?" in a password manager KB should be factual, not out-of-scope). Fix: fine-tune on your actual query distribution. (2) Compound queries — "What's our error rate and why is it high?" is both aggregation AND factual. Fix: allow multi-label classification and route to multiple backends. (3) Edge cases between temporal and factual — "What is the refund policy?" vs "What was the refund policy last year?" differ by one word but need different handling. Fix: add temporal-keyword detection as a pre-processing rule. Improvement path: log all queries with their classifications, have humans label a sample of 500, identify the systematic error patterns, and either add rules or fine-tune the classifier on those patterns.
:::

## Key Mental Models

- **Classification enables routing.** Not every query should go to the vector database — some need SQL, some need live APIs, some need refusal.
- **Routing does not have to be exclusive.** For ambiguous queries, send to multiple backends and let the LLM synthesize.
- **Tune classifiers on YOUR data.** Generic classifiers fail on domain-specific queries. The 8% error rate clusters in predictable patterns that domain-specific training fixes.
- **Every routing decision adds at least 1 LLM call.** Budget 50-150ms for classification. This is almost always worth it because misrouting wastes far more time and money downstream.

## Related

- [Query Transformations](01-query-transformations.md) — rewriting, expansion, and decomposition before routing
- [Retrieval Strategies](../module-09/01-retrieval-strategies.md) — the retrieval methods that receive routed queries
- [Hybrid Search & Fusion](../module-09/02-hybrid-search.md) — RRF for merging multi-query results
- [Reranking](../module-11/01-reranking.md) — post-retrieval refinement after query processing
- [Context Construction](../module-11/02-context-construction.md) — what happens after retrieval
