// Shared CUSIP lookup logic used by both scripts/fill-cusip.js (bulk backfill) and the
// new-stock auto-fill triggered from routes/stocks.js (see server.js/routes/stocks.js POST
// handler). Tries two sources per symbol, in order:
//   1. SEC EDGAR: every Schedule 13G/13G-A filed about a company prints "CUSIP No. ..." on
//      its cover page - official U.S. government data with no licensing ambiguity. Requires
//      SEC_EDGAR_CONTACT in .env (a real, identifiable email) or every request 403s - see
//      https://www.sec.gov/os/webmaster-faq#developers. Not every company has a 13G on file.
//   2. quantumonline.com: a free public securities-lookup site, used as the fallback.
// Whatever is found is re-validated with lib/validateCusip.js before being returned, as a
// sanity check against either source's page format changing under us.
const { isValidCusip } = require('./validateCusip');

const SEC_CONTACT = process.env.SEC_EDGAR_CONTACT;
const SEC_USER_AGENT = `update-stock-app (${SEC_CONTACT || 'no-contact-set'})`;
const QOL_USER_AGENT = 'stock-symbol-manager/1.0 (personal CUSIP lookup; see github.com/victor5566/update_stock_app)';

function extractCusip(text) {
  // SEC filings vary in how they space "CUSIP No./Number:" from the value - some use plain
  // spaces, others HTML non-breaking-space entities or inline tags - so normalize both away
  // before matching rather than trying to enumerate every separator variant.
  const normalized = text
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  const match = normalized.match(/CUSIP\s*(?:No\.?|Number)?\s*:?\s*([0-9A-Z]{9})/i);
  return match ? match[1].toUpperCase() : null;
}

// SEC requires this file's ticker->CIK map for every automated lookup. Fetched at most once
// per process lifetime and cached, since it's an ~800KB file that rarely changes.
let tickerToCikPromise = null;

async function loadTickerToCik() {
  const res = await fetch('https://www.sec.gov/files/company_tickers.json', {
    headers: { 'User-Agent': SEC_USER_AGENT },
  });
  if (!res.ok) throw new Error(`SEC company_tickers.json HTTP ${res.status}`);
  const data = await res.json();
  const map = new Map();
  for (const entry of Object.values(data)) {
    map.set(String(entry.ticker).toUpperCase(), String(entry.cik_str).padStart(10, '0'));
  }
  return map;
}

function getTickerToCik() {
  if (!SEC_CONTACT) return Promise.resolve(new Map());
  if (!tickerToCikPromise) {
    tickerToCikPromise = loadTickerToCik().catch((err) => {
      tickerToCikPromise = null; // let the next call retry instead of caching a failure forever
      throw err;
    });
  }
  return tickerToCikPromise;
}

async function lookupCusipFromSec(cik) {
  const listUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=SC+13G&dateb=&owner=include&count=5&output=atom`;
  const listRes = await fetch(listUrl, { headers: { 'User-Agent': SEC_USER_AGENT } });
  if (!listRes.ok) throw new Error(`SEC filing list HTTP ${listRes.status}`);

  const xml = await listRes.text();
  const accessionMatch = xml.match(/<accession-number>([\d-]+)<\/accession-number>/);
  if (!accessionMatch) return null; // no Schedule 13G/13G-A on file for this company

  const accession = accessionMatch[1];
  const accessionNoDash = accession.replace(/-/g, '');
  const cikNum = String(Number(cik));
  const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accessionNoDash}/${accession}.txt`;
  const docRes = await fetch(docUrl, { headers: { 'User-Agent': SEC_USER_AGENT } });
  if (!docRes.ok) throw new Error(`SEC filing document HTTP ${docRes.status}`);

  return extractCusip(await docRes.text());
}

async function lookupCusipFromQuantumOnline(symbol) {
  const url = `https://www.quantumonline.com/search.cfm?tickersymbol=${encodeURIComponent(symbol)}&sopt=symbol`;
  const res = await fetch(url, { headers: { 'User-Agent': QOL_USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  if (/not found/i.test(html)) return null;
  return extractCusip(html);
}

// Returns { cusip, source } - cusip is null (source null too) if not found on either source,
// if lookups errored, or if what was found fails CUSIP check-digit validation. Never throws;
// pass onSourceError(sourceName, err) to observe per-source failures (used by the bulk script
// for progress diagnostics - see scripts/fill-cusip.js).
async function lookupCusip(symbol, { onSourceError } = {}) {
  let cusip = null;
  let source = null;

  try {
    const tickerToCik = await getTickerToCik();
    const cik = tickerToCik.get(symbol);
    if (cik) {
      cusip = await lookupCusipFromSec(cik);
      if (cusip) source = 'SEC';
    }
  } catch (err) {
    if (onSourceError) onSourceError('SEC', err);
  }

  if (!cusip) {
    try {
      cusip = await lookupCusipFromQuantumOnline(symbol);
      if (cusip) source = 'quantumonline.com';
    } catch (err) {
      if (onSourceError) onSourceError('quantumonline.com', err);
    }
  }

  if (cusip && !isValidCusip(cusip)) {
    return { cusip: null, source: null };
  }

  return { cusip, source };
}

module.exports = { lookupCusip, hasSecContact: Boolean(SEC_CONTACT) };
