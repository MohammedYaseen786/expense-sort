# Statement Sorter — Expense Sort

Upload your bank statements (PDF or pasted text), drag each transaction into a category, and see the totals. This is the Statement Sorter page from Claude, turned into an app that runs on your own computer with a real database behind it. It's set up the same way as SoleTracker.

- **Local database:** everything is stored in one SQLite file, `data/expensesort.db`.
- **Local accounts:** sign up and log in. Passwords are hashed with scrypt, sessions use cookies, and each account only sees its own transactions.
- **Every change saves straight away.** Sorting, removing, adding, importing, and settings are all sent to the server as you go. The indicator at the top right shows *saving… / saved*.
- **Statement import:** a PDF is read in the browser, then the server picks out the transaction lines and skips any that are already in the pool.
- **Export:** a full JSON backup, or a CSV of the date range you're viewing that opens in Excel. Importing a JSON backup restores it, including backups exported from the original Claude page.
- **Demo data:** new accounts start with about 130 made-up transactions from `seed/demo-transactions.json`, so there's something to sort straight away. "Restore original" brings them back.
- **Private starter data (optional):** to start with your own transactions instead, put them in `data/private-sample-transactions.json` (same format as the demo file) and your email in `data/sample-owner.txt`. Only that account gets them, and every other account starts empty. The `data` folder is git-ignored, so this never leaves your computer.

## Running it

You need **Node.js 22.13 or newer** (it includes SQLite).

```bash
npm install
npm start          # http://127.0.0.1:3100
npm test           # API tests, run against a throwaway database
```

### Run it at http://expensesort, starting automatically (like SoleTracker)

Run these once:

```powershell
# 1. Point http://expensesort at this computer. Run from an *administrator* PowerShell:
powershell -ExecutionPolicy Bypass -File scripts\windows\add-hostname.ps1

# 2. Start the server hidden every time you log in, and add a "Statement Sorter" desktop shortcut:
powershell -ExecutionPolicy Bypass -File scripts\windows\install-autostart.ps1
```

This also installs the **Statement Sorter app**: a shortcut with its own icon on the desktop and in the Start menu. It opens in its own window (Microsoft Edge in app mode, with no tabs or address bar) and starts the server first if it isn't running. To pin it, right-click the open window's taskbar button and choose *Pin to taskbar*. To install just the app shortcut, run `scripts\windows\install-app.ps1`. To redraw the icon, run `node scripts/make-icon.js`.

The app listens on `127.0.0.2:80`. SoleTracker uses `127.0.0.1:80`, so both can run side by side.

- After changing the code: `scripts\windows\restart.ps1`
- Stop it: `scripts\windows\stop-server.ps1`
- Remove the auto-start: `scripts\windows\uninstall-autostart.ps1`
- Server log: `data\server.log`

## Your data

- Back up by copying the `data` folder (stop the server first), or use **Export everything** in the app.
- To keep the data somewhere else, such as OneDrive, set the `DATA_DIR` environment variable.
- The `data` folder is git-ignored.
- Forgot your password? Run `npm run reset-password -- you@example.com newpassword`
- To import or check a statement from the command line, run `npm run import-pdf -- you@example.com statement.pdf`. Add `--dry-run` to list what was read and its totals without saving, which is handy for comparing against the statement.

## How statements are read

`public/pdf-lines.js` turns the PDF into lines. The app and `import-pdf` both use it, and it:
- ignores sideways text, such as the reference code FNB prints down the margin;
- treats text within 2.5pt of the same height as one printed row.

`src/parse.js` then picks out the transactions. It keeps lines with no readable description, such as FNB fees whose names aren't stored as text in the PDF, and labels them "No description on statement". When the statement prints a "Statement Date", that sets the year, so December–January statements come out right.

When importing, identical charges on the same statement (e.g. three R490.64 payments on one day) are all kept. Only copies already in the app before the upload are skipped, so importing the same statement twice is safe.

## API

All endpoints except signup and login need a session cookie. Request bodies must be JSON.

| Method | Path | What it does |
|---|---|---|
| POST | `/api/auth/signup` | `{email, password, loadSample?}` (`loadSample` only applies to the owner's email) |
| POST | `/api/auth/login` · `/api/auth/logout` | |
| GET | `/api/auth/me` | |
| POST | `/api/auth/password` | `{currentPassword, newPassword}` |
| GET | `/api/state` | user, settings, categories, and all transactions |
| GET/PUT | `/api/settings` | `{currencySymbol, defaultAccount, defaultYear}` |
| GET | `/api/transactions` | filters: `from`, `to`, `category` (or `unsorted`), `account`, `q` |
| POST | `/api/transactions` | add one `{date, account, desc, amount, isCredit, category?}` |
| PATCH/DELETE | `/api/transactions/:id` | edit (e.g. `{category}`) or remove |
| POST | `/api/transactions/categorise` | `{ids, category}` (bulk; `null` un-sorts) |
| POST | `/api/transactions/reset-categories` | `{from?, to?}` |
| POST | `/api/transactions/clear` | `{confirm: true}` erases everything |
| POST | `/api/transactions/restore-sample` | `{confirm: true}` reloads the starter transactions (403 if this account has none) |
| POST | `/api/import/lines` | `{lines, account, year, source, filename?}` parses statement lines and skips duplicates |
| POST | `/api/import/backup` | `{transactions, currency?}` replaces everything with a backup |
| GET | `/api/imports` | import history |
| GET | `/api/summary` | totals by category and by month (`from`, `to`) |
| GET | `/api/export` | `format=json` or `csv` (`from`, `to`) |

Categories: `eating`, `clothing`, `business`, `petrol`, `online`, `other`, `ignore`.

## Project layout

```
server.js            HTTP server: pages, static files, sign-in redirects
src/api.js           API routes
src/db.js            SQLite connection (node:sqlite)
src/schema.js        tables: users, sessions, transactions, imports, user_settings
src/auth.js          accounts and sessions
src/parse.js         statement line parser
seed/                fictional demo transactions for new accounts
public/              the Statement Sorter page, the login page, styles
scripts/             reset-password, Windows auto-start scripts
tests/               API tests (node --test)
```
