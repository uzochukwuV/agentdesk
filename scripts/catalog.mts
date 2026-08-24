import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const exchange = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});

const markets = Object.values(await exchange.loadMarkets(true));
const binaries = markets.filter((m) => m.active && isBinaryMarket(m.info)) as any[];
const now = Date.now() / 1000;
const seen = new Set<string>();
for (const m of binaries) {
  const info = m.info as any;
  const key = `${info.asset}:${Number(info.intervalSec)}`;
  const secs = Number(info.expiry ?? 0) - now;
  if (secs <= 0) continue;
  if (seen.has(key)) continue;
  seen.add(key);
  let status = "?", secondsLeft = 0, yesBid = null, yesAsk = null;
  try {
    const oc = await exchange.client.getMarketOnchain(info.marketId as `0x${string}`);
    status = String(oc.status);
    secondsLeft = Math.round(Number((oc as any).expiry ?? info.expiry) - now);
  } catch {}
  try {
    const book = await exchange.fetchOrderBook(m.outcomes?.[0]?.symbol, 5);
    yesBid = book.bids[0]?.[0] ?? null;
    yesAsk = book.asks[0]?.[0] ?? null;
  } catch {}
  console.log({
    symbol: m.symbol,
    asset: info.asset,
    intervalMin: Number(info.intervalSec) / 60,
    status,
    secondsLeft,
    yesBid,
    yesAsk,
  });
}
process.exit(0);
