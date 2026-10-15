// Shared CUSIP lookup logic used by both scripts/fill-cusip.js (bulk backfill) and the
// new-stock auto-fill triggered from routes/stocks.js (see server.js/routes/stocks.js POST
// handler). Tries two sources per symbol, in order:
//   1. SEC EDGAR: every Schedule 13G/13G-A filed about a company carries its CUSIP (the cover
//      page's "CUSIP No. ..." in the old text form, <issuerCusipNumber> in the structured form
//      used since late 2024) - official U.S. government data with no licensing ambiguity. Requires
//      SEC_EDGAR_CONTACT in .env (a real, identifiable email) or every request 403s - see
//      https://www.sec.gov/os/webmaster-faq#developers. Not every company has a 13G on file.
//   2. SEC EDGAR 13F holdings reports: every institution managing $100M+ files its holdings
//      each quarter as a structured table (issuer name, class, CUSIP). Found by EDGAR's
//      full-text search on the company name; covers what 13G doesn't - foreign issuers
//      (Locafy, LCFY: Q56120134), small caps no one holds 5% of.
//   3. quantumonline.com: a free public securities-lookup site, used as the last fallback.
// Whatever is found is re-validated with lib/validateCusip.js before being returned, as a
// sanity check against either source's page format changing under us.
const { isValidCusip, looksLikePaddedSedol } = require('./validateCusip');
const { toYahooSymbol } = require('./yahoo');
const { TABLE, ID } = require('./stockTable');
const { sameCompany, similarNames, isWordAbbreviationOf, companyNamesMatch } = require('./normalizeCompanyName');
const { applyStockUpdate } = require('./applyStockUpdate');

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

// The 13G forms filed about a company, from SEC's per-company filing index (one JSON request).
// It lists both formats: "SC 13G" (free text, until late 2024) and "SCHEDULE 13G" (structured
// XML, since then - the old browse-edgar query by type "SC 13G" never saw these, so every CUSIP
// found came from 2024 or earlier).
const FORM_13G = /^(SC 13G|SCHEDULE 13G)(\/A)?$/;

async function loadSecFilings(cik) {
  const res = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
  if (!res.ok) throw new Error(`SEC filing list HTTP ${res.status}`);
  const data = await res.json();
  const recent = (data.filings && data.filings.recent) || {};
  const filings = (recent.form || []).map((form, i) => ({ form, accession: recent.accessionNumber[i], date: recent.filingDate[i] }))
    .filter((f) => FORM_13G.test(f.form));
  const names = [data.name, ...(data.formerNames || []).map((n) => n.name)].filter(Boolean);
  return { filings, names }; // newest first, as SEC lists them
}

// A structured SCHEDULE 13G names the issuer in fields of its own: <issuerCik>, <issuerName>,
// <issuerCusipNumber>. Still filer-entered, so the same checks as the text form apply.
const xmlValues = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`, 'g'))].map((m) => m[1]);
function decodeXml(v) {
  return v.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

// Returns { cusip, filedAt, structured } or { cusip: null, reason }. filedAt / structured are
// those of the newest filing that printed the CUSIP returned.
// SEC's ticker list can still map a recycled ticker to its previous owner: BTA (Beacon Tactical
// Alternatives Risk ETF) -> BlackRock Long-Term Municipal Advantage Trust, whose own 13Gs then pass
// every check below (they are about that CIK and name it) - so 09250B103 replaced the ETF's
// 664925765 on 2026-10-14. So the CIK's names (current or former) must name our company first;
// if not, SEC is skipped as uncertain (the user, 2026-10-15) and 13F is asked instead.
function secNamesMatch(secNames, companyName) {
  if (!companyName) return true;
  return secNames.some((n) => nameMentions(n, companyName) || nameMentions(companyName, n) || f13NameMatches(n, companyName));
}

async function lookupCusipFromSec(cik, companyName) {
  const { filings, names: secNames } = await loadSecFilings(cik);
  if (!secNamesMatch(secNames, companyName)) return { cusip: null, reason: 'cik_name_mismatch', detail: secNames[0] };
  const cikNum = String(Number(cik));

  // An accession number starts with the submitter's CIK, so ones starting with ours were
  // filed by this company itself (as a holder of someone else's stock) - skip them without
  // downloading anything.
  const candidates = filings.filter((f) => f.accession.slice(0, 10) !== cik).slice(0, SEC_MAX_DOCS);

  // Even with the right issuer name on the cover, filers paste the wrong CUSIP: one of PLUG's
  // 13Gs prints Rubrik's, two of GROY's print NexGen's. So read every candidate and vote by
  // *issuer* (the first 6 characters; newest wins a tie), then take that issuer's newest
  // CUSIP - a reverse split or reorg changes the issue number (SMCI 86800U104 -> 86800U302),
  // and older filings with the old number shouldn't outvote the new one. A lone 1-vs-1
  // disagreement between issuers can't be settled, so that's "not found", not a coin flip.
  const votes = []; // newest first: { cusip, filedAt, structured }
  let aboutCompany = 0;
  for (const filing of candidates) {
    const folder = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${filing.accession.replace(/-/g, '')}`;
    const structured = filing.form.startsWith('SCHEDULE');
    const docRes = await secFetch(structured ? `${folder}/primary_doc.xml` : `${folder}/${filing.accession}.txt`);
    if (!docRes.ok) throw new Error(`SEC filing document HTTP ${docRes.status}`);
    const text = await docRes.text();

    if (structured) {
      const issuerCik = xmlValues(text, 'issuerCik')[0];
      if (!issuerCik || issuerCik.padStart(10, '0') !== cik) continue;
      aboutCompany++;
      const issuerName = decodeXml(xmlValues(text, 'issuerName')[0] || '');
      const known = [...secNames, companyName].filter(Boolean);
      if (issuerName && !known.some((name) => nameMentions(issuerName, name) || nameMentions(name, issuerName))) continue;
      // Several CUSIPs = several classes; which one is ours isn't said - not a vote.
      // Two schema versions: <issuerCusips><issuerCusipNumber>... and a plain <issuerCusip> (GROY).
      const cusips = [...xmlValues(text, 'issuerCusipNumber'), ...xmlValues(text, 'issuerCusip')]
        .map((c) => c.toUpperCase()).filter(isValidCusip);
      if (cusips.length === 1) votes.push({ cusip: cusips[0], filedAt: filing.date, structured });
      continue;
    }

    const subject = text.slice(0, 5000).match(/SUBJECT COMPANY:[\s\S]*?CENTRAL INDEX KEY:\s*(\d+)/);
    if (!subject || subject[1].padStart(10, '0') !== cik) continue;
    aboutCompany++;
    if (!secIssuerMatches(text, companyName)) continue;
    // Old filings sometimes print a placeholder ("000000000") - not a vote.
    const cusip = extractCusip(text);
    if (cusip && isValidCusip(cusip)) votes.push({ cusip, filedAt: filing.date, structured });
  }

  const issuerCounts = new Map(); // insertion order = newest first
  for (const { cusip } of votes) issuerCounts.set(cusip.slice(0, 6), (issuerCounts.get(cusip.slice(0, 6)) || 0) + 1);
  let bestIssuer = null;
  let bestCount = 0;
  for (const [issuer, count] of issuerCounts) {
    if (count > bestCount) [bestIssuer, bestCount] = [issuer, count];
  }
  // The reason codes are shown in the UI when an add can't fill the CUSIP (see routes/stocks.js).
  if (bestCount === 1 && issuerCounts.size > 1) return { cusip: null, reason: 'conflicting_13g' };
  if (bestIssuer) {
    const best = votes.find((v) => v.cusip.startsWith(bestIssuer));
    // newest: whether the newest usable filing of all printed this same CUSIP (the monitor only
    // replaces a stored CUSIP then - an older majority can't undo a newer change).
    return { ...best, newest: votes[0].cusip === best.cusip };
  }
  return { cusip: null, reason: aboutCompany ? 'unusable_13g' : 'no_13g' };
}

// --- 13F holdings reports ---
// Searched by the company name's first two distinctive words over the last F13_DAYS of 13F-HR
// filings, newest first; up to F13_MAX_DOCS holdings tables are read (a broker's can be
// several MB; one over F13_MAX_BYTES is skipped), stopping early once 4+ tables agree on one. An entry counts when its nameOfIssuer is our
// company (13F names are abbreviated - "TAIWAN SEMICONDUCTOR MFG CO LTD") and its class is
// common equity: warrants ("*W EXP 03/29/2027"), rights, units, preferreds, notes and option
// positions (putCall) carry their own CUSIPs. The 13F names are short enough that two issuers
// can match (BRW's "SABA CAPITAL INCOME & OPRNT" and Fund II's "... & OPPORT"): matches from
// more than one issuer (first 6 characters) are "ambiguous", not a guess, unless one issuer clearly
// outnumbers the rest (see below - a filer's typo). Within one issuer,
// the CUSIP seen in the newest filing wins (a reverse split's new number), unless another one
// of that issuer was also seen within F13_SAME_TIME_DAYS of it (two share classes) - ambiguous.
const F13_DAYS = 200;
const F13_MAX_DOCS = 12;
const F13_MAX_BYTES = 15 * 1024 * 1024;
const F13_SAME_TIME_DAYS = 60;
const F13_MIN_MAJORITY = 3;
const F13_MAJORITY_RATIO = 3;
const F13_STOPWORDS = new Set(['the', 'inc', 'inc.', 'corp', 'corp.', 'corporation', 'co', 'co.', 'company', 'ltd', 'ltd.',
  'limited', 'plc', 'llc', 'sa', 's.a.', 'nv', 'n.v.', 'ag', 'holdings', 'holding', 'group', 'and', '&']);
const F13_NON_COMMON = /\*W\b|\bW EXP\b|\b(?:WTS?|WARRANTS?|RIGHTS?|RTS?|UNITS?|PFD|PREF|PREFERRED|NOTES?|DEB|DEBENTURES?|BONDS?|CV|CONV)\b|%/i;

const f13NameMatches = (issuer, companyName) => sameCompany(issuer, companyName) || similarNames(issuer, companyName)
  || isWordAbbreviationOf(issuer, companyName) || companyNamesMatch(issuer, companyName);

async function lookupCusipFrom13F(companyName) {
  if (!companyName) return { cusip: null, reason: 'no_13f' };
  const words = String(companyName).replace(/[^\p{L}\p{N}&.' -]/gu, ' ').split(/\s+/)
    .filter((w) => w && !F13_STOPWORDS.has(w.toLowerCase()));
  if (!words.length) return { cusip: null, reason: 'no_13f' };
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  const query = `"${words.slice(0, 2).join(' ')}"`;
  const searchUrl = `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(query)}&forms=13F-HR`
    + `&startdt=${day(Date.now() - F13_DAYS * 864e5)}&enddt=${day(Date.now())}`;
  let res = await secFetch(searchUrl);
  if (res.status >= 500) res = await secFetch(searchUrl); // the search answers an occasional 500 (seen 2026-10-13)
  if (!res.ok) throw new Error(`SEC full-text search HTTP ${res.status}`);
  const hits = ((await res.json()).hits || {}).hits || [];
  hits.sort((a, b) => String(b._source.file_date).localeCompare(String(a._source.file_date)));

  const seen = new Map(); // cusip -> { count, last }
  let docs = 0;
  for (const hit of hits.slice(0, F13_MAX_DOCS)) {
    // Enough: several tables read and they all point at one CUSIP.
    if (docs >= 4 && seen.size === 1 && [...seen.values()][0].count >= 3) break;
    const [accession, file] = String(hit._id).split(':');
    const filerCik = hit._source.ciks && hit._source.ciks[0];
    if (!accession || !file || !filerCik) continue;
    const doc = await secFetch(`https://www.sec.gov/Archives/edgar/data/${Number(filerCik)}/${accession.replace(/-/g, '')}/${file}`);
    if (!doc.ok) continue;
    if (Number(doc.headers.get('content-length')) > F13_MAX_BYTES) {
      await doc.body.cancel();
      continue;
    }
    const xml = await doc.text();
    docs += 1;
    for (const m of xml.matchAll(/<(?:\w+:)?infoTable>([\s\S]*?)<\/(?:\w+:)?infoTable>/g)) {
      // `\\w`: in a template literal a plain `\w` is just "w", which silently skipped every
      // table using a namespace prefix (<ns1:cusip>, most of them) until 2026-10-15 - SUSA got
      // the one unprefixed filer's typo (46436E569 for 464288802).
      const field = (tag) => {
        const v = m[1].match(new RegExp(`<(?:\\w+:)?${tag}>([^<]*)<`));
        return v ? decodeXml(v[1]).trim() : '';
      };
      if (field('putCall')) continue;
      const cusip = field('cusip').toUpperCase();
      if (!isValidCusip(cusip) || F13_NON_COMMON.test(field('titleOfClass'))) continue;
      if (!f13NameMatches(field('nameOfIssuer'), companyName)) continue;
      const entry = seen.get(cusip) || { count: 0, last: '' };
      entry.count += 1;
      if (hit._source.file_date > entry.last) entry.last = hit._source.file_date;
      seen.set(cusip, entry);
    }
  }

  if (!seen.size) return { cusip: null, reason: 'no_13f' };
  // Several issuers: a filer's typo (SUSA: one table had 46436E569, the others 464288802) is
  // outvoted when one issuer has at least F13_MIN_MAJORITY entries and F13_MAJORITY_RATIO times
  // all the others together; anything closer (BRW's two Saba funds) stays ambiguous.
  const byIssuer = new Map();
  for (const [c, e] of seen) byIssuer.set(c.slice(0, 6), (byIssuer.get(c.slice(0, 6)) || 0) + e.count);
  const [topIssuer, topCount] = [...byIssuer.entries()].sort((a, b) => b[1] - a[1])[0];
  const others = [...byIssuer.values()].reduce((s, n) => s + n, 0) - topCount;
  if (others && (topCount < F13_MIN_MAJORITY || topCount < F13_MAJORITY_RATIO * others)) {
    return { cusip: null, reason: 'ambiguous_13f', detail: [...seen.keys()].join(' ') };
  }
  const ranked = [...seen.entries()].filter(([c]) => c.startsWith(topIssuer)).sort((a, b) => b[1].last.localeCompare(a[1].last) || b[1].count - a[1].count);
  const [cusip, { last }] = ranked[0];
  const daysApart = (a, b) => Math.abs(new Date(a) - new Date(b)) / 864e5;
  if (ranked.slice(1).some(([, e]) => daysApart(e.last, last) < F13_SAME_TIME_DAYS)) {
    return { cusip: null, reason: 'ambiguous_13f', detail: ranked.map(([c]) => c).join(' ') };
  }
  // Holdings as of the last quarter: current, like a structured 13G's.
  return { cusip, filedAt: last, structured: true, newest: true };
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
    `SELECT ${ID} AS id, stock_symbol, company_name, exchange, cusips FROM ${TABLE}
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

// Returns { cusip, source, reasons, filedAt, structured, newest, owner } - filedAt / structured /
// newest describe the SEC filing the CUSIP came from (a 13F result is current: structured and
// newest); owner is checkOwner's verdict on it. Sources in order: SEC 13G, SEC 13F,
// quantumonline.com (secOnly skips the last). cusip is
// null (source null too) if no source found one, if lookups errored, or if what was found fails
// CUSIP check-digit validation or is another stock's.
// `reasons` says why each source tried came up empty, as [{ source, code, detail? }] - the
// add form shows them (codes: SEC no_contact / no_cik / skipped_non_common /
// skipped_multi_class / no_13g / unusable_13g / conflicting_13g; SEC 13F no_13f /
// ambiguous_13f; quantumonline.com not_found / name_mismatch / no_cusip_on_page; any
// error / invalid_check_digit / belongs_to_other / padded_sedol). Never throws; pass onSourceError(sourceName,
// err) to observe per-source failures (used by the bulk script for progress diagnostics - see
// scripts/fill-cusip.js). Pass companyName whenever known: it guards the quantumonline
// fallback against recycled tickers (see qolSecurityName above), SEC against mis-tagged
// filings, and is what the 13F search looks for. Pass listing (lib/nasdaqTrader.js) when
// available, or at least securityName (NASDAQ Trader's raw name), so a preferred/note/warrant -
// or one of several share classes - skips SEC (see isNonCommonSecurity / hasCommonSibling).
// Writers pass checkOwner: (cusip) => checkCusipOwner(pool, cusip, { stockId, listing,
// companyName, exchange }), then
// write only after releaseFromHolder(pool, result.owner, result.cusip) says ok.
async function lookupCusip(symbol, { onSourceError, companyName, securityName, listing, secOnly, checkOwner } = {}) {
  const reasons = [];
  if (!securityName && listing && listing.get(symbol)) securityName = listing.get(symbol).name;

  // Each source returns { cusip, reason?, detail? }; a found value still has to pass the check
  // digit, and - with checkOwner - must not be another stock's verified CUSIP (see
  // checkCusipOwner): LCFY's quantumonline page printed LUCD's 54948X109, which SEC confirms is
  // LUCD's, so that answer is dropped and the next source is asked.
  const trySource = async (source, fn) => {
    try {
      const r = await fn();
      // "00" + SEDOL (see looksLikePaddedSedol): uncertain, so skipped - a 13G is about this
      // company's own CIK, so its answer is kept. In 13F it still votes before this point, so
      // BKHPF's 006075808 vs the ADR's 062510300 stays ambiguous instead of the ADR winning.
      if (r.cusip && source !== 'SEC' && looksLikePaddedSedol(r.cusip)) {
        reasons.push({ source, code: 'padded_sedol', detail: r.cusip });
        return null;
      }
      if (r.cusip && isValidCusip(r.cusip)) {
        const owner = checkOwner ? await checkOwner(r.cusip) : null;
        if (owner && owner.status === 'theirs') {
          reasons.push({ source, code: 'belongs_to_other', detail: `${r.cusip} ${owner.holder.stock_symbol}` });
          return null;
        }
        return { cusip: r.cusip, source, reasons, filedAt: r.filedAt || null, structured: Boolean(r.structured), newest: Boolean(r.newest), owner };
      }
      reasons.push({ source, code: r.cusip ? 'invalid_check_digit' : r.reason, detail: r.detail });
    } catch (err) {
      reasons.push({ source, code: 'error', detail: err.message });
      if (onSourceError) onSourceError(source, err);
    }
    return null;
  };

  let found = null;
  if (isNonCommonSecurity(symbol, companyName, securityName)) {
    reasons.push({ source: 'SEC', code: 'skipped_non_common' });
  } else if (!SEC_CONTACT) {
    reasons.push({ source: 'SEC', code: 'no_contact' });
  } else {
    let multiClass = false;
    found = await trySource('SEC', async () => {
      const tickerToCik = await getTickerToCik();
      // SEC's ticker list writes share classes / warrants / units Yahoo-style ("BRK-B",
      // "GME-WT"); quantumonline below uses our own "BRK.B" form, so only SEC gets converted.
      const cik = tickerToCik.get(toYahooSymbol(symbol)) || tickerToCik.get(symbol);
      if (!cik) return { cusip: null, reason: 'no_cik' };
      if (listing && hasCommonSibling(tickerToCik, cik, symbol, listing)) {
        multiClass = true;
        return { cusip: null, reason: 'skipped_multi_class' };
      }
      return lookupCusipFromSec(cik, companyName);
    });
    // A 13G CUSIP from the old text form (filed before late 2024) can predate a reverse split
    // (AIRE: 75607T105 from 2024, while 13Fs since August show 75607T204), so 13F's current
    // holdings are asked then too, and win when they have an answer. 13F names don't tell share
    // classes apart either, so a multi-class company skips it.
    if (!(found && found.structured) && !multiClass) {
      const from13F = await trySource('SEC 13F', () => lookupCusipFrom13F(companyName));
      if (from13F) found = { ...from13F, reasons };
    }
  }
  if (found) return found;

  if (secOnly) return { cusip: null, source: null, reasons };
  found = await trySource('quantumonline.com', () => lookupCusipFromQuantumOnline(symbol, companyName));
  return found || { cusip: null, source: null, reasons };
}

// Who holds `cusip`, and is it really theirs? A CUSIP identifies one security, so when a found
// value is already on another live row, one side is wrong (the user, 2026-10-13: check whether
// the other stock's is right - if it is, what we found is wrong). The holder's own CUSIP is
// looked up from SEC (13G / 13F only - not quantumonline, the source that mixes them up):
//   free         - no other live row has it
//   theirs       - the holder's lookup gives this same CUSIP: ours is wrong (lookupCusip drops it)
//   holder_wrong - the holder's lookup gives a different, current CUSIP (holderCusip): theirs is
//                  the wrong one (releaseFromHolder corrects it)
//   unverified   - the holder's can't be confirmed either way: a person has to decide
// A holder that is the same company can't be checked this way (its lookup finds the same
// company's CUSIP): a non-US listing of it shares the CUSIP legitimately (APC.DE, Apple on
// XETRA, holds AAPL's 037833100) - free; two US rows of one company - unverified.
// companyName / exchange are the row being filled.
const US_EXCHANGE = /nasdaq|nyse|amex|otc|pnk|oem|oqx|oqb|bats|arca|cboe|nms|ngm|ncm|nyq|ase|^us/i;
async function checkCusipOwner(pool, cusip, { stockId, listing, companyName, exchange } = {}) {
  const holder = await findCusipConflict(pool, cusip, { stockId });
  if (!holder) return { status: 'free' };
  if (companyName && (sameCompany(holder.company_name, companyName) || similarNames(holder.company_name, companyName))) {
    const isUS = (ex) => US_EXCHANGE.test(String(ex || ''));
    return isUS(holder.exchange) && isUS(exchange) ? { status: 'unverified', holder } : { status: 'free' };
  }
  const theirs = await lookupCusip(holder.stock_symbol, { companyName: holder.company_name, listing, secOnly: true });
  if (theirs.cusip === cusip) return { status: 'theirs', holder };
  if (theirs.cusip && theirs.structured && theirs.newest) return { status: 'holder_wrong', holder, holderCusip: theirs.cusip };
  return { status: 'unverified', holder };
}

// Makes `cusip` free to write for a lookupCusip result's owner check: { ok: true } when no other
// live row holds it, or after replacing the holder's wrong value with its own verified CUSIP
// ({ ok: true, fixed: { id, stock_symbol, from, to } }); { ok: false } when it stays the
// holder's (unverified, or the holder's own CUSIP is on a third row).
async function releaseFromHolder(pool, owner, cusip) {
  if (!owner || owner.status === 'free') return { ok: true };
  if (owner.status !== 'holder_wrong') return { ok: false };
  const { holder, holderCusip } = owner;
  if (await findCusipConflict(pool, holderCusip, { stockId: holder.id })) return { ok: false };
  const list = String(holder.cusips || '').trim().split(/\s+/).filter(Boolean);
  const next = [...new Set(list.map((c) => (c === cusip ? holderCusip : c)))].join(' ');
  await applyStockUpdate(pool, holder.id, { cusips: next });
  return { ok: true, fixed: { id: holder.id, stock_symbol: holder.stock_symbol, from: holder.cusips, to: next } };
}

module.exports = {
  lookupCusip, lookupCusipFrom13F, findCusipConflict, checkCusipOwner, releaseFromHolder, isNonCommonSecurity, getTickerToCik, secNamesMatch, SEC_USER_AGENT, hasSecContact: Boolean(SEC_CONTACT),
};
