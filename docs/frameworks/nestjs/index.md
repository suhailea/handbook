---
title: NestJS
outline: deep
---

# NestJS

NestJS is the opinionated, TypeScript-first framework that layers dependency injection, decorators, and a modular architecture on top of Express (or Fastify). This section explains how each abstraction works under the hood.

## Pages

- [DI Container & reflect-metadata](/frameworks/nestjs/01-di-container) — how NestJS resolves dependencies at runtime
- [Request Lifecycle](/frameworks/nestjs/02-request-lifecycle) — the full pipeline from middleware to response
- [Provider Scopes & CLS](/frameworks/nestjs/03-provider-scopes) — singleton vs request-scoped vs transient
- [Microservices Transports](/frameworks/nestjs/04-microservices) — built-in transports and messaging patterns
