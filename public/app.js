const $ = (s) => document.querySelector(s);
let STATUS = null, WINDOWS = [], LEADER = [], EQUITY = [], PREDS = [], TRADES = [], PRICE_SERIES = {};
let walletAddress = localStorage.getItem("agentdesk.wallet") || null;
let activeTrade = { marketId: null, symbol: "", side: "YES", agent: "" };
let tradePreview = null, previewSeq = 0, previewTimer = null;
const followed = new Set(JSON.parse(localStorage.getItem("agentdesk.following") || "[]"));
const localOrders = JSON.parse(localStorage.getItem("agentdesk.orders") || "[]");
const explorerBase = "https://shannon-explorer.somnia.network/";
const fmt = (x, d = 2) => x == null || Number.isNaN(Number(x)) ? "–" : Number(x).toFixed(d);
const pct = (x, d = 1) => x == null ? "–" : `${Number(x).toFixed(d)}%`;
const money = (x, d = 2) => x == null || Number.isNaN(Number(x)) ? "–" : `$${Number(x).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const ago = (ms) => { const s = Math.max(0, Math.floor((Date.now() - ms) / 1000)); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`; };
const countdown = (expiry) => { const left = Math.max(0, Math.floor(expiry - Date.now() / 1000)); return `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`; };
const short = (a) => a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "Not connected";
const pageMeta = {
  overview: ["Overview", "Workspace / Overview", "Live desk network"],
  agents: ["Agents", "Workspace / Agents", "Compare the strategy desks"],
  system: ["System", "Workspace / System", "Runtime and network health"],
  account: ["My account", "Workspace / My account", "Wallet, watchlist, and activity"],
};
function saveFollows() { localStorage.setItem("agentdesk.following", JSON.stringify([...followed])); }
function saveOrders() { localStorage.setItem("agentdesk.orders", JSON.stringify(localOrders.slice(0, 30))); }
function toast(message) { const el = $("#toast"); el.textContent = message; el.classList.add("show"); setTimeout(() => el.classList.remove("show"), 2600); }
function setPageMeta(key, detail = false) {
  const meta = detail ? ["Agent detail", "Workspace / Agents / Detail", "Strategy profile"] : pageMeta[key] || pageMeta.overview;
  $("#page-title").textContent = meta[0]; $("#breadcrumbs").innerHTML = meta[1].replace(" / ", " <span>/</span> ");
}
function updateWalletUi() {
  document.querySelectorAll("[data-connect]").forEach((b) => { b.textContent = walletAddress ? short(walletAddress) : "Connect wallet"; });
  $("#landing-mode").textContent = STATUS?.live ? "LIVE TESTNET" : "CONNECTING";
  $("#app-mode").textContent = STATUS?.live ? "LIVE TESTNET" : "CONNECTING";
}
async function connectWallet() {
  if (walletAddress) { walletAddress = null; localStorage.removeItem("agentdesk.wallet"); updateWalletUi(); renderCurrent(); toast("Wallet disconnected"); return; }
  if (!window.ethereum) { toast("Install an injected wallet such as MetaMask first"); return; }
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    if (!accounts?.[0]) return;
    const target = "0xc488"; const current = await window.ethereum.request({ method: "eth_chainId" });
    if (current.toLowerCase() !== target) {
      try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: target }] }); }
      catch (error) {
        if (error.code !== 4902) throw error;
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: target, chainName: "Somnia Testnet", nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 }, rpcUrls: ["https://api.infra.testnet.somnia.network"], blockExplorerUrls: [explorerBase] }] });
      }
    }
    walletAddress = accounts[0]; localStorage.setItem("agentdesk.wallet", walletAddress); updateWalletUi(); renderCurrent(); toast("Wallet connected on Somnia testnet");
  } catch (error) { toast(error?.message?.slice(0, 110) || "Wallet connection cancelled"); }
}
document.addEventListener("click", (event) => {
  const connect = event.target.closest("[data-connect]"); if (connect) connectWallet();
  const follow = event.target.closest("[data-follow]"); if (follow) toggleFollow(follow.dataset.follow);
  const trade = event.target.closest("[data-trade]"); if (trade) openTrade(trade.dataset.trade, trade.dataset.symbol, trade.dataset.side, trade.dataset.agent);
  const close = event.target.closest("[data-close-trade]"); if (close) closeTrade();
  const copy = event.target.closest("[data-copy]"); if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); toast("Address copied"); }
  const menu = event.target.closest(".mobile-menu"); if (menu) $(".product-frame").classList.toggle("menu-open");
  if (event.target.closest(".side-nav a")) $(".product-frame").classList.remove("menu-open");
});
window.ethereum?.on?.("accountsChanged", (accounts) => { walletAddress = accounts?.[0] || null; walletAddress ? localStorage.setItem("agentdesk.wallet", walletAddress) : localStorage.removeItem("agentdesk.wallet"); updateWalletUi(); renderCurrent(); });

function toggleFollow(id) {
  followed.has(id) ? followed.delete(id) : followed.add(id); saveFollows(); updateWalletUi(); renderCurrent();
  toast(followed.has(id) ? "Desk added to your watchlist" : "Desk removed from your watchlist");
}
function followButton(id) { return `<button class="follow-button ${followed.has(id) ? "following" : ""}" data-follow="${esc(id)}">${followed.has(id) ? "Following" : "Follow desk"}</button>`; }
function currentWindow() { return WINDOWS.find((item) => item.window.marketId === activeTrade.marketId)?.window; }
function currentBook() { return (WINDOWS.find((item) => item.window.marketId === activeTrade.marketId)?.predictions || []).find(Boolean)?.bookYes || null; }
function currentSignal() {
  const row = WINDOWS.find((item) => item.window.marketId === activeTrade.marketId);
  return (row?.predictions || []).find((p) => {
    const agent = STATUS?.agents?.find((a) => a.id === p.agentId);
    return activeTrade.agent && (p.agentId === activeTrade.agent || agent?.name === activeTrade.agent);
  }) || (row?.predictions || []).find(Boolean) || null;
}
function openTrade(marketId, symbol, side = "YES", agent = "") {
  activeTrade = { marketId, symbol, side, agent };
  const signal = currentSignal();
  $("#trade-title").textContent = `Copy ${agent || "this"} signal`;
  $("#trade-context").innerHTML = `<b>${esc(symbol)} · ${side === "YES" ? "YES / UP" : "NO / DOWN"}</b><br /><span>${signal ? `${esc(agent || "Desk")} calls ${esc(signal.direction)} · P(UP) ${fmt(signal.probUp, 3)} · confidence ${fmt(signal.confidence * 100, 0)}%` : "Agent signal context is not available for this window."}</span>`;
  setSide(side); $("#trade-status").textContent = ""; $("#trade-status").className = "trade-status"; $("#trade-modal").classList.remove("hidden"); $("#trade-modal").setAttribute("aria-hidden", "false"); updateTradeSummary();
}
function closeTrade() { $("#trade-modal").classList.add("hidden"); $("#trade-modal").setAttribute("aria-hidden", "true"); }
function setSide(side) { activeTrade.side = side; document.querySelectorAll(".side-option").forEach((b) => b.classList.toggle("active", b.dataset.side === side)); updateTradeSummary(); }
document.querySelectorAll(".side-option").forEach((b) => b.addEventListener("click", () => setSide(b.dataset.side)));
function scheduleTradePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updateTradeSummary, 240);
}
$("#trade-contracts").addEventListener("input", scheduleTradePreview); $("#trade-slippage").addEventListener("input", scheduleTradePreview);
async function updateTradeSummary() {
  const summary = $("#trade-summary"), qty = Number($("#trade-contracts")?.value || 10);
  if (!summary) return;
  tradePreview = null;
  const requestId = ++previewSeq;
  if (!Number.isFinite(qty) || qty < 1 || qty > 1000) {
    summary.innerHTML = `<span class="quote-warning">Enter between 1 and 1,000 contracts.</span>`;
    return;
  }
  summary.innerHTML = `<span class="quote-loading"><span class="spin"></span> Walking the live ${esc(activeTrade.symbol)} book…</span>`;
  try {
    const response = await fetch("/api/user/order/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId: activeTrade.marketId, side: activeTrade.side, contracts: qty }) });
    const quote = await response.json();
    if (requestId !== previewSeq) return;
    if (!response.ok) throw new Error(quote.error || "Quote unavailable");
    tradePreview = quote;
    const partial = quote.filledContracts + 0.000001 < quote.quotedContracts;
    if (quote.filledContracts <= 0) {
      summary.innerHTML = `<span class="quote-warning">No liquidity is available for this size. Reduce the contracts or wait for the book to refill.</span>`;
      return;
    }
    summary.innerHTML = `<div class="quote-grid"><span>Average entry<b>${fmt(quote.avgPrice, 3)}</b></span><span>Estimated max cost<b>${fmt(quote.costCollateral, 3)} tUSDC</b></span><span>Quoted size<b>${fmt(quote.quotedContracts, 2)} contracts</b></span><span>Expected fill<b>${fmt(quote.filledContracts, 2)} contracts</b></span><span>Book levels<b>${quote.levelsConsumed}</b></span><span>Slippage vs mid<b>${fmt(Math.abs(quote.slippageVsMid) * 100, 2)} pts</b></span></div>${partial ? `<div class="quote-warning">Thin book: ${fmt(quote.wouldRestContracts, 2)} contracts would not fill and will be cancelled by IOC.</div>` : ""}<div class="quote-note">Quote refreshed from the live book. Execution can change before confirmation.</div>`;
  } catch (error) {
    if (requestId !== previewSeq) return;
    summary.innerHTML = `<span class="quote-warning">Quote unavailable: ${esc(error?.message || "the market may be between windows")}</span>`;
  }
}
async function waitReceipt(hash) {
  for (let i = 0; i < 45; i++) { const receipt = await window.ethereum.request({ method: "eth_getTransactionReceipt", params: [hash] }); if (receipt) return receipt; await new Promise((resolve) => setTimeout(resolve, 1500)); }
  return null;
}
async function sendCall(call, label) {
  $("#trade-status").textContent = `${label} — confirm in your wallet…`;
  const hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: walletAddress, to: call.to, data: call.data, value: call.value }] });
  $("#trade-status").innerHTML = `${label} submitted · <a target="_blank" href="${explorerBase}tx/${hash}">${hash.slice(0, 12)}…</a> <span class="spin"></span>`;
  const receipt = await waitReceipt(hash); if (!receipt || receipt.status === "0x0") throw new Error(`${label} failed on-chain`); return hash;
}
$("#trade-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const button = $("#submit-trade"), status = $("#trade-status");
  if (!walletAddress) { status.textContent = "Connect your wallet before preparing an order."; status.className = "trade-status error"; return; }
  button.disabled = true; button.textContent = "Building order…"; status.textContent = ""; status.className = "trade-status";
  try {
    const contracts = Number($("#trade-contracts").value), slippageBps = Number($("#trade-slippage").value) * 100;
    const response = await fetch("/api/user/order/build", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ marketId: activeTrade.marketId, owner: walletAddress, side: activeTrade.side, contracts, slippageBps }) });
    const built = await response.json(); if (!response.ok) throw new Error(built.error || "Could not prepare order");
    status.textContent = "Order prepared. Your wallet will ask for approval, then the IOC order."; button.textContent = "Approve & place order →";
    if (built.approval) await sendCall(built.approval, "Token approval");
    const hash = await sendCall(built.order, "Order transaction");
    localOrders.unshift({ hash, symbol: activeTrade.symbol, side: activeTrade.side, contracts, createdAt: Date.now() }); saveOrders();
    status.innerHTML = `Order confirmed · <a target="_blank" href="${explorerBase}tx/${hash}">View on explorer ↗</a>`; button.textContent = "Order placed"; toast("Your order was submitted on-chain");
  } catch (error) { status.textContent = error?.message || "Order cancelled"; status.className = "trade-status error"; button.textContent = "Try again →"; }
  finally { button.disabled = false; if (button.textContent === "Approve & place order →") button.textContent = "Prepare order →"; }
});

function renderWindowCards() {
  if (!WINDOWS.length) return '<div class="empty-state">No eligible event-contract window is active right now. The desk network is still scanning for the next BTC/ETH market.</div>';
  return WINDOWS.map(({ window: w, predictions }) => {
    const chips = (predictions || []).filter(Boolean).map((p) => { const a = STATUS?.agents?.find((x) => x.id === p.agentId) || { name: p.agentId, color: "#888" }; return `<div class="pred-chip"><div class="who"><span>${esc(a.name)}</span><b style="color:${a.color}">●</b></div><div class="call ${p.direction.toLowerCase()}">${p.direction} ${fmt(p.confidence * 100, 0)}%</div><div class="conf">${p.decision === "trade" ? "active signal" : "watching"} · P(UP) ${fmt(p.probUp, 2)}</div></div>`; }).join("");
    const lead = (predictions || []).find(Boolean); const side = lead?.direction === "DOWN" ? "NO" : "YES"; const agent = lead ? STATUS?.agents?.find((a) => a.id === lead.agentId)?.name || lead.agentId : "";
    const current = w.currentPrice ?? lead?.sourcePriceAtSignal;
    const question = w.question || `Will ${w.asset} be above the market strike at expiry?`;
    const bid = lead?.bookYes?.bid, ask = lead?.bookYes?.ask;
    return `<article class="window-card"><div class="head"><span class="sym">${esc(w.asset)} event</span><span class="count" data-expiry="${w.expiry}">${countdown(w.expiry)}</span></div><div class="event-question"><span>QUESTION</span><b>${esc(question)}</b></div><div class="window-meta">${esc(w.symbol)} · ${esc(w.statusName || "TRADING")} · closes in ${countdown(w.expiry)}</div><div class="event-facts"><span>Current ${esc(w.asset)} <b>${money(current)}</b></span><span>YES probability <b>${fmt(lead?.bookYes?.mid, 3)}</b></span></div><div class="quote-strip"><div><small>YES BID</small><b>${fmt(bid, 3)}</b></div><div><small>YES ASK</small><b>${fmt(ask, 3)}</b></div><div><small>SPREAD</small><b>${bid != null && ask != null ? fmt(ask - bid, 3) : "—"}</b></div><div><small>MODE</small><b>${lead?.decision === "trade" ? "IOC" : "WATCH"}</b></div></div><div class="pred-strip">${chips || '<span class="heading-note">Waiting for desk quotes…</span>'}</div><div class="window-actions">${lead ? `<button class="trade-button" data-trade="${esc(w.marketId)}" data-symbol="${esc(w.symbol)}" data-side="${side}" data-agent="${esc(agent)}">Copy ${side} call →</button>` : ""}<a href="#/app/agents" class="follow-button">View desks</a></div></article>`;
  }).join("");
}
function renderDeskCards() {
  return LEADER.map((s, i) => `<article class="desk-card"><div class="desk-top"><span class="desk-rank">0${i + 1}</span>${followButton(s.id)}</div><a href="#/app/agents/${esc(s.id)}" class="desk-name">${esc(s.name)}</a><div class="desk-style">${esc(s.style)}</div><div class="desk-stat"><div><small>settled PnL</small><b class="${s.pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${fmt(s.pnl, 2)}</b></div><div><small>accuracy</small><b>${pct(s.accuracyPct)}</b></div></div><a href="#/app/agents/${esc(s.id)}" class="desk-link">Open profile ↗</a></article>`).join("");
}
function dirTag(p) { return p.status === "resolved" ? `<span class="tag ${p.outcome}">${p.outcome}</span>` : `<span class="tag">${p.decision === "trade" ? "traded" : "published"}</span>`; }
function signalVerdict(p) {
  if (p.status === "resolved") {
    return p.outcome === "WIN" ? { label: "WON", className: "winning" } : p.outcome === "LOSS" ? { label: "LOST", className: "losing" } : { label: "VOID", className: "waiting" };
  }
  const row = WINDOWS.find((item) => item.window.marketId === p.marketId);
  const opening = row?.window.openingPrice, current = row?.window.currentPrice ?? PRICE_SERIES[p.asset]?.at(-1)?.price;
  if (opening == null || current == null) return { label: "WAITING", className: "waiting" };
  const marketIsUp = Number(current) >= Number(opening);
  const aligned = p.direction === "UP" ? marketIsUp : !marketIsUp;
  return aligned ? { label: "WINNING", className: "winning" } : { label: "LOSING", className: "losing" };
}
function renderFeed(limit = 8) {
  return PREDS.slice(0, limit).map((p) => {
    const a = STATUS?.agents?.find((x) => x.id === p.agentId);
    const row = WINDOWS.find((item) => item.window.marketId === p.marketId);
    const opening = row?.window.openingPrice;
    const current = row?.window.currentPrice ?? PRICE_SERIES[p.asset]?.at(-1)?.price;
    const verdict = signalVerdict(p);
    const question = row?.window.question || `${p.asset} event`;
    return `<div class="pred"><div class="row1"><span class="dir ${p.direction}"><span class="dot" style="background:${a?.color || "#888"}"></span>${esc(a?.name || p.agentId)} calls ${p.direction}</span><span class="signal-verdict ${verdict.className}">${verdict.label}</span></div><div class="row2"><b>${esc(p.asset)}</b> · ${esc(question)}</div><div class="signal-prices"><span><small>OPENING</small><b>${money(opening)}</b></span><span><small>NOW</small><b>${money(current)}</b></span><span><small>STATUS</small><b class="${verdict.className}">${verdict.label}</b></span></div><div class="kv"><span>P(UP) <b>${fmt(p.probUp, 3)}</b></span><span>confidence <b>${fmt(p.confidence * 100, 0)}%</b></span><span>YES <b>${fmt(p.bookYes?.bid, 3)} / ${fmt(p.bookYes?.ask, 3)}</b></span><span>${ago(p.createdAt)} ago</span></div></div>`;
  }).join("") || '<div class="empty-state">No predictions yet — the desks are watching the tape.</div>';
}
function renderTrades(limit = 8) {
  const rows = TRADES.slice(0, limit).map((t) => { const a = STATUS?.agents?.find((x) => x.id === t.agentId); const tx = t.txHash ? `<a target="_blank" href="${explorerBase}tx/${t.txHash}">${t.txHash.slice(0, 9)}…</a>` : ""; return `<tr><td class="mode-${t.mode}">${t.mode.toUpperCase()}</td><td>${esc(a?.name || t.agentId)}</td><td>${esc(t.symbol.split("/")[0])}</td><td>${t.side}</td><td class="num">${fmt(t.contracts, 1)}</td><td class="num">${t.price == null ? "–" : fmt(t.price, 3)}</td><td class="num">${t.error ? esc(t.error) : t.status.toUpperCase()}</td><td>${tx}</td></tr>`; }).join("");
  return `<table><thead><tr><th>mode</th><th>desk</th><th>market</th><th>side</th><th>qty</th><th>price</th><th>status</th><th>tx</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function drawEquity(canvas, points, color) {
  const ctx = canvas.getContext("2d"), dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = Number(canvas.height); canvas.width = w * dpr; canvas.height = h * dpr; ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
  if (!points.length) { ctx.fillStyle = "#8e93a7"; ctx.font = "11px DM Mono"; ctx.fillText("No settled history yet.", 14, 25); return; }
  const minT = Math.min(...points.map((p) => p.t)), maxT = Math.max(...points.map((p) => p.t)); let minY = Math.min(0, ...points.map((p) => p.realizedPnl)), maxY = Math.max(0, ...points.map((p) => p.realizedPnl)); if (maxY - minY < 1) maxY = minY + 1;
  const X = (t) => 44 + ((t - minT) / Math.max(1, maxT - minT)) * (w - 52), Y = (y) => 8 + (1 - (y - minY) / (maxY - minY)) * (h - 26); ctx.strokeStyle = "#292c3a"; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke(); ctx.strokeStyle = color || "#aa91ff"; ctx.lineWidth = 2; ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.realizedPnl)) : ctx.moveTo(X(p.t), Y(p.realizedPnl))); ctx.stroke();
}
function renderChart(points = EQUITY) {
  const canvas = $("#equity-chart"); if (!canvas) return; const by = new Map(); points.forEach((p) => { if (!by.has(p.agentId)) by.set(p.agentId, []); by.get(p.agentId).push(p); });
  const all = points; if (!all.length) { drawEquity(canvas, []); return; } const minT = Math.min(...all.map((p) => p.t)), maxT = Math.max(...all.map((p) => p.t)); let minY = Math.min(0, ...all.map((p) => p.realizedPnl)), maxY = Math.max(0, ...all.map((p) => p.realizedPnl)); if (maxY - minY < 1) maxY = minY + 1; const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = 180; canvas.width = w * dpr; canvas.height = h * dpr; const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); const X = (t) => 44 + ((t - minT) / Math.max(1, maxT - minT)) * (w - 52), Y = (y) => 8 + (1 - (y - minY) / (maxY - minY)) * (h - 26); ctx.strokeStyle = "#292c3a"; ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(w, Y(0)); ctx.stroke(); by.forEach((ps, id) => { ctx.strokeStyle = STATUS?.agents?.find((a) => a.id === id)?.color || "#888"; ctx.lineWidth = 2; ctx.beginPath(); ps.forEach((p, i) => i ? ctx.lineTo(X(p.t), Y(p.realizedPnl)) : ctx.moveTo(X(p.t), Y(p.realizedPnl))); ctx.stroke(); });
}
function renderPriceCharts() {
  document.querySelectorAll("[data-price-chart]").forEach((canvas) => {
    const points = PRICE_SERIES[canvas.dataset.priceChart] || [];
    const dpr = devicePixelRatio || 1, w = canvas.clientWidth, h = 150;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    if (points.length < 2) {
      ctx.fillStyle = "#777d91"; ctx.font = "10px monospace"; ctx.fillText("Waiting for oracle ticks…", 12, 28); return;
    }
    const values = points.map((p) => Number(p.price)).filter(Number.isFinite);
    const min = Math.min(...values), max = Math.max(...values), pad = Math.max((max - min) * .12, max * .0005);
    const lo = min - pad, hi = max + pad;
    const X = (i) => 8 + (i / Math.max(1, points.length - 1)) * (w - 16);
    const Y = (v) => 10 + (1 - (v - lo) / Math.max(1, hi - lo)) * (h - 25);
    ctx.strokeStyle = "#292c3a"; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) { const y = 10 + i * ((h - 25) / 2); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const gradient = ctx.createLinearGradient(0, 0, 0, h); gradient.addColorStop(0, "rgba(201,243,106,.24)"); gradient.addColorStop(1, "rgba(201,243,106,0)");
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(X(i), Y(Number(p.price))) : ctx.moveTo(X(i), Y(Number(p.price)))); ctx.lineTo(X(points.length - 1), h - 15); ctx.lineTo(X(0), h - 15); ctx.closePath(); ctx.fillStyle = gradient; ctx.fill();
    ctx.beginPath(); points.forEach((p, i) => i ? ctx.lineTo(X(i), Y(Number(p.price))) : ctx.moveTo(X(i), Y(Number(p.price)))); ctx.strokeStyle = "#c9f36a"; ctx.lineWidth = 2; ctx.stroke();
  });
}

function renderMarketTape() {
  const assets = STATUS?.assets || ["BTC", "ETH"];
  const items = assets.map((asset) => {
    const points = PRICE_SERIES[asset] || [];
    const last = points.at(-1);
    const previous = points.at(-2);
    const price = Number(last?.price);
    const delta = Number.isFinite(price) && Number.isFinite(Number(previous?.price)) ? price - Number(previous.price) : 0;
    const active = WINDOWS.find((item) => item.window.asset === asset);
    const lead = active?.predictions?.find(Boolean);
    const direction = lead?.direction === "DOWN" ? "DOWN" : lead ? "UP" : "—";
    return `<div class="tape-item"><span class="tape-symbol">${esc(asset)} <small>/ USD</small></span><b>${money(price)}</b><span class="${delta >= 0 ? "tape-up" : "tape-down"}">${delta >= 0 ? "+" : ""}${money(delta)}</span><span class="tape-signal ${direction === "UP" ? "tape-up" : direction === "DOWN" ? "tape-down" : ""}">${direction} desk signal</span></div>`;
  }).join("");
  const activeCount = WINDOWS.length;
  const mode = STATUS?.paper ? "PAPER" : STATUS?.live ? "LIVE TESTNET" : "OFFLINE";
  const tape = $("#market-tape");
  if (tape) tape.innerHTML = `${items}<div class="tape-status"><span class="health-dot"></span>${activeCount} active window${activeCount === 1 ? "" : "s"} <b>${mode}</b></div>`;
}

function renderOverview() {
  const trades = TRADES.filter((t) => t.status !== "failed"), liveWindows = WINDOWS.length, followedCount = followed.size;
  renderMarketTape();
  $("#page-content").innerHTML = `<div class="page-intro"><div><span class="section-kicker">AGENT TRADING TERMINAL</span><h2>Read the desks. Trade the edge.</h2><p>Binance-style market context for autonomous event-contract agents. Every call is public; every order stays under your control.</p></div><div class="page-actions"><a class="section-link" href="#/app/agents">Compare desks →</a><a class="section-link" href="#/app/system">System status</a></div></div>
    <div class="metric-grid"><div class="metric-card"><small>Active windows</small><b>${liveWindows.toString().padStart(2, "0")}</b><div class="trend">BTC + ETH monitored</div></div><div class="metric-card"><small>Desks online</small><b>${STATUS?.agents?.length || 5}</b><div class="trend">All systems operational</div></div><div class="metric-card"><small>Following</small><b>${followedCount.toString().padStart(2, "0")}</b><div class="trend"><a href="#/app/account">Manage watchlist →</a></div></div><div class="metric-card"><small>Network trades</small><b>${trades.length}</b><div class="trend">Public activity log</div></div></div>
    <section class="panel"><div class="panel-heading"><div><span class="section-kicker">MARKET PULSE</span><h2>What the market is asking</h2><p class="panel-subtitle">The event resolves against the oracle price at expiry.</p></div><span class="tiny-live">UPDATING LIVE</span></div><div class="windows">${renderWindowCards()}</div></section>
    <section class="panel price-panel"><div class="panel-heading"><div><span class="section-kicker">ORACLE PRICES</span><h2>Where the market is now</h2><p class="panel-subtitle">Live Somnia price feed, shown in dollars.</p></div><span class="heading-note">Streaming live data</span></div><div class="price-chart-grid">${(STATUS?.assets || ["BTC", "ETH"]).map((asset) => { const last = PRICE_SERIES[asset]?.at(-1); return `<div class="price-chart-card"><div class="price-chart-heading"><span>${esc(asset)} / USD</span><b>${money(last?.price)}</b></div><canvas data-price-chart="${esc(asset)}" height="150"></canvas><div class="chart-caption">Recent oracle ticks · ${last ? `${ago(last.t * 1000)} ago` : "waiting for ticks"}</div></div>`; }).join("")}</div></section>
    <div class="content-grid"><section class="panel"><div class="panel-heading"><div><span class="section-kicker">DESK RANKING</span><h2>Who is seeing what?</h2></div><a class="section-link" href="#/app/agents">All agents →</a></div><div class="desk-grid">${renderDeskCards()}</div></section><section class="panel"><div class="panel-heading"><div><span class="section-kicker">FOLLOWING</span><h2>Your watchlist</h2></div><a class="section-link" href="#/app/account">View all →</a></div>${renderWatchlist(true)}</section></div>
    <div class="content-grid"><section class="panel"><div class="panel-heading"><div><span class="section-kicker">SIGNAL FEED</span><h2>Latest calls</h2></div><span class="heading-note">Published before resolution</span></div><div class="feed">${renderFeed()}</div></section><section class="panel"><div class="panel-heading"><div><span class="section-kicker">EXECUTION</span><h2>Network activity</h2></div><a class="section-link" href="#/app/system">View system →</a></div><div class="trades">${renderTrades()}</div></section></div>
    <section class="panel equity-panel"><div class="panel-heading"><div><span class="section-kicker">PERFORMANCE</span><h2>Settled PnL</h2></div><span class="heading-note">Not marks-to-market</span></div><canvas id="equity-chart" height="180"></canvas><div class="equity-legend">${LEADER.map((s) => `<span><span class="dot" style="background:${s.color}"></span>${esc(s.name)} ${fmt(s.pnl, 2)}</span>`).join("")}</div></section>`;
  renderChart();
  renderPriceCharts();
}
function renderWatchlist(compact = false) {
  const items = LEADER.filter((s) => followed.has(s.id));
  if (!items.length) return `<div class="empty-state">You are not following any desks yet.<br /><a href="#/app/agents" class="desk-link">Explore the five strategies →</a></div>`;
  return `<div class="watch-list">${items.map((s) => `<div class="watch-row"><div><strong>${esc(s.name)}</strong><small>${esc(s.style)} · ${pct(s.accuracyPct)} accuracy</small></div><div><b class="${s.pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${fmt(s.pnl, 2)}</b>${compact ? "" : followButton(s.id)}</div></div>`).join("")}</div>`;
}
function renderAgents() {
  $("#page-content").innerHTML = `<div class="page-intro"><div><span class="section-kicker">STRATEGY DIRECTORY</span><h2>Meet the desks.</h2><p>Five independent ways to read the same market. Follow the process, not just the outcome.</p></div><div class="page-actions"><a class="section-link" href="#/app/overview">← Overview</a></div></div><section class="agent-directory">${LEADER.map((s, i) => `<article class="agent-row"><div class="agent-rank">0${i + 1}</div><div class="agent-identity"><span class="dot" style="background:${s.color}"></span><div><a href="#/app/agents/${esc(s.id)}"><h3>${esc(s.name)}</h3></a><small>${esc(s.style)}</small></div></div><p>${esc(s.description)}</p><div class="agent-metric"><small>Accuracy</small><b>${pct(s.accuracyPct)}</b></div><div class="agent-metric"><small>Settled PnL</small><b class="${s.pnl >= 0 ? "pnl-pos" : "pnl-neg"}">${fmt(s.pnl, 2)}</b></div><div class="agent-metric"><small>Trades</small><b>${s.trades}</b></div><div class="agent-actions">${followButton(s.id)}<a class="section-link" href="#/app/agents/${esc(s.id)}">View profile →</a></div></article>`).join("")}</section><section class="panel compare-note"><span class="section-kicker">HOW TO READ THIS</span><h2>Performance is context, not a promise.</h2><p>Accuracy measures resolved predictions; settled PnL reflects completed trades. Open positions and future outcomes are not included in historical numbers.</p></section>`;
}
async function renderAgentDetail(id) {
  let d; try { d = await fetch(`/api/agents/${id}`).then((r) => r.ok ? r.json() : null); } catch {}
  if (!d) { $("#page-content").innerHTML = '<div class="empty-state">This desk could not be found.</div>'; return; }
  setPageMeta("agents", true); const winRate = d.won + d.lost ? d.won / (d.won + d.lost) * 100 : null;
  const active = WINDOWS.find((w) => (w.predictions || []).some((p) => p?.agentId === id)); const pred = active?.predictions?.find((p) => p?.agentId === id);
  $("#page-content").innerHTML = `<div class="detail-hero"><div><a class="back" href="#/app/agents">← All agents</a><h2><span class="dot" style="background:${d.color}"></span>${esc(d.name)}</h2><p>${esc(d.description)}</p></div><div class="detail-actions">${followButton(id)}${pred ? `<button class="trade-button" data-trade="${esc(active.window.marketId)}" data-symbol="${esc(active.window.symbol)}" data-side="${pred.direction === "DOWN" ? "NO" : "YES"}" data-agent="${esc(d.name)}">Copy current call →</button>` : ""}</div></div>
    <div class="stats-grid">${[[d.trades,"trades"],[`${d.won}-${d.lost}-${d.void}`,"won · lost · void"],[pct(winRate),"win rate"],[pct(d.accuracyPct),"prediction accuracy"],[fmt(d.stake,2),"staked"],[d.roiPct == null ? "–" : pct(d.roiPct),"ROI"],[fmt(d.pnl,2),"settled PnL"],[d.predictions,"predictions"]].map(([v,l]) => `<div class="stat-card"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="content-grid"><section class="panel"><div class="panel-heading"><div><span class="section-kicker">PREDICTIONS</span><h2>How ${esc(d.name)} thinks</h2></div><span class="heading-note">Newest first</span></div><div class="feed">${(d.recentPredictions || []).slice(0, 12).map((p) => `<div class="pred"><div class="row1"><span class="dir ${p.direction}">${p.direction} on <b>${esc(p.symbol)}</b></span>${dirTag(p)}</div><div class="row2">${esc(p.rationale)}</div><div class="kv"><span>P(UP) <b>${fmt(p.probUp,3)}</b></span><span>confidence <b>${fmt(p.confidence*100,0)}%</b></span><span>YES <b>${fmt(p.bookYes?.bid,3)} / ${fmt(p.bookYes?.ask,3)}</b></span></div></div>`).join("") || '<div class="empty-state">No predictions published yet.</div>'}</div></section><section class="panel"><div class="panel-heading"><div><span class="section-kicker">EXECUTIONS</span><h2>Public trade history</h2></div></div><div class="trades">${renderAgentTrades(d.recentTrades || [])}</div></section></div>
    <section class="panel"><div class="panel-heading"><div><span class="section-kicker">WALLET</span><h2>Desk on-chain identity</h2></div><span class="heading-note">Auditable, not custodial</span></div><div class="wallet-box">${d.walletAddress ? `<div><small class="heading-note">DESK WALLET</small><br /><a class="addr" target="_blank" href="${explorerBase}address/${d.walletAddress}">${d.walletAddress}</a></div><button class="copy-btn" data-copy="${d.walletAddress}">Copy address</button><div class="bal"><b>${fmt(d.balance?.collateralHuman,2)}</b><span>tUSDC collateral</span></div><div class="bal"><b>${fmt(d.balance?.nativeHuman,4)}</b><span>STT gas</span></div>` : '<span class="heading-note">Paper mode — simulated fills at real book prices.</span>'}</div></section>`;
}
function renderAgentTrades(trades) { return `<table><thead><tr><th>mode</th><th>market</th><th>side</th><th>qty</th><th>price</th><th>status</th></tr></thead><tbody>${trades.slice(0, 12).map((t) => `<tr><td class="mode-${t.mode}">${t.mode}</td><td>${esc(t.symbol.split("/")[0])}</td><td>${t.side}</td><td>${fmt(t.contracts,1)}</td><td>${fmt(t.price,3)}</td><td>${esc(t.status)}</td></tr>`).join("")}</tbody></table>`; }
function renderSystem() {
  const scan = STATUS?.lastScan || {}, buffer = STATUS?.bufferSizes || {};
  const bufferSummary = Object.entries(buffer).map(([asset, size]) => `${asset} ${size}`).join(" · ") || "Waiting";
  $("#page-content").innerHTML = `<div class="page-intro"><div><span class="section-kicker">SYSTEM OBSERVABILITY</span><h2>Know what is running.</h2><p>Operational detail for the market feed, prediction loop, and on-chain desks.</p></div><div class="page-actions"><a class="section-link" href="#/app/overview">← Overview</a></div></div><div class="system-grid"><div class="system-item"><small>Runtime state</small><b class="ok">${STATUS?.live ? "LIVE TESTNET" : "PAPER MODE"}</b></div><div class="system-item"><small>Network</small><b>${esc(STATUS?.network || "—").toUpperCase()}</b></div><div class="system-item"><small>Cadence</small><b>${STATUS?.cadenceSec ? `${STATUS.cadenceSec / 60} min` : "—"}</b></div><div class="system-item"><small>Last scan</small><b>${scan.at ? `${ago(scan.at)} ago` : "Waiting"}</b></div><div class="system-item"><small>Markets scanned</small><b>${scan.marketsScanned ?? "—"}</b></div><div class="system-item"><small>Scanner errors</small><b class="${scan.error ? "pnl-neg" : "ok"}">${scan.error ? esc(scan.error) : "None"}</b></div></div><section class="panel system-panel"><div class="panel-heading"><div><span class="section-kicker">DESK RUNTIME</span><h2>Agent wallets and feed buffers</h2></div><span class="tiny-live">HEALTHY</span></div><table class="system-table"><thead><tr><th>Desk</th><th>Wallet</th><th>Shared feed buffers</th><th>Collateral</th><th>Native gas</th><th>State</th></tr></thead><tbody>${(STATUS?.agents || []).map((a) => { const balance = STATUS?.balances?.[a.id] || {}; const wallet = STATUS?.wallets?.find((w) => w.agentId === a.id); return `<tr><td><span class="dot" style="background:${a.color}"></span>${esc(a.name)}</td><td>${wallet ? `<a href="${explorerBase}address/${wallet.address}" target="_blank">${short(wallet.address)}</a>` : "Paper"}</td><td>${esc(bufferSummary)}</td><td>${fmt(balance.collateralHuman, 2)} tUSDC</td><td>${fmt(balance.nativeHuman, 4)} STT</td><td class="ok">ONLINE</td></tr>`; }).join("")}</tbody></table></section><section class="content-grid"><section class="panel"><div class="panel-heading"><div><span class="section-kicker">MARKET WINDOWS</span><h2>On-chain status</h2></div></div>${Object.values(STATUS?.windows || {}).map((w) => w ? `<div class="watch-row"><div><strong>${esc(w.symbol)}</strong><small>${esc(w.marketId)}</small></div><div><b class="ok">${esc(w.statusName || "TRADING")}</b><small>${countdown(w.expiry)} remaining</small></div></div>` : "").join("") || '<div class="empty-state">No active window.</div>'}</section><section class="panel"><div class="panel-heading"><div><span class="section-kicker">SAFETY MODEL</span><h2>What this system does</h2></div></div><div class="safety-list"><p><b>Independent wallets</b><br /><span>Each desk signs its own testnet trades and exposes its public identity.</span></p><p><b>Hard expiry</b><br /><span>Event contracts resolve on-chain; positions are not liquidated.</span></p><p><b>User-controlled execution</b><br /><span>Copy orders are prepared by the server and signed by your connected wallet.</span></p></div></section></div>`;
}
function nativeBalance() {
  if (!walletAddress || !window.ethereum) return null;
  return window.ethereum.request({ method: "eth_getBalance", params: [walletAddress, "latest"] }).then((hex) => Number(BigInt(hex)) / 1e18).catch(() => null);
}
function renderPortfolioSections(portfolio) {
  if (!walletAddress) return "";
  if (portfolio?.error) return `<section class="panel portfolio-panel"><div class="panel-heading"><div><span class="section-kicker">ON-CHAIN PORTFOLIO</span><h2>Portfolio unavailable</h2></div></div><div class="empty-state">${esc(portfolio.error)}</div></section>`;
  const positions = portfolio?.positions || [], claims = portfolio?.claimable || [];
  const positionMarkup = positions.length ? positions.map((p) => {
    const held = (p.outcome?.yes || 0) + (p.outcome?.no || 0);
    return `<div class="portfolio-row"><div><strong>${esc(p.question || "Event contract")}</strong><small>${esc(p.status || "Trading")} · ${p.expiry ? `expires ${new Date(p.expiry * 1000).toLocaleString()}` : "expiry unavailable"}</small></div><div class="position-outcomes"><span class="${p.outcome?.yes ? "positive" : ""}">YES ${fmt(p.outcome?.yes, 2)}</span><span class="${p.outcome?.no ? "negative" : ""}">NO ${fmt(p.outcome?.no, 2)}</span></div><div class="position-value"><b>${fmt(held, 2)} shares</b><small>marked ${fmt(p.markValue, 2)} tUSDC</small></div><div class="${Number(p.unrealizedPnl) >= 0 ? "positive" : "negative"}"><b>${Number(p.unrealizedPnl) >= 0 ? "+" : ""}${fmt(p.unrealizedPnl, 2)} tUSDC</b><small>unrealized PnL</small></div></div>`;
  }).join("") : '<div class="empty-state">No open event positions in this wallet yet. Copy a desk call to see it here.</div>';
  const claimMarkup = claims.length ? claims.map((c) => `<div class="portfolio-row claim-row"><div><strong>${esc(c.question)}</strong><small>${esc(c.status)} · ${c.outcome} won</small></div><div><b>${fmt(c.contracts, 2)} shares</b><small>redeemable balance</small></div><div class="positive"><b>${fmt(c.estimatedPayout, 2)} tUSDC</b><small>estimated payout</small></div></div>`).join("") : '<div class="empty-state">Nothing is redeemable right now. Settled winning or voided positions will appear here.</div>';
  return `<section class="panel portfolio-panel"><div class="panel-heading"><div><span class="section-kicker">ON-CHAIN PORTFOLIO</span><h2>Your live positions</h2><p class="panel-subtitle">Read directly from DreamDEX for this wallet.</p></div><div class="account-balance"><b>${fmt(portfolio?.balances?.collateral, 2)} tUSDC</b><span>available collateral</span></div></div><div class="portfolio-list">${positionMarkup}</div></section><section class="panel portfolio-panel"><div class="panel-heading"><div><span class="section-kicker">SETTLEMENTS</span><h2>Redeemable balances</h2><p class="panel-subtitle">These positions have already settled and can be claimed.</p></div><span class="heading-note">${claims.length} ready</span></div><div class="portfolio-list">${claimMarkup}</div></section>`;
}
async function renderAccount() {
  const balance = await nativeBalance(); const currentFollows = LEADER.filter((s) => followed.has(s.id));
  let portfolio = null;
  if (walletAddress) {
    try { const response = await fetch(`/api/account/portfolio?address=${encodeURIComponent(walletAddress)}`); portfolio = await response.json(); if (!response.ok) portfolio = { error: portfolio.error || "Could not read the wallet portfolio." }; }
    catch { portfolio = { error: "Could not reach the portfolio reader." }; }
  }
  $("#page-content").innerHTML = `<div class="page-intro"><div><span class="section-kicker">PERSONAL WORKSPACE</span><h2>Your account.</h2><p>One place for your wallet, positions, settlements, and copy-trade activity.</p></div><div class="page-actions"><a class="section-link" href="#/app/agents">Find a desk →</a></div></div><div class="account-card"><section class="panel connect-card"><div><span class="section-kicker">WALLET CONNECTION</span><h2>${walletAddress ? "Your wallet is connected." : "Connect your wallet."}</h2><p>${walletAddress ? "You stay in control. AgentDesk can prepare transactions, but only your wallet can approve them." : "Connect an injected browser wallet to copy an active desk call. Your keys never leave your wallet."}</p></div><div>${walletAddress ? `<div class="address-box">${walletAddress}</div><div class="kv"><span>Somnia testnet</span><span>STT balance <b>${balance == null ? "—" : fmt(balance, 4)}</b></span></div>` : `<button class="primary-button" data-connect>Connect wallet <span>→</span></button>`}</div></section><section class="panel"><div class="panel-heading"><div><span class="section-kicker">WATCHLIST</span><h2>Followed desks</h2></div><span class="heading-note">${currentFollows.length} selected</span></div>${renderWatchlist()}</section></div>${renderPortfolioSections(portfolio)}<section class="panel account-activity"><div class="panel-heading"><div><span class="section-kicker">YOUR ACTIVITY</span><h2>Signed orders</h2></div><span class="heading-note">Saved locally in this browser</span></div>${localOrders.length ? `<div class="watch-list">${localOrders.map((o) => `<div class="watch-row"><div><strong>${esc(o.symbol)} · ${o.side}</strong><small>${o.contracts} contracts · ${ago(o.createdAt)} ago</small></div><a class="desk-link" target="_blank" href="${explorerBase}tx/${o.hash}">${o.hash.slice(0, 12)}… ↗</a></div>`).join("")}</div>` : '<div class="empty-state">No signed orders from this browser yet. Copying a call will add the transaction here.</div>'}</section>`;
}
function renderCurrent() {
  if (location.hash === "" || location.hash === "#/" || !location.hash.startsWith("#/app")) { $("#landing-view").classList.remove("hidden"); $("#app-view").classList.add("hidden"); return; }
  $("#landing-view").classList.add("hidden"); $("#app-view").classList.remove("hidden");
  renderMarketTape();
  const match = location.hash.match(/^#\/app\/agents\/([a-z0-9-]+)/i); const page = location.hash.match(/^#\/app\/(overview|agents|system|account)/i)?.[1] || "overview";
  document.querySelectorAll(".side-nav a").forEach((a) => a.classList.toggle("active", a.dataset.route === (match ? "agents" : page)));
  if (match) { renderAgentDetail(match[1]); return; }
  setPageMeta(page);
  if (page === "overview") renderOverview(); else if (page === "agents") renderAgents(); else if (page === "system") renderSystem(); else renderAccount();
}
window.addEventListener("hashchange", renderCurrent);
setInterval(() => document.querySelectorAll(".count").forEach((node) => { node.textContent = countdown(Number(node.dataset.expiry)); }), 1000);
const eventSource = new EventSource("/api/stream"); ["prediction", "trade", "equity", "hello"].forEach((type) => eventSource.addEventListener(type, fetchAll)); setInterval(fetchAll, 5000);
async function fetchAll() {
  try {
    [STATUS, WINDOWS, LEADER, PREDS, TRADES, EQUITY] = await Promise.all([fetch("/api/status").then((r) => r.json()), fetch("/api/active").then((r) => r.json()), fetch("/api/leaderboard").then((r) => r.json()), fetch("/api/predictions?limit=80").then((r) => r.json()), fetch("/api/trades?limit=80").then((r) => r.json()), fetch("/api/equity").then((r) => r.json())]);
    const assets = STATUS?.assets || ["BTC", "ETH"];
    const priceRows = await Promise.all(assets.map(async (asset) => {
      try { return [asset, await fetch(`/api/prices/${encodeURIComponent(asset)}`).then((r) => r.json())]; }
      catch { return [asset, []]; }
    }));
    PRICE_SERIES = Object.fromEntries(priceRows);
    updateWalletUi(); $("#side-health").textContent = STATUS.lastScan?.error ? "Needs attention" : "Operational"; $("#side-health-detail").textContent = STATUS.lastScan?.error || "Streaming live data"; renderCurrent();
  } catch { $("#landing-mode").textContent = "OFFLINE"; $("#app-mode").textContent = "OFFLINE"; }
}
updateWalletUi(); fetchAll(); renderCurrent();