// Usage: node scripts/export-to-csv.js
// Exports the full stocks table to exports/stocks.csv.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');

const OUTPUT_PATH = path.join(__dirname, '..', 'exports', 'stocks.csv');

function csvEscape(value) {
  const str = value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const { rows } = await pool.query(
    `SELECT stock_symbol, company_name, trading_market, source, created_at, updated_at
     FROM stocks ORDER BY stock_symbol ASC`
  );

  const header = ['stock_symbol', 'company_name', 'trading_market', 'source', 'created_at', 'updated_at'];
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((col) => csvEscape(row[col])).join(','));
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, lines.join('\n') + '\n', 'utf8');

  console.log(`Exported ${rows.length} stocks to ${OUTPUT_PATH}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
