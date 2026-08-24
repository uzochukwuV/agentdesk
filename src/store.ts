import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface BookYes {
  bid: number | null;
  ask: number | null;
  mid: number | null;
}

export interface Prediction {
  id: string; // marketId:agentId
  agentId: string;
  marketId: string;
  symbol: string;
  yesSymbol: string;
  asset: string;
  intervalSec: number;
  expiry: number; // unix seconds
  windowStart: number; // estimated unix seconds (expiry - intervalSec)
  createdAt: number; // ms
  sourcePriceAtSignal: number | null; // live index price when predicted
  direction: "UP" | "DOWN";
  probUp: number; // 0..1
  confidence: number; // 0..1
  rationale: string;
  features: Record<string, number>;
  bookYes: BookYes;
  decision: "trade" | "skip";
  decisionReason: string;
  status: "pending" | "resolved";
  outcome: "WIN" | "LOSS" | "VOID" | null;
  resolution: { winningOutcome: 0 | 1 | null; voided: boolean } | null;
  resolvedAt: number | null; // ms
}

export interface Trade {
  id: string; // predictionId + seq
  predictionId: string;
  agentId: string;
  marketId: string;
  symbol: string;
  mode: "live" | "paper";
  side: "YES" | "NO";
  contracts: number;
  price: number | null; // entry price (YES-terms probability of the bought side)
  costCollateral: number;
  placedAt: number; // ms
  txHash: string | null;
  status: "open" | "failed" | "won" | "lost" | "void";
  error: string | null;
  payoutCollateral: number;
  pnlCollateral: number;
  redeemTxHash: string | null;
}

export interface EquityPoint {
  t: number; // ms
  agentId: string;
  realizedPnl: number;
  stakeVolume: number;
  wins: number;
  losses: number;
  trades: number;
}

interface State {
  predictions: Prediction[];
  trades: Trade[];
  equity: EquityPoint[];
}

const MAX_PREDICTIONS = 5000;
const MAX_TRADES = 5000;
const MAX_EQUITY = 20000;

export class Store {
  private state: State = { predictions: [], trades: [], equity: [] };
  private file: string;
  private dirty = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "state.json");
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, "utf8"));
        this.state = { predictions: parsed.predictions ?? [], trades: parsed.trades ?? [], equity: parsed.equity ?? [] };
        console.log(`[store] loaded ${this.state.predictions.length} predictions, ${this.state.trades.length} trades from ${this.file}`);
      } catch (e) {
        console.error("[store] failed to parse state.json, starting fresh", e);
      }
    }
    this.timer = setInterval(() => this.flush(), 5000);
    this.timer.unref?.();
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const stateToWrite = JSON.stringify(this.state);
    const tmp = this.file + ".tmp";
    try {
      writeFileSync(tmp, stateToWrite);
      renameSync(tmp, this.file);
    } catch (e) {
      console.error("[store] flush failed", e);
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.dirty = true;
    this.flush();
  }

  private mark(): void {
    this.dirty = true;
  }

  upsertPrediction(p: Prediction): void {
    const idx = this.state.predictions.findIndex((x) => x.id === p.id);
    if (idx >= 0) this.state.predictions[idx] = p;
    else {
      this.state.predictions.push(p);
      if (this.state.predictions.length > MAX_PREDICTIONS) this.state.predictions.shift();
    }
    this.mark();
  }

  getPrediction(id: string): Prediction | undefined {
    return this.state.predictions.find((p) => p.id === id);
  }

  listPredictions(predicate?: (p: Prediction) => boolean): Prediction[] {
    const list = predicate ? this.state.predictions.filter(predicate) : [...this.state.predictions];
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }

  upsertTrade(t: Trade): void {
    const idx = this.state.trades.findIndex((x) => x.id === t.id);
    if (idx >= 0) this.state.trades[idx] = t;
    else {
      this.state.trades.push(t);
      if (this.state.trades.length > MAX_TRADES) this.state.trades.shift();
    }
    this.mark();
  }

  listTrades(predicate?: (t: Trade) => boolean): Trade[] {
    const list = predicate ? this.state.trades.filter(predicate) : [...this.state.trades];
    return list.sort((a, b) => b.placedAt - a.placedAt);
  }

  appendEquity(points: EquityPoint[]): void {
    this.state.equity.push(...points);
    if (this.state.equity.length > MAX_EQUITY) this.state.equity.splice(0, this.state.equity.length - MAX_EQUITY);
    this.mark();
  }

  listEquity(): EquityPoint[] {
    return [...this.state.equity].sort((a, b) => a.t - b.t);
  }
}
