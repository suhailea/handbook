---
title: AI in Trading Architecture
outline: deep
---

# AI in Trading Architecture

🔥🔥🔥 Architecture · Prerequisites: [Energy Trading Concepts](./01-energy-trading-concepts) · [AI System Patterns](../module-08/01-ai-system-patterns)

## 🗣️ In Plain English

::: tip In Plain English
Imagine a trading floor in 1995. Dozens of traders sit at desks, phones pressed to their ears, watching screens full of numbers and shouting buy/sell orders. Each trader has a specialty — one watches crude oil, one watches refined products, one watches weather forecasts. Their job is to synthesize a flood of information and turn it into a decision in seconds.

Now imagine a second layer: the risk manager standing behind them. While traders make decisions, the risk manager watches the entire book. The moment a trader's position grows too large, the risk manager can override them — or at least force them to explain themselves. There are hard rules: no single position can exceed X barrels, no single bet can risk more than Y million dollars, no trade can happen without two approvals for amounts above Z.

AI in trading plays the same roles — but faster and at scale. The **LLM layer** is the trader: it reads news articles, analyst reports, earnings calls, weather data, and geopolitical briefings and synthesizes a view. "OPEC meeting surprised to the downside, Saudi Arabia announcing increased output — bearish signal for Brent near term." This is interpretation: taking unstructured information and forming a directional view in natural language.

The **quantitative model layer** is the risk manager: it takes that view, plugs it into a mathematical framework, calculates exact position sizes, runs the risk metrics (VaR, Greeks, delta equivalent), checks against every limit in the rulebook, and only then generates an order. The math is deterministic. The risk checks are hard-coded. No LLM output can bypass these gates.

This separation is not a design choice — it is a regulatory and fiduciary requirement. If an algorithm causes a $100 million loss, your risk committee needs to explain exactly what happened, step by step, to the regulator. "The LLM decided to buy" is not an acceptable explanation. "The momentum model generated a signal, the position sizing algorithm allocated 2,000 contracts within VaR limits, and the order management system executed at VWAP" — that is.

The architecture of trading AI is therefore: **LLM interprets signals, quant models make decisions, deterministic controls gate execution**.
:::

## ⚙️ Under the Hood

### Full AI Trading Stack

```
┌─────────────────────────────────────────────────────────────────────┐
│                     SIGNAL INGESTION LAYER                          │
│  News APIs  │  Market Data Feeds  │  Weather  │  Shipping/AIS Data  │
│  (Bloomberg Terminal, Refinitiv, OPIS, Platts, ICE Connect)         │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     LLM INTERPRETATION LAYER                        │
│  • News summarization and sentiment scoring                         │
│  • Fundamental analysis extraction (supply/demand narratives)       │
│  • Earnings call parsing (refinery utilization, capex plans)        │
│  • Geopolitical event classification (sanction risk, route risk)    │
│  Output: structured JSON signals with confidence and reasoning      │
└─────────────────────────┬───────────────────────────────────────────┘
                          │ Structured JSON signals
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   QUANTITATIVE MODEL LAYER                          │
│  • Time-series forecasting (ARIMA, LSTM, XGBoost)                  │
│  • Statistical arbitrage signals (spread models, cointegration)     │
│  • Fundamental valuation models (crack spreads, refinery margins)   │
│  • Options pricing (Black-76 for energy, local vol surfaces)        │
│  Output: directional signals, target prices, confidence intervals   │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   PORTFOLIO MANAGEMENT LAYER                        │
│  • Signal aggregation (alpha model: weighted combination)           │
│  • Position sizing (Kelly criterion, risk parity, vol targeting)    │
│  • Correlation and concentration risk management                    │
│  Output: target positions per instrument                            │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      RISK CHECK LAYER ← HARD GATE                  │
│  • Pre-trade VaR check (reject if limit breached)                   │
│  • Position limit check (per instrument, per sector, book total)    │
│  • Notional limit check (regulatory and internal)                   │
│  • Counterparty credit limit check                                  │
│  • Market hours and liquidity check                                 │
│  • Human approval gate for trades above threshold                   │
│  Output: approved or rejected, with reason code                     │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   ORDER MANAGEMENT SYSTEM (OMS)                     │
│  • Order routing (exchange vs dark pool vs broker RFQ)              │
│  • Execution algorithms (TWAP, VWAP, implementation shortfall)      │
│  • Transaction cost analysis (TCA)                                  │
│  • Confirmation and settlement                                      │
└─────────────────────────┬───────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    REPORTING & AUDIT LAYER                          │
│  • Real-time P&L attribution                                        │
│  • End-of-day risk report                                           │
│  • Regulatory reporting (EMIR, MiFID II, CFTC)                     │
│  • Audit trail: every signal, decision, and execution logged        │
└─────────────────────────────────────────────────────────────────────┘
```

### Signal Pipeline Implementation

```typescript
// run: npx tsx signal-pipeline.ts

interface RawMarketSignal {
  source: "news" | "market_data" | "fundamental" | "weather" | "shipping";
  timestamp: Date;
  content: string;
  instrument: string;
}

interface InterpretedSignal {
  instrument: string;
  direction: "bullish" | "bearish" | "neutral";
  confidence: number;           // 0–1
  horizon: "intraday" | "1w" | "1m" | "3m";
  reasoning: string;
  source_signal_id: string;
  llm_model: string;
  created_at: Date;
}

interface QuantSignal {
  instrument: string;
  alpha_score: number;          // z-score of expected return
  target_price: number;
  lower_bound: number;          // 90% confidence interval
  upper_bound: number;
  model: string;
  features_used: string[];
}

interface TradeProposal {
  instrument: string;
  direction: "buy" | "sell";
  quantity_contracts: int;
  limit_price: number;
  time_in_force: "day" | "gtc" | "ioc";
  rationale: {
    llm_signals: InterpretedSignal[];
    quant_signal: QuantSignal;
    position_sizing_method: string;
  };
}

type int = number;

class LLMSignalInterpreter {
  private readonly model = "gpt-4o";
  private readonly systemPrompt = `You are an energy markets analyst.
  Analyze market signals and return a structured JSON with:
  - direction: bullish | bearish | neutral
  - confidence: 0-1 (be conservative; default to neutral if uncertain)
  - horizon: intraday | 1w | 1m | 3m
  - reasoning: 1-2 sentence explanation
  Only return valid JSON matching the InterpretedSignal schema.`;

  async interpret(signal: RawMarketSignal): Promise<InterpretedSignal> {
    // In production: call OpenAI/Azure OpenAI with structured output
    // const response = await openai.chat.completions.create({...})
    // Stub for demonstration:
    return {
      instrument: signal.instrument,
      direction: "bearish",
      confidence: 0.72,
      horizon: "1w",
      reasoning: "OPEC+ production increase announcement exceeds consensus by 400K bbl/day; Saudi Arabia signaling market share defense over price support.",
      source_signal_id: `sig-${Date.now()}`,
      llm_model: this.model,
      created_at: new Date(),
    };
  }
}

class QuantSignalEngine {
  /**
   * Pure mathematical signal generation.
   * No LLM involved; uses time-series models and statistical methods.
   */
  async generateSignal(instrument: string, llmSignals: InterpretedSignal[]): Promise<QuantSignal> {
    // In production: run XGBoost/LSTM models on market data + LLM sentiment features
    // LLM signals are just ONE input feature, weighted alongside price momentum,
    // carry, volatility regime, and fundamental indicators

    const llmSentimentScore = llmSignals.reduce((acc, s) => {
      const score = s.direction === "bullish" ? s.confidence
                  : s.direction === "bearish" ? -s.confidence
                  : 0;
      return acc + score;
    }, 0) / Math.max(llmSignals.length, 1);

    // Stub — real implementation runs a trained model
    return {
      instrument,
      alpha_score: llmSentimentScore * 1.2 - 0.1,  // model-adjusted
      target_price: 83.40,
      lower_bound: 79.20,
      upper_bound: 87.10,
      model: "xgb-wti-v3.2.1",
      features_used: ["llm_sentiment", "momentum_5d", "carry", "vol_regime", "cot_positioning"],
    };
  }
}

class PositionSizer {
  private readonly maxVarPercent = 0.01;        // max 1% portfolio VaR per trade
  private readonly portfolioValue = 100_000_000; // $100M portfolio
  private readonly contractSize = 1_000;         // barrels per contract

  sizePosition(signal: QuantSignal, currentPrice: number, dailyVol: number): int {
    // Vol-targeting approach: size so that 1-day 1σ P&L = target risk
    const targetRisk = this.portfolioValue * this.maxVarPercent;
    const dollarVolPerContract = currentPrice * dailyVol * this.contractSize;
    const rawContracts = Math.floor(targetRisk / dollarVolPerContract);

    // Scale by alpha conviction
    const convictionScale = Math.min(Math.abs(signal.alpha_score), 2.0) / 2.0;
    return Math.floor(rawContracts * convictionScale);
  }
}

async function runSignalPipeline(rawSignal: RawMarketSignal): Promise<TradeProposal | null> {
  const interpreter = new LLMSignalInterpreter();
  const quantEngine = new QuantSignalEngine();
  const sizer = new PositionSizer();

  // Step 1: LLM interprets unstructured signal
  const llmSignal = await interpreter.interpret(rawSignal);
  console.log(`LLM: ${llmSignal.direction} (${(llmSignal.confidence * 100).toFixed(0)}%) — ${llmSignal.reasoning}`);

  // Step 2: Quant model generates mathematical signal (using LLM output as one feature)
  const quantSignal = await quantEngine.generateSignal(rawSignal.instrument, [llmSignal]);

  if (Math.abs(quantSignal.alpha_score) < 0.3) {
    console.log(`Signal too weak (alpha_score=${quantSignal.alpha_score.toFixed(3)}), no trade.`);
    return null;
  }

  // Step 3: Position sizing (pure math)
  const currentPrice = 84.50;
  const dailyVol = 0.025;
  const contracts = sizer.sizePosition(quantSignal, currentPrice, dailyVol);

  const proposal: TradeProposal = {
    instrument: rawSignal.instrument,
    direction: quantSignal.alpha_score < 0 ? "sell" : "buy",
    quantity_contracts: contracts,
    limit_price: quantSignal.alpha_score < 0 ? currentPrice - 0.10 : currentPrice + 0.10,
    time_in_force: "day",
    rationale: {
      llm_signals: [llmSignal],
      quant_signal: quantSignal,
      position_sizing_method: "vol_targeting_1pct_var",
    },
  };

  console.log(`Proposed trade: ${proposal.direction} ${proposal.quantity_contracts} contracts @ ${proposal.limit_price}`);
  return proposal;
}

// Example run
const news: RawMarketSignal = {
  source: "news",
  timestamp: new Date(),
  content: "OPEC+ Joint Ministerial Monitoring Committee agrees to increase output by 800K bbl/day starting Q4, exceeding analyst expectations of 400K bbl/day increase.",
  instrument: "CLZ25",
};

runSignalPipeline(news).catch(console.error);
```

### The Risk Check Layer — The Hard Gate

This layer runs **synchronously** before any order reaches the OMS. It cannot be bypassed by any upstream component.

```typescript
// run: npx tsx risk-checks.ts

interface Position {
  instrument: string;
  contracts: number;  // positive = long, negative = short
  entry_price: number;
}

interface RiskLimits {
  max_position_contracts: number;       // per instrument
  max_book_delta_equivalent: number;    // total portfolio in barrel-equivalents
  max_single_trade_notional: number;    // USD
  max_portfolio_var_1d_99: number;      // USD
  require_human_approval_above: number; // contracts
}

interface RiskCheckResult {
  approved: boolean;
  rejection_reason?: string;
  checks_passed: string[];
  checks_failed: string[];
}

const TRADING_LIMITS: RiskLimits = {
  max_position_contracts: 500,
  max_book_delta_equivalent: 10_000_000,  // 10M barrels equivalent
  max_single_trade_notional: 50_000_000,  // $50M per trade
  max_portfolio_var_1d_99: 5_000_000,     // $5M daily VaR limit
  require_human_approval_above: 100,      // contracts
};

async function preTradeRiskCheck(
  proposal: TradeProposal,
  currentBook: Position[],
  currentVaR: number,
  currentPrice: number
): Promise<RiskCheckResult> {
  const passed: string[] = [];
  const failed: string[] = [];

  // Check 1: Position limit
  const existingPosition = currentBook.find(p => p.instrument === proposal.instrument);
  const existingContracts = existingPosition?.contracts ?? 0;
  const newPosition = proposal.direction === "buy"
    ? existingContracts + proposal.quantity_contracts
    : existingContracts - proposal.quantity_contracts;

  if (Math.abs(newPosition) <= TRADING_LIMITS.max_position_contracts) {
    passed.push(`position_limit: ${Math.abs(newPosition)} ≤ ${TRADING_LIMITS.max_position_contracts}`);
  } else {
    failed.push(`position_limit: ${Math.abs(newPosition)} > ${TRADING_LIMITS.max_position_contracts}`);
  }

  // Check 2: Notional limit
  const notional = proposal.quantity_contracts * 1000 * currentPrice;
  if (notional <= TRADING_LIMITS.max_single_trade_notional) {
    passed.push(`notional_limit: $${(notional / 1e6).toFixed(1)}M ≤ $${TRADING_LIMITS.max_single_trade_notional / 1e6}M`);
  } else {
    failed.push(`notional_limit: $${(notional / 1e6).toFixed(1)}M > $${TRADING_LIMITS.max_single_trade_notional / 1e6}M`);
  }

  // Check 3: Incremental VaR (simplified; production uses full revaluation)
  const incrementalVaR = proposal.quantity_contracts * 1000 * currentPrice * 0.025 * 2.326;  // 99% z-score
  const newTotalVaR = currentVaR + incrementalVaR * 0.5;  // diversification benefit assumed
  if (newTotalVaR <= TRADING_LIMITS.max_portfolio_var_1d_99) {
    passed.push(`var_limit: $${(newTotalVaR / 1e6).toFixed(2)}M ≤ $${TRADING_LIMITS.max_portfolio_var_1d_99 / 1e6}M`);
  } else {
    failed.push(`var_limit: $${(newTotalVaR / 1e6).toFixed(2)}M > $${TRADING_LIMITS.max_portfolio_var_1d_99 / 1e6}M`);
  }

  // Check 4: Human approval gate
  if (proposal.quantity_contracts > TRADING_LIMITS.require_human_approval_above) {
    // In production: create approval request in workflow system (ServiceNow, Jira, custom)
    // and BLOCK until approved or timeout
    console.log(`⚠ HUMAN APPROVAL REQUIRED: ${proposal.quantity_contracts} contracts > ${TRADING_LIMITS.require_human_approval_above} limit`);
    // For demo, we'll flag but not block:
    passed.push(`human_approval_gate: flagged_for_review`);
  }

  const approved = failed.length === 0;
  return { approved, checks_passed: passed, checks_failed: failed, rejection_reason: failed[0] };
}

// Example: test a large trade
const testProposal: TradeProposal = {
  instrument: "CLZ25",
  direction: "sell",
  quantity_contracts: 150,
  limit_price: 84.40,
  time_in_force: "day",
  rationale: { llm_signals: [], quant_signal: {} as any, position_sizing_method: "vol_targeting" },
};

const currentBook: Position[] = [
  { instrument: "CLZ25", contracts: 200, entry_price: 86.50 },
];

preTradeRiskCheck(testProposal, currentBook, 2_500_000, 84.50)
  .then(result => {
    console.log(`\nRisk Check: ${result.approved ? "APPROVED" : "REJECTED"}`);
    result.checks_passed.forEach(c => console.log(`  ✓ ${c}`));
    result.checks_failed.forEach(c => console.log(`  ✗ ${c}`));
    if (result.rejection_reason) console.log(`  Reason: ${result.rejection_reason}`);
  });
```

### Data Sources and Latency Tiers

| Data Source | Latency | Cost | Used For |
|-------------|---------|------|----------|
| Bloomberg Terminal B-PIPE | Sub-second | ~$30K/seat/year | Real-time prices, news |
| Refinitiv Elektron | Sub-second | ~$20K/seat/year | Alternative price feed |
| ICE Data Services | Milliseconds | Exchange fee | Exchange prices direct |
| OPIS / Platts | 15-min to daily | Per report | Physical cargo prices |
| EIA Reports | Weekly | Free | US inventory data |
| NOAA Weather | Hourly | Free / commercial | Demand forecasting |
| MarineTraffic (AIS) | 5-min | Commercial | Tanker tracking for supply |
| OpenAI / Azure OpenAI | 200-2000ms | Per token | LLM interpretation |

LLM calls are in the **slow path** (seconds latency). They are never on the critical path for high-frequency signals. LLM analysis runs async and feeds into models that update positions on a slower cycle (minutes to hours).

### Regulatory Considerations

| Regulation | Jurisdiction | Key Requirement |
|-----------|-------------|----------------|
| MiFID II | EU | Algorithm registration; pre/post-trade transparency; kill switch mandatory |
| EMIR | EU | Derivative trade reporting; central clearing for standardized contracts |
| CFTC Part 49 | US | Swap data reporting to SDR |
| MAR | EU | Market abuse regulation; surveillance for spoofing, layering |
| Dodd-Frank | US | Position limits; swap dealer registration for large participants |

Every algorithm operating in EU markets must be **registered with the regulator** (MiFID II RTS 6), have a tested **kill switch** that can halt all trading within seconds, and maintain **complete audit trails** for 5 years.

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Latency mismatch causes stale signals**: An LLM parses a Reuters news article about an OPEC cut and returns a bullish signal 1.8 seconds later. By then, algorithmic traders have already moved WTI up $1.20/bbl. The quantitative model enters long at the new price, holding the cost of the entire news move. LLM signals must be latency-adjusted: either trade in illiquid hours where the edge survives the latency, or accept that LLM-interpreted signals operate on a minutes-to-hours horizon, not seconds.

**Kill switch not tested**: Under MiFID II RTS 6, kill switches must be tested at least annually. A desk neglects the test; during a market dislocation, the kill switch call fails because the OMS dependency has a stale TLS certificate. The algorithm continues sending orders for 4 minutes before manual intervention. Regulators treat this as a trading algorithm failure, triggering a full investigation. Test kill switches in production with synthetic order flow monthly.

**LLM interprets ambiguous news incorrectly**: A Reuters headline reads "Saudi Arabia cuts output to 9M bbl/day". The LLM rates this bullish (interpreting "cuts" as a production reduction). The actual report explains Saudi Arabia was already at 10.2M and "cuts" refers to voluntary restraint in a prior agreement — the 9M figure is higher than the current level. The LLM missed the base. An AI trading signal that processes ambiguous language must have a second-pass validation: if confidence < 0.65, flag for human review rather than feeding to the quant model.

**Model decay after structural break**: An XGBoost model trained on 2019-2022 data learned that EIA inventory draws are bullish. Post-2022, the US Strategic Petroleum Reserve (SPR) release policy makes inventory signals noisy. The model's Sharpe ratio drops from 1.4 to 0.3 over 6 months. Production trading models need continuous backtesting on rolling windows and automated drift detection.
:::

## 🎯 Checkpoint

::: details Question 1 — Where Does LLM Fit in the Stack?
**Q:** A colleague proposes having the LLM directly output "buy 200 CLZ25 contracts at $84.50" rather than a directional signal. What are the two critical problems with this approach?

**A:**
1. **Auditability and regulatory compliance**: MiFID II requires that algorithmic trading decisions be fully explainable and auditable. "The LLM decided to buy 200 contracts" is not a legally sufficient audit trail. The decision must flow through documented, testable models with defined parameters. An LLM's reasoning cannot be deterministically reproduced, making post-hoc audit impossible.

2. **Safety and risk control bypass**: The LLM would be generating position sizes and prices without running through the pre-trade risk check layer (VaR limits, position limits, notional limits). A hallucination or prompt injection could generate "buy 50,000 contracts at market" — executing this would cause a catastrophic market impact and regulatory violation before any human could intervene. The position sizing, limit checks, and execution algorithms are deterministic specifically because they need to be rock-solid regardless of what signals arrive from upstream.
:::

::: details Question 2 — Signal Latency Arbitrage
**Q:** Your LLM signal interpretation layer has a p50 latency of 800ms and p99 of 2,400ms. You are trading WTI futures. In what market conditions or strategies would LLM-interpreted signals still generate alpha despite this latency?

**A:**
LLM-interpreted signals remain valuable when:

1. **Fundamental medium-term views**: Weekly OPEC meetings, monthly EIA forecasts, quarterly earnings calls. These events move markets over hours to days, not milliseconds. An LLM that correctly parses an OPEC surprise at 800ms latency can still generate alpha if the market takes 30 minutes to fully price in the implication for forward curves and refined product spreads.

2. **Illiquid instruments or time zones**: Physical cargo prices (Platts, OPIS assessments), far-dated futures (months 12-36 on the curve), or European trading hours for US contracts. Fewer algorithmic participants means the news impact takes longer to fully incorporate.

3. **Complex multi-source synthesis**: When a correct market view requires synthesizing a weather forecast (Gulf storm), a geopolitical development (Libya production disruption), and a refinery outage report simultaneously, LLMs can synthesize across sources faster than human analysts even at 2-second latency.

4. **Contrarian signals**: When consensus is wrong, being 2 seconds late to a wrong consensus still produces alpha. LLMs that correctly identify when analyst consensus is anchored to stale priors can generate signals that remain valid for hours after the initial latency cost.
:::

## Key Mental Models

1. **LLM in the slow path, quant in the fast path** — LLM signals operate on minutes-to-hours horizons; they are input features to mathematical models, not execution triggers.

2. **The risk check layer has veto power over everyone** — no signal strength, no matter how high confidence, bypasses the pre-trade risk gate. This is enforced architecturally, not culturally.

3. **Every algorithmic trade needs a kill switch that works** — this is not optional infrastructure; it is a regulatory requirement (MiFID II RTS 6) and a market safety obligation.

4. **Latency defines your strategy space** — the latency of your slowest signal source determines which strategies you can run. LLM latency (seconds) means you are in the fundamental/medium-term space, not high-frequency.

5. **Audit trail is the product** — in regulated trading, the algorithm's explainability is as important as its returns. Build the audit layer first, not last.

## Related

- [12.1 Energy Trading Concepts](./01-energy-trading-concepts) — the market concepts this architecture serves
- [12.3 LLM + Quant Models](./03-llm-plus-quant) — deep dive into the LLM interpretation + quant calculation separation
- [Module 11 — Security & Responsible AI](/ai-engineering/module-07/) — security and audit requirements apply here at 10× stakes
