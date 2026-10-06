// Usage: node scripts/add-from-yahoo.js AAPL MSFT KO ...
// Looks up each symbol on Yahoo Finance and inserts it directly into company_profiles
// (skipped if a live row already has the symbol).
require('dotenv').config();
const pool = require('../db');
const { lookupStock, YahooLookupError } = require('../lib/yahoo');
const { TABLE, SELECT_COLUMNS } = require('../lib/stockTable');

async function addSymbol(symbol) {
  let stockData;
  try {
    stockData = await lookupStock(symbol.toUpperCase());
  } catch (err) {
    if (err instanceof YahooLookupError) {
      console.log(`SKIP ${symbol}: ${err.message}`);
      return;
    }
    throw err;
  }

  try {
    const result = await pool.query(
      `INSERT INTO ${TABLE}
         (stock_symbol, company_name, exchange, sector, industry, currency, company_location, companysite, description, ceo)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10
       WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE stock_symbol = $11 AND NOT coalesce(isdelisted, false))
       RETURNING ${SELECT_COLUMNS}`,
      // The symbol goes in twice ($1, $11): one parameter used in both places can't get a
      // single inferred type, and explicit casts need pg_catalog access this role lacks.
      [
        stockData.stock_symbol, stockData.company_name, stockData.exchange,
        stockData.sector, stockData.industry, stockData.currency,
        stockData.company_location, stockData.urll, stockData.description, stockData.ceo,
        stockData.stock_symbol,
      ]
    );
    const row = result.rows[0];
    if (!row) {
      console.log(`SKIP ${stockData.stock_symbol}: already exists`);
      return;
    }
    console.log(`ADDED ${row.stock_symbol} - ${row.company_name} (${row.exchange})`);
  } catch (err) {
    if (err.code === '23505') {
      console.log(`SKIP ${stockData.stock_symbol}: already exists`);
      return;
    }
    throw err;
  }
}

async function main() {
  const symbols = process.argv.slice(2);
  if (!symbols.length) {
    console.error('Usage: node scripts/add-from-yahoo.js SYMBOL [SYMBOL ...]');
    process.exit(1);
  }

  for (const symbol of symbols) {
    await addSymbol(symbol);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
