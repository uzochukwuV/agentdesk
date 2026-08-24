const $ = (s) => document.querySelector(s);

let STATUS = null;
let WINDOWS = [];
let LEADER = [];
let EQUITY = [];
let PREDS = [];
let TRADES = [];
let explorerBase = "https://shannon-explorer.somnia.network/";

const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? "–" : Number(x).toFixed(d));
const pct = (x, d = 1) => (x == null ? "–" : `${x.toFixed(d)}%`);
const ago = (ms) => {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h`;
};
const countdown = (expiry) => {
  const left = Math.max(0, Math.floor(expiry - Date.now() / 1000));
  const m = Math.floor(left / 60);
  const s = left % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

let DESK = null;

function route() {
  const m = location.hash.match(/^#\/desk\/([a-z0-9]+)/i);
  const id = m?.[1] ?? null;
  document.getElementById("desk-view").classList.toggle("hidden", !id);
  document.getElementById("main-view").classList.toggle("hidden", !!id);
  if (id) renderDesk(id);
}
window.addEventListener("hashchange", route);

async function renderDesk(id) {
  let d = null;
  try {
    d = await fetch(`/api/agents/${id}`).then((r) => (r.ok ? r.json() : null));
  } catch {}
  if (!d) {
    document.getElementById("desk-title").textContent = "unknown desk";
    return;
  }
  const desk = (STATUS?.agents ?? []).find((a) => a.id === id);
  $("#desk-title").innerHTML = `<span class="dot" style="background:${d.color}"></span> ${d.name} <span class="hint">${desk?.style ?? d.style ?? ""}</span>`;
  $("#desk-style").textContent = desk?.description ?? d.description ?? "";

  // wallet + balances
  const wb = $("#desk-wallet");
  if (d.walletAddress) {
    const bal = d.balance ?? {};
    const cHuman = bal.collateralHuman == null ? "–" : fmt(bal.collateralHuman, 2);
    const nHuman = bal.nativeHuman == null ? "–" : fmt(bal.nativeHuman, 4);
    wb.innerHTML = `
      <div><span class="hint">desk wallet (on-chain, auditable)</span><br/>
        <a class="addr" href="${explorerBase}address/${d.walletAddress}" target="_blank">${d.walletAddress}</a>
        <button class="copy-btn" onclick="navigator.clipboard.writeText('${d.walletAddress}')">copy</button>
      </div>
      <div class="bal"><b>${cHuman}</b><span>tUSDC (testnet collateral)</span></div>
      <div class="bal"><b>${nHuman}</b><span>STT gas</span></div>
      <div class="bal"><b class="pnl ${d.pnl >= 0 ? "pos" : "neg"}">${fmt(d.pnl, 2)}</b><span>settled PnL</span></div>`;
  } else {
    wb.innerHTML = `<span class="hint">Paper mode — this desk trades simulated fills at real book prices. Set PAPER_TRADES=false for an on-chain wallet.</span>`;
  }

  // stat cards
  const winRate = d.won + d.lost > 0 ? pct((d.won / (d.won + d.lost)) * 100) : "–";
  $("#desk-stats").innerHTML = [
    [d.trades, "trades"],
    [`${d.won}-${d.lost}-${d.void}`, "won-lost-void"],
    [winRate, "win rate"],
    [pct(d.accuracyPct), "prediction accuracy"],
    [fmt(d.stake, 2), "staked"],
    [d.roiPct == null ? "–" : `${d.roiPct.toFixed(1)}%`, "ROI"],
    [d.bestTradePnL == null ? "–" : fmt(d.bestTradePnL, 2), "best trade"],
    [d.predictions, "predictions"],
  ].map(([v, l]) => `<div class="stat-card"><b>${v}</b><span>${l}</span></div>`).join("");

  // equity
  drawEquity($("#desk-equity"), d.equity ?? [], d.color);

  // predictions
  $("#desk-feed").innerHTML = (d.recentPredictions ?? []).map((p) => `
    <div class="pred">
      <div class="row1">
        <span class="dir ${p.direction}">${p.direction} on <b>${p.symbol}</b></span>
        ${dirTag(p)}
      </div>
      <div class="row2">${p.rationale}</div>
      <div class="kv">
        <span>P(UP) <b>${fmt(p.probUp, 3)}</b></span>
        <span>conf <b>${fmt(p.confidence * 100, 0)}%</b></span>
        <span>YES ${fmt(p.bookYes?.bid, 3)}/${fmt(p.bookYes?.ask, 3)}</span>
        <span>${ago(p.createdAt)} ago</span>
      </div>
    </div>`).join("") || `<div class="hint">no calls yet<span class="spin"></span></div>`;

  // trades
  $("#desk-trades").innerHTML = `<table><thead><tr><th>mode</th><th>market</th><th>side</th><th>qty</th><th>prc</th><th>status</th><th>pnl</th><th>tx</th></tr></thead><tbody>` +
    (d.recentTrades ?? []).map((t) => {
      const link = t.txHash ? `<a href="${explorerBase}tx/${t.txHash}" target="_blank">${t.txHash.slice(0, 10)}…</a>` : "";
      const redeem = t.redeemTxHash ? ` <a href="${explorerBase}tx/${t.redeemTxHash}" target="_blank">[redeem]</a>` : "";
      const pnlMsg = t.status === "open" ? "" : `<b class="pnl ${t.pnlCollateral >= 0 ? "pos" : "neg"}">${fmt(t.pnlCollateral, 2)}</b>${redeem}`;
      return `<tr><td><span class="mode-${t.mode}">${t.mode.toUpperCase()}</span></td><td>${t.symbol.split("/")[0]}</td><td>${t.side}</td><td class="num">${fmt(t.contracts, 2)}</td><td class="num">${t.price == null ? "–" : fmt(t.price, 3)}</td><td>${t.error ? t.error : t.status.toUpperCase()}</td><td class="num">${pnlMsg}</td><td>${link}</td></tr>`;
    }).join("") + `</tbody></table>`;
}

async function fetchAll() {
  const [status, active, leader, equity, preds, trades] = await Promise.all([
    fetch("/api/status").then((r) => r.json()),
    fetch("/api/active").then((r) => r.json()),
    fetch("/api/leaderboard").then((r) => r.json()),
    fetch("/api/equity").then((r) => r.json()),
    fetch("/api/predictions?limit=60").then((r) => r.json()),
    fetch("/api/trades?limit=120").then((r) => r.json()),
  ]);
  STATUS = status;
  WINDOWS = active;
  LEADER = leader;
  EQUITY = equity;
  PREDS = preds;
  TRADES = trades;
  explorerBase = status.network === "mainnet" ? "https://explorer.somnia.network/" : "https://shannon-explorer.somnia.network/";
  renderHeader();
  renderWindows();
  renderLeader();
  renderEquity();
  renderFeed();
  renderTrades();
  route();
}

function renderHeader() {
  const st = STATUS;
  $("#mode").textContent = st.paper ? "PAPER MODE" : "LIVE TESTNET";
  $("#mode").className = st.paper ? "pill paper" : "pill";
  $("#network").textContent = st.network === "mainnet" ? "Somnia Mainnet" : "Somnia Shannon";
  $("#cadence").textContent = `${(st.cadenceSec / 60) | 0}m windows`;
  const scanAgo = st.lastScan.at ? `${ago(st.lastScan.at)} scan` : "starting…";
  $("#latency").textContent = `${scanAgo}`;
  $("#stake").textContent = `(${fmt(st.stakeContracts, 0)} contracts/desk)`;
}

function renderWindows() {
  const el = $("#windows");
  if (!WINDOWS.length) {
    el.innerHTML = `<div class="window-card"><span class="hint">No active ${(STATUS?.cadenceSec ?? 900) / 60}m window right now<span class="spin"></span></span></div>`;
    return;
  }
  el.innerHTML = WINDOWS.map(({ window: w, predictions }) => {
    const chips = (predictions || [])
      .filter(Boolean)
      .map((p) => {
        const agent = (STATUS?.agents ?? []).find((a) => a.id === p.agentId) ?? { name: p.agentId, color: "#888" };
        return `<div class="pred-chip" title="${p.rationale ?? ""}">
          <div class="who"><span>${agent.name}</span><b style="color:${agent.color}">●</b></div>
          <div class="call ${p.direction.toLowerCase()}">${p.direction} ${fmt(p.confidence * 100, 0)}%</div>
          <div class="conf">${p.decision === "trade" ? "trading" : "watching"} · P(UP)=${fmt(p.probUp, 2)}</div>
        </div>`;
      })
      .join("");
    const yesMid = predictions?.[0]?.bookYes?.mid ?? null;
    return `<div class="window-card">
      <div class="head">
        <span class="sym">${w.symbol}</span>
        <span class="count" data-expiry="${w.expiry}">${countdown(w.expiry)}</span>
      </div>
      <div class="yesmid">YES mid ${fmt(yesMid, 3)} · status ${w.statusName ?? ""}</div>
      <div class="pred-strip">${chips || '<span class="hint">waiting for prices…</span>'}</div>
    </div>`;
  }).join("");
}

function tickDown() {
  document.querySelectorAll(".count").forEach((n) => {
    n.textContent = countdown(Number(n.dataset.expiry));
  });
}
setInterval(tickDown, 1000);

function renderLeader() {
  const tbody = $("#leader tbody");
  tbody.innerHTML = LEADER.map((s, i) => {
    const winRate = s.won + s.lost > 0 ? ((s.won / (s.won + s.lost)) * 100) : null;
    return `<tr class="${i === 0 ? "rank1" : ""}">
      <td>${i + 1}</td>
      <td><div class="desk"><span class="dot" style="background:${s.color}"></span><span class="nm"><a href="#/desk/${s.id}">${s.name}</a></span></div></td>
      <td title="${s.description.replace(/"/g, "&quot;")}"><span class="sty">${s.style}</span></td>
      <td class="num">${s.trades}</td>
      <td class="num">${s.won}-${s.lost}-${s.void}</td>
      <td class="num">${pct(winRate)}</td>
      <td class="num">${pct(s.accuracyPct)}</td>
      <td class="num">${fmt(s.stake, 2)}</td>
      <td class="num pnl ${s.pnl >= 0 ? "pos" : "neg"}">${fmt(s.pnl, 2)}</td>
      <td class="num">${s.roiPct == null ? "–" : `${s.roiPct.toFixed(1)}%`}</td>
    </tr>`;
  }).join("}");
  renderEquityLegend();
}

function renderEquityLegend() {
  $("#equity-legend").innerHTML = LEADER.map((s) => `<span><span class="dot" style="background:${s.color}"></span> ${s.name} (${fmt(s.pnl, 2)})</span>`).join("");
}

function drawEquity(canvas, points, color) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = Number(canvas.getAttribute("height") || 180);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  if (!points.length) {
    ctx.fillStyle = "#5b6b7c";
    ctx.font = "12px system-ui";
    ctx.fillText("No settled history yet.", 14, 24);
    return;
  }
  const minT = Math.min(...points.map((p) => p.t));
  const maxT = Math.max(...points.map((p) => p.t));
  let minY = Math.min(0, ...points.map((p) => p.realizedPnl));
  let maxY = Math.max(0, ...points.map((p) => p.realizedPnl));
  if (maxY - minY < 1) maxY = minY + 1;
  const pad = { l: 44, r: 8, t: 8, b: 18 };
  const X = (t) => pad.l + ((t - minT) / Math.max(1, maxT - minT)) * (w - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  ctx.strokeStyle = "#26323f";
  ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
  ctx.fillStyle = "#5b6b7c";
  ctx.font = "10px system-ui";
  ctx.fillText("0", 4, Y(0) + 3);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(X(p.t), Y(p.realizedPnl)) : ctx.lineTo(X(p.t), Y(p.realizedPnl))));
  ctx.stroke();
}

function renderEquity() {
  const canvas = $("#equity");
  const ctx = canvas.getContext("2d");
  if (!EQUITY.length) {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    canvas.width = w * dpr;
    canvas.height = 180 * dpr;
    ctx.scale(dpr, dpr);
    ctx.fillStyle = "#5b6b7c";
    ctx.font = "12px system-ui";
    ctx.fillText("Waiting for the first settled trades… equity builds per desk, in settled collateral.", 14, 24);
    return;
  }
  const byAgent = new Map();
  for (const p of EQUITY) {
    if (!byAgent.has(p.agentId)) byAgent.set(p.agentId, []);
    byAgent.get(p.agentId).push(p);
  }
  // Use shared scale across desks: draw background grid once, then each desk line on the same axes.
  const allT = EQUITY.map((p) => p.t);
  const minT = Math.min(...allT), maxT = Math.max(...allT);
  const allY = EQUITY.map((p) => p.realizedPnl);
  let minY = Math.min(0, ...allY), maxY = Math.max(0, ...allY);
  if (maxY - minY < 1) { maxY = minY + 1; }
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = 180;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);
  const pad = { l: 44, r: 8, t: 8, b: 18 };
  const X = (t) => pad.l + ((t - minT) / Math.max(1, maxT - minT)) * (w - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - minY) / (maxY - minY)) * (h - pad.t - pad.b);
  ctx.strokeStyle = "#26323f";
  ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke();
  ctx.fillStyle = "#5b6b7c";
  ctx.font = "10px system-ui";
  ctx.fillText("0", 4, Y(0) + 3);
  for (const [agentId, points] of byAgent) {
    const color = STATUS?.agents?.find((a) => a.id === agentId)?.color ?? "#888";
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((p, idx) => (idx === 0 ? ctx.moveTo(X(p.t), Y(p.realizedPnl)) : ctx.lineTo(X(p.t), Y(p.realizedPnl))));
    ctx.stroke();
  }
}

function dirTag(p) {
  if (p.status === "resolved") return `<span class="tag ${p.outcome}">${p.outcome}${p.outcome === "VOID" ? " (both pay 0.5)" : ""}</span>`;
  return `<span class="tag">${p.decision === "trade" ? "traded" : "published"}</span>`;
}

function renderFeed() {
  const el = $("#feed");
  el.innerHTML = PREDS.map((p) => {
    const agent = STATUS?.agents?.find((a) => a.id === p.agentId);
    const fe = Object.entries(p.features ?? {}).slice(0, 3).map(([k, v]) => `<span>${k} <b>${fmt(Number(v), 3)}</b></span>`).join("");
    return `<div class="pred">
      <div class="row1">
        <span class="dir ${p.direction}"><span class="dot" style="background:${agent?.color ?? "#888"}"></span> ${agent?.name ?? p.agentId} calls ${p.direction}</span>
        ${dirTag(p)}
      </div>
      <div class="row2"><b>${p.symbol}</b> · ${p.rationale} </div>
      <div class="kv">
        <span>P(UP) <b>${fmt(p.probUp, 3)}</b></span>
        <span>conf <b>${fmt(p.confidence * 100, 0)}%</b></span>
        <span>YES ${fmt(p.bookYes?.bid, 3)}/${fmt(p.bookYes?.ask, 3)}</span>
        ${fe}
        <span>${ago(p.createdAt)} ago</span>
      </div>
    </div>`;
  }).join("") || `<div class="hint">No predictions yet — the desks are watching the tape<span class="spin"></span></div>`;
}

function renderTrades() {
  const el = $("#trades");
  const rows = TRADES.map((t) => {
    const agent = STATUS?.agents?.find((a) => a.id === t.agentId);
    const link = t.txHash ? `<a href="${explorerBase}tx/${t.txHash}" target="_blank">${t.txHash.slice(0, 10)}…</a>` : "";
    const redeem = t.redeemTxHash ? `<a href="${explorerBase}tx/${t.redeemTxHash}" target="_blank">redeemed</a>` : "";
    const pnlMsg = t.status === "open" ? "" : `<b class="pnl ${t.pnlCollateral >= 0 ? "pos" : "neg"}">${fmt(t.pnlCollateral, 2)}</b>`;
    return `<tr>
      <td><span class="mode-${t.mode}">${t.mode.toUpperCase()}</span></td>
      <td>${agent?.name ?? t.agentId}</td>
      <td title="${t.symbol}">${t.symbol.split("/")[0]}</td>
      <td>${t.side}</td>
      <td class="num">${fmt(t.contracts, 2)}</td>
      <td class="num">${t.price == null ? "–" : fmt(t.price, 3)}</td>
      <td class="num">${t.error ? t.error : t.status.toUpperCase()}</td>
      <td class="num">${pnlMsg}${redeem}</td>
      <td>${link}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `<table>
    <thead><tr><th>mode</th><th>desk</th><th>market</th><th>side</th><th>qty</th><th>prc</th><th>status</th><th>pnl</th><th>tx</th></tr></thead>
    <tbody>${rows}</tbody></table>` || `<div class="hint">No trades yet<span class="spin"></span></div>`;
}

// SSE push triggers re-fetch on any event.
const es = new EventSource("/api/stream");
es.onmessage = () => fetchAll();
for (const type of ["prediction", "trade", "equity", "hello"]) es.addEventListener(type, () => fetchAll());
es.onerror = () => {};

// Polling fallback every 5s.
setInterval(fetchAll, 5000);
fetchAll();
