---
title: ML Algorithms — From Linear Regression to XGBoost
outline: deep
---

# ML Algorithms — From Linear Regression to XGBoost

🔥🔥 Interview weight | Prerequisites: [1.1 Supervised vs Unsupervised](./01-supervised-vs-unsupervised), [1.2 Train/Val/Test](./02-training-validation-test)

## 🗣️ In Plain English

::: tip In Plain English
Think of ML algorithms as different types of specialists you can hire to solve a problem.

**Linear Regression** is the Excel analyst. Given historical data about house sizes and prices, they draw the best-fit straight line through the data. Fast, interpretable, honest — but useless if the relationship isn't roughly linear.

**Logistic Regression** is the same analyst, but now you asked them a yes/no question. They still draw a straight decision boundary, but they output a probability instead of a number. "Based on this customer's history, there's an 83% chance they churn."

**Decision Trees** are the customer service script. "Is the ticket about billing? If yes: Is the amount over $100? If yes: escalate. If no: auto-refund." They make a series of if/else decisions. Very interpretable — a human can read the tree and understand the logic. But a single tree trained aggressively will memorize noise.

**Random Forest** hires a hundred decision tree analysts and averages their answers. Each analyst sees a random subset of the data and a random subset of features. No single tree is great, but together they're robust. The wisdom of crowds.

**XGBoost** builds trees sequentially, each one learning from the mistakes of the previous. The first tree is rough. The second tree focuses on what the first got wrong. The third corrects the second's errors. Layer by layer, you get a highly accurate ensemble. XGBoost wins most tabular data Kaggle competitions.

**SVM** finds the widest possible lane between two classes. If you could draw a road between "spam" and "not spam" emails, SVM finds the road that has the most space to the nearest examples on either side. Great for high-dimensional data with clear margins.

**K-Means** divides your customers into K groups by asking: who is closest to each other? It places K central points ("centroids") and assigns each customer to their nearest center, then re-positions the centers, repeating until they stop moving.

**PCA** compresses data. If you have 100 features, PCA finds the 2 or 3 directions that capture most of the variation and projects everything onto those. Useful for visualization and noise reduction.
:::

## ⚙️ Under the Hood

### Linear Regression

Fits `y = Xw + b` by minimizing `||y - Xw - b||²` (MSE). The optimal weights have an analytical solution (Normal Equation): `w = (XᵀX)⁻¹Xᵀy`. In practice, gradient descent is used for large datasets because matrix inversion is O(n³).

```python
# run: python linear_regression.py
import numpy as np
from sklearn.linear_model import LinearRegression, Ridge, Lasso
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline

np.random.seed(42)
n = 500
X = np.random.randn(n, 5)
# True: y = 2x0 + 0.5x1 + noise
y = 2 * X[:, 0] + 0.5 * X[:, 1] + np.random.randn(n) * 0.3

# Plain OLS
lr = LinearRegression()
lr.fit(X, y)
print("Coefficients (OLS):", lr.coef_.round(3))  # [2.0, 0.5, ~0, ~0, ~0]

# Ridge: L2 penalty, all coefficients shrink but stay non-zero
ridge = Pipeline([('scale', StandardScaler()), ('model', Ridge(alpha=1.0))])
ridge.fit(X, y)

# Lasso: L1 penalty, irrelevant coefficients → exactly zero
lasso = Pipeline([('scale', StandardScaler()), ('model', Lasso(alpha=0.01))])
lasso.fit(X, y)
print("Lasso coefficients:", lasso.named_steps['model'].coef_.round(3))
# x2, x3, x4 should be ~0 (feature selection)
```

**When to use:** Baseline for any regression task. Start here. If it performs well, ship it — simple models are easier to maintain, debug, and explain.

### Logistic Regression

Not regression — it's a linear classifier. Applies the logistic sigmoid `σ(z) = 1/(1+e⁻ᶻ)` to a linear combination of features to output a probability. Loss is binary cross-entropy: `-[y log(p) + (1-y)log(1-p)]`.

The decision boundary is linear in feature space. Non-linear boundaries require feature engineering (polynomial features, interaction terms).

```python
# run: python logistic_regression.py
from sklearn.linear_model import LogisticRegression
from sklearn.datasets import make_classification
from sklearn.model_selection import train_test_split
from sklearn.calibration import calibration_curve
import numpy as np

X, y = make_classification(n_samples=5000, n_features=20, n_informative=10, random_state=42)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

model = LogisticRegression(C=1.0, max_iter=500)
model.fit(X_train, y_train)

probs = model.predict_proba(X_test)[:, 1]  # P(class=1)
# LogisticRegression is generally well-calibrated:
# if it says 70%, ~70% of those samples should be positive
fraction_pos, mean_pred = calibration_curve(y_test, probs, n_bins=10)
print("Calibration check (pred → actual):")
for pred, actual in zip(mean_pred, fraction_pos):
    print(f"  predicted {pred:.2f} → actual {actual:.2f}")
```

**When to use:** Binary or multiclass problems with tabular features, when you need calibrated probabilities and interpretable coefficients (coefficient = log-odds change per unit feature change).

### Decision Trees

Splits data recursively by the feature and threshold that maximally reduce **impurity** (Gini impurity for classification, variance for regression).

Gini impurity of a node: `G = 1 - Σ(pᵢ²)` where `pᵢ` is the proportion of class `i`.

```python
# run: python decision_tree.py
from sklearn.tree import DecisionTreeClassifier, export_text
from sklearn.datasets import load_iris

X, y = load_iris(return_X_y=True)
tree = DecisionTreeClassifier(max_depth=3, random_state=42)
tree.fit(X, y)

print(export_text(tree, feature_names=load_iris().feature_names))
# Human-readable rules:
# |--- petal length (cm) <= 2.45
# |   |--- class: 0
# |--- petal length (cm) > 2.45
# |   |--- petal width (cm) <= 1.75
# ...
print(f"Feature importances: {dict(zip(load_iris().feature_names, tree.feature_importances_.round(3)))}")
```

**When to use:** When interpretability is required (financial, healthcare decisions that need explanation). Rarely competitive as a standalone model for accuracy.

### Random Forest

Bootstrap aggregation (bagging) + random feature subsets. Each tree is trained on `n` samples drawn with replacement from training data. At each split, only `sqrt(n_features)` features are considered. Predictions: majority vote (classification) or mean (regression).

```python
# run: python random_forest.py
from sklearn.ensemble import RandomForestClassifier
from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import cross_val_score
import pandas as pd

X, y = load_breast_cancer(return_X_y=True, as_frame=True)

rf = RandomForestClassifier(
    n_estimators=200,       # number of trees
    max_depth=None,         # grow until pure; bagging handles overfitting
    max_features='sqrt',    # random feature subset per split
    min_samples_leaf=1,
    n_jobs=-1,              # use all CPU cores
    random_state=42,
)

scores = cross_val_score(rf, X, y, cv=5, scoring='roc_auc')
print(f"ROC-AUC: {scores.mean():.4f} ± {scores.std():.4f}")

rf.fit(X, y)
importance = pd.Series(rf.feature_importances_, index=X.columns)
print("\nTop 5 features:")
print(importance.nlargest(5))
```

**When to use:** Strong default for tabular classification/regression. Less tuning than XGBoost. Handles missing values (with imputation). Naturally gives feature importance.

### XGBoost (Extreme Gradient Boosting)

Builds an ensemble of trees **sequentially**. Each tree fits the **residual errors** (gradient of the loss) of the current ensemble. The final prediction is the sum of all tree outputs, scaled by a learning rate.

Key hyperparameters:
- `n_estimators`: number of trees (more = better until overfitting; use early stopping)
- `learning_rate (eta)`: shrinks each tree's contribution; lower = more trees needed but better generalization
- `max_depth`: tree depth; deeper = more complex patterns but higher variance
- `subsample`: fraction of data per tree (bagging-like, reduces variance)
- `colsample_bytree`: fraction of features per tree

```python
# run: python xgboost_demo.py
# pip install xgboost
import xgboost as xgb
from sklearn.datasets import load_breast_cancer
from sklearn.model_selection import train_test_split
from sklearn.metrics import roc_auc_score

X, y = load_breast_cancer(return_X_y=True)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
X_train, X_val, y_train, y_val = train_test_split(X_train, y_train, test_size=0.2, random_state=42)

model = xgb.XGBClassifier(
    n_estimators=1000,       # will stop early
    learning_rate=0.05,
    max_depth=4,
    subsample=0.8,
    colsample_bytree=0.8,
    eval_metric='auc',
    early_stopping_rounds=20,  # stop if val AUC doesn't improve for 20 rounds
    random_state=42,
)
model.fit(X_train, y_train, eval_set=[(X_val, y_val)], verbose=False)

print(f"Best iteration: {model.best_iteration}")
auc = roc_auc_score(y_test, model.predict_proba(X_test)[:, 1])
print(f"Test ROC-AUC: {auc:.4f}")
```

**When to use:** State-of-the-art for tabular data. When you need the best accuracy and have time to tune. Winner of most Kaggle tabular competitions. Consider LightGBM for faster training on large datasets.

### SVM (Support Vector Machine)

Finds the hyperplane that maximizes the **margin** (distance to nearest training points of each class). The nearest points are the **support vectors**. Non-linearly separable data is handled via the **kernel trick**: implicitly mapping data to a higher-dimensional space where it is linearly separable.

Common kernels: RBF (Gaussian), polynomial, sigmoid.

```python
# run: python svm_demo.py
from sklearn.svm import SVC
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.datasets import make_circles
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score

# Non-linearly separable data (concentric circles)
X, y = make_circles(n_samples=1000, noise=0.1, factor=0.5, random_state=42)
X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2)

# RBF kernel maps data to infinite-dimensional space
svm = Pipeline([
    ('scale', StandardScaler()),  # SVM is sensitive to scale
    ('svm', SVC(kernel='rbf', C=1.0, gamma='scale', probability=True))
])
svm.fit(X_train, y_train)
print(f"Accuracy: {accuracy_score(y_test, svm.predict(X_test)):.4f}")
```

**When to use:** High-dimensional data where number of features >> samples (text classification, bioinformatics). Slow on large datasets (O(n²) to O(n³) training). SVMs are less common since neural nets and gradient boosting surpassed them on most tasks, but still useful for small, high-dimensional problems.

### K-Means Clustering

Iteratively assigns each point to the nearest of K centroids, then recomputes centroids. Convergence is guaranteed (finite states) but may reach a local minimum. Run multiple times with different initializations (K-Means++ initialization helps).

```python
# run: python kmeans_demo.py
from sklearn.cluster import KMeans
from sklearn.metrics import silhouette_score
from sklearn.datasets import make_blobs
import numpy as np

X, _ = make_blobs(n_samples=500, centers=4, random_state=42)

# Choose K using silhouette score
for k in range(2, 8):
    km = KMeans(n_clusters=k, n_init=10, random_state=42)
    labels = km.fit_predict(X)
    sil = silhouette_score(X, labels)  # -1 to 1; higher = better defined clusters
    print(f"K={k}: silhouette={sil:.3f}, inertia={km.inertia_:.1f}")
```

**When to use:** Customer segmentation, document clustering, anomaly detection (find outliers by distance to nearest centroid). Not suitable for clusters of very different sizes/shapes — use DBSCAN or GMM.

### PCA (Principal Component Analysis)

Finds orthogonal directions of maximum variance in the data. Projects data onto the top-k such directions (principal components).

Mechanically: compute covariance matrix, eigen-decompose it, take the top-k eigenvectors.

```python
# run: python pca_demo.py
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
import numpy as np

np.random.seed(42)
# Simulated embeddings: 1000 samples, 768-dimensional
X = np.random.randn(1000, 768) @ np.random.randn(768, 768)  # correlated features

scaler = StandardScaler()
X_scaled = scaler.fit_transform(X)

pca = PCA()
pca.fit(X_scaled)

# Explained variance ratio: how much variance each component captures
cumulative = np.cumsum(pca.explained_variance_ratio_)
k_for_95pct = np.searchsorted(cumulative, 0.95) + 1
print(f"Components needed for 95% variance: {k_for_95pct}")

# Apply: 768 → k dimensions
pca_k = PCA(n_components=k_for_95pct)
X_reduced = pca_k.fit_transform(X_scaled)
print(f"Reduced shape: {X_reduced.shape}")
```

**When to use:** Preprocessing to remove correlated features, visualization (project to 2D/3D), noise reduction in embeddings before retrieval.

### Algorithm Selection Guide

| Scenario | Start with | Why |
|----------|-----------|-----|
| Regression baseline | Linear Regression | Fast, interpretable, establishes baseline |
| Binary classification | Logistic Regression | Calibrated probabilities, interpretable |
| Best tabular accuracy | XGBoost / LightGBM | State-of-the-art, early stopping, fast |
| Need feature importance | Random Forest or XGBoost | Built-in, reliable |
| High-dim, few samples | SVM (RBF) | Works well in high-dim |
| Unsupervised grouping | K-Means | Fast, simple, good starting point |
| Dimensionality reduction | PCA | Linear, fast, interpretable |
| Text classification | Logistic Regression or fine-tuned model | LR with TF-IDF baselines well; finetune for production |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**XGBoost "early stopping" on test set:** Engineers pass the test set as the evaluation set for early stopping. This contaminates the test set — the model's number of trees is tuned to perform well on those specific test samples. The "test" accuracy is now optimistic. Always use a separate validation set for early stopping.

**SVM training time blows up:** SVM trains fine on 10,000 samples but becomes unusably slow on 1,000,000. The training algorithm is O(n²)-O(n³) in samples. Engineers discover this when a dataset doubles in size. Switch to LinearSVC (linear kernel only, but O(n)) or gradient boosting which scales linearly.

**K-Means on unscaled features:** A clustering model for customer segmentation uses features including "annual revenue (in millions)" and "number of support tickets". Revenue dominates the distance calculation because its values are 1000× larger. Clusters form purely around revenue bands. Fix: always StandardScaler before K-Means and SVM.

**Random Forest feature importance misleads:** Features with high cardinality (many unique values) or continuous features appear more important than they should because the tree can find more split points. A random ID column might rank highly. Use permutation importance or SHAP values for reliable attribution.
:::

## 🎯 Checkpoint

::: details Question 1 — XGBoost vs Random Forest
**Q:** Both XGBoost and Random Forest are tree ensembles. What is the fundamental difference in how they build trees, and what does this imply about their failure modes?

**A:** Random Forest builds trees **in parallel** on bootstrap samples — each tree is independent and the ensemble error is reduced through averaging (variance reduction). Trees can be overfit individually but their errors cancel. XGBoost builds trees **sequentially** — each tree fits the negative gradient of the loss of the current ensemble. This is variance AND bias reduction: early trees capture the main signal, later trees correct residual errors. Implications: (1) XGBoost is more susceptible to overfitting to noise in later iterations — controlled by early stopping and learning rate. (2) If training is stopped too early, XGBoost underfits (insufficient bias reduction), while Random Forest rarely underfits with enough trees. (3) XGBoost is harder to parallelize (tree dependency) while Random Forest trains n_estimators trees in parallel.
:::

::: details Question 2 — Kernel trick
**Q:** What is the kernel trick in SVM, and why does it avoid the computational cost of explicitly computing high-dimensional mappings?

**A:** The kernel trick exploits the fact that SVM's decision boundary depends only on **dot products** between training samples (through the dual formulation). A kernel function K(xᵢ, xⱼ) computes the dot product between two samples in a transformed feature space **without explicitly computing the transformation**. For the RBF kernel: K(xᵢ, xⱼ) = exp(-γ||xᵢ-xⱼ||²), which corresponds to a dot product in an infinite-dimensional feature space. Computing that infinite-dimensional transformation explicitly is impossible; computing the kernel is O(d) where d is the original feature dimension. This makes SVMs tractable for non-linear classification without explicit feature engineering.
:::

## Key Mental Models

- **Start simple, escalate complexity only when the baseline fails** — Linear/Logistic Regression before XGBoost.
- **XGBoost sequential residual fitting = each tree specializes in correcting predecessor's mistakes** — use early stopping to control when this process has overfit.
- **K-Means is distance-based — scale your features first** — or you're clustering by whichever feature has the largest values.
- **Feature importance from tree models is a starting point, not ground truth** — validate with permutation importance or SHAP.

## Related

- [1.2 Train / Validation / Test](./02-training-validation-test) — how to evaluate all of these algorithms
- [1.6 ML Metrics](./06-ml-metrics) — what to measure: AUC, F1, RMSE
- [Module 0 — Mental Models](/ai-engineering/module-00/) — neural networks as the next step beyond these classical algorithms
