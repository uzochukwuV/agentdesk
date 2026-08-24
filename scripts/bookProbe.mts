import { Exchange } from "../src/exchange.js";
const ex = new Exchange();
const wins = await ex.findWindows(["BTC", "ETH"], 900);
for (const w of wins) {
  console.log(w.asset, w.symbol, "yesSymbol:", w.yesSymbol, "expiry in", w.secondsLeft, "s");
  for (const sym of [w.yesSymbol, `${w.symbol}#YES`]) {
    try {
      const book = await ex.exchange.fetchOrderBook(sym, 5);
      console.log("  ", sym, "bids:", book.bids.slice(0, 2), "asks:", book.asks.slice(0, 2));
    } catch (e: any) {
      console.log("  ", sym, "ERR", (e?.message ?? String(e)).slice(0, 120));
    }
  }
}
