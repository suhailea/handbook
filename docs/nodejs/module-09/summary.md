---
title: "Module 9 Summary"
outline: deep
---

# Module 9 — Testing & Observability: Summary

Module 9 covers code quality and production visibility — tests, logs, traces, and debugging.

## Mental Models Gained

- **`node:test` is production-ready.** Built-in test runner with mocking, snapshots, and coverage. No external dependency needed for most projects.
- **Structured logging is observability's foundation.** JSON logs with consistent fields, powered by Pino and AsyncLocalStorage for automatic request context.
- **OpenTelemetry is the observability standard.** Traces, metrics, and logs unified under one SDK. Auto-instrumentation hooks into `async_hooks`.
- **Production debugging is a skill, not luck.** `--inspect` for live debugging, diagnostic reports for crashes, heap snapshots for memory, CPU profiles for latency.

## Self-Assessment Checklist

- [ ] Can you write tests with `node:test` including ESM mocks?
- [ ] Can you set up structured logging with request-scoped context?
- [ ] Can you add OpenTelemetry instrumentation?
- [ ] Can you attach a debugger to a running production process?

## What's Next

[Module 10 — Capstones](/nodejs/module-10/)
