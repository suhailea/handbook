---
title: pytest — Testing Done Right
outline: deep
---

# pytest — Testing Done Right

Interview weight: 🔥🔥🔥 &nbsp;|&nbsp; Python 3.8+ (examples target 3.12+) &nbsp;|&nbsp; Prerequisites: [Functions & Scoping](/python/module-03/), [OOP](/python/module-04/), [Error Handling](/python/module-06/)

## 🗣️ In Plain English

::: tip In Plain English
Imagine you hire a building inspector to check every room in your house. The old inspector — think of him as **unittest** — is thorough but impossibly bureaucratic. Before he can check if a wall is straight, you must fill out a specific form (create a class that inherits from `TestCase`), use his proprietary ruler (`assertEqual`, `assertGreater`, `assertIn` — a different method for every type of check), and submit each form in triplicate. If you forget the right form name, he shrugs and walks out.

The new inspector — **pytest** — just walks in. No paperwork. You point at a wall and say "that should be straight" (a plain `assert`). If it is, he nods and moves on. If it is not, he does not just say "nope" — he pulls out a laser level and shows you *exactly* how crooked it is, which direction it leans, and by how many millimeters. That detailed report is what pytest calls **assertion introspection**.

What about setup? The old inspector expected you to personally prepare every room before he arrived, pushing furniture aside and turning on lights (setUp/tearDown methods). Pytest uses **fixtures** instead — a prep crew. You write a description of what each crew does ("install a temporary sink", "set up sample furniture"), and the inspector figures out which crews he needs for each room just by looking at the room's checklist. If two rooms both need a temporary sink, the crew shares one. If a crew needs to clean up afterwards (remove the sink), they know to do that automatically.

Want to test the same room with ten different paint colors? You do not write ten separate checklists. You write one and attach a list of colors. The inspector runs through the room once per color, reporting each result separately. That is **parametrize**.

The result: you write less paperwork, get better failure reports, and the inspector handles the logistics of who-needs-what. You just describe what "correct" looks like.
:::

## ⚙️ Under the Hood

### pytest vs unittest: why pytest won

unittest, inspired by Java's JUnit, shipped with Python's standard library. It requires:

- Subclassing `TestCase`
- Using specific assertion methods (`assertEqual`, `assertRaises`, `assertIn`, etc.)
- `setUp`/`tearDown` methods for fixture logic

pytest eliminates all of that. A test is any function whose name starts with `test_`, in any file whose name starts with `test_` or ends with `_test.py`. Assertions are plain `assert` statements. Setup and teardown are handled by fixtures injected via function parameters.

```python
# test_comparison.py
# run: python3 -m pytest test_comparison.py -v

# --- unittest style ---
import unittest

class TestMathUnittest(unittest.TestCase):
    def test_addition(self) -> None:
        self.assertEqual(1 + 1, 2)

    def test_list_contains(self) -> None:
        self.assertIn("apple", ["apple", "banana", "cherry"])


# --- pytest style ---

def test_addition() -> None:
    assert 1 + 1 == 2

def test_list_contains() -> None:
    assert "apple" in ["apple", "banana", "cherry"]
```

pytest can also run unittest-style tests, so migration is incremental.

### Test discovery

pytest searches for tests using these rules:

1. **Files**: names matching `test_*.py` or `*_test.py` (configurable via `python_files` in config)
2. **Functions**: names starting with `test_` (configurable via `python_functions`)
3. **Classes**: names starting with `Test` (no `__init__` method), containing methods starting with `test_`
4. **Directories**: recurse from the invocation path or configured `testpaths`

```ini
# pyproject.toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
python_functions = ["test_*"]
python_classes = ["Test*"]
```

### conftest.py: shared fixtures, hooks, plugins

`conftest.py` is a special file that pytest loads automatically. It is **hierarchical** — pytest collects `conftest.py` from the root down to the test file's directory, merging fixtures and hooks at each level.

```
tests/
  conftest.py            # fixtures available to ALL tests
  unit/
    conftest.py          # fixtures available to tests/unit/ only
    test_models.py
  integration/
    conftest.py          # fixtures available to tests/integration/ only
    test_api.py
```

No imports needed. Fixtures defined in `conftest.py` are automatically available to tests in that directory and below.

### Assertions: plain `assert` with AST rewriting

When pytest collects a test file, it **rewrites the AST** (abstract syntax tree) of every `assert` statement before Python compiles it. A plain `assert left == right` is transformed into code that, on failure, captures `left`, `right`, and the comparison, producing a detailed diff:

```
    def test_dicts():
>       assert {"a": 1, "b": 2} == {"a": 1, "b": 3}
E       AssertionError: assert {'a': 1, 'b': 2} == {'a': 1, 'b': 3}
E         Differing items:
E         {'b': 2} != {'b': 3}
```

This works for `==`, `!=`, `in`, `not in`, `is`, `is not`, and comparisons. For compound expressions like `assert a and b`, pytest shows which part was falsy. This eliminates the need for dozens of `assert*` methods.

### Fixtures: the dependency injection system

Fixtures replace `setUp`/`tearDown` with composable, injectable functions.

```python
# conftest.py
# run: python3 -m pytest test_user_service.py -v

import pytest
from dataclasses import dataclass


@dataclass
class User:
    id: int
    name: str
    email: str


@dataclass
class Database:
    users: dict[int, User]

    def get_user(self, user_id: int) -> User | None:
        return self.users.get(user_id)

    def add_user(self, user: User) -> None:
        self.users[user.id] = user


@pytest.fixture
def sample_user() -> User:
    """A single test user."""
    return User(id=1, name="Alice", email="alice@example.com")


@pytest.fixture
def db(sample_user: User) -> Database:
    """A database pre-loaded with one user. Depends on sample_user fixture."""
    database = Database(users={})
    database.add_user(sample_user)
    return database
```

```python
# test_user_service.py
# run: python3 -m pytest test_user_service.py -v

from conftest import Database, User


def test_get_existing_user(db: Database, sample_user: User) -> None:
    """pytest sees 'db' and 'sample_user' in the signature and injects them."""
    result = db.get_user(sample_user.id)
    assert result is not None
    assert result.name == "Alice"


def test_get_missing_user(db: Database) -> None:
    result = db.get_user(999)
    assert result is None
```

**How fixture injection works:** pytest inspects the test function's signature using `inspect.signature()`. Each parameter name is looked up in the fixture registry (built from `conftest.py` files and `@pytest.fixture` decorators in the test module). Fixtures that themselves have fixture parameters trigger recursive resolution — pytest builds a dependency graph and executes fixtures in topological order.

### Fixture scopes

The `scope` parameter controls how often a fixture is created and destroyed:

| Scope | Lifetime | Use case |
|-------|----------|----------|
| `function` (default) | Created/destroyed per test function | Isolated, no state leakage |
| `class` | Once per test class | Shared setup for a class of related tests |
| `module` | Once per test module (file) | Expensive setup shared across a file |
| `session` | Once per entire test run | Database connections, server processes |

```python
# run: python3 -m pytest test_scopes.py -v -s

import pytest


@pytest.fixture(scope="module")
def expensive_resource() -> str:
    print("\n  [SETUP] Creating expensive resource")
    return "shared_connection"


def test_one(expensive_resource: str) -> None:
    print(f"  test_one using: {expensive_resource}")
    assert expensive_resource == "shared_connection"


def test_two(expensive_resource: str) -> None:
    print(f"  test_two using: {expensive_resource}")
    assert expensive_resource == "shared_connection"

# Output: [SETUP] prints only once for both tests
```

### Yield fixtures: setup + teardown

A `yield` fixture performs setup before the yield and teardown after. The teardown runs even if the test raises an exception (pytest wraps it in a try/finally).

```python
# run: python3 -m pytest test_yield_fixture.py -v -s

import pytest
import tempfile
import os


@pytest.fixture
def temp_config_file() -> str:
    """Create a temp config file, yield its path, then clean up."""
    fd, path = tempfile.mkstemp(suffix=".cfg")
    os.write(fd, b"debug=true\n")
    os.close(fd)
    print(f"\n  [SETUP] Created {path}")

    yield path  # test runs here

    os.unlink(path)
    print(f"  [TEARDOWN] Deleted {path}")


def test_config_exists(temp_config_file: str) -> None:
    assert os.path.exists(temp_config_file)
    with open(temp_config_file) as f:
        assert "debug=true" in f.read()
```

### The `tmp_path` fixture

pytest provides a built-in `tmp_path` fixture that gives each test its own temporary directory as a `pathlib.Path`. Cleanup is automatic (pytest keeps the last few runs for debugging).

```python
# run: python3 -m pytest test_tmp_path.py -v

from pathlib import Path


def test_write_and_read(tmp_path: Path) -> None:
    file = tmp_path / "data.txt"
    file.write_text("hello pytest")
    assert file.read_text() == "hello pytest"
    assert file.parent == tmp_path
```

### `autouse` fixtures

A fixture with `autouse=True` is injected into every test in its scope without being named in the test signature. Use sparingly — implicit behavior is harder to debug.

```python
# run: python3 -m pytest test_autouse.py -v -s

import pytest
import time


@pytest.fixture(autouse=True)
def timer() -> None:
    start = time.perf_counter()
    yield
    elapsed = time.perf_counter() - start
    print(f"  [{elapsed:.4f}s]", end="")
```

### @pytest.mark.parametrize: data-driven tests

Instead of writing separate test functions for each input, parametrize runs one test function with multiple sets of arguments.

```python
# run: python3 -m pytest test_parametrize.py -v

import pytest


@pytest.mark.parametrize(
    "input_str, expected",
    [
        ("hello", "HELLO"),
        ("Hello World", "HELLO WORLD"),
        ("", ""),
        ("123abc", "123ABC"),
    ],
    ids=["lowercase", "mixed_case", "empty", "alphanumeric"],
)
def test_uppercase(input_str: str, expected: str) -> None:
    assert input_str.upper() == expected


# Multiple parametrize decorators create a cartesian product
@pytest.mark.parametrize("x", [1, 2])
@pytest.mark.parametrize("y", [10, 20])
def test_multiply(x: int, y: int) -> None:
    assert x * y > 0  # 4 test cases: (1,10), (1,20), (2,10), (2,20)
```

### Markers: skip, xfail, custom

Markers add metadata to tests, controlling when and how they run.

```python
# run: python3 -m pytest test_markers.py -v

import sys
import pytest


@pytest.mark.skip(reason="Not implemented yet")
def test_future_feature() -> None:
    pass


@pytest.mark.skipif(
    sys.platform == "win32",
    reason="Unix-only functionality",
)
def test_unix_permissions() -> None:
    import os
    assert hasattr(os, "getuid")


@pytest.mark.xfail(reason="Known bug #1234, fix in progress")
def test_known_broken() -> None:
    # If this passes, pytest reports XPASS (unexpected pass)
    # If this fails, pytest reports xfail (expected failure) — not a failure
    assert 1 / 0  # type: ignore[unreachable]
```

Custom markers let you categorize tests and run subsets:

```python
# pyproject.toml
# [tool.pytest.ini_options]
# markers = ["slow: marks tests as slow", "integration: integration tests"]

# Usage: pytest -m "not slow" to skip slow tests
```

### Exception testing with `pytest.raises`

```python
# run: python3 -m pytest test_exceptions.py -v

import pytest


def divide(a: float, b: float) -> float:
    if b == 0:
        raise ValueError(f"Cannot divide {a} by zero")
    return a / b


def test_divide_by_zero() -> None:
    with pytest.raises(ValueError, match=r"Cannot divide .+ by zero"):
        divide(10, 0)


def test_divide_by_zero_inspect() -> None:
    with pytest.raises(ValueError) as exc_info:
        divide(42, 0)
    assert "42" in str(exc_info.value)
    assert exc_info.type is ValueError
```

### Float comparison with `pytest.approx`

```python
# run: python3 -m pytest test_approx.py -v

import pytest


def test_floating_point() -> None:
    # 0.1 + 0.2 != 0.3 due to IEEE 754
    assert 0.1 + 0.2 != 0.3  # this is True (they are NOT equal)

    # pytest.approx handles the tolerance
    assert 0.1 + 0.2 == pytest.approx(0.3)
    assert 0.1 + 0.2 == pytest.approx(0.3, abs=1e-9)


def test_approx_sequences() -> None:
    result = [0.1 * i for i in range(5)]
    expected = [0.0, 0.1, 0.2, 0.3, 0.4]
    assert result == pytest.approx(expected)
```

### Plugins ecosystem

| Plugin | Purpose | Install |
|--------|---------|---------|
| `pytest-asyncio` | Test async functions with `@pytest.mark.asyncio` | `pip install pytest-asyncio` |
| `pytest-mock` | `mocker` fixture wrapping `unittest.mock` | `pip install pytest-mock` |
| `pytest-xdist` | Parallel test execution (`pytest -n auto`) | `pip install pytest-xdist` |
| `pytest-cov` | Coverage reporting integrated into pytest | `pip install pytest-cov` |
| `pytest-timeout` | Fail tests that run too long | `pip install pytest-timeout` |
| `pytest-randomly` | Randomize test order to catch hidden state deps | `pip install pytest-randomly` |

### A complete test file example

```python
# test_calculator.py
# run: python3 -m pytest test_calculator.py -v

import pytest
from dataclasses import dataclass


@dataclass
class Calculator:
    history: list[str]

    def __init__(self) -> None:
        self.history = []

    def add(self, a: float, b: float) -> float:
        result = a + b
        self.history.append(f"{a} + {b} = {result}")
        return result

    def divide(self, a: float, b: float) -> float:
        if b == 0:
            raise ValueError("Division by zero")
        result = a / b
        self.history.append(f"{a} / {b} = {result}")
        return result


# --- Fixtures ---

@pytest.fixture
def calc() -> Calculator:
    """Fresh calculator for each test."""
    return Calculator()


# --- Tests ---

class TestAdd:
    def test_positive_numbers(self, calc: Calculator) -> None:
        assert calc.add(2, 3) == 5

    def test_negative_numbers(self, calc: Calculator) -> None:
        assert calc.add(-1, -1) == -2

    @pytest.mark.parametrize(
        "a, b, expected",
        [
            (0, 0, 0),
            (1, -1, 0),
            (0.1, 0.2, pytest.approx(0.3)),
            (1_000_000, 1, 1_000_001),
        ],
        ids=["zeros", "cancel_out", "floats", "large"],
    )
    def test_various_inputs(
        self, calc: Calculator, a: float, b: float, expected: float
    ) -> None:
        assert calc.add(a, b) == expected


class TestDivide:
    def test_basic_division(self, calc: Calculator) -> None:
        assert calc.divide(10, 2) == 5.0

    def test_division_by_zero(self, calc: Calculator) -> None:
        with pytest.raises(ValueError, match="Division by zero"):
            calc.divide(1, 0)


class TestHistory:
    def test_operations_recorded(self, calc: Calculator) -> None:
        calc.add(1, 2)
        calc.divide(10, 5)
        assert len(calc.history) == 2
        assert "1 + 2 = 3" in calc.history[0]

    def test_fresh_calculator_has_no_history(self, calc: Calculator) -> None:
        assert calc.history == []
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Fixture scope leakage.** A `module`- or `session`-scoped fixture that returns a mutable object (a list, a dict, a database connection with uncommitted state) shares that object across tests. Test A appends to the list, Test B sees the appended item. Symptoms: tests pass in isolation (`pytest test_b.py`) but fail when run together (`pytest`). The test order matters, which means you have hidden coupling. Fix: use `function` scope for mutable state, or return a fresh copy from the fixture. The `pytest-randomly` plugin is invaluable for catching this — it randomizes test order on every run.

**2. Conftest.py at the wrong level.** A `conftest.py` placed at the project root (next to `pyproject.toml`) is loaded for *every* test in every subdirectory. If it imports heavy dependencies (database clients, ML models), every test pays the import cost, even unit tests that do not need them. Worse, if the import fails (missing dev dependency in CI), the *entire* test suite fails to collect. Fix: put heavy fixtures in subdirectory-level conftest files (`tests/integration/conftest.py`), not the root.

**3. Parametrize without ids creates unreadable output.** When a parametrized test fails, the default ID is `test_func[arg0-arg1-arg2]`, which means nothing when `arg0` is a complex object. Symptoms: CI shows a failure in `test_validate[user0-True-None]` and nobody knows which case that is. Fix: always provide `ids` for parametrize, or use `pytest.param(..., id="descriptive_name")`.

**4. Collecting too many tests from site-packages.** If `testpaths` is not configured and pytest recurses from the project root, it may descend into `.venv/` or `node_modules/` and try to collect test files from installed packages. Symptoms: collection takes minutes, or crashes with import errors from third-party test files. Fix: always set `testpaths = ["tests"]` in `pyproject.toml` and add `--rootdir` if needed.
:::

## 🎯 Checkpoint

::: details Question 1 — Fixture injection mechanics
**Q:** How does pytest know which fixtures to inject into a test function? What happens if two fixtures have the same name at different conftest levels?

**A:** pytest inspects the test function's signature using `inspect.signature()` and looks up each parameter name in a fixture registry. The registry is built by scanning `conftest.py` files from the rootdir down to the test file's directory, plus any `@pytest.fixture` decorators in the test module itself. If two fixtures share the same name, the **closer** one wins — a fixture in `tests/unit/conftest.py` overrides one in `tests/conftest.py` for tests in `tests/unit/`. This is intentional and enables fixture specialization per test directory. The resolution order is: test module > nearest conftest > parent conftest > root conftest > plugins.
:::

::: details Question 2 — Assert rewriting
**Q:** How does pytest provide detailed failure messages from plain `assert` statements, given that Python's built-in `assert` only produces `AssertionError` with an optional string?

**A:** During test collection, pytest uses an import hook (`PytestAssertRewriteHook`) that intercepts the import of test modules. Before Python compiles the module to bytecode, pytest parses the source into an AST, finds every `assert` statement, and rewrites it into expanded code that captures the intermediate values of the expression. For example, `assert a == b` becomes code that evaluates `a` and `b`, stores both, performs the comparison, and if it fails, constructs a detailed error message showing both values and their diff. This happens at import time, has no runtime cost for passing assertions, and works with any expression — comparisons, membership tests, boolean combinations, and even function calls (though the introspection depth varies). The rewriting is why third-party assertion libraries are unnecessary in pytest.
:::

::: details Question 3 — Yield fixtures and error handling
**Q:** If a test raises an exception, does the teardown code after `yield` in a yield fixture still run? What about if the fixture's own setup code raises?

**A:** If the **test** raises an exception, yes — the teardown code after `yield` still runs. pytest wraps the yield in the equivalent of a `try`/`finally`, so cleanup is guaranteed regardless of test outcome. However, if the fixture's **setup** code (before the `yield`) raises an exception, the `yield` is never reached, so the teardown code does not run. This is the correct behavior — teardown should only clean up resources that were actually created. If setup partially succeeds (e.g., file created but database insert fails), you need explicit error handling in the setup code itself, or use `request.addfinalizer()` to register cleanup callbacks as resources are created, rather than relying on a single yield point.
:::

## Key Mental Models

- **Tests are just functions.** No class hierarchy, no assertion methods — pytest discovers functions named `test_*` and treats plain `assert` as the universal assertion by rewriting the AST at import time to capture intermediate values.

- **Fixtures are dependency injection.** pytest reads your test function's parameter names and recursively resolves them from the fixture registry, building a DAG of dependencies. This replaces `setUp`/`tearDown` with composable, scoped, injectable units.

- **Scope controls sharing, sharing implies trust.** A `session`-scoped fixture is created once and shared across thousands of tests. If it holds mutable state, every test that touches it is implicitly coupled to every other. Default to `function` scope; widen only when creation cost justifies the coupling risk.

- **conftest.py is hierarchical, not global.** Fixtures in a subdirectory's `conftest.py` override parent-level fixtures of the same name and are invisible to sibling directories. This lets you specialize fixtures per test category without cross-contamination.

- **Parametrize multiplies tests, not complexity.** One function plus N parameter sets produces N independent test cases, each with its own pass/fail status. Always provide `ids` so failures are immediately identifiable.

## Related

- [Mocking & Coverage](./02-mocking-coverage.md) — how to isolate units and measure what your tests actually cover
- [Error Handling](/python/module-06/01-exceptions.md) — the exception mechanics that `pytest.raises` tests against
- [Functions & Scoping](/python/module-03/) — closures and name lookup, relevant to fixture injection and parametrize
- [Imports & Packaging](/python/module-08/) — understanding the import system helps with conftest resolution and the "where to patch" rule in mocking
