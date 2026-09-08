---
title: MCP — Model Context Protocol
outline: deep
---

# MCP — Model Context Protocol

We had tools in our agent. But our tools were hardcoded. Then we learned about MCP — a standard way for models to discover and call tools, like a USB standard for AI.

::: tip Plain English
Before USB, every device had its own connector. Printers, cameras, keyboards — each needed a specific cable for each specific computer. USB said: "Here's a single standard. If you build to this standard, any USB device works with any USB port."

MCP is that for AI tools. Before MCP, every agent had its own way of defining and calling tools. If you built a tool for one agent framework, you'd have to rewrite it for another. MCP says: "Here's a single standard. If you build an MCP server, any MCP-compatible model or agent can use your tools."

Anthropic published this open protocol in late 2024, and it's been widely adopted since.
:::

## The two sides: MCP server and MCP client

**MCP server** — exposes tools, resources, and data. You build this if you have something to offer. For TaskFlow, our backend would be an MCP server exposing: `lookup_ticket`, `list_user_tickets`, `escalate_to_human`.

**MCP client** — connects to MCP servers and makes the tools available to the model. The agent harness is the client. Claude, for example, is an MCP client — it can connect to MCP servers and use their tools.

The flow:
```
MCP Client (agent harness)    ←→    MCP Server (your tools)
       ↓
     Model
       ↓
  "I need lookup_ticket" → Client calls MCP Server → Result back to model
```

## Why it matters

**Tool portability:** Build your tool once as an MCP server. Use it with Claude, use it with an OpenAI-based agent, use it with any MCP-compatible framework. No rewrites.

**Ecosystem:** Public MCP servers already exist for GitHub, Slack, Google Drive, databases, web browsers. You can drop these into your agent as tools without writing any integration code.

**Discovery:** MCP clients can dynamically ask a server "what tools do you have?" The model doesn't need to be told upfront — it can discover available tools at runtime.

**Security boundary:** The MCP server controls what the model can access. You don't expose your database directly — you expose specific functions that do what you decide.

## MCP vs custom tool calling

| | Custom tool calling | MCP |
|---|---|---|
| Setup | Simpler for one agent | More setup initially |
| Portability | Tied to your agent | Works with any MCP client |
| Ecosystem | You build everything | Reuse community servers |
| Discovery | Static tool list | Dynamic discovery |
| Best for | One agent, one codebase | Shared tools, ecosystem integration |

## When to use MCP vs custom tools

::: tip When to use MCP
- You want to share tools across multiple agents or frameworks
- You want to use community MCP servers (GitHub, Slack, etc.)
- You're building tools that other teams will consume
- You want tool discovery without rebuilding the tool list every time
:::

::: tip When to use custom tools
- You have one agent, one codebase, one team
- You want the simplest possible setup
- Your tool definitions are changing frequently
- You don't need portability yet
:::

For TaskFlow's v1, we used custom tool calling — it was simpler and we controlled everything. As we add more agents (see Module 2.6), we're migrating our backend tools to MCP servers so all agents can share them without code duplication.

::: details Interview Question — MCP use case
**Q:** You have 5 different AI agents in your company, all needing to look up customer data. How would MCP help?

**A:** Without MCP, each of the 5 teams writes their own tool integration to the customer data API — 5 separate implementations, 5 places to maintain auth logic, 5 places that break when the API changes. With MCP, you build one MCP server that wraps the customer data API and exposes the right tools. All 5 agents connect as MCP clients. Changes to the data API are fixed in one place. Auth is handled once. New tools (e.g., `get_customer_history`) are immediately available to all 5 agents without any of the 5 teams doing anything. It's a shared infrastructure layer for AI tools, the same way a shared API gateway is shared infrastructure for HTTP services.
:::
