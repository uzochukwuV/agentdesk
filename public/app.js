const $ = (s) => document.querySelector(s);
let STATUS = null, WINDOWS = [], LEADER = [], EQUITY = [], PREDS = [], TRADES = [];
let explorerBase = "https://shannon-explorer.somnia.network/";
let activeTrade = { marketId: null, symbol: "", side: "YES", agent: "" };
let walletAddress = localStorage.getItem("agentdesk.wallet") || null;
const followed = new Set(JSON.parse(localStorage.getItem("agentdesk.following") || "[]"));
const fmt = (x, d = 2) => x == null || Number.isNaN(Number(x)) ? "–" : Number(x).toFixed(d);
const pct = (x, d = 1) => x == null ? "–" : `${Number(x).toFixed(d)}%`;
const esc = (x) => String(x ?? "").replace(/[&<>"']/g, (c) => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
const ago = (ms) => { const s = Math.max(0, Math.floor((Date.now()-ms)/1000)); return s<60?`${s}s`:s<3600?`${Math.floor(s/60)}m`:`${Math.floor(s/3600)}h`; };
const countdown = (expiry) => { const left=Math.max(0,Math.floor(expiry-Date.now()/1000)); return `${String(Math.floor(left/60)).padStart(2,"0")}:${String(left%60).padStart(2,"0")}`; };
const short = (a) => a ? `${a.slice(0,6)}…${a.slice(-4)}` : "Not connected";
function saveFollows(){ localStorage.setItem("agentdesk.following", JSON.stringify([...followed])); }
function toast(msg){ const el=$("#toast"); el.textContent=msg; el.classList.add("show"); setTimeout(()=>el.classList.remove("show"),2600); }

function route(){
  const id=location.hash.match(/^#\/desk\/([a-z0-9]+)/i)?.[1] || null;
  $("#desk-view").classList.toggle("hidden",!id); $("#main-view").classList.toggle("hidden",!!id);
  if(id) renderDesk(id);
}
window.addEventListener("hashchange",route);

function updateWalletUi(){
  $("#wallet-button").textContent=walletAddress?short(walletAddress):"Connect wallet";
  $("#wallet-short").textContent=short(walletAddress);
  $("#account-title").textContent=walletAddress?"Your copy desk is ready":"Your copy desk";
  $("#account-subtitle").textContent=walletAddress?"Non-custodial signing enabled":"Connect a wallet to copy signals non-custodially";
  $("#strip-connect").textContent=walletAddress?"Disconnect wallet":"Connect wallet";
  $("#following-count").textContent=`${followed.size} desk${followed.size===1?"":"s"}`;
}
async function connectWallet(){
  if(walletAddress){ walletAddress=null; localStorage.removeItem("agentdesk.wallet"); updateWalletUi(); toast("Wallet disconnected"); return; }
  if(!window.ethereum){ toast("Install an injected wallet such as MetaMask first"); return; }
  try{
    const accounts=await window.ethereum.request({method:"eth_requestAccounts"});
    if(!accounts?.[0]) return;
    const target="0xc488";
    const current=await window.ethereum.request({method:"eth_chainId"});
    if(current.toLowerCase()!==target){
      try{ await window.ethereum.request({method:"wallet_switchEthereumChain",params:[{chainId:target}]}); }
      catch(e){ if(e.code===4902) await window.ethereum.request({method:"wallet_addEthereumChain",params:[{chainId:target,chainName:"Somnia Testnet",nativeCurrency:{name:"STT",symbol:"STT",decimals:18},rpcUrls:["https://api.infra.testnet.somnia.network"],blockExplorerUrls:[explorerBase]}]}); else throw e; }
    }
    walletAddress=accounts[0]; localStorage.setItem("agentdesk.wallet",walletAddress); updateWalletUi(); toast("Wallet connected on Somnia testnet");
  }catch(e){ toast(e?.message?.slice(0,100)||"Wallet connection cancelled"); }
}
document.querySelectorAll("[data-connect]").forEach((b)=>b.addEventListener("click",connectWallet));
$("#wallet-button").addEventListener("click",connectWallet); $("#strip-connect").addEventListener("click",connectWallet);
if(window.ethereum){ window.ethereum.on?.("accountsChanged",(a)=>{ walletAddress=a?.[0]||null; walletAddress?localStorage.setItem("agentdesk.wallet",walletAddress):localStorage.removeItem("agentdesk.wallet"); updateWalletUi(); }); }

function toggleFollow(id){
  followed.has(id)?followed.delete(id):followed.add(id); saveFollows(); updateWalletUi(); renderLeader(); renderWindows();
  toast(followed.has(id)?"Desk added to your watchlist":"Desk removed from your watchlist");
}
function followButton(id){ return `<button class="follow-button ${followed.has(id)?"following":""}" data-follow="${esc(id)}">${followed.has(id)?"Following":"Follow desk"}</button>`; }
document.addEventListener("click",(e)=>{
  const follow=e.target.closest("[data-follow]"); if(follow) toggleFollow(follow.dataset.follow);
  const trade=e.target.closest("[data-trade]"); if(trade) openTrade(trade.dataset.trade,trade.dataset.symbol,trade.dataset.side,trade.dataset.agent);
  if(e.target.closest("[data-close-trade]")) closeTrade();
});

function openTrade(marketId,symbol,side="YES",agent=""){ activeTrade={marketId,symbol,side,agent}; $("#trade-title").textContent=`Copy ${agent||"this"} signal`; $("#trade-context").textContent=`${symbol} · ${side==="YES"?"YES / UP":"NO / DOWN"} · IOC order`; setSide(side); $("#trade-status").textContent=""; $("#trade-status").className="trade-status"; $("#trade-modal").classList.remove("hidden"); $("#trade-modal").setAttribute("aria-hidden","false"); updateTradeSummary(); }
function closeTrade(){ $("#trade-modal").classList.add("hidden"); $("#trade-modal").setAttribute("aria-hidden","true"); }
function setSide(side){ activeTrade.side=side; document.querySelectorAll(".side-option").forEach((b)=>b.classList.toggle("active",b.dataset.side===side)); updateTradeSummary(); }
document.querySelectorAll(".side-option").forEach((b)=>b.addEventListener("click",()=>setSide(b.dataset.side)));
$("#trade-contracts").addEventListener("input",updateTradeSummary); $("#trade-slippage").addEventListener("input",updateTradeSummary);
function currentWindow(){ return WINDOWS.find((x)=>x.window.marketId===activeTrade.marketId)?.window; }
function currentBook(){ const ps=WINDOWS.find((x)=>x.window.marketId===activeTrade.marketId)?.predictions||[]; return ps.find(Boolean)?.bookYes||null; }
function updateTradeSummary(){
  const book=currentBook(), qty=Number($("#trade-contracts")?.value||10), slip=Number($("#trade-slippage")?.value||2);
  const raw=activeTrade.side==="YES"?book?.ask:book?.bid; const price=raw==null?null:activeTrade.side==="YES"?raw+slip/100:1-(raw-slip/100);
  if($("#trade-summary")) $("#trade-summary").innerHTML=`Entry limit <b>${price==null?"Waiting for quote":fmt(price,3)}</b><br />Estimated max collateral <b>${price==null?"–":fmt(price*qty,3)} tUSDC</b><br />Execution <b>Immediate or cancel</b>`;
}
async function waitReceipt(hash){
  for(let i=0;i<45;i++){ const receipt=await window.ethereum.request({method:"eth_getTransactionReceipt",params:[hash]}); if(receipt) return receipt; await new Promise(r=>setTimeout(r,1500)); }
  return null;
}
async function sendCall(call,label){
  $("#trade-status").textContent=`${label} — confirm in your wallet…`;
  const hash=await window.ethereum.request({method:"eth_sendTransaction",params:[{from:walletAddress,to:call.to,data:call.data,value:call.value}]});
  $("#trade-status").innerHTML=`${label} submitted · <a target="_blank" href="${explorerBase}tx/${hash}">${hash.slice(0,12)}…</a> <span class="spin"></span>`;
  const receipt=await waitReceipt(hash); if(!receipt||receipt.status==="0x0") throw new Error(`${label} failed on-chain`);
  return hash;
}
$("#trade-form").addEventListener("submit",async(e)=>{
  e.preventDefault(); const button=$("#submit-trade"); const status=$("#trade-status");
  if(!walletAddress){ status.textContent="Connect your wallet before preparing an order."; status.className="trade-status error"; return; }
  button.disabled=true; button.textContent="Building order…"; status.className="trade-status"; status.textContent="";
  try{
    const contracts=Number($("#trade-contracts").value), slippageBps=Number($("#trade-slippage").value)*100;
    const r=await fetch("/api/user/order/build",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({marketId:activeTrade.marketId,owner:walletAddress,side:activeTrade.side,contracts,slippageBps})});
    const built=await r.json(); if(!r.ok) throw new Error(built.error||"Could not prepare order");
    status.textContent="Order prepared. Your wallet will ask for approval, then the IOC order.";
    button.textContent="Approve & place order →";
    if(built.approval) await sendCall(built.approval,"Token approval");
    const hash=await sendCall(built.order,"Order transaction");
    status.innerHTML=`Order confirmed · <a target="_blank" href="${explorerBase}tx/${hash}">View on explorer ↗</a>`;
    button.textContent="Order placed"; toast("Your order was submitted on-chain");
  }catch(err){ status.textContent=err?.message||"Order cancelled"; status.className="trade-status error"; button.textContent="Try again →"; }
  finally{ button.disabled=false; if(button.textContent==="Approve & place order →") button.textContent="Prepare order →"; }
});

function renderWindows(){
  const el=$("#windows"); if(!WINDOWS.length){el.innerHTML='<div class="panel"><span class="heading-note">Scanning live event contracts…</span><span class="spin"></span></div>';return;}
  el.innerHTML=WINDOWS.map(({window:w,predictions})=>{
    const chips=(predictions||[]).filter(Boolean).map((p)=>{
      const a=STATUS?.agents?.find(x=>x.id===p.agentId)||{name:p.agentId,color:"#888"};
      return `<div class="pred-chip"><div class="who"><span>${esc(a.name)}</span><b style="color:${a.color}">●</b></div><div class="call ${p.direction.toLowerCase()}">${p.direction} ${fmt(p.confidence*100,0)}%</div><div class="conf">${p.decision==="trade"?"active signal":"watching"} · P(UP) ${fmt(p.probUp,2)}</div></div>`;
    }).join("");
    const lead=(predictions||[]).find(Boolean); const side=lead?.direction==="DOWN"?"NO":"YES"; const agent=lead?STATUS?.agents?.find(a=>a.id===lead.agentId)?.name||lead.agentId:"";
    return `<article class="window-card"><div class="head"><span class="sym">${esc(w.symbol)}</span><span class="count" data-expiry="${w.expiry}">${countdown(w.expiry)}</span></div><div class="window-meta">EXPIRY WINDOW · ${esc(w.statusName||"TRADING")} · YES MID ${fmt(lead?.bookYes?.mid,3)}</div><div class="pred-strip">${chips||'<span class="heading-note">Waiting for desk quotes…</span>'}</div><div class="window-actions">${lead?`<button class="trade-button" data-trade="${esc(w.marketId)}" data-symbol="${esc(w.symbol)}" data-side="${side}" data-agent="${esc(agent)}">Copy ${side} call →</button>`:""}<a href="#/desk/${esc(lead?.agentId||"momentum")}" class="follow-button">View lead desk</a></div></article>`;
  }).join("");
}
function renderLeader(){
  $("#desk-grid").innerHTML=LEADER.map((s,i)=>`<article class="desk-card"><div class="desk-top"><span class="desk-rank">0${i+1}</span>${followButton(s.id)}</div><a href="#/desk/${esc(s.id)}" class="desk-name">${esc(s.name)}</a><div class="desk-style">${esc(s.style)}</div><div class="desk-stat"><div><small>settled PnL</small><b class="${s.pnl>=0?"pnl-pos":"pnl-neg"}">${fmt(s.pnl,2)}</b></div><div><small>accuracy</small><b>${pct(s.accuracyPct)}</b></div></div><a href="#/desk/${esc(s.id)}" class="desk-link">Open desk ↗</a></article>`).join("");
  $("#equity-legend").innerHTML=LEADER.map(s=>`<span><span class="dot" style="background:${s.color}"></span>${esc(s.name)} ${fmt(s.pnl,2)}</span>`).join("");
}
function dirTag(p){ return p.status==="resolved"?`<span class="tag ${p.outcome}">${p.outcome}</span>`:`<span class="tag">${p.decision==="trade"?"traded":"published"}</span>`; }
function renderFeed(){
  $("#feed").innerHTML=PREDS.map(p=>{const a=STATUS?.agents?.find(x=>x.id===p.agentId);return `<div class="pred"><div class="row1"><span class="dir ${p.direction}"><span class="dot" style="background:${a?.color||"#888"}"></span>${esc(a?.name||p.agentId)} calls ${p.direction}</span>${dirTag(p)}</div><div class="row2"><b>${esc(p.symbol)}</b> · ${esc(p.rationale)}</div><div class="kv"><span>P(UP) <b>${fmt(p.probUp,3)}</b></span><span>confidence <b>${fmt(p.confidence*100,0)}%</b></span><span>YES <b>${fmt(p.bookYes?.bid,3)} / ${fmt(p.bookYes?.ask,3)}</b></span><span>${ago(p.createdAt)} ago</span></div></div>`;}).join("")||'<span class="heading-note">No predictions yet — desks are watching the tape.</span>'; 
}
function renderTrades(){
  const rows=TRADES.map(t=>{const a=STATUS?.agents?.find(x=>x.id===t.agentId);const tx=t.txHash?`<a target="_blank" href="${explorerBase}tx/${t.txHash}">${t.txHash.slice(0,9)}…</a>`:"";return `<tr><td class="mode-${t.mode}">${t.mode.toUpperCase()}</td><td>${esc(a?.name||t.agentId)}</td><td>${esc(t.symbol.split("/")[0])}</td><td>${t.side}</td><td class="num">${fmt(t.contracts,1)}</td><td class="num">${t.price==null?"–":fmt(t.price,3)}</td><td class="num">${t.error?esc(t.error):t.status.toUpperCase()}</td><td>${tx}</td></tr>`;}).join("");
  $("#trades").innerHTML=`<table><thead><tr><th>mode</th><th>desk</th><th>market</th><th>side</th><th>qty</th><th>price</th><th>status</th><th>tx</th></tr></thead><tbody>${rows}</tbody></table>`||'<span class="heading-note">No trades yet.</span>';
}
function drawEquity(canvas,points,color){
  const ctx=canvas.getContext("2d"),dpr=devicePixelRatio||1,w=canvas.clientWidth,h=Number(canvas.height);canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);if(!points.length){ctx.fillStyle="#8e93a7";ctx.font="11px DM Mono";ctx.fillText("No settled history yet.",14,25);return;}const minT=Math.min(...points.map(p=>p.t)),maxT=Math.max(...points.map(p=>p.t));let minY=Math.min(0,...points.map(p=>p.realizedPnl)),maxY=Math.max(0,...points.map(p=>p.realizedPnl));if(maxY-minY<1)maxY=minY+1;const X=t=>44+(t-minT)/Math.max(1,maxT-minT)*(w-52),Y=y=>8+(1-(y-minY)/(maxY-minY))*(h-26);ctx.strokeStyle="#272a38";ctx.beginPath();ctx.moveTo(0,Y(0));ctx.lineTo(w,Y(0));ctx.stroke();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();points.forEach((p,i)=>i?ctx.lineTo(X(p.t),Y(p.realizedPnl)):ctx.moveTo(X(p.t),Y(p.realizedPnl)));ctx.stroke();
}
function renderEquity(){const c=$("#equity"),by=new Map();EQUITY.forEach(p=>{if(!by.has(p.agentId))by.set(p.agentId,[]);by.get(p.agentId).push(p);});if(!EQUITY.length){drawEquity(c,[]);return;}const pts=[...by.values()].flat();const minT=Math.min(...pts.map(p=>p.t)),maxT=Math.max(...pts.map(p=>p.t));let minY=Math.min(0,...pts.map(p=>p.realizedPnl)),maxY=Math.max(0,...pts.map(p=>p.realizedPnl));if(maxY-minY<1)maxY=minY+1;const dpr=devicePixelRatio||1,w=c.clientWidth,h=180;c.width=w*dpr;c.height=h*dpr;const ctx=c.getContext("2d");ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);const X=t=>44+(t-minT)/Math.max(1,maxT-minT)*(w-52),Y=y=>8+(1-(y-minY)/(maxY-minY))*(h-26);ctx.strokeStyle="#272a38";ctx.beginPath();ctx.moveTo(0,Y(0));ctx.lineTo(w,Y(0));ctx.stroke();by.forEach((ps,id)=>{ctx.strokeStyle=STATUS?.agents?.find(a=>a.id===id)?.color||"#888";ctx.lineWidth=2;ctx.beginPath();ps.forEach((p,i)=>i?ctx.lineTo(X(p.t),Y(p.realizedPnl)):ctx.moveTo(X(p.t),Y(p.realizedPnl)));ctx.stroke();});}
async function renderDesk(id){
  let d;try{d=await fetch(`/api/agents/${id}`).then(r=>r.ok?r.json():null);}catch{}if(!d)return;
  const meta=STATUS?.agents?.find(a=>a.id===id)||d;$("#desk-title").innerHTML=`<span class="dot" style="background:${d.color}"></span>${esc(d.name)}`;$("#desk-style").textContent=`${meta.style||d.style} · ${meta.description||d.description}`;$("#desk-follow").innerHTML=followButton(id);
  const b=d.balance||{};$("#desk-wallet").innerHTML=d.walletAddress?`<div><small class="heading-note">ON-CHAIN DESK WALLET</small><br/><a class="addr" target="_blank" href="${explorerBase}address/${d.walletAddress}">${d.walletAddress}</a></div><button class="copy-btn" data-copy="${d.walletAddress}">Copy</button><div class="bal"><b>${fmt(b.collateralHuman,2)}</b><span>tUSDC collateral</span></div><div class="bal"><b>${fmt(b.nativeHuman,4)}</b><span>STT gas</span></div>`:`<span class="heading-note">Paper mode — simulated fills at real book prices.</span>`;
  const winRate=d.won+d.lost?d.won/(d.won+d.lost)*100:null;$("#desk-stats").innerHTML=[[d.trades,"trades"],[`${d.won}-${d.lost}-${d.void}`,"won · lost · void"],[pct(winRate),"win rate"],[pct(d.accuracyPct),"accuracy"],[fmt(d.stake,2),"staked"],[d.roiPct==null?"–":pct(d.roiPct),"ROI"],[fmt(d.pnl,2),"settled PnL"],[d.predictions,"predictions"]].map(([v,l])=>`<div class="stat-card"><b>${v}</b><span>${l}</span></div>`).join("");
  $("#desk-feed").innerHTML=(d.recentPredictions||[]).map(p=>`<div class="pred"><div class="row1"><span class="dir ${p.direction}">${p.direction} on <b>${esc(p.symbol)}</b></span>${dirTag(p)}</div><div class="row2">${esc(p.rationale)}</div><div class="kv"><span>P(UP) <b>${fmt(p.probUp,3)}</b></span><span>confidence <b>${fmt(p.confidence*100,0)}%</b></span><span>YES <b>${fmt(p.bookYes?.bid,3)} / ${fmt(p.bookYes?.ask,3)}</b></span></div></div>`).join("")||'<span class="heading-note">No predictions yet.</span>';
  $("#desk-trades").innerHTML=`<table><thead><tr><th>mode</th><th>market</th><th>side</th><th>qty</th><th>price</th><th>status</th></tr></thead><tbody>${(d.recentTrades||[]).map(t=>`<tr><td class="mode-${t.mode}">${t.mode}</td><td>${esc(t.symbol.split("/")[0])}</td><td>${t.side}</td><td>${fmt(t.contracts,1)}</td><td>${fmt(t.price,3)}</td><td>${t.status}</td></tr>`).join("")}</tbody></table>`;
  drawEquity($("#desk-equity"),d.equity||[],d.color);
}
document.addEventListener("click",(e)=>{const copy=e.target.closest("[data-copy]");if(copy){navigator.clipboard?.writeText(copy.dataset.copy);toast("Address copied");}});
async function fetchAll(){
  try{[STATUS,WINDOWS,LEADER,PREDS,TRADES,EQUITY]=await Promise.all([fetch("/api/status").then(r=>r.json()),fetch("/api/active").then(r=>r.json()),fetch("/api/leaderboard").then(r=>r.json()),fetch("/api/predictions?limit=80").then(r=>r.json()),fetch("/api/trades?limit=80").then(r=>r.json()),fetch("/api/equity").then(r=>r.json())]);$("#mode").textContent=STATUS.live?"LIVE TESTNET":"PAPER MODE";$("#network").textContent=STATUS.network==="testnet"?"SOMNIA TESTNET":"SOMNIA MAINNET";renderWindows();renderLeader();renderFeed();renderTrades();renderEquity();route();}catch(e){$("#mode").textContent="OFFLINE";}}
document.querySelectorAll(".count").forEach(()=>{});setInterval(()=>document.querySelectorAll(".count").forEach(n=>n.textContent=countdown(Number(n.dataset.expiry))),1000);
const es=new EventSource("/api/stream");["prediction","trade","equity","hello"].forEach(t=>es.addEventListener(t,fetchAll));setInterval(fetchAll,5000);updateWalletUi();fetchAll();route();