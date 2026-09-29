// Cross-checks every stock in the database against Yahoo Finance and rebuilds two
// review lists: stock_update_candidates (likely name/market change) and
// stock_removal_candidates (no longer found / no longer a supported equity).
// This only writes to those two tables - it never changes the stocks table itself.
// Shared by scripts/check-stock-status.js and POST /api/removal-candidates/refresh.
const { yf, marketLabelForQuote, toYahooSymbol } = require('./yahoo');
const { companyNamesMatch, sameCompany } = require('./normalizeCompanyName');
const { loadNasdaqTraderListing } = require('./nasdaqTrader');
const { sanitizeText } = require('./sanitizeText');

const BATCH_SIZE = 200;
const LISTED_MARKETS = new Set(['NASDAQ', 'NYSE', 'AMEX']);

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function checkStockStatus(pool, { log = () => {} } = {}) {
  const { rows: stocks } = await pool.query(
    'SELECT id, stock_symbol, company_name, exchange FROM stocks ORDER BY id'
  );
  log(`Checking ${stocks.length} stocks against Yahoo Finance...`);

  // Yahoo's names go stale on recycled tickers (DPU kept "DB Commodity Long ETN" long after
  // it became Top KingWin; RCD still reads as an Invesco ETF), and the re-check button
  // auto-applies suggestions - so for listed stocks a rename also needs NASDAQ Trader's
  // official listing to agree, or it would revert names corrected from that listing.
  let listing = null;
  try {
    listing = await loadNasdaqTraderListing();
  } catch (err) {
    log(`NASDAQ Trader listing unavailable (${err.message}) - name suggestions will be Yahoo-only`);
  }
  const nameChangeCorroborated = (stock, yahooName) => {
    if (!listing || !LISTED_MARKETS.has(stock.exchange)) return true; // OTC etc.: Yahoo is all we have
    const listed = listing.get(stock.stock_symbol);
    if (!listed) return false; // exchange-listed but missing from the listing - nothing to corroborate with
    return !sameCompany(stock.company_name, listed.name) && sameCompany(yahooName, listed.name);
  };

  const updateCandidates = [];
  const removalCandidates = [];

  const batches = chunk(stocks, BATCH_SIZE);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    const symbols = batch.map((s) => s.stock_symbol);

    let quotes;
    try {
      quotes = await yf.quote(symbols.map(toYahooSymbol), {}, { validateResult: false });
    } catch (err) {
      log(`Batch ${i + 1}/${batches.length} failed: ${err.message}`);
      continue;
    }

    const bySymbol = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q]));

    for (const stock of batch) {
      // Yahoo answers under its own form ("BRK-B"), occasionally echoing ours ("BRK.B").
      const quote = bySymbol.get(toYahooSymbol(stock.stock_symbol)) || bySymbol.get(stock.stock_symbol);

      if (!quote) {
        removalCandidates.push({ stock, reason: 'not_found_on_yahoo' });
        continue;
      }

      if (quote.quoteType !== 'EQUITY') {
        removalCandidates.push({ stock, reason: 'no_longer_equity' });
        continue;
      }

      const suggestedExchange = marketLabelForQuote(quote);
      // longName only: when Yahoo has no longName its shortName is a 31-char truncation or an
      // abbreviation ("Ocean Capital Acquisition Corpo", "Comp En De Mn Cemig ADS"), and since
      // the re-check button applies suggestions automatically, those must never be proposed.
      const suggestedName = quote.longName || stock.company_name;

      // Yahoo occasionally returns a quote with no exchange info at all (seen with BF.A);
      // that's "unknown", not a mismatch, so fall through to the name check instead.
      if (suggestedExchange && suggestedExchange !== stock.exchange) {
        updateCandidates.push({
          stock,
          reason: 'exchange_mismatch',
          suggestedName: stock.company_name,
          suggestedExchange,
        });
      } else if (!companyNamesMatch(stock.company_name, suggestedName) && nameChangeCorroborated(stock, suggestedName)) {
        updateCandidates.push({
          stock,
          reason: 'company_name_mismatch',
          suggestedName,
          suggestedExchange: stock.exchange,
        });
      }
    }

    log(`Checked batch ${i + 1}/${batches.length} (${symbols.length} symbols)`);
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
            current_exchange, suggested_exchange)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          c.stock.id,
          c.stock.stock_symbol,
          c.reason,
          sanitizeText(c.stock.company_name),
          sanitizeText(c.suggestedName),
          c.stock.exchange,
          c.suggestedExchange,
        ]
      );
    }

    for (const c of removalCandidates) {
      await client.query(
        `INSERT INTO stock_removal_candidates
           (stock_id, stock_symbol, company_name, exchange, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [c.stock.id, c.stock.stock_symbol, sanitizeText(c.stock.company_name), c.stock.exchange, c.reason]
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  return { updateCount: updateCandidates.length, removalCount: removalCandidates.length };
}

module.exports = { checkStockStatus };
