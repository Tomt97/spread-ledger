// Saves 15-minute-delayed option quotes for every ticker with open trades, so the app can show P&L now.
// Runs in GitHub Actions. CBOE's public delayed-quote feed needs no key but can't be read from a browser
// on another site, so this copies the useful strikes into quotes.json on the "quotes" branch.
// Tickers: the four indexes below, plus whatever the app has listed in the public "tickers" collection.
import { readFileSync, writeFileSync } from "node:fs";

const ALWAYS = ["SPX", "XSP", "RUT", "NDX"];
const INDEXES = new Set(["SPX", "XSP", "RUT", "NDX", "VIX", "DJX", "OEX", "XEO", "MRUT", "XND"]);   // CBOE files these as _SPX etc.
const MAX_TICKERS = 60, STALE_DAYS = 45;
const out = { updated: null, src: "CBOE delayed quotes (about 15 minutes)", u: {} };

// Only during the trading day in New York, unless started by hand with "force".
const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
const mins = ny.getHours() * 60 + ny.getMinutes(), weekday = ny.getDay() >= 1 && ny.getDay() <= 5;
if (process.env.FORCE !== "true" && (!weekday || mins < 9 * 60 + 25 || mins > 16 * 60 + 35)) { console.log("Market closed; nothing to do."); process.exit(0); }

// Tickers listed by the app (read with the public web key in config.js; the rules allow reading only this list).
async function listedTickers(){
  try {
    const cfg = readFileSync("config.js", "utf8");
    const key = /apiKey:\s*"([^"]+)"/.exec(cfg)?.[1], project = /projectId:\s*"([^"]+)"/.exec(cfg)?.[1];
    if (!key || !project) return [];
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/tickers?pageSize=300&key=${key}`);
    if (!res.ok) { console.error(`tickers list: HTTP ${res.status}`); return []; }
    const docs = (await res.json()).documents || [], cutoff = Date.now() - STALE_DAYS * 864e5;
    return docs.filter(d => +(d.fields?.at?.integerValue || 0) > cutoff).map(d => d.name.split("/").pop());
  } catch (e) { console.error(`tickers list: ${e.message}`); return []; }
}
const symbols = [...new Set([...ALWAYS, ...(await listedTickers())])].filter(s => /^[A-Z0-9.]{1,8}$/.test(s)).slice(0, MAX_TICKERS);
console.log("Tickers:", symbols.join(", "));

const today = new Date(); today.setUTCHours(0, 0, 0, 0);
let total = 0;
for (const sym of symbols) {
  const idx = INDEXES.has(sym);
  const maxDays = idx ? 70 : 270, band = idx ? 0.08 : 0.25;     // indexes have far more strikes; keep the file small
  let json;
  try {
    const res = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/${idx ? "_" : ""}${sym}.json`, { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger quotes)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) { console.error(`${sym}: ${e.message}`); continue; }
  const d = json?.data, px = +d?.current_price;
  if (!d || !isFinite(px)) { console.error(`${sym}: no data`); continue; }
  const o = {};
  for (const q of d.options || []) {
    const m = /^([A-Z]+)(\d{6})([CP])(\d{8})$/.exec(q.option || ""); if (!m) continue;
    const k = +m[4] / 1000, exp = new Date(Date.UTC(2000 + +m[2].slice(0, 2), +m[2].slice(2, 4) - 1, +m[2].slice(4, 6)));
    const days = (exp - today) / 864e5;
    if (days < 0 || days > maxDays || Math.abs(k / px - 1) > band) continue;
    o[`${m[1]}${m[2]}${m[3]}${k}`] = [+q.bid || 0, +q.ask || 0];
  }
  out.u[sym] = { px, iv: isFinite(+d.iv30) ? +d.iv30 : null, t: json.timestamp || null, o };
  total += Object.keys(o).length;
  console.log(`${sym} ${px} iv30 ${d.iv30}: ${Object.keys(o).length} contracts`);
}
if (!total) { console.error("No quotes fetched"); process.exit(1); }
out.updated = new Date().toISOString();
writeFileSync("quotes.json", JSON.stringify(out));
