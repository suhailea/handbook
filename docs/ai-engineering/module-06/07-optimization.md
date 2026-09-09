---
title: Optimization — Loss Functions, Gradient Descent, Backpropagation
outline: deep
---

# Optimization — Loss Functions, Gradient Descent, Backpropagation

🔥🔥🔥 Interview weight | Prerequisites: [6.5 Linear Algebra for AI](./05-linear-algebra-for-ai)

## 🗣️ In Plain English

::: tip In Plain English
Training a machine learning model is a search problem. You have a landscape of possible models — every possible set of weights defines one point in this landscape. Some points produce models that make accurate predictions; most don't. Training is the process of finding the good points.

**The loss function** is your map: it tells you how bad your current position is. If your model predicts "the price will be $200" but the actual price is $250, the loss is high. If your prediction is $251, the loss is nearly zero. The loss function converts "how wrong am I?" into a single number you can minimize.

**Gradient descent** is how you navigate the landscape. The gradient is the slope of the loss landscape at your current position — it tells you which direction is uphill. To minimize loss, you go downhill: you move opposite to the gradient. The **learning rate** is how big each step is. Too large and you bounce around without settling; too small and you take forever.

**Backpropagation** is the efficient algorithm for computing the gradient across all the weights in a deep neural network. It's calculus applied cleverly: you compute the gradient of the output with respect to every weight by working backwards through the network, reusing intermediate calculations. Without backpropagation, computing gradients for a network with millions of weights would be impossibly slow.

Here's the intuition for one training step: make a prediction → measure how wrong it was (forward pass) → trace back through the network to find which weights contributed most to the error → nudge those weights slightly in the direction that reduces the error (backward pass). Repeat millions of times.

The result? A model that has been navigated — through the loss landscape, step by step — toward a position where predictions are accurate.
:::

## ⚙️ Under the Hood

### Loss Functions

The choice of loss function defines what "correct" means to the optimizer.

**For classification:**

- **Binary Cross-Entropy (Log Loss)**: `-[y log(ŷ) + (1-y)log(1-ŷ)]`
  Used for binary classification. Penalizes confident wrong predictions logarithmically.

- **Categorical Cross-Entropy**: `-Σ yᵢ log(ŷᵢ)` across K classes
  Used for multiclass. Reduces to `-log(ŷ_true)` since y is one-hot.

**For regression:**

- **MSE** (L2 loss): `(y - ŷ)²/n` — penalizes large errors heavily; sensitive to outliers
- **MAE** (L1 loss): `|y - ŷ|/n` — constant gradient for large errors; robust to outliers; not differentiable at 0
- **Huber loss**: quadratic for small errors, linear for large ones — combines MSE and MAE benefits

```python
# run: python loss_functions.py
import numpy as np

def binary_crossentropy(y_true, y_pred, eps=1e-15):
    y_pred = np.clip(y_pred, eps, 1 - eps)  # avoid log(0)
    return -np.mean(y_true * np.log(y_pred) + (1 - y_true) * np.log(1 - y_pred))

def mse(y_true, y_pred):
    return np.mean((y_true - y_pred)**2)

def mae(y_true, y_pred):
    return np.mean(np.abs(y_true - y_pred))

def huber(y_true, y_pred, delta=1.0):
    diff = np.abs(y_true - y_pred)
    return np.mean(np.where(diff <= delta, 0.5 * diff**2, delta * (diff - 0.5 * delta)))

# Classification example
y_true_cls = np.array([1, 0, 1, 1, 0])
y_pred_confident_right = np.array([0.95, 0.05, 0.92, 0.88, 0.03])
y_pred_confident_wrong = np.array([0.05, 0.95, 0.08, 0.12, 0.97])

print(f"Confident correct BCE: {binary_crossentropy(y_true_cls, y_pred_confident_right):.4f}")
print(f"Confident wrong BCE:   {binary_crossentropy(y_true_cls, y_pred_confident_wrong):.4f}")
# Confident wrong predictions get VERY high loss (log(~0) → large)

# Regression example with outliers
y_true_reg = np.array([1.0, 2.0, 3.0, 4.0, 100.0])  # outlier at 100
y_pred_reg = np.array([1.1, 2.1, 3.1, 4.1, 5.0])     # missed outlier

print(f"\nWith outlier:")
print(f"MSE:   {mse(y_true_reg, y_pred_reg):.2f}")    # dominated by outlier
print(f"MAE:   {mae(y_true_reg, y_pred_reg):.2f}")    # more robust
print(f"Huber: {huber(y_true_reg, y_pred_reg, delta=5.0):.2f}")  # balance
```

### Gradient Descent

The gradient `∇L(w)` is the vector of partial derivatives of the loss with respect to every weight. Moving opposite to the gradient decreases loss.

**Weight update rule**: `w ← w - η * ∇L(w)`

Where η (eta) is the **learning rate**.

Three variants based on how many samples are used per gradient estimate:

| Variant | Data per step | Gradient noise | Memory | Typical use |
|---------|--------------|----------------|--------|------------|
| **Batch GD** | Full dataset | Very low | High | Small datasets |
| **Stochastic GD (SGD)** | 1 sample | Very high | Minimal | Online learning |
| **Mini-batch GD** | 32–512 samples | Moderate | Moderate | Standard practice |

```python
# run: python gradient_descent.py
import numpy as np

# Minimize f(x,y) = x² + y² (obvious minimum at origin)
def f(params):
    x, y = params
    return x**2 + y**2

def grad_f(params):
    x, y = params
    return np.array([2*x, 2*y])

# Gradient descent with different learning rates
for lr in [0.01, 0.1, 1.5]:  # 1.5 will diverge
    params = np.array([10.0, 8.0])
    history = [f(params)]

    for step in range(50):
        g = grad_f(params)
        params = params - lr * g
        history.append(f(params))
        if f(params) > 1e6:  # diverged
            print(f"lr={lr}: DIVERGED at step {step}")
            break
    else:
        print(f"lr={lr}: final loss={f(params):.6f} after 50 steps")
```

### Adaptive Learning Rate Optimizers

Pure SGD applies the same learning rate to every parameter. Modern optimizers adapt per-parameter:

**Adam (Adaptive Moment Estimation)** — the dominant optimizer for neural networks:
- Maintains `m` (first moment, exponentially decaying average of gradients — like momentum)
- Maintains `v` (second moment, exponentially decaying average of squared gradients)
- Update: `w -= η * m̂ / (√v̂ + ε)`
- `m̂`, `v̂` are bias-corrected versions (important in early training steps)

```python
# run: python adam_optimizer.py
import numpy as np

def adam_optimizer(grad_fn, initial_params, n_steps=200, lr=0.001, beta1=0.9, beta2=0.999, eps=1e-8):
    params = np.array(initial_params, dtype=float)
    m = np.zeros_like(params)  # first moment
    v = np.zeros_like(params)  # second moment

    history = []
    for t in range(1, n_steps + 1):
        g = grad_fn(params)
        m = beta1 * m + (1 - beta1) * g        # update biased first moment
        v = beta2 * v + (1 - beta2) * g**2     # update biased second moment
        m_hat = m / (1 - beta1**t)             # bias correction
        v_hat = v / (1 - beta2**t)             # bias correction
        params -= lr * m_hat / (np.sqrt(v_hat) + eps)
        history.append(params.copy())

    return params, history

# 2D Rosenbrock function — challenging optimization landscape
def rosenbrock(params):
    x, y = params
    return (1 - x)**2 + 100 * (y - x**2)**2

def grad_rosenbrock(params):
    x, y = params
    return np.array([
        -2*(1 - x) - 400*x*(y - x**2),
        200*(y - x**2)
    ])

final, history = adam_optimizer(grad_rosenbrock, [-1.5, 0.5], n_steps=5000, lr=0.01)
print(f"Adam final params: ({final[0]:.4f}, {final[1]:.4f})")
print(f"Expected minimum:  (1.0000, 1.0000)")
print(f"Final loss: {rosenbrock(final):.6f}")
```

**Other common optimizers:**
- **SGD + Momentum**: accumulates gradient direction, dampens oscillation
- **AdaGrad**: adapts lr per parameter based on historical gradient magnitude; lr decays over time
- **RMSProp**: like AdaGrad but uses exponential moving average (doesn't decay to zero)

### Backpropagation

Backpropagation is the application of the **chain rule** of calculus to compute gradients through a computational graph.

For a network with layers `L₁, L₂, ..., Lₙ` and loss `ℒ`:

`∂ℒ/∂W₁ = ∂ℒ/∂Lₙ * ∂Lₙ/∂Lₙ₋₁ * ... * ∂L₂/∂L₁ * ∂L₁/∂W₁`

Each term in the chain is computed during the backward pass, reusing values computed during the forward pass.

```python
# run: python backprop_manual.py
import numpy as np

# Manual backpropagation through a tiny network: 2→2→1
# No frameworks — implement everything from scratch

np.random.seed(42)
# Weights
W1 = np.random.randn(2, 2) * 0.1  # hidden layer
b1 = np.zeros(2)
W2 = np.random.randn(2, 1) * 0.1  # output layer
b2 = np.zeros(1)

def sigmoid(x):
    return 1 / (1 + np.exp(-np.clip(x, -500, 500)))

def sigmoid_deriv(x):
    s = sigmoid(x)
    return s * (1 - s)

# One forward + backward pass
X = np.array([[1.0, 0.5]])  # single sample, 2 features
y = np.array([[1.0]])        # target

# Forward pass
z1 = X @ W1 + b1      # (1, 2)
a1 = sigmoid(z1)       # (1, 2)
z2 = a1 @ W2 + b2     # (1, 1)
a2 = sigmoid(z2)       # (1, 1) — output probability
loss = -np.mean(y * np.log(a2 + 1e-15) + (1-y) * np.log(1 - a2 + 1e-15))

print(f"Forward: prediction={a2[0,0]:.4f}, loss={loss:.4f}")

# Backward pass (chain rule)
dL_da2 = -(y / (a2 + 1e-15)) + ((1-y) / (1 - a2 + 1e-15))  # dL/da2
da2_dz2 = sigmoid_deriv(z2)                                    # da2/dz2
dL_dz2 = dL_da2 * da2_dz2                                     # (1, 1)

dL_dW2 = a1.T @ dL_dz2  # (2, 1)
dL_db2 = dL_dz2.sum(axis=0)

dL_da1 = dL_dz2 @ W2.T  # (1, 2)
da1_dz1 = sigmoid_deriv(z1)
dL_dz1 = dL_da1 * da1_dz1

dL_dW1 = X.T @ dL_dz1   # (2, 2)
dL_db1 = dL_dz1.sum(axis=0)

print(f"dL/dW2:\n{dL_dW2}")
print(f"dL/dW1:\n{dL_dW1}")

# Gradient descent step
lr = 0.1
W2 -= lr * dL_dW2
W1 -= lr * dL_dW1
```

### The Vanishing Gradient Problem

In deep networks, gradients are multiplied through many layers. If each layer's sigmoid derivative is small (max 0.25), after 10 layers: `0.25^10 ≈ 0.0000001`. Gradients vanish — early layers learn nothing.

Solutions:
- **ReLU activation**: `max(0, x)` — derivative is 1 for x>0, avoiding sigmoid's saturation
- **Residual connections**: `output = F(x) + x` — gradients can flow directly through the skip connection
- **Batch Normalization**: normalizes layer inputs, keeping values in the non-saturating region
- **Careful weight initialization**: Xavier/He initialization scales weights to maintain gradient magnitude

```python
# run: python vanishing_gradient.py
import numpy as np

def sigmoid_deriv(x):
    s = 1/(1+np.exp(-x))
    return s*(1-s)

def relu_deriv(x):
    return (x > 0).astype(float)

# Gradient after N sigmoid layers (max 0.25 per layer)
n_layers = 10
x = np.array(0.0)  # activation value
grad_sigmoid = 1.0
grad_relu = 1.0

for _ in range(n_layers):
    grad_sigmoid *= sigmoid_deriv(x)  # each ≤ 0.25
    grad_relu    *= relu_deriv(1.0)   # 1.0 for positive activations

print(f"Gradient after {n_layers} sigmoid layers: {grad_sigmoid:.10f}")
print(f"Gradient after {n_layers} ReLU layers:    {grad_relu:.10f}")
# Sigmoid: near zero → early layers learn nothing
# ReLU:    stays at 1 → gradients propagate
```

### Learning Rate Scheduling

A fixed learning rate is often suboptimal. Common schedules:

```python
# run: python lr_schedule.py
import numpy as np

# Cosine annealing with warm restarts (used in LLM training)
def cosine_lr(step, total_steps, lr_max=1e-3, lr_min=1e-5):
    return lr_min + 0.5 * (lr_max - lr_min) * (1 + np.cos(np.pi * step / total_steps))

# Warmup + decay (common for transformers)
def warmup_cosine(step, warmup_steps, total_steps, lr_max=1e-3, lr_min=1e-5):
    if step < warmup_steps:
        return lr_max * step / warmup_steps  # linear warmup
    return cosine_lr(step - warmup_steps, total_steps - warmup_steps, lr_max, lr_min)

total, warmup = 10000, 500
for step in [0, 100, 500, 1000, 5000, 9999]:
    lr = warmup_cosine(step, warmup, total)
    print(f"Step {step:5d}: lr = {lr:.6f}")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Learning rate too high → divergence:** Loss is decreasing for the first 100 steps, then suddenly shoots to NaN or Inf. This is gradient explosion — the learning rate is causing parameters to overshoot the minimum in the loss landscape, amplifying with each step. Fix: gradient clipping (`torch.nn.utils.clip_grad_norm_(params, max_norm=1.0)`), lower learning rate, or warmup. Always log gradient norms during training.

**Vanishing gradients in fine-tuning:** You fine-tune a transformer with 12 layers using a uniform learning rate. After training, the bottom layers (embedding, early attention) barely changed while the top layers changed significantly. Vanishing gradients plus the frozen-bottom-layers-through-magnitude effect. Fix: use **layer-wise learning rate decay** — lower layers get 10×–100× smaller learning rates than top layers, since they encode more general representations.

**Loss not decreasing — silent bug in loss function:** Custom loss function incorrectly averages over the batch dimension. The loss looks like it's decreasing but the model never converges. Root cause: mean was taken over the wrong axis. Always verify your loss function output on a single known example with expected values calculated by hand before running training.

**Wrong loss function for imbalanced classes:** Categorical cross-entropy on a 100:1 imbalanced dataset — the model learns to predict the majority class 99.9% of the time. Loss decreases but the model is useless. Fix: class-weighted loss (`weight=n_samples / (n_classes * np.bincount(y))` in sklearn; `pos_weight` in PyTorch's BCEWithLogitsLoss), or focal loss which down-weights easy negatives.
:::

## 🎯 Checkpoint

::: details Question 1 — Why Adam over SGD?
**Q:** Explain why Adam typically converges faster than vanilla SGD and what its two moments represent mechanically.

**A:** Vanilla SGD applies the same learning rate to every parameter at every step. In high-dimensional neural networks, some parameters are in a flat region (need large steps) while others are in a steep region (need small steps). Adam maintains per-parameter learning rates that adapt based on gradient history. The **first moment** (m) is an exponentially decaying average of gradients — it acts like momentum, accumulating direction in parameter space. This dampens oscillation in directions where gradients flip sign (common in saddle regions). The **second moment** (v) is an exponentially decaying average of squared gradients — it tracks per-parameter gradient magnitude. Dividing the update by √v effectively normalizes the update per parameter: parameters that have historically large gradients (steep regions) get small steps; parameters with small gradients (flat regions) get larger steps. The combination means Adam converges faster in practice, especially early in training where parameter scales vary widely.
:::

::: details Question 2 — Backpropagation chain rule
**Q:** You have a network: input x → linear layer → ReLU → linear layer → sigmoid → loss. Derive the gradient of the loss with respect to the first linear layer's weights.

**A:** Let: z₁ = W₁x + b₁ (first linear), a₁ = ReLU(z₁), z₂ = W₂a₁ + b₂ (second linear), ŷ = σ(z₂) (sigmoid), L = BCE(y, ŷ). Chain rule backwards: (1) dL/dz₂ = ŷ - y (BCE + sigmoid gradient simplifies to this). (2) dL/da₁ = dL/dz₂ · W₂ᵀ. (3) dL/dz₁ = dL/da₁ ⊙ 1[z₁>0] (ReLU derivative: 1 where input was positive, 0 elsewhere — element-wise). (4) dL/dW₁ = xᵀ · dL/dz₁ (outer product for batch: Xᵀ @ dL/dz₁). This is exactly what backprop computes, reusing forward-pass activations (a₁, z₁, z₂) to avoid recomputation.
:::

## Key Mental Models

- **Loss function = definition of what "wrong" means** — choose it based on your cost structure, not convenience.
- **Gradient descent follows the downhill direction in loss landscape** — learning rate controls step size; too large diverges, too small wastes compute.
- **Backpropagation = chain rule applied efficiently backwards** — the gradients flow from loss to input, each layer contributing its Jacobian.
- **ReLU solved vanishing gradients** — derivative is 1 for positive activations, not the ≤0.25 of sigmoid.
- **Adam adapts per-parameter learning rates** — use it as the default; tune only if you have specific reasons to use SGD.

## Related

- [6.5 Linear Algebra for AI](./05-linear-algebra-for-ai) — the matrix operations that implement forward and backward pass
- [Module 7.1 Neural Networks](../module-07/01-neural-networks) — how these optimization concepts apply in practice
- [Module 4 Fine-Tuning](/ai-engineering/module-04/) — fine-tuning uses these same optimization principles on pre-trained models
