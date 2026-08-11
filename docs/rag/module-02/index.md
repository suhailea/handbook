---
title: Module 2 — System Requirements
outline: deep
---

# Module 2 — System Requirements

The single biggest predictor of RAG project failure is not the wrong vector database or the wrong embedding model — it is building before defining what "working" means. This module teaches the discipline of requirements gathering that separates production systems from demo-ware.

Every technology choice in Modules 3-18 is a consequence of the requirements you define here. Skip this module, and you will make expensive decisions based on blog posts instead of your actual constraints.

## Pages in This Module

| # | Page | What You Will Learn |
|---|------|---------------------|
| 1 | [Designing Before Building](01-requirements.md) | The complete requirements framework: data, traffic, latency, freshness, accuracy, security, cost — with 3 worked example requirement documents |
| — | [Summary](summary.md) | Mental models and self-assessment checklist |

## Prerequisites

- [Module 1 — RAG Fundamentals](../module-01/index.md): you need to understand what RAG is and when it is the right tool before you can define requirements for one.

## Why a Whole Module for Requirements

In system design interviews, the first 5-10 minutes are requirements gathering. Candidates who jump straight to "let's use Pinecone and OpenAI embeddings" without asking about data volume, query patterns, freshness needs, and security constraints fail. The same is true in production: teams that skip requirements end up rebuilding.
