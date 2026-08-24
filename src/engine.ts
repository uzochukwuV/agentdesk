import { AGENTS, runPredictions, type AgentOutput, type SignalContext, type Tick, type Candle } from "./agents/index.js";
import { config } from "./config.js";
import { Exchange, type WindowMarket } from "./exchange.js";
import { Store, type Prediction, type Trade, type EquityPoint } from "./store.js";
import { resolveWallets, type WalletInfo } from "./wallets.js";

// Feed EMA arrives as a 1e18 fixed-point raw value on some venues; bring it to spot scale.
function normalizeEma(ema: number, price: number): number {
  return price > 0 && ema / price > 1e6 ? ema / 1e18 : ema;
}

export interface Broadcaster {
  onEvent(type: string, payload: unknown): void;
}

export interface AgentBalance {
  address: string;
  collateralHuman: number | null;
  nativeHuman: number | null;
  updatedAt: number;
}

export class Engine {
  private store: Store;
  private readExchange: Exchange;
  private agentExchanges = new Map<string, Exchange>();
  private wallets = new Map<string, WalletInfo>();
  private balances = new Map<string, AgentBalance>();
  private live: boolean;
  private running = false;
  private ticks = new Map<string, Tick[]>(); // asset -> newest-first ticks
  private candleCache = new Map<string, { candles: Candle[]; fetchedAt: number }>();
  private windows = new Map<string, WindowMarket | null>();
  private broadcasts = new Set<Broadcaster>();
  private started = false;
  private lastScan: { at: number; marketsScanned: number; error: string | null } = { at: 0, marketsScanned: 0, error: null };
  private lastEquityAt = 0;
  private bookReady = new Set<string>();

  constructor(store: Store) {
    this.store = store;
    // wallets exist whenever paper mode is off; actual on-chain orders only when ENABLE_LIVE_TRADING=true
    const walletsOn = !config.paperTrades;
    this.live = walletsOn && config.enableLiveTrading;
    if (walletsOn) {
      this.wallets = resolveWallets(AGENTS.map((a) => a.id));
      for (const [id, w] of this.wallets) {
        this.agentExchanges.set(id, new Exchange(w.privateKey));
        console.log(`[engine] agent ${id} wallet: ${w.address}`);
      }
      if (!config.enableLiveTrading) console.log("[engine] wallets ready; ENABLE_LIVE_TRADING=false so orders are simulated until funded");
    }
    this.readExchange = new Exchange();
  }

  private agentExchange(agentId: string): Exchange | undefined {
    return this.agentExchanges.get(agentId);
  }

  broadcast(cb: (b: Broadcaster) => void): void {
    this.broadcasts.forEach(cb);
  }

  attach(b: Broadcaster): void {
    this.broadcasts.add(b);
  }

  private emit(type: string, payload: unknown): void {
    for (const b of this.broadcasts) b.onEvent(type, payload);
  }

  status() {
    return {
      live: this.live,
      paper: !this.live,
      wallets: this.wallets.size ? [...this.wallets.values()].map((w) => ({ agentId: w.agentId, address: w.address })) : [],
      balances: Object.fromEntries(this.balances),
      network: config.network,
      cadenceSec: config.cadenceSec,
      assets: config.assets,
      stakeContracts: config.stakeContracts,
      minConfidence: config.minAgentConfidence,
      lastScan: this.lastScan,
      windows: Object.fromEntries(this.windows),
      agents: AGENTS.map((a) => ({ id: a.id, name: a.name, style: a.style, description: a.description, color: a.color })),
      bufferSizes: Object.fromEntries([...this.ticks].map(([a, t]) => [a, t.length])),
    };
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // Watch prices.
    const handle = await this.readExchange.exchange.client.watchPrices(config.assets);
    console.log(this.live ? `[engine] live mode (${this.wallets.size} independent wallets)` : "[engine] paper mode (simulated fills)");
    // Maintain tick buffers from the live store.
    this.readExchange.exchange.client.subscribePrices(() => {
      for (const asset of config.assets) {
        const list = this.readExchange.exchange.client.getLivePriceTicks(asset, { limit: 25 });
        if (!list.length) continue;
        let buf: Tick[] = [];
        for (const tick of list) buf.push({ t: tick.blockTimestamp, p: tick.price, e: normalizeEma(Number(tick.raw?.ema ?? tick.ema), tick.price) });
        const existing = this.ticks.get(asset) ?? [];
        for (const t of existing) {
          if (!buf.some((b) => b.t === t.t)) buf.push(t);
        }
        buf.sort((a, b) => b.t - a.t);
        if (buf.length > 1500) buf = buf.slice(0, 1500);
        this.ticks.set(asset, buf);
      }
    });
    // Fill buffers from history so strategies have data immediately.
    for (const asset of config.assets) {
      try {
        const hist = await this.readExchange.exchange.client.fetchPriceHistory(asset, { limit: 1000 });
        this.ticks.set(
          asset,
          hist.map((h) => ({ t: h.blockTimestamp, p: h.price, e: normalizeEma(Number(h.raw?.ema ?? h.ema), h.price) }))
        );
        console.log(`[engine] seeded ${asset} with ${hist.length} ticks`);
      } catch (e) {
        console.error(`[engine] failed to seed ${asset}`, e);
      }
    }
    if (this.live && config.autoFaucet) await this.faucetAll();
    if (this.wallets.size) await this.refreshBalances();
    this.running = true;
    this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const startedAt = Date.now();
      try {
        this.lastScan.error = null;
        await this.scan();
        this.lastScan.at = Date.now();
      } catch (e: any) {
        this.lastScan.error = String(e?.message ?? e);
        console.error("[engine] scan error", e);
      }
      const elapsed = Date.now() - startedAt;
      const wait = Math.max(1000, config.scanIntervalMs - elapsed);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  private async scan(): Promise<void> {
    // 1. Refresh windows for all assets (one indexer sweep).
    let scanned = 0;
    const wins = await this.readExchange.findWindows(config.assets, config.cadenceSec);
    for (let i = 0; i < config.assets.length; i++) {
      const asset = config.assets[i];
      const win = wins[i];
      if (!win) {
        // Keep the previous assignment briefly so expired windows can settle.
        const prev = this.windows.get(asset);
        if (prev && Number(prev.expiry) > Date.now() / 1000) this.windows.set(asset, prev);
        continue;
      }
      scanned++;
      this.windows.set(asset, win);
      // 2. If we haven't predicted for this window yet, do it now.
      const existing = this.store.listPredictions((x) => x.marketId === win.marketId);
      if (existing.length < AGENTS.length) {
        await this.predictAll(win);
      } else if (!this.bookReady.has(win.marketId)) {
        // First pass may have run before the market maker quoted the book; retry once it appears.
        const noBook = existing.some((x) => x.rationale === "no book" || x.decisionReason === "no book liquidity");
        if (!noBook) {
          this.bookReady.add(win.marketId);
        } else {
          const book = await this.readExchange.getYesBook(win.yesSymbol);
          if (book.bid != null && book.ask != null) {
            this.bookReady.add(win.marketId);
            console.log(`[engine] ${win.asset} book quoted — re-running predictions`);
            await this.predictAll(win);
          }
        }
        if (this.bookReady.size > 200) this.bookReady.delete(this.bookReady.values().next().value!);
      }
    }
    this.lastScan.marketsScanned = scanned;
    // 3. Settle expired pending predictions.
    await this.settle();
    // 4. Refresh wallet balances (cheap on-chain reads).
    if (!this.lastBalanceAt || Date.now() - this.lastBalanceAt > 20_000) {
      await this.refreshBalances();
      this.lastBalanceAt = Date.now();
    }
    // 5. Equity snapshots for all agents once a minute.
    if (Date.now() - this.lastEquityAt > 60_000) {
      this.lastEquityAt = Date.now();
      this.snapshotEquity();
    }
  }

  private lastBalanceAt = 0;
  private async refreshBalances(): Promise<void> {
    if (!this.wallets.size) return;
    await Promise.all(
      [...this.wallets.values()].map(async (w) => {
        let collateralHuman: number | null = null;
        let nativeHuman: number | null = null;
        try {
          collateralHuman = await this.readExchange.getCollateralBalanceHuman(w.address);
        } catch {}
        try {
          nativeHuman = await this.readExchange.getNativeBalanceHuman(w.address);
        } catch {}
        this.balances.set(w.agentId, { address: w.address, collateralHuman, nativeHuman, updatedAt: Date.now() });
      })
    );
  }

  private async faucetAll(): Promise<void> {
    for (const [agentId, w] of this.wallets) {
      const ex = this.agentExchanges.get(agentId);
      if (!ex) continue;
      try {
        const bal = await ex.getCollateralBalanceHuman(w.address);
        if (bal < config.faucetWhenBelow) {
          console.log(`[engine] ${agentId} collateral ${bal.toFixed(2)} → faucet`);
          const tx = await ex.faucet();
          console.log(`[engine] ${agentId} faucet ok: ${tx}`);
        } else {
          console.log(`[engine] ${agentId} collateral: ${bal.toFixed(2)}`);
        }
      } catch (e: any) {
        console.error(`[engine] ${agentId} faucet failed: ${e?.message}`);
      }
    }
  }

  private async predictAll(win: WindowMarket): Promise<void> {
    const buf = this.ticks.get(win.asset) ?? [];
    const book = await this.readExchange.getYesBook(win.yesSymbol);
    console.log(`[engine] ${win.asset} ${win.symbol} book YES bid=${book.bid} ask=${book.ask}`);
    // Candles for window-open reference.
    let openPrice: number | null = null;
    const cache = this.candleCache.get(win.asset);
    if (!cache || Date.now() - cache.fetchedAt > 30 * 60_000) {
      try {
        const cs = await this.readExchange.exchange.client.fetchPriceCandles(win.asset, "M1", { limit: 2000 });
        const candles = cs.map((c: any) => ({ t: c.bucketStart, o: c.open, h: c.high, l: c.low, c: c.close, n: c.count })) as Candle[];
        this.candleCache.set(win.asset, { candles, fetchedAt: Date.now() });
      } catch (e) {
        // leave stale cache if it exists
      }
    }
    const candles = (this.candleCache.get(win.asset)?.candles ?? []) as Candle[];
    const atStart = candles.filter((c) => c.t <= win.windowStart).pop() ?? null;
    openPrice = atStart?.o ?? null;
    const ctx: Omit<SignalContext, "peers"> = {
      asset: win.asset,
      windowStart: win.windowStart,
      windowEnd: win.expiry,
      nowSec: Math.floor(Date.now() / 1000),
      secsLeft: win.secondsLeft,
      ticks: buf,
      candles,
      book,
      openPrice,
    };
    const outputs = runPredictions(ctx);
    for (const out of outputs) {
      const prediction = this.toPrediction(win, out, book);
      this.store.upsertPrediction(prediction);
      this.emit("prediction", prediction);
    }
    // Then trade each (sequenced to avoid nonce races).
    for (const out of outputs) {
      if (out.confidence >= config.minAgentConfidence) {
        await this.execute(win, this.store.getPrediction(`${win.marketId}:${out.agentId}`)!);
      } else {
        const p = this.store.getPrediction(`${win.marketId}:${out.agentId}`);
        if (p) {
          p.decision = "skip";
          p.decisionReason = `confidence ${(out.confidence * 100).toFixed(0)}% below threshold ${(config.minAgentConfidence * 100).toFixed(0)}%`;
          this.store.upsertPrediction(p);
          this.emit("prediction", p);
        }
      }
    }
  }

  private toPrediction(win: WindowMarket, out: AgentOutput, book: { bid: number | null; ask: number | null }): Prediction {
    const ticks = this.ticks.get(win.asset) ?? [];
    const yesBook = { bid: book.bid, ask: book.ask, mid: book.bid != null && book.ask != null ? (book.bid + book.ask) / 2 : (book.bid ?? book.ask) };
    return {
      id: `${win.marketId}:${out.agentId}`,
      agentId: out.agentId,
      marketId: win.marketId,
      symbol: win.symbol,
      yesSymbol: win.yesSymbol,
      asset: win.asset,
      intervalSec: win.intervalSec,
      expiry: win.expiry,
      windowStart: win.windowStart,
      createdAt: Date.now(),
      sourcePriceAtSignal: ticks[0]?.p ?? null,
      direction: out.direction,
      probUp: out.probUp,
      confidence: out.confidence,
      rationale: out.rationale,
      features: out.features,
      bookYes: yesBook,
      decision: "skip",
      decisionReason: "queued",
      status: "pending",
      outcome: null,
      resolution: null,
      resolvedAt: null,
    };
  }

  private async execute(win: WindowMarket, p: Prediction): Promise<void> {
    if (p.decision === "trade") return;
    // Re-read book to trade against a current quote.
    const book = await this.readExchange.getYesBook(p.yesSymbol);
    if (book.bid == null || book.ask == null) {
      p.decision = "skip";
      p.decisionReason = "no book liquidity";
      this.store.upsertPrediction(p);
      this.emit("prediction", p);
      return;
    }
    p.decision = "trade";
    p.decisionReason = `confidence ${(p.confidence * 100).toFixed(0)}% ≥ ${(config.minAgentConfidence * 100).toFixed(0)}%`;
    p.bookYes = { bid: book.bid, ask: book.ask, mid: (book.bid + book.ask) / 2 };
    this.store.upsertPrediction(p);
    const side: "YES" | "NO" = p.direction === "UP" ? "YES" : "NO";
    const contracts = config.stakeContracts;
    let trade: Trade = {
      id: `${p.id}:t1`,
      predictionId: p.id,
      agentId: p.agentId,
      marketId: p.marketId,
      symbol: p.symbol,
      mode: this.live ? "live" : "paper",
      side,
      contracts,
      price: null,
      costCollateral: 0,
      placedAt: Date.now(),
      txHash: null,
      status: "open",
      error: null,
      payoutCollateral: 0,
      pnlCollateral: 0,
      redeemTxHash: null,
    };
    if (this.live) {
      const ex = this.agentExchange(p.agentId);
      const w = this.wallets.get(p.agentId);
      if (!ex || !w) {
        trade.status = "failed";
        trade.error = "no agent wallet";
      } else {
        try {
          // Cross the touch with small buffer, priced in YES terms.
          const limitYesPrice = side === "YES" ? Math.min(0.999, book.ask + 0.02) : Math.max(0.001, book.bid - 0.02);
          const res = await ex.placeLiveTrade(win, side, contracts, limitYesPrice);
          trade.txHash = res.txHash;
          trade.contracts = res.filledQty;
          trade.price = res.avgYesPrice;
          trade.costCollateral = res.spentCollateral;
        } catch (e: any) {
          trade.status = "failed";
          trade.error = String(e?.message ?? e).slice(0, 300);
        }
      }
    } else {
      // Paper: entry at the touch (YES ask for YES side; 1-bid for NO side).
      const entry = side === "YES" ? book.ask : 1 - book.bid;
      trade.price = entry != null ? Math.min(0.999, Math.max(0.001, entry)) : null;
      trade.costCollateral = (trade.price ?? 0) * contracts;
    }
    this.store.upsertTrade(trade);
    this.emit("trade", trade);
  }

  // ---------------------------------------------------------------- settlement
  private async settle(): Promise<void> {
    const pending = this.store.listPredictions((x) => x.status === "pending");
    const settledMarkets: { marketId: string; winningOutcome: 0 | 1 | null; voided: boolean; resolvedAtMs: number }[] = [];
    for (const p of pending) {
      if (p.expiry > Date.now() / 1000 - 5) continue;
      let oc: any = null;
      try {
        oc = await this.readExchange.getMarketOnchainSnapshot(p.marketId);
      } catch {
        continue; // retry next scan
      }
      const status = Number(oc.status);
      if (status !== 4 && status !== 5) continue; // still resolving
      const voided = status === 5;
      const winningOutcome: 0 | 1 | null = voided ? null : (Number(oc.winningOutcome) as 0 | 1);
      const outcome: "WIN" | "LOSS" | "VOID" = voided
        ? "VOID"
        : winningOutcome === (p.direction === "UP" ? 0 : 1)
          ? "WIN"
          : "LOSS";
      p.status = "resolved";
      p.outcome = outcome;
      p.resolution = { winningOutcome, voided };
      p.resolvedAt = Date.now();
      this.store.upsertPrediction(p);
      this.emit("prediction", p);
      settledMarkets.push({ marketId: p.marketId, winningOutcome, voided, resolvedAtMs: Date.now() });
    }
    if (!settledMarkets.length) return;
    // Update trades on settled markets.
    for (const sm of settledMarkets) {
      const trades = this.store.listTrades((t) => t.marketId === sm.marketId);
      for (const t of trades) {
        if (t.status !== "open") continue;
        const isWinner = sm.voided ? false : (t.side === "YES" ? sm.winningOutcome === 0 : sm.winningOutcome === 1);
        const payout = sm.voided ? t.contracts * 0.5 : isWinner ? t.contracts : 0;
        t.payoutCollateral = payout;
        t.pnlCollateral = payout - t.costCollateral;
        t.status = sm.voided ? "void" : isWinner ? "won" : "lost";
        this.store.upsertTrade(t);
        this.emit("trade", t);
      }
    }
    // Live redemption proof per agent wallet for claimable positions.
    if (this.live) {
      const settledIds = new Set(settledMarkets.map((s) => s.marketId));
      for (const [agentId, w] of this.wallets) {
        const ex = this.agentExchanges.get(agentId);
        if (!ex) continue;
        try {
          const claims = await ex.claimable(w.address);
          for (const c of claims) {
            if (!settledIds.has(c.marketId)) continue;
            try {
              const tx = await ex.redeem({ marketId: c.marketId, outcomeIdx: c.outcomeIdx, amount: c.amount });
              const sideName = c.outcomeIdx === 0 ? "YES" : "NO";
              for (const t of this.store.listTrades((x) => x.agentId === agentId && x.marketId === c.marketId && x.side === sideName && (x.status === "won" || x.status === "void"))) {
                t.redeemTxHash = tx;
                this.store.upsertTrade(t);
                this.emit("trade", t);
              }
            } catch (e: any) {
              console.error(`[engine] ${agentId} redeem failed ${c.marketId}:`, e?.message);
            }
          }
        } catch (e: any) {
          console.error(`[engine] ${agentId} claimable scan failed`, e?.message);
        }
      }
    }
  }

  private snapshotEquity(): void {
    const points: EquityPoint[] = [];
    for (const a of AGENTS) {
      const trades = this.store.listTrades((t) => t.agentId === a.id && (t.status === "won" || t.status === "lost" || t.status === "void"));
      const pnl = trades.reduce((s, t) => s + t.pnlCollateral, 0);
      const stake = trades.reduce((s, t) => s + t.costCollateral, 0);
      const wins = trades.filter((t) => t.status === "won").length;
      const losses = trades.filter((t) => t.status === "lost").length;
      points.push({ t: Date.now(), agentId: a.id, realizedPnl: pnl, stakeVolume: stake, wins, losses, trades: trades.length });
    }
    this.store.appendEquity(points);
    this.emit("equity", points);
  }
}
