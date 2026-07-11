---
title: "Module 8 Summary"
outline: deep
---

# Module 8 — Security & Hardening: Summary

Module 8 covers attack surfaces and defense patterns for Node.js applications.

## Mental Models Gained

- **Prototype pollution is JavaScript's unique vulnerability.** Recursive merges of user input can modify `Object.prototype`. Defense: `Object.create(null)`, `Map`, input validation.
- **Regex is an attack surface.** Catastrophic backtracking (ReDoS) blocks the event loop. Audit nested quantifiers.
- **Your dependencies are your attack surface.** `npm ci` with a lockfile is your first defense. Audit regularly.
- **LLM-facing APIs have new threat models.** Tool-calling agents can trigger SSRF and resource exhaustion. Treat LLM tool outputs as untrusted input.

## Self-Assessment Checklist

- [ ] Can you identify and defend against prototype pollution?
- [ ] Can you spot a vulnerable regex pattern?
- [ ] Can you explain `npm ci` vs `npm install` for security?
- [ ] Can you threat-model an LLM-facing API?

## What's Next

[Module 9 — Testing & Observability](/nodejs/module-09/)
