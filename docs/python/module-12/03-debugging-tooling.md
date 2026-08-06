---
title: Debugging & Developer Tooling
outline: deep
---

# Debugging & Developer Tooling

Interview weight: 🔥 &nbsp;|&nbsp; Python 3.7+ (breakpoint()), examples target 3.12+ &nbsp;|&nbsp; Prerequisites: [pytest](./01-pytest.md), [Functions & Scoping](/python/module-03/)

## 🗣️ In Plain English

::: tip In Plain English
Debugging tools are like medical instruments, each suited to a different kind of examination.

**pdb** is a stethoscope. You place it against your program's chest (a specific line of code), and it pauses the heartbeat right there. You can listen to every variable's current value, step forward one heartbeat at a time, peek up at the organs that called this function, or jump down into the function it is about to call. It is simple, always available, and requires no special equipment — just you and the patient.

**An IDE debugger** (like the one in VS Code) is a full MRI machine. You get the same pause-and-inspect capability, but with a visual interface: a panel showing every variable, a call stack you can click through, breakpoints you set by clicking in the margin, and conditional stops ("only pause if this patient's blood pressure is above 140"). More powerful, but it requires setup and a bigger room.

Then there is a different category entirely: **preventive health screening**. **ruff** is an automated screening tool that catches common problems *before* symptoms appear. It scans your code in milliseconds (it is written in Rust, so it is absurdly fast) and flags issues: unused imports, variables that shadow outer names, code patterns known to cause bugs, inconsistent formatting. It does not run your code — it reads it the way a radiologist reads an X-ray, looking for structural problems.

**pre-commit hooks** are the appointment system. Instead of relying on each developer to remember to run the screening, pre-commit runs it automatically every time someone tries to check in their code. If the screening finds a problem, the check-in is blocked until the problem is fixed. This way, no unhealthy code enters the shared codebase without passing the screening first.

Together, these tools form a complete health system: prevention (ruff, pre-commit), diagnosis (pdb, IDE debugger), and the testing from the previous pages (pytest) is the ongoing monitoring.
:::

## ⚙️ Under the Hood

### pdb: the built-in debugger

`pdb` is Python's standard interactive debugger. It is always available, requires no installation, and works in any terminal.

#### Launching pdb

```bash
# Run a script under pdb (stops at first line)
python3 -m pdb script.py

# Run and only stop on crash (post-mortem)
python3 -m pdb -c continue script.py
```

#### breakpoint(): the modern entry point (Python 3.7+)

Instead of importing pdb, just drop `breakpoint()` into your code:

```python
# debug_example.py
# run: python3 debug_example.py

def calculate_total(items: list[dict[str, float]]) -> float:
    total = 0.0
    for item in items:
        subtotal = item["price"] * item["quantity"]
        breakpoint()  # execution pauses here — you get a pdb prompt
        total += subtotal
    return total


data = [
    {"price": 10.0, "quantity": 3},
    {"price": 25.0, "quantity": 1},
]

print(calculate_total(data))
```

When `breakpoint()` fires, you get the `(Pdb)` prompt. From there:

#### Essential pdb commands

| Command | Shortcut | Action |
|---------|----------|--------|
| `next` | `n` | Execute current line, step *over* function calls |
| `step` | `s` | Execute current line, step *into* function calls |
| `continue` | `c` | Resume execution until next breakpoint or end |
| `print expr` | `p expr` | Print the value of an expression |
| `pp expr` | | Pretty-print (for dicts, lists, nested objects) |
| `list` | `l` | Show 11 lines around the current position |
| `longlist` | `ll` | Show the entire current function |
| `where` | `w` | Print the call stack (traceback) |
| `up` | `u` | Move one frame up in the call stack |
| `down` | `d` | Move one frame down in the call stack |
| `break [file:]lineno` | `b` | Set a breakpoint at a line |
| `break func` | `b func` | Set a breakpoint at a function entry |
| `clear` | `cl` | Remove breakpoints |
| `quit` | `q` | Abort the program and exit pdb |
| `!statement` | | Execute a Python statement (use `!` to avoid pdb command conflicts) |
| `args` | `a` | Print the arguments of the current function |
| `return` | `r` | Continue until the current function returns |
| `display expr` | | Display expression value each time execution stops |

#### Practical debugging session

```python
# buggy.py
# run: python3 buggy.py

def merge_configs(base: dict[str, object], override: dict[str, object]) -> dict[str, object]:
    """Merge override into base. Bug: mutates base!"""
    result = base  # Bug: should be base.copy()
    for key, value in override.items():
        result[key] = value
    return result


defaults = {"debug": False, "port": 8080, "host": "localhost"}
custom = {"debug": True, "port": 9090}

merged = merge_configs(defaults, custom)
print(f"Merged: {merged}")
print(f"Defaults: {defaults}")  # Oops — defaults is mutated too!

# To debug: add breakpoint() on the `result = base` line
# Then use `p id(result) == id(base)` to see they are the same object
```

### PYTHONBREAKPOINT environment variable

The `breakpoint()` function checks `PYTHONBREAKPOINT` to decide what debugger to use:

```bash
# Disable all breakpoints (useful for CI or production)
PYTHONBREAKPOINT=0 python3 script.py

# Use ipdb instead of pdb
PYTHONBREAKPOINT=ipdb.set_trace python3 script.py

# Use pdb++ (pdbpp)
PYTHONBREAKPOINT=pdbpp.set_trace python3 script.py

# Use a remote debugger
PYTHONBREAKPOINT=web_pdb.set_trace python3 script.py

# Default (same as not setting it)
PYTHONBREAKPOINT=pdb.set_trace python3 script.py
```

This is why `breakpoint()` is better than `import pdb; pdb.set_trace()` — it is configurable without changing code.

### Post-mortem debugging

When a script crashes, you can inspect the state at the point of the crash:

```python
# crash.py
# run: python3 -m pdb crash.py
# (pdb will stop at the crash point automatically)

def divide_all(numbers: list[float], divisor: float) -> list[float]:
    return [n / divisor for n in numbers]

result = divide_all([1.0, 2.0, 3.0], 0)  # ZeroDivisionError
```

```bash
# Option 1: run under pdb (drops to prompt on crash)
python3 -m pdb crash.py

# Option 2: from Python REPL after the crash
python3 -c "
import crash  # crashes
" 2>/dev/null; python3 -c "
import pdb; pdb.pm()  # post-mortem on last exception
"
```

In an interactive session (or Jupyter), `pdb.pm()` examines `sys.last_traceback` and drops you into the frame where the exception occurred.

### ipdb and pdb++: better debugging experience

Both provide enhanced versions of pdb with syntax highlighting, tab completion, and better display:

```bash
# Install
pip install ipdb    # ipython-based debugger
pip install pdbpp   # pdb++ (drop-in replacement)

# ipdb: colored output, ipython features
PYTHONBREAKPOINT=ipdb.set_trace python3 script.py

# pdb++: replaces pdb globally when installed
# Just use breakpoint() — pdbpp hooks in automatically
pip install pdbpp
python3 script.py   # breakpoint() now uses pdb++
```

pdb++ adds:
- Syntax highlighting in the source listing
- Tab completion for variable names and attributes
- `sticky` mode (always shows the current function with a cursor)
- `longlist` shows the full function (also in standard pdb 3.12+)

### IDE debugging: VS Code

VS Code provides a visual debugger that wraps `debugpy`:

```json
// .vscode/launch.json
{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Python: Current File",
            "type": "debugpy",
            "request": "launch",
            "program": "${file}",
            "console": "integratedTerminal",
            "justMyCode": true
        },
        {
            "name": "Python: pytest",
            "type": "debugpy",
            "request": "launch",
            "module": "pytest",
            "args": ["-xvs", "tests/"],
            "console": "integratedTerminal",
            "justMyCode": false
        },
        {
            "name": "Python: Attach to Remote",
            "type": "debugpy",
            "request": "attach",
            "connect": {"host": "localhost", "port": 5678}
        }
    ]
}
```

Key VS Code debugging features:
- **Conditional breakpoints**: right-click a breakpoint and add a condition (`user.role == "admin"`)
- **Logpoints**: print a message without stopping (like a temporary print statement)
- **Watch expressions**: monitor variables continuously as you step
- **Call stack panel**: click any frame to inspect its local variables
- **Debug console**: evaluate expressions in the current frame's context
- **`justMyCode: false`**: step into library and framework code (essential for understanding NestJS-like framework internals)

### ruff: the Rust-based linter and formatter

ruff replaces flake8, isort, pyflakes, pycodestyle, pydocstyle, pyupgrade, autoflake, and many pylint rules — and runs 10-100x faster than any of them because it is written in Rust.

```bash
# Install
pip install ruff

# Lint (check for issues)
ruff check .

# Lint and auto-fix what can be fixed
ruff check --fix .

# Format (replaces black)
ruff format .

# Check formatting without changing files
ruff format --check .
```

#### Configuration

```toml
# pyproject.toml

[tool.ruff]
target-version = "py312"
line-length = 88                    # same as black default

[tool.ruff.lint]
select = [
    "E",    # pycodestyle errors
    "W",    # pycodestyle warnings
    "F",    # pyflakes (unused imports, undefined names)
    "I",    # isort (import ordering)
    "UP",   # pyupgrade (modernize syntax for target Python version)
    "B",    # bugbear (common bug patterns)
    "SIM",  # simplify (unnecessary complexity)
    "RUF",  # ruff-specific rules
]
ignore = [
    "E501",  # line too long (handled by formatter)
]

[tool.ruff.lint.per-file-ignores]
"tests/**/*.py" = [
    "S101",  # allow assert in tests
]

[tool.ruff.format]
quote-style = "double"
indent-style = "space"
docstring-code-format = true        # format code blocks in docstrings
```

#### Common rule sets

| Prefix | Source | What it catches |
|--------|--------|-----------------|
| `E` / `W` | pycodestyle | Style violations (whitespace, indentation) |
| `F` | pyflakes | Unused imports, undefined names, redefined variables |
| `I` | isort | Unsorted or ungrouped imports |
| `UP` | pyupgrade | Old syntax that can be modernized (`dict()` -> `{}`, old-style `format()`) |
| `B` | flake8-bugbear | Likely bugs: mutable default arguments, bare `except`, `assert False` |
| `SIM` | flake8-simplify | Unnecessary `if`/`else`, `not not`, `os.path` -> `pathlib` |
| `RUF` | ruff-specific | Ruff's own rules: unused `noqa`, ambiguous characters |
| `S` | bandit | Security issues: hardcoded passwords, `eval()`, SQL injection |
| `C4` | flake8-comprehensions | Unnecessary list/dict/set calls that should be comprehensions |

#### ruff vs black

ruff's formatter is a near-drop-in replacement for black. Key differences:
- ruff is 10-100x faster (Rust vs Python)
- ruff combines linting AND formatting in one tool
- ruff's formatter has some minor formatting differences from black (documented in ruff's docs), but is intentionally compatible for most codebases
- black is stable and widely adopted; ruff's formatter is newer but rapidly maturing

### pre-commit hooks

pre-commit is a framework for managing git hooks. It runs configured tools automatically before every commit:

```bash
# Install
pip install pre-commit
```

```yaml
# .pre-commit-config.yaml

repos:
  # ruff: linting + formatting
  - repo: https://github.com/astral-sh/ruff-pre-commit
    rev: v0.8.0
    hooks:
      - id: ruff
        args: [--fix]
      - id: ruff-format

  # mypy: type checking
  - repo: https://github.com/pre-commit/mirrors-mypy
    rev: v1.13.0
    hooks:
      - id: mypy
        additional_dependencies: []

  # general pre-commit hooks
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v5.0.0
    hooks:
      - id: trailing-whitespace
      - id: end-of-file-fixer
      - id: check-yaml
      - id: check-added-large-files
        args: [--maxkb=500]
      - id: check-merge-conflict
      - id: debug-statements       # catch leftover breakpoint() calls
```

```bash
# Install the git hooks (run once per repo clone)
pre-commit install

# Run against all files (useful for first-time setup)
pre-commit run --all-files

# Run a specific hook
pre-commit run ruff --all-files

# Skip hooks for a specific commit (use sparingly)
git commit --no-verify -m "WIP: quick save"

# Update hook versions
pre-commit autoupdate
```

How it works: `pre-commit install` writes a script to `.git/hooks/pre-commit`. Before every `git commit`, git executes this script, which runs each configured hook against the staged files. If any hook fails (non-zero exit), the commit is blocked. The developer fixes the issue, re-stages, and commits again.

### Type checking in CI

mypy or pyright should run in CI, not just locally, to catch type regressions:

```yaml
# .github/workflows/ci.yml (relevant section)

- name: Type check with mypy
  run: |
    pip install mypy
    mypy src/ --strict

- name: Lint and format with ruff
  run: |
    pip install ruff
    ruff check src/ tests/
    ruff format --check src/ tests/

- name: Run tests with coverage
  run: |
    pip install pytest pytest-cov
    pytest --cov=src --cov-report=xml --cov-fail-under=80 tests/
```

### The modern Python dev tools ecosystem

| Concern | Tool | Role |
|---------|------|------|
| Linting | **ruff** | Catch bugs, enforce style, sort imports |
| Formatting | **ruff format** | Consistent code style (replaces black) |
| Type checking | **mypy** or **pyright** | Static type verification |
| Testing | **pytest** | Test execution, fixtures, parametrize |
| Coverage | **pytest-cov** / **coverage.py** | Measure test coverage |
| Mocking | **pytest-mock** / **unittest.mock** | Test doubles for dependencies |
| Git hooks | **pre-commit** | Automate quality checks before commits |
| Dependency management | **pip** + **pip-tools** or **uv** | Lock dependencies, reproducible installs |
| Task running | **Makefile** or **just** | Developer-facing command shortcuts |

A minimal but complete `pyproject.toml` tying it all together:

```toml
# pyproject.toml
# run: cat pyproject.toml  (this is configuration, not executable)

[project]
name = "myproject"
version = "0.1.0"
requires-python = ">=3.12"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-v --strict-markers"
markers = [
    "slow: marks tests as slow",
    "integration: integration tests",
]

[tool.ruff]
target-version = "py312"
line-length = 88

[tool.ruff.lint]
select = ["E", "W", "F", "I", "UP", "B", "SIM", "RUF"]

[tool.mypy]
python_version = "3.12"
strict = true
warn_return_any = true
warn_unused_configs = true

[tool.coverage.run]
source = ["src"]
branch = true

[tool.coverage.report]
fail_under = 80
show_missing = true
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "if __name__ == .__main__.",
]
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Leftover breakpoint() in production.** A developer adds `breakpoint()` while debugging, fixes the bug, commits, and forgets to remove the breakpoint. In production, the program hangs at the breakpoint line, waiting for debugger input that will never come. Symptoms: the process appears alive (PID exists, port is open) but is not responding to requests. Gunicorn/uvicorn workers time out and get killed. Fix: add the `debug-statements` pre-commit hook (from `pre-commit-hooks`) which catches `breakpoint()`, `import pdb`, and `print()` in staged files. Also set `PYTHONBREAKPOINT=0` in production environment variables as a safety net.

**2. ruff and mypy disagree.** ruff does not perform type checking — it is a linter and formatter. mypy does not check style. You need both. A common frustration: ruff auto-fixes an import to be unused (because it was only used in a type annotation), then mypy complains about the missing import. Fix: use `from __future__ import annotations` (PEP 563) or `TYPE_CHECKING` blocks to separate runtime imports from type-checking imports. Configure ruff to understand `TYPE_CHECKING` blocks (`TC` rules).

**3. pre-commit hooks not installed after clone.** pre-commit hooks live in `.git/hooks/`, which is not version-controlled. Every new clone requires `pre-commit install`. Developers who skip this step commit unformatted, unlinted code. Fix: add a setup script or Makefile target (`make setup` runs `pre-commit install`), document it in the README, and run the same checks in CI as a backstop. CI catches what local hooks missed.
:::

## 🎯 Checkpoint

::: details Question 1 — breakpoint() mechanics
**Q:** What happens when Python executes `breakpoint()`? How does `PYTHONBREAKPOINT` change the behavior, and why is this design better than `import pdb; pdb.set_trace()`?

**A:** `breakpoint()` is a built-in function (added in Python 3.7 via PEP 553) that calls `sys.breakpointhook()`. By default, `sys.breakpointhook` calls `pdb.set_trace()`. The `PYTHONBREAKPOINT` environment variable controls what `sys.breakpointhook` does:

- Not set or `""`: calls `pdb.set_trace()` (the default)
- `"0"`: `breakpoint()` is a no-op (returns immediately)
- `"some.module.function"`: imports `some.module` and calls `function()`

This is better than `import pdb; pdb.set_trace()` for three reasons: (1) you can disable all breakpoints in production with a single env var (`PYTHONBREAKPOINT=0`) without touching code, (2) you can swap debuggers (ipdb, pdb++, remote debuggers) without modifying source files, and (3) it is a single function call instead of an import + call, reducing the chance of leaving half-removed debug code.
:::

::: details Question 2 — Where ruff fits in the toolchain
**Q:** A colleague says "we use ruff, so we do not need mypy." Is this correct? What does ruff check that mypy does not, and vice versa?

**A:** This is incorrect. ruff and mypy operate at different levels:

**ruff** is a linter and formatter. It checks for: style violations (PEP 8), unused imports, undefined names, mutable default arguments, unreachable code, import ordering, and many pattern-based bug detectors. It rewrites the AST for formatting but does not understand types. It catches `def f(x=[]):` as a bug (mutable default) because it matches a syntactic pattern, not because it analyzed the type flow.

**mypy** is a type checker. It understands the type system: generics, protocols, overloads, union types, type narrowing. It catches: passing a `str` where an `int` is expected, accessing an attribute that does not exist on a type, returning `None` from a function declared to return `str`, and incorrect generic usage.

Example that ruff misses but mypy catches:
```python
def get_name(user_id: int) -> str:
    return None  # ruff: fine. mypy: error, incompatible return type.
```

Example that mypy misses but ruff catches:
```python
import os  # ruff: F401 unused import. mypy: no opinion.
def f(items=[]):  # ruff: B006 mutable default. mypy: no opinion.
```

You need both.
:::

::: details Question 3 — Post-mortem debugging
**Q:** Your production service logged a traceback but the error is hard to reproduce. You have a dump of the locals at the crash point. In development, how would you use post-mortem debugging to inspect the state, and what are its limitations?

**A:** In development, if you can reproduce the crash, run the script under pdb: `python3 -m pdb script.py`. When the unhandled exception occurs, pdb automatically enters post-mortem mode at the crash frame. You can then use `p variable` to inspect locals, `w` to see the call stack, `u`/`d` to navigate frames, and understand the state that led to the crash.

If you are in an interactive session (REPL, Jupyter), call `pdb.pm()` after the exception — it examines `sys.last_traceback` and drops you into the frame where the exception was raised.

Limitations: (1) post-mortem only works for unhandled exceptions — if the exception is caught and re-raised or logged, `pdb.pm()` may not have the right traceback; (2) you cannot step *forward* — execution is done, you can only inspect the state at the crash point; (3) it requires the crash to be reproducible in a development environment — if the bug depends on production data, load patterns, or race conditions, you need logging, tracing, or core dumps instead; (4) `pdb.pm()` relies on `sys.last_traceback`, which is only set in interactive mode, not in scripts run with `python3 script.py`.
:::

## Key Mental Models

- **breakpoint() is configurable pdb.** It checks `PYTHONBREAKPOINT` so you can disable debugging in production, swap debuggers without code changes, and keep a single consistent entry point for interactive debugging.

- **pdb is always available.** No install, no IDE, no configuration. Learn the five core commands (`n`, `s`, `c`, `p`, `w`) and you can debug anywhere — SSH sessions, Docker containers, CI runners.

- **ruff is lint + format, not type checking.** ruff catches syntactic and pattern-based issues at 100x the speed of flake8. mypy/pyright catch type-level issues. They are complementary, not alternatives.

- **pre-commit is the last line of defense before the repository.** It runs quality tools automatically on staged files at commit time. CI is the backstop for developers who skip hooks. Together, they create a two-layer quality gate.

- **The modern Python toolchain is four tools.** ruff (lint + format), mypy (types), pytest (tests), pre-commit (automation). Everything else is optional specialization. Start here, add tools only when a specific need arises.

## Related

- [pytest — Testing Done Right](./01-pytest.md) — the test framework that debugging and tooling support
- [Mocking & Coverage](./02-mocking-coverage.md) — coverage.py and pytest-cov integrate with the CI pipeline described here
- [Imports & Packaging](/python/module-08/) — understanding how Python resolves imports helps debug import errors and configure ruff's isort rules
- [Type Hints & Modern Python](/python/module-10/) — the type system that mypy/pyright enforce, and ruff's `UP` rules that modernize annotation syntax
