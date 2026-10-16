// Research: is the ES − SPX spread (basis) the Market page subtracts correct?
// For each recent session it compares three numbers:
//   used  : ES 3–4 pm bar close − SPX close (what update-market.mjs uses for that day)
//   bars  : median of ES − SPX on every matched intraday bar that day (15-minute for 60 days, hourly for ~2 years)
//   fair  : theoretical carry = SPX × (T-bill rate − dividend yield) × days to the contract's expiry / 365
// and flags days where they disagree. Writes basis-check.json.
import { writeFileSync } from "node:fs";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger research)" } };
async function chart(sym, interval, range){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=true`;
  for (let a = 0; a < 3; a++){
    try { const x = (await (await fetch(url, UA)).json()).chart.result[0], q = x.indicators.quote[0];
      return x.timestamp.map((t, i) => ({ t, c: q.close[i] })).filter(b => b.c != null && isFinite(b.c) && b.c > 0); }
    catch (e) { if (a === 2){ console.error(sym, e.message); return []; } await new Promise(r => setTimeout(r, 2500)); }
  }
}
const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const ny = t => { const p = Object.fromEntries(fmt.formatToParts(new Date(t * 1000)).map(x => [x.type, x.value])); return { d: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour % 24) * 60 + +p.minute }; };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const r2 = v => v == null ? null : Math.round(v * 100) / 100;

const [es15, spx15, es60, spx60, spxD, irx] = await Promise.all([chart("ES=F", "15m", "60d"), chart("^GSPC", "15m", "60d"), chart("ES=F", "60m", "730d"),
  chart("^GSPC", "60m", "730d"), chart("^GSPC", "1d", "3y"), chart("^IRX", "1d", "3y")]);
console.log(`ES15 ${es15.length} SPX15 ${spx15.length} ES60 ${es60.length} SPX60 ${spx60.length} SPXd ${spxD.length} IRX ${irx.length}`);
const spxClose = new Map(spxD.map(b => [ny(b.t).d, b.c])), rate = new Map(irx.map(b => [ny(b.t).d, b.c]));
// "used": the ES hourly bar that starts at 3:00 pm closes at 4:00 pm
const used = new Map(); for (const b of es60){ const t = ny(b.t); if (t.mins === 15 * 60 && spxClose.has(t.d)) used.set(t.d, b.c - spxClose.get(t.d)); }
// matched intraday bars during the regular session
function matched(es, spx){
  const sp = new Map(spx.map(b => [b.t, b.c])), byDay = new Map();
  for (const b of es){ if (!sp.has(b.t)) continue; const t = ny(b.t); if (t.mins < 9 * 60 + 45 || t.mins > 15 * 60 + 45) continue; (byDay.get(t.d) || byDay.set(t.d, []).get(t.d)).push(b.c - sp.get(b.t)); }
  return byDay;
}
const m15 = matched(es15, spx15), m60 = matched(es60, spx60);
// quarterly expiry (third Friday of Mar/Jun/Sep/Dec); Yahoo's ES=F rolls about 8 days before it
const thirdFri = (y, m) => { const d = new Date(Date.UTC(y, m, 1)); const off = (5 - d.getUTCDay() + 7) % 7; return new Date(Date.UTC(y, m, 1 + off + 14)); };
function contractExpiry(iso){
  const d = new Date(iso + "T12:00:00Z");
  for (const y of [d.getUTCFullYear(), d.getUTCFullYear() + 1]) for (const q of [2, 5, 8, 11]){ const e = thirdFri(y, q); if ((e - d) / 864e5 > 8) return e; }
}
const DIV = 0.0125;   // S&P 500 dividend yield, approximate
const days = [...new Set([...used.keys(), ...m60.keys()])].sort().slice(-500);
const rows = days.map(d => {
  const u = used.get(d), b15 = m15.has(d) ? median(m15.get(d)) : null, b60 = m60.has(d) ? median(m60.get(d)) : null;
  const exp = contractExpiry(d), T = (exp - new Date(d + "T20:00:00Z")) / 864e5, rf = (rate.get(d) ?? null);
  const fair = rf != null && spxClose.has(d) ? spxClose.get(d) * (rf / 100 - DIV) * T / 365 : null;
  return { d, used: r2(u), bars15: r2(b15), bars60: r2(b60), fair: r2(fair), daysToExpiry: Math.round(T), expiry: exp.toISOString().slice(0, 10) };
});
// disagreements worth a look
const diff = (a, b) => a != null && b != null ? a - b : null;
const flags = rows.filter(r => { const x = diff(r.used, r.bars15 ?? r.bars60); return x != null && Math.abs(x) > 3; });
const stat = k => { const v = rows.map(r => diff(r.used, r[k])).filter(x => x != null); const a = v.map(Math.abs); return v.length ? { days: v.length, medianAbsDiff: r2(median(a)), over3pts: a.filter(x => x > 3).length, over10pts: a.filter(x => x > 10).length } : null; };
const report = { made: new Date().toISOString(), vsBars15: stat("bars15"), vsBars60: stat("bars60"), vsFair: stat("fair"), flagged: flags, last30: rows.slice(-30), all: rows };
writeFileSync("basis-check.json", JSON.stringify(report, null, 1));
console.log(JSON.stringify({ vsBars15: report.vsBars15, vsBars60: report.vsBars60, vsFair: report.vsFair, flagged: flags.slice(-20), last10: rows.slice(-10) }, null, 1));
