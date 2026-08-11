---
title: Hallucination — Causes, Detection & Mitigation
outline: deep
---

# Hallucination — Causes, Detection & Mitigation

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [Grounded Generation](01-grounded-generation.md), [Context Construction](../module-11/02-context-construction.md), [Retrieval Strategies](../module-09/01-retrieval-strategies.md) | **Builds toward:** RAG evaluation and production monitoring

## 🗣️ In Plain English

::: tip In Plain English
Hallucination is when the LLM writes something that sounds correct but is not in the retrieved documents. It is the model filling in blanks with confident-sounding guesses. In RAG, this usually means retrieval failed (wrong documents), context was incomplete (the answer was not in the corpus), or the model simply ignored what it was given.
:::

## ⚙️ Under the Hood

### What Causes Hallucination in RAG

RAG hallucination has specific, diagnosable causes that differ from general LLM hallucination:

| Cause | Mechanism | Frequency |
|-------|-----------|-----------|
| **Retrieval failure** | Wrong documents retrieved — answer is in the corpus but not in the context | Very common |
| **Missing information** | Answer not in corpus at all — model fills the gap from parametric knowledge | Common |
| **Conflicting sources** | Two retrieved docs contradict each other — model picks one or merges incorrectly | Occasional |
| **Bad chunking** | Relevant information split across chunk boundaries — partial context misleads | Common |
| **Poor prompt** | Model ignores context and uses training data instead | Common with weak prompts |
| **Context overflow** | Too many chunks — relevant info buried in the middle, model misses it | Moderate |
| **Model limitation** | Even with perfect context, model misreads, misquotes, or confabulates details | Irreducible |

**The RAG hallucination chain:**

```
Retrieval Failure ──► Wrong context ──► Model answers from wrong docs
                                        or from parametric knowledge
                                        ──► Hallucinated response

Missing Information ──► No relevant context ──► Model should abstain
                                                 but generates instead
                                                 ──► Hallucinated response

Perfect Retrieval ──► Perfect context ──► Model still misquotes a number
                                          or adds an unsupported inference
                                          ──► Hallucinated response (irreducible)
```

### Types of Hallucination

**Intrinsic hallucination:** The response contradicts the provided context.

```
Context: "The refund policy is 30 days."
Response: "You can get a refund within 60 days."  ← directly contradicts context
```

**Extrinsic hallucination:** The response adds information not present in the context.

```
Context: "The refund policy is 30 days."
Response: "The refund policy is 30 days, and you can also exchange items within 90 days."
                                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                                         Not in context — model added this
```

**Fabricated details:** The response invents specific details (numbers, dates, names) that sound plausible but are not in the context.

```
Context: "Our support team is available during business hours."
Response: "Support is available Monday-Friday, 9am-5pm EST."
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
           Specific details fabricated — context didn't specify
```

**Why the type distinction matters:** Intrinsic hallucination (contradiction) is easier to detect because you can compare the response to the context. Extrinsic hallucination (addition) is harder because you need to verify that every claim in the response has a source in the context — proving a negative.

### Detection Strategies

#### 1. LLM-as-Judge (Faithfulness Check)

Use a second LLM to verify that every claim in the response is supported by the context:

```typescript
// run: npx tsx llm-judge-hallucination.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

interface FaithfulnessResult {
  faithful: boolean;
  score: number;              // 0.0 to 1.0
  unsupportedClaims: string[];
  reasoning: string;
}

async function checkFaithfulness(
  response: string,
  context: string
): Promise<FaithfulnessResult> {
  const result = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `You are a faithfulness evaluator. Given a RESPONSE and the CONTEXT
it was supposed to be based on, check if every factual claim in the response
is supported by the context.

Return JSON:
{
  "faithful": true/false,
  "score": 0.0-1.0 (1.0 = fully faithful),
  "unsupportedClaims": ["claim 1 not in context", "claim 2 not in context"],
  "reasoning": "explanation"
}

Be strict. If the response adds ANY information not in the context,
it is not fully faithful.`,
      },
      {
        role: 'user',
        content: `CONTEXT:\n${context}\n\nRESPONSE:\n${response}`,
      },
    ],
    max_tokens: 500,
  });

  return JSON.parse(result.choices[0].message.content!) as FaithfulnessResult;
}

// Example
const context = `Enterprise customers may request a refund within 30 days of purchase.
Refund processing takes 5-10 business days.`;

const response = `Enterprise customers can get a refund within 30 days [1].
Processing takes 5-10 business days [2]. After 30 days, customers can request
a store credit instead.`;

const check = await checkFaithfulness(response, context);
console.log(JSON.stringify(check, null, 2));
// {
//   "faithful": false,
//   "score": 0.7,
//   "unsupportedClaims": ["After 30 days, customers can request a store credit instead."],
//   "reasoning": "The context only mentions refunds within 30 days. No mention of store credits."
// }
```

**Cost:** One extra LLM call per response. At scale, this doubles the LLM cost. Mitigations: use a cheaper model (GPT-4o-mini) for faithfulness checks, run asynchronously (log and review), or sample-check (verify 10% of responses).

#### 2. Natural Language Inference (NLI)

Use an NLI model to classify each sentence in the response as:
- **Entailment:** Supported by the context
- **Contradiction:** Contradicts the context
- **Neutral:** Neither supported nor contradicted (possible extrinsic hallucination)

```typescript
// run: npx tsx nli-hallucination.ts
// Concept: split response into sentences, check each against context

async function nliCheck(
  responseSentences: string[],
  context: string
): Promise<Array<{ sentence: string; label: string; score: number }>> {
  // In production, use a dedicated NLI model:
  // - cross-encoder/nli-deberta-v3-base (HuggingFace)
  // - Jina NLI models
  // - Or use an LLM as a proxy

  const results = [];

  for (const sentence of responseSentences) {
    // Simplified: using LLM as NLI proxy
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        temperature: 0.0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `Given a premise (context) and hypothesis (response sentence), classify:
- "entailment": the premise supports the hypothesis
- "contradiction": the premise contradicts the hypothesis
- "neutral": the premise neither supports nor contradicts
Return JSON: { "label": "...", "confidence": 0.0-1.0 }`,
          },
          {
            role: 'user',
            content: `Premise: ${context}\n\nHypothesis: ${sentence}`,
          },
        ],
      }),
    });

    const data = await response.json();
    const parsed = JSON.parse(data.choices[0].message.content);
    results.push({
      sentence,
      label: parsed.label,
      score: parsed.confidence,
    });
  }

  return results;
}
```

#### 3. Citation Verification

Check that every citation in the response actually matches the cited source:

```typescript
// run: npx tsx citation-verification.ts

interface VerificationResult {
  citation: string;
  claim: string;
  sourceText: string;
  supported: boolean;
  explanation: string;
}

async function verifyCitations(
  response: string,
  sources: Map<string, string>  // label → text
): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  // Extract cited claims: "claim text [1]" or "[1] claim text"
  const citationPattern = /([^.!?\n]+)\[(\d+)\]/g;
  let match: RegExpExecArray | null;

  while ((match = citationPattern.exec(response)) !== null) {
    const claim = match[1].trim();
    const label = `[${match[2]}]`;
    const sourceText = sources.get(label) ?? '';

    if (!sourceText) {
      results.push({
        citation: label,
        claim,
        sourceText: '',
        supported: false,
        explanation: `Citation ${label} does not exist in provided sources`,
      });
      continue;
    }

    // Use LLM to verify the claim is supported by the source
    // (In production, use the NLI approach or LLM-as-judge)
    const supported = await checkClaimAgainstSource(claim, sourceText);
    results.push({
      citation: label,
      claim,
      sourceText: sourceText.slice(0, 200),
      supported: supported.isSupported,
      explanation: supported.reasoning,
    });
  }

  return results;
}

async function checkClaimAgainstSource(
  claim: string,
  source: string
): Promise<{ isSupported: boolean; reasoning: string }> {
  // Simplified — use LLM or NLI model
  return { isSupported: true, reasoning: 'Verified' };
}
```

#### 4. Self-Consistency Check

Generate the answer multiple times (with temperature > 0) and check for agreement. If the model gives different answers to the same question, confidence is low.

```typescript
// run: npx tsx self-consistency.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

async function selfConsistencyCheck(
  query: string,
  context: string,
  numSamples: number = 3
): Promise<{ consistent: boolean; answers: string[]; agreement: number }> {
  const answers: string[] = [];

  for (let i = 0; i < numSamples; i++) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      temperature: 0.5, // needs some randomness for diversity
      messages: [
        {
          role: 'system',
          content: 'Answer using only the provided context. Be concise.',
        },
        {
          role: 'user',
          content: `CONTEXT:\n${context}\n\nQUESTION: ${query}`,
        },
      ],
      max_tokens: 300,
    });
    answers.push(response.choices[0].message.content!);
  }

  // Check agreement using LLM
  const agreementCheck = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Given multiple answers to the same question, determine if they agree
on the key facts. Return JSON: { "consistent": true/false, "agreement": 0.0-1.0,
"conflicting_points": ["..."] }`,
      },
      {
        role: 'user',
        content: answers.map((a, i) => `Answer ${i + 1}: ${a}`).join('\n\n'),
      },
    ],
    max_tokens: 200,
  });

  const result = JSON.parse(agreementCheck.choices[0].message.content!);
  return {
    consistent: result.consistent,
    answers,
    agreement: result.agreement,
  };
}
```

**Cost:** Multiplies LLM calls by `numSamples`. Use selectively for high-stakes queries.

### Detection Strategy Comparison

| Strategy | Catches Intrinsic | Catches Extrinsic | Latency | Cost | Best For |
|----------|------------------|-------------------|---------|------|----------|
| LLM-as-Judge | Yes | Yes | 500-1500ms | High | Comprehensive check |
| NLI | Yes | Partial | 100-300ms | Low | Fast per-sentence check |
| Citation verification | Partial | Partial | Varies | Medium | Verifiable answers |
| Self-consistency | Yes | Yes | 3x generation cost | Very high | High-stakes answers |

### Mitigation Strategies

#### Layer 1: Better Retrieval

Most hallucination starts with retrieval failure. Fixing retrieval is the highest-ROI mitigation.

| Issue | Fix |
|-------|-----|
| Wrong documents retrieved | Hybrid search (dense + BM25) |
| Documents not found | Better chunking, query expansion |
| Too many irrelevant docs | Reranking |
| Missing from corpus | Identify coverage gaps, ingest missing docs |

#### Layer 2: Better Context Construction

| Issue | Fix |
|-------|-----|
| Key info in the middle of context | Lost-in-the-middle ordering |
| Duplicate chunks waste budget | Deduplication |
| Too much noise | Fewer, higher-quality chunks |
| Answer split across chunks | Hierarchical/parent-document retrieval |

#### Layer 3: Better Prompting

| Issue | Fix |
|-------|-----|
| Model uses training knowledge | Explicit grounding instructions + few-shot abstention |
| Model extrapolates | "Only state facts explicitly in the context" |
| No citations | Require structured output with citations |
| Ignores grounding prompt | Two-pass answerability check |

#### Layer 4: Generation Controls

| Issue | Fix |
|-------|-----|
| Random fabrication | Temperature 0.0-0.2 |
| Inconsistent answers | Self-consistency check |
| Confident wrong answers | Confidence scoring |
| High-stakes errors | Human review for flagged topics |

#### Layer 5: Post-Generation Validation

```typescript
// run: npx tsx hallucination-pipeline.ts
import { OpenAI } from 'openai';

const openai = new OpenAI();

interface ValidationResult {
  response: string;
  faithfulnessScore: number;
  hasUnsupportedClaims: boolean;
  unsupportedClaims: string[];
  action: 'serve' | 'flag' | 'abstain';
}

async function validateAndServe(
  response: string,
  context: string,
  highStakes: boolean = false
): Promise<ValidationResult> {
  // Run faithfulness check
  const check = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.0,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Check if the response is faithful to the context.
Return JSON: {
  "score": 0.0-1.0,
  "unsupportedClaims": ["claim not in context", ...]
}`,
      },
      {
        role: 'user',
        content: `CONTEXT:\n${context}\n\nRESPONSE:\n${response}`,
      },
    ],
    max_tokens: 300,
  });

  const result = JSON.parse(check.choices[0].message.content!);
  const hasIssues = result.unsupportedClaims.length > 0;

  // Decision logic
  let action: 'serve' | 'flag' | 'abstain';

  if (result.score >= 0.9 && !hasIssues) {
    action = 'serve';
  } else if (highStakes || result.score < 0.5) {
    action = 'abstain'; // too risky, don't serve
  } else {
    action = 'flag'; // serve with a disclaimer
  }

  return {
    response: action === 'abstain'
      ? "I'm not confident in my answer. Please consult the original documents or contact support."
      : response,
    faithfulnessScore: result.score,
    hasUnsupportedClaims: hasIssues,
    unsupportedClaims: result.unsupportedClaims,
    action,
  };
}
```

### Hallucination Rate as a Production Metric

Track hallucination rate alongside latency and throughput:

```typescript
// run: npx tsx hallucination-metrics.ts

interface HallucinationMetrics {
  totalQueries: number;
  faithfulResponses: number;
  partialHallucinations: number;
  fullHallucinations: number;
  abstentions: number;
  hallucinationRate: number;    // (partial + full) / total
  abstentionRate: number;       // abstentions / total
}

function computeMetrics(
  results: Array<{
    faithfulnessScore: number;
    action: 'serve' | 'flag' | 'abstain';
  }>
): HallucinationMetrics {
  const total = results.length;
  const faithful = results.filter(r => r.faithfulnessScore >= 0.9).length;
  const partial = results.filter(
    r => r.faithfulnessScore >= 0.5 && r.faithfulnessScore < 0.9
  ).length;
  const full = results.filter(r => r.faithfulnessScore < 0.5).length;
  const abstentions = results.filter(r => r.action === 'abstain').length;

  return {
    totalQueries: total,
    faithfulResponses: faithful,
    partialHallucinations: partial,
    fullHallucinations: full,
    abstentions,
    hallucinationRate: (partial + full) / total,
    abstentionRate: abstentions / total,
  };
}

// Target metrics:
// - Hallucination rate: < 5% for general RAG, < 1% for high-stakes
// - Abstention rate: 5-15% (too low = not abstaining enough, too high = too conservative)
// - Faithfulness score P50: > 0.9
```

**What to alert on:**
- Hallucination rate spike: > 2x baseline over 1 hour
- Abstention rate spike: > 2x baseline (may indicate retrieval degradation)
- Faithfulness score P50 drop: below 0.85

### The Irreducible Hallucination Problem

Even with perfect retrieval, perfect context construction, and perfect prompting, some hallucination is irreducible:

1. **Numerical precision:** The model may round, approximate, or transpose digits ("$12,500" → "$12,050")
2. **Temporal confusion:** "Q3 2024" → "Q4 2024" or "2023"
3. **Attribution errors:** Correct fact cited to the wrong source
4. **Logical inference:** The model makes a "reasonable" inference that is not actually stated

**Why it is irreducible:** LLMs are probabilistic text generators. They do not perform symbolic reasoning or exact retrieval from their context window. They predict the most likely next token, which is usually correct but sometimes wrong in specific details.

**Implication:** No RAG system can guarantee zero hallucination. Defense must be **layered:**

```
Layer 1: Better retrieval (catch 60% of hallucinations)
    ↓
Layer 2: Better context construction (catch 15%)
    ↓
Layer 3: Better prompting (catch 10%)
    ↓
Layer 4: Post-generation validation (catch 10%)
    ↓
Layer 5: Human review for high-stakes (catch remaining 5%)
    ↓
Residual risk: ~1-2% irreducible hallucination rate
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Retrieval failure masquerades as hallucination.** The team blames the LLM for hallucinating, but the root cause is that the right document was never retrieved. They invest in prompt engineering and output validation while the retrieval pipeline returns irrelevant chunks. Hallucination rate stays flat. Fix: always measure retrieval quality (recall@K, precision@K) alongside hallucination rate. If retrieval recall is below 90%, fix retrieval first.

**Conflicting sources cause the model to pick the wrong one.** Two versions of a policy document exist in the corpus: v1 (30-day refund) and v2 (60-day refund). Both are retrieved. The model cites v1. The user complains because v2 is current. Fix: add version metadata, filter for latest versions at retrieval time, or instruct the model to prefer more recent sources when they conflict.

**Hallucination detection is too slow for real-time serving.** The faithfulness check adds 500-1500ms per response. The product team rejects the latency increase. The team disables detection and ships without it. Fix: run detection asynchronously — serve the response immediately, validate in the background, and log results. Use the logs to compute hallucination rate as a monitoring metric. For high-stakes domains, accept the latency or use a fast NLI model instead of an LLM judge.

**"Zero hallucination" is promised to stakeholders.** The PM tells the customer that the RAG system will never hallucinate. It does. The customer loses trust entirely. Fix: never promise zero hallucination. Promise layered defenses, monitoring, and a target hallucination rate (e.g., < 2%). Provide confidence scores with every response so the user can calibrate their trust.
:::

## 🎯 Checkpoint

::: details Question 1 — Diagnosing hallucination root cause
**Q:** Your RAG system has a 12% hallucination rate. How do you diagnose whether the problem is retrieval, context construction, prompting, or the model itself?

**A:** Systematic diagnosis: (1) Check retrieval quality first. Sample 100 queries, manually label the retrieved chunks as relevant/irrelevant. If recall@10 is below 80%, retrieval is the primary problem — the model is hallucinating because it does not have the right context. Fix retrieval before anything else. (2) If retrieval is good (recall > 90%), check context construction. Are the right chunks making it into the final prompt? Are they being truncated, deduplicated incorrectly, or ordered poorly? Read the actual prompts sent to the LLM for failing queries. (3) If retrieval and context are both good, check prompting. Is the system prompt enforcing grounding? Are there few-shot examples of abstention? Is temperature too high? (4) If all three are good and the model still hallucinates, you have hit the irreducible hallucination rate for that model. Mitigate with post-generation validation and confidence scoring. The key insight: in most systems, 60-70% of hallucination traces back to retrieval failure. Start there.
:::

::: details Question 2 — Intrinsic vs extrinsic detection
**Q:** Why is extrinsic hallucination (adding information) harder to detect than intrinsic hallucination (contradicting context)?

**A:** Intrinsic hallucination is a contradiction — the response says X but the context says not-X. You can detect this with NLI (entailment vs contradiction) or direct comparison. Extrinsic hallucination is an addition — the response says Y and the context says nothing about Y. Detecting this requires proving a negative: verifying that Y does not appear anywhere in the context. This is harder because (1) Y might be an inference from the context rather than a direct addition, making the boundary between "reasonable inference" and "hallucination" blurry, (2) Y might use different wording than the context, requiring semantic matching to determine if it is supported, (3) the context may implicitly support Y through combinations of facts, but the model made the connection explicit. The most reliable approach: require citations for every claim and flag any claim without a citation as potentially extrinsic.
:::

::: details Question 3 — Layered defense design
**Q:** Design a hallucination defense strategy for a medical RAG system where incorrect answers could harm patients.

**A:** For medical RAG, defense must be aggressive: (1) Retrieval: hybrid search (dense + BM25) with medical-domain embeddings. Rerank with a medical-domain cross-encoder. High candidate count (N=100, K=5). (2) Context: strict deduplication, source authority weighting (systematic reviews > case reports), recency bias for clinical guidelines. (3) Prompting: temperature 0.0, explicit grounding instructions, mandatory citations, two-pass answerability check (abstain if confidence < 0.8). (4) Post-generation: LLM-as-judge faithfulness check on every response (not sampled). NLI per-sentence verification. Any unsupported claim triggers abstention. (5) Confidence scoring: every response includes a confidence level. Low-confidence responses (< 0.7) are automatically flagged for human review. (6) Human-in-the-loop: all responses about medication dosages, contraindications, or treatment plans are queued for clinician review before serving. (7) Monitoring: hallucination rate tracked in real-time with alerting. Target: < 0.5%. (8) Disclaimer: every response includes "This information is from clinical guidelines and should be verified by a healthcare professional."
:::

## Key Mental Models

- **Most RAG hallucination is retrieval failure in disguise.** Fix retrieval first — it accounts for 60-70% of hallucination root causes.
- **Intrinsic hallucination (contradiction) is detectable; extrinsic (addition) is harder.** Require citations for every claim to make extrinsic hallucination visible.
- **Hallucination defense must be layered.** No single technique eliminates hallucination. Better retrieval + better context + better prompting + post-generation validation + human review = defense in depth.
- **Some hallucination is irreducible.** LLMs are probabilistic. Never promise zero hallucination — promise monitoring, layered defenses, and a target rate.
- **Hallucination rate is a production metric.** Track it alongside latency and throughput. Alert on spikes. Target < 5% for general RAG, < 1% for high-stakes.

## Related

- [Grounded Generation](01-grounded-generation.md) — the techniques that prevent hallucination at generation time
- [Context Construction](../module-11/02-context-construction.md) — poor context construction causes hallucination
- [Reranking](../module-11/01-reranking.md) — reranking improves context quality, reducing hallucination
- [Retrieval Strategies](../module-09/01-retrieval-strategies.md) — retrieval failure is the #1 hallucination cause
- [Hybrid Search](../module-09/02-hybrid-search.md) — hybrid search reduces the retrieval failures that cause hallucination
