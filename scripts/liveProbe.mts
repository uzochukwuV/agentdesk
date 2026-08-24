import { SomniaMarkets, SOMNIA_TESTNET_ADDRESSES, SOMNIA_TESTNET_PRICE_FEED, isBinaryMarket } from "@somnia-chain/markets-sdk";
import { somniaShannon } from "@somnia-chain/markets-sdk/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const pk = `0x${generatePrivateKey().slice(2)}` as `0x${string}`;
const account = privateKeyToAccount(pk);
console.log("probe wallet:", account.address);

const exchange = new SomniaMarkets({
  indexerUrl: "https://dev.smk.somnia.host/v1/graphql",
  chain: somniaShannon,
  wsRpcUrl: "wss://api.infra.testnet.somnia.network/ws",
  addresses: SOMNIA_TESTNET_ADDRESSES,
  priceFeed: SOMNIA_TESTNET_PRICE_FEED,
  privateKey: pk,
});

// Faucet 10k tUSDC.
const f = await exchange.trader.faucet();
console.log("faucet tx:", f.receipt?.transactionHash, "status:", f.receipt?.status);

// Find a 15m BTC/ETH market with headroom.
const markets = Object.values(await exchange.loadMarkets(true));
const now = Date.now() / 1000;
let target: any = null;
let oc: any = null;
for (const m of markets) {
  if (!m.active || !isBinaryMarket(m.info)) continue;
  const info = m.info as any;
  if (Number(info.intervalSec) !== 900) continue;
  try {
    const o = await exchange.client.getMarketOnchain(info.marketId as `0x${string}`);
    if (o.status !== 1) continue;
    const left = Number(o.expiry) - now;
    if (left < 300) continue;
    target = m;
    oc = o;
    break;
  } catch {}
}
if (!target || !oc) throw new Error("no 15m window right now");
console.log("window:", target.symbol, "seconds left:", Math.round(Number(oc.expiry) - now));

const yesSymbol = (target as any).outcomes?.[0]?.symbol ?? `${target.symbol}#YES`;
const book = await exchange.fetchOrderBook(yesSymbol, 5);
const ask = book.asks[0]?.[0];
console.log("YES book best ask:", ask, "best bid:", book.bids[0]?.[0]);
if (ask == null) throw new Error("no ask");

// Raw-tier live trade: BUY_YES, IOC, cross ask+0.02, 2 contracts, tick-snapped.
const dec = 6;
const ONE = BigInt(10 ** dec);
const TICK = 1_000n; // 0.001
const priceRaw = BigInt(Math.round((Math.min(0.999, ask + 0.02)) * Number(ONE / TICK))) * TICK;
const qtyRaw = BigInt(Math.floor(2 * Number(ONE / TICK))) * TICK;
console.log("placing BUY_YES price(raw)", priceRaw.toString(), "qty(raw)", qtyRaw.toString());
const res = await exchange.trader.placeOrder({
  pool: oc.pool,
  side: "BUY_YES",
  price: priceRaw,
  quantity: qtyRaw,
  orderType: 2,
  expireTimestampNs: BigInt(Math.min(Math.floor(now) + 300, Number(oc.expiry))) * 1_000_000_000n,
});
console.log("tx:", res.receipt?.transactionHash, "status:", res.receipt?.status, "fills:", res.fills.length);
for (const fll of res.fills) {
  console.log("  fill qty:", (Number(fll.quantityFilled) / 10 ** dec).toFixed(6), "px", (Number(fll.fillPrice) / 10 ** dec).toFixed(6));
}
process.exit(0);
