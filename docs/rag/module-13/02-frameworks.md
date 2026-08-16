---
title: Evaluation Frameworks & Datasets
outline: deep
---

# Evaluation Frameworks & Datasets

Interview weight: 🔥🔥 | Prerequisites: [Retrieval & Generation Metrics](01-metrics.md)

## 🗣️ In Plain English

::: tip In Plain English
Metrics tell you *what* to measure, but frameworks tell you *how* to measure it at scale. Think of it like grading exams: the rubric (metrics) says what a good answer looks like, but you still need a grading system -- automated scoring, human spot-checks, and a question bank. That is what evaluation frameworks provide for RAG systems.
:::

## ⚙️ Under the Hood

### RAGAS Framework

**RAGAS** (Retrieval Augmented Generation Assessment) is the most widely adopted open-source RAG evaluation framework. It measures four core dimensions:

| Metric | What It Evaluates | Needs Ground Truth? |
|--------|-------------------|-------------------|
| Faithfulness | Is the answer grounded in context? | No |
| Answer Relevance | Does the answer address the question? | No |
| Context Precision | Are relevant chunks ranked higher? | Yes |
| Context Recall | Did retrieval find all needed info? | Yes |

**How RAGAS works internally:**

1. **Faithfulness:** The LLM decomposes the answer into atomic claims, then checks each claim against the retrieved context using natural language inference. Score = supported claims / total claims.

2. **Answer Relevance:** The LLM generates N questions from the answer. Cosine similarity between original question and generated questions is averaged.

3. **Context Precision:** For each chunk in the retrieved context, the LLM judges if it is relevant to answering the question. Precision is weighted by rank position (higher-ranked relevant chunks score better).

4. **Context Recall:** The LLM decomposes the ground-truth answer into claims and checks if each claim can be attributed to the retrieved context.

**Using RAGAS in practice:**

```typescript
// run: npx tsx ragas-eval.ts
// Conceptual — RAGAS is Python-native, but the pattern applies to any framework

interface RAGASInput {
  question: string;
  answer: string;
  contexts: string[];       // retrieved chunks
  ground_truth?: string;    // needed for context_recall, answer_correctness
}

interface RAGASOutput {
  faithfulness: number;     // 0-1
  answer_relevancy: number; // 0-1
  context_precision: number; // 0-1 (needs ground_truth)
  context_recall: number;   // 0-1 (needs ground_truth)
}

// Typical evaluation run:
// 1. Prepare 100-500 evaluation samples
// 2. Run your RAG pipeline on each question
// 3. Pass (question, answer, contexts, ground_truth) to RAGAS
// 4. Aggregate scores across all samples
```

**RAGAS limitations:**

- **LLM dependency:** RAGAS itself uses an LLM (usually GPT-4) to compute metrics. Different judge LLMs produce different scores. Scores are not comparable across judge models.
- **Cost:** Evaluating 500 samples with 4 metrics can cost $10-50 in LLM API calls.
- **Prompt sensitivity:** The internal prompts for claim decomposition and NLI checking can produce inconsistent results on edge cases.
- **Binary simplification:** Faithfulness treats claims as either supported or not -- it does not handle partial support or nuance well.

---

### LLM-as-Judge

Using a strong LLM (GPT-4, Claude) to evaluate RAG outputs. More flexible than RAGAS because you write custom evaluation prompts.

**The scoring prompt pattern:**

```typescript
// run: npx tsx llm-judge.ts
const evaluationPrompt = `You are an expert evaluator for a RAG system.

Given:
- User Question: {question}
- Retrieved Context: {context}
- Generated Answer: {answer}

Evaluate the answer on these dimensions (1-5 scale):

1. **Faithfulness**: Does the answer ONLY contain information supported by the context?
   1 = completely fabricated, 5 = every claim is directly supported

2. **Completeness**: Does the answer address all aspects of the question using available context?
   1 = misses the question entirely, 5 = fully addresses the question

3. **Clarity**: Is the answer well-structured and easy to understand?
   1 = incoherent, 5 = clear and well-organized

For each dimension, provide:
- Score (1-5)
- One-sentence justification

Respond in JSON format:
{
  "faithfulness": { "score": N, "justification": "..." },
  "completeness": { "score": N, "justification": "..." },
  "clarity": { "score": N, "justification": "..." }
}`;
```

**Calibration issues and mitigations:**

| Problem | Description | Mitigation |
|---------|-------------|-----------|
| Position bias | LLM favors first/last options in comparisons | Randomize order, evaluate independently |
| Verbosity bias | Longer answers score higher | Explicitly penalize unnecessary length |
| Self-preference | GPT-4 rates GPT-4 outputs higher than Claude | Use a different model as judge than generator |
| Score compression | Most scores cluster at 4-5 | Use pairwise comparison instead of absolute scores |
| Inconsistency | Same input gets different scores on re-run | Average 3+ runs, use temperature=0 |

**Pairwise comparison (more reliable than absolute scoring):**

Instead of "rate this answer 1-5", ask: "Which answer is better, A or B?" This is more reliable because humans and LLMs are better at *comparative* judgments than *absolute* ones.

```typescript
// run: npx tsx pairwise-eval.ts
const pairwisePrompt = `Given the question and two candidate answers, which answer is better?

Question: {question}
Context: {context}

Answer A: {answer_a}
Answer B: {answer_b}

Consider: faithfulness to context, completeness, clarity.
Respond with: "A", "B", or "tie", followed by a brief justification.`;

// Run twice with A/B swapped to detect position bias
// If results disagree → tie
```

---

### Human Evaluation

**When LLM judges are not enough:**

- Evaluating subjective quality (tone, helpfulness, empathy)
- Validating LLM judge accuracy (calibration)
- High-stakes domains (medical, legal, financial) where automated metrics are not trusted
- Building the initial ground-truth dataset

**Inter-annotator agreement:**

When multiple humans evaluate the same sample, they will disagree. Measure agreement with **Cohen's Kappa** (2 annotators) or **Fleiss' Kappa** (3+ annotators):

| Kappa Range | Interpretation |
|------------|---------------|
| 0.0 - 0.20 | Slight agreement |
| 0.21 - 0.40 | Fair agreement |
| 0.41 - 0.60 | Moderate agreement |
| 0.61 - 0.80 | Substantial agreement |
| 0.81 - 1.00 | Almost perfect agreement |

If kappa < 0.60, your evaluation criteria are ambiguous -- fix the rubric before collecting more labels.

**Practical setup:**

- 3 annotators per sample minimum
- 200-500 samples for reliable aggregate metrics
- Majority vote for final label
- Track per-annotator statistics to catch low-quality annotators

---

### Building Evaluation Datasets

The quality of your evaluation is only as good as your dataset. A RAG evaluation dataset has four columns:

```text
Question → Expected Documents → Expected Answer → Evaluation Criteria
```

**Methods to build the dataset:**

**1. Manual curation (highest quality, highest cost):**
- Domain experts write questions they know the answer to
- Tag which documents contain the answer
- Write the expected answer
- Best for: initial dataset, high-stakes domains

**2. Synthetic generation (scalable, needs validation):**

```typescript
// run: npx tsx generate-eval-dataset.ts
const syntheticPrompt = `Given this document chunk, generate a question-answer pair
that can ONLY be answered using information in this chunk.

Chunk: {chunk_text}

Generate:
1. A natural question a user might ask
2. The correct answer based ONLY on the chunk
3. A harder variant of the question (requires reasoning, not just extraction)

Output JSON:
{
  "simple_question": "...",
  "simple_answer": "...",
  "hard_question": "...",
  "hard_answer": "..."
}`;

// Pipeline:
// 1. Sample 200 chunks from your corpus
// 2. Generate QA pairs with a strong LLM
// 3. Human review 100% of generated pairs (remove bad ones)
// 4. Result: 300-500 validated QA pairs
```

**3. Production traffic mining (most realistic):**
- Log real user queries
- Sample queries, run them through the pipeline
- Have humans annotate whether the answer was correct
- Tag which retrieved documents were relevant
- Best for: ongoing evaluation, catches real distribution

**4. Adversarial / edge-case generation:**
- Deliberately craft queries that stress the system:
  - Ambiguous queries ("What is the limit?" -- which limit?)
  - Multi-hop queries requiring info from multiple documents
  - Queries with no answer in the corpus (should say "I don't know")
  - Queries about recently updated information

---

### Offline vs Online Evaluation

| Dimension | Offline Evaluation | Online Evaluation |
|-----------|-------------------|-------------------|
| When | Before deployment, in CI/CD | After deployment, in production |
| Data | Curated eval dataset | Real user traffic |
| Metrics | All metrics (have ground truth) | System metrics + implicit feedback |
| Cost | LLM judge costs only | Free (implicit) to expensive (human review) |
| Latency | Minutes to hours | Continuous |
| What it catches | Regressions, config changes | Distribution shift, real user needs |

**Offline evaluation pipeline:**

```text
Code change → CI triggers eval →
  Run pipeline on eval dataset →
    Compute metrics →
      Compare to baseline →
        Pass/fail gate → Deploy
```

**Online evaluation signals:**

- **Explicit:** thumbs up/down, star ratings, "was this helpful?"
- **Implicit:** did the user reformulate the question (= bad answer), did they click citations (= engaged), did they escalate to a human (= system failed), session length, copy/paste behavior

---

### Using Evaluation to Compare Strategies

The most practical use of evaluation: **A/B test your RAG pipeline changes.**

```yaml
Experiment: "Does adding a reranker improve quality?"

Control:  query → embed → vector search top-10 → LLM
Variant:  query → embed → vector search top-20 → rerank to top-5 → LLM

Run both on 500 eval questions.
Compare: Recall@5, NDCG@5, Faithfulness, Answer Correctness, P95 latency, cost/query

Results:
  Recall@5:       0.72 → 0.85  (+18%)
  NDCG@5:         0.65 → 0.82  (+26%)
  Faithfulness:   0.83 → 0.89  (+7%)
  Correctness:    0.71 → 0.79  (+11%)
  P95 latency:    1.8s → 2.1s  (+17%)
  Cost/query:     $0.008 → $0.009 (+12%)

Decision: reranker adds 300ms and $0.001 but significantly improves quality → deploy.
```

---

### Continuous Evaluation Pipeline

In production, evaluation is not a one-time activity. Build a **continuous loop**:

```text
                    ┌─────────────────────┐
                    │   Production RAG    │
                    │      System         │
                    └─────────┬───────────┘
                              │ logs queries + responses
                              ▼
                    ┌─────────────────────┐
                    │   Sample & Store    │
                    │   (1-5% of traffic) │
                    └─────────┬───────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌──────────────┐ ┌─────────────┐ ┌──────────────┐
     │  LLM Judge   │ │   Human     │ │   Implicit   │
     │  (automated) │ │   Review    │ │   Signals    │
     └──────┬───────┘ └──────┬──────┘ └──────┬───────┘
            │                │               │
            └────────────────┼───────────────┘
                             ▼
                    ┌─────────────────────┐
                    │   Metrics Dashboard │
                    │   + Alerts          │
                    └─────────┬───────────┘
                              │ regression detected
                              ▼
                    ┌─────────────────────┐
                    │   Investigate &     │
                    │   Improve Pipeline  │
                    └─────────────────────┘
```

**Alert thresholds (example):**
- Faithfulness drops below 0.80 → page on-call
- Error rate exceeds 2% → page on-call
- P95 latency exceeds 5s → warning
- Cost per query exceeds $0.02 → warning

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Evaluating without ground truth.** A team ran RAGAS with only faithfulness and answer relevance (no ground truth needed) and reported "quality is great." But they never measured recall or correctness. Their retriever was missing 40% of relevant documents -- the LLM was faithfully generating answers from incomplete context. **Metrics without ground truth can only catch hallucination, not omission.**

**LLM judge drift.** A team set up automated evaluation with GPT-4 as judge in January. By March, the provider had updated the model's weights. Evaluation scores shifted by 5-10% without any change to their RAG system. They had no human baseline to detect the drift. **Pin your judge model version and re-calibrate quarterly.**

**Synthetic eval datasets that are too easy.** A team generated QA pairs from their own chunks. Every question was a simple factual extraction ("What year was X founded?"). Their system scored 0.95 on this dataset. Real users asked multi-hop, ambiguous, and comparative questions -- actual quality was around 0.55. **Include adversarial and multi-hop questions in your eval set.**
:::

## 🎯 Checkpoint

::: details Question 1 -- RAGAS without ground truth
**Q:** You want to evaluate your RAG system but you do not have a ground-truth dataset. Which RAGAS metrics can you still compute, and what blind spots will you have?

**A:** Without ground truth, you can compute **faithfulness** (checks answer against retrieved context) and **answer relevance** (checks if answer addresses the question). You cannot compute **context recall** (needs ground truth to know what should have been retrieved) or **answer correctness** (needs ground truth answer to compare against).

Blind spots: You will not know if your retriever is **missing relevant documents** -- faithfulness only checks that the answer matches what was retrieved, not that what was retrieved was complete. A system can be perfectly faithful to wrong or incomplete context. You also cannot detect systematic knowledge gaps.
:::

::: details Question 2 -- LLM judge vs human evaluation
**Q:** When would you invest in human evaluation instead of relying solely on LLM-as-judge?

**A:** Human evaluation is worth the investment when: (1) **Building the initial calibration set** -- you need human labels to validate that your LLM judge agrees with humans (measure correlation, not just trust the LLM). (2) **High-stakes domains** like medical or legal where automated metrics are not trusted by regulators or users. (3) **Subjective quality dimensions** like tone, empathy, or cultural appropriateness that LLMs assess poorly. (4) **Detecting LLM judge drift** -- periodic human spot-checks catch when the judge model's behavior changes. (5) **Disagreement resolution** -- when your LLM judge gives inconsistent scores, humans provide the tiebreaker. A practical strategy: use LLM judges for 100% of samples (cheap), human evaluation for 5-10% (expensive but essential for calibration).
:::

::: details Question 3 -- A/B testing a pipeline change
**Q:** You want to compare two chunking strategies. Design the evaluation process.

**A:** (1) **Prepare:** Take your evaluation dataset (300+ QA pairs with ground-truth documents and answers). (2) **Ingest twice:** Process your corpus with both chunking strategies into separate vector collections. (3) **Run both pipelines:** For each eval question, run retrieval + generation with Strategy A and Strategy B. Keep everything else identical (same embedding model, same LLM, same prompt). (4) **Compute per-question metrics:** Recall@10, NDCG@10, Faithfulness, Answer Correctness, latency, token usage. (5) **Statistical comparison:** Use paired t-test or Wilcoxon signed-rank test on per-question scores. Do not just compare averages -- check if the difference is statistically significant (p < 0.05). (6) **Segment analysis:** Break results by question type (factual, multi-hop, comparative) to see if one strategy wins on specific categories. (7) **Cost analysis:** Compare total tokens used (different chunk sizes = different context lengths = different costs).
:::

## Key Mental Models

- **RAGAS is a starting point, not a finish line** -- it measures four things well but has blind spots around nuance, multi-hop reasoning, and calibration stability.
- **LLM judges need judges** -- always calibrate automated evaluation against human labels. An uncalibrated LLM judge gives you false confidence.
- **Eval datasets are a product** -- invest in them like you invest in code. A bad eval dataset is worse than no eval dataset because it gives false signal.
- **Offline evaluation gates deployment, online evaluation drives improvement** -- you need both, and they measure different things.

## Related

- [Retrieval & Generation Metrics](01-metrics.md) -- the metrics these frameworks compute
- [Reranking](/rag/module-11/) -- a common pipeline change to A/B test with evaluation
- [Chunking strategies](/rag/module-05/) -- another axis to evaluate
