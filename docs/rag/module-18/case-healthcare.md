---
title: "Case Study: Healthcare Document RAG"
outline: deep
---

# Case Study 6 — Healthcare Document RAG

**Scenario:** A hospital system wants clinicians to query clinical guidelines, drug interaction databases, and internal protocols. HIPAA compliance is non-negotiable.

**Requirements:**
- HIPAA compliance: PHI (Protected Health Information) must never leak.
- On-premises or private cloud only — no data sent to public LLM APIs.
- Audit trail for every query and response.
- Sources: clinical guidelines (UpToDate-style), drug databases, internal hospital protocols, formulary.
- Disclaimer: system must never be the sole basis for clinical decisions.

**Architecture:**

```text
┌──────────────┐     ┌──────────────┐     ┌──────────────────────────┐
│  Clinician   │────▶│  Auth + Audit│────▶│  RAG Orchestrator        │
│  (EMR-       │     │  Gateway     │     │  (on-prem FastAPI)       │
│   embedded)  │     └──────────────┘     └───────────┬──────────────┘
└──────────────┘                                      │
                                    ┌─────────────────┼──────────────┐
                                    ▼                 ▼              ▼
                          ┌──────────────┐  ┌──────────────┐ ┌────────────┐
                          │ Vector DB    │  │ Keyword Index │ │ On-prem LLM│
                          │ (on-prem     │  │ (on-prem     │ │ (Llama 3   │
                          │  Qdrant)     │  │  Solr/ES)    │ │  70B, vLLM)│
                          └──────────────┘  └──────────────┘ └────────────┘
```

**Ingestion Strategy:**
- Clinical guidelines: structured XML/HTML from publisher APIs, parsed with section-level granularity.
- Drug databases: structured data (drug name, interactions, contraindications, dosing) stored as both structured records and embedded text chunks.
- Internal protocols: PDF/Word documents from the hospital's quality department, parsed via `unstructured`, manually reviewed for PHI before indexing.
- **PHI scrubbing**: before any document enters the RAG pipeline, it passes through a NER-based PHI detector (patient names, MRNs, dates of birth). Documents containing PHI are either scrubbed or rejected.

**Retrieval Strategy:**
- Hybrid search with medical synonym expansion (e.g., "heart attack" maps to "myocardial infarction" maps to "MI").
- Drug interaction queries route to the structured drug database first, with RAG as fallback for guideline-level context.
- Metadata filters: `source_type`, `specialty`, `last_reviewed_date` (clinical guidelines have review dates — outdated guidelines are deprioritized).

**Reranking:**
- Domain-specific reranker trained on medical text (PubMedBERT-based cross-encoder).
- Higher weight for guidelines reviewed within the last 2 years.

**Generation:**
- On-premises LLM (Llama 3 70B served via vLLM) — no data leaves the hospital network.
- Every response includes: the answer, cited sources with URLs, and a mandatory disclaimer: "This information is for clinical reference only. Always verify with current guidelines and exercise clinical judgment."
- Confidence scoring: if retrieval scores are low, the system says "I found limited information on this topic" rather than generating a low-confidence answer.

**Security:**
- **HIPAA Technical Safeguards:**
  - Encryption at rest (AES-256) and in transit (TLS 1.3).
  - Access controls: role-based (physicians see different content than nurses).
  - Audit trail: immutable log of every query, retrieved chunks, generated response, user ID, timestamp.
  - Automatic session timeout.
- PHI never enters the vector database or the LLM prompt.
- On-prem deployment eliminates data-in-transit risk to cloud providers.
- BAA (Business Associate Agreement) with any third-party software vendor whose code touches the data.

**Evaluation:**
- Clinical accuracy: reviewed by medical professionals quarterly.
- Retrieval recall for known guidelines: given a clinical question, does the system retrieve the correct guideline section?
- PHI leak detection: automated scanning of all stored chunks and generated responses for PHI patterns.
- Disclaimer compliance: every response must contain the disclaimer.

**Scaling:**
- On-prem GPU cluster for LLM inference (4x A100 or equivalent).
- Scaling is constrained by hardware budget — optimize with quantization (AWQ/GPTQ), batching, and KV-cache management.
- Expected load is moderate (~1K queries/day) — scaling is less of a concern than compliance.

**Key Trade-offs:**
- On-prem LLM has lower quality than GPT-4o/Claude, but HIPAA compliance is non-negotiable.
- PHI scrubbing may remove contextually important information (e.g., a patient name in a case study) — accept the loss for compliance.
- Clinical accuracy requires ongoing human review — you cannot fully automate evaluation.
- **The lesson: compliance requirements drive every architectural decision. Start with the constraints, not the features.**
