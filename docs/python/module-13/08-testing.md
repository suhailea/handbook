---
title: Testing FastAPI Applications
outline: deep
---

# Testing FastAPI Applications

**Interview weight:** 🔥🔥🔥 — testing is a staple of senior backend interviews. Expect questions about how you test API endpoints, mock dependencies, handle async tests, and ensure your test suite is fast and reliable.

**Python version:** `TestClient` available since FastAPI 0.1. `httpx.AsyncClient` with `ASGITransport` since httpx 0.23+. All examples target Python 3.12+ with `pip install "fastapi[standard]" pytest pytest-asyncio httpx`.

**Prerequisites:** [FastAPI Architecture](./01-architecture), [Dependency Injection](./03-dependency-injection), [Testing with pytest](/python/module-12/)

---

## 🗣️ In Plain English

::: tip In Plain English
Testing a FastAPI app is like running a fire drill. You do not set a real fire — you simulate one. The TestClient is like a fire drill coordinator who walks through the building (your app) triggering alarms (sending requests) and checking that everyone evacuates properly (correct responses come back with the right status codes and data).

Dependency overrides are like swapping real fire extinguishers for props during the drill. You replace the real database with a fake one, the real email service with a log that just records "email would have been sent." This way you can test the evacuation procedure — does the right handler get called? does it return the right response? — without flooding the building with water or sending real emails to real customers.

The beauty of FastAPI's testing story is that you never start a real server. The TestClient speaks directly to your app in memory, as if it were making HTTP requests, but everything happens inside a single Python process. This is like running the fire drill with the building doors locked — nobody actually leaves the building, but you can still verify every step of the procedure. The result: tests that run in milliseconds instead of seconds, with no ports to manage and no network to flake out on.

When you need to test async code directly — perhaps an endpoint that uses `await` internally and you want to verify the async behavior — you switch to the async test client. Same idea, same app, but now your test itself is an `async def` function that can `await` things. It is the difference between a drill coordinator who calls the fire department on their behalf (sync TestClient) and one who actually picks up the phone themselves (async client).
:::

---

## ⚙️ Under the Hood

### TestClient Basics

FastAPI's `TestClient` wraps `httpx`, giving you a synchronous API to test async endpoints without needing `async def` test functions:

```python
# run: pytest test_basic.py -v
from fastapi import FastAPI
from fastapi.testclient import TestClient

app = FastAPI()


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "hello"}


@app.get("/items/{item_id}")
async def read_item(item_id: int, q: str | None = None) -> dict[str, object]:
    result: dict[str, object] = {"item_id": item_id}
    if q:
        result["q"] = q
    return result


client = TestClient(app)


def test_root() -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"message": "hello"}


def test_read_item() -> None:
    response = client.get("/items/42?q=search")
    assert response.status_code == 200
    data = response.json()
    assert data["item_id"] == 42
    assert data["q"] == "search"


def test_item_not_found_type() -> None:
    # Path parameter that fails validation (string instead of int)
    response = client.get("/items/notanumber")
    assert response.status_code == 422  # Validation error
```

### Testing CRUD Operations

```python
# run: pytest test_crud.py -v
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

app = FastAPI()

# In-memory store for testing demonstration
fake_db: dict[int, dict[str, object]] = {}
counter = 0


class ItemCreate(BaseModel):
    name: str
    price: float


class ItemResponse(BaseModel):
    id: int
    name: str
    price: float


@app.post("/items/", response_model=ItemResponse, status_code=201)
async def create_item(item: ItemCreate) -> dict[str, object]:
    global counter
    counter += 1
    record = {"id": counter, "name": item.name, "price": item.price}
    fake_db[counter] = record
    return record


@app.get("/items/{item_id}", response_model=ItemResponse)
async def get_item(item_id: int) -> dict[str, object]:
    if item_id not in fake_db:
        raise HTTPException(status_code=404, detail="Item not found")
    return fake_db[item_id]


@app.delete("/items/{item_id}", status_code=204)
async def delete_item(item_id: int) -> None:
    if item_id not in fake_db:
        raise HTTPException(status_code=404, detail="Item not found")
    del fake_db[item_id]


client = TestClient(app)


def test_create_item() -> None:
    response = client.post("/items/", json={"name": "Widget", "price": 9.99})
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "Widget"
    assert data["price"] == 9.99
    assert "id" in data


def test_get_item() -> None:
    # Create first
    create_resp = client.post("/items/", json={"name": "Gadget", "price": 19.99})
    item_id = create_resp.json()["id"]

    # Then retrieve
    response = client.get(f"/items/{item_id}")
    assert response.status_code == 200
    assert response.json()["name"] == "Gadget"


def test_get_missing_item() -> None:
    response = client.get("/items/99999")
    assert response.status_code == 404
    assert response.json()["detail"] == "Item not found"


def test_delete_item() -> None:
    create_resp = client.post("/items/", json={"name": "Temp", "price": 1.0})
    item_id = create_resp.json()["id"]

    delete_resp = client.delete(f"/items/{item_id}")
    assert delete_resp.status_code == 204

    # Verify it is gone
    get_resp = client.get(f"/items/{item_id}")
    assert get_resp.status_code == 404


def test_create_item_validation_error() -> None:
    # Missing required field
    response = client.post("/items/", json={"name": "NoPrice"})
    assert response.status_code == 422
```

### Dependency Overrides

This is the most important testing pattern in FastAPI. You replace real dependencies with test doubles:

```python
# run: pytest test_overrides.py -v
from collections.abc import Generator
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

app = FastAPI()


# --- Production dependencies ---

def get_db() -> Generator[dict[str, list[str]], None, None]:
    """In production, this yields a real DB session."""
    raise RuntimeError("Should not be called in tests!")


def get_current_user(db: Annotated[object, Depends(get_db)]) -> dict[str, str]:
    """In production, this decodes a JWT and queries the DB."""
    raise RuntimeError("Should not be called in tests!")


# --- Endpoint using those dependencies ---

@app.get("/me")
async def read_me(
    user: Annotated[dict[str, str], Depends(get_current_user)],
) -> dict[str, str]:
    return user


@app.get("/protected")
async def protected_route(
    user: Annotated[dict[str, str], Depends(get_current_user)],
) -> dict[str, str]:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin required")
    return {"message": f"Welcome, admin {user['name']}"}


# --- Test overrides ---

def override_get_db() -> dict[str, list[str]]:
    """Returns a fake in-memory 'database'."""
    return {"users": ["alice", "bob"]}


def override_get_current_user() -> dict[str, str]:
    """Returns a fake authenticated user."""
    return {"name": "testuser", "role": "admin"}


def override_get_regular_user() -> dict[str, str]:
    """Returns a fake non-admin user."""
    return {"name": "regularuser", "role": "viewer"}


# Apply overrides BEFORE creating the TestClient
app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_current_user] = override_get_current_user

client = TestClient(app)


def test_read_me() -> None:
    response = client.get("/me")
    assert response.status_code == 200
    assert response.json()["name"] == "testuser"


def test_admin_access() -> None:
    response = client.get("/protected")
    assert response.status_code == 200
    assert "admin" in response.json()["message"]


def test_non_admin_rejected() -> None:
    # Temporarily override with a non-admin user
    app.dependency_overrides[get_current_user] = override_get_regular_user
    try:
        response = client.get("/protected")
        assert response.status_code == 403
        assert response.json()["detail"] == "Admin required"
    finally:
        # Restore the admin override
        app.dependency_overrides[get_current_user] = override_get_current_user
```

### Async Testing with httpx.AsyncClient

When you need to test async behavior directly, or when your app uses async lifespan events:

```python
# run: pytest test_async.py -v --asyncio-mode=auto
import pytest
from httpx import ASGITransport, AsyncClient
from fastapi import FastAPI

app = FastAPI()


@app.get("/async-data")
async def get_async_data() -> dict[str, str]:
    # In real code, this might await a DB query or external API
    return {"source": "async"}


@pytest.mark.anyio
async def test_async_endpoint() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.get("/async-data")
    assert response.status_code == 200
    assert response.json() == {"source": "async"}


@pytest.mark.anyio
async def test_async_post() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        response = await ac.post(
            "/items/",  # Would need the endpoint defined
            json={"name": "AsyncItem", "price": 5.0},
        )
    # This would be 404 since /items/ is not defined in this app,
    # but demonstrates the async client pattern
    assert response.status_code in (201, 404, 405)
```

### pytest Fixtures for FastAPI — Complete Setup

A production-quality `conftest.py` that provides app, client, and database fixtures:

```python
# run: pytest tests/ -v
# file: tests/conftest.py
from collections.abc import Generator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


def create_test_app() -> FastAPI:
    """Create a fresh app instance for testing."""
    from myapp.main import app  # Your actual app

    return app


@pytest.fixture(scope="module")
def app() -> FastAPI:
    """Provide the FastAPI app instance."""
    return create_test_app()


@pytest.fixture(scope="module")
def client(app: FastAPI) -> Generator[TestClient, None, None]:
    """Provide a TestClient with dependency overrides."""
    # Set up overrides
    app.dependency_overrides[...] = ...  # Your overrides here

    with TestClient(app) as c:
        yield c

    # Teardown: clear overrides
    app.dependency_overrides.clear()


# --- Database fixture (SQLite in-memory for fast tests) ---

@pytest.fixture(scope="function")
def db_session() -> Generator[dict[str, list[object]], None, None]:
    """
    Provide a fresh in-memory 'database' per test.
    In a real app, this would be a SQLAlchemy session with an in-memory SQLite.
    """
    db: dict[str, list[object]] = {"users": [], "items": []}
    yield db
    db.clear()  # Cleanup after each test
```

**Async conftest with a real test database (SQLAlchemy pattern):**

```python
# run: pytest tests/ -v --asyncio-mode=auto
# file: tests/conftest.py
from collections.abc import AsyncGenerator

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from myapp.main import app
from myapp.database import Base, get_db

# Test database — in-memory SQLite
TEST_DATABASE_URL = "sqlite+aiosqlite:///./test.db"

engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestingSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest.fixture(scope="session", autouse=True)
async def setup_database() -> AsyncGenerator[None, None]:
    """Create all tables once for the test session."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional database session that rolls back after each test."""
    async with TestingSessionLocal() as session:
        yield session
        await session.rollback()


@pytest.fixture
async def async_client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """Provide an async test client with the DB overridden."""

    async def override_get_db() -> AsyncGenerator[AsyncSession, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()
```

### Testing Authentication

Override the user dependency to test both authenticated and unauthenticated paths:

```python
# run: pytest test_auth.py -v
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from typing import Annotated

app = FastAPI()


# Production auth dependency
async def get_current_user() -> dict[str, str]:
    raise RuntimeError("Real auth not available in tests")


@app.get("/profile")
async def get_profile(
    user: Annotated[dict[str, str], Depends(get_current_user)],
) -> dict[str, str]:
    return {"username": user["username"], "email": user["email"]}


# --- Tests ---

def _make_user(username: str = "alice", email: str = "alice@example.com") -> dict[str, str]:
    return {"username": username, "email": email}


def test_profile_authenticated() -> None:
    app.dependency_overrides[get_current_user] = lambda: _make_user()
    client = TestClient(app)
    response = client.get("/profile")
    assert response.status_code == 200
    assert response.json()["username"] == "alice"
    app.dependency_overrides.clear()


def test_profile_different_user() -> None:
    app.dependency_overrides[get_current_user] = lambda: _make_user("bob", "bob@example.com")
    client = TestClient(app)
    response = client.get("/profile")
    assert response.status_code == 200
    assert response.json()["username"] == "bob"
    app.dependency_overrides.clear()


def test_profile_unauthenticated() -> None:
    """Simulate auth failure by making the dependency raise HTTPException."""

    async def reject() -> dict[str, str]:
        raise HTTPException(status_code=401, detail="Not authenticated")

    app.dependency_overrides[get_current_user] = reject
    client = TestClient(app)
    response = client.get("/profile")
    assert response.status_code == 401
    app.dependency_overrides.clear()
```

### Testing WebSocket Endpoints

```python
# run: pytest test_websocket.py -v
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.testclient import TestClient

app = FastAPI()


@app.websocket("/ws/echo")
async def echo_ws(websocket: WebSocket) -> None:
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            await websocket.send_text(f"Echo: {data}")
    except WebSocketDisconnect:
        pass


client = TestClient(app)


def test_websocket_echo() -> None:
    with client.websocket_connect("/ws/echo") as ws:
        ws.send_text("hello")
        data = ws.receive_text()
        assert data == "Echo: hello"

        ws.send_text("world")
        data = ws.receive_text()
        assert data == "Echo: world"


def test_websocket_json() -> None:
    @app.websocket("/ws/json")
    async def json_ws(websocket: WebSocket) -> None:
        await websocket.accept()
        data = await websocket.receive_json()
        await websocket.send_json({"received": data, "status": "ok"})

    with client.websocket_connect("/ws/json") as ws:
        ws.send_json({"key": "value"})
        response = ws.receive_json()
        assert response["status"] == "ok"
        assert response["received"] == {"key": "value"}
```

### Testing File Uploads

```python
# run: pytest test_upload.py -v
from fastapi import FastAPI, UploadFile
from fastapi.testclient import TestClient

app = FastAPI()


@app.post("/upload/")
async def upload_file(file: UploadFile) -> dict[str, object]:
    content = await file.read()
    return {
        "filename": file.filename,
        "size": len(content),
        "content_type": file.content_type,
    }


client = TestClient(app)


def test_upload_text_file() -> None:
    response = client.post(
        "/upload/",
        files={"file": ("report.txt", b"Hello, World!", "text/plain")},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["filename"] == "report.txt"
    assert data["size"] == 13
    assert data["content_type"] == "text/plain"


def test_upload_csv() -> None:
    csv_content = b"name,age\nAlice,30\nBob,25"
    response = client.post(
        "/upload/",
        files={"file": ("data.csv", csv_content, "text/csv")},
    )
    assert response.status_code == 200
    assert response.json()["filename"] == "data.csv"
```

### Integration vs Unit Testing Strategy

| Approach | When to use | Speed | Confidence |
|----------|-------------|-------|------------|
| **Unit test** (call service functions directly) | Pure business logic, transformations, validations | Fastest | Lowest (does not test HTTP layer) |
| **TestClient** (sync, in-process HTTP) | Most endpoint tests, CRUD, auth, error handling | Fast | High (tests full request/response cycle) |
| **AsyncClient** (async, in-process HTTP) | Async lifespan events, async-only dependencies | Fast | High |
| **External HTTP** (real server, real DB) | Smoke tests, deployment verification | Slowest | Highest |

**The recommended split:**
- 70% TestClient endpoint tests with overridden dependencies
- 20% unit tests for complex business logic (no HTTP involved)
- 10% integration tests with a real test database (use sparingly)

### Complete Test File Example

```python
# run: pytest tests/test_items_api.py -v
# file: tests/test_items_api.py
"""
Complete test module demonstrating a realistic FastAPI test setup.
"""
from collections.abc import Generator

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel
from typing import Annotated

# --- App setup (in real projects, import from your app module) ---

app = FastAPI()

# Fake "database" for the example
items_db: dict[int, dict[str, object]] = {}
_id_counter = 0


class ItemCreate(BaseModel):
    name: str
    price: float
    description: str | None = None


class ItemResponse(BaseModel):
    id: int
    name: str
    price: float
    description: str | None


async def get_current_user() -> dict[str, str]:
    """Production: decode JWT, query DB. Overridden in tests."""
    raise RuntimeError("Not available outside request context")


@app.post("/api/items", response_model=ItemResponse, status_code=201)
async def create_item(
    item: ItemCreate,
    user: Annotated[dict[str, str], Depends(get_current_user)],
) -> dict[str, object]:
    global _id_counter
    _id_counter += 1
    record: dict[str, object] = {"id": _id_counter, **item.model_dump()}
    items_db[_id_counter] = record
    return record


@app.get("/api/items/{item_id}", response_model=ItemResponse)
async def get_item(item_id: int) -> dict[str, object]:
    if item_id not in items_db:
        raise HTTPException(status_code=404, detail="Item not found")
    return items_db[item_id]


@app.get("/api/items", response_model=list[ItemResponse])
async def list_items(skip: int = 0, limit: int = 10) -> list[dict[str, object]]:
    all_items = list(items_db.values())
    return all_items[skip : skip + limit]


@app.delete("/api/items/{item_id}", status_code=204)
async def delete_item(
    item_id: int,
    user: Annotated[dict[str, str], Depends(get_current_user)],
) -> None:
    if item_id not in items_db:
        raise HTTPException(status_code=404, detail="Item not found")
    del items_db[item_id]


# --- Fixtures ---

@pytest.fixture(autouse=True)
def clear_db() -> Generator[None, None, None]:
    """Reset the fake DB before each test."""
    global _id_counter
    items_db.clear()
    _id_counter = 0
    yield
    items_db.clear()


@pytest.fixture
def client() -> Generator[TestClient, None, None]:
    """Provide a TestClient with auth overridden."""
    app.dependency_overrides[get_current_user] = lambda: {
        "username": "testuser",
        "role": "admin",
    }
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


# --- Tests ---

class TestCreateItem:
    def test_create_success(self, client: TestClient) -> None:
        response = client.post(
            "/api/items",
            json={"name": "Widget", "price": 9.99, "description": "A fine widget"},
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Widget"
        assert data["price"] == 9.99
        assert data["id"] == 1

    def test_create_minimal(self, client: TestClient) -> None:
        """Description is optional."""
        response = client.post(
            "/api/items",
            json={"name": "Basic", "price": 1.0},
        )
        assert response.status_code == 201
        assert response.json()["description"] is None

    def test_create_validation_error(self, client: TestClient) -> None:
        """Missing required 'price' field."""
        response = client.post("/api/items", json={"name": "NoPriceItem"})
        assert response.status_code == 422
        errors = response.json()["detail"]
        assert any(e["loc"] == ["body", "price"] for e in errors)


class TestGetItem:
    def test_get_existing(self, client: TestClient) -> None:
        create_resp = client.post(
            "/api/items", json={"name": "Findme", "price": 5.0}
        )
        item_id = create_resp.json()["id"]

        response = client.get(f"/api/items/{item_id}")
        assert response.status_code == 200
        assert response.json()["name"] == "Findme"

    def test_get_not_found(self, client: TestClient) -> None:
        response = client.get("/api/items/999")
        assert response.status_code == 404
        assert response.json()["detail"] == "Item not found"

    def test_get_invalid_id_type(self, client: TestClient) -> None:
        response = client.get("/api/items/abc")
        assert response.status_code == 422


class TestDeleteItem:
    def test_delete_success(self, client: TestClient) -> None:
        create_resp = client.post(
            "/api/items", json={"name": "DeleteMe", "price": 1.0}
        )
        item_id = create_resp.json()["id"]

        delete_resp = client.delete(f"/api/items/{item_id}")
        assert delete_resp.status_code == 204

        get_resp = client.get(f"/api/items/{item_id}")
        assert get_resp.status_code == 404

    def test_delete_not_found(self, client: TestClient) -> None:
        response = client.delete("/api/items/999")
        assert response.status_code == 404
```

---

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Dependency overrides not cleared between tests.**
If one test sets `app.dependency_overrides[get_db] = mock_db` and does not clear it, every subsequent test uses that mock — even tests that expect the real dependency. This causes cascading, order-dependent test failures that only appear when running the full suite. **Diagnosis:** tests pass individually (`pytest test_foo.py`) but fail when run together (`pytest tests/`). **Fix:** always clear overrides in a fixture's teardown or a `finally` block. Use `app.dependency_overrides.clear()` in a fixture with `yield`.

**2. TestClient does not run lifespan events by default.**
If your app uses `lifespan` to initialize a database pool on startup, `TestClient(app)` without the context manager (`with TestClient(app) as c:`) does not trigger `startup`/`shutdown` events. Your tests hit endpoints that expect an initialized DB pool and get `AttributeError: 'NoneType' object has no attribute 'execute'`. **Diagnosis:** tests fail with errors about uninitialized resources. **Fix:** always use the `with TestClient(app) as client:` context manager form, which triggers lifespan events.

**3. Async test hangs or "event loop is closed" errors.**
Mixing `TestClient` (which runs its own event loop) and `pytest-asyncio` async tests in the same file can cause event loop conflicts. You see `RuntimeError: Event loop is closed` or tests that hang indefinitely. **Diagnosis:** tests work in isolation but break when combined. **Fix:** use `TestClient` for sync tests and `httpx.AsyncClient` with `ASGITransport` for async tests. Do not mix them within the same test function. Configure `pytest-asyncio` with `asyncio_mode = "auto"` in `pyproject.toml`.
:::

---

## 🎯 Checkpoint

::: details Question 1 — Dependency override mechanics
**Q:** You have a FastAPI endpoint that depends on `get_db()` which yields a SQLAlchemy session. In your test, you override it with a function that returns an in-memory SQLite session. After the test, the override is not cleared. What happens when the next test runs, and why is this particularly dangerous with `yield` dependencies?

**A:** The next test still uses the in-memory SQLite session from the override, not the production dependency. This is dangerous with `yield` dependencies because the teardown logic (the code after `yield` in the real `get_db`) never runs — the override function replaces the entire dependency, including its cleanup. In a real scenario, database sessions from the override may not be properly closed, and if a later test expects the real database, it will silently operate on the wrong data source. The fix: always call `app.dependency_overrides.clear()` in a fixture teardown, and scope test database sessions to individual tests with rollback to prevent cross-test contamination.
:::

::: details Question 2 — TestClient vs AsyncClient
**Q:** When would you choose `httpx.AsyncClient` with `ASGITransport` over FastAPI's `TestClient`? Are there cases where `TestClient` cannot be used?

**A:** Use `AsyncClient` when: (1) your test function itself needs to be `async def` — for example, to call async setup/teardown helpers, await async fixtures, or test async WebSocket interactions beyond what `TestClient` supports; (2) you need to test lifespan events with fine-grained control; (3) your app uses async dependencies that interact with the test's own async context (like sharing an async database session between the test and the app). `TestClient` works for the vast majority of cases because it internally runs the async app in a synchronous wrapper. The main case where `TestClient` cannot be used is when you need the test itself to participate in the same event loop as the app — for example, when an async fixture sets up a database transaction that the app's overridden dependency must use within the same async context.
:::

::: details Question 3 — Testing strategy
**Q:** A team tests every FastAPI endpoint with a real PostgreSQL test database (Docker container). Tests take 8 minutes. How would you restructure the test suite to run in under 30 seconds while maintaining confidence?

**A:** Replace the real database with dependency overrides for most tests. Create three tiers: (1) **Unit tests** (60-70%) — test service functions and business logic directly, no HTTP layer, no database. (2) **TestClient tests with overrides** (25-30%) — override `get_db` with in-memory fakes or simple dicts, test the full HTTP request/response cycle including validation, auth, and error handling. These run in milliseconds per test. (3) **Integration tests** (5-10%) — keep a small number of tests that use the real PostgreSQL container, but only for queries with complex joins, transactions, or database-specific behavior that in-memory fakes cannot replicate. Mark these with `@pytest.mark.integration` and run them separately in CI. The key insight: most endpoint tests are verifying routing, validation, auth, and response shaping — none of which require a real database.
:::

---

## Key Mental Models

- **TestClient is not a server.** It speaks ASGI directly to your app in-process. No ports, no network, no flakiness from connection timeouts.

- **Dependency overrides are the testing superpower.** They replace any node in the dependency tree. Override `get_db` and everything that depends on it automatically gets the test double.

- **Always clear overrides in teardown.** A leaked override is an invisible, order-dependent bug that wastes hours of debugging.

- **Use the `with TestClient(app)` context manager form.** Without it, lifespan events (startup/shutdown) do not fire, and your app may be in a half-initialized state.

- **Test the contract, not the implementation.** Assert on status codes, response shapes, and error details. Do not assert on internal function calls unless you are unit-testing a service layer.

---

## Related

- [Dependency Injection](./03-dependency-injection) — the system that makes testing via overrides possible
- [Auth — JWT, OAuth2 & Security](./05-auth-security) — testing auth flows with overridden user dependencies
- [Database Integration](./06-database-integration) — async session fixtures and test database patterns
- [Testing with pytest](/python/module-12/) — pytest fundamentals: fixtures, parametrize, markers
- [Background Tasks, WebSockets & SSE](./07-background-websockets) — testing WebSocket endpoints with `websocket_connect`
