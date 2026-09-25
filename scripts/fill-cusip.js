// Usage: node scripts/fill-cusip.js [SYMBOL ...]
// Fills in stocks.cusips - not available from Yahoo Finance or NASDAQ Trader's listing
// files at all, so this is the only automated source in this project for that column (see
// CLAUDE.md). Lookup logic (SEC EDGAR, then quantumonline.com as fallback) lives in
// lib/cusipLookup.js, shared with the auto-fill triggered on new manual additions
// (routes/stocks.js).
//
// With no symbols given, processes every stock where cusips IS NULL. Requests are spaced
// QOL_DELAY_MS (default 500ms) apart - quantumonline.com is a small site, not an API.
require('dotenv').config();
const pool = require('../db');
const { lookupCusip, hasSecContact } = require('../lib/cusipLookup');

const DELAY_MS = Number(process.env.QOL_DELAY_MS) || 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  if (!hasSecContact) {
    console.log('WARNING: SEC_EDGAR_CONTACT is not set in .env - SEC EDGAR will reject every request with a 403.');
    console.log('Falling back to quantumonline.com only for this run.\n');
  }

  const symbols = process.argv.slice(2).map((s) => s.trim().toUpperCase());

  const { rows: stocks } = symbols.length
    ? await pool.query('SELECT id, stock_symbol FROM stocks WHERE stock_symbol = ANY($1)', [symbols])
    : await pool.query('SELECT id, stock_symbol FROM stocks WHERE cusips IS NULL ORDER BY id');

  if (symbols.length && stocks.length < symbols.length) {
    const found = new Set(stocks.map((s) => s.stock_symbol));
    for (const s of symbols) {
      if (!found.has(s)) console.log(`SKIP ${s}: not in database`);
    }
  }

  console.log(`Looking up CUSIP for ${stocks.length} stock(s) (SEC EDGAR, then quantumonline.com)...`);

  let filled = 0;
  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    const { cusip, source } = await lookupCusip(stock.stock_symbol, {
      onSourceError: (src, err) => console.log(`  (${src} lookup failed for ${stock.stock_symbol}: ${err.message})`),
    });

    if (!cusip) {
      console.log(`SKIP ${stock.stock_symbol}: not found on either source`);
    } else {
      await pool.query('UPDATE stocks SET cusips = $1, updated_at = now() WHERE id = $2', [cusip, stock.id]);
      console.log(`FILLED ${stock.stock_symbol}: ${cusip} (${source})`);
      filled++;
    }

    if (i < stocks.length - 1) await sleep(DELAY_MS);
  }

  console.log(`\nDone. Filled ${filled} of ${stocks.length}.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
