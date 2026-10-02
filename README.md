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
