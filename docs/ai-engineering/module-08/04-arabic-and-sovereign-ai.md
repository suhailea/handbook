# Arabic LLMs, Multilingual RAG & Sovereign AI

🔥🔥 Interview weight (🔥🔥🔥 for Gulf roles) | Prerequisites: [8.2 Enterprise AI Architecture](./02-enterprise-ai-architecture), [8.3 Data Architecture](./03-data-architecture), [9.1 Cloud vs Local vs Self-Hosted](../module-09/01-model-serving-overview)

::: info Plain English
Most AI tutorials assume English users and a US cloud. Building in the Gulf adds two requirements that change your architecture.

**Arabic and bilingual users.** Arabic is written right-to-left, words change shape with prefixes and suffixes, the same word can be spelled several ways, and people mix dialects, Modern Standard Arabic and English in one sentence. A RAG system that works well in English can quietly fail in Arabic.

**Sovereignty.** Governments, banks, healthcare and energy companies often require that data, and sometimes the model itself, stays inside the country or on their own infrastructure. "Just call the API" may not be allowed.

Engineers who can handle both are in high demand in the UAE, Saudi Arabia and the wider region.
:::

::: warning Verify before you build
Regulations, cloud-region model availability and local model releases change often. Treat the specifics here as a starting map, and confirm current rules with your legal/compliance team and current offerings with each provider.
:::

## Part 1: Arabic in LLM Systems

### What makes Arabic hard

| Challenge | Example | Impact |
| --- | --- | --- |
| **Rich morphology** | "وسيكتبونها" = "and they will write it" (one word) | Keyword search misses matches; token counts rise |
| **Spelling variation** | أ / إ / آ / ا for alef; ة vs ه; ى vs ي | Same word, different strings; exact match fails |
| **Diacritics** | كَتَبَ vs كتب | Usually omitted, occasionally present; breaks matching |
| **Dialects** | Gulf, Egyptian, Levantine, Maghrebi vs MSA | Models and STT trained on MSA struggle with dialect |
| **Code-switching** | "ابي أعرف الـ refund policy" | Mixed-language queries confuse retrieval and routing |
| **Arabizi** | "3ayez a3raf" (Arabic in Latin letters with numbers) | Invisible to Arabic-script pipelines |
| **Tokenisation cost** | Many tokenisers split Arabic into more tokens per word than English | Higher cost, less effective context |

### Model choices

| Option | Notes |
| --- | --- |
| **Frontier multilingual models** (major commercial providers) | Generally strong on MSA and improving on dialects; easiest start; check data residency options |
| **Jais** (Inception / G42 with MBZUAI) | Arabic-English bilingual models; open-weight versions available for self-hosting |
| **Falcon family** (TII, Abu Dhabi) | Open-weight models, including Arabic-focused variants |
| **ALLaM** (SDAIA, Saudi Arabia) | Arabic-focused model from the Saudi data and AI authority |

Don't pick based on reputation. **Build an Arabic eval set** from your real users (including dialect and code-switched queries) and compare models on it, the same way as in [Module 5](../module-05/).

### Arabic-aware RAG

**1. Normalise text consistently** at both indexing and query time:

```typescript
// arabic-normalize.ts
const DIACRITICS = /[\u064B-\u0652\u0670]/g   // Harakat, tanween, sukun, superscript alef
const TATWEEL = /\u0640/g                      // Kashida (decorative stretching)

export function normalizeArabic(text: string, opts = { aggressive: false }): string {
  let t = text
    .replace(DIACRITICS, '')
    .replace(TATWEEL, '')
    .replace(/[\u0622\u0623\u0625\u0671]/g, '\u0627')                      // آ أ إ ٱ → ا
    .replace(/[\u0660-\u0669]/g, d => String(d.charCodeAt(0) - 0x0660))    // Arabic-Indic digits → 0-9
    .replace(/[\u06F0-\u06F9]/g, d => String(d.charCodeAt(0) - 0x06F0))    // Extended (Persian) digits

  if (opts.aggressive) {
    // Lossy: improves recall for keyword search, but can merge different words.
    t = t.replace(/\u0649/g, '\u064A')   // ى → ي
         .replace(/\u0629/g, '\u0647')   // ة → ه
  }
  return t
}
```

Use aggressive normalisation for the **keyword (BM25) index**, but store and display the **original text**. Never show normalised text to users.

**2. Use hybrid search.** Multilingual embedding models (e.g. BGE-M3, multilingual E5, or commercial multilingual embeddings) handle meaning across languages. Keyword search catches exact names, IDs and legal terms. Add Arabic light stemming or morphological analysis (tools like CAMeL Tools or Farasa) to the keyword side for better recall.

**3. Handle cross-lingual retrieval.** Users ask in Arabic about English documents, and vice versa. Options:
- Multilingual embeddings (query and documents in one shared vector space).
- Query translation: translate the query to the document language and search both.
- Bilingual indexing: store a translated copy of key documents.

**4. Chunk carefully.** Split on sentence and paragraph boundaries that respect Arabic punctuation (، ؛ ؟). Measure chunk size in tokens with your actual tokenizer, since Arabic chunks hit token limits sooner.

**5. Answer in the user's language.** Detect the query language (and dialect where relevant) and instruct the model to respond in it, even when sources are in the other language. Citations should still point to the original source text.

### Bilingual product details

- **RTL rendering:** use `dir="auto"` on user and model messages; mixed Arabic/English text needs bidi-aware rendering.
- **Streaming:** RTL text streaming token by token can reorder visually mid-stream; test it.
- **Numbers and dates:** decide on Western vs Arabic-Indic digits per product, and the Hijri vs Gregorian calendar where relevant.
- **Tone:** formal MSA for official communication; users may prefer dialect-friendly replies in casual products.

## Part 2: Sovereign AI & Data Residency

### The deployment spectrum

From least to most control:

| Level | Setup | Data leaves the country? | Typical fit |
| --- | --- | --- | --- |
| **1. Global API** | Provider's global endpoint | Possibly | Startups, non-sensitive data |
| **2. In-region cloud** | Hyperscaler region in the UAE/KSA with models hosted in-region | No (if configured correctly) | Most regulated enterprises |
| **3. Sovereign / local cloud** | Local sovereign cloud providers | No | Government, critical sectors |
| **4. Self-hosted, private** | Open-weight models on your own GPUs (vLLM, see [9.3](../module-09/03-vllm)) | No | Banks, defence, health, strict policies |
| **5. Air-gapped** | No internet connection at all | No | Classified or highly sensitive workloads |

Hyperscalers have regions in the UAE (for example Azure UAE North/Central and AWS's UAE region), but **not every model is offered in every region**. Confirm model availability, and whether inference and logs stay in-region, before designing around a model.

### Regulatory landscape (UAE-focused)

Frameworks you'll commonly meet:

- **UAE PDPL** (Federal Decree-Law No. 45 of 2021 on personal data protection).
- **DIFC Data Protection Law** (DIFC Law No. 5 of 2020) for entities in the DIFC.
- **ADGM Data Protection Regulations 2021** for entities in ADGM.
- **Sector rules**: e.g. health data localisation requirements under UAE health ICT law, and central bank outsourcing and cloud rules for financial institutions.
- **Government data classification** policies at federal and emirate level.
- Across the region: Saudi Arabia's PDPL and national data rules, and similar laws in other GCC states.

Your job as an engineer isn't to interpret the law, but to **design systems that can satisfy whatever your compliance team decides**:

```typescript
// data-routing.ts
type Classification = 'public' | 'internal' | 'confidential' | 'restricted'

const MODEL_ROUTES: Record<Classification, { endpoint: string; allowExternal: boolean }> = {
  public:       { endpoint: process.env.GLOBAL_LLM_ENDPOINT!,     allowExternal: true },
  internal:     { endpoint: process.env.IN_REGION_LLM_ENDPOINT!,  allowExternal: false },
  confidential: { endpoint: process.env.IN_REGION_LLM_ENDPOINT!,  allowExternal: false },
  restricted:   { endpoint: process.env.SELF_HOSTED_LLM_ENDPOINT!, allowExternal: false },
}

export function routeByClassification(c: Classification) {
  return MODEL_ROUTES[c]   // Classification decides the model endpoint, not the developer
}
```

### Sovereign architecture checklist

- **Data classification at ingestion:** tag documents and requests so routing can enforce policy.
- **In-region everything:** not just the model, but also embeddings, vector DB, logs, traces, caches and eval data. Traces often contain full prompts and are the most common leak.
- **PII handling:** redact or tokenise personal data before it reaches any model that doesn't need it.
- **Audit logs:** who asked what, which model answered, which documents were retrieved.
- **Model portability:** keep an abstraction layer so you can move from an in-region API to self-hosted open weights if policy tightens.
- **Self-hosting capacity planning:** GPU availability, quantisation ([9.4](../module-09/04-quantization)), and the quality gap between open-weight and frontier models, measured on your evals.

::: danger Where It Bites
**Normalisation mismatch:** Documents are normalised at indexing, but queries aren't (or vice versa). Recall drops for any word containing أ or ة, and nobody notices because English queries work fine. Fix: one shared normalisation function for both paths, with tests.

**Evaluating on MSA only:** The eval set is written by the team in formal Arabic. Real users write Gulf dialect mixed with English. Production quality is far below eval scores. Fix: build eval sets from real (anonymised) user queries.

**Residency leak through observability:** The model runs in-region, but the tracing SaaS stores full prompts in another country. Fix: self-host or region-pin tracing, or redact prompts before export.

**Assuming model availability:** Architecture is designed around a model that isn't offered in the required region. Fix: confirm regional availability early, and keep the model layer swappable.

**Token budget surprise:** Arabic documents use far more tokens than the English estimate. Costs and context overflows exceed plans. Fix: measure token counts on real Arabic content with each candidate model's tokenizer.
:::

## Interview Questions

::: details Q1 — How would you build RAG for a bilingual Arabic/English knowledge base?
Consistent Arabic normalisation at index and query time; hybrid retrieval with multilingual embeddings plus a keyword index with Arabic stemming; cross-lingual handling via multilingual embeddings or query translation; token-aware chunking respecting Arabic punctuation; reranking with a multilingual reranker; answering in the user's language with citations to original text; and an eval set built from real user queries including dialect and code-switching, with retrieval metrics tracked separately per language.
:::

::: details Q2 — A bank requires that no customer data leaves the UAE. How does that change your LLM architecture?
Classify data and route by classification. Use in-region hosted models or self-hosted open-weight models for anything containing customer data. Keep embeddings, vector DB, caches, logs and traces in-region too, since observability is a common leak. Redact PII where the model doesn't need it, keep full audit logs, and keep an abstraction layer so the model backend can change if policy or availability changes. Confirm details with compliance rather than interpreting regulations myself.
:::

::: details Q3 — Open-weight Arabic model self-hosted, or a frontier model in-region?
Compare on an Arabic eval set from real users, plus cost at expected volume and operational burden. In-region frontier models usually win on quality and ops simplicity if they're available and approved. Self-hosted open-weight models win when policy requires full control, when volume makes GPUs cheaper than API pricing, or when you need fine-tuning on domain data. Many organisations use both, routing by data classification.
:::

## Key Mental Models

- **Normalise once, use everywhere.** Same function for indexing and querying; show original text.
- **Evaluate on real users' Arabic.** Dialect and code-switching, not textbook MSA.
- **Residency covers the whole pipeline.** Model, embeddings, vector DB, logs, traces, caches.
- **Classification drives routing.** Policy in code, not in developers' heads.
- **Keep the model layer swappable.** Regulations and regional availability change.

## Related

- [8.3 Data Architecture](./03-data-architecture) — where data lives and flows
- [9.1 Cloud vs Local vs Self-Hosted](../module-09/01-model-serving-overview) — the serving trade-offs
- [11.5 Multi-Cloud AI](../module-11/05-multi-cloud-ai) — in-region options across providers
- [RAG track](/rag/) — full retrieval pipeline details
