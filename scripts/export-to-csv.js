// Usage: node scripts/export-to-csv.js
// Exports the full stocks table to exports/stocks.csv (format: lib/stockCsv.js, shared with
// the stock list's "Export CSV" button).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { EXPORT_COLUMNS, toCsv } = require('../lib/stockCsv');

const OUTPUT_PATH = path.join(__dirname, '..', 'exports', 'stocks.csv');

async function main() {
  const { rows } = await pool.query(
    `SELECT ${EXPORT_COLUMNS.join(', ')} FROM stocks ORDER BY stock_symbol ASC`
  );

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, toCsv(rows), 'utf8');

  console.log(`Exported ${rows.length} stocks to ${OUTPUT_PATH}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
