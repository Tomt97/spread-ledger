// Builds events.json: scheduled market-moving events, past and upcoming, for the SPX outlook.
// Official sources: Federal Reserve (FOMC decisions + minutes), BLS (CPI, jobs report, PPI), BEA (PCE, GDP),
// NYSE (holidays, early closes). Option expirations are computed. If a source can't be read this run, its
// events from the previous events.json (PREV_EVENTS) are kept.
import { readFileSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const UA = { headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15", "Accept-Language": "en-US,en;q=0.9", "Accept": "text/html" } };
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const mIdx = s => MONTHS.findIndex(m => m.startsWith(String(s).toLowerCase().replace(/\./, "").slice(0, 3)));
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const addDays = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const text = h => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/\s+/g, " ");
// curl is used instead of fetch: some of these government sites refuse Node's built-in client.
const execFileP = promisify(execFile);
async function get(url){
  for (let a = 0; a < 3; a++){
    try {
      const { stdout } = await execFileP("curl", ["-sSL", "--compressed", "--max-time", "40", "-A", UA.headers["User-Agent"], "-H", "Accept-Language: en-US,en;q=0.9",
        "-H", "Accept: text/html,application/xhtml+xml", "-w", "\n%{http_code}", url], { maxBuffer: 20 * 1024 * 1024 });
      const i = stdout.lastIndexOf("\n"), code = +stdout.slice(i + 1), body = stdout.slice(0, i);
      if (code !== 200) throw new Error(`HTTP ${code}`);
      return body;
    } catch (e) { if (a === 2){ console.error(`${url}: ${e.message}`); return null; } await new Promise(r => setTimeout(r, 3000)); }
  }
}

const sources = {};
/* ---------- FOMC (decision day = last day of the meeting; minutes 3 weeks later unless listed) ---------- */
sources.fed = async () => {
  const h = await get("https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm"); if (!h) return null;
  const out = [], panels = h.split(/<h4><a id="\d+">/).slice(1);
  for (const p of panels){
    const y = +(/^(\d{4}) FOMC Meetings/.exec(p) || [])[1]; if (!y) continue;
    for (const row of p.split(/class="(?:fomc-meeting--shaded )?row fomc-meeting"/).slice(1)){
      const mon = (/fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>/.exec(row) || [])[1], dt = (/fomc-meeting__date[^>]*>([^<]+)</.exec(row) || [])[1];
      if (!mon || !dt) continue;
      const t = text(row);
      if (/unscheduled|notation vote|conference call/i.test(dt + " " + t.slice(0, 200))) continue;
      const days = dt.replace(/\*/g, "").match(/\d+/g); if (!days) continue;
      const months = mon.split("/"), last = +days[days.length - 1];
      const m = mIdx(months[months.length - 1]); if (m < 0) continue;
      const decision = iso(y, m, last), sep = /\*/.test(dt);
      out.push({ d: decision, type: "FOMC", time: "2:00 PM", label: sep ? "FOMC decision + projections, press conference" : "FOMC decision, press conference" });
      const rel = /Released ([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(t);
      out.push({ d: rel ? iso(+rel[3], mIdx(rel[1]), +rel[2]) : addDays(decision, 21), type: "MINUTES", time: "2:00 PM", label: "FOMC minutes" });
    }
  }
  return out.length >= 16 ? out : null;
};
/* ---------- BLS: archive links carry past release dates (cpi_MMDDYYYY.htm); schedule pages list upcoming ones ---------- */
const bls = (code, type, label) => async () => {
  const out = new Map();
  const arch = await get(`https://www.bls.gov/bls/news-release/${code}.htm`);
  if (arch) for (const m of arch.matchAll(new RegExp(`${code}_(\\d{2})(\\d{2})(\\d{4})\\.htm`, "g"))) out.set(`${m[3]}-${m[1]}-${m[2]}`, 1);
  const sched = await get(`https://www.bls.gov/schedule/news_release/${code}.htm`);
  if (sched) for (const m of text(sched).matchAll(/([A-Z][a-z]{2})\.? (\d{1,2}), (\d{4}) (\d{1,2}:\d{2} [AP]M)/g)) out.set(iso(+m[3], mIdx(m[1]), +m[2]), m[4].replace(/^0/, ""));
  if (out.size < 12) return null;
  return [...out.entries()].map(([d, t]) => ({ d, type, time: typeof t === "string" ? t : "8:30 AM", label }));
};
sources.cpi = bls("cpi", "CPI", "CPI inflation report");
sources.nfp = bls("empsit", "NFP", "Jobs report (nonfarm payrolls)");
sources.ppi = bls("ppi", "PPI", "PPI producer prices");
/* ---------- BEA: PCE (Personal Income and Outlays) and GDP, this year's schedule ---------- */
sources.bea = async () => {
  const h = await get("https://www.bea.gov/news/schedule/full"); if (!h) return null;
  const t = text(h), y = +((/(20\d\d) (?:Release Schedule|BEA Release Schedule)/.exec(t) || [])[1] || new Date().getUTCFullYear());
  const out = [];
  // Each entry reads "<Month> <day> <time> News <title>". GDP releases are titled "GDP (Advance Estimate), ..." etc.
  for (const m of t.matchAll(/([A-Z][a-z]+) (\d{1,2}) (\d{1,2}:\d{2} [AP]M) N ?ews (Personal Income and Outlays|GDP \((Advance|Second|Third) Estimate\))/g)){
    const mi = mIdx(m[1]); if (mi < 0) continue;
    const pce = m[4].startsWith("Personal");
    out.push({ d: iso(y, mi, +m[2]), type: pce ? "PCE" : "GDP", time: m[3], label: pce ? "PCE inflation / personal income" : `GDP (${m[5].toLowerCase()} estimate)` });
  }
  return out.length ? out : null;
};
/* ---------- NYSE holidays and 1:00 pm early closes ---------- */
sources.nyse = async () => {
  const h = await get("https://www.nyse.com/markets/hours-calendars"); if (!h) return null;
  const t = text(h), out = [];
  const head = /Holiday (\d{4}) (\d{4}) (\d{4})/.exec(t); if (!head) return null;
  const years = [+head[1], +head[2], +head[3]];
  const body = t.slice(head.index, t.indexOf("*", head.index + 30) > 0 ? t.indexOf(" * ", head.index) : head.index + 3000);
  const names = ["New Year", "Martin Luther King", "Washington", "Good Friday", "Memorial Day", "Juneteenth", "Independence Day", "Labor Day", "Thanksgiving", "Christmas"];
  for (const n of names){
    const i = body.indexOf(n); if (i < 0) continue;
    const seg = body.slice(i, i + 220), ds = [...seg.matchAll(/(?:—\*?|[A-Z][a-z]+day, ([A-Z][a-z]+) (\d{1,2}))/g)].slice(0, 3);
    ds.forEach((m, k) => { if (m[1]) out.push({ d: iso(years[k], mIdx(m[1]), +m[2]), type: "HOLIDAY", time: "", label: `Market closed (${n.replace(/ Day$/, "")})` }); });
  }
  for (const note of t.matchAll(/close early at 1:00 p\.m\.[^*]*/g))
    for (const m of note[0].matchAll(/[A-Z][a-z]+day, ([A-Z][a-z]+) (\d{1,2}), (\d{4})/g))
      out.push({ d: iso(+m[3], mIdx(m[1]), +m[2]), type: "EARLY", time: "1:00 PM", label: "Early close 1:00 pm (options 1:15)" });
  return out.length >= 8 ? out : null;
};

/* ---------- computed: monthly options expiration, quad witching, VIX expiration ---------- */
function computed(fromY, toY, holidays){
  const out = [], isHol = d => holidays.has(d);
  const thirdFri = (y, m) => { const first = new Date(Date.UTC(y, m, 1)).getUTCDay(); return iso(y, m, 1 + ((5 - first + 7) % 7) + 14); };
  const prevBiz = d => { let x = d; while (isHol(x) || [0, 6].includes(new Date(x + "T12:00:00Z").getUTCDay())) x = addDays(x, -1); return x; };
  for (let y = fromY; y <= toY; y++) for (let m = 0; m < 12; m++){
    const opex = prevBiz(thirdFri(y, m)), quad = m % 3 === 2;
    out.push({ d: opex, type: quad ? "QUAD" : "OPEX", time: "", label: quad ? "Quad witching (quarterly expiration)" : "Monthly options expiration" });
    // VIX options expire 30 days before the next month's SPX monthly expiration (a Wednesday)
    const nm = m === 11 ? [y + 1, 0] : [y, m + 1];
    out.push({ d: prevBiz(addDays(thirdFri(nm[0], nm[1]), -30)), type: "VIXEXP", time: "9:30 AM", label: "VIX expiration" });
  }
  return out;
}

let prev = [];
try { prev = JSON.parse(readFileSync(process.env.PREV_EVENTS || "prev/events.json", "utf8")).events || []; } catch {}
const events = [], status = {};
for (const [name, fn] of Object.entries(sources)){
  let got = null; try { got = await fn(); } catch (e) { console.error(`${name}: ${e.message}`); }
  if (got){ got.forEach(e => events.push({ ...e, src: name })); status[name] = `${got.length} new`; }
  else { const kept = prev.filter(e => e.src === name); kept.forEach(e => events.push(e)); status[name] = `failed, kept ${kept.length} from last run`; }
}
const hol = new Set(events.filter(e => e.type === "HOLIDAY").map(e => e.d));
const thisY = new Date().getUTCFullYear();
computed(thisY - 3, thisY + 1, hol).forEach(e => events.push({ ...e, src: "calc" }));
const seen = new Set(), clean = events.filter(e => /^\d{4}-\d{2}-\d{2}$/.test(e.d)).sort((a, b) => a.d.localeCompare(b.d) || a.type.localeCompare(b.type))
  .filter(e => { const k = e.d + e.type; if (seen.has(k)) return false; seen.add(k); return true; });
writeFileSync("events.json", JSON.stringify({ updated: new Date().toISOString(), status, events: clean }));
console.log("events.json:", JSON.stringify(status), clean.length, "events;", clean.filter(e => e.d >= new Date().toISOString().slice(0, 10)).slice(0, 12).map(e => `${e.d} ${e.type}`).join(", "));
