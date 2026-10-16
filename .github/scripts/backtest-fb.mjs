// Research: the Failed Breakdown setup (as Adam Mancini describes it publicly), coded as rules and tested on ES futures.
//   1. Significant low: a swing low (lowest bar with k bars on each side), confirmed before the setup, within the lookback.
//   2. Flush: price trades below it by at least a quarter of the average bar range (ATR) but not more than 3 ATR.
//   3. Reclaim: within 10 bars of the flush, a bar closes back above the low + a small buffer (acceptance). Long at that close.
//   4. Stop below the flush low. Targets: the next swing highs above (level to level), or 1R/2R if none.
//      75% off at the first target, runner to the second with its stop moved to entry; time limit about two sessions.
// Compared against the same trade (same stop and target distances) entered at random bars, so ES's upward drift and
// the target spacing can't pass for an edge. Writes fb-check.json.
import { writeFileSync } from "node:fs";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger research)" } };
async function chart(sym, interval, range){
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=${range}&interval=${interval}&includePrePost=true`;
  for (let a = 0; a < 3; a++){
    try { const x = (await (await fetch(url, UA)).json()).chart.result[0], q = x.indicators.quote[0];
      return x.timestamp.map((t, i) => ({ t, o: q.open[i], h: q.high[i], l: q.low[i], c: q.close[i] })).filter(b => [b.o, b.h, b.l, b.c].every(v => v != null && isFinite(v) && v > 0)); }
    catch (e) { if (a === 2){ console.error(sym, e.message); return []; } await new Promise(r => setTimeout(r, 2500)); }
  }
}
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const r2 = v => Math.round(v * 100) / 100;
const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const nyMins = t => { const [h, m] = fmt.format(new Date(t * 1000)).split(":").map(Number); return (h % 24) * 60 + m; };
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

function atrSeries(B, n = 14){ const out = []; let a = null; B.forEach((b, i) => { const tr = i ? Math.max(b.h - b.l, Math.abs(b.h - B[i - 1].c), Math.abs(b.l - B[i - 1].c)) : b.h - b.l; a = a == null ? tr : a + (tr - a) / n; out.push(a); }); return out; }
// Swing lows/highs with k bars on each side; on equal lows/highs (ES moves in 0.25 ticks) the first one counts.
function pivots(B, k){ const lows = [], highs = []; for (let i = k; i < B.length - k; i++){ let lo = true, hi = true; for (let j = i - k; j <= i + k; j++){ if (j === i) continue; if (j < i ? B[j].l <= B[i].l : B[j].l < B[i].l) lo = false; if (j < i ? B[j].h >= B[i].h : B[j].h > B[i].h) hi = false; } if (lo) lows.push({ i, p: B[i].l, conf: i + k }); if (hi) highs.push({ i, p: B[i].h, conf: i + k }); } return { lows, highs }; }

// one trade: returns P&L in R and points, and whether the first target came before the stop
function simulate(B, s, entry, stop, t1, t2, horizon){
  const R = entry - stop; let runnerStop = stop, got1 = false, pnl = 0, done = false, end = Math.min(B.length - 1, s + horizon);
  for (let j = s + 1; j <= end && !done; j++){
    const b = B[j];
    if (!got1){
      if (b.l <= stop){ pnl = -R; done = true; break; }          // stop first when both are inside one bar (conservative)
      if (b.h >= t1){ got1 = true; pnl += 0.75 * (t1 - entry); runnerStop = entry; if (b.h >= t2){ pnl += 0.25 * (t2 - entry); done = true; } continue; }
    } else {
      if (b.l <= runnerStop){ done = true; break; }              // runner out at breakeven
      if (b.h >= t2){ pnl += 0.25 * (t2 - entry); done = true; break; }
    }
  }
  if (!done){ const last = B[end].c; pnl = got1 ? pnl + 0.25 * (last - entry) : last - entry; }
  return { got1, pts: pnl, R: pnl / R };
}

function study(B, { k, lookback, maxBars, horizon, label, strict }){
  const atr = atrSeries(B), { lows, highs } = pivots(B, k), sig = [];
  const state = new Map();   // pivot index → { flushAt, flushLow } while a flush is in progress
  let lastSig = -99;
  for (let t = 50; t < B.length - 2; t++){
    const A = atr[t - 1], b = B[t];
    for (const L of lows){
      if (L.conf >= t || t - L.i > lookback || L.used) continue;
      const st = state.get(L.i);
      if (!st){
        if (b.l < L.p - 0.25 * A){
          if (strict){
            // "big previously set low": the level held at least one more test after it formed
            let touches = 0; for (let j = L.i + 1; j < t; j++) if (Math.abs(B[j].l - L.p) <= 0.3 * A) touches++;
            // "elevator down": a fast drop of at least 2.5 ATR over the last 6 bars into the flush
            const hiBefore = Math.max(...B.slice(Math.max(0, t - 6), t + 1).map(x => x.h));
            if (touches < 1 || hiBefore - b.l < 2.5 * A){ L.used = true; continue; }
          }
          state.set(L.i, { at: t, low: b.l });
        }
        continue;
      }
      st.low = Math.min(st.low, b.l);
      if (st.low < L.p - 3 * A || t - st.at > maxBars){ L.used = true; continue; }         // a real breakdown, not a trap
      if (b.c > L.p + 0.1 * A && t - lastSig > 4){
        L.used = true; lastSig = t;
        const entry = b.c, stop = st.low - 0.1 * A, R = entry - stop;
        const above = highs.filter(h => h.conf <= t && h.p > entry + 0.5 * A && t - h.i <= lookback * 2).map(h => h.p).sort((x, y) => x - y);
        const t1 = above[0] ?? entry + R, t2 = above.find(p => p > t1 + 0.5 * A) ?? Math.max(t1 + R, entry + 2 * R);
        const m = nyMins(b.t), rth = m >= 570 && m < 960;
        const volRatio = mean(atr.slice(Math.max(0, t - 30), t)) / (mean(atr.slice(Math.max(0, t - 600), t)) || 1);
        sig.push({ t: b.t, i: t, level: r2(L.p), entry: r2(entry), stop: r2(stop), t1: r2(t1), t2: r2(t2), riskPts: r2(R), flushAtr: r2((L.p - st.low) / A), rth, volRatio: r2(volRatio),
                   ...simulate(B, t, entry, stop, t1, t2, horizon) });
      }
    }
  }
  // the same trades at random bars: same stop and target distances, same horizon
  const base = [];
  for (const s of sig) for (let r = 0; r < 20; r++){ const j = 50 + Math.floor(rnd() * (B.length - horizon - 60)), e = B[j].c;
    base.push(simulate(B, j, e, e - (s.entry - s.stop), e + (s.t1 - s.entry), e + (s.t2 - s.entry), horizon)); }
  const sum = a => a.length ? { n: a.length, t1Hit: r2(a.filter(x => x.got1).length / a.length * 100), avgR: r2(mean(a.map(x => x.R))), avgPts: r2(mean(a.map(x => x.pts))),
    winRate: r2(a.filter(x => x.pts > 0).length / a.length * 100), profitFactor: r2(a.filter(x => x.pts > 0).reduce((s, x) => s + x.pts, 0) / (Math.abs(a.filter(x => x.pts < 0).reduce((s, x) => s + x.pts, 0)) || 1)) } : null;
  const se = a => { const m = mean(a), v = mean(a.map(x => (x - m) ** 2)); return Math.sqrt(v / (a.length || 1)); };
  const edgeR = mean(sig.map(s => s.R)) - mean(base.map(s => s.R)), tStat = edgeR / Math.sqrt(se(sig.map(s => s.R)) ** 2 + se(base.map(s => s.R)) ** 2 || 1);
  const half = Math.floor(sig.length / 2), hv = sig.filter(s => s.volRatio >= 1.2), lv = sig.filter(s => s.volRatio < 1.2);
  return { label, bars: B.length, from: new Date(B[0].t * 1000).toISOString().slice(0, 10), to: new Date(B.at(-1).t * 1000).toISOString().slice(0, 10),
    signals: sum(sig), randomSameTrade: sum(base), edgeRPerTrade: r2(edgeR), tStat: r2(tStat), medianRiskPts: r2([...sig.map(s => s.riskPts)].sort((a, b) => a - b)[Math.floor(sig.length / 2)] || 0),
    regularHours: sum(sig.filter(s => s.rth)), overnight: sum(sig.filter(s => !s.rth)),
    afterVolSpike: sum(hv), calm: sum(lv), firstHalf: sum(sig.slice(0, half)), secondHalf: sum(sig.slice(half)),
    deepFlush: sum(sig.filter(s => s.flushAtr >= 1)), shallowFlush: sum(sig.filter(s => s.flushAtr < 1)),
    recent: sig.slice(-15).map(s => ({ when: new Date(s.t * 1000).toISOString().slice(0, 16), level: s.level, entry: s.entry, stop: s.stop, t1: s.t1, t2: s.t2, got1: s.got1, pts: r2(s.pts) })) };
}

const [es15, es60] = await Promise.all([chart("ES=F", "15m", "60d"), chart("ES=F", "60m", "730d")]);
console.log(`ES 15m ${es15.length} bars, 60m ${es60.length} bars`);
const out = { made: new Date().toISOString(), runs: [] };
for (const [B, cfgs] of [[es15, [{ label: "15m k=4", k: 4, lookback: 300, maxBars: 10, horizon: 90 }, { label: "15m k=8", k: 8, lookback: 400, maxBars: 10, horizon: 90 },
                                 { label: "15m k=8 STRICT (shelf + elevator down)", k: 8, lookback: 600, maxBars: 10, horizon: 90, strict: true }]],
                         [es60, [{ label: "60m k=3", k: 3, lookback: 120, maxBars: 8, horizon: 46 }, { label: "60m k=6", k: 6, lookback: 200, maxBars: 8, horizon: 46 },
                                 { label: "60m k=3 STRICT (shelf + elevator down)", k: 3, lookback: 200, maxBars: 8, horizon: 46, strict: true },
                                 { label: "60m k=6 STRICT (shelf + elevator down)", k: 6, lookback: 300, maxBars: 8, horizon: 46, strict: true }]]])
  for (const c of cfgs) if (B.length > 300) out.runs.push(study(B, c));
writeFileSync("fb-check.json", JSON.stringify(out, null, 1));
console.log(JSON.stringify(out.runs.map(({ recent, ...r }) => r), null, 1));
