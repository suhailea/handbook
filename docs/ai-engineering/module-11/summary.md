---
title: Module 11 Summary — Security & Responsible AI
outline: deep
---

# Module 11 Summary — Security & Responsible AI

## What you built

A security-and-ethics framework for production AI systems: defenses against prompt injection and PII leakage, authorization gates for autonomous agents, and the fairness/transparency/compliance stack required for regulated industries.

## 6 Mental Models to Take Forward

1. **Every LLM input is an untrusted network request** — validate and sanitize AI inputs the same way you validate HTTP request bodies. Injection patterns, PII, and adversarial instructions all arrive via the same channel: user text.

2. **The LLM decides what to do; your code decides whether it happens** — never let an agent's tool call execute without a deterministic permission check outside the model. The model's intent is advisory; your authorization layer is authoritative.

3. **Human-in-the-loop is not a UX choice, it is a safety architecture** — irreversible, high-value, or cross-system actions (payments, deletions, emails to customers) require an explicit human approval gate with a TTL-bounded pending state.

4. **Bias lives in data, amplifies in models, and manifests in outputs** — auditing model accuracy alone misses disparate impact. Measure demographic parity, equal opportunity, and equalized odds on representative slices before every production deployment.

5. **GDPR Article 22 is not optional when AI makes consequential decisions** — automated decisions affecting individuals require a legal basis, human review on request, and a meaningful explanation. Audit logs are the evidence that you complied.

6. **Explainability is not transparency theater** — SHAP values point to the features driving a decision (which helps engineers debug bias), but a human-readable explanation generated from SHAP + LLM is what actually satisfies a customer or regulator asking "why."

## Self-Assessment Checklist

- [ ] Can you describe three distinct prompt injection attack vectors and a defense for each?
- [ ] Can you implement an input validator that blocks injection patterns without over-blocking legitimate user queries?
- [ ] Can you explain the difference between PII detection (find) and PII masking (replace) and name a production tool for each?
- [ ] Can you design an agent permission model with per-tool limits and a human approval gate for high-value actions?
- [ ] Can you define demographic parity, equal opportunity, and equalized odds and calculate them from a confusion matrix?
- [ ] Can you explain what SHAP values represent and how to use them to diagnose model bias?
- [ ] Can you list the GDPR Article 22 obligations for an AI system that auto-approves or rejects loan applications?
- [ ] Can you design an audit log schema that satisfies regulatory review requirements for AI decisions?

## Next Module

[Module 12 — Energy Trading AI](../module-12/) covers domain-specific AI for commodities trading: energy market concepts, AI trading architecture, and the critical principle that LLMs interpret while quantitative models calculate.
