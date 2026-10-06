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
const { TABLE, ID } = require('./stockTable');

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

// SEC filings vary in how they space "CUSIP No./Number:" from the value - some use plain
// spaces, others HTML non-breaking-space entities or inline tags - so normalize both away
// before matching rather than trying to enumerate every separator variant.
function normalizeFilingText(text) {
  return text
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
    .replace(/&amp;|&#38;/gi, '&')
    .replace(/<[^>]+>/g, ' ');
}

function extractCusip(text) {
  const normalized = normalizeFilingText(text);
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
// The header alone isn't enough either: filers mis-tag it - Norges Bank's 13G "about" PLUG
// is about Rubrik, and GSK's own 13G on its Wave stake (filed via an agent) names GSK as the
// subject. So the cover page's "(Name of Issuer)" must also be the subject company (any of
// its header names, incl. former ones) or companyName.
const SEC_MAX_DOCS = 5;

function secSubjectNames(text) {
  const header = text.split('</SEC-HEADER>')[0];
  const subject = header.split('SUBJECT COMPANY:')[1];
  if (!subject) return [];
  return [...subject.split('FILED BY:')[0].matchAll(/CONFORMED NAME:\s*(.+)/g)].map((m) => m[1].trim());
}

function coverIssuerName(normalized) {
  const at = normalized.search(/\(\s*Name\s+of\s+(?:the\s+)?Issuer\s*\)/i);
  if (at < 0) return null;
  const lines = normalized.slice(Math.max(0, at - 400), at).replace(/_+/g, ' ')
    .split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return lines.pop() || null;
}

function secIssuerMatches(text, companyName) {
  const issuer = coverIssuerName(normalizeFilingText(text));
  if (!issuer) return true; // cover page laid out some other way - nothing to check against
  const names = [...secSubjectNames(text), companyName].filter(Boolean);
  return names.some((name) => nameMentions(issuer, name) || nameMentions(name, issuer));
}

async function lookupCusipFromSec(cik, companyName) {
  const listUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=SC+13G&dateb=&owner=include&count=40&output=atom`;
  const listRes = await secFetch(listUrl);
  if (!listRes.ok) throw new Error(`SEC filing list HTTP ${listRes.status}`);

  const xml = await listRes.text();
  const accessions = [...xml.matchAll(/<accession-number>([\d-]+)<\/accession-number>/g)].map((m) => m[1]);
  const cikNum = String(Number(cik));

  // An accession number starts with the submitter's CIK, so ones starting with ours were
  // filed by this company itself - skip them without downloading anything.
  const candidates = accessions.filter((a) => a.slice(0, 10) !== cik).slice(0, SEC_MAX_DOCS);

  // Even with the right issuer name on the cover, filers paste the wrong CUSIP: one of PLUG's
  // 13Gs prints Rubrik's, two of GROY's print NexGen's. So read every candidate and vote by
  // *issuer* (the first 6 characters; newest wins a tie), then take that issuer's newest
  // CUSIP - a reverse split or reorg changes the issue number (SMCI 86800U104 -> 86800U302),
  // and older filings with the old number shouldn't outvote the new one. A lone 1-vs-1
  // disagreement between issuers can't be settled, so that's "not found", not a coin flip.
  const votes = []; // newest first
  let aboutCompany = 0;
  for (const accession of candidates) {
    const docUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accession.replace(/-/g, '')}/${accession}.txt`;
    const docRes = await secFetch(docUrl);
    if (!docRes.ok) throw new Error(`SEC filing document HTTP ${docRes.status}`);

    const text = await docRes.text();
    const subject = text.slice(0, 5000).match(/SUBJECT COMPANY:[\s\S]*?CENTRAL INDEX KEY:\s*(\d+)/);
    if (!subject || subject[1].padStart(10, '0') !== cik) continue;
    aboutCompany++;
    if (!secIssuerMatches(text, companyName)) continue;
    // Old filings sometimes print a placeholder ("000000000") - not a vote.
    const cusip = extractCusip(text);
    if (cusip && isValidCusip(cusip)) votes.push(cusip);
  }

  const issuerCounts = new Map(); // insertion order = newest first
  for (const cusip of votes) issuerCounts.set(cusip.slice(0, 6), (issuerCounts.get(cusip.slice(0, 6)) || 0) + 1);
  let bestIssuer = null;
  let bestCount = 0;
  for (const [issuer, count] of issuerCounts) {
    if (count > bestCount) [bestIssuer, bestCount] = [issuer, count];
  }
  // The reason codes are shown in the UI when an add can't fill the CUSIP (see routes/stocks.js).
  if (bestCount === 1 && issuerCounts.size > 1) return { cusip: null, reason: 'conflicting_13g' };
  if (bestIssuer) return { cusip: votes.find((cusip) => cusip.startsWith(bestIssuer)) };
  return { cusip: null, reason: aboutCompany ? 'unusable_13g' : 'no_13g' };
}

// quantumonline is keyed by ticker, so a recycled ticker can still show its previous owner:
// FGC (FG Nexus) returned "NextEra Energy Capital Holdings, 6.60% Series A ... Ticker Symbol:
// FGC* CUSIP: 65339K308". The page puts the security's name right before "Ticker Symbol:";
// when the caller knows the company name, require the first distinctive word of it
// ("nexus", "berkshire", "jpmorgan") to appear there, else the CUSIP isn't trusted.
const NAME_STOPWORDS = new Set(['the', 'inc', 'corp', 'corporation', 'company', 'ltd', 'limited', 'plc', 'llc',
  'holdings', 'holding', 'group', 'and', 'incorporated', 'common', 'stock', 'class', 'new']);

function qolSecurityName(html) {
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+/g, ' ');
  const at = text.search(/Ticker Symbol:/i);
  if (at < 0) return null;
  const before = text.slice(Math.max(0, at - 200), at);
  return before.split(/-->|\bLOGIN\b/).pop().trim() || null;
}

function nameMentions(pageName, companyName) {
  const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const word = fold(companyName).split(/[^a-z0-9]+/).find((w) => w.length >= 3 && !NAME_STOPWORDS.has(w));
  if (!word) return true; // nothing distinctive to check (e.g. a 2-letter name)
  return fold(pageName).replace(/[^a-z0-9]/g, '').includes(word);
}

async function lookupCusipFromQuantumOnline(symbol, companyName) {
  const url = `https://www.quantumonline.com/search.cfm?tickersymbol=${encodeURIComponent(symbol)}&sopt=symbol`;
  const res = await fetch(url, { headers: { 'User-Agent': QOL_USER_AGENT } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const html = await res.text();
  // The real no-match page says "Not Found!"; a plain /not found/i also matched bank pages'
  // "Not found in FDIC ..." notes and threw away CUSIPs that were right there on the page.
  if (/Not Found!/.test(html)) return { cusip: null, reason: 'not_found' };
  if (companyName) {
    const pageName = qolSecurityName(html);
    if (!pageName || !nameMentions(pageName, companyName)) {
      return { cusip: null, reason: 'name_mismatch', detail: pageName };
    }
  }
  const cusip = extractCusip(html);
  return cusip ? { cusip } : { cusip: null, reason: 'no_cusip_on_page' };
}

// Preferreds, notes, warrants, units and rights have CUSIPs of their own, but SEC's ticker map
// points them at the parent's CIK, whose 13Gs are about the common stock - so the SEC source
// handed AGNCN, RILYN, SOJC... the common's CUSIP. Recognized by the security name (NASDAQ
// Trader's raw name says "Depositary Shares ... Preferred", "Senior Notes due 2029",
// "Warrants"; our cleaned company_name usually doesn't) or a dot suffix (NE.W, KCA.U, CELG.R).
// Kept narrow on purpose: "Unit Corporation", "Preferred Bank", "... Preferred Income Fund"
// (a fund's common shares) and an MLP's "Common Units" / "Limited Partnership Units" are
// common equity.
const NON_COMMON_NAME = /\b(warrants?|rights|preferred (?:stock|shares|securities|class|series)|perpetual preferred|pfd|notes?|debentures?|mortgage bonds|subordinated|parrs)\b|\bdeposi[a-z]+ shares? .*\bpreferred\b|\bunits?,? (?:each )?consisting\b|(?<!(?:common|partnership)\s)\b(?:unit|right|warrant)s?\.?\s*$|capital trust\s+[IVX]+\b|\bnt\s+\d{4}\b|\d%|\bdue\s+(?:\w+\s+)?\d{4}\b/i;

// A name that ends by calling itself common stock is (BNS's listing reads "Bank Nova Scotia
// Halifax Pfd 3 Ordinary Shares") - unless it's a right/warrant/unit *on* those shares.
const COMMON_NAME = /\b(?:common|ordinary) (?:stock|shares)\s*$/i;
const DERIVATIVE_WORD = /\b(?:warrants?|rights?|units?)\b/i;

// securityName (NASDAQ Trader's raw name) is the better evidence when there is one - our
// cleaned company_name can mislead ("... Preferred Securities Income Fund" is FFC's common).
function isNonCommonSecurity(symbol, companyName, securityName) {
  const name = securityName || companyName;
  if (/\.(W|WS|U|R|RT)$/i.test(symbol)) return true;
  if (!name || !NON_COMMON_NAME.test(name)) return false;
  return !COMMON_NAME.test(name) || DERIVATIVE_WORD.test(name);
}

// Another stock already holding `cusip`, or null. A CUSIP identifies one security, so two of
// our symbols never legitimately share one - not a different issuer (quantumonline printed
// Copart's CUSIP on CSQR's page, Outset's on TELO's), not a preferred and its common, not
// two share classes (FOX / FOXA). If the other stock's value is the wrong one, fix it there
// first; this deliberately doesn't guess which side is right. Delisted rows don't count: the
// table keeps them, and a symbol change leaves the same CUSIP on the old, delisted row. A
// stored value may hold several space-separated CUSIPs.
async function findCusipConflict(pool, cusip, { stockId } = {}) {
  const { rows } = await pool.query(
    `SELECT ${ID} AS id, stock_symbol, company_name FROM ${TABLE}
     WHERE $1 = ANY(regexp_split_to_array(cusips, '\\s+')) AND ${ID} <> $2
       AND NOT coalesce(isdelisted, false)
     LIMIT 1`,
    [cusip, stockId || 0]
  );
  return rows[0] || null;
}

// Several common-stock classes under one CIK (UHAL / UHAL.B, LILA / LILAK, GOOG / GOOGL):
// each class has its own CUSIP, but the company's 13Gs don't say which of our tickers they
// cover - UHAL.B was handed UHAL's. Siblings come from SEC's ticker map and count only if
// NASDAQ Trader lists them as common, so preferred tickers under the same CIK don't.
const cikTickersCache = new WeakMap();
function hasCommonSibling(tickerToCik, cik, symbol, listing) {
  if (!cikTickersCache.has(tickerToCik)) {
    const byCik = new Map();
    for (const [ticker, c] of tickerToCik) byCik.set(c, [...(byCik.get(c) || []), ticker]);
    cikTickersCache.set(tickerToCik, byCik);
  }
  return (cikTickersCache.get(tickerToCik).get(cik) || []).some((ticker) => {
    const ours = ticker.replace(/-/g, '.');
    if (ours === symbol || ticker === toYahooSymbol(symbol)) return false;
    const listed = listing.get(ours) || listing.get(ticker);
    return listed && !isNonCommonSecurity(ours, null, listed.name);
  });
}

// Returns { cusip, source, reasons } - cusip is null (source null too) if not found on either
// source, if lookups errored, or if what was found fails CUSIP check-digit validation.
// `reasons` says why each source tried came up empty, as [{ source, code, detail? }] - the
// add form shows them (codes: SEC no_contact / no_cik / skipped_non_common /
// skipped_multi_class / no_13g / unusable_13g / conflicting_13g; quantumonline.com not_found /
// name_mismatch / no_cusip_on_page; either error / invalid_check_digit). Never throws; pass
// onSourceError(sourceName, err) to observe per-source failures (used by the bulk script for
// progress diagnostics - see scripts/fill-cusip.js). Pass companyName whenever known: it
// guards the quantumonline fallback against recycled tickers (see qolSecurityName above), and
// SEC against mis-tagged filings. Pass listing (lib/nasdaqTrader.js) when available, or at
// least securityName (NASDAQ Trader's raw name), so a preferred/note/warrant - or one of
// several share classes - skips SEC (see isNonCommonSecurity / hasCommonSibling). Callers
// should still run findCusipConflict before writing - quantumonline's own data has wrong
// CUSIPs on it.
async function lookupCusip(symbol, { onSourceError, companyName, securityName, listing } = {}) {
  const reasons = [];
  if (!securityName && listing && listing.get(symbol)) securityName = listing.get(symbol).name;

  // Each source returns { cusip, reason?, detail? }; a found value still has to pass the check digit.
  const trySource = async (source, fn) => {
    try {
      const r = await fn();
      if (r.cusip && isValidCusip(r.cusip)) return { cusip: r.cusip, source, reasons };
      reasons.push({ source, code: r.cusip ? 'invalid_check_digit' : r.reason, detail: r.detail });
    } catch (err) {
      reasons.push({ source, code: 'error', detail: err.message });
      if (onSourceError) onSourceError(source, err);
    }
    return null;
  };

  if (isNonCommonSecurity(symbol, companyName, securityName)) {
    reasons.push({ source: 'SEC', code: 'skipped_non_common' });
  } else if (!SEC_CONTACT) {
    reasons.push({ source: 'SEC', code: 'no_contact' });
  } else {
    const found = await trySource('SEC', async () => {
      const tickerToCik = await getTickerToCik();
      // SEC's ticker list writes share classes / warrants / units Yahoo-style ("BRK-B",
      // "GME-WT"); quantumonline below uses our own "BRK.B" form, so only SEC gets converted.
      const cik = tickerToCik.get(toYahooSymbol(symbol)) || tickerToCik.get(symbol);
      if (!cik) return { cusip: null, reason: 'no_cik' };
      if (listing && hasCommonSibling(tickerToCik, cik, symbol, listing)) return { cusip: null, reason: 'skipped_multi_class' };
      return lookupCusipFromSec(cik, companyName);
    });
    if (found) return found;
  }

  const found = await trySource('quantumonline.com', () => lookupCusipFromQuantumOnline(symbol, companyName));
  return found || { cusip: null, source: null, reasons };
}

module.exports = {
  lookupCusip, findCusipConflict, isNonCommonSecurity, getTickerToCik, SEC_USER_AGENT, hasSecContact: Boolean(SEC_CONTACT),
};
