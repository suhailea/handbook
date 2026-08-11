---
title: CSV, Excel & Structured Data
outline: deep
---

# CSV, Excel & Structured Data

**Interview weight:** 🔥🔥🔥 | **Prerequisites:** [Parsing Every Format](01-parsing-formats.md) | **Builds toward:** Chunking Strategies (Module 5), [RAG vs Alternatives](../module-01/02-rag-vs-alternatives.md)

## 🗣️ In Plain English

::: tip In Plain English
You would not cut a spreadsheet into random strips and ask someone to answer questions from the strips. But that is exactly what naive RAG does with CSV data. Structured data needs structured tools — usually SQL, sometimes embeddings, often both.
:::

## ⚙️ Under the Hood

### Why Naive Chunking Destroys Structured Data

This is the single most common mistake in RAG systems that handle tabular data. Here is what happens:

```
ORIGINAL CSV:
  employee_id, name,    department, salary, hire_date
  1001,        Alice,   Engineering, 95000, 2020-03-15
  1002,        Bob,     Marketing,   82000, 2019-07-22
  1003,        Charlie, Engineering, 105000, 2018-01-10
  1004,        Diana,   Marketing,   78000, 2021-11-01
  ...1000 more rows...

NAIVE CHUNKING (500 tokens per chunk):

  Chunk 1: "employee_id, name, department, salary, hire_date
            1001, Alice, Engineering, 95000, 2020-03-15
            1002, Bob, Marketing, 82000, 2019-07-22
            1003, Charlie, Engineering, 105000, 2018-01-10
            ..."

  Chunk 2: "1004, Diana, Marketing, 78000, 2021-11-01
            1005, Eve, Sales, 88000, 2020-06-14
            ..."   <-- NO HEADERS! What do these numbers mean?

  Chunk 3-20: ... more rows without headers ...

PROBLEMS:
  1. Only Chunk 1 has column headers — Chunks 2-20 are meaningless
     without them (what is 78000? salary? employee_id? zip code?)
  2. "Average salary?" requires ALL rows, but retrieval returns 3-5 chunks
  3. "Find all engineers" requires scanning all chunks — retrieval
     finds Chunk 1 (mentions "Engineering") but misses Chunk 7
     (also has engineers but no header to match on)
  4. Embeddings of "1004, Diana, Marketing, 78000" have almost no
     semantic meaning — what query would retrieve this?
```

### The Right Approach: Route by Query Type

Different questions about the same data need different tools:

```
                        ┌─────────────────────┐
                        │    User Query        │
                        └──────────┬──────────┘
                                   │
                          ┌────────┴────────┐
                          │  Query Router   │
                          │  (classify      │
                          │   query type)   │
                          └────────┬────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                    │
              ▼                    ▼                    ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │  Analytical    │  │  Text Search   │  │  Hybrid        │
     │  (SQL)         │  │  (Embeddings)  │  │  (SQL + RAG)   │
     │                │  │                │  │                │
     │ "Average       │  │ "Find similar  │  │ "Summarize     │
     │  salary?"      │  │  complaints"   │  │  complaints    │
     │ "Count by      │  │ "Products like │  │  from customers│
     │  department"   │  │  this one"     │  │  who spent     │
     │ "Top 10..."    │  │                │  │  over $1000"   │
     └────────┬───────┘  └────────┬───────┘  └────────┬───────┘
              │                    │                    │
              ▼                    ▼                    ▼
     ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
     │  PostgreSQL    │  │  Vector DB     │  │  SQL query →   │
     │  or SQLite     │  │  (embedded     │  │  filter set →  │
     │                │  │   text cols)   │  │  vector search │
     │  SQL result →  │  │               │  │  on filtered   │
     │  LLM narrate   │  │  Retrieved    │  │  set → LLM     │
     │                │  │  chunks → LLM │  │  summarize     │
     └────────────────┘  └────────────────┘  └────────────────┘
```

### Query Type Examples with Architecture

| Query | Type | Approach | Why |
|-------|------|----------|-----|
| "What is the average salary?" | Analytical | SQL: `SELECT AVG(salary) FROM employees` | Aggregation over all rows — embeddings cannot do this |
| "Find complaints similar to 'shipping was late'" | Text search | Embed the `complaint_text` column, vector search | Semantic similarity on free-text fields |
| "Show all flights delayed more than 2 hours" | Filter | SQL: `WHERE delay_minutes > 120` | Exact filtering — embeddings approximate, SQL is exact |
| "Summarize customer feedback about pricing" | Hybrid | Embed `feedback_text`, retrieve pricing-related chunks, LLM summarize | Need semantic search (find relevant feedback) + synthesis |
| "Compare revenue between Q1 and Q2" | Analytical | SQL for revenue figures, LLM for narrative comparison | Numbers from SQL, narrative from LLM |
| "Which department has the highest turnover and why?" | Hybrid | SQL for turnover rate calculation, embed exit survey text, retrieve reasons, LLM synthesize | Quantitative (SQL) + qualitative (RAG) |

### Pattern 1: NL-to-SQL (For Analytical Queries)

When the data is structured and the question is analytical, convert natural language to SQL.

```python
# run: pip install openai sqlalchemy && python nl_to_sql.py

from openai import OpenAI
import sqlite3
import json


def get_table_schema(db_path: str) -> str:
    """Extract schema description for the LLM."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Get all tables and their schemas
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
    tables = cursor.fetchall()

    schema_parts = []
    for (table_name,) in tables:
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = cursor.fetchall()

        col_descriptions = []
        for col in columns:
            col_name, col_type = col[1], col[2]
            col_descriptions.append(f"  {col_name} ({col_type})")

        # Get sample rows for context
        cursor.execute(f"SELECT * FROM {table_name} LIMIT 3")
        samples = cursor.fetchall()

        schema_parts.append(
            f"Table: {table_name}\n"
            f"Columns:\n" + "\n".join(col_descriptions) + "\n"
            f"Sample rows: {samples}"
        )

    conn.close()
    return "\n\n".join(schema_parts)


def nl_to_sql(
    question: str,
    db_path: str,
    model: str = "gpt-4o",
) -> dict[str, str | list]:
    """Convert natural language question to SQL and execute."""
    client = OpenAI()
    schema = get_table_schema(db_path)

    response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are a SQL expert. Given a database schema and a "
                    "natural language question, generate a SQLite query. "
                    "Return ONLY the SQL query, no explanation.\n\n"
                    f"Schema:\n{schema}"
                ),
            },
            {"role": "user", "content": question},
        ],
        temperature=0,
    )

    sql = response.choices[0].message.content.strip()
    # Remove markdown code fences if present
    sql = sql.removeprefix("```sql").removesuffix("```").strip()

    # Execute the query
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        cursor.execute(sql)
        results = cursor.fetchall()
        columns = [desc[0] for desc in cursor.description] if cursor.description else []
    finally:
        conn.close()

    # Generate natural language answer from results
    answer_response = client.chat.completions.create(
        model=model,
        messages=[
            {
                "role": "system",
                "content": (
                    "Convert the following SQL query result into a clear, "
                    "natural language answer. Include the actual numbers."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Question: {question}\n"
                    f"SQL: {sql}\n"
                    f"Columns: {columns}\n"
                    f"Results: {results}"
                ),
            },
        ],
        temperature=0,
    )

    return {
        "question": question,
        "sql": sql,
        "raw_results": results,
        "answer": answer_response.choices[0].message.content,
    }


# Example usage:
# result = nl_to_sql(
#     "What is the average salary by department?",
#     "company.db"
# )
# print(result["answer"])
# → "The average salary by department is: Engineering $100,000,
#    Marketing $80,000, Sales $88,000."
```

### Pattern 2: Embed Text Columns Only

When the CSV has free-text columns (descriptions, feedback, notes), embed those — but keep the structured columns as metadata.

```python
# run: python embed_text_columns.py

import pandas as pd
from dataclasses import dataclass


@dataclass
class ChunkWithMetadata:
    text: str
    metadata: dict


def prepare_csv_for_embedding(
    csv_path: str,
    text_columns: list[str],
    metadata_columns: list[str],
    id_column: str,
) -> list[ChunkWithMetadata]:
    """Prepare CSV for embedding: embed text columns, keep structured as metadata.

    ONLY text columns become embeddings. Structured columns become
    filterable metadata in the vector DB.
    """
    df = pd.read_csv(csv_path)
    chunks = []

    for _, row in df.iterrows():
        # Combine text columns into one embedding text
        text_parts = []
        for col in text_columns:
            value = str(row[col]).strip()
            if value and value.lower() != "nan":
                text_parts.append(f"{col}: {value}")

        if not text_parts:
            continue  # Skip rows with no text content

        text = "\n".join(text_parts)

        # Structured columns become metadata (for filtering)
        metadata = {col: row[col] for col in metadata_columns if pd.notna(row[col])}
        metadata["row_id"] = str(row[id_column])

        chunks.append(ChunkWithMetadata(text=text, metadata=metadata))

    return chunks


# Example: Customer feedback CSV
# Columns: customer_id, date, product, rating, feedback_text, resolution
#
# text_columns = ["feedback_text", "resolution"]  ← embed these
# metadata_columns = ["customer_id", "date", "product", "rating"]  ← filter on these
#
# Query: "Complaints about shipping from customers who rated 1 star"
# → Vector search on feedback_text with filter: {"rating": 1}
```

### Pattern 3: Hybrid (SQL + Embeddings)

The most powerful pattern for mixed queries:

```python
# run: python hybrid_csv_query.py

from enum import Enum


class QueryType(Enum):
    ANALYTICAL = "analytical"      # Pure SQL
    TEXT_SEARCH = "text_search"    # Pure vector search
    HYBRID = "hybrid"             # SQL filter + vector search
    COMPARISON = "comparison"     # SQL aggregation + LLM narrative


async def classify_query(query: str, schema: str) -> QueryType:
    """Use LLM to classify query type."""
    response = await llm.chat(
        messages=[{
            "role": "system",
            "content": (
                "Classify the following query against this database schema. "
                "Return ONLY one of: analytical, text_search, hybrid, comparison.\n\n"
                "- analytical: needs aggregation, counting, filtering on numeric/date columns\n"
                "- text_search: searches for meaning/similarity in text fields\n"
                "- hybrid: combines structured filtering with text search\n"
                "- comparison: needs numbers from the DB + narrative explanation\n\n"
                f"Schema: {schema}"
            ),
        }, {
            "role": "user",
            "content": query,
        }],
        temperature=0,
    )
    return QueryType(response.content.strip().lower())


async def hybrid_query(
    query: str,
    db,           # SQL database connection
    vector_db,    # Vector database client
    llm,          # LLM client
) -> str:
    """Route query to the right backend based on type."""
    schema = get_schema(db)
    query_type = await classify_query(query, schema)

    if query_type == QueryType.ANALYTICAL:
        # Pure SQL path
        sql = await nl_to_sql(query, schema)
        results = db.execute(sql)
        return await llm.narrate(query, results)

    elif query_type == QueryType.TEXT_SEARCH:
        # Pure vector search path
        chunks = await vector_db.search(query, top_k=10)
        return await llm.synthesize(query, chunks)

    elif query_type == QueryType.HYBRID:
        # SQL filter → vector search on filtered set
        # Example: "Summarize complaints from premium customers"
        # Step 1: SQL to get customer IDs
        filter_sql = await nl_to_sql(
            f"Get the relevant IDs for: {query}", schema
        )
        filtered_ids = db.execute(filter_sql)

        # Step 2: Vector search with ID filter
        chunks = await vector_db.search(
            query,
            top_k=10,
            filter={"customer_id": {"$in": filtered_ids}},
        )
        return await llm.synthesize(query, chunks)

    elif query_type == QueryType.COMPARISON:
        # SQL for numbers + LLM for narrative
        sql = await nl_to_sql(query, schema)
        data = db.execute(sql)
        return await llm.compare_and_narrate(query, data)
```

### The Decision Table: SQL vs Embeddings vs Hybrid

| Signal | Use SQL | Use Embeddings | Use Hybrid |
|--------|---------|---------------|------------|
| Query asks for counts, sums, averages | YES | no | — |
| Query asks for exact filters (>, <, =) | YES | no | — |
| Query asks "find similar to..." | no | YES | — |
| Query involves free-text search | no | YES | — |
| Query combines filters + text search | — | — | YES |
| Query needs summarization of text | — | YES | — |
| Query needs numbers + narrative | — | — | YES |
| Data is purely numeric | YES | no | — |
| Data is purely text | no | YES | — |
| Data is mixed (text + numeric) | — | — | YES |

### Excel-Specific Challenges

Excel files have unique challenges beyond CSV:

| Challenge | Problem | Solution |
|-----------|---------|----------|
| **Multiple sheets** | Each sheet may have different data/schema | Process each sheet independently, tag with sheet name |
| **Merged cells** | `openpyxl` reads merged cell value only in the top-left cell | Unmerge and fill values down/right |
| **Formulas** | Cell contains `=SUM(A1:A10)`, not the computed value | Use `data_only=True` to get computed values (requires Excel to have saved them) |
| **Named ranges** | References like `=Revenue2024` | Resolve named ranges to cell references |
| **Charts** | Embedded charts contain data not in cells | Extract chart data series, or use vision LLM |
| **Formatting as data** | Red cells = overdue, bold = important | Capture formatting as metadata |
| **Pivot tables** | Summary tables derived from source data | Extract the source data, not the pivot |
| **Hidden sheets/rows** | Data exists but is not visible | Decide: include hidden data or not? |

```python
# run: pip install openpyxl pandas && python parse_excel.py

import openpyxl
import pandas as pd
from dataclasses import dataclass


@dataclass
class ExcelSheet:
    name: str
    headers: list[str]
    row_count: int
    data_types: dict[str, str]
    sample_rows: list[dict]
    has_merged_cells: bool
    has_formulas: bool


def analyze_excel(file_path: str) -> list[ExcelSheet]:
    """Analyze an Excel file to determine processing strategy."""
    wb = openpyxl.load_workbook(file_path, data_only=True)
    sheets = []

    for sheet_name in wb.sheetnames:
        ws = wb[sheet_name]

        if ws.max_row is None or ws.max_row < 2:
            continue  # Skip empty sheets

        # Detect headers (first row)
        headers = []
        for cell in ws[1]:
            headers.append(str(cell.value) if cell.value else f"col_{cell.column}")

        # Check for merged cells
        has_merged = len(ws.merged_cells.ranges) > 0

        # Check for formulas (load without data_only to see formulas)
        wb_formulas = openpyxl.load_workbook(file_path, data_only=False)
        ws_formulas = wb_formulas[sheet_name]
        has_formulas = any(
            str(cell.value).startswith("=")
            for row in ws_formulas.iter_rows(min_row=2, max_row=min(10, ws.max_row))
            for cell in row
            if cell.value
        )

        # Sample rows
        df = pd.read_excel(file_path, sheet_name=sheet_name, nrows=5)
        sample_rows = df.to_dict("records")

        # Detect data types
        data_types = {}
        for col in df.columns:
            dtype = str(df[col].dtype)
            if "int" in dtype or "float" in dtype:
                data_types[col] = "numeric"
            elif "datetime" in dtype:
                data_types[col] = "datetime"
            else:
                # Check if text column has long values (likely prose)
                avg_len = df[col].astype(str).str.len().mean()
                data_types[col] = "text_long" if avg_len > 100 else "text_short"

        sheets.append(ExcelSheet(
            name=sheet_name,
            headers=headers,
            row_count=ws.max_row - 1,  # Exclude header
            data_types=data_types,
            sample_rows=sample_rows,
            has_merged_cells=has_merged,
            has_formulas=has_formulas,
        ))

    wb.close()
    return sheets


def route_excel_sheet(sheet: ExcelSheet) -> str:
    """Determine the best RAG strategy for a sheet."""
    text_cols = [c for c, t in sheet.data_types.items() if t.startswith("text_long")]
    numeric_cols = [c for c, t in sheet.data_types.items() if t == "numeric"]

    if not text_cols and numeric_cols:
        return "sql_only"  # Pure structured data → NL-to-SQL
    elif text_cols and not numeric_cols:
        return "embed_only"  # Pure text data → embed and search
    elif text_cols and numeric_cols:
        return "hybrid"  # Mixed → SQL for filters, embed for text search
    else:
        return "sql_only"  # Default to SQL for short text + no long text


# Example output:
# Sheet "Employees": sql_only (all numeric/short text)
# Sheet "Feedback": hybrid (has long text feedback + numeric ratings)
# Sheet "Policies": embed_only (pure long-form text)
```

### Tools Comparison for Structured Data

| Tool | Best For | Limitations |
|------|---------|------------|
| **pandas** | Quick analysis, prototyping, small-medium datasets | Memory-bound (loads entire file), not persistent |
| **SQLite** | Local analysis, up to ~1GB | Single-user, no concurrent writes |
| **PostgreSQL** | Production, multi-user, large datasets | Requires server setup |
| **DuckDB** | Analytical queries on CSV/Parquet, fast aggregations | Not a full transactional DB |
| **SQLAlchemy** | Python ORM, schema management, NL-to-SQL | Abstraction overhead |
| **LangChain SQL Agent** | Turnkey NL-to-SQL with retries | Opinionated, hard to customize |

### Complete Architecture: CSV in a RAG System

```
CSV Upload Flow:

  1. Upload CSV → S3
  2. Worker detects format → CSV handler
  3. Schema analysis:
     ├─ Detect column types (numeric, text, date)
     ├─ Identify text columns worth embedding
     └─ Determine strategy (SQL, embed, hybrid)
  4. Load into SQL database (PostgreSQL/SQLite)
  5. If text columns exist:
     ├─ Extract text + metadata per row
     ├─ Embed text columns
     └─ Store in vector DB with row_id as metadata
  6. Index ready for queries

Query Flow:

  1. Receive query
  2. Classify query type (analytical, text_search, hybrid)
  3. Route to appropriate backend:
     ├─ Analytical → NL-to-SQL → execute → LLM narrate
     ├─ Text search → vector search → LLM synthesize
     └─ Hybrid → SQL filter → vector search on filtered set → LLM
  4. Return answer with source attribution
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. The "average salary" failure.**
Team builds RAG over an HR CSV with 10,000 rows. User asks "What is the average salary?" The retriever returns 5 chunks out of 20. The LLM averages the salaries in those 5 chunks and gets $87,400. The actual average across all 10,000 rows is $94,200. The answer is confidently wrong by 7%. Symptom: numerical answers that are close but wrong, because the retriever cannot surface all rows. Fix: route analytical queries to SQL.

**2. Headers lost after first chunk.**
CSV is chunked at 500 tokens. Only Chunk 1 has the header row. Chunks 2-50 are raw numbers without column names. A query like "show marketing salaries" retrieves chunks that contain the number 82000 but without context to know it is a salary for a marketing employee. Symptom: chunks with numbers but no meaning, leading to confused or fabricated LLM answers. Fix: do not chunk CSVs. Load into a database and use SQL.

**3. Excel merged cell disaster.**
A financial report has merged header cells spanning three columns. `openpyxl` reads the merged value only in the top-left cell. The other cells read as `None`. The result: column headers are wrong, data is misaligned. Symptom: nonsensical data after parsing. Fix: unmerge cells and fill the value into all cells in the merged range before reading data.

:::

## 🎯 Checkpoint

::: details Question 1 — Query routing
**Q:** You have a customer database CSV with columns: `customer_id`, `name`, `email`, `lifetime_value`, `signup_date`, `last_purchase_date`, `support_tickets`, `feedback_text`. A user asks: "Which customers signed up in 2024, have lifetime value over $1000, and have negative feedback?" Design the query pipeline.

**A:** This is a **hybrid** query — it combines structured filters (signup date, lifetime value) with text search (negative feedback). Pipeline: (1) **SQL filter** — query the database: `SELECT customer_id FROM customers WHERE signup_date >= '2024-01-01' AND lifetime_value > 1000`. This returns a set of customer IDs. (2) **Vector search with filter** — search the vector DB (where `feedback_text` was embedded) with query "negative feedback" or "complaints" or "dissatisfied", filtered to only the customer IDs from step 1: `filter={"customer_id": {"$in": filtered_ids}}`. (3) **LLM synthesis** — send the retrieved feedback chunks to the LLM with the original question to generate a summary. The key insight: the structured filters (date, value) happen in SQL where they are exact. The semantic search (negative feedback) happens in the vector DB where it is approximate but handles natural language. Neither tool alone could answer this question correctly.
:::

::: details Question 2 — Architecture decision
**Q:** A team is debating whether to use NL-to-SQL or RAG for a product catalog with 50,000 items. Each item has: `name`, `price`, `category`, `description` (200 words avg), `specifications` (key-value pairs), and `reviews` (free text, avg 5 per product). What is your recommendation?

**A:** **Hybrid architecture.** (1) Load all structured fields (`name`, `price`, `category`, `specifications`) into PostgreSQL. This handles: "cheapest laptop under $1000," "all products in category X," "compare specs of product A and B." (2) Embed `description` and `reviews` text into a vector DB with `product_id` as metadata. This handles: "gaming laptop with good battery life" (semantic match on descriptions), "products with complaints about overheating" (semantic search on reviews). (3) Query router classifies incoming queries: analytical (SQL), semantic (vector), or hybrid (SQL filter + vector search). With 50K items x 5 reviews = 250K review chunks + 50K description chunks = 300K vectors, this is a medium-scale index that any managed vector DB handles easily. Cost: PostgreSQL hosting ~$50/month, vector DB ~$100/month, embedding the 300K chunks ~$5 one-time. The alternative (pure RAG on everything) fails on "cheapest laptop under $1000" because embeddings cannot do price comparisons. The alternative (pure SQL) fails on "laptop with good battery life" because SQL cannot do semantic search on free-text descriptions.
:::

::: details Question 3 — Excel challenge
**Q:** An Excel file has 5 sheets: "Revenue" (monthly figures), "Expenses" (categorized costs), "Employees" (names, departments, salaries), "Meeting Notes" (dates + long-form text), and "Dashboard" (charts and pivot tables). How do you ingest this for a RAG system?

**A:** Process each sheet with the appropriate strategy: (1) **Revenue, Expenses, Employees** → load into PostgreSQL (three tables). These are structured, relational data. NL-to-SQL handles "total revenue in Q3," "top expense categories," "average salary by department." (2) **Meeting Notes** → hybrid: load into PostgreSQL (for date filtering) AND embed the long-form text column into the vector DB with `date` and `meeting_id` as metadata. This handles both "meetings in January" (SQL date filter) and "discussions about product launch" (semantic search on notes). (3) **Dashboard** → skip the pivot tables (they are derived from the other sheets). For charts: either extract the underlying data series (which should already be in Revenue/Expenses tables) or use a vision LLM to generate chart descriptions that can be embedded. Do NOT try to extract data from chart images — extract from the source data instead.
:::

## Key Mental Models

- **Structured data is not text.** CSVs encode relationships (this value belongs to this column in this row). Embeddings see text, not relationships. Treat tabular data as tabular data — use SQL.
- **Route by query type, not data type.** The same CSV might receive analytical queries (SQL), semantic queries (embeddings on text columns), and hybrid queries (both). Build a router, not a single pipeline.
- **Embed text columns, filter on structured columns.** In a table with both, put text into the vector DB and structured fields into metadata filters. Never embed numbers you intend to do math on.
- **Headers are meaning.** Without column headers, "95000" is meaningless. Never chunk a CSV in a way that separates data from its headers.
- **Load into a database first.** Even if you plan to embed text columns, load the entire CSV into PostgreSQL or SQLite first. This gives you SQL access for free and makes hybrid queries possible.

## Related

- [RAG vs Alternatives](../module-01/02-rag-vs-alternatives.md) — the broader RAG vs SQL decision
- [Parsing Every Format](01-parsing-formats.md) — format-specific parsing that precedes this page's concerns
- [Designing Before Building](../module-02/01-requirements.md) — query type analysis during requirements gathering
