---
title: "Case Study: CSV/Excel Analytics Assistant"
outline: deep
---

# Case Study 9 — CSV/Excel Analytics Assistant

**Scenario:** Business analysts want to ask natural-language questions about data in CSV and Excel files: "What were our top 10 customers by revenue last quarter?" or "Show me the month-over-month growth rate for the EMEA region."

**Requirements:**
- Input: CSV/Excel files uploaded by users.
- Queries are analytical (aggregations, filters, joins) not document-search.
- Results should include tables, charts, and explanations.
- Data can be large (millions of rows).

**Why RAG Is Wrong Here:**

This is the second case study where naive RAG is the wrong approach. Consider what happens if you chunk a CSV file and embed it:
- Row 47 gets embedded as "Acme Corp, 2024-Q3, $1,247,000, EMEA". The embedding captures semantic similarity but not the mathematical structure.
- "What were our top 10 customers by revenue?" requires a `GROUP BY customer ORDER BY SUM(revenue) DESC LIMIT 10` — an operation that embedding similarity search cannot perform.
- Chunking a spreadsheet destroys the tabular structure. Row 47 in one chunk has no connection to the column headers in another chunk.

**The Correct Approach: NL-to-SQL (Text-to-SQL):**

```text
┌──────────┐    ┌──────────────┐    ┌──────────────────────────────┐
│ Analyst  │───▶│  File Upload │───▶│  Analytics Orchestrator      │
│          │    │  + Schema    │    │  ┌──────────────────────┐    │
│          │    │  Extraction  │    │  │ NL-to-SQL Generator  │    │
└──────────┘    └──────────────┘    │  │ (LLM + schema context)   │
                                    │  └──────────┬───────────┘    │
                                    └─────────────┼────────────────┘
                                                  │
                                    ┌─────────────┼───────────────┐
                                    ▼             ▼               ▼
                          ┌──────────────┐ ┌────────────┐ ┌────────────┐
                          │  DuckDB /    │ │ Result     │ │ Chart      │
                          │  SQLite      │ │ Formatter  │ │ Generator  │
                          │  (query      │ │ (LLM)      │ │ (matplotlib│
                          │   engine)    │ │            │ │  / plotly) │
                          └──────────────┘ └────────────┘ └────────────┘
```

**Data Flow:**
1. Analyst uploads a CSV/Excel file.
2. System loads the file into DuckDB (an in-process analytical database).
3. Schema extraction: column names, types, sample values, and basic statistics (min, max, unique count) are extracted and formatted as context.
4. User asks: "What were our top 10 customers by revenue last quarter?"
5. LLM receives: the schema context, the user's question, and instructions to generate a SQL query.
6. LLM generates: `SELECT customer, SUM(revenue) as total_revenue FROM sales WHERE quarter = 'Q3-2024' GROUP BY customer ORDER BY total_revenue DESC LIMIT 10`.
7. SQL is executed against DuckDB; results returned as a table.
8. LLM generates a natural-language summary of the results + optionally a chart.

**Where RAG Does Help (Hybrid):**
- RAG over the schema: if the user asks "What does the 'ARR' column mean?", RAG can retrieve the data dictionary or column descriptions.
- RAG over previous analyses: if analysts have written reports about this data, RAG can retrieve relevant context.
- But the core analytical capability is NL-to-SQL, not retrieval-augmented generation.

**Security:**
- SQL injection prevention: the generated SQL runs in a sandboxed DuckDB instance with read-only access.
- Row-level security: if the CSV contains sensitive data, access is controlled at the upload level.
- File size limits: max 500MB per upload to prevent resource exhaustion.
- Query timeout: 30 seconds max execution time.

**Generation:**
- Two-step generation: first generate SQL (validated and executed), then generate the explanation/summary from the query results.
- If the generated SQL fails, the LLM receives the error message and retries (up to 3 attempts).
- Self-correction: the LLM checks if the SQL makes sense given the schema before execution.

**Evaluation:**
- SQL correctness: does the generated SQL produce the right answer? (Evaluated against a test suite of question-SQL pairs.)
- Execution success rate: percentage of generated SQL queries that execute without errors.
- Answer accuracy: does the natural-language summary correctly reflect the query results?

**Key Trade-offs:**
- NL-to-SQL is fragile: ambiguous column names, inconsistent data formats, and complex queries (multi-table joins, window functions) have high failure rates.
- DuckDB is fast for analytics but doesn't scale to truly large datasets (>10GB) — for those, connect to a data warehouse (BigQuery, Snowflake).
- Showing the generated SQL to the analyst builds trust (they can verify it) but adds complexity to the UI.
- **The lesson: know your data shape. Tabular data needs SQL, not embeddings. Use the right tool for the job.**
