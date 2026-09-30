// Usage: node scripts/add-from-yahoo.js AAPL MSFT KO ...
// Looks up each symbol on Yahoo Finance and inserts it directly into the stocks table.
require('dotenv').config();
const pool = require('../db');
const { lookupStock, YahooLookupError } = require('../lib/yahoo');

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
      `INSERT INTO stocks
         (stock_symbol, company_name, exchange, source, sector, industry, currency, company_location, urll, description, ceo)
       VALUES ($1, $2, $3, 'yahoo', $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        stockData.stock_symbol, stockData.company_name, stockData.exchange,
        stockData.sector, stockData.industry, stockData.currency,
        stockData.company_location, stockData.urll, stockData.description, stockData.ceo,
      ]
    );
    const row = result.rows[0];
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
