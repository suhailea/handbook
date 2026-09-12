---
title: Supervised vs Unsupervised Learning
outline: deep
---

# Supervised vs Unsupervised Learning

🔥🔥🔥 Interview weight | Prerequisites: None — this is a foundation page

## 🗣️ In Plain English

::: tip In Plain English
Imagine you're training a new employee to sort customer support tickets into three buckets: "billing issue", "technical problem", and "feature request".

You have two choices.

**Choice A:** You show them 10,000 already-sorted tickets and say "study these." They see the patterns — billing tickets usually mention "invoice", "charge", "refund". They learn by example, and soon they can correctly categorize new tickets without your help. This is **supervised learning**: you provide labeled examples, the machine learns the mapping from input to label.

**Choice B:** You dump 10,000 unsorted tickets on their desk with no instructions and say "group these into natural clusters." They'll notice that some tickets share vocabulary, topic, urgency level. They'll find groupings you didn't anticipate — maybe "password reset" is a bigger category than you thought. This is **unsupervised learning**: no labels, no right answer defined in advance — just find structure in the data.

The difference is the label. Supervised learning requires someone to already know the answer and mark it down. Unsupervised learning finds patterns in the raw signal.

Within supervised learning: if the label is a **category** (billing / technical / feature), it's **classification**. If the label is a **number** (e.g., how many minutes until the customer churns), it's **regression**.

Within unsupervised learning: finding groups is **clustering**. Finding a compressed representation is **dimensionality reduction**.

Most of what you'll do in AI engineering is supervised learning — because you have labels (past user interactions, historical outcomes). Unsupervised techniques come up in embeddings, anomaly detection, and exploratory data analysis.
:::

## ⚙️ Under the Hood

### The Formal Distinction

**Supervised learning** trains a function `f: X → Y` where:
- `X` is the input feature space
- `Y` is the label space
- The training set is `{(x₁, y₁), (x₂, y₂), ..., (xₙ, yₙ)}`
- Loss = discrepancy between `f(xᵢ)` and `yᵢ`; minimizing loss is the training objective

**Unsupervised learning** trains on `{x₁, x₂, ..., xₙ}` — no `y`. The objective is model-dependent: for clustering it's minimizing intra-cluster distance, for generative models it's maximizing likelihood of the data distribution.

### Classification

The output `Y` is a discrete set of classes. The model outputs either:
- A hard label: `"billing"`, `"technical"`, `"feature"`
- A probability distribution: `{billing: 0.72, technical: 0.21, feature: 0.07}`

**Binary classification**: two classes (spam/not spam, churn/retain, fraud/legitimate).
**Multiclass classification**: three or more mutually exclusive classes.
**Multilabel classification**: each input can have multiple labels simultaneously (a ticket about both billing AND a technical bug).

```python
# run: python classification_example.py
from sklearn.linear_model import LogisticRegression
from sklearn.datasets import load_iris
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report

# Iris: 4 features → 3 species (multiclass classification)
X, y = load_iris(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = LogisticRegression(max_iter=200)
model.fit(X_train, y_train)

preds = model.predict(X_test)
probs = model.predict_proba(X_test)  # [n_samples, n_classes]

print(f"Accuracy: {accuracy_score(y_test, preds):.2%}")
print(classification_report(y_test, preds, target_names=load_iris().target_names))

# The model learned: P(class | features) via a softmax over learned weights
# predict() returns argmax of predict_proba()
```

### Regression

The output `Y` is a continuous real number. Loss is typically Mean Squared Error (MSE) or Mean Absolute Error (MAE).

```python
# run: python regression_example.py
from sklearn.linear_model import LinearRegression
from sklearn.datasets import fetch_california_housing
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_squared_error, r2_score
import numpy as np

X, y = fetch_california_housing(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = LinearRegression()
model.fit(X_train, y_train)

preds = model.predict(X_test)
rmse = np.sqrt(mean_squared_error(y_test, preds))
print(f"RMSE: {rmse:.3f}")   # In units of the target (median house value)
print(f"R²:   {r2_score(y_test, preds):.3f}")  # Fraction of variance explained
```

### Clustering (Unsupervised)

K-Means assigns each point to the nearest of K cluster centroids, then re-computes centroids, repeating until convergence.

```python
# run: python clustering_example.py
from sklearn.cluster import KMeans
from sklearn.datasets import make_blobs
import numpy as np

X, true_labels = make_blobs(n_samples=300, centers=4, random_state=42)

kmeans = KMeans(n_clusters=4, random_state=42, n_init='auto')
kmeans.fit(X)

print("Inertia (sum of squared distances to centroid):", kmeans.inertia_)
print("Cluster centers:\n", kmeans.cluster_centers_)
# Note: cluster IDs are arbitrary — cluster 0 may correspond to true label 3
```

### The Label Cost Problem

Supervised learning requires **labeled data** — and labels are expensive. Human annotators cost money and time; labels can be noisy or inconsistent. This is why:

- **Semi-supervised learning** exists: train on a small labeled set + large unlabeled set
- **Self-supervised learning** is critical to LLMs: the labels come from the data itself (predict the next token; the label is the actual next token, for free from any text corpus)
- **Active learning**: the model queries a human annotator for the most uncertain examples rather than labeling everything

### Where Each Paradigm Shows Up in AI Engineering

| Task | Paradigm | Why |
|------|----------|-----|
| Sentiment classification | Supervised (classification) | You have labeled reviews |
| Churn prediction | Supervised (regression/binary) | Historical churn data is the label |
| Topic discovery in new corpus | Unsupervised (clustering) | No predefined topics |
| Anomaly detection | Unsupervised | Normal is defined by the distribution; anomalies are outliers |
| LLM pre-training | Self-supervised | Next token is the label, mined from text |
| RAG embedding | Unsupervised (representation) | Embeddings cluster semantically similar text |
| Fine-tuning classification head | Supervised | You provide (prompt, label) pairs |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Label leakage:** Your supervised model achieves 99% accuracy in testing and 60% in production. Root cause: a feature used during training was derived from future information (e.g., "days since last contact" computed at outcome time, not at decision time). The training labels leaked future signal into features. Diagnose by reconstructing features using only information available at decision time.

**Cluster count selection:** You use K-Means for unsupervised segmentation and pick K=5 because it looks right. Six months later the business complains the segments don't make sense. Root cause: no principled method was used to choose K. Use the elbow method (inertia vs K), silhouette score, or domain knowledge. In production, cluster quality degrades as the data distribution shifts — monitor centroid drift.

**Supervised model trained on biased labels:** You build a "good answer" classifier trained on human ratings. If annotators systematically prefer longer answers, your model learns length = quality. Your AI system then generates verbose responses that score well but don't actually help users. Diagnose by auditing inter-annotator agreement and checking feature importance for proxy features (length, sentiment polarity).

**The wrong paradigm:** You apply supervised classification to a problem where the category set isn't stable — new issue types emerge every month. A fixed-class classifier silently misclassifies new types into the nearest old class. Consider an unsupervised anomaly detection approach, or an open-set classifier with a "none of the above" output.
:::

## 🎯 Checkpoint

::: details Question 1 — Self-supervised learning
**Q:** LLM pre-training is described as self-supervised. Explain precisely what the labels are and where they come from, and why this is categorized as supervised rather than unsupervised.

**A:** In next-token prediction (the dominant LLM pre-training objective), the input is a sequence of tokens `[t₁, t₂, ..., tₙ₋₁]` and the label is `tₙ` — the actual next token from the text corpus. The labels are derived mechanically from the data itself: no human annotation is needed. Because there is an explicit target `y` (the next token) and an explicit loss (cross-entropy between the model's predicted distribution and the one-hot actual token), it follows the supervised learning formulation `f: X → Y`. It's "self-supervised" rather than "supervised" to distinguish it from human-annotated supervision — but mathematically it belongs to the supervised family.
:::

::: details Question 2 — Classification vs Regression decision
**Q:** You're building a model to predict whether a customer support ticket will be resolved within 24 hours. Should you frame this as classification or regression? What are the tradeoffs?

**A:** Both framings are valid; the choice depends on what action follows the prediction. **Classification (binary):** Output is "will resolve in 24h: yes/no". Optimizes directly for the decision boundary. Calibrated probabilities let you set a threshold. Easier to explain to stakeholders. Use when the 24h threshold is genuinely the business boundary. **Regression:** Output is "predicted resolution time in hours". More informative — you can derive multiple thresholds, rank tickets by urgency numerically, and see that a ticket predicted at 23.5h is different from one at 26h. Harder to calibrate. Choose regression when the continuous prediction has downstream value (SLA risk scoring), classification when the binary decision is all that matters.
:::

::: details Question 3 — Label noise
**Q:** Your training set for a ticket classifier was labeled by support agents who often disagreed. How does label noise affect the trained model?

**A:** Label noise introduces variance in the target variable. The model will try to fit inconsistent labels, which has two effects: (1) it increases effective loss on the training set — the model can never fully minimize loss because some labels contradict each other — leading to underfitting if the model is not expressive enough, or (2) the model memorizes noisy labels in specific examples if the model is very expressive, leading to worse generalization. Techniques to mitigate: (a) confidence learning — identify likely-mislabeled examples by cross-checking model predictions against labels; (b) soft labels — instead of one-hot labels, use the distribution across annotators (e.g., 60% billing, 40% technical); (c) robust loss functions like symmetric cross-entropy; (d) inter-annotator agreement filtering — only keep examples where ≥2/3 annotators agree.
:::

## Key Mental Models

- **Supervised learning requires labels** — someone must already know the answer. The cost and quality of labels is the primary bottleneck in most production ML.
- **LLMs use self-supervision** — the text itself provides free labels (next token prediction), which is why they can scale to trillions of tokens without human annotation.
- **Classification outputs probabilities, not certainties** — always expose the probability, not just the argmax. A model that says "billing: 0.51" is very different from one saying "billing: 0.99".
- **Unsupervised = finding structure without ground truth** — you can't measure accuracy directly; you use proxy metrics (inertia, silhouette) or domain evaluation.
- **The label space must be stable** — if new categories emerge post-deployment, a fixed-class supervised model silently misclassifies them.

## Related

- [1.2 Train / Validation / Test Splits](./02-training-validation-test) — how to evaluate supervised models without peeking at test data
- [1.6 ML Metrics](./06-ml-metrics) — precision/recall/F1 for classification; RMSE/R² for regression
- [Module 0.1 How Transformers Work](/ai-engineering/module-00/01-how-transformers-work) — self-supervised pre-training in context
