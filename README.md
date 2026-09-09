# AgentDesk

### Inspectable autonomous trading desks for Somnia event contracts

AgentDesk is a trading-intelligence and execution workspace for [DreamDEX](https://docs.dreamdex.io/) event contracts on [Somnia](https://somnia.network/).

It runs five independent strategy desks against live Somnia market data. Each desk publishes a directional forecast before a binary event resolves, explains the evidence behind its decision, and can execute a small, transparent testnet trade from its own wallet. Users can inspect the signal, see the live order book, follow a desk, and copy a trade through their own wallet without giving AgentDesk custody of their funds.

The product is built around a simple principle:

> **Make autonomous trading legible before making it executable.**

AgentDesk is currently a working Somnia testnet prototype. It is not investment advice, and its testnet balances have no monetary value.

---

## What AgentDesk does

For each active BTC or ETH event-contract window, AgentDesk:

1. Reads the Somnia price feed and recent market history.
2. Finds the active DreamDEX binary event contract.
3. Runs five independent strategy desks.
4. Publishes each desk's direction, probability, confidence, rationale, and numeric features.
5. Compares the forecast with the live YES/NO order book.
6. Trades only when the desk passes the configured confidence threshold.
7. Records the prediction and execution as an append-only track record.
8. Reads the finalized on-chain result and marks the prediction WIN, LOSS, or VOID.
9. Updates desk PnL, accuracy, ROI, equity history, and leaderboard rankings.
10. Redeems winning live positions when the market is claimable.

The dashboard also supports non-custodial user execution:

- Connect MetaMask or another injected EVM wallet.
- Inspect multi-level order-book depth before copying a call.
- Walk the live book for an estimated fill.
- See an execution-safety score, maximum loss, spread, price impact, and expiry time.
- Sign the final transaction in the user's own wallet.

AgentDesk never receives a user's private key.

---

## Why Somnia and DreamDEX

Somnia is a strong fit for this product because the application needs a fast, observable execution environment for short-lived event markets. AgentDesk is not simulating a prediction market in a private database. It uses the Somnia ecosystem as the source of truth:

- **Somnia RPC and WebSocket endpoints** provide the chain connection for reads and signed transactions.
- **Somnia's market data stack** provides index prices, price history, candles, and order-book information.
- **DreamDEX event contracts** provide the binary markets that settle against an oracle-defined outcome.
- **On-chain market state** determines whether a market is trading, locked, resolved, or voided.
- **On-chain settlement and redemption** determine the final result and payout.
- **Somnia explorer links** make desk identities and trade transactions publicly auditable.

The project uses:

```text
@somnia-chain/markets-sdk
```

The SDK is used for:

- Watching live prices.
- Fetching historical ticks and candles.
- Loading DreamDEX markets.
- Reading binary market metadata and status.
- Reading YES/NO order books.
- Building and submitting IOC orders.
- Reading positions and claimable balances.
- Redeeming settled positions.

AgentDesk intentionally uses the existing DreamDEX event-contract venue instead of inventing a parallel settlement contract. This keeps the result verifiable by the same oracle and market state that traders use.

### Somnia network configuration

The current defaults target Somnia Shannon testnet:

```text
Indexer: https://dev.smk.somnia.host/v1/graphql
HTTP RPC: https://api.infra.testnet.somnia.network
WebSocket RPC: wss://api.infra.testnet.somnia.network/ws
```

Mainnet URLs can be selected through `DREAMDEX_NETWORK=mainnet`, but mainnet operation requires a separate production-readiness review, secure key management, monitoring, limits, and operational controls.

---

## The five strategy desks

| Desk | Strategy | What it measures |
| --- | --- | --- |
| **Momo** | Momentum Rider | Recent oracle-price slope normalized by realized volatility. |
| **Revert** | Mean Reversion | Spot-to-EMA deviation and the probability of a snap-back. |
| **Arbik** | Mispricing Hunter | Estimated fair probability compared with the market's YES midpoint. |
| **Ranger** | Range Breakout | Short-term movement versus a longer volatility baseline. |
| **Quorum** | Ensemble Vote | Confidence-weighted agreement across the other four desks. |

These are deterministic quantitative strategies today. There is no LLM making the current direction calls. That is intentional: every present signal can be replayed from market data, inspected through its features, and graded against the finalized event outcome.

---

## Decision receipts and execution safety

AgentDesk is designed to be more than an agent leaderboard or a copy-trading button.

### Decision receipts

Every published prediction contains:

- Direction: UP or DOWN.
- Model probability of UP.
- Confidence.
- Source price at signal time.
- Market YES bid, ask, and midpoint.
- Model edge versus the market midpoint.
- Strategy rationale.
- Numeric features used by the desk.
- Whether the desk qualified for execution.
- The final resolved outcome.

This produces a public explanation of what the desk knew and why it acted.

### Execution safety

Before a connected user signs a copy trade, the server reads the live binary book and estimates:

- Expected average entry.
- Number of book levels consumed.
- Expected filled quantity.
- Unfilled quantity that an IOC order would cancel.
- Spread width.
- Slippage versus midpoint.
- Estimated maximum collateral loss.
- Estimated payout if the selected side wins.
- Seconds remaining until expiry.

The quote receives a deterministic safety label:

- **HEALTHY** — sufficient fillability and acceptable market conditions.
- **CAUTION** — execution is possible but the book or timing deserves attention.
- **THIN** — liquidity, spread, price impact, or expiry timing is weak.

This score is an execution check, not a prediction of profit. It does not replace user judgment.

---

## Architecture

```text
Somnia price feed + DreamDEX indexer
                  │
                  ▼
           Market discovery
                  │
                  ▼
          Strategy engine
       Momo / Revert / Arbik
          Ranger / Quorum
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
  Decision receipt      Book-aware execution
        │                   │
        ▼                   ▼
  Append-only state    Agent wallet or user wallet
        │                   │
        └─────────┬─────────┘
                  ▼
       On-chain settlement reader
                  │
                  ▼
       PnL, accuracy, ROI, equity
```

### Current application layers

- `src/agents/index.ts` — quantitative desk definitions and prediction logic.
- `src/engine.ts` — market scanning, prediction lifecycle, execution, settlement, and redemption.
- `src/exchange.ts` — Somnia and DreamDEX SDK adapter.
- `src/store.ts` — append-only local prediction, trade, and equity state.
- `src/server.ts` — Express API, SSE stream, copy-trade transaction builder, and portfolio reader.
- `public/` — vanilla JavaScript trading workspace, order-book display, strategy directory, account view, and charts.
- `scripts/` — smoke checks and raw Somnia/DreamDEX probes.
- `data/Agentwallet.json` — selected per-agent wallet file for live testnet operation; gitignored.

The current local JSON store is appropriate for a hackathon prototype and a single operator. It is not the intended final storage layer for a multi-user production service.

---

## Quick start

### Requirements

- Node.js 20 or newer.
- npm.
- Access to Somnia Shannon testnet for live mode.
- An injected EVM wallet such as MetaMask for manual user trades.

### Install and run paper mode

```bash
npm install
npm start
```

Open:

```text
http://localhost:5000
```

Paper mode reads the real market feed and order book but simulates the autonomous desk fills. It is the recommended starting point.

### Run the health check

With the server running in another terminal:

```bash
BASE=http://127.0.0.1:5000 npm run smoke
```

The smoke check verifies:

- Server status.
- Five registered desks.
- Equity endpoint.
- Prediction flow when a market window is available.
- Active-window discovery when markets are live.
- Settlement outcome shape when resolved data exists.

### Run live testnet mode

Live mode is intentionally explicit:

```bash
PAPER_TRADES=false \
ENABLE_LIVE_TRADING=true \
DREAMDEX_NETWORK=testnet \
npm start
```

Each autonomous desk uses a separate signing wallet. The selected wallet file is:

```text
data/Agentwallet.json
```

The file is gitignored. Never commit it, expose it in the browser, or reuse an autonomous desk wallet as a personal wallet.

Live desks need:

1. Native STT for gas.
2. tUSDC collateral on the testnet venue.
3. A live two-sided market book.
4. An eligible event-contract window with enough time remaining.

The app can call the venue faucet for testnet collateral when `AUTO_FAUCET=true`, but faucet calls still require native gas.

---

## Configuration

Copy `.env.example` to `.env` when local configuration is needed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | HTTP server port. |
| `HOST` | `0.0.0.0` | Bind address. |
| `DREAMDEX_NETWORK` | `testnet` | `testnet` or `mainnet` network selection. |
| `PAPER_TRADES` | `true` | Simulate autonomous fills when true. |
| `ENABLE_LIVE_TRADING` | `false` | Second safety switch for actual autonomous orders. |
| `ASSETS` | `BTC,ETH` | Comma-separated underlying assets. |
| `CADENCE_SEC` | `900` | Event window length; 900 seconds is 15 minutes. |
| `STAKE_CONTRACTS` | `10` | Deterministic autonomous desk size today. |
| `MIN_AGENT_CONFIDENCE` | `0.55` | Minimum confidence required before a desk trades. |
| `SCAN_INTERVAL_MS` | `5000` | Engine scan interval. |
| `MIN_WINDOW_HEADROOM_SEC` | `120` | Minimum time left for an active window. |
| `MIN_MARKET_HEADROOM_SEC` | `150` | Market discovery headroom. |
| `AUTO_FAUCET` | `true` | Request testnet collateral when a desk balance is low. |
| `FAUCET_WHEN_BELOW` | `100` | Collateral threshold for the testnet faucet. |
| `DATA_DIR` | `data` | Local state and wallet directory. |
| `AGENT_WALLETS_FILE` | `Agentwallet.json` | Wallet filename inside `DATA_DIR`. |
| `PRIVATE_KEY` | unset | Legacy development shortcut; avoid for production. |
| `AGENT_<ID>_PRIVATE_KEY` | unset | Per-desk development override. |

In the current workflow, live testnet execution is enabled explicitly by the run command. For production, wallet custody should move from raw local key files to a secure signer or restricted session-key service.

---

## API surface

### Market and system data

```text
GET /api/status
GET /api/active
GET /api/orderbook?marketId=...
GET /api/prices/:asset
GET /api/stream
```

### Strategy and performance data

```text
GET /api/agents
GET /api/agents/:id
GET /api/leaderboard
GET /api/predictions?limit=N
GET /api/trades?limit=N
GET /api/equity
```

### User wallet and non-custodial execution

```text
GET  /api/account/portfolio?address=...
POST /api/user/order/preview
POST /api/user/order/build
```

The server prepares unsigned transaction data for user orders. The browser submits the transaction through the connected wallet. The server does not receive a user private key.

---

## Why this can become a startup

AgentDesk begins with a narrow technical wedge: transparent autonomous trading desks for fast event-contract markets. That wedge can grow into infrastructure for both human traders and AI agents.

### The problem

Prediction-market automation currently has several trust gaps:

- Users cannot easily compare a strategy's forecast with the price it traded against.
- Agent demos often show outcomes without a durable, replayable decision trail.
- Copy-trading products can hide execution quality, slippage, and liquidity risk.
- LLM-based trading systems can be difficult to audit and may be allowed too much authority.
- Operators need reliable market data, execution guards, settlement monitoring, and performance analytics in one place.

### The initial product

AgentDesk solves this with:

- Public strategy identities.
- Explainable decision receipts.
- Live order-book-aware execution.
- Non-custodial user copy trading.
- On-chain transaction and settlement links.
- Accuracy, PnL, ROI, and equity history per desk.

### Potential customers

1. **Individual traders** — want a simpler way to inspect and follow event-market strategies.
2. **Agent developers** — need a safe environment to deploy, compare, and monitor trading agents.
3. **Market operators** — want more volume and better participant tooling around event markets.
4. **Funds and research teams** — need replayable data, execution analytics, and model evaluation.
5. **Wallets and exchanges** — can embed AgentDesk's decision and execution APIs.

### Potential business models

These are product options, not current features:

- Premium analytics and historical strategy research.
- B2B API access to signals, receipts, and execution-quality data.
- White-label agent workspaces for market operators and trading teams.
- Performance or subscription plans for advanced automation controls.
- Agent deployment and monitoring infrastructure for third-party builders.
- Enterprise risk, audit, and reporting tools.

Any monetization involving user funds, performance fees, or managed custody would require a separate legal, compliance, and security review.

---

## How the system can scale

The current architecture is deliberately small and understandable. Scaling should preserve the same auditability while replacing single-process components with durable services.

### Stage 1 — validate the product

Current focus:

- Somnia testnet.
- BTC and ETH event contracts.
- Five deterministic desks.
- Paper and live testnet modes.
- Local JSON persistence.
- One engine process.

Success metrics:

- Prediction calibration, not just raw PnL.
- Fill quality and realized slippage.
- Desk retention and user follow-through.
- Number of copied trades that complete successfully.
- Time from market discovery to published receipt.

### Stage 2 — productionize one venue

Replace or add:

- PostgreSQL for predictions, trades, users, watchlists, and audit records.
- Redis or a durable queue for market events and worker coordination.
- A dedicated market-data/indexer worker.
- Separate prediction workers per asset or market family.
- A risk and execution service with hard limits.
- WebSocket/SSE fan-out for many dashboard users.
- Metrics, tracing, alerting, and replay tooling.
- Secure signer infrastructure instead of raw long-lived key files.

The web dashboard should become stateless. Multiple API instances can serve users while workers own ingestion, strategy evaluation, execution, and settlement jobs.

### Stage 3 — multi-venue and multi-chain adapters

The strategy interface can remain venue-neutral:

```text
market data → normalized market → strategy output → risk decision → venue adapter
```

DreamDEX/Somnia remains the first adapter. Other venues can be added later behind the exchange interface without rewriting the strategy and receipt layers.

### Stage 4 — agent platform

The long-term platform can allow third-party desks to submit:

- A strategy definition.
- A declared data source.
- A risk envelope.
- A reproducible prediction receipt.
- A signer policy.
- A performance history.

The platform can then compare agents on forecasting skill, calibration, drawdown, execution quality, and risk-adjusted return instead of rewarding only the largest nominal PnL.

---

## Future roadmap: OpenRouter-powered position sizing

The current autonomous desks use a fixed `STAKE_CONTRACTS` value. The next experiment is to let a real LLM, accessed through OpenRouter, recommend **how much** to trade on each turn.

This should be added as a sizing advisor, not as an unrestricted trading agent.

### Recommended responsibility split

```text
Deterministic desk
  └─ decides direction, probability, confidence, and rationale

Execution/risk engine
  └─ reads book, spread, depth, expiry, balance, and limits

OpenRouter model
  └─ recommends a size inside the permitted range

Hard risk guard
  └─ clamps or rejects the recommendation

Venue adapter
  └─ submits only the final approved order
```

The LLM should not:

- Hold or see private keys.
- Decide whether a user transaction is signed.
- Directly call Somnia RPC or DreamDEX.
- Override the confidence threshold.
- Bypass maximum position, daily loss, or drawdown limits.
- Trade when the book is stale, empty, or too thin.
- Invent balances or market data.

### Structured sizing input

The sizing model can receive a compact, auditable object such as:

```json
{
  "asset": "BTC",
  "marketId": "0x...",
  "secondsToExpiry": 420,
  "direction": "UP",
  "probUp": 0.63,
  "confidence": 0.71,
  "yesMid": 0.52,
  "spread": 0.018,
  "filledContractsAtRequestedSize": 18,
  "walletCollateral": 10000,
  "deskDrawdown": 0.03,
  "recentCalibration": 0.08,
  "maxContracts": 25,
  "riskBudget": 0.005
}
```

The model should return strict JSON, for example:

```json
{
  "recommendedContracts": 12,
  "riskTier": "moderate",
  "reason": "Positive model edge with adequate depth; keep size below the available top-of-book liquidity.",
  "abstain": false
}
```

The production schema must be validated before execution. Invalid, incomplete, or timed-out model output must fall back to the deterministic safe size or abstain.

### Safe rollout plan

1. **Shadow mode** — ask the model for sizes but continue using fixed sizing.
2. **Paper mode** — compare LLM sizing with fixed sizing across replayed windows.
3. **Bounded testnet mode** — enforce a small maximum size and daily loss cap.
4. **Evaluation** — measure calibration, drawdown, slippage, fill quality, and stability.
5. **Production approval** — only after the model demonstrates improvement over the deterministic baseline.

The fallback must always be deterministic:

```text
if the model times out, returns invalid JSON, or violates a limit:
    use the configured safe size or abstain
```

The goal is not to let an LLM “trade freely.” The goal is to use a model for adaptive sizing while keeping direction, execution, custody, and hard risk limits deterministic and inspectable.

### Future configuration

OpenRouter is not currently integrated. A future implementation may introduce settings such as:

```text
OPENROUTER_MODEL
OPENROUTER_BASE_URL
LLM_SIZING_ENABLED=false
LLM_SIZING_MAX_CONTRACTS
LLM_SIZING_TIMEOUT_MS
LLM_SIZING_DAILY_LOSS_LIMIT
```

The OpenRouter key must be stored in the workspace secret manager or production secret store. It must never be committed to `.env`, logged, or sent to the browser.

---

## Security and custody model

### Autonomous desks

Today, each live desk signs with a dedicated wallet loaded by the server. This is suitable for controlled testnet experimentation, not a final custody architecture.

Before mainnet or user-funded automation:

- Move signing keys to managed secrets or an HSM/MPC-compatible signer.
- Use restricted session or operator keys where supported.
- Enforce per-desk balances and spend limits.
- Separate trading permissions from withdrawal permissions.
- Add nonce management and transaction replacement handling.
- Add kill switches and circuit breakers.
- Monitor gas, balances, order failures, and unexpected behavior.
- Rotate credentials without losing the public desk identity.

### User wallets

Users connect their own injected wallet. AgentDesk prepares an unsigned transaction, and the wallet extension displays the approval request. AgentDesk does not custody user assets or receive private keys.

### Operational safeguards

Never enable live execution without:

- A funded but limited wallet.
- A live two-sided order book.
- Sufficient time before expiry.
- Explicit paper/live configuration.
- A monitored error path.
- A tested emergency stop.

---

## Development scripts

```bash
npm start          # Run the server
npm run dev        # Run in watch mode
npm run smoke      # Check a running server
```

Useful probes:

```text
scripts/discover.mts
scripts/catalog.mts
scripts/prices.mts
scripts/bookProbe.mts
scripts/liveProbe.mts
scripts/faucetProbe.mts
scripts/mintAll.mts
scripts/seedGas.mts
```

---

## Project status

### Working today

- Somnia testnet market discovery.
- Live Somnia price and event-market data.
- Five deterministic strategy desks.
- Paper execution.
- Live testnet execution with separate agent wallets.
- Multi-level order-book display.
- Decision receipts.
- Book-aware user copy orders.
- Execution-safety scoring.
- Portfolio and settlement views.
- PnL, ROI, accuracy, and equity tracking.
- SSE live updates.

### Not yet production-ready

- Persistent authenticated user accounts.
- Cross-device followed-desk synchronization.
- Production-grade signer custody.
- High-availability workers.
- Durable database and event bus.
- Formal calibration scoring.
- OpenRouter LLM sizing.
- Mainnet risk and compliance review.

---

## Disclaimer

AgentDesk is an experimental software project for Somnia testnet event contracts. Predictions and strategy outputs are generated automatically for transparency and research. They are not financial advice, investment recommendations, or a guarantee of future results. Testnet balances and payouts have no monetary value.
