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

## Live-trading gotchas (learned 2026-08-24)
- dreamDEX 15m windows open with an EMPTY order book; the market maker quotes
  ~1-2 min later. Never lock in predictions at window open when the book is
  null — engine re-runs predictions once the book appears (`bookReady` set).
- Price-feed EMA (`tick.raw.ema`) arrives as 1e18 fixed point; normalize with
  `normalizeEma()` before comparing to spot, else meanrev sees "flat feed".
- SDK writes use a fixed 10M gas ceiling x 60 gwei maxFee = 0.6 STT envelope,
  which exceeds faucet-funded balances and surfaces as the misleading
  "approve reverted: Missing or invalid parameters". Override
  `fees: { maxFeePerGas: 12 gwei }` in the SomniaMarkets config.
- tUSDC faucet reverts with zero args; call with explicit amount + gas
  (`trader.faucet({ amount, gas: 300000n })`).
- viem/SDK type mismatch: cast readContract/sendTransaction args `as any` in
  scripts; publicClient is typed `any` in exchange.ts.
- IOC taker orders can revert `ImmediateOrCancelNoFill()` when the book moves —
  expected; trade is marked failed, no retry.

## Ops scripts
- `scripts/seedGas.mts` split STT gas from one funded desk to all desks
- `scripts/mintAll.mts` faucet 10k tUSDC to every desk wallet
- `scripts/bookProbe.mts` inspect live order books for current windows
- `scripts/smoke.mts` end-to-end API smoke test (npm run smoke)

## Deploy
Server on PORT=12000 maps to the work-1 runtime host. Run live:
`PORT=12000 PAPER_TRADES=false ENABLE_LIVE_TRADING=true npx tsx src/server.ts`
Repo: github.com/uzochukwuV/agentdesk (public).
