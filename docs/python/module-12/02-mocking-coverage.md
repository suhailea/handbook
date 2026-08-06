---
title: Mocking & Coverage
outline: deep
---

# Mocking & Coverage

Interview weight: 🔥🔥 &nbsp;|&nbsp; Python 3.8+ (AsyncMock), examples target 3.12+ &nbsp;|&nbsp; Prerequisites: [pytest](./01-pytest.md), [Imports & Packaging](/python/module-08/), [OOP](/python/module-04/)

## 🗣️ In Plain English

::: tip In Plain English
Think of filming a movie. There is a scene where the hero jumps off a building. You are not going to throw the real actor off a real building — that is expensive, dangerous, and you only get one take. Instead, you bring in a **stunt double** who *looks* like the actor from the camera's angle and can perform the jump safely. Afterwards, the director reviews the footage: did the double jump from the right spot? Did they do the flip we asked for? How many takes did it need? The director can check all of this because the stunt double was told to report back.

In testing, the "dangerous jump" is calling a real external service — a database, a payment API, a slow machine-learning model. A **Mock** is your stunt double. It takes the place of the real thing, responds with pre-scripted answers ("if someone asks for user #42, say the name is Alice"), and quietly records every call made to it. After the scene (test) finishes, you can ask the mock: were you called? How many times? With what arguments?

The critical trick — and where most people get tripped up — is **where you position the stunt double**. You do not go to the stunt double's house and replace them there. You replace the actor *on set* — in the specific scene (module) where the actor's name is called. If your code says "get me the database module's `query` function," you replace `query` in *that* module, not in the database module's original home. Swap the actor where the camera is pointed, not where the actor lives.

**Coverage** is a different tool entirely. It is like a GPS tracker attached to the film crew. As they move through the studio (your code), it marks every set (line of code) they visited. After filming, you get a map showing which sets were used and which gathered dust. It cannot tell you if the scenes were *good* — only that the crew walked through them. A movie can visit every set and still be terrible. Tests can cover every line and still miss critical bugs.
:::

## ⚙️ Under the Hood

### Mock and MagicMock

The `unittest.mock` module (standard library since 3.3) provides two core classes:

- **`Mock`**: a flexible object that accepts any attribute access or method call and records them. Returns new Mocks for any attribute or method by default.
- **`MagicMock`**: a subclass of Mock with all **magic methods** (`__len__`, `__getitem__`, `__iter__`, `__str__`, etc.) pre-configured to return sensible defaults. In practice, you almost always want MagicMock.

```python
# test_mock_basics.py
# run: python3 -m pytest test_mock_basics.py -v

from unittest.mock import Mock, MagicMock


def test_mock_records_calls() -> None:
    service = Mock()

    # Call the mock like a function
    service.get_user(42)
    service.get_user(99, include_email=True)

    # Verify calls
    assert service.get_user.call_count == 2
    service.get_user.assert_called_with(99, include_email=True)  # last call


def test_mock_return_value() -> None:
    service = Mock()
    service.get_user.return_value = {"id": 42, "name": "Alice"}

    result = service.get_user(42)
    assert result["name"] == "Alice"


def test_mock_side_effect_exception() -> None:
    service = Mock()
    service.delete_user.side_effect = PermissionError("Admin only")

    import pytest
    with pytest.raises(PermissionError, match="Admin only"):
        service.delete_user(1)


def test_mock_side_effect_function() -> None:
    """side_effect can be a function for dynamic responses."""
    def fake_lookup(user_id: int) -> dict[str, object]:
        if user_id == 1:
            return {"id": 1, "name": "Alice"}
        raise KeyError(f"User {user_id} not found")

    service = Mock()
    service.get_user.side_effect = fake_lookup

    assert service.get_user(1)["name"] == "Alice"

    import pytest
    with pytest.raises(KeyError):
        service.get_user(999)


def test_mock_side_effect_iterable() -> None:
    """side_effect can be an iterable — returns values one at a time."""
    service = Mock()
    service.get_next.side_effect = [1, 2, 3]

    assert service.get_next() == 1
    assert service.get_next() == 2
    assert service.get_next() == 3


def test_magicmock_has_magic_methods() -> None:
    m = MagicMock()
    m.__len__.return_value = 5
    assert len(m) == 5

    m.__getitem__.return_value = "value"
    assert m["any_key"] == "value"

    # Regular Mock would raise TypeError for len()
```

### Key Mock attributes

| Attribute/Method | Purpose |
|-----------------|---------|
| `return_value` | What the mock returns when called |
| `side_effect` | Exception to raise, function to call, or iterable of return values |
| `call_args` | `(args, kwargs)` of the most recent call |
| `call_args_list` | List of all `(args, kwargs)` for every call |
| `call_count` | Number of times the mock was called |
| `assert_called()` | Assert the mock was called at least once |
| `assert_called_once()` | Assert exactly one call |
| `assert_called_with(*args, **kwargs)` | Assert the *last* call used these arguments |
| `assert_called_once_with(*args, **kwargs)` | Assert exactly one call, with these arguments |
| `assert_not_called()` | Assert zero calls |
| `reset_mock()` | Clear all recorded calls and assertions |

### patch: the core tool

`patch` temporarily replaces an attribute in a module's namespace with a Mock, then restores the original after the test. Three usage patterns:

```python
# app/service.py
from app.database import get_connection

def get_user_name(user_id: int) -> str:
    conn = get_connection()
    row = conn.execute("SELECT name FROM users WHERE id = ?", (user_id,))
    return row["name"]
```

```python
# test_service.py
# run: python3 -m pytest test_service.py -v

from unittest.mock import patch, MagicMock


# --- Pattern 1: decorator ---
@patch("app.service.get_connection")
def test_get_user_as_decorator(mock_conn_factory: MagicMock) -> None:
    mock_conn = MagicMock()
    mock_conn.execute.return_value = {"name": "Alice"}
    mock_conn_factory.return_value = mock_conn

    from app.service import get_user_name
    assert get_user_name(42) == "Alice"
    mock_conn.execute.assert_called_once()


# --- Pattern 2: context manager ---
def test_get_user_as_context_manager() -> None:
    with patch("app.service.get_connection") as mock_conn_factory:
        mock_conn = MagicMock()
        mock_conn.execute.return_value = {"name": "Bob"}
        mock_conn_factory.return_value = mock_conn

        from app.service import get_user_name
        assert get_user_name(1) == "Bob"
    # Original get_connection is restored here


# --- Pattern 3: manual start/stop ---
def test_get_user_manual() -> None:
    patcher = patch("app.service.get_connection")
    mock_conn_factory = patcher.start()

    mock_conn = MagicMock()
    mock_conn.execute.return_value = {"name": "Charlie"}
    mock_conn_factory.return_value = mock_conn

    from app.service import get_user_name
    assert get_user_name(7) == "Charlie"

    patcher.stop()  # Always call stop — or use addCleanup/fixture
```

### WHERE to patch: the critical rule

This is the single most common mocking mistake. The rule:

> **Patch where the thing is looked up, not where it is defined.**

```python
# db.py
def connect():
    return RealDatabaseConnection()

# service.py
from db import connect  # <-- 'connect' is now an attribute of service module

def do_work():
    conn = connect()  # <-- looks up 'connect' in service's namespace
    ...
```

```python
# WRONG — patches db.connect, but service.py already imported it
# into its own namespace. service.connect still points to the real function.
@patch("db.connect")
def test_wrong(mock_connect):
    ...

# RIGHT — patches service.connect, which is where the code looks it up
@patch("service.connect")
def test_right(mock_connect):
    ...
```

Why? `from db import connect` copies the *reference* to `connect` into `service`'s module namespace. After that, `service.connect` is an independent name binding. Patching `db.connect` replaces the original in `db`'s namespace, but `service.connect` still points to the old object. You must patch the name *as seen by the code under test*.

### patch.object: patching attributes on objects

When you need to patch a method on a specific object (not a module-level name):

```python
# test_patch_object.py
# run: python3 -m pytest test_patch_object.py -v

from unittest.mock import patch


class EmailClient:
    def send(self, to: str, body: str) -> bool:
        # In reality: connects to SMTP server
        raise NotImplementedError("Real email sending")


def test_patch_object() -> None:
    client = EmailClient()

    with patch.object(client, "send", return_value=True) as mock_send:
        result = client.send("user@example.com", "Hello")
        assert result is True
        mock_send.assert_called_once_with("user@example.com", "Hello")
```

### PropertyMock: mocking properties

```python
# test_property_mock.py
# run: python3 -m pytest test_property_mock.py -v

from unittest.mock import patch, PropertyMock


class Server:
    @property
    def is_healthy(self) -> bool:
        # In reality: performs health check
        raise NotImplementedError

    def status_report(self) -> str:
        return "OK" if self.is_healthy else "DOWN"


def test_unhealthy_server() -> None:
    with patch.object(
        Server, "is_healthy", new_callable=PropertyMock, return_value=False
    ):
        server = Server()
        assert server.status_report() == "DOWN"
```

### AsyncMock (Python 3.8+)

For testing async code, `AsyncMock` returns a coroutine that can be awaited:

```python
# test_async_mock.py
# run: python3 -m pytest test_async_mock.py -v

import pytest
from unittest.mock import AsyncMock


async def fetch_user(client: object, user_id: int) -> dict[str, object]:
    return await client.get(f"/users/{user_id}")  # type: ignore[attr-defined]


@pytest.mark.asyncio
async def test_fetch_user() -> None:
    mock_client = AsyncMock()
    mock_client.get.return_value = {"id": 1, "name": "Alice"}

    result = await fetch_user(mock_client, 1)
    assert result["name"] == "Alice"
    mock_client.get.assert_awaited_once_with("/users/1")
```

### pytest-mock: the mocker fixture

The `pytest-mock` plugin provides a `mocker` fixture that wraps `unittest.mock` with automatic cleanup — no need to manually stop patchers:

```python
# test_with_mocker.py
# run: pip install pytest-mock && python3 -m pytest test_with_mocker.py -v

from pytest_mock import MockerFixture


def send_notification(user_email: str, message: str) -> bool:
    """Pretend this calls an external API."""
    raise NotImplementedError("Real notification service")


def process_order(order_id: int, mocker_send: object) -> str:
    """Process an order and notify the user."""
    # In real code, mocker_send would be the real send_notification
    mocker_send("user@test.com", f"Order {order_id} confirmed")  # type: ignore[operator]
    return "processed"


def test_process_order(mocker: MockerFixture) -> None:
    # mocker.patch replaces the target and auto-restores after the test
    mock_send = mocker.patch(
        f"{__name__}.send_notification", return_value=True
    )

    # Or use mocker.MagicMock(), mocker.Mock(), mocker.spy(), etc.
    result = process_order(42, mock_send)
    assert result == "processed"
    mock_send.assert_called_once_with("user@test.com", "Order 42 confirmed")
```

### When mocking helps vs when it hurts

**Mocking helps when:**
- The dependency is slow (network, database, disk)
- The dependency is non-deterministic (time, random, external state)
- You need to test error paths (simulate network failures, timeouts)
- The dependency has side effects (sending emails, charging credit cards)

**Mocking hurts when:**
- You mock so much that the test only verifies your mocks, not your code
- You mock internal implementation details — refactoring breaks tests even though behavior is unchanged
- The mock's behavior drifts from reality (the real API changed, but the mock still returns the old format)
- You use mocks to avoid writing integration tests entirely

**The guideline:** mock at boundaries (external services, I/O), not at internal seams. If every class mocks every collaborator, your tests are testing wiring diagrams, not behavior.

### coverage.py: measuring what your tests exercise

`coverage.py` instruments your code to track which lines execute during a test run.

```bash
# Install
pip install coverage

# Run tests with coverage tracking
coverage run -m pytest tests/

# Show report in terminal
coverage report

# Generate HTML report with annotated source
coverage html
# Open htmlcov/index.html in a browser

# Combine (for parallel runs or subprocess tracking)
coverage combine
coverage report
```

### Line coverage vs branch coverage

Line coverage counts whether each line executed. Branch coverage counts whether each **branch** of a conditional was taken. Branch coverage catches more bugs:

```python
# app/utils.py

def categorize(value: int) -> str:
    result = "unknown"
    if value > 0:
        result = "positive"
    return result
```

```python
# test_utils.py
# run: coverage run --branch -m pytest test_utils.py && coverage report -m

from app.utils import categorize


def test_positive() -> None:
    assert categorize(5) == "positive"

# Line coverage: 100% — every line of categorize() executed.
# Branch coverage: 50% — the 'if value > 0' was only True, never False.
# We never tested categorize(0) or categorize(-1), which return "unknown".
# Branch coverage exposes this gap.
```

To enable branch coverage:

```bash
coverage run --branch -m pytest
```

### pytest-cov: integrated coverage

```bash
# Run tests with coverage in one command
pytest --cov=mypackage --cov-report=html --cov-report=term-missing tests/

# --cov=mypackage: measure coverage for this package
# --cov-report=html: generate HTML report
# --cov-report=term-missing: show missing lines in terminal
```

### Configuration

```toml
# pyproject.toml

[tool.coverage.run]
source = ["app"]
branch = true
omit = [
    "*/tests/*",
    "*/migrations/*",
    "*/__main__.py",
]

[tool.coverage.report]
show_missing = true
skip_empty = true
exclude_lines = [
    "pragma: no cover",
    "if TYPE_CHECKING:",
    "if __name__ == .__main__.",
    "@overload",
    "raise NotImplementedError",
    "\\.\\.\\.",        # ellipsis in protocol/abstract methods
]
fail_under = 80  # CI fails if coverage drops below 80%

[tool.coverage.html]
directory = "htmlcov"
```

### Coverage targets: a pragmatic view

- **80%** is a reasonable floor for most projects. It catches obvious gaps without turning coverage into a game.
- **100%** is almost always waste. Defensive code paths, platform-specific branches, and error handling for impossible states add lines that are correct-by-inspection but expensive to test.
- **Critical paths matter more than numbers.** 85% overall coverage with 0% on the payment processing module is worse than 70% coverage with 100% on payments.
- **Coverage is necessary but not sufficient.** A test that executes a line but does not assert anything meaningful contributes to coverage but not to confidence. Mutation testing (e.g., `mutmut`) is the next level — it checks whether tests actually *detect* changes to the code.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Patching the wrong location.** The classic: you `patch("db.connect")` but your code does `from db import connect` — so `service.connect` still points to the real function. The test passes because the mock is never called (so no assertion fires), but the real database is hit. Symptoms: tests are mysteriously slow, or they fail in CI where the database is not available. Debugging: add `assert mock_connect.called` explicitly — if it is `False`, you patched the wrong location.

**2. Mock drift from reality.** You mock an API client to return `{"user": {"name": "Alice"}}`. Six months later, the API changes to `{"data": {"user": {"name": "Alice"}}}`. Your tests still pass because the mock returns the old format. Your production code crashes. Fix: supplement mocks with contract tests or integration tests that hit a real (staging) service. Pin your mocks to actual response schemas from API documentation.

**3. Over-mocking hides real bugs.** A service function calls three internal helpers. You mock all three, then assert the function calls them in order. The test passes. Then someone changes a helper's return type. The test still passes — it never called the real helper. Fix: mock at the *boundary* (the database call, the HTTP request), not at internal function calls. Let internal logic run for real.

**4. Coverage as a vanity metric.** CI enforces 90% coverage. Developers add tests like `def test_init(): MyClass()` — they exercise the constructor line but assert nothing. Coverage goes up. Bugs persist. The number becomes a false comfort signal. Fix: complement coverage with mutation testing or code review that checks assertion quality, not just line execution.
:::

## 🎯 Checkpoint

::: details Question 1 — Where to patch
**Q:** You have `notifications.py` that does `from email_client import send_email`. In `test_notifications.py`, you write `@patch("email_client.send_email")`. The mock is never called during the test. Why, and how do you fix it?

**A:** The `from email_client import send_email` statement copies the reference to `send_email` into `notifications`'s module namespace. After that, `notifications.send_email` is a separate name binding. Patching `email_client.send_email` replaces the object in `email_client`'s namespace, but `notifications.send_email` still points to the original function. The fix is `@patch("notifications.send_email")` — patch where the code *looks up* the name, not where it was defined. This is the single most common mocking mistake in Python.
:::

::: details Question 2 — Branch coverage gap
**Q:** A function has line coverage of 100% but branch coverage of only 50%. How is this possible? Give a concrete example.

**A:** This happens when a conditional has a "fall-through" path that does not have its own line. Example:

```python
def greet(name: str | None) -> str:
    greeting = "Hello"
    if name:
        greeting += f", {name}"
    return greeting
```

If you only test `greet("Alice")`, every line executes: `greeting = "Hello"` runs, the `if` is True so `greeting += ...` runs, `return greeting` runs. Line coverage is 100%. But the `if name` branch was never False — you never tested `greet(None)` or `greet("")`. Branch coverage is 50% (one of two branches taken). The untested path would return just `"Hello"`, which may or may not be correct — only branch coverage reveals the gap.
:::

::: details Question 3 — MagicMock vs Mock
**Q:** When would you use `Mock()` instead of `MagicMock()`? What is the practical difference?

**A:** `MagicMock` is a subclass of `Mock` that pre-configures all dunder/magic methods (`__len__`, `__getitem__`, `__iter__`, `__bool__`, `__str__`, etc.) to return sensible defaults (e.g., `__len__` returns 0, `__bool__` returns True, `__iter__` returns an empty iterator). `Mock` does not configure these — calling `len()` on a plain `Mock` raises `TypeError`.

Use `Mock()` when you want to **ensure that magic methods are not accidentally called**. If your code should not be treating the mock as a container (calling `len()`, iterating over it, using it in a boolean context), a `Mock` will raise immediately, catching the mistake. `MagicMock` would silently return a default value, potentially hiding a bug. In practice, `MagicMock` is used ~90% of the time because most mocks need to work in boolean contexts (e.g., `if service:`) or string contexts (`f"Result: {service}"`). Use `Mock` when strictness is more valuable than convenience.
:::

## Key Mental Models

- **Patch where it is looked up, not where it lives.** `from X import Y` copies the reference into the importing module's namespace. You must replace the name in *that* namespace, not in X's.

- **Mocks are silent by default.** A mock that is never called does not complain. Always add explicit assertions (`assert_called_once_with`, `assert_called`) or your test may pass vacuously while the real code runs behind the scenes.

- **Mock at boundaries, not at internals.** Mock the database call, the HTTP request, the filesystem operation. Let internal logic run for real. Over-mocking creates tests that verify wiring diagrams instead of behavior.

- **Coverage measures breadth, not depth.** Line coverage tells you which code *ran*; it says nothing about whether the test *checked* the result. Branch coverage is strictly better than line coverage. Neither replaces thoughtful assertions.

- **80% coverage is a floor, not a ceiling.** Below 80%, you are likely missing major code paths. Above 95%, you are likely writing low-value tests to satisfy a number. Invest marginal effort in testing critical paths, not in chasing the metric.

## Related

- [pytest — Testing Done Right](./01-pytest.md) — fixtures and parametrize, which are the foundation for effective mocking tests
- [Debugging & Developer Tooling](./03-debugging-tooling.md) — when a test fails and you cannot see why, pdb is next
- [Imports & Packaging](/python/module-08/) — the import system mechanics that explain *why* "where to patch" matters
- [OOP & Descriptors](/python/module-04/) — properties, descriptors, and attribute access, relevant to `PropertyMock` and `patch.object`
