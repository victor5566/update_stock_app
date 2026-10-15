// Stock monitor: checks every row of the stock table against NASDAQ Trader's official listing
// and Yahoo Finance, decides whether each stock is still trading, and updates / fills in its
// info. It never deletes anything - a stock that stopped trading only gets isdelisted = true.
// Shared by scripts/monitor-stocks.js (CLI), routes/monitor.js (the UI's buttons) and the
// optional daily schedule in server.js.
//
// Since 2026-10-15 (the user) it only checks the rows that have no CUSIP: live US-market rows
// (NASDAQ / NYSE / AMEX / OTC) with an empty cusips - every other row is loaded (the duplicate-name
// and recycled-ticker rules compare against the other rows of a symbol) but not quoted, judged or
// written. Per checked row it may set: isdelisted, company_name, exchange, category (OTC rows),
// currency; then, on applying runs, the CUSIP via lib/cusipLookup.js. So a run checks at most as
// many rows as are missing a CUSIP, and fewer each time some are found. Company details
// (lib/fillCompanyDetails.js) are no longer part of it - scripts/fill-company-details.js still
// does them. stock_symbol is never changed automatically - a symbol change can't be told apart
// from a recycled ticker reliably.
const { yf, toYahooSymbol, marketLabelForQuote } = require('./yahoo');
const { loadNasdaqTraderListing } = require('./nasdaqTrader');
const { cleanSecurityName } = require('./cleanSecurityName');
const { sameCompany, similarNames, isAbbreviationOf, isWordAbbreviationOf, stripFundFamily, namePartOf, matchCasing, nearlyEqual } = require('./normalizeCompanyName');
const { applyStockUpdate } = require('./applyStockUpdate');
const { lookupCusip, checkCusipOwner, releaseFromHolder } = require('./cusipLookup');
const { TABLE, ID, isBlank } = require('./stockTable');

const DAY_MS = 24 * 60 * 60 * 1000;
// Last trade within FRESH_DAYS = trading. Older than STALE_DAYS = stopped trading. In between
// (thin OTC stocks can go weeks without a trade) the status is left alone.
const FRESH_DAYS = 30;
const STALE_DAYS = 120;
const QUOTE_BATCH = 200;
const QUOTE_RETRY_BATCH = 25;
const QUOTE_DELAY_MS = 300;
// quantumonline.com is a small site (see scripts/fill-cusip.js's QOL_DELAY_MS); SEC requests
// are paced separately inside lib/cusipLookup.js.
const CUSIP_DELAY_MS = Number(process.env.QOL_DELAY_MS) || 500;
// CUSIP lookups per applying run: no limit - every checked row that is still trading (at most the
// number of rows missing a CUSIP; 2,477 on waffle on 2026-10-15). MONITOR_CUSIP_LIMIT in .env (or
// the CLI's --cusip-limit) can still cap it.
const DEFAULT_CUSIP_LIMIT = Infinity;
// Row id -> when its CUSIP lookup last found nothing. In-process only (the app can't create
// tables), so a server restart forgets it; the daily runs share it.
const cusipMissedAt = new Map();
const CUSIP_SKIP_MS = 7 * 24 * 60 * 60 * 1000;

const LISTED_MARKETS = new Set(['NASDAQ', 'NYSE', 'AMEX']);
const US_MARKETS = new Set([...LISTED_MARKETS, 'OTC']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The table spells the four US markets many ways (PNK, OEM, US OTC, NYQ, New York Stock
// Exchange, ...); collapse them so only real market changes count. Others pass through.
function marketOf(value) {
  const s = String(value || '').trim().toUpperCase();
  if (!s) return '';
  if (s.includes('OTC') || /^(PNK|OEM|OQB|OQX|OGM|OID)$/.test(s)) return 'OTC';
  if (/AMERICAN|^AMEX$|^ASE$|^NYSE ?MKT$/.test(s)) return 'AMEX';
  if (/^NASDAQ|^NAS$|^NMS$|^NGM$|^NCM$/.test(s)) return 'NASDAQ';
  if (/^NYSE$|^NYQ$|^NEW YORK STOCK EXCHANGE(, INC\.)?$/.test(s)) return 'NYSE';
  return s;
}

// Placeholder names found in the table ("324823", "GCTSmissing co name", "eo_company").
function isInvalidName(name) {
  const s = String(name || '').trim();
  return !s || /^\d+$/.test(s) || /missing co name/i.test(s) || /^eo_company$/i.test(s);
}

// OTC category in the table's existing format: "OTC Markets OTCPK - PNK",
// "OTC Markets OTCQX - Delayed Quote - OQX" (Yahoo's fullExchangeName, quoteSourceName, exchange).
function otcCategory(quote) {
  if (!quote || !String(quote.fullExchangeName || '').startsWith('OTC Markets') || !quote.exchange) return null;
  return [quote.fullExchangeName, quote.quoteSourceName, quote.exchange].filter(Boolean).join(' - ');
}

// Yahoo's quoteSourceName comes and goes between calls, so compare only tier + code.
function categoryTier(category) {
  const parts = String(category).split(' - ');
  return `${parts[0]}|${parts[parts.length - 1]}`;
}

// Yahoo cuts some names at 30/31 characters ("NASDAQ MEA Basic Resources Larg"). A name of that
// length that ends like a complete name ("Mitsui Kinzoku Company, Limited", "Jeff Bank, National
// Association", "Colombier Acquisition Corp. III") is taken as complete.
const COMPLETE_ENDING = /\b(?:Inc|Corp|Corporation|Company|Co|Ltd|Limited|plc|PLC|LLC|L\.?P|S\.?A|AG|N\.?V|SE|Association|Bancorp|Bank|Trust|Fund|ETF|ETN|Group|Holdings)\.?(?:\s+[IVX]+)?$/;
const looksTruncated = (name) => name.length >= 30 && name.length <= 31 && /[A-Za-z]$/.test(name) && !COMPLETE_ENDING.test(name);

// Same name for the stock monitor's purposes: same issuer, or the same name spelled differently.
const sameName = (a, b) => sameCompany(a, b) || similarNames(a, b);

// Our stored name was cut off and `full` (the listing's security name) continues it: mid-word /
// mid-number ("KKR Group Finance Co. IX LLC 4." + "625% ..."), or the stored value ends in a
// space ("DTE Energy Company 2021 Series ").
function isCutOff(stored, full) {
  const s = String(stored || '');
  const t = s.trim();
  const f = String(full || '').trim();
  if (t.length < 15 || f.length <= t.length || !f.toLowerCase().startsWith(t.toLowerCase())) return false;
  return /\s$/.test(s) || /[A-Za-z0-9]/.test(f[t.length]);
}

function lastTradeOf(quote) {
  const t = quote && quote.regularMarketTime;
  if (!t) return null;
  const d = t instanceof Date ? t : new Date(typeof t === 'number' ? t * 1000 : t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const day = (d) => d.toISOString().slice(0, 10);

// Decides one row. Pure (no I/O) so the rules can be exercised with fake data.
// ctx: { listing: Map | null, quotes: Map, failedSymbols: Set, liveCount: Map, now: Date }
// Returns { status: 'listed' | 'delisted' | 'unknown', reason, fields, notes, live }.
// Mutual funds (category "Mutual Fund", or the 5-letter ...X symbol convention) are not in
// NASDAQ Trader's directory.
const isMutualFund = (row) => /mutual fund/i.test(String(row.category || '')) || /^[A-Z]{4}X$/.test(String(row.stock_symbol).trim().toUpperCase());

// True when one name is the other followed by more words ("WIG20" / "WIG20 D.WIND PLN").
function suffixOnlyDifference(a, b) {
  const fold = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
  const fa = fold(a);
  const fb = fold(b);
  return Boolean(fa && fb) && (fa.startsWith(`${fb} `) || fb.startsWith(`${fa} `));
}

// True when one name is the other with a leading "<issuer / fund family> - " part.
function prefixOnlyDifference(a, b) {
  const tail = (s) => {
    const i = String(s).indexOf(' - ');
    return i > 0 ? String(s).slice(i + 3).trim() : null;
  };
  const same = (x, y) => x.toLowerCase() === String(y).trim().toLowerCase() || sameName(x, y);
  const ta = tail(a);
  const tb = tail(b);
  return Boolean((ta && same(ta, b)) || (tb && same(tb, a)));
}

// A trailing common-share descriptor on a stored name (see planRow's company_name rules).
const EQUITY_DESCRIPTOR = /(?:\s*[-,]\s*|\s+)(?:(?:Class|Series) [A-Z]\s+)?(?:Common Stock|Common Shares|Ordinary Shares|American Depositary Shares|American Depository Shares|ADSs?|ADRs?)$/i;

function planRow(row, ctx) {
  const symbol = row.stock_symbol.trim().toUpperCase();
  const ySymbol = toYahooSymbol(row.stock_symbol);
  const listed = ctx.listing ? ctx.listing.get(symbol) : null;
  const quote = ctx.quotes.get(ySymbol);
  const lastTrade = lastTradeOf(quote);
  const ageDays = lastTrade ? (ctx.now - lastTrade) / DAY_MS : null;
  const dbMarket = marketOf(row.exchange);
  const fields = {};
  const notes = [];

  let status = 'unknown';
  let reason = '';
  if (listed) {
    status = 'listed';
    reason = 'NASDAQ Trader';
  } else if (ageDays !== null && ageDays <= FRESH_DAYS) {
    status = 'listed';
    reason = `Yahoo last trade ${day(lastTrade)}`;
  } else if (ageDays !== null && ageDays >= STALE_DAYS) {
    status = 'delisted';
    reason = `Yahoo last trade ${day(lastTrade)}`;
  } else if (!quote && !ctx.failedSymbols.has(ySymbol) && ctx.listing
    && LISTED_MARKETS.has(dbMarket) && /^[A-Z]{1,5}$/.test(symbol) && !isMutualFund(row)) {
    // An exchange-listed common stock gone from the official directory and from Yahoo.
    // Only plain symbols: preferreds / units are spelled differently in the directory. Not
    // mutual funds: the directory never lists them, so it says nothing about them.
    status = 'delisted';
    reason = 'not in NASDAQ Trader listing or on Yahoo';
  } else {
    reason = quote ? `Yahoo last trade ${lastTrade ? day(lastTrade) : 'unknown'}` : 'no source has it';
  }

  // The current name, and whether two sources agree on it. Yahoo's longName only - shortName
  // is often a truncation (but it can confirm the stored name, see yahooShortConfirms below).
  // For listed symbols Yahoo alone isn't trusted (it keeps a recycled ticker's previous owner's
  // name), so it counts only when it matches the official listing.
  // When both agree, Yahoo's spelling is used: it's the clean form shown on Yahoo's page
  // ("iPath Series B Carbon ETN"), where the listing adds descriptors ("... Exchange-Traded
  // Notes", "... Common Shares of Beneficial Interest", "... due 2045").
  let currentName = null;
  let corroborated = false;
  const yahooName = quote && quote.longName ? quote.longName.trim() : null;
  const listingName = listed ? cleanSecurityName(listed.name) : null;
  if (listed) {
    // Yahoo may prefix the fund family ("Roundhill ETF Trust - Roundhill S&P 500 ..."); drop it
    // when what's left is the listing's name. (Only here: for funds Yahoo alone describes, the
    // part after the dash can be just a share class - "... Investment Trust - Equity".)
    const unprefixed = yahooName && stripFundFamily(yahooName);
    const yName = unprefixed && unprefixed !== yahooName && sameName(unprefixed, listingName) ? unprefixed : yahooName;
    if (yName && (sameCompany(yName, listed.name) || sameName(yName, listingName))) {
      // Words that differ only in capitalisation ("Nvda" / "NVDA", "Microsectors" /
      // "MicroSectors") are spelled as in the listing, the official form.
      currentName = matchCasing(yName, listed.name);
      // Yahoo cut the name mid-word and the listing continues it ("... Power Buffer ETF - Se" /
      // "... ETF - September"): use the listing's full name.
      if (isCutOff(yName, listed.name)) currentName = listed.name.trim();
      corroborated = true;
    } else {
      currentName = listingName;
    }
  } else if (yahooName) {
    currentName = yahooName;
    // Yahoo sometimes serves a 30/31-character truncation even as longName ("NASDAQ MEA
    // Basic Resources Larg" for BC-PC) - don't overwrite a real name with one.
    corroborated = !looksTruncated(yahooName);
  }

  const wasDelisted = Boolean(row.isdelisted);
  const otherLiveRows = (ctx.liveCount.get(symbol) || 0) - (wasDelisted ? 0 : 1);
  let live = !wasDelisted;

  if (status === 'delisted' && !wasDelisted) {
    fields.isdelisted = true;
    live = false;
  } else if (status === 'listed' && wasDelisted) {
    // Only revive the row if it's the same company: a recycled ticker's quote describes the
    // new owner, not the old delisted row.
    const sameIssuer = isInvalidName(row.company_name) || (currentName && sameCompany(currentName, row.company_name));
    // Per the user (2026-10-08): when the symbol now belongs to another company - another live
    // row holds it, or the quote is a different issuer (FLYT 5568 "Direxion Flight to Safety
    // Strategy ETF", whose symbol now trades as "Tradr 2X Long FLY Daily ETF") - the delisted
    // row is left completely alone and not reported at all: no fields, no note. Its status is
    // the row's (delisted), not the symbol's, so the counts and badge don't call it listed.
    if (otherLiveRows > 0 || !sameIssuer) {
      status = 'delisted';
      reason = otherLiveRows > 0 ? 'symbol held by another live row' : `symbol trades as ${currentName || 'another company'}`;
    } else {
      fields.isdelisted = false;
      live = true;
    }
  }

  if (status === 'listed' && live) {
    if (currentName) {
      const stored = row.company_name;
      // Yahoo abbreviates fund names at ~30 characters ("PIMCO GIS Income Instl SGDH Inc"); a
      // name at that limit, shorter than ours and starting with the same words, isn't a rename.
      const yahooAbbreviates = !listed && yahooName && yahooName.length >= 30 && yahooName.length <= 31
        && yahooName.length < String(stored).trim().length
        && yahooName.split(/\s+/).slice(0, 2).join(' ').toLowerCase() === String(stored).trim().split(/\s+/).slice(0, 2).join(' ').toLowerCase();
      // A symbol only Yahoo knows: Yahoo's shortName naming the stored company means Yahoo itself
      // still uses our name - its longName can be a subsidiary's (JFBC: longName "Jeff Bank,
      // National Association", shortName and page title "Jeffersonville Bancorp"). Per the user
      // (2026-10-08) such a name stays as it is.
      const yahooShort = quote && quote.shortName ? quote.shortName.trim() : null;
      const yahooShortConfirms = !listed && yahooShort && !isInvalidName(stored)
        && (sameName(yahooShort, stored) || sameCompany(yahooShort, stored));
      // Ours still carries a common-share descriptor ("ASP Isotopes Inc. Common Stock", "...
      // Class A Ordinary Shares", "... American Depositary Shares") that the comparison ignores:
      // with the sources agreeing, write their clean name (the user, 2026-10-08). Only these -
      // "Unit" / "Warrant" / "Right" / "Notes due ..." / "- June" are part of the security's name.
      const storedClean = isInvalidName(stored) ? null : String(stored).trim().replace(EQUITY_DESCRIPTOR, '').trim();
      const storedHasDescriptor = Boolean(storedClean) && storedClean !== String(stored).trim();
      if (isInvalidName(stored)) {
        fields.company_name = currentName;
      } else if (storedHasDescriptor && corroborated && otherLiveRows <= 0
        && (sameName(currentName, storedClean) || sameCompany(currentName, storedClean))) {
        fields.company_name = currentName;
      } else if (yahooShortConfirms) {
        // leave it
      } else if (isWordAbbreviationOf(currentName, stored)) {
        // The new name is ours abbreviated word by word ("China Development Bank Intl Inv Ltd." for
        // "... International Investment Limited", 1062.HK): Yahoo serves either form depending on
        // where and when it's asked. Never replace a full name with its abbreviation (the user,
        // 2026-10-09: names follow what Yahoo's page shows, which is the full form). The other
        // way - ours abbreviated, the source's full - still gets the full name below.
      } else if (!listed && (prefixOnlyDifference(currentName, stored) || suffixOnlyDifference(currentName, stored))) {
        // The names differ only by a leading issuer / fund-family part ("Global X ETF Series OFC -
        // Global X China Consumer Brand ETF" vs "Global X China Consumer Brand ETF"). Yahoo
        // serves either form depending on where and when it's asked, so following it made rows
        // flip back and forth between runs (2806.HK and other HK ETFs, 2026-10-08). Per the
        // user, the stored name stays. Likewise for names that differ only by trailing words:
        // WIG20.WA's page shows "WIG20" while the quote API serves "WIG20 D.WIND PLN" (renamed by
        // a run on 2026-10-11, restored by hand on 2026-10-12 - the user: wrong name).
      } else if (!sameName(currentName, stored) && !nearlyEqual(currentName, stored)) {
        if (yahooAbbreviates) {
          // Keep our full name; note it only if the abbreviation doesn't fit it (maybe a rename,
          // e.g. "... Low Duration Income Fund" vs "... Low Duration Bond").
          if (!isAbbreviationOf(yahooName, stored)) notes.push(`name differs: ${currentName}`);
        } else if (listed && otherLiveRows <= 0
          && (sameName(currentName, stripFundFamily(stored)) || isWordAbbreviationOf(stored, currentName))) {
          // Ours carries a fund-family prefix ("AIM ETF Products Trust - ...") or is an
          // abbreviation ("Etracs Alerian Mlp Ind Ser B") of the current name.
          fields.company_name = currentName;
        } else if (corroborated && otherLiveRows <= 0) {
          fields.company_name = currentName;
        } else if (listed && otherLiveRows <= 0 && isCutOff(stored, listed.name)) {
          // Our name was cut off and only the listing has it (notes, preferreds): use its full name.
          fields.company_name = listed.name.trim();
        } else if (yahooName && sameName(yahooName, stored) && namePartOf(currentName, stored)) {
          // Yahoo confirms the stored name and the listing's is just a less specific form of it
          // ("Short Term Municipal Bond Active ETF" for "PIMCO Short Term ...") - leave it. A
          // listing name with different words (a rename Yahoo hasn't caught up with) is noted.
        } else if (!corroborated && yahooName && looksTruncated(yahooName) && isAbbreviationOf(yahooName, stored)) {
          // Yahoo's ~30-character abbreviation of the stored (full) name, e.g. mutual funds.
        } else {
          notes.push(`name differs: ${currentName}`);
        }
      } else if (corroborated && otherLiveRows <= 0 && currentName !== stored && !sameCompany(currentName, stored)
        && currentName.length <= String(stored).trim().length + 5) {
        // The same name, spelled differently from the sources ("Adc Therapeutics S.A." /
        // "ADC Therapeutics SA"): use the sources' spelling, so names match them as closely as
        // possible. Not when it would only make the name longer with generic words ("... ETF"
        // -> "... ETF ETF Shares", "Plc" -> "Public Limited Company"), and differences
        // sameCompany already ignores ("Inc" / "Inc.") stay.
        fields.company_name = currentName;
      }
    }

    if (listed && LISTED_MARKETS.has(listed.exchange)) {
      if (dbMarket !== listed.exchange) fields.exchange = listed.exchange;
    } else if (quote) {
      const yahooMarket = marketLabelForQuote(quote);
      if (!dbMarket && yahooMarket) fields.exchange = yahooMarket;
      else if (yahooMarket === 'OTC' && US_MARKETS.has(dbMarket) && dbMarket !== 'OTC') fields.exchange = 'OTC';
    }

    const category = otcCategory(quote);
    if (category && (isBlank(row.category)
      || (String(row.category).startsWith('OTC Markets') && categoryTier(row.category) !== categoryTier(category)))) {
      fields.category = category;
    }

    // Currency: filled when empty, and since 2026-10-15 (the user) replaced when the quote's differs
    // - but only when the quote names the row's company (a recycled ticker's quote is someone else's),
    // and a US-market row only ever gets USD: Yahoo labels some Nasdaq mutual funds CAD (CFHAX, CFHIX).
    const usRow = US_MARKETS.has(marketOf(fields.exchange || row.exchange));
    if (quote && quote.currency && String(quote.currency).trim() !== String(row.currency || '').trim()
      && (!usRow || quote.currency === 'USD')) {
      const ours = fields.company_name || row.company_name;
      if (isBlank(row.currency) || [quote.longName, quote.shortName].some((n) => n && sameName(n, ours))) fields.currency = quote.currency;
    }
  }

  return { status, reason, fields, notes, live };
}

// Yahoo quotes for all symbols, QUOTE_BATCH at a time. A failed batch is retried in smaller
// pieces (one malformed symbol can fail a whole request); symbols still failing are reported
// so their status isn't judged on missing data.
async function fetchQuotes(ySymbols, onProgress, shouldStop) {
  const quotes = new Map();
  const failedSymbols = new Set();
  let stopped = false;
  const take = async (batch) => {
    const res = await yf.quote(batch, {}, { validateResult: false });
    for (const q of [].concat(res || [])) if (q && q.symbol) quotes.set(q.symbol.toUpperCase(), q);
  };
  for (let i = 0; i < ySymbols.length; i += QUOTE_BATCH) {
    if (shouldStop()) {
      stopped = true;
      break;
    }
    const batch = ySymbols.slice(i, i + QUOTE_BATCH);
    try {
      await take(batch);
    } catch {
      for (let j = 0; j < batch.length; j += QUOTE_RETRY_BATCH) {
        const small = batch.slice(j, j + QUOTE_RETRY_BATCH);
        try {
          await take(small);
        } catch {
          small.forEach((s) => failedSymbols.add(s));
        }
      }
    }
    if (onProgress) onProgress(Math.min(i + QUOTE_BATCH, ySymbols.length), ySymbols.length);
    await sleep(QUOTE_DELAY_MS);
  }
  return { quotes, failedSymbols, stopped };
}

// The rows a run checks (the user, 2026-10-15): live, a US market, no CUSIP yet.
const needsCusip = (r) => !r.isdelisted && isBlank(r.cusips) && US_MARKETS.has(marketOf(r.exchange));

// options: apply (write changes; default false = preview), symbols (only these - still only the
// ones without a CUSIP), cusipLimit (CUSIP lookups per run), onProgress({ phase, done, total }),
// shouldStop() (checked between rows / batches; a stopped run returns what it did so far with
// stopped: true - changes already written stay written).
async function runStockMonitor(pool, options = {}) {
  const shouldStop = options.shouldStop || (() => false);
  let stopped = false;
  const stopNow = () => stopped || (stopped = shouldStop());
  const apply = Boolean(options.apply);
  const symbols = (options.symbols || []).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const cusipLimit = options.cusipLimit ?? DEFAULT_CUSIP_LIMIT;
  const progress = (phase, done, total) => options.onProgress && options.onProgress({ phase, done, total });
  const startedAt = new Date();

  progress('loading', 0, 0);
  // Every row is loaded (cheap), because the rules below compare a row with the other rows of
  // its symbol (unique (symbol, name) index, recycled tickers); only checkRows are judged.
  const { rows } = await pool.query(
    `SELECT ${ID} AS id, stock_symbol, company_name, exchange, isdelisted, category, cusips, currency
     FROM ${TABLE} ${symbols.length ? 'WHERE upper(stock_symbol) = ANY($1)' : ''}
     ORDER BY ${ID}`,
    symbols.length ? [symbols] : []
  );
  const checkRows = rows.filter(needsCusip);

  let listing = null;
  try {
    listing = await loadNasdaqTraderListing();
  } catch {
    // Without the official listing, no listed stock is renamed, moved or marked delisted on
    // Yahoo's word alone (see planRow).
  }

  const ySymbols = [...new Set(checkRows.map((r) => toYahooSymbol(r.stock_symbol)))];
  const fetched = await fetchQuotes(ySymbols, (done, total) => progress('quotes', done, total), stopNow);
  const { quotes, failedSymbols } = fetched;
  // A batch answer can silently leave a symbol out (PARJX, a live mutual fund, was marked
  // delisted on 2026-10-08 that way). Before a live exchange-listed row is called delisted for
  // having no quote, ask Yahoo again for just those symbols, in small batches; one that fails
  // here counts as failed (status left alone).
  if (!fetched.stopped) {
    const recheck = [...new Set(checkRows.filter((r) => !r.isdelisted && listing
      && !listing.has(r.stock_symbol.trim().toUpperCase()) && LISTED_MARKETS.has(marketOf(r.exchange))
      && /^[A-Z]{1,5}$/.test(r.stock_symbol.trim().toUpperCase()) && !isMutualFund(r))
      .map((r) => toYahooSymbol(r.stock_symbol))
      .filter((y) => !quotes.has(String(y).toUpperCase()) && !failedSymbols.has(y)))];
    for (let j = 0; j < recheck.length && !stopNow(); j += QUOTE_RETRY_BATCH) {
      const small = recheck.slice(j, j + QUOTE_RETRY_BATCH);
      try {
        const res = await yf.quote(small, {}, { validateResult: false });
        for (const q of [].concat(res || [])) if (q && q.symbol) quotes.set(q.symbol.toUpperCase(), q);
      } catch {
        small.forEach((y) => failedSymbols.add(y));
      }
      await sleep(QUOTE_DELAY_MS);
    }
  }
  // Stopped mid-fetch: the quotes are incomplete, and judging rows on them would mark every
  // stock without a quote as delisted - so nothing is compared or written at all.
  const quotesIncomplete = fetched.stopped;
  if (ySymbols.length && quotes.size === 0 && !quotesIncomplete) {
    throw new Error('Yahoo Finance returned no quotes at all - nothing checked, nothing changed');
  }

  const liveCount = new Map();
  for (const r of rows) {
    if (!r.isdelisted) {
      const s = r.stock_symbol.trim().toUpperCase();
      liveCount.set(s, (liveCount.get(s) || 0) + 1);
    }
  }
  const ctx = { listing, quotes, failedSymbols, liveCount, now: Date.now() };
  // The table's unique index is on (stock_symbol, company_name): a rename to the name another row
  // of the same symbol already has (usually the company's old delisted row - ADCT 124802 vs 8837)
  // can't be written. When the holder is a delisted row, it is renamed "<its name> (old)" first,
  // so the listed row can take the correct name (the user, 2026-10-13, for ADCT: the listed row
  // gets the name; renaming the old delisted row is the exception made for this case). When the
  // holder is another live row, the row is left completely alone (no field changes, no
  // detail/CUSIP fill) and only noted for a person. Every row of a checked symbol is loaded, so
  // this map sees all of them.
  const symbolNameKey = (symbol, name) => `${symbol}\u0000${name}`;
  const rowBySymbolName = new Map(rows.map((r) => [symbolNameKey(r.stock_symbol, r.company_name), r]));

  const items = [];
  const counts = { checked: checkRows.length, listed: 0, delisted: 0, unknown: 0, updated: 0, errors: 0 };
  const fieldCounts = {};
  const finalRows = [];
  const loopItems = new Map(); // id -> item, so a renamed delisted holder and its own check share one
  const report = (item) => { if (!items.includes(item)) items.push(item); };
  const freeName = (holder) => {
    let name = `${holder.company_name} (old)`;
    for (let n = 2; rowBySymbolName.has(symbolNameKey(holder.stock_symbol, name)); n++) name = `${holder.company_name} (old ${n})`;
    return name;
  };

  // Each stock is handled in one go (the user, 2026-10-15): status / name / market (plus OTC tier
  // and currency) compared and written, then - on an applying run, if it is still trading in a US
  // market - its CUSIP looked up and written, before the next stock. So a stopped run leaves every
  // stock it reached complete. Only rows without a CUSIP are checked; a stored CUSIP is never
  // re-checked (the SEC re-check of 2026-10-12 was removed on 2026-10-15).
  // Order: rows on NASDAQ Trader's listing first, oldest first, rows whose CUSIP lookup found
  // nothing in the last CUSIP_SKIP_MS last. Newest-first picked the same 50 brand-new issuers and
  // foreign OTC names every run (no 13G yet / no SEC CIK), so a run filled 0/50 while older listed
  // stocks fill almost always (a 2026-10-08 sample: 9/9). A new add has its own lookup + retries
  // (routes/stocks.js), so it doesn't need priority here.
  const onListing = (r) => Boolean(listing && listing.has(String(r.stock_symbol).toUpperCase()));
  const recentlyMissed = (r) => (Date.now() - (cusipMissedAt.get(r.id) || 0)) < CUSIP_SKIP_MS;
  checkRows.sort((a, b) => (recentlyMissed(a) - recentlyMissed(b)) || (onListing(b) - onListing(a)) || a.id - b.id);
  const cusip = { missing: 0, tried: 0, filled: 0, conflicts: 0, errors: 0 };
  // A CUSIP taken back from another stock whose own (verified) CUSIP is different: that stock's
  // value was corrected too (releaseFromHolder) - report it as its own change.
  const recordHolderFix = (fixed) => {
    let it = loopItems.get(fixed.id);
    if (!it) {
      it = { id: fixed.id, stock_symbol: fixed.stock_symbol, company_name: '', status: 'listed', reason: 'CUSIP corrected', changes: [], notes: [] };
      loopItems.set(fixed.id, it);
    }
    report(it);
    it.changes.push({ field: 'cusips', from: fixed.from, to: fixed.to });
    fieldCounts.cusips = (fieldCounts.cusips || 0) + 1;
  };
  const checkOwner = (row) => (cusipValue) => checkCusipOwner(pool, cusipValue, { stockId: row.id, listing: listing || undefined, companyName: row.company_name, exchange: row.exchange });

  progress('updating', 0, checkRows.length);
  for (let i = 0; i < checkRows.length && !quotesIncomplete; i++) {
    if (stopNow()) break;
    progress('updating', i, checkRows.length);
    const row = checkRows[i];
    const plan = planRow(row, ctx);
    if (plan.fields.company_name !== undefined) {
      const holder = rowBySymbolName.get(symbolNameKey(row.stock_symbol, plan.fields.company_name));
      let blocked = holder && holder.id !== row.id;
      if (blocked && holder.isdelisted && plan.status === 'listed' && plan.live) {
        const oldName = freeName(holder);
        const from = holder.company_name;
        let hItem = loopItems.get(holder.id);
        if (!hItem) {
          hItem = { id: holder.id, stock_symbol: holder.stock_symbol, company_name: from, status: 'delisted', reason: `name given to id ${row.id}`, changes: [], notes: [] };
          loopItems.set(holder.id, hItem);
          items.push(hItem);
        }
        if (!items.includes(hItem)) items.push(hItem); // its own check had nothing to report
        hItem.changes.push({ field: 'company_name', from, to: oldName });
        hItem.notes.push(`renamed so the listed row with this symbol (id ${row.id}) can use its name: ${from}`);
        fieldCounts.company_name = (fieldCounts.company_name || 0) + 1;
        try {
          if (apply) await applyStockUpdate(pool, holder.id, { company_name: oldName });
          rowBySymbolName.delete(symbolNameKey(holder.stock_symbol, from));
          rowBySymbolName.set(symbolNameKey(holder.stock_symbol, oldName), holder);
          holder.company_name = oldName;
          blocked = false;
        } catch (err) {
          counts.errors += 1;
          hItem.error = err.message;
        }
      }
      if (blocked) {
        plan.notes.push(`name already used by another row with this symbol (id ${holder.id}${holder.isdelisted ? ', delisted' : ''}): ${plan.fields.company_name} - nothing changed`);
        plan.fields = {};
        plan.skipped = true;
      } else if (apply) {
        rowBySymbolName.delete(symbolNameKey(row.stock_symbol, row.company_name));
        rowBySymbolName.set(symbolNameKey(row.stock_symbol, plan.fields.company_name), row);
      }
    }
    counts[plan.status] += 1;
    const changes = Object.entries(plan.fields).map(([field, to]) => ({ field, from: row[field] ?? null, to }));
    // A delisted row renamed above (to free its name) already has an item: this check joins it.
    const earlier = loopItems.get(row.id);
    const item = earlier
      ? Object.assign(earlier, { status: plan.status, reason: plan.reason, changes: [...earlier.changes, ...changes], notes: [...earlier.notes, ...plan.notes] })
      : { id: row.id, stock_symbol: row.stock_symbol, company_name: row.company_name, status: plan.status, reason: plan.reason, changes, notes: plan.notes };
    loopItems.set(row.id, item);

    if (changes.length) {
      for (const c of changes) fieldCounts[c.field] = (fieldCounts[c.field] || 0) + 1;
      if (apply) {
        try {
          await applyStockUpdate(pool, row.id, plan.fields);
          counts.updated += 1;
        } catch (err) {
          counts.errors += 1;
          item.error = err.message;
        }
      }
    }
    if (!earlier && (changes.length || plan.notes.length)) items.push(item);
    const finalRow = { ...row, ...plan.fields };
    finalRows.push({ row: finalRow, plan });

    // Its CUSIP, right away: only if still trading and (after this run's market change) still in
    // a US market, and not left alone above. A preview only counts these.
    if (!(plan.status === 'listed' && plan.live && !plan.skipped && isBlank(finalRow.cusips)
      && US_MARKETS.has(marketOf(finalRow.exchange)))) continue;
    cusip.missing += 1;
    if (!apply || cusip.tried >= cusipLimit || item.error || stopNow()) continue;
    cusip.tried += 1;
    try {
      const found = await lookupCusip(finalRow.stock_symbol, { companyName: finalRow.company_name, listing: listing || undefined, checkOwner: checkOwner(finalRow) });
      if (found.cusip) {
        const freed = await releaseFromHolder(pool, found.owner, found.cusip);
        if (!freed.ok) {
          const { holder } = found.owner;
          cusip.conflicts += 1;
          item.cusipConflict = { cusip: found.cusip, id: holder.id, stock_symbol: holder.stock_symbol };
        } else {
          if (freed.fixed) recordHolderFix(freed.fixed);
          await applyStockUpdate(pool, row.id, { cusips: found.cusip });
          cusip.filled += 1;
          cusip.missing -= 1; // "still missing" after this run
          item.filled = { ...item.filled, cusip: found.cusip };
        }
        report(item);
      } else {
        cusipMissedAt.set(row.id, Date.now());
      }
    } catch (err) {
      cusip.errors += 1;
      item.fillError = { part: 'cusip', message: err.message };
      report(item);
    }
    await sleep(CUSIP_DELAY_MS);
  }

  counts.checked = finalRows.length; // fewer than checkRows.length if stopped

  return {
    apply,
    stopped,
    stoppedDuringQuotes: quotesIncomplete,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    listingAvailable: Boolean(listing),
    failedQuotes: failedSymbols.size,
    counts,
    fieldCounts,
    cusip,
    items,
  };
}

module.exports = { runStockMonitor, planRow, marketOf, otcCategory, FRESH_DAYS, STALE_DAYS };
