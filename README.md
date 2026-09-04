# AgentDesk — agent predictions for dreamDEX event contracts

Five autonomous strategy desks make a prediction for each **15-minute binary market**
(BTC/ETH "up or down vs. the window open") on [dreamDEX](https://docs.dreamdex.io/)'s
Somnia event contracts, publish the call **before** it resolves, and execute it
(paper by default, live on testnet when you give the app a funded key). Every
execution feeds the leaderboard: settled PnL, win rate, prediction accuracy,
stake and ROI per desk, with links straight to the Somnia explorer for
on-chain verification.

The goal is a product where users see tonight's predictions from each desk and
choose whose to ride — because the desks can be graded against outcomes any
observer can check on-chain.

## Agents

| Desk | Strategy | Idea |
|------|----------|------|
| Momo | Momentum Rider | Recent tick-slope normalized by realized vol; rides the trend. |
| Revert | Mean Reversion | Spot-to-EMA overshoot of the oracle mark; predicts the snap-back. |
| Arbik | Mispricing Hunter | Estimated fair P(UP) from the drift, compared to the market's YES mid. Trades the gap. |
| Ranger | Range Breakout | 2-minute range vs 10-minute baseline; follows k·σ escapes. |
| Quorum | Ensemble Vote | Confidence-weighted vote across the other four; trades only on agreement. |

Signals come from the on-chain BTC/ETH index feed exposed by
`@somnia-chain/markets-sdk` (`watchPrices`, M1 candles, and per-market order books).

## Run

```bash
npm install
npm start          # paper mode, http://localhost:5000
```

### Going live (testnet)

`PAPER_TRADES=false` plus either `PRIVATE_KEY` in `.env` or a wallet the tool
autogenerates into `data/wallet.json` (gitignored). The wallet needs:

- **gas**: a bit of STT (Somnia Shannon test token — any public faucet, e.g.
  Google Cloud / thirdweb / Discord DevRel)
- **tUSDC collateral**: the tool calls `trader.faucet()` itself once funded with gas
  (10,000 per call, rechecked at boot or via `AUTO_FAUCET=true`)

From then on, everything is on-chain: IOC order with a tx hash shown in the UI,
settlement at expiry, and (for winners) an on-chain redeem whose tx is linked too.

### Configuration

| Env | Default | Meaning |
|-----|---------|---------|
| `PORT` | `12000` | HTTP port |
| `PAPER_TRADES` | `true` | `false` + a key → live testnet fills |
| `PRIVATE_KEY` | — | EVM signing key, else generated to `data/wallet.json` |
| `DREAMDEX_NETWORK` | `testnet` | `mainnet` for production collateral |
| `ASSETS` | `BTC,ETH` | Underlyings to predict |
| `CADENCE_SEC` | `900` | Binary window length (900 = 15m) |
| `STAKE_CONTRACTS` | `10` | Contracts per desk per window |
| `MIN_AGENT_CONFIDENCE` | `0.55` | Below this the desk publishes but skips trading |
| `SCAN_INTERVAL_MS` | `5000` | Engine loop cadence |
| `AUTO_FAUCET` | `true` | Mint tUSDC when live collateral is low |
| `DATA_DIR` | `data` | Persisted state (gitignored) |

### API

- `GET /` — dashboard
- `GET /api/status` — network, mode, wallet, windows, buffers
- `GET /api/active` — current windows with the five current predictions
- `GET /api/leaderboard` — agents sorted by settled PnL
- `GET /api/predictions?limit=N` — every call with rationale, features, and
  (post-expiry) WIN/LOSS/VOID and the on-chain resolution
- `GET /api/trades` — every execution: mode, side, qty, price, settlement, tx links
- `GET /api/equity` — per-desk settled-PnL series (chart)
- `GET /api/stream` — SSE that pushes prediction/trade/equity events

React to the dashboards or embed the endpoints in a product of your own.

### How a call becomes a track record

1. Engine subscribes to live prices + maintains tick history.
2. When a 15-minute window opens, each desk computes `(probUp, direction,
   confidence, rationale, features)` from public market data — then the call
   is permanently stored. It can't be edited after resolution.
3. Confidence ≥ threshold → desk trades: paper fill at the actual book touch,
   or on-chain IOC on a live key.
4. At expiry, the market resolves on-chain via the oracle hub ("UP" if the
   index closed ≥ the window open, else "DOWN"; void pays both sides 0.5 on a
   missing settlement answer). Desk PnL updates and its row on the
   leaderboard changes.
5. Winners are redeemed on-chain in live mode; the tx is linked in the UI.

### Stack notes

- `@somnia-chain/markets-sdk` (testnet: `dev.smk.somnia.host`
  indexer + `wss://api.infra.testnet.somnia.network/ws`)
- Express + SSE, no build step for the frontend (vanilla JS + canvas chart)
- State is append-only JSON persisted at `data/state.json`

### DreamDEX Bot Kit alignment

The official [dreamdex-bot-kit](https://github.com/somnia-chain/dreamdex-bot-kit) currently
separates spot bots (`@dreamdex-bot-kit/core`) from event-contract bots
(`@dreamdex-bot-kit/ec-core`). The event-contract package is a private workspace package and
is intentionally built on the same `@somnia-chain/markets-sdk` used here, so AgentDesk keeps
its existing event-contract adapter rather than adding an incompatible spot-bot dependency.

The dashboard follows the kit's safer operator patterns: live market status is visible before
execution, bid/ask and fill mode are shown in the copy ticket, and live testnet execution
remains explicitly labeled. A future migration can replace the adapter internals with
`ec-core` once that package is published or vendored, without changing the agent or UI APIs.

### Scripts

- `npm start` / `npm run dev` (watch)
- `npm run smoke` — quick health check of a running server
- `scripts/discover.mts`, `scripts/catalog.mts`, `scripts/prices.mts`,
  `scripts/liveProbe.mts` — raw SDK probes used while building:

**Disclaimer**: predictions are generated automatically and displayed for
transparency; they are not advice. Testnet payouts are zero-value tokens.
