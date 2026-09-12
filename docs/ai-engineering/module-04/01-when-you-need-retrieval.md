---
title: When You Need Retrieval
outline: deep
---

# When You Need Retrieval

TaskFlow's agent could look up a ticket by ID — that's a tool call against structured data. It couldn't answer "what's our refund policy for annual plans?" because that lives in a policy document, not a database row. Retrieval is how you close that specific gap.

::: tip Plain English
A model's training gave it broad, general knowledge — but nothing about your specific business, your specific documents, or anything that changed after its training cutoff. Retrieval is handing it the relevant page from your own filing cabinet right before it answers, instead of hoping it memorized your policy manual during training. It didn't, and it can't have.
:::

## The adaptation ladder

Four ways to get a model to know something it doesn't know by default, roughly in order of effort:

| Approach | When it fits | Effort |
|---|---|---|
| **Better prompting** | The model has the knowledge but phrases it badly, or needs format guidance | Lowest |
| **More context** | A small, fixed set of facts that fit comfortably in the prompt | Low |
| **RAG** | A large or changing knowledge base — docs, policies, tickets — too big to paste in every time | Medium |
| **Fine-tuning** | The model needs to reliably shift *behavior* or *style*, not just recall facts | Highest |

Most "the model doesn't know X" problems are retrieval problems, not fine-tuning problems. Fine-tuning is for teaching a consistent style, format, or specialized skill — it's a poor and expensive way to teach facts, because facts change and retraining every time a policy updates doesn't scale. See [When to Fine-Tune](/ai-engineering/module-10/03-when-to-fine-tune) for the fuller version of this decision.

## Recognizing you've hit the RAG case

- The knowledge base is bigger than fits comfortably in a prompt
- It changes over time — new tickets, updated policies — so baking it into a fine-tune would go stale
- You need the answer grounded in a specific, citable source, not the model's general sense of the topic
- Different users need different slices of a shared knowledge base

TaskFlow's policy documents, help center articles, and past-ticket history all fit this shape. Ticket-by-ID lookup does not — that's a direct database query, not retrieval, because you already know exactly which record you want.

::: warning Watch out
Don't reach for RAG when a direct lookup will do. If you know the exact record you need (a ticket ID, a user's account), call a tool that fetches it directly — retrieval-by-similarity is for when you don't know exactly what you're looking for, only roughly what it's about.
:::

::: details Interview Question — RAG vs fine-tuning for a knowledge gap
**Q:** An agent gives outdated answers about your product's pricing tiers. Do you fine-tune it on current pricing, or use RAG?
**A:** RAG. Pricing changes, and fine-tuning bakes knowledge into weights at a point in time — every price change would need a retraining cycle to stay current. Retrieval pulls from a source you can update in seconds, no retraining required, which matches how often pricing actually changes.
:::

::: details Interview Question — Ticket lookup vs RAG
**Q:** Why is looking up a ticket by ID a tool call rather than a RAG retrieval, even though both involve fetching data?
**A:** You already know exactly which record you want — a direct key lookup against a database. RAG is for when the query is fuzzy and you're searching by *meaning* across many candidates, not fetching a known record by its identifier. Using similarity search for an exact-match lookup is slower and less reliable than the direct query it's replacing.
:::

## Where to go next

This module stops here deliberately. Retrieval is a large enough subject to warrant its own track — [**Production RAG**](/rag/) covers ingestion, chunking, embeddings, vector databases, hybrid search, reranking, grounded generation, and evaluation across 18 modules, including 10 worked case studies.

Come back here once retrieval is in place: [Module 5 — Evaluation](/ai-engineering/module-05/) is where RAG-grounded agents and pure agents converge, because both need the same answer to "is this actually working."

## Key Mental Models

**Most "the model doesn't know X" problems are retrieval problems.** Fine-tuning is for behavior and style, not for facts that change.

**RAG is for when you don't know exactly which record you need.** If you do, that's a direct tool call, not retrieval.

## Related

- [Production RAG](/rag/) — the full track
- [10.3 When to Fine-Tune](/ai-engineering/module-10/03-when-to-fine-tune) — the other branch of this decision
- [2.2 Tools & Tool Calling](/ai-engineering/module-02/02-tools-and-tool-calling) — direct lookup, the non-retrieval case
