import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const exchange = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
});

const markets = Object.values(await exchange.loadMarkets(true));
console.log("total markets:", markets.length);
const binaries = markets.filter((m) => m.active && isBinaryMarket(m.info)) as any[];
console.log("active binaries:", binaries.length);
for (const m of binaries.slice(0, 10)) {
  const info = m.info as any;
  let status = "?";
  try {
    const oc = await exchange.client.getMarketOnchain(info.marketId as `0x${string}`);
    status = String(oc.status);
  } catch (e: any) {
    status = "ERR:" + e.message?.slice(0, 60);
  }
  console.log({
    symbol: m.symbol,
    asset: info.asset,
    intervalSec: Number(info.intervalSec),
    expiry: Number(info.expiry ?? 0),
    status,
    outcomes: m.outcomes?.map((o: any) => o.symbol),
  });
}
process.exit(0);
