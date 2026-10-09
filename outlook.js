/* SPX outlook: the panel at the top of the dashboard.
   Reads market.json, which the "Update option quotes" GitHub Action builds on the quotes branch:
   ES futures charts converted to SPX points, GEX, support/resistance and 1DTE/2DTE ranges, plus the log
   that scores each day's ranges against the actual close. A study aid built from delayed data, not advice. */
(function(){
  const host = /\.github\.io$/.test(location.hostname) && location.pathname.split("/")[1]
    ? `https://raw.githubusercontent.com/${location.hostname.split(".")[0]}/${location.pathname.split("/")[1]}/quotes/market.json` : "market.json";
  const LS = k => { try { return localStorage.getItem("spread-ledger-outlook-" + k); } catch { return null; } };
  const LSset = (k, v) => { try { localStorage.setItem("spread-ledger-outlook-" + k, v); } catch {} };
  let M = null, tf = LS("tf") || "1h", inES = LS("es") === "1", showDay = LS("day") === "1", zoom = 1, loading = false, failed = false;

  const css = `
#outlook{display:grid;gap:0}
#outlook > details > summary{list-style:none;cursor:pointer;display:flex;gap:10px 16px;align-items:center;flex-wrap:wrap;padding:12px 16px}
#outlook > details > summary::-webkit-details-marker{display:none}
#outlook > details > summary .chev{margin-left:auto;color:var(--muted);font-size:13px;font-weight:600;white-space:nowrap}
#outlook > details[open] > summary .chev .more{display:none}
#outlook > details:not([open]) > summary .chev .less{display:none}
#outlook .ol-sum{display:flex;gap:6px 16px;flex-wrap:wrap;align-items:baseline;font-size:14px;min-width:0}
#outlook .ol-sum b{font-family:var(--mono);font-weight:600}
#outlook .ol-body{display:grid;gap:16px;padding:4px 16px 16px;min-width:0}
#outlook .ol-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:8px;overflow:hidden}
#outlook .ol-stat{background:var(--surface);padding:10px 12px;display:grid;gap:2px;min-width:0}
#outlook .ol-stat .v{font-size:18px;font-weight:700}
#outlook .ol-stat .s{font-size:12px;color:var(--muted)}
#outlook .ol-ranges{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
#outlook .ol-range{border:1px solid var(--line);border-radius:8px;padding:12px 14px;display:grid;gap:6px;min-width:0}
#outlook .ol-range .big{font-family:var(--mono);font-size:18px;font-weight:600}
#outlook .ol-range .row{display:flex;justify-content:space-between;gap:8px;font-size:13px;flex-wrap:wrap}
#outlook .ol-range .row span:last-child{font-family:var(--mono)}
#outlook .ol-ctl{display:flex;gap:8px 12px;align-items:center;flex-wrap:wrap}
#outlook .ol-ctl label{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--muted);cursor:pointer}
#outlook .ol-chart{position:relative;min-width:0}
#outlook .ol-chart svg{width:100%;height:auto;touch-action:pan-y}
#outlook .ol-tip{position:absolute;pointer-events:none;background:var(--surface);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;box-shadow:0 6px 18px rgba(0,0,0,.14);display:grid;gap:2px;min-width:150px;z-index:2}
#outlook .ol-tip .k{display:flex;justify-content:space-between;gap:12px}
#outlook .ol-tip .k b{font-family:var(--mono);font-weight:600;color:var(--ink)}
#outlook .ol-tip .k span{color:var(--muted);display:flex;align-items:center;gap:6px}
#outlook .ol-tip i{display:inline-block;width:12px;height:2px;border-radius:1px}
#outlook .ol-legend{display:flex;gap:6px 14px;flex-wrap:wrap;font-size:12px;color:var(--muted)}
#outlook .ol-legend span{display:flex;align-items:center;gap:6px}
#outlook .ol-legend i{display:inline-block;width:14px;height:2px;border-radius:1px}
#outlook .ol-legend i.box{height:10px;width:10px;border-radius:2px}
#outlook .ol-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}
#outlook h3{font-size:14px;font-weight:700}
#outlook .ol-note{font-size:12px;color:var(--muted)}
#outlook td,#outlook th{padding:7px 8px;font-size:13px}
#outlook td.num{font-family:var(--mono);font-variant-numeric:tabular-nums;white-space:nowrap}
#outlook .tag{font-size:11px;font-weight:700;padding:1px 6px;border-radius:99px;background:var(--sunk);color:var(--muted);white-space:nowrap}
#outlook .ol-err{color:var(--loss);font-size:13px}
.ol-root{--s1:#2a78d6;--s2:#eb6834;--s3:#1baf7a;--s4:#eda100;--pos:#2a78d6;--neg:#e34948;--band:rgba(42,120,214,.13);--band2:rgba(42,120,214,.07)}
@media (prefers-color-scheme: dark){:root:where(:not([data-theme="light"])) .ol-root{--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--pos:#3987e5;--neg:#e66767;--band:rgba(57,135,229,.2);--band2:rgba(57,135,229,.1)}}
:root[data-theme="dark"] .ol-root{--s1:#3987e5;--s2:#d95926;--s3:#199e70;--s4:#c98500;--pos:#3987e5;--neg:#e66767;--band:rgba(57,135,229,.2);--band2:rgba(57,135,229,.1)}
@media (max-width:760px){#outlook .ol-stats{grid-template-columns:repeat(2,minmax(0,1fr))} #outlook .ol-ranges,#outlook .ol-split{grid-template-columns:1fr}}
`;
  const style = document.createElement("style"); style.textContent = css; document.head.appendChild(style);

  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const off = () => inES && M ? M.basis.now : 0;                 // shift every SPX-point value into ES points
  const px = v => v == null || !isFinite(v) ? "—" : (v + off()).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const px0 = v => v == null || !isFinite(v) ? "—" : Math.round(v + off()).toLocaleString("en-US");
  const pts = v => v == null || !isFinite(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1);
  const nyF = new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});
  const nyD = new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", month: "short", day: "numeric", weekday: "short"});
  const nyH = new Intl.DateTimeFormat("en-US", {timeZone: "America/New_York", hour: "numeric", hour12: false});
  const dayLabel = iso => nyD.format(new Date(iso + "T17:00:00Z"));
  const timeLabel = sec => nyF.format(new Date(sec * 1000)) + " ET";
  const sessionOf = sec => { const d = new Date(sec * 1000); const h = +nyH.format(d) % 24; return new Date(d.getTime() + (h >= 18 ? 864e5 : 0)).toLocaleDateString("en-CA", {timeZone: "America/New_York"}); };
  const money = v => (v < 0 ? "−$" : "$") + (Math.abs(v) >= 1e9 ? (Math.abs(v) / 1e9).toFixed(1) + "B" : (Math.abs(v) / 1e6).toFixed(0) + "M");

  /* ---------- indicators ---------- */
  const ema = (xs, n) => { const k = 2 / (n + 1); let e = null; return xs.map(x => (e = e == null ? x : x * k + e * (1 - k))); };
  function rsi(xs, n = 14){
    const out = xs.map(() => null); let g = 0, l = 0;
    for (let i = 1; i < xs.length; i++){
      const d = xs[i] - xs[i - 1], up = Math.max(d, 0), dn = Math.max(-d, 0);
      if (i <= n){ g += up / n; l += dn / n; if (i === n) out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
      else { g = (g * (n - 1) + up) / n; l = (l * (n - 1) + dn) / n; out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l); }
    }
    return out;
  }
  function vwap(bars){       // resets each futures session (6:00 pm New York)
    let s = null, pv = 0, v = 0;
    return bars.map(b => { const d = sessionOf(b[0]); if (d !== s){ s = d; pv = 0; v = 0; } const tp = (b[2] + b[3] + b[4]) / 3; pv += tp * b[5]; v += b[5]; return v > 0 ? pv / v : tp; });
  }

  /* ---------- levels ---------- */
  function levelList(){
    const L = [], lv = M.levels || {};
    (lv.resistance || []).slice(0, 4).forEach(l => L.push({p: l.p, name: "Resistance", kind: "res", detail: `${l.tfs.join("/")} swings · ${l.touches} rejection${l.touches === 1 ? "" : "s"}`, score: l.score}));
    (lv.support || []).slice(0, 4).forEach(l => L.push({p: l.p, name: "Support", kind: "sup", detail: `${l.tfs.join("/")} swings · ${l.touches} rejection${l.touches === 1 ? "" : "s"}`, score: l.score}));
    (lv.refs || []).forEach(r => L.push({p: r.p, name: r.name, kind: r.group, detail: r.group === "gex" ? "options positioning" : r.group === "pivot" ? "from prior day's high, low, close" : r.group === "overnight" ? "ES since 6 pm" : "SPX regular session"}));
    return L.sort((a, b) => b.p - a.p);
  }

  /* ---------- rendering ---------- */
  function mount(){
    const dash = document.getElementById("dash"); if (!dash || document.getElementById("outlook")) return;
    const sec = document.createElement("section");
    sec.className = "panel ol-root"; sec.id = "outlook"; sec.setAttribute("aria-label", "SPX outlook");
    const nav = dash.querySelector(".acctbar");
    nav ? nav.after(sec) : dash.prepend(sec);
    render(); load();
    setInterval(() => { if (document.visibilityState === "visible") load(); }, 10 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && M && Date.now() - Date.parse(M.updated) > 15 * 60 * 1000) load(); });
    window.addEventListener("resize", () => { clearTimeout(mount.rt); mount.rt = setTimeout(() => { if (isOpen()) drawCharts(); }, 150); });
  }
  const isOpen = () => !!document.querySelector("#outlook > details[open]");
  async function load(){
    if (loading) return; loading = true;
    try { const r = await fetch(host, {cache: "no-cache"}); if (!r.ok) throw 0; M = await r.json(); failed = false; }
    catch { failed = !M; }
    loading = false; render();
  }

  function render(){
    const el = document.getElementById("outlook"); if (!el) return;
    const open = LS("open") === "1";
    if (!M){
      el.innerHTML = `<details ${open ? "open" : ""}><summary><span class="label">SPX outlook</span><span class="ol-sum muted">${failed ? "Market data isn't available yet. It appears after the Update option quotes Action has run." : "Loading market data…"}</span><span class="chev"><span class="more">Show</span><span class="less">Hide</span></span></summary></details>`;
      wire(el); return;
    }
    const R = M.ranges || [], g = M.gex, P = M.predictions || {models: [], recent: []};
    const sum = R.map(r => `<span>${esc(r.label)} ${esc(dayLabel(r.exp))} <b>${px0(r.r68[0])}–${px0(r.r68[1])}</b></span>`).join("");
    el.innerHTML = `<details ${open ? "open" : ""}>
      <summary><span class="label">SPX outlook</span>
        <span class="ol-sum"><span>${inES ? "ES" : "SPX"} ≈ <b>${px(M.spot)}</b></span>${sum}<span class="muted">${esc(timeLabel(Date.parse(M.updated) / 1000))}</span></span>
        <span class="chev"><span class="more">Show charts &amp; levels</span><span class="less">Hide</span></span></summary>
      <div class="ol-body">
        <div class="ol-ctl">
          <span class="ol-note">Delayed data. ES is converted to SPX points by subtracting the ES − SPX spread (now ${pts(M.basis.now)}${M.basis.live ? ", live" : ", at the last close"}). For study, not advice.</span>
          <label><input type="checkbox" id="olES" ${inES ? "checked" : ""}> Show prices in ES points</label>
        </div>
        <div class="ol-stats">
          <div class="ol-stat"><span class="label">SPX now (from ES)</span><span class="v">${px(M.spot)}</span><span class="s">ES ${M.es.last.toLocaleString("en-US", {minimumFractionDigits: 2})} · spread ${pts(M.basis.now)}</span></div>
          <div class="ol-stat"><span class="label">VIX · VIX1D</span><span class="v">${M.vix.vix != null ? M.vix.vix.toFixed(2) : "—"}</span><span class="s">1-day ${M.vix.vix1d != null ? M.vix.vix1d.toFixed(2) : "—"} · 9-day ${M.vix.vix9d != null ? M.vix.vix9d.toFixed(2) : "—"}</span></div>
          <div class="ol-stat"><span class="label">Gamma regime</span><span class="v">${g ? (g.total >= 0 ? "Positive" : "Negative") : "—"}</span><span class="s">${g ? `${money(g.total)} per 1% · flip ${px0(g.flip)}` : "no options data"}</span></div>
          <div class="ol-stat"><span class="label">Call wall · Put wall</span><span class="v">${g ? `${px0(g.callWall)} · ${px0(g.putWall)}` : "—"}</span><span class="s">largest call / put gamma strikes</span></div>
          <div class="ol-stat"><span class="label">ATR (14 days)</span><span class="v">${M.atr14 != null ? M.atr14.toFixed(1) : "—"}</span><span class="s">average SPX daily range, points</span></div>
        </div>
        <div class="ol-ranges">${R.map(r => rangeCard(r, (P.models || []).find(m => m.h === r.h))).join("") || `<span class="ol-note">No ranges right now (no upcoming SPX expirations in the data).</span>`}</div>
        <div class="card-head"><h3>ES chart in ${inES ? "ES" : "SPX"} points</h3>
          <div class="ol-ctl">
            <div class="tabs" role="group" aria-label="Chart timeframe">${["15m", "1h", "2h", "4h", "1d"].map(t => `<button type="button" data-oltf="${t}" aria-pressed="${t === tf}">${t === "1d" ? "Daily" : t}</button>`).join("")}</div>
            <div class="tabs" role="group" aria-label="Zoom"><button type="button" data-olzoom="out" aria-label="Show more bars">−</button><button type="button" data-olzoom="in" aria-label="Show fewer bars">+</button></div>
            <label><input type="checkbox" id="olDay" ${showDay ? "checked" : ""}> Day levels &amp; pivots</label>
          </div></div>
        <div class="ol-legend" id="olLegend"></div>
        <div class="ol-chart" id="olChart"></div>
        <div class="ol-split">
          <div style="display:grid;gap:8px;align-content:start;min-width:0"><div class="card-head"><h3>Gamma exposure by strike</h3><span class="ol-note">${g ? esc(g.asOf ? "options as of " + g.asOf.slice(11, 16) + " UTC" : "") : ""}</span></div>
            <div class="ol-legend"><span><i class="box" style="background:var(--pos)"></i>Positive (calls)</span><span><i class="box" style="background:var(--neg)"></i>Negative (puts)</span><span><i style="background:var(--ink)"></i>Spot</span><span><i style="background:var(--muted)"></i>Flip</span></div>
            <div class="ol-chart" id="olGex"></div></div>
          <div style="display:grid;gap:8px;align-content:start;min-width:0"><h3>Key levels</h3>
            <div class="scroll" style="max-height:330px;overflow-y:auto"><table><thead><tr><th class="r">${inES ? "ES" : "SPX"}</th><th>Level</th><th class="r">Away</th></tr></thead><tbody>
            ${levelList().map(l => `<tr><td class="num r">${px(l.p)}</td><td><b>${esc(l.name)}</b><div class="ol-note">${esc(l.detail)}</div></td><td class="num r">${pts(l.p - M.spot)}</td></tr>`).join("")}
            </tbody></table></div></div>
        </div>
        ${trackRecord(P)}
      </div></details>`;
    wire(el);
    if (open) drawCharts();
  }

  function rangeCard(r, m){
    const scored = m && m.n ? `${m.n} scored · avg miss ${m.mae.toFixed(1)} pts (last-price guess ${m.maeRaw.toFixed(1)}) · inside 68%: ${m.hit68}%` : "No scored predictions yet: the first is scored after its target day closes.";
    const tuned = m && m.n >= 8 ? ` · tuned: pull ${Math.round(m.w * 100)}%, bias ${pts(m.b)}` : "";
    return `<div class="ol-range">
      <div class="card-head"><span class="label">${esc(r.label)} · ${esc(dayLabel(r.exp))} close</span><span class="tag">±${r.sigma.toFixed(0)} pts implied</span></div>
      <div class="big">${px(r.center)}</div>
      <div class="row"><span>Likely (68%)</span><span>${px(r.r68[0])} – ${px(r.r68[1])}</span></div>
      <div class="row"><span>Wide (90%)</span><span>${px(r.r90[0])} – ${px(r.r90[1])}</span></div>
      <div class="row muted"><span>ATM straddle ${r.straddle.toFixed(2)} · IV ${r.atmIv.toFixed(1)}%</span><span>${r.magnet != null ? `gamma magnet ${px0(r.magnet)}` : ""}</span></div>
      <div class="ol-note">Widths use how big moves really were vs. implied${r.within1 != null ? ` (closes stayed inside ±1 implied σ on ${r.within1.toFixed(0)}% of the last 2 years' days)` : ""}. Typical miss of a last-price guess: ${m ? m.baseline.toFixed(0) : "—"} pts.</div>
      <div class="ol-note">${esc(scored + tuned)}</div></div>`;
  }

  function trackRecord(P){
    const done = (P.recent || []).filter(r => r.actual).slice(-12).reverse(), pending = (P.recent || []).filter(r => !r.actual);
    return `<div style="display:grid;gap:8px"><div class="card-head"><h3>Prediction track record</h3><span class="ol-note">Each range keeps updating until it locks (1DTE at the target day's open, 2DTE at the open the day before), then it's scored at the close.</span></div>
      ${done.length ? `<div class="scroll"><table><thead><tr><th>Target close</th><th>Horizon</th><th class="r">Predicted</th><th class="r">68% range</th><th class="r">Actual</th><th class="r">Miss</th><th>Inside</th></tr></thead><tbody>
        ${done.map(r => `<tr><td>${esc(dayLabel(r.target))}</td><td>${r.h}DTE</td><td class="num r">${px(r.center)}</td><td class="num r">${px0(r.r68[0])}–${px0(r.r68[1])}</td><td class="num r">${px(r.actual.c)}</td><td class="num r">${pts(r.err)}</td><td>${r.in68 ? "68% ✓" : r.in90 ? "90% ✓" : "outside ✗"}</td></tr>`).join("")}
        </tbody></table></div>` : `<span class="ol-note">Nothing scored yet.</span>`}
      ${pending.length ? `<span class="ol-note">Waiting: ${pending.map(r => `${r.h}DTE ${esc(dayLabel(r.target))} → ${px(r.center)}`).join(" · ")}</span>` : ""}</div>`;
  }

  function wire(el){
    const det = el.querySelector("details");
    det.addEventListener("toggle", () => { LSset("open", det.open ? "1" : "0"); if (det.open && M) drawCharts(); });
    el.querySelectorAll("[data-oltf]").forEach(b => b.addEventListener("click", () => { tf = b.dataset.oltf; zoom = 1; LSset("tf", tf); el.querySelectorAll("[data-oltf]").forEach(x => x.setAttribute("aria-pressed", x === b)); drawCharts(); }));
    el.querySelectorAll("[data-olzoom]").forEach(b => b.addEventListener("click", () => { zoom = Math.max(0.35, Math.min(3, zoom * (b.dataset.olzoom === "in" ? 0.7 : 1.4))); drawCharts(); }));
    const es = el.querySelector("#olES"); if (es) es.addEventListener("change", () => { inES = es.checked; LSset("es", inES ? "1" : "0"); render(); });
    const dy = el.querySelector("#olDay"); if (dy) dy.addEventListener("change", () => { showDay = dy.checked; LSset("day", showDay ? "1" : "0"); drawCharts(); });
  }

  function drawCharts(){ drawPrice(); drawGex(); }

  function drawPrice(){
    const box = document.getElementById("olChart"); if (!box || !M) return;
    const all = M.bars[tf] || []; if (!all.length){ box.innerHTML = `<div class="ol-note">No ${esc(tf)} bars yet.</div>`; return; }
    const W = Math.max(320, box.clientWidth || 700), phone = W < 560;
    const closes = all.map(b => b[4]), e20 = ema(closes, 20), e50 = ema(closes, 50), e200 = ema(closes, 200), rs = rsi(closes);
    const intraday = tf === "15m" || tf === "1h", vw = intraday ? vwap(all) : null;
    const want = Math.round((phone ? 70 : {"15m": 150, "1h": 140, "2h": 130, "4h": 130, "1d": 150}[tf]) * zoom);
    const n = Math.min(all.length, Math.max(20, want)), s0 = all.length - n, bars = all.slice(s0);
    const r1 = (M.ranges || [])[0];
    const ml = phone ? 36 : 44, mr = phone ? 88 : 132, mt = 10, H = phone ? 300 : 380, rsiH = 70, gap = 26, mb = 22;
    const futW = r1 ? Math.max(28, (W - ml - mr) * 0.08) : 0, plotW = W - ml - mr - futW;
    let lo = Math.min(...bars.map(b => b[3])), hi = Math.max(...bars.map(b => b[2]));
    if (r1){ lo = Math.min(lo, r1.r90[0]); hi = Math.max(hi, r1.r90[1]); }
    const pad = (hi - lo) * 0.04; lo -= pad; hi += pad;
    const step = plotW / n, X = i => ml + step * (i + 0.5), Y = v => mt + (hi - v) / (hi - lo) * (H - mt);
    const yR = v => H + gap + (100 - v) / 100 * rsiH, total = H + gap + rsiH + mb;
    const o = off(), parts = [];
    // grid + y ticks (solid hairlines)
    const tickStep = niceStep((hi - lo) / 6);
    for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep){
      parts.push(`<line x1="${ml}" x2="${ml + plotW + futW}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/>`);
      parts.push(`<text x="${ml - 4}" y="${Y(v) + 4}" text-anchor="end">${Math.round(v + o)}</text>`);
    }
    // 1DTE range band in the space after the last bar
    if (r1){
      const x0 = ml + plotW + 2, w = futW - 4;
      parts.push(`<rect x="${x0}" y="${Y(r1.r90[1])}" width="${w}" height="${Y(r1.r90[0]) - Y(r1.r90[1])}" fill="var(--band2)" rx="3"/>`);
      parts.push(`<rect x="${x0}" y="${Y(r1.r68[1])}" width="${w}" height="${Y(r1.r68[0]) - Y(r1.r68[1])}" fill="var(--band)" rx="3"/>`);
      parts.push(`<line x1="${x0}" x2="${x0 + w}" y1="${Y(r1.center)}" y2="${Y(r1.center)}" stroke="var(--s1)" stroke-width="2"/>`);
      parts.push(`<text x="${x0 + w / 2}" y="${Y(r1.r90[1]) - 4}" text-anchor="middle">${esc(r1.label)}</text>`);
    }
    // levels (labels in the right gutter, skipped when they would collide)
    const levels = levelList().filter(l => (showDay || l.kind === "res" || l.kind === "sup" || l.kind === "gex") && l.p > lo && l.p < hi);
    const used = [];
    levels.forEach(l => {
      const y = Y(l.p), col = l.kind === "res" ? "var(--loss)" : l.kind === "sup" ? "var(--gain)" : l.kind === "gex" ? "var(--accent)" : "var(--muted)";
      parts.push(`<line x1="${ml}" x2="${ml + plotW + futW}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="1" ${l.kind === "gex" || l.kind === "pivot" || l.kind === "day" || l.kind === "overnight" ? 'stroke-dasharray="4 3"' : ""} opacity=".8"/>`);
      if (used.every(u => Math.abs(u - y) > 12)){ used.push(y);
        const short = l.kind === "res" ? "R" : l.kind === "sup" ? "S" : l.name.replace(" (GEX)", "").replace(/Prior day /, "PD ").replace(/Overnight /, "ON ").replace(/ \(.*\)/, "");
        parts.push(`<text x="${ml + plotW + futW + 6}" y="${y + 4}" style="fill:var(--ink)">${Math.round(l.p + o)} ${esc(short)}</text>`); }
    });
    // candles
    const bw = Math.max(1, Math.min(9, step * 0.62));
    bars.forEach((b, i) => {
      const up = b[4] >= b[1], col = up ? "var(--gain)" : "var(--loss)", x = X(i);
      parts.push(`<line x1="${x}" x2="${x}" y1="${Y(b[2])}" y2="${Y(b[3])}" stroke="${col}"/>`);
      const yt = Y(Math.max(b[1], b[4])), yb = Y(Math.min(b[1], b[4]));
      parts.push(`<rect x="${x - bw / 2}" y="${yt}" width="${bw}" height="${Math.max(1, yb - yt)}" fill="${col}" rx="${bw > 4 ? 1 : 0}"/>`);
    });
    // indicator lines (2px), with end labels
    const series = [["EMA 20", e20, "var(--s1)"], ["EMA 50", e50, "var(--s2)"], ["EMA 200", e200, "var(--s3)"]];
    if (vw) series.push(["VWAP", vw, "var(--s4)"]);
    series.forEach(([name, arr, col]) => {
      const pts2 = bars.map((b, i) => [X(i), arr[s0 + i]]).filter(p => p[1] != null && p[1] > lo && p[1] < hi);
      if (pts2.length > 1) parts.push(`<path d="${pts2.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + Y(p[1]).toFixed(1)).join("")}" fill="none" stroke="${col}" stroke-width="2" stroke-linejoin="round"/>`);
    });
    // RSI pane
    parts.push(`<text x="${ml}" y="${H + gap - 6}">RSI 14</text>`);
    [30, 50, 70].forEach(v => parts.push(`<line x1="${ml}" x2="${ml + plotW}" y1="${yR(v)}" y2="${yR(v)}" stroke="var(--line)"/><text x="${ml - 4}" y="${yR(v) + 4}" text-anchor="end">${v}</text>`));
    const rp = bars.map((b, i) => [X(i), rs[s0 + i]]).filter(p => p[1] != null);
    if (rp.length > 1) parts.push(`<path d="${rp.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + yR(p[1]).toFixed(1)).join("")}" fill="none" stroke="var(--s1)" stroke-width="2"/>`);
    // x labels
    const every = Math.max(1, Math.round(n / (phone ? 4 : 7)));
    for (let i = every - 1; i < n; i += every){
      const d = new Date(bars[i][0] * 1000), lab = tf === "1d" ? nyD.format(d).replace(/^\w+, /, "") : nyF.format(d).replace(/, /, " ");
      parts.push(`<text x="${X(i)}" y="${total - 6}" text-anchor="middle">${esc(lab)}</text>`);
    }
    parts.push(`<line id="olX" x1="0" x2="0" y1="${mt}" y2="${H + gap + rsiH}" stroke="var(--muted)" visibility="hidden"/>`);
    parts.push(`<rect id="olHit" x="${ml}" y="0" width="${plotW}" height="${total}" fill="transparent"/>`);
    box.innerHTML = `<svg viewBox="0 0 ${W} ${total}" role="img" aria-label="${esc(tf)} chart of ES in ${inES ? "ES" : "SPX"} points with EMA 20, 50, 200${vw ? ", VWAP" : ""}, support and resistance">${parts.join("")}</svg><div class="ol-tip" id="olTip" hidden></div>`;
    document.getElementById("olLegend").innerHTML = series.map(([name, , col]) => `<span><i style="background:${col}"></i>${esc(name)}</span>`).join("")
      + `<span><i style="background:var(--loss)"></i>Resistance</span><span><i style="background:var(--gain)"></i>Support</span><span><i style="background:var(--accent)"></i>GEX walls / flip</span>${r1 ? `<span><i class="box" style="background:var(--band)"></i>${esc(r1.label)} range 68% / 90%</span>` : ""}`;
    // crosshair: snap to the nearest bar, one readout for every series
    const svg = box.querySelector("svg"), tip = box.querySelector("#olTip"), xl = svg.querySelector("#olX");
    const show = ev => {
      const rect = svg.getBoundingClientRect(), sx = (ev.clientX - rect.left) * W / rect.width;
      const i = Math.max(0, Math.min(n - 1, Math.round((sx - ml) / step - 0.5))), b = bars[i], k = s0 + i;
      xl.setAttribute("x1", X(i)); xl.setAttribute("x2", X(i)); xl.setAttribute("visibility", "visible");
      tip.hidden = false; tip.textContent = "";
      const row = (label, val, col) => { const r = document.createElement("div"); r.className = "k"; const a = document.createElement("span");
        if (col){ const ii = document.createElement("i"); ii.style.background = col; a.appendChild(ii); } a.appendChild(document.createTextNode(label));
        const v = document.createElement("b"); v.textContent = val; r.append(a, v); tip.appendChild(r); };
      const head = document.createElement("div"); head.className = "ol-note"; head.textContent = tf === "1d" ? nyD.format(new Date(b[0] * 1000)) : timeLabel(b[0]); tip.appendChild(head);
      row("Close", px(b[4])); row("High / Low", `${px(b[2])} / ${px(b[3])}`); row("Open", px(b[1]));
      series.forEach(([name, arr, col]) => row(name, px(arr[k]), col)); row("RSI 14", rs[k] != null ? rs[k].toFixed(1) : "—");
      const left = (X(i) / W) * rect.width; tip.style.left = Math.min(rect.width - 170, Math.max(0, left + 12)) + "px"; tip.style.top = "8px";
    };
    svg.addEventListener("pointermove", show); svg.addEventListener("pointerdown", show);
    svg.addEventListener("pointerleave", () => { tip.hidden = true; xl.setAttribute("visibility", "hidden"); });
  }
  function niceStep(raw){ const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }

  function drawGex(){
    const box = document.getElementById("olGex"), g = M && M.gex; if (!box) return;
    if (!g || !g.byStrike.length){ box.innerHTML = `<div class="ol-note">No options data yet.</div>`; return; }
    const rows = g.byStrike.filter(r => Math.abs(r[0] / g.spot - 1) <= 0.025);
    const W = Math.max(300, box.clientWidth || 500), H = 220, ml = 46, mr = 8, mt = 8, mb = 22;
    const vals = rows.map(r => r[1] + r[2]), ext = Math.max(...vals.map(Math.abs), 1);
    const kmin = rows[0][0], kmax = rows[rows.length - 1][0], X = k => ml + (k - kmin) / (kmax - kmin || 1) * (W - ml - mr), Y = v => mt + (ext - v) / (2 * ext) * (H - mt - mb);
    const bw = Math.max(1, (W - ml - mr) / rows.length - 2), parts = [];
    [ext, ext / 2, 0, -ext / 2, -ext].forEach(v => parts.push(`<line x1="${ml}" x2="${W - mr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${ml - 4}" y="${Y(v) + 4}" text-anchor="end">${Math.abs(v) < 1 ? "0" : money(v).replace("$", "")}</text>`));
    rows.forEach((r, i) => { const v = r[1] + r[2], y0 = Y(0), y1 = Y(v);
      parts.push(`<rect data-i="${i}" x="${X(r[0]) - bw / 2}" y="${Math.min(y0, y1)}" width="${bw}" height="${Math.max(1, Math.abs(y1 - y0))}" fill="${v >= 0 ? "var(--pos)" : "var(--neg)"}" rx="1"/>`); });
    const vline = (k, col, label, left) => { if (k == null || k < kmin || k > kmax) return; parts.push(`<line x1="${X(k)}" x2="${X(k)}" y1="${mt}" y2="${H - mb}" stroke="${col}" stroke-width="1.5"/><text x="${X(k) + (left ? -4 : 4)}" y="${mt + 10}" text-anchor="${left ? "end" : "start"}" style="fill:var(--ink)">${esc(label)}</text>`); };
    vline(g.spot, "var(--ink)", "spot", g.flip != null && g.flip > g.spot); vline(g.flip, "var(--muted)", "flip", !(g.flip > g.spot));
    const every = Math.max(1, Math.round(rows.length / 6));
    rows.forEach((r, i) => { if (i % every === 0) parts.push(`<text x="${X(r[0])}" y="${H - 6}" text-anchor="middle">${Math.round(r[0] + off())}</text>`); });
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Net gamma exposure by SPX strike">${parts.join("")}</svg><div class="ol-tip" hidden></div>`;
    const svg = box.querySelector("svg"), tip = box.querySelector(".ol-tip");
    svg.addEventListener("pointermove", ev => {
      const rect = svg.getBoundingClientRect(), sx = (ev.clientX - rect.left) * W / rect.width;
      const r = rows.reduce((a, x) => Math.abs(X(x[0]) - sx) < Math.abs(X(a[0]) - sx) ? x : a, rows[0]);
      tip.hidden = false; tip.textContent = "";
      [["Strike", Math.round(r[0] + off()).toString()], ["Net", money(r[1] + r[2])], ["Calls", money(r[1])], ["Puts", money(r[2])]].forEach(([a, b]) => {
        const d = document.createElement("div"); d.className = "k"; const s = document.createElement("span"); s.textContent = a; const v = document.createElement("b"); v.textContent = b; d.append(s, v); tip.appendChild(d); });
      tip.style.left = Math.min(rect.width - 160, Math.max(0, (X(r[0]) / W) * rect.width + 10)) + "px"; tip.style.top = "8px";
    });
    svg.addEventListener("pointerleave", () => { tip.hidden = true; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();
