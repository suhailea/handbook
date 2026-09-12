---
title: Reliability & Fallbacks
outline: deep
---

# Reliability & Fallbacks

TaskFlow's agent went down for 41 minutes on a Tuesday. Our code was fine, our infrastructure was fine, and our dashboards were green except for one climbing error rate. The provider was having a bad day. We had built a feature with a hard dependency on a third party and no answer for what to do when it wasn't there.

::: tip Plain English
Every other external service you've integrated is either up or down, and it answers in milliseconds. A model API is different in three ways that matter.

It's slow — seconds, not milliseconds — so timeouts that feel generous elsewhere are aggressive here. It's expensive, so a retry isn't free the way retrying a database read is; every attempt is a real charge. And it's non-deterministic, so the same request twice gives you two different answers, which means a retry is never quite a repeat.

Put those together and the usual reliability playbook doesn't transfer cleanly. Retry aggressively and you multiply your bill during exactly the incident where the provider is already struggling. Retry timidly and transient blips become user-visible failures. The engineering is in knowing which failures are worth paying to retry.
:::

## Not all failures deserve the same response

The single most useful move is to stop treating "the call failed" as one condition.

| Failure | Retry? | Why |
|---|---|---|
| `429` rate limited | Yes, with backoff | Transient by definition; the provider is telling you when to return |
| `500` / `502` / `503` | Yes, with backoff | Provider-side and usually brief |
| Timeout | Careful | The request may still be running and billing |
| `400` bad request | No | Malformed input; the same input fails identically |
| `401` / `403` | No | Credential problem; retrying floods your logs |
| Content filter refusal | No | Deterministic for that input |
| Context length exceeded | No — fix the input | Retrying sends the same oversized prompt |

Retrying a `400` is pure waste: same input, same rejection, three times the log noise. Not retrying a `429` turns a two-second delay into a user-facing error. The classification carries more value than the retry logic itself.

```typescript
// Node 22+, ESM.
type Verdict = 'retry' | 'fail' | 'fallback';

function classify(err: unknown): Verdict {
  const status = (err as { status?: number }).status;
  if (status === 429) return 'retry';
  if (status !== undefined && status >= 500) return 'fallback';
  if (status === 401 || status === 403) return 'fail';
  if (status === 400) return 'fail';
  if ((err as { name?: string }).name === 'AbortError') return 'fail';
  return 'fallback';
}
```

Note that sustained 5xx routes to `fallback` rather than `retry`. If the provider is broken, retrying the same provider is the least promising thing you can do.

## Backoff, and why jitter isn't optional

```typescript
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (classify(err) !== 'retry' || attempt === maxAttempts - 1) throw err;
      const backoff = baseMs * 2 ** attempt;
      const jitter = Math.random() * backoff;   // spread the herd
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }
  }
  throw lastErr;
}
```

The jitter is the part people drop, and it's the part that matters under load. Without it, every request that hits the same rate limit retries at the same instant, and you've built a synchronised stampede that re-triggers the limit you were backing off from. Randomising the delay spreads the retries across a window.

Three attempts is a deliberate ceiling. With exponential backoff you've already waited several seconds by the third; a fourth adds latency the user is actively experiencing, for a scenario where the first three all failed.

## Timeouts belong at every layer

A default SDK timeout is often 10 minutes. That is not a timeout, it's a formality. Set explicit ones:

**Per attempt** — how long one call may take. For an interactive agent, 30 seconds is generous. Anything longer and the user has left.

**Per run** — the total budget across retries and agent loop iterations. Without this, three attempts at 30 seconds plus backoff is a two-minute request nobody is waiting for.

Wire both to an `AbortController` so cancellation actually reaches the provider — a timeout that abandons your promise while the upstream request stays open changes your latency graph and not your bill.

## Fallback chains

When the primary provider is unavailable, the useful question is what *degraded* service looks like — because it's rarely "nothing."

```typescript
const chain = [
  { name: 'primary',   call: () => callOpenAI(messages) },
  { name: 'secondary', call: () => callAnthropic(messages) },
  { name: 'cached',    call: () => semanticCacheLookup(messages) },
];

async function callWithFallback(messages: Message[]): Promise<Result> {
  for (const link of chain) {
    try {
      const result = await withRetry(() => link.call());
      return { ...result, servedBy: link.name };
    } catch (err) {
      if (classify(err) === 'fail') throw err;   // our bug — don't mask it
      metrics.increment('fallback', { from: link.name });
    }
  }
  throw new Error('all providers exhausted');
}
```

Three things worth calling out.

**`fail` verdicts break the chain immediately.** If your request is malformed, every provider rejects it. Walking the whole chain turns one bug into four failed calls and hides the actual error behind "all providers exhausted."

**Record which link served the response.** Without `servedBy`, a silent fallback means quality changes with no visible cause — someone eventually reports the agent "got worse" and you have no signal to correlate against.

**Cross-provider fallback is not free.** Prompts tuned for one model behave differently on another; tool-calling formats differ; token costs differ. A fallback path you've never tested will fail when you need it. Exercise it deliberately — route a small percentage of traffic to the secondary so it stays warm and you find the incompatibilities on a normal day.

## Circuit breakers

Retries handle a failing request. A circuit breaker handles a failing *provider*. After N consecutive failures, stop trying for a cooling-off period and fail fast to the fallback instead.

This matters more with LLMs than elsewhere because of the timeout cost. A dead provider that hangs for 30 seconds per attempt, times three attempts, is a 90-second wait before the fallback even starts. The breaker turns that into an immediate skip. During TaskFlow's 41-minute outage, the difference between having a breaker and not was the difference between degraded-but-usable and timed-out.

::: warning Watch out
**Timeouts don't stop billing.** Abandoning a request client-side leaves the provider generating. Your timeout protects your latency, not your invoice — only a propagated abort does both.

**Retrying a non-deterministic call is not idempotent.** If the first attempt actually succeeded and only the response was lost, a retry runs the whole thing again: new tokens, new charge, and for tool-calling agents, potentially a repeated side effect. Any agent that writes — issues refunds, sends email, updates tickets — needs idempotency keys on the *tools*, not just retry logic on the model call.

**Untested fallbacks are decorative.** A secondary provider that has never served real traffic will surface its incompatibilities during your incident. Send it a small share of normal traffic so the path stays proven.
:::

::: details Interview Question — Retry budget under an outage
**Q:** Your provider starts returning 500s for 20% of requests. You have 3 retries with exponential backoff. What happens to your traffic and your costs, and what would you change?

**A:** The failing 20% each generate up to four calls, so upstream request volume rises materially at the exact moment the provider is struggling — you're adding load to a degraded service. Latency for that 20% climbs by the accumulated backoff, several seconds at minimum. Cost depends on how far each attempt got: a 500 after generation started is billed, so partial-generation failures cost real money per attempt.

The bigger risk is correlation. If the outage is broad, a large share of concurrent requests retry in lockstep and you get a synchronised burst — which is what jitter exists to prevent, and why its absence shows up as a cliff rather than a slope.

Changes: route sustained 5xx to fallback rather than retry, since retrying a broken provider has low expected value; add a circuit breaker so that after N consecutive failures you skip the primary entirely for a cooling period instead of paying the timeout each time; keep retries for 429 specifically, where the provider is signalling a transient condition; and make sure jitter is present on every backoff path.

Finally, instrument attempts-per-successful-response. That single metric makes retry amplification visible during the incident instead of on the invoice.
:::

::: details Interview Question — Designing a fallback chain
**Q:** Design a fallback strategy for a support agent that must stay available. What are the links, and what do you tell the user?

**A:** Order the chain by decreasing quality, not just availability. Primary model; secondary model from a different provider, so a provider-wide outage doesn't take both; then a semantic cache lookup for a near-identical past question; then a deterministic path — a retrieval-only answer with citations and no generation, or a templated response that routes to a human.

The key design point is that the last link is never an error page. "Here's the relevant policy document, and I've queued a human" is a real answer. An agent that can degrade to retrieval-plus-escalation has no true outage state, only reduced capability.

Two providers matter more than two models. A second model at the same vendor shares the vendor's failure domain, which is the failure you're actually defending against.

On the user side: don't announce the degradation in a way that erodes trust, but don't hide a quality change either. For the cached and deterministic links it's usually right to say a human is being looped in, because that sets accurate expectations. Internally, log `servedBy` on every response so you can correlate quality complaints with fallback events rather than guessing.
:::

## Key Mental Models

**Classify before you retry.** Most of the value is in knowing which failures are worth paying for, not in the retry mechanism.

**Jitter is what stops a retry policy becoming a stampede.** Synchronised backoff re-triggers the limit it was backing off from.

**A timeout protects latency, an abort protects cost.** They are different mechanisms and you need both.

**Fallback should degrade capability, not availability.** The last link in the chain is a real answer, not an error.

**An untested fallback path is a hypothesis.** Send it live traffic occasionally or it will fail during the incident.

## Related

- [3.1 Streaming & SSE](./01-streaming-and-sse) — retrying after half a response is already on the wire
- [3.6 Semantic Caching](./06-semantic-caching) — the cache as a fallback link
- [2.5 The Agent Harness](/ai-engineering/module-02/05-agent-harness) — where retry and timeout policy actually lives
- [6.1 Production Metrics](/ai-engineering/module-06/01-production-metrics) — error rate and retry amplification as signals
- [Failure Modes](/system-design/microservices/03-failure-modes) — circuit breakers and bulkheads generally
