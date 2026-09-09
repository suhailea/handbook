---
title: AI Infrastructure Patterns — GPU, Model Serving, Scaling
outline: deep
---

# AI Infrastructure Patterns — GPU, Model Serving, Scaling

🔥🔥 Interview weight | Prerequisites: [10.3 AKS and Azure](./03-aks-and-azure)

## 🗣️ In Plain English

::: tip In Plain English
Running AI models at production scale introduces infrastructure challenges that don't exist in traditional web services. The two biggest are GPU memory and request batching.

**GPU memory** is the scarcest resource in AI infrastructure. An A100 GPU has 80GB of VRAM — sounds like a lot until you realize a 70B parameter model in FP16 requires 140GB just for the weights, before any context is added. Fitting models into GPU memory requires a combination of quantization (using 4-bit numbers instead of 16-bit), splitting across multiple GPUs (tensor parallelism), and carefully managing the KV cache (the attention state that grows with context length).

**Request batching** is the key to GPU efficiency. A GPU is optimized for parallel computation. Processing 64 requests simultaneously uses almost the same time as processing 1 request — as long as they can be batched. An idle GPU waiting for one request at a time is extremely wasteful. vLLM's continuous batching engine is specifically designed to solve this: it dynamically groups incoming requests, fills the GPU's compute capacity, and dramatically improves throughput.

The infrastructure patterns for AI are about solving these two constraints: fitting your model in memory, and keeping the GPU busy with batched requests.

**Scaling AI is different from scaling web services.** Web services scale horizontally — add more identical servers. AI serving can scale horizontally too, but individual GPUs are expensive and adding more of them multiplies cost rapidly. The first priority is maximizing the throughput of each GPU before scaling out. Only when a single GPU is saturated do you add more.
:::

## ⚙️ Under the Hood

### GPU Memory Planning

Before deploying a model, calculate memory requirements:

```python
# run: python gpu_memory_calc.py

def estimate_gpu_memory(
    model_params_billions: float,
    dtype: str = "fp16",           # "fp32", "fp16", "fp8", "int4", "int8"
    context_length: int = 4096,
    batch_size: int = 32,
    n_layers: int = 32,
    n_kv_heads: int = 8,
    head_dim: int = 128,
) -> dict:
    """Estimate GPU memory requirements for LLM inference"""

    # Bytes per parameter by dtype
    bytes_per_param = {
        "fp32": 4,
        "fp16": 2,
        "bf16": 2,
        "fp8":  1,
        "int8": 1,
        "int4": 0.5,  # 4-bit = 0.5 bytes per param
    }[dtype]

    # Model weight memory
    weight_memory_gb = model_params_billions * 1e9 * bytes_per_param / 1e9

    # KV cache memory
    # Each token needs: 2 (K + V) × n_kv_heads × head_dim × n_layers × bytes_per_param
    bytes_per_token = 2 * n_kv_heads * head_dim * n_layers * bytes_per_param
    kv_cache_gb = (batch_size * context_length * bytes_per_token) / 1e9

    # Activation memory (rough estimate: ~20% of weights)
    activation_gb = weight_memory_gb * 0.2

    total_gb = weight_memory_gb + kv_cache_gb + activation_gb

    return {
        "weight_memory_gb": round(weight_memory_gb, 1),
        "kv_cache_gb": round(kv_cache_gb, 1),
        "activation_gb": round(activation_gb, 1),
        "total_gb": round(total_gb, 1),
        "fits_in_a100_80gb": total_gb < 72,  # 90% utilization limit
        "fits_in_h100_80gb": total_gb < 72,
        "fits_in_2x_a100": total_gb < 144,
    }

# Common model sizes
models = [
    ("Llama-3-8B", 8, "fp16", 32, 32, 8, 128),
    ("Llama-3-8B-4bit", 8, "int4", 32, 32, 8, 128),
    ("Llama-3-70B", 70, "fp16", 4096, 80, 8, 128),
    ("Llama-3-70B-4bit", 70, "int4", 4096, 80, 8, 128),
    ("Mistral-7B", 7, "fp16", 4096, 32, 8, 128),
    ("Mistral-7B-4bit", 7, "int4", 4096, 32, 8, 128),
]

print(f"{'Model':<24} {'Weights':>8} {'KV Cache':>9} {'Total':>7} {'Fits A100?':>11}")
for name, params, dtype, ctx, n_layers, n_kv_heads, head_dim in models:
    r = estimate_gpu_memory(params, dtype, ctx, 32, n_layers, n_kv_heads, head_dim)
    fits = "Yes" if r["fits_in_a100_80gb"] else ("2×A100" if r["fits_in_2x_a100"] else "No (4×+)")
    print(f"{name:<24} {r['weight_memory_gb']:>7.1f}GB {r['kv_cache_gb']:>8.1f}GB {r['total_gb']:>6.1f}GB {fits:>11}")
```

### Quantization for Production Deployment

```python
# run: python quantization_demo.py
# pip install transformers bitsandbytes

# Load model in 4-bit quantization with bitsandbytes
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
import torch

quantization_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_compute_dtype=torch.float16,  # compute in fp16, store in 4-bit
    bnb_4bit_quant_type="nf4",             # NormalFloat4 (better than int4 for LLMs)
    bnb_4bit_use_double_quant=True,        # Quantize quantization constants too
)

# This loads a 7B model in ~4GB instead of ~14GB
model = AutoModelForCausalLM.from_pretrained(
    "mistralai/Mistral-7B-Instruct-v0.3",
    quantization_config=quantization_config,
    device_map="auto",
)
tokenizer = AutoTokenizer.from_pretrained("mistralai/Mistral-7B-Instruct-v0.3")

print(f"Model memory: {model.get_memory_footprint() / 1e9:.2f} GB")
# ~4GB instead of ~14GB for 7B model

# GPTQ — better quality, requires specific GPU
# AWQ — better quality + speed, good for vLLM
# For production: use pre-quantized AWQ models from HuggingFace
```

**Quantization quality impact:**
| Method | Memory | Speed | Quality Loss |
|--------|--------|-------|-------------|
| FP16 (baseline) | 100% | 1× | — |
| INT8 | 50% | ~1× | Minimal |
| GPTQ-INT4 | 25% | 1.2× | Small (1-2%) |
| AWQ-INT4 | 25% | 1.5× | Small (1-2%) |
| INT2 | 12.5% | — | Significant |

### Tensor Parallelism — Multi-GPU Serving

When a model is too large for one GPU, split it across multiple:

```python
# run: python tensor_parallel.py
# vLLM automatically handles tensor parallelism

# Start vLLM with 4 GPUs for a 70B model
# vllm serve meta-llama/Llama-3-70b-instruct \
#   --tensor-parallel-size 4 \     # Split attention heads across 4 GPUs
#   --max-model-len 32768

# Pipeline parallelism: split by layers (for very large models)
# Each GPU handles a subset of layers
# vllm serve model --pipeline-parallel-size 2 --tensor-parallel-size 4
# = 8 GPUs total (2 pipeline × 4 tensor)
```

**Tensor parallelism mechanics:**
- Each GPU holds a shard of the weight matrices
- For each token: all GPUs compute in parallel, then communicate via AllReduce
- Communication overhead: O(batch_size × d_model) per layer
- Practical: efficient up to 8 GPUs on NVLink; InfiniBand required for more

### Continuous Batching with vLLM

Traditional static batching: wait for N requests, process together, respond to all. Problem: batch waits for the slowest request; GPU idle between batches.

**Continuous batching (PagedAttention)**: requests join and leave the batch mid-processing. New requests are added to the running batch after each forward pass.

```python
# run: python vllm_serving.py
# pip install vllm
from vllm import LLM, SamplingParams

# vLLM handles batching automatically
llm = LLM(
    model="mistralai/Mistral-7B-Instruct-v0.3",
    gpu_memory_utilization=0.90,     # Use 90% of GPU VRAM
    max_num_batched_tokens=8192,     # Max tokens in a batch
    max_num_seqs=256,                # Max concurrent sequences
    enforce_eager=False,             # Use CUDA graphs for speed
)

# Single request (internally still uses batching)
sampling_params = SamplingParams(
    temperature=0.7,
    max_tokens=512,
    stop=["</s>", "[INST]"]
)

outputs = llm.generate([
    "Explain quantum computing in simple terms:",
    "What is the capital of France?",
    "Write a Python function to sort a list:",
], sampling_params)

for output in outputs:
    print(f"Generated: {output.outputs[0].text[:100]}...")

# vLLM's PagedAttention:
# - KV cache stored in non-contiguous memory pages (like OS virtual memory)
# - Eliminates memory fragmentation (different sequence lengths = different KV sizes)
# - Enables sharing KV cache across sequences with common prefixes (prefix caching)
```

### Prefix Caching

When many requests share a common prefix (system prompt), the KV cache for that prefix can be shared:

```python
# run: python prefix_cache_demo.py
from vllm import LLM, SamplingParams

llm = LLM(
    model="mistralai/Mistral-7B-Instruct-v0.3",
    enable_prefix_caching=True,  # Cache KV for common prefixes
)

# System prompt is the common prefix (4000 tokens)
system_prompt = """[INST] You are a helpful customer support agent for TaskFlow.
You have access to our product documentation and can help users with:
- Account management
- Billing questions
- Technical support
- Feature requests
[/INST]"""

# First request: full computation including system prompt KV
output1 = llm.generate([system_prompt + "How do I reset my password?"])

# Second request: system prompt KV is reused from cache!
output2 = llm.generate([system_prompt + "What is the refund policy?"])

# ~40% speedup for 4000-token system prompts when all requests share it
print("Prefix caching avoids recomputing the system prompt for every request")
```

### Model Serving Architecture Patterns

```
┌──────────────────────────────────────────────────────────────┐
│                  AI Request Flow                              │
│                                                              │
│  API Gateway → Rate Limiter → Request Router                 │
│                                    │                         │
│                    ┌───────────────┤                         │
│                    │               │                         │
│            ┌───────▼──────┐ ┌─────▼──────────┐            │
│            │ Azure OpenAI │ │  vLLM Cluster   │            │
│            │ (GPT-4o)     │ │ (Local Model)   │            │
│            │ - General    │ │ - Sensitive data │            │
│            │ - Fast       │ │ - Offline-capable│            │
│            └───────────────┘ └────────────────┘            │
│                                                              │
│  Selection criteria:                                         │
│  - data_sensitivity == "confidential" → vLLM               │
│  - requires_internet == false → vLLM                        │
│  - else → Azure OpenAI (cheaper, faster, more capable)      │
└──────────────────────────────────────────────────────────────┘
```

```typescript
// run: npx tsx model_router.ts
import OpenAI from 'openai'

interface ModelRoutingContext {
  dataSensitivity: 'public' | 'internal' | 'confidential'
  requiresLocalProcessing: boolean
  maxLatencyMs: number
  maxCostUsd: number
  estimatedInputTokens: number
}

function selectModelEndpoint(ctx: ModelRoutingContext): {
  endpoint: string
  model: string
  reason: string
} {
  // Hard rule: confidential data must stay local
  if (ctx.dataSensitivity === 'confidential' || ctx.requiresLocalProcessing) {
    return {
      endpoint: process.env.VLLM_ENDPOINT ?? 'http://vllm-service:8000',
      model: 'mistral-7b-instruct',
      reason: 'Confidential data or local processing requirement',
    }
  }

  // Cost optimization: cheap model for simple tasks
  if (ctx.estimatedInputTokens < 2000 && ctx.maxCostUsd < 0.01) {
    return {
      endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
      model: 'gpt-4o-mini-prod',  // Azure deployment name
      reason: 'Short request, cost-optimized',
    }
  }

  // Default: full capability model
  return {
    endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
    model: 'gpt-4o-prod',  // Azure deployment name
    reason: 'Standard request',
  }
}
```

### Cost and Throughput Benchmarking

```python
# run: python benchmark_throughput.py
# pip install vllm aiohttp

import asyncio
import time
from openai import AsyncOpenAI

async def benchmark_throughput(
    client: AsyncOpenAI,
    model: str,
    n_requests: int = 100,
    prompt: str = "Explain machine learning in one paragraph:",
    max_tokens: int = 200,
) -> dict:
    start = time.time()

    # Send all requests concurrently
    tasks = [
        client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
        )
        for _ in range(n_requests)
    ]

    responses = await asyncio.gather(*tasks, return_exceptions=True)

    elapsed = time.time() - start
    successes = [r for r in responses if not isinstance(r, Exception)]
    total_tokens = sum(r.usage.total_tokens for r in successes)

    return {
        "n_requests": n_requests,
        "successes": len(successes),
        "failures": n_requests - len(successes),
        "elapsed_s": round(elapsed, 2),
        "requests_per_second": round(len(successes) / elapsed, 2),
        "tokens_per_second": round(total_tokens / elapsed, 2),
        "avg_latency_ms": round(elapsed / len(successes) * 1000, 0),
    }

# Usage:
# asyncio.run(benchmark_throughput(client, "gpt-4o-mini-prod", n_requests=50))
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**KV cache OOM during long-context serving:** vLLM serves Llama-3-70B with `--max-model-len 32768`. Under load with many concurrent 32K-context requests, GPU VRAM is exhausted by KV cache even though model weights fit. vLLM begins rejecting new requests: `RESOURCE_EXHAUSTED: out of KV cache`. Fix: reduce `--max-model-len` to match actual usage (most requests use < 8K tokens in practice); enable `--kv-cache-dtype fp8` to halve KV cache memory; reduce `--max-num-seqs` to limit concurrent sequences; consider a larger GPU (H200 with 141GB) for long-context workloads.

**Cold start kills SLA on GPU scale-up:** An AKS GPU node scales to zero overnight. At 8am, the first requests arrive. Node takes 8 minutes to provision + 5 minutes for model loading = 13-minute cold start. First users of the day experience timeouts. Fix: schedule the GPU node to be provisioned 15 minutes before business hours (KEDA cron trigger or node autoprovisioner wake-up schedule); maintain at least 1 warm replica during business hours even if idle; implement graceful request queuing during cold start with a maximum wait time.

**Tensor parallelism communication bottleneck:** Scaling from 2 to 8 GPUs for a 70B model. Expected: 4× throughput. Actual: 2.8× throughput. The AllReduce communication between GPUs is the bottleneck — GPUs have 8× the compute but only 2× the NVLink bandwidth. Fix: for multi-GPU on the same node, NVLink is required (A100/H100 NVLink interconnect, not PCIe); for multiple nodes, InfiniBand is required; consider pipeline parallelism across nodes + tensor parallelism within nodes; beyond 8 GPUs on one node, throughput gains diminish rapidly without specialized interconnects.

**Quantized model quality regression on specific tasks:** A 4-bit quantized version of a model performs well on general benchmarks but has noticeable accuracy drops on mathematical reasoning tasks (GSM8K benchmark: 84% FP16 vs 76% INT4). The quantization error is amplified in the precise numerical computations required for math. Fix: run domain-specific benchmarks (your use case) not just general benchmarks; if math/code tasks are critical, use INT8 (50% memory savings with minimal quality loss); use AWQ quantization (better than GPTQ for outlier-sensitive tasks); consider mixed precision: FP16 for critical layers, INT4 for feed-forward layers.
:::

## 🎯 Checkpoint

::: details Question 1 — GPU memory for 70B model
**Q:** You want to deploy Llama-3-70B in FP16 for production serving with 32K context window and 16 concurrent users. Calculate the GPU memory required and specify the minimum hardware configuration.

**A:** Weight memory: 70B params × 2 bytes (FP16) = 140GB. KV cache (Llama-3-70B has 80 layers, 8 GQA heads, head_dim=128): per token = 2 × 8 × 128 × 80 × 2 bytes = 327,680 bytes ≈ 0.328 MB/token. For 16 concurrent sequences × 32,768 tokens = 524,288 tokens total × 0.328 MB ≈ 172GB KV cache. Activations ≈ 28GB. Total: 140 + 172 + 28 = 340GB. Minimum config: **4 × A100 80GB** (320GB VRAM — marginally too small), or **3 × H200 141GB** (423GB — comfortable). Practical recommendation: use 4-bit AWQ quantization → weights reduce to 35GB; KV cache in FP8 → 86GB; total ≈ 150GB → fits on **2 × H100 80GB** with comfortable headroom. Always benchmark with representative traffic before committing to hardware.
:::

::: details Question 2 — Continuous batching benefit
**Q:** Explain why continuous batching provides higher GPU throughput than static batching for LLM serving, and what PagedAttention enables that makes it feasible.

**A:** **Static batching** problem: to form a batch, you wait for N requests. Request 1 finishes in 50 tokens; requests 2-8 continue for 500 tokens. Request 1 is done but the GPU continues computing for the remaining requests. The batch processing time = max(all sequence lengths). GPU utilization is wasted on the "holes" where finished sequences sit idle. **Continuous batching** (iteration-level scheduling): after each forward pass (token generation), the batch is re-evaluated. Finished sequences are removed; new waiting requests are added. The GPU is always running at maximum batch utilization. Measured improvement: 20-40× better throughput vs static batching in typical production settings. **PagedAttention** makes this feasible by solving the KV cache memory problem: in static batching, KV cache is pre-allocated for the maximum sequence length (wastes memory for short sequences). With PagedAttention, KV cache is allocated in small pages (similar to OS virtual memory) and only the pages that are actually needed are allocated. This allows dynamically adding/removing sequences from the batch without pre-allocating full-length KV cache for each sequence. The combination enables vLLM to maintain high GPU utilization even with highly variable sequence lengths.
:::

## Key Mental Models

- **GPU VRAM = model weights + KV cache + activations** — KV cache grows linearly with context length × concurrent sequences; it's often the binding constraint, not model weights.
- **Quantization is the first lever** — INT4/INT8 models are 2-4× smaller with minimal quality loss for most tasks; always consider before buying more GPUs.
- **Continuous batching > static batching for throughput** — PagedAttention enables dynamic batch membership, keeping the GPU full.
- **Maximize GPU utilization before scaling out** — a well-configured single A100 can serve 10× more requests than a poorly configured one; add GPUs only when a single is saturated.
- **Local model serving is for data sovereignty, not cost** — cloud APIs (Azure OpenAI) are cheaper, faster, and more capable per dollar; self-hosting is justified by data residency requirements or air-gapped environments.

## Related

- [10.3 AKS and Azure](./03-aks-and-azure) — deploying these serving patterns on Azure
- [Module 3.3 vLLM](/ai-engineering/module-03/03-vllm) — vLLM internals: PagedAttention, KV cache mechanics
- [Module 3.5 Quantization](/ai-engineering/module-03/05-quantization) — quantization techniques in depth
