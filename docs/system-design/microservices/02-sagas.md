---
title: Sagas & Distributed Transactions
outline: deep
---

# Sagas & Distributed Transactions

<Badge type="danger" text="High interview weight" /> <Badge type="warning" text="Prereqs: Microservices basics, message brokers" />

## 🗣️ In Plain English

::: tip In Plain English
Imagine planning a vacation. You need to book three things: a flight, a hotel, and a rental car. In an ideal world, you'd book all three at once — either they all succeed or none of them do. That's what a traditional database transaction does: all-or-nothing.

But each booking goes through a different company with a different system. You can't wrap Airline.com, Marriott.com, and Hertz.com in a single transaction. So you book them one at a time. You book the flight first. Then the hotel. Then the car.

Now imagine the car rental fails — no cars available. You can't just "rollback" like a database. The flight is already booked. The hotel is already reserved. Instead, you have to *undo* each previous step: cancel the hotel reservation, then cancel the flight. These cancellations are what we call **compensating transactions** — they're not a true undo (the airline might charge a cancellation fee), but they get you back to a reasonable state.

This is exactly the saga pattern. A saga is a sequence of local transactions, each in its own service, where each step has a corresponding "compensation" step that reverses its effect if a later step fails. There's no global coordinator locking resources across services. Instead, the services cooperate through a defined sequence of actions and compensations.

There are two ways to coordinate this sequence. In **choreography**, each service listens for events and decides what to do next — like a group of dancers who all know the routine. In **orchestration**, a central coordinator tells each service what to do next — like a conductor directing an orchestra. Choreography is simpler for 2-3 services; orchestration is more manageable when you have 5+ steps or complex branching logic.

The key insight is that distributed systems can't have traditional ACID transactions across service boundaries. Sagas trade **isolation** (other operations can see intermediate states) for **availability** and **partition tolerance**. The system is eventually consistent: it will reach a correct state, but there may be a window where it's partway through.
:::

## ⚙️ Under the Hood

### Why Two-Phase Commit (2PC) Doesn't Scale

Two-Phase Commit is the textbook approach to distributed transactions:

1. **Prepare phase:** A coordinator asks every participant "can you commit?" Each participant locks its resources and votes yes or no.
2. **Commit phase:** If all voted yes, the coordinator tells everyone to commit. If any voted no, everyone aborts.

**Why it fails in microservices:**

| Problem | Impact |
|---|---|
| **Blocking protocol** | All participants hold locks during the prepare phase. If the coordinator crashes, participants are stuck holding locks indefinitely. |
| **Latency** | Two network round-trips minimum. Every participant must wait for the slowest one. |
| **Availability** | If *any* participant is unavailable, the entire transaction fails. 2PC requires 100% availability across all participants. |
| **Heterogeneous systems** | Participants must support the XA protocol. Message brokers, third-party APIs, and many databases don't. |
| **Autonomy violation** | Each service loses independent deployability — they're bound to the coordinator's protocol. |

2PC works within a single database cluster. It does not work across independently deployed microservices with different data stores.

### The Saga Pattern

A saga replaces a single distributed transaction with a sequence of local transactions, each publishing an event or notification that triggers the next step. If any step fails, compensating transactions execute in reverse order.

#### Saga Step Structure

Each step in a saga has three components:

1. **Transaction (T):** The forward action (e.g., reserve inventory).
2. **Compensation (C):** The reverse action (e.g., release inventory).
3. **Pivot point:** The step after which there are no more compensations needed — the saga is committed. Steps after the pivot are *retriable* (they must eventually succeed).

```
T1 → T2 → T3 (pivot) → T4 → T5
          ↑ failure
C2 ← C1   (compensate in reverse)
```

### Choreography vs Orchestration

#### Choreography (Event-Driven)

Each service publishes domain events. Other services subscribe and react.

```
OrderService                PaymentService              InventoryService
    |                            |                            |
    |-- OrderCreated ----------->|                            |
    |                            |-- PaymentCharged --------->|
    |                            |                            |-- InventoryReserved -->
    |<--------------------------------------------------------|
    |   (OrderConfirmed)
```

If payment fails:
```
OrderService                PaymentService
    |                            |
    |<-- PaymentFailed ----------|
    |   (cancel order)
```

**Pros:**
- No central coordinator — each service is autonomous
- Loose coupling — services only know about events, not each other
- Simple for short sagas (2-3 steps)

**Cons:**
- Hard to understand the full flow — the logic is scattered across services
- Adding a new step means modifying multiple services' event subscriptions
- Difficult to handle complex branching or conditional logic
- Cycle risk — circular event chains can create infinite loops

#### Orchestration (Central Coordinator)

A saga orchestrator (sometimes called a saga execution coordinator, or SEC) defines the sequence. It tells each service what to do and handles the compensation logic.

```typescript
// Conceptual orchestrator — the saga definition
const createOrderSaga = {
  steps: [
    { service: 'PaymentService',   action: 'chargeCard',      compensation: 'refundCard' },
    { service: 'InventoryService', action: 'reserveItems',    compensation: 'releaseItems' },
    { service: 'ShippingService',  action: 'createShipment',  compensation: 'cancelShipment' },
  ],
};
```

The orchestrator:
1. Calls `PaymentService.chargeCard()`.
2. If successful, calls `InventoryService.reserveItems()`.
3. If successful, calls `ShippingService.createShipment()`.
4. If step 3 fails, calls `InventoryService.releaseItems()`, then `PaymentService.refundCard()`.

**Pros:**
- Full flow is visible in one place — easy to understand and debug
- Complex branching, conditional steps, and parallel steps are straightforward
- Adding a step means modifying only the orchestrator
- The orchestrator can persist its state for crash recovery

**Cons:**
- Risk of centralizing too much logic — the orchestrator can become a "god service"
- Orchestrator is a single point of failure (mitigated by making it stateless + durable state store)
- Slightly tighter coupling — the orchestrator knows about all participant services

#### When to Choose Which

| Factor | Choreography | Orchestration |
|---|---|---|
| Number of steps | 2-3 | 4+ |
| Branching logic | Minimal | Complex |
| Team structure | Each team owns a service | One team owns the flow |
| Debuggability | Harder (distributed trace) | Easier (orchestrator logs) |
| Coupling | Looser | Tighter to orchestrator |

### Compensating Transactions: The Hard Part

Compensations are not rollbacks. A rollback undoes work as if it never happened. A compensation is a *new* forward action that semantically reverses the effect.

**Why the distinction matters:**

- A payment charge followed by a refund is not invisible — the customer sees two transactions on their statement.
- An inventory reservation followed by a release might happen after another customer grabbed the last item.
- A sent email cannot be unsent — you send a *new* email saying "Sorry, your order was cancelled."

**Design rules for compensations:**

1. **Compensations must be idempotent.** If the compensation message is delivered twice, applying it twice must be safe.
2. **Compensations must always succeed.** They should be retriable. If a refund API is down, retry with exponential backoff. If it permanently fails, alert a human.
3. **Compensations must handle the case where the forward action never completed.** If `chargeCard` timed out and you don't know whether it succeeded, `refundCard` must handle "nothing to refund" gracefully.

### Handling Partial Failures and Intermediate States

Because sagas don't provide isolation, other operations can observe intermediate states:

- A customer's order might show as "placed" while payment hasn't been charged yet.
- Inventory might be reserved but the order hasn't been confirmed.

**Mitigation strategies:**

1. **Semantic locks:** Add a status field (`PENDING`, `CONFIRMED`, `CANCELLED`) that acts as a soft lock. Other operations check the status before acting on the entity.
2. **Commutative updates:** Design operations so the order of concurrent saga steps doesn't matter.
3. **Pessimistic view:** Show conservative data to users. Don't show "Order confirmed" until the saga is fully complete.
4. **Reread value:** Before compensating, re-read the current state to ensure it hasn't been modified by another saga.

### Worked Example: Order → Payment → Inventory

```
Happy path:
  1. OrderService: Create order (status: PENDING)
  2. PaymentService: Charge customer's card
  3. InventoryService: Reserve items, decrement stock
  4. OrderService: Update order (status: CONFIRMED)

Payment fails:
  1. OrderService: Create order (status: PENDING)         ✓
  2. PaymentService: Charge card                          ✗ (declined)
  3. OrderService: Compensate → Update order (status: CANCELLED)

Inventory fails:
  1. OrderService: Create order (status: PENDING)         ✓
  2. PaymentService: Charge card                          ✓
  3. InventoryService: Reserve items                      ✗ (out of stock)
  4. PaymentService: Compensate → Refund card
  5. OrderService: Compensate → Update order (status: CANCELLED)
```

### Saga State Persistence

The orchestrator must persist its state so it can resume after a crash:

```typescript
interface SagaState {
  sagaId: string;
  currentStep: number;
  status: 'RUNNING' | 'COMPENSATING' | 'COMPLETED' | 'FAILED';
  completedSteps: Array<{
    step: number;
    result: 'SUCCESS' | 'FAILURE';
    timestamp: number;
  }>;
}
```

Store this in a database. On restart, the orchestrator queries for sagas in `RUNNING` or `COMPENSATING` status and resumes them. This is critical — a crash during compensation leaves the system in an inconsistent state if not recovered.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites
**Compensation that can't compensate.** You charged a credit card and the refund API is permanently down. Or you sent a physical shipment and need to "undo" it. Design compensations before the happy path — if you can't define a compensation, you can't use a saga for that step. Consider making the irreversible step the *last* step (the pivot point).

**Observability gap.** A saga spans 5 services and takes 30 seconds to complete. Without a correlation ID threaded through every event and a way to visualize the saga's state machine, debugging a stuck saga is guesswork. Build a saga dashboard that shows each instance's current step, time in state, and retry count.

**Zombie sagas.** A saga starts, step 2 times out, compensation runs, but step 2 actually completed (late response). Now you have both the forward action and the compensation applied. This is the "dual write" problem. Mitigate by making compensations check current state before acting: "refund only if charge status is CHARGED."

**Semantic lock contention.** If orders for the same product are sagas with `PENDING` status, a second order might see the first's inventory reservation and incorrectly think stock is available. Use reservation-based semantics: `available_stock = total - reserved`, and track reservations explicitly.
:::

## 🎯 Checkpoint

::: details Question 1 — 2PC vs Sagas
**Q:** Why can't you use two-phase commit (2PC) across microservices that each have their own database?

**A:** 2PC requires all participants to support the XA protocol, hold locks during the prepare phase, and remain available throughout. In microservices, each service has an independent database (often different database technologies), services may be temporarily unavailable, and holding locks across network boundaries creates unacceptable latency and availability risk. If the coordinator crashes during the prepare phase, all participants are stuck holding locks. Sagas avoid these problems by using local transactions only, at the cost of losing isolation between concurrent operations.
:::

::: details Question 2 — Choreography Failure
**Q:** In a choreographed saga with services A → B → C, service B publishes a "B completed" event but C never processes it because the message broker lost the message. What happens?

**A:** The saga stalls indefinitely — C never knows it should act, and there's no orchestrator monitoring overall progress. This is why choreography requires reliable messaging (persistent messages, at-least-once delivery) and timeout mechanisms. A common fix is a "saga watchdog" that detects sagas stuck in an intermediate state beyond a threshold and either retries the event or triggers compensation. With orchestration, the orchestrator itself handles this by retrying the step on timeout.
:::

::: details Question 3 — Idempotent Compensations
**Q:** Why must compensating transactions be idempotent?

**A:** Because message delivery in distributed systems is at-least-once. The "refund card" compensation message might be delivered twice (broker retry, network glitch, orchestrator restart). If the refund isn't idempotent, the customer gets refunded twice. Implementation: use an idempotency key (e.g., the saga ID + step number) and check whether the compensation has already been applied before executing it.
:::

## 🏗️ Design It

**Scenario:** Design a booking system where reserving a hotel, flight, and car rental must either all succeed or all roll back.

::: details Worked Solution
**Approach: Orchestrated saga with a `BookingOrchestrator`.**

**Why orchestration over choreography:** Three external integrations (hotel, airline, car rental) with complex failure handling and the need for clear timeout management. The flow is linear and visibility into the overall state is critical.

**Saga Definition:**

| Step | Service | Action | Compensation |
|---|---|---|---|
| 1 | FlightService | `reserveFlight(flightId, holdUntil)` | `cancelFlightReservation(confirmationId)` |
| 2 | HotelService | `reserveRoom(hotelId, dates)` | `cancelRoomReservation(confirmationId)` |
| 3 (pivot) | CarRentalService | `reserveCar(location, dates)` | `cancelCarReservation(confirmationId)` |
| 4 | PaymentService | `chargeTotal(amount)` | *(retriable — must succeed)* |
| 5 | BookingService | `confirmBooking(bookingId)` | *(retriable — must succeed)* |

**Design decisions:**

1. **Reservation with hold time.** Each external provider gives us a reservation with a hold expiry (e.g., 15 minutes). This acts as a natural timeout. If the saga doesn't complete within the hold window, the provider auto-releases the reservation.

2. **Pivot at step 3.** After car rental is reserved, all three resources are held. Steps 4 and 5 (payment and confirmation) are *retriable* — if payment fails, we retry with backoff. We don't compensate steps 1-3 unless payment permanently fails (e.g., card declined after 3 attempts).

3. **State machine for the orchestrator:**

```
CREATED → RESERVING_FLIGHT → RESERVING_HOTEL → RESERVING_CAR
  → CHARGING_PAYMENT → CONFIRMING → COMPLETED

Any step failure → COMPENSATING → CANCELLED
```

4. **Failure scenario — hotel unavailable:**
   - Flight reserved successfully (confirmation: FLT-123)
   - Hotel reservation fails (no availability)
   - Orchestrator enters COMPENSATING state
   - Calls `cancelFlightReservation(FLT-123)`
   - Updates booking status to CANCELLED
   - Returns error to user: "Hotel unavailable for selected dates"

5. **Failure scenario — orchestrator crashes mid-saga:**
   - Saga state is persisted to database after each step transition
   - On restart, a recovery process queries for sagas in non-terminal states
   - It resumes from the last persisted state
   - Even if the saga is abandoned, the hold-time reservations expire naturally — this is the safety net

6. **Idempotency:**
   - Each service call includes the `bookingId` + step number as an idempotency key
   - If the flight was already reserved for this booking, `reserveFlight` returns the existing confirmation instead of creating a duplicate

7. **User experience:**
   - User sees "Booking in progress..." with a booking ID
   - Frontend polls `/bookings/{id}/status` every 2 seconds
   - Typical completion: 3-8 seconds
   - If the saga takes longer than 30 seconds, UI shows "This is taking longer than usual" with the option to cancel

**Monitoring:**
- Dashboard showing saga instances by state, with alerts for sagas stuck in a non-terminal state for more than the hold-time window
- Correlation ID links the saga to all downstream service calls for distributed tracing
:::

## Key Mental Models

- **Sagas trade isolation for availability.** You lose the "I" in ACID, but you gain the ability to work across service boundaries without global locks.
- **Every forward step needs a compensation step defined *before* you write the happy path.** If you can't compensate, restructure the saga so that step is the pivot.
- **Choreography for simple flows, orchestration for complex ones.** Three services with linear flow? Choreography. Five services with conditional logic? Orchestration.
- **Compensations are not rollbacks.** They are new forward actions that semantically reverse an effect. They must be idempotent and retriable.
- **The pivot point separates compensatable steps from retriable steps.** Design your saga so irreversible actions come after the pivot.

## Related

- [Sync vs Async Communication](./01-communication)
- [Distributed Failure Modes](./03-failure-modes)
- [Delivery Semantics](/system-design/queues/03-delivery-semantics)
