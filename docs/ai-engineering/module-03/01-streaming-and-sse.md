---
title: Streaming & SSE
outline: deep
---

# Streaming & SSE

TaskFlow's first deployment worked correctly and felt broken. The agent took four seconds to answer, and for all four of those seconds the user stared at a spinner. Support leads assumed it had crashed and refreshed, which started a second run. The model was fine. The delivery was wrong.

::: tip Plain English
Think about ordering food at a counter versus a sit-down restaurant. At the counter, nothing arrives until the entire order is ready — you wait, holding a buzzer, wondering if anyone is cooking. At the restaurant, bread arrives first, then a starter, then the main. The total time might be identical, but one feels like waiting and the other feels like being served.

Streaming is bringing out the bread. The model generates its answer one piece at a time anyway — that's how it works internally, word by word. Without streaming, you make the user wait while you collect every piece, then hand over the whole thing at once. With streaming, you pass each piece along as it appears.

The answer doesn't arrive faster. It starts arriving almost immediately, and that's the part people actually feel.
:::

## Why the model can stream at all

An LLM produces one token, appends it to its own input, and produces the next. The answer genuinely does not exist all at once — it's built incrementally. A non-streaming API call isn't avoiding that process; it's just buffering the whole thing on the provider's side and sending it after the final token.

So streaming isn't a feature bolted on. It's the provider declining to hide what was already happening.

This gives you two numbers that matter separately:

**Time to first token (TTFT)** — how long before anything appears. This is what users experience as responsiveness.

**Tokens per second** — how fast the rest arrives once it starts.

A 4-second response with 300ms TTFT feels fast. A 2-second response with 2-second TTFT feels slow. Optimizing total latency while ignoring TTFT is the most common mistake in this area, and it's why TaskFlow's "fast" endpoint felt worse than the slow one it replaced.

## Server-Sent Events, and why not WebSockets

The transport almost everyone uses is **Server-Sent Events** — a long-lived HTTP response where the server writes chunks as they become available.

```typescript
// SSE wire format: each event is "data: <payload>\n\n"
data: {"delta":"Your"}

data: {"delta":" ticket"}

data: {"delta":" is"}

data: [DONE]
```

SSE fits this problem better than WebSockets for a reason worth internalising: **token streaming is one-directional**. The client sends one request and receives many chunks. It never needs to push mid-stream. WebSockets give you bidirectional communication you won't use, in exchange for a protocol upgrade, a different connection lifecycle, and infrastructure that often needs separate configuration.

| | SSE | WebSocket |
|---|---|---|
| Direction | Server → client only | Bidirectional |
| Protocol | Plain HTTP | Upgrade handshake |
| Reconnection | Built into the browser `EventSource` | You implement it |
| Proxy support | Works with normal HTTP infrastructure | Often needs explicit config |
| Fits token streaming | Yes | Overkill |

Choose WebSockets when the client genuinely needs to interrupt or steer mid-generation — live collaborative editing, voice. For a support agent answering a question, SSE is the right size.

## Streaming through your own backend

You are rarely streaming directly from the provider to the browser. TaskFlow's agent sits behind an API that authenticates the user, injects the system prompt, and logs the run — so the stream passes through your server, and your server becomes a relay.

```typescript
// Node 22+, ESM. Relay a provider stream to the browser over SSE.
import type { Request, Response } from 'express';

export async function streamAgent(req: Request, res: Response): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',          // tells nginx not to buffer this response
  });

  const controller = new AbortController();
  // If the user closes the tab, stop paying for tokens nobody will read.
  req.on('close', () => controller.abort());

  try {
    const upstream = await callModel(req.body.messages, controller.signal);
    for await (const chunk of upstream) {
      res.write(`data: ${JSON.stringify({ delta: chunk.text })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    if (controller.signal.aborted) return;   // client left; not an error
    res.write(`data: ${JSON.stringify({ error: 'stream_failed' })}\n\n`);
  } finally {
    res.end();
  }
}
```

Three details in that snippet carry most of the weight.

**`X-Accel-Buffering: no`** — nginx buffers proxied responses by default. It will happily collect your entire stream and deliver it in one piece, perfectly recreating the problem you were solving. The symptom is maddening: streaming works locally and stops working in staging, with no code change. Same class of issue affects other reverse proxies and some CDN configurations.

**The abort on `close`** — when a user closes the tab, the browser drops the connection, but nothing automatically tells the provider to stop generating. You keep being billed for tokens nobody will ever see. Wiring client disconnect to an `AbortController` is the fix, and on a support tool where users abandon slow answers, it's a real line item.

**Swallowing the post-abort error** — once you abort, the upstream call throws. That's expected, not a failure, and logging it as an error will fill your dashboard with noise that hides real problems.

## Backpressure: the failure nobody tests for

The model can produce tokens faster than a client on hotel wifi can accept them. `res.write()` returns `false` when the outbound buffer is full — and if you ignore that return value, Node keeps buffering in memory. One slow client is survivable. Two hundred concurrent slow clients is an out-of-memory crash that looks nothing like its cause.

```typescript
// Respect backpressure: pause reading upstream until the socket drains.
for await (const chunk of upstream) {
  const ok = res.write(`data: ${JSON.stringify({ delta: chunk.text })}\n\n`);
  if (!ok) await new Promise<void>((r) => res.once('drain', () => r()));
}
```

Node's `pipeline()` handles this for you when you can express the relay as streams. When you're transforming chunks by hand, as above, you own it.

::: warning Watch out
**Streaming makes partial failure visible.** A non-streaming call either succeeds or fails. A stream can deliver 200 tokens and then die — the user has half an answer, and it may read as complete. Always send an explicit terminal event (`[DONE]`) and have the client treat a stream that ends without one as failed, not finished. Otherwise a truncated refund policy reads as a policy.

**Streamed responses are hard to guardrail.** Output filters (covered in [Module 7](/ai-engineering/module-07/01-ai-security)) need the whole response to judge it, but you've already sent most of it. The usual compromise is to buffer a short window — a sentence or two behind the generation edge — so a filter can catch something before the final chunk leaves. You trade a little perceived latency for the ability to stop a bad answer mid-flight.
:::

::: details Interview Question — Streaming works locally, not in production
**Q:** Your token streaming works perfectly in local development. Deployed behind nginx, users see the full response appear at once after several seconds. Nothing in the application changed. What happened, and how do you confirm it?

**A:** Almost certainly proxy buffering. nginx buffers proxied responses by default (`proxy_buffering on`), so it accumulates your SSE chunks and forwards them once the upstream response completes or its buffer fills. The application is streaming correctly; the proxy is un-streaming it.

Confirm it by bypassing the proxy: `curl -N` directly against the app port shows chunks arriving incrementally, while the same `curl -N` through nginx shows one burst. That isolates it to the proxy layer in one step.

Two fixes. Set `X-Accel-Buffering: no` on the response, which nginx honours per-response and keeps the configuration with the code that needs it. Or set `proxy_buffering off` in the nginx location block, which is broader and affects everything routed through it. Prefer the header — it's scoped to the endpoint that actually streams.

Also check for compression middleware in your own stack. `compression()` in Express will buffer to build compressible blocks and produces the identical symptom with no proxy involved, which is why this sometimes reproduces locally too.
:::

::: details Interview Question — Cost of abandoned streams
**Q:** Your agent averages 800 output tokens per response. Analytics show 30% of users navigate away before the response finishes. What's the exposure and what do you do?

**A:** The exposure is that generation continues after the client disconnects unless something cancels it. TCP close doesn't propagate to the provider on its own — your server holds an open upstream request, tokens keep being generated and billed, and the user is gone. On abandoned runs you may be paying for most of the 800 tokens with zero delivery.

The fix is to wire client disconnect to cancellation: listen for `close` on the request, abort the upstream call via `AbortController`, and make sure the abort actually reaches the provider SDK rather than only stopping your local iteration. Verify it — it's easy to abort your own loop while the HTTP request stays open, which changes nothing about the bill.

Then instrument it: log completed versus aborted runs with tokens generated for each. That turns "30% navigate away" into a number you can put next to the invoice, and it tells you whether the cancellation is genuinely working.

The deeper fix is often TTFT. Users abandon because nothing appeared quickly enough. Reducing TTFT reduces abandonment, which reduces waste more durably than cancelling efficiently does.
:::

## Key Mental Models

**Streaming doesn't make responses faster, it makes them start.** TTFT is the number users feel; total latency is the number dashboards show.

**SSE is one-directional, and so is token generation.** WebSockets buy bidirectionality you won't use, at the cost of infrastructure that needs special handling.

**Every layer between you and the user can un-stream you.** Proxies, compression middleware and CDNs all buffer by default. Streaming that works locally proves nothing.

**A disconnected client still costs money.** Cancellation must reach the provider, not just your own loop.

**A stream that ends is not a stream that succeeded.** Without an explicit terminal event, truncation is indistinguishable from completion.

## Related

- [3.3 Reliability & Fallbacks](./03-reliability-and-fallbacks) — what a retry means once you've already sent half a response
- [3.4 Cost & Token Accounting](./04-cost-and-token-accounting) — attributing spend on runs that never finished
- [6.1 Production Metrics](/ai-engineering/module-06/01-production-metrics) — TTFT as an SLO
- [Streams & Backpressure](/nodejs/module-04/02-streams-backpressure) — the Node mechanics underneath
- [SSE Streaming in Node](/nodejs/module-04/04-sse-streaming) — transport-level detail
- [nginx & Streaming](/system-design/load-balancing/03-streaming-sse) — proxy configuration
