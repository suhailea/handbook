---
title: Module 8 Summary
outline: deep
---

# Module 8 Summary — The Import System & Packaging

## Mental Models Gained

1. **Import is cache-check, find, load, bind.** Every `import` starts with a dictionary lookup in `sys.modules`. Only on a cache miss does Python invoke finders (from `sys.meta_path`) to locate the module, a loader to execute it, and then bind the resulting name into the importing module's namespace.

2. **Modules execute once; every subsequent import gets the same object.** `sys.modules` is a global cache of module objects. The top-level code in a `.py` file runs exactly once per interpreter session. This is why module-level state is effectively singleton state.

3. **Circular imports give you a half-initialized module, not always an error.** Because Python inserts the module object into `sys.modules` before executing its code, a circular reference gets a module whose attributes are only partially defined. The fix is to defer imports (function-level) or import the module rather than names from it.

4. **`from X import Y` copies a reference; `import X` defers lookup.** `from X import Y` binds the name `Y` to whatever `X.Y` pointed to at import time. If `X.Y` later changes (reload, monkey-patch), the local `Y` is stale. `import X` followed by `X.Y` always reads the current attribute.

5. **A virtual environment is a `sys.path` trick, not a Python copy.** `python -m venv` creates a symlink to the base interpreter and a fresh `site-packages` directory. Activation merely prepends the venv's `bin/` to `PATH`. You can use a venv without activating it.

6. **Lock files pin the world; requirements.txt pins a flat snapshot.** Lock files (from `pip-compile`, `poetry lock`, `uv lock`) record direct vs. transitive dependencies, cryptographic hashes, and the resolution graph. Plain `pip freeze` gives you a flat list with no context about why each package is present.

## Self-Assessment Checklist

Rate yourself on each item: **confident** / **shaky** / **need to revisit**.

| # | Concept | Status |
|---|---------|--------|
| 1 | I can describe the four steps of an `import` statement (cache check, find, load, bind) and explain what happens at each step. | |
| 2 | I can explain why `sys.modules` is checked first and why modules are inserted into it before execution completes. | |
| 3 | I can list the three default finders in `sys.meta_path` and explain what each handles. | |
| 4 | I can explain how `sys.path` is constructed (script dir, `PYTHONPATH`, site-packages, `.pth` files) and debug a module-not-found issue. | |
| 5 | I can explain why circular imports produce partial modules and name three strategies to fix them. | |
| 6 | I can explain the difference between `python3 script.py` and `python3 -m package.module` in terms of `__package__`, `sys.path[0]`, and relative import behavior. | |
| 7 | I can explain what `python -m venv` creates on disk and what `source activate` actually modifies in the shell. | |
| 8 | I can describe the four phases of `pip install` (resolve, download, build, install) and explain when the build step is skipped (wheels). | |
| 9 | I can write a modern `pyproject.toml` with `[build-system]`, `[project]`, and `[tool.*]` sections and explain why it replaced `setup.py`. | |
| 10 | I can explain the difference between a wheel and a source distribution and why lock files are better than `pip freeze`. | |

## Quick Reference

### Import Resolution Order

```
import mymodule
  │
  ├─ 1. Check sys.modules["mymodule"]  ──→  found? return cached module
  │
  ├─ 2. Iterate sys.meta_path finders:
  │     ├─ BuiltinImporter.find_spec()   ──→  built-in C modules (sys, _thread)
  │     ├─ FrozenImporter.find_spec()    ──→  frozen modules (startup only)
  │     └─ PathFinder.find_spec()        ──→  searches sys.path entries:
  │           ├─ sys.path[0]: script dir or CWD
  │           ├─ sys.path[1..n]: PYTHONPATH entries
  │           └─ sys.path[n+1..]: site-packages, .pth additions
  │
  ├─ 3. Loader executes module code:
  │     ├─ Create module object
  │     ├─ Add to sys.modules BEFORE execution  ← circular import safety
  │     └─ Execute top-level code in module namespace
  │
  └─ 4. Bind name in importing module's namespace
```

### Packaging File Comparison

| Aspect | `setup.py` | `setup.cfg` | `pyproject.toml` |
|--------|-----------|-------------|-----------------|
| Format | Python script | INI-style | TOML |
| Code execution | Yes (arbitrary) | No | No |
| Build-system agnostic | No (setuptools) | No (setuptools) | Yes (PEP 517) |
| Standardized metadata | No | Partially | Yes (PEP 621) |
| Tool config (`[tool.*]`) | No | No | Yes |
| Still needed for new projects? | No | No | **Yes** |
| Introduced | 2000 | 2016 | 2020 |

### Virtual Environment Commands Cheat Sheet

| Task | Command |
|------|---------|
| **Create venv** | `python3 -m venv .venv` |
| **Activate (bash/zsh)** | `source .venv/bin/activate` |
| **Activate (fish)** | `source .venv/bin/activate.fish` |
| **Activate (Windows)** | `.venv\Scripts\activate` |
| **Deactivate** | `deactivate` |
| **Use without activating** | `.venv/bin/python script.py` |
| **Install package** | `pip install requests` |
| **Install from requirements** | `pip install -r requirements.txt` |
| **Freeze current state** | `pip freeze > requirements.txt` |
| **Install in editable mode** | `pip install -e .` |
| **Install with extras** | `pip install -e ".[dev]"` |

### uv Commands Cheat Sheet

| Task | uv Command | pip Equivalent |
|------|-----------|---------------|
| Create venv | `uv venv` | `python -m venv .venv` |
| Install package | `uv pip install requests` | `pip install requests` |
| Generate lock file | `uv lock` | `pip-compile` |
| Install from lock file | `uv sync` | `pip-sync` |
| Add dependency | `uv add requests` | (edit pyproject.toml + pip install) |
| Remove dependency | `uv remove requests` | (edit pyproject.toml + pip uninstall) |
| Run script | `uv run script.py` | `.venv/bin/python script.py` |
| Install CLI tool | `uv tool install ruff` | `pipx install ruff` |

## What's Next

Continue to **[Module 9 — Memory & Performance](/python/module-09/)** to learn how CPython manages memory (reference counting, garbage collection, `__slots__`), how to profile Python code, and where performance bottlenecks hide. You will see that understanding the import system helps with startup time optimization — lazy imports and deferred loading are common techniques for reducing the cost of importing large packages.
