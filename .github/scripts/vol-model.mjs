// Range model for the 1DTE/2DTE SPX predictions, shared by update-market.mjs (live) and backtest-model.mjs (checks).
//
// Everything is measured in "implied units": the move the options market priced at the moment the prediction locks
// (I = price × implied vol × √(days/252)). A ridge regression learns, from the past, when the real move tends to run
// bigger or smaller than priced (recent realized volatility at three horizons, the VIX term structure, the VIX level,
// the overnight gap, yesterday's drop, scheduled news). The 68%/84% ranges are then the matching quantiles of past
// |move| / predicted scale. Pure functions only: no network, no files.

export const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
export const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); if (!s.length) return null; const i = (s.length - 1) * q, lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const LN2x4 = 4 * Math.log(2);

/* Third Friday of the month (monthly option expiration). */
export function isOpex(iso){ const d = new Date(iso + "T12:00:00Z"); return d.getUTCDay() === 5 && d.getUTCDate() >= 15 && d.getUTCDate() <= 21; }

/* Event flags for a day from events.json entries (types: FOMC, MINUTES, CPI, NFP, PPI, ...). */
export const EVENT_KEYS = ["FOMC", "CPI", "NFP", "PPI", "MINUTES"];

/* Feature names, in order. Kept short; the app shows them as "what moved the range today". */
export const FEATURES = ["rv1", "rv5", "rv22", "term", "vix", "gap", "down", "FOMC", "CPI", "NFP", "PPI", "MINUTES", "opex", "mon"];

/*
  days: [{d, o, h, l, c}] SPX regular-session bars, oldest first (finished days, plus optionally today's open).
  vol:  {vix1d: Map(date → {o, c}), vix9d: Map, vix: Map}
  evOn: Map(date → [types])
  h: 1 (lock at the target day's open, move = close − open)
     2 (lock at the open of the day before, move = target close − that open)
  Returns one row per target day with features x, implied unit I, and (when known) the outcome.
*/
export function buildRows(days, vol, evOn, h, opts = {}){
  const src = opts.src || (h === 1 ? "vix1d" : "vix9d");
  const pk = days.map(b => b.h > 0 && b.l > 0 ? Math.log(b.h / b.l) ** 2 / LN2x4 : null);
  const rows = [];
  for (let t = 23; t < days.length; t++){
    const L = t - (h - 1);                      // the lock day (its open is the reference price)
    if (L < 23) continue;
    const lock = days[L], prev = days[L - 1], tgt = days[t];
    const iv = ivAt(vol, src, lock.d, prev.d);
    if (!iv || !(lock.o > 0)) continue;
    const ivd = iv / 100 / Math.sqrt(252);       // one day of implied vol, as a fraction
    const I = lock.o * ivd * Math.sqrt(h === 1 ? 1 : 2);
    const rv = n => { const s = pk.slice(L - n, L).filter(v => v != null); return s.length ? Math.sqrt(mean(s)) : null; };
    const r1 = rv(1), r5 = rv(5), r22 = rv(22); if (!r1 || !r5 || !r22) continue;
    const pre = src.endsWith("Prev"), v9 = num(pre ? vol.vix9d.get(prev.d)?.c : vol.vix9d.get(lock.d)?.o ?? vol.vix9d.get(prev.d)?.c), vx = num(pre ? vol.vix.get(prev.d)?.c : vol.vix.get(lock.d)?.o ?? vol.vix.get(prev.d)?.c);
    if (!v9 || !vx) continue;
    const span = h === 1 ? [tgt.d] : [days[L].d, tgt.d];
    const ev = k => span.some(d => (evOn.get(d) || []).includes(k)) ? 1 : 0;
    const retPrev = Math.log(prev.c / prev.o);      // yesterday open → close, as a fraction
    const gap = Math.log(lock.o / prev.c);
    const x = [
      Math.log(Math.max(r1, ivd * 0.05) / ivd), Math.log(r5 / ivd), Math.log(r22 / ivd),
      Math.log(v9 / vx), Math.log(vx / 20),
      Math.abs(gap) / ivd, Math.max(0, -Math.log(prev.c / days[L - 2].c)) / ivd,
      ...EVENT_KEYS.map(ev), span.some(isOpex) ? 1 : 0, new Date(lock.d + "T12:00:00Z").getUTCDay() === 1 ? 1 : 0,
    ];
    const row = { d: tgt.d, lock: lock.d, ref: lock.o, I, ivd, x, gapSigned: gap / ivd, retPrev: retPrev / ivd,
                  r5s: Math.log(prev.c / days[L - 6].c) / ivd };
    if (tgt.c > 0 && t < days.length && !tgt.open){
      const hi = Math.max(...days.slice(L, t + 1).map(b => b.h)), lo = Math.min(...days.slice(L, t + 1).map(b => b.l));
      Object.assign(row, { move: tgt.c - lock.o, up: hi - lock.o, dn: lock.o - lo, range: hi - lo });
    }
    rows.push(row);
  }
  return rows;
}
const num = v => v != null && isFinite(v) && v > 0 ? +v : null;
function ivAt(vol, src, lockD, prevD){
  // "…Prev": only the previous close is known (a prediction locked before the 9:30 open)
  const prevOnly = src.endsWith("Prev"), m = vol[prevOnly ? src.slice(0, -4) : src]; if (!m) return null;
  return prevOnly ? num(m.get(prevD)?.c) : num(m.get(lockD)?.o) ?? num(m.get(prevD)?.c);
}

/* Ridge regression with standardized features. Returns {beta, mu, sd, b0, predict(x)}. */
export function ridge(X, y, lambda){
  const n = X.length, p = X[0].length;
  const mu = Array(p).fill(0), sd = Array(p).fill(0);
  X.forEach(r => r.forEach((v, j) => mu[j] += v / n));
  X.forEach(r => r.forEach((v, j) => sd[j] += (v - mu[j]) ** 2 / n));
  for (let j = 0; j < p; j++) sd[j] = Math.sqrt(sd[j]) || 1;
  const Z = X.map(r => r.map((v, j) => (v - mu[j]) / sd[j])), ym = mean(y);
  const A = Array.from({length: p}, (_, i) => Array.from({length: p}, (_, j) => (i === j ? lambda : 0)));
  const bv = Array(p).fill(0);
  Z.forEach((r, k) => { for (let i = 0; i < p; i++){ bv[i] += r[i] * (y[k] - ym); for (let j = 0; j < p; j++) A[i][j] += r[i] * r[j]; } });
  const beta = solve(A, bv);
  const predict = x => ym + x.reduce((a, v, j) => a + beta[j] * (v - mu[j]) / sd[j], 0);
  return { beta, mu, sd, b0: ym, predict };
}
function solve(A, b){
  const n = b.length, M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++){
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++){ if (r === c) continue; const f = M[r][c] / d; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

/*
  Fit on rows with outcomes. Scale: log(range / I) on the features (the day's high-low range is a far less noisy
  read of how volatile the window was than the close alone). Width: quantiles of |move| / predicted scale over the
  most recent `calN` rows. Returns a model {scale(x), k68, k84, kUp, kDn} usable on any row.
*/
export function fitScale(train, { lambda = 25, calN = 500, use = null } = {}){
  const pick = x => use ? use.map(j => x[j]) : x;
  const ok = train.filter(r => r.range > 0);
  const m = ridge(ok.map(r => pick(r.x)), ok.map(r => Math.log(r.range / r.I)), lambda);
  const scale = x => Math.exp(m.predict(pick(x)));
  const cal = ok.slice(-calN), z = cal.map(r => Math.abs(r.move) / (r.I * scale(r.x)));
  const up = cal.map(r => r.up / (r.I * scale(r.x))), dn = cal.map(r => r.dn / (r.I * scale(r.x)));
  return { scale, beta: m.beta, sd: m.sd, k68: quantile(z, 0.68), k84: quantile(z, 0.84),
           up68: quantile(up, 0.68), up84: quantile(up, 0.84), dn68: quantile(dn, 0.68), dn84: quantile(dn, 0.84), n: ok.length };
}

/* The old way, for comparison: no features, just quantiles of |move| / implied over the recent rows. */
export function fitPlain(train, { calN = 500 } = {}){
  const cal = train.filter(r => r.range > 0).slice(-calN), z = cal.map(r => Math.abs(r.move) / r.I);
  return { scale: () => 1, k68: quantile(z, 0.68), k84: quantile(z, 0.84),
           up68: quantile(cal.map(r => r.up / r.I), 0.68), up84: quantile(cal.map(r => r.up / r.I), 0.84),
           dn68: quantile(cal.map(r => r.dn / r.I), 0.68), dn84: quantile(cal.map(r => r.dn / r.I), 0.84), n: cal.length };
}

/* Center: ridge on (close − reference) / I using the overnight gap, yesterday's move and the last week's move.
   Heavily shrunk; only worth using if it beats "no change" out of sample (the backtest reports this). */
export function fitCenter(train, { lambda = 200 } = {}){
  const ok = train.filter(r => r.move != null);
  const f = r => [r.gapSigned, r.retPrev, r.r5s];
  const m = ridge(ok.map(f), ok.map(r => r.move / r.I), lambda);
  return { shift: r => m.predict(f(r)) * r.I, beta: m.beta };
}

/* Walk-forward: refit every `every` rows on everything before, predict the next block. */
export function walkForward(rows, fit, { start = 500, every = 21 } = {}){
  const out = []; let model = null;
  for (let i = start; i < rows.length; i++){
    if (!model || (i - start) % every === 0) model = fit(rows.slice(0, i));
    out.push({ r: rows[i], m: model });
  }
  return out;
}

/* Scores for a set of out-of-sample predictions: coverage, average full width (points), interval score. */
export function score(preds, centerOf = () => 0){
  const res = { n: preds.length };
  for (const [name, a] of [["68", 0.32], ["84", 0.16]]){
    let hit = 0, wsum = 0, is = 0, uh = 0, dh = 0;
    for (const { r, m } of preds){
      const s = r.I * m.scale(r.x), k = m["k" + name], c = centerOf(r, m);
      const lo = c - k * s, hi = c + k * s, w = hi - lo; wsum += w;
      const inside = r.move >= lo && r.move <= hi; if (inside) hit++;
      is += w + (2 / a) * (r.move < lo ? lo - r.move : r.move > hi ? r.move - hi : 0);
      if (r.up <= m["up" + name] * s) uh++; if (r.dn <= m["dn" + name] * s) dh++;
    }
    Object.assign(res, { ["cov" + name]: +(hit / preds.length * 100).toFixed(1), ["width" + name]: +(wsum / preds.length).toFixed(1),
                         ["is" + name]: +(is / preds.length).toFixed(1), ["upHold" + name]: +(uh / preds.length * 100).toFixed(1), ["dnHold" + name]: +(dh / preds.length * 100).toFixed(1) });
  }
  return res;
}
