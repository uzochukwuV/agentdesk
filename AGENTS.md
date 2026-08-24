# AgentDesk — repository memory

## What this is
AgentDesk: 5 autonomous prediction agents ("desks") that call dreamDEX 15-minute
event-contract windows (BTC/ETH up/down), publish the calls, trade them (paper
by default, live when a funded `PRIVATE_KEY` is provided), and rank desks on a
leaderboard by settled PnL.

## Key paths
- `src/agents/index.ts` — the five strategy implementations + `runPredictions`.
- `src/exchange.ts` — `@somnia-chain/markets-sdk` façade (window finder, books,
  live orders, faucet, claim/redeem).
- `src/engine.ts` — loop, predictions → trade gating → settlement → equity.
- `src/store.ts` — append-only state + flush timer.
- `public/` — vanilla dashboard (no build).

## Gotchas hit while building (save yourself the regressions)
- SDK BigInt fields (yesId/noId) break Express `res.json` — the server wraps
  `toSafe()` (BigInt→string) middleware. Any new endpoint returning market data
  must route through it.
- YES symbol must come from `market.outcomes[0].symbol`; composing
  `` `${baseSymbol}#YES` `` works but proved flaky — always keep yesSymbol from
  the SDK.
- Only `SOMNIA_TESTNET_PRICE_FEED` is exported (no mainnet priceFeed constant).
  Mainnet is untested; guard isNetwork gates accordingly.
- Faucet (`trader.faucet`) needs wallet gas FIRST (wallet that has never held
  STT errors with `account does not exist` on eth_sendRawTransaction). Live
  mode requires user-funded STT.
- JsonBody: express res.json serializes; websocket docs examples use `wss://
  api.dreamdex.io/v0/ws/public` (main) / `stg.` prefix (testnet).
- Paper mode uses the book touch: YES→ask, NO→1-bid. Don't substitute mid —
  it's dishonest relative to on-chain fill pricing.
- The venue's binary tick grid: testnet 1e3 raw (0.001), mainnet 1e15. Use
  `trader.placeOrder` (raw, integer-snap) for live orders; unified createOrder
  float-converts off-grid on 18-dec collaterals (docs gotcha #3).

## Validate after changes
- `npx tsc --noEmit`, `npm run smoke`, let one full 15-minute window cycle to
  confirm settlement + redeem attribution in `data/state.json`.
