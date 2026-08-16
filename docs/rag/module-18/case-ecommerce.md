---
title: "Case Study: E-commerce Product Search"
outline: deep
---

# Case Study 7 — E-commerce Product Search

**Scenario:** An online retailer with 2M products wants a conversational search that understands natural language queries ("waterproof hiking boots under $150 with good arch support") and can show relevant products with images.

**Requirements:**
- Multimodal: products have images, descriptions, specs, and reviews.
- Structured data: price, brand, category, ratings, inventory status.
- Faceted filtering: price range, brand, category, rating threshold.
- Personalization: search results influenced by user's purchase history and preferences.
- Real-time inventory: don't recommend out-of-stock items.
- Scale: 2M products, 50M review chunks, 100K queries/day.

**Architecture:**

```text
┌──────────┐    ┌──────────────────────────────────────────────────┐
│ Shopper  │───▶│              Search Orchestrator                 │
└──────────┘    │  ┌──────────┐  ┌────────────┐  ┌─────────────┐  │
                │  │ Query    │  │ Structured │  │ Vector      │  │
                │  │ Parser   │  │ Filter     │  │ Search      │  │
                │  │ (extract │  │ (price,    │  │ (semantic   │  │
                │  │  facets) │  │  brand...) │  │  matching)  │  │
                │  └──────────┘  └────────────┘  └─────────────┘  │
                └──────────────────────────────────────────────────┘
                         │                │               │
                         ▼                ▼               ▼
                ┌──────────────┐  ┌─────────────┐  ┌────────────┐
                │ Product DB   │  │ Inventory   │  │ Review     │
                │ (PostgreSQL) │  │ Service     │  │ Vector DB  │
                └──────────────┘  └─────────────┘  └────────────┘
```

**Data Flow:**
1. "Waterproof hiking boots under $150 with good arch support" hits the Query parser, which extracts: `category=hiking_boots`, `feature=waterproof`, `price_max=150`, `semantic_query="good arch support"`.
2. Structured filters applied to product DB: `category=hiking_boots AND waterproof=true AND price<=150 AND in_stock=true`.
3. Filtered product IDs sent to vector search: semantic match on "good arch support" against product descriptions + review embeddings.
4. Results combined and ranked: product relevance + review sentiment for "arch support" + personalization score.
5. Top 10 products returned with images, prices, ratings, and a generated summary of why each matches.

**Ingestion Strategy:**
- Product catalog: ingested from the product database via CDC (Change Data Capture) — real-time updates when products change.
- Each product generates multiple embeddings: one from the description, one from aggregated review text, one from specs.
- Reviews: chunked per-review (each review is a chunk), embedded with metadata: `product_id`, `rating`, `verified_purchase`, `date`.
- Images: embedded using CLIP or similar multimodal model for image-to-text matching.

**Retrieval Strategy:**
- **Structured-first, semantic-second**: apply hard filters (price, brand, category, inventory) in the database, then semantic search over the filtered set.
- This is the opposite of a typical RAG system where semantic search comes first — in e-commerce, hard filters are non-negotiable (don't show $200 boots when the user said $150).
- Review-based retrieval: for subjective queries ("comfortable", "good for wide feet"), search review embeddings, not just product descriptions.

**Reranking:**
- Lightweight reranker that combines: semantic relevance score, product rating, review count, personalization score (based on user history), and recency.
- No heavyweight cross-encoder — latency budget is tight for e-commerce (< 500ms total).

**Generation:**
- For each recommended product, generate a 2-sentence summary: why it matches the query, pulled from the most relevant review snippets.
- "Based on 47 reviews mentioning arch support, the Salomon X Ultra gets consistently high marks for cushioning and stability."

**Security:**
- Product data is public — no ACL concerns.
- User purchase history is PII — personalization model runs server-side, user data never sent to LLM.
- Rate limiting to prevent scraping.

**Evaluation:**
- Click-through rate (CTR) on recommended products.
- Conversion rate: does the search lead to purchases?
- Query understanding accuracy: does the parser correctly extract facets?
- Zero-result rate: percentage of queries that return no results (should be < 5%).

**Key Trade-offs:**
- Structured filters before semantic search reduces recall but ensures hard constraints are met.
- Multiple embeddings per product (description + reviews + image) increase storage and ingestion cost but dramatically improve retrieval for subjective queries.
- Real-time inventory checks add latency but prevent the terrible UX of recommending out-of-stock items.
- **The lesson: e-commerce search is a hybrid of structured queries and semantic search. Pure RAG over unstructured text would miss the mark entirely.**
