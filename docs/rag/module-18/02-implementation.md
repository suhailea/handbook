---
title: Reference Implementation
outline: deep
---

# Reference Implementation

Interview weight: 🔥🔥 | Prerequisites: [Case Studies](01-case-studies.md), [Modules 1--17](../index.md) | Stack: Python, FastAPI, PostgreSQL + pgvector, Redis, LangChain/LangGraph, Docker

## 🗣️ In Plain English

::: tip In Plain English
This is the blueprint for a RAG system you could actually deploy. Think of it as a model home in a housing development — it has every room a real house needs (ingestion, retrieval, generation, caching), wired together and functional, but you would customize the finishes for your specific use case.
:::

## ⚙️ Under the Hood

### 1. Project Structure

```
rag-service/
├── docker-compose.yml
├── Dockerfile
├── pyproject.toml
├── alembic/                    # DB migrations
│   └── versions/
├── app/
│   ├── main.py                 # FastAPI app entry point
│   ├── config.py               # Settings via pydantic-settings
│   ├── dependencies.py         # Dependency injection
│   ├── models/
│   │   ├── database.py         # SQLAlchemy models (pgvector)
│   │   └── schemas.py          # Pydantic request/response models
│   ├── ingestion/
│   │   ├── router.py           # Ingestion API endpoints
│   │   ├── parser.py           # Unified document parser
│   │   ├── chunker.py          # Recursive text splitter
│   │   ├── embedder.py         # Embedding generation (batched)
│   │   └── worker.py           # Background ingestion worker
│   ├── retrieval/
│   │   ├── router.py           # Query API endpoints
│   │   ├── vector_search.py    # pgvector similarity search
│   │   ├── keyword_search.py   # tsvector full-text search
│   │   ├── hybrid.py           # RRF fusion
│   │   └── reranker.py         # Cohere rerank
│   ├── generation/
│   │   ├── context.py          # Context construction + citations
│   │   ├── llm.py              # LLM client (streaming)
│   │   └── guardrails.py       # Input/output validation
│   ├── cache/
│   │   └── redis_cache.py      # Caching layer
│   └── observability/
│       ├── logging.py          # Structured logging
│       └── metrics.py          # Prometheus metrics
└── tests/
    ├── test_ingestion.py
    ├── test_retrieval.py
    └── test_generation.py
```

### 2. Database Schema (SQLAlchemy + pgvector)

```python
# app/models/database.py
from datetime import datetime
from uuid import uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    Column, DateTime, Index, String, Text, Integer, Float,
    ForeignKey, func
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR, UUID
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    pass


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID, primary_key=True, default=uuid4)
    title = Column(String(512), nullable=False)
    source = Column(String(256), nullable=False)       # "confluence", "upload", "gdrive"
    source_url = Column(Text)
    tenant_id = Column(String(64), nullable=False, index=True)
    acl_groups = Column(ARRAY(String), nullable=False, default=[])
    metadata_ = Column("metadata", JSONB, default={})
    content_hash = Column(String(64), index=True)      # SHA-256 for dedup
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"

    id = Column(UUID, primary_key=True, default=uuid4)
    document_id = Column(UUID, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    content = Column(Text, nullable=False)
    chunk_index = Column(Integer, nullable=False)       # ordering within document
    token_count = Column(Integer)
    embedding = Column(Vector(1536))                    # OpenAI text-embedding-3-small
    tsv = Column(TSVECTOR)                              # full-text search vector
    tenant_id = Column(String(64), nullable=False)      # denormalized for query perf
    acl_groups = Column(ARRAY(String), nullable=False)  # denormalized
    section_title = Column(String(512))
    page_number = Column(Integer)
    metadata_ = Column("metadata", JSONB, default={})

    document = relationship("Document", back_populates="chunks")

    __table_args__ = (
        Index("ix_chunks_embedding_ivfflat", "embedding",
              postgresql_using="ivfflat",
              postgresql_with={"lists": 100},
              postgresql_ops={"embedding": "vector_cosine_ops"}),
        Index("ix_chunks_tsv", "tsv", postgresql_using="gin"),
        Index("ix_chunks_tenant_acl", "tenant_id", "acl_groups",
              postgresql_using="gin"),
    )
```

### 3. Ingestion API Endpoint

```python
# app/ingestion/router.py
from fastapi import APIRouter, BackgroundTasks, Depends, UploadFile, File, Form
from uuid import UUID

from app.dependencies import get_db, get_current_user
from app.ingestion.worker import ingest_document
from app.models.schemas import IngestResponse

router = APIRouter(prefix="/ingest", tags=["ingestion"])


@router.post("/", response_model=IngestResponse)
async def ingest(
    file: UploadFile = File(...),
    tenant_id: str = Form(...),
    acl_groups: list[str] = Form(default=[]),
    source: str = Form(default="upload"),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """Queue a document for ingestion. Processing happens asynchronously."""
    content = await file.read()
    doc_id = await create_document_record(
        db, title=file.filename, source=source,
        tenant_id=tenant_id, acl_groups=acl_groups,
        content_hash=hash_content(content),
    )
    # Enqueue background processing: parse -> chunk -> embed -> store
    background_tasks.add_task(
        ingest_document, doc_id=doc_id, content=content,
        filename=file.filename, tenant_id=tenant_id,
        acl_groups=acl_groups,
    )
    return IngestResponse(document_id=doc_id, status="queued")
```

### 4. Document Parser

```python
# app/ingestion/parser.py
from pathlib import Path
from dataclasses import dataclass

from unstructured.partition.auto import partition
from unstructured.documents.elements import (
    NarrativeText, Title, Table, ListItem, Image
)


@dataclass
class ParsedSection:
    content: str
    section_title: str | None
    page_number: int | None
    element_type: str  # "text", "table", "image_description"


def parse_document(content: bytes, filename: str) -> list[ParsedSection]:
    """Unified parser: handles PDF, HTML, DOCX, TXT, Markdown."""
    suffix = Path(filename).suffix.lower()

    elements = partition(
        file=content, metadata_filename=filename,
        strategy="hi_res" if suffix == ".pdf" else "auto",
        include_page_breaks=True,
    )

    sections: list[ParsedSection] = []
    current_title: str | None = None

    for el in elements:
        if isinstance(el, Title):
            current_title = str(el)
        elif isinstance(el, (NarrativeText, ListItem)):
            sections.append(ParsedSection(
                content=str(el),
                section_title=current_title,
                page_number=el.metadata.page_number,
                element_type="text",
            ))
        elif isinstance(el, Table):
            sections.append(ParsedSection(
                content=el.metadata.text_as_html or str(el),
                section_title=current_title,
                page_number=el.metadata.page_number,
                element_type="table",
            ))

    return sections
```

### 5. Chunking (Recursive Text Splitter with Metadata)

```python
# app/ingestion/chunker.py
from dataclasses import dataclass

from langchain_text_splitters import RecursiveCharacterTextSplitter


@dataclass
class ChunkWithMetadata:
    content: str
    chunk_index: int
    section_title: str | None
    page_number: int | None
    token_count: int


def chunk_sections(
    sections: list,  # list[ParsedSection]
    chunk_size: int = 512,
    chunk_overlap: int = 64,
) -> list[ChunkWithMetadata]:
    """Split parsed sections into chunks, preserving metadata."""
    splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
        model_name="text-embedding-3-small",
        chunk_size=chunk_size,
        chunk_overlap=chunk_overlap,
        separators=["\n\n", "\n", ". ", " ", ""],
    )

    chunks: list[ChunkWithMetadata] = []
    idx = 0

    for section in sections:
        splits = splitter.split_text(section.content)
        for text in splits:
            chunks.append(ChunkWithMetadata(
                content=text,
                chunk_index=idx,
                section_title=section.section_title,
                page_number=section.page_number,
                token_count=len(text.split()),  # approximate; use tiktoken for exact
            ))
            idx += 1

    return chunks
```

### 6. Embedding Generation (Batched)

```python
# app/ingestion/embedder.py
import openai
from tenacity import retry, stop_after_attempt, wait_exponential

BATCH_SIZE = 100  # OpenAI allows up to 2048 inputs, but 100 is safe for token limits
MODEL = "text-embedding-3-small"

client = openai.OpenAI()


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def _embed_batch(texts: list[str]) -> list[list[float]]:
    response = client.embeddings.create(input=texts, model=MODEL)
    return [item.embedding for item in response.data]


def generate_embeddings(texts: list[str]) -> list[list[float]]:
    """Generate embeddings in batches with retry logic."""
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i : i + BATCH_SIZE]
        embeddings = _embed_batch(batch)
        all_embeddings.extend(embeddings)

    return all_embeddings
```

### 7. Vector Storage (pgvector Upsert with Metadata)

```python
# app/ingestion/worker.py (core storage function)
from uuid import UUID
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.ingestion.parser import parse_document
from app.ingestion.chunker import chunk_sections
from app.ingestion.embedder import generate_embeddings
from app.models.database import Chunk


async def ingest_document(
    doc_id: UUID, content: bytes, filename: str,
    tenant_id: str, acl_groups: list[str],
    db: AsyncSession | None = None,
):
    """Full ingestion pipeline: parse -> chunk -> embed -> store."""
    # 1. Parse
    sections = parse_document(content, filename)

    # 2. Chunk
    chunks = chunk_sections(sections)

    # 3. Embed
    texts = [c.content for c in chunks]
    embeddings = generate_embeddings(texts)

    # 4. Store — delete old chunks for this doc, insert new ones
    await db.execute(
        sql_text("DELETE FROM chunks WHERE document_id = :doc_id"),
        {"doc_id": doc_id},
    )

    for chunk, embedding in zip(chunks, embeddings):
        db_chunk = Chunk(
            document_id=doc_id,
            content=chunk.content,
            chunk_index=chunk.chunk_index,
            token_count=chunk.token_count,
            embedding=embedding,
            tenant_id=tenant_id,
            acl_groups=acl_groups,
            section_title=chunk.section_title,
            page_number=chunk.page_number,
        )
        db.add(db_chunk)

    # 5. Update tsvector for full-text search
    await db.execute(sql_text("""
        UPDATE chunks SET tsv = to_tsvector('english', content)
        WHERE document_id = :doc_id
    """), {"doc_id": doc_id})

    await db.commit()
```

### 8. Metadata Filtering (Tenant + Access Level)

```python
# app/retrieval/vector_search.py
from uuid import UUID
from sqlalchemy import text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession


async def vector_search(
    db: AsyncSession,
    query_embedding: list[float],
    tenant_id: str,
    user_groups: list[str],
    top_k: int = 20,
    metadata_filters: dict | None = None,
) -> list[dict]:
    """Semantic search with mandatory tenant + ACL pre-filtering."""

    # ACL is a pre-filter: unauthorized chunks never leave the DB
    query = sql_text("""
        SELECT
            c.id, c.content, c.section_title, c.page_number,
            c.document_id, d.title as doc_title, d.source_url,
            1 - (c.embedding <=> :embedding) AS similarity
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        WHERE c.tenant_id = :tenant_id
          AND c.acl_groups && :user_groups    -- array overlap: user has access
        ORDER BY c.embedding <=> :embedding   -- cosine distance
        LIMIT :top_k
    """)

    result = await db.execute(query, {
        "embedding": str(query_embedding),
        "tenant_id": tenant_id,
        "user_groups": user_groups,
        "top_k": top_k,
    })

    return [dict(row._mapping) for row in result.fetchall()]
```

### 9. Hybrid Search (pgvector + tsvector)

```python
# app/retrieval/hybrid.py
from app.retrieval.vector_search import vector_search
from app.retrieval.keyword_search import keyword_search


def reciprocal_rank_fusion(
    result_lists: list[list[dict]],
    k: int = 60,
) -> list[dict]:
    """Fuse multiple ranked lists using RRF. k=60 is the standard constant."""
    scores: dict[str, float] = {}
    docs: dict[str, dict] = {}

    for results in result_lists:
        for rank, doc in enumerate(results):
            doc_id = str(doc["id"])
            scores[doc_id] = scores.get(doc_id, 0) + 1.0 / (k + rank + 1)
            docs[doc_id] = doc

    sorted_ids = sorted(scores, key=lambda x: scores[x], reverse=True)
    return [
        {**docs[doc_id], "rrf_score": scores[doc_id]}
        for doc_id in sorted_ids
    ]


async def hybrid_search(
    db, query_text: str, query_embedding: list[float],
    tenant_id: str, user_groups: list[str],
    top_k: int = 20,
) -> list[dict]:
    """Combine vector similarity + BM25 keyword search via RRF."""
    # Run both searches
    vector_results = await vector_search(
        db, query_embedding, tenant_id, user_groups, top_k=top_k,
    )
    kw_results = await keyword_search(
        db, query_text, tenant_id, user_groups, top_k=top_k,
    )

    # Fuse with RRF
    fused = reciprocal_rank_fusion([vector_results, kw_results])
    return fused[:top_k]
```

### 10. Reranking (Cohere API)

```python
# app/retrieval/reranker.py
import cohere
from app.config import settings

co = cohere.Client(api_key=settings.cohere_api_key)


def rerank(
    query: str,
    documents: list[dict],
    top_n: int = 5,
    relevance_threshold: float = 0.25,
) -> list[dict]:
    """Rerank candidates using Cohere cross-encoder. Filter low-relevance."""
    if not documents:
        return []

    response = co.rerank(
        model="rerank-english-v3.0",
        query=query,
        documents=[doc["content"] for doc in documents],
        top_n=top_n,
        return_documents=False,
    )

    reranked = []
    for result in response.results:
        if result.relevance_score >= relevance_threshold:
            doc = documents[result.index]
            doc["rerank_score"] = result.relevance_score
            reranked.append(doc)

    return reranked
```

### 11. Context Construction (Dedup, Ordering, Citation Mapping)

```python
# app/generation/context.py
from dataclasses import dataclass


@dataclass
class CitedChunk:
    citation_id: int          # [1], [2], etc.
    content: str
    doc_title: str
    source_url: str | None
    section_title: str | None
    page_number: int | None


def build_context(chunks: list[dict], max_tokens: int = 4000) -> tuple[str, list[CitedChunk]]:
    """
    Build LLM context from reranked chunks.
    - Deduplicates near-identical chunks
    - Orders by document, then page/section for coherence
    - Assigns citation IDs
    - Truncates to token budget
    """
    # 1. Deduplicate: skip chunks with >90% content overlap
    seen_hashes: set[str] = set()
    unique: list[dict] = []
    for chunk in chunks:
        content_hash = chunk["content"][:200]  # rough dedup key
        if content_hash not in seen_hashes:
            seen_hashes.add(content_hash)
            unique.append(chunk)

    # 2. Order: group by document, then by chunk position
    unique.sort(key=lambda c: (str(c.get("document_id", "")), c.get("page_number", 0)))

    # 3. Build context string + citation map
    citations: list[CitedChunk] = []
    context_parts: list[str] = []
    total_tokens = 0

    for i, chunk in enumerate(unique):
        token_est = len(chunk["content"].split())
        if total_tokens + token_est > max_tokens:
            break

        cid = i + 1
        citations.append(CitedChunk(
            citation_id=cid,
            content=chunk["content"],
            doc_title=chunk.get("doc_title", "Unknown"),
            source_url=chunk.get("source_url"),
            section_title=chunk.get("section_title"),
            page_number=chunk.get("page_number"),
        ))
        context_parts.append(f"[{cid}] {chunk['content']}")
        total_tokens += token_est

    context_str = "\n\n".join(context_parts)
    return context_str, citations
```

### 12. LLM Generation (Streaming with Citations)

```python
# app/generation/llm.py
import openai
from collections.abc import AsyncIterator

from app.config import settings
from app.generation.context import CitedChunk

client = openai.AsyncOpenAI(api_key=settings.openai_api_key)

SYSTEM_PROMPT = """You are a helpful assistant that answers questions based ONLY on
the provided context. Rules:
1. Only use information from the numbered context passages below.
2. Cite sources using [1], [2], etc. after each claim.
3. If the context doesn't contain the answer, say "I don't have enough information
   to answer that based on the available documents."
4. Never fabricate information not in the context.
"""


async def generate_answer(
    query: str,
    context: str,
    citations: list[CitedChunk],
    model: str = "gpt-4o",
) -> AsyncIterator[str]:
    """Stream a cited answer from the LLM."""
    user_message = f"""Context:
{context}

Question: {query}

Provide a thorough answer citing the relevant passages using [1], [2], etc."""

    stream = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        temperature=0.1,
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta.content
        if delta:
            yield delta
```

### 13. Caching Layer (Redis)

```python
# app/cache/redis_cache.py
import hashlib
import json
from typing import Any

import redis.asyncio as redis

from app.config import settings

pool = redis.ConnectionPool.from_url(settings.redis_url, decode_responses=True)


async def get_cached(key: str) -> dict | None:
    """Retrieve cached result."""
    async with redis.Redis(connection_pool=pool) as r:
        data = await r.get(key)
        return json.loads(data) if data else None


async def set_cached(key: str, value: Any, ttl: int = 3600) -> None:
    """Cache a result with TTL."""
    async with redis.Redis(connection_pool=pool) as r:
        await r.set(key, json.dumps(value, default=str), ex=ttl)


def make_cache_key(query: str, tenant_id: str, user_groups: list[str]) -> str:
    """Deterministic cache key from query + access context."""
    raw = f"{query}|{tenant_id}|{','.join(sorted(user_groups))}"
    return f"rag:query:{hashlib.sha256(raw.encode()).hexdigest()}"
```

### 14. Docker Compose Setup

```yaml
# docker-compose.yml
services:
  app:
    build: .
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://rag:rag@postgres:5432/ragdb
      - REDIS_URL=redis://redis:6379/0
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - COHERE_API_KEY=${COHERE_API_KEY}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy

  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: ragdb
      POSTGRES_USER: rag
      POSTGRES_PASSWORD: rag
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U rag"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

volumes:
  pgdata:
```

### Putting It Together — The Query Flow

```
User Query
    │
    ▼
┌─────────────────────────┐
│ 1. Cache check           │  Redis lookup by query + tenant + ACL hash
│    Hit? Return cached.   │
└──────────┬──────────────┘
           │ Miss
           ▼
┌─────────────────────────┐
│ 2. Embed query           │  OpenAI text-embedding-3-small
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 3. Hybrid search         │  pgvector (semantic) + tsvector (keyword)
│    + ACL pre-filter      │  with tenant_id + acl_groups filtering
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 4. RRF fusion            │  Merge vector + keyword results
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 5. Rerank                │  Cohere cross-encoder, filter < threshold
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 6. Build context         │  Dedup, order, assign citations, token budget
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 7. Generate              │  LLM streaming with citation instructions
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 8. Cache result          │  Store in Redis with TTL
│ 9. Log + metrics         │  Structured log, Prometheus counters
└─────────────────────────┘
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**pgvector IVFFlat index needs retraining.** The IVFFlat index builds cluster centroids at creation time. As you ingest more documents, the centroids become stale and recall degrades. Symptom: retrieval quality drops gradually over weeks despite no code changes. Fix: periodically rebuild the index with `REINDEX INDEX ix_chunks_embedding_ivfflat;`, or switch to HNSW which does not require retraining (but uses more memory).

**Background task loses database session.** The `BackgroundTasks` approach in FastAPI shares no session with the request handler. If you pass the request's `db` session to the background task, it will be closed before the task runs. Symptom: `SessionClosedError` in background ingestion. Fix: create a new session inside the background task, or use a proper task queue (Celery, arq) instead of FastAPI's `BackgroundTasks` for long-running work.

**Cache poisoning via ACL changes.** If a user's group membership changes (e.g., they leave a team), cached results generated under the old ACL may still be served. Symptom: user sees documents they should no longer access. Fix: include the user's group list in the cache key (as shown above) and set short TTLs, or invalidate cache entries when ACL changes are detected.

**tsvector language mismatch.** The `to_tsvector('english', content)` call applies English stemming and stop-word removal. If your content includes non-English text, keywords will be incorrectly stemmed or dropped. Symptom: keyword search returns no results for non-English queries. Fix: detect language per-chunk and store the appropriate tsvector configuration, or use `'simple'` configuration for multilingual content (no stemming, but preserves all tokens).
:::

## 🎯 Checkpoint

::: details Question 1 — Why pre-filter ACLs in SQL?
**Q:** The vector search query includes `WHERE c.acl_groups && :user_groups`. Why is this a SQL-level filter rather than a Python-level filter applied after retrieval? What happens to recall if you post-filter instead?

**A:** SQL-level filtering ensures unauthorized chunks never leave the database — they are excluded from the `ORDER BY ... LIMIT` operation. If you post-filter, you retrieve the top 20 most similar chunks regardless of ACL, then discard unauthorized ones. This creates two problems: (1) you might discard 15 of 20 results, leaving only 5 authorized chunks that may not be the best 5 the user could see — recall drops because the database never considered other authorized chunks that ranked 21-50, and (2) unauthorized content briefly exists in application memory, creating a security exposure in logs, error traces, or memory dumps. The pgvector index with an ACL GIN index means the combined filter+similarity query is still efficient.
:::

::: details Question 2 — Embedding batch size trade-off
**Q:** The embedder uses a batch size of 100. What happens if you set it to 2000 (OpenAI's maximum)? What if you set it to 1?

**A:** At batch size 2000: you minimize HTTP round-trips (one call instead of twenty for 2000 chunks), but you risk hitting OpenAI's token-per-request limit (8191 tokens per input, and total tokens across all inputs matters for rate limiting). One failed request in a batch of 2000 means retrying all 2000. At batch size 1: you make 2000 HTTP calls, each with connection overhead and rate-limit counting. Total wall-clock time increases dramatically due to latency multiplication. Batch size 100 is a pragmatic middle ground: small enough that a retry is cheap, large enough that HTTP overhead is amortized. In production, you would also parallelize batches with asyncio to maximize throughput within rate limits.
:::

::: details Question 3 — Cache key design
**Q:** The cache key includes `tenant_id` and `sorted(user_groups)`. Why sort the groups? What would happen if you also included the user's ID in the cache key?

**A:** Sorting ensures deterministic keys: `["eng", "admin"]` and `["admin", "eng"]` produce the same hash, so two users with identical group memberships share cached results. If you included the user's ID, every user would get their own cache entry even if they have identical access — the cache hit rate drops to nearly zero because individual users rarely repeat the exact same query. The correct design is to cache by *access context* (tenant + groups), not by identity. This maximizes cache sharing among users with the same permissions while ensuring ACL correctness.
:::

## Key Mental Models

- **The pipeline is parse, chunk, embed, store, search, rerank, build context, generate, cache.** Every RAG system follows this flow; the details vary.
- **ACL filtering belongs in the database query.** Never retrieve unauthorized chunks and discard them in application code.
- **Hybrid search (vector + keyword) with RRF fusion** is the default retrieval strategy for production systems. Pure vector search misses exact matches; pure keyword search misses semantic similarity.
- **Batching and retry logic** around external API calls (embeddings, reranking, LLM) are not optional — they are core reliability concerns.
- **Cache keys must include the access context**, not just the query text, to prevent information leakage.

## Related

- [10 Design Case Studies](01-case-studies.md) — the architectures this implementation supports
- [Production Checklist](03-checklist.md) — verify this implementation against the full checklist
- [Hybrid Search](../module-09/02-hybrid-search.md) — deep dive on RRF and fusion strategies
- [Security & ACL](../module-14/01-security.md) — access control patterns in detail
- [Caching & Freshness](../module-17/01-caching-freshness.md) — cache invalidation strategies
