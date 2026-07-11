---
title: System Design Crash Sheet
outline: deep
---

# System Design Crash Sheet

Rapid-review bullets for system design interviews. Each bullet links to its full page for the deep dive.

> **How to use:** Tier 1 = must-know (asked in almost every interview). Tier 2 = frequently asked. Tier 3 = differentiators that impress.

---

## Tier 1 — Must Know

🚧 *Bullets will be added as System Design pages are completed.*

**Topics to cover:**
- Why queues exist (decoupling, spike absorption, retries)
- Horizontal vs vertical scaling
- Cache-aside pattern and cache stampede
- Rate limiting algorithms (token bucket, sliding window)

## Tier 2 — Frequently Asked

🚧 *Bullets will be added as System Design pages are completed.*

**Topics to cover:**
- L4 vs L7 load balancing
- Delivery semantics (at-most-once, at-least-once, exactly-once myth)
- Sync vs async microservice communication
- Circuit breakers and bulkheads

## Tier 3 — Differentiators

🚧 *Bullets will be added as System Design pages are completed.*

**Topics to cover:**
- Saga patterns (choreography vs orchestration)
- nginx streaming/SSE configuration (`proxy_buffering off`)
- Transactional outbox pattern
- Distributed rate limiting with Redis

---

*This crash sheet will be populated as the [System Design track](/system-design/) pages are written.*
