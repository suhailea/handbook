---
title: Module 8 — The Import System & Packaging
outline: deep
---

# Module 8 — The Import System & Packaging

Every Python program beyond a single script depends on importing code from somewhere else. Yet most developers treat `import` as a magic incantation and `pip install` as a black box. This module peels back both layers: first, the **import system** — the machinery Python uses to find, load, cache, and bind modules — and then the **packaging ecosystem** — how dependencies are isolated, resolved, distributed, and installed.

By the end of this module, you will understand what happens at every step between typing `import json` and using `json.dumps()`, why circular imports produce half-initialized modules instead of clean errors, what `python -m venv` actually creates on disk, and why the Python community has gone through three generations of packaging configuration (setup.py, setup.cfg, pyproject.toml).

## What You'll Learn

- **The import machinery** — the step-by-step resolution path (`sys.modules` cache, finders, loaders), how packages initialize via `__init__.py`, how relative imports resolve, why circular imports break, and how `importlib.reload()` works (and doesn't).
- **Virtual environments & modern packaging** — what `python -m venv` creates, how `pip install` resolves and installs dependencies, the evolution from setup.py to pyproject.toml, lock files, the new `uv` tool, wheels vs sdist, and publishing to PyPI.

## Pages in This Module

| # | Page | Focus |
|---|------|-------|
| 1 | [How import Actually Works](./01-import-mechanics.md) | `sys.modules` cache, finders & loaders, `sys.path`, `__init__.py`, relative imports, circular imports, `importlib.reload()`, `__name__ == "__main__"` |
| 2 | [Virtual Environments & Modern Packaging](./02-venvs-packaging.md) | `venv`, `pip install` internals, `pyproject.toml`, lock files, `uv`, wheels vs sdist, editable installs, publishing to PyPI |

## Prerequisites

- **[Module 3 — Functions & Scoping](/python/module-03/)**: You need to understand how Python executes function bodies and manages namespaces, since importing a module means executing its top-level code and creating a module namespace.
- **[Module 1 — What Python Is](/python/module-01/)**: Understanding the CPython interpreter and how `.pyc` files are generated helps when you see `__pycache__` directories appear after imports.

## How the Pages Connect

The import system (page 1) is the **runtime mechanism** — it explains what happens when Python encounters an `import` statement. Packaging (page 2) is the **ecosystem layer** built on top — it deals with getting third-party code installed into directories where the import system can find it (`site-packages`), isolating those installations per project, and distributing your own code. Understanding import mechanics first makes packaging make sense: `pip install` puts files where `sys.path` can find them, `venv` manipulates `sys.path` to create isolation, and `pyproject.toml` describes how to build those files.
