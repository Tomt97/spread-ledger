// Adds the latest daily open/close for each index to prices.json (used to close expired trades).
// Runs in GitHub Actions; Yahoo Finance's chart API needs no key.
import { readFileSync, writeFileSync } from "node:fs";

const SYMBOLS = { SPX: "^GSPC", RUT: "^RUT", NDX: "^NDX" };
const FILE = "prices.json";
const KEEP_DAYS = 800;

const data = JSON.parse(readFileSync(FILE, "utf8"));
let changed = 0;

for (const [sym, yahoo] of Object.entries(SYMBOLS)) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahoo)}?range=1mo&interval=1d`;
  let json;
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (spread-ledger price update)" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
  } catch (e) { console.error(`${sym}: ${e.message}`); continue; }
  const r = json?.chart?.result?.[0];
  if (!r) { console.error(`${sym}: no data`); continue; }
  const offset = r.meta?.gmtoffset ?? -14400;          // exchange time zone offset in seconds
  const q = r.indicators?.quote?.[0] || {};
  const book = data[sym] || (data[sym] = {});
  const today = new Date(Date.now() + offset * 1000).toISOString().slice(0, 10);
  const closedToday = new Date(Date.now() + offset * 1000).getUTCHours() >= 16;   // after 4:00 pm exchange time
  (r.timestamp || []).forEach((ts, i) => {
    const day = new Date((ts + offset) * 1000).toISOString().slice(0, 10);
    const o = q.open?.[i], c = q.close?.[i];
    if (c == null || o == null) return;
    if (day === today && !closedToday) return;          // don't store an unfinished day
    const row = [Math.round(o * 100) / 100, Math.round(c * 100) / 100];
    if (JSON.stringify(book[day]) !== JSON.stringify(row)) { book[day] = row; changed++; }
  });
  const days = Object.keys(book).sort();
  for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete book[d];
  console.log(`${sym}: ${Object.keys(book).length} days, latest ${days[days.length - 1]}`);
}

if (changed) {
  data.updated = new Date().toISOString();
  const ordered = { updated: data.updated, source: data.source };
  for (const k of Object.keys(data)) if (!(k in ordered)) ordered[k] = Object.fromEntries(Object.entries(data[k]).sort());
  writeFileSync(FILE, JSON.stringify(ordered));
}
console.log(`${changed} price rows added or changed`);
