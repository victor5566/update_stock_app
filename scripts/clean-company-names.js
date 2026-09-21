// Usage: node scripts/clean-company-names.js
// One-off fix for company names already in the stocks table that still carry
// NASDAQ Trader's raw security-type suffix (e.g. "... Common Stock", "... Class A
// Ordinary Shares"). Strips the suffix via lib/cleanSecurityName and updates the row.
// Does not touch company_name_history - this is a data-quality cleanup, not a rename.
require('dotenv').config();
const pool = require('../db');
const { cleanSecurityName } = require('../lib/cleanSecurityName');

async function main() {
  const { rows } = await pool.query('SELECT id, stock_symbol, company_name FROM stocks');

  const toUpdate = [];
  for (const row of rows) {
    const cleaned = cleanSecurityName(row.company_name);
    if (cleaned !== row.company_name) {
      toUpdate.push({ id: row.id, stock_symbol: row.stock_symbol, cleaned });
    }
  }

  console.log(`${toUpdate.length} of ${rows.length} company names will be cleaned.`);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const stock of toUpdate) {
      await client.query('UPDATE stocks SET company_name = $1 WHERE id = $2', [stock.cleaned, stock.id]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`Updated ${toUpdate.length} rows.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
