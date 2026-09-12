---
title: ML Metrics — Accuracy, Precision, Recall, AUC, RMSE
outline: deep
---

# ML Metrics — Accuracy, Precision, Recall, AUC, RMSE

🔥🔥🔥 Interview weight | Prerequisites: [6.1 Supervised vs Unsupervised](./01-supervised-vs-unsupervised)

## 🗣️ In Plain English

::: tip In Plain English
Imagine your hospital has a system that screens chest X-rays for tumors. It processes 10,000 X-rays: 100 have tumors (1%), 9,900 don't.

A naive model that always says "no tumor" is 99% accurate. But it missed all 100 tumors. Accuracy is useless here.

The question you actually care about: "Of all the patients you flagged, how many actually had a tumor?" That's **precision** — your false-alarm rate. And: "Of all the patients who actually had a tumor, how many did you catch?" That's **recall** — your miss rate.

Precision and recall trade off against each other through a **threshold**. Lower the threshold → flag more patients → catch more tumors (higher recall) → but also flag more healthy patients (lower precision). The **F1 score** is the harmonic mean of precision and recall — it penalizes you for being bad at either one.

**ROC-AUC** answers a different question: across all possible thresholds, how well does your model separate positive from negative cases? An AUC of 1.0 means perfect separation. An AUC of 0.5 means your model is as good as flipping a coin. AUC doesn't depend on any threshold — it measures the overall discriminative power.

For **regression** (predicting numbers), the equivalents are:
- **MAE** (Mean Absolute Error): average distance from prediction to truth, in the original units.
- **RMSE** (Root Mean Squared Error): like MAE but squares the errors first — penalizes big mistakes more heavily.
- **R²** (R-squared): "what fraction of the variance did my model explain?" An R² of 0.9 means the model explains 90% of why values vary. R² of 0 means your model is no better than always predicting the mean.

The key insight: there is no universal best metric. **The metric is a business decision.** In fraud detection, you care more about recall (catch every fraud). In spam filtering, you care more about precision (never miss a real email). Choose the metric that matches the cost of each type of error in your specific use case.
:::

## ⚙️ Under the Hood

### The Confusion Matrix

All classification metrics derive from the confusion matrix:

| | Predicted Positive | Predicted Negative |
|--|--|--|
| **Actual Positive** | True Positive (TP) | False Negative (FN) |
| **Actual Negative** | False Positive (FP) | True Negative (TN) |

- **TP**: correctly flagged positives
- **FN**: missed positives (type II error)
- **FP**: false alarms (type I error)
- **TN**: correctly cleared negatives

```python
# run: python confusion_matrix_demo.py
from sklearn.metrics import (
    confusion_matrix, accuracy_score, precision_score, recall_score,
    f1_score, roc_auc_score, classification_report
)
from sklearn.linear_model import LogisticRegression
from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split
import numpy as np

# Imbalanced dataset: 5% positive rate (like fraud detection)
X, y = make_classification(
    n_samples=10_000, n_features=20, weights=[0.95, 0.05],
    n_informative=10, random_state=42
)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = LogisticRegression(max_iter=1000, class_weight='balanced')
model.fit(X_train, y_train)

y_pred = model.predict(X_test)
y_proba = model.predict_proba(X_test)[:, 1]

cm = confusion_matrix(y_test, y_pred)
TP, FN, FP, TN = cm[1,1], cm[1,0], cm[0,1], cm[0,0]
print(f"TP={TP}, FN={FN}, FP={FP}, TN={TN}")

print(f"\nAccuracy:  {accuracy_score(y_test, y_pred):.4f}")
print(f"Precision: {precision_score(y_test, y_pred):.4f}  (of flagged, how many real positives)")
print(f"Recall:    {recall_score(y_test, y_pred):.4f}  (of real positives, how many caught)")
print(f"F1:        {f1_score(y_test, y_pred):.4f}")
print(f"ROC-AUC:   {roc_auc_score(y_test, y_proba):.4f}")

print("\n" + classification_report(y_test, y_pred))
```

### Precision and Recall Formulas

**Precision** = TP / (TP + FP) — "of what I predicted positive, how many actually are?"

**Recall (Sensitivity)** = TP / (TP + FN) — "of all actual positives, how many did I find?"

**Specificity** = TN / (TN + FP) — "of all actual negatives, how many did I correctly clear?" (Used in medical testing)

**F1 Score** = 2 * (Precision * Recall) / (Precision + Recall) — harmonic mean, penalizes imbalance between P and R.

**F-beta Score** = (1 + β²) * (P * R) / (β²P + R) — weight recall β times as important as precision. Use β=2 to emphasize recall (don't miss positives), β=0.5 to emphasize precision.

```python
# run: python precision_recall_tradeoff.py
import numpy as np
from sklearn.metrics import precision_score, recall_score
from sklearn.linear_model import LogisticRegression
from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split

X, y = make_classification(n_samples=5000, weights=[0.9, 0.1], n_features=10, random_state=42)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = LogisticRegression(max_iter=500)
model.fit(X_train, y_train)
y_proba = model.predict_proba(X_test)[:, 1]

print(f"{'Threshold':>10} {'Precision':>10} {'Recall':>10} {'F1':>10}")
for threshold in [0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
    y_pred = (y_proba >= threshold).astype(int)
    if y_pred.sum() == 0:
        continue
    p = precision_score(y_test, y_pred, zero_division=0)
    r = recall_score(y_test, y_pred, zero_division=0)
    f1 = 2*p*r/(p+r) if (p+r) > 0 else 0
    print(f"{threshold:>10.1f} {p:>10.4f} {r:>10.4f} {f1:>10.4f}")

# As threshold increases: precision ↑, recall ↓
```

### ROC Curve and AUC

The **ROC curve** (Receiver Operating Characteristic) plots True Positive Rate (Recall) vs False Positive Rate (FP/(FP+TN)) at every possible threshold. AUC = Area Under the ROC Curve.

- AUC = 1.0: perfect classifier
- AUC = 0.5: random (diagonal line)
- AUC = 0.0: perfectly inverted (predicts every class as the other — also perfect, just flip)

**Interpretation**: AUC = probability that a randomly chosen positive example gets a higher score than a randomly chosen negative example. This is a threshold-free measure of ranking quality.

```python
# run: python roc_auc_demo.py
from sklearn.metrics import roc_curve, roc_auc_score
import numpy as np

np.random.seed(42)
n = 1000
y_true = np.random.binomial(1, 0.2, n)

# Three models with different discriminative power
y_score_good   = 0.8 * y_true + 0.2 * np.random.rand(n)  # high AUC
y_score_medium = 0.5 * y_true + 0.5 * np.random.rand(n)  # medium AUC
y_score_random = np.random.rand(n)                         # ~0.5 AUC

for name, scores in [("Good", y_score_good), ("Medium", y_score_medium), ("Random", y_score_random)]:
    auc = roc_auc_score(y_true, scores)
    print(f"{name} model AUC: {auc:.4f}")

# PR-AUC (Precision-Recall AUC): better for highly imbalanced datasets
from sklearn.metrics import average_precision_score
ap = average_precision_score(y_true, y_score_good)
print(f"\nGood model PR-AUC (avg precision): {ap:.4f}")
# PR-AUC is more informative than ROC-AUC when positives are rare
```

**When to use PR-AUC vs ROC-AUC:** With severe class imbalance (1% positive rate), ROC-AUC can look optimistic because TN dominates the denominator of FPR. PR-AUC focuses only on the positive class — use it for fraud, medical diagnosis, rare event detection.

### Regression Metrics

```python
# run: python regression_metrics.py
import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

np.random.seed(42)
y_true = np.random.randn(1000) * 10 + 50  # mean=50, std=10

# A good model
y_pred_good = y_true + np.random.randn(1000) * 2  # small noise
# A mediocre model
y_pred_med = y_true + np.random.randn(1000) * 5   # more noise

for name, y_pred in [("Good", y_pred_good), ("Mediocre", y_pred_med)]:
    mae  = mean_absolute_error(y_true, y_pred)
    mse  = mean_squared_error(y_true, y_pred)
    rmse = np.sqrt(mse)
    r2   = r2_score(y_true, y_pred)
    mape = np.mean(np.abs((y_true - y_pred) / y_true)) * 100  # Mean Abs % Error

    print(f"\n{name} model:")
    print(f"  MAE:  {mae:.3f}  (avg error in original units)")
    print(f"  RMSE: {rmse:.3f} (penalizes large errors more)")
    print(f"  R²:   {r2:.4f} (1 = perfect, 0 = predict-mean baseline)")
    print(f"  MAPE: {mape:.2f}%")
```

**MAE vs RMSE:**
- MAE: robust to outliers, treats all errors equally. Use when outlier errors shouldn't be penalized extra.
- RMSE: penalizes large errors quadratically. Use when big errors are disproportionately bad (e.g., predict LLM latency: a 60-second error is much worse than a 1-second error).

**R² interpretation:**
- R² = 1 - (SS_res / SS_tot) where SS_res = Σ(yᵢ - ŷᵢ)² and SS_tot = Σ(yᵢ - ȳ)²
- Can be negative if the model is worse than always predicting the mean

### Multiclass Metrics

For classification with K > 2 classes:

```python
# run: python multiclass_metrics.py
from sklearn.metrics import precision_score, recall_score, f1_score
from sklearn.datasets import load_iris
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split

X, y = load_iris(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

model = RandomForestClassifier(n_estimators=100, random_state=42)
model.fit(X_train, y_train)
y_pred = model.predict(X_test)

# averaging strategies:
# 'macro': compute metric per class, average equally (treats rare classes equally)
# 'weighted': average weighted by support (class frequency)
# 'micro': aggregate TP/FP/FN across all classes first

print(f"Precision (macro):    {precision_score(y_test, y_pred, average='macro'):.4f}")
print(f"Precision (weighted): {precision_score(y_test, y_pred, average='weighted'):.4f}")
print(f"Recall    (macro):    {recall_score(y_test, y_pred, average='macro'):.4f}")
print(f"F1        (macro):    {f1_score(y_test, y_pred, average='macro'):.4f}")
```

**Macro vs Weighted:**
- Macro: treats each class as equally important. Highlights poor performance on minority classes.
- Weighted: weights by class frequency. Can hide poor minority class performance. Use when class frequency reflects real importance.

### Metric Selection Guide

| Use Case | Primary Metric | Why |
|----------|---------------|-----|
| Balanced classification | Accuracy or F1 | Both errors equally costly |
| Fraud / medical diagnosis | Recall (F-beta, β>1) | Missing positives is catastrophic |
| Spam filter | Precision (F-beta, β<1) | False positives (missed real mail) matter most |
| Imbalanced dataset | PR-AUC | ROC-AUC misleads with extreme imbalance |
| Model comparison (threshold-free) | ROC-AUC | Compares discriminative ability |
| Predict a price / time | MAE or RMSE | Depends on outlier penalty |
| Explain to stakeholders | R² | "Explains 85% of variance" is intuitive |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Accuracy on imbalanced data:** A churn prediction model reports 95% accuracy. The churn rate is 5%. The model is predicting "no churn" for every customer. Recall = 0. Zero churners intercepted. This exact failure mode has caused teams to deploy useless models because they only checked accuracy. Always report precision, recall, and F1 alongside accuracy for classification problems.

**Optimizing training for the wrong metric:** You minimize MSE during training (standard) but evaluate on MAPE (Mean Absolute Percentage Error) in production. MSE-optimized models tend to have large errors on low-value predictions because the absolute value is small (MSE minimizes absolute error, not relative). Training with a custom loss function that matches the production metric often improves real-world performance.

**AUC drops between validation and production:** AUC was 0.91 in validation, 0.76 in production month 3. Root cause: the validation set was drawn from the same time period as training. Distribution shift (seasonal patterns, new customer demographics) degraded performance. Monitor AUC in production monthly, with a rolling test set of recent data.

**Threshold not calibrated for production class ratio:** The model was trained with equal class weights (50/50 artificially balanced). In production, the actual positive rate is 2%. The default threshold of 0.5 is too high — most positives score 0.2–0.4. The model misses them. Calibrate threshold on the production class ratio using the validation set's precision-recall curve.
:::

## 🎯 Checkpoint

::: details Question 1 — Precision vs Recall tradeoff
**Q:** You're building a content moderation classifier that flags user-generated content for human review. The operations cost of reviewing flagged content is high, but missing harmful content has regulatory risk. How do you choose the operating threshold and primary metric?

**A:** This is a precision-recall tradeoff with asymmetric costs. The cost of FN (missing harmful content → regulatory risk) vs FP (false flag → review cost). Steps: (1) Quantify the costs: if regulatory fines are 100× the per-review cost, you want high recall even at precision cost. (2) Use F-beta score with β > 1 (e.g., β=2) to weight recall twice as much as precision during threshold selection. (3) Plot the precision-recall curve on your validation set and find the threshold where Fβ is maximized. (4) Check operational capacity: if the ops team can review 1,000 items/day, constrain precision to be no worse than (harmful_items_per_day / 1000). (5) The primary tracking metric is recall@operating_precision — what recall do you achieve given an operational precision constraint. Report both; optimize recall within a precision floor.
:::

::: details Question 2 — Why RMSE not MAE for certain regression problems
**Q:** You're predicting LLM inference latency. A prediction error of 1 second happens 100 times. A prediction error of 30 seconds happens twice. Which metric better captures that the 30-second errors are the real problem?

**A:** RMSE, because it squares errors before averaging. The 30-second errors contribute 30² = 900 per occurrence vs 1² = 1 for small errors. RMSE is dominated by these large errors, giving you a metric that is sensitive to them. MAE treats all errors equally: the 100 × 1-second errors (MAE contribution = 100) swamp the 2 × 30-second errors (MAE contribution = 60). In production latency prediction for an AI system, a 30-second error causes timeouts, SLA violations, and user abandonment — genuinely more than 30× the impact of a 1-second error. RMSE's quadratic penalty better reflects this cost function. Consider also Huber loss as a compromise: quadratic for small errors (like RMSE) but linear for large ones (not dominated by extreme outliers).
:::

## Key Mental Models

- **Accuracy is often the wrong metric** — especially for imbalanced classes; always check precision and recall.
- **Precision and recall trade off via threshold** — raise threshold to be more precise (fewer false alarms); lower threshold to improve recall (catch more).
- **AUC is threshold-free** — it measures discriminative power; use it to compare models before choosing a threshold.
- **RMSE penalizes large errors quadratically** — if big mistakes are disproportionately costly, RMSE is the right loss signal.
- **The metric is a business decision** — "what's the cost of each type of error in your specific domain?"

## Related

- [6.2 Train / Validation / Test](./02-training-validation-test) — what split these metrics are computed on
- [Module 9.1 RAG Evaluation Metrics](/ai-engineering/module-09/01-rag-evaluation-metrics) — retrieval-specific metrics (Recall@K, MRR)
- [Module 9.3 Evaluation Pipeline](/ai-engineering/module-09/03-evaluation-pipeline) — applying metrics to agent evaluation
