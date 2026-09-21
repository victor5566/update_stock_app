// Usage: node scripts/check-stock-status.js
// Cross-checks every stock in the database against Yahoo Finance and rebuilds two
// review lists: stock_update_candidates (likely name/market change) and
// stock_removal_candidates (no longer found / no longer a supported equity).
// This only writes to those two tables - it never changes the stocks table itself.
require('dotenv').config();
const pool = require('../db');
const { yf, EXCHANGE_TO_MARKET } = require('../lib/yahoo');
const { companyNamesMatch } = require('../lib/normalizeCompanyName');

const BATCH_SIZE = 200;

// Yahoo occasionally returns names with unpaired UTF-16 surrogates, which node-postgres
// encodes as invalid UTF-8 bytes and Postgres then rejects. Round-tripping through a
// Buffer replaces anything invalid with the standard U+FFFD replacement character.
function sanitizeText(str) {
  return Buffer.from(String(str), 'utf8').toString('utf8');
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function main() {
  const { rows: stocks } = await pool.query(
    'SELECT id, stock_symbol, company_name, trading_market FROM stocks ORDER BY id'
  );
  console.log(`Checking ${stocks.length} stocks against Yahoo Finance...`);

  const updateCandidates = [];
  const removalCandidates = [];

  const batches = chunk(stocks, BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const symbols = batch.map((s) => s.stock_symbol);

    let quotes;
    try {
      quotes = await yf.quote(symbols, {}, { validateResult: false });
    } catch (err) {
      console.error(`Batch ${i + 1}/${batches.length} failed: ${err.message}`);
      continue;
    }

    const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

    for (const stock of batch) {
      const quote = bySymbol.get(stock.stock_symbol);

      if (!quote) {
        removalCandidates.push({ stock, reason: 'not_found_on_yahoo' });
        continue;
      }

      if (quote.quoteType !== 'EQUITY') {
        removalCandidates.push({ stock, reason: 'no_longer_equity' });
        continue;
      }

      const suggestedMarket = EXCHANGE_TO_MARKET[quote.exchange];
      if (!suggestedMarket) {
        removalCandidates.push({ stock, reason: 'unsupported_exchange' });
        continue;
      }

      const suggestedName = quote.longName || quote.shortName || stock.company_name;

      if (suggestedMarket !== stock.trading_market) {
        updateCandidates.push({
          stock,
          reason: 'market_mismatch',
          suggestedName: stock.company_name,
          suggestedMarket,
        });
      } else if (!companyNamesMatch(stock.company_name, suggestedName)) {
        updateCandidates.push({
          stock,
          reason: 'company_name_mismatch',
          suggestedName,
          suggestedMarket: stock.trading_market,
        });
      }
    }

    console.log(`Checked batch ${i + 1}/${batches.length} (${symbols.length} symbols)`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('TRUNCATE stock_update_candidates');
    await client.query('TRUNCATE stock_removal_candidates');

    for (const c of updateCandidates) {
      await client.query(
        `INSERT INTO stock_update_candidates
           (stock_id, stock_symbol, reason, current_company_name, suggested_company_name,
            current_trading_market, suggested_trading_market)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          c.stock.id,
          c.stock.stock_symbol,
          c.reason,
          sanitizeText(c.stock.company_name),
          sanitizeText(c.suggestedName),
          c.stock.trading_market,
          c.suggestedMarket,
        ]
      );
    }

    for (const c of removalCandidates) {
      await client.query(
        `INSERT INTO stock_removal_candidates
           (stock_id, stock_symbol, company_name, trading_market, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [c.stock.id, c.stock.stock_symbol, sanitizeText(c.stock.company_name), c.stock.trading_market, c.reason]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nDone. ${updateCandidates.length} update candidates, ${removalCandidates.length} removal candidates.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
