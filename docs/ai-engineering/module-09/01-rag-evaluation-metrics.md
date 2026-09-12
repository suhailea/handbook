---
title: RAG Evaluation Metrics
outline: deep
---

# RAG Evaluation Metrics

🔥🔥🔥 Interview weight | Prerequisites: [8.1 AI System Patterns](../module-08/01-ai-system-patterns), [ML 1.6 ML Metrics](/ml-foundations/module-01/06-ml-metrics)

## 🗣️ In Plain English

::: tip In Plain English
A RAG system has two phases: finding the right documents (retrieval) and writing a good answer from them (generation). Each phase can fail independently, and they fail in different ways.

**Retrieval failure** is like sending a research assistant to a library and they come back with the wrong books. Your answer will be wrong no matter how smart the assistant is. Even if they write beautifully, they're writing about the wrong topic.

**Generation failure** is when the research assistant found exactly the right books but then ignored what they said and made something up. Or only used part of the information and missed the crucial exception.

These are entirely different problems requiring different measurements.

For **retrieval**, you care about: "Did the system find the right documents?" You need to know whether the relevant document was in the top results, how high it ranked, and whether less-relevant documents pushed important ones down.

- **Recall@K**: Of all the relevant documents in my database, what fraction appeared in the top K results? If there are 5 relevant documents and only 3 appeared in your top 10, Recall@10 = 0.6.
- **Precision@K**: Of the K documents returned, what fraction were actually relevant? If 3 of 10 returned documents are relevant, Precision@10 = 0.3.
- **MRR (Mean Reciprocal Rank)**: Where did the first relevant document appear? If it was result #1, MRR = 1.0. If it was result #5, MRR = 0.2. Matters when users read only the top result.

For **generation**, you care about: "Was the answer good?"

- **Faithfulness**: Did the model stick to what the documents said, or did it add facts from its training data? A faithful answer only makes claims supported by the retrieved context.
- **Correctness**: Is the answer actually right compared to ground truth? (Different from faithfulness — a model can be faithful to wrong documents.)
- **Relevance**: Did the answer actually address what was asked?
:::

## ⚙️ Under the Hood

### Retrieval Metrics

#### Recall@K and Precision@K

For each query, assume you know the ground-truth set of relevant documents `R`:

```python
# run: python retrieval_metrics.py
from typing import Any

def recall_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    """Fraction of relevant docs found in top-K retrieved"""
    if not relevant:
        return 0.0
    retrieved_k = set(retrieved[:k])
    return len(retrieved_k & relevant) / len(relevant)

def precision_at_k(retrieved: list[str], relevant: set[str], k: int) -> float:
    """Fraction of top-K retrieved that are relevant"""
    if k == 0:
        return 0.0
    retrieved_k = retrieved[:k]
    return sum(1 for doc in retrieved_k if doc in relevant) / k

def average_precision(retrieved: list[str], relevant: set[str]) -> float:
    """Area under precision-recall curve; rewards high-ranked relevant docs"""
    if not relevant:
        return 0.0
    score = 0.0
    num_relevant_found = 0
    for i, doc in enumerate(retrieved, 1):
        if doc in relevant:
            num_relevant_found += 1
            score += num_relevant_found / i  # precision at this rank
    return score / len(relevant)

# Example
relevant_docs = {"doc_A", "doc_C", "doc_E"}
retrieved_order = ["doc_A", "doc_B", "doc_C", "doc_D", "doc_E", "doc_F", "doc_G", "doc_H", "doc_I", "doc_J"]

for k in [1, 3, 5, 10]:
    r = recall_at_k(retrieved_order, relevant_docs, k)
    p = precision_at_k(retrieved_order, relevant_docs, k)
    print(f"K={k:2d}: Recall={r:.2f}, Precision={p:.2f}")

ap = average_precision(retrieved_order, relevant_docs)
print(f"Average Precision: {ap:.4f}")
```

**MAP (Mean Average Precision)**: average of AP across all queries. The standard single-number retrieval quality metric.

```python
def mean_average_precision(queries: list[dict[str, Any]]) -> float:
    """queries: list of {'retrieved': [...], 'relevant': set(...)}"""
    return sum(
        average_precision(q['retrieved'], q['relevant'])
        for q in queries
    ) / len(queries)
```

#### MRR — Mean Reciprocal Rank

Particularly important when users only look at the top result (e.g., the first source citation displayed):

```python
# run: python mrr_demo.py

def reciprocal_rank(retrieved: list[str], relevant: set[str]) -> float:
    """Inverse of the rank of the first relevant result"""
    for rank, doc in enumerate(retrieved, 1):
        if doc in relevant:
            return 1.0 / rank
    return 0.0  # no relevant document found

def mean_reciprocal_rank(queries: list[dict]) -> float:
    return sum(
        reciprocal_rank(q['retrieved'], q['relevant'])
        for q in queries
    ) / len(queries)

# Examples
examples = [
    {"retrieved": ["doc_A", "doc_B", "doc_C"], "relevant": {"doc_A"}},  # rank 1 → RR=1.0
    {"retrieved": ["doc_X", "doc_B", "doc_A"], "relevant": {"doc_A"}},  # rank 3 → RR=0.33
    {"retrieved": ["doc_X", "doc_Y", "doc_Z"], "relevant": {"doc_A"}},  # not found → RR=0
]

for ex in examples:
    rr = reciprocal_rank(ex["retrieved"], ex["relevant"])
    print(f"RR={rr:.3f}: retrieved={ex['retrieved'][:3]}")

mrr = mean_reciprocal_rank(examples)
print(f"\nMRR: {mrr:.4f}")
```

#### NDCG — Normalized Discounted Cumulative Gain

Unlike Recall@K (binary: relevant or not), NDCG supports **graded relevance** (e.g., highly relevant = 3, somewhat relevant = 1, not relevant = 0). It also penalizes relevant documents appearing lower in the ranking.

```python
# run: python ndcg_demo.py
import numpy as np

def dcg(relevance_scores: list[int], k: int) -> float:
    """Discounted Cumulative Gain: log2(rank+1) discount"""
    k = min(k, len(relevance_scores))
    gains = [rel / np.log2(rank + 2)  # rank 0-indexed; log2(2)=1, log2(3)≈1.58
             for rank, rel in enumerate(relevance_scores[:k])]
    return sum(gains)

def ndcg(retrieved_relevance: list[int], k: int) -> float:
    """NDCG = DCG / IDCG (ideal DCG where best docs are first)"""
    ideal_relevance = sorted(retrieved_relevance, reverse=True)
    idcg = dcg(ideal_relevance, k)
    if idcg == 0:
        return 0.0
    return dcg(retrieved_relevance, k) / idcg

# Relevance scores for retrieved documents (0=not relevant, 1=somewhat, 2=very relevant)
# Scenario 1: best docs retrieved first
retrieved_best_first = [2, 2, 1, 0, 1, 0, 0, 0, 0, 0]
# Scenario 2: best docs buried at bottom
retrieved_worst_first = [0, 0, 0, 0, 1, 0, 1, 0, 2, 2]

for k in [3, 5, 10]:
    best = ndcg(retrieved_best_first, k)
    worst = ndcg(retrieved_worst_first, k)
    print(f"NDCG@{k}: best_first={best:.4f}, worst_first={worst:.4f}")
```

### Generation Metrics

For generation quality, ground-truth comparison is difficult — LLM answers are free-form. Three approaches:

1. **Human evaluation**: expensive, slow, gold standard
2. **Reference-based metrics**: compare to a known-correct answer (ROUGE, BLEU, BERTScore)
3. **LLM-as-Judge**: use a stronger LLM to evaluate the answer

#### Reference-Based Metrics

```python
# run: python generation_reference_metrics.py
# pip install rouge-score bert-score

from rouge_score import rouge_scorer

scorer = rouge_scorer.RougeScorer(['rouge1', 'rouge2', 'rougeL'], use_stemmer=True)

reference = "The company was founded in 2010 by Alice Johnson and Bob Smith in San Francisco."
candidate_good = "Alice Johnson and Bob Smith founded the company in San Francisco in 2010."
candidate_bad = "The company has offices in New York and was established decades ago."

for name, candidate in [("Good", candidate_good), ("Bad", candidate_bad)]:
    scores = scorer.score(reference, candidate)
    print(f"\n{name}:")
    for metric, score in scores.items():
        print(f"  {metric}: P={score.precision:.3f}, R={score.recall:.3f}, F1={score.fmeasure:.3f}")
```

ROUGE is commonly used but has known limitations: it rewards word overlap, not semantic correctness. A synonym-heavy correct answer scores poorly; a word-matching incorrect answer scores well.

#### LLM-as-Judge for RAG

```python
# run: python llm_judge_rag.py
from openai import OpenAI
import json

client = OpenAI()

def evaluate_faithfulness(
    context: str,
    question: str,
    answer: str,
) -> dict:
    """Is every claim in the answer supported by the context?"""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": """You are an expert evaluator for RAG systems.
Evaluate whether the answer is FAITHFUL to the provided context.
Faithful = every factual claim in the answer is explicitly supported by the context.
Unfaithful = the answer adds information NOT in the context (even if the added info might be true).

Respond as JSON:
{
  "faithfulness_score": 0.0-1.0,
  "verdict": "faithful" | "unfaithful",
  "unfaithful_claims": ["list of claims not supported by context"],
  "reasoning": "brief explanation"
}"""
            },
            {
                "role": "user",
                "content": f"""Context:
{context}

Question: {question}

Answer: {answer}

Evaluate faithfulness:"""
            }
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)

def evaluate_correctness(
    question: str,
    answer: str,
    ground_truth: str,
) -> dict:
    """Is the answer factually correct compared to the known truth?"""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": """Evaluate whether the answer is factually correct compared to the ground truth.
Respond as JSON:
{
  "correctness_score": 0.0-1.0,
  "verdict": "correct" | "partially_correct" | "incorrect",
  "missing_information": ["key facts from ground truth not in answer"],
  "incorrect_claims": ["claims that contradict the ground truth"],
  "reasoning": "brief explanation"
}"""
            },
            {
                "role": "user",
                "content": f"""Question: {question}

Ground Truth Answer: {ground_truth}

System Answer: {answer}

Evaluate correctness:"""
            }
        ],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)

# Example evaluation
context = """
TaskFlow's refund policy allows refunds within 30 days of purchase.
Refunds are processed within 5-7 business days.
Subscription cancellations take effect at the end of the billing period.
"""

question = "How long does it take to process a refund at TaskFlow?"
ground_truth = "Refunds at TaskFlow are processed within 5-7 business days."
good_answer = "According to TaskFlow's policy, refunds are processed within 5-7 business days."
bad_answer = "TaskFlow processes refunds within 1-2 business days and cancels subscriptions immediately."

for name, answer in [("Good", good_answer), ("Bad", bad_answer)]:
    faith = evaluate_faithfulness(context, question, answer)
    correct = evaluate_correctness(question, answer, ground_truth)
    print(f"\n--- {name} Answer ---")
    print(f"Faithfulness: {faith['faithfulness_score']:.1f} ({faith['verdict']})")
    print(f"Correctness:  {correct['correctness_score']:.1f} ({correct['verdict']})")
```

### Building a RAG Evaluation Dataset

```python
# run: python build_eval_dataset.py
from openai import OpenAI
import json

client = OpenAI()

def generate_qa_pairs(document: str, n_questions: int = 5) -> list[dict]:
    """Auto-generate question-answer pairs from a document for RAG evaluation"""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": f"""Generate {n_questions} question-answer pairs from the document.
Questions should be answerable ONLY from this document.
Include both simple factual and more complex inferential questions.

Respond as JSON array:
[{{"question": "...", "answer": "...", "relevant_quote": "..."}}]"""
            },
            {"role": "user", "content": document}
        ],
        response_format={"type": "json_object"},
    )
    result = json.loads(response.choices[0].message.content)
    return result.get("pairs", result) if isinstance(result, dict) else result

# This creates a "golden dataset" — curated Q&A pairs with known-correct answers
# Used for regression testing: if RAG eval drops, a prompt or retrieval change broke something
```

### The Ragas Framework

Ragas (RAG Assessment) is a popular open-source framework for automated RAG evaluation:

```python
# run: python ragas_demo.py
# pip install ragas datasets

from datasets import Dataset
from ragas import evaluate
from ragas.metrics import (
    faithfulness,
    answer_relevancy,
    context_recall,
    context_precision,
)

# Each row: question, answer, contexts (retrieved), ground_truth
data = {
    "question": ["What is the refund period at TaskFlow?"],
    "answer": ["Refunds are processed within 5-7 business days."],
    "contexts": [["TaskFlow's refund policy allows refunds within 30 days. Processed in 5-7 business days."]],
    "ground_truth": ["5-7 business days"],
}

dataset = Dataset.from_dict(data)
result = evaluate(
    dataset,
    metrics=[faithfulness, answer_relevancy, context_recall, context_precision],
)
print(result)
# Returns scores 0-1 for each metric across all rows
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**High Recall@K but low Precision@K:** RAG returns 10 chunks but only 2 are relevant. The LLM context is 80% noise. Generation quality suffers even though the relevant documents were retrieved. Root cause: retrieval threshold too low, or no re-ranking step. Fix: add a cross-encoder re-ranker to re-score the top-K before passing to the LLM; lower K with higher minimum similarity threshold.

**LLM-as-Judge position bias:** When evaluating two answers (A vs B), the judge LLM consistently rates the first answer higher regardless of quality. This is position bias — LLMs are biased toward the first option. Fix: evaluate each answer independently (not comparatively); run paired comparisons both ways (A vs B, then B vs A) and average; or use a scoring rubric rather than pairwise comparison.

**Faithfulness high but correctness low:** The answer faithfully cites the retrieved context, but the retrieved context was wrong (outdated policy, incorrect fact in KB). Faithfulness measures "did the LLM stick to the context?" not "is the context right?" Fix: evaluate the knowledge base quality separately; audit source documents for staleness and accuracy; add a "source quality" metric that cross-checks key facts against authoritative sources.

**Eval dataset distribution mismatch:** The golden dataset has 100 well-formed questions written by engineers during development. Production queries are messier — typos, ambiguous phrasing, mixed languages, multi-part questions. Eval scores are 90%+; production quality is 65%. Fix: sample evaluation queries from real production traffic (with PII removed); include edge cases, ambiguous queries, and multi-language queries in the golden dataset.
:::

## 🎯 Checkpoint

::: details Question 1 — MRR vs MAP for RAG
**Q:** When should you optimize for MRR vs MAP in a RAG evaluation? Give a concrete scenario for each.

**A:** **MRR** is appropriate when only the first relevant document matters — typically when the RAG system shows a single top source or when the LLM's context window is very small and you pass only the top result. Example: a search assistant that shows one highlighted answer with one citation; if the first retrieved document isn't relevant, the system fails regardless of what's at rank 5. **MAP** is appropriate when multiple relevant documents contribute to the answer, and you want to know overall retrieval quality across the full result set. Example: a research assistant that synthesizes information from the top 10 documents; retrieving 5 relevant documents across ranks 1-10 is valuable, not just rank 1. For most RAG systems with K=3-5 context documents, NDCG@K or MAP@K is more appropriate than MRR, because multiple relevant chunks typically contribute to generation quality.
:::

::: details Question 2 — Hallucination types
**Q:** Explain the difference between a "faithful but incorrect" answer and an "unfaithful but correct" answer in a RAG system. How should you handle each?

**A:** **Faithful but incorrect**: the LLM correctly cites the retrieved context, but the retrieved context itself contains wrong information. Example: policy document says "refunds in 3-5 days" but the actual policy changed to 7-10 days and the document wasn't updated. The LLM's answer is faithful (matches the document) but incorrect (wrong timeframe). Diagnosis: evaluate context quality; implement freshness tracking for source documents; add fact-verification against authoritative sources for critical claims. **Unfaithful but correct**: the LLM uses its training knowledge rather than the retrieved context, and that knowledge happens to be correct. Example: context says nothing about return shipping costs, but the LLM (from training) adds "typically $5-10 shipping fee." The LLM may be right, but you can't verify it and the system is unreliable — the next time it adds unsupported facts, they might be wrong. Diagnosis: faithfulness metric catches this. Fix: explicitly instruct the LLM to say "I don't have information about X" when context doesn't cover a claim, rather than drawing on training knowledge.
:::

## Key Mental Models

- **RAG has two failure modes**: retrieval failure (wrong documents) and generation failure (wrong answer from right documents). Measure both separately.
- **Recall@K says "did we find the relevant documents?"; MRR says "did we find them first?"** — choose based on whether rank matters.
- **Faithfulness ≠ Correctness** — a faithful answer to a wrong document is still wrong; a correct answer from an unfaithful model is unreliable.
- **LLM-as-Judge has biases** — always use scoring rubrics, not comparative ranking; test for position bias.
- **Golden datasets must mirror production traffic** — eval on dev-authored questions gives artificially high scores.

## Related

- [9.3 Evaluation Pipeline](./03-evaluation-pipeline) — how to run these metrics at scale
- [ML 1.6 ML Metrics](/ml-foundations/module-01/06-ml-metrics) — classical ML metrics that ground these concepts
- [RAG Module 13 — Evaluation](/rag/module-13/) — deeper RAG evaluation in the RAG track
