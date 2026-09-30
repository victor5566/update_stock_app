// NASDAQ Trader's official daily symbol directory - the authoritative current listing for
// NASDAQ / NYSE / AMEX (OTC isn't in it). Shared by lib/checkStockStatus.js (to corroborate
// Yahoo's names, which go stale for recycled tickers) and scripts/audit-stocks.js.
// scripts/import-nasdaq-trader.js has its own parser (it filters ETFs for inserting).
const NASDAQ_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt';
const OTHER_LISTED_URL = 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt';
const OTHER_EXCHANGES = { N: 'NYSE', A: 'AMEX', P: 'NYSE Arca', Z: 'Cboe BZX', V: 'IEX' };

async function fetchLines(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return (await res.text()).split('\n').map((l) => l.trimEnd()).filter(Boolean);
}

// symbol -> { name (raw security name), exchange }. Test issues excluded; ETFs kept, so a
// symbol we hold that's now an ETF still counts as listed.
async function loadNasdaqTraderListing() {
  const [nasdaqLines, otherLines] = await Promise.all([fetchLines(NASDAQ_LISTED_URL), fetchLines(OTHER_LISTED_URL)]);
  const listing = new Map();
  for (const line of nasdaqLines.slice(1)) {
    if (line.startsWith('File Creation Time')) continue;
    const [symbol, name, , testIssue] = line.split('|');
    if (testIssue === 'Y') continue;
    listing.set(symbol.trim().toUpperCase(), { name, exchange: 'NASDAQ' });
  }
  for (const line of otherLines.slice(1)) {
    if (line.startsWith('File Creation Time')) continue;
    const [symbol, name, exchangeCode, , , , testIssue] = line.split('|');
    if (testIssue === 'Y') continue;
    listing.set(symbol.trim().toUpperCase(), { name, exchange: OTHER_EXCHANGES[exchangeCode] || exchangeCode });
  }
  return listing;
}

// For per-request use (the add form's pre-fill): the directory is ~13k lines across two
// files and only changes daily, so reuse it for an hour instead of re-downloading per symbol.
const CACHE_MS = 60 * 60 * 1000;
let cached = null;
let cachedAt = 0;
async function getCachedListing() {
  if (!cached || Date.now() - cachedAt > CACHE_MS) {
    cached = await loadNasdaqTraderListing();
    cachedAt = Date.now();
  }
  return cached;
}

module.exports = { loadNasdaqTraderListing, getCachedListing };
