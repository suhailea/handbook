---
title: Dependency Injection — Depends()
outline: deep
---

# Dependency Injection — Depends()

**Interview weight:** 🔥🔥🔥 | **Python 3.12+** | **FastAPI 0.110+** | **Prerequisites:** [13.1 FastAPI Architecture](01-architecture), [13.2 Routing & Validation](02-routing-validation)

## 🗣️ In Plain English

::: tip In Plain English
FastAPI's dependency injection is like a prep station system in a professional kitchen.

Before the chef (your handler) starts cooking, prep cooks (dependencies) prepare ingredients. One prep cook washes and chops the vegetables (validates the authentication token). Another heats the oven to the right temperature (opens a database connection). A third checks the pantry inventory (verifies the user has the right permissions).

The clever part: each prep cook can rely on OTHER prep cooks. The one checking permissions needs to know WHO the user is, so it depends on the one who validated the authentication token. That token validator needs a working database connection to look up the user, so it depends on the one who opened the database connection. This chain of dependencies — sub-dependencies — resolves automatically. FastAPI figures out the order, calls each one, and passes the results down the chain.

When the meal is finished, cleanup crews run in reverse order. The database connection that was opened gets closed. The temporary storage that was allocated gets freed. This is what "yield dependencies" do — they set something up, hand it to the chef, wait for the meal to be done, and then clean up.

The chef never has to think about prep or cleanup. They just write in the recipe: "I need chopped vegetables, a hot oven, and confirmed permissions." Those things appear on their station, ready to use. If tomorrow you want to swap the real oven for a test oven (in your test suite), you just tell the kitchen "use this mock oven instead" — the chef's recipe does not change at all.

One more thing: the kitchen is smart about avoiding duplicate work. If two prep stations both need chopped onions, the kitchen chops them once and gives the same bowl to both. Within a single meal (request), the same dependency is computed once and reused everywhere it is needed.
:::

## ⚙️ Under the Hood

### Basic Depends()

A dependency is any callable (function, method, class) that FastAPI calls before your handler and injects the result as a parameter:

```python
# basic_depends.py
from fastapi import Depends, FastAPI

app = FastAPI()


# A simple dependency — a plain function
async def common_parameters(skip: int = 0, limit: int = 100):
    """Extracts and validates pagination params."""
    return {"skip": skip, "limit": limit}


@app.get("/items")
async def list_items(params: dict = Depends(common_parameters)):
    return {"params": params, "data": ["item1", "item2"]}


@app.get("/users")
async def list_users(params: dict = Depends(common_parameters)):
    return {"params": params, "data": ["alice", "bob"]}

# Both endpoints now accept ?skip=10&limit=20
# The dependency extracts and validates those query params

# GET /items?skip=5&limit=10 → {"params": {"skip": 5, "limit": 10}, "data": [...]}
# GET /users                  → {"params": {"skip": 0, "limit": 100}, "data": [...]}

# run: uvicorn basic_depends:app --reload
```

**What happens under the hood when a request arrives:**

1. FastAPI inspects the handler's signature and finds `Depends(common_parameters)`
2. It inspects `common_parameters`'s signature — sees `skip: int = 0, limit: int = 100`
3. It extracts those from the query string (same rules as handler params)
4. Calls `await common_parameters(skip=5, limit=10)`
5. Passes the result (`{"skip": 5, "limit": 10}`) to the handler as `params`

### Sub-Dependencies

Dependencies can depend on other dependencies. FastAPI resolves the entire tree:

```python
# sub_dependencies.py
from fastapi import Depends, FastAPI, Header, HTTPException

app = FastAPI()


async def get_token(authorization: str = Header()):
    """Extract token from Authorization header."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Invalid auth header format")
    return authorization.removeprefix("Bearer ")


async def get_current_user(token: str = Depends(get_token)):
    """Validate token and return user. Depends on get_token."""
    # In production: decode JWT, query database
    fake_users = {"valid-token-alice": "alice", "valid-token-bob": "bob"}
    user = fake_users.get(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return user


async def require_admin(user: str = Depends(get_current_user)):
    """Check if user is admin. Depends on get_current_user → get_token."""
    admins = {"alice"}
    if user not in admins:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@app.get("/admin/dashboard")
async def admin_dashboard(admin: str = Depends(require_admin)):
    return {"message": f"Welcome, {admin}", "role": "admin"}

# Dependency chain:
#   admin_dashboard
#     └── require_admin
#           └── get_current_user
#                 └── get_token
#                       └── Header("authorization")
#
# FastAPI resolves bottom-up:
#   1. Extract Authorization header
#   2. Call get_token → returns token string
#   3. Call get_current_user(token) → returns username
#   4. Call require_admin(user) → returns username if admin
#   5. Call admin_dashboard(admin) → returns response

# run: uvicorn sub_dependencies:app --reload
# Test: curl -H "Authorization: Bearer valid-token-alice" http://localhost:8000/admin/dashboard
```

### Dependency Caching (use_cache)

By default, if the same dependency is used multiple times in one request (directly or through sub-dependencies), FastAPI calls it only once and reuses the result:

```python
# dep_caching.py
from fastapi import Depends, FastAPI

app = FastAPI()

call_count = 0


async def get_db_connection():
    """Simulates opening a database connection."""
    global call_count
    call_count += 1
    print(f"Opening connection (call #{call_count})")
    return f"connection-{call_count}"


async def get_user_repo(conn: str = Depends(get_db_connection)):
    return {"repo": "users", "conn": conn}


async def get_order_repo(conn: str = Depends(get_db_connection)):
    return {"repo": "orders", "conn": conn}


@app.get("/dashboard")
async def dashboard(
    users: dict = Depends(get_user_repo),
    orders: dict = Depends(get_order_repo),
):
    # Both repos need get_db_connection.
    # With caching (default): get_db_connection is called ONCE.
    # Both repos receive the SAME connection string.
    return {"users": users, "orders": orders}

# GET /dashboard →
#   Console: "Opening connection (call #1)"   ← only once!
#   Response: {
#     "users":  {"repo": "users",  "conn": "connection-1"},
#     "orders": {"repo": "orders", "conn": "connection-1"}   ← same connection
#   }


# To disable caching (call the dependency fresh each time):
async def get_random_id():
    import random
    return random.randint(1, 1000)


@app.get("/no-cache")
async def no_cache(
    id1: int = Depends(get_random_id, use_cache=False),
    id2: int = Depends(get_random_id, use_cache=False),
):
    return {"id1": id1, "id2": id2}
# id1 and id2 will be different — get_random_id called twice

# run: uvicorn dep_caching:app --reload
```

### Yield Dependencies (Setup + Teardown)

Use `yield` in a dependency to run cleanup code after the response is sent. This is how you manage resources like database sessions:

```python
# yield_depends.py
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, FastAPI

app = FastAPI()


class FakeDBSession:
    """Simulates a database session."""
    def __init__(self, session_id: int):
        self.session_id = session_id
        self.committed = False
        print(f"  [DB] Session {session_id} opened")

    async def commit(self):
        self.committed = True
        print(f"  [DB] Session {self.session_id} committed")

    async def rollback(self):
        print(f"  [DB] Session {self.session_id} rolled back")

    async def close(self):
        print(f"  [DB] Session {self.session_id} closed")


_session_counter = 0


async def get_db() -> AsyncGenerator[FakeDBSession, None]:
    """
    Yield dependency: setup → yield → teardown.

    Everything BEFORE yield runs before the handler.
    Everything AFTER yield runs after the response is sent.
    If an exception occurs, the finally block still runs.
    """
    global _session_counter
    _session_counter += 1
    session = FakeDBSession(_session_counter)
    try:
        yield session           # handler receives this value
        await session.commit()  # runs after handler succeeds
    except Exception:
        await session.rollback()  # runs if handler raised
        raise
    finally:
        await session.close()    # ALWAYS runs — cleanup


# Annotated syntax (recommended in modern FastAPI)
DB = Annotated[FakeDBSession, Depends(get_db)]


@app.get("/items")
async def list_items(db: DB):
    print(f"  [Handler] Using session {db.session_id}")
    return {"session": db.session_id, "items": ["a", "b"]}

# GET /items →
#   Console:
#     [DB] Session 1 opened
#     [Handler] Using session 1
#     [DB] Session 1 committed
#     [DB] Session 1 closed
#   Response: {"session": 1, "items": ["a", "b"]}

# run: uvicorn yield_depends:app --reload
```

**The execution flow for yield dependencies:**

```
Request arrives
  │
  ├─ 1. Code BEFORE yield runs (setup: open session)
  ├─ 2. yield value → injected into handler
  ├─ 3. Handler runs
  │     ├─ Success → code AFTER yield runs (commit)
  │     └─ Exception → except block runs (rollback)
  └─ 4. finally block runs (close session) — ALWAYS
  │
Response sent
```

### Class-Based Dependencies

Any callable works as a dependency. Classes are callable (their `__init__` is called), so you can use classes:

```python
# class_depends.py
from fastapi import Depends, FastAPI, Query

app = FastAPI()


class Pagination:
    """Class-based dependency — __init__ params become query params."""
    def __init__(
        self,
        page: int = Query(default=1, ge=1),
        size: int = Query(default=20, ge=1, le=100),
    ):
        self.page = page
        self.size = size
        self.offset = (page - 1) * size

    def __repr__(self) -> str:
        return f"Pagination(page={self.page}, size={self.size}, offset={self.offset})"


@app.get("/items")
async def list_items(pagination: Pagination = Depends(Pagination)):
    return {
        "page": pagination.page,
        "size": pagination.size,
        "offset": pagination.offset,
    }
# GET /items?page=3&size=10 → {"page": 3, "size": 10, "offset": 20}


# Shorthand: when the type annotation IS the dependency class,
# you can use Depends() without arguments:
@app.get("/users")
async def list_users(pagination: Pagination = Depends()):
    # Depends() with no argument infers the dependency from the type annotation
    return {"page": pagination.page, "size": pagination.size}

# run: uvicorn class_depends:app --reload
```

### Global and Router-Level Dependencies

Dependencies can be applied to every route without repeating `Depends()` in each handler:

```python
# global_depends.py
from fastapi import Depends, FastAPI, Header, HTTPException, APIRouter

app = FastAPI()


async def verify_api_key(x_api_key: str = Header()):
    """Global dependency — runs for every route in the app."""
    if x_api_key != "secret-key-123":
        raise HTTPException(status_code=403, detail="Invalid API key")
    return x_api_key


async def log_request_id(x_request_id: str | None = Header(default=None)):
    """Logs the request ID — does not return a value, just a side-effect."""
    if x_request_id:
        print(f"Request ID: {x_request_id}")


# App-level dependencies — run for ALL routes
app = FastAPI(dependencies=[Depends(verify_api_key), Depends(log_request_id)])


# Router-level dependencies — run for all routes in this router
admin_router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(verify_api_key)],  # redundant here since it's global, but shows the pattern
)


@app.get("/public")
async def public_endpoint():
    # verify_api_key still runs because it's a global dependency
    return {"message": "Hello"}


@admin_router.get("/stats")
async def admin_stats():
    return {"users": 42}


app.include_router(admin_router)

# run: uvicorn global_depends:app --reload
# Test: curl -H "X-Api-Key: secret-key-123" http://localhost:8000/public
```

### Dependency Overrides for Testing

One of the most powerful features — swap out any dependency without changing handler code:

```python
# dep_overrides.py
from typing import Annotated

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

app = FastAPI()


# --- Production dependencies ---

class RealDatabase:
    def get_users(self) -> list[dict]:
        # In production: queries PostgreSQL
        return [{"id": 1, "name": "Alice"}]


def get_db() -> RealDatabase:
    return RealDatabase()


DB = Annotated[RealDatabase, Depends(get_db)]


@app.get("/users")
async def list_users(db: DB):
    return db.get_users()


# --- Test code ---

class FakeDatabase:
    def get_users(self) -> list[dict]:
        return [{"id": 99, "name": "TestUser"}]


def get_fake_db() -> FakeDatabase:
    return FakeDatabase()


def test_list_users():
    # Override the dependency — handler code unchanged
    app.dependency_overrides[get_db] = get_fake_db

    client = TestClient(app)
    response = client.get("/users")

    assert response.status_code == 200
    assert response.json() == [{"id": 99, "name": "TestUser"}]

    # Clean up
    app.dependency_overrides.clear()


if __name__ == "__main__":
    test_list_users()
    print("Test passed!")

# run: python3 dep_overrides.py
```

### The Dependency Resolution Tree

For a complex endpoint, FastAPI builds and resolves a full dependency graph:

```python
# dep_tree.py
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query

app = FastAPI()


# --- Layer 1: Infrastructure ---

async def get_db_session():
    """Opens a database session."""
    print("  1. Opening DB session")
    session = {"db": "connected"}
    yield session
    print("  6. Closing DB session")


# --- Layer 2: Authentication ---

async def get_token(authorization: str = Header()):
    """Extracts Bearer token."""
    print("  2. Extracting token")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bad auth format")
    return authorization.removeprefix("Bearer ")


async def get_current_user(
    token: str = Depends(get_token),
    db: dict = Depends(get_db_session),
):
    """Validates token against DB."""
    print(f"  3. Validating user (token={token}, db={db})")
    if token != "valid":
        raise HTTPException(status_code=401, detail="Invalid token")
    return {"id": 1, "name": "alice", "role": "admin"}


# --- Layer 3: Authorization ---

async def require_role(
    role: str,  # this makes it a factory — see usage below
):
    """Returns a dependency that checks for a specific role."""
    async def check_role(user: dict = Depends(get_current_user)):
        print(f"  4. Checking role '{role}' for user {user['name']}")
        if user.get("role") != role:
            raise HTTPException(status_code=403, detail=f"Requires {role} role")
        return user
    return check_role


# --- Layer 4: Business logic dependencies ---

class Pagination:
    def __init__(self, page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
        self.page = page
        self.size = size


# --- Handler ---

@app.get("/admin/users")
async def list_admin_users(
    admin: Annotated[dict, Depends(require_role("admin"))],
    pagination: Pagination = Depends(),
    db: dict = Depends(get_db_session),  # same dep as in get_current_user — cached!
):
    print(f"  5. Handler running (admin={admin['name']}, page={pagination.page})")
    return {
        "admin": admin["name"],
        "page": pagination.page,
        "size": pagination.size,
    }

# Dependency tree:
#
#   list_admin_users
#   ├── require_role("admin") [factory returns check_role]
#   │   └── get_current_user
#   │       ├── get_token ← Header("authorization")
#   │       └── get_db_session ← yield dep (CACHED)
#   ├── Pagination ← Query params
#   └── get_db_session ← REUSES cached instance from above
#
# Resolution order:
#   1. get_db_session (setup, yield)
#   2. get_token (extract header)
#   3. get_current_user (validate)
#   4. check_role (authorize)
#   5. Pagination (extract query params)
#   6. Handler runs
#   7. get_db_session (teardown)

# run: uvicorn dep_tree:app --reload
# Test: curl -H "Authorization: Bearer valid" "http://localhost:8000/admin/users?page=2&size=5"
```

### Real-World Patterns

Here are the dependency patterns you will use in every production FastAPI app:

```python
# real_world_patterns.py
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, FastAPI, Header, HTTPException, Query

app = FastAPI()


# --- Pattern 1: Database session (yield dependency) ---

class AsyncSession:
    """Fake async DB session for demonstration."""
    async def execute(self, query: str) -> list[dict]:
        return [{"id": 1}]
    async def commit(self): ...
    async def close(self): ...


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    session = AsyncSession()
    try:
        yield session
        await session.commit()
    except Exception:
        # rollback would happen here in production
        raise
    finally:
        await session.close()

DB = Annotated[AsyncSession, Depends(get_db)]


# --- Pattern 2: Current user (auth dependency) ---

class User:
    def __init__(self, id: int, name: str, roles: list[str]):
        self.id = id
        self.name = name
        self.roles = roles


async def get_current_user(authorization: str = Header()) -> User:
    # In production: decode JWT, query user from DB
    if authorization != "Bearer valid-token":
        raise HTTPException(status_code=401, detail="Not authenticated")
    return User(id=1, name="alice", roles=["user", "admin"])

CurrentUser = Annotated[User, Depends(get_current_user)]


# --- Pattern 3: Permission checker (parameterized dependency) ---

def require_role(role: str):
    """Factory that returns a dependency checking for a specific role."""
    async def role_checker(user: CurrentUser) -> User:
        if role not in user.roles:
            raise HTTPException(status_code=403, detail=f"Role '{role}' required")
        return user
    return role_checker

AdminUser = Annotated[User, Depends(require_role("admin"))]


# --- Pattern 4: Pagination (class dependency) ---

class PaginationParams:
    def __init__(
        self,
        page: int = Query(default=1, ge=1, description="Page number"),
        per_page: int = Query(default=20, ge=1, le=100, description="Items per page"),
    ):
        self.page = page
        self.per_page = per_page
        self.offset = (page - 1) * per_page

Pagination = Annotated[PaginationParams, Depends()]


# --- Pattern 5: Rate limiter (side-effect dependency) ---

_request_counts: dict[str, int] = {}

async def rate_limit(user: CurrentUser):
    """Simple in-memory rate limiter."""
    key = f"user:{user.id}"
    _request_counts[key] = _request_counts.get(key, 0) + 1
    if _request_counts[key] > 100:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")


# --- Using all patterns together ---

@app.get("/admin/reports", dependencies=[Depends(rate_limit)])
async def admin_reports(
    admin: AdminUser,
    pagination: Pagination,
    db: DB,
):
    results = await db.execute(
        f"SELECT * FROM reports LIMIT {pagination.per_page} OFFSET {pagination.offset}"
    )
    return {
        "admin": admin.name,
        "page": pagination.page,
        "per_page": pagination.per_page,
        "results": results,
    }

# run: uvicorn real_world_patterns:app --reload
# Test: curl -H "Authorization: Bearer valid-token" "http://localhost:8000/admin/reports?page=2&per_page=10"
```

### Annotated Syntax (Modern FastAPI)

FastAPI 0.95+ supports `Annotated` for cleaner dependency declarations:

```python
# annotated_syntax.py
from typing import Annotated
from fastapi import Depends, FastAPI, Query

app = FastAPI()


async def get_current_user() -> dict:
    return {"id": 1, "name": "alice"}


# Old style:
# async def handler(user: dict = Depends(get_current_user)):

# New style with Annotated — reusable type alias:
CurrentUser = Annotated[dict, Depends(get_current_user)]


@app.get("/me")
async def get_me(user: CurrentUser):
    return user


@app.get("/my-items")
async def get_my_items(user: CurrentUser):
    return {"user": user, "items": []}

# Benefits of Annotated:
# 1. The type alias is reusable — define once, use everywhere
# 2. Default values in function signatures remain clean
# 3. Better IDE support (the type is dict, not Depends(...))
# 4. Composable — you can stack multiple Annotated dependencies

# run: uvicorn annotated_syntax:app --reload
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Yield dependencies and background tasks — teardown runs too early.**
If your handler starts a `BackgroundTask` that uses the database session from a yield dependency, the session is closed before the background task runs. The yield teardown executes after the response is sent but before background tasks complete. Symptoms: `SessionClosedError` or `ConnectionResetError` in background task logs, intermittent because it depends on timing.

Fix: background tasks that need resources must create their own sessions, not reuse the request-scoped one. Or use a proper task queue (Celery, ARQ) instead of `BackgroundTasks`.

**2. Forgetting that `Depends()` caching is per-request, not global.**
Teams sometimes expect `Depends(get_db_connection)` to return the same connection across multiple requests (like a singleton). It does not — caching only applies within a single request. A new request gets a new dependency resolution. If you need a connection pool, manage it at the app level (lifespan event), not through `Depends()`.

**3. Circular dependencies silently cause infinite recursion.**
If dependency A depends on B and B depends on A, FastAPI does not detect this at startup. It blows up at request time with a `RecursionError` and a cryptic stack trace. The fix is to restructure: extract the shared logic into a third dependency that both A and B depend on, breaking the cycle.
:::

## 🎯 Checkpoint

::: details Question 1 — Caching behavior
**Q:** In a single request, `get_current_user` depends on `get_db_session`, and the handler also directly depends on `get_db_session`. How many times is `get_db_session` called? What if you pass `use_cache=False`?

**A:** With default behavior (`use_cache=True`), `get_db_session` is called exactly once. FastAPI caches the result (keyed by the dependency callable) within the request's dependency resolution. Both `get_current_user` and the handler receive the same session instance.

With `use_cache=False` on either `Depends(get_db_session, use_cache=False)`, that specific injection site gets a fresh call. If only the handler uses `use_cache=False`, the handler gets a second session while `get_current_user` still uses the first (cached) one. This means you could have two different sessions in the same request — which can cause subtle bugs if they see different database states (different transactions).

The cache key is the callable itself (the function object), not the parameter name. So `Depends(get_db_session)` and `Depends(get_db_session)` share the cache, but `Depends(get_db_session_v2)` would be separate even if the two functions are identical.
:::

::: details Question 2 — Yield dependency exception handling
**Q:** A yield dependency opens a database transaction. The handler raises an `HTTPException(404)`. Does the code after `yield` run? Does the `finally` block run? What about the `except` block?

**A:** When the handler raises an exception (including `HTTPException`):

1. The code between `yield` and `except`/`finally` is skipped (the normal post-yield code does NOT run).
2. If there is a matching `except` block, it runs. `HTTPException` is a subclass of `Exception`, so `except Exception` catches it.
3. The `finally` block ALWAYS runs, regardless of whether an exception occurred.

For a typical database session pattern:
```python
async def get_db():
    session = Session()
    try:
        yield session
        await session.commit()    # SKIPPED on exception
    except Exception:
        await session.rollback()  # RUNS — rolls back the transaction
        raise                     # re-raises so FastAPI returns the 404
    finally:
        await session.close()     # ALWAYS RUNS — closes connection
```

This is why the `try/except/finally` structure in yield dependencies is critical — it ensures resources are always cleaned up, transactions are rolled back on errors, and commits only happen on success.
:::

::: details Question 3 — Dependency overrides in testing
**Q:** You have a dependency `get_current_user` that validates a JWT token. In tests, you want to skip JWT validation entirely and always return a specific test user. How do you do this without modifying any production code?

**A:** Use FastAPI's `dependency_overrides` dict:

```python
def get_test_user():
    return User(id=99, name="testuser", roles=["admin"])

app.dependency_overrides[get_current_user] = get_test_user
```

This replaces `get_current_user` with `get_test_user` for all routes that depend on it — including sub-dependencies. If `require_admin` depends on `get_current_user`, it will receive the test user. The override is keyed by the original callable (the function object), not by name.

Important subtleties:
- The override function must have a compatible return type (FastAPI does not validate this — it is your responsibility).
- Overrides are global to the `app` instance. In pytest, always clean up with `app.dependency_overrides.clear()` in a fixture's teardown, or you risk test pollution.
- You can override yield dependencies with non-yield functions and vice versa — FastAPI handles both.
- The override does NOT affect the dependency's sub-dependencies. If the original `get_current_user` depends on `get_db_session`, and you override `get_current_user`, then `get_db_session` is never called at all for that chain.
:::

## Key Mental Models

- **Dependencies are just callables.** Functions, async functions, classes — anything you can call with `()` can be a dependency. FastAPI inspects the signature and injects parameters the same way it does for handlers.
- **Yield = context manager for requests.** Code before `yield` is setup, code after is teardown. Use `try/except/finally` to guarantee cleanup even when handlers raise exceptions.
- **Caching is per-request, not global.** The same dependency used multiple times in one request resolves once. A new request starts with a clean slate. For app-level singletons, use lifespan events.
- **`dependency_overrides` is your testing superpower.** Swap any dependency at the app level without touching handler code — mock databases, skip auth, inject test data.
- **The dependency tree is your application's architecture.** In a well-designed FastAPI app, the dependency tree tells you exactly how authentication, authorization, database access, and business logic are wired together. If the tree is messy, your architecture is messy.

## Related

- [13.1 FastAPI Architecture](01-architecture) — how dependency resolution fits into the request lifecycle
- [13.2 Routing, Params & Validation](02-routing-validation) — dependencies add another way to inject validated parameters
- [13.5 Auth — JWT, OAuth2 & Security](05-auth-security) — authentication and authorization as dependency chains
- [13.6 Database Integration](06-database-integration) — yield dependencies for SQLAlchemy async sessions
- [13.8 Testing FastAPI Applications](08-testing) — dependency overrides in practice
