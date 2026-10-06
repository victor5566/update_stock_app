# Stock Symbol Manager

A maintenance tool for a stock symbol list. You can view, search, add and update stocks, and the app fills in company details automatically. It does **not** handle prices or trading.

The data lives in an existing shared table, **`test.company_profiles`**, in the remote PostgreSQL database `waffle_test`. That table belongs to another system, so the app works within strict limits:

- It may only **read, insert and update** rows. It never deletes them.
- It never changes the table's columns.

Stack:

- **Backend:** Node.js + Express
- **Frontend:** none at the moment. The old frontend was removed on 2026-10-06; a new one will be built with React + Tailwind CSS.
- **External data sources:** Yahoo Finance (`yahoo-finance2`), NASDAQ Trader symbol directory, SEC EDGAR, quantumonline.com

---

## 1. Installation

### 1.1 Requirements

| Component | Version / note |
|-----------|----------------|
| Node.js   | **>= 22.8.0**. Do **not** use v22.7.0: it has a UTF-8 bug that corrupts accented names, and `db.js` refuses to start on it. |
| Database  | Network access to the PostgreSQL server that holds `company_profiles` (TCP port 5432) |
| OS        | Developed and run inside **WSL (Linux)**. Run `node` / `npm` commands from a WSL shell. |

On WSL, make sure you use the Node managed by `n` (`/usr/local/bin/node`), not the old apt package at `/usr/bin/node`.

### 1.2 Get the code and install dependencies

```bash
git clone https://github.com/victor5566/update_stock_app.git
cd update_stock_app
npm install
```

### 1.3 Configure `.env`

Copy `.env.example` to `.env` and fill in your values:

```ini
PGHOST=<database host>
PGPORT=5432
PGUSER=<login role>
PGPASSWORD=<password>
PGDATABASE=waffle_test
PGSCHEMA=test          # schema that holds company_profiles

PORT=3000
HOST=0.0.0.0                              # address to listen on (0.0.0.0 = all interfaces)

# Required by SEC EDGAR (CUSIP lookup): a real contact email for the User-Agent header
SEC_EDGAR_CONTACT=your-email@example.com
```

`.env` is gitignored. Never commit the database password.

### 1.4 Database permissions

There is nothing to create: the app only uses `company_profiles`. The login role needs `SELECT`, `INSERT` and `UPDATE` on that table, plus `USAGE` on its id sequence (`company_profile_id_seq`). It does not need, and does not use, `DELETE`.

### 1.5 Run

```bash
npm start        # production: node server.js
npm run dev      # development: restarts automatically on file changes
```

The server provides the API only, for example <http://localhost:3000/api/health> or <http://localhost:3000/api/stocks>. If `localhost` doesn't reach WSL from Windows, use the WSL IP instead, for example `http://172.18.x.x:3000`.

### 1.6 Deploy to a remote Linux server

See [docs/Deployment_Guide_en.docx](docs/Deployment_Guide_en.docx) (中文：[docs/Deployment_Guide_zh-TW.docx](docs/Deployment_Guide_zh-TW.docx)): run `deploy/setup-server.sh` once, then `deploy/deploy.sh` for each release, and `deploy/rollback.sh` to go back.

---

## 2. System features

### 2.1 Features

| Feature | What it does |
|---------|--------------|
| **Stock list** | Every row of `company_profiles` (about 79,000, including delisted and non-US stocks), paged on the server. Search by symbol or name, filter by market, and export the filtered list as CSV (UTF-8 with a BOM, so Excel shows accented names correctly). |
| **Add / update** | Add a stock with symbol, company name and market, or update one. A pre-fill lookup gives the name and market from NASDAQ Trader and Yahoo, and a duplicate check rejects a symbol a non-delisted row already has, including equivalent spellings such as `BRK-B` and `BRK.B`. |
| **Automatic detail lookup on add** | After an add, the server looks up sector, industry, CEO, address, website, description and CUSIP before it answers, waiting up to 20 seconds. The response explains anything that couldn't be found. Missing parts are retried automatically after 1, 5, 15 and 60 minutes. |
| **Stock Monitor & Auto Update** | Checks every stock against the NASDAQ Trader listing and Yahoo. It marks each stock listed or delisted, and updates the name, market, OTC Category and Currency. It also fills in missing company details and CUSIPs, a few hundred rows per run. It never deletes a stock. A preview shows what would change without writing. With `MONITOR_DAILY_AT=03:00` in `.env`, it runs automatically every day at that time. |

**Removed features.** Delete, the deletion log, the change-history pages, the manual-add log, and Re-check / removal candidates have all been removed. The app's account can't create the extra tables these features need, and it isn't allowed to delete rows. `company_profiles` records its own changes with a database audit trigger.

**One symbol, several rows.** This happens when a ticker is reused by a new company: the old company's row stays in the table, marked as delisted. When only a symbol is given (`GET /api/stocks/by-symbol/:symbol`, case-insensitive), the API picks one row in this order:

1. a row whose symbol matches the given case exactly;
2. a row that isn't delisted;
3. the newest row.

To get an exact row, use `GET /api/stocks/:id`.

### 2.2 REST API

| Method & path | Purpose |
|---------------|---------|
| `GET /api/stocks?market=&q=&page=&pageSize=` | One page of the list. Returns `{ rows, total, page, pageSize }`. `pageSize` is at most 100. |
| `GET /api/stocks/markets` | All distinct `exchange` values |
| `GET /api/stocks/suggest?q=` | Up to 20 symbols starting with `q` (for autocomplete) |
| `GET /api/stocks/export.csv?market=&q=` | Export the filtered list as CSV |
| `GET /api/stocks/:id` | One row by `company_profile_id` |
| `GET /api/stocks/by-symbol/:symbol` | The preferred row for a symbol, plus its latest auto-fill report |
| `GET /api/stocks/yahoo-lookup/:symbol` | Pre-fill data for an add (read-only). `409` if the stock already exists. |
| `POST /api/stocks` | Add a stock. Returns `409` for a duplicate. The response includes an `autofill` report. |
| `PUT /api/stocks/:id` | Update a stock |
| `POST /api/monitor/run` | Start the stock monitor. Body `{ "apply": true }` writes changes; `false` only previews. |
| `GET /api/monitor/status` | Progress of the running check, the last report and the next scheduled run |
| `GET /api/monitor/report` | The last report's per-row changes and notes |
| `POST /api/monitor/stop` | Stop the running check |
| `GET /api/health` | Liveness check (doesn't touch the database) |

There is no `DELETE` endpoint.

### 2.3 Command-line scripts (`scripts/`)

These scripts connect to the database directly. The server doesn't need to be running.

| Script | Purpose |
|--------|---------|
| `add-from-yahoo.js SYMBOL...` | Look up the given symbols on Yahoo and insert them (skipped if a non-delisted row already has the symbol) |
| `import-from-excel.js <file.xlsx>` | Bulk insert from a spreadsheet (skips symbols already present) |
| `import-nasdaq-trader.js` | Insert NASDAQ/NYSE/AMEX listings that aren't in the table yet |
| `fill-company-details.js [SYMBOL...]` | Fill in missing company details from Yahoo |
| `fill-cusip.js [SYMBOL...]` | Fill in missing CUSIPs (SEC EDGAR first, then quantumonline) |
| `audit-stocks.js [--out file.csv]` | Read-only cross-check of NASDAQ/NYSE/AMEX/OTC rows against NASDAQ Trader, SEC and Yahoo. Writes `exports/audit-report.csv`. |
| `export-to-csv.js` | Export the whole table to `exports/stocks.csv` |
| `monitor-stocks.js [--apply] [--list] [SYMBOL...]` | Run the stock monitor from the command line. Without `--apply` it only previews. `--list` prints every change. |

Run without symbols, the `fill-*` scripts process every non-delisted row with a missing value, where an empty string also counts as missing. That's tens of thousands of rows here, so passing symbols is usually what you want.

---

## 3. Database: `test.company_profiles`

The app uses this one table. It reads 16 of its 35 columns, plus `display_security` (used only to choose between rows that share a symbol). Some column names are different in the API; `lib/stockTable.js` maps them:

| Column | API field | Notes |
|--------|-----------|-------|
| `company_profile_id` | `id` | Primary key |
| `stock_symbol` | | Not unique: a reused ticker keeps its delisted row. May contain digits and `. - _ ^ = &` or spaces (`000001.SZ`, `ACIC_old`). |
| `company_name` | | |
| `exchange` | | About 157 distinct values (NASDAQ, NYSE, OTC, LSE, HKSE, Tokyo, ...). May be empty. |
| `isdelisted` | | Nullable |
| `category`, `cusips`, `sector`, `industry`, `currency`, `company_location`, `description`, `ceo` | | `cusips` may hold several space-separated values |
| `companysite` | `urll` | Company website |
| `display_security` | | Only used to choose between rows that share a symbol |
| `created_at`, `updated_at` | | `updated_at` is also maintained by a trigger |

The app doesn't touch the table's other columns (`permaticker`, `siccode`, `famasector`, `delisted_date`, ...). The table stores missing values as both `NULL` and `''`, and the app treats both as missing.

---

## 4. Project layout

```
server.js            Express app: mounts /api/stocks and /api/monitor (API only, no frontend yet)
db.js                PostgreSQL pool (reads .env; PGSCHEMA sets search_path)
lib/stockTable.js    Table name, column mapping, row-preference order for company_profiles
routes/stocks.js     The API
lib/                 Shared logic: Yahoo client, CUSIP lookup, update, detail fill, CSV
scripts/             Command-line tools
```
