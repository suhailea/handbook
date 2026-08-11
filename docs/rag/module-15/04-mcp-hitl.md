---
title: MCP & Human-in-the-Loop
outline: deep
---

# MCP & Human-in-the-Loop

Interview weight: 🔥🔥 | Prerequisites: [Agentic RAG](01-agentic-rag.md), [Guardrails](/rag/module-14/02-guardrails.md)

## 🗣️ In Plain English

::: tip In Plain English
MCP (Model Context Protocol) is a standard way to give an LLM access to tools and data -- like a universal adapter that lets the AI plug into any system. Human-in-the-Loop means a human must approve certain actions before they happen -- like a manager who signs off on refunds over $100. MCP gives the AI *ability*, HITL gives humans *oversight*.
:::

## ⚙️ Under the Hood

### Part 1: Model Context Protocol (MCP)

#### What MCP Is

MCP (Model Context Protocol), introduced by Anthropic, is a **standardized interface** for connecting LLMs to external data sources and tools. Before MCP, every integration was custom -- each tool had its own API client, authentication flow, and data format. MCP provides a common protocol so that any MCP-compatible client can use any MCP-compatible server.

**Analogy:** USB standardized how peripherals connect to computers. Before USB, every device had its own proprietary connector. MCP does the same for LLM-tool connections.

#### Architecture

```
┌─────────────────┐         ┌─────────────────┐
│   MCP Client    │         │   MCP Server    │
│   (LLM App)     │◄──────►│   (Tool Host)   │
│                 │  MCP    │                 │
│  • Claude       │ Protocol│  • File system  │
│  • Custom agent │         │  • Database     │
│  • IDE plugin   │         │  • API wrapper  │
│                 │         │  • RAG system   │
└─────────────────┘         └─────────────────┘
```

**Three MCP primitives:**

| Primitive | Direction | Purpose | Example |
|-----------|-----------|---------|---------|
| **Tools** | Client → Server | Execute an action | `search_flights`, `process_refund` |
| **Resources** | Client → Server | Read data | `file://docs/policy.md`, `db://users/123` |
| **Prompts** | Server → Client | Suggested prompts | "Summarize this document", "Explain this error" |

#### Tools vs Resources

```typescript
// run: npx tsx mcp-concepts.ts

// TOOLS: actions the LLM can request
// The LLM sends arguments, the server executes and returns results
interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;  // JSON Schema
}

// Example tools for an airline MCP server:
const airlineTools: MCPTool[] = [
  {
    name: 'search_flights',
    description: 'Search for available flights between airports on a date',
    inputSchema: {
      type: 'object',
      properties: {
        origin: { type: 'string', description: 'Airport code (e.g., SFO)' },
        destination: { type: 'string', description: 'Airport code (e.g., JFK)' },
        date: { type: 'string', description: 'Date in YYYY-MM-DD' },
      },
      required: ['origin', 'destination', 'date'],
    },
  },
  {
    name: 'get_booking',
    description: 'Look up a booking by confirmation number',
    inputSchema: {
      type: 'object',
      properties: {
        confirmation: { type: 'string' },
      },
      required: ['confirmation'],
    },
  },
  {
    name: 'cancel_booking',
    description: 'Cancel a flight booking. Requires customer confirmation.',
    inputSchema: {
      type: 'object',
      properties: {
        confirmation: { type: 'string' },
        reason: { type: 'string' },
      },
      required: ['confirmation', 'reason'],
    },
  },
  {
    name: 'process_refund',
    description: 'Process a refund for a cancelled booking',
    inputSchema: {
      type: 'object',
      properties: {
        confirmation: { type: 'string' },
        amount: { type: 'number' },
        method: { type: 'string', enum: ['original_payment', 'credit'] },
      },
      required: ['confirmation', 'amount', 'method'],
    },
  },
  {
    name: 'check_seat_availability',
    description: 'Check available seats on a specific flight',
    inputSchema: {
      type: 'object',
      properties: {
        flight_number: { type: 'string' },
        date: { type: 'string' },
      },
      required: ['flight_number', 'date'],
    },
  },
];

// RESOURCES: data the LLM can read
// Static or slowly-changing data, exposed as URIs
// Example: flight policies, fare rules, airport information
```

#### How an Agent Uses MCP Tools

```typescript
// run: npx tsx agent-mcp-flow.ts

// User: "I need to cancel my flight ABC123 and get a refund"

// Agent reasoning (simplified):
// Step 1: Look up the booking
// Step 2: Cancel the booking
// Step 3: Process refund

// The agent calls tools through the MCP protocol:

// Step 1: Agent calls get_booking
const booking = await mcpClient.callTool('get_booking', {
  confirmation: 'ABC123',
});
// Returns: { flight: "UA456", date: "2025-03-15", passenger: "John Doe", amount: 450.00, status: "confirmed" }

// Step 2: Agent calls cancel_booking
const cancellation = await mcpClient.callTool('cancel_booking', {
  confirmation: 'ABC123',
  reason: 'Customer requested cancellation',
});
// Returns: { success: true, cancellation_id: "CXL789" }

// Step 3: Agent calls process_refund
const refund = await mcpClient.callTool('process_refund', {
  confirmation: 'ABC123',
  amount: 450.0,
  method: 'original_payment',
});
// Returns: { success: true, refund_id: "REF012", estimated_days: 5 }

// Agent generates response to user with all the details
```

#### When to Use MCP vs Direct API Calls

| Scenario | MCP | Direct API |
|----------|-----|-----------|
| Multiple LLM applications need the same tools | MCP (write once, use everywhere) | Duplicate integration code |
| Single application, one tool | Overkill | Simpler |
| Third-party tool providers | MCP (standard interface) | Custom per provider |
| Rapid prototyping | MCP (many pre-built servers) | Build from scratch |
| High-performance, low-latency | Extra protocol overhead | Direct, minimal overhead |

#### Authorization and Security in MCP

```typescript
// run: npx tsx mcp-security.ts

// MCP servers MUST enforce their own authorization
// The LLM client passes user context, the server validates

interface MCPRequest {
  method: string;
  params: {
    name: string;         // tool name
    arguments: Record<string, unknown>;
  };
  // Auth context passed separately (not in tool arguments)
  meta?: {
    auth_token?: string;
    user_id?: string;
    permissions?: string[];
  };
}

// Server-side authorization check
function authorizeToolCall(
  request: MCPRequest,
  toolName: string,
): { authorized: boolean; reason?: string } {
  const user = validateToken(request.meta?.auth_token);
  if (!user) {
    return { authorized: false, reason: 'Invalid auth token' };
  }

  // Tool-level permissions
  const requiredPermission = TOOL_PERMISSIONS[toolName];
  if (
    requiredPermission &&
    !user.permissions.includes(requiredPermission)
  ) {
    return {
      authorized: false,
      reason: `Missing permission: ${requiredPermission}`,
    };
  }

  // Business logic authorization
  if (toolName === 'process_refund') {
    const amount = request.params.arguments.amount as number;
    if (amount > 500 && !user.permissions.includes('high_value_refund')) {
      return {
        authorized: false,
        reason: 'Refund exceeds authorization limit',
      };
    }
  }

  return { authorized: true };
}

const TOOL_PERMISSIONS: Record<string, string> = {
  search_flights: 'read',
  get_booking: 'read',
  check_seat_availability: 'read',
  cancel_booking: 'write',
  process_refund: 'refund',
};
```

---

### Part 2: Human-in-the-Loop (HITL)

#### What HITL Means

Human-in-the-Loop is a design pattern where **certain AI actions require human approval** before execution. It is not a technology -- it is an architectural decision about where to place human decision points.

**HITL is NOT the same as MCP:**
- MCP = how the AI accesses tools (the protocol)
- HITL = whether a human must approve before the tool executes (the policy)

You can have MCP without HITL (fully automated tool use) or HITL without MCP (custom tool integration with approval gates).

#### When HITL Is Needed

| Action Type | Risk Level | HITL Required? |
|------------|-----------|----------------|
| Search/read data | Low | No |
| Generate a summary | Low | No |
| Send an email to customer | Medium | Maybe (review draft) |
| Cancel a booking | High | Yes (confirm with customer) |
| Process a refund > $100 | High | Yes (agent approval) |
| Modify account settings | High | Yes |
| Delete data | Critical | Yes (multi-approval) |

#### Approval Workflow Patterns

**Pattern 1: Synchronous Approval (real-time chat)**

```typescript
// run: npx tsx sync-approval.ts

// User is in a live chat. Agent proposes action, waits for confirmation.

interface ApprovalRequest {
  action: string;
  description: string;
  details: Record<string, unknown>;
  requiredApprover: 'customer' | 'agent' | 'manager';
}

async function handleWithApproval(
  toolCall: ToolCall,
  chat: ChatSession,
): Promise<ToolResult> {
  // Check if this tool requires approval
  const policy = getApprovalPolicy(toolCall.name);

  if (policy.requiresApproval) {
    // Present the proposed action to the approver
    if (policy.approver === 'customer') {
      // Ask the customer in the chat
      await chat.sendMessage(
        `I'd like to cancel your booking ABC123 and process a ` +
        `refund of $450 to your original payment method. ` +
        `Shall I proceed? (yes/no)`,
      );

      const response = await chat.waitForResponse({ timeout: 120_000 });

      if (!isAffirmative(response.text)) {
        return { success: false, reason: 'Customer declined' };
      }
    } else if (policy.approver === 'agent') {
      // Route to a human agent for approval
      const approval = await escalateToAgent({
        action: toolCall.name,
        arguments: toolCall.arguments,
        customerContext: chat.getHistory(),
        timeoutMs: 300_000, // 5 minute timeout
      });

      if (!approval.approved) {
        return {
          success: false,
          reason: `Agent declined: ${approval.reason}`,
        };
      }
    }
  }

  // Approved — execute the tool
  return await executeTool(toolCall);
}
```

**Pattern 2: Async Approval (ticket-based)**

```typescript
// run: npx tsx async-approval.ts

// For non-real-time workflows. Agent creates an approval request,
// human approves later, system completes the action.

interface ApprovalTicket {
  id: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  action: ToolCall;
  context: {
    user_id: string;
    conversation_summary: string;
    ai_reasoning: string;       // why the AI thinks this action is needed
  };
  created_at: string;
  expires_at: string;
  approved_by?: string;
  rejection_reason?: string;
}

async function createApprovalTicket(
  action: ToolCall,
  context: ConversationContext,
): Promise<ApprovalTicket> {
  const ticket: ApprovalTicket = {
    id: generateId(),
    status: 'pending',
    action,
    context: {
      user_id: context.userId,
      conversation_summary: await summarizeConversation(context),
      ai_reasoning: await explainReasoning(action, context),
    },
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };

  await ticketQueue.create(ticket);

  // Notify the user
  await notifyUser(
    context.userId,
    `Your request is pending approval. Ticket: ${ticket.id}`,
  );

  return ticket;
}

// When human approves the ticket:
async function onTicketApproved(ticketId: string): Promise<void> {
  const ticket = await ticketQueue.get(ticketId);
  if (ticket.status !== 'pending') return;

  // Execute the action
  const result = await executeTool(ticket.action);

  // Update ticket
  ticket.status = 'approved';

  // Notify the user
  await notifyUser(
    ticket.context.user_id,
    `Your request has been approved and processed. ${JSON.stringify(result)}`,
  );
}
```

**Pattern 3: Escalation from AI to Human Agent**

```typescript
// run: npx tsx escalation.ts

interface EscalationCriteria {
  confidenceThreshold: number;  // below this, escalate
  maxToolCalls: number;         // if agent loops, escalate
  sensitiveTopics: string[];    // always escalate
  customerSentiment: 'negative' | 'frustrated' | 'angry'; // escalate
}

async function shouldEscalate(
  conversation: ConversationContext,
  criteria: EscalationCriteria,
): Promise<{ escalate: boolean; reason: string }> {
  // 1. Low confidence
  if (conversation.lastConfidenceScore < criteria.confidenceThreshold) {
    return {
      escalate: true,
      reason: `Low confidence: ${conversation.lastConfidenceScore}`,
    };
  }

  // 2. Too many tool calls (agent is struggling)
  if (conversation.toolCallCount > criteria.maxToolCalls) {
    return {
      escalate: true,
      reason: `Exceeded tool call limit: ${conversation.toolCallCount}`,
    };
  }

  // 3. Sensitive topic detected
  const topic = await classifyTopic(conversation.latestMessage);
  if (criteria.sensitiveTopics.includes(topic)) {
    return {
      escalate: true,
      reason: `Sensitive topic: ${topic}`,
    };
  }

  // 4. Customer frustration detected
  const sentiment = await analyzeSentiment(conversation.latestMessage);
  if (['frustrated', 'angry'].includes(sentiment)) {
    return {
      escalate: true,
      reason: `Customer sentiment: ${sentiment}`,
    };
  }

  return { escalate: false, reason: '' };
}

// Escalation handoff
async function escalateToHuman(
  conversation: ConversationContext,
  reason: string,
): Promise<void> {
  // Generate a summary for the human agent
  const summary = await generateHandoffSummary(conversation);

  // Transfer to human queue with full context
  await humanAgentQueue.enqueue({
    conversation_id: conversation.id,
    customer_id: conversation.userId,
    summary,
    escalation_reason: reason,
    full_history: conversation.getHistory(),
    ai_actions_taken: conversation.toolCalls,
    priority: determinePriority(reason),
  });

  // Inform the customer
  await conversation.sendMessage(
    "I'm connecting you with a human agent who can better assist you. " +
    "They'll have the full context of our conversation.",
  );
}
```

---

### HITL Design Principles

1. **Risk-proportional oversight:** Low-risk actions (search) proceed automatically. High-risk actions (refunds, cancellations) require approval. Map every tool to a risk level.

2. **Context-rich handoffs:** When escalating to a human, provide the full conversation history, the AI's reasoning, and what actions were already taken. Humans should not have to re-ask the customer for information.

3. **Graceful degradation:** When no human is available (off-hours, queue overflow), the system should acknowledge the delay, set expectations, and optionally offer self-service alternatives.

4. **Feedback loop:** Human decisions (approvals, rejections, corrections) should feed back into the system to improve routing, confidence calibration, and policy rules.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**HITL bottleneck kills throughput.** A team required human approval for all refunds, regardless of amount. During a service outage that affected 10,000 customers, the approval queue backed up to 48 hours. Customers who should have received instant $5 refunds waited two days. **Set dollar thresholds: auto-approve small refunds, require approval only above a meaningful limit.**

**Lost context on escalation.** When the AI escalated to a human agent, it passed only the last message. The human agent had to ask the customer to repeat their problem, creating frustration. The customer's sentiment went from "mildly annoyed" to "furious." **Always pass the full conversation history, AI reasoning, and a summary to the human agent.**

**MCP server without authorization.** A team built an MCP server exposing database tools. The tools executed whatever SQL the LLM generated -- including UPDATE and DELETE statements. An adversarial prompt tricked the agent into deleting records. **MCP servers must validate and authorize every tool call independently. Never trust the LLM client to enforce policies.**
:::

## 🎯 Checkpoint

::: details Question 1 -- MCP vs direct integration
**Q:** When would you build an MCP server for your RAG system instead of directly calling APIs from your application code?

**A:** Build an MCP server when: (1) **Multiple clients** need the same tool access -- if your RAG tools are used by a web app, a Slack bot, and a CLI tool, MCP lets you implement tools once and expose them to all clients through the standard protocol. (2) **Third-party LLM integrations** -- if you want Claude Desktop, Cursor, or other MCP-compatible clients to access your tools without custom code. (3) **Tool ecosystem** -- if you want to compose tools from multiple providers (your database + a partner's API + a monitoring service) using a standard interface.

Use direct API calls when: (1) Single application, single tool -- MCP adds protocol overhead with no benefit. (2) Ultra-low-latency requirements -- MCP's JSON-RPC adds a few milliseconds per call. (3) Tightly coupled logic -- when tool calls are deeply integrated with application state that would be awkward to serialize over MCP.
:::

::: details Question 2 -- Designing HITL for an airline chatbot
**Q:** Design the HITL policy for an airline customer service chatbot. Which actions should be automatic, which need customer confirmation, and which need agent approval?

**A:**

| Action | Approval | Rationale |
|--------|----------|-----------|
| Search flights, check status | Automatic | Read-only, no risk |
| Get booking details | Automatic | Read-only, user already authenticated |
| Seat selection (free) | Customer confirmation | Irreversible choice, low risk |
| Seat upgrade (paid) | Customer confirmation + payment auth | Financial commitment |
| Change flight (no fee) | Customer confirmation | Irreversible, customer must agree to new times |
| Change flight (with fee) | Customer confirmation + payment auth | Financial commitment |
| Cancel booking (< $100) | Customer confirmation | Low value, customer can confirm in chat |
| Cancel booking (> $100) | Customer confirmation + agent review | High value, prevent AI errors |
| Refund (< $50) | Automatic after cancellation | Low value, standard policy |
| Refund ($50-$500) | Agent approval | Moderate value |
| Refund (> $500) | Manager approval | High value |
| Account changes (email, phone) | Customer re-authentication | Identity verification |
| Complaint escalation | Auto-escalate to human | Sensitive, empathy needed |

Key design decisions: (1) Financial thresholds should align with existing business policies. (2) Customer confirmation is cheap (ask in chat). (3) Agent approval adds latency -- only use for genuinely risky actions. (4) Always provide a path to a human when the customer asks.
:::

## Key Mental Models

- **MCP is a protocol, HITL is a policy** -- MCP defines how tools are accessed, HITL defines who approves their use. They are complementary, not alternatives.
- **Risk-proportional oversight** -- automate low-risk actions, gate high-risk ones. The threshold should match business policy, not engineering convenience.
- **Context-rich handoffs** -- when escalating to a human, the handoff quality determines whether the human can help efficiently or has to start from scratch.
- **Every MCP server is a security boundary** -- it must authenticate callers, authorize actions, validate inputs, and rate-limit independently of the LLM client.

## Related

- [Agentic RAG](01-agentic-rag.md) -- the agent patterns that MCP tools enable
- [Guardrails](/rag/module-14/02-guardrails.md) -- tool guardrails apply to MCP tool calls
- [RAG Security](/rag/module-14/01-security.md) -- MCP server authorization is a security concern
