import type { BookYes } from "../store.js";

export interface Tick {
  t: number; // unix seconds (chain time)
  p: number; // spot index
  e: number; // EMA mark
}

export interface Candle {
  t: number; // bucket start
  o: number;
  h: number;
  l: number;
  c: number;
  n: number;
}

export interface SignalContext {
  asset: string;
  windowStart: number;
  windowEnd: number;
  nowSec: number;
  secsLeft: number;
  ticks: Tick[]; // newest first
  candles: Candle[]; // oldest first
  book: BookYes;
  openPrice: number | null;
  peers?: AgentOutput[]; // for the Quorum agent
}

export interface AgentOutput {
  agentId: string;
  probUp: number; // 0..1
  direction: "UP" | "DOWN";
  confidence: number; // 0..1
  rationale: string;
  features: Record<string, number>;
}

export interface Agent {
  id: string;
  name: string;
  style: string;
  description: string;
  color: string;
  predict(ctx: SignalContext): AgentOutput | null;
}

const LOGISTIC_K = 3;
const logistic = (x: number) => 1 / (1 + Math.exp(-x));

function stats(xs: number[]): { mean: number; sd: number } {
  if (!xs.length) return { mean: NaN, sd: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / Math.max(1, xs.length - 1));
  return { mean, sd };
}

function seriesWithin(ticks: Tick[], nowSec: number, spanSec: number): Tick[] {
  const end = nowSec;
  return ticks.filter((tk) => tk.t <= end && tk.t > end - spanSec);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

// ---------------------------------------------------------------- momentum
const momentum: Agent = {
  id: "momentum",
  name: "Momo",
  style: "Momentum Rider",
  description:
    "Follows the drift: linear-regression slope of the oracle index over the recent window, normalized by realized volatility. Rides with the trend.",
  color: "#6366f1",
  predict(ctx) {
    const lookback = Math.min(Math.max(120, ctx.windowEnd - ctx.windowStart), 600);
    const s = seriesWithin(ctx.ticks, ctx.nowSec, lookback);
    if (s.length < 10) {
      return {
        agentId: "momentum",
        probUp: 0.5,
        direction: "UP",
        confidence: 0,
        rationale: "insufficient ticks",
        features: { ticks: s.length },
      };
    }
    const span = Math.max(1, s.length);
    const newest = s[0];
    const oldest = s[span - 1];
    const dt = newest.t - oldest.t;
    // Per-tick increments (series is newest-first); z = total move vs random-walk expectation.
    const rets: number[] = [];
    for (let i = 0; i + 1 < s.length; i++) rets.push(s[i].p - s[i + 1].p);
    const { sd: rsd } = stats(rets);
    if (rsd === 0 || !isFinite(rsd)) return { agentId: "momentum", probUp: 0.5, direction: "UP", confidence: 0, rationale: "zero variance", features: { sd: rsd } };
    const move = newest.p - oldest.p;
    const z = move / (rsd * Math.sqrt(rets.length));
    const probUp = logistic(LOGISTIC_K * z);
    const direction = probUp >= 0.5 ? "UP" : "DOWN";
    const confidence = Math.min(1, Math.abs(z) / 2);
    return {
      agentId: "momentum",
      probUp,
      direction,
      confidence,
      rationale: `${direction} — ${span} ticks over ${dt}s, move z=${z.toFixed(2)} vs tick σ=${rsd.toFixed(4)}`,
      features: { move, sd: rsd, z, ticks: span, dt },
    };
  },
};

// ---------------------------------------------------------------- mean reversion
const meanrev: Agent = {
  id: "meanrev",
  name: "Revert",
  style: "Mean Reversion",
  description:
    "Compares the spot index against the oracle's EMA-smoothed mark. When spot overshoots the mark by multiple sigmas, it predicts the snap-back instead of the chase.",
  color: "#0891b2",
  predict(ctx) {
    const s = seriesWithin(ctx.ticks, ctx.nowSec, 120);
    if (s.length < 5) {
      return { agentId: "meanrev", probUp: 0.5, direction: "UP", confidence: 0, rationale: "insufficient ticks", features: { ticks: s.length } };
    }
    let deviations = s.map((t) => (t.e !== 0 ? (t.p - t.e) / Math.max(t.e, 1e-9) : 0));
    let { mean, sd } = stats(deviations);
    if (sd === 0 || !isFinite(sd)) {
      // Venue EMA tracks spot exactly — fall back to spot vs its own rolling mean.
      const closes = s.map((t) => t.p);
      const m = closes.reduce((a, b) => a + b, 0) / closes.length;
      deviations = closes.map((p) => (p - m) / Math.max(m, 1e-9));
      ({ mean, sd } = stats(deviations));
      if (sd === 0 || !isFinite(sd)) return { agentId: "meanrev", probUp: 0.5, direction: "UP", confidence: 0, rationale: "flat feed", features: { sd } };
    }
    const z = (mean - 0) / sd;
    const probUp = logistic(-LOGISTIC_K * z * 0.8);
    const direction = probUp >= 0.5 ? "UP" : "DOWN";
    const confidence = Math.min(1, Math.abs(z) / 1.8);
    return {
      agentId: "meanrev",
      probUp,
      direction,
      confidence,
      rationale: `${direction} — spot-vs-EMA deviation z=${(-z).toFixed(2)}; spot ${s[0].p.toFixed(2)} vs mark ${s[0].e.toFixed(2)}`,
      features: { z, spot: s[0].p, ema: s[0].e, ticks: s.length },
    };
  },
};

// ---------------------------------------------------------------- mispricing hunter (book vs fair)
const mispricing: Agent = {
  id: "mispricing",
  name: "Arbik",
  style: "Mispricing Hunter",
  description:
    "Estimates fair P(UP) from the drift of the last ~2 minutes, then compares against the market's implied YES price. Bets only when the market is off fair value.",
  color: "#d97706",
  predict(ctx) {
    const s = seriesWithin(ctx.ticks, ctx.nowSec, 120);
    if (s.length < 10 || ctx.book.mid == null) {
      return {
        agentId: "mispricing",
        probUp: 0.5,
        direction: "UP",
        confidence: 0,
        rationale: ctx.book.mid == null ? "no book" : "insufficient ticks",
        features: { ticks: s.length },
      };
    }
    // Fair prob from normalized recent slope (same idea as momentum but shorter).
    const ys = s.map((x) => x.p);
    const { sd } = stats(ys);
    const n = s.length;
    const dt = Math.max(1, s[0].t - s[n - 1].t);
    const slope = sd > 0 ? ((s[0].p - s[n - 1].p) / dt) / sd : 0;
    const fairUp = logistic(4 * slope * Math.sqrt(dt));
    const implied = ctx.book.mid;
    const edge = fairUp - implied;
    const probUp = fairUp;
    const direction = probUp >= 0.5 ? "UP" : "DOWN";
    const confidence = Math.min(1, Math.abs(edge) / 0.08);
    return {
      agentId: "mispricing",
      probUp,
      direction,
      confidence,
      rationale: `${direction} — fair P(UP)=${round3(fairUp)}, mkt YES=${round3(implied)}, edge=${round3(edge)}`,
      features: { fairUp, implied: implied ?? 0.5, edge, slope },
    };
  },
};

// ---------------------------------------------------------------- range breakout
const breakout: Agent = {
  id: "breakout",
  name: "Ranger",
  style: "Range Breakout",
  description:
    "Measures the current 2-realized-minute range against a longer baseline. When price escapes k·σ of the baseline, it follows the break; otherwise it inspects candle direction and stays cautious.",
  color: "#dc2626",
  predict(ctx) {
    const recent = seriesWithin(ctx.ticks, ctx.nowSec, 120);
    const base = seriesWithin(ctx.ticks, ctx.nowSec, 600);
    if (recent.length < 15 || base.length < 30) {
      return { agentId: "breakout", probUp: 0.5, direction: "UP", confidence: 0, rationale: "insufficient history", features: { recent: recent.length, base: base.length } };
    }
    const rp = recent.map((x) => x.p);
    const bp = base.map((x) => x.p);
    const { sd: recentSd } = stats(rp);
    const { sd: baseSd } = stats(bp);
    if (baseSd === 0 || !isFinite(baseSd) || recentSd === 0) {
      // Fall back on a simple candle direction bias, low confidence.
      const c = ctx.candles.slice(-3);
      const up = c.filter((x) => x.c >= x.o).length > c.length / 2;
      return {
        agentId: "breakout",
        probUp: up ? 0.6 : 0.4,
        direction: up ? "UP" : "DOWN",
        confidence: 0.2,
        rationale: `flat ranges — candle bias ${up ? "up" : "down"}`,
        features: { baseSd, recentSd },
      };
    }
    const latest = recent[0];
    const oldest = recent[recent.length - 1];
    const span = Math.max(1, latest.t - oldest.t);
    // Recent move vs baseline vol over the same window length: recent window is 120s,
    // so normalize the observed move against the baseline sigma for 120s.
    const move = (latest.p - oldest.p) / Math.max(1e-9, baseSd * Math.sqrt(span / 600));
    const probUp = logistic(2 * move);
    const expansion = recentSd / baseSd;
    const confidence = Math.min(1, Math.abs(move) / 1.8 + Math.min(0.5, expansion * 0.1));
    const direction = probUp >= 0.5 ? "UP" : "DOWN";
    return {
      agentId: "breakout",
      probUp,
      direction,
      confidence,
      rationale: `${direction} — move=${move.toFixed(2)}σ over ${span}s, vol expansion x${expansion.toFixed(2)}`,
      features: { move, expansion, recentSd, baseSd },
    };
  },
};

// ---------------------------------------------------------------- quorum (ensemble)
const quorum: Agent = {
  id: "quorum",
  name: "Quorum",
  style: "Ensemble Vote",
  description:
    "Meta model: confidence-weighted vote across the other agents. Trades only when the desk broadly agrees on the direction; otherwise reports the stalemate.",
  color: "#16a34a",
  predict(ctx) {
    const peers = ctx.peers ?? [];
    if (!peers.length) {
      return { agentId: "quorum", probUp: 0.5, direction: "UP", confidence: 0, rationale: "no peers", features: { peers: 0 } };
    }
    let w = 0;
    let upW = 0;
    let agree = 0;
    for (const p of peers) {
      const cw = Math.max(p.confidence, 0.05);
      w += cw;
      upW += cw * p.probUp;
      if (p.direction === "UP") agree += cw;
    }
    const probUp = upW / w;
    const direction = probUp >= 0.5 ? "UP" : "DOWN";
    const coherence = direction === "UP" ? agree / w : 1 - agree / w;
    const confidence = coherence;
    return {
      agentId: "quorum",
      probUp,
      direction,
      confidence,
      rationale: `${direction} — vote ${(coherence * 100).toFixed(0)}% for ${direction} across ${peers.length} desks, P(UP)=${round3(probUp)}`,
      features: { probUp, coherence, peers: peers.length },
    };
  },
};

export const AGENTS: Agent[] = [momentum, meanrev, mispricing, breakout, quorum];

export function runPredictions(ctx: Omit<SignalContext, "peers">): AgentOutput[] {
  const outputs: AgentOutput[] = [];
  for (const agent of AGENTS) {
    if (agent.id === "quorum") continue;
    const out = agent.predict({ ...ctx, peers: undefined });
    if (out) outputs.push(out);
  }
  // Quorum last, using peers.
  const q = quorum.predict({ ...ctx, peers: outputs });
  if (q) outputs.push(q);
  return outputs;
}
