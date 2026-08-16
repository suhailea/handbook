---
title: "Case Study: HR Policy Assistant"
outline: deep
---

# Case Study 8 — HR Policy Assistant

**Scenario:** A company's HR department deploys an internal assistant for employees to ask about PTO policies, benefits, expense rules, promotion criteria, and company handbook content.

**Requirements:**
- Access-level filtering: managers see different content than individual contributors (e.g., termination procedures, salary bands).
- Employees should get answers instantly instead of emailing HR and waiting 2 days.
- Sensitive topics: the assistant must not answer questions about specific employees, ongoing investigations, or legal matters — redirect to HR.
- Multi-region: different policies for US, UK, EU, India offices.

**Architecture:**

```text
┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐
│  Employee    │───▶│  SSO + Role  │───▶│  RAG Orchestrator    │
│  (Slack bot  │    │  Resolver    │    │  (filters by role +  │
│   or Web UI) │    │  (Okta/AD)   │    │   region)            │
└──────────────┘    └──────────────┘    └──────────┬───────────┘
                                                    │
                                    ┌───────────────┼──────────┐
                                    ▼               ▼          ▼
                          ┌──────────────┐  ┌────────────┐  ┌──────┐
                          │ Vector DB    │  │ Keyword    │  │ LLM  │
                          │ (pgvector)   │  │ Search     │  │      │
                          │ + role/region│  │            │  │      │
                          │   metadata   │  │            │  │      │
                          └──────────────┘  └────────────┘  └──────┘
```

**Ingestion Strategy:**
- HR policy documents ingested with rich metadata: `policy_category`, `region` (US/UK/EU/India), `access_level` (all_employees/managers/hr_only/executives), `effective_date`, `supersedes` (link to previous version).
- Versioning: when a policy is updated, the old version is soft-deleted (marked `superseded=true`) but retained for audit purposes.
- Chunking: section-level within each policy document. Each chunk inherits the document's access metadata.

**Retrieval Strategy:**
- Two mandatory filters applied before retrieval:
  1. `region`: matches the employee's office location (from SSO profile).
  2. `access_level`: matches the employee's role (IC, manager, HR, executive).
- Example: A US-based IC asking "How many PTO days do I get?" only retrieves US employee-level PTO policy, not the UK policy or the manager-level policy that includes details about approving direct reports' PTO.
- Hybrid search for queries that include policy numbers or specific terms.

**Reranking:**
- Standard cross-encoder reranker. Policy corpus is small (~2K chunks), so reranking is fast.
- Prefer newer policies when multiple versions exist.

**Generation:**
- System prompt includes a blocklist of topics: "Do not answer questions about specific employees, ongoing HR investigations, salary information for other employees, or legal matters. For these topics, respond: 'Please contact HR directly at hr@company.com for assistance with this matter.'"
- Region-appropriate answers: if a US employee asks about parental leave, cite the US policy, not the UK one.
- Citations reference the policy document name and section.

**Security:**
- Access-level filtering is enforced at the database query level (pre-filter).
- The LLM never sees chunks the user isn't authorized to access.
- Sensitive topic detection: a classifier checks if the query is about a blocked topic before executing retrieval.
- All queries logged with employee ID for audit.

**Evaluation:**
- HR team reviews a sample of answers weekly for correctness.
- Employee satisfaction survey: is the assistant helpful?
- Deflection rate: how many queries were resolved by the assistant vs. escalated to HR?
- Access violation testing: red-team exercise where ICs try to access manager-only content.

**Scaling:**
- Small corpus, moderate query volume (~500 queries/day) — a single instance handles this easily.
- The main scaling concern is organizational: keeping policies up-to-date as they change.

**Key Trade-offs:**
- Role-based filtering reduces recall (managers get broader results) but is required for confidentiality.
- Maintaining region-specific policies multiplies content management effort.
- Blocking sensitive topics means the assistant can't help with everything — but attempting to answer legal or personnel matters is far riskier than declining.
- **The lesson: HR assistants are ACL problems disguised as RAG problems. Get the access control right first.**
