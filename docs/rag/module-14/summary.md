---
title: Module 14 Summary — Security & Guardrails
outline: deep
---

# Module 14 Summary — Security & Guardrails

## Mental Models Gained

1. **The LLM is not a security boundary.** It cannot verify identity, enforce access control, or reliably resist prompt injection. Every security control must be enforced at the infrastructure layer (database, API gateway, application code) -- the LLM is the last line of defense, not the first.

2. **Filter before the LLM sees it.** If unauthorized documents are in the context window, the breach has already happened. Database-level ACL filters ensure the LLM never receives data it should not have.

3. **Indirect injection is the RAG-specific threat.** Unlike direct injection (malicious user queries), indirect injection comes through poisoned documents. It is harder to prevent because the attack enters through the ingestion pipeline, not the query path.

4. **Guardrails are safety nets, not quality.** They catch catastrophic failures (toxic output, PII leakage, off-topic responses) but do not improve the quality of correct answers. Invest in retrieval and generation quality separately.

5. **Every guardrail needs a fallback.** External moderation APIs go down. Decide fail-open vs fail-closed for each guardrail, and have a degraded local alternative.

## Self-Assessment Checklist

- [ ] Can you explain direct vs indirect prompt injection and mitigations for each?
- [ ] Can you design a multi-tenant ACL system with database-level enforcement?
- [ ] Can you explain why "the LLM will filter" is not a valid security strategy?
- [ ] Can you implement a PII detection and redaction pipeline for ingestion?
- [ ] Can you design a guardrail pipeline with correct ordering (cheap first, parallel where possible)?
- [ ] Can you explain the difference between guardrails, validation, evaluation, and security?
- [ ] Can you design fail-open and fail-closed strategies with fallbacks?

## Security Control Placement Quick Reference

| Threat | Layer | Control |
|--------|-------|---------|
| Direct prompt injection | API Gateway + Application | Input pattern matching, prompt hardening |
| Indirect prompt injection | Ingestion + Retrieval | Document scanning, data/instruction separation |
| Cross-tenant leakage | Database | Mandatory tenant_id filter, row-level security |
| Unauthorized access | Database + Application | ACL metadata filters, JWT-based permissions |
| PII exposure | Ingestion + Output | Redact at ingestion, scan at output |
| Data poisoning | Ingestion | Source trust levels, human review, provenance tracking |
| System prompt leakage | Output | Output scanning, prompt hardening |
