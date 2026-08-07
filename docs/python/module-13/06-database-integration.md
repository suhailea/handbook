---
title: "Database Integration — SQLAlchemy & Async"
outline: deep
---

# Database Integration — SQLAlchemy & Async

Interview weight: 🔥🔥 | FastAPI 0.100+ / SQLAlchemy 2.0+ / Python 3.12+ | Prerequisites: [Dependency Injection](./03-dependency-injection.md), [Auth — JWT, OAuth2 & Security](./05-auth-security.md)

## 🗣️ In Plain English

::: tip In Plain English
Imagine your FastAPI app is a busy restaurant, and your database is a warehouse across town where all the ingredients are stored.

You don't want every waiter to hop in a car and drive to the warehouse whenever a customer orders something. That would be chaotic, slow, and you'd run out of cars. Instead, you have a **loading dock manager** (the database session). The loading dock manager controls access: one truck at a time backs up to the dock, loads or unloads goods, and leaves. The manager keeps everything orderly.

The **warehouse itself** (the database engine) maintains the inventory and the trucks. It keeps a small fleet of trucks parked and ready (the connection pool) so you don't have to rent a new truck for every delivery. When a truck comes back, it goes back into the pool for the next trip.

Here's the important part: each waiter (request handler) gets their own loading dock manager for the duration of their shift (the request). The manager handles everything — loading goods, checking manifests, and if a delivery arrives damaged (a database error), the manager **rolls the whole shipment back** (transaction rollback) so the warehouse isn't left in a messy state. When the waiter's shift ends (the request finishes), the manager cleans up automatically — returns the truck to the pool, clears the paperwork.

This is where FastAPI's **dependency injection** shines. Instead of each waiter figuring out how to get a manager, the restaurant's system automatically assigns one at the start of each shift and reclaims it at the end. The waiter just says "I need a loading dock manager" and one appears. If the waiter quits mid-shift (an error occurs), the manager still cleans up — no abandoned trucks, no half-delivered shipments.

The **inventory manifest** (your SQLAlchemy models) describes what's in the warehouse: what shelves exist, what goes on each shelf, how items relate to each other (this ingredient belongs to that recipe). You update the manifest through **migrations** — formal change orders that add new shelves or rearrange existing ones, and can be reversed if the new layout doesn't work.
:::

## ⚙️ Under the Hood

### Setting Up the Async Engine and Session

SQLAlchemy 2.0 provides first-class async support. The engine manages the connection pool; the session manages individual transactions.

```python
# run: uvicorn app:app --reload
# pip install "fastapi[standard]" "sqlalchemy[asyncio]" aiosqlite
# database.py — central database configuration

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# For SQLite (development):
DATABASE_URL = "sqlite+aiosqlite:///./app.db"

# For PostgreSQL (production):
# DATABASE_URL = "postgresql+asyncpg://user:pass@localhost:5432/mydb"

engine = create_async_engine(
    DATABASE_URL,
    # --- Connection pool settings (PostgreSQL; SQLite ignores most of these) ---
    pool_size=5,          # Number of persistent connections kept open
    max_overflow=10,      # Extra connections allowed beyond pool_size during spikes
    pool_recycle=3600,    # Recycle connections after 1 hour (prevents stale connections)
    pool_pre_ping=True,   # Test connection health before using it (handles DB restarts)
    echo=False,           # Set True to log all SQL statements (noisy but useful for debugging)
)

# async_sessionmaker produces AsyncSession instances.
# expire_on_commit=False: objects remain usable after commit without re-querying.
async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)
```

**Engine vs Session vs Connection:**

| Concept | What it is | Lifecycle |
|---|---|---|
| **Engine** | Connection pool + dialect (how to talk to this DB) | Application lifetime |
| **Connection** | A single TCP connection to the database | Borrowed from pool per operation |
| **Session** | Unit-of-work tracker — batches changes, manages transactions | One per request |

### The Session Dependency with `yield`

FastAPI's `Depends` with a generator function gives you setup/teardown semantics — the session is created before the handler runs and closed after, even if an exception occurs:

```python
# database.py (continued)
from collections.abc import AsyncGenerator


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Dependency that provides a database session per request.

    - yield gives the handler a session
    - finally block ensures cleanup even on exceptions
    - The session is NOT committed automatically — handlers must commit explicitly,
      or you add auto-commit logic here.
    """
    async with async_session() as session:
        try:
            yield session
            await session.commit()  # Auto-commit if handler didn't raise
        except Exception:
            await session.rollback()  # Rollback on any error
            raise
        finally:
            await session.close()
```

### Declarative Models with SQLAlchemy 2.0

SQLAlchemy 2.0 uses `Mapped[]` type annotations for column declarations — fully typed, IDE-friendly:

```python
# models.py
from datetime import datetime, timezone

from sqlalchemy import ForeignKey, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Base class for all models. Provides metadata and registry."""
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),  # DB-level default
    )

    # Relationship: one user has many posts
    posts: Mapped[list["Post"]] = relationship(
        back_populates="author",
        cascade="all, delete-orphan",  # Delete posts when user is deleted
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, username={self.username!r})>"


class Post(Base):
    __tablename__ = "posts"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    content: Mapped[str] = mapped_column(String(10000))
    published: Mapped[bool] = mapped_column(default=False)
    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(),
    )

    # Foreign key — every post belongs to one user
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    author: Mapped["User"] = relationship(back_populates="posts")

    def __repr__(self) -> str:
        return f"<Post(id={self.id}, title={self.title!r})>"
```

### Pydantic Schemas (Separate from Models)

SQLAlchemy models define database structure. Pydantic schemas define API contracts. Keep them separate:

```python
# schemas.py
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr


# --- User schemas ---
class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str  # Plain text — hashed before storage


class UserResponse(BaseModel):
    id: int
    email: str
    username: str
    is_active: bool
    created_at: datetime

    # model_config allows Pydantic to read from SQLAlchemy model attributes
    model_config = ConfigDict(from_attributes=True)


# --- Post schemas ---
class PostCreate(BaseModel):
    title: str
    content: str
    published: bool = False


class PostResponse(BaseModel):
    id: int
    title: str
    content: str
    published: bool
    created_at: datetime
    author_id: int

    model_config = ConfigDict(from_attributes=True)


class PostWithAuthor(PostResponse):
    author: UserResponse
```

### CRUD Operations: The 2.0 Statement-Based API

SQLAlchemy 2.0 replaces the legacy `session.query()` with explicit `select()`, `insert()`, `update()`, `delete()` statements:

```python
# crud.py
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import Post, User
from schemas import PostCreate, UserCreate


# --- User CRUD ---
async def create_user(
    session: AsyncSession, user_data: UserCreate, hashed_password: str
) -> User:
    user = User(
        email=user_data.email,
        username=user_data.username,
        hashed_password=hashed_password,
    )
    session.add(user)
    await session.flush()    # Assigns the ID without committing the transaction
    await session.refresh(user)  # Reload to get server-generated defaults
    return user


async def get_user_by_id(session: AsyncSession, user_id: int) -> User | None:
    result = await session.execute(
        select(User).where(User.id == user_id)
    )
    return result.scalars().first()


async def get_user_by_email(session: AsyncSession, email: str) -> User | None:
    result = await session.execute(
        select(User).where(User.email == email)
    )
    return result.scalars().first()


async def list_users(
    session: AsyncSession, skip: int = 0, limit: int = 100
) -> list[User]:
    result = await session.execute(
        select(User).offset(skip).limit(limit)
    )
    return list(result.scalars().all())


# --- Post CRUD ---
async def create_post(
    session: AsyncSession, post_data: PostCreate, author_id: int
) -> Post:
    post = Post(**post_data.model_dump(), author_id=author_id)
    session.add(post)
    await session.flush()
    await session.refresh(post)
    return post


async def get_post_with_author(session: AsyncSession, post_id: int) -> Post | None:
    """Eagerly load the author relationship to avoid N+1."""
    result = await session.execute(
        select(Post)
        .where(Post.id == post_id)
        .options(selectinload(Post.author))  # Load author in the same query batch
    )
    return result.scalars().first()


async def update_post(
    session: AsyncSession, post_id: int, title: str | None = None
) -> None:
    """Bulk update without loading the object into memory."""
    values: dict = {}
    if title is not None:
        values["title"] = title
    if values:
        await session.execute(
            update(Post).where(Post.id == post_id).values(**values)
        )


async def delete_post(session: AsyncSession, post_id: int) -> None:
    await session.execute(
        delete(Post).where(Post.id == post_id)
    )
```

### Transactions: Implicit and Explicit

By default, SQLAlchemy sessions use **implicit transactions** — a transaction begins on the first database operation and persists until you `commit()` or `rollback()`.

```python
from sqlalchemy.ext.asyncio import AsyncSession


async def transfer_post(
    session: AsyncSession, post_id: int, from_user_id: int, to_user_id: int
) -> None:
    """
    Transfer a post between users atomically.
    If any step fails, the entire operation rolls back.
    """
    # Explicit transaction block — clearer intent than implicit
    async with session.begin():
        # Verify the post belongs to from_user
        post = await get_post_with_author(session, post_id)
        if post is None or post.author_id != from_user_id:
            raise ValueError("Post not found or not owned by source user")

        # Reassign
        post.author_id = to_user_id
        # session.begin() auto-commits at the end of the block,
        # or auto-rolls-back if an exception is raised.
```

### The N+1 Query Problem

This is the most common performance trap with ORMs. It occurs when you load a list of objects, then access a relationship on each one — triggering one query per object.

```python
# THE PROBLEM — N+1 queries:
async def list_posts_bad(session: AsyncSession) -> list[Post]:
    result = await session.execute(select(Post))
    posts = list(result.scalars().all())
    # Each access to post.author fires a separate SELECT query!
    # 1 query for posts + N queries for N authors = N+1 queries
    for post in posts:
        print(post.author.username)  # LAZY LOAD — triggers query
    return posts


# THE FIX — Eager loading:
async def list_posts_good(session: AsyncSession) -> list[Post]:
    result = await session.execute(
        select(Post).options(
            selectinload(Post.author)  # SELECT ... WHERE user.id IN (1, 2, 3, ...)
        )
    )
    posts = list(result.scalars().all())
    # author is already loaded — no extra queries
    for post in posts:
        print(post.author.username)  # No query — already in memory
    return posts
```

| Strategy | SQL pattern | When to use |
|---|---|---|
| `selectinload()` | `SELECT ... WHERE id IN (...)` | One-to-many, small-to-medium sets |
| `joinedload()` | `LEFT JOIN` in the original query | Many-to-one, one-to-one |
| `subqueryload()` | Subquery for related objects | Large sets where IN clause hits limits |
| `lazyload()` (default) | Query on attribute access | Never in async (raises error in async context) |

**Critical note for async:** lazy loading (the default) **does not work** with async sessions. Accessing an unloaded relationship raises `MissingGreenlet` because SQLAlchemy can't implicitly run a synchronous query in an async context. You must always use eager loading strategies with `AsyncSession`.

### Alembic for Migrations

Alembic is SQLAlchemy's migration tool — it generates and applies incremental schema changes.

```bash
# Initialize Alembic in your project
pip install alembic
alembic init alembic
```

Configure `alembic/env.py` for async:

```python
# alembic/env.py
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from models import Base  # Import your models' Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations without a database connection (generates SQL)."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection) -> None:  # type: ignore[no-untyped-def]
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Run migrations with an async engine."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
```

Common Alembic commands:

```bash
# Auto-generate a migration by comparing models to the database schema
alembic revision --autogenerate -m "create users and posts tables"

# Apply all pending migrations
alembic upgrade head

# Rollback the last migration
alembic downgrade -1

# Show current migration state
alembic current

# Show migration history
alembic history
```

### Repository Pattern

For larger applications, abstract database access behind a clean interface:

```python
# repository.py
from abc import ABC, abstractmethod

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import Post, User


class UserRepository:
    """Encapsulates all database operations for User."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_by_id(self, user_id: int) -> User | None:
        result = await self._session.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalars().first()

    async def get_by_email(self, email: str) -> User | None:
        result = await self._session.execute(
            select(User).where(User.email == email)
        )
        return result.scalars().first()

    async def create(self, user: User) -> User:
        self._session.add(user)
        await self._session.flush()
        await self._session.refresh(user)
        return user

    async def list_all(self, skip: int = 0, limit: int = 100) -> list[User]:
        result = await self._session.execute(
            select(User).offset(skip).limit(limit)
        )
        return list(result.scalars().all())
```

Use the repository as a dependency:

```python
from typing import Annotated

from fastapi import Depends

from database import get_db
from repository import UserRepository


async def get_user_repo(
    session: Annotated[AsyncSession, Depends(get_db)],
) -> UserRepository:
    return UserRepository(session)


@app.get("/users/{user_id}", response_model=UserResponse)
async def read_user(
    user_id: int,
    repo: Annotated[UserRepository, Depends(get_user_repo)],
) -> User:
    user = await repo.get_by_id(user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user
```

### Multiple Databases

For applications that need to read from a replica or use separate databases for different domains:

```python
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Primary (read-write)
primary_engine = create_async_engine("postgresql+asyncpg://user:pass@primary:5432/mydb")
PrimarySession = async_sessionmaker(primary_engine, class_=AsyncSession)

# Replica (read-only)
replica_engine = create_async_engine("postgresql+asyncpg://user:pass@replica:5432/mydb")
ReplicaSession = async_sessionmaker(replica_engine, class_=AsyncSession)


async def get_primary_db() -> AsyncGenerator[AsyncSession, None]:
    async with PrimarySession() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def get_replica_db() -> AsyncGenerator[AsyncSession, None]:
    async with ReplicaSession() as session:
        yield session  # No commit needed — read-only
```

### Complete Example: Tying It All Together

```python
# run: uvicorn app:app --reload
# pip install "fastapi[standard]" "sqlalchemy[asyncio]" aiosqlite
# app.py — complete working application

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import String, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# --- Database setup ---
engine = create_async_engine("sqlite+aiosqlite:///./demo.db", echo=True)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class Item(Base):
    __tablename__ = "items"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), index=True)
    description: Mapped[str] = mapped_column(String(500), default="")
    price: Mapped[float] = mapped_column()
    in_stock: Mapped[bool] = mapped_column(default=True)


# --- Schemas ---
class ItemCreate(BaseModel):
    name: str
    description: str = ""
    price: float
    in_stock: bool = True


class ItemResponse(BaseModel):
    id: int
    name: str
    description: str
    price: float
    in_stock: bool
    model_config = ConfigDict(from_attributes=True)


# --- Lifespan: create tables on startup ---
@asynccontextmanager
async def lifespan(app: FastAPI):  # type: ignore[no-untyped-def]
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    await engine.dispose()


app = FastAPI(lifespan=lifespan)


# --- Dependency ---
async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# --- Routes ---
@app.post("/items", response_model=ItemResponse, status_code=201)
async def create_item(
    item_data: ItemCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Item:
    item = Item(**item_data.model_dump())
    db.add(item)
    await db.flush()
    await db.refresh(item)
    return item


@app.get("/items", response_model=list[ItemResponse])
async def list_items(
    db: Annotated[AsyncSession, Depends(get_db)],
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
) -> list[Item]:
    result = await db.execute(
        select(Item).offset(skip).limit(limit)
    )
    return list(result.scalars().all())


@app.get("/items/{item_id}", response_model=ItemResponse)
async def get_item(
    item_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Item:
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalars().first()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@app.delete("/items/{item_id}", status_code=204)
async def delete_item(
    item_id: int,
    db: Annotated[AsyncSession, Depends(get_db)],
) -> None:
    result = await db.execute(select(Item).where(Item.id == item_id))
    item = result.scalars().first()
    if item is None:
        raise HTTPException(status_code=404, detail="Item not found")
    await db.delete(item)
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. Lazy loading with async sessions raises `MissingGreenlet`.**
Symptom: `sqlalchemy.exc.MissingGreenlet: greenlet_spawn has not been called; can't call await_only() here`. This happens when you access an unloaded relationship on a model returned from an async session. The default `lazyload` strategy tries to run a synchronous query, which is impossible in an async context. The fix: always use `selectinload()` or `joinedload()` in your queries. To catch this early, set `relationship(lazy="raise")` as the default — it will raise an explicit error instead of the cryptic greenlet message.

**2. Connection pool exhaustion under load.**
Symptom: requests hang for seconds then fail with `TimeoutError` or `QueuePool limit exceeded`. The default `pool_size=5` with `max_overflow=10` allows 15 concurrent connections. If your handler holds a session while doing slow work (calling external APIs, processing files), connections stay checked out. The fix: keep database sessions short — do your DB work, commit, then do non-DB work. Monitor pool statistics with `engine.pool.status()`. Increase `pool_size` for high-throughput services, but remember: each connection is a TCP socket and a backend process on PostgreSQL.

**3. Forgetting to commit — data silently disappears.**
Symptom: your POST endpoint returns the created object with an ID, but a subsequent GET returns 404. The session's `flush()` sent the INSERT to the database (assigning the ID), but without `commit()`, the transaction was rolled back when the session closed. The fix: either commit explicitly in your CRUD functions, or use the `get_db()` dependency pattern shown above that auto-commits on success. Never assume `flush()` is permanent — it's only visible within the current transaction.
:::

## 🎯 Checkpoint

::: details Question 1 — flush vs commit
**Q:** What is the difference between `session.flush()` and `session.commit()`? If you call `flush()` to get a generated ID and then an exception occurs before `commit()`, what happens to the database row?

**A:** `flush()` sends pending SQL statements to the database (INSERT, UPDATE, DELETE) within the current transaction. The database executes them and returns generated values (like auto-increment IDs), but the transaction remains open. `commit()` finalizes the transaction, making changes permanent and visible to other sessions. If an exception occurs after `flush()` but before `commit()`, the transaction is rolled back — the row is removed, the auto-increment ID is consumed but wasted. The row never existed from the perspective of other connections. This is why `flush()` is useful for obtaining IDs mid-transaction, but `commit()` is what makes data durable.
:::

::: details Question 2 — N+1 in async context
**Q:** You have a `/posts` endpoint that returns 50 posts with their author names. Using the default relationship configuration with `AsyncSession`, what happens when your serializer accesses `post.author.username` for each post?

**A:** It raises `MissingGreenlet`. In an async session, lazy loading is not just slow — it's impossible. SQLAlchemy's lazy loading mechanism attempts to run a synchronous `SELECT` to fetch the related `User`, but async sessions don't support implicit synchronous I/O. The solution is to eagerly load the relationship in the original query: `select(Post).options(selectinload(Post.author))`. This issues one additional `SELECT ... WHERE users.id IN (...)` query to batch-load all authors. With 50 posts by 10 distinct authors, you get 2 queries instead of 51 (or in this case, 50 crashes instead of 51 queries).
:::

::: details Question 3 — Connection pool sizing
**Q:** Your FastAPI service handles 200 concurrent requests, each holding a database session for ~50ms. You configured `pool_size=5, max_overflow=10`. Will this work? What happens if each request suddenly starts taking 500ms due to a slow downstream query?

**A:** At 200 req/s with 50ms per session, you need `200 * 0.05 = 10` concurrent connections on average. With pool_size=5 and max_overflow=10, you have 15 max connections — this works with some headroom. When latency jumps to 500ms, you need `200 * 0.5 = 100` concurrent connections. With only 15 available, 85 requests queue up waiting for a connection. After the pool's timeout (default 30s), they fail with `TimeoutError`. This cascading failure is called **pool exhaustion**. Mitigations: increase pool size (but PostgreSQL has its own `max_connections` limit, typically 100-200), add a connection pooler like PgBouncer between your app and the database, set aggressive statement timeouts to kill slow queries, and implement circuit breakers to fail fast when the database is struggling.
:::

## Key Mental Models

- **Engine = pool, Session = one conversation.** The engine manages connections across your whole app. A session is one request's scoped interaction with the database, providing transaction boundaries and identity tracking.
- **`flush()` is tentative, `commit()` is permanent.** Flush sends SQL to the DB within a transaction; commit finalizes it. Without commit, everything rolls back.
- **Async sessions forbid lazy loading.** Always use `selectinload()` or `joinedload()`. Set `lazy="raise"` on relationships to catch mistakes early.
- **The dependency with `yield` is your session lifecycle.** `get_db()` creates, commits-or-rolls-back, and closes the session. Handlers never manage session lifecycle directly.
- **Pydantic schemas and SQLAlchemy models are separate layers.** Models define storage; schemas define API contracts. `from_attributes=True` bridges them for serialization.

## Related

- [Dependency Injection](./03-dependency-injection.md) — how `Depends()` with `yield` provides the session lifecycle
- [Auth — JWT, OAuth2 & Security](./05-auth-security.md) — storing users and credentials in the database
- [Middleware, CORS & Error Handling](./04-middleware-errors.md) — how database errors interact with exception handlers
