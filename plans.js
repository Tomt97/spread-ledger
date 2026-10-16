/* Trader levels: paste a trader's daily plan (for example an ES futures plan from X or a newsletter), the app reads
   the levels out of it, draws them on the SPX outlook chart and, once that session is over, scores each one against
   what ES actually did. The aim is to learn, with numbers, whether someone's levels are worth following.
   Plans are private (members/<uid>/settings/plans). Levels written in ES points are converted to SPX points with
   that day's ES − SPX spread, like everything else on the Market page. Uses window.LedgerApp.plans (index.html)
   and window.LedgerOutlook (outlook.js). A study aid, not advice. */
(function(){
  const KINDS = {
    sup:  { name: "Support",   short: "S",  col: "var(--gain)" },
    tgt:  { name: "Target",    short: "T",  col: "var(--accent)" },
    trig: { name: "Long trigger", short: "↑", col: "var(--s4, #c98500)" },
    brk:  { name: "Breakdown", short: "↓",  col: "var(--loss)" },
    lvl:  { name: "Level",     short: "L",  col: "var(--muted)" },
  };
  const ORDER = ["sup", "tgt", "trig", "brk", "lvl"];
  const LS = k => { try { return localStorage.getItem("spread-ledger-plans-" + k); } catch { return null; } };
  const LSset = (k, v) => { try { localStorage.setItem("spread-ledger-plans-" + k, v); } catch {} };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmt = v => Math.round(v * 100) / 100 % 1 ? (Math.round(v * 100) / 100).toFixed(2) : String(Math.round(v));
  const app = () => window.LedgerApp && window.LedgerApp.plans;
  const mkt = () => window.LedgerOutlook && window.LedgerOutlook.data();
  let draft = { text: "", src: LS("src") || "", unit: LS("unit") || "ES", d: null, levels: null, editId: null }, msg = "";

  /* ---------- New York dates ---------- */
  const nyParts = d => Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" }).formatToParts(d).map(x => [x.type, x.value]));
  const nyToday = () => { const p = nyParts(new Date()); return { d: `${p.year}-${p.month}-${p.day}`, mins: (+p.hour % 24) * 60 + +p.minute, wd: p.weekday }; };
  const addDays = (iso, n) => { const x = new Date(iso + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const weekday = iso => new Date(iso + "T12:00:00Z").getUTCDay();
  // The session a plan pasted now is for: today until the 4 pm close on a weekday, else the next weekday.
  function nextSession(){
    const t = nyToday(); let d = t.d;
    if (weekday(d) === 0 || weekday(d) === 6 || t.mins >= 16 * 60) { do d = addDays(d, 1); while (weekday(d) === 0 || weekday(d) === 6); }
    return d;
  }
  const dayLabel = iso => new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  // a session is over at 5 pm New York (ES closes); after that its score is final
  const sessionOver = iso => { const t = nyToday(); return t.d > iso || (t.d === iso && t.mins >= 17 * 60); };

  /* ---------- reading a plan ---------- */
  // "7765-55" is 7765 and 7755; "7716-22" is 7716 and 7722; "7853/7840" are two levels.
  function numbersIn(s, ref){
    const out = [], re = /(?<![\d.:$])(\d{4,5}(?:\.\d{1,2})?)(?:\s*[-–]\s*(\d{2,5}(?:\.\d{1,2})?))?(?![\d:%]|\s*(?:points|pts|pt|k|K|views|AM|PM|am|pm))/g;
    for (const m of s.matchAll(re)){
      const a = +m[1]; let list = [a];
      if (m[2]){ const t = m[2]; const b = t.length >= m[1].split(".")[0].length ? +t : +(m[1].slice(0, m[1].split(".")[0].length - t.split(".")[0].length) + t); if (Math.abs(b - a) < a * 0.02) list.push(b); }
      for (const v of list) if (!ref || Math.abs(v / ref - 1) < 0.15) out.push({ v, at: m.index });
    }
    return out;
  }
  function parsePlan(text, ref){
    const found = new Map();
    // a number named twice keeps its strongest meaning: trigger, then support, breakdown, target, plain level
    const RANK = { trig: 0, sup: 1, brk: 2, tgt: 3, lvl: 4 };
    const put = (v, k) => { const old = found.get(v); if (!old || RANK[k] < RANK[old]) found.set(v, k); };
    // recaps of what already happened ("Targets were 7772, 7782. All hit", "Yesterday was all about 7853") aren't the plan
    const PAST = /\b(yesterday'?s?|ystd|last night|last week|were|was|got to|triggered|all hit|we sold|we bought|we recovered|as posted|tagged)\b/i;
    const UP = /\b(to rally|rally|sees?|targets?|next comes|next|then|up to|squeeze to)\b/gi;
    const clauses = text.replace(/\r/g, "").split(/(?<=[.!?;])\s+|\n+|\b(?=plan(?: today| for today| tomorrow)?\s*:)/i);
    for (const clause of clauses){
      const c = clause.replace(/^plan[^:]*:\s*/i, "").trim(); if (!c) continue;
      const nums = numbersIn(c, ref); if (!nums.length) continue;
      if (PAST.test(c) && !/\b(today|now|next|tomorrow|plan)\b/i.test(c)) continue;
      const low = c.toLowerCase();
      const ups = [...c.matchAll(UP)].map(m => m.index);
      const trigM = /failed breakdown|reclaim|long trigger|trigger long|to trigger|triggers? long/i.exec(c), trigAt = trigM ? trigM.index : -1;
      // the upside part of a trigger sentence starts at the first "rally/sees/targets" after the trigger words
      const upAfter = at => ups.find(u => u > at) ?? -1;
      const sellM = /(sell\s*<|short\s*<|<\s*\d|below\s+\d|\bfails?\b|\blose\b|\bloses\b|loss of|breakdown under|under\s+\d)/i.exec(c), sellAt = sellM ? sellM.index : -1;
      for (const { v, at } of nums){
        const tail = low.slice(at); let k;
        if (/^[\d\s.,\-–\/+~]*=\s*(weak\s+|key\s+|major\s+)?supports?/.test(tail) || /^[\d\s.,\-–\/+~()a-z]{0,25}\bsupports?\b/.test(tail) && !/^[^=]*\b(see|rally|target)/.test(tail.slice(0, 25))) k = "sup";
        else if (trigAt >= 0 && Math.abs(at - trigAt) < 60 && (upAfter(trigAt) < 0 || at < upAfter(trigAt))) k = "trig";
        else if (sellAt >= 0 && at > sellAt) k = "brk";
        else if (ups.some(u => u < at)) k = "tgt";
        else if (/targets?|resistance|backtest|upside/.test(low)) k = "tgt";
        else if (/\bsupports?\b/.test(low)) k = "sup";
        else if (sellAt >= 0) k = "brk";
        else k = "lvl";
        put(v, k);
      }
    }
    return [...found.entries()].map(([v, k]) => ({ v, k })).sort((a, b) => b.v - a.v);
  }

  /* ---------- ES ↔ SPX ---------- */
  function basisFor(d){
    const M = mkt(); if (!M || !M.basis) return null;
    const h = M.basis.history || [], hit = h.find(x => x[0] === d);
    if (hit) return hit[1];
    const before = h.filter(x => x[0] < d); return d > (h.length ? h[h.length - 1][0] : "") ? M.basis.now : before.length ? before[before.length - 1][1] : M.basis.now;
  }
  const toSpx = (p, l) => p.unit === "SPX" ? l.v : (basisFor(p.d) == null ? null : l.v - basisFor(p.d));

  /* ---------- scoring against what ES did that session (bars are in SPX points) ---------- */
  function sessionBars(d){
    const M = mkt(), O = window.LedgerOutlook; if (!M || !M.bars || !O) return [];
    for (const tf of ["15m", "1h"]){ const b = (M.bars[tf] || []).filter(x => O.sessionOf(x[0]) === d); if (b.length >= 4) return b.map(x => ({ t: x[0], o: x[1], h: x[2], l: x[3], c: x[4] })); }
    return [];
  }
  function scorePlan(p){
    // from when the plan was saved, if that was during the session (moves before it aren't the plan's)
    const all = sessionBars(p.d), from = all.filter(b => b.t * 1000 >= (p.made || 0) - 15 * 60e3), B = from.length >= 4 ? from : all;
    if (!B.length) return null;
    const open = B[0].o, hi = Math.max(...B.map(b => b.h)), lo = Math.min(...B.map(b => b.l)), close = B[B.length - 1].c;
    const lv = p.levels.map(l => ({ ...l, s: toSpx(p, l) })).filter(l => l.s != null);
    const res = lv.map(l => {
      const x = l.s, r = { v: l.v, k: l.k, spx: Math.round(x * 100) / 100 };
      if (l.k === "sup"){
        const first = B.findIndex(b => b.l <= x + 2);
        if (first < 0) return { ...r, st: "untested", ok: null, note: `low ${fmt(lo - x)} above it` };
        const after = B.slice(first), brokeBar = after.find(b => b.c < x - 5);
        if (brokeBar && close < x) return { ...r, st: "broke", ok: false, note: `closed ${fmt(x - close)} below` };
        const depth = x - Math.min(...after.map(b => b.l));
        // a short flush under support that's bought back is the trap traders look for; a deep break isn't "held"
        if (depth > 12) return { ...r, st: "broke, recovered later", ok: false, note: `went ${fmt(depth)} under before closing above` };
        if (depth > 2) return { ...r, st: "flushed, reclaimed", ok: true, note: `${fmt(depth)} under, closed back above` };
        return { ...r, st: "held", ok: true, note: "tested and held" };
      }
      if (l.k === "tgt"){
        const up = x >= open;
        const hit = up ? hi >= x - 1 : lo <= x + 1;
        return { ...r, st: hit ? "hit" : "missed", ok: hit, note: hit ? "" : `closest ${fmt(up ? x - hi : lo - x)} away`, dist: Math.abs(x - open), up };
      }
      if (l.k === "trig"){
        // failed breakdown: trade under it, then a 15-minute close back above
        const flush = B.findIndex(b => b.l < x - 2); if (flush < 0) return { ...r, st: "not triggered", ok: null, note: "never traded below it" };
        const rec = B.findIndex((b, i) => i > flush && b.c > x + 1); if (rec < 0) return { ...r, st: "not triggered", ok: null, note: "broke and stayed below" };
        const flushLow = Math.min(...B.slice(flush, rec + 1).map(b => b.l)), entry = B[rec].c;
        const nextTgt = lv.filter(o => o.k === "tgt" && o.s > entry + 1).map(o => o.s).sort((a, b) => a - b)[0] ?? entry + (entry - flushLow);
        for (const b of B.slice(rec + 1)){
          if (b.l < flushLow) return { ...r, st: "triggered, stopped", ok: false, note: `long ${fmt(entry)}, lost the flush low` };
          if (b.h >= nextTgt) return { ...r, st: "triggered, worked", ok: true, note: `long ${fmt(entry)} → ${fmt(nextTgt)}` };
        }
        return { ...r, st: "triggered, open", ok: close > entry, note: `long ${fmt(entry)}, closed ${fmt(close - entry)}` };
      }
      if (l.k === "brk"){
        const brk = B.findIndex(b => b.c < x - 1); if (brk < 0) return { ...r, st: "held above", ok: null, note: "" };
        return { ...r, st: "broke down", ok: close < x, note: `closed ${fmt(close - x)} from it` };
      }
      const touched = lo <= x && hi >= x; return { ...r, st: touched ? "touched" : "not reached", ok: null };
    });
    return { at: Date.now(), final: sessionOver(p.d), basis: p.unit === "SPX" ? 0 : Math.round((basisFor(p.d) || 0) * 100) / 100, open, hi, lo, close, res };
  }
  // How often a target that far from the open gets hit on an ordinary session (from the hourly bars), so a high hit
  // rate can be told apart from targets that were simply close.
  function chanceOfReaching(dist, up){
    const M = mkt(), O = window.LedgerOutlook; if (!M || !O) return null;
    const by = new Map(); for (const x of M.bars["1h"] || []){ const d = O.sessionOf(x[0]); const s = by.get(d) || by.set(d, { o: x[1], h: x[2], l: x[3] }).get(d); s.h = Math.max(s.h, x[2]); s.l = Math.min(s.l, x[3]); }
    const s = [...by.values()]; if (s.length < 20) return null;
    return s.filter(v => up ? v.h - v.o >= dist : v.o - v.l >= dist).length / s.length;
  }

  /* ---------- the chart hook ---------- */
  window.LedgerPlans = {
    chartLevels(){
      if (LS("chart") === "0") return [];
      const list = (app() && app().list()) || [], d = nextSession(), t = nyToday().d;
      // the plan for the session in progress (or the next one), else the latest
      const p = list.filter(x => x.d === d || x.d === t).sort((a, b) => b.made - a.made)[0];
      if (!p) return [];
      return p.levels.map(l => ({ p: toSpx(p, l), name: `${p.src || "Plan"} ${KINDS[l.k].name.toLowerCase()}`, short: `${(p.src || "P")[0].toUpperCase()}${KINDS[l.k].short}`,
        detail: `${p.unit === "SPX" ? "" : `ES ${fmt(l.v)} · `}${p.src || "plan"} for ${dayLabel(p.d)}` })).filter(l => l.p != null);
    },
  };

  /* ---------- UI ---------- */
  const css = `
#plansPanel .pl-body{display:grid;gap:12px;margin-top:10px}
#plansPanel textarea{width:100%;min-height:96px;font:inherit;font-size:14px;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);resize:vertical;box-sizing:border-box}
#plansPanel .pl-row{display:flex;gap:8px 12px;flex-wrap:wrap;align-items:end}
#plansPanel .pl-row label{display:grid;gap:4px;font-size:12px;color:var(--muted);min-width:0}
#plansPanel .pl-row input,#plansPanel .pl-row select{font:inherit;font-size:14px;padding:7px 9px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);min-width:0}
#plansPanel .pl-chips{display:flex;flex-wrap:wrap;gap:6px}
#plansPanel .pl-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-left:4px solid var(--c);border-radius:8px;padding:4px 8px;font-size:13px;background:var(--surface);color:var(--ink)}
#plansPanel .pl-chip b{font-family:var(--mono, ui-monospace, monospace)}
#plansPanel .pl-chip button{border:none;background:none;color:var(--muted);cursor:pointer;font:inherit;padding:0 2px}
#plansPanel .pl-chip .k{font-size:11px;font-weight:700;color:var(--c);text-transform:uppercase;letter-spacing:.04em;cursor:pointer}
#plansPanel .pl-plan{border-top:1px solid var(--line);padding-top:10px;display:grid;gap:8px}
#plansPanel .pl-head{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;align-items:baseline}
#plansPanel .pl-res{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:4px 10px;font-size:13px;align-items:baseline}
#plansPanel .pl-res .ok{color:var(--gain);font-weight:700} #plansPanel .pl-res .bad{color:var(--loss);font-weight:700} #plansPanel .pl-res .na{color:var(--muted)}
#plansPanel .pl-score{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--line);border:1px solid var(--line);border-radius:10px;overflow:hidden}
#plansPanel .pl-score div{background:var(--surface);padding:10px 12px;display:grid;gap:2px;min-width:0}
#plansPanel .pl-score .v{font-size:18px;font-weight:700}
#plansPanel .pl-note{font-size:12.5px;color:var(--muted)}
#plansPanel .pl-msg{font-size:13px;color:var(--loss)}
#plansPanel details > summary{cursor:pointer;list-style:none;color:var(--accent);font-weight:600}
#plansPanel details > summary::-webkit-details-marker{display:none}
@media (max-width:640px){ #plansPanel .pl-score{grid-template-columns:1fr} #plansPanel .pl-res{grid-template-columns:auto minmax(0,1fr)} #plansPanel .pl-res .n{grid-column:2} }`;
  const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);

  function mount(){
    if (document.getElementById("plansPanel")) return;
    const dash = document.getElementById("dash"), after = document.getElementById("outlook"); if (!dash || !after) return setTimeout(mount, 300);
    const sec = document.createElement("section");
    sec.className = "panel card"; sec.id = "plansPanel"; sec.dataset.views = "market"; sec.setAttribute("aria-label", "Trader levels");
    after.after(sec);
    sec.addEventListener("click", onClick); sec.addEventListener("input", onInput); sec.addEventListener("change", onInput);
    sec.addEventListener("toggle", ev => { if (ev.target.matches("details.pl-d")) LSset("open", ev.target.open ? "1" : "0"); }, true);
    render();
  }

  function chip(l, i, editable){
    const K = KINDS[l.k];
    return `<span class="pl-chip" style="--c:${K.col}">${editable ? `<span class="k" data-plk="${i}" title="Tap to change the kind">${K.name}</span>` : `<span class="k">${K.name}</span>`}<b>${fmt(l.v)}</b>${editable ? `<button type="button" data-pldel="${i}" aria-label="Remove ${fmt(l.v)}">×</button>` : ""}</span>`;
  }
  function stats(list){
    const R = list.filter(p => p.score && p.score.final).flatMap(p => p.score.res);
    const tg = R.filter(r => r.k === "tgt"), sp = R.filter(r => r.k === "sup" && r.ok != null), tr = R.filter(r => r.k === "trig" && /triggered/.test(r.st) && !/open/.test(r.st));
    const chance = tg.map(r => chanceOfReaching(r.dist, r.up)).filter(v => v != null);
    return { plans: list.filter(p => p.score && p.score.final).length,
      tgt: tg.length ? [tg.filter(r => r.ok).length, tg.length] : null, chance: chance.length ? chance.reduce((a, b) => a + b, 0) / chance.length : null,
      sup: sp.length ? [sp.filter(r => r.ok).length, sp.length] : null, trig: tr.length ? [tr.filter(r => r.ok).length, tr.length] : null };
  }
  const pct = ([a, b]) => `${Math.round(a / b * 100)}%`;

  function render(){
    const sec = document.getElementById("plansPanel"); if (!sec) return;
    const A = app(), list = (A && A.list() || []).slice().sort((a, b) => b.d.localeCompare(a.d) || b.made - a.made), canEdit = !!(A && A.canEdit());
    const M = mkt(), ref = M ? (draft.unit === "SPX" ? M.spot : M.es && M.es.last) : null;
    if (!draft.d) draft.d = nextSession();
    const S = stats(list), open = LS("open") !== "0";
    const editing = draft.levels != null;
    sec.innerHTML = `<details class="pl-d" ${open ? "open" : ""}><summary><span class="card-head" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><h2 style="margin:0;font-size:17px">Trader levels</h2><span class="pl-note">${list.length ? `${list.length} plan${list.length === 1 ? "" : "s"}${S.plans ? ` · ${S.plans} scored` : ""}` : "paste a trader's plan, score their levels"}</span></span></summary>
      <div class="pl-body">
        <div class="pl-note">Paste someone's daily plan (for example an ES futures plan from X or a newsletter). The app reads the levels, draws them on the chart above in SPX points, and after the session scores each one: did supports hold, were targets hit, did long triggers work. Your plans stay private to your account.</div>
        ${S.plans ? `<div class="pl-score">
          <div><span class="label">Targets hit</span><span class="v">${S.tgt ? pct(S.tgt) : "—"}</span><span class="pl-note">${S.tgt ? `${S.tgt[0]} of ${S.tgt[1]}${S.chance != null ? ` · ${Math.round(S.chance * 100)}% expected by chance at those distances` : ""}` : "no targets yet"}</span></div>
          <div><span class="label">Supports held</span><span class="v">${S.sup ? pct(S.sup) : "—"}</span><span class="pl-note">${S.sup ? `${S.sup[0]} of ${S.sup[1]} tested (a flush of up to 12 pts that closes back above counts as held)` : "none tested yet"}</span></div>
          <div><span class="label">Long triggers worked</span><span class="v">${S.trig ? pct(S.trig) : "—"}</span><span class="pl-note">${S.trig ? `${S.trig[0]} of ${S.trig[1]} triggered reached the next target before the flush low` : "none triggered yet"}</span></div></div>
          ${S.plans < 15 ? `<div class="pl-note">Only ${S.plans} session${S.plans === 1 ? "" : "s"} scored: too few to judge. About 20–30 sessions start to mean something.</div>` : ""}` : ""}
        ${canEdit ? `<div style="display:grid;gap:8px">
          <textarea id="plText" placeholder="Paste the plan here, e.g. “Next comes 7811, 7820, then 7835 to backtest. 7782, 7765-55=supports”">${esc(draft.text)}</textarea>
          <div class="pl-row">
            <label>Source<input id="plSrc" value="${esc(draft.src)}" placeholder="e.g. Mancini" maxlength="30" size="12"></label>
            <label>For session<input id="plDate" type="date" value="${esc(draft.d)}"></label>
            <label>Prices in<select id="plUnit"><option value="ES" ${draft.unit === "ES" ? "selected" : ""}>ES futures</option><option value="SPX" ${draft.unit === "SPX" ? "selected" : ""}>SPX</option></select></label>
            <button class="btn" type="button" data-plact="read">Read levels</button>
          </div>
          ${editing ? `<div class="pl-note">${draft.levels.length ? "Check the kinds (tap a label to change it, × to remove), then save." : "No levels found in that text."}${ref ? "" : " Market data isn't loaded, so numbers far from today's price weren't filtered."}</div>
            <div class="pl-chips">${draft.levels.map((l, i) => chip(l, i, true)).join("")}</div>
            <div class="pl-row"><label>Add a level<input id="plAdd" inputmode="decimal" placeholder="7790" size="8"></label><button class="btn" type="button" data-plact="add">Add</button>
              <button class="btn primary" type="button" data-plact="save" ${draft.levels.length ? "" : "disabled"}>${draft.editId ? "Save changes" : "Save plan"}</button><button class="btn" type="button" data-plact="cancel">Cancel</button></div>` : ""}
          ${msg ? `<div class="pl-msg">${esc(msg)}</div>` : ""}
        </div>` : `<div class="pl-note">Viewing someone else's dashboard: plans are read-only.</div>`}
        <label class="pl-note" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="plChart" ${LS("chart") === "0" ? "" : "checked"}> Show the current plan's levels on the chart</label>
        ${list.map(p => planCard(p, canEdit)).join("")}
      </div></details>`;
  }

  function planCard(p, canEdit){
    const sc = p.score && p.score.final ? p.score : (sessionOver(p.d) || nyToday().d === p.d ? scorePlan(p) : null);
    const mark = r => r.ok === true ? `<span class="ok">✓</span>` : r.ok === false ? `<span class="bad">✗</span>` : `<span class="na">–</span>`;
    const conv = p.unit === "SPX" ? "" : (() => { const b = sc ? sc.basis : basisFor(p.d); return b != null ? ` · ES − ${fmt(b)} = SPX` : ""; })();
    return `<div class="pl-plan">
      <div class="pl-head"><b>${esc(dayLabel(p.d))} · ${esc(p.src || "Plan")}</b><span class="pl-note">${p.unit}${conv}${sc ? (sc.final ? " · scored" : " · so far today") : " · waiting for the session"}</span></div>
      ${sc ? `<div class="pl-res">${sc.res.map(r => `${mark(r)}<span><span style="color:${KINDS[r.k].col};font-weight:700">${KINDS[r.k].name}</span> <b>${fmt(r.v)}</b>${p.unit === "SPX" ? "" : ` <span class="pl-note">(SPX ${fmt(r.spx)})</span>`}</span><span class="n pl-note">${esc(r.st)}${r.note ? ` · ${esc(r.note)}` : ""}</span>`).join("")}</div>
        <div class="pl-note">Session in SPX points: open ${fmt(sc.open)} · high ${fmt(sc.hi)} · low ${fmt(sc.lo)} · ${sc.final ? "close" : "last"} ${fmt(sc.close)}</div>`
        : `<div class="pl-chips">${p.levels.map(l => chip(l, 0, false)).join("")}</div>`}
      ${p.text ? `<details><summary class="pl-note">Original text</summary><div class="pl-note" style="white-space:pre-wrap;margin-top:6px">${esc(p.text)}</div></details>` : ""}
      ${canEdit ? `<div class="pl-row"><button class="btn small" type="button" data-pledit="${esc(p.id)}">Edit</button><button class="btn small danger" type="button" data-plrm="${esc(p.id)}">Delete</button></div>` : ""}
    </div>`;
  }

  function onInput(ev){
    const t = ev.target;
    if (t.id === "plText") draft.text = t.value;
    else if (t.id === "plSrc") { draft.src = t.value; LSset("src", t.value); }
    else if (t.id === "plDate") draft.d = t.value;
    else if (t.id === "plUnit") { draft.unit = t.value; LSset("unit", t.value); }
    else if (t.id === "plChart" && ev.type === "change") { LSset("chart", t.checked ? "1" : "0"); window.LedgerOutlook && window.LedgerOutlook.redraw(); }
  }
  async function onClick(ev){
    const b = ev.target.closest("[data-plact],[data-plk],[data-pldel],[data-pledit],[data-plrm]"); if (!b) return;
    const A = app(); msg = "";
    if (b.dataset.plk != null){ const l = draft.levels[+b.dataset.plk]; l.k = ORDER[(ORDER.indexOf(l.k) + 1) % ORDER.length]; return render(); }
    if (b.dataset.pldel != null){ draft.levels.splice(+b.dataset.pldel, 1); return render(); }
    if (b.dataset.pledit){ const p = A.list().find(x => x.id === b.dataset.pledit); if (!p) return;
      draft = { text: p.text || "", src: p.src || "", unit: p.unit, d: p.d, levels: p.levels.map(l => ({ ...l })), editId: p.id }; render();
      document.getElementById("plText")?.scrollIntoView({ block: "center" }); return; }
    if (b.dataset.plrm){ if (!confirm("Delete this plan and its score?")) return; await A.save(A.list().filter(x => x.id !== b.dataset.plrm)); return render(); }
    const act = b.dataset.plact, M = mkt();
    if (act === "read"){
      const ref = M ? (draft.unit === "SPX" ? M.spot : M.es && M.es.last) : null;
      draft.levels = parsePlan(draft.text, ref); if (!draft.levels.length) msg = "No price levels found. Paste the plan text, or add levels by hand below.";
      if (!draft.levels.length) draft.levels = [];
      return render();
    }
    if (act === "add"){ const v = parseFloat(document.getElementById("plAdd").value); if (isFinite(v) && v > 0){ draft.levels = (draft.levels || []).filter(l => l.v !== v).concat({ v, k: "lvl" }).sort((a, b) => b.v - a.v); } return render(); }
    if (act === "cancel"){ draft = { text: "", src: draft.src, unit: draft.unit, d: nextSession(), levels: null, editId: null }; return render(); }
    if (act === "save"){
      if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.d || "")) { msg = "Pick the session date."; return render(); }
      const list = A.list().slice(), id = draft.editId || Math.random().toString(36).slice(2, 10);
      const plan = { id, d: draft.d, src: draft.src.trim().slice(0, 30), unit: draft.unit, made: Date.now(), text: draft.text.slice(0, 2000), levels: draft.levels.map(l => ({ v: l.v, k: l.k })) };
      const i = list.findIndex(x => x.id === id); if (i >= 0) list[i] = { ...list[i], ...plan, score: null }; else list.push(plan);
      const ok = await A.save(list);
      if (ok === false) { msg = "Couldn't save. Check your connection and try again."; return render(); }
      draft = { text: "", src: draft.src, unit: draft.unit, d: nextSession(), levels: null, editId: null }; return render();
    }
  }

  // Freeze each finished session's score into the plan (the 15-minute bars only go back about two weeks).
  let saving = false;
  async function freezeScores(){
    const A = app(); if (!A || !A.canEdit() || saving || !mkt()) return;
    const list = A.list(); let changed = false;
    const next = list.map(p => { if (p.score && p.score.final || !sessionOver(p.d)) return p; const sc = scorePlan(p); if (!sc || !sc.final) return p; changed = true; return { ...p, score: sc }; });
    if (changed){ saving = true; try { await A.save(next); } finally { saving = false; } }
  }

  window.addEventListener("ledger:plans", () => { render(); freezeScores(); });
  window.addEventListener("ledger:market", () => { render(); freezeScores(); window.LedgerOutlook && window.LedgerOutlook.redraw(); });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
  window.LedgerPlansTest = { parsePlan, numbersIn };
})();
