---
title: Train / Validation / Test Splits
outline: deep
---

# Train / Validation / Test Splits

🔥🔥🔥 Interview weight | Prerequisites: [1.1 Supervised vs Unsupervised](./01-supervised-vs-unsupervised)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you're studying for a certification exam. You have three resources: a textbook, practice tests, and the real exam.

You read the textbook to learn the material. That's your **training set** — the data you actually learn from.

You take practice tests to see how you're doing. If you score badly, you go back to the textbook, study more, adjust your approach. You might take the practice test dozens of times as you improve. But here's the risk: eventually you start memorizing the practice test questions, not the material. You're not learning anymore — you're pattern-matching the test itself. This is **overfitting to the validation set**.

The real exam — the one you can only take once — is your **test set**. If you'd been cramming the practice test questions, you'll bomb the real exam despite perfect practice scores.

The three-split rule exists because of this dynamic. The training set teaches. The validation set guides improvement without corrupting learning. The test set gives you a single honest measurement of true performance.

**Overfitting** means the model has memorized training examples rather than learning generalizable patterns. A student who memorizes "Q: What year did WWII end? A: 1945" but can't answer "When did the Second World War conclude?" has overfit — they learned the form, not the concept.

**Underfitting** is the opposite: the model is too simple to capture the real patterns. A student who just writes "42" for every answer is underfitting.

The **bias/variance tradeoff**: a model that's too simple has high bias (systematic error, consistently wrong in the same direction). A model that's too complex has high variance (highly sensitive to which specific training examples it saw, so it varies wildly). The goal is the sweet spot where bias and variance are both acceptably low.
:::

## ⚙️ Under the Hood

### The Three Splits and Their Roles

| Split | Purpose | Touch it? | Typical size |
|-------|---------|-----------|-------------|
| **Training** | Model learns weights from this | Yes, repeatedly | 60–80% |
| **Validation** | Tune hyperparameters; choose model | Read-only during tuning | 10–20% |
| **Test** | Final evaluation; one shot | Once, at the end | 10–20% |

The **critical invariant**: the test set must never influence any decision made during training or hyperparameter tuning. The moment you look at test performance and adjust anything, it becomes a de facto validation set and you need a new test set.

```python
# run: python splits_demo.py
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score
import numpy as np

# Simulated data: 10,000 samples, 20 features
np.random.seed(42)
X = np.random.randn(10_000, 20)
y = (X[:, 0] + X[:, 1] > 0).astype(int)  # Simple true boundary

# Split: 70% train, 15% val, 15% test
X_train, X_temp, y_train, y_temp = train_test_split(X, y, test_size=0.30, random_state=42)
X_val, X_test, y_val, y_test = train_test_split(X_temp, y_temp, test_size=0.50, random_state=42)

print(f"Train: {len(X_train)}, Val: {len(X_val)}, Test: {len(X_test)}")

# Hyperparameter tuning on validation set
best_c, best_val_acc = None, 0
for C in [0.01, 0.1, 1.0, 10.0, 100.0]:
    model = LogisticRegression(C=C, max_iter=500)
    model.fit(X_train, y_train)
    val_acc = accuracy_score(y_val, model.predict(X_val))
    print(f"C={C:6.2f}: val accuracy = {val_acc:.4f}")
    if val_acc > best_val_acc:
        best_val_acc = val_acc
        best_c = C

# Final evaluation: train on train+val with best C, then test
X_trainval = np.vstack([X_train, X_val])
y_trainval = np.concatenate([y_train, y_val])
final_model = LogisticRegression(C=best_c, max_iter=500)
final_model.fit(X_trainval, y_trainval)

test_acc = accuracy_score(y_test, final_model.predict(X_test))
print(f"\nBest C={best_c}, final test accuracy: {test_acc:.4f}")
```

### Overfitting vs Underfitting — Mechanistic View

**Overfitting** occurs when the model's hypothesis class is too expressive relative to the amount of training data. The model memorizes training noise rather than signal:
- Training loss → 0, validation loss → rising
- The validation curve diverges from the training curve

**Underfitting** occurs when the model is too simple to represent the true mapping:
- Training loss stays high
- Both train and validation curves are similarly high (parallel, not diverging)

```python
# run: python overfit_demo.py
from sklearn.preprocessing import PolynomialFeatures
from sklearn.linear_model import LinearRegression
from sklearn.pipeline import Pipeline
from sklearn.metrics import mean_squared_error
import numpy as np

np.random.seed(42)
# True signal: y = x² + noise
X = np.sort(np.random.uniform(-3, 3, 50)).reshape(-1, 1)
y = X.ravel()**2 + np.random.normal(0, 0.5, 50)
X_train, X_test = X[:40], X[40:]
y_train, y_test = y[:40], y[40:]

for degree in [1, 2, 10]:
    pipe = Pipeline([
        ('poly', PolynomialFeatures(degree=degree)),
        ('lr', LinearRegression()),
    ])
    pipe.fit(X_train, y_train)
    train_mse = mean_squared_error(y_train, pipe.predict(X_train))
    test_mse  = mean_squared_error(y_test, pipe.predict(X_test))
    print(f"degree={degree:2d}: train_mse={train_mse:.3f}, test_mse={test_mse:.3f}")

# degree=1:  underfit  (too simple: linear can't fit quadratic)
# degree=2:  good fit  (matches true signal)
# degree=10: overfit   (near-zero train loss, high test loss)
```

### Bias-Variance Tradeoff

Total expected prediction error = Bias² + Variance + Irreducible noise

- **Bias**: error from wrong assumptions (e.g., fitting a line to quadratic data). Systematic, directional.
- **Variance**: error from sensitivity to specific training samples (e.g., high-degree polynomial wiggles through noise). High variance → inconsistent predictions when retraining on different data subsets.
- **Irreducible noise**: the signal that even a perfect model cannot explain (measurement error, inherent randomness).

Increasing model complexity: bias ↓, variance ↑. The sweet spot (minimum total error) defines the optimal model complexity.

### Cross-Validation

When data is scarce, a single val split wastes data. **K-fold cross-validation** uses all data for both training and validation:

1. Split data into K equal folds
2. For each fold k: train on all other folds, evaluate on fold k
3. Average the K validation scores; use std deviation to assess stability

```python
# run: python cross_val_demo.py
from sklearn.model_selection import cross_val_score, KFold
from sklearn.ensemble import RandomForestClassifier
from sklearn.datasets import load_breast_cancer
import numpy as np

X, y = load_breast_cancer(return_X_y=True)

cv = KFold(n_splits=5, shuffle=True, random_state=42)
model = RandomForestClassifier(n_estimators=100, random_state=42)

scores = cross_val_score(model, X, y, cv=cv, scoring='accuracy')
print(f"CV scores: {scores}")
print(f"Mean ± std: {scores.mean():.4f} ± {scores.std():.4f}")
# High std → model is sensitive to which data it trains on (high variance)
```

**Stratified K-fold**: ensures each fold has the same class ratio as the full dataset. Essential for imbalanced classification (e.g., fraud: 0.1% positive rate).

**Time-series splits**: when data is temporal, you cannot shuffle. Use `TimeSeriesSplit`: train on past, validate on future.

```python
# run: python time_split.py
from sklearn.model_selection import TimeSeriesSplit
import numpy as np

# Simulate 1000 days of data
X = np.arange(1000).reshape(-1, 1)
y = np.random.randn(1000)

tscv = TimeSeriesSplit(n_splits=5)
for fold, (train_idx, val_idx) in enumerate(tscv.split(X)):
    print(f"Fold {fold+1}: train days {train_idx[0]}-{train_idx[-1]}, "
          f"val days {val_idx[0]}-{val_idx[-1]}")
# Fold 1: train 0-166, val 167-333
# Fold 5: train 0-833, val 834-999
```

### Regularization as the Structural Solution to Overfitting

Rather than reducing model capacity, regularization adds a penalty to large weights:

- **L2 (Ridge)**: adds `λ * ||w||²` to loss → weights shrink toward zero smoothly
- **L1 (Lasso)**: adds `λ * ||w||₁` → sparse weights; some exactly zero (feature selection)
- **Dropout** (neural networks): randomly zero out neurons during training → each neuron cannot rely on other specific neurons → forces redundant representations

The regularization coefficient `λ` (or `C = 1/λ` in sklearn) is a **hyperparameter tuned on the validation set**.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Test set contamination:** A team builds a model, checks test performance, makes changes, and re-evaluates on test. After many rounds, the test score becomes optimistic — the team has implicitly selected the best run on test noise. The model underperforms in production by 5–10%. Root cause: test set used as a second validation set. Fix: establish a strict protocol where test evaluation is run once, by a separate person or automated pipeline, after all development is frozen.

**Data leakage through preprocessing:** Normalization (fitting `mean`, `std`) is computed on the full dataset including test, then applied to train. The test set's statistics leak into training. In production, the live data distribution differs from training statistics. Fix: use sklearn `Pipeline` — `StandardScaler.fit()` only on training data, then `.transform()` on val/test.

**Temporal ordering violation:** An e-commerce model predicts churn but is trained on randomly shuffled historical records. Users from 2024 inform the model about users from 2023. In production, this future information doesn't exist. Test set temporal contamination. Fix: always split by time — train on earlier data, test on later.

**Overfitting to a custom validation metric:** You tune exclusively for F1 on the validation set. The model learns to hit the exact F1 sweet spot for that threshold but performs poorly at other operating points. In production, the operating threshold shifts due to class ratio changes. Fix: evaluate the full ROC-AUC curve and calibrate probabilities separately from threshold selection.
:::

## 🎯 Checkpoint

::: details Question 1 — Why three splits?
**Q:** Why is a two-split (train/test) approach insufficient when tuning hyperparameters?

**A:** When you tune hyperparameters by evaluating on the test set, you are effectively searching for hyperparameters that perform well on that specific test sample — not hyperparameters that generalize to the true underlying distribution. The test set becomes an information source that influences your decisions. By the time you're done tuning, you've implicitly overfit to the test set's random characteristics. The reported test score is then an optimistic estimate of true generalization. The validation set absorbs this "peeking" — you're allowed to overfit to it slightly — while the test set remains unseen until the final measurement.
:::

::: details Question 2 — Bias-variance in ML interview context
**Q:** A decision tree with depth=1 has high bias. A decision tree with depth=30 has high variance. How does Random Forest reduce variance without increasing bias significantly?

**A:** Random Forest reduces variance through **ensemble averaging** and **random feature subsampling**. Variance of an average of n independent, identically distributed random variables = σ²/n. Individual deep trees have high variance (overfit to different random training subsets). By training many such trees on **bootstrap samples** (random sampling with replacement) and averaging their predictions, variance reduces by ~1/n (adjusted for correlation between trees). The correlation between trees is reduced by the random feature subsampling (each split considers only a random subset of features) — this decorrelates the trees. The bias of each individual tree is roughly preserved (deep trees are expressive enough to learn the signal). Net effect: variance ↓↓, bias unchanged or ↑ slightly, total error ↓.
:::

::: details Question 3 — Detecting overfitting
**Q:** You're monitoring a model being trained. What specific signals tell you the model is overfitting?

**A:** The canonical signal: **training loss continues to decrease while validation loss stops decreasing or increases** — the two curves diverge. Secondary signals: (1) the gap between train accuracy and val accuracy grows over epochs; (2) the model is highly sensitive to which training samples are included — cross-val std dev is large; (3) learned weights have very large magnitudes (high-norm weights fit noise precisely); (4) performance is high on training data but low on a fresh manually-curated "clean" test set. In deep learning, overfitting is often detected via the **generalization gap**: `gen_gap = train_loss - val_loss`; early stopping monitors this gap and stops training before it widens excessively.
:::

## Key Mental Models

- **The test set is a one-shot measurement** — the moment you read it and make decisions, it's a validation set. Treat test evaluation as a ceremony, not a workflow step.
- **Validation loss diverging from training loss = overfitting signal** — the visual diagnostic every engineer should recognize.
- **Cross-validation trades compute for data efficiency** — K-fold uses every sample for evaluation, paying K× training cost.
- **Regularization shrinks weights; data augmentation grows training set** — both fight overfitting from opposite directions.
- **Time-series data must be split by time** — shuffling creates temporal leakage that inflates reported performance.

## Related

- [1.6 ML Metrics](./06-ml-metrics) — what to measure on val and test sets
- [1.7 Optimization](./07-optimization) — training loop where overfitting occurs
- [Module 9 LLMOps & Evaluation](/ai-engineering/module-09/) — validation and test split concepts applied to LLM evaluation
