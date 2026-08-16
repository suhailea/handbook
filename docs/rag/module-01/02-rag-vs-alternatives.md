---
title: RAG vs Alternatives
outline: deep
---

# RAG vs Alternatives

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [What Is RAG & When to Use It](01-what-is-rag.md) | **Builds toward:** [Designing Before Building](../module-02/01-requirements.md)

## 🗣️ In Plain English

::: tip In Plain English
RAG is one tool in a toolbox. Fine-tuning teaches the model new habits. Long-context windows let you shove more pages onto the desk. SQL queries ask a structured database directly. Agents decide which tool to grab on their own. Knowing when NOT to use RAG is just as important as knowing how to build it.
:::

## ⚙️ Under the Hood

### RAG vs Fine-Tuning

Fine-tuning modifies the model's weights. RAG modifies the model's input. This distinction drives every trade-off:

| Dimension | RAG | Fine-Tuning |
|-----------|-----|-------------|
| **What it changes** | Input (context at inference time) | Weights (model parameters) |
| **Knowledge type** | Factual, frequently changing | Behavioral, stylistic, format |
| **Update speed** | Minutes (re-index) | Hours to days (retrain) |
| **Data freshness** | Real-time possible | Frozen at training time |
| **Cost model** | Per-query retrieval + LLM tokens | Upfront training cost + inference |
| **Hallucination** | Reduced (grounded in retrieved docs) | Can still hallucinate freely |
| **Traceability** | Citations to source documents | No traceability to training data |
| **Data requirements** | Raw documents (any volume) | Curated prompt-completion pairs (100s-1000s) |
| **Infrastructure** | Vector DB + embedding pipeline | GPU training infrastructure |
| **Failure mode** | Wrong docs retrieved → wrong answer | Wrong behavior learned → consistent errors |

**When to combine them:** Fine-tune for output format and tone, use RAG for factual grounding. Example: a legal AI fine-tuned to write in formal legal prose, with RAG providing case law and statutes.

```typescript
// Conceptual: RAG adds knowledge, fine-tuning adds behavior

// RAG approach: "What is our refund policy?"
const context = retrieve("refund policy"); // → "30-day return window..."
const answer1 = llm(`Based on: ${context}\nAnswer: What is our refund policy?`);
// Output: "Our refund policy allows returns within 30 days."

// Fine-tuning approach: "Write a customer email about refund policy"
// Model was fine-tuned on 500 examples of company email style
const answer2 = fineTunedLlm("Write a customer email about refund policy");
// Output: "Dear valued customer, Thank you for reaching out..."
// (correct style, but may hallucinate policy details without RAG)

// Combined: RAG + Fine-tuned model
const context2 = retrieve("refund policy");
const answer3 = fineTunedLlm(`Based on: ${context2}\nWrite a customer email about refund policy`);
// Output: correct style AND correct facts
```

### RAG vs Long-Context LLMs

Modern LLMs support massive context windows (Claude: 200K tokens, Gemini: 2M tokens). This raises the question: why retrieve when you can stuff?

| Dimension | RAG (retrieve top-k) | Long-Context Stuffing |
|-----------|----------------------|----------------------|
| **Corpus limit** | Unlimited (millions of docs) | Limited by context window |
| **Cost per query** | Low (only retrieved chunks sent to LLM) | High (entire corpus sent every query) |
| **Latency** | Lower (fewer tokens to process) | Higher (more tokens = more time) |
| **Accuracy** | Depends on retrieval quality | "Lost in the middle" effect degrades accuracy |
| **Architecture** | Complex (vector DB, embeddings, reranker) | Simple (just stuff and send) |
| **Freshness** | Requires ingestion pipeline | Requires re-loading corpus |
| **Multi-tenant** | Metadata filtering for access control | Must load per-tenant corpus separately |

**The "lost in the middle" problem** (Liu et al., 2023): LLMs perform best on information at the beginning and end of the context window. Information in the middle is disproportionately ignored. This means stuffing 200K tokens of documents actually *reduces* accuracy for facts that land in the middle positions.

```text
Accuracy vs Position in Context Window

100% |
 90% |  ##                                        ##
 80% |  ## ##                                   ## ##
 70% |  ## ## ##                             ## ## ##
 60% |  ## ## ## ##                       ## ## ## ##
 50% |  ## ## ## ## ##             ## ## ## ## ## ##
 40% |  ## ## ## ## ## ## ## ## ## ## ## ## ## ## ##
     +----------------------------------------------
      Start                Middle                End
                  Position in context window
```

**Cost comparison at scale:**

```yaml
Scenario: 500K-token corpus, 10K queries/day, GPT-4o pricing

Long-Context (stuff everything):
  Input:  500K tokens x 10K queries = 5B tokens/day
  Cost:   5B x $2.50/M = $12,500/day = $375,000/month

RAG (retrieve 3K tokens per query):
  Input:  3K tokens x 10K queries = 30M tokens/day
  Cost:   30M x $2.50/M = $75/day = $2,250/month
  + Vector DB: ~$200/month
  + Embeddings (one-time): ~$5

  Total:  ~$2,450/month

RAG is 153x cheaper at this scale.
```

**When long-context wins:** Small corpus (<50K tokens), low query volume, prototype/POC phase, when retrieval errors are more costly than the extra tokens.

### RAG vs Traditional Search

| Dimension | RAG | Traditional Search (Elasticsearch, BM25) |
|-----------|-----|------------------------------------------|
| **Output** | Generated natural language answer | Ranked list of documents |
| **Understanding** | Semantic (understands meaning) | Lexical (matches keywords) + some semantic |
| **Synthesis** | Can combine info from multiple docs | Returns docs, user must synthesize |
| **Precision** | Can hallucinate if context is weak | Returns exact matches (no fabrication) |
| **User experience** | Conversational, direct answers | Search results page, user clicks through |
| **Cost** | Higher (LLM inference per query) | Lower (no LLM needed) |

**The hybrid reality:** Most production RAG systems use traditional search as a component. BM25 handles exact keyword matches that dense embeddings miss ("error code E-4021"), while embeddings handle semantic queries ("how do I fix the connection timeout issue").

### RAG vs SQL / Database Queries

| Data Type | Best Approach | Why |
|-----------|--------------|-----|
| Structured (tables, rows, columns) | SQL / NL-to-SQL | Preserves relationships, supports aggregation |
| Unstructured (documents, emails, PDFs) | RAG | No schema to query against |
| Semi-structured (JSON, logs) | Depends on query type | Filtering → SQL; semantic search → RAG |
| Mixed | Hybrid (SQL + RAG) | Route based on query intent |

```typescript
// run: npx tsx demo_routing.ts (conceptual - shows query routing logic)

interface ClassifierResult {
  type: "analytical" | "factual_lookup" | "hybrid";
}

function routeQuery(query: string, classifierResult: ClassifierResult): string {
  if (classifierResult.type === "analytical") {
    // "What is the average order value this month?"
    return executeSql(nlToSql(query));
  }

  if (classifierResult.type === "factual_lookup") {
    // "What is our refund policy?"
    const chunks = vectorSearch(query);
    return llmGenerate(query, chunks);
  }

  if (classifierResult.type === "hybrid") {
    // "Summarize complaints from customers who spent over $1000"
    const highSpenders = executeSql(
      "SELECT customer_id FROM orders " +
      "GROUP BY customer_id HAVING SUM(total) > 1000"
    );
    const complaints = vectorSearch(
      query, { filter: { customer_id: { $in: highSpenders } } }
    );
    return llmGenerate(query, complaints);
  }

  throw new Error(`Unknown query type: ${classifierResult.type}`);
}
```

### RAG vs Agents (and Agentic RAG)

An agent is a system that can decide which tools to use and when. RAG is one tool an agent can use.

| Dimension | Standard RAG | Agentic RAG |
|-----------|-------------|-------------|
| **Retrieval** | Single-shot: retrieve once, generate | Multi-step: retrieve, evaluate, retrieve again if needed |
| **Routing** | Fixed pipeline | Agent decides: vector DB? SQL? API? Web? |
| **Self-correction** | None | Agent checks if context answers the query; retries if not |
| **Query decomposition** | Simple rewriting | Breaks complex queries into sub-queries, answers each, synthesizes |
| **Complexity** | Moderate | High (tool definitions, planning, evaluation loops) |
| **Latency** | Predictable (one retrieval + one LLM call) | Variable (multiple tool calls, many LLM calls) |
| **Cost** | Fixed per query | Variable (more complex = more LLM calls) |
| **Reliability** | Predictable failure modes | Can loop, use wrong tools, compound errors |

```text
Standard RAG:
  Query --> Retrieve --> Generate --> Response

Agentic RAG:
  Query --> Agent thinks: "I need to..."
             |-- Search vector DB for policy docs
             |-- Results insufficient --> rewrite query --> search again
             |-- Found relevant docs, but query also needs a number
             |-- Query SQL database for the metric
             +-- Combine both results --> Generate --> Response
```

### The Decision Matrix

Given your requirements, which approach should you choose?

| Requirement | RAG | Fine-Tune | Long-Context | SQL | Agent |
|-------------|:---:|:---------:|:------------:|:---:|:-----:|
| Private/changing data | YES | no | YES | YES | YES |
| Citations needed | YES | no | maybe | YES | YES |
| Large corpus (>1M tokens) | YES | no | no | YES | YES |
| Low latency (<1s) | YES | YES | no | YES | no |
| Low cost per query | YES | YES | no | YES | no |
| Structured data | no | no | maybe | YES | YES |
| Style/behavior change | no | YES | no | no | no |
| Multi-step reasoning | maybe | no | maybe | no | YES |
| Simple architecture | maybe | maybe | YES | YES | no |
| Minimal ops overhead | maybe | no | YES | YES | no |

### Common Combinations in Production

Most real systems combine approaches:

| Pattern | Components | Example Use Case |
|---------|-----------|-----------------|
| RAG + Fine-tuning | Fine-tuned model + retrieval pipeline | Legal AI: formal writing style + case law retrieval |
| RAG + SQL | Vector search + database queries | E-commerce: product search + order analytics |
| RAG + Agents | Agent framework with RAG as a tool | IT helpdesk: search docs, query CMDB, create tickets |
| RAG + Long-context | RAG for large corpus, stuff for small sets | Retrieve top-50, rerank, stuff top-5 for final answer |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Choosing RAG when SQL would do.**
A team builds a full RAG pipeline to answer "How many orders did we process last month?" The embedding-based retrieval returns chunks about order processing documentation instead of actual order data. Symptom: semantically related but factually wrong answers to analytical questions. Fix: classify query intent upfront — route analytical queries to SQL, factual lookups to RAG.

**2. Skipping RAG because "long-context handles it."**
Works in the prototype with 20 documents. In production, the corpus grows to 2M tokens. Costs explode, latency triples, and the lost-in-the-middle effect causes accuracy drops nobody debugged. Symptom: gradual quality degradation as the knowledge base grows. Fix: design for RAG from the start if the corpus is expected to grow beyond 100K tokens.

**3. Over-engineering with agents when standard RAG suffices.**
An agent-based system with tool-calling for a simple FAQ bot. Each query triggers 3-5 LLM calls instead of 1. Latency goes from 1s to 8s, cost goes 5x. Symptom: slow, expensive answers to simple questions. Fix: start with standard RAG, add agentic capabilities only for query types that demonstrably need multi-step reasoning.

:::

## 🎯 Checkpoint

::: details Question 1 — Choosing the right approach
**Q:** You are building a system for a hospital that needs to (a) answer doctors' questions about drug interactions from medical literature, (b) generate discharge summaries in the hospital's standard format, and (c) report patient statistics by department. Which approach(es) would you use for each, and why?

**A:** (a) **RAG** — medical literature is a large, evolving corpus of unstructured text. RAG retrieves relevant papers/guidelines and generates grounded answers with citations, which is critical in healthcare. The embedding model should be domain-specific (e.g., PubMedBERT). (b) **Fine-tuning + RAG** — fine-tune the LLM on hundreds of existing discharge summaries to learn the hospital's format, tone, and structure. Use RAG to retrieve the specific patient's records, lab results, and treatment history to ground the content. (c) **SQL** — patient statistics by department is a structured analytical query. This belongs in a dashboard backed by SQL queries against the hospital's EHR database, not RAG. An LLM-powered NL-to-SQL interface could make it conversational. HIPAA compliance affects all three: embeddings and LLM inference must happen on-premises or in a HIPAA-compliant cloud environment.
:::

::: details Question 2 — The long-context trap
**Q:** Your team has a 150K-token internal wiki. You are debating between RAG and stuffing everything into Claude's 200K context window. The wiki grows by ~10K tokens/month. There are 500 queries/day. Calculate the 6-month cost of each approach and recommend a strategy.

**A:** **Long-context approach:** At month 6, corpus = 150K + 60K = 210K tokens (exceeds 200K window — already broken). Even at month 1: 150K tokens x 500 queries/day x 30 days x $3/M input tokens = $6,750/month. Over 6 months (with growth): approximately $50,000. **RAG approach:** Retrieve ~3K tokens per query. 3K x 500 x 30 x $3/M = $135/month. Vector DB: ~$100/month. Embedding cost (one-time + monthly updates): negligible. Total over 6 months: ~$1,400. **Recommendation:** Start with RAG. The corpus will exceed the context window by month 4-5 anyway, so you would need to migrate. RAG is ~35x cheaper and scales without architecture changes. The only argument for long-context is fewer than ~50 queries/day and a corpus that stays small.
:::

::: details Question 3 — Agentic RAG justification
**Q:** Give a concrete example where standard RAG fails and agentic RAG is necessary. What is the minimum set of tools the agent needs?

**A:** **Example:** "Compare our Q3 2024 revenue with the projections in the strategic plan and identify departments that underperformed." Standard RAG fails because: (1) it requires retrieving from two different sources (financial database for actuals, document store for the strategic plan), (2) it requires numerical comparison that embeddings handle poorly, (3) the answer requires synthesis across structured and unstructured data. **Agentic RAG solution:** The agent decomposes the query: step 1 — query SQL for Q3 revenue by department; step 2 — retrieve strategic plan sections about Q3 projections via vector search; step 3 — compare actuals vs projections; step 4 — identify underperformers; step 5 — generate narrative. **Minimum tools:** (1) SQL query tool, (2) vector search tool, (3) calculator/code execution tool. The agent also needs planning/decomposition capability (handled by the LLM) and a synthesis step.
:::

## Key Mental Models

- **RAG adds knowledge, fine-tuning adds behavior.** If you need the model to *know* something, retrieve it. If you need the model to *act* differently, fine-tune it.
- **Long-context is simple but does not scale.** Great for prototypes and small corpora. RAG wins on cost, latency, and scalability for anything beyond ~100K tokens or ~100 queries/day.
- **Structured data belongs in SQL, not embeddings.** Embeddings destroy the relationships that make structured data valuable. Route analytical queries to databases.
- **Start standard, go agentic only when forced.** Every agent loop multiplies latency and cost. Add agency only for query types that demonstrably fail with single-shot retrieval.
- **Most production systems combine approaches.** RAG + SQL, RAG + fine-tuning, RAG + agents — the right answer is almost always a hybrid.

## Related

- [What Is RAG & When to Use It](01-what-is-rag.md) — the foundational RAG concepts this page builds on
- [Designing Before Building](../module-02/01-requirements.md) — how these trade-offs map to concrete requirements
- [CSV, Excel & Structured Data](../module-04/02-csv-excel.md) — deep dive on the RAG vs SQL decision for tabular data
