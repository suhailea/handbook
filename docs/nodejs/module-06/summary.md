---
title: "Module 6 Summary"
outline: deep
---

# Module 6 — Performance & Diagnostics: Summary

Module 6 is about finding and fixing problems — CPU bottlenecks, memory leaks, GC pauses, and scaling decisions.

## Mental Models Gained

- **Flame graphs tell you where time goes.** Wide bars at the top = where time is spent. Focus on the widest bars first.
- **Heap snapshots tell you where memory goes.** Take two, compare them. Growing objects are leak candidates. Follow the retainer tree.
- **GC pauses are the latency killer.** V8's generational GC is efficient, but old-space growth causes long major GC pauses.
- **Workers, cluster, and pods solve different problems.** `worker_threads` = CPU parallelism. `cluster` = multi-process. Pods = multi-machine. Start with pods in K8s.

## Self-Assessment Checklist

- [ ] Can you generate and read a flame graph?
- [ ] Can you find a memory leak with heap snapshot comparison?
- [ ] Can you tune `--max-old-space-size` for your workload?
- [ ] Can you choose between workers, cluster, and pods for a given scenario?

## What's Next

[Module 7 — FS, Child Processes & OS Boundary](/nodejs/module-07/)
