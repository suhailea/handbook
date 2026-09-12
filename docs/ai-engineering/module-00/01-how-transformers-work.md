---
title: How Transformers Work
outline: deep
---

# How Transformers Work

Everyone says it's just predicting the next word. That's true and it's useless. A parrot predicts the next word too. What makes a transformer different is *how* it decides what comes next — and that mechanism explains most of the strange behaviour you'll spend the rest of this track working around.

::: tip Plain English
Imagine two ways of reading a long sentence.

The first: you're allowed to see one word at a time, and before moving on you must summarise everything so far onto a single sticky note. By the end of a long sentence that note is crowded. Early words have been squeezed, overwritten, and effectively forgotten. If the sentence opens by mentioning a river and closes by mentioning a bank, you've probably lost the river.

The second: the entire sentence is laid out in front of you, and for each word you can glance at every other word and decide which ones actually matter for understanding it. Working out what "bank" means? Look directly at "river." No summary, no forgetting, no relay.

That second way is attention, and it's the whole idea. Every word gets to consult every other word, all at once, and weigh what's relevant. The sticky note is gone.

The cost is that everyone consulting everyone gets expensive fast — and that cost is why long inputs are priced the way they are.
:::

## What came before, and why it broke

The previous dominant architecture was the RNN — a recurrent network that processed text sequentially, carrying a hidden state forward from word to word. That hidden state is the sticky note: a fixed-size summary of everything seen so far.

Fixed size is the problem. However long the input, the summary is the same width, so information competes for space. Early tokens get overwritten by later ones. The failure mode is exactly what you'd predict: performance degrades with distance.

| | RNN | Transformer |
|---|---|---|
| Reads input | One token at a time, in order | All tokens at once |
| Carries context via | A fixed-size hidden state | Direct token-to-token attention |
| Distant context | Degrades with distance | Equally reachable |
| Training | Sequential — can't parallelise across the sequence | Parallel across the whole sequence |
| Cost scaling | Linear in length | Quadratic in length |

That last row is the trade. Transformers didn't win by being cheaper — they're dramatically more expensive per token of context. They won because the expense buys something that couldn't be bought otherwise, and because the parallelism made the expense survivable on GPUs.

## What attention actually computes

For each token, the model asks three questions, and the names are worth knowing because you'll meet them in every serving discussion later.

**Query** — what am I looking for?
**Key** — what do I offer to others looking?
**Value** — what do I actually contribute if selected?

Every token produces all three. To build the representation of "bank," the model compares bank's *query* against every other token's *key*, producing a relevance score for each. Those scores become weights, and the output is the weighted blend of everyone's *values*.

```
Sentence: "the man fished by the river then robbed the bank"

Computing the representation of "bank":
  query(bank) · key(river)  → 0.31   ← strong
  query(bank) · key(robbed) → 0.44   ← strongest
  query(bank) · key(the)    → 0.02   ← noise
  ...
  representation(bank) = Σ (weight × value) for every token
```

Change "river" to "transfer" and the weights shift, so the representation of "bank" shifts with them. Same word, different vector, because the context voted differently. Nothing was memorised — it was computed on the spot.

Models run many of these in parallel (**multi-head attention**), each head free to specialise: one tracks syntax, another tracks long-range reference, another tracks something nobody has a clean name for.

## The three consequences you'll actually feel

**Long context is possible but quadratically priced.** Every token attending to every token means doubling the input roughly quadruples the attention work. This is why context windows were historically small, why long-context pricing looks the way it does, and why [prompt caching](/ai-engineering/module-03/05-prompt-caching) is such a large lever — it lets you skip recomputing attention over a prefix you've already sent.

**Training parallelises, generation does not.** During training the whole sequence is processed at once. During generation the model still produces one token at a time, feeding each back as input. That asymmetry is the entire subject of [Training vs Inference](./02-training-vs-inference), and it's why streaming is natural rather than bolted on.

**Position must be injected deliberately.** Attention has no inherent sense of order — it sees a set, not a sequence. Order is added through positional encoding, and modern models use rotary encoding (RoPE), which is why extending a model's context window isn't simply a matter of allowing a longer input.

## The honest part

At sufficient scale, models began doing things nobody trained them to do: multi-step reasoning, working code, analogies across domains never seen together. The field calls this emergent capability, and does not have a complete mechanistic account of it.

That isn't a dodge, it's the current state. There are theories — compressed world models, implicit Bayesian inference — and no settled answer.

::: warning Watch out
**You can't reliably predict model behaviour from the architecture.** Knowing how attention works will not tell you whether a given model can do your task. Anyone confident they can reason from first principles to capability is overconfident. Test empirically; the architecture explains *why* things behave as they do, not *what* they'll do.

**"It attends to everything" doesn't mean it uses everything well.** Attention makes distant context reachable, not guaranteed. Models routinely under-use information buried in the middle of long inputs — the position of a fact in your prompt affects whether it lands. This is why [context engineering](/ai-engineering/module-01/03-context-engineering) is a real discipline and not just concatenation.
:::

::: details Interview Question — Attention versus recurrence
**Q:** Explain what attention does and why it replaced recurrent architectures. What did the change cost?

**A:** An RNN carries context in a fixed-size hidden state passed forward token by token. Because the state is fixed-size, information about early tokens gets compressed and overwritten as the sequence grows — long-range dependencies degrade with distance, and the sequential dependency means you can't parallelise across the sequence during training.

Attention removes the intermediary. Each token compares its query against every other token's key to produce relevance weights, then takes a weighted sum of their values. Distant tokens are exactly as reachable as adjacent ones, because reach isn't mediated by a summary at all. This is why "bank" resolves differently next to "river" than next to "transfer" — the representation is computed from context, not retrieved.

The practical wins were long context, parallel training across the sequence (which is what made GPU scaling work), and representations rich enough to transfer across tasks.

The cost is quadratic complexity: every token attends to every token, so doubling input roughly quadruples attention compute. That's the direct cause of context-window limits, long-context pricing, and the entire body of work on efficient attention, KV caching and GQA. Transformers traded a linear-cost architecture that couldn't hold long-range context for a quadratic-cost one that could — and the bet paid off because parallelism made the quadratic term affordable in a way sequential recurrence never was.
:::

::: details Interview Question — Why position needs encoding
**Q:** Attention computes over all tokens simultaneously. What does that imply about word order, and how do transformers handle it?

**A:** Pure attention is permutation-invariant — it treats the input as a set. "Dog bites man" and "man bites dog" would produce identical attention outputs, because nothing in the query-key-value computation encodes position. For language that's obviously fatal.

Order is injected explicitly through positional encoding. The original transformer added sinusoidal position signals to the input embeddings. Modern models mostly use rotary position embeddings (RoPE), which rotate the query and key vectors by an angle derived from position, so relative position falls out of the dot product naturally.

The engineering consequence is that a model's context window isn't an arbitrary configuration limit. The position encoding was trained over a specific range, and pushing beyond it means the model sees position signals it has never encountered. This is why extending context requires techniques like position interpolation and usually some continued training — and why a model advertised at a long context length may still show quality degradation well before that limit. The limit is about what the position encoding was trained to represent, not about a buffer size.
:::

## Key Mental Models

**Attention replaced a summary with direct lookup.** RNNs compressed the past into a fixed-size state; transformers let every token consult every other token directly.

**The same word gets different vectors in different contexts.** Meaning is computed from neighbours at inference time, not retrieved from a dictionary.

**Quadratic cost is the price of long context.** Nearly every serving optimisation you'll meet later exists to manage that term.

**Training is parallel, generation is sequential.** The asymmetry drives streaming, KV caching, and the whole shape of inference cost.

**Architecture explains behaviour; it doesn't predict capability.** Test empirically.

## Related

- [0.2 Training vs Inference](./02-training-vs-inference) — why generation stays sequential
- [0.3 Embeddings](./03-embeddings) — the vectors attention operates on
- [1.1 LLMs & Tokens](/ai-engineering/module-01/01-llms-and-tokens) — context windows as a practical constraint
- [3.5 Prompt Caching](/ai-engineering/module-03/05-prompt-caching) — exploiting attention's prefix structure
- [ML 2.2 CNNs, RNNs, LSTMs](/ml-foundations/module-02/02-cnn-rnn-lstm) — the architectures transformers displaced

---

[← Module Overview](/ai-engineering/module-00/) · [Next: 0.2 Training vs Inference →](/ai-engineering/module-00/02-training-vs-inference)
