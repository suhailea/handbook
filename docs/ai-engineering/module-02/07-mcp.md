---
title: MCP — Model Context Protocol
outline: deep
---

# MCP — Model Context Protocol

Before MCP, connecting TaskFlow's agent to Slack, a database, and a ticketing system meant three different bespoke tool integrations, each hand-rolled. MCP is a standard protocol so tools can be written once and plugged into any compatible agent.

::: tip Plain English
Before USB, every peripheral needed its own custom port. MCP is doing the same job for AI tools: instead of every agent framework inventing its own way to describe and call tools, MCP defines one interface. A server exposing tools over MCP can be plugged into any MCP-compatible agent, and an agent that speaks MCP can use any MCP server, without either side needing custom glue code.
:::

## How it fits together

An **MCP server** exposes tools, resources (readable data) and prompts. An **MCP client** — your agent's harness — connects to one or more servers and makes their tools available to the model, using the same tool-calling mechanism from [2.2](./02-tools-and-tool-calling).

```
Agent Harness (MCP client)
    │
    ├── connects to ──▶ Google Drive MCP server   (read/search docs)
    ├── connects to ──▶ Slack MCP server           (post messages)
    └── connects to ──▶ Internal Ticketing server  (your own, custom-built)
```

The model still just sees "tools" — MCP is a transport and discovery standard underneath, not a change to how tool calling works from the model's perspective.

## Why it matters practically

**Reuse.** A well-built MCP server for, say, GitHub gets built once and used by every agent that needs GitHub access, instead of each team writing its own integration.

**Discovery.** Clients can query a server for its available tools at connection time rather than hardcoding a tool list, which matters for agents that need to work with tools they weren't specifically built for.

**Separation of concerns.** The team that owns a service can own its MCP server and its security boundary, rather than every agent builder needing deep knowledge of that service's API.

| | Custom integration | MCP server |
|---|---|---|
| Reuse across agents | None | Built in |
| Who maintains it | Every consumer | The service owner |
| Discovery | Hardcoded | Queryable |

::: warning Watch out
An MCP server is a new trust boundary — you're letting an agent call tools defined by code you may not control, especially for third-party servers. Treat MCP tool results as untrusted input, same as any other tool output, and don't assume a server's tool descriptions are accurate or non-adversarial just because it speaks the protocol correctly.
:::

::: details Interview Question — MCP vs a custom tool integration
**Q:** When would you use MCP instead of just writing a custom tool integration?
**A:** When the tool will be reused across multiple agents or teams, or when you want to consume a third-party service that already has an MCP server (Slack, GitHub, Google Drive) rather than writing your own client for their API. For a one-off internal tool used by a single agent, a plain function is simpler and the protocol overhead isn't worth it.
:::

::: details Interview Question — Security implications of MCP
**Q:** What's different about the security posture of an agent using third-party MCP servers versus tools you wrote yourself?
**A:** You don't control the server's code, so its tool descriptions and results are untrusted input, not verified behavior. Apply the same guardrails you'd use for any external data — validate outputs, don't let an MCP tool's returned content be interpreted as instructions (a prompt injection vector), and scope what each server can actually do rather than granting broad access by default.
:::

## Key Mental Models

**MCP standardizes tool exposure, not tool-calling itself.** The model-facing mechanism is unchanged; what's new is how tools get discovered and connected.

**A third-party MCP server is a trust boundary.** Treat its outputs as untrusted, same as any other external input.

## Related

- [2.2 Tools & Tool Calling](./02-tools-and-tool-calling) — the underlying mechanism MCP standardizes
- [2.8 A2A](./08-a2a) — the complementary protocol for agent-to-agent communication
- [7.1 AI Security](/ai-engineering/module-07/01-ai-security) — treating tool output as untrusted input
