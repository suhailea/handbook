---
title: "Module 17 — DevOps & Deployment"
outline: deep
---

# Module 17 — DevOps & Deployment

Writing correct Node.js code is half the job. The other half is packaging it, shipping it, configuring it, and knowing it is healthy once it is running. This module covers the full deployment lifecycle: containerizing a Node.js application with Docker, automating builds and deploys with CI/CD pipelines, managing configuration and secrets safely across environments, and wiring up health checks and monitoring so you know when something goes wrong before your users do.

Every topic in this module connects directly back to Node.js runtime behavior covered in earlier modules. Docker signal handling ties to Module 1's process lifecycle. Health check endpoints tie to Module 9's observability. Config validation at startup ties to Module 3's fail-fast error doctrine. The goal is not to teach generic DevOps -- it is to teach DevOps *for Node.js*, with the runtime-specific details that matter.

## Pages

- [Docker for Node.js](./01-docker) — multi-stage builds, layer caching, signal handling, non-root users, Docker Compose, image optimization
- [CI/CD Pipelines](./02-cicd) — GitHub Actions workflows, caching, matrix testing, Docker in CI, preview deployments, semantic versioning
- [Configuration & Secrets Management](./03-config-secrets) — 12-Factor config, startup validation with Zod, secrets management, feature flags, NestJS ConfigModule
- [Health Checks, Monitoring & Alerting](./04-health-monitoring) — liveness vs readiness, K8s probes, Prometheus metrics, key metrics, alerting rules, runbook-driven alerts
- [Module 17 Summary](./summary)
