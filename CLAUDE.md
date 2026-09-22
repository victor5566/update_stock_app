# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A stock symbol maintenance app for US markets (NASDAQ/NYSE/AMEX/OTC): a plain Node.js/Express backend, a no-build-step vanilla HTML/CSS/JS frontend, and PostgreSQL storage. Its purpose is upkeep of a symbol/company-name/market list — manual CRUD, bulk import, and automated drift-checking against Yahoo Finance — not trading or price data.

## Commands

```bash
npm install
npm start          # node server.js
npm run dev         # node --watch server.js
```

No test suite or lint script is configured.

The app is developed and run inside WSL (Linux), even though the project directory is on the Windows filesystem (`/mnt/c/Users/...` from WSL). Run all `node`/`npm`/`psql` commands from a WSL shell, not PowerShell.

### Database

`sql/schema.sql` is the single source of truth for the schema and is written to be safely re-run after any change (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` + re-add) — there is no migration framework, just re-apply this file:

```bash
psql -h localhost -U <role> -d <db> -f sql/schema.sql
```

PostgreSQL runs locally in WSL. The app connects over TCP (`localhost:5432`) with password auth via a dedicated role, not the `postgres` superuser and not peer auth — connection settings come from `.env` (see `.env.example`), read by `db.js`.

### Git

The repo's `origin` is https://github.com/victor5566/update_stock_app (branch `main`). Pushes are done from a Windows-side shell (PowerShell), not WSL — the WSL environment has no GitHub credentials configured, but Windows git already has a cached credential for this account via Git Credential Manager.

## Architecture

**`stocks`** is the core table (`stock_symbol` UNIQUE, `company_name`, `trading_market` CHECK'd to the 4 markets, `source` CHECK'd to `manual | yahoo | excel_import | nasdaq_trader`). Five auxiliary tables hang off it:
- `company_name_history` / `stock_symbol_history` — append-only audit log of renames, written transactionally, `stock_id` FK `ON DELETE CASCADE` (history disappears if the stock is later deleted).
- `stock_update_candidates` / `stock_removal_candidates` — a snapshot, not a log: `scripts/check-stock-status.js` `TRUNCATE`s and fully repopulates both on every run. Also `ON DELETE CASCADE`, so deleting a stock that happens to be a removal candidate silently drops it from that list too.
- `stock_deletion_log` — the one exception: **no FK to `stocks`**, by design, since these rows must outlive the stock they describe.

**Two transactional diff-and-log mechanisms are the core non-obvious pattern**:
- **Updates**: `lib/applyStockUpdate.js` holds the shared core — `SELECT ... FOR UPDATE`s the current row, applies the update, diffs old vs. new `company_name`/`stock_symbol`, and conditionally inserts into the two history tables. It expects to run inside a transaction the *caller* owns (`BEGIN`/`COMMIT`/`ROLLBACK` + `client.connect`/`release`). Two callers use it: `PUT /api/stocks/:id` (one stock, from the web form) and `scripts/apply-update-candidates.js` (bulk, one candidate row at a time from `stock_update_candidates`). If you add a third way to update a stock, call this instead of re-inlining the diff logic.
- **Deletes**: `DELETE /api/stocks/:id` (`routes/stocks.js`) deletes the row (`RETURNING` its data) and inserts that data into `stock_deletion_log`, in the same transaction. Not yet extracted to `lib/` since there's only one caller.

Any future change to how stocks are updated or deleted needs to preserve these steps, since they're the only thing populating the history/log tables. Both paths sanitize text through a `Buffer.from(str,'utf8').toString('utf8')` round-trip before writing history rows — accented company names (Latin American ADRs, etc.) have tripped a node-postgres encoding edge case here before.

**`source` tracks provenance**, not just for record-keeping: the "manual add log" UI section is literally `GET /api/stocks?source=manual`. Only `POST /api/stocks` (the web form) sets `source='manual'`; each of the import scripts stamps its own source value. If you add a new way to insert stocks, make sure it sets `source` correctly or it will silently pollute the manual-add log.

**Routes** (`routes/*.js`) are each mounted in `server.js` under their own path prefix (`/api/stocks`, `/api/company-name-history`, `/api/stock-symbol-history`, `/api/removal-candidates`, `/api/stock-deletion-log`). `routes/stocks.js` also owns `GET /api/stocks/by-symbol/:symbol`, used by every lookup-before-edit flow on the frontend (rename / change-symbol / delete-by-symbol forms all use a text input + shared `#stock-datalist` autocomplete, deliberately not a `<select>`, per prior feedback in this project).

**`lib/yahoo.js`** centralizes the `yahoo-finance2` client and `EXCHANGE_TO_MARKET` (Yahoo's exchange codes like `NMS`/`NYQ`/`ASE`/`PNK` → our 4-market enum). Both `scripts/add-from-yahoo.js` (single-symbol lookups) and `scripts/check-stock-status.js` (bulk audit) import from here rather than duplicating the mapping.

**`lib/normalizeCompanyName.js`** vs. **`lib/cleanSecurityName.js`** solve two different problems and are not interchangeable:
- `normalizeCompanyName` collapses a name to a lossy comparison fingerprint (strips noise words, then *all* whitespace) — used only by the status checker to decide whether two names are "the same" (e.g. NASDAQ Trader's "JP Morgan Chase & Co. Common Stock" vs. Yahoo's "JPMorgan Chase & Co." must compare equal).
- `cleanSecurityName` produces a real display name by stripping the trailing security-type descriptor (" Common Stock", " - Class A Ordinary Shares", " Depositary Shares, each representing...", etc.) while keeping normal spacing — used when *writing* `company_name` (`scripts/import-nasdaq-trader.js` and the one-off `scripts/clean-company-names.js`), not for comparison.

**`scripts/`** are standalone maintenance tools that talk to Postgres directly (each does its own `require('../db')` + `dotenv.config()`) and are meant to be run from the CLI, independent of the running server — not exposed through the web UI or API by design:
- `add-from-yahoo.js SYMBOL...` — look up and insert specific symbols.
- `import-from-excel.js <path.xlsx>` — bulk import from a spreadsheet (header aliases are matched loosely; later duplicate rows for the same symbol win).
- `import-nasdaq-trader.js` — downloads NASDAQ Trader's official listing files and bulk-inserts all NASDAQ/NYSE/AMEX securities, cleaning names via `cleanSecurityName` on the way in. Does **not** cover OTC (that data isn't in an exchange-listing feed); OTC coverage currently comes only from Excel imports.
- `clean-company-names.js` — one-off backfill that re-runs `cleanSecurityName` over every existing row and updates `company_name` where it changed. Does **not** touch `company_name_history` — this is a data-quality fix, not a rename, so it shouldn't show up as one.
- `check-stock-status.js` — batches all DB symbols through `yf.quote()` (200 at a time) and rebuilds the two candidate tables (`TRUNCATE` + full repopulate, so it's always a fresh snapshot, not additive). Pass `{}, { validateResult: false }` as `yf.quote()`'s 3rd arg, or one malformed instrument in a batch of 200 silently drops the entire batch. Re-run this after any bulk company-name cleanup, since messy names inflate false-positive `company_name_mismatch` candidates.
- `apply-update-candidates.js` — reads every row out of `stock_update_candidates` and applies it to `stocks` via `applyStockUpdate` (so it still gets logged to history), then deletes the row it just applied. Only touches `stock_update_candidates`; `stock_removal_candidates` is intentionally left alone since deleting stocks is a separate, more consequential decision the UI leaves to a human.
- `export-to-csv.js` — dumps the full `stocks` table to `exports/stocks.csv` (committed to the repo, not gitignored). Re-run and re-commit after any bulk data change if you want the export to stay current; nothing does this automatically.

**Frontend** (`public/`) is a single `index.html` + `app.js`, no bundler/framework. Notable patterns to follow if extending it:
- i18n is a `TRANSLATIONS` object (zh/en) applied via `data-i18n` / `data-i18n-placeholder` attributes and a `t()` lookup — not a library.
- Every list section (stock list, company-name history, symbol history, manual-add log, removal candidates, deletion log — 6 total) paginates client-side at `PAGE_SIZE = 15`, each with its own page-state variable and render function, duplicated per-section rather than abstracted into a shared helper. The two history API endpoints used to `LIMIT 200`; that cap was removed once pagination existed, so don't re-add a server-side limit without also handling it client-side.
- The three lookup-before-edit forms (rename, change-symbol, delete) each follow the same shape: a symbol input with datalist autocomplete, a "查詢/Lookup" button that `GET`s `by-symbol` and disables/enables the rest of the form, a "清空/Clear" button that calls that form's `reset*Form()`, and a submit that does the actual `PUT`/`DELETE`. Copy this shape rather than inventing a new one if adding a fourth.
- Stock-symbol inputs use `class="uppercase"` (CSS `text-transform`, display-only) rather than mutating the input value on keystroke.
