---
title: Model Serving — Cloud vs Local vs Self-Hosted
outline: deep
---

# Model Serving — Cloud vs Local vs Self-Hosted

Three options were on the table. Each had a very different risk, cost, and latency profile.

::: tip Plain English
When you call OpenAI's API, you're renting someone else's server, someone else's GPU, and someone else's model. It's like renting a car — convenient, no maintenance, but the rental company has your data and you pay every time.

Running a model yourself is like buying a car. Higher upfront cost, more maintenance, but the car is yours, your data stays with you, and the per-mile cost is near zero once you've paid for it.

There's also a middle option: running a small model locally on your laptop or a cheap machine, no GPU required. Think of it as a bicycle — very cheap, limited range, but good for short trips.

The right choice depends on how far you're going, how often, and how private the trip needs to be.
:::

## The three options

### Option 1: Cloud API (OpenAI, Anthropic, Google)

You call an API. The model runs on their servers. You pay per token.

**How it works:** Sign up, get API key, make HTTP requests. Takes 30 minutes to production.

**Pros:**
- Zero infrastructure to manage
- Access to the best models in the world
- Scales automatically to any load
- Constant model updates (and improvements)

**Cons:**
- Your data leaves your servers
- Cost scales with usage — can get expensive at high volume
- Latency depends on their servers and your distance
- Rate limits cap your throughput
- You're dependent on their uptime and pricing decisions

### Option 2: Self-hosted on GPU (vLLM, TGI)

You rent or buy GPUs and run an open-source model yourself using an inference server.

**How it works:** Rent a GPU server (AWS, GCP, Lambda Labs), download a model (Llama 3, Mistral, etc.), run vLLM or similar. Exposes an OpenAI-compatible API your code calls.

**Pros:**
- Data never leaves your infrastructure
- Fixed cost (predictable at scale)
- Can customize the model (fine-tuning)
- No rate limits

**Cons:**
- Significant ops burden (GPU management, scaling, updates)
- High upfront cost to start
- Model quality below frontier models
- You manage the infrastructure, failures, security

### Option 3: Local on CPU/Apple Silicon (Ollama, llama.cpp)

You run a quantized model on regular hardware — no GPU required (or a consumer GPU).

**How it works:** Install Ollama, run `ollama pull llama3`, call a local API endpoint. Works on a MacBook Pro.

**Pros:**
- Completely offline — data stays on the machine
- Zero API costs
- Great for development and testing
- Works without internet

**Cons:**
- Much slower than cloud or GPU-hosted (seconds per response vs milliseconds)
- Only practical for small quantized models
- Not suitable for multiple concurrent users
- Smaller/quantized models have lower quality

## Comparison table

| | Cloud API | Self-hosted GPU | Local (CPU/Apple Silicon) |
|---|---|---|---|
| Cost | Per-token, scales with use | Fixed GPU cost + ops | Near zero |
| Latency | 500ms–2s | 200ms–1s (depends on GPU) | 5s–60s |
| Privacy | Data leaves your servers | Data stays with you | Fully local |
| Ops burden | None | High | None |
| Max model quality | Best (GPT-4o, Claude) | Good (Llama 3 70B) | Limited (8B quantized) |
| Scales to 100+ users | Yes | Yes (with setup) | No |
| Best for | Most production workloads | Privacy-sensitive production | Dev/test, offline use |

## When to choose each

::: tip Use Cloud API when
- You're in the early stage — don't optimize prematurely
- Model quality is critical and you need frontier performance
- You don't have the ops team to manage GPU infrastructure
- Your volume is moderate (the cost isn't prohibitive)
:::

::: tip Use self-hosted GPU when
- Data privacy requirements prevent sending data to third parties
- Your volume is high enough that per-token costs exceed GPU costs
- You need to fine-tune or customize the model
- You have (or can hire) the ops expertise
:::

::: tip Use local/Ollama when
- Development and testing — no need to burn API credits
- Fully offline or air-gapped environments
- Internal tools where latency is acceptable
- Proof of concept before committing to GPU infrastructure
:::

For TaskFlow's enterprise customers: we deployed a self-hosted Llama 3 70B on a pair of A100 GPUs. Enterprise data never left their VPC. Standard customers still use the OpenAI API. It's not one choice — it's a tiered architecture.

::: details Interview Question — When to self-host
**Q:** At what point does it make financial sense to self-host a model vs use a cloud API?

**A:** Rough math: A cloud API charges roughly $5–15 per million tokens (for GPT-4-class). An A100 GPU server costs ~$2–3/hour on AWS. If you're running 24/7, that's ~$1,500–2,000/month. You'd need to process 100–400 million tokens per month to break even (not counting engineering time to manage infrastructure). Beyond that, self-hosting is cheaper. In practice: self-host when you're spending >$3k/month on API costs, you have privacy requirements, or you need fine-tuning. Below that threshold, the ops overhead isn't worth it. Also consider: are you paying for GPU idle time? If your load is spiky, cloud APIs may remain cheaper even at high average volume because you don't pay when you're not using them.
:::
