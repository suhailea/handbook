---
title: "Module 10 Summary"
outline: deep
---

# Module 10 — Capstones: Summary

Module 10 ties everything together with three build-from-scratch projects.

## Mental Models Gained

- **A web framework is middleware dispatch + routing + error handling.** Building Express-like from `node:http` reveals that the "magic" is just URL parsing, route matching, and sequential middleware execution.
- **A reliable job queue is a state machine backed by Redis.** Jobs flow through states (waiting → active → completed/failed) with atomic Redis transitions. Reliability comes from BRPOPLPUSH, not hope.
- **An LLM gateway ties together every Node.js concept.** Streaming (Module 4), HTTP (Module 5), abort signals (Module 3), rate limiting, and observability (Module 9) all converge in one system.

## Self-Assessment Checklist

- [ ] Can you build a middleware pipeline from scratch?
- [ ] Can you implement reliable job processing with atomic Redis operations?
- [ ] Can you proxy SSE streams with backpressure and abort propagation?

## What's Next

You've completed the Node.js Runtime track. Review the [Node.js Crash Sheet](/interview/crash-sheet-node), explore the [System Design track](/system-design/), or dive into [Frameworks](/frameworks/).
