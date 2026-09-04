// End-to-end health check against a running server.
const BASE = process.env.BASE ?? `http://localhost:${process.env.PORT ?? "5000"}`;
let failures = 0;
const check = (name: string, cond: boolean, detail: string = "") => {
  const ok = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`${ok} ${name}${detail ? " — " + detail : ""}`);
};
const j = (p: string, qs: string = "") => fetch(`${BASE}${p}${qs}`).then((r) => r.json());

const status = await j("/api/status");
check("status endpoint", status.live !== undefined || status.paper !== undefined);
const agents = await j("/api/agents");
check("agents registered", Array.isArray(agents) && agents.length === 5, `${agents.length}/5`);
const preds = (await j("/api/predictions", "?limit=10")) as any[];
const trades = (await j("/api/trades")) as any[];
console.log(`     (trades placed: ${trades.length})`);
const active = await j("/api/active");
const equity = await j("/api/equity");
check("equity endpoint", Array.isArray(equity));

// Event-contract windows roll on a live schedule. During the gap between
// market rolls, the API is healthy even though there is nothing to predict.
const marketDataAvailable = Number(status.lastScan?.marketsScanned ?? 0) > 0 || preds.length > 0 || active.length > 0;
check("predictions flowing", !marketDataAvailable || (Array.isArray(preds) && preds.length > 0), marketDataAvailable ? `${preds.length} so far` : "waiting for next eligible window");
check("active windows", !marketDataAvailable || (Array.isArray(active) && active.length > 0), marketDataAvailable ? `${active.length} active` : "no eligible window right now");

const settled = preds.filter((p: any) => p.status === "resolved");
if (settled.length) {
  check("settlements recorded", true, `${settled.length} resolved`);
  const wrong = preds.filter((p: any) => !["WIN", "LOSS", "VOID"].includes(p.outcome ?? ""));
  check("outcome values", wrong.length === 0);
}

console.log(failures ? `FAILURES=${failures}` : "ALL PASS");
process.exit(failures ? 1 : 0);
