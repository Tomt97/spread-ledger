# Spread Ledger: notes for Claude

Options-trade tracker on GitHub Pages (`index.html`, `firebase.js`, `config.js`, `view.html`, `outlook.js`, `sw.js`)
with Firebase Auth + Firestore (`firestore.rules`, published by the owner in the Firebase console; it can't be deployed from here).

## SPX outlook: owner's standing rules
- **Chart off ES, predict SPX.** All charts, indicators and swing support/resistance come from **ES futures** (`ES=F`)
  bars. They are converted to **SPX points** by subtracting the ES − SPX spread (basis) before any analysis.
  Predictions (1DTE/2DTE ranges, centers, key levels) are always stated in **SPX** terms. ES points are only an
  optional display toggle.
- Basis per trading day = ES 1-hour bar starting 3:00 pm New York (closes 4:00 pm) minus the SPX daily close; during the
  session, the median of matching 15-minute closes. Each ES bar has its own session's basis subtracted (this handles rolls).
- Every prediction goes in `predictions.json` on the `quotes` branch, locks at the open (1DTE: target day; 2DTE: day
  before), is scored against the actual SPX close, and the scores tune the model (`fitModel` in
  `.github/scripts/update-market.mjs`). Keep the track record and its comparison with a "last price" guess visible.
- The owner wants the default view compact: only the 1DTE and 2DTE high–low range plus 2–3 resistance and support levels
  each. Charts, indicators and GEX sit behind "Show charts & details".
- The prediction track record lives in its own dropdown ("Prediction track record"), separate from the charts. Every
  1DTE/2DTE prediction (center, 68%/90% range) sits next to that day's actual SPX close, high and low, with the miss,
  so the owner can judge how well the predictions work.
- The owner aims for misses within 10–20 SPX points. Report the real average miss honestly against the ~44-point
  last-price baseline; never overstate accuracy.

## Data pipeline
- `.github/workflows/quotes.yml` ("Update option quotes") runs `update-quotes.mjs` (CBOE delayed option quotes for every
  ticker in the public `tickers` collection + SPX/XSP/RUT/NDX) and `update-market.mjs` (Yahoo ES/SPX/VIX bars, CBOE SPX
  chain → GEX, levels, ranges). It force-pushes a single commit to the `quotes` branch, keeping files not rebuilt in that run.
- Started hourly by the owner's cron-job.org job (workflow_dispatch); GitHub's own schedule is only a backup (it runs ~2×/day).
- This session's proxy blocks CBOE/Yahoo and Actions logs: test scripts on GitHub via a temporary push-triggered
  branch that commits its output, then ask the owner to delete the branch (branch deletion isn't allowed from here).

## Conventions
- Must work on any phone or iPad (360–1366 px wide, portrait and landscape) with no sideways page scrolling. Grids use
  `minmax(0,1fr)`, wide tables scroll inside their own box or become cards on phones. Check with the responsive audit
  (every screen at 360/375/390/430/744/820/1024/1180/1366 px) before shipping UI changes.
- Commits as Claude <noreply@anthropic.com>; never put model names in commits or code.
- Bump `CACHE` in `sw.js` whenever app files change; new app files go in its `SHELL` list.
- ntfy/config values are public: never put names, emails or other personal data in them.
