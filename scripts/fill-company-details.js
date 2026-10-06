// Usage: node scripts/fill-company-details.js [SYMBOL ...]
// Looks up each symbol on Yahoo Finance and fills in company_profiles' extended detail
// columns (sector/industry/currency/company_location/companysite/description/ceo) directly - see
// lib/fillCompanyDetails.js for the shared fetch+write logic (also used by the auto-fill
// triggered on new manual additions in routes/stocks.js).
// With no symbols given, processes every non-delisted stock missing any of those detail fields (not just
// sector - plenty of stocks have a sector but no CEO/description/address). Existing values
// are never cleared, only filled in or refreshed.
// Requests are spaced YAHOO_DELAY_MS (default 200ms) apart to avoid tripping Yahoo's
// unofficial API's rate limiting on a large batch run.
require('dotenv').config();
const pool = require('../db');
const { fillCompanyDetails } = require('../lib/fillCompanyDetails');
const { TABLE, ID } = require('../lib/stockTable');

const DELAY_MS = Number(process.env.YAHOO_DELAY_MS) || 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const symbols = process.argv.slice(2).map((s) => s.trim().toUpperCase());

  // Empty strings count as missing too (the table holds both). Delisted rows are skipped
  // unless named explicitly.
  const { rows: stocks } = symbols.length
    ? await pool.query(`SELECT ${ID} AS id, stock_symbol, company_name FROM ${TABLE} WHERE upper(stock_symbol) = ANY($1)`, [symbols])
    : await pool.query(
        `SELECT ${ID} AS id, stock_symbol, company_name FROM ${TABLE}
         WHERE NOT coalesce(isdelisted, false)
           AND (NULLIF(sector, '') IS NULL OR NULLIF(industry, '') IS NULL OR NULLIF(currency, '') IS NULL
             OR NULLIF(company_location, '') IS NULL OR NULLIF(companysite, '') IS NULL
             OR NULLIF(description, '') IS NULL OR NULLIF(ceo, '') IS NULL)
         ORDER BY ${ID}`
      );

  if (symbols.length && stocks.length < symbols.length) {
    const found = new Set(stocks.map((s) => s.stock_symbol.toUpperCase()));
    for (const s of symbols) {
      if (!found.has(s)) console.log(`SKIP ${s}: not in database`);
    }
  }

  console.log(`Filling company details for ${stocks.length} stock(s)...`);

  let filled = 0;
  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    try {
      if (await fillCompanyDetails(pool, stock)) {
        console.log(`FILLED ${stock.stock_symbol}`);
        filled++;
      } else {
        console.log(`SKIP ${stock.stock_symbol}: no details available from Yahoo Finance`);
      }
    } catch (err) {
      console.log(`SKIP ${stock.stock_symbol}: ${err.message}`);
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
