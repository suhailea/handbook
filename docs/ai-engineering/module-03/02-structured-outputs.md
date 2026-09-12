---
title: Structured Outputs
outline: deep
---

# Structured Outputs

TaskFlow's agent had to classify each ticket before routing it. The prompt asked for JSON. It returned JSON roughly 97% of the time. The other 3% arrived wrapped in a markdown fence, or prefaced with "Here's the classification:", or with a trailing comment explaining its reasoning. Every one of those crashed `JSON.parse`, and the ticket vanished into an error log.

::: tip Plain English
Asking a model for JSON in the prompt is like asking a contractor to work in metric. Most of the time they will. But they're a person who thinks in feet, doing you a favour, and under pressure they'll slip back — and you won't find out until something doesn't fit.

Structured outputs are different in kind, not degree. Instead of asking the model to produce a shape and hoping, you constrain what it is *able* to produce. The model is physically prevented from emitting a character that would break the format. It's less like a request and more like a form with fixed fields — there's no space to write something else.

The distinction matters because the two approaches fail differently. A prompt that asks nicely fails rarely and unpredictably. A constrained output can't fail that way at all.
:::

## Three levels of getting structure back

They differ in where the guarantee lives.

**Level 1 — ask in the prompt.** Zero setup, no guarantee. Fine for prototypes, unsuitable for anything that feeds a parser. This is where TaskFlow started and where the 3% came from.

**Level 2 — JSON mode.** The provider guarantees syntactically valid JSON. It does *not* guarantee your schema. You'll get parseable output with the wrong field names, missing keys, or a string where you expected a number. It removes crashes but not bugs.

**Level 3 — schema-constrained generation.** You supply a JSON Schema; the provider masks the token sampler so only tokens consistent with the schema can be selected. Valid JSON *and* the right shape, structurally guaranteed.

| | Prompt request | JSON mode | Schema-constrained |
|---|---|---|---|
| Valid JSON | Usually | Guaranteed | Guaranteed |
| Correct fields | No | No | Guaranteed |
| Correct types | No | No | Guaranteed |
| Setup cost | None | Low | Moderate |
| Works everywhere | Yes | Most providers | Varies |

The mechanism behind level 3 is worth understanding, because it explains the limits. At each step the model produces a probability distribution over the vocabulary. Constrained decoding computes which tokens could still lead to a schema-valid document and zeroes out everything else before sampling. The model never "decides" to comply — non-compliant tokens are unreachable.

What this does *not* do is make the content correct. A schema guarantees `priority` is one of `low | medium | high`. It cannot guarantee the model picked the right one. Structure and accuracy are separate problems, and conflating them is how teams end up trusting well-formed nonsense.

## Defining the schema

```typescript
// Node 22+, ESM. Schema as the single source of truth.
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

const TicketClassification = z.object({
  category: z.enum(['billing', 'technical', 'account', 'other']),
  priority: z.enum(['low', 'medium', 'high']),
  requiresHuman: z.boolean(),
  summary: z.string().max(200),
});

type TicketClassification = z.infer<typeof TicketClassification>;

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: ticketText }],
  response_format: {
    type: 'json_schema',
    json_schema: { name: 'classification', schema: zodToJsonSchema(TicketClassification), strict: true },
  },
});

// Parse anyway. The provider guarantees the schema; it doesn't guarantee
// that the schema you sent is the schema this code expects.
const result: TicketClassification = TicketClassification.parse(
  JSON.parse(response.choices[0].message.content!),
);
```

Deriving the JSON Schema from the same Zod object that types your code means the TypeScript type and the model's constraint can't drift apart. Maintaining two hand-written copies of a schema is a bug with a delay fuse.

Validating after parsing looks redundant when the provider guarantees compliance. It isn't. Your deployed code and your deployed schema can be different versions, providers have bugs, and `strict: true` isn't universally supported. The parse is cheap; the failure it catches is not.

## Schema design affects accuracy, not just shape

The same information, modelled differently, produces different quality. Some patterns that consistently help:

**Enums over free strings.** `category: enum` beats `category: string` twice over — it eliminates the "Billing" vs "billing" vs "BILLING" normalisation layer, and it narrows what the model considers.

**Flat over deeply nested.** Every level of nesting is more structure to hold consistent while reasoning about content. Two flat fields usually beat one nested object.

**Reasoning field first, when you need chain-of-thought.** JSON is generated in order, so a field placed first is generated first and everything after it is conditioned on it:

```typescript
const Classification = z.object({
  reasoning: z.string(),     // generated first — the model "thinks" here
  category: z.enum([...]),   // then commits, conditioned on its own reasoning
  priority: z.enum([...]),
});
```

Put `reasoning` last and it becomes a post-hoc justification of a decision already made. The field order is doing real work.

**Optional fields need a reason to exist.** Every optional field is a branch your code must handle. If it's always populated in practice, make it required and let validation catch the exception.

## When the schema can't save you

Not every provider supports constrained decoding, and self-hosted models often don't. For those paths you need a repair loop — but a *bounded* one:

```typescript
async function parseWithRepair<T>(
  raw: string,
  schema: z.ZodSchema<T>,
  retry: (err: string) => Promise<string>,
  maxAttempts = 2,
): Promise<T> {
  let current = raw;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const stripped = current.replace(/^```(?:json)?\n?|\n?```$/g, '').trim();
    const parsed = schema.safeParse(JSON.parse(stripped));
    if (parsed.success) return parsed.data;
    current = await retry(parsed.error.message);   // feed the error back
  }
  throw new Error('structured output failed after repair attempts');
}
```

Two attempts, not unlimited. A model that fails a schema twice with the error text in front of it is not going to succeed on the fifth try — it's going to keep costing you a full inference call each time. Cap it and fail loudly.

Note what gets fed back: the *validation error*, not just "try again." Telling the model `priority: expected 'low'|'medium'|'high', received 'urgent'` gives it something actionable. Telling it "that was wrong" gives it nothing.

::: warning Watch out
**Schema compliance reads as correctness.** This is the trap. Well-formed output with the right enum values looks trustworthy in a way prose doesn't, and reviewers stop checking. TaskFlow shipped a classifier that put 12% of billing tickets under `technical` — every response passed validation, every dashboard was green, and the error surfaced as a routing complaint weeks later. Structure is not accuracy; you still need [evaluation](/ai-engineering/module-05/).

**Constrained decoding can degrade quality when the schema fights the model.** Forcing a rigid structure onto a task that needs open reasoning, or over-constraining a string field with a tight regex, can push the sampler into low-probability regions and produce worse content than an unconstrained call. If quality drops after adding a schema, loosen the schema before blaming the model.

**Streaming and structured output are awkward together.** A partial JSON document isn't parseable, so you either buffer the whole response — losing the streaming benefit — or use a streaming-tolerant parser that yields fields as they complete. For a classification step nobody watches, just buffer it.
:::

::: details Interview Question — JSON mode vs schema-constrained
**Q:** A colleague says "we enabled JSON mode, so parsing errors are solved." What's incomplete about that, and when would you still add a schema?

**A:** JSON mode guarantees *syntactic* validity — the output will parse. It says nothing about structure. You can get `{"result": "billing"}` when your code expects `{"category": "billing"}`, or `{"priority": 2}` when you expect a string enum. `JSON.parse` succeeds and the bug moves downstream into whatever consumes the object, which is a worse place to find it than a parse error.

So JSON mode solves crashes and creates silent shape mismatches. That's an improvement, not a solution.

Add a schema whenever the output feeds code rather than a human: routing decisions, tool arguments, database writes, anything typed. The cost is low and the guarantee is categorical rather than probabilistic.

Keep JSON mode alone when the consumer is tolerant — a UI that renders whatever keys it finds, or an internal debugging path. And regardless of which you use, validate after parsing, because your code's expectations and the schema you deployed can drift out of sync independently of the provider behaving correctly.
:::

::: details Interview Question — Debugging a quality regression after adding a schema
**Q:** You add a strict schema to an extraction task. Format errors go to zero, but extraction accuracy drops noticeably. Explain what could cause that and how you'd investigate.

**A:** Constrained decoding masks tokens that can't lead to a schema-valid document. If the schema is tight, the tokens the model most wanted are sometimes unavailable, and it's forced into lower-probability paths. Format improves; content degrades.

Common specific causes: a regex-constrained string that's stricter than the real data; an enum missing a category that genuinely occurs, forcing misclassification into the nearest allowed value; required fields the source text doesn't contain, so the model fabricates rather than omitting; and removing a free-text reasoning field the model was previously using to work through the problem.

To investigate, compare the same inputs with and without the schema on a fixed sample and read the disagreements — not the aggregate score. The failure pattern is usually obvious once you see which cases flipped. Check whether the constrained version concentrates errors in one enum value, which points at a missing category.

Fixes, in order of preference: add the missing enum members, including an explicit `other`; make genuinely-absent fields nullable rather than required; loosen over-tight string patterns; and reintroduce a reasoning field as the first property so the model can think before committing.
:::

## Key Mental Models

**Prompting for JSON is a request; schema constraint is a guarantee.** They fail differently, and only one of them fails predictably.

**Valid is not correct.** A schema constrains shape, never content — which is exactly why well-formed output gets trusted more than it has earned.

**Field order is generation order.** Anything you want the model to condition on must appear earlier in the schema.

**Repair loops must be bounded.** A model that fails validation twice with the error in hand will keep failing, one paid call at a time.

**Derive the schema and the type from one definition.** Two hand-maintained copies drift, and the drift surfaces in production.

## Related

- [3.3 Reliability & Fallbacks](./03-reliability-and-fallbacks) — what to do when the repair loop exhausts
- [2.2 Tools & Tool Calling](/ai-engineering/module-02/02-tools-and-tool-calling) — tool arguments are structured outputs with a different name
- [5.2 Evaluation Pipeline](/ai-engineering/module-05/02-evaluation-pipeline) — catching the accuracy problems schemas can't
- [7.1 AI Security](/ai-engineering/module-07/01-ai-security) — validation as a security boundary, not just a correctness one
