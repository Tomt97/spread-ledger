// Saves 15-minute-delayed option quotes for the indexes the tracker uses, so open trades can show P&L now.
// Runs in GitHub Actions; CBOE's public delayed-quote feed needs no key but can't be read from a browser
// on another site, so the Action copies the near-term strikes into quotes.json on the "quotes" branch.
import { writeFileSync } from "node:fs";

const SYMBOLS = ["SPX", "XSP", "RUT", "NDX"];
const MAX_DAYS = 70;      // expirations within this many days
const BAND = 0.08;        // strikes within 8% of the index
const out = { updated: null, src: "CBOE delayed quotes (about 15 minutes)", u: {} };

// Only bother during the trading day in New York (the schedule is in UTC and runs a little wide).
const ny = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
const mins = ny.getHours() * 60 + ny.getMinutes(), weekday = ny.getDay() >= 1 && ny.getDay() <= 5;
if (process.env.FORCE !== "1" && (!weekday || mins < 9 * 60 + 25 || mins > 16 * 60 + 35)) { console.log("Market closed; nothing to do."); process.exit(0); }

const today = new Date(); today.setUTCHours(0, 0, 0, 0);
let total = 0;
for (const sym of SYMBOLS) {
  let json;
  try {
    const res = await fetch(`https://cdn.cboe.com/api/global/delayed_quotes/options/_${sym}.json`, { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger quotes)" } });
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
    if (days < 0 || days > MAX_DAYS || Math.abs(k / px - 1) > BAND) continue;
    o[`${m[1]}${m[2]}${m[3]}${k}`] = [+q.bid || 0, +q.ask || 0];
  }
  out.u[sym] = { px, t: json.timestamp || null, o };
  total += Object.keys(o).length;
  console.log(`${sym} ${px}: ${Object.keys(o).length} contracts`);
}
if (!total) { console.error("No quotes fetched"); process.exit(1); }
out.updated = new Date().toISOString();
writeFileSync("quotes.json", JSON.stringify(out));
