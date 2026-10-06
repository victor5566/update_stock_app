// Usage: node scripts/import-nasdaq-trader.js
// Downloads the official NASDAQ Trader symbol directory (nasdaqlisted.txt + otherlisted.txt)
// and bulk-inserts every NASDAQ / NYSE / AMEX security into the stocks table.
// Note: this source does not cover OTC-quoted securities (those aren't "listed" on an exchange).
require('dotenv').config();
const pool = require('../db');
const { TABLE, ID } = require('../lib/stockTable');
const { cleanSecurityName } = require('../lib/cleanSecurityName');

const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';

const SYMBOL_RE = /^[A-Za-z.-]{1,10}$/;

async function fetchLines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  return text.split('\n').map((l) => l.trimEnd()).filter(Boolean);
}

function parseNasdaqListed(lines) {
  const rows = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('File Creation Time')) continue;
    const cols = line.split('|');
    const [symbol, securityName, , testIssue, , , etf] = cols;
    if (testIssue === 'Y' || etf === 'Y') continue;
    rows.push({
      stock_symbol: symbol.trim().toUpperCase(),
      company_name: cleanSecurityName(securityName),
      exchange: 'NASDAQ',
    });
  }
  return rows;
}

function parseOtherListed(lines) {
  const rows = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('File Creation Time')) continue;
    const cols = line.split('|');
    const [actSymbol, securityName, exchangeCode, , etf, , testIssue] = cols;
    if (testIssue === 'Y' || etf === 'Y') continue;
    const exchange = exchangeCode === 'N' ? 'NYSE' : exchangeCode === 'A' ? 'AMEX' : null;
    if (!exchange) continue;
    rows.push({
      stock_symbol: actSymbol.trim().toUpperCase(),
      company_name: cleanSecurityName(securityName),
      exchange,
    });
  }
  return rows;
}

async function main() {
  console.log('Downloading NASDAQ Trader symbol directory...');
  const [nasdaqLines, otherLines] = await Promise.all([
    fetchLines(NASDAQ_LISTED_URL),
    fetchLines(OTHER_LISTED_URL),
  ]);

  const parsed = [...parseNasdaqListed(nasdaqLines), ...parseOtherListed(otherLines)];

  const bySymbol = new Map();
  let invalidSymbolCount = 0;
  for (const stock of parsed) {
    if (!SYMBOL_RE.test(stock.stock_symbol)) {
      invalidSymbolCount++;
      continue;
    }
    bySymbol.set(stock.stock_symbol, stock);
  }

  const stocks = [...bySymbol.values()];
  console.log(`Parsed ${stocks.length} valid unique symbols (${invalidSymbolCount} skipped for unsupported symbol format).`);

  const client = await pool.connect();
  let inserted = 0;
  let skippedExisting = 0;
  try {
    await client.query('BEGIN');
    for (const stock of stocks) {
      const result = await client.query(
        // Symbols aren't unique in company_profiles, so skip any symbol already present (in
        // any row) instead of relying on ON CONFLICT.
        `INSERT INTO ${TABLE} (stock_symbol, company_name, exchange)
         SELECT $1, $2, $3
         WHERE NOT EXISTS (SELECT 1 FROM ${TABLE} WHERE stock_symbol = $4)
         RETURNING ${ID}`,
        // Symbol passed twice: a reused parameter can't get one inferred type, and casts
        // need pg_catalog access this role lacks.
        [stock.stock_symbol, stock.company_name, stock.exchange, stock.stock_symbol]
      );
      if (result.rows.length) inserted++;
      else skippedExisting++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`Inserted ${inserted} new stocks. Skipped ${skippedExisting} already in the database.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
