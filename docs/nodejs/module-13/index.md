---
title: "Module 13 — API Design Patterns"
outline: deep
---

# Module 13 — API Design Patterns

This module covers the patterns and practices that determine whether your API is a joy or a nightmare to consume. It moves from foundational REST conventions through pagination, validation, the REST-vs-GraphQL decision, and file upload architectures. Every page ties back to the Node.js runtime concepts from earlier modules — streams, backpressure, error handling, AbortSignal — showing how API-layer decisions are shaped by what the runtime can and cannot do.

## Pages

- [REST API Best Practices](./01-rest-best-practices) — resource naming, HTTP semantics, status codes, error formats, ETags, and content negotiation
- [API Versioning & Pagination](./02-versioning-pagination) — versioning strategies, cursor-based pagination, offset trade-offs, filtering and sorting
- [Request Validation & Error Handling](./03-validation-error-handling) — Zod, class-validator, validation middleware, consistent error responses, sanitization
- [GraphQL vs REST: When to Use Which](./04-graphql-vs-rest) — mental models, N+1 and DataLoader, security, subscriptions, NestJS integration
- [File Uploads & Presigned URLs](./05-file-uploads) — multipart uploads, streaming to S3, presigned URL workflows, virus scanning, image processing
- [Module 13 Summary](./summary)
