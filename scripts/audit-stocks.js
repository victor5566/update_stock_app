// Usage: node scripts/audit-stocks.js [--out <path.csv>]
// Read-only cross-check of every stock's symbol / company name / exchange against two
// official sources, to catch what the Yahoo-only status check can't - e.g. BRR -> SVIA,
// where Yahoo still served the old ticker under the old name, so nothing looked wrong:
//   - NASDAQ Trader's daily symbol directory (authoritative for NASDAQ / NYSE / AMEX)
//   - SEC's company_tickers.json (official ticker -> company; also covers some OTC)
// Writes nothing to the database; prints a summary and writes one CSV row per finding.
// Finding types:
//   symbol_changed    - our symbol is gone from the listing, and the same company (by
//                       normalized name) is listed under a symbol we don't have yet
//   delisted          - our symbol is gone from the listing and no successor was found
//   name_mismatch     - at least two of Yahoo / NASDAQ Trader / SEC agree on a name that
//                       differs from ours (single-source differences are mostly formatting
//                       or stale data, so they don't count on their own)
//   name_unconfirmed  - every source that knows the symbol disagrees with us, but not with
//                       each other - worth a human look
//   truncated_name    - our name looks cut off (~30 chars) and a source has the full one
//   exchange_mismatch - symbol listed on a different exchange than we have
// OTC stocks aren't in NASDAQ Trader's files, so they get only Yahoo + SEC.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../db');
const { cleanSecurityName } = require('../lib/cleanSecurityName');
const { normalizeCompanyName, isTruncationOf, sameCompany } = require('../lib/normalizeCompanyName');
const { loadNasdaqTraderListing } = require('../lib/nasdaqTrader');
const { yf, toYahooSymbol } = require('../lib/yahoo');
const { SEC_USER_AGENT, hasSecContact } = require('../lib/cusipLookup');

const LISTED_MARKETS = new Set(['NASDAQ', 'NYSE', 'AMEX']);

// symbol -> { name (cleaned), exchange }
async function loadNasdaqTrader() {
  const listing = await loadNasdaqTraderListing();
  for (const info of listing.values()) info.name = cleanSecurityName(info.name);
  return listing;
}

// SEC ticker (dash form, "BRK-B") -> company title
async function loadSec() {
  if (!hasSecContact) return new Map();
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', { headers: { 'User-Agent': SEC_USER_AGENT } });
  if (!res.ok) throw new Error(`SEC company_tickers.json HTTP ${res.status}`);
  const map = new Map();
  for (const e of Object.values(await res.json())) map.set(String(e.ticker).toUpperCase(), e.title);
  return map;
}

// symbol -> Yahoo longName, batched like lib/checkStockStatus.js
async function loadYahooNames(symbols) {
  const names = new Map();
  for (let i = 0; i < symbols.length; i += 200) {
    const batch = symbols.slice(i, i + 200);
    try {
      const quotes = await yf.quote(batch.map(toYahooSymbol), {}, { validateResult: false });
      const byYahoo = new Map(quotes.map((q) => [q.symbol.toUpperCase(), q.longName]));
      for (const s of batch) {
        const name = byYahoo.get(toYahooSymbol(s)) || byYahoo.get(s);
        if (name) names.set(s, name);
      }
    } catch (err) {
      console.log(`Yahoo batch ${i / 200 + 1} failed: ${err.message}`);
    }
  }
  return names;
}

// "SBXD" vs "SBXD-UN", "RIV.R" vs "RIV-PA": same issuer's other securities, not a successor.
const symbolRoot = (s) => s.split(/[.-]/)[0].replace(/(W|WS|U|R|P[A-Z]?)$/, (m, _g, off) => (off >= 3 ? '' : m));

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const outIdx = process.argv.indexOf('--out');
  const outPath = outIdx > -1 ? process.argv[outIdx + 1] : path.join(__dirname, '..', 'exports', 'audit-report.csv');

  console.log('Downloading NASDAQ Trader directory and SEC ticker list...');
  const [listing, sec] = await Promise.all([loadNasdaqTrader(), loadSec()]);
  // Already-flagged delistings are known; don't keep re-reporting them.
  const { rows: stocks } = await pool.query('SELECT id, stock_symbol, company_name, exchange FROM stocks WHERE NOT isdelisted ORDER BY stock_symbol');
  const ours = new Set(stocks.map((s) => s.stock_symbol));
  console.log('Fetching Yahoo names...');
  const yahooNames = await loadYahooNames(stocks.map((s) => s.stock_symbol));

  // Listed symbols we don't have, indexed by normalized company name - successor candidates.
  const unheldByName = new Map();
  for (const [symbol, info] of listing) {
    if (ours.has(symbol)) continue;
    const key = normalizeCompanyName(info.name);
    if (!key) continue;
    if (!unheldByName.has(key)) unheldByName.set(key, []);
    unheldByName.get(key).push({ symbol, ...info });
  }
  // Same for SEC (catches renames that also changed the name, via SEC's current title).
  const secUnheldByName = new Map();
  for (const [ticker, title] of sec) {
    if (ours.has(ticker) || ours.has(ticker.replace('-', '.'))) continue;
    const key = normalizeCompanyName(title);
    if (!secUnheldByName.has(key)) secUnheldByName.set(key, []);
    secUnheldByName.get(key).push(ticker);
  }

  const findings = [];
  const add = (stock, type, detail, suggestion) =>
    findings.push({ symbol: stock.stock_symbol, company_name: stock.company_name, exchange: stock.exchange, type, detail, suggestion });

  for (const stock of stocks) {
    const secTitle = sec.get(toYahooSymbol(stock.stock_symbol)) || sec.get(stock.stock_symbol);

    if (LISTED_MARKETS.has(stock.exchange)) {
      const listed = listing.get(stock.stock_symbol);
      if (!listed) {
        const key = normalizeCompanyName(stock.company_name);
        const root = symbolRoot(stock.stock_symbol);
        const successors = [
          ...(unheldByName.get(key) || []).filter((s) => symbolRoot(s.symbol) !== root)
            .map((s) => `${s.symbol} (${s.exchange}, NASDAQ Trader)`),
          ...(secUnheldByName.get(key) || []).filter((t) => symbolRoot(t) !== root)
            .map((t) => `${t} (SEC)`),
        ];
        if (successors.length) add(stock, 'symbol_changed', 'not in NASDAQ Trader listing', [...new Set(successors)].join('; '));
        else add(stock, 'delisted', `not in NASDAQ Trader listing${secTitle ? `; SEC still maps it to "${secTitle}"` : ''}`, '');
        continue;
      }
      if (listed.exchange !== stock.exchange) {
        add(stock, 'exchange_mismatch', 'NASDAQ Trader lists it elsewhere', listed.exchange);
      }
    }

    // Names: each source alone is noisy (formatting, stale data - NASDAQ Trader still says
    // "Bunge Limited"), so a mismatch is only "confirmed" when two sources agree with each
    // other and both disagree with us. Suggestion prefers Yahoo's longName, then NASDAQ
    // Trader, then SEC (SEC titles are often all-caps/abbreviated).
    const sources = [
      ['Yahoo', yahooNames.get(stock.stock_symbol)],
      ['NASDAQ Trader', listing.get(stock.stock_symbol)?.name],
      ['SEC', secTitle],
    ].filter(([, name]) => name);

    const truncatedBy = sources.find(([, name]) => isTruncationOf(stock.company_name, name));
    if (truncatedBy) {
      add(stock, 'truncated_name', `our name looks cut off (${truncatedBy[0]})`, truncatedBy[1]);
      continue;
    }
    const disagreeing = sources.filter(([, name]) => !sameCompany(stock.company_name, name));
    if (!disagreeing.length) continue;
    const corroborated = disagreeing.find(([src, name]) =>
      disagreeing.some(([otherSrc, otherName]) => otherSrc !== src && sameCompany(name, otherName)));
    if (corroborated) {
      const agreeing = disagreeing.filter(([, name]) => sameCompany(name, corroborated[1]));
      add(stock, 'name_mismatch', `${agreeing.map(([s]) => s).join(' + ')} agree on another name`, agreeing[0][1]);
    } else if (disagreeing.length === sources.length) {
      // every source that knows this symbol disagrees, just not with each other
      add(stock, 'name_unconfirmed', disagreeing.map(([s, n]) => `${s}: ${n}`).join(' | '), '');
    }
  }

  const header = ['symbol', 'company_name', 'exchange', 'type', 'detail', 'suggestion'];
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, [header.join(','), ...findings.map((f) => header.map((h) => csvCell(f[h])).join(','))].join('\n') + '\n');

  const counts = {};
  for (const f of findings) counts[f.type] = (counts[f.type] || 0) + 1;
  console.log(`\nAudited ${stocks.length} stocks (${listing.size} listed symbols, ${sec.size} SEC tickers).`);
  console.log(counts);
  console.log(`Report: ${outPath}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
