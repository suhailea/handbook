---
title: "Module 15 Summary"
outline: deep
---

# Module 15 — WebSockets & Real-Time: Summary

## Mental Models Gained

- **WebSocket is an upgrade, not a replacement.** It starts as HTTP, then switches to a persistent, full-duplex channel. This upgrade requirement shapes how you configure proxies and load balancers.
- **Socket.IO solves the hard parts.** Auto-reconnection, room-based broadcasting, fallback transports, and the Redis adapter for multi-server scaling. Use raw `ws` only when you need minimal overhead.
- **Push (EventEmitter/WebSocket) vs Pull (async iteration/SSE).** Choose based on your pattern: fan-out to many clients = push/WebSocket. Server-to-client updates = SSE is often simpler.
- **Scaling WebSockets is fundamentally different from scaling HTTP.** Connections are stateful (sticky sessions), cross-server messaging needs a bus (Redis pub/sub), and deploys require connection draining.

## Self-Assessment Checklist

- [ ] Can you implement WebSocket authentication?
- [ ] Can you configure Socket.IO with the Redis adapter for multi-server?
- [ ] Can you implement a presence system (who's online)?
- [ ] Can you explain the sticky session requirement and configure nginx for it?
- [ ] Can you handle graceful reconnection with backoff + jitter?
- [ ] Can you decide when SSE is better than WebSocket?
