import { readFileSync, existsSync } from "node:fs";

function envBool(v: string | undefined, dflt: boolean): boolean {
  if (v === undefined || v === "") return dflt;
  return /^(1|true|yes|on)$/i.test(v);
}
function envNum(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return v === undefined || v === "" || Number.isNaN(n) ? dflt : n;
}

// Load .env if present (no dotenv dependency)
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const config = {
  port: envNum(process.env.PORT, 12000),
  host: process.env.HOST ?? "0.0.0.0",

  network: (process.env.DREAMDEX_NETWORK ?? "testnet") as "testnet" | "mainnet",
  indexerUrl:
    process.env.INDEXER_URL ??
    (process.env.DREAMDEX_NETWORK === "mainnet"
      ? "https://prd.smk.somnia.host/v1/graphql"
      : "https://dev.smk.somnia.host/v1/graphql"),
  wsRpcUrl:
    process.env.WS_RPC_URL ??
    (process.env.DREAMDEX_NETWORK === "mainnet"
      ? "wss://api.infra.mainnet.somnia.network/ws"
      : "wss://api.infra.testnet.somnia.network/ws"),
  httpRpcUrl:
    process.env.HTTP_RPC_URL ??
    (process.env.DREAMDEX_NETWORK === "mainnet"
      ? "https://api.infra.mainnet.somnia.network"
      : "https://api.infra.testnet.somnia.network"),

  // Trading mode. PAPER_TRADES=false + per-agent wallets funded => live testnet trading.
  paperTrades: envBool(process.env.PAPER_TRADES, true),
  // Extra safety: only actually submit live orders when explicitly enabled. Wallets still exist + balances show otherwise.
  enableLiveTrading: envBool(process.env.ENABLE_LIVE_TRADING, false),

  // Markets to predict: assets + cadence of the binary windows (900s = 15m).
  assets: (process.env.ASSETS ?? "BTC,ETH")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
  cadenceSec: envNum(process.env.CADENCE_SEC, 900),

  // Engine cadence.
  scanIntervalMs: envNum(process.env.SCAN_INTERVAL_MS, 5000),
  minWindowHeadroomSec: envNum(process.env.MIN_WINDOW_HEADROOM_SEC, 120),
  minMarketHeadroomSec: envNum(process.env.MIN_MARKET_HEADROOM_SEC, 150),

  // Sizing (human contracts per trade; testnet tUSDC 6 decimals).
  stakeContracts: envNum(process.env.STAKE_CONTRACTS, 10),
  minAgentConfidence: envNum(process.env.MIN_AGENT_CONFIDENCE, 0.55),

  // Persistence
  dataDir: process.env.DATA_DIR ?? "data",

  // Auto faucet on startup in live mode when collateral is low.
  autoFaucet: envBool(process.env.AUTO_FAUCET, true),
  faucetWhenBelow: envNum(process.env.FAUCET_WHEN_BELOW, 100),
};
export type AppConfig = typeof config;
