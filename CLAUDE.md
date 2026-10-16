# Spread Ledger: notes for Claude

Options-trade tracker on GitHub Pages (`index.html`, `firebase.js`, `config.js`, `view.html`, `outlook.js`, `sw.js`)
with Firebase Auth + Firestore (`firestore.rules`, published by the owner in the Firebase console; it can't be deployed from here).

## SPX outlook: owner's standing rules
- **Chart off ES, predict SPX.** All charts, indicators and swing support/resistance come from **ES futures** (`ES=F`)
  bars. They are converted to **SPX points** by subtracting the ES − SPX spread (basis) before any analysis.
  Predictions (1DTE/2DTE ranges, centers, key levels) are always stated in **SPX** terms. ES points are only an
  optional display toggle.
- Basis per trading day = median of ES − SPX over every matched 15-minute bar of the session (9:45 am–3:45 pm), where
  15-minute data exists (~60 days); older days use the ES 3–4 pm bar close minus the SPX close (noisier by ~2–5 pts,
  checked in `basis-check.mjs`). Before the open, yesterday's value; during the session, the median of the last 8 matched bars. Each ES bar has its own session's basis subtracted (this handles rolls).
- Every prediction goes in `predictions.json` on the `quotes` branch, locks at the open (1DTE: target day; 2DTE: day
  before), is scored against the actual SPX close, and the scores tune the model (`fitModel` in
  `.github/scripts/update-market.mjs`). Keep the track record and its comparison with a "last price" guess visible.
- The owner wants the default view compact: only the 1DTE and 2DTE high–low range plus 2–3 resistance and support levels
  each. Charts, indicators and GEX sit behind "Show charts & details".
- The prediction track record lives in its own dropdown ("Prediction track record"), separate from the charts. Every
  1DTE/2DTE prediction (center, 68%/84% range) sits next to that day's actual SPX close, high and low, with the miss,
  so the owner can judge how well the predictions work.
- Scheduled news is part of every prediction: `update-events.mjs` builds `events.json` (FOMC decisions and minutes from
  federalreserve.gov, CPI/jobs report/PPI from bls.gov via curl, PCE/GDP from bea.gov, NYSE holidays and early closes,
  computed opex, quad witching and VIX expiration). 1DTE/2DTE cards badge the events on their days. The 1DTE range takes
  news through VIX1D (which prices it); the 2DTE model has news terms. The News & events study (days filed under their
  main event, ratios shrunk toward 1) stays as a reference. The owner wants FOMC and FOMC minutes always called out.
- Ranges are 68% (inner) and 84% (outer). The owner moved the outer band from 90% to 84% (Oct 2026): 90% was too wide
  to collect enough premium. Older records keep their r90 band and are labeled 90%.
- Range model (Oct 2026, `vol-model.mjs`, chosen by walk-forward tests in `backtest-model.mjs` over 10+ years): unit = the
  move priced at lock time (previous close of VIX1D for 1DTE, VIX9D for 2DTE), measured from the lock-time open. 1DTE uses
  VIX1D alone (features and news dummies added nothing; VIX1D already prices news). 2DTE uses a ridge model (realized vol
  1/5/22 days, VIX9D/VIX, VIX level, gap, prior drop, FOMC/CPI/NFP/PPI/minutes, opex, Monday) that fixed under-coverage on
  FOMC days and in stressed markets. Center stays at last price + learned gamma pull: gap/momentum/mean-reversion
  centers did not beat "no change" out of sample. market.json `modelCheck` reports live walk-forward coverage; adopt a
  change only if it beats the current model on interval score at the same coverage.
- Each record logs the gamma regime at lock (`gex.total`, `flip`, `belowFlip`) and the implied move (`iv`). Once ~40 days are
  scored, test whether negative-gamma / below-flip days need wider ranges (no GEX history exists to backtest it).
- Locks must use a fresh pre-market run: 8:30 am ET data (CPI, PPI, jobs) moves the open. The track record flags
  predictions that locked on data 3+ hours old. Oct 14, 2026: CPI was missed by the calendar and the lock used 7:27 pm data.
- Failed Breakdown (Adam Mancini's public setup), coded in `backtest-fb.mjs` (swing low → flush → reclaim, targets at next
  swing highs, 75% at T1 + runner; strict variant needs a tested shelf and an elevator-down drop). Oct 2026 result: no
  significant edge vs the same trade at random bars (best +0.05R, t≈0.7, 2.5 years hourly ES). Don't present it as a
  signal unless a future test beats the random-entry control. His edge, if any, is in discretionary level choice.
- What predicts the close (`backtest-center.mjs`, Oct 2026): 32 signals known at the open (gap, VIX, SKEW, other markets,
  calendar) gave no usable edge (−0.3 pt MAE, worse last year). Time of day matters: no-change MAE 31 pts at 10 am →
  12 pts at 3 pm (hourly ES, 2 years). The 10–20 pt goal is realistic only for afternoon re-forecasts.
- The owner aims for misses within 10–20 SPX points. Report the real average miss honestly against the last-price
  baseline (~34 pts open→close for 1DTE, ~56 for 2DTE); never overstate accuracy.

## Data pipeline
- `.github/workflows/quotes.yml` ("Update option quotes") runs `update-quotes.mjs` (CBOE delayed option quotes for every
  ticker in the public `tickers` collection + SPX/XSP/RUT/NDX), `update-events.mjs` and `update-market.mjs` (Yahoo ES/SPX/VIX bars, CBOE SPX
  chain → GEX, levels, ranges). It force-pushes a single commit to the `quotes` branch, keeping files not rebuilt in that run.
- Started hourly by the owner's cron-job.org job (workflow_dispatch); GitHub's own schedule is only a backup (it runs ~2×/day).
- This session's proxy blocks CBOE/Yahoo and Actions logs. Research runs go through `.github/workflows/research.yml`
  (workflow_dispatch only: `gh workflow run research.yml`), which force-pushes results to the `research` branch (result
  files only). Don't use push-triggered probe branches: deleting one re-runs its workflow (Oct 13 it overwrote `quotes`).

## Navigation (owner's preference: a clean main page)
- `nav.js` gives the app tabs like popular trading apps: **Home** (alerts, SPX 1DTE/2DTE ranges, performance, trades),
  **Trades** (add/import, list), **Market** (outlook charts, GEX, levels, News & events, prediction track record, market
  inputs), **Stats** (timeframe, cumulative P&L, by strategy, P&L calendar) and **More** (fees, accounts, share, export,
  members, admin mode, install, sign out). Bottom tab bar on phones, tabs under the header on wider screens.
- Pull to refresh (nav.js): pulling down from the top fires a `ledger:refresh` event; data loaders (outlook.js load,
  index.html loadQuotes) push their promise into `ev.detail.wait`. New data sources should listen too.
- Each `#dash` section carries `data-views="..."`; new sections must declare which tabs they belong to. index.html exposes
  `window.LedgerApp` (read-only state + backToMine/render) for nav.js.

## Share links
- A "%" share link looks exactly like the "$" one (same cards as the app's Stats page: Net P&L, Win rate, Avg per trade
  with win/loss averages, Max drawdown peak → trough, Top strategy), except Net P&L and Max drawdown (with its peak → trough), which
  show as % of the owner's starting account size. Only those two are in % (owner's request, Oct 2026). The size isn't stored in the share record, but it can be worked out
  from the dollar figures; the share settings say so.

## Conventions
- Must work on any phone or iPad (360–1366 px wide, portrait and landscape) with no sideways page scrolling. Grids use
  `minmax(0,1fr)`, wide tables scroll inside their own box or become cards on phones. Check with the responsive audit
  (every screen at 360/375/390/430/744/820/1024/1180/1366 px) before shipping UI changes.
- Commits as Claude <noreply@anthropic.com>; never put model names in commits or code.
- Bump `CACHE` in `sw.js` whenever app files change; new app files go in its `SHELL` list.
- ntfy/config values are public: never put names, emails or other personal data in them.
