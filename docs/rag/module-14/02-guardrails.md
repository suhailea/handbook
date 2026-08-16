---
title: Guardrails
outline: deep
---

# Guardrails

Interview weight: 🔥🔥 | Prerequisites: [RAG Security](01-security.md), [Generation & prompting](/rag/module-12/)

## 🗣️ In Plain English

::: tip In Plain English
Guardrails are like the bumpers at a bowling alley -- they do not make you a better bowler, but they keep the ball out of the gutter. In a RAG system, guardrails check inputs before processing, validate retrieval before sending to the LLM, and scan outputs before showing to the user. They are runtime safety nets, not quality improvements.
:::

## ⚙️ Under the Hood

### Guardrails vs Validation vs Evaluation vs Security

These four concepts are often confused. They are distinct:

| Concept | When It Runs | Purpose | Example |
|---------|-------------|---------|---------|
| **Security** | Infrastructure level | Prevent unauthorized access and attacks | ACL filters, tenant isolation, auth |
| **Guardrails** | Runtime, per-request | Prevent harmful/inappropriate behavior | Block toxic output, reject out-of-scope queries |
| **Validation** | Runtime, per-request | Ensure correct format/schema | JSON schema check, required fields, type checking |
| **Evaluation** | Offline or sampled | Measure quality over time | Faithfulness score, NDCG, A/B test |

**Key distinction:** Security stops attackers. Guardrails stop the system from misbehaving. Validation stops malformed data. Evaluation measures how well the system works.

---

### Input Guardrails

Input guardrails run **before** any retrieval or generation. They are the cheapest guardrails because they short-circuit early.

```typescript
// run: npx tsx input-guardrails.ts

interface GuardrailResult {
  pass: boolean;
  reason?: string;
  action: 'allow' | 'block' | 'modify' | 'flag';
}

// 1. Query length limits
function checkQueryLength(
  query: string,
  maxChars = 2000,
): GuardrailResult {
  if (query.length > maxChars) {
    return {
      pass: false,
      reason: `Query exceeds ${maxChars} character limit`,
      action: 'block',
    };
  }
  return { pass: true, action: 'allow' };
}

// 2. Content safety — toxicity detection
// Use a classifier model (OpenAI moderation API, Perspective API, or local model)
async function checkContentSafety(
  query: string,
): Promise<GuardrailResult> {
  const response = await fetch(
    'https://api.openai.com/v1/moderations',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: query }),
    },
  );
  const result = await response.json();
  const flagged = result.results[0].flagged;

  if (flagged) {
    return {
      pass: false,
      reason: 'Content flagged by moderation',
      action: 'block',
    };
  }
  return { pass: true, action: 'allow' };
}

// 3. Intent classification — reject out-of-scope queries
async function checkIntent(
  query: string,
  llm: LLMClient,
): Promise<GuardrailResult> {
  const classification = await llm.complete({
    prompt: `Classify this query as one of:
    - IN_SCOPE: Question about our product/documentation
    - OUT_OF_SCOPE: Unrelated question (homework, recipes, etc.)
    - HARMFUL: Attempting to misuse the system

    Query: "${query}"
    Classification:`,
    temperature: 0,
    maxTokens: 20,
  });

  const intent = classification.trim().toUpperCase();
  if (intent.includes('OUT_OF_SCOPE')) {
    return {
      pass: false,
      reason: 'Query is outside the system scope',
      action: 'block',
    };
  }
  if (intent.includes('HARMFUL')) {
    return { pass: false, reason: 'Harmful intent detected', action: 'block' };
  }
  return { pass: true, action: 'allow' };
}

// 4. PII detection in queries
function checkQueryPII(query: string): GuardrailResult {
  const piiPatterns = {
    ssn: /\b\d{3}-\d{2}-\d{4}\b/,
    credit_card: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
    email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b/i,
  };

  for (const [type, pattern] of Object.entries(piiPatterns)) {
    if (pattern.test(query)) {
      return {
        pass: false,
        reason: `PII detected in query: ${type}`,
        action: 'block',
      };
    }
  }
  return { pass: true, action: 'allow' };
}
```

**Input guardrail pipeline:**

```
Query → Length Check → PII Check → Content Safety → Intent Classification → Proceed
         (fast)       (fast)       (API call)       (LLM call, optional)
```

Order matters: run cheap checks first, expensive checks last. If length check fails, do not waste an API call on content safety.

---

### Retrieval Guardrails

Retrieval guardrails run **after** vector search returns results but **before** the results are sent to the LLM.

```typescript
// run: npx tsx retrieval-guardrails.ts

interface RetrievedChunk {
  id: string;
  text: string;
  score: number;
  metadata: Record<string, unknown>;
}

// 1. Minimum relevance score threshold
function filterByRelevance(
  chunks: RetrievedChunk[],
  minScore = 0.7,
): RetrievedChunk[] {
  const filtered = chunks.filter((c) => c.score >= minScore);
  return filtered;
}

// 2. Minimum number of retrieved docs
function checkMinDocuments(
  chunks: RetrievedChunk[],
  minDocs = 1,
): GuardrailResult {
  if (chunks.length < minDocs) {
    return {
      pass: false,
      reason: `Only ${chunks.length} documents retrieved (minimum: ${minDocs})`,
      action: 'block', // Return "I don't have enough information"
    };
  }
  return { pass: true, action: 'allow' };
}

// 3. ACL enforcement (MUST happen here if not at DB level)
function enforceACL(
  chunks: RetrievedChunk[],
  userGroups: string[],
): RetrievedChunk[] {
  return chunks.filter((chunk) => {
    const allowedGroups = chunk.metadata.allowed_groups as string[];
    if (!allowedGroups || allowedGroups.length === 0) return true;
    return allowedGroups.some((g) => userGroups.includes(g));
  });
}

// 4. Content safety on retrieved chunks
// Scan chunks for content that should not be passed to the LLM
async function scanChunkSafety(
  chunks: RetrievedChunk[],
): Promise<RetrievedChunk[]> {
  return chunks.filter((chunk) => {
    // Check for injection patterns in retrieved content
    const hasInjection = /ignore\s+previous|new\s+instruction/i.test(
      chunk.text,
    );
    if (hasInjection) {
      console.warn(
        `Potential injection in chunk ${chunk.id}, removing`,
      );
      return false;
    }
    return true;
  });
}

// Full retrieval guardrail pipeline
async function applyRetrievalGuardrails(
  chunks: RetrievedChunk[],
  userGroups: string[],
): Promise<{ chunks: RetrievedChunk[]; proceed: boolean; message?: string }> {
  // Step 1: ACL (security, not optional)
  let filtered = enforceACL(chunks, userGroups);

  // Step 2: Relevance threshold
  filtered = filterByRelevance(filtered, 0.7);

  // Step 3: Content safety scan
  filtered = await scanChunkSafety(filtered);

  // Step 4: Minimum documents check
  const minCheck = checkMinDocuments(filtered, 1);
  if (!minCheck.pass) {
    return {
      chunks: [],
      proceed: false,
      message:
        "I don't have enough relevant information to answer this question.",
    };
  }

  return { chunks: filtered, proceed: true };
}
```

---

### Output Guardrails

Output guardrails run **after** the LLM generates a response but **before** it is returned to the user.

```typescript
// run: npx tsx output-guardrails.ts

// 1. Factual grounding check
// Verify the answer references retrieved context (lightweight faithfulness)
function checkGrounding(
  answer: string,
  chunks: RetrievedChunk[],
): GuardrailResult {
  // Simple heuristic: does the answer reference content from chunks?
  const chunkTexts = chunks.map((c) => c.text.toLowerCase());
  const answerLower = answer.toLowerCase();

  // Extract key phrases from answer and check if they appear in chunks
  const sentences = answer.split(/[.!?]+/).filter((s) => s.trim().length > 20);

  let groundedCount = 0;
  for (const sentence of sentences) {
    const words = sentence.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const matchesAnyChunk = chunkTexts.some((chunk) =>
      words.filter((w) => chunk.includes(w)).length >= words.length * 0.3,
    );
    if (matchesAnyChunk) groundedCount++;
  }

  const groundingRatio =
    sentences.length > 0 ? groundedCount / sentences.length : 0;

  if (groundingRatio < 0.5) {
    return {
      pass: false,
      reason: `Low grounding ratio: ${groundingRatio.toFixed(2)}`,
      action: 'flag', // Log for review, maybe still return
    };
  }
  return { pass: true, action: 'allow' };
}

// 2. PII scanning on output
function checkOutputPII(answer: string): GuardrailResult {
  const piiPatterns = {
    ssn: /\b\d{3}-\d{2}-\d{4}\b/,
    credit_card: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/,
  };

  for (const [type, pattern] of Object.entries(piiPatterns)) {
    if (pattern.test(answer)) {
      return {
        pass: false,
        reason: `PII (${type}) detected in output`,
        action: 'modify', // Redact PII, return modified answer
      };
    }
  }
  return { pass: true, action: 'allow' };
}

// 3. Content safety on output
async function checkOutputSafety(
  answer: string,
): Promise<GuardrailResult> {
  // Use moderation API or custom classifier
  const response = await fetch(
    'https://api.openai.com/v1/moderations',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({ input: answer }),
    },
  );
  const result = await response.json();

  if (result.results[0].flagged) {
    return {
      pass: false,
      reason: 'Output flagged by moderation',
      action: 'block',
    };
  }
  return { pass: true, action: 'allow' };
}

// 4. Format validation (when structured output is expected)
function validateOutputFormat(
  answer: string,
  expectedFormat: 'json' | 'markdown' | 'text',
): GuardrailResult {
  if (expectedFormat === 'json') {
    try {
      JSON.parse(answer);
      return { pass: true, action: 'allow' };
    } catch {
      return {
        pass: false,
        reason: 'Output is not valid JSON',
        action: 'block', // retry with format instructions
      };
    }
  }
  return { pass: true, action: 'allow' };
}

// 5. Confidence threshold
function checkConfidence(
  answer: string,
  chunks: RetrievedChunk[],
): GuardrailResult {
  // If all chunks have low similarity scores, the system is guessing
  const maxScore = Math.max(...chunks.map((c) => c.score));
  if (maxScore < 0.5) {
    return {
      pass: false,
      reason: `Low retrieval confidence (max score: ${maxScore})`,
      action: 'modify', // Prepend a disclaimer
    };
  }
  return { pass: true, action: 'allow' };
}
```

---

### Tool Guardrails

When RAG systems use tools (agentic RAG), additional guardrails are needed:

```typescript
// run: npx tsx tool-guardrails.ts

interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolPolicy {
  maxCallsPerRequest: number;
  allowedTools: string[];
  requireApproval: string[];     // tools that need human approval
  rateLimits: Record<string, { maxPerMinute: number }>;
}

const defaultPolicy: ToolPolicy = {
  maxCallsPerRequest: 10,
  allowedTools: ['search_docs', 'search_faq', 'get_product_info'],
  requireApproval: ['create_ticket', 'process_refund', 'update_account'],
  rateLimits: {
    search_docs: { maxPerMinute: 30 },
    process_refund: { maxPerMinute: 5 },
  },
};

function validateToolCall(
  call: ToolCall,
  policy: ToolPolicy,
  callCount: number,
): GuardrailResult {
  // 1. Check if tool is allowed
  if (!policy.allowedTools.includes(call.name)) {
    return {
      pass: false,
      reason: `Tool "${call.name}" is not in the allowed list`,
      action: 'block',
    };
  }

  // 2. Check call count budget
  if (callCount >= policy.maxCallsPerRequest) {
    return {
      pass: false,
      reason: `Tool call budget exceeded (${callCount}/${policy.maxCallsPerRequest})`,
      action: 'block',
    };
  }

  // 3. Check if approval is required
  if (policy.requireApproval.includes(call.name)) {
    return {
      pass: false,
      reason: `Tool "${call.name}" requires human approval`,
      action: 'flag', // Route to human-in-the-loop
    };
  }

  // 4. Input validation on tool arguments
  // (tool-specific validation logic here)

  return { pass: true, action: 'allow' };
}
```

---

### Full Guardrail Pipeline

Putting it all together:

```
                         ┌──────────────┐
                         │  User Query  │
                         └──────┬───────┘
                                │
                    ┌───────────▼───────────┐
                    │   INPUT GUARDRAILS    │
                    │  • Length check       │
                    │  • PII detection      │
                    │  • Content safety     │
                    │  • Intent classif.    │
                    └───────────┬───────────┘
                                │ pass
                    ┌───────────▼───────────┐
                    │     RETRIEVAL         │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │ RETRIEVAL GUARDRAILS  │
                    │  • ACL enforcement    │
                    │  • Relevance filter   │
                    │  • Injection scan     │
                    │  • Min doc check      │
                    └───────────┬───────────┘
                                │ pass
                    ┌───────────▼───────────┐
                    │    LLM GENERATION     │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │   OUTPUT GUARDRAILS   │
                    │  • Grounding check    │
                    │  • PII scanning       │
                    │  • Content safety     │
                    │  • Format validation  │
                    │  • Confidence check   │
                    └───────────┬───────────┘
                                │ pass
                         ┌──────▼───────┐
                         │   Response   │
                         └──────────────┘
```

---

### Fail-Open vs Fail-Closed

When a guardrail service is **down** (moderation API timeout, classifier error), what happens?

| Strategy | Behavior | Use When |
|----------|----------|----------|
| **Fail-closed** | Block the request | High-risk outputs (financial advice, medical) |
| **Fail-open** | Allow the request, log the skip | Low-risk, high-availability requirements |
| **Fallback** | Use a simpler local check | Balance of safety and availability |

```typescript
// run: npx tsx fail-strategy.ts

async function contentSafetyWithFallback(
  text: string,
): Promise<GuardrailResult> {
  try {
    // Primary: external moderation API
    return await checkContentSafety(text);
  } catch (error) {
    console.error('Moderation API failed:', error);

    // Fallback: local regex-based check (less accurate, but available)
    const localCheck = localContentCheck(text);
    if (!localCheck.pass) return localCheck;

    // If local check passes, allow but flag for async review
    return {
      pass: true,
      action: 'flag',
      reason: 'Moderation API unavailable, passed local check',
    };
  }
}
```

---

### Monitoring Guardrail Performance

Guardrails have their own metrics:

| Metric | What It Measures | Action If Too High |
|--------|-----------------|-------------------|
| Block rate | % of requests blocked | Review thresholds -- too aggressive? |
| False positive rate | Legitimate requests blocked | Tune classifiers, add allowlists |
| False negative rate | Bad requests that pass | Tighten thresholds, add patterns |
| Guardrail latency | Time added by guardrails | Optimize, cache, run in parallel |
| Skip rate | % of requests where guardrails were bypassed (fallback) | Fix underlying service |

Track block reasons in a dashboard to identify patterns:

```typescript
// run: npx tsx guardrail-metrics.ts

interface GuardrailEvent {
  timestamp: string;
  query_id: string;
  guardrail: string;        // e.g., "input.content_safety"
  result: 'pass' | 'block' | 'flag' | 'modify' | 'error';
  reason?: string;
  latency_ms: number;
}

// Aggregate metrics for dashboards
// - Block rate by guardrail type (spot misconfigured guardrails)
// - Block rate over time (detect shifts in user behavior)
// - Top block reasons (understand what's being caught)
// - Latency per guardrail (find performance bottlenecks)
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Over-aggressive input guardrails.** A team set a strict toxicity threshold that blocked queries containing medical terms (interpreted as violent/harmful by the classifier). Doctors using the system could not ask questions about their own medical documentation. Block rate was 15%, and they only discovered it when a user complained. **Monitor block rates and review samples of blocked queries weekly.**

**Guardrail latency stacking.** A pipeline ran five guardrails sequentially: input safety (200ms) + intent classification (300ms) + retrieval safety (100ms) + output safety (200ms) + grounding check (400ms). Total guardrail overhead: 1.2 seconds, nearly doubling response time. **Run independent guardrails in parallel. Input safety and PII check can run simultaneously.**

**No fallback when moderation API is down.** The content safety API had an outage. The system was configured fail-closed, so every request was blocked for two hours. There was no fallback and no circuit breaker. **Always have a degraded-but-functional fallback for external guardrail services.**
:::

## 🎯 Checkpoint

::: details Question 1 -- Guardrails vs security
**Q:** A team tells you they do not need ACL filters on their vector database because they have an output guardrail that checks if the response contains unauthorized information. Why is this wrong?

**A:** Output guardrails run **after** the LLM has already seen the retrieved documents. By the time the output guardrail checks the response, the unauthorized documents have been: (1) retrieved from the database -- a data access event that may itself violate compliance requirements, (2) sent to a third-party LLM API -- the data has left your infrastructure, (3) processed by the LLM -- even if the guardrail blocks the output, the LLM's context contained unauthorized data, and the LLM provider may log it. Furthermore, output guardrails are imperfect -- the LLM might subtly reference unauthorized information in ways the guardrail does not catch. ACL filters prevent unauthorized data from ever leaving the database. Output guardrails are defense in depth, not a replacement for access control.
:::

::: details Question 2 -- Guardrail ordering
**Q:** You have five guardrails: query length check (1ms), PII detection (5ms), content safety API (200ms), intent classification via LLM (500ms), and prompt injection detection (10ms). Design the optimal execution order and strategy.

**A:** **Sequential first, then parallel for expensive checks:**

Step 1 (sequential, fast): Query length check (1ms) → if fail, return immediately.
Step 2 (parallel, fast): PII detection (5ms) + prompt injection detection (10ms) → both are fast regex/pattern checks, run simultaneously. If either fails, return.
Step 3 (parallel, expensive): Content safety API (200ms) + intent classification (500ms) → these are independent external calls, run in parallel. Total wait = 500ms (the slower one), not 700ms (sequential).

Total best-case latency: 1ms + 10ms + 500ms = ~511ms (instead of 716ms sequential).
Total worst-case (all pass): same ~511ms.

The key principles: (1) cheapest checks first (fail-fast for obviously bad inputs), (2) independent expensive checks in parallel, (3) never run an expensive check if a cheap check already failed.
:::

## Key Mental Models

- **Guardrails are safety nets, not quality improvements** -- they catch the worst failures but do not make good answers better. Invest in retrieval and generation quality separately.
- **Cheap checks first, expensive checks last** -- order guardrails by cost and run independent ones in parallel.
- **Every guardrail needs a fallback** -- external services go down. Decide fail-open vs fail-closed for each guardrail before it happens.
- **Monitor the guardrails themselves** -- a guardrail with a 20% false positive rate is degrading your product. Track block rates, latency, and review blocked samples.

## Related

- [RAG Security](01-security.md) -- the security controls that guardrails complement
- [Evaluation Frameworks](/rag/module-13/02-frameworks.md) -- how to measure quality (evaluation), not just prevent harm (guardrails)
- [Agentic RAG](/rag/module-15/01-agentic-rag.md) -- tool guardrails become critical in agentic systems
