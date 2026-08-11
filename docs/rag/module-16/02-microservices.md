---
title: Microservices & Async Processing
outline: deep
---

# Microservices & Async Processing

Interview weight: 🔥🔥 | Prerequisites: [Full System Architecture](01-system-architecture.md), [System design fundamentals](/system-design/)

## 🗣️ In Plain English

::: tip In Plain English
Should you build your RAG system as one big application or split it into many small services? The answer depends on your team size and scaling needs. A small team ships faster with a monolith. A large team needs independent services so they do not step on each other. Either way, the ingestion pipeline should be async -- you do not want a 500-page PDF upload to block your API.
:::

## ⚙️ Under the Hood

### Service Decomposition for RAG

A production RAG system can be split along these boundaries:

```
┌──────────────────────────────────────────────────────────────┐
│                    SERVICE BOUNDARIES                         │
├──────────────┬──────────────┬──────────────┬─────────────────┤
│  API Service │  Ingestion   │  Document    │  Embedding      │
│              │  Service     │  Processing  │  Service        │
│ • REST API   │ • Accept     │ • Parse PDF  │ • Embed text    │
│ • Auth       │   uploads    │ • OCR        │ • Batch embed   │
│ • Routing    │ • Queue jobs │ • Extract    │ • Model serving │
│ • Rate limit │ • Status     │   images     │                 │
├──────────────┼──────────────┼──────────────┼─────────────────┤
│  Retrieval   │  Reranking   │  Agent       │  Evaluation     │
│  Service     │  Service     │  Service     │  Service        │
│              │              │              │                 │
│ • Vector     │ • Cross-enc  │ • Agentic    │ • Offline eval  │
│   search     │ • Score +    │   loops      │ • LLM-as-judge  │
│ • Keyword    │   reorder    │ • Tool calls │ • Metrics       │
│   search     │              │ • Routing    │   aggregation   │
│ • Hybrid     │              │              │                 │
│   merge      │              │              │                 │
└──────────────┴──────────────┴──────────────┴─────────────────┘
```

---

### Monolith vs Microservices Decision

| Factor | Monolith | Microservices |
|--------|----------|---------------|
| Team size | 1-5 engineers | 5+ engineers, multiple teams |
| Development speed (early) | Faster | Slower (infra overhead) |
| Development speed (mature) | Slower (merge conflicts, coupling) | Faster (independent deploys) |
| Operational complexity | Low (one deployment) | High (multiple services, networking) |
| Independent scaling | No (scale everything together) | Yes (scale embedding workers separately) |
| Technology flexibility | One stack | Different stacks per service |
| Debugging | Easier (single process) | Harder (distributed traces needed) |
| Data consistency | Simpler (shared DB) | Harder (eventual consistency) |

**The modular monolith compromise:**

```typescript
// run: npx tsx modular-monolith.ts

// Structure as a monolith with clear module boundaries
// Ready to split into services later if needed

// src/modules/embedding/embedding.service.ts
// src/modules/retrieval/retrieval.service.ts
// src/modules/reranking/reranking.service.ts
// src/modules/generation/generation.service.ts
// src/modules/ingestion/ingestion.service.ts
// src/modules/evaluation/evaluation.service.ts

// Each module:
// 1. Has a clear interface (public API)
// 2. Does not access other modules' database tables directly
// 3. Communicates through defined interfaces, not shared state
// 4. Can be extracted to a separate service by replacing
//    in-process calls with HTTP/gRPC calls

interface EmbeddingModule {
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
}

interface RetrievalModule {
  search(
    embedding: number[],
    options: SearchOptions,
  ): Promise<Chunk[]>;
}

// In monolith: direct function calls
// In microservices: HTTP/gRPC calls behind the same interface
```

**Recommendation by team stage:**

| Stage | Architecture | Why |
|-------|-------------|-----|
| 0-1 (prototype) | Single script / notebook | Speed to validate idea |
| 1-3 engineers | Modular monolith | Ship fast, easy debugging |
| 3-8 engineers | Monolith + async ingestion workers | Ingestion is the first service to extract |
| 8+ engineers | Microservices | Independent team ownership |

---

### Async Processing for Ingestion

The ingestion pipeline is the first component to make asynchronous, regardless of whether you use microservices:

```
Synchronous (bad):
  Upload → Parse → Chunk → Embed → Store → Response
  (blocks for 10s-2min per document)

Asynchronous (good):
  Upload → Store raw → Enqueue → Response (202 Accepted)
  (returns in < 1s)

  Worker → Dequeue → Parse → Chunk → Embed → Store → Update status
  (runs in background, scales independently)
```

**Queue → Worker pattern:**

```typescript
// run: npx tsx ingestion-worker.ts

import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL!);

// Producer: the API server enqueues jobs
const ingestionQueue = new Queue('document-ingestion', {
  connection: redis,
});

async function handleDocumentUpload(
  file: Buffer,
  metadata: DocumentMetadata,
): Promise<{ jobId: string }> {
  // 1. Store raw file in S3
  const s3Key = await uploadToS3(file, metadata.filename);

  // 2. Create metadata record
  const docId = await db.documents.create({
    ...metadata,
    s3Key,
    status: 'queued',
  });

  // 3. Enqueue processing job
  const job = await ingestionQueue.add(
    'process-document',
    { documentId: docId, s3Key },
    {
      attempts: 3,                    // retry on failure
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 1000,         // keep last 1000 completed jobs
      removeOnFail: 5000,             // keep last 5000 failed for debugging
    },
  );

  return { jobId: job.id! };
}

// Consumer: workers process jobs from the queue
const worker = new Worker(
  'document-ingestion',
  async (job) => {
    const { documentId, s3Key } = job.data;

    // Update status
    await db.documents.update(documentId, { status: 'processing' });

    try {
      // 1. Download from S3
      const fileBuffer = await downloadFromS3(s3Key);

      // 2. Parse document
      await job.updateProgress(10);
      const parsed = await parseDocument(fileBuffer);

      // 3. PII redaction
      await job.updateProgress(20);
      const redacted = await redactPII(parsed);

      // 4. Chunk
      await job.updateProgress(30);
      const chunks = chunkDocument(redacted);

      // 5. Embed (batch)
      await job.updateProgress(50);
      const embeddings = await embedBatch(chunks.map((c) => c.text));

      // 6. Store in vector DB
      await job.updateProgress(70);
      await vectorDB.upsert(
        chunks.map((chunk, i) => ({
          id: `${documentId}-${i}`,
          values: embeddings[i],
          metadata: {
            document_id: documentId,
            chunk_index: i,
            text: chunk.text,
            ...chunk.metadata,
          },
        })),
      );

      // 7. Store in Elasticsearch
      await job.updateProgress(85);
      await elasticsearch.bulk(
        chunks.map((chunk, i) => ({
          index: { _id: `${documentId}-${i}` },
          text: chunk.text,
          document_id: documentId,
          ...chunk.metadata,
        })),
      );

      // 8. Update metadata
      await job.updateProgress(95);
      await db.documents.update(documentId, {
        status: 'indexed',
        chunkCount: chunks.length,
        indexedAt: new Date(),
      });

      await job.updateProgress(100);
    } catch (error) {
      await db.documents.update(documentId, {
        status: 'failed',
        errorMessage: (error as Error).message,
      });
      throw error; // BullMQ will retry based on attempts config
    }
  },
  {
    connection: redis,
    concurrency: 5, // process 5 documents simultaneously
  },
);
```

---

### Choosing Message Queues

| Queue | Throughput | Ordering | Retry/DLQ | Managed Option | Best For |
|-------|-----------|----------|-----------|----------------|----------|
| **Kafka** | Very high (millions/s) | Per partition | Manual (consumer offset) | Confluent Cloud, AWS MSK | High-throughput event streaming, replay, audit logs |
| **RabbitMQ** | High (100K/s) | Per queue (FIFO) | Built-in DLQ, TTL | CloudAMQP, AWS Amazon MQ | Complex routing, task distribution, priority queues |
| **SQS** | High | Standard: no. FIFO: yes | Built-in DLQ, visibility timeout | AWS-native | Managed simplicity, AWS-integrated workloads |
| **BullMQ/Redis** | Medium (10K/s) | Per queue (FIFO) | Built-in retry, backoff, DLQ | Redis Cloud + BullMQ | Node.js apps, small-medium scale, rich job features |

**When to use which:**

- **BullMQ (Redis):** You are a Node.js team, scale is < 10K jobs/hour, you want rich job features (progress tracking, scheduled jobs, rate limiting, priorities) with minimal infrastructure.

- **SQS:** You are on AWS, want zero-ops queue management, and do not need complex routing or message replay.

- **RabbitMQ:** You need complex routing (fanout, topic-based), priority queues, or are running multi-language services that need a protocol-based queue (AMQP).

- **Kafka:** You need event replay (re-process all documents from last month), very high throughput (millions of events), or event sourcing. Overkill for most RAG ingestion pipelines unless you are at massive scale.

**For most RAG systems at small-to-medium scale, BullMQ is the practical choice** for Node.js teams. It provides retry, backoff, progress tracking, rate limiting, and DLQ out of the box with Redis as the only infrastructure dependency.

---

### Service Communication Patterns

| Pattern | Latency | Coupling | Use When |
|---------|---------|----------|----------|
| **Synchronous REST** | Low | High | Query path (embed → search → rerank → generate) |
| **Synchronous gRPC** | Very low | High | High-performance internal calls (embedding service) |
| **Async message queue** | Variable | Low | Ingestion, evaluation, non-blocking operations |
| **Event-driven (pub/sub)** | Variable | Very low | Document indexed → notify search, update cache |

```typescript
// run: npx tsx service-communication.ts

// Query path: synchronous (user is waiting)
// Orchestrator calls each service in sequence (or parallel where possible)
const answer = await orchestrator.query(userQuery);
// Internally:
//   await embeddingService.embed(query)        // sync HTTP/gRPC
//   await retrievalService.search(embedding)   // sync HTTP/gRPC
//   await rerankerService.rerank(query, chunks) // sync HTTP/gRPC
//   await llmService.generate(prompt)           // sync HTTP, streaming

// Ingestion path: async (user is not waiting for completion)
await ingestionQueue.add('process', { documentId });
// Worker processes in background

// Event-driven: decouple services
// When a document finishes indexing:
await eventBus.publish('document.indexed', {
  documentId,
  tenantId,
  chunkCount,
});
// Subscribers:
// - Cache invalidation service clears related query caches
// - Evaluation service schedules quality check
// - Notification service tells the user
```

---

### Independent Scaling

The key advantage of microservices: scale each component based on its specific bottleneck.

| Service | Scaling Trigger | Scaling Strategy |
|---------|----------------|-----------------|
| API Service | Request rate (QPS) | Horizontal (more pods) |
| Embedding Service | Embedding queue depth | Horizontal (more GPU/CPU pods) |
| Ingestion Workers | Queue depth | Horizontal (auto-scale on queue size) |
| Retrieval Service | Query latency | Vertical (more RAM for index) or horizontal (read replicas) |
| Reranker Service | Reranking latency | Horizontal (more model instances) |
| LLM Service | Token throughput | Horizontal (more model instances, if self-hosted) |

```typescript
// run: npx tsx k8s-scaling.ts

// Kubernetes HPA configuration concept (YAML equivalent):
const hpaConfig = {
  ingestionWorker: {
    minReplicas: 2,
    maxReplicas: 20,
    metrics: [
      {
        type: 'external',
        metric: 'bullmq_queue_waiting', // custom metric from Redis
        target: { averageValue: 10 },    // scale up if > 10 waiting jobs per worker
      },
    ],
  },
  queryService: {
    minReplicas: 3,
    maxReplicas: 15,
    metrics: [
      {
        type: 'resource',
        resource: 'cpu',
        target: { averageUtilization: 70 },
      },
      {
        type: 'pods',
        metric: 'http_request_duration_p95',
        target: { averageValue: '3s' },  // scale up if P95 > 3s
      },
    ],
  },
};
```

---

### Deployment Patterns for RAG

#### Canary Deployments for Model Changes

Changing an embedding model, LLM, or reranker affects output quality. Do not flip a switch for all users:

```
1. Deploy new model version to 5% of traffic
2. Run evaluation on both populations
3. Compare metrics (faithfulness, correctness, latency, cost)
4. If new version is better: ramp to 25% → 50% → 100%
5. If worse: roll back immediately
```

#### Blue-Green for Vector DB Migration

When changing embedding models, you need to re-embed the entire corpus:

```
1. Blue: current vector collection (old embeddings)
2. Green: new vector collection (new embeddings)
3. Re-embed entire corpus into Green (background job)
4. When Green is complete and validated:
   - Switch query traffic to Green
   - Keep Blue for 1 week (rollback)
   - Delete Blue
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Premature microservices.** A 3-person team split their RAG system into 8 microservices from day one. Each service had its own repo, CI/CD pipeline, and deployment. Debugging a single request required correlating logs across 5 services. Feature development that should have taken a day took a week. **Start with a modular monolith. Extract services when you have a concrete scaling or team-ownership reason.**

**Queue backlog during reindexing.** A team re-indexed 100,000 documents by pushing them all to the ingestion queue at once. The queue depth hit 100,000, workers were overwhelmed, and the regular document uploads from users were stuck behind the reindexing batch. **Use separate queues or priority levels for bulk operations vs user uploads. User uploads should always have priority.**

**Embedding model change without re-indexing.** A team upgraded their embedding model for better quality. New queries were embedded with the new model, but the vector DB still contained embeddings from the old model. Cosine similarity between different model families is meaningless -- retrieval quality collapsed. **Changing the embedding model requires re-embedding the entire corpus. Plan for blue-green vector DB migration.**
:::

## 🎯 Checkpoint

::: details Question 1 -- Monolith vs microservices
**Q:** You are the tech lead for a 4-person team building a RAG system expected to serve 10,000 queries/day. Would you start with microservices? What would trigger you to split?

**A:** **Start with a modular monolith.** At 4 people and 10K queries/day (~0.12 QPS), there is no scaling need that justifies microservices overhead. A single Node.js process can handle this load easily. The team is too small for service ownership -- everyone touches everything anyway.

**Architecture:** One NestJS application with clear modules (embedding, retrieval, reranking, generation, ingestion). One PostgreSQL database. One Redis instance (cache + BullMQ). One vector DB (pgvector in the same PostgreSQL, or managed Pinecone). Ingestion workers as separate processes (same codebase, different entry point) consuming from BullMQ.

**Triggers to split:**
- **Ingestion workers need GPU** but query servers do not → extract embedding service
- **Team grows to 6+** and two sub-teams form → split along team boundaries
- **Query latency spikes during ingestion** because they share CPU → separate processes/pods
- **Need different scaling profiles** (10x more ingestion workers during bulk import) → extract ingestion service
- **Need different deployment cadence** (retrieval team deploys daily, LLM team deploys weekly) → extract along deployment boundaries
:::

::: details Question 2 -- Queue selection
**Q:** Compare BullMQ and SQS for a RAG ingestion pipeline processing 50,000 documents/day. Which would you choose and why?

**A:** **50K docs/day = ~0.6 jobs/second average, maybe 5/s peak.** Both handle this easily.

**BullMQ advantages for this use case:** (1) Rich job features out of the box -- progress tracking (show users "50% processed"), rate limiting (do not exceed embedding API limits), job priorities, scheduled/delayed jobs, repeatable jobs. (2) Same language (TypeScript) -- workers and API share code, types, and data models. (3) Lower latency -- Redis is in-process or on the same network, no AWS API call overhead. (4) Dashboard (Bull Board) for monitoring jobs. (5) No AWS vendor lock-in.

**SQS advantages:** (1) Zero operational burden -- no Redis to manage, no scaling to configure. (2) Built-in DLQ with redrive. (3) Scales to any throughput without intervention. (4) If already on AWS with other services, it is the natural choice.

**Recommendation:** For a Node.js team at 50K docs/day, **BullMQ**. The rich job features (progress, priorities, rate limiting) are very useful for document ingestion, and the operational burden of Redis is low (managed Redis services exist). Choose SQS if you are already heavily invested in AWS and want to minimize operational surface.
:::

## Key Mental Models

- **Start monolith, extract when you must** -- premature microservices slow small teams. Extract services when you have a concrete reason (scaling, team ownership, different technology needs).
- **Ingestion is always async** -- it is the first thing to decouple, regardless of architecture style.
- **Queues decouple pace from processing** -- the API accepts documents at user speed, workers process at their own speed. Queue depth is your backlog metric.
- **Changing embedding models = re-indexing everything** -- plan for this from day one. Blue-green vector DB migration is the safe approach.

## Related

- [Full System Architecture](01-system-architecture.md) -- the components these services implement
- [Evaluation](/rag/module-13/) -- the evaluation service in the architecture
- [Security](/rag/module-14/) -- how security controls map to service boundaries
