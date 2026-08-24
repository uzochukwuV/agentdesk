import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, SOMNIA_TESTNET_PRICE_FEED } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";

const exchange = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
});

const handle = await exchange.client.watchPrices(["BTC", "ETH"]);
await new Promise((r) => setTimeout(r, 5000));
for (const a of ["BTC", "ETH"]) {
  const live = exchange.client.getLivePrice(a);
  const ticks = exchange.client.getLivePriceTicks(a, { limit: 5 });
  const hist = await exchange.client.fetchPriceHistory(a, { limit: 3 });
  const candles = await exchange.client.fetchPriceCandles(a, "M1", { limit: 3 });
  console.log({
    asset: a,
    status: exchange.client.getPriceStatus(a),
    live: live && { asset: live.asset, price: live.price, ema: live.ema, ts: live.blockTimestamp },
    ticks: ticks.map((t) => ({ p: t.price, t: t.blockTimestamp })),
    hist: hist.map((t) => ({ p: t.price, t: t.blockTimestamp })),
    candles: candles.map((c: any) => ({ t: c.timestamp, o: c.open, h: c.high, l: c.low, c: c.close })),
  });
}
await handle.stop();
process.exit(0);
