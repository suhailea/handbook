---
title: Parsing Every Format
outline: deep
---

# Parsing Every Format

**Interview weight:** 🔥🔥 | **Prerequisites:** [Ingestion Pipelines](../module-03/01-ingestion-pipelines.md) | **Builds toward:** [CSV, Excel & Structured Data](02-csv-excel.md), Chunking Strategies (Module 5)

## 🗣️ In Plain English

::: tip In Plain English
Every document format is a different kind of packaging. Some are easy to unwrap (plain text), some are nested boxes (HTML), and some are sealed containers with the contents glued to the walls (scanned PDFs). The parser's job is to get the actual content out cleanly, regardless of packaging.
:::

## ⚙️ Under the Hood

### The Comprehensive Format Table

| Format | Extraction Strategy | Best Tools | Structure Preservation | Metadata Available | Common Problems | RAG Strategy |
|--------|-------------------|------------|----------------------|-------------------|-----------------|-------------|
| **PDF (digital)** | Text extraction from PDF objects | PyMuPDF (fitz), pdfplumber, PyPDF2 | Medium — loses some layout | Title, author, dates, page numbers | Multi-column, headers/footers, ligatures | Chunk by section/page, preserve headers |
| **PDF (scanned)** | OCR → text | Tesseract, AWS Textract, Google Vision | Low — depends on scan quality | Minimal (file metadata only) | Poor scan quality, handwriting, stamps | OCR → clean → chunk; consider vision LLM |
| **PDF (tables)** | Table-specific extraction | pdfplumber, Camelot, Tabula, AWS Textract | High with right tools | Column headers, row structure | Merged cells, spanning columns, nested tables | Preserve table as Markdown/CSV, do not flatten |
| **HTML** | DOM parsing + content extraction | BeautifulSoup, trafilatura, readability-lxml | High — HTML has structure | Title, meta tags, headings, links | Boilerplate (nav, ads, footers), JS-rendered content | Extract main content only, preserve heading hierarchy |
| **Markdown** | Direct parsing | Python-Markdown, mistune | Very high — already structured | Headings, links, metadata (frontmatter) | Embedded HTML, non-standard extensions | Chunk by heading hierarchy |
| **Plain text (.txt)** | Read as-is | Built-in file I/O | None — no inherent structure | File name, modification date | Encoding issues (UTF-8 vs Latin-1), line endings | Chunk by paragraph or fixed-size |
| **DOCX** | XML extraction from zip | python-docx, mammoth | High — preserves styles/headings | Author, title, dates, comments | Embedded images, text boxes, tracked changes | Extract text + styles, chunk by heading |
| **CSV** | Structured parsing | pandas, csv module | Tabular — rows and columns | Column headers, data types | Encoding, delimiters, quoting, missing values | **Do NOT chunk into text** — use SQL or hybrid |
| **Excel (.xlsx)** | Structured parsing | openpyxl, pandas | Tabular + multi-sheet | Sheet names, cell formatting, formulas | Multiple sheets, merged cells, formulas, charts | Per-sheet extraction, preserve structure |
| **JSON** | Structured parsing | json module, jq | Hierarchical | Keys as schema | Deeply nested, large files, arrays | Flatten or extract by path, embed text fields |
| **XML** | DOM/SAX parsing | lxml, xml.etree | Hierarchical | Tags, attributes, namespaces | Complex schemas, namespaces, entity references | Extract text content, preserve hierarchy |
| **Images** | OCR or vision LLM | Tesseract, GPT-4o, Claude | Depends on image content | EXIF data | Complex layouts, diagrams, handwriting | Vision LLM for description, OCR for text |
| **Scanned docs** | OCR pipeline | AWS Textract, Google Vision, Tesseract + pre-processing | Low-Medium | Minimal | Noise, skew, varied quality | Pre-process (deskew, denoise) → OCR → validate |
| **Audio** | Speech-to-text | OpenAI Whisper, Google STT, AWS Transcribe | None (transcription) | Duration, speaker (with diarization) | Accents, background noise, technical terms | Transcribe → chunk by speaker turn or timestamp |
| **Video** | Extract audio → STT; extract frames → vision | Whisper + GPT-4o/Claude | Medium (transcript + key frames) | Duration, chapters, timestamps | Long duration, multiple speakers, visual content | Transcript chunks by segment + key frame descriptions |
| **Code** | Language-aware parsing | tree-sitter, AST parsers | Very high — syntax tree | Functions, classes, imports, comments | Multiple languages, dependencies, dynamic features | Chunk by function/class, include docstrings |

### PDF Extraction Deep Dive

PDFs are the most common and most problematic format. The same PDF can contain text, tables, images, multi-column layouts, headers, footers, and page numbers — all of which must be handled differently.

```python
# run: pip install pymupdf pdfplumber && python parse_pdf.py

import fitz  # PyMuPDF
import pdfplumber
from dataclasses import dataclass


@dataclass
class ParsedPage:
    page_number: int
    text: str
    tables: list[list[list[str]]]  # list of tables, each table is rows of cells
    images: list[dict]              # image metadata


def extract_with_pymupdf(pdf_path: str) -> list[ParsedPage]:
    """Fast text extraction with PyMuPDF.

    Best for: clean, single-column PDFs with no complex tables.
    PyMuPDF is 10-100x faster than pdfplumber but worse at tables.
    """
    doc = fitz.open(pdf_path)
    pages = []

    for page_num, page in enumerate(doc):
        text = page.get_text("text")

        # Remove headers/footers (common pattern: first/last lines repeat)
        lines = text.split("\n")
        # Simple heuristic: if a line appears on >50% of pages, it's a header/footer
        # In production, use a more sophisticated approach

        images = []
        for img_info in page.get_images():
            images.append({
                "xref": img_info[0],
                "width": img_info[2],
                "height": img_info[3],
            })

        pages.append(ParsedPage(
            page_number=page_num + 1,
            text=text.strip(),
            tables=[],
            images=images,
        ))

    doc.close()
    return pages


def extract_tables_with_pdfplumber(pdf_path: str) -> list[ParsedPage]:
    """Table-aware extraction with pdfplumber.

    Best for: PDFs with tables, forms, structured layouts.
    Slower than PyMuPDF but much better at table detection.
    """
    pages = []

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            # Extract tables
            tables = page.extract_tables() or []

            # Extract text (excluding table regions for cleaner output)
            # This avoids double-counting text that's in tables
            text = page.extract_text() or ""

            pages.append(ParsedPage(
                page_number=page_num + 1,
                text=text.strip(),
                tables=tables,
                images=[],
            ))

    return pages


def format_table_as_markdown(table: list[list[str]]) -> str:
    """Convert a parsed table to Markdown format.

    Preserving table structure in Markdown keeps the semantic
    relationships between headers and values intact for the LLM.
    """
    if not table or not table[0]:
        return ""

    # First row as headers
    headers = [str(cell or "").strip() for cell in table[0]]
    md = "| " + " | ".join(headers) + " |\n"
    md += "| " + " | ".join(["---"] * len(headers)) + " |\n"

    # Data rows
    for row in table[1:]:
        cells = [str(cell or "").strip() for cell in row]
        # Pad if row has fewer cells than headers
        while len(cells) < len(headers):
            cells.append("")
        md += "| " + " | ".join(cells) + " |\n"

    return md
```

**Choosing a PDF parser:**

```
Is the PDF scanned (images of text)?
├─ YES → OCR pipeline (Textract/Tesseract) + vision LLM for complex layouts
└─ NO → Does it contain important tables?
         ├─ YES → pdfplumber or Camelot for tables + PyMuPDF for text
         └─ NO → PyMuPDF (fastest, good enough for text-only PDFs)

For enterprise / complex PDFs (mixed layouts, multi-column, forms):
  → Consider LlamaParse or Unstructured.io (higher quality, higher cost)
```

### HTML Extraction

The challenge with HTML is separating content from chrome (navigation, ads, footers, sidebars).

```python
# run: pip install trafilatura beautifulsoup4 && python parse_html.py

import trafilatura
from bs4 import BeautifulSoup


def extract_main_content(html: str) -> dict[str, str]:
    """Extract main content from HTML, removing boilerplate.

    trafilatura uses heuristics + ML to identify the main
    content area, similar to Firefox's Reader View.
    """
    # trafilatura: best for web articles, blog posts, news
    main_text = trafilatura.extract(
        html,
        include_tables=True,
        include_links=True,
        include_comments=False,
        output_format="txt",
    )

    # Also extract metadata
    metadata = trafilatura.extract_metadata(html)

    return {
        "text": main_text or "",
        "title": metadata.title if metadata else "",
        "author": metadata.author if metadata else "",
        "date": metadata.date if metadata else "",
    }


def extract_with_structure(html: str) -> list[dict[str, str]]:
    """Extract content preserving heading hierarchy.

    Useful when you want to chunk by section later.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Remove noise elements
    for tag in soup.find_all(["nav", "footer", "header", "aside", "script", "style"]):
        tag.decompose()

    sections = []
    current_section = {"heading": "", "level": 0, "content": ""}

    for element in soup.find_all(["h1", "h2", "h3", "h4", "p", "li", "table", "pre"]):
        if element.name in ("h1", "h2", "h3", "h4"):
            # Save previous section
            if current_section["content"].strip():
                sections.append(current_section.copy())

            level = int(element.name[1])
            current_section = {
                "heading": element.get_text(strip=True),
                "level": level,
                "content": "",
            }
        else:
            text = element.get_text(strip=True)
            if text:
                current_section["content"] += text + "\n"

    # Don't forget the last section
    if current_section["content"].strip():
        sections.append(current_section)

    return sections
```

### Image and Scanned Document Extraction

```python
# run: pip install pytesseract Pillow && python parse_images.py
# Requires: tesseract-ocr installed on system

from pathlib import Path

# Option 1: Traditional OCR (fast, free, good for clean scans)
import pytesseract
from PIL import Image


def ocr_extract(image_path: str) -> str:
    """Extract text from image using Tesseract OCR."""
    image = Image.open(image_path)

    # Pre-processing improves OCR accuracy
    # Convert to grayscale
    image = image.convert("L")

    text = pytesseract.image_to_string(
        image,
        lang="eng",
        config="--psm 6",  # Assume uniform block of text
    )
    return text.strip()


# Option 2: Vision LLM (slower, costs money, but handles complex layouts)
from openai import OpenAI
import base64


def vision_llm_extract(image_path: str) -> str:
    """Extract text and describe content using vision LLM.

    Best for: complex layouts, diagrams, charts, handwriting.
    GPT-4o and Claude can understand layout and context.
    """
    client = OpenAI()

    with open(image_path, "rb") as f:
        image_data = base64.b64encode(f.read()).decode()

    ext = Path(image_path).suffix.lstrip(".")
    mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"

    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "Extract ALL text from this image. "
                        "Preserve the structure (headings, lists, tables). "
                        "If there are diagrams or charts, describe them. "
                        "Output in Markdown format."
                    ),
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:{mime};base64,{image_data}",
                    },
                },
            ],
        }],
        max_tokens=4096,
    )

    return response.choices[0].message.content or ""
```

### Audio Extraction

```python
# run: pip install openai && python parse_audio.py

from openai import OpenAI
from dataclasses import dataclass


@dataclass
class TranscriptSegment:
    text: str
    start_time: float
    end_time: float
    speaker: str | None = None


def transcribe_audio(audio_path: str) -> list[TranscriptSegment]:
    """Transcribe audio using OpenAI Whisper API.

    For long audio (>25MB), split into segments first.
    """
    client = OpenAI()

    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
            timestamp_granularities=["segment"],
        )

    segments = []
    for seg in response.segments:
        segments.append(TranscriptSegment(
            text=seg["text"].strip(),
            start_time=seg["start"],
            end_time=seg["end"],
        ))

    return segments


def chunk_transcript(
    segments: list[TranscriptSegment],
    max_duration_seconds: float = 120.0,
) -> list[str]:
    """Chunk transcript by time windows.

    Groups segments into ~2-minute chunks for embedding.
    """
    chunks = []
    current_chunk_text = ""
    chunk_start = 0.0

    for seg in segments:
        if seg.start_time - chunk_start > max_duration_seconds and current_chunk_text:
            chunks.append(current_chunk_text.strip())
            current_chunk_text = ""
            chunk_start = seg.start_time

        current_chunk_text += " " + seg.text

    if current_chunk_text.strip():
        chunks.append(current_chunk_text.strip())

    return chunks
```

### Code Extraction

```python
# run: pip install tree-sitter tree-sitter-python && python parse_code.py

import ast
from dataclasses import dataclass


@dataclass
class CodeUnit:
    name: str
    type: str  # "function", "class", "method"
    code: str
    docstring: str | None
    line_start: int
    line_end: int


def extract_python_units(source_code: str) -> list[CodeUnit]:
    """Extract functions and classes from Python source code.

    For RAG, chunking by function/class is much better than
    fixed-size text chunking because it preserves semantic units.
    """
    tree = ast.parse(source_code)
    units = []
    lines = source_code.split("\n")

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            unit_type = "class" if isinstance(node, ast.ClassDef) else "function"
            code_lines = lines[node.lineno - 1 : node.end_lineno]

            units.append(CodeUnit(
                name=node.name,
                type=unit_type,
                code="\n".join(code_lines),
                docstring=ast.get_docstring(node),
                line_start=node.lineno,
                line_end=node.end_lineno or node.lineno,
            ))

    return units


# For embedding code: include both the code and its docstring
# The docstring provides semantic meaning that helps with natural
# language queries like "function that calculates tax"
def code_unit_to_embedding_text(unit: CodeUnit) -> str:
    """Create an embedding-friendly text representation."""
    parts = [f"{unit.type}: {unit.name}"]
    if unit.docstring:
        parts.append(f"Description: {unit.docstring}")
    parts.append(f"Code:\n{unit.code}")
    return "\n".join(parts)
```

### Universal Parser Pattern

In production, you need a router that selects the right parser based on file type:

```python
# run: python universal_parser.py

from pathlib import Path
from dataclasses import dataclass


@dataclass
class ParsedDocument:
    text: str
    metadata: dict
    tables: list[str]       # tables as Markdown
    images: list[dict]      # image descriptions
    format: str


class DocumentParser:
    """Universal parser that routes to format-specific extractors."""

    PARSERS = {
        ".pdf": "parse_pdf",
        ".html": "parse_html",
        ".htm": "parse_html",
        ".md": "parse_markdown",
        ".txt": "parse_text",
        ".docx": "parse_docx",
        ".csv": "parse_csv",
        ".xlsx": "parse_excel",
        ".json": "parse_json",
        ".py": "parse_code",
        ".js": "parse_code",
        ".ts": "parse_code",
        ".png": "parse_image",
        ".jpg": "parse_image",
        ".jpeg": "parse_image",
        ".mp3": "parse_audio",
        ".wav": "parse_audio",
        ".mp4": "parse_video",
    }

    def parse(self, file_path: str) -> ParsedDocument:
        """Route to the correct parser based on file extension."""
        ext = Path(file_path).suffix.lower()
        parser_name = self.PARSERS.get(ext)

        if not parser_name:
            raise ValueError(f"Unsupported format: {ext}")

        parser_method = getattr(self, parser_name)
        return parser_method(file_path)

    def parse_pdf(self, path: str) -> ParsedDocument:
        """PDF parsing with table detection."""
        # Use PyMuPDF for text, pdfplumber for tables
        # (implementation from examples above)
        ...

    def parse_html(self, path: str) -> ParsedDocument:
        """HTML parsing with boilerplate removal."""
        ...

    # ... etc for each format
```

### Structure Preservation: Why It Matters

```
WRONG: Flatten a table into text
  "Name John Age 32 Salary 85000 Name Jane Age 28 Salary 92000"
  → Embedding captures some words but loses ALL relationships
  → Query "Who earns more?" cannot be answered from this text

RIGHT: Preserve table as Markdown
  | Name | Age | Salary |
  |------|-----|--------|
  | John | 32  | 85,000 |
  | Jane | 28  | 92,000 |
  → LLM can reason about rows and columns
  → Query "Who earns more?" → Jane ($92,000)

WRONG: Strip headings from HTML
  "Deploy the application. Run npm install. Then npm start."
  → Lost context: this was under "Production Deployment > Quick Start"
  → Query about "testing" might retrieve this chunk incorrectly

RIGHT: Preserve heading hierarchy
  "## Production Deployment\n### Quick Start\nDeploy the application..."
  → Heading provides context for the content below it
  → Better retrieval precision
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**1. PDF table extraction silently fails.**
A financial report has tables with revenue figures. PyMuPDF extracts the text but scrambles the columns — "Revenue $5.2M" becomes "Revenue $5" and ".2M" on the next line. The RAG system confidently reports wrong numbers. Symptom: numerically incorrect answers from PDF-sourced data. Fix: use pdfplumber or Camelot for table extraction, validate extracted tables against expected column counts, and preserve tables as Markdown.

**2. HTML boilerplate poisons retrieval.**
Every page on the company wiki has a navigation sidebar with links to "Home | About | Contact | FAQ." These words appear in every chunk. When a user asks "How do I contact support?", the retriever returns 20 chunks that all contain nav-bar text, not the actual contact page. Symptom: irrelevant chunks that all look slightly relevant. Fix: use trafilatura or readability to extract main content only, strip nav/header/footer/aside elements.

**3. Encoding errors create invisible garbage.**
A batch of documents uses Latin-1 encoding but the parser assumes UTF-8. Non-ASCII characters (accents, em dashes, smart quotes) become replacement characters or garbage. Embeddings of garbage text produce meaningless vectors. Symptom: documents that exist in the index but are never retrieved (because the mangled text does not match any query semantically). Fix: detect encoding with chardet/charset-normalizer before parsing, validate output text.

**4. Scanned PDFs treated as digital PDFs.**
The parser calls PyMuPDF on a scanned PDF. PyMuPDF finds no text objects (the PDF contains only images). It returns an empty string. The empty chunk is embedded and indexed. Symptom: some PDFs return no results despite being in the corpus. Fix: detect scanned PDFs (if extracted text length is suspiciously short relative to page count, assume scanned), fall back to OCR pipeline.

:::

## 🎯 Checkpoint

::: details Question 1 — Parser selection
**Q:** You receive a 200-page PDF that contains a mix of narrative text (70%), financial tables (20%), and embedded charts/graphs (10%). Describe your parsing pipeline, including which tools handle which components.

**A:** Three-pass pipeline: (1) **Text extraction with PyMuPDF** — fast extraction of narrative text, using page.get_text("blocks") to get text blocks with position information for layout awareness. Remove headers/footers by detecting repeated lines across pages. (2) **Table extraction with pdfplumber** — run pdfplumber.page.extract_tables() on each page. pdfplumber uses line detection to identify table boundaries. Convert each table to Markdown format to preserve structure. Merge with the narrative text at the correct position (using page number and vertical position). (3) **Chart/graph extraction with a vision LLM** — extract images from the PDF with PyMuPDF (page.get_images()), filter to those above a size threshold (likely charts, not icons), send each to GPT-4o or Claude with a prompt like "Describe this chart: what data does it show, what are the key trends?" Insert the description at the correct position. The final output: a structured document where narrative text, table Markdown, and chart descriptions are in reading order, preserving the semantic flow of the document.
:::

::: details Question 2 — Structure preservation
**Q:** Why is it wrong to flatten a table into a single paragraph of text for embedding? Give a specific example where this causes a retrieval failure.

**A:** Flattening destroys the row-column relationships that give tabular data meaning. Example: a table comparing three cloud providers on cost, performance, and reliability. Flattened: "AWS $0.10 99.99% 50ms Azure $0.12 99.95% 45ms GCP $0.11 99.97% 48ms". Query: "Which provider has the best reliability?" The embedding of the flattened text captures all three provider names and all three percentages, but cannot associate "99.99%" with "AWS". The LLM receiving this chunk must guess which number belongs to which provider. In contrast, the Markdown table preserves these associations. The LLM can read the table and correctly answer "AWS at 99.99%." This is why tables should be preserved in a structured format (Markdown, CSV) and optionally embedded alongside a natural-language summary like "Comparison of AWS, Azure, and GCP on cost, performance, and reliability."
:::

## Key Mental Models

- **Structure is information.** When you strip headings, flatten tables, or lose formatting, you are deleting data — not just decoration. Preserve the structure that carries meaning.
- **Route by format, not one-size-fits-all.** A universal "convert to text" function hides format-specific problems. Each format needs a dedicated parser that understands its structure.
- **Tables are not text.** Tables encode relationships (this column belongs to that header). Flattening them into text destroys these relationships. Preserve as Markdown or route to SQL.
- **Detect scanned vs digital PDFs.** The same .pdf extension can mean "structured text objects" or "images of text." Your pipeline must detect which and route accordingly.
- **Extraction quality is measurable.** Compare extracted text against the original document. If information is lost, the parser is wrong — do not accept "close enough."

## Related

- [CSV, Excel & Structured Data](02-csv-excel.md) — deep dive on why structured data needs a completely different approach
- [Ingestion Pipelines](../module-03/01-ingestion-pipelines.md) — where parsing fits in the overall pipeline
- [Reliability & Monitoring](../module-03/02-reliability.md) — handling parse failures with DLQs and monitoring
