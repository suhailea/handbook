---
title: Query Transformations
outline: deep
---

# Query Transformations — Rewriting, Expansion, Decomposition, HyDE & Multi-Query

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [Retrieval Strategies](../module-09/01-retrieval-strategies.md), [Embedding Models](../module-07/01-embeddings-similarity.md) | **Builds toward:** [Hybrid Search](../module-09/02-hybrid-search.md), [Reranking](../module-11/01-reranking.md)

## 🗣️ In Plain English

::: tip In Plain English
Query processing is the translator between how a human asks a question and how a search engine needs to receive it. A user says "what about its warranty?" and the system rewrites it to "what is the warranty for the iPhone 15 Pro?" before searching. Without this translation, retrieval searches for "its warranty" and finds nothing useful.
:::

## ⚙️ Under the Hood

### The Complete Query Processing Pipeline

```text
Raw User Query
      │
      ▼
┌─────────────────┐
│ Conversational   │ ← uses chat history to resolve pronouns/context
│ Rewriting        │   "what about its price?" → "what is the price of the Tesla Model 3?"
└────────┬────────┘
         ▼
┌─────────────────┐
│ Query            │ ← classify intent: factual / comparison / summary / out-of-scope
│ Classification   │
└────────┬────────┘
         ▼
┌─────────────────┐
│ Query            │ ← route to: vector DB / SQL DB / live API / refusal
│ Routing          │
└────────┬────────┘
         ▼
    ┌────┴────────────────┐
    │  Is query complex?  │
    ├─ YES ───────────────┤
    │  Decompose into     │
    │  sub-queries        │
    ├─ NO ────────────────┤
    │  Single query path  │
    └────┬────────────────┘
         ▼
┌─────────────────┐
│ Expansion /      │ ← add synonyms, generate variants, or HyDE
│ Multi-Query /    │
│ HyDE             │
└────────┬────────┘
         ▼
    Retrieval Engine(s)
```

Each stage is optional. A simple RAG system might only use conversational rewriting. A production system uses most of these stages, with the choice driven by query classification.

---

### 1. Query Rewriting

**What:** Transform the raw query into a better query for retrieval. Fix typos, expand abbreviations, add specificity.

**Types of rewrites:**

| Rewrite Type | Before | After |
|-------------|--------|-------|
| Typo correction | "How to hanlde erors in Nod.js" | "How to handle errors in Node.js" |
| Abbreviation expansion | "K8s OOM pod restart" | "Kubernetes out of memory pod restart" |
| Vague → specific | "how does it work?" | "how does the billing system calculate taxes?" |
| Formal → search-friendly | "I was wondering about..." | "refund policy time limit" |

```typescript
// run: npx tsx query-rewriting.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

async function rewriteQuery(rawQuery: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    messages: [
      {
        role: 'system',
        content: `You are a query rewriter for a search engine. Given a user query:
1. Fix typos and grammar
2. Expand abbreviations
3. Make it specific and search-friendly
4. Remove filler words ("I was wondering", "can you tell me")
Output ONLY the rewritten query, nothing else.`,
      },
      { role: 'user', content: rawQuery },
    ],
    max_tokens: 100,
  });

  return response.choices[0].message.content!.trim();
}

// Example
const raw = "how do i hanlde erors in k8s pods";
const rewritten = await rewriteQuery(raw);
console.log(`Original: ${raw}`);
console.log(`Rewritten: ${rewritten}`);
// Rewritten: "How to handle errors in Kubernetes pods"
```

---

### 2. Conversational Query Rewriting

**What:** In a multi-turn conversation, resolve pronouns and implicit references using chat history to create a standalone query.

This is critical for conversational RAG. Without it, the retrieval system receives "what about its warranty?" and has no idea what "its" refers to.

```typescript
// run: npx tsx conversational-rewrite.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

async function rewriteWithHistory(
  currentQuery: string,
  chatHistory: ChatMessage[]
): Promise<string> {
  const historyText = chatHistory
    .map(m => `${m.role}: ${m.content}`)
    .join('\n');

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    messages: [
      {
        role: 'system',
        content: `Given a conversation history and a follow-up question, rewrite the
follow-up question to be a standalone question that contains all necessary
context. Do NOT answer the question — only rewrite it.

Output ONLY the rewritten question.`,
      },
      {
        role: 'user',
        content: `Conversation history:
${historyText}

Follow-up question: ${currentQuery}

Standalone question:`,
      },
    ],
    max_tokens: 150,
  });

  return response.choices[0].message.content!.trim();
}

// Example
const history: ChatMessage[] = [
  { role: 'user', content: 'Tell me about the iPhone 15 Pro' },
  { role: 'assistant', content: 'The iPhone 15 Pro features a titanium design, A17 Pro chip...' },
  { role: 'user', content: 'What about the camera?' },
  { role: 'assistant', content: 'It has a 48MP main camera with 5x optical zoom...' },
];

const standalone = await rewriteWithHistory(
  "what about its warranty?",
  history
);
console.log(standalone);
// "What is the warranty for the iPhone 15 Pro?"
```

**Key decisions:**
- How much history to include? Last 3-5 turns is usually sufficient. More adds noise and cost.
- When to rewrite? Always for multi-turn conversations. Skip for the first message (no context to resolve).
- Model choice? Use a fast, cheap model (gpt-4o-mini, Claude Haiku). This is a simple rewriting task.

---

### 3. Query Expansion

**What:** Enrich a single query with synonyms, related terms, or acronym expansions. Unlike multi-query (which generates separate queries and retrieves separately), expansion modifies a single query.

**Approaches:**

1. **Rule-based:** Maintain a synonym/acronym dictionary
2. **LLM-powered:** Ask an LLM to expand the query
3. **Embedding-based:** Find the nearest terms in the embedding space

```typescript
// run: npx tsx query-expansion.ts

// Approach 1: Rule-based expansion
const synonyms: Record<string, string[]> = {
  'K8s':     ['Kubernetes'],
  'OOM':     ['out of memory', 'OOMKilled'],
  'DB':      ['database'],
  'auth':    ['authentication', 'authorization'],
  'authn':   ['authentication'],
  'authz':   ['authorization'],
  'env':     ['environment'],
  'config':  ['configuration'],
  'infra':   ['infrastructure'],
};

function ruleBasedExpand(query: string): string {
  let expanded = query;
  for (const [abbr, expansions] of Object.entries(synonyms)) {
    const regex = new RegExp(`\\b${abbr}\\b`, 'gi');
    if (regex.test(query)) {
      expanded += ' ' + expansions.join(' ');
    }
  }
  return expanded;
}

console.log(ruleBasedExpand('K8s OOM pod restart'));
// "K8s OOM pod restart Kubernetes out of memory OOMKilled"
```

```typescript
// run: npx tsx llm-expansion.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

// Approach 2: LLM-powered expansion
async function llmExpand(query: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    messages: [
      {
        role: 'system',
        content: `Given a search query, add 3-5 relevant synonyms or related terms
to improve search recall. Return the expanded query as a single line.
Do not change the meaning.`,
      },
      { role: 'user', content: query },
    ],
    max_tokens: 100,
  });
  return response.choices[0].message.content!.trim();
}

const expanded = await llmExpand('K8s pod crash');
console.log(expanded);
// "K8s Kubernetes pod crash CrashLoopBackOff restart failure OOMKilled container"
```

**Pitfall:** Over-expansion adds noise. "Python crash" expanded with "snake reptile" will pollute results in a tech corpus. Domain-specific expansion dictionaries outperform generic LLM expansion for specialized domains.

---

### 4. Multi-Query Retrieval

**What:** Generate 3-5 semantically diverse variants of the user's query, retrieve results for each independently, then merge using RRF or another fusion strategy.

**Why it works:** Different phrasings activate different regions of the embedding space. "How to fix memory leaks in Node.js" and "Node.js heap growth debugging" are semantically related but embed differently. Searching with both finds documents that either alone would miss.

```typescript
// run: npx tsx multi-query.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

async function generateQueryVariants(
  query: string,
  count: number = 3
): Promise<string[]> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.7, // some creativity for diversity
    messages: [
      {
        role: 'system',
        content: `Generate ${count} different versions of the given search query.
Each version should approach the topic from a different angle or use different
terminology, while preserving the original intent.
Return one query per line, no numbering, no explanation.`,
      },
      { role: 'user', content: query },
    ],
    max_tokens: 200,
  });

  const variants = response.choices[0].message.content!
    .trim()
    .split('\n')
    .filter(line => line.trim().length > 0);

  // Always include the original query
  return [query, ...variants];
}

async function multiQueryRetrieval(query: string) {
  const variants = await generateQueryVariants(query, 3);
  console.log('Query variants:');
  variants.forEach((v, i) => console.log(`  ${i + 1}. ${v}`));

  // In production: retrieve top-K for each variant, then fuse with RRF
  // const allResults = await Promise.all(
  //   variants.map(v => vectorDB.search(v, { topK: 20 }))
  // );
  // return reciprocalRankFusion(allResults);
}

await multiQueryRetrieval('How to handle memory leaks in Node.js');
// Query variants:
//   1. How to handle memory leaks in Node.js
//   2. Node.js heap memory growth debugging and prevention
//   3. Detecting and fixing memory leaks in Node applications
//   4. V8 garbage collection issues and memory profiling in Node.js
```

**Merge strategy:** Use RRF (see [Hybrid Search](../module-09/02-hybrid-search.md)) to merge results from all query variants. Documents that appear in results for multiple variants rank highest.

---

### 5. Query Decomposition

**What:** Break complex, multi-part questions into independent sub-queries. Retrieve separately for each, then combine the retrieved context.

**When to decompose:**
- "Compare pricing and features of Plan A vs Plan B" → two separate retrievals
- "What changed in the refund policy between 2023 and 2024?" → retrieve both versions
- "How does our error rate compare to the SLA, and what are the main causes?" → two different questions

```typescript
// run: npx tsx query-decomposition.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

interface DecomposedQuery {
  subQueries: string[];
  synthesisInstruction: string;
}

async function decomposeQuery(query: string): Promise<DecomposedQuery> {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Analyze if the query needs to be broken into sub-queries for
separate retrieval. If it does, decompose it. If it's simple enough for
single retrieval, return it as-is.

Return JSON: {
  "needsDecomposition": boolean,
  "subQueries": ["query1", "query2", ...],
  "synthesisInstruction": "how to combine the sub-answers"
}`,
      },
      { role: 'user', content: query },
    ],
    max_tokens: 300,
  });

  const result = JSON.parse(response.choices[0].message.content!);

  if (!result.needsDecomposition) {
    return {
      subQueries: [query],
      synthesisInstruction: 'Direct answer from retrieved context.',
    };
  }

  return {
    subQueries: result.subQueries,
    synthesisInstruction: result.synthesisInstruction,
  };
}

const result = await decomposeQuery(
  'Compare pricing and features of Plan A vs Plan B'
);
console.log(result);
// {
//   subQueries: [
//     "What are the pricing details of Plan A?",
//     "What are the features of Plan A?",
//     "What are the pricing details of Plan B?",
//     "What are the features of Plan B?"
//   ],
//   synthesisInstruction: "Create a comparison table of pricing and features..."
// }
```

**Caution:** Decomposition generates more sub-queries, each requiring retrieval. A 4-part decomposition with 20 results each = 80 candidates to process. Budget for the latency and cost.

---

### 6. HyDE (Hypothetical Document Embedding)

**What:** Generate a hypothetical answer using the LLM, embed that answer instead of the query, and use the embedding for retrieval. The hypothesis is in the same "register" as the documents, improving embedding alignment.

See [Retrieval Strategies](../module-09/01-retrieval-strategies.md) for the full explanation, mechanism, and code example.

**When to use in the query processing pipeline:**
- The query is a natural question, but the corpus consists of technical documentation, specifications, or formal prose
- Embedding the question directly yields poor recall
- You have latency budget for an extra LLM call (300-1000ms)

**Key risk:** If the LLM hallucinates in the hypothesis, retrieval goes in the wrong direction. Mitigate by generating multiple hypotheses and averaging their embeddings, or by using HyDE results alongside regular query results (hybrid of HyDE + direct embedding).

```typescript
// run: npx tsx hyde-with-fallback.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

async function hydeWithFallback(query: string) {
  // Generate hypothesis
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    messages: [
      {
        role: 'system',
        content: `Write a short technical paragraph that would answer this question.
Write in the style of official documentation. If you are unsure, say so.`,
      },
      { role: 'user', content: query },
    ],
    max_tokens: 200,
  });

  const hypothesis = completion.choices[0].message.content!;

  // Embed both the query and the hypothesis
  const embeddings = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: [query, hypothesis],
  });

  const queryVec = embeddings.data[0].embedding;
  const hydeVec = embeddings.data[1].embedding;

  // Use both for retrieval — search with each, merge results via RRF
  // This gives you the benefits of HyDE without losing direct query matching
  return { queryVec, hydeVec, hypothesis };
}
```

---

### Techniques Comparison

| Technique | Cost & Latency Added | Best For | Risk |
|-----------|---------------------|----------|------|
| Query Rewriting | 1 LLM call, 100-300ms, ~$0.0001 | Typos, abbreviations, vague queries | Minimal — low risk of harm |
| Conversational Rewrite | 1 LLM call, 100-300ms, ~$0.0001 | Multi-turn conversations | Topic drift misdetection |
| Query Expansion | 1 LLM call, 50-200ms, ~$0.0001 | Domain-specific acronyms | Over-expansion adds noise |
| Multi-Query | 1 LLM call + N retrievals, 200-400ms, ~$0.0002 | Broad or ambiguous queries | Latency explosion if uncapped |
| Decomposition | 1 LLM call + N retrievals, 200-400ms, ~$0.0002 | Complex multi-part questions | Cost multiplied by sub-query count |
| HyDE | 1 LLM call + 1 embedding, 300-1000ms, ~$0.001 | Formal corpus with question-document gap | Hallucinated hypothesis misdirects retrieval |

### Decision Matrix: Which Techniques to Apply

| Scenario | Techniques to Apply |
|----------|-------------------|
| First message, simple factual query | Basic rewrite only |
| Follow-up message in conversation | Conversational rewrite → classify → retrieve |
| Ambiguous or broad query | Multi-query expansion → RRF fusion |
| Complex multi-part question | Decomposition → parallel retrieval → merge |
| Domain with formal documentation | HyDE (bridges question→document register gap) |
| Technical domain with acronyms | Rule-based expansion + BM25 |
| Mixed query types (analytics + semantic) | Classification → routing to appropriate backend |
| All of the above at scale | Full pipeline with classification-driven routing |

### Latency and Cost Budgets

Every LLM call in the query processing pipeline adds latency and cost:

| Stage | Latency | Cost per Query |
|-------|---------|---------------|
| Conversational rewrite | 100-300ms | ~$0.0001 |
| Query cleanup | 50-200ms | ~$0.0001 |
| Classification | 50-150ms | ~$0.0001 |
| Multi-query (3 variants) | 200-400ms | ~$0.0002 |
| Decomposition | 200-400ms | ~$0.0002 |
| HyDE hypothesis | 300-1000ms | ~$0.001 |
| **Total (full pipeline)** | **500-1500ms** | **~$0.001** |

**Optimization strategies:**
- Run independent stages in parallel (classification + rewriting simultaneously)
- Cache rewrites for identical or near-identical queries
- Use smaller models for simple tasks (classification, cleanup)
- Skip stages based on classification (simple factual queries skip decomposition and HyDE)
- Batch embedding calls (embed all query variants in one API call)

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Conversational rewriting introduces incorrect context.** The rewriter merges chat history into the query, but the user has changed topics. "Tell me about pricing for Plan A" followed by "What about security?" gets rewritten as "What about security for Plan A?" when the user meant security in general. Fix: detect topic shifts in the chat history before rewriting. If the latest message has low semantic similarity to recent history, treat it as a new conversation.

**Multi-query explosion kills latency.** A team generates 5 query variants, each with 20 results, producing 100 candidates to deduplicate and rerank. P95 latency jumps from 200ms to 2 seconds. Fix: cap at 3 variants, retrieve 10 per variant, and set a hard wall-clock budget with `Promise.race` / `AbortController` timeout.

**HyDE hypothesis is confidently wrong.** For a domain-specific question about internal company policy, the LLM generates a hypothesis based on generic knowledge. The hypothesis embedding pulls retrieval toward wrong documents. The retrieved context contains incorrect information that the generation LLM then presents as fact. Fix: use HyDE only for domains where the LLM has reasonable base knowledge. For internal/proprietary data, direct embedding or multi-query is safer.
:::

## 🎯 Checkpoint

::: details Question 1 — Conversational rewriting
**Q:** A user is on their 5th message in a conversation. Each message references the previous one. How would you design the conversational rewriting step, and what are the failure modes?

**A:** Design: take the last 3-5 turns of chat history and the current message. Use a fast LLM to rewrite the current message as a standalone query by resolving all pronouns and implicit references. Include the system's responses in the history (not just user messages) because the user often references information the system provided. Failure modes: (1) Topic drift — the user changed subjects but the rewriter merges old context. Detect via semantic similarity between current query and recent history. (2) Accumulated error — each rewrite introduces slight distortions that compound. The 5th rewrite is based on the 4th rewritten query, not the original. Fix: always rewrite from the raw user message + original history, not from previously rewritten queries. (3) Information loss — the rewriter drops nuance from the original question while trying to make it standalone.
:::

::: details Question 2 — Cost-benefit of query processing
**Q:** A stakeholder asks: "We are spending $0.001 per query on query processing LLM calls before even hitting retrieval. Is this worth it?" How do you evaluate this?

**A:** Measure the impact empirically. Set up an A/B test: Group A uses the full query processing pipeline, Group B sends raw queries directly to retrieval. Measure: (1) Retrieval recall@10 — does query processing find more relevant documents? A 20-30% recall improvement is common. (2) End-to-end answer quality — human evaluation or LLM-as-judge on answer correctness. (3) User satisfaction / thumbs-up rate. Then calculate ROI: if $0.001/query in processing prevents even one support escalation per 1000 queries (each costing $5-15 in human agent time), the processing pays for itself 5-15x over. The cost is almost always worth it — query processing is the highest-ROI intervention in most RAG systems because it directly improves retrieval quality, which is the ceiling for answer quality.
:::

## Key Mental Models

- **Query processing bridges the gap** between how humans ask questions and how retrieval systems find answers. Skip it and you leave 20-40% of recall on the table.
- **Conversational rewriting is mandatory** for multi-turn RAG. Without it, the retrieval system receives "what about it?" and finds nothing.
- **Every LLM call adds latency.** Budget the full pipeline (rewrite + classify + expand) at 500-1500ms. Skip stages based on query type to stay within budget.
- **Multi-query and decomposition boost recall** but multiply retrieval cost. Cap variant counts and set hard latency budgets.

## Related

- [Routing & Classification](02-routing-classification.md) — classifying query intent and routing to backends
- [Retrieval Strategies](../module-09/01-retrieval-strategies.md) — the retrieval methods that receive processed queries
- [Hybrid Search & Fusion](../module-09/02-hybrid-search.md) — RRF for merging multi-query results
- [Reranking](../module-11/01-reranking.md) — post-retrieval refinement after query processing
- [Context Construction](../module-11/02-context-construction.md) — what happens after retrieval
