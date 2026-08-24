import express from "express";
import { AGENTS } from "./agents/index.js";
import { config } from "./config.js";
import { Engine } from "./engine.js";
import { Store, type Trade, type Prediction } from "./store.js";
import { join } from "node:path";

const store = new Store(join(process.cwd(), config.dataDir));
const engine = new Engine(store);

interface AgentStats {
  id: string;
  name: string;
  style: string;
  description: string;
  color: string;
  predictions: number;
  resolvedPredictions: number;
  correctPredictions: number;
  accuracyPct: number | null;
  trades: number;
  won: number;
  lost: number;
  void: number;
  failed: number;
  pnl: number;
  stake: number;
  roiPct: number | null;
  bestTradePnL: number | null;
}

function statsFor(agentId: string): AgentStats {
  const agent = AGENTS.find((a) => a.id === agentId);
  const preds = store.listPredictions((p) => p.agentId === agentId);
  const resolved = preds.filter((p) => p.status === "resolved");
  const correct = resolved.filter((p) => p.outcome === "WIN").length;
  const voids = resolved.filter((p) => p.outcome === "VOID").length;
  const trades = store.listTrades((t) => t.agentId === agentId);
  const openish = trades.filter((t) => t.status === "open");
  const closedish = trades.filter((t) => ["won", "lost", "void"].includes(t.status));
  const won = closedish.filter((t) => t.status === "won").length;
  const lost = closedish.filter((t) => t.status === "lost").length;
  const failed = openish.filter((t) => t.status === "failed").length + trades.filter((t) => t.status === "failed").length;
  const pnl = closedish.reduce((s, t) => s + t.pnlCollateral, 0);
  const stake = closedish.reduce((s, t) => s + t.costCollateral, 0);
  const best = closedish.length ? Math.max(...closedish.map((t) => t.pnlCollateral)) : null;
  // predictive accuracy: resolved predictions without trades count too.
  const denominator = correct + (resolved.length - correct - voids);
  return {
    id: agentId,
    name: agent?.name ?? agentId,
    style: agent?.style ?? "",
    description: agent?.description ?? "",
    color: agent?.color ?? "#888",
    predictions: preds.length,
    resolvedPredictions: resolved.length,
    correctPredictions: correct,
    accuracyPct: denominator > 0 ? (correct / denominator) * 100 : null,
    trades: trades.length,
    won,
    lost,
    void: closedish.filter((t) => t.status === "void").length,
    failed: trades.filter((t) => t.status === "failed").length,
    pnl,
    stake,
    roiPct: stake > 0 ? (pnl / stake) * 100 : null,
    bestTradePnL: best,
  };
}

const app = express();
// Safe JSON: convert BigInt values to strings (they appear in market ids/quantity fields).
app.set("json spaces", 0);
const toSafe = (v: unknown): unknown =>
  JSON.parse(
    JSON.stringify(v, (_k, val) => (typeof val === "bigint" ? val.toString() : val))
  );
app.use((_req, res, next) => {
  const orig = res.json.bind(res);
  res.json = (body: any) => orig(toSafe(body));
  next();
});
app.use(express.static(join(process.cwd(), "public")));

// SSE
app.get("/api/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const send = (type: string, payload: unknown) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  };
  engine.attach({ onEvent: send });
  send("hello", { ok: true });
  req.on("close", () => {});
});

app.get("/api/status", (_req, res) => res.json(engine.status()));
app.get("/api/agents", (_req, res) => {
  const status = engine.status();
  const wallets = new Map(status.wallets.map((w: any) => [w.agentId, w.address]));
  const balances = status.balances as Record<string, any>;
  res.json(
    AGENTS.map((a) => ({
      ...statsFor(a.id),
      walletAddress: wallets.get(a.id) ?? null,
      balance: balances[a.id] ?? null,
    }))
  );
});
app.get("/api/agents/:id", (req, res) => {
  const id = String(req.params.id);
  if (!AGENTS.some((a) => a.id === id)) return res.status(404).json({ error: "unknown agent" });
  const status = engine.status();
  const wallets = new Map(status.wallets.map((w: any) => [w.agentId, w.address]));
  const balances = status.balances as Record<string, any>;
  const limit = Math.min(Number(req.query.limit ?? 100), 1000);
  res.json({
    ...statsFor(id),
    walletAddress: wallets.get(id) ?? null,
    balance: balances[id] ?? null,
    recentPredictions: store.listPredictions((p) => p.agentId === id).slice(0, limit),
    recentTrades: store.listTrades((t) => t.agentId === id).slice(0, limit),
    equity: store.listEquity().filter((e) => e.agentId === id),
  });
});
app.get("/api/leaderboard", (_req, res) => {
  const stats = AGENTS.map((a) => statsFor(a.id));
  stats.sort((x, y) => y.pnl - x.pnl);
  res.json(stats);
});
app.get("/api/predictions", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 1000);
  res.json(store.listPredictions().slice(0, limit));
});
app.get("/api/trades", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 200), 2000);
  res.json(store.listTrades().slice(0, limit));
});
app.get("/api/equity", (_req, res) => res.json(store.listEquity()));
app.get("/api/active", (_req, res) => {
  // Current windows + the latest prediction per agent on each window.
  const status = engine.status();
  const out = Object.values(status.windows).flatMap((w: any) =>
    w?.marketId
      ? {
          window: w,
          predictions: AGENTS.map((a) => statsFor(a.id).id).map((id) => store.getPrediction(`${w.marketId}:${id}`) ?? null),
        }
      : []
  );
  res.json(out);
});

app.get("/", (_req, res) => {
  res.sendFile(join(process.cwd(), "public", "index.html"));
});

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] predicting-agents dashboard on http://${config.host}:${config.port}`);
});

process.on("SIGINT", () => {
  console.log("shutting down...");
  engine.stop();
  store.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
});

engine.start().catch((e) => {
  console.error("[engine] failed to start", e);
});
