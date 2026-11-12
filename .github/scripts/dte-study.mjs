// 7 DTE vs 14 DTE put credit spreads by delta (owner's question, Nov 2026).
// Today's real chain (CBOE delayed, SPX and XSP) gives the strike, distance and credit at each put delta for the
// expirations nearest 7 and 14 calendar days. History (Yahoo, 12 years of SPX with VIX / VIX9D) gives how often a strike
// that far away, measured in the same implied-move units, was breached, touched or fully lost, and the average loss.
// Held to expiration, no management. Writes dte-study.json. Run in GitHub Actions (CBOE and Yahoo are reachable there).
import { writeFileSync } from "node:fs";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger research)" } };
const r2 = v => Math.round(v * 100) / 100, mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const nyDate = t => new Date(t * 1000).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
async function daily(sym, range){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=1d`;
  for (let a = 0; a < 3; a++){
    try { const x = (await (await fetch(url, UA)).json()).chart.result[0], q = x.indicators.quote[0];
      return x.timestamp.map((t, i) => ({ d: nyDate(t), o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter(b => [b.o, b.h, b.l, b.c].every(v => v != null && isFinite(v) && v > 0)); }
    catch (e) { if (a === 2) { console.error(sym, e.message); return []; } await new Promise(r => setTimeout(r, 2000)); }
  }
}
async function chain(sym){
  const res = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/_${sym}.json`, UA); if (!res.ok) throw new Error(`${sym} chain HTTP ${res.status}`);
  const j = await res.json(), S = +j.data.current_price, out = [];
  for (const q of j.data.options || []){
    const m = /^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(q.option || ""); if (!m) continue;
    if (sym === "SPX" && m[1] === "SPX") continue;                       // AM-settled monthlies
    out.push({ exp: `20${m[2]}-${m[3]}-${m[4]}`, type: m[5], K: +m[6] / 1000, bid: +q.bid || 0, ask: +q.ask || 0, delta: +q.delta || 0, iv: +q.iv || 0 });
  }
  return { S, t: j.timestamp, opts: out };
}

const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const dayDiff = (a, b) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5);
const [spxAll, vix, vix9d] = await Promise.all([daily("^GSPC", "12y"), daily("^VIX", "12y"), daily("^VIX9D", "12y")]);
const spx = spxAll.filter(b => b.d < today), vmap = new Map(vix.map(b => [b.d, b.c])), v9map = new Map(vix9d.map(b => [b.d, b.c]));
console.log(`SPX ${spx.length} days ${spx[0]?.d}..${spx.at(-1)?.d}`);

const DELTAS = [0.05, 0.07, 0.10, 0.12, 0.14, 0.16, 0.20];
const CFG = { SPX: { widths: [10, 20], fee: 1.08 }, XSP: { widths: [1, 2], fee: 0.46 } };
const mid = o => o && o.bid > 0 && o.ask > 0 && o.ask >= o.bid ? (o.bid + o.ask) / 2 : null;

// history: for a put spread opened at each past close, N trading days to expiration, short strike z units below the price
// (unit = price × vol index / 100 × √(N/252)), long strike zl units below
function history(N, volMap, z, zl, from){
  let n = 0, itm = 0, maxLoss = 0, touch = 0, lossSum = 0;   // lossSum in units of the spread width
  for (let i = 0; i + N < spx.length; i++){
    const b = spx[i]; if (from && b.d < from) continue; const v = volMap.get(b.d); if (!v) continue;
    const u = b.c * v / 100 * Math.sqrt(N / 252), K = b.c - z * u, L = b.c - zl * u, end = spx[i + N].c;
    let lo = Infinity; for (let j = i + 1; j <= i + N; j++) lo = Math.min(lo, spx[j].l);
    n++; if (end < K) itm++; if (end <= L) maxLoss++; if (lo <= K) touch++;
    lossSum += Math.min(1, Math.max(0, (K - end) / (K - L)));
  }
  return { n, itm: itm / n, maxLoss: maxLoss / n, touch: touch / n, avgLoss: lossSum / n };
}

const report = { made: new Date().toISOString(), note: "Held to expiration, no management. Credits are mids from the delayed chain; history uses 12 years of SPX with the strike placed the same number of implied-move units away (VIX9D for ~7 DTE, VIX for ~14 DTE).", symbols: {} };
for (const sym of ["SPX", "XSP"]){
  let ch; try { ch = await chain(sym); } catch (e) { console.error(e.message); continue; }
  const scale = sym === "XSP" ? 10 : 1, exps = [...new Set(ch.opts.map(o => o.exp))].filter(e => e > today).sort();
  const pick = target => exps.reduce((a, e) => Math.abs(dayDiff(today, e) - target) < Math.abs(dayDiff(today, a) - target) ? e : a, exps[0]);
  const out = { spot: ch.S, asOf: ch.t, dte: {} };
  for (const target of [7, 14]){
    const exp = pick(target), cal = dayDiff(today, exp), N = Math.max(1, Math.round(cal * 5 / 7)), puts = ch.opts.filter(o => o.exp === exp && o.type === "P" && o.K < ch.S);
    const volMap = target === 7 ? v9map : vmap, volNow = (target === 7 ? vix9d : vix).at(-1)?.c, unit = ch.S * volNow / 100 * Math.sqrt(N / 252);
    const rows = [];
    for (const d of DELTAS){
      const s = puts.filter(o => o.delta < 0).reduce((a, o) => !a || Math.abs(Math.abs(o.delta) - d) < Math.abs(Math.abs(a.delta) - d) ? o : a, null); if (!s) continue;
      for (const w of CFG[sym].widths){
        const l = puts.find(o => o.K === s.K - w), ms = mid(s), ml = mid(l); if (ms == null || ml == null) continue;
        const credit = ms - ml, natural = s.bid - l.ask, z = (ch.S - s.K) / unit, zl = (ch.S - (s.K - w)) / unit;
        const fee = CFG[sym].fee * 2 / 100;     // per spread, in points (opening only: expires worthless)
        const stat = from => { const h = history(N, volMap, z, zl, from); if (!h.n) return null;
          const ev = credit - h.avgLoss * w - fee;   // per spread, points; ×100 = dollars
          return { n: h.n, finishITM: r2(h.itm * 100), touch: r2(h.touch * 100), fullLoss: r2(h.maxLoss * 100), avgLossPts: r2(h.avgLoss * w), evDollars: r2(ev * 100), evAtFill: r2((natural - h.avgLoss * w - fee) * 100) }; };
        rows.push({ targetDelta: d, delta: r2(Math.abs(s.delta)), short: s.K, long: s.K - w, width: w, distPts: r2(ch.S - s.K), distPct: r2((ch.S - s.K) / ch.S * 100), z: r2(z), iv: r2(s.iv * 100),
          credit: r2(credit), natural: r2(natural), creditPctWidth: r2(credit / w * 100), maxLoss: r2((w - credit) * 100), breakevenWinRate: r2((w - credit + fee) / (w + 0) * 100),
          all: stat(null), last3y: stat(spx.at(-756)?.d) });
      }
    }
    out.dte[target] = { exp, calendarDays: cal, tradingDays: N, volIndex: target === 7 ? "VIX9D" : "VIX", volNow, impliedMovePts: r2(unit), rows };
  }
  report.symbols[sym] = out;
}
writeFileSync("dte-study.json", JSON.stringify(report, null, 1));
for (const [sym, o] of Object.entries(report.symbols)) for (const [t, d] of Object.entries(o.dte)){
  console.log(`\n${sym} ${o.spot} · ~${t} DTE = ${d.exp} (${d.calendarDays} days, ${d.tradingDays} sessions) · ${d.volIndex} ${d.volNow} · 1σ ${d.impliedMovePts}`);
  for (const r of d.rows) console.log(`  Δ${r.delta} ${r.short}/${r.long} w${r.width} dist ${r.distPts} (${r.distPct}%, z ${r.z}) credit ${r.credit} (fill ${r.natural}, ${r.creditPctWidth}% of width) | 12y: ITM ${r.all?.finishITM}% touch ${r.all?.touch}% full ${r.all?.fullLoss}% EV $${r.all?.evDollars} (fill $${r.all?.evAtFill}) | 3y: ITM ${r.last3y?.finishITM}% EV $${r.last3y?.evDollars}`);
}
