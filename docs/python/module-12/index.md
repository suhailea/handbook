---
title: Module 12 — Testing, Debugging & Tooling
outline: deep
---

# Module 12 — Testing, Debugging & Tooling

Production code without tests is a guess. Code without tooling is a chore. This module closes the loop on everything you have learned across the Python track by covering how to **verify** your code actually does what you think (testing), how to **investigate** when it does not (debugging), and how to keep the codebase **healthy** over time (linting, formatting, type checking, automation).

Python's testing ecosystem has converged around **pytest** as the de facto framework, replacing the verbose unittest style with something that reads almost like executable documentation. Mocking lets you isolate units from slow or unpredictable dependencies, while coverage measurement tells you which lines and branches your tests actually exercise. On the tooling side, **ruff** has unified linting and formatting into a single, blazing-fast tool, and **pre-commit** hooks ensure quality gates run before code ever reaches a pull request.

This is the final module of the Python track. By the end, you will have the complete toolkit to write, test, debug, and ship Python with confidence.

## What You'll Learn

- **pytest** — test discovery, plain-assert introspection, fixtures with dependency injection, parametrize, markers, plugins, and how pytest differs from unittest at a mechanical level.
- **Mocking & coverage** — `unittest.mock` (Mock, MagicMock, patch), the critical "where to patch" rule, AsyncMock, pytest-mock, coverage.py, branch vs line coverage, and pragmatic coverage targets.
- **Debugging & developer tooling** — pdb/breakpoint(), post-mortem debugging, ruff (linting + formatting), pre-commit hooks, and assembling a modern Python dev toolchain.

## Pages in This Module

| # | Page | Focus |
|---|------|-------|
| 1 | [pytest — Testing Done Right](./01-pytest.md) | Test discovery, assertions with introspection, fixtures, parametrize, markers, plugins |
| 2 | [Mocking & Coverage](./02-mocking-coverage.md) | unittest.mock, patch (where to patch), coverage.py, branch coverage, pytest-cov |
| 3 | [Debugging & Developer Tooling](./03-debugging-tooling.md) | pdb, breakpoint(), ruff, pre-commit, assembling the modern Python toolchain |

## Prerequisites

- **[Module 3 — Functions & Scoping](/python/module-03/)**: Fixtures are functions, parametrize uses closures, and "where to patch" depends on understanding how Python looks up names in modules.
- **[Module 4 — OOP & Descriptors](/python/module-04/)**: Mocking replaces attributes on objects and modules. Understanding `__getattr__`, descriptors, and how classes resolve attribute access makes Mock's magic intuitive.
- **[Module 6 — Error Handling](/python/module-06/)**: Testing exception paths with `pytest.raises` and writing tests for error-handling code requires comfort with exception mechanics.
- **[Module 8 — Imports & Packaging](/python/module-08/)**: The "where to patch" rule is fundamentally about Python's import system. If you skipped Module 8, the mocking page will be harder than it needs to be.

## How the Pages Connect

Start with pytest (page 1) because it is the foundation everything else builds on. Mocking and coverage (page 2) extend your test suite to handle dependencies and measure completeness. Debugging and tooling (page 3) round out the developer experience — when a test fails and you cannot see why, pdb gets you there; when the codebase grows, ruff and pre-commit keep it consistent. Together, these three pages form the quality layer that sits on top of all the knowledge from Modules 1-11.
