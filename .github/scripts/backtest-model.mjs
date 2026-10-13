// Walk-forward check of the 1DTE/2DTE range model (vol-model.mjs) against the plain "implied move × history" way.
// Every day is predicted only from data before it. Writes model-check.json. Run in GitHub Actions (Yahoo is reachable there).
import { readFileSync, writeFileSync } from "node:fs";
import { buildRows, fitScale, fitPlain, fitCenter, walkForward, score, FEATURES, mean } from "./vol-model.mjs";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger backtest)" } };
const nyDate = t => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
async function daily(sym, range){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
  for (let a = 0; a < 3; a++){
    try { const x = (await (await fetch(url, UA)).json()).chart.result[0], q = x.indicators.quote[0];
      return x.timestamp.map((t, i) => ({ d: nyDate(t), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter(b => [b.o, b.h, b.l, b.c].every(v => v != null && isFinite(v) && v > 0)); }
    catch (e) { if (a === 2) { console.error(sym, e.message); return []; } await new Promise(r => setTimeout(r, 2000)); }
  }
}
const [spx, vix, vix9d, vix1d] = await Promise.all([daily("^GSPC", "12y"), daily("^VIX", "12y"), daily("^VIX9D", "12y"), daily("^VIX1D", "5y")]);
const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const days = spx.filter(b => b.d < today);
const toMap = a => new Map(a.map(b => [b.d, b]));
const vol = { vix: toMap(vix), vix9d: toMap(vix9d), vix1d: toMap(vix1d) };
let EV = [];
for (const f of [process.env.EVENTS_FILE || "events.json", "prev/events.json"]){ try { EV = JSON.parse(readFileSync(f, "utf8")).events || []; if (EV.length) break; } catch {} }
const evOn = new Map(); EV.forEach(e => (evOn.get(e.d) || evOn.set(e.d, []).get(e.d)).push(e.type));
console.log(`SPX ${days.length} days ${days[0]?.d}..${days.at(-1)?.d}; VIX1D ${vix1d.length} (from ${vix1d[0]?.d}); events ${EV.length}`);

const report = { made: new Date().toISOString(), spxDays: days.length, from: days[0]?.d, vix1dFrom: vix1d[0]?.d, events: EV.length, horizons: {} };
for (const h of [1, 2]){
  const R9 = buildRows(days, vol, evOn, h, { src: "vix9d" }).filter(r => r.move != null);
  const R1 = h === 1 ? buildRows(days, vol, evOn, h, { src: "vix1d" }).filter(r => r.move != null) : null;
  const R9p = buildRows(days, vol, evOn, h, { src: "vix9dPrev" }).filter(r => r.move != null);
  const variants = {
    scale9prev: walkForward(R9p, tr => fitScale(tr), { start: 500 }),
    plain9prev: walkForward(R9p, tr => fitPlain(tr), { start: 500 }),
    plain9: walkForward(R9, tr => fitPlain(tr), { start: 500 }),
    scale9: walkForward(R9, tr => fitScale(tr), { start: 500 }),
    scale9_noEv: walkForward(R9, tr => fitScale(tr, { use: [0, 1, 2, 3, 4, 5, 6, 12, 13] }), { start: 500 }),
    scale9_rvOnly: walkForward(R9, tr => fitScale(tr, { use: [0, 1, 2] }), { start: 500 }),
  };
  if (R1){
    variants.plain1 = walkForward(R1, tr => fitPlain(tr), { start: 250 });
    variants.scale1 = walkForward(R1, tr => fitScale(tr, { lambda: 60 }), { start: 250 });
    const R1p = buildRows(days, vol, evOn, h, { src: "vix1dPrev" }).filter(r => r.move != null);
    variants.plain1prev = walkForward(R1p, tr => fitPlain(tr), { start: 250 });
    variants.scale1prev = walkForward(R1p, tr => fitScale(tr, { lambda: 60 }), { start: 250 });
  }
  // compare on the same days: the latest common window
  const sets = Object.values(variants).map(v => new Set(v.map(p => p.r.d)));
  const common = [...sets[0]].filter(d => sets.every(s => s.has(d)));
  const recent = new Set(common.slice(-750));
  const out = {};
  for (const [k, v] of Object.entries(variants)){
    const pv = v.filter(p => recent.has(p.r.d)); out[k] = score(pv);
    // coverage in calm vs stressed markets (VIX terciles), so a good average doesn't hide a regime problem
    const vx = pv.map(p => p.r.x[4]).sort((a, b) => a - b), t1 = vx[Math.floor(vx.length / 3)], t2 = vx[Math.floor(vx.length * 2 / 3)];
    out[k].byVix = ["low", "mid", "high"].map((n, i) => { const s = pv.filter(p => i === 0 ? p.r.x[4] < t1 : i === 1 ? p.r.x[4] >= t1 && p.r.x[4] < t2 : p.r.x[4] >= t2); return { n, ...(({cov68, cov84, width68}) => ({cov68, cov84, width68}))(score(s)) }; });
    // scheduled-news days (all years the variant covers): does the range still hold on them?
    out[k].byEvent = Object.fromEntries(["FOMC", "CPI", "NFP", "PPI", "MINUTES"].map((e, j) => { const s = v.filter(p => p.r.x[7 + j] === 1); return [e, s.length >= 8 ? (({n, cov68, cov84}) => ({n, cov68, cov84}))(score(s)) : null]; }));
    // full-history version, where available
    out[k].allYears = (({n, cov68, cov84, width68, width84, is68, is84}) => ({n, cov68, cov84, width68, width84, is68, is84}))(score(v));
  }
  // center: does anything beat "no change"?
  const cen = walkForward(R9, tr => ({ ...fitScale(tr), ...fitCenter(tr) }), { start: 500 }).filter(p => recent.has(p.r.d));
  const mae0 = mean(cen.map(p => Math.abs(p.r.move))), mae1 = mean(cen.map(p => Math.abs(p.r.move - p.m.shift(p.r))));
  const dirOk = cen.filter(p => Math.sign(p.m.shift(p.r)) === Math.sign(p.r.move)).length / cen.length;
  const gapFill = cen.filter(p => p.r.gapSigned !== 0).map(p => -Math.sign(p.r.gapSigned) * p.r.move);
  out.center = { n: cen.length, maeNoChange: +mae0.toFixed(1), maeModel: +mae1.toFixed(1), direction: +(dirOk * 100).toFixed(1),
                 avgShift: +mean(cen.map(p => Math.abs(p.m.shift(p.r)))).toFixed(1), gapFillAvgPts: +mean(gapFill).toFixed(2),
                 beta: cen.at(-1)?.m.beta.map(b => +b.toFixed(3)) };
  const last = fitScale(R9);
  out.features = Object.fromEntries(FEATURES.map((f, j) => [f, +(last.beta[j]).toFixed(3)]));
  out.window = { from: [...recent][0], to: [...recent].at(-1), days: recent.size };
  report.horizons[h] = out;
}
writeFileSync("model-check.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
