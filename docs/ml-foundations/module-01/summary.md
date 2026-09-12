---
title: Module 1 Summary — ML Fundamentals & Statistics
outline: deep
---

# Module 1 Summary — ML Fundamentals & Statistics

## What you built

A solid mathematical foundation for AI engineering: the statistical tools, linear algebra concepts, ML algorithms, and optimization mechanics that underpin every model you'll work with.

## 7 Mental Models to Take Forward

1. **Supervised learning requires labels; LLMs evade this with self-supervision** — next-token prediction gives free labels from any text, at trillion-token scale.

2. **Test set = sacred; touch it once** — every time you read test metrics and make a decision, it becomes a validation set. The three-split protocol exists because of this.

3. **XGBoost for tabular, fine-tuned transformers for text, start simple always** — Linear Regression and Logistic Regression as the mandatory first baseline before escalating.

4. **Use the metric that matches the cost of each error type** — accuracy on imbalanced data is a lie; recall matters for medical/fraud; precision matters for spam. Choose before training.

5. **Gradient descent = navigate the loss landscape by following the downhill slope** — learning rate controls step size; Adam adapts per parameter; backprop computes the direction efficiently.

6. **Cosine similarity = directional relationship; magnitude is usually noise in embeddings** — always L2-normalize embeddings before comparing or indexing.

7. **Training loss down + validation loss up = overfitting** — the single diagnostic every engineer must recognize. Stop training (early stopping), add regularization, or get more data.

## Self-Assessment Checklist

- [ ] Can you explain supervised vs unsupervised without jargon?
- [ ] Can you explain why a test set must be untouched during development?
- [ ] Can you choose between Linear Regression, Random Forest, and XGBoost given a scenario?
- [ ] Can you explain the difference between precision and recall with a concrete example?
- [ ] Can you derive the gradient update rule for gradient descent?
- [ ] Can you explain what backpropagation computes and how the chain rule enables it?
- [ ] Can you explain why cosine similarity is preferred over dot product for embeddings?
- [ ] Can you describe the bias-variance tradeoff and give one technique to address each?

## Next Module

[Module 2 — Deep Learning & NLP](../module-02/) covers neural networks, CNNs, RNNs, and why Transformers replaced them — building on the optimization foundations from this module.
