---
title: Linear Algebra for AI
outline: deep
---

# Linear Algebra for AI

🔥🔥🔥 Interview weight | Prerequisites: [1.4 Statistics for AI](./04-statistics-for-ai)

## 🗣️ In Plain English

::: tip In Plain English
Every piece of text, every image, every user behavior in an AI system gets converted into a list of numbers before the model can work with it. That list of numbers is a **vector**. Vectors live in space, and the relationships between them are what AI systems learn.

Think of a movie recommendation system. Every movie is represented as a point in space: "The Dark Knight" might be at coordinates (0.9, 0.1, 0.8) meaning (action=0.9, comedy=0.1, drama=0.8). "The Grand Budapest Hotel" might be at (0.1, 0.8, 0.7). When you watch a movie, your taste profile moves closer to that movie's location in space.

The **dot product** of two vectors is a single number that measures "how much they point in the same direction." If two movies point in the same direction in taste-space, they're similar. The dot product is what's happening inside every attention calculation in a transformer, every similarity search in a vector database, every neural network layer.

**Cosine similarity** normalizes the dot product so it doesn't care about magnitude — only direction. If one document is twice as long as another but covers the same topics, cosine similarity says they're equally related. This is why embedding search uses cosine similarity rather than raw dot product.

**Matrix multiplication** is how neural network layers transform data. When a text representation enters a neural network layer, the layer multiplies it by a matrix of learned weights. Each row of that matrix represents a "what am I looking for?" question. The result is a new representation where each number answers one of those questions. Stack 96 such layers and you get GPT-4.

**Eigenvalues** tell you about the "natural axes" of a dataset — the directions where data spreads out the most. This is what PCA uses to compress data without losing important structure.

You don't need to derive these from scratch. But you need to understand what they mean, because every time you look at an embedding, adjust a model, or debug a similarity search, you're looking at linear algebra.
:::

## ⚙️ Under the Hood

### Vectors

A vector is an ordered list of real numbers: `v = [v₁, v₂, ..., vₙ]`. In AI:
- An embedding is a 768- or 1536-dimensional vector
- A row of training data is a feature vector
- A one-hot encoding is a binary vector with exactly one 1

Operations:
- **Addition**: `u + v = [u₁+v₁, u₂+v₂, ...]` — pointwise
- **Scalar multiplication**: `αv = [αv₁, αv₂, ...]` — scales magnitude, preserves direction
- **L2 norm (magnitude)**: `||v|| = √(v₁² + v₂² + ... + vₙ²)`

```python
# run: python vectors_demo.py
import numpy as np

# Simulated embeddings
doc1 = np.array([0.8, 0.1, 0.3, 0.7])   # "machine learning article"
doc2 = np.array([0.7, 0.2, 0.2, 0.8])   # "deep learning tutorial"
query = np.array([0.9, 0.0, 0.1, 0.9])  # "AI training concepts"

# L2 norms
print(f"||doc1|| = {np.linalg.norm(doc1):.4f}")
print(f"||query|| = {np.linalg.norm(query):.4f}")

# Vector arithmetic: midpoint between two concepts
midpoint = (doc1 + doc2) / 2
print(f"Midpoint: {midpoint}")
```

### Dot Product

`u · v = u₁v₁ + u₂v₂ + ... + uₙvₙ = ||u|| ||v|| cos(θ)`

Where `θ` is the angle between the vectors. This identity is the bridge between algebra and geometry.

- If `u · v > 0`: vectors point in similar directions (angle < 90°)
- If `u · v = 0`: orthogonal (angle = 90°) — unrelated in this space
- If `u · v < 0`: opposite directions (angle > 90°)

```python
# run: python dot_product_demo.py
import numpy as np

a = np.array([1.0, 0.0, 0.5])
b = np.array([0.8, 0.1, 0.6])
c = np.array([-1.0, 0.0, -0.5])  # opposite of a

dot_ab = np.dot(a, b)  # also: a @ b
dot_ac = np.dot(a, c)

print(f"a · b = {dot_ab:.3f}")  # positive: similar direction
print(f"a · c = {dot_ac:.3f}")  # negative: opposite

# This is what attention does:
# Query Q, Key K → attention_score = Q · K / sqrt(d)
# Large score → high attention weight
d = 3
attention_score = dot_ab / np.sqrt(d)
print(f"Scaled attention score (Q·K/√d): {attention_score:.3f}")
```

### Cosine Similarity

`cosine_sim(u, v) = (u · v) / (||u|| · ||v||)`

Normalizes the dot product to [-1, 1]. Measures directional similarity independent of magnitude.

```python
# run: python cosine_sim_demo.py
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

# Embeddings: each row is a document
docs = np.array([
    [0.9, 0.1, 0.8, 0.2],  # "Python machine learning"
    [0.8, 0.2, 0.7, 0.3],  # "ML with Python"  -- similar
    [0.1, 0.9, 0.2, 0.8],  # "JavaScript web development"  -- different
    [1.8, 0.2, 1.6, 0.4],  # "Python ML" (doubled magnitude)
])

# Note: doc0 and doc3 have the same DIRECTION but different magnitudes
# Cosine sim should treat them as identical; dot product would not
sim_matrix = cosine_similarity(docs)
print("Cosine similarity matrix:")
print(sim_matrix.round(3))
# doc0 vs doc3 should be ~1.0 (same direction, different length)
# doc0 vs doc2 should be low (different topics)

# Manual computation
def cosine(u, v):
    return np.dot(u, v) / (np.linalg.norm(u) * np.linalg.norm(v))

print(f"\nManual doc0 vs doc1: {cosine(docs[0], docs[1]):.4f}")
print(f"Manual doc0 vs doc3 (doubled): {cosine(docs[0], docs[3]):.4f}")  # ~1.0
```

### Matrix Multiplication

Matrix `A` (m×n) times matrix `B` (n×p) = `C` (m×p).

`C[i,j] = A[i,:] · B[:,j]` — each output cell is the dot product of a row of A with a column of B.

In neural networks: the input is a batch of vectors `X` (batch_size × input_dim), the weight matrix is `W` (input_dim × output_dim), and `XW` (batch_size × output_dim) is the transformed representation.

```python
# run: python matmul_demo.py
import numpy as np

# Simulate a single linear layer: input_dim=4, output_dim=3
batch_size = 2
input_dim = 4
output_dim = 3

X = np.random.randn(batch_size, input_dim)  # input batch
W = np.random.randn(input_dim, output_dim)  # weight matrix (learned)
b = np.random.randn(output_dim)              # bias vector (learned)

# Forward pass through one linear layer
output = X @ W + b  # (2, 4) @ (4, 3) + (3,) = (2, 3)
print(f"Input shape:  {X.shape}")
print(f"Weight shape: {W.shape}")
print(f"Output shape: {output.shape}")

# With activation (ReLU): max(0, x) — zero-out negatives
output_activated = np.maximum(0, output)
print(f"After ReLU:   {output_activated}")

# This is the building block of every transformer layer:
# Q = X @ W_Q  (query projection)
# K = X @ W_K  (key projection)
# V = X @ W_V  (value projection)
# Attention = softmax(Q @ K.T / sqrt(d_k)) @ V
```

### Attention as Linear Algebra

The transformer's self-attention, stripped to its essence:

```python
# run: python attention_linalg.py
import numpy as np

def softmax(x):
    x = x - x.max(axis=-1, keepdims=True)  # numerical stability
    e = np.exp(x)
    return e / e.sum(axis=-1, keepdims=True)

# Single-head self-attention on 5 tokens, embedding dim=4
seq_len = 5
d_model = 4
d_k = 4  # key/query dimension

np.random.seed(42)
X = np.random.randn(seq_len, d_model)  # token embeddings

# Learned projections (random for demo)
W_Q = np.random.randn(d_model, d_k)
W_K = np.random.randn(d_model, d_k)
W_V = np.random.randn(d_model, d_k)

Q = X @ W_Q  # (5, 4)
K = X @ W_K  # (5, 4)
V = X @ W_V  # (5, 4)

# Attention scores: each token queries every other token
scores = Q @ K.T / np.sqrt(d_k)  # (5, 5)
weights = softmax(scores)          # (5, 5): each row sums to 1

# Weighted sum of values
output = weights @ V  # (5, 4): each token gets a weighted blend of all values

print(f"Attention weights (token 0 attends to all others):")
print(weights[0].round(3))
print(f"Output shape: {output.shape}")
```

### Eigenvalues and PCA Connection

The covariance matrix `C = (1/n) * X.T @ X` captures how features co-vary. Its **eigenvectors** are the principal components — directions of maximum variance. **Eigenvalues** quantify how much variance each direction explains.

```python
# run: python eigen_pca.py
import numpy as np

np.random.seed(42)
# Correlated 2D data
X = np.random.randn(200, 2)
X[:, 1] = 0.8 * X[:, 0] + 0.2 * np.random.randn(200)  # strong correlation

# Covariance matrix
C = np.cov(X.T)
print(f"Covariance matrix:\n{C.round(3)}")

# Eigendecomposition
eigenvalues, eigenvectors = np.linalg.eig(C)
idx = eigenvalues.argsort()[::-1]  # sort descending
eigenvalues = eigenvalues[idx]
eigenvectors = eigenvectors[:, idx]

print(f"\nEigenvalues: {eigenvalues.round(3)}")
# Larger eigenvalue = more variance explained
print(f"Explained variance ratio: {(eigenvalues / eigenvalues.sum()).round(3)}")
# First component captures ~89% of variance

# Project data onto first principal component
X_reduced = X @ eigenvectors[:, :1]
print(f"Reduced shape: {X_reduced.shape}")
```

### Broadcasting in NumPy — Why It Matters

Neural network code heavily uses broadcasting — operating on tensors with different shapes. Understanding shapes prevents bugs:

```python
# run: python broadcasting_demo.py
import numpy as np

# Normalize a batch of embeddings to unit vectors
batch = np.random.randn(32, 768)  # 32 embeddings, 768-dim each
norms = np.linalg.norm(batch, axis=1, keepdims=True)  # (32, 1)
normalized = batch / norms  # (32, 768) / (32, 1) → broadcasts correctly

# Verify unit norm
print(f"Norms after normalization: min={norms.min():.4f}, max={norms.max():.4f}")
norms_after = np.linalg.norm(normalized, axis=1)
print(f"All norms == 1: {np.allclose(norms_after, 1.0)}")

# Common bug: wrong axis for norm
bad_norms = np.linalg.norm(batch, axis=0)  # (768,) — norms over batch, not embedding
# batch / bad_norms would broadcast incorrectly: (32, 768) / (768,) is valid in numpy
# but semantically wrong: dividing each feature by its across-batch norm
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Cosine similarity vs dot product in vector search:** A team builds a vector search system using raw dot product similarity. Documents that appear more than once (duplicated content) have higher norm and consistently rank higher than unique documents, regardless of semantic relevance. Fix: normalize embeddings to unit vectors before indexing. After L2 normalization, cosine similarity = dot product, and magnitude no longer biases results. Alternatively, use indexes that normalize internally (pgvector with `<=>` operator, Pinecone with cosine metric).

**Shape mismatch silently broadcasts wrong:** A NumPy broadcast between `(batch, seq, d)` and `(batch, d)` raises no error but produces an incorrect tensor — the shape rule allows it but semantically it's wrong. Always add `assert tensor.shape == expected_shape` in critical paths of custom attention or model code.

**Attention scaling omitted:** Implementing self-attention without dividing by `√d_k` causes the dot products to grow in magnitude as d increases. The softmax then has very large inputs, producing near-one-hot distributions (one token gets almost all attention). The model stops learning because gradients through softmax vanish. Always scale: `Q @ K.T / sqrt(d_k)`.

**PCA losing important minority dimensions:** You reduce embeddings from 1536 to 64 dimensions for cost. The 64 components capture 95% of variance. But the remaining 5% encoded rare-but-important distinctions in a niche product category that makes up 2% of queries. Retrieval quality drops 40% for those queries. Always evaluate retrieval metrics segment-by-segment after dimensionality reduction.
:::

## 🎯 Checkpoint

::: details Question 1 — Attention mechanism as matrix operations
**Q:** Describe the full computation of single-head self-attention using only matrix multiplication notation. What does each matrix multiplication represent semantically?

**A:** Given input matrix X ∈ ℝ^(seq_len × d_model): (1) Q = X @ W_Q — projects each token into a "query" (what am I looking for?). (2) K = X @ W_K — projects each token into a "key" (what do I contain?). (3) V = X @ W_V — projects each token into a "value" (what information do I provide if attended to?). (4) scores = Q @ K.T / √d_k — each token's query is compared to every token's key; the √d_k scaling prevents magnitude explosion. (5) weights = softmax(scores) — converts raw scores to a probability distribution over tokens. (6) output = weights @ V — each token's output is a weighted average of all values, weighted by attention. The output is a new representation where each token has "seen" (attended to) all other tokens, weighted by relevance.
:::

::: details Question 2 — Why cosine similarity over Euclidean distance for embeddings
**Q:** Vector databases offer cosine similarity and Euclidean (L2) distance. When should you use each, and why do most embedding models default to cosine similarity?

**A:** **Cosine similarity** measures the angle between vectors — purely directional. It is invariant to vector magnitude (scaling). Embedding models are trained with loss functions that optimize directional similarity (e.g., contrastive learning where similar texts should point in the same direction). Two semantically identical documents of different lengths produce embeddings with different magnitudes but similar directions. Cosine correctly identifies them as similar. **L2 distance** measures absolute distance in the embedding space. Sensitive to magnitude. Useful when magnitude carries meaning (e.g., word frequency TF-IDF vectors where term frequency matters). For most transformer-based embeddings: cosine similarity or dot product after L2 normalization. Note: after normalization, cosine_sim = (dot product), so normalized HNSW indexes can use dot product internally (faster SIMD operations) while achieving cosine semantics.
:::

## Key Mental Models

- **Every embedding is a vector — similar semantics = similar direction** — cosine similarity measures this direction.
- **Matrix multiplication is the core operation of every neural network layer** — understand `(batch, in) @ (in, out) = (batch, out)`.
- **Attention = each token querying all other tokens, weighted by relevance** — Q·K.T is the compatibility matrix; @V is the weighted aggregation.
- **Always check tensor shapes** — silent broadcasting bugs cause incorrect outputs without errors.
- **Divide by √d in attention** — without it, softmax saturates and gradients vanish.

## Related

- [1.7 Optimization](./07-optimization) — gradient descent uses these same matrix operations
- [Module 0.1 How Transformers Work](/ai-engineering/module-00/01-how-transformers-work) — attention mechanism in full transformer context
- [RAG Module 7 — Embeddings](/rag/module-07/01-embeddings-similarity) — cosine similarity in production retrieval
