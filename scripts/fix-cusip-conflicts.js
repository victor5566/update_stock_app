// Usage: node scripts/fix-cusip-conflicts.js [--plan path.json] [--apply]
// One-off repair for CUSIPs written before lib/cusipLookup.js learned to (a) reject the
// "000000000" placeholder, (b) vote across 13Gs and check their "(Name of Issuer)", (c) skip
// SEC for preferreds/notes/warrants (which got the parent's common CUSIP), and before
// fill-cusip.js / the add auto-fill checked findCusipConflict (quantumonline's own pages
// carry other companies' CUSIPs), and before multi-class companies skipped SEC (FOX and
// FOXA got one CUSIP). Suspects are stored CUSIPs that are placeholders or are shared with
// another stock (see the exception below); each is re-looked-up
// with the fixed logic. If the new value would still collide, a non-SEC value gives way
// first, then an SEC one - so a collision always ends as null, never as a guess.
//
// Lookups take a while (SEC is paced), so --plan saves the looked-up results to a file on the
// first run and reuses them on the next: review a dry run, then re-run with --apply.
require('dotenv').config();
const fs = require('fs');
const pool = require('../db');
const { lookupCusip, isNonCommonSecurity, hasSecContact } = require('../lib/cusipLookup');
const { isValidCusip } = require('../lib/validateCusip');
const { loadNasdaqTraderListing } = require('../lib/nasdaqTrader');
const { sameCompany } = require('../lib/normalizeCompanyName');

const QOL_DELAY_MS = 500;
const RATE_LIMIT_WAIT_MS = 60 * 1000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function lookupWithRetry(stock, listing) {
  for (let attempt = 0; ; attempt++) {
    const errors = [];
    const result = await lookupCusip(stock.stock_symbol, {
      companyName: stock.company_name,
      listing,
      onSourceError: (src, err) => errors.push(`${src}: ${err.message}`),
    });
    if (!errors.length) return result;
    if (attempt < 3 && errors.some((e) => /429/.test(e))) {
      console.log(`...rate limited, waiting ${RATE_LIMIT_WAIT_MS / 1000}s`);
      await sleep(RATE_LIMIT_WAIT_MS);
      continue;
    }
    return { error: errors.join('; ') };
  }
}

async function main() {
  if (!hasSecContact) throw new Error('SEC_EDGAR_CONTACT is not set in .env');
  const apply = process.argv.includes('--apply');
  const planPath = argValue('--plan');

  const listing = await loadNasdaqTraderListing();
  const rawName = (sym) => (listing.get(sym) ? listing.get(sym).name : undefined);

  const { rows: stocks } = await pool.query(
    'SELECT id, stock_symbol, company_name, cusips FROM stocks WHERE cusips IS NOT NULL ORDER BY id'
  );
  const byCusip = new Map();
  for (const s of stocks) byCusip.set(s.cusips, [...(byCusip.get(s.cusips) || []), s]);

  // Two symbols never share a CUSIP (see findCusipConflict), with one exception for deciding
  // *who* is wrong: a common stock whose CUSIP is only "shared" with its own preferreds/
  // notes/warrants is most likely right - it's the siblings that got it wrongly - so it's
  // left alone (a re-lookup could regress it to a pre-split / pre-merger number).
  const isCommon = (s) => !isNonCommonSecurity(s.stock_symbol, s.company_name, rawName(s.stock_symbol));
  const keepsAgainst = (s, o) => isCommon(s) && !isCommon(o) && sameCompany(s.company_name, o.company_name);
  const suspects = stocks.filter((s) => !isValidCusip(s.cusips)
    || byCusip.get(s.cusips).some((o) => o.id !== s.id && !keepsAgainst(s, o)));
  console.log(`${suspects.length} suspect CUSIPs out of ${stocks.length}.`);

  // symbol -> { cusip, source } | { error }
  let plan = {};
  if (planPath && fs.existsSync(planPath)) {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
    console.log(`Using looked-up results from ${planPath}.`);
  }
  for (let i = 0; i < suspects.length; i++) {
    const s = suspects[i];
    if (plan[s.stock_symbol]) continue;
    plan[s.stock_symbol] = await lookupWithRetry(s, listing);
    if (planPath) fs.writeFileSync(planPath, JSON.stringify(plan, null, 1)); // survive an interrupted run
    if ((i + 1) % 50 === 0) console.log(`...${i + 1}/${suspects.length}`);
    await sleep(QOL_DELAY_MS);
  }

  // Final state: suspects take their new value, everything else keeps its stored one.
  const suspectIds = new Set(suspects.map((s) => s.id));
  const next = new Map(stocks.map((s) => [s.id, s.cusips]));
  const sourceOf = new Map();
  for (const s of suspects) {
    const r = plan[s.stock_symbol];
    if (r.error) continue; // lookup failed - leave as is, decide on a later run
    next.set(s.id, r.cusip);
    sourceOf.set(s.id, r.source);
  }
  const collides = (s) => stocks.some((o) => o.id !== s.id && next.get(o.id) === next.get(s.id) && !keepsAgainst(s, o));
  for (const pass of ['nonSec', 'sec']) {
    // Decide the whole pass from one snapshot: two equally-trusted values that collide
    // (ADAG and CASIF both got G1933S101 from SEC) both go, rather than whichever was
    // checked second surviving.
    const drop = suspects.filter((s) => next.get(s.id) && sourceOf.has(s.id)
      && (sourceOf.get(s.id) === 'SEC') === (pass === 'sec') && collides(s));
    for (const s of drop) {
      next.set(s.id, null);
      sourceOf.set(s.id, `${sourceOf.get(s.id)}, dropped: collides`);
    }
  }

  let changes = 0;
  let errors = 0;
  for (const s of stocks) {
    if (!suspectIds.has(s.id)) continue;
    if (plan[s.stock_symbol].error) {
      console.log(`SKIP ${s.stock_symbol}: ${plan[s.stock_symbol].error}`);
      errors++;
      continue;
    }
    const value = next.get(s.id);
    if (value === s.cusips) continue;
    console.log(`FIX ${s.stock_symbol}: ${s.cusips} -> ${value || 'null'} (${sourceOf.get(s.id) || 'not found'})`);
    if (apply) {
      // Only if nobody changed it since this run read it.
      await pool.query('UPDATE stocks SET cusips = $1, updated_at = now() WHERE id = $2 AND cusips = $3', [value, s.id, s.cusips]);
    }
    changes++;
  }

  console.log(`\n${changes} CUSIPs ${apply ? 'fixed' : 'to fix (dry run - re-run with --apply)'}, ${errors} skipped on lookup errors.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
