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

```python
# run: python idempotent_ingestion.py

import hashlib
from datetime import datetime, timezone


def content_hash(text: str) -> str:
    """Deterministic hash of document content."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def idempotent_upsert(
    doc_id: str,
    content: str,
    vector_db,
    embedder,
    chunker,
) -> str:
    """Upsert with content-hash deduplication.

    Returns: 'indexed', 'skipped' (already exists), or 'updated'
    """
    new_hash = content_hash(content)

    # Check if this exact content is already indexed
    existing = vector_db.get_metadata(
        filter={"doc_id": doc_id},
        fields=["content_hash"],
    )

    if existing and existing["content_hash"] == new_hash:
        return "skipped"  # Exact same content, no work needed

    action = "updated" if existing else "indexed"

    # Delete old chunks for this doc (if any)
    vector_db.delete(filter={"doc_id": doc_id})

    # Process and insert new chunks
    chunks = chunker(content)
    embeddings = embedder([c.text for c in chunks])

    vector_db.upsert(
        ids=[f"{doc_id}::chunk::{i}" for i in range(len(chunks))],
        embeddings=embeddings,
        documents=[c.text for c in chunks],
        metadatas=[{
            "doc_id": doc_id,
            "content_hash": new_hash,
            "chunk_index": i,
            "total_chunks": len(chunks),
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        } for i in range(len(chunks))],
    )

    return action
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

```python
# run: python retry_strategy.py

import asyncio
import random
from functools import wraps
from typing import TypeVar, Callable, Any

T = TypeVar("T")


def with_retry(
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 60.0,
    retryable_exceptions: tuple[type[Exception], ...] = (
        ConnectionError,
        TimeoutError,
    ),
):
    """Decorator for exponential backoff with jitter."""

    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            last_exception: Exception | None = None

            for attempt in range(max_retries + 1):
                try:
                    return await func(*args, **kwargs)
                except retryable_exceptions as e:
                    last_exception = e
                    if attempt == max_retries:
                        break

                    # Exponential backoff: 1s, 2s, 4s, 8s...
                    delay = min(base_delay * (2 ** attempt), max_delay)
                    # Add jitter: +/- 25%
                    jitter = delay * 0.25 * (2 * random.random() - 1)
                    actual_delay = delay + jitter

                    print(
                        f"Attempt {attempt + 1} failed: {e}. "
                        f"Retrying in {actual_delay:.1f}s"
                    )
                    await asyncio.sleep(actual_delay)

            raise last_exception  # type: ignore[misc]

        return wrapper  # type: ignore[return-value]
    return decorator


class RateLimitError(Exception):
    """Embedding API rate limit hit."""
    def __init__(self, retry_after: float = 60.0):
        self.retry_after = retry_after


@with_retry(
    max_retries=5,
    base_delay=2.0,
    retryable_exceptions=(ConnectionError, TimeoutError, RateLimitError),
)
async def embed_with_retry(texts: list[str]) -> list[list[float]]:
    """Embed texts with automatic retry on transient failures."""
    response = await embedding_api.embed(texts)
    return response.embeddings
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

```python
# run: python dlq_handler.py

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum


class FailureReason(Enum):
    PARSE_ERROR = "parse_error"           # Corrupted or unsupported file
    EMBED_ERROR = "embed_error"           # Embedding API failure
    VECTOR_DB_ERROR = "vector_db_error"   # Vector DB write failure
    TIMEOUT = "timeout"                   # Processing took too long
    OOM = "out_of_memory"                 # File too large for worker memory
    UNKNOWN = "unknown"


@dataclass
class DLQEntry:
    doc_id: str
    s3_path: str
    failure_reason: FailureReason
    error_message: str
    attempts: int
    first_failed_at: datetime
    last_failed_at: datetime
    metadata: dict = field(default_factory=dict)


class DeadLetterQueue:
    """Dead letter queue with inspection and retry capabilities."""

    def __init__(self, storage):
        self.storage = storage

    async def add(self, entry: DLQEntry) -> None:
        """Add a failed document to the DLQ."""
        await self.storage.put(entry.doc_id, entry)
        # Alert if DLQ is growing
        dlq_size = await self.storage.count()
        if dlq_size > 100:
            await self.alert(
                f"DLQ size is {dlq_size}. "
                f"Latest failure: {entry.failure_reason.value}"
            )

    async def inspect(
        self,
        reason: FailureReason | None = None,
    ) -> list[DLQEntry]:
        """List DLQ entries, optionally filtered by failure reason."""
        entries = await self.storage.list()
        if reason:
            entries = [e for e in entries if e.failure_reason == reason]
        return entries

    async def retry(self, doc_id: str, queue) -> None:
        """Move a DLQ entry back to the main processing queue."""
        entry = await self.storage.get(doc_id)
        if entry:
            await queue.enqueue(
                "process_document",
                doc_id=entry.doc_id,
                s3_path=entry.s3_path,
            )
            await self.storage.delete(doc_id)

    async def retry_all(
        self,
        reason: FailureReason,
        queue,
    ) -> int:
        """Retry all DLQ entries with a specific failure reason.

        Useful after fixing a systemic issue (e.g., embedding API
        was down, now it's back).
        """
        entries = await self.inspect(reason=reason)
        for entry in entries:
            await self.retry(entry.doc_id, queue)
        return len(entries)
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

```python
# Document update flow

async def handle_document_update(
    doc_id: str,
    new_content: str,
    vector_db,
    embedder,
    chunker,
) -> dict[str, str]:
    """Handle a document update: delete old chunks, insert new."""
    new_hash = content_hash(new_content)

    # Check if content actually changed
    existing = await vector_db.get_metadata(
        filter={"doc_id": doc_id},
        fields=["content_hash"],
    )

    if existing and existing.get("content_hash") == new_hash:
        return {"action": "skipped", "reason": "content_unchanged"}

    # Delete old chunks atomically
    deleted_count = await vector_db.delete(filter={"doc_id": doc_id})

    # Insert new chunks
    chunks = chunker(new_content)
    embeddings = await embedder([c.text for c in chunks])
    await vector_db.upsert(
        ids=[f"{doc_id}::chunk::{i}" for i in range(len(chunks))],
        embeddings=embeddings,
        documents=[c.text for c in chunks],
        metadatas=[{
            "doc_id": doc_id,
            "content_hash": new_hash,
            "chunk_index": i,
            "version": (existing.get("version", 0) + 1) if existing else 1,
            "indexed_at": datetime.now(timezone.utc).isoformat(),
        } for i in range(len(chunks))],
    )

    return {
        "action": "updated",
        "old_chunks_deleted": deleted_count,
        "new_chunks_inserted": len(chunks),
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

```python
# Blue-green re-index

async def blue_green_reindex(
    vector_db,
    source,
    embedder,
    chunker,
    current_collection: str = "docs-v1",
    new_collection: str = "docs-v2",
) -> dict:
    """Zero-downtime re-index using blue-green swap."""

    # 1. Create new collection with updated config
    await vector_db.create_collection(
        name=new_collection,
        embedding_dimension=1536,  # might be different with new model
    )

    # 2. Re-index all documents into new collection
    all_docs = await source.list_all()
    errors = []

    for doc in all_docs:
        try:
            chunks = chunker(doc.content)
            embeddings = await embedder([c.text for c in chunks])
            await vector_db.upsert(
                collection=new_collection,
                ids=[f"{doc.id}::chunk::{i}" for i in range(len(chunks))],
                embeddings=embeddings,
                documents=[c.text for c in chunks],
                metadatas=[{"doc_id": doc.id, "chunk_index": i}
                           for i in range(len(chunks))],
            )
        except Exception as e:
            errors.append({"doc_id": doc.id, "error": str(e)})

    # 3. Verify new index (run test queries, compare results)
    validation_passed = await validate_index(new_collection)

    if not validation_passed or len(errors) > len(all_docs) * 0.01:
        # More than 1% errors or validation failed — abort
        await vector_db.delete_collection(new_collection)
        raise RuntimeError(
            f"Re-index failed: {len(errors)} errors, "
            f"validation={'passed' if validation_passed else 'FAILED'}"
        )

    # 4. Swap the alias (atomic — queries switch instantly)
    await vector_db.update_alias(
        alias="production",
        collection=new_collection,
    )

    # 5. Keep old collection for rollback (delete after 24h)
    # await vector_db.delete_collection(current_collection)  # later

    return {
        "documents_indexed": len(all_docs) - len(errors),
        "errors": len(errors),
        "old_collection": current_collection,
        "new_collection": new_collection,
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

```python
# run: python monitoring.py

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class IngestionMetrics:
    """Metrics collected during document processing."""
    doc_id: str
    started_at: float = field(default_factory=time.monotonic)

    parse_duration_ms: float = 0
    chunk_duration_ms: float = 0
    embed_duration_ms: float = 0
    upsert_duration_ms: float = 0
    total_duration_ms: float = 0

    chunk_count: int = 0
    token_count: int = 0
    status: str = "processing"
    error: str | None = None

    def record_stage(self, stage: str, duration_ms: float) -> None:
        setattr(self, f"{stage}_duration_ms", duration_ms)

    def finalize(self, status: str = "success", error: str | None = None) -> None:
        self.total_duration_ms = (time.monotonic() - self.started_at) * 1000
        self.status = status
        self.error = error

    def to_log_dict(self) -> dict:
        """Structured log entry for monitoring."""
        return {
            "event": "document_ingested",
            "doc_id": self.doc_id,
            "status": self.status,
            "total_duration_ms": round(self.total_duration_ms, 1),
            "parse_ms": round(self.parse_duration_ms, 1),
            "chunk_ms": round(self.chunk_duration_ms, 1),
            "embed_ms": round(self.embed_duration_ms, 1),
            "upsert_ms": round(self.upsert_duration_ms, 1),
            "chunks": self.chunk_count,
            "tokens": self.token_count,
            "error": self.error,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


# Usage in the worker:
async def process_with_metrics(doc_id: str, content: str):
    metrics = IngestionMetrics(doc_id=doc_id)

    try:
        t0 = time.monotonic()
        parsed = parse(content)
        metrics.record_stage("parse", (time.monotonic() - t0) * 1000)

        t0 = time.monotonic()
        chunks = chunk(parsed)
        metrics.record_stage("chunk", (time.monotonic() - t0) * 1000)
        metrics.chunk_count = len(chunks)

        t0 = time.monotonic()
        embeddings = await embed(chunks)
        metrics.record_stage("embed", (time.monotonic() - t0) * 1000)

        t0 = time.monotonic()
        await vector_db.upsert(chunks, embeddings)
        metrics.record_stage("upsert", (time.monotonic() - t0) * 1000)

        metrics.finalize(status="success")

    except Exception as e:
        metrics.finalize(status="error", error=str(e))
        raise

    finally:
        # Emit structured log (picked up by monitoring system)
        logger.info(metrics.to_log_dict())
        # Emit Prometheus metrics
        ingestion_duration.observe(metrics.total_duration_ms / 1000)
        ingestion_chunks.observe(metrics.chunk_count)
        ingestion_errors.labels(stage=metrics.status).inc()
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
