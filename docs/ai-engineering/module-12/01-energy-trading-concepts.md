---
title: Energy Trading Concepts
outline: deep
---

# Energy Trading Concepts

🔥🔥🔥 Domain knowledge · Prerequisites: [Module 8 AI Architecture](../module-08/01-ai-system-patterns)

## 🗣️ In Plain English

::: tip In Plain English
Imagine the world runs on a single commodity — oil — and every country, airline, heating company, and factory needs it. The problem is that oil is produced in a few places (Saudi Arabia, Texas, the North Sea) and consumed everywhere. Getting it from there to here takes weeks. Prices swing based on weather, wars, hurricanes, OPEC meetings, and whether a refinery in Houston had a fire this morning.

To survive in this world, companies need to plan ahead. An airline knows it will burn 10 million gallons of jet fuel next quarter. If oil spikes from $80 to $130, that's an extra $500 million in costs — potentially fatal. So the airline doesn't just buy fuel when it needs it; it **locks in prices in advance** using contracts called **futures**. A futures contract is simply a promise: "I will buy 1,000 barrels of oil in three months at exactly $85, no matter what the spot price is then."

That's the core of energy trading: **separating the decision of when to buy from the act of buying**. Traders and risk managers spend their days asking: is the current price fair? Will it go up or down? How do we protect the company if we're wrong?

**Crude oil** is the raw material drilled out of the ground. Before it's useful, it must be **refined** into products: gasoline, diesel, jet fuel, heating oil. Two benchmark crude oils define global prices. **Brent** is drilled in the North Sea off Scotland and trades in London — it's the global reference price. **WTI (West Texas Intermediate)** is drilled in Texas and trades in Cushing, Oklahoma — it's the US reference price. They're usually close but diverge when there's a pipeline bottleneck or regional supply shock.

When you're long (you've bought contracts), rising prices make you money. When you're short (you've sold contracts you don't own yet), falling prices make you money. Your **P&L** (profit and loss) is how much you've made or lost today. Your **risk** is how much you could lose if prices move against you. **Hedging** is deliberately taking a position that offsets your risk — like the airline buying futures. It's insurance, not speculation.

Options are a step beyond futures. They give you the **right but not the obligation** to buy or sell at a fixed price. You pay a premium upfront. If the price moves your way, you exercise the option. If it doesn't, you let it expire and only lose the premium. Options are used to protect against extreme scenarios while keeping upside.
:::

## ⚙️ Under the Hood

### Market Structure

Energy markets layer from physical commodity to financial derivative:

```
Physical Layer       → Spot market: actual barrels, actual delivery
Futures Layer        → Standardized contracts: delivery in N months
Options Layer        → Rights on futures: calls (right to buy) and puts (right to sell)
Swaps Layer          → OTC (over-the-counter): customized cashflow exchanges
Structured Products  → Combinations: collars, spreads, swaptions
```

**Exchange-traded vs OTC**: CME Group (NYMEX) and ICE list standardized futures. OTC instruments trade bilaterally between counterparties, carry counterparty credit risk, and require ISDA Master Agreements.

### Benchmark Crude Oils

| Benchmark | Location | Exchange | Sulfur | API Gravity | Role |
|-----------|----------|----------|--------|-------------|------|
| Brent | North Sea | ICE London | ~0.37% | ~38° | Global reference; 70% of world oil priced off Brent |
| WTI | Cushing, OK | NYMEX Chicago | ~0.24% | ~39.6° | US reference; constrained by pipeline infrastructure |
| Dubai/Oman | Middle East | DME | ~2% | ~31° | Asian benchmark; sour crude proxy |

**The Brent-WTI spread** is a frequently traded pair. It widens when US pipeline capacity is constrained (WTI gets cheaper relative to Brent because it can't easily leave the US) and narrows when export terminals open.

### Futures Contract Mechanics

A WTI crude futures contract (CL on NYMEX):
- **Size**: 1,000 barrels
- **Tick**: $0.01/barrel = $10/contract
- **Margin**: ~$5,000–$8,000 initial margin (changes with volatility)
- **Settlement**: Physical delivery at Cushing, Oklahoma, OR cash settlement if rolled before expiry
- **Expiry**: 3rd business day before the 25th calendar day of the month preceding delivery

```python
# run: python energy_futures.py

from dataclasses import dataclass
from datetime import date
from typing import Literal

@dataclass
class FuturesPosition:
    instrument: str          # e.g. "CLZ24" = WTI December 2024
    direction: Literal["long", "short"]
    contracts: int           # number of contracts
    entry_price: float       # $/barrel
    contract_size: int = 1000  # barrels per contract

    def pnl(self, current_price: float) -> float:
        """Mark-to-market P&L in USD."""
        price_move = current_price - self.entry_price
        if self.direction == "short":
            price_move = -price_move
        return price_move * self.contracts * self.contract_size

    def dollar_per_tick(self) -> float:
        """Value of a 1-cent move."""
        return 0.01 * self.contracts * self.contract_size

# Airline hedging example
hedge = FuturesPosition(
    instrument="CLZ25",
    direction="long",
    contracts=10_000,      # hedging 10 million barrels (simplified; airlines use jet fuel swaps)
    entry_price=85.00
)

# Oil spikes to $130
print(f"P&L at $130: ${hedge.pnl(130.00):,.0f}")    # +$450,000,000
# Oil falls to $70
print(f"P&L at $70:  ${hedge.pnl(70.00):,.0f}")     # -$150,000,000
# The airline doesn't care about the futures loss — their physical fuel is also cheaper
print(f"Dollar per tick: ${hedge.dollar_per_tick():,.0f}")  # $100,000 per cent
```

### Options Terminology

```python
# run: python options_basics.py

from dataclasses import dataclass
import math
from typing import Literal

@dataclass
class EnergyOption:
    option_type: Literal["call", "put"]
    underlying_price: float   # current spot/futures price (S)
    strike: float             # contract strike price (K)
    time_to_expiry: float     # in years (T)
    volatility: float         # annualized implied vol (σ)
    risk_free_rate: float     # (r)
    premium: float            # what you paid for it

    def intrinsic_value(self) -> float:
        """Value if exercised right now."""
        if self.option_type == "call":
            return max(0, self.underlying_price - self.strike)
        return max(0, self.strike - self.underlying_price)

    def is_itm(self) -> bool:
        return self.intrinsic_value() > 0

    def breakeven(self) -> float:
        if self.option_type == "call":
            return self.strike + self.premium
        return self.strike - self.premium

    def pnl_at_expiry(self, expiry_price: float) -> float:
        """P&L per barrel at option expiry."""
        if self.option_type == "call":
            payoff = max(0, expiry_price - self.strike)
        else:
            payoff = max(0, self.strike - expiry_price)
        return payoff - self.premium


# Refinery buying a put to protect against oil price collapse
put = EnergyOption(
    option_type="put",
    underlying_price=85.0,
    strike=80.0,            # right to sell at $80 even if market crashes
    time_to_expiry=0.25,    # 3 months
    volatility=0.35,        # 35% implied vol — energy is volatile
    risk_free_rate=0.05,
    premium=3.20            # cost per barrel
)

print(f"Breakeven: ${put.breakeven():.2f}/bbl")  # $76.80
print(f"P&L if oil → $60: ${put.pnl_at_expiry(60):.2f}/bbl")   # +$16.80
print(f"P&L if oil → $90: ${put.pnl_at_expiry(90):.2f}/bbl")   # -$3.20 (premium lost)
```

### Greeks — Risk Sensitivities

Options and complex positions are managed through their **Greeks**: sensitivities to market variables.

| Greek | Definition | Physical intuition |
|-------|-----------|-------------------|
| **Delta (Δ)** | dV/dS — how much position value changes per $1 move in oil | 0.5 delta call ≈ half a barrel of oil |
| **Gamma (Γ)** | d²V/dS² — how delta changes as oil moves | High gamma = position accelerates its gains/losses |
| **Theta (Θ)** | dV/dt — daily time decay | Options lose value as expiry approaches, all else equal |
| **Vega (ν)** | dV/dσ — sensitivity to implied volatility | Hurricanes → vol spikes → options get expensive |
| **Rho (ρ)** | dV/dr — sensitivity to interest rates | Minor for short-dated energy options |

### P&L Components

A trading book's daily P&L decomposes as:

```
Total P&L = Delta P&L + Gamma P&L + Theta P&L + Vega P&L + Unexplained
```

Where:
- **Delta P&L** = Δ × price move (directional exposure)
- **Gamma P&L** ≈ ½ × Γ × (price move)² (convexity benefit/cost)
- **Theta P&L** = Θ × time (daily bleeding for option buyers)
- **Vega P&L** = ν × volatility change (vol surface shift)

### Risk Metrics

| Metric | Definition | Usage |
|--------|-----------|-------|
| **VaR (Value at Risk)** | Maximum expected loss over N days at X% confidence | Regulatory capital; daily risk limits |
| **CVaR / Expected Shortfall** | Expected loss beyond VaR threshold | Better for fat-tailed distributions (energy) |
| **DV01** | Dollar change per 1bps interest rate move | Interest rate books; swap desks |
| **PV01** | Present value of 1bps | Fixed-income hybrid instruments |
| **Delta equivalent** | Total directional exposure in barrel-equivalent | Aggregating across products |

```python
# run: python var_calc.py

import numpy as np

def historical_var(returns: np.ndarray, confidence: float = 0.99, horizon_days: int = 1) -> float:
    """
    Historical simulation VaR.
    Returns: VaR as a positive number (loss).
    """
    sorted_returns = np.sort(returns)
    index = int((1 - confidence) * len(sorted_returns))
    daily_var = -sorted_returns[index]
    return daily_var * np.sqrt(horizon_days)

def expected_shortfall(returns: np.ndarray, confidence: float = 0.99) -> float:
    """CVaR: average of losses beyond VaR."""
    var = historical_var(returns, confidence)
    tail_losses = -returns[returns < -var]
    return float(np.mean(tail_losses)) if len(tail_losses) > 0 else var

# Simulate 2 years of daily WTI returns
np.random.seed(42)
# Energy returns are fat-tailed: use t-distribution with low df
daily_returns = np.random.standard_t(df=4, size=504) * 0.025  # ~2.5% daily vol

position_value = 85_000_000  # $85M book (1M barrels at $85)

var_1d_99 = historical_var(daily_returns) * position_value
es_1d_99 = expected_shortfall(daily_returns) * position_value

print(f"1-day 99% VaR:  ${var_1d_99:,.0f}")
print(f"1-day 99% CVaR: ${es_1d_99:,.0f}")
print(f"10-day 99% VaR: ${var_1d_99 * np.sqrt(10):,.0f}")
```

### Hedging Strategies

```python
# run: python hedging.py

from dataclasses import dataclass
from typing import Literal

@dataclass
class HedgeRatio:
    """Minimum-variance hedge ratio calculation."""
    physical_position_barrels: int
    futures_contract_size: int = 1000

    def naive_ratio(self) -> int:
        """1:1 hedge — simple but ignores basis risk."""
        return self.physical_position_barrels // self.futures_contract_size

    def minimum_variance_ratio(self, correlation: float, spot_std: float, futures_std: float) -> int:
        """
        Optimal hedge ratio = correlation * (spot_std / futures_std)
        Adjusts for basis risk between spot physical and futures.
        """
        h_star = correlation * (spot_std / futures_std)
        contracts = int(h_star * self.physical_position_barrels / self.futures_contract_size)
        return contracts


# Three hedging strategies
print("=== Hedging Strategies ===\n")

# 1. Perfect hedge (airline, fixed-price contract)
exposure = HedgeRatio(physical_position_barrels=1_000_000)
naive = exposure.naive_ratio()
print(f"1. Naive (1:1) hedge: {naive} contracts = {naive * 1000:,} barrels")

# 2. Minimum variance hedge (physical crude, basis risk to Brent futures)
mv = exposure.minimum_variance_ratio(
    correlation=0.92,    # Brent-WTI spread introduces basis risk
    spot_std=0.032,      # 3.2% daily vol in physical WTI
    futures_std=0.031    # 3.1% daily vol in WTI futures
)
print(f"2. Min-variance hedge: {mv} contracts (correlation = 0.92)")

# 3. Collar — buy put + sell call (zero-cost or near-zero-cost protection)
print("\n3. Collar structure:")
print("   Buy $75 put @ $2.50/bbl  → protection if oil falls below $75")
print("   Sell $95 call @ $2.40/bbl → give up upside above $95")
print("   Net premium: -$0.10/bbl  → near-zero-cost protection band [$75, $95]")
```

## 💥 Where It Bites (Production Lens)

::: warning Where It Bites

**Basis risk underestimated**: A gas utility hedges its physical gas purchases using Henry Hub (HH) NYMEX futures. A polar vortex causes local basis (the spread between HH and their delivery point) to spike from $0.20/MMBtu to $8.00/MMBtu. Their futures hedge is profitable, but their physical gas costs $7.80 more than the hedge offset. Basis risk — the mismatch between the hedging instrument and the physical exposure — is often the largest unhedged risk in energy books.

**Model P&L ≠ Realized P&L**: A trading system computes intraday P&L using mid-market prices. At 4pm, the position is +$2.3M. At close, the trader unwinds and realizes +$1.1M. The difference is **market impact** (moving the market while exiting) plus **bid-ask spread**. AI models trained on mid prices systematically overestimate realized returns. Use transaction-cost-adjusted backtests.

**Curve construction errors cascade**: Energy trading desks use forward curves (the implied price of oil 1, 2, 3, ... 36 months out). These curves are bootstrapped from liquid near-dated futures and interpolated for illiquid far dates. A bug in the cubic spline interpolation creates $0.30/bbl mispricing in months 18-24. Automated trading algorithms hit thousands of these mispricings before anyone notices. In energy, always have independent curve construction and cross-checks against broker marks.

**Options assignment at expiry**: An automated system manages a book of WTI call options. Expiry occurs at 2:30pm ET. The system does not handle the ITM assignment — the option expires, 5,000 long barrels are assigned, and the system has no physical delivery infrastructure for Cushing. The company takes an emergency cash settlement at a $400K discount. Options expiry handling is a production operations requirement, not just a calculation.
:::

## 🎯 Checkpoint

::: details Question 1 — Futures vs Options Risk Profile
**Q:** A gas producer wants protection if natural gas prices fall below $3.00/MMBtu but wants to keep the upside if prices rise. Should they use futures or options? Explain the risk profile of each choice.

**A:** Futures lock in the price completely: the producer sells futures at $3.00, so if prices fall to $2.00 they gain $1.00 on the futures (offsetting the physical loss), but if prices rise to $4.00, they lose $1.00 on the futures (offsetting the physical gain). Full protection, full upside surrender.

Options give asymmetric protection: the producer buys put options at $3.00/MMBtu, paying a premium (say $0.15/MMBtu). If prices fall to $2.00, the put pays $1.00 but they netted only $0.85 after premium. If prices rise to $4.00, the put expires worthless — they lose $0.15 premium but keep the $1.00 physical upside. Options are insurance: you pay a premium to retain upside while capping downside. The correct choice depends on the company's premium budget and their tolerance for upside participation.
:::

::: details Question 2 — VaR Limitations for Energy
**Q:** Why is historical VaR often inadequate for energy trading books? Name two limitations and describe how the energy market specifically exacerbates them.

**A:**
1. **Fat tails**: Historical VaR assumes the loss distribution is captured by the historical window. Energy markets have power-law tails — extreme events (Gulf hurricanes, geopolitical supply cuts, polar vortices) occur far more often than normal distributions predict. A 99% VaR calibrated to a calm 250-day window completely misses a 10-sigma event. The solution is CVaR/Expected Shortfall and stress testing against named scenarios (Hurricane Katrina, Ukraine invasion).

2. **Non-stationarity**: Market regimes change. A 2020 historical window includes the COVID demand crash and negative WTI prices (May 2020 — WTI briefly traded at -$37/barrel because storage was physically full). Including this in a 2024 VaR model creates a wildly conservative estimate; excluding it creates a dangerous blind spot. Energy markets regularly transit between backwardation (front-month premium, physical scarcity) and contango (front-month discount, storage glut) regimes, and risk profiles differ fundamentally between regimes.
:::

## Key Mental Models

1. **Futures separate timing from price** — you commit to a price now and take delivery (or cash settle) later. This is the foundation of all energy hedging.

2. **Long physical commodity = short volatility** — a refinery sitting on oil inventory is hurt by price drops, so they buy puts (long volatility) to offset. Position direction implies natural hedge instrument direction.

3. **Basis risk is the hedge's hedge risk** — the spread between your physical price and your futures contract is itself a source of risk that cannot be fully eliminated, only measured and accepted.

4. **Options give asymmetry at a price** — the premium you pay for an option is fair compensation for keeping one-sided exposure. Zero-cost structures (collars) exist but they trade upside for protection, not free protection.

5. **VaR is a floor estimate, not a ceiling** — it tells you "we won't lose more than X on 99 out of 100 days." The hundredth day is what risk managers actually fear.

## Related

- [12.2 AI in Trading Architecture](./02-ai-in-trading-architecture) — where these concepts meet AI systems
- [12.3 LLM + Quant Models](./03-llm-plus-quant) — how LLMs interpret these signals while quant models calculate
- [Module 9 — LLMOps & Evaluation](../module-09/) — evaluation frameworks relevant to trading AI
