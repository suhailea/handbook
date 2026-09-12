---
title: Statistics for AI
outline: deep
---

# Statistics for AI

🔥🔥 Interview weight | Prerequisites: basic algebra

## 🗣️ In Plain English

::: tip In Plain English
Statistics is the science of making decisions under uncertainty. Every number a machine learning model outputs is drenched in uncertainty — and statistics gives you the vocabulary to reason about it honestly.

Imagine you're running a customer support system and you want to know: "How long does a typical ticket take to resolve?" You pull a sample of 1,000 tickets.

The **mean** (average) says 4.2 hours. But a few very complex tickets took 72 hours and are dragging the average up. The **median** (the middle value when sorted) says 2.1 hours — that's what most customers actually experience. The **mode** (most common value) is 1 hour — that's the peak of your distribution.

The **standard deviation** tells you how spread out the times are. A std dev of 0.5 hours means most tickets cluster tightly around the mean. A std dev of 12 hours means wildly variable times — the average is almost meaningless.

**Correlation** tells you whether two things move together. If "ticket complexity score" and "resolution time" are highly correlated, knowing complexity helps you predict time. But correlation doesn't tell you which one *causes* the other — maybe both are caused by a third factor (time of day, team size).

**Bayes' theorem** is how you update beliefs with evidence. If a customer emails angrily about a charge, what's the probability it's actually a billing issue vs. them just being upset? Bayes says: start with your prior belief (90% of angry-charge emails are billing issues), update it with the new evidence (the email mentions a specific transaction ID), and get a posterior probability. This is how spam filters work, how AI classification systems work internally, and how you should reason when debugging production systems.

The **normal distribution** (bell curve) appears everywhere in nature and in statistics because of a mathematical result called the Central Limit Theorem: averages of many independent random things tend to be normally distributed, regardless of the shape of the individual things. This is why you can use z-scores to tell how unusual something is.
:::

## ⚙️ Under the Hood

### Measures of Central Tendency

```python
# run: python statistics_demo.py
import numpy as np
from scipy import stats

# Simulated ticket resolution times (hours) — right-skewed distribution
np.random.seed(42)
times = np.concatenate([
    np.random.exponential(2, 800),  # most tickets: fast
    np.random.uniform(20, 72, 200), # some complex tickets: slow
])

print(f"Mean:   {np.mean(times):.2f} hours")    # Pulled up by outliers
print(f"Median: {np.median(times):.2f} hours")  # Robust to outliers
print(f"Mode:   {stats.mode(times.round(1))[0]:.1f} hours")  # Most frequent

# For reporting SLAs to customers: use median (or percentiles)
print(f"p50:    {np.percentile(times, 50):.2f} hours")
print(f"p90:    {np.percentile(times, 90):.2f} hours")
print(f"p99:    {np.percentile(times, 99):.2f} hours")
```

**When to use which:**
- **Mean**: when the distribution is symmetric and you need arithmetic operations downstream
- **Median**: whenever outliers exist or distribution is skewed (income, latency, token counts)
- **Mode**: categorical data; or finding the peak of a unimodal distribution

### Variance and Standard Deviation

**Variance**: `σ² = Σ(xᵢ - μ)² / n` — average squared deviation from the mean.

**Standard deviation**: `σ = √(σ²)` — in the same units as the data.

**Coefficient of Variation (CV)**: `σ/μ` — relative spread, useful when comparing distributions with different means.

```python
# run: python variance_demo.py
import numpy as np

times = np.array([1, 2, 2, 3, 3, 3, 4, 5, 20, 80])  # outlier at 80

population_var = np.var(times)           # divides by n
sample_var = np.var(times, ddof=1)       # divides by n-1 (Bessel's correction, unbiased)
std = np.std(times, ddof=1)

print(f"Mean:        {np.mean(times):.1f}")
print(f"Sample var:  {sample_var:.1f}")
print(f"Std dev:     {std:.1f}")
print(f"CV:          {std / np.mean(times):.2f}")  # 80%+: very high relative spread

# Practical: 68-95-99.7 rule for normal distributions
# 68% of data within ±1σ, 95% within ±2σ, 99.7% within ±3σ
```

**Why Bessel's correction (n-1)?** When estimating population variance from a sample, the sample mean is itself estimated from the data, which biases variance downward. Dividing by n-1 corrects this (produces an unbiased estimator).

### Correlation and Covariance

**Covariance**: `Cov(X,Y) = Σ(xᵢ-μₓ)(yᵢ-μᵧ) / n` — direction of linear relationship (positive/negative/zero).

**Pearson Correlation**: `r = Cov(X,Y) / (σₓ σᵧ)` — normalized to [-1, 1]. Scale-invariant.

```python
# run: python correlation_demo.py
import numpy as np
from scipy import stats

np.random.seed(42)
n = 1000

# Feature: ticket complexity score (1-10)
complexity = np.random.uniform(1, 10, n)

# Resolution time: correlated with complexity + noise
resolution_time = 0.8 * complexity + np.random.randn(n) * 2

# Also generate an unrelated feature
random_feature = np.random.randn(n)

r_complexity, p_complexity = stats.pearsonr(complexity, resolution_time)
r_random, p_random = stats.pearsonr(random_feature, resolution_time)

print(f"Complexity vs time: r={r_complexity:.3f}, p={p_complexity:.4f}")
print(f"Random vs time:     r={r_random:.3f}, p={p_random:.4f}")

# Correlation matrix for feature selection
import pandas as pd
df = pd.DataFrame({'complexity': complexity, 'time': resolution_time, 'noise': random_feature})
print("\nCorrelation matrix:")
print(df.corr().round(3))
```

**Pitfalls:**
- Pearson measures only **linear** relationships. Use Spearman rank correlation for monotonic non-linear.
- **Spurious correlation**: two variables correlated because both depend on a third (confounding variable).
- High correlation between features → multicollinearity → inflates coefficient variance in linear models.

### Probability and Bayes' Theorem

**Conditional probability**: `P(A|B) = P(A ∩ B) / P(B)` — probability of A given B is true.

**Bayes' Theorem**: `P(A|B) = P(B|A) · P(A) / P(B)`

In ML context:
- `P(A)` = prior probability (before seeing data)
- `P(B|A)` = likelihood (how likely is the evidence given hypothesis A)
- `P(A|B)` = posterior probability (updated belief after seeing evidence B)

```python
# run: python bayes_demo.py
# Naive Bayes classifier: applies Bayes theorem feature-by-feature
from sklearn.naive_bayes import MultinomialNB
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report

# Simplified ticket classification
texts = [
    "charge invoice payment billing",
    "refund overcharged account bill",
    "server error 500 api down",
    "cannot connect timeout error",
    "feature request dark mode",
    "please add export function",
] * 100  # inflate for demo

labels = (["billing"] * 2 + ["technical"] * 2 + ["feature"] * 2) * 100

X_train, X_test, y_train, y_test = train_test_split(texts, labels, test_size=0.2)

vectorizer = CountVectorizer()
X_train_vec = vectorizer.fit_transform(X_train)
X_test_vec = vectorizer.transform(X_test)

nb = MultinomialNB()
nb.fit(X_train_vec, y_train)
print(classification_report(y_test, nb.predict(X_test_vec)))

# Naive Bayes assumes P(word|class) are independent — "naive"
# P(class|words) ∝ P(class) * Π P(word_i|class)
```

### Normal Distribution and the Central Limit Theorem

The normal distribution N(μ, σ²) is defined by its PDF: `f(x) = (1/(σ√(2π))) * exp(-(x-μ)²/(2σ²))`

**Central Limit Theorem (CLT)**: For any distribution with finite mean μ and variance σ², the distribution of **sample means** converges to N(μ, σ²/n) as n → ∞.

This is why: model prediction errors, noise in gradients, measurement errors tend to be approximately normal — they're sums or averages of many independent small effects.

```python
# run: python clt_demo.py
import numpy as np
import matplotlib.pyplot as plt

np.random.seed(42)
# Start with a highly non-normal distribution (exponential)
population = np.random.exponential(scale=2, size=100_000)
print(f"Population: mean={population.mean():.2f}, skew highly positive")

# Sample means of size n=30 → should be approximately normal
sample_means = [np.mean(np.random.choice(population, size=30)) for _ in range(10_000)]
print(f"Sample means: mean={np.mean(sample_means):.2f}, std={np.std(sample_means):.3f}")
# Theoretical: std = σ/√n = 2/√30 ≈ 0.365
print(f"Theoretical std of sample mean: {population.std() / np.sqrt(30):.3f}")
```

### Z-Score and Standardization

`z = (x - μ) / σ` transforms raw values to "how many standard deviations from the mean".

Used for:
- Feature scaling (required by SVM, neural networks, distance-based algorithms)
- Outlier detection: |z| > 3 → likely outlier
- Comparing values from different scales

```python
# run: python zscore_demo.py
from scipy import stats
import numpy as np

data = np.array([2.1, 2.3, 2.0, 2.2, 2.4, 15.0])  # 15.0 is an outlier

z_scores = np.abs(stats.zscore(data))
print(f"Z-scores: {z_scores.round(2)}")
# 15.0 will have z ~ 3+

outliers = data[z_scores > 2.5]
print(f"Outliers: {outliers}")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Mean latency hides tail pain:** Your AI API reports mean response time of 1.2 seconds. Users are complaining. The p99 is 45 seconds — 1% of requests timeout. Mean is meaningless for latency SLOs. Always report percentiles (p50, p95, p99, p999) for latency and cost metrics.

**Correlation ≠ causation in feature engineering:** A team finds that "length of query" strongly correlates with "LLM cost" and adds it as a feature in a cost prediction model. The model learns to equate length with cost. When they switch to a model with different tokenization (where some languages tokenize into fewer tokens), the predictor breaks. The correlation was a proxy; the actual driver is token count.

**Naive Bayes on correlated features:** Naive Bayes assumes feature independence. In ticket classification, words like "charge" and "billing" co-occur constantly. NB treats them as independent, overcounting their evidence. Result: billing-related probabilities are overestimated. Use Logistic Regression or a transformer when features are highly correlated.

**Ignoring distribution shift:** Training data has mean response time of 2s with std 0.5s. A year later, production query complexity has grown — mean is now 4s, std is 2s. A model trained on the old distribution makes poor predictions. Monitor feature distribution statistics (mean, std, percentiles) in production and trigger retraining when they drift significantly (KS test, PSI score).
:::

## 🎯 Checkpoint

::: details Question 1 — Bayes in spam filtering
**Q:** Explain how a Naive Bayes spam filter uses Bayes' theorem, and why "naive" doesn't necessarily mean inaccurate.

**A:** For a given email with words w₁, w₂, ..., wₙ, the filter computes: `P(spam | words) ∝ P(spam) * Π P(wᵢ | spam)`. P(spam) is the prior (e.g., 40% of all emails are spam). P(wᵢ | spam) is estimated from training data as (count of word i in spam emails + 1) / (total words in spam + vocabulary size) — Laplace smoothing for unseen words. The "naive" assumption is that word occurrences are conditionally independent given the class. This is empirically false (words co-occur) but the model often works well in practice because: (a) even if probabilities are miscalibrated, the ranking/decision boundary may be correct; (b) with many features, individual dependency violations average out; (c) high-dimensional sparse text data has relatively few strong dependencies between most word pairs.
:::

::: details Question 2 — Central Limit Theorem in ML
**Q:** Why does the Central Limit Theorem matter for gradient descent in large mini-batches?

**A:** Gradient descent computes the gradient on a mini-batch (sample), not the full dataset. The true gradient (average over full dataset) is estimated by the mini-batch gradient. By the CLT, the mini-batch gradient is approximately normally distributed around the true gradient, with variance σ²/B where B is batch size. Therefore: larger batches → more accurate gradient estimates (lower variance) → smoother convergence. However, very large batches (linear scaling regime) often converge to sharper minima (less generalization) and require linear learning rate scaling with batch size to maintain training stability. The CLT gives the formal justification for why mini-batch gradients are useful approximations and how variance scales with batch size.
:::

## Key Mental Models

- **Use the median for skewed distributions** — latency, cost, token counts are all right-skewed; median or percentiles tell the real story.
- **Correlation is a signal, not a cause** — always ask "what third variable might explain this?"
- **Bayes' theorem = prior belief + new evidence = updated belief** — this is how calibrated models should update class probabilities.
- **Normal distribution is the shape of aggregation** — sums and averages of many small effects converge to normal (CLT).
- **Standard deviation quantifies uncertainty** — a model that says "mean=4, std=0.1" is far more confident than "mean=4, std=3".

## Related

- [1.5 Linear Algebra for AI](./05-linear-algebra-for-ai) — vectors and matrices that implement the math above
- [1.6 ML Metrics](./06-ml-metrics) — statistical metrics for model evaluation
- [Module 9 — LLMOps & Evaluation](/ai-engineering/module-09/) — applying statistical rigor to LLM evaluation
