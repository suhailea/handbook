---
title: vLLM — High-Throughput Model Serving
outline: deep
---

# vLLM — High-Throughput Model Serving

Local llama.cpp was too slow for production. We needed to serve Llama 3 to 100 concurrent users. Enter vLLM.

::: tip Plain English
llama.cpp is like a single checkout lane at a grocery store. One customer at a time. Everyone else waits. It's fine when there's one person in the store.

vLLM is like a supermarket that batches customers together. While it's ringing up customer A's items, it's also already starting on customer B's items. Multiple customers are being served simultaneously, sharing the same register. The store (GPU) is never idle.

This is called "continuous batching," and it's the core reason vLLM can serve 100 users in the time llama.cpp serves 5.
:::

## What vLLM is

vLLM is an open-source inference server built specifically for high-throughput LLM serving. It runs models on GPU and exposes an OpenAI-compatible API. Your existing code that calls OpenAI just needs a base URL change:

```python
# Before: OpenAI API
client = OpenAI(api_key="sk-...")

# After: vLLM (same interface, local model)
client = OpenAI(
    api_key="not-needed",
    base_url="http://your-vllm-server:8000/v1"
)
```

## The key ideas

### Continuous batching

Traditional inference servers process one request at a time (or batch fixed-size groups). vLLM processes requests continuously — new requests join the batch mid-flight as others complete. The GPU is almost never idle. This dramatically increases throughput.

### PagedAttention

During inference, the model needs to store "KV cache" — intermediate computations from processing input tokens. (More on KV cache on the [next page](/ai-engineering/module-03/05-prompt-caching).)

The problem: different requests have different lengths. A 5,000-token context and a 50-token context need very different amounts of KV cache space. If you pre-allocate the maximum, you waste most of your GPU memory most of the time.

PagedAttention manages KV cache like a virtual memory system — it allocates memory in small, fixed-size pages and only uses what's needed. This means you can fit many more concurrent requests in GPU memory than traditional approaches. The name references operating system paging: the same idea that lets your computer run programs bigger than your RAM.

For TaskFlow: with standard attention, we could handle ~20 concurrent requests on our A100. With PagedAttention (vLLM), we handle 80+ concurrent requests on the same GPU.

### OpenAI-compatible API

vLLM serves the exact same REST API as OpenAI. You can run:
- `/v1/chat/completions` (the standard chat endpoint)
- `/v1/completions` (legacy)
- `/v1/models` (model listing)

Any code that works with OpenAI works with vLLM. This is non-trivial — it means you can switch between cloud and self-hosted without changing your agent code.

## Deploying vLLM

```bash
# Install
pip install vllm

# Serve Llama 3 8B
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Meta-Llama-3-8B-Instruct \
  --tensor-parallel-size 1  # number of GPUs

# Serve Llama 3 70B across 4 GPUs
python -m vllm.entrypoints.openai.api_server \
  --model meta-llama/Meta-Llama-3-70B-Instruct \
  --tensor-parallel-size 4
```

## Comparison table

| | llama.cpp / Ollama | vLLM | Cloud API |
|---|---|---|---|
| Hardware | CPU / Apple Silicon | GPU required | Their problem |
| Concurrent users | 1 (effectively) | 50–500+ | Unlimited |
| Latency | 5–60s | 200ms–2s | 500ms–2s |
| Setup complexity | Low | Medium | None |
| Cost at scale | Near zero | GPU costs | Per token |
| Best for | Dev / single user | Self-hosted production | Cloud production |

::: tip When to use vLLM
- Self-hosting a model in production for multiple concurrent users
- Privacy requirements prevent cloud APIs
- High volume where cloud API costs exceed GPU costs
- You need fine-tuned models in production
:::

::: warning When NOT to use vLLM
- You don't have GPU access — vLLM needs NVIDIA GPU (though AMD ROCm support exists)
- Low traffic — if you have < 100 requests/hour, cloud API is simpler and probably cheaper
- You need frontier model quality — vLLM serves open models, which still trail GPT-4o/Claude on complex reasoning
:::

::: details Interview Question — PagedAttention
**Q:** What problem does PagedAttention solve, and why does it matter for throughput?

**A:** Traditional KV cache management pre-allocates a contiguous block of memory per request equal to the maximum sequence length. This leads to internal fragmentation — if your max is 4k tokens but most requests use 500 tokens, 87% of allocated memory is wasted per request. This limits how many requests can be in-flight simultaneously. PagedAttention manages KV cache in fixed-size pages (like OS virtual memory), allocating only the pages actually needed by each request. Pages from different requests can be interleaved in physical GPU memory. Result: much higher GPU memory utilization, 2–4x more concurrent requests for the same GPU. It also enables efficient memory sharing for requests with the same prompt prefix (prompt caching), and zero-copy beam search. The net effect is higher throughput without any model quality changes.
:::
