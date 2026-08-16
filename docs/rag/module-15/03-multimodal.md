---
title: Multimodal RAG
outline: deep
---

# Multimodal RAG

Interview weight: 🔥🔥 | Prerequisites: [Embeddings](/rag/module-07/), [Retrieval fundamentals](/rag/module-09/)

## 🗣️ In Plain English

::: tip In Plain English
Standard RAG only understands text. But real documents contain images, tables, charts, and diagrams -- and sometimes the answer is in a screenshot, not a paragraph. Multimodal RAG extends the pipeline to index and retrieve non-text content, either by converting it to text first (describe-then-embed) or by using models that understand multiple formats natively (multimodal embeddings).
:::

## ⚙️ Under the Hood

### The Multimodal Challenge

Production documents are rarely pure text:

| Content Type | Example | Challenge |
|-------------|---------|-----------|
| Images | Architecture diagrams, product photos | Cannot be embedded as text |
| Tables | Financial data, comparison matrices | Flattening loses structure |
| Charts | Revenue graphs, performance plots | Information is visual, not textual |
| Scanned PDFs | Legacy documents, signed contracts | Need OCR before text extraction |
| Audio | Meeting recordings, support calls | Need transcription |
| Video | Training materials, product demos | Multiple modalities combined |

---

### Strategy 1: Describe-Then-Embed

Convert non-text content to text descriptions using a vision LLM, then embed the text normally. This is the most practical approach for most teams.

```typescript
// run: npx tsx describe-then-embed.ts

// Image → text description → text embedding
async function processImage(
  imagePath: string,
  visionLLM: LLMClient,
): Promise<{ text: string; embedding: number[] }> {
  // Step 1: Describe the image with a vision model
  const description = await visionLLM.complete({
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'file', path: imagePath },
          },
          {
            type: 'text',
            text: `Describe this image in detail for a knowledge base.
Include:
- What the image shows (diagram, photo, chart, etc.)
- All text visible in the image
- Key data points if it's a chart or table
- Relationships shown if it's a diagram
- Any labels, legends, or annotations

Be thorough — this description will be used for search and retrieval.`,
          },
        ],
      },
    ],
    maxTokens: 1000,
  });

  // Step 2: Embed the description as regular text
  const embedding = await embedText(description);

  return { text: description, embedding };
}

// Table → structured text → text embedding
function processTable(tableData: string[][]): string {
  // Convert table to a structured text format that preserves meaning
  const headers = tableData[0];
  const rows = tableData.slice(1);

  let text = `Table with columns: ${headers.join(', ')}\n\n`;
  for (const row of rows) {
    const pairs = headers.map((h, i) => `${h}: ${row[i]}`);
    text += pairs.join(', ') + '\n';
  }

  return text;
}

// Chart → vision LLM description → embedding
async function processChart(
  chartImagePath: string,
  visionLLM: LLMClient,
): Promise<string> {
  return await visionLLM.complete({
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'file', path: chartImagePath },
          },
          {
            type: 'text',
            text: `This is a chart or graph. Extract ALL data from it:
1. Chart type (bar, line, pie, etc.)
2. Title and axis labels
3. ALL data points with their values
4. Key trends or patterns
5. Any annotations or callouts

Format the data as a structured description with actual numbers.`,
          },
        ],
      },
    ],
    maxTokens: 1500,
  });
}
```

**Advantages of describe-then-embed:**
- Uses existing text embedding infrastructure
- Text descriptions are searchable with standard vector search
- Works with any embedding model
- LLM can generate rich, contextual descriptions

**Disadvantages:**
- Description quality depends on the vision model
- Information loss -- visual nuances may not be captured in text
- Extra cost: vision LLM call per image ($0.001-0.01 per image)
- Cannot handle "show me images similar to this one" (visual similarity)

---

### Strategy 2: Multimodal Embeddings

Use models like **CLIP** or **SigLIP** that embed images and text into the **same vector space**. A text query can retrieve images, and an image query can retrieve text.

```typescript
// run: npx tsx multimodal-embeddings.ts

// CLIP-style models embed text and images into the same space
// Text: "a diagram showing microservice architecture"
// Image: [actual architecture diagram]
// Both get embeddings in the same 512/768-dim space
// Cosine similarity between them should be high if they match

interface MultimodalEmbedder {
  embedText(text: string): Promise<number[]>;
  embedImage(imagePath: string): Promise<number[]>;
  // Both return vectors in the SAME space
}

// Index both text chunks and images in one collection
interface MultimodalChunk {
  id: string;
  type: 'text' | 'image';
  content: string;           // text content or image path
  embedding: number[];       // from same model, same space
  metadata: {
    source_document: string;
    page_number?: number;
    modality: 'text' | 'image' | 'table' | 'chart';
  };
}

// Query can be text OR image
async function multimodalSearch(
  query: string | { imagePath: string },
  embedder: MultimodalEmbedder,
  vectorDB: VectorDB,
): Promise<MultimodalChunk[]> {
  const queryEmbedding =
    typeof query === 'string'
      ? await embedder.embedText(query)
      : await embedder.embedImage(query.imagePath);

  return vectorDB.search(queryEmbedding, { topK: 10 });
}
```

**When to use multimodal embeddings vs describe-then-embed:**

| Criterion | Multimodal Embeddings | Describe-Then-Embed |
|-----------|----------------------|---------------------|
| Visual similarity search ("find similar images") | Required | Cannot do |
| Text queries finding images | Good | Good (often better) |
| Accuracy on detailed content | Lower (CLIP has 77-token limit) | Higher (rich descriptions) |
| Cost per image | Low (embedding only) | Higher (vision LLM call) |
| Infrastructure complexity | Separate embedding model | Uses existing text pipeline |
| **Recommendation** | When visual similarity matters | For most RAG use cases |

---

### PDF Image Extraction and OCR Pipeline

PDFs are the most common multimodal document type in enterprise RAG:

```typescript
// run: npx tsx pdf-pipeline.ts

interface PDFProcessingResult {
  pages: Array<{
    pageNumber: number;
    text: string;              // extracted text
    images: Array<{
      imageData: Buffer;
      boundingBox: { x: number; y: number; w: number; h: number };
      description?: string;    // from vision LLM
    }>;
    tables: Array<{
      data: string[][];
      structuredText: string;
    }>;
  }>;
}

// Full PDF processing pipeline:
//
// 1. TEXT EXTRACTION
//    PDF → pdf-parse / pdfjs-dist → raw text per page
//    For scanned PDFs: PDF → image per page → OCR (Tesseract/cloud OCR) → text
//
// 2. IMAGE EXTRACTION
//    PDF → extract embedded images (pdf-lib / pdfjs-dist)
//    Each image → vision LLM → text description
//
// 3. TABLE EXTRACTION
//    PDF → table detection (Camelot/Tabula for Python, or vision LLM)
//    Each table → structured text (row-by-row with headers)
//
// 4. CHUNKING
//    Combine: page text + image descriptions + table text
//    Chunk with awareness of page boundaries
//    Store modality metadata on each chunk

// OCR for scanned documents
// Options ranked by quality:
// 1. Cloud OCR: Google Document AI, AWS Textract, Azure Form Recognizer
//    - Best quality, handles complex layouts, expensive
// 2. Tesseract (open source)
//    - Good for simple layouts, free, lower quality on complex docs
// 3. Vision LLM (GPT-4o, Claude)
//    - Best for mixed content (text + diagrams), expensive per page
```

---

### Audio Processing

```typescript
// run: npx tsx audio-pipeline.ts

// Audio → Transcription → Chunking → Embedding

// Step 1: Transcription (Whisper or cloud API)
interface TranscriptionSegment {
  start: number;      // seconds
  end: number;
  text: string;
  speaker?: string;   // if speaker diarization is used
  confidence: number;
}

// Step 2: Chunking strategies for audio
// Option A: Fixed time windows (every 60 seconds)
// Option B: By speaker turn (new chunk when speaker changes)
// Option C: By topic (use LLM to detect topic shifts)
// Option D: By silence gaps (natural pauses)

function chunkBySpeaker(
  segments: TranscriptionSegment[],
): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentSpeaker = segments[0]?.speaker;

  for (const segment of segments) {
    if (segment.speaker !== currentSpeaker) {
      if (current.trim()) chunks.push(current.trim());
      current = `[${segment.speaker}]: `;
      currentSpeaker = segment.speaker;
    }
    current += segment.text + ' ';
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

// Metadata to store with audio chunks:
// - timestamp range (for "jump to this part" UX)
// - speaker identity
// - source file
// - confidence score (low confidence = noisy audio)
```

---

### Video Understanding

Video combines visual and audio streams:

```
Video Processing Pipeline:
                    ┌──────────┐
                    │  Video   │
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              ▼                     ▼
     ┌────────────────┐    ┌───────────────┐
     │  Audio Track   │    │  Video Track  │
     └────────┬───────┘    └───────┬───────┘
              │                    │
              ▼                    ▼
     ┌────────────────┐    ┌───────────────┐
     │  Transcription │    │   Keyframe    │
     │  (Whisper)     │    │  Extraction   │
     └────────┬───────┘    │  (1 per 5-30s)│
              │            └───────┬───────┘
              │                    │
              │                    ▼
              │            ┌───────────────┐
              │            │  Vision LLM   │
              │            │  Description  │
              │            └───────┬───────┘
              │                    │
              └────────┬───────────┘
                       ▼
              ┌────────────────┐
              │   Combine &    │
              │   Chunk by     │
              │   timestamp    │
              └────────────────┘
```

```typescript
// run: npx tsx video-pipeline.ts

interface VideoChunk {
  startTime: number;
  endTime: number;
  transcript: string;        // what was said
  visualDescription: string; // what was shown (from keyframe analysis)
  combined: string;          // merged text for embedding
}

// Keyframe extraction: select representative frames
// - Every N seconds (simple, may miss important moments)
// - On scene changes (detect visual discontinuities)
// - On slide changes (for presentations — detect large visual shifts)

function combineVideoChunk(
  transcript: string,
  visualDescription: string,
  startTime: number,
  endTime: number,
): VideoChunk {
  const timeRange = `[${formatTime(startTime)} - ${formatTime(endTime)}]`;
  return {
    startTime,
    endTime,
    transcript,
    visualDescription,
    combined: `${timeRange}\nNarration: ${transcript}\nVisual: ${visualDescription}`,
  };
}
```

---

### Architecture for Multimodal Document Processing

```
                    ┌───────────────────────┐
                    │   Document Upload     │
                    │   (PDF, DOCX, etc.)   │
                    └───────────┬───────────┘
                                │
                    ┌───────────▼───────────┐
                    │   Format Detection    │
                    │   & Routing           │
                    └───────────┬───────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     ┌────────▼───────┐ ┌──────▼──────┐  ┌───────▼───────┐
     │  Text Extractor│ │   Image     │  │  Table        │
     │  (text, OCR)   │ │  Extractor  │  │  Extractor    │
     └────────┬───────┘ └──────┬──────┘  └───────┬───────┘
              │                │                  │
              │         ┌──────▼──────┐  ┌───────▼───────┐
              │         │ Vision LLM  │  │  Structured   │
              │         │ Description │  │  Text Convert │
              │         └──────┬──────┘  └───────┬───────┘
              │                │                  │
              └────────────────┼──────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Unified Chunker    │
                    │   (page-aware,       │
                    │    modality metadata) │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Text Embedding     │
                    │   (all content is    │
                    │    text at this point)│
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Vector DB          │
                    │   (with modality     │
                    │    metadata)         │
                    └──────────────────────┘
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Tables flattened to nonsense.** A team converted tables to text by reading left-to-right, top-to-bottom: "Revenue Q1 Q2 Q3 Product A 100 200 300 Product B...". The LLM could not reconstruct the table structure. Queries like "What was Product A's Q2 revenue?" got wrong answers. **Convert tables row-by-row with column headers: "Product A: Q1=100, Q2=200, Q3=300".**

**OCR quality on scanned PDFs.** A legal team indexed scanned contracts using basic OCR. Character error rate was 5%, which sounds low but meant names, dates, and dollar amounts were frequently wrong. The RAG system confidently cited incorrect amounts from OCR errors. **Use cloud OCR services (Google Document AI, AWS Textract) for production workloads, and store confidence scores to flag low-quality extractions.**

**Vision LLM hallucination on charts.** A vision model was used to describe revenue charts. It sometimes invented data points or misread axis labels. A chart showing $1.2M revenue was described as "$12M". **Always include a confidence disclaimer for vision-extracted data, and consider storing the original image alongside the description for human verification.**
:::

## 🎯 Checkpoint

::: details Question 1 -- Describe-then-embed vs multimodal embeddings
**Q:** When would you choose multimodal embeddings (CLIP/SigLIP) over the describe-then-embed approach for image RAG?

**A:** Choose multimodal embeddings when: (1) **Visual similarity search** is a requirement -- "find images that look like this one." Describe-then-embed cannot do visual similarity because it discards the visual information. (2) **High volume, low cost** -- embedding an image with CLIP is cheap ($0.0001) vs. describing with a vision LLM ($0.005-0.01). At 1M images, the cost difference is $100 vs $5,000-10,000.

Choose describe-then-embed when: (1) **Content accuracy matters most** -- a rich text description captures more semantic detail than CLIP's 77-token-limited understanding. (2) **Text queries dominate** -- if users search with text and expect images as supporting evidence, text descriptions match text queries more accurately. (3) **Existing infrastructure** -- you already have a text embedding pipeline and do not want to manage a separate multimodal model. For most enterprise RAG systems, describe-then-embed is the practical choice because users search with text and need accurate content extraction, not visual similarity.
:::

::: details Question 2 -- Table processing
**Q:** A document contains a complex table with merged cells, multi-level headers, and footnotes. How would you process it for RAG?

**A:** (1) **Extraction:** Use a vision LLM rather than rule-based table extraction. Send the table as an image and prompt: "Convert this table to structured data, preserving all headers, merged cells, and footnotes." Vision LLMs handle complex layouts better than programmatic parsers. (2) **Structured representation:** Convert to row-by-row text with full headers. For merged cells, repeat the merged value for each row it spans. Include footnotes inline. Example: "Product A (North America): Q1 Revenue = $1.2M, Q2 Revenue = $1.5M. Note: Revenue includes subsidiaries per footnote 3." (3) **Chunking:** Keep the entire table as one chunk if it fits within chunk size limits. Tables lose meaning when split across chunks. If too large, split by logical sections (e.g., by region) rather than by row count. (4) **Metadata:** Tag the chunk as modality=table, include page number and table title for citation.
:::

## Key Mental Models

- **Describe-then-embed is the pragmatic default** -- it fits into existing text pipelines, produces richer representations than CLIP, and handles most enterprise use cases.
- **Tables need structure, not flattening** -- row-by-row with headers preserves meaning. Left-to-right reading order destroys it.
- **OCR quality is a data quality problem** -- garbage in, garbage out. Budget for high-quality OCR in production.
- **Store originals alongside descriptions** -- vision LLM descriptions can be wrong. Keep the original image/table for human verification and re-processing when models improve.

## Related

- [Embeddings](/rag/module-07/) -- the text embedding pipeline that multimodal content feeds into
- [Chunking strategies](/rag/module-05/) -- how to chunk multimodal documents
- [GraphRAG](02-graphrag.md) -- entities extracted from images and tables can feed knowledge graphs
