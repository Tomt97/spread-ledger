// Research: what, if anything, helps predict where SPX closes, beyond "it stays where it is"?
// Part A (daily, 10+ years): the close from the 9:30 open, using everything known at the open: the overnight gap,
//   yesterday's session, trend and technicals, VIX level/term structure/overnight change, other markets (Nikkei today;
//   yesterday's DAX, Nasdaq, Russell, 10-year yield, dollar, oil, gold, bitcoin, high-yield bonds, SKEW) and the
//   calendar (weekday, opex, turn of month, FOMC/CPI/jobs days).
// Part B (hourly ES, ~2 years): the close from later in the session (10 am ... 3 pm), using the move so far.
// Every prediction is walk-forward (fit only on earlier days). Writes center-check.json. Run in GitHub Actions.
import { readFileSync, writeFileSync } from "node:fs";
import { ridge, mean, quantile } from "./vol-model.mjs";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger research)" } };
async function chart(sym, interval, range){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}`;
  for (let a = 0; a < 3; a++){
    try { const x = (await (await fetch(url, UA)).json()).chart.result[0], q = x.indicators.quote[0];
      return x.timestamp.map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter(b => [b.o, b.h, b.l, b.c].every(v => v != null && isFinite(v) && v > 0)); }
    catch (e) { if (a === 2){ console.error(sym, e.message); return []; } await new Promise(r => setTimeout(r, 2500)); }
  }
}
const utcD = t => new Date(t * 1000).toISOString().slice(0, 10);
const nyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const nyParts = t => { const p = Object.fromEntries(nyFmt.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, h: +p.hour % 24, m: +p.minute }; };

const SYMS = { spx: "^GSPC", vix: "^VIX", vix9: "^VIX9D", skew: "^SKEW", ndx: "^NDX", rut: "^RUT", tnx: "^TNX", dxy: "DX-Y.NYB", oil: "CL=F", gold: "GC=F", n225: "^N225", dax: "^GDAXI", btc: "BTC-USD", hyg: "HYG" };
const raw = {}; await Promise.all(Object.entries(SYMS).map(async ([k, s]) => { raw[k] = await chart(s, "1d", "12y"); }));
const es60 = await chart("ES=F", "60m", "730d");
console.log(Object.entries(raw).map(([k, v]) => `${k} ${v.length}`).join(", "), "| ES 60m", es60.length);
const M = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, new Map(v.map(b => [utcD(b.t), b]))]));
let EV = []; for (const f of ["prev/events.json", "events.json"]) { try { EV = JSON.parse(readFileSync(f, "utf8")).events || []; if (EV.length) break; } catch {} }
const evOn = new Map(); EV.forEach(e => (evOn.get(e.d) || evOn.set(e.d, []).get(e.d)).push(e.type));

/* ---------- Part A: daily ---------- */
const today = new Date().toISOString().slice(0, 10);
const S = raw.spx.map(b => ({ ...b, d: utcD(b.t) })).filter(b => b.d < today);
const dates = S.map(b => b.d);
// last value of a series strictly before date d (for markets that trade on different days)
const prevIdx = {}; for (const [k, m] of Object.entries(M)) { const ks = [...m.keys()].sort(); prevIdx[k] = ks; }
function prior(k, d, n = 1){ const ks = prevIdx[k]; let lo = 0, hi = ks.length - 1, best = -1; while (lo <= hi){ const mid = (lo + hi) >> 1; if (ks[mid] < d){ best = mid; lo = mid + 1; } else hi = mid - 1; } return best - n + 1 >= 0 ? M[k].get(ks[best - n + 1]) : null; }
const ret = (k, d) => { const a = prior(k, d, 1), b = prior(k, d, 2); return a && b ? Math.log(a.c / b.c) : null; };
const isOpex = d => { const x = new Date(d + "T12:00:00Z"); return x.getUTCDay() === 5 && x.getUTCDate() >= 15 && x.getUTCDate() <= 21; };
const FEAT = ["gap", "prevCC", "prevOC", "closeLoc", "r5", "r20", "dSMA20", "dSMA50", "rsi14", "vixLvl", "vixTerm", "vixChgPrev", "vixOvernight", "skewChg",
  "n225Today", "daxPrev", "ndxRel", "rutRel", "tnxChg", "dxyRet", "oilRet", "goldRet", "btcRet", "hygRet", "mon", "fri", "opex", "tomStart", "tomEnd", "fomc", "cpi", "nfp"];
const rows = [];
const closes = S.map(b => b.c);
const rsi = (i, n = 14) => { let g = 0, l = 0; for (let j = i - n + 1; j <= i; j++){ const d = closes[j] - closes[j - 1]; if (d > 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); };
for (let i = 60; i < S.length; i++){
  const b = S[i], p = S[i - 1], d = b.d;
  const vx = M.vix.get(p.d), v9 = M.vix9.get(p.d), vxT = M.vix.get(d); if (!vx || !v9) continue;
  const ivd = vx.c / 100 / Math.sqrt(252), I = b.o * ivd;          // one day of implied move at the open, in points
  const sma = n => mean(closes.slice(i - n, i));
  const nk = M.n225.get(d), nkp = prior("n225", d, 1);
  const ym = d.slice(0, 7), month = dates.filter(x => x.slice(0, 7) === ym), pos = month.indexOf(d);
  const ev = evOn.get(d) || [];
  const x = {
    gap: Math.log(b.o / p.c) / ivd, prevCC: Math.log(p.c / S[i - 2].c) / ivd, prevOC: Math.log(p.c / p.o) / ivd,
    closeLoc: p.h > p.l ? (p.c - p.l) / (p.h - p.l) - 0.5 : 0, r5: Math.log(p.c / S[i - 6].c) / ivd, r20: Math.log(p.c / S[i - 21].c) / ivd,
    dSMA20: Math.log(p.c / sma(20)) / ivd, dSMA50: Math.log(p.c / sma(50)) / ivd, rsi14: (rsi(i - 1) - 50) / 50,
    vixLvl: Math.log(vx.c / 20), vixTerm: Math.log(v9.c / vx.c), vixChgPrev: ret("vix", d) ?? 0, vixOvernight: vxT ? Math.log(vxT.o / vx.c) : 0,
    skewChg: ret("skew", d) ?? 0, n225Today: nk && nkp ? Math.log(nk.c / nkp.c) / ivd : 0, daxPrev: (ret("dax", d) ?? 0) / ivd,
    ndxRel: ((ret("ndx", d) ?? 0) - Math.log(p.c / S[i - 2].c)) / ivd, rutRel: ((ret("rut", d) ?? 0) - Math.log(p.c / S[i - 2].c)) / ivd,
    tnxChg: (() => { const a = prior("tnx", d, 1), c = prior("tnx", d, 2); return a && c ? (a.c - c.c) : 0; })(),
    dxyRet: (ret("dxy", d) ?? 0) / ivd, oilRet: (ret("oil", d) ?? 0) / ivd, goldRet: (ret("gold", d) ?? 0) / ivd, btcRet: (ret("btc", d) ?? 0) / ivd, hygRet: (ret("hyg", d) ?? 0) / ivd,
    mon: new Date(d + "T12:00:00Z").getUTCDay() === 1 ? 1 : 0, fri: new Date(d + "T12:00:00Z").getUTCDay() === 5 ? 1 : 0, opex: isOpex(d) ? 1 : 0,
    tomStart: pos >= 0 && pos < 3 ? 1 : 0, tomEnd: pos === month.length - 1 && d.slice(0, 7) < today.slice(0, 7) ? 1 : 0,
    fomc: ev.includes("FOMC") ? 1 : 0, cpi: ev.includes("CPI") ? 1 : 0, nfp: ev.includes("NFP") ? 1 : 0,
  };
  rows.push({ d, I, y: (b.c - b.o) / I, pts: b.c - b.o, x: FEAT.map(f => isFinite(x[f]) ? x[f] : 0) });
}
console.log(`Part A rows ${rows.length} (${rows[0]?.d}..${rows.at(-1)?.d})`);
// univariate: correlation with the open→close move, full sample and second half (stability)
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let s = 0, sa = 0, sb = 0; a.forEach((v, i) => { s += (v - ma) * (b[i] - mb); sa += (v - ma) ** 2; sb += (b[i] - mb) ** 2; }); return s / Math.sqrt(sa * sb || 1); };
const half = Math.floor(rows.length / 2);
const uni = FEAT.map((f, j) => { const xa = rows.map(r => r.x[j]), ya = rows.map(r => r.y), c1 = corr(xa.slice(0, half), ya.slice(0, half)), c2 = corr(xa.slice(half), ya.slice(half)), c = corr(xa, ya);
  return { f, corr: +c.toFixed(3), t: +(c * Math.sqrt(rows.length)).toFixed(1), firstHalf: +c1.toFixed(3), secondHalf: +c2.toFixed(3) }; }).sort((a, b) => Math.abs(b.t) - Math.abs(a.t));
// walk-forward ridge with all features, at several shrinkage levels
function wf(lambda, use){
  const out = []; let m = null;
  for (let i = 750; i < rows.length; i++){
    if (!m || (i - 750) % 21 === 0){ const tr = rows.slice(0, i); m = ridge(tr.map(r => use.map(j => r.x[j])), tr.map(r => r.y), lambda); }
    const r = rows[i], yhat = m.predict(use.map(j => r.x[j]));
    out.push({ d: r.d, pts: r.pts, hat: yhat * r.I });
  }
  const mae0 = mean(out.map(o => Math.abs(o.pts))), mae1 = mean(out.map(o => Math.abs(o.pts - o.hat)));
  const dl = out.map(o => Math.abs(o.pts) - Math.abs(o.pts - o.hat)), dm = mean(dl) / (Math.sqrt(mean(dl.map(v => (v - mean(dl)) ** 2)) / dl.length) || 1);
  const dir = out.filter(o => Math.abs(o.hat) > 0.5).map(o => Math.sign(o.hat) === Math.sign(o.pts));
  const recent = out.slice(-250);
  return { lambda, days: out.length, maeNoChange: +mae0.toFixed(2), maeModel: +mae1.toFixed(2), gainPts: +(mae0 - mae1).toFixed(2), dmT: +dm.toFixed(2),
           directionHit: dir.length ? +(dir.filter(Boolean).length / dir.length * 100).toFixed(1) : null, avgShiftPts: +mean(out.map(o => Math.abs(o.hat))).toFixed(1),
           lastYear: { maeNoChange: +mean(recent.map(o => Math.abs(o.pts))).toFixed(2), maeModel: +mean(recent.map(o => Math.abs(o.pts - o.hat))).toFixed(2) } };
}
const all = FEAT.map((_, j) => j), top = uni.slice(0, 6).map(u => FEAT.indexOf(u.f));
const partA = { rows: rows.length, from: rows[0]?.d, to: rows.at(-1)?.d, univariate: uni,
  ridgeAll: [30, 300, 3000].map(l => wf(l, all)), ridgeTop6: [30, 300, 3000].map(l => wf(l, top)) };
// what a perfect-direction coin flip would need: share of |move| on days the model calls direction right
partA.typicalMovePts = { median: +quantile(rows.slice(-250).map(r => Math.abs(r.pts)), 0.5).toFixed(1), mean: +mean(rows.slice(-250).map(r => Math.abs(r.pts))).toFixed(1) };

/* ---------- Part B: later in the session (hourly ES) ---------- */
const sess = new Map();
for (const b of es60){ const t = nyParts(b.t); if (t.h < 9 || t.h > 15) continue; (sess.get(t.d) || sess.set(t.d, []).get(t.d)).push({ ...b, h: t.h }); }
const partB = {};
const dayRows = [...sess.entries()].filter(([, bs]) => bs.some(b => b.h === 15) && bs.some(b => b.h === 9)).map(([d, bs]) => {
  const at = h => bs.find(b => b.h === h), close = at(15).c, open = at(9).c;       // 9:00 bar closes at 10:00; 15:00 bar closes at 16:00
  return { d, close, open930: at(9).o, px: Object.fromEntries([10, 11, 12, 13, 14, 15].map(h => [h, at(h - 1)?.c])) };
});
for (const H of [10, 11, 12, 13, 14, 15]){
  const rs = dayRows.filter(r => r.px[H] != null).map(r => ({ d: r.d, y: r.close - r.px[H], soFar: r.px[H] - r.open930 }));
  if (rs.length < 200) continue;
  // walk-forward: does the move so far (momentum or reversal) help predict the rest of the day?
  const out = []; for (let i = 120; i < rs.length; i++){ const tr = rs.slice(0, i), b = tr.reduce((a, r) => a + r.soFar * r.y, 0) / (tr.reduce((a, r) => a + r.soFar * r.soFar, 0) || 1); out.push({ y: rs[i].y, hat: b * rs[i].soFar, b }); }
  partB[`${H}:00`] = { days: out.length, maeNoChange: +mean(out.map(o => Math.abs(o.y))).toFixed(1), maeMomentum: +mean(out.map(o => Math.abs(o.y - o.hat))).toFixed(1),
    within10: +(out.filter(o => Math.abs(o.y) <= 10).length / out.length * 100).toFixed(0), within20: +(out.filter(o => Math.abs(o.y) <= 20).length / out.length * 100).toFixed(0), beta: +out.at(-1).b.toFixed(3) };
}
// Part C: "rest of day" ranges. At each hour, the rest-of-day move in units of the day's implied move (VIX at the prior
// close) × √(time left / 6.5 h). Walk-forward quantiles give the 68%/84% half-widths; check coverage and width.
const partC = {};
for (const H of [10, 11, 12, 13, 14, 15]){
  const rs = dayRows.filter(r => r.px[H] != null).map(r => { const v = prior("vix", r.d, 1); if (!v) return null;
    const unit = r.px[H] * v.c / 100 / Math.sqrt(252) * Math.sqrt((16 - H) / 6.5); return { d: r.d, y: r.close - r.px[H], unit }; }).filter(Boolean);
  if (rs.length < 200) continue;
  const out = []; for (let i = 120; i < rs.length; i++){ const z = rs.slice(Math.max(0, i - 400), i).map(r => Math.abs(r.y) / r.unit);
    const k68 = quantile(z, 0.68), k84 = quantile(z, 0.84), r = rs[i]; out.push({ in68: Math.abs(r.y) <= k68 * r.unit, in84: Math.abs(r.y) <= k84 * r.unit, w68: 2 * k68 * r.unit, w84: 2 * k84 * r.unit, k68, k84 }); }
  partC[`${H}:00`] = { days: out.length, cov68: +(out.filter(o => o.in68).length / out.length * 100).toFixed(1), cov84: +(out.filter(o => o.in84).length / out.length * 100).toFixed(1),
    width68: +mean(out.map(o => o.w68)).toFixed(1), width84: +mean(out.map(o => o.w84)).toFixed(1), k68: +out.at(-1).k68.toFixed(3), k84: +out.at(-1).k84.toFixed(3) };
}
// Part D: do classic day levels (prior day high/low/close, floor pivots) hold better than round numbers?
// Same rule as the live level log, scaled to the price level of the day (12 pts and 25 pts at SPX ~7700).
const partD = (() => {
  const sum = {}, add = (g, j) => { const k = sum[g] ||= { tested: 0, held: 0 }; if (j && j.tested){ k.tested++; if (j.held) k.held++; } };
  for (let i = 15; i < S.length; i++){
    const b = S[i], p = S[i - 1], scale = b.o / 7700, tol = 2 * scale, deep = 12 * scale, step = 25 * scale;
    let A = 0; for (let j = i - 14; j <= i - 1; j++) A += Math.max(S[j].h - S[j].l, Math.abs(S[j].h - S[j - 1].c), Math.abs(S[j].l - S[j - 1].c)); A /= 14;
    const judge = x => { if (Math.abs(x - b.o) > 1.5 * A || Math.abs(x - b.o) < tol) return null; const sup = x < b.o, tested = sup ? b.l <= x + tol : b.h >= x - tol;
      if (!tested) return { tested: false }; const depth = sup ? x - b.l : b.h - x; return { tested: true, held: depth <= deep && (sup ? b.c >= x : b.c <= x) }; };
    const P = (p.h + p.l + p.c) / 3;
    const L = { "prior day high/low": [p.h, p.l], "prior day close": [p.c], "pivot": [P], "R1/S1": [2 * P - p.l, 2 * P - p.h], "R2/S2": [P + (p.h - p.l), P - (p.h - p.l)] };
    for (const [g, xs] of Object.entries(L)) for (const x of xs) add(g, judge(x));
    for (let x = Math.ceil((b.o - 1.5 * A) / step) * step; x <= b.o + 1.5 * A; x += step) add("round numbers (baseline)", judge(x));
  }
  return Object.fromEntries(Object.entries(sum).map(([g, v]) => [g, { ...v, heldPct: +(v.held / (v.tested || 1) * 100).toFixed(1) }]));
})();
const report = { made: new Date().toISOString(), partA, partB, partC, partD };
writeFileSync("center-check.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify({ ridgeAll: partA.ridgeAll, ridgeTop6: partA.ridgeTop6, top: uni.slice(0, 10), partB, partC, partD }, null, 1));
