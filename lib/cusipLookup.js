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
const { toYahooSymbol } = require('./yahoo');

const SEC_CONTACT = process.env.SEC_EDGAR_CONTACT;
const SEC_USER_AGENT = `update-stock-app (${SEC_CONTACT || 'no-contact-set'})`;
const QOL_USER_AGENT = 'stock-symbol-manager/1.0 (personal CUSIP lookup; see github.com/victor5566/update_stock_app)';

// SEC answers bursts with HTTP 429 well below its published 10 req/s (seen when bulk-
// rechecking), and one symbol can take several requests - so space every SEC request in
// this process at least SEC_MIN_GAP_MS apart.
const SEC_MIN_GAP_MS = 170;
let secNextSlot = 0;

async function secFetch(url) {
  const now = Date.now();
  const wait = Math.max(0, secNextSlot - now);
  secNextSlot = Math.max(now, secNextSlot) + SEC_MIN_GAP_MS;
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  return fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT } });
}

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
  const res = await secFetch('https://www.sec.gov/files/company_tickers.json');
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

// A company's EDGAR listing mixes 13Gs filed *about* it (what we want - the cover page CUSIP
// is its own) with 13Gs it filed *as a holder* of other companies' stock. For banks and asset
// managers (JPM, GS, MS, BLK...) the latter dominate, and taking the newest one blindly stored
// some other issuer's CUSIP. So only accept a filing whose SUBJECT COMPANY header is this CIK.
const SEC_MAX_DOCS = 5;

async function lookupCusipFromSec(cik) {
  const listUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=SC+13G&dateb=&owner=include&count=40&output=atom`;
  const listRes = await secFetch(listUrl);
  if (!listRes.ok) throw new Error(`SEC filing list HTTP ${listRes.status}`);

  const xml = await listRes.text();
  const accessions = [...xml.matchAll(/<accession-number>([\d-]+)<\/accession-number>/g)].map((m) => m[1]);
  const cikNum = String(Number(cik));

  // An accession number starts with the submitter's CIK, so ones starting with ours were
  // filed by this company itself - skip them without downloading anything.
  const candidates = accessions.filter((a) => a.slice(0, 10) !== cik).slice(0, SEC_MAX_DOCS);

  for (const accession of candidates) {
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession.replace(/-/g, '')}/${accession}.txt`;
    const docRes = await secFetch(docUrl);
    if (!docRes.ok) throw new Error(`SEC filing document HTTP ${docRes.status}`);

    const text = await docRes.text();
    const subject = text.slice(0, 5000).match(/SUBJECT COMPANY:[\s\S]*?CENTRAL INDEX KEY:\s*(\d+)/);
    if (subject && subject[1].padStart(10, '0') === cik) {
      return extractCusip(text);
    }
  }
  return null; // no Schedule 13G/13G-A about this company among its recent filings
}

async function lookupCusipFromQuantumOnline(symbol) {
  const url = `https://www.quantumonline.com/search.cfm?tickersymbol=${encodeURIComponent(symbol)}&sopt=symbol`;
  const res = await fetch(url, { headers: { 'User-Agent': QOL_USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  // The real no-match page says "Not Found!"; a plain /not found/i also matched bank pages'
  // "Not found in FDIC ..." notes and threw away CUSIPs that were right there on the page.
  if (/Not Found!/.test(html)) return null;
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
    // SEC's ticker list writes share classes / warrants / units Yahoo-style ("BRK-B",
    // "GME-WT"); quantumonline below uses our own "BRK.B" form, so only SEC gets converted.
    const cik = tickerToCik.get(toYahooSymbol(symbol)) || tickerToCik.get(symbol);
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

module.exports = {
  lookupCusip, getTickerToCik, SEC_USER_AGENT, hasSecContact: Boolean(SEC_CONTACT),
};
