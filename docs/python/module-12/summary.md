---
title: Module 12 Summary
outline: deep
---

# Module 12 Summary — Testing, Debugging & Tooling

## Mental Models Gained

1. **Tests are functions, assertions are assertions.** pytest strips away the class hierarchy and method zoo of unittest. A test is a function named `test_*`. An assertion is `assert`. pytest rewrites the AST at import time to give you detailed failure diffs from plain assert statements — no `assertEqual`, `assertIn`, or `assertRaises` methods needed.

2. **Fixtures are dependency injection, not setup/teardown.** pytest inspects your test function's parameter names, resolves them from a hierarchical fixture registry (conftest.py files from root to test directory), and injects them. Scope controls lifetime (function/class/module/session). Yield fixtures give you setup-before-yield and teardown-after-yield with guaranteed cleanup.

3. **Patch where the name is looked up, not where it lives.** `from X import Y` copies the reference into the importing module. Patching `X.Y` does not affect the copy. You must patch `importing_module.Y`. This is the single most common mocking mistake and the single most important rule to internalize.

4. **Coverage measures breadth, not depth.** Line coverage tells you which code ran. Branch coverage tells you which decision paths were taken. Neither tells you whether the test actually *checked* the result. Coverage is a necessary minimum, not a quality guarantee.

5. **ruff is lint + format; mypy is types. You need both.** ruff catches syntactic patterns (unused imports, mutable defaults, style). mypy catches type-level errors (wrong argument types, missing return values, invalid attribute access). They operate at different levels and are complementary, never substitutes.

6. **pre-commit + CI = two-layer quality gate.** pre-commit hooks run tools on staged files before every commit, catching issues at the earliest possible moment. CI runs the same checks on the full codebase as a backstop. Together, they prevent quality regressions from reaching the main branch.

## Self-Assessment Checklist

Use this checklist to verify you have internalized the module. If you cannot answer a question confidently, revisit the linked page.

- [ ] **Can you write a pytest test file from scratch?** Test functions, fixtures, parametrize, `pytest.raises` for exceptions, `pytest.approx` for floats. No unittest imports needed. ([pytest](./01-pytest.md))

- [ ] **Can you explain how pytest's assert introspection works?** AST rewriting at import time via `PytestAssertRewriteHook`. The `assert` statement is expanded to capture intermediate values and produce detailed diffs on failure. ([pytest](./01-pytest.md))

- [ ] **Can you write a yield fixture with proper setup and teardown?** Setup before `yield`, teardown after. Teardown runs even if the test raises. If setup fails before `yield`, teardown does not run (correct behavior — nothing to clean up). ([pytest](./01-pytest.md))

- [ ] **Can you explain fixture scopes and their trade-offs?** `function` (default, isolated), `class`, `module`, `session` (shared, faster but couples tests). Mutable state in wide-scope fixtures causes order-dependent failures. ([pytest](./01-pytest.md))

- [ ] **Can you apply the "where to patch" rule correctly?** Given `from db import connect` in `service.py`, you patch `service.connect`, not `db.connect`. The rule: patch where the name is looked up by the code under test. ([Mocking & Coverage](./02-mocking-coverage.md))

- [ ] **Do you know when to use Mock vs MagicMock?** MagicMock has magic methods pre-configured (works with `len()`, `bool()`, `str()`). Mock does not — raises TypeError for magic method calls, which is useful when you want to catch accidental usage. ([Mocking & Coverage](./02-mocking-coverage.md))

- [ ] **Can you explain line coverage vs branch coverage?** Line: did this line execute? Branch: did this conditional go both True and False? A function can have 100% line coverage and 50% branch coverage if a conditional's false branch shares no unique lines. ([Mocking & Coverage](./02-mocking-coverage.md))

- [ ] **Can you debug a Python script with pdb?** `breakpoint()` to pause, `n` to step over, `s` to step in, `p` to print, `w` for call stack, `u`/`d` to navigate frames, `c` to continue. ([Debugging & Tooling](./03-debugging-tooling.md))

- [ ] **Can you configure ruff for a project?** `pyproject.toml` with `[tool.ruff]`, select rule sets (E, F, I, UP, B), set target version, configure per-file ignores for tests. ([Debugging & Tooling](./03-debugging-tooling.md))

- [ ] **Can you set up pre-commit hooks for a Python project?** `.pre-commit-config.yaml` with ruff (lint + format), mypy, and standard hooks (trailing whitespace, debug statements). `pre-commit install` to activate. ([Debugging & Tooling](./03-debugging-tooling.md))

## Quick Reference

### pytest fixtures cheat sheet

| Pattern | Code | When to use |
|---------|------|-------------|
| Basic fixture | `@pytest.fixture` <br> `def db(): return Database()` | Simple setup, no cleanup needed |
| Yield fixture | `@pytest.fixture` <br> `def db(): conn = connect(); yield conn; conn.close()` | Setup + guaranteed teardown |
| Scoped fixture | `@pytest.fixture(scope="session")` <br> `def db(): ...` | Expensive setup shared across tests |
| Autouse fixture | `@pytest.fixture(autouse=True)` <br> `def timer(): ...` | Applied to every test automatically |
| Parametrized fixture | `@pytest.fixture(params=["pg", "mysql"])` <br> `def db(request): return connect(request.param)` | Run all dependent tests with each param |
| tmp_path | `def test_x(tmp_path: Path): ...` | Built-in: unique temp directory per test |
| Fixture depending on fixture | `@pytest.fixture` <br> `def user(db): return db.create_user()` | Composable dependency chain |

### Common pytest CLI flags

```bash
pytest -v                    # verbose: show each test name
pytest -x                    # stop on first failure
pytest -k "test_login"       # run tests matching keyword expression
pytest -m "not slow"         # run tests not marked as slow
pytest --lf                  # re-run only last-failed tests
pytest --ff                  # run last-failed first, then rest
pytest -n auto               # parallel execution (pytest-xdist)
pytest --tb=short            # shorter tracebacks
pytest --tb=no               # no tracebacks (just pass/fail)
pytest -s                    # do not capture stdout (see print output)
pytest --co                  # collect only (list tests without running)
```

### pdb commands table

| Command | Short | Action |
|---------|-------|--------|
| `next` | `n` | Step over (execute line, do not enter functions) |
| `step` | `s` | Step into (enter the called function) |
| `continue` | `c` | Resume until next breakpoint or end |
| `return` | `r` | Continue until current function returns |
| `print expr` | `p` | Print expression value |
| `pp expr` | | Pretty-print expression |
| `list` | `l` | Show source around current line |
| `longlist` | `ll` | Show entire current function |
| `where` | `w` | Print call stack |
| `up` | `u` | Move one frame up (toward caller) |
| `down` | `d` | Move one frame down (toward callee) |
| `break N` | `b N` | Set breakpoint at line N |
| `clear` | `cl` | Remove breakpoints |
| `args` | `a` | Print current function's arguments |
| `display expr` | | Show expr every time execution stops |
| `quit` | `q` | Exit debugger and abort program |

### ruff setup checklist

1. Install: `pip install ruff`
2. Add `[tool.ruff]` section to `pyproject.toml`
3. Set `target-version` to your minimum Python version
4. Select rule sets: start with `["E", "F", "I", "UP", "B"]`
5. Add per-file ignores: allow `assert` in tests (`S101`)
6. Run `ruff check .` to see current violations
7. Run `ruff check --fix .` to auto-fix what is fixable
8. Run `ruff format .` to format all files
9. Add ruff to pre-commit hooks
10. Add `ruff check` and `ruff format --check` to CI

### Dev tooling stack table

| Layer | Tool | What it does | When it runs |
|-------|------|-------------|--------------|
| Linting | **ruff check** | Catches bugs, enforces style, sorts imports | Editor save, pre-commit, CI |
| Formatting | **ruff format** | Consistent whitespace, quotes, line length | Editor save, pre-commit, CI |
| Type checking | **mypy** or **pyright** | Verifies type annotations | Editor (pyright), pre-commit (mypy), CI |
| Testing | **pytest** | Runs test suite, reports failures | Manual, pre-push hook, CI |
| Coverage | **pytest-cov** | Measures which lines/branches tests exercise | CI (with fail-under threshold) |
| Git hooks | **pre-commit** | Runs lint/format/type checks on staged files | Every `git commit` |
| CI pipeline | **GitHub Actions** / etc. | Runs all checks on every push/PR | Every push, every PR |

## Congratulations

You have completed the Python track. From the data model and memory layout (Module 1) through concurrency, packaging, type hints, standard library, and now testing and tooling (Module 12), you have covered Python at a level that goes well beyond surface-level usage.

The mental models from these twelve modules form an interconnected web: understanding how Python resolves names (Module 3) explains why "where to patch" matters (this module). Understanding the GIL (Module 7) explains why `pytest-xdist` uses subprocesses, not threads. Understanding the import system (Module 8) explains how conftest.py resolution works.

Go back to the [Python Track Overview](/python/) to review the full module map and identify any areas worth revisiting.
