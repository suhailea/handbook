---
title: GraphRAG
outline: deep
---

# GraphRAG

Interview weight: 🔥🔥 | Prerequisites: [Retrieval fundamentals](/rag/module-09/), [Agentic RAG](01-agentic-rag.md)

## 🗣️ In Plain English

::: tip In Plain English
Vector search finds documents that *talk about similar things*. Graph search finds documents that are *connected to each other*. If you ask "who reports to the person who approved policy X?", vector search finds documents about the policy but cannot follow the chain of relationships. A knowledge graph can, because it stores entities (people, policies) and their connections (approved, reports-to) explicitly.
:::

## ⚙️ Under the Hood

### What Is a Knowledge Graph?

A knowledge graph is a structured representation of entities and their relationships:

```
[Entity] --relationship--> [Entity]

[Alice]  --reports_to-->   [Bob]
[Bob]    --approved-->     [Policy X]
[Policy X] --applies_to--> [Engineering Department]
```

Each node is an **entity** (person, document, concept) and each edge is a **relationship** (reports-to, authored-by, references).

---

### Why Vector Search Is Not Enough

| Query Type | Vector Search | Graph Search |
|-----------|--------------|-------------|
| "What is our refund policy?" | Excellent (semantic match) | Not needed |
| "Who approved the refund policy?" | Finds policy doc, maybe mentions approver | Direct: Policy → approved_by → Person |
| "Who reports to the person who approved the refund policy?" | Fails (multi-hop reasoning across docs) | Direct: Policy → approved_by → Person → reports_from → People |
| "How are departments X and Y connected?" | Finds docs about each, cannot connect | Traverses shared relationships |
| "Summarize everything we know about Project Alpha" | Returns top-K related chunks | Traverses all connected entities |

---

### Graph Construction Pipeline

Building a knowledge graph from documents requires **entity extraction** and **relationship extraction**, typically using LLMs:

```typescript
// run: npx tsx graph-construction.ts

interface Entity {
  id: string;
  name: string;
  type: string;        // person, organization, policy, product, etc.
  properties: Record<string, unknown>;
  sourceChunkId: string;
}

interface Relationship {
  source: string;      // entity ID
  target: string;      // entity ID
  type: string;        // reports_to, authored_by, references, etc.
  properties: Record<string, unknown>;
  sourceChunkId: string;
}

// Step 1: Entity extraction using LLM
const entityExtractionPrompt = `Extract all named entities from this text.
For each entity, provide:
- name: the entity name as it appears in the text
- type: one of [person, organization, policy, product, location, event, concept]
- description: one-sentence description based on context

Text:
{chunk_text}

Output as JSON array of entities.`;

// Step 2: Relationship extraction using LLM
const relationshipExtractionPrompt = `Given these entities extracted from a text,
identify relationships between them.

Entities: {entities}

Text: {chunk_text}

For each relationship, provide:
- source: source entity name
- target: target entity name
- type: relationship type (e.g., reports_to, authored_by, approves, references)
- description: one-sentence description of the relationship

Output as JSON array of relationships.`;

// Step 3: Entity resolution (deduplication)
// "John Smith", "J. Smith", "John" → same entity
// This is the hardest step — use embedding similarity + LLM verification
async function resolveEntities(
  entities: Entity[],
): Promise<Map<string, string>> {
  // Group by type first
  const byType = new Map<string, Entity[]>();
  for (const entity of entities) {
    const group = byType.get(entity.type) ?? [];
    group.push(entity);
    byType.set(entity.type, group);
  }

  const mergeMap = new Map<string, string>(); // old ID → canonical ID

  for (const [type, group] of byType) {
    // Compute pairwise name similarity
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const similarity = computeNameSimilarity(
          group[i].name,
          group[j].name,
        );
        if (similarity > 0.85) {
          // Merge: keep the longer name as canonical
          const canonical =
            group[i].name.length >= group[j].name.length
              ? group[i].id
              : group[j].id;
          const merged =
            canonical === group[i].id ? group[j].id : group[i].id;
          mergeMap.set(merged, canonical);
        }
      }
    }
  }

  return mergeMap;
}
```

---

### Microsoft's GraphRAG Approach

Microsoft Research's GraphRAG (2024) introduced a specific methodology:

**1. Community detection:** After building the entity-relationship graph, detect communities (clusters of densely connected entities) using algorithms like Leiden.

**2. Hierarchical summarization:** For each community, generate a summary using an LLM. These summaries form a hierarchy -- small communities summarized, then grouped into larger communities with higher-level summaries.

**3. Two retrieval modes:**

| Mode | How It Works | Best For |
|------|-------------|----------|
| **Local search** | Start from query-relevant entities, traverse nearby graph neighborhood, combine with vector-retrieved chunks | Specific questions ("What did Alice say about Project X?") |
| **Global search** | Use community summaries at the appropriate hierarchy level | Broad questions ("What are the main themes in this dataset?") |

**Advantages of the Microsoft approach:**
- Global search can answer questions that require synthesizing information across the entire corpus -- something basic RAG fundamentally cannot do
- Community summaries pre-compute high-level patterns
- Hierarchy allows different granularity levels

**Disadvantages:**
- Expensive graph construction (many LLM calls for extraction and summarization)
- Community summaries can become stale as documents change
- Requires re-running community detection when the graph changes significantly

---

### Graph Retrieval Patterns

```typescript
// run: npx tsx graph-retrieval.ts

// Pattern 1: Entity-centric retrieval
// "Tell me about Alice" → find Alice node → get all relationships → get connected entities
async function entityRetrieval(
  entityName: string,
  graphDB: GraphDB,
  depth = 2,
): Promise<Subgraph> {
  const entity = await graphDB.findEntity(entityName);
  if (!entity) return { nodes: [], edges: [] };

  // Traverse N hops from the entity
  return await graphDB.query(`
    MATCH (start {name: $name})-[r*1..${depth}]-(connected)
    RETURN start, r, connected
  `, { name: entityName });
}

// Pattern 2: Path finding
// "How are Alice and Project X connected?"
async function findPath(
  entity1: string,
  entity2: string,
  graphDB: GraphDB,
): Promise<Path[]> {
  return await graphDB.query(`
    MATCH path = shortestPath(
      (a {name: $name1})-[*]-(b {name: $name2})
    )
    RETURN path
  `, { name1: entity1, name2: entity2 });
}

// Pattern 3: Hybrid — graph + vector
// Use graph to expand context, then vector search with expanded terms
async function hybridGraphVector(
  query: string,
  graphDB: GraphDB,
  vectorDB: VectorDB,
): Promise<Chunk[]> {
  // Step 1: Extract entities from query
  const queryEntities = await extractEntities(query);

  // Step 2: Get graph context (related entities and relationships)
  const graphContext: string[] = [];
  for (const entity of queryEntities) {
    const subgraph = await entityRetrieval(entity.name, graphDB, 1);
    graphContext.push(subgraphToText(subgraph));
  }

  // Step 3: Augmented vector search
  // Combine original query with graph context for richer retrieval
  const augmentedQuery = `${query}\n\nRelated context: ${graphContext.join('; ')}`;
  const vectorResults = await vectorDB.search(augmentedQuery, { topK: 10 });

  // Step 4: Combine graph context + vector results
  return [
    ...graphContext.map((text) => ({ text, source: 'graph' })),
    ...vectorResults,
  ];
}
```

---

### When GraphRAG Adds Value vs When It Is Overkill

| Scenario | GraphRAG Value | Recommendation |
|----------|---------------|----------------|
| FAQ / simple Q&A | Low | Basic RAG |
| Highly relational data (org charts, legal contracts, research papers with citations) | High | GraphRAG |
| Multi-hop questions ("who manages the person who wrote policy X?") | High | GraphRAG |
| Small corpus (< 1000 documents) | Low | Basic RAG (not enough entities for a useful graph) |
| Global summarization ("what are the main themes?") | High | GraphRAG (community summaries) |
| Real-time, low-latency requirements | Low | Basic RAG (graph construction adds latency) |
| Frequently changing documents | Medium | Consider update cost |

### Advantages/Disadvantages Summary

| Aspect | Advantage | Disadvantage |
|--------|-----------|--------------|
| **Multi-hop reasoning** | Can follow chains of relationships | Requires accurate entity extraction |
| **Global understanding** | Community summaries capture themes | Expensive to build and maintain |
| **Explainability** | Graph paths show *why* entities are connected | Graph visualization is complex |
| **Precision on relational queries** | Direct edge traversal, not semantic guessing | Misses relationships not in the graph |
| **Construction cost** | One-time build | Many LLM calls for extraction (~$5-50 per 1000 docs) |
| **Maintenance** | Incremental updates possible | Entity resolution gets harder over time |

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Entity extraction quality.** A team built a knowledge graph from legal contracts. The LLM entity extractor missed 30% of entity mentions due to legal jargon and abbreviations. The graph had holes -- traversals that should have connected entities hit dead ends. **Measure entity extraction recall and precision on a labeled sample before trusting the graph.**

**Entity resolution failures.** "John Smith (Engineering)" and "J. Smith (VP Engineering)" were treated as two different entities. Queries about John returned incomplete results. The graph was technically correct but practically useless for this entity. **Entity resolution is the hardest step in graph construction. Invest in it proportionally.**

**Graph staleness.** Documents were updated weekly, but the graph was rebuilt monthly. For three weeks each month, the graph contained stale relationships. An employee who changed departments was still shown in the old department's subgraph. **Build incremental update pipelines, or clearly communicate the graph's freshness.**
:::

## 🎯 Checkpoint

::: details Question 1 -- Vector vs graph retrieval
**Q:** Explain with an example why vector search fails on multi-hop relational questions and how graph retrieval solves this.

**A:** Consider the question: "Who manages the person who approved the travel policy?"

Vector search embeds this question and finds chunks that are semantically similar. It might find the travel policy document (mentions "approved by Sarah Chen") and maybe a document mentioning "Sarah Chen." But it has no way to connect "Sarah Chen" to her manager -- that information might be in an HR document that is not semantically similar to the query at all.

Graph retrieval solves this by: (1) Identifying "travel policy" as an entity, (2) Following the "approved_by" edge to "Sarah Chen", (3) Following the "reports_to" edge from "Sarah Chen" to "James Rodriguez". The answer is "James Rodriguez" -- found by traversing two edges, not by semantic similarity. The key insight is that graph retrieval follows *structural connections*, while vector search relies on *semantic similarity*. Multi-hop questions require following connections that span documents with no semantic overlap.
:::

::: details Question 2 -- Graph construction cost
**Q:** You have a corpus of 50,000 documents. Estimate the cost and time to build a knowledge graph, and propose a strategy to reduce costs.

**A:** **Estimation:** Each document needs 1-2 LLM calls for entity extraction and 1 call for relationship extraction. At ~3 calls per document: 150,000 LLM calls. Using GPT-4o-mini at ~$0.001 per call: ~$150. Using GPT-4o at ~$0.01 per call: ~$1,500. Time: at 10 calls/second, ~4 hours. Entity resolution adds another pass.

**Cost reduction strategies:** (1) **Sample first:** Build the graph from a representative 5,000 documents, evaluate quality, then decide if full corpus is worth it. (2) **Tiered extraction:** Use a cheap/fast model for entity extraction (most entities are straightforward NER), use a strong model only for relationship extraction and ambiguous entities. (3) **Pre-filter documents:** Only run extraction on documents likely to contain relationships (skip boilerplate, appendices, glossaries). (4) **Batch efficiently:** Group chunks from the same document to provide more context per LLM call, reducing total calls. (5) **Incremental updates:** After initial build, only process new/changed documents.
:::

## Key Mental Models

- **Graphs capture structure, vectors capture meaning** -- use graphs when the question is about relationships, vectors when the question is about content.
- **Entity resolution is the bottleneck** -- inaccurate entity resolution makes the graph unreliable. Budget accordingly.
- **GraphRAG is an investment** -- expensive to build, expensive to maintain, but uniquely powerful for relational and global queries.
- **Hybrid is usually better than pure** -- combine graph traversal with vector search for the best of both worlds.

## Related

- [Agentic RAG](01-agentic-rag.md) -- agents can use graph search as one of their tools
- [Multimodal RAG](03-multimodal.md) -- entities can be extracted from images and tables too
- [Retrieval fundamentals](/rag/module-09/) -- the vector search that GraphRAG augments
