---
title: Corrective RAG & Self-RAG
outline: deep
---

# Corrective RAG & Self-RAG

**Interview weight:** 🔥🔥 | **Prerequisites:** [Agentic RAG](01-agentic-rag.md), [Evaluation](/rag/module-13/)

## 🗣️ In Plain English

::: tip In Plain English
Basic RAG trusts whatever the retriever hands back. CRAG and Self-RAG add a quality inspector between retrieval and generation — the system checks "are these documents actually relevant?" and, if not, rewrites the query, tries a different source, or admits it cannot answer. It is self-correcting search, not blind search.
:::

## ⚙️ Under the Hood

### Corrective RAG (CRAG)

CRAG (Yan et al., 2024, "Corrective Retrieval Augmented Generation", arXiv:2401.15884) adds a **retrieval evaluator** that scores each retrieved document before generation.

**The three verdicts:**

| Verdict | Meaning | Action |
|---------|---------|--------|
| **Correct** | Document clearly addresses the query | Use for generation |
| **Incorrect** | Document is irrelevant | Discard; trigger web-search fallback |
| **Ambiguous** | Partially relevant or unclear | Decompose query, refine, re-retrieve |

**CRAG pipeline:**

```text
Query → Retrieve top-K → Evaluate each doc →
  ├─ All correct → Generate with retrieved docs
  ├─ Some incorrect → Discard bad docs + web-search fallback → Generate
  └─ Ambiguous → Decompose query → Re-retrieve → Re-evaluate → Generate
```

**Decompose–recompose refinement:** When documents are ambiguous, CRAG breaks the original query into sub-questions, retrieves for each independently, then recomposes the partial answers.

### Self-RAG

Self-RAG (Asai et al., 2023, "Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection", arXiv:2310.11511) trains the LLM itself to emit **reflection tokens** that control retrieval and self-critique.

**The four reflection tokens:**

| Token | Purpose | Values |
|-------|---------|--------|
| **Retrieve** | Should I retrieve for this segment? | `yes` / `no` / `continue` |
| **ISREL** | Is retrieved doc relevant to the query? | `relevant` / `irrelevant` |
| **ISSUP** | Is my generation supported by the doc? | `fully` / `partially` / `no` |
| **ISUSE** | Is my generation useful to the user? | `5` (best) … `1` (worst) |

**Self-RAG flow:**

```text
Query → LLM decides [Retrieve: yes/no]
  ├─ [Retrieve: no] → Generate directly (no docs needed)
  └─ [Retrieve: yes] → Retrieve docs → For each:
       ├─ [ISREL: irrelevant] → Skip doc
       └─ [ISREL: relevant] → Generate segment →
            ├─ [ISSUP: no] → Discard, retry
            └─ [ISSUP: fully/partially] → Score [ISUSE] → Pick best
```

**Key distinction:** Self-RAG decides *whether* to retrieve at all — the LLM can answer directly when it has sufficient parametric knowledge, saving the retrieval cost entirely.

### Comparison Table

| Dimension | Basic RAG | CRAG | Self-RAG | Full Agentic RAG |
|-----------|-----------|------|----------|-------------------|
| Retrieval evaluation | None | External evaluator | LLM reflection tokens | LLM + tools |
| On-demand retrieval | No (always retrieves) | No (always retrieves) | Yes (Retrieve token) | Yes (tool calls) |
| Self-critique | None | None | ISSUP + ISUSE tokens | Reflection step |
| Fallback strategy | None | Web search | Skip/retry | Multi-source routing |
| Added LLM calls | 0 | 1 (evaluator) | 0 (single model) | 2-10+ |
| Added latency | 0 | +200-500ms | ~0 (in-model) | +2-15s |
| Training required | No | No (classifier) | Yes (fine-tune) | No |
| Best for | Simple use cases | Unreliable retrieval | Research/high precision | Complex multi-step |

### When to Use Each

- **CRAG** when retrieval quality varies (noisy corpus, broad queries) and you want a safety net without fine-tuning.
- **Self-RAG** when you need maximum precision and can fine-tune your model with reflection tokens.
- **Full agentic RAG** when the task requires multi-step reasoning, tool use, or routing across multiple data sources.
- **Basic RAG** when your corpus is clean, queries are straightforward, and latency/cost matter most.

### TypeScript Sketch: CRAG-Style Loop

```typescript
// run: npx tsx crag-loop.ts
interface RetrievedDoc {
  id: string;
  content: string;
  score: number;
}

type Verdict = "correct" | "incorrect" | "ambiguous";

async function evaluateRelevance(query: string, doc: RetrievedDoc): Promise<Verdict> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Rate document relevance to the query. Respond with exactly: correct, incorrect, or ambiguous." },
        { role: "user", content: `Query: ${query}\n\nDocument: ${doc.content.slice(0, 500)}` },
      ],
      temperature: 0,
    }),
  });
  const data = await response.json();
  return data.choices[0].message.content.trim().toLowerCase() as Verdict;
}

async function cragRetrieve(query: string, retrieveFn: (q: string) => Promise<RetrievedDoc[]>): Promise<RetrievedDoc[]> {
  const docs = await retrieveFn(query);
  const evaluated = await Promise.all(
    docs.map(async (doc) => ({ doc, verdict: await evaluateRelevance(query, doc) }))
  );

  const correct = evaluated.filter((e) => e.verdict === "correct").map((e) => e.doc);
  const ambiguous = evaluated.filter((e) => e.verdict === "ambiguous").map((e) => e.doc);

  // All good — proceed
  if (correct.length >= 3) return correct;

  // Too few good results — fallback to web search or broader query
  if (correct.length === 0 && ambiguous.length === 0) {
    const webDocs = await retrieveFn(`site:docs.example.com ${query}`); // web-search fallback
    return webDocs;
  }

  // Ambiguous — rewrite and re-retrieve
  const rewrittenQuery = await rewriteQuery(query);
  const retried = await retrieveFn(rewrittenQuery);
  return [...correct, ...retried.slice(0, 5 - correct.length)];
}

async function rewriteQuery(query: string): Promise<string> {
  // Simplified — in production, use LLM to decompose/refine
  return `${query} (detailed explanation)`;
}
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
1. **Evaluator hallucination:** The relevance evaluator itself can be wrong — it may mark relevant docs as "incorrect," causing unnecessary fallbacks and increased latency. Calibrate thresholds carefully.
2. **Infinite retry loops:** A CRAG system with aggressive re-retrieval can loop (query → bad results → rewrite → still bad → rewrite again). Always set a max-retry limit (2-3 attempts) with a final "I don't know" fallback.
3. **Self-RAG requires fine-tuning:** Unlike CRAG (which uses any LLM as an evaluator), Self-RAG's reflection tokens require training a custom model. This is impractical for teams using only API-based LLMs.
4. **Latency variance:** CRAG adds 200-500ms per query when the evaluator runs. In the failure path (rewrite + re-retrieve), total latency can spike to 3-5x normal. Monitor P99 carefully.
:::

## 🎯 Checkpoint

::: details Question 1 — CRAG vs Self-RAG: core difference?
**Q:** What is the fundamental architectural difference between CRAG and Self-RAG?

**A:** CRAG uses an **external evaluator** (a separate LLM call or classifier) to judge retrieval quality *after* retrieval always happens. Self-RAG trains **reflection tokens into the generation model itself**, allowing it to decide *whether* to retrieve at all, and to self-critique its own output for factual support. CRAG is a pipeline modification; Self-RAG is a model modification.
:::

::: details Question 2 — When does CRAG hurt more than help?
**Q:** In what scenario would adding CRAG to a production RAG system make things worse?

**A:** When the corpus is high-quality and queries are well-matched (e.g., a curated FAQ), the evaluator adds latency and cost without catching real problems. Worse, a poorly-calibrated evaluator may reject valid documents (false negatives), triggering expensive fallback paths and potentially returning lower-quality web results. CRAG is most valuable when retrieval quality is *unreliable* — noisy corpora, broad queries, or multi-source indexes.
:::

::: details Question 3 — Implementing CRAG without fine-tuning?
**Q:** How would you implement a CRAG-style system using only API-based LLMs (no fine-tuning)?

**A:** Use a cheap, fast model (e.g., GPT-4o-mini) as the evaluator with a simple classification prompt: "Is this document relevant to the query? Answer: correct/incorrect/ambiguous." Run this on all retrieved docs in parallel. Filter based on verdicts. For the fallback path, rewrite the query using the same cheap model and re-retrieve. This gives you CRAG's benefits without any model training — just an extra LLM call per retrieved document (~$0.001-0.01 per query depending on doc count).
:::

## Key Mental Models

- **CRAG = quality gate after retrieval.** Evaluate before you generate; discard bad results rather than feeding garbage to the LLM.
- **Self-RAG = built-in quality conscience.** The model itself knows when it needs more info and when its output is unsupported.
- **Both solve the "garbage in, garbage out" problem** — the #1 cause of RAG hallucination is relevant-looking but actually irrelevant retrieved documents.
- **CRAG is deploy-tomorrow practical; Self-RAG is research-grade.** Choose based on whether you can fine-tune.
- **Set retry limits.** Any self-correcting system can loop. Cap attempts and fall back to abstention.

## Related

- [Agentic RAG](01-agentic-rag.md) — CRAG and Self-RAG are stepping stones toward full agentic retrieval
- [Hallucination Mitigation](/rag/module-12/02-hallucination) — CRAG directly reduces retrieval-caused hallucination
- [Evaluation](/rag/module-13/) — you need retrieval quality metrics to calibrate the evaluator
- [Reranking](/rag/module-11/01-reranking) — reranking is a lighter alternative when retrieval quality is decent but ordering is off
