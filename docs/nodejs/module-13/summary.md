---
title: "Module 13 Summary"
outline: deep
---

# Module 13 — API Design Patterns: Summary

Module 13 covers the patterns that shape how clients interact with your backend — from naming conventions and status codes to pagination, validation, and file handling. These are the decisions that determine whether your API is a joy to consume or a source of constant frustration.

## Mental Models Gained

- **URLs are nouns, methods are verbs, status codes are contracts.** REST is not just a convention — it is an interface contract that CDNs, load balancers, monitoring tools, and client libraries all depend on. Returning 200 for errors or using verbs in URLs breaks the ecosystem built on these assumptions.
- **RFC 7807 Problem Details is your error format.** A consistent, typed error response means every consumer (frontend, mobile, third-party integrator) parses errors the same way. Do not invent your own shape when a standard exists.
- **Cursor pagination is O(log N); offset pagination is O(N).** For any dataset that could grow, cursor-based pagination with an indexed sort column is the correct default. Offset pagination is simpler but degrades catastrophically at scale.
- **Validate at the boundary, before any side effects.** Catching invalid data after you have started a transaction, sent a message, or called an external service is vastly more expensive than catching it at the API edge. Zod schemas are the single source of truth for both runtime validation and TypeScript types.
- **GraphQL trades caching simplicity for query flexibility.** REST endpoints are trivially cacheable; GraphQL queries are not (without persisted queries). GraphQL eliminates over-fetching but requires DataLoader, depth limiting, and complexity analysis — infrastructure that REST does not need.
- **DataLoader is not optional in GraphQL.** Without it, every list resolver creates an N+1 query problem. It exploits the microtask queue to batch all keys collected within a single tick into one database call. Create one instance per request to avoid cross-request data leaks.
- **Presigned URLs move file bytes off your server.** Your API only signs URLs and stores metadata. S3 handles the heavy lifting of receiving, storing, and serving bytes. This is the production pattern for anything over a few megabytes.
- **Content-Type is a client-controlled header; magic bytes are evidence.** Never make security decisions based on what the client claims a file is. Read the actual bytes.

## Self-Assessment Checklist

### 13.1 — REST Best Practices
- [ ] Can you design resource URLs that follow plural-noun, kebab-case conventions with proper nesting?
- [ ] Do you know the idempotency semantics of each HTTP method?
- [ ] Can you implement ETags for both cache validation and optimistic concurrency?
- [ ] Can you explain the RFC 7807 Problem Details format and when to use it?
- [ ] Do you propagate request IDs through headers and logs?

### 13.2 — Versioning & Pagination
- [ ] Can you compare URL-path, header, and query-param versioning with trade-offs?
- [ ] Can you implement cursor-based pagination with compound cursors for non-unique sort columns?
- [ ] Do you know why `COUNT(*)` is expensive in PostgreSQL and what alternatives exist?
- [ ] Can you whitelist sort and filter fields to prevent information disclosure?

### 13.3 — Validation & Error Handling
- [ ] Can you build a Zod schema and infer TypeScript types from it?
- [ ] Do you know the difference between `.parse()`, `.safeParse()`, `.strict()`, and `.strip()`?
- [ ] Can you implement a global error handler that maps operational errors to RFC 7807 and hides internals for programmer errors?
- [ ] Can you validate file uploads using magic bytes instead of Content-Type?

### 13.4 — GraphQL vs REST
- [ ] Can you explain the N+1 problem and how DataLoader solves it using microtask batching?
- [ ] Do you know when to choose GraphQL over REST and vice versa?
- [ ] Can you list three security measures required for a production GraphQL server?
- [ ] Do you understand the trade-off between schema-first and code-first approaches?

### 13.5 — File Uploads & Presigned URLs
- [ ] Can you implement the full presigned URL workflow (sign, upload, confirm)?
- [ ] Do you know the memory difference between buffered and streamed file uploads?
- [ ] Can you design a virus scanning pipeline with quarantine and promotion?
- [ ] Do you handle orphaned uploads with S3 Lifecycle Rules?

## What's Next

[Module 14](/nodejs/module-14/) builds on these API design patterns with authentication and authorization — JWT mechanics, session management, OAuth2 flows, RBAC, and how these concepts integrate with the middleware patterns and request lifecycle covered here.
