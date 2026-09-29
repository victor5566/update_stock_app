// Usage: node scripts/recheck-sec-cusips.js [--apply]
// One-off repair for CUSIPs written before lib/cusipLookup.js checked a 13G's SUBJECT
// COMPANY: the old code took the newest SC 13G under the company's CIK, which for banks and
// asset managers is usually one they filed as a *holder* of another company - so e.g. JPM got
// some other issuer's CUSIP. For every stock with a CUSIP and an SEC CIK, re-derives what the
// old code would have read; if that filing wasn't about the company itself, the stored CUSIP
// is suspect, and if the stored CUSIP is exactly the one that wrong filing yields, it gets
// re-looked-up with the fixed logic (set to null if nothing is found). Everything else -
// including values already corrected by hand - is left alone. Dry run unless --apply.
require('dotenv').config();
const pool = require('../db');
const { lookupCusip, getTickerToCik, SEC_USER_AGENT, hasSecContact } = require('../lib/cusipLookup');
const { toYahooSymbol } = require('../lib/yahoo');

// SEC's published limit is 10 req/s, but 4 concurrent workers already got HTTP 429s back
// within seconds, so go one at a time with a gap, and back off for a minute on a 429.
const REQUEST_GAP_MS = 250;
const RATE_LIMIT_WAIT_MS = 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function secGet(url) {
  for (let attempt = 0; ; attempt++) {
    await sleep(REQUEST_GAP_MS);
    const res = await fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT } });
    if (res.status === 429 && attempt < 5) {
      console.log(`...SEC rate limit hit, waiting ${RATE_LIMIT_WAIT_MS / 1000}s`);
      await sleep(RATE_LIMIT_WAIT_MS);
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }
}

// Mirrors the old lookupCusipFromSec's choice (newest SC 13G, count=5) and returns the
// CUSIP it would have read, but only if that filing's subject company was someone else
// (i.e. the old pick was wrong); null otherwise.
async function wrongOldPickCusip(cik) {
  const xml = await secGet(
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=SC+13G&dateb=&owner=include&count=5&output=atom`
  );
  const m = xml.match(/<accession-number>([\d-]+)<\/accession-number>/);
  if (!m) return null; // no 13G at all - the old code fell through to quantumonline
  const accession = m[1];
  const text = await secGet(
    `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${accession}.txt`
  );
  const subject = text.slice(0, 5000).match(/SUBJECT COMPANY:[\s\S]*?CENTRAL INDEX KEY:\s*(\d+)/);
  if (subject && subject[1].padStart(10, '0') === cik) return null;
  const cusip = text.replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/<[^>]+>/g, ' ')
    .match(/CUSIP\s*(?:No\.?|Number)?\s*:?\s*([0-9A-Z]{9})/i);
  return cusip ? cusip[1].toUpperCase() : null;
}

async function main() {
  if (!hasSecContact) throw new Error('SEC_EDGAR_CONTACT is not set in .env');
  const apply = process.argv.includes('--apply');
  const tickerToCik = await getTickerToCik();

  const { rows } = await pool.query(
    'SELECT id, stock_symbol, cusips FROM stocks WHERE cusips IS NOT NULL ORDER BY id'
  );
  const stocks = rows
    .map((s) => ({ ...s, cik: tickerToCik.get(toYahooSymbol(s.stock_symbol)) || tickerToCik.get(s.stock_symbol) }))
    .filter((s) => s.cik);
  console.log(`Checking ${stocks.length} stocks with an SEC CIK and a stored CUSIP...`);

  let fixes = 0;
  let errors = 0;

  for (let i = 0; i < stocks.length; i++) {
    const stock = stocks[i];
    try {
      // Only touch a stored value that *is* the bad pick's CUSIP - anything else (a manual
      // fix, a quantumonline value) didn't come from this bug and is left alone.
      if (stock.cusips === (await wrongOldPickCusip(stock.cik))) {
        const sourceErrors = [];
        const { cusip, source } = await lookupCusip(stock.stock_symbol, {
          onSourceError: (src, err) => sourceErrors.push(`${src}: ${err.message}`),
        });
        if (sourceErrors.length) {
          console.log(`SKIP ${stock.stock_symbol}: ${sourceErrors.join('; ')}`);
          errors++;
        } else if (cusip !== stock.cusips) {
          console.log(`FIX ${stock.stock_symbol}: ${stock.cusips} -> ${cusip || 'null'}${source ? ` (${source})` : ''}`);
          // Written immediately, so an interrupted run keeps what it already fixed.
          if (apply) {
            await pool.query('UPDATE stocks SET cusips = $1, updated_at = now() WHERE id = $2', [cusip, stock.id]);
          }
          fixes++;
        }
      }
    } catch (err) {
      console.log(`SKIP ${stock.stock_symbol}: ${err.message}`);
      errors++;
    }
    if ((i + 1) % 500 === 0) console.log(`...${i + 1}/${stocks.length}`);
  }

  console.log(`\n${fixes} wrong CUSIPs ${apply ? 'fixed' : 'found (dry run - re-run with --apply to fix)'}, ${errors} errors.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
