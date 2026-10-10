// Builds market.json for the Market page: ES futures charts converted to SPX points, SPX gamma exposure (GEX),
// support/resistance levels and 1DTE/2DTE SPX ranges. Runs in GitHub Actions next to update-quotes.mjs.
// Sources (free, no key): Yahoo Finance charts (ES=F, ^GSPC, ^VIX, ^VIX1D, ^VIX9D) and CBOE's delayed SPX options.
// Everything here is a study aid built from delayed data, not a forecast anyone can rely on.
import { readFileSync, writeFileSync } from "node:fs";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger market)" } };
const r2 = v => Math.round(v * 100) / 100;
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };

/* ---------- New York time helpers ---------- */
const nyFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" });
function ny(ts){   // ts in seconds
  const p = Object.fromEntries(nyFmt.formatToParts(new Date(ts * 1000)).map(x => [x.type, x.value]));
  const h = +p.hour % 24, m = +p.minute;
  return { date: `${p.year}-${p.month}-${p.day}`, h, m, mins: h * 60 + m, dow: p.weekday };
}
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
// Futures sessions run 6:00 pm - 5:00 pm New York; a bar after 6 pm belongs to the next trading day.
function sessionDate(ts){
  const t = ny(ts); let d = t.h >= 18 ? addDays(t.date, 1) : t.date;
  const wd = new Date(d + "T12:00:00Z").getUTCDay();
  if (wd === 6) d = addDays(d, 2); else if (wd === 0) d = addDays(d, 1);
  return d;
}

/* ---------- data ---------- */
async function chart(sym, interval, range){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=true`;
  for (let attempt = 0; attempt < 3; attempt++){
    try {
      const res = await fetch(url, UA); if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const x = (await res.json()).chart?.result?.[0]; if (!x) throw new Error("no data");
      const q = x.indicators.quote[0], out = [];
      (x.timestamp || []).forEach((t, i) => {
        const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
        if ([o, h, l, c].some(v => v == null || !isFinite(v))) return;
        out.push({ t, o, h, l, c, v: q.volume?.[i] || 0 });
      });
      return out;
    } catch (e) { if (attempt === 2) { console.error(`${sym} ${interval}: ${e.message}`); return []; } await new Promise(r => setTimeout(r, 1500)); }
  }
}
const [es15, es60, spxD, spx15, vixD, vix1dD, vix9dD] = await Promise.all([
  chart("ES=F", "15m", "60d"), chart("ES=F", "60m", "730d"), chart("^GSPC", "1d", "5y"), chart("^GSPC", "15m", "5d"),
  chart("^VIX", "1d", "5y"), chart("^VIX1D", "1d", "5y"), chart("^VIX9D", "1d", "5y")]);
if (!es60.length || !spxD.length) { console.error("Missing ES or SPX history"); process.exit(1); }

/* ---------- ES - SPX spread (basis), per trading day ----------
   The ES 1-hour bar that starts at 3:00 pm New York closes at 4:00 pm, the same moment as the SPX close. */
const spxClose = new Map(spxD.map(b => [ny(b.t).date, b.c]));
const basisByDay = new Map();
for (const b of es60){ const t = ny(b.t); if (t.h === 15 && t.m === 0 && spxClose.has(t.date)) basisByDay.set(t.date, b.c - spxClose.get(t.date)); }
// Today, during the session: median of matching 15-minute closes (both feeds stamp bars on the quarter hour).
const spx15ByT = new Map(spx15.map(b => [b.t, b.c]));
const todayNY = ny(Date.now() / 1000).date;
const liveDiffs = es15.filter(b => spx15ByT.has(b.t) && ny(b.t).date === todayNY).map(b => b.c - spx15ByT.get(b.t));
const basisDays = [...basisByDay.keys()].sort();
const lastBasis = basisDays.length ? basisByDay.get(basisDays[basisDays.length - 1]) : 0;
const basisNow = liveDiffs.length >= 2 ? median(liveDiffs.slice(-8)) : lastBasis;
// The spread of a session that hasn't closed yet: today's live value, else the latest close.
const basisFor = day => basisByDay.get(day) ?? (day >= todayNY ? basisNow : (() => {   // nearest earlier day (holidays, gaps)
  let lo = 0, hi = basisDays.length - 1, best = null; while (lo <= hi){ const mid = (lo + hi) >> 1; if (basisDays[mid] <= day){ best = basisDays[mid]; lo = mid + 1; } else hi = mid - 1; }
  return best ? basisByDay.get(best) : basisNow; })());

/* ---------- ES bars in SPX points ---------- */
const adj = bars => bars.map(b => { const k = basisFor(sessionDate(b.t)); return { t: b.t, o: b.o - k, h: b.h - k, l: b.l - k, c: b.c - k, v: b.v, d: sessionDate(b.t) }; });
const a15 = adj(es15), a60 = adj(es60);
function group(bars, keyOf){
  const out = []; let cur = null, key = null;
  for (const b of bars){
    const k = keyOf(b);
    if (k !== key){ if (cur) out.push(cur); cur = { ...b }; key = k; }
    else { cur.h = Math.max(cur.h, b.h); cur.l = Math.min(cur.l, b.l); cur.c = b.c; cur.v += b.v; }
  }
  if (cur) out.push(cur);
  return out;
}
// 2h / 4h buckets counted from the 6:00 pm session open.
const bucket = n => b => { const t = ny(b.t); return `${b.d}|${Math.floor(((t.h - 18 + 24) % 24) / n)}`; };
const a2h = group(a60, bucket(2)), a4h = group(a60, bucket(4)), aD = group(a60, b => b.d);
const lastSession = n => bars => { const days = [...new Set(bars.map(b => b.d))].slice(-n); return bars.filter(b => b.d >= days[0]); };
const pack = bars => bars.map(b => [b.t, r2(b.o), r2(b.h), r2(b.l), r2(b.c), Math.round(b.v)]);

const esLast = es15.length ? es15[es15.length - 1] : es60[es60.length - 1];
const spot = esLast.c - basisNow;            // SPX equivalent now (ES trades nearly around the clock)

/* ---------- SPX options: GEX and implied moves ---------- */
let chain = null;
try { const res = await fetch("https://cdn.cboe.com/api/global/delayed_quotes/options/_SPX.json", UA); if (res.ok) chain = await res.json(); else console.error(`SPX chain HTTP ${res.status}`); }
catch (e) { console.error(`SPX chain: ${e.message}`); }
const nowSec = Date.now() / 1000;
const normPdf = x => Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI);
// Seconds since epoch of a New York clock time (minutes after midnight) on a date.
function atNY(iso, mins){
  const guess = Date.parse(iso + "T20:00:00Z") / 1000, t = ny(guess);          // 4 pm EDT is 20:00 UTC; adjust for EST
  return guess + (mins - t.mins) * 60;
}
const expirySec = (iso, am) => atNY(iso, am ? 9 * 60 + 30 : 16 * 60);       // AM-settled monthly SPX: 9:30 am
let gex = null, expirations = [];
if (chain?.data?.options){
  const S = +chain.data.current_price, opts = [];
  for (const q of chain.data.options){
    const m = /^(SPXW?)(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/.exec(q.option || ""); if (!m) continue;
    const exp = `20${m[2]}-${m[3]}-${m[4]}`, K = +m[6] / 1000, am = m[1] === "SPX";
    const T = (expirySec(exp, am) - nowSec) / (365 * 864e2);
    if (T <= 0 || T > 60 / 365) continue;
    opts.push({ exp, am, K, type: m[5], T: Math.max(T, 1 / (365 * 24 * 4)), iv: +q.iv || 0, g: +q.gamma || 0, oi: +q.open_interest || 0, bid: +q.bid || 0, ask: +q.ask || 0 });
  }
  // Dealer gamma per 1% move, in $: calls +, puts - (the usual "dealers short puts, long calls" convention).
  const per = (g, oi, s) => g * oi * 100 * s * s * 0.01;
  const strikes = new Map();
  for (const o of opts){ if (!o.oi || Math.abs(o.K / S - 1) > 0.1) continue;
    const e = per(o.g, o.oi, S) * (o.type === "C" ? 1 : -1), r = strikes.get(o.K) || { c: 0, p: 0 };
    if (o.type === "C") r.c += e; else r.p += e; strikes.set(o.K, r); }
  const rows = [...strikes.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => [k, v.c, v.p]);
  const total = rows.reduce((a, r) => a + r[1] + r[2], 0);
  const above = rows.filter(r => r[0] >= S), below = rows.filter(r => r[0] <= S);
  const callWall = above.length ? above.reduce((a, r) => r[1] > a[1] ? r : a)[0] : null;
  const putWall = below.length ? below.reduce((a, r) => r[2] < a[2] ? r : a)[0] : null;
  // Zero-gamma flip: total GEX recomputed with Black-Scholes gamma at nearby prices.
  const live = opts.filter(o => o.oi > 0 && o.iv > 0 && Math.abs(o.K / S - 1) < 0.15);
  const totalAt = s => live.reduce((a, o) => { const sd = o.iv * Math.sqrt(o.T), d1 = (Math.log(s / o.K) + sd * sd / 2) / sd;
    return a + per(normPdf(d1) / (s * sd), o.oi, s) * (o.type === "C" ? 1 : -1); }, 0);
  const grid = []; for (let f = -0.06; f <= 0.0601; f += 0.002) grid.push([S * (1 + f), totalAt(S * (1 + f))]);
  let flip = null;
  for (let i = 1; i < grid.length; i++){ const [x0, y0] = grid[i - 1], [x1, y1] = grid[i];
    if ((y0 <= 0 && y1 > 0) || (y0 >= 0 && y1 < 0)){ const x = x0 + (x1 - x0) * (-y0) / (y1 - y0); if (flip == null || Math.abs(x - S) < Math.abs(flip - S)) flip = x; } }
  const top = rows.map(r => [r[0], r[1] + r[2]]).filter(r => Math.abs(r[0] / S - 1) < 0.04).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4).map(r => r[0]);
  gex = { spot: r2(S), asOf: chain.timestamp || null, total: Math.round(total), flip: flip && r2(flip), callWall, putWall, magnets: top,
          byStrike: rows.filter(r => Math.abs(r[0] / S - 1) <= 0.05).map(r => [r[0], Math.round(r[1]), Math.round(r[2])]),
          curve: grid.map(([x, y]) => [r2(x), Math.round(y)]) };
  // Implied move for each expiration from the at-the-money straddle (PM-settled SPXW only).
  const byExp = new Map();
  for (const o of opts){ if (o.am) continue; (byExp.get(o.exp) || byExp.set(o.exp, []).get(o.exp)).push(o); }
  expirations = [...byExp.keys()].sort().map(exp => {
    const list = byExp.get(exp), ks = [...new Set(list.map(o => o.K))];
    const K = ks.reduce((a, k) => Math.abs(k - S) < Math.abs(a - S) ? k : a, ks[0]);
    const c = list.find(o => o.K === K && o.type === "C"), p = list.find(o => o.K === K && o.type === "P");
    if (!c || !p || !(c.ask > 0) || !(p.ask > 0)) return null;
    const straddle = (c.bid + c.ask) / 2 + (p.bid + p.ask) / 2;
    return { exp, K, straddle: r2(straddle), iv: r2(((c.iv + p.iv) / 2) * 100), T: list[0].T };
  }).filter(Boolean);
}

/* ---------- how big moves really were, relative to what was implied ----------
   z = actual close-to-close log move / move implied by VIX1D (1 day) or VIX9D (2 days) the evening before. */
const dayClose = spxD.filter(b => ny(b.t).date < ny(Date.now() / 1000).date || ny(Date.now() / 1000).mins >= 16 * 60).map(b => ({ d: ny(b.t).date, c: b.c }));   // finished sessions only
const volBy = bars => new Map(bars.map(b => [ny(b.t).date, b.c]));
const v1 = volBy(vix1dD), v9 = volBy(vix9dD), vx = volBy(vixD);
function zScores(days, volMap, fallback){
  const z = [];
  for (let i = 1; i + days - 1 < dayClose.length; i++){
    const prev = dayClose[i - 1], end = dayClose[i + days - 1], iv = volMap.get(prev.d) ?? fallback.get(prev.d);
    if (!iv) continue;
    z.push(Math.abs(Math.log(end.c / prev.c)) / (iv / 100 * Math.sqrt(days / 252)));
  }
  return z.slice(-500);       // about two years
}
const z1 = zScores(1, v1, vx), z2 = zScores(2, v9, vx);
const calib = z => z.length < 60 ? null : { n: z.length, k68: r2(quantile(z, 0.68)), k90: r2(quantile(z, 0.90)), within1: r2(z.filter(x => x <= 1).length / z.length * 100) };
const cal1 = calib(z1), cal2 = calib(z2);

/* ---------- news & scheduled events: what history says about each kind of day ----------
   events.json (update-events.mjs): FOMC decisions and minutes, CPI, jobs report, PPI, PCE, GDP, option expirations,
   holidays and early closes. For every finished SPX day of the last ~3 years: z = |close-to-close move| / the move
   VIX1D (VIX before 2023) priced the evening before, and the day's high-low range in the same units. Each event type
   is compared with all days; the ratio of their 68%/90% points says how much wider or narrower that kind of day runs
   than the options priced it. Fitted on the older days and checked on the most recent year it didn't see. */
let EV = [];
for (const f of [process.env.EVENTS_FILE || "events.json", "prev/events.json"]){ try { EV = JSON.parse(readFileSync(f, "utf8")).events || []; if (EV.length) break; } catch {} }
const evOn = new Map(); EV.forEach(e => (evOn.get(e.d) || evOn.set(e.d, []).get(e.d)).push(e));
const STUDY = ["FOMC", "MINUTES", "CPI", "NFP", "PPI", "PCE", "GDP", "QUAD", "OPEX", "VIXEXP", "EARLY"];
const NAMES = {FOMC: "FOMC decision", MINUTES: "FOMC minutes", CPI: "CPI", NFP: "Jobs report", PPI: "PPI", PCE: "PCE", GDP: "GDP", QUAD: "Quad witching", OPEX: "Monthly opex", VIXEXP: "VIX expiration", EARLY: "Early close"};
const days = (() => {
  const fin = spxD.filter(b => ny(b.t).date < ny(nowSec).date || ny(nowSec).mins >= 16 * 60), out = [];
  for (let i = 1; i < fin.length; i++){
    const p = fin[i - 1], b = fin[i], pd = ny(p.t).date, d = ny(b.t).date, iv = v1.get(pd) ?? vx.get(pd); if (!iv) continue;
    const unit = p.c * iv / 100 / Math.sqrt(252);
    out.push({ d, z: Math.abs(b.c - p.c) / unit, rz: (b.h - b.l) / unit, pts: b.c - p.c, rng: b.h - b.l, types: (evOn.get(d) || []).map(e => e.type) });
  }
  return out.slice(-750);
})();
function evStats(rows, base){
  if (rows.length < 4) return null;
  const zs = rows.map(r => r.z), k68 = quantile(zs, 0.68), k90 = quantile(zs, 0.90);
  return { n: rows.length, k68: r2(k68), k90: r2(k90), r68: base ? r2(k68 / base.k68) : 1, r90: base ? r2(k90 / base.k90) : 1,
           avgMove: r2(mean(rows.map(r => Math.abs(r.pts)))), avgRange: r2(mean(rows.map(r => r.rng))), rangeX: base ? r2(median(rows.map(r => r.rz)) / base.medRz) : 1,
           medRz: median(rows.map(r => r.rz)), up: Math.round(rows.filter(r => r.pts > 0).length / rows.length * 100),
           avgSigned: r2(mean(rows.map(r => r.pts))), inside68: base ? Math.round(rows.filter(r => r.z <= base.k68).length / rows.length * 100) : null };
}
const allStats = evStats(days, null), quiet = evStats(days.filter(r => !r.types.some(t => STUDY.includes(t) && t !== "VIXEXP" && t !== "OPEX")), allStats);
const study = {};
for (const t of STUDY){ const st = evStats(days.filter(r => r.types.includes(t)), allStats); if (st) study[t] = { name: NAMES[t], ...st, f68: r2(clampR(shrink(st.r68, st.n))), f90: r2(clampR(shrink(st.r90, st.n))) }; }
// Out-of-sample check: fit each ratio on the older days, apply it to the most recent ~250 days.
const cut = days.length - 250, older = days.slice(0, Math.max(0, cut)), newer = days.slice(Math.max(0, cut));
const oldAll = evStats(older, null), newAll = evStats(newer, null);
for (const t of Object.keys(study)){
  const o = evStats(older.filter(r => r.types.includes(t)), oldAll), test = newer.filter(r => r.types.includes(t));
  if (!o || o.n < 6 || test.length < 3 || !oldAll) continue;
  const kPlain = oldAll.k68, kAdj = oldAll.k68 * clampR(shrink(o.r68, o.n));
  study[t].test = { n: test.length, plain68: Math.round(test.filter(r => r.z <= kPlain).length / test.length * 100), adj68: Math.round(test.filter(r => r.z <= kAdj).length / test.length * 100) };
}
if (quiet && oldAll){
  const qo = evStats(older.filter(r => !r.types.some(t => STUDY.includes(t) && t !== "VIXEXP" && t !== "OPEX")), oldAll), qt = newer.filter(r => !r.types.some(t => STUDY.includes(t) && t !== "VIXEXP" && t !== "OPEX"));
  if (qo && qt.length >= 10) quiet.test = { n: qt.length, plain68: Math.round(qt.filter(r => r.z <= oldAll.k68).length / qt.length * 100), adj68: Math.round(qt.filter(r => r.z <= oldAll.k68 * clampR(shrink(qo.r68, qo.n))).length / qt.length * 100) };
}
function clampR(r){ return Math.max(0.8, Math.min(1.6, r || 1)); }
// Small samples are noisy: pull each event ratio toward 1 (no change) by how few days back it up.
function shrink(r, n){ return 1 + ((r || 1) - 1) * n / (n + 30); }
// Width factor for a target day: the strongest event type with enough history (8+ days), else the quiet-day factor.
function eventFactor(dates){
  const evs = dates.flatMap(d => (evOn.get(d) || []).filter(e => e.type !== "HOLIDAY").map(e => ({ ...e, on: d })));
  let f68 = quiet && quiet.n >= 30 ? clampR(shrink(quiet.r68, quiet.n)) : 1, f90 = quiet && quiet.n >= 30 ? clampR(shrink(quiet.r90, quiet.n)) : 1, why = evs.length ? null : "quiet day (no scheduled news)";
  for (const e of evs){ const st = study[e.type]; if (!st || st.n < 8) continue;
    const g68 = clampR(shrink(st.r68, st.n)), g90 = clampR(shrink(st.r90, st.n));
    if (why == null || g68 > f68){ f68 = g68; f90 = g90; why = `${st.name} days`; } }
  if (why == null) { f68 = 1; f90 = 1; why = "scheduled events with too little history to adjust"; }
  if (dates.length > 1){ f68 = Math.sqrt((f68 * f68 + 1) / 2); f90 = Math.sqrt((f90 * f90 + 1) / 2); }   // one of two days carries the event
  return { f68: r2(f68), f90: r2(f90), why, events: evs.map(e => ({ d: e.on, type: e.type, time: e.time, label: e.label })) };
}

/* ---------- prediction log: every 1DTE/2DTE range is kept and scored against the actual SPX close ----------
   A prediction keeps updating until it locks: 1DTE at the target day's 9:30 am open, 2DTE at the open of
   the day before. Once the target day closes, it's scored. The scores tune the model below. */
const PRED_FILE = process.env.PRED_FILE || "predictions.json";
let records = [];
try { records = JSON.parse(readFileSync(PRED_FILE, "utf8")).records || []; } catch { console.log("No earlier predictions found; starting a new log."); }
const nyNow = ny(nowSec);
const finished = new Map(spxD.filter(b => ny(b.t).date < nyNow.date || nyNow.mins >= 16 * 60 + 15).map(b => [ny(b.t).date, b]));
for (const r of records){
  if (r.actual || !finished.has(r.target)) continue;
  const b = finished.get(r.target);
  r.actual = { c: r2(b.c), h: r2(b.h), l: r2(b.l) };
  r.err = r2(b.c - r.center); r.errRaw = r2(b.c - r.spotAt);
  r.in68 = b.c >= r.r68[0] && b.c <= r.r68[1]; r.in90 = b.c >= r.r90[0] && b.c <= r.r90[1];
}
// Random-walk baseline from history: how far SPX closed from the previous close (or two closes back).
const baseline = days => r2(mean(dayClose.slice(-251).slice(days).map((d, i) => Math.abs(d.c - dayClose.slice(-251)[i].c))));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function fitModel(h){
  const hist = h === 1 ? cal1 : cal2, rs = records.filter(r => r.h === h && r.actual).slice(-60), n = rs.length;
  let w = 0, b = 0, k68 = hist ? hist.k68 : 1, k90 = hist ? hist.k90 : 1.645;
  if (n >= 8){
    // How much of the gap to the biggest gamma strike the close actually closed (least squares), then any leftover bias.
    const errs = rs.map(r => r.actual.c - r.spotAt), pulls = rs.map(r => r.pull || 0), spp = pulls.reduce((a, p) => a + p * p, 0);
    if (spp > 0) w = clamp(pulls.reduce((a, p, i) => a + p * errs[i], 0) / spp, 0, 0.7);
    b = clamp(mean(errs.map((e, i) => e - w * pulls[i])) * n / (n + 20), -15, 15);
  }
  if (n >= 15){        // widths: blend history's calibration with our own record as it grows
    const zs = rs.map(r => Math.abs(r.actual.c - r.center) / r.sigma), a = n / (n + 40);
    k68 = (1 - a) * k68 + a * quantile(zs, 0.68); k90 = (1 - a) * k90 + a * quantile(zs, 0.90);
  }
  return { h, n, w: r2(w), b: r2(b), k68: r2(k68), k90: r2(k90),
           mae: n ? r2(mean(rs.map(r => Math.abs(r.err)))) : null, maeRaw: n ? r2(mean(rs.map(r => Math.abs(r.errRaw)))) : null,
           hit68: n ? Math.round(rs.filter(r => r.in68).length / n * 100) : null, hit90: n ? Math.round(rs.filter(r => r.in90).length / n * 100) : null,
           baseline: baseline(h) };
}
const models = [fitModel(1), fitModel(2)];

/* ---------- ranges for the next two expirations after today ---------- */
const future = expirations.filter(e => e.exp > nyNow.date);
const atrDaily = (() => { const b = spxD.slice(-15); let s = 0; for (let i = 1; i < b.length; i++) s += Math.max(b[i].h - b[i].l, Math.abs(b[i].h - b[i - 1].c), Math.abs(b[i].l - b[i - 1].c)); return r2(s / (b.length - 1)); })();
const ranges = [future[0], future[1]].map((e, i) => {
  if (!e) return null;
  const ev = eventFactor(i === 0 ? [e.exp] : [future[0].exp, e.exp]);
  const m = { ...models[i], k68: r2(models[i].k68 * ev.f68), k90: r2(models[i].k90 * ev.f90) }, sigma = e.straddle * Math.sqrt(Math.PI / 2);   // an at-the-money straddle is about 0.8 sigma
  // In positive gamma, dealer hedging tends to pull price toward the biggest gamma strike nearby ("pin").
  const near = gex && gex.total > 0 ? gex.byStrike.filter(r => Math.abs(r[0] - spot) <= sigma).sort((a, b) => Math.abs(b[1] + b[2]) - Math.abs(a[1] + a[2]))[0] : null;
  const magnet = near ? near[0] : null, pull = magnet != null ? magnet - spot : 0;
  const center = spot + m.w * pull + m.b;
  return { label: `${i + 1}DTE`, h: i + 1, exp: e.exp, spot: r2(spot), center: r2(center), magnet, pull: r2(pull), straddle: e.straddle, atmIv: e.iv, sigma: r2(sigma),
           r68: [r2(center - m.k68 * sigma), r2(center + m.k68 * sigma)], r90: [r2(center - m.k90 * sigma), r2(center + m.k90 * sigma)],
           k68: m.k68, k90: m.k90, within1: (i === 0 ? cal1 : cal2)?.within1 ?? null, events: ev.events, evF: ev.f68, evWhy: ev.why };
}).filter(Boolean);
// Save or update the open predictions (locked ones are left as they were).
for (const r of ranges){
  const lockAt = atNY(r.h === 1 ? r.exp : future[0].exp, 9 * 60 + 30);
  if (nowSec >= lockAt) continue;
  const id = `${r.exp}|${r.h}`, rec = { id, h: r.h, target: r.exp, made: new Date().toISOString(), lockAt: new Date(lockAt * 1000).toISOString(),
    spotAt: r.spot, center: r.center, magnet: r.magnet, pull: r.pull, sigma: r.sigma, r68: r.r68, r90: r.r90, events: r.events.map(e => e.type), evF: r.evF, model: { w: models[r.h - 1].w, b: models[r.h - 1].b } };
  const i = records.findIndex(x => x.id === id);
  if (i >= 0 && !records[i].actual) records[i] = rec; else if (i < 0) records.push(rec);
}
records.sort((a, b) => a.target.localeCompare(b.target) || a.h - b.h);
records = records.slice(-400);
writeFileSync("predictions.json", JSON.stringify({ updated: new Date().toISOString(), records }));

/* ---------- support & resistance (SPX points) ---------- */
function swings(bars, k, weight, tf){
  const out = [];
  for (let i = k; i < bars.length - k; i++){
    let hi = true, lo = true;
    for (let j = 1; j <= k; j++){ if (bars[i - j].h >= bars[i].h || bars[i + j].h > bars[i].h) hi = false; if (bars[i - j].l <= bars[i].l || bars[i + j].l < bars[i].l) lo = false; }
    if (hi) out.push({ p: bars[i].h, w: weight, t: bars[i].t, tf, kind: "high" });
    if (lo) out.push({ p: bars[i].l, w: weight, t: bars[i].t, tf, kind: "low" });
  }
  return out;
}
const since = days => nowSec - days * 864e2;
const cands = [...swings(a60.filter(b => b.t > since(30)), 3, 1, "1h"), ...swings(a4h.filter(b => b.t > since(120)), 2, 2, "4h"), ...swings(aD.filter(b => b.t > since(365)), 2, 3, "D")];
const tol = spot * 0.0012;
cands.sort((a, b) => a.p - b.p);
const clusters = [];
for (const c of cands){         // a cluster spans at most 2 x tol, so dense areas don't chain into one level
  const last = clusters[clusters.length - 1];
  if (last && c.p - last.min <= 2 * tol) last.items.push(c); else clusters.push({ items: [c], min: c.p });
}
// Rejections in the last 60 days of 1-hour bars: price poked through the level and closed back on the side it
// came from. Bars within 4 hours of the previous rejection count as the same episode.
const recent = a60.filter(b => b.t > since(60));
const swingLevels = clusters.map(cl => {
  const w = cl.items.reduce((a, c) => a + c.w * (1 + Math.max(0, 1 - (nowSec - c.t) / (90 * 864e2))), 0);
  const p = cl.items.reduce((a, c) => a + c.p * c.w, 0) / cl.items.reduce((a, c) => a + c.w, 0);
  let touches = 0, lastI = -99;
  recent.forEach((b, i) => {
    const held = (b.o > p && b.l <= p + tol && b.c > p + tol) || (b.o < p && b.h >= p - tol && b.c < p - tol);
    if (held && i - lastI >= 4){ touches++; lastI = i; }
  });
  return { p: r2(p), score: r2(w + Math.min(touches, 12) * 0.5), touches, tfs: [...new Set(cl.items.map(c => c.tf))], kind: "swing" };
}).filter(l => Math.abs(l.p / spot - 1) < 0.04);
const pickSide = (side) => swingLevels.filter(l => side > 0 ? l.p > spot : l.p < spot).sort((a, b) => b.score - a.score).slice(0, 6);

// Reference levels from the last full SPX session, today's session so far and the overnight ES session.
const rth = spxD.filter(b => ny(b.t).date < nyNow.date || nyNow.mins >= 16 * 60);
const prev = rth[rth.length - 1], prev2 = rth[rth.length - 2];
const P = prev ? (prev.h + prev.l + prev.c) / 3 : null;
const curSession = a15.filter(b => b.d === sessionDate(nowSec));
const overnight = curSession.filter(b => { const t = ny(b.t); return t.h >= 18 || t.mins < 9 * 60 + 30; });
const refs = [];
const ref = (p, name, group) => { if (p != null && isFinite(p)) refs.push({ p: r2(p), name, group }); };
if (prev){ ref(prev.h, `Prior day high (${ny(prev.t).date.slice(5)})`, "day"); ref(prev.l, "Prior day low", "day"); ref(prev.c, "Prior day close", "day");
  ref(P, "Pivot", "pivot"); ref(2 * P - prev.l, "R1", "pivot"); ref(2 * P - prev.h, "S1", "pivot"); ref(P + (prev.h - prev.l), "R2", "pivot"); ref(P - (prev.h - prev.l), "S2", "pivot"); }
if (overnight.length){ ref(Math.max(...overnight.map(b => b.h)), "Overnight high", "overnight"); ref(Math.min(...overnight.map(b => b.l)), "Overnight low", "overnight"); }
if (gex){ ref(gex.callWall, "Call wall (GEX)", "gex"); ref(gex.putWall, "Put wall (GEX)", "gex"); ref(gex.flip, "Gamma flip", "gex"); }

const out = {
  updated: new Date().toISOString(),
  note: "Delayed data (Yahoo Finance, CBOE). ES converted to SPX points by subtracting each day's ES minus SPX spread at the 4:00 pm close.",
  es: { last: r2(esLast.c), t: esLast.t }, spot: r2(spot),
  basis: { now: r2(basisNow), live: liveDiffs.length >= 2, history: basisDays.slice(-90).map(d => [d, r2(basisByDay.get(d))]) },
  vix: { vix: vixD.at(-1)?.c ?? null, vix1d: vix1dD.at(-1)?.c ?? null, vix9d: vix9dD.at(-1)?.c ?? null },
  bars: { "15m": pack(lastSession(12)(a15)), "1h": pack(a60.filter(b => b.t > since(75))), "2h": pack(a2h.filter(b => b.t > since(150))),
          "4h": pack(a4h.filter(b => b.t > since(300))), "1d": pack(aD.filter(b => b.t > since(730))) },
  spxDaily: spxD.slice(-260).map(b => [ny(b.t).date, r2(b.o), r2(b.h), r2(b.l), r2(b.c)]),
  atr14: atrDaily, gex, expirations: expirations.slice(0, 6).map(({ T, ...e }) => e), ranges, calibration: { oneDay: cal1, twoDay: cal2 },
  predictions: { models, recent: records.slice(-60) },
  events: { upcoming: EV.filter(e => e.d > nyNow.date || (e.d === nyNow.date && nyNow.mins < 16 * 60)).slice(0, 40),
            study: { all: allStats && { n: allStats.n, k68: allStats.k68, k90: allStats.k90, avgMove: allStats.avgMove, avgRange: allStats.avgRange }, quiet, types: study } },
  levels: { resistance: pickSide(1), support: pickSide(-1), refs },
};
writeFileSync("market.json", JSON.stringify(out));
console.log(`market.json: spot ${out.spot}, ES ${out.es.last}, basis ${out.basis.now}, ranges ${JSON.stringify(ranges.map(r => [r.label, r.r68]))}, GEX flip ${gex?.flip}`);
