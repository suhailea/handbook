---
title: "Module 17 Summary"
outline: deep
---

# Module 17 — DevOps & Deployment: Summary

## Mental Models Gained

- **Docker is about reproducibility, not virtualization.** Multi-stage builds keep images small. Layer caching keeps builds fast. Run as non-root, use `tini` for signal handling, and `node:22-slim` for the best balance.
- **CI/CD is your quality gate.** Lint → test → build → deploy. Cache aggressively. Run migrations before deploy. Never skip the gate.
- **Config in the environment, secrets in a vault.** Validate everything at startup with Zod. A clear crash at boot beats a mystery failure at 3 AM.
- **Liveness ≠ readiness.** Liveness: "is the process alive?" Readiness: "can it handle traffic?" Getting these wrong causes cascading restarts.
- **ELU is your single best Node.js metric.** Event loop utilization directly measures saturation. CPU percentage lies.

## Self-Assessment Checklist

- [ ] Can you write a multi-stage Dockerfile with proper layer caching?
- [ ] Can you set up a GitHub Actions pipeline with caching and matrix testing?
- [ ] Can you validate all environment variables at startup with Zod?
- [ ] Can you explain the difference between liveness and readiness probes?
- [ ] Can you expose Prometheus metrics and configure meaningful alerts?
- [ ] Can you explain why ELU matters more than CPU for Node.js?
