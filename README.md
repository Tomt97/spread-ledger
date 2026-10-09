# Spread/Ledger

Options trade tracker. Paste a thinkorswim order, track it to the close or to expiration, and see
P&L, win rate, average per trade, max drawdown, top strategy, breakevens, chance of profit,
payoff graphs and OptionStrat links. Each member has a private dashboard; the master account
can review every member and edit or remove trades in Admin mode.

Hosting: GitHub Pages (free). Login + database: Firebase Spark plan (free).

## Setup (about 15 minutes, one time)

### 1. Firebase project
1. Go to https://console.firebase.google.com and choose **Create a project** (Analytics is optional).
2. **Build → Authentication → Get started.** Enable **Email/Password** and **Google**.
3. **Build → Firestore Database → Create database.** Choose *production mode* and a location near you.
4. In Firestore, open the **Rules** tab, replace everything with the contents of `firestore.rules`, and **Publish**.
5. **Project settings (gear) → General → Your apps → Web (`</>`)**. Register an app (no Hosting needed),
   then copy the `firebaseConfig` values into `config.js`.

### 2. GitHub Pages
1. Create a new **public** repository at https://github.com/new (for example `spread-ledger`).
2. Upload `index.html`, `firebase.js`, `config.js`, `firestore.rules` and `README.md`
   (**Add file → Upload files**), then commit.
3. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)` → Save.**
   After a minute your site is at `https://<your-github-username>.github.io/spread-ledger/`.

### 3. Allow the site to sign people in
Firebase → **Authentication → Settings → Authorized domains → Add domain** → `<your-github-username>.github.io`.

### 4. Make yourself the master account
1. Open the site, choose **Create an account**, and sign up.
2. A yellow box shows **Your user ID**. Copy it.
3. Paste it into `config.js` (`OWNER_UID`) **and** into `firestore.rules` (replace `PASTE_YOUR_USER_ID`).
4. Upload the new `config.js` to GitHub, and publish the updated rules in Firebase → Firestore → Rules.
5. Reload the site. You now see **My dashboard | Members** and the **Admin mode** switch.

Share the site link with your members. When someone signs up they see **Waiting for approval**.
You'll see a **pending** badge on **Members**; click **Approve** (or **Decline**). Their dashboard
opens for them automatically once approved. **Remove access** takes an approved member back out.

## Phone app
The site installs as an app (a Progressive Web App). It uses the same login and data as the website,
so trades entered on the phone show up on the computer and the other way around.

- **iPhone / iPad:** open the site in **Safari** → **Share** → **Add to Home Screen** → **Add**.
- **Android:** open the site in **Chrome** → tap **Install app** at the top of the page
  (or the ⋮ menu → **Install app** / **Add to Home screen**).

Sign in once inside the installed app. On phones the trades list shows as cards, and trade details,
imports and settings open full screen. App updates arrive automatically the next time it opens
with a connection.

## Sign-up alerts
- **In the app (no setup):** while you have the site or app open, a new sign-up shows a banner with
  **Review**, a count on the browser tab, and a notification if you click **Turn on sign-up alerts**.
- **Phone push (no account):** install the free **ntfy** app (iPhone/Android), tap **+**, and subscribe
  to the topic in `config.js` (`SIGNUP_ALERT_NTFY_TOPIC`). Each sign-up sends one push that says someone
  is waiting (no names or emails, since `config.js` is public). Tapping it opens the site.
- **By email (2-minute setup):** create a free form at https://formspree.io using the email that
  should receive alerts, then put its ID (the part after `/f/`) in `config.js` as
  `SIGNUP_ALERT_FORMSPREE`. Each new sign-up then emails you once. Free plan: 50 emails a month.

## P&L now on open trades (15-minute delayed)
Open trades in **any optionable ticker** (SPX, XSP, RUT, NDX, QQQ, SPY, stocks and so on) show **P&L now**: each leg
priced at the mid of its bid and ask. **Market inputs** fill in each ticker's price and 30-day implied volatility
automatically, so chance of profit works without typing (anything you type wins until newer quotes arrive).

How it works: the app lists the ticker symbols that have open trades in the public `tickers` collection
(symbols only, nothing about who holds them). The GitHub Action **Update option quotes**
(`.github/workflows/quotes.yml`) fetches CBOE's free delayed quotes for those tickers and SPX/XSP/RUT/NDX. It saves
near-term strikes to `quotes.json` on the `quotes` branch, replacing the one commit there each time, and the app reads that file.

**One-time setup:**
1. **Publish the rules again.** `firestore.rules` now includes `tickers`. In Firebase, go to **Firestore Database → Rules**,
   paste the file, then click **Publish**.
2. **Make it run every hour.** GitHub's own schedule often runs only once or twice a day on small repositories,
   so a free [cron-job.org](https://cron-job.org) job starts the Action instead:
   - On GitHub: profile picture → **Settings → Developer settings → Personal access tokens → Fine-grained tokens →
     Generate new token**. Set the name to `spread-ledger quotes`. Under **Repository access**, choose **Only select repositories** → `spread-ledger`.
     Under **Permissions → Repository permissions**, set **Actions: Read and write** and leave everything else as is. Generate it and copy it.
   - On cron-job.org (free account): **Create cronjob**.
     - URL: `https://api.github.com/repos/Tomt97/spread-ledger/actions/workflows/quotes.yml/dispatches`.
     - Schedule: every hour, Monday–Friday, from 9 to 16, time zone America/New_York.
     - Under **Advanced**, set the request method to **POST** and the request body to `{"ref":"main"}`.
     - Add these headers:
       - `Authorization: Bearer <your token>`
       - `Accept: application/vnd.github+json`
       - `Content-Type: application/json`
     - Click **Test run**. It should answer **204**, and a new run shows under **Actions** on GitHub.
   The token can only start Actions in this one repository. Delete it on GitHub to stop the job at any time.

The app shows the time of the quotes next to each number. On GitHub, **Actions → Update option quotes → Run workflow**
also refreshes them on demand. GitHub stops schedules in a public repository after 60 days without a commit, but the
cron-job.org trigger keeps working.

## SPX outlook (top of the dashboard)
A collapsible section with ES futures charts (15 min, 1 h, 2 h, 4 h, daily) converted to SPX points,
EMA 20/50/200, VWAP, RSI, support/resistance from swing highs and lows, prior-day and overnight levels,
pivots, SPX gamma exposure by strike (call wall, put wall, zero-gamma flip) and 1DTE/2DTE ranges for SPX.
**Show prices in ES points** adds the spread back.

- **ES to SPX:** each day's ES − SPX spread is measured at the 4:00 pm close (ES's 3–4 pm bar against the SPX
  close), and during the session from matching 15-minute bars. Each ES bar has its own day's spread subtracted, which
  also takes care of quarterly contract rolls.
- **Ranges:** the at-the-money straddle for each expiration gives the implied move. The widths are calibrated by
  how big moves really were, compared with VIX1D (1 day) and VIX9D (2 days), over the last two years.
- **Prediction log:** every range is saved to `predictions.json` on the `quotes` branch. It keeps updating until it locks:
  1DTE at the target day's 9:30 am open, 2DTE at the open the day before. After the target day's close it is
  scored: points missed and whether the close landed inside the 68% and 90% ranges. After 8 scored days the model
  learns how far closes move toward the biggest nearby gamma strike, and any steady bias. After 15 it also re-fits
  the range widths. The section shows the average miss next to a "last price" guess, so you can see whether the
  model is earning its keep.

It is built by the same **Update option quotes** Action, so the hourly cron-job.org trigger keeps it fresh. ES trades
nearly around the clock, so you can also run that job overnight (Sunday 6 pm to Friday 5 pm New York time).
Delayed data, for study only.

## Share your progress (read-only links)
**Share progress** (next to Export to Excel) creates links like
`https://<you>.github.io/spread-ledger/view.html?s=<random code>`, each for one account (or all combined).
Make as many as you like and send each person the one you want them to see.
Anyone with the link sees P&L, win rate, drawdown, the cumulative and monthly charts, the calendar,
strategy results and, by default, every trade in that account with strikes, entry and exit prices,
fees, order text and a payoff graph (or choose a summary list, or no list). They can't add or change
anything, and opening the link while signed in to their own account doesn't affect it. Your email and
other accounts are never included. The page
refreshes itself whenever you open the app; **Stop sharing** turns that link off.
Requires the `shares` rule in `firestore.rules` to be published in Firebase.

## Who can do what
| | Member | Master (you) |
|---|---|---|
| Add trades, record exits, reopen an exit | Own dashboard | Own dashboard; any member in Admin mode |
| Edit or remove a single trade | No | Admin mode only |
| Create / rename account tabs | Yes | Yes |
| Delete an account tab (and its trades) | Yes | Yes |
| Delete whole membership | Yes (erases data and login) | No |
| See other members | No | Members view |
| Approve / decline / remove access | No | Members view |

The database rules (`firestore.rules`) make each member's data readable only by that member and you,
and only after you approve them. Sign-ups can't approve themselves.
The "no edit/remove" limits for members are enforced by the page; the rules let members write their
own area so they can add trades.

## Free-plan limits (Firebase Spark)
50,000 document reads and 20,000 writes per day, 1 GiB stored, 50,000 monthly sign-ins.
If a daily limit is reached, Firebase pauses that feature until the next day instead of charging.
Check https://firebase.google.com/pricing for current numbers.

## Notes
- `config.js` values are not secrets; Firebase security comes from `firestore.rules`.
- Chance of profit uses a lognormal model with one implied volatility you enter (no skew).
- Live market data (hourly SPX/VIX, GEX, ES levels) is not included yet.
