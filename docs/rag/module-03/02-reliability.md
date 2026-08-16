---
title: Reliability & Monitoring
outline: deep
---

# Reliability & Monitoring

**Interview weight:** 🔥🔥 | **Prerequisites:** [Ingestion Pipelines](01-ingestion-pipelines.md) | **Builds toward:** [Parsing Every Format](../module-04/01-parsing-formats.md)

## 🗣️ In Plain English

::: tip In Plain English
Picture a mailroom that handles thousands of letters daily. A reliable mailroom never loses a letter, never delivers the same letter twice, and when a clerk drops a tray, every scattered letter gets picked up and re-sorted — not silently swept under the rug. That is what reliability engineering does for your ingestion pipeline: it makes every failure visible, every delivery exactly-once, and every dropped document recoverable.
:::

## ⚙️ Under the Hood

### Idempotency: Process Once, No Matter How Many Times You Try

An idempotent operation produces the same result whether you run it once or ten times. This is critical because queues deliver at-least-once — your worker *will* see duplicate messages.

**The content hash pattern:**

```typescript
// run: npx tsx idempotent_ingestion.ts

import { createHash } from "node:crypto";

interface Chunk {
  text: string;
}

function contentHash(text: string): string {
  /** Deterministic hash of document content. */
  return createHash("sha256").update(text, "utf-8").digest("hex");
}

async function idempotentUpsert(
  docId: string,
  content: string,
  vectorDb: any,
  embedder: (texts: string[]) => Promise<number[][]>,
  chunker: (content: string) => Chunk[],
): Promise<"indexed" | "skipped" | "updated"> {
  /**
   * Upsert with content-hash deduplication.
   * Returns: 'indexed', 'skipped' (already exists), or 'updated'
   */
  const newHash = contentHash(content);

  // Check if this exact content is already indexed
  const existing = await vectorDb.getMetadata({
    filter: { doc_id: docId },
    fields: ["content_hash"],
  });

  if (existing && existing.content_hash === newHash) {
    return "skipped"; // Exact same content, no work needed
  }

  const action: "indexed" | "updated" = existing ? "updated" : "indexed";

  // Delete old chunks for this doc (if any)
  await vectorDb.delete({ filter: { doc_id: docId } });

  // Process and insert new chunks
  const chunks = chunker(content);
  const embeddings = await embedder(chunks.map((c) => c.text));

  await vectorDb.upsert({
    ids: chunks.map((_, i) => `${docId}::chunk::${i}`),
    embeddings,
    documents: chunks.map((c) => c.text),
    metadatas: chunks.map((_, i) => ({
      doc_id: docId,
      content_hash: newHash,
      chunk_index: i,
      total_chunks: chunks.length,
      indexed_at: new Date().toISOString(),
    })),
  });

  return action;
}
```

**Why content hash, not document ID?** A document can be updated (same ID, different content). The content hash detects actual changes. If the content is identical, skip re-embedding — it wastes money and produces identical vectors.

### Retry Strategies

Not all failures are equal. The retry strategy must match the failure type:

| Failure Type | Example | Retry? | Strategy |
|-------------|---------|--------|----------|
| **Transient** | Network timeout, 503, rate limit (429) | Yes | Exponential backoff with jitter |
| **Permanent** | Corrupted file, unsupported format, 400 | No | Send to DLQ immediately |
| **Partial** | Embedded 8/10 chunks, then API error | Yes | Resume from checkpoint, not restart |
| **Resource** | Out of memory on large PDF | Maybe | Retry with smaller batch or more memory |

```typescript
// run: npx tsx retry_strategy.ts

function withRetry<T>(
  options: {
    maxRetries?: number;
    baseDelay?: number;
    maxDelay?: number;
    retryableErrors?: (err: unknown) => boolean;
  } = {},
) {
  /** Decorator factory for exponential backoff with jitter. */
  const {
    maxRetries = 3,
    baseDelay = 1.0,
    maxDelay = 60.0,
    retryableErrors = (err) =>
      err instanceof Error &&
      ("code" in err || err.message.includes("timeout") || err.message.includes("ECONNRESET")),
  } = options;

  return function decorator(
    fn: (...args: any[]) => Promise<T>,
  ): (...args: any[]) => Promise<T> {
    return async function wrapper(...args: any[]): Promise<T> {
      let lastError: unknown = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          return await fn(...args);
        } catch (err) {
          lastError = err;
          if (!retryableErrors(err) || attempt === maxRetries) break;

          // Exponential backoff: 1s, 2s, 4s, 8s...
          const delay = Math.min(baseDelay * 2 ** attempt, maxDelay);
          // Add jitter: +/- 25%
          const jitter = delay * 0.25 * (2 * Math.random() - 1);
          const actualDelay = delay + jitter;

          console.log(
            `Attempt ${attempt + 1} failed: ${err}. Retrying in ${actualDelay.toFixed(1)}s`,
          );
          await new Promise((r) => setTimeout(r, actualDelay * 1000));
        }
      }

      throw lastError;
    };
  };
}

class RateLimitError extends Error {
  retryAfter: number;
  constructor(retryAfter = 60.0) {
    super("Rate limit hit");
    this.retryAfter = retryAfter;
  }
}

const embedWithRetry = withRetry<number[][]>({
  maxRetries: 5,
  baseDelay: 2.0,
  retryableErrors: (err) =>
    err instanceof RateLimitError ||
    err instanceof TypeError ||
    (err instanceof Error && err.message.includes("timeout")),
})(async function embedWithRetry(texts: string[]): Promise<number[][]> {
  /** Embed texts with automatic retry on transient failures. */
  const response = await embeddingApi.embed(texts);
  return response.embeddings;
});
```

**Why jitter matters:** Without jitter, all workers that hit a rate limit at the same time will retry at the same time, causing a "thundering herd" that hits the rate limit again. Jitter spreads retries across time.

### Dead-Letter Queues (DLQ)

A DLQ captures messages that failed all retry attempts. It is the safety net that prevents silent data loss.

```text
Normal Flow:
  Queue ──► Worker ──► Success ──► Vector DB

Failure Flow:
  Queue ──► Worker ──► Fail ──► Retry (1) ──► Fail ──► Retry (2)
    ──► Fail ──► Retry (3) ──► Fail ──► DLQ

DLQ Handling:
  DLQ ──► Alert ──► Engineer inspects ──► Fix ──► Re-queue
                                     or ──► Delete (permanent failure)
```

```typescript
// run: npx tsx dlq_handler.ts

type FailureReason =
  | "parse_error"       // Corrupted or unsupported file
  | "embed_error"       // Embedding API failure
  | "vector_db_error"   // Vector DB write failure
  | "timeout"           // Processing took too long
  | "out_of_memory"     // File too large for worker memory
  | "unknown";

interface DLQEntry {
  docId: string;
  s3Path: string;
  failureReason: FailureReason;
  errorMessage: string;
  attempts: number;
  firstFailedAt: Date;
  lastFailedAt: Date;
  metadata: Record<string, unknown>;
}

class DeadLetterQueue {
  /** Dead letter queue with inspection and retry capabilities. */
  private storage: any;

  constructor(storage: any) {
    this.storage = storage;
  }

  async add(entry: DLQEntry): Promise<void> {
    /** Add a failed document to the DLQ. */
    await this.storage.put(entry.docId, entry);
    // Alert if DLQ is growing
    const dlqSize = await this.storage.count();
    if (dlqSize > 100) {
      await this.alert(
        `DLQ size is ${dlqSize}. Latest failure: ${entry.failureReason}`,
      );
    }
  }

  async inspect(reason?: FailureReason): Promise<DLQEntry[]> {
    /** List DLQ entries, optionally filtered by failure reason. */
    let entries: DLQEntry[] = await this.storage.list();
    if (reason) {
      entries = entries.filter((e) => e.failureReason === reason);
    }
    return entries;
  }

  async retry(docId: string, queue: any): Promise<void> {
    /** Move a DLQ entry back to the main processing queue. */
    const entry: DLQEntry | null = await this.storage.get(docId);
    if (entry) {
      await queue.add("process_document", {
        docId: entry.docId,
        s3Path: entry.s3Path,
      });
      await this.storage.delete(docId);
    }
  }

  async retryAll(reason: FailureReason, queue: any): Promise<number> {
    /**
     * Retry all DLQ entries with a specific failure reason.
     * Useful after fixing a systemic issue (e.g., embedding API
     * was down, now it's back).
     */
    const entries = await this.inspect(reason);
    for (const entry of entries) {
      await this.retry(entry.docId, queue);
    }
    return entries.length;
  }

  private async alert(message: string): Promise<void> {
    console.warn(`[DLQ ALERT] ${message}`);
  }
}
```

### Document Versioning

Documents change. The versioning strategy determines how updates and deletes are handled.

| Strategy | How It Works | Pros | Cons |
|----------|-------------|------|------|
| **Replace-on-update** | Delete old chunks, insert new | Simple, always current | Brief window of missing data during re-index |
| **Version field** | Add `version` to metadata, query latest | History preserved | Duplicates in index, must filter |
| **Tombstone** | Mark deleted docs as `is_deleted=true`, filter at query time | Audit trail, no data loss | Index bloat, filter overhead |
| **Hard delete** | Remove chunks entirely | Clean index | No recovery if mistake |
| **Blue-green index** | Build new index alongside old, swap atomically | Zero-downtime re-index | 2x storage during swap |

**Recommended for most cases: replace-on-update with content hashing.** On update, delete all chunks with the document's ID, then insert new chunks. The content hash skips re-processing if nothing changed.

```typescript
// Document update flow

interface Chunk {
  text: string;
}

async function handleDocumentUpdate(
  docId: string,
  newContent: string,
  vectorDb: any,
  embedder: (texts: string[]) => Promise<number[][]>,
  chunker: (content: string) => Chunk[],
): Promise<Record<string, string | number>> {
  /** Handle a document update: delete old chunks, insert new. */
  const newHash = contentHash(newContent);

  // Check if content actually changed
  const existing = await vectorDb.getMetadata({
    filter: { doc_id: docId },
    fields: ["content_hash"],
  });

  if (existing && existing.content_hash === newHash) {
    return { action: "skipped", reason: "content_unchanged" };
  }

  // Delete old chunks atomically
  const deletedCount = await vectorDb.delete({ filter: { doc_id: docId } });

  // Insert new chunks
  const chunks = chunker(newContent);
  const embeddings = await embedder(chunks.map((c) => c.text));
  await vectorDb.upsert({
    ids: chunks.map((_, i) => `${docId}::chunk::${i}`),
    embeddings,
    documents: chunks.map((c) => c.text),
    metadatas: chunks.map((_, i) => ({
      doc_id: docId,
      content_hash: newHash,
      chunk_index: i,
      version: existing ? (existing.version ?? 0) + 1 : 1,
      indexed_at: new Date().toISOString(),
    })),
  });

  return {
    action: "updated",
    old_chunks_deleted: deletedCount,
    new_chunks_inserted: chunks.length,
  };
}
```

### Re-Indexing Strategies

Sometimes you need to re-index everything: new embedding model, new chunking strategy, schema changes.

| Strategy | How | Downtime | Risk |
|----------|-----|----------|------|
| **In-place re-index** | Overwrite existing vectors | Degraded during processing | Partial index if it fails midway |
| **Blue-green swap** | Build new collection, swap alias | Zero | 2x storage temporarily |
| **Rolling re-index** | Process N docs at a time, replace gradually | None | Mixed old/new embeddings during transition |

**Blue-green is the production standard:**

```text
Phase 1: Build new index alongside old

  [collection-v1] ◄── queries go here (alias: "production")
  [collection-v2] ◄── ingestion builds this (no queries yet)

Phase 2: Swap the alias

  [collection-v1]     (no longer receiving queries)
  [collection-v2] ◄── queries go here (alias: "production")

Phase 3: Delete old index

  [collection-v2] ◄── queries go here (alias: "production")
```

```typescript
// run: npx tsx blue_green_reindex.ts
// Blue-green re-index

interface Chunk {
  text: string;
}

interface DocSource {
  id: string;
  content: string;
}

async function blueGreenReindex(
  vectorDb: any,
  source: any,
  embedder: (texts: string[]) => Promise<number[][]>,
  chunker: (content: string) => Chunk[],
  currentCollection = "docs-v1",
  newCollection = "docs-v2",
): Promise<Record<string, unknown>> {
  /** Zero-downtime re-index using blue-green swap. */

  // 1. Create new collection with updated config
  await vectorDb.createCollection({
    name: newCollection,
    embeddingDimension: 1536, // might be different with new model
  });

  // 2. Re-index all documents into new collection
  const allDocs: DocSource[] = await source.listAll();
  const errors: { docId: string; error: string }[] = [];

  for (const doc of allDocs) {
    try {
      const chunks = chunker(doc.content);
      const embeddings = await embedder(chunks.map((c) => c.text));
      await vectorDb.upsert({
        collection: newCollection,
        ids: chunks.map((_, i) => `${doc.id}::chunk::${i}`),
        embeddings,
        documents: chunks.map((c) => c.text),
        metadatas: chunks.map((_, i) => ({ doc_id: doc.id, chunk_index: i })),
      });
    } catch (e) {
      errors.push({ docId: doc.id, error: String(e) });
    }
  }

  // 3. Verify new index (run test queries, compare results)
  const validationPassed = await validateIndex(newCollection);

  if (!validationPassed || errors.length > allDocs.length * 0.01) {
    // More than 1% errors or validation failed — abort
    await vectorDb.deleteCollection(newCollection);
    throw new Error(
      `Re-index failed: ${errors.length} errors, ` +
      `validation=${validationPassed ? "passed" : "FAILED"}`,
    );
  }

  // 4. Swap the alias (atomic — queries switch instantly)
  await vectorDb.updateAlias({
    alias: "production",
    collection: newCollection,
  });

  // 5. Keep old collection for rollback (delete after 24h)
  // await vectorDb.deleteCollection(currentCollection); // later

  return {
    documents_indexed: allDocs.length - errors.length,
    errors: errors.length,
    old_collection: currentCollection,
    new_collection: newCollection,
  };
}
```

### Monitoring: The Metrics That Matter

| Metric | What It Tells You | Alert Threshold |
|--------|------------------|----------------|
| **Queue depth** | Are workers keeping up? | Depth growing for >10 min |
| **Processing latency (P50/P95)** | How long does each document take? | P95 > 2x normal |
| **Error rate** | % of documents failing | >1% sustained |
| **DLQ size** | How many documents permanently failed? | >0 (investigate every entry) |
| **Ingestion lag** | Time from document update to searchable | Exceeds freshness SLA |
| **Embedding throughput** | Tokens/second being embedded | Below capacity (workers idle or rate-limited) |
| **Chunk count per doc** | Is chunking behaving as expected? | Sudden change in average (chunker bug) |
| **Index size** | How many vectors in the DB? | Unexpected growth or shrinkage |
| **Content hash collision** | Are duplicates being detected? | Collision rate too high (hash bug) or too low (dedup not working) |

```typescript
// run: npx tsx monitoring.ts

class IngestionMetrics {
  /** Metrics collected during document processing. */
  docId: string;
  startedAt: number;

  parseDurationMs = 0;
  chunkDurationMs = 0;
  embedDurationMs = 0;
  upsertDurationMs = 0;
  totalDurationMs = 0;

  chunkCount = 0;
  tokenCount = 0;
  status = "processing";
  error: string | null = null;

  constructor(docId: string) {
    this.docId = docId;
    this.startedAt = performance.now();
  }

  recordStage(stage: "parse" | "chunk" | "embed" | "upsert", durationMs: number): void {
    (this as any)[`${stage}DurationMs`] = durationMs;
  }

  finalize(status = "success", error: string | null = null): void {
    this.totalDurationMs = performance.now() - this.startedAt;
    this.status = status;
    this.error = error;
  }

  toLogDict(): Record<string, unknown> {
    /** Structured log entry for monitoring. */
    return {
      event: "document_ingested",
      doc_id: this.docId,
      status: this.status,
      total_duration_ms: Math.round(this.totalDurationMs * 10) / 10,
      parse_ms: Math.round(this.parseDurationMs * 10) / 10,
      chunk_ms: Math.round(this.chunkDurationMs * 10) / 10,
      embed_ms: Math.round(this.embedDurationMs * 10) / 10,
      upsert_ms: Math.round(this.upsertDurationMs * 10) / 10,
      chunks: this.chunkCount,
      tokens: this.tokenCount,
      error: this.error,
      timestamp: new Date().toISOString(),
    };
  }
}

// Usage in the worker:
async function processWithMetrics(docId: string, content: string): Promise<void> {
  const metrics = new IngestionMetrics(docId);

  try {
    let t0 = performance.now();
    const parsed = parse(content);
    metrics.recordStage("parse", performance.now() - t0);

    t0 = performance.now();
    const chunks = chunk(parsed);
    metrics.recordStage("chunk", performance.now() - t0);
    metrics.chunkCount = chunks.length;

    t0 = performance.now();
    const embeddings = await embed(chunks);
    metrics.recordStage("embed", performance.now() - t0);

    t0 = performance.now();
    await vectorDb.upsert(chunks, embeddings);
    metrics.recordStage("upsert", performance.now() - t0);

    metrics.finalize("success");

  } catch (e) {
    metrics.finalize("error", String(e));
    throw e;

  } finally {
    // Emit structured log (picked up by monitoring system)
    logger.info(metrics.toLogDict());
    // Emit Prometheus metrics
    ingestionDuration.observe(metrics.totalDurationMs / 1000);
    ingestionChunks.observe(metrics.chunkCount);
    ingestionErrors.labels({ stage: metrics.status }).inc();
  }
}
```

### Backfilling: Adding a New Field or New Model

When you change the embedding model, add a metadata field, or change the chunking strategy, you need to backfill existing documents.

```text
Backfill Scenarios:

1. New embedding model
   - Must re-embed ALL documents (old and new embeddings are incompatible)
   - Use blue-green re-index

2. New metadata field (e.g., adding "department" to all chunks)
   - Can update in-place (no re-embedding needed)
   - Iterate over all chunks, add the field

3. New chunking strategy
   - Must re-chunk AND re-embed all documents
   - Use blue-green re-index

4. Fix parsing bug (some PDFs were parsed incorrectly)
   - Identify affected documents (e.g., by source format)
   - Re-process only affected documents
   - Use incremental re-index
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Non-idempotent ingestion creates ghost duplicates.**
The worker processes a document, inserts 10 chunks, then crashes before acknowledging the queue message. The queue redelivers. The worker processes again, inserting 10 more chunks. Now there are 20 chunks for one document. Search returns duplicate results. Symptom: same passage appears twice in retrieval results. Fix: use content-hash-based deduplication and always delete-then-insert (not just insert).

**2. Blue-green re-index without validation.**
Team swaps to a new collection without running test queries. The new embedding model produces vectors in a different dimension. All queries return garbage. Symptom: sudden drop in answer quality after re-index. Fix: run a validation suite (known queries with expected results) against the new collection before swapping the alias.

**3. No monitoring on ingestion lag.**
The webhook fires but the worker is down (deployment gone wrong). Documents are queued but not processed. No alert fires because the team only monitors error rates (which are zero — nothing is erroring, just nothing is running). Symptom: users report "the system doesn't know about the document I uploaded yesterday." Fix: monitor ingestion lag (time since last successful processing) and queue depth, not just error rates.

:::

## 🎯 Checkpoint

::: details Question 1 — Idempotency design
**Q:** Your ingestion worker receives the same document ID twice (at-least-once delivery). Describe exactly what happens in a well-designed pipeline, step by step. What if the content changed between the two deliveries?

**A:** Step 1: Worker receives message with doc_id and s3_path. Step 2: Download document from S3, compute content hash. Step 3: Query vector DB for existing metadata with this doc_id. Step 4a: If content hash matches → skip, acknowledge message. Step 4b: If content hash differs or doc_id not found → delete all existing chunks for this doc_id (if any), chunk the document, embed, upsert new chunks with the new content hash. Step 5: Acknowledge the queue message. If the content changed between two deliveries: the second delivery downloads the newer version from S3 (since S3 has the latest), computes a different hash, detects the change, and re-indexes. The key invariant: after processing, the index always reflects the latest content from S3, regardless of how many times the message was delivered.
:::

::: details Question 2 — Re-indexing strategy
**Q:** You need to switch from `text-embedding-ada-002` (1536 dimensions) to `text-embedding-3-large` (3072 dimensions) for your production RAG system with 5M vectors. Walk through the steps and risks.

**A:** You cannot mix embeddings from different models in the same collection (different dimensions, different vector spaces — cosine similarity across models is meaningless). Steps: (1) Create a new collection with 3072 dimensions (collection-v2). (2) Re-embed all source documents with the new model. At 5M vectors and ~500 tokens per chunk, that is ~2.5B tokens of embedding. At text-embedding-3-large pricing ($0.13/M tokens), that costs ~$325. Time: at 3000 RPM and 100 chunks per request, ~17 hours. (3) Run validation queries against collection-v2 and compare answer quality to collection-v1. (4) Swap the alias from collection-v1 to collection-v2 (zero downtime). (5) Keep collection-v1 for 7 days as rollback. Risks: the new model might not improve quality (validate first), the re-embedding cost is non-trivial, and during the 17-hour re-index, new documents must be embedded with BOTH models (write to both collections) to avoid a gap.
:::

## Key Mental Models

- **Idempotency = content hash + delete-then-insert.** The same document processed twice must produce the same index state. Content hashing skips unchanged documents; delete-then-insert prevents duplicates.
- **Every failure needs a destination.** Retryable failures get exponential backoff. Permanent failures go to the DLQ. Nothing should be silently dropped.
- **Blue-green is the production re-index pattern.** Build the new index alongside the old, validate, swap atomically. Never re-index in place unless you can tolerate degraded service.
- **Monitor lag, not just errors.** A worker that is down produces zero errors but infinite lag. Queue depth and ingestion lag are the primary health signals.
- **Jitter prevents thundering herds.** Add randomness to all retry delays. Without it, concurrent failures synchronize their retries and amplify the original problem.

## Related

- [Ingestion Pipelines](01-ingestion-pipelines.md) — the pipeline architecture that this page makes reliable
- [Designing Before Building](../module-02/01-requirements.md) — freshness and availability requirements drive these reliability decisions
- [Parsing Every Format](../module-04/01-parsing-formats.md) — the parsing stage where many ingestion failures originate
