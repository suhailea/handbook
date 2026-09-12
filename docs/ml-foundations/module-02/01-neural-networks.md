---
title: Neural Networks — Layers, Weights, Activations, Backprop
outline: deep
---

# Neural Networks — Layers, Weights, Activations, Backprop

🔥🔥🔥 Interview weight | Prerequisites: [1.5 Linear Algebra](../module-01/05-linear-algebra-for-ai), [1.7 Optimization](../module-01/07-optimization)

## 🗣️ In Plain English

::: tip In Plain English
Think of a neural network as a factory assembly line with many stations.

Raw material (your input data — say, the pixels of an image) enters the first station. Each station is a **layer**. Workers at each station look at what they received, apply a transformation, and pass the result to the next station. At the end, the final station outputs the answer: "this image is a cat, probability 0.94."

What do the workers at each station actually do? They have two things: **weights** (tools they've learned to use over time) and an **activation function** (a decision about whether to pass the signal forward or suppress it).

The weights are like dials on a mixing board. Each worker has one dial for each piece of input they receive. A high dial = "this input matters a lot." A zero dial = "ignore this." The worker multiplies each input by its dial, sums everything up, adds a bias offset, and passes the result on.

But without an activation function, the whole assembly line would collapse into a single linear equation — no matter how many stations, you could always represent it as one. The **activation function** adds the crucial non-linearity: it lets the network learn curves, corners, and complex shapes instead of just straight lines. The most common one today (ReLU) is beautifully simple: "if the signal is positive, pass it through unchanged. If it's negative, silence it."

**Training** is the factory learning to do its job. At first, all the dials are random. The factory makes a prediction, compares it to the right answer, measures how wrong it was (the loss), and then — working backwards through all the stations — nudges each dial slightly toward the setting that would have produced a better answer. This nudging process is **backpropagation**.

After millions of products go through the line, the dials have been adjusted so many times that the factory has learned to make accurate predictions.
:::

## ⚙️ Under the Hood

### The Neuron — Atomic Unit

A single neuron computes: `output = activation(w · x + b)`

Where `w` is the weight vector, `x` is the input vector, `b` is the bias scalar, and `activation` is a non-linear function.

In matrix form for a full layer: `A = activation(XW + b)`
- X: (batch_size, input_dim)
- W: (input_dim, output_dim)  ← the learned parameters
- b: (output_dim,)
- A: (batch_size, output_dim) ← output activations

### Activation Functions

| Activation | Formula | Derivative | Used when |
|-----------|---------|-----------|-----------|
| **ReLU** | max(0, x) | 1 if x>0, 0 else | Hidden layers (default) |
| **Sigmoid** | 1/(1+e⁻ˣ) | σ(x)(1-σ(x)) | Binary output |
| **Softmax** | eˣⁱ/Σeˣʲ | complex (Jacobian) | Multiclass output |
| **Tanh** | (eˣ-e⁻ˣ)/(eˣ+e⁻ˣ) | 1-tanh²(x) | RNN hidden states |
| **GELU** | x·Φ(x) | smooth, ~ReLU | Transformers (BERT, GPT) |
| **LeakyReLU** | max(0.1x, x) | 1 if x>0, 0.1 else | When dying ReLU is concern |

**Dying ReLU problem:** If a neuron receives consistently negative inputs, its gradient is always zero (ReLU derivative is 0 for x≤0). The neuron "dies" — it never updates. Solutions: proper weight initialization, batch normalization, LeakyReLU.

```python
# run: python activations.py
import numpy as np

def relu(x):
    return np.maximum(0, x)

def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))

def softmax(x):
    # numerically stable: subtract max before exp
    e = np.exp(x - x.max(axis=-1, keepdims=True))
    return e / e.sum(axis=-1, keepdims=True)

def gelu(x):
    # Approximation used in transformers
    return 0.5 * x * (1 + np.tanh(np.sqrt(2/np.pi) * (x + 0.044715 * x**3)))

x = np.array([-2.0, -1.0, 0.0, 1.0, 2.0])
print(f"Input:   {x}")
print(f"ReLU:    {relu(x)}")
print(f"Sigmoid: {sigmoid(x).round(4)}")
print(f"GELU:    {gelu(x).round(4)}")

# Softmax: converts logits to probabilities
logits = np.array([2.0, 1.0, 0.1])  # raw scores for 3 classes
probs = softmax(logits)
print(f"\nLogits: {logits} → Probabilities: {probs.round(4)} (sum={probs.sum():.4f})")
```

### Building a Neural Network from Scratch

```python
# run: python neural_net_scratch.py
import numpy as np
from sklearn.datasets import make_moons
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

np.random.seed(42)

class Layer:
    def __init__(self, input_dim: int, output_dim: int):
        # He initialization: scale by sqrt(2/fan_in)
        self.W = np.random.randn(input_dim, output_dim) * np.sqrt(2.0 / input_dim)
        self.b = np.zeros(output_dim)
        # Cache for backprop
        self.X_cache = None
        self.dW = None
        self.db = None

    def forward(self, X: np.ndarray) -> np.ndarray:
        self.X_cache = X
        return X @ self.W + self.b

    def backward(self, dOut: np.ndarray) -> np.ndarray:
        self.dW = self.X_cache.T @ dOut
        self.db = dOut.sum(axis=0)
        return dOut @ self.W.T  # gradient flowing to previous layer

class ReLULayer:
    def __init__(self):
        self.mask = None

    def forward(self, X: np.ndarray) -> np.ndarray:
        self.mask = X > 0
        return X * self.mask

    def backward(self, dOut: np.ndarray) -> np.ndarray:
        return dOut * self.mask  # zero out where input was <= 0

class Network:
    def __init__(self):
        self.l1 = Layer(2, 16)
        self.r1 = ReLULayer()
        self.l2 = Layer(16, 8)
        self.r2 = ReLULayer()
        self.l3 = Layer(8, 1)  # output: 1 logit

    def forward(self, X: np.ndarray) -> np.ndarray:
        return self.l3.forward(self.r2.forward(self.l2.forward(self.r1.forward(self.l1.forward(X)))))

    def backward(self, dLoss: np.ndarray) -> None:
        d = self.l3.backward(dLoss)
        d = self.r2.backward(d)
        d = self.l2.backward(d)
        d = self.r1.backward(d)
        self.l1.backward(d)

    def update(self, lr: float) -> None:
        for layer in [self.l1, self.l2, self.l3]:
            layer.W -= lr * layer.dW
            layer.b -= lr * layer.db

def bce_loss(y_true, logits):
    probs = 1 / (1 + np.exp(-logits))
    loss = -np.mean(y_true * np.log(probs + 1e-15) + (1 - y_true) * np.log(1 - probs + 1e-15))
    dLoss = (probs - y_true) / len(y_true)
    return loss, dLoss

# Train on moons dataset
X, y = make_moons(n_samples=1000, noise=0.1, random_state=42)
X = StandardScaler().fit_transform(X)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
y_train = y_train.reshape(-1, 1).astype(float)
y_test  = y_test.reshape(-1, 1).astype(float)

net = Network()
lr = 0.01

for epoch in range(200):
    logits = net.forward(X_train)
    loss, dLoss = bce_loss(y_train, logits)
    net.backward(dLoss)
    net.update(lr)
    if (epoch + 1) % 50 == 0:
        preds = (1/(1+np.exp(-net.forward(X_test)))) > 0.5
        acc = (preds == y_test).mean()
        print(f"Epoch {epoch+1:3d}: train_loss={loss:.4f}, test_acc={acc:.4f}")
```

### Weight Initialization

How you initialize matters enormously:

- **All zeros**: all neurons compute the same value, all receive the same gradient. Network never breaks symmetry — all hidden neurons stay identical forever.
- **Too large random**: gradients explode in backward pass (large forward activations → large gradients)
- **Too small random**: gradients vanish (signals decay through layers)

**Xavier (Glorot) initialization** for sigmoid/tanh: `W ~ U(-√(6/(fanin+fanout)), √(6/(fanin+fanout)))`

**He initialization** for ReLU: `W ~ N(0, 2/fanin)` — accounts for the fact that ReLU zeros out half the neurons on average

```python
# run: python initialization.py
import numpy as np

def xavier_init(fan_in, fan_out):
    limit = np.sqrt(6 / (fan_in + fan_out))
    return np.random.uniform(-limit, limit, (fan_in, fan_out))

def he_init(fan_in, fan_out):
    std = np.sqrt(2.0 / fan_in)
    return np.random.randn(fan_in, fan_out) * std

# Verify signal magnitude through 10 layers
def simulate_forward(init_fn, n_layers=10, dim=256):
    x = np.random.randn(32, dim)  # batch of 32
    variances = [x.var()]
    for _ in range(n_layers):
        W = init_fn(dim, dim)
        x = np.maximum(0, x @ W)  # ReLU layer
        variances.append(x.var())
    return variances

for name, init_fn in [("He", he_init), ("Xavier", xavier_init)]:
    variances = simulate_forward(init_fn)
    print(f"{name}: layer variances {[f'{v:.3f}' for v in variances]}")
    # He: should stay roughly constant (~1.0 throughout)
    # Xavier: may decay for ReLU networks
```

### Batch Normalization

Normalizes layer inputs within a mini-batch: `x̂ = (x - μ_B) / √(σ²_B + ε)`, then `y = γx̂ + β` where γ, β are learned parameters.

Benefits:
- Reduces internal covariate shift (distribution of layer inputs stays stable)
- Allows higher learning rates
- Provides slight regularization
- Alleviates vanishing/exploding gradients

**Layer Normalization** (used in Transformers): normalizes over the feature dimension instead of batch — works for variable-length sequences and batch_size=1.

### Dropout

Randomly zeros out `p` fraction of neurons during training. Each training step uses a different random subset of the network. At inference, all neurons are active but outputs are scaled by `(1-p)`.

Effect: forces the network to learn redundant representations (since any neuron might be dropped). Reduces co-adaptation (neurons depending on specific other neurons). Equivalent to training an ensemble of 2^n sub-networks and averaging them.

```python
# run: python dropout_demo.py
import numpy as np

def dropout(x: np.ndarray, p: float = 0.5, training: bool = True) -> np.ndarray:
    """p = probability of DROPPING a neuron"""
    if not training:
        return x  # full network at inference (already scaled during training)
    mask = (np.random.rand(*x.shape) > p) / (1 - p)  # inverted dropout: scale during training
    return x * mask

x = np.ones((4, 8))
print("Training (p=0.5):")
print(dropout(x, p=0.5, training=True))  # ~half zeros, rest scaled to 2.0
print("\nInference:")
print(dropout(x, p=0.5, training=False))  # all ones
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Batch norm in production with wrong statistics:** Batch normalization computes running mean/var during training and uses them at inference. If training data distribution differs from production distribution (e.g., domain shift), the frozen batch norm statistics are wrong — inference degrades mysteriously. The model was fine on the test set (same distribution as training) but breaks on real data. Symptom: loss is much higher in production than expected from test metrics. Fix: recalibrate batch norm statistics on a representative production sample before deployment (`model.eval()` + forward pass on production data to update running stats).

**Dropout left on at inference:** A custom model class forgets to set `model.eval()` before inference. Dropout randomly zeros neurons during every inference call — predictions are non-deterministic and degraded. This is especially insidious for classification: the same input returns different predictions on different calls. Always call `model.eval()` (PyTorch) or `model(training=False)` (TensorFlow) at inference time.

**Exploding gradients in deep fine-tuning:** During fine-tuning, loss suddenly jumps to NaN after several hundred steps. Gradient norm spiked — one batch had an unusual input that sent gradients through the roof. Fix: log gradient norms every step (`torch.nn.utils.clip_grad_norm_`), add gradient clipping (max_norm=1.0), and reduce learning rate for the bottom layers.

**All-zero initial hidden layer:** A custom network initializes all weights to zero. Every neuron computes identical outputs, receives identical gradients, and updates identically forever — the hidden layer size is effectively 1. Network trains slowly, converges to poor local minimum. Always use random initialization (He for ReLU, Xavier for others).
:::

## 🎯 Checkpoint

::: details Question 1 — Why non-linearity?
**Q:** A network with 5 linear layers (no activation functions) is mathematically equivalent to a network with 1 linear layer. Prove this and explain why activation functions solve it.

**A:** A linear transformation is `y = Wx + b`. Composing two linear transformations: `y = W₂(W₁x + b₁) + b₂ = W₂W₁x + W₂b₁ + b₂ = W'x + b'` where `W' = W₂W₁` and `b' = W₂b₁ + b₂`. Matrix multiplication of two matrices yields another matrix of the same type. By induction, any depth of linear layers collapses to a single linear transformation `W'x + b'` — expressible as one layer. Activation functions break this: `ReLU(W₂ · ReLU(W₁x + b₁) + b₂)` cannot be simplified to a linear form because ReLU is non-linear (piecewise linear but not globally linear). Each additional layer with activation increases the number of linear regions in the input space, enabling exponentially more complex decision boundaries.
:::

::: details Question 2 — Batch norm vs layer norm
**Q:** Why does Transformer architecture use Layer Normalization instead of Batch Normalization?

**A:** Batch Normalization normalizes over the batch dimension — it computes mean and variance across the N samples in a mini-batch. This has three problems for Transformers: (1) **Variable sequence length**: sequences in a batch are padded to the same length; normalizing over a batch with padding produces incorrect statistics. (2) **Batch dependency**: during inference with batch_size=1 (streaming single tokens), BatchNorm uses training running statistics which may not reflect the current input — degrades with small or single-item batches. (3) **Autoregressive inference**: each token is generated one at a time; batch statistics are meaningless. Layer Normalization normalizes over the feature (embedding) dimension for each token independently: `x̂[i,j] = (x[i,j] - μᵢ) / σᵢ` where `μᵢ` and `σᵢ` are computed over the d_model features for token i. This is independent of other tokens, batch size, and sequence length — exactly what sequence models need.
:::

## Key Mental Models

- **Non-linearity = capacity to learn curved boundaries** — without activation functions, the whole network is a single linear transformation.
- **Weight initialization must preserve signal magnitude** — zeros create symmetry that training never breaks; large random causes explosion; He/Xavier initialize correctly for each activation type.
- **Dropout = training an ensemble** — each step trains a different random sub-network; inference averages them.
- **Batch norm stabilizes training; layer norm enables sequence models** — both normalize activations but on different axes.
- **Backprop is the chain rule applied backwards** — each layer must store its forward-pass activations to compute gradients.

## Related

- [1.7 Optimization](../module-01/07-optimization) — the gradient descent that trains these networks
- [2.2 CNNs, RNNs, LSTMs](./02-cnn-rnn-lstm) — specialized architectures built on these foundations
- [Module 0.1 How Transformers Work](/ai-engineering/module-00/01-how-transformers-work) — the modern architecture that uses all of the above
