---
title: Module 3 Summary — Data Ingestion
outline: deep
---

# Module 3 Summary — Data Ingestion

## Mental Models to Carry Forward

1. **Store before you queue.** Persist documents to durable storage (S3) before putting messages on the queue. The queue message is a pointer, not a payload. Lost messages are retryable; lost documents are not.

2. **Match the pattern to the freshness SLA.** Days → batch cron. Hours → incremental with change detection. Minutes → event-driven with queue. Seconds → streaming (Kafka). Over-engineering freshness wastes money; under-engineering it breaks trust.

3. **Idempotency is content hash + delete-then-insert.** Same document processed twice = same index state. Content hashing skips unchanged documents. Delete-then-insert prevents duplicates on retry.

4. **Every failure needs a destination.** Transient failures get exponential backoff with jitter. Permanent failures go to the DLQ. Nothing is silently dropped. The DLQ is inspected, not ignored.

5. **Monitor lag, not just errors.** A down worker produces zero errors but infinite lag. Queue depth and ingestion lag (time from document change to searchable) are the primary health signals.

6. **Blue-green is the production re-index pattern.** Build new index, validate with test queries, swap alias atomically. Never re-index in place for production workloads.

7. **Bulk and real-time are separate pipelines.** Initial data loads, backfills, and ongoing updates have different throughput, priority, and failure needs. Do not mix them.

## Self-Assessment Checklist

Before moving to Module 4, you should be able to:

- [ ] Choose between batch, incremental, event-driven, and streaming ingestion for a given freshness requirement
- [ ] Design an async ingestion pipeline with queue, workers, and DLQ
- [ ] Explain why ingestion must be decoupled from the API (timeouts, scaling, failure isolation)
- [ ] Implement content-hash-based idempotency for document upserts
- [ ] Compare Kafka, SQS, RabbitMQ, and Redis Streams for a given use case
- [ ] Design a blue-green re-index with validation and zero-downtime cutover
- [ ] List the key monitoring metrics for ingestion health (queue depth, lag, error rate, processing latency, DLQ size)
- [ ] Implement retry with exponential backoff and jitter, and explain why jitter prevents thundering herds

## What Comes Next

[Module 4 — Document Parsing](../module-04/index.md) goes inside the worker pipeline to the parsing stage. Every document format has its own extraction challenges, failure modes, and tooling. Module 4 teaches you how to get clean text out of PDFs, HTML, images, CSVs, and more — and why naive approaches destroy structured data.
