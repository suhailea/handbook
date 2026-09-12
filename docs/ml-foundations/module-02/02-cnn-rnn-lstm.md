---
title: CNNs, RNNs, LSTMs — and Why Transformers Won
outline: deep
---

# CNNs, RNNs, LSTMs — and Why Transformers Won

🔥🔥 Interview weight | Prerequisites: [2.1 Neural Networks](./01-neural-networks)

## 🗣️ In Plain English

::: tip In Plain English
Before Transformers, researchers built specialized architectures for different data types. Understanding them helps you understand why Transformers are so good — and when older architectures still have a role.

**Convolutional Neural Networks (CNNs)** were designed for images. The key insight: a cat ear looks the same whether it's in the top-left or bottom-right of the image. CNNs exploit this by sliding the same small "filter" (a pattern detector) across the entire image. One filter might detect edges, another might detect curves. Stack many filters across many layers, and you get a hierarchy: edges → shapes → features → "this is a cat." The sliding window approach is far more efficient than a regular network, which would need to independently learn that "this pixel pattern = cat" in every possible position.

**Recurrent Neural Networks (RNNs)** were designed for sequences — text, audio, time series. The idea: process one element at a time, left to right, and maintain a "memory" (hidden state) that carries information forward. It's like reading a sentence word by word, carrying your understanding as you go. The problem: the memory is a single fixed-size vector. By the time you reach word 50 of a sentence, word 1 has been squeezed through 49 transformations and is barely represented. Long-range dependencies vanish.

**LSTMs (Long Short-Term Memory)** added a more sophisticated memory system with gates — think of a notebook with a "what to remember" gate, a "what to forget" gate, and a "what to output" gate. This helped with longer sequences but didn't fully solve the fundamental bottleneck: information still had to flow through every intermediate step to reach long-distance connections.

**Transformers** solved this with a radical idea: let every word attend directly to every other word. No bottleneck, no sequential processing — the attention mechanism computes the relevance of every word to every other word simultaneously. Word 1 and word 50 connect directly, with no information decay. This direct all-to-all connectivity, combined with the ability to run in parallel (unlike RNNs which are sequential), made Transformers scale to the enormous datasets that produce LLMs.

The pattern: each architecture made a specific structural assumption. CNNs assumed spatial locality and translation invariance. RNNs assumed sequential temporal structure. Transformers made no such assumptions — they let the data teach the model which relationships matter.
:::

## ⚙️ Under the Hood

### Convolutional Neural Networks

A **convolution** slides a learned filter (kernel) over the input and computes element-wise multiplication and sum at each position. For a 3×3 filter over a 2D image:

`output[i,j] = Σ Σ input[i+di, j+dj] * kernel[di, dj]`

Key parameters:
- **Kernel size**: 3×3, 5×5 — spatial extent the filter sees
- **Stride**: step size when sliding (stride=2 downsamples by 2×)
- **Padding**: zeros added to edges so output size matches input
- **Channels**: multiple filters → multiple output feature maps

```python
# run: python cnn_demo.py
import numpy as np

# Manual 2D convolution (for understanding — don't use in production)
def conv2d(input_2d: np.ndarray, kernel: np.ndarray, stride: int = 1) -> np.ndarray:
    h, w = input_2d.shape
    kh, kw = kernel.shape
    out_h = (h - kh) // stride + 1
    out_w = (w - kw) // stride + 1
    output = np.zeros((out_h, out_w))
    for i in range(out_h):
        for j in range(out_w):
            region = input_2d[i*stride:i*stride+kh, j*stride:j*stride+kw]
            output[i, j] = (region * kernel).sum()
    return output

# Edge detection kernel (Sobel horizontal)
image = np.array([
    [0, 0, 0, 0, 0],
    [0, 1, 1, 1, 0],
    [0, 1, 1, 1, 0],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0],
], dtype=float)

edge_kernel = np.array([
    [-1, -2, -1],
    [ 0,  0,  0],
    [ 1,  2,  1],
])

edges = conv2d(image, edge_kernel)
print("Input:\n", image)
print("Edges (horizontal Sobel):\n", edges)
# Non-zero values appear at horizontal edges

# Using PyTorch (real usage):
# import torch.nn as nn
# conv = nn.Conv2d(in_channels=3, out_channels=64, kernel_size=3, padding=1)
# # (batch, 3, 224, 224) → (batch, 64, 224, 224) with padding=1
```

**Pooling layers** reduce spatial dimensions: MaxPool takes the maximum in each window (retains strongest activation). This provides spatial invariance — a slight shift in the input doesn't change the pooled output.

**Typical CNN architecture** (VGG-style):
```
Input(224×224×3) → Conv→ReLU→Pool → Conv→ReLU→Pool → ... → Flatten → FC → Softmax
```

**Why CNNs are still used:**
- Efficient for image/audio when spatial locality is a true inductive bias
- Much smaller parameter count than attention for 2D data
- Faster inference on edge devices (no O(n²) attention)
- Used in vision encoders inside multimodal models (e.g., CLIP)

### Recurrent Neural Networks

At each time step t, an RNN computes:
`h_t = tanh(W_h * h_{t-1} + W_x * x_t + b)`

Where `h_{t-1}` is the hidden state from the previous step, `x_t` is the current input.

```python
# run: python rnn_manual.py
import numpy as np

# Minimal RNN: processes a sequence left-to-right
class SimpleRNN:
    def __init__(self, input_dim: int, hidden_dim: int):
        # Xavier init
        self.W_h = np.random.randn(hidden_dim, hidden_dim) * 0.1
        self.W_x = np.random.randn(hidden_dim, input_dim) * 0.1
        self.b   = np.zeros(hidden_dim)
        self.hidden_dim = hidden_dim

    def forward(self, sequence: np.ndarray) -> list:
        """sequence: (seq_len, input_dim)"""
        h = np.zeros(self.hidden_dim)
        hidden_states = []
        for x_t in sequence:
            h = np.tanh(self.W_h @ h + self.W_x @ x_t + self.b)
            hidden_states.append(h.copy())
        return hidden_states

# Process a sequence of 5 "word vectors" (dim=4)
rnn = SimpleRNN(input_dim=4, hidden_dim=8)
seq = np.random.randn(5, 4)
states = rnn.forward(seq)
print(f"Hidden state shape at each step: {states[0].shape}")
print(f"After 5 steps, hidden state norm: {np.linalg.norm(states[-1]):.4f}")
# The hidden state carries ALL past information compressed into 8 values
# Information from step 0 has been transformed 5 times by step 4
```

**The vanishing gradient problem in RNNs:**

During backpropagation through time (BPTT), gradients are multiplied by `W_h` at each step. If `max_eigenvalue(W_h) < 1`, gradients vanish exponentially. If `> 1`, they explode. In practice, for long sequences (50-100 tokens), the gradient signal from early tokens is negligible.

### LSTM — Long Short-Term Memory

LSTM introduces three gates (σ = sigmoid) and a cell state c_t that flows more directly:

```
f_t = σ(W_f · [h_{t-1}, x_t] + b_f)   # Forget gate: what to erase from cell state
i_t = σ(W_i · [h_{t-1}, x_t] + b_i)   # Input gate: what new information to add
g_t = tanh(W_g · [h_{t-1}, x_t] + b_g) # Gate gate: candidate values to add
o_t = σ(W_o · [h_{t-1}, x_t] + b_o)   # Output gate: what to output

c_t = f_t ⊙ c_{t-1} + i_t ⊙ g_t      # Cell state update
h_t = o_t ⊙ tanh(c_t)                 # Hidden state
```

The cell state `c_t` is the key innovation: information can flow unchanged through `f_t = 1, i_t = 0` (preserve everything) or be completely replaced. The gradient flows through `c_t` more directly (additive update, not multiplicative through many layers), reducing vanishing gradients for sequences up to ~200 tokens.

```python
# run: python lstm_manual.py
import numpy as np

class LSTM:
    def __init__(self, input_dim: int, hidden_dim: int):
        # Combined weight matrix for all 4 gates: [forget, input, gate, output]
        self.W = np.random.randn(4 * hidden_dim, input_dim + hidden_dim) * 0.1
        self.b = np.zeros(4 * hidden_dim)
        self.hidden_dim = hidden_dim

    def step(self, x_t, h_prev, c_prev):
        combined = np.concatenate([h_prev, x_t])
        gates = self.W @ combined + self.b  # (4*hidden,)

        hd = self.hidden_dim
        f = 1/(1+np.exp(-gates[:hd]))    # forget gate
        i = 1/(1+np.exp(-gates[hd:2*hd])) # input gate
        g = np.tanh(gates[2*hd:3*hd])   # gate gate
        o = 1/(1+np.exp(-gates[3*hd:])) # output gate

        c_t = f * c_prev + i * g        # cell state
        h_t = o * np.tanh(c_t)          # hidden state
        return h_t, c_t

lstm = LSTM(input_dim=16, hidden_dim=32)
seq_len = 100  # longer than RNN typically handles well
h, c = np.zeros(32), np.zeros(32)
for t in range(seq_len):
    x_t = np.random.randn(16)
    h, c = lstm.step(x_t, h, c)
print(f"After {seq_len} steps: hidden norm={np.linalg.norm(h):.4f}")
```

### Why Transformers Won

The Transformer's self-attention provides **direct connections between any two positions** in a sequence:

| Property | RNN/LSTM | Transformer |
|----------|----------|-------------|
| Path length between position 1 and position N | O(N) — through N steps | O(1) — direct attention |
| Can process in parallel? | No — sequential | Yes — all positions simultaneously |
| Max practical sequence length | ~200-500 tokens | 1M+ tokens (with efficient attention) |
| Gradient path | Through N multiplications | Through ~constant layers |
| Inductive bias | Sequential order | None — positional encodings provide order |
| Training speed | Slow (sequential) | Fast (parallel, GPU-friendly) |
| Parameter efficiency | Efficient (shared weights) | More parameters (attention matrices) |

**Transformers scale better because:**
1. Parallel training enables processing of internet-scale datasets
2. No bottleneck: every word can "see" every other word with no information decay
3. Attention heads can specialize: one head learns syntax, another learns coreference, etc.
4. Residual connections allow stacking 96+ layers without vanishing gradients

**Where RNNs/LSTMs still make sense:**
- Very long sequences where O(n²) attention is prohibitive (time series with millions of steps)
- Streaming inference where each step must be processed online with O(1) state
- Edge deployment where memory is constrained (LSTM state is small and fixed)
- State Space Models (SSM) like Mamba combine RNN-style efficiency with competitive performance

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Exploding gradients in RNNs on long sequences:** Training an LSTM on sequences longer than used in training — loss suddenly NaN. Gradients through the LSTM cell, while more stable than plain RNN, can still explode for very long sequences or high learning rates. Fix: gradient clipping (`clip_grad_norm_ ≤ 5.0` for RNNs), truncated BPTT (backpropagate through only last K steps).

**CNN receptive field too small:** A 1D CNN for time-series classification uses 3×3 kernels and 4 layers. The effective receptive field is only 9 steps — can't capture patterns spanning 50+ steps. Accuracy plateaus despite more data. Fix: increase kernel size, add dilation (dilated convolutions: skip positions to expand receptive field geometrically without more parameters), or stack more layers.

**Transformer O(n²) memory for long context:** Adding 32K token context to a Transformer causes OOM at batch_size=4 on an 80GB A100. Memory scales as O(seq_len²) for full attention. Fix: Flash Attention (computes attention in tiles, O(seq_len) memory while maintaining O(seq_len²) compute), sliding window attention, or Mamba-style state space models for ultra-long sequences.

**LSTM bidirectional during training, unidirectional during inference:** A sentiment model uses a bidirectional LSTM (looks at past and future context). This architecture requires the full sequence before processing any position — fine for batch classification, breaks for streaming/real-time scenarios where words arrive one at a time. An unidirectional LSTM or causal transformer is required for streaming inference.
:::

## 🎯 Checkpoint

::: details Question 1 — CNN parameter sharing
**Q:** A convolutional layer with 64 filters of 3×3 has how many parameters? Compare to a fully-connected layer connecting a 224×224 image to 64 output neurons. What does this imply about CNNs' efficiency?

**A:** Conv layer: 64 filters × 3 × 3 × (input channels, say 3) + 64 biases = 64 × 27 + 64 = 1,792 parameters. These parameters are shared across every spatial position. The same 27 weights detect the same edge pattern whether it's in the top-left or center of the image. Fully-connected layer: 224 × 224 × 3 input features × 64 output neurons + 64 biases = 9,633,856 + 64 ≈ 9.6 million parameters. Each spatial position uses unique weights — no sharing. Implication: CNNs are 5,000× more parameter-efficient here, and the shared weights naturally implement translation equivariance (detecting a feature anywhere in the image). This is why CNNs can learn from much less data for image tasks than fully-connected networks.
:::

::: details Question 2 — Transformer vs LSTM for LLM
**Q:** Why is it fundamentally difficult to train a language model the size of GPT-3 (175B parameters) using LSTM architecture, regardless of compute budget?

**A:** Two fundamental bottlenecks: (1) **Sequential training**: LSTM processes tokens sequentially — position t cannot be computed until position t-1 is complete. GPT-3 was trained on ~300 billion tokens. Sequential processing means you cannot parallelize across the sequence dimension, only across the batch. Modern GPU clusters achieve massive throughput through data parallelism AND sequence parallelism; LSTMs can only use the former. Training time would be 10-100× longer for equivalent throughput. (2) **Long-range gradient decay**: Even with LSTM's cell state, gradients for dependencies spanning 1000+ tokens (e.g., "The president who was elected in 2008... he...") decay significantly through hundreds of multiplicative LSTM steps. This limits the context length that the model can effectively learn from. Transformers handle 4K-128K token contexts with direct attention connections; effective LSTM context rarely exceeds 500-1000 tokens in practice. The Transformer architecture was specifically the breakthrough that made LLMs at this scale feasible.
:::

## Key Mental Models

- **CNNs exploit translation invariance via weight sharing** — the same detector works everywhere in the image, reducing parameters by orders of magnitude.
- **LSTMs improved on RNNs by adding a cell state as a gradient highway** — information can flow more directly, reducing but not eliminating vanishing gradients.
- **Transformers replaced sequential bottlenecks with direct attention** — O(1) path between any two positions enables both better learning and parallel training.
- **No inductive bias in Transformers is a feature, not a bug** — enough data teaches the model what structure to learn, rather than constraining it upfront.

## Related

- [2.1 Neural Networks](./01-neural-networks) — foundations these architectures build on
- [Module 0.1 How Transformers Work](/ai-engineering/module-00/01-how-transformers-work) — the winning architecture in full detail
- [Module 3.3 vLLM](/ai-engineering/module-09/03-vllm) — efficient inference for Transformer-based LLMs
