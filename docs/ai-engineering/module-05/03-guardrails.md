---
title: Guardrails — Keeping the Agent in Bounds
outline: deep
---

# Guardrails — Keeping the Agent in Bounds

A user asked our support agent for their competitor's pricing. The agent started comparing competitors. That's not its job.

::: tip Plain English
A guardrail is exactly what the name suggests. On a mountain road, guardrails don't control where you go — you're still driving. But if you drift too far toward the edge, the guardrail stops you from going over.

Agent guardrails are the same. The agent handles most requests normally. Guardrails are only invoked when something goes wrong: the input is out of scope, the output contains something it shouldn't, or the agent is about to do something unsafe.

You don't want guardrails to be so tight that the agent can't function. You want them tight enough that the failure modes you actually care about are caught.
:::

## Two kinds of guardrails

### Input guardrails — check what comes in

Examine the user's message before the agent processes it.

**Topic classification:** Is this message on-topic? For TaskFlow, a support agent should handle billing, technical issues, and account questions. If someone asks about competitor pricing, stock tips, or help writing an essay — that's off-topic. A fast classifier (rule-based or a small LLM) can catch this and redirect.

```
User: "What's the best project management tool other than TaskFlow?"

Input guardrail: [classifier: off-topic — competitor comparison]
Response: "I'm here to help with TaskFlow specifically. Is there
          something about TaskFlow I can help with today?"
```

**PII detection:** If users are pasting data that contains social security numbers, credit card numbers, or health information — you may want to flag it, redact it before sending to the LLM, or refuse to process it.

**Prompt injection detection:** As discussed in Module 1, users may try to override your system prompt. Input guardrails can scan for telltale patterns ("ignore previous instructions," "pretend you are," "your new role is") and respond with a redirect instead of passing to the agent.

### Output guardrails — check what goes out

Examine the agent's response before sending it to the user.

**Topic drift:** The agent's response should stay on topic. If the agent produced a competitor comparison (maybe from a clever multi-message manipulation), catch it here before it goes out.

**Hallucination checks:** For critical facts (ticket IDs, pricing, feature availability), cross-reference the agent's response against a source of truth before sending. If the agent claims ticket #9999 is closed but your database says it's open — block the response and let the agent try again with corrected information.

**Commitment detection:** Did the agent make a promise you can't keep? "I'll issue a full refund immediately" — if your system can't do that automatically, this needs to catch it and route to human review.

**PII in output:** Did the agent accidentally include another user's data in its response? Check before sending.

## Hard stops vs soft redirects

**Hard stop:** The agent does not respond at all. The user gets a generic error or redirect. Use for: prompt injection attempts, clearly abusive messages, policy violations you can't work around.

**Soft redirect:** The agent responds, but not to the original request — it acknowledges the issue and redirects. Use for: off-topic questions, requests the agent shouldn't handle but doesn't warrant a hard block.

For most cases, soft redirects produce a better user experience. Hard stops are for genuine safety or policy violations.

## Tools (brief)

**Guardrails AI:** Open-source Python library for building input/output validators. Supports custom validators, LLM-based validators, and a library of pre-built validators for common cases (PII, toxic content, JSON format).

**NeMo Guardrails:** NVIDIA's framework for adding guardrails to LLM applications. Dialog-flow based — you define allowed/disallowed conversation patterns in a specialized config format. More powerful but higher learning curve.

For TaskFlow: we built lightweight custom guardrails — a small classifier for topic detection and a regex + LLM hybrid for commitment detection. We didn't need a full framework for our use case.

## When to add each type

| Guardrail | Add when |
|-----------|----------|
| Topic classification | Agent has a defined scope and off-topic requests are common |
| PII detection | Users paste sensitive data and you process it through third-party APIs |
| Prompt injection detection | High-stakes actions are possible (deletes, refunds) |
| Hallucination check | Agent makes factual claims that can be verified against a source of truth |
| Commitment detection | Agent could make promises that have real business/legal consequences |
| Output topic filter | Multi-turn manipulation could drift the agent off-topic |

::: warning Watch out
Guardrails have false positives. An over-tuned topic classifier will block legitimate questions because they mention a word that sounds off-topic. Before tightening guardrails, measure the false positive rate on real traffic. A guardrail that blocks 5% of legitimate requests is worse than a looser guardrail that occasionally lets an off-topic response through.
:::

::: details Interview Question — Guardrail design
**Q:** How would you design guardrails for a financial services chatbot that can answer questions about account balances and move money?

**A:** Layered approach: (1) **Input** — authenticate the user before the session starts (out of band); classify every message for intent — account inquiry vs transaction request. Transactions go through a different, more restricted path. (2) **Transaction guardrails** — for any money movement: extract the intended action (amount, destination) with a separate LLM call, require explicit structured confirmation from the user before executing, enforce hard limits (amount caps, recipient whitelist). (3) **Output** — never include another user's account info in a response (cross-user PII check). Flag any response that references amounts the system didn't look up (hallucinated balances). (4) **Hard stops** — if the agent attempts a transaction tool call without going through the confirmation flow, block it at the harness level, not just the guardrail. (5) **Audit trail** — log every guardrail invocation with the input that triggered it. This is your evidence trail for regulatory compliance. The principle: guardrails for high-stakes financial actions should be implemented in code (the harness), not just in the LLM prompt.
:::
