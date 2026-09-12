---
title: RLHF & Alignment
outline: deep
---

# RLHF & Alignment

A model trained only on internet text is helpful, harmful and rude in roughly the proportions the internet is. Alignment training is what turned raw language capability into something shippable — and it's also the direct cause of most of the model behaviour you'll find yourself fighting.

::: tip Plain English
Picture someone who has read essentially everything: every manual, every forum argument, every novel, every support transcript. They can imitate any of it perfectly.

Now ask them a question. Which voice do they answer in? The patient technical writer? The combative forum poster? The character in a thriller who happens to be discussing the same topic? They've seen all of those, and nothing in "having read everything" tells them which one you wanted.

That's a base model. Enormously capable, no sense of what a *good answer to a user* looks like — because being statistically plausible and being helpful are different targets, and only the first one was ever trained for.

Alignment is the second training stage that supplies the missing judgement. First by showing examples of good answers, then — and this is the clever part — by showing pairs of answers and asking people which is better. Judging is far faster than authoring, so you can collect vastly more signal for the same money.

Everything you like about a deployed model, and most of what irritates you, comes from this stage rather than the first.
:::

## Three stages, three different objectives

| Stage | What it optimises | Data | Cost |
|---|---|---|---|
| **Pre-training** | Predict the next token | Trillions of tokens, scraped | Enormous — months, thousands of GPUs |
| **Supervised fine-tuning (SFT)** | Imitate good answers | Tens of thousands of written examples | Moderate — humans author each one |
| **Preference tuning (RLHF/DPO)** | Produce answers humans prefer | Hundreds of thousands of rankings | Moderate — humans only compare |

Pre-training produces capability. SFT produces format. Preference tuning produces judgement. They aren't interchangeable, and skipping the last one is what separates a base model from an assistant.

The economics of the third stage are the point. Writing an ideal answer to a hard question might take a skilled contractor twenty minutes. Deciding which of two answers is better takes thirty seconds. Ranking is where the scale comes from, and the whole method is built around that asymmetry.

## How preference tuning works

Classic RLHF runs in two steps:

**Train a reward model.** Show humans pairs of model outputs for the same prompt; record which they preferred. Train a separate model to predict those preferences. The reward model is now a cheap, automatic stand-in for human judgement — it can score any output without a human present.

**Optimise against it.** Generate outputs from the language model, score them with the reward model, and adjust the language model toward higher-scoring outputs using reinforcement learning. Repeat.

```
prompt ──> language model ──> two candidate answers
                                      │
                            human picks the better one
                                      │
                                reward model learns to predict the pick
                                      │
              language model nudged toward outputs the reward model scores highly
```

There's a constraint that matters: the optimisation is penalised for drifting too far from the SFT model. Without that leash, the model finds ways to score highly on the reward model while producing degenerate text — the classic reward-hacking failure, where output stops being language and starts being whatever the scorer likes.

## What replaced it

**DPO (Direct Preference Optimization)** is now the more common choice. It skips the separate reward model and the RL loop entirely, deriving a loss directly from preference pairs and fine-tuning in one stage. Simpler pipeline, far less training instability, comparable results. Most fine-tunes you'll encounter today use DPO or a variant of it.

**RLAIF (RL from AI Feedback)** substitutes a capable model for the human rankers. Much cheaper, scales indefinitely — and inherits whatever biases the judge model has. It's the same trade-off you'll meet again in [LLM-as-judge evaluation](/ai-engineering/module-05/02-evaluation-pipeline): automated preference is affordable enough to use everywhere and correlated enough with human judgement to be useful, but it is not the same thing.

**RLVR (RL from Verifiable Rewards)** applies where correctness is checkable — maths with a known answer, code that either passes tests or doesn't. The reward comes from the verifier rather than from preference, which removes the subjectivity entirely. It's a large part of why recent models improved sharply on reasoning tasks specifically.

## Why this shows up in your product

Alignment explains refusals, formatting habits, hedging, and the tendency to say "I'm not certain" instead of confidently inventing an answer. It also explains over-refusal on obviously benign requests, and disclaimers attached to things that needed none.

When a model won't do something reasonable, you're meeting a calibration decision, not randomness. The useful response is to supply context that changes the model's read of what a helpful answer looks like here — stating the professional setting, the audience, the purpose. That's not circumvention; it's giving the model the information a human would have needed to make the same judgement.

It also explains why behaviour shifts between model versions more than capability benchmarks suggest. A new version can be measurably smarter and still feel worse for your use case, because the alignment calibration moved. This is a concrete argument for keeping a golden dataset and re-running it on every model upgrade — capability benchmarks won't catch a tone or refusal regression that breaks your product.

::: warning Watch out
**The alignment tax is real and bidirectional.** Over-align and the model refuses too much, hedges everything, and buries answers in caveats. Under-align and it's unpredictable. Every lab navigates this continuously, which is why the same model family behaves noticeably differently across versions.

**Preference tuning optimises for what raters liked, not for what's true.** Raters reward answers that *look* good: confident, fluent, well-structured. That's a systematic pressure toward confident phrasing regardless of actual certainty, and it's part of why fluent hallucination is the failure mode rather than obvious garbage. Your [evaluation](/ai-engineering/module-05/) has to check grounding directly, because the training process did not.

**Alignment is not a security boundary.** It reduces the probability of bad output; it doesn't prevent it, and it can be steered by adversarial input. Anything with real consequences needs enforcement in code — see [agent security](/ai-engineering/module-07/02-agent-security).
:::

::: details Interview Question — Why benchmarks aren't enough
**Q:** A base model scores well on factual accuracy and reasoning benchmarks. Why can't you ship it as an assistant, and what specifically does alignment add?

**A:** Benchmarks measure capability — whether the model *can* produce a correct answer. They say nothing about whether it *will* produce an appropriate one unprompted.

A base model is optimised for statistical plausibility given its training distribution, which contains harmful content, low-quality content, and content in registers entirely wrong for a user-facing product. Asked "how do I cancel my subscription?", a base model might continue the question rather than answer it — because in its training data, questions are frequently followed by more questions. It has no notion that a query implies a request for help.

Alignment supplies three things benchmarks don't measure: the instruction-following behaviour that maps a question to an answer rather than a continuation; the refusal behaviour that declines harmful requests; and calibration, which is the tendency to express uncertainty rather than confidently fabricate.

The practical framing for an interview: pre-training buys capability, alignment buys behaviour, and shipping requires both. You can't substitute output filtering for alignment at scale, because you'd be filtering a firehose of plausible-but-wrong-register text rather than catching occasional edge cases.
:::

::: details Interview Question — When a model upgrade regresses your product
**Q:** You upgrade to a newer model that benchmarks better across the board. Users report the assistant "got worse." How is that possible and how do you handle it?

**A:** Entirely possible, and common. Benchmarks measure capability on standardised tasks; your users experience behaviour on your specific task. Alignment calibration changes between versions independently of capability, so a smarter model can refuse more, hedge more, change formatting conventions, or shift verbosity in ways that break prompts tuned against the previous version's defaults.

Concretely: prompts that relied on the old model's tendencies may now under-specify. Few-shot examples that anchored format may be overridden by stronger instruction-following. Output length can change enough to break downstream parsing. A newly cautious refusal boundary can catch legitimate requests in your domain.

Handling it: never upgrade on benchmarks alone. Run your golden dataset against both versions and compare on the dimensions your users care about — task completion, tone, refusal rate, format conformance — not on aggregate quality. Use pairwise judging where absolute scores are unstable. Shadow-deploy and compare outcome metrics like escalation rate over real traffic before switching.

And expect to re-tune prompts. Prompts are fitted to a model's calibration; changing the model changes the fit. Treating the prompt as portable across versions is the mistake that produces this exact surprise.
:::

## Key Mental Models

**Pre-training buys capability, alignment buys behaviour.** They're separate training stages with separate objectives, and only one of them is measured by benchmarks.

**Ranking scales where authoring doesn't.** The whole method exists because comparing two answers is vastly cheaper than writing one.

**Preference tuning rewards what looks good to raters.** That's a structural bias toward confident phrasing, and a direct cause of fluent hallucination.

**Refusals and hedging are calibration, not malfunction.** Supply the context a human would have needed and the assessment usually changes.

**Alignment reduces probability; it never guarantees.** High-stakes behaviour belongs in code.

## Related

- [0.2 Training vs Inference](./02-training-vs-inference) — where these stages sit in the lifecycle
- [1.2 Prompt Engineering](/ai-engineering/module-01/02-prompt-engineering) — working with the alignment rather than against it
- [10.1 Fine-Tuning Overview](/ai-engineering/module-10/01-fine-tuning-overview) — running SFT and DPO on your own data
- [5.2 Evaluation Pipeline](/ai-engineering/module-05/02-evaluation-pipeline) — catching alignment regressions on upgrade
- [7.3 Responsible AI](/ai-engineering/module-07/03-responsible-ai) — the wider picture

---

[← 0.3 Embeddings](/ai-engineering/module-00/03-embeddings) · [Next: Module 0 Summary →](/ai-engineering/module-00/summary)
