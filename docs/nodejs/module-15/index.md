---
title: "Module 15 — WebSockets & Real-Time"
outline: deep
---

# Module 15 — WebSockets & Real-Time

HTTP is a pull protocol: the client asks, the server answers. But many features — chat, notifications, live dashboards, collaborative editing — require the server to push data the instant it appears, without the client polling. WebSockets solve this by upgrading an HTTP connection into a persistent, full-duplex channel where either side can send frames at any time.

This module starts from the raw WebSocket handshake (building on Module 5's HTTP internals), moves through the `ws` library and Socket.IO's abstraction layer, explores real-time application patterns (presence, chat, live data), and finishes with the hard operational problem: scaling stateful WebSocket connections across multiple servers in production.

## Pages

- [WebSocket Fundamentals](./01-websocket-fundamentals) — upgrade handshake, ws library, message framing, ping/pong, backpressure, authentication, heartbeat implementation
- [Socket.IO: Rooms, Namespaces & Scaling](./02-socketio-rooms) — rooms, namespaces, acknowledgements, middleware, Redis adapter for horizontal scaling, NestJS Gateway integration
- [Real-Time Patterns: Chat, Notifications, Live Data](./03-realtime-patterns) — presence systems, chat rooms, notification queues, live dashboards, collaborative editing concepts, debounced typeahead
- [Scaling WebSockets in Production](./04-scaling-websockets) — sticky sessions, Redis pub/sub, connection limits, memory budgets, graceful reconnection, connection draining, WebSocket vs SSE decision matrix
- [Module 15 Summary](./summary)
