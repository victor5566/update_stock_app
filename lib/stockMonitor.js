// Stock monitor: checks every row of the stock table against NASDAQ Trader's official listing
// and Yahoo Finance, decides whether each stock is still trading, and updates / fills in its
// info. It never deletes anything - a stock that stopped trading only gets isdelisted = true.
// Shared by scripts/monitor-stocks.js (CLI), routes/monitor.js (the UI's buttons) and the
// optional daily schedule in server.js.
//
// Per row it may set: isdelisted, company_name, exchange, category (OTC rows), currency (only
// when empty). Then, for a limited number of rows per run (slow, rate-limited lookups):
// sector / industry / company_location / companysite / ceo / description via
// lib/fillCompanyDetails.js, and cusips via lib/cusipLookup.js. stock_symbol is never changed
// automatically - a symbol change can't be told apart from a recycled ticker reliably.
const { yf, toYahooSymbol, marketLabelForQuote } = require('./yahoo');
const { loadNasdaqTraderListing } = require('./nasdaqTrader');
const { cleanSecurityName } = require('./cleanSecurityName');
const { sameCompany, similarNames, isAbbreviationOf, isWordAbbreviationOf, stripFundFamily, namePartOf, matchCasing, nearlyEqual } = require('./normalizeCompanyName');
const { applyStockUpdate } = require('./applyStockUpdate');
const { fillCompanyDetails } = require('./fillCompanyDetails');
const { lookupCusip, findCusipConflict } = require('./cusipLookup');
const { TABLE, ID, isBlank } = require('./stockTable');

const DAY_MS = 24 * 60 * 60 * 1000;
// Last trade within FRESH_DAYS = trading. Older than STALE_DAYS = stopped trading. In between
// (thin OTC stocks can go weeks without a trade) the status is left alone.
const FRESH_DAYS = 30;
const STALE_DAYS = 120;
const QUOTE_BATCH = 200;
const QUOTE_RETRY_BATCH = 25;
const QUOTE_DELAY_MS = 300;
const DETAIL_DELAY_MS = 200;
// quantumonline.com is a small site (see scripts/fill-cusip.js's QOL_DELAY_MS); SEC requests
// are paced separately inside lib/cusipLookup.js.
const CUSIP_DELAY_MS = Number(process.env.QOL_DELAY_MS) || 500;
// Rows per applying run for the slow lookups (raised 2026-10-08 from 300 / 50 at the user's
// request; the pacing above is unchanged, so a run just takes longer - roughly 10-15 min of
// detail lookups and 5-10 min of CUSIP lookups on top of the ~5 min check).
// MONITOR_DETAIL_LIMIT / MONITOR_CUSIP_LIMIT in .env override them.
const DEFAULT_DETAIL_LIMIT = 1000;
const DEFAULT_CUSIP_LIMIT = 300;
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

    if (isBlank(row.currency) && quote && quote.currency) fields.currency = quote.currency;
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

const DETAIL_COLUMNS = ['sector', 'industry', 'company_location', 'companysite', 'ceo'];

// options: apply (write changes; default false = preview), symbols (only these),
// detailLimit / cusipLimit (rows per run for the slow lookups), onProgress({ phase, done, total }),
// shouldStop() (checked between rows / batches; a stopped run returns what it did so far with
// stopped: true - changes already written stay written).
async function runStockMonitor(pool, options = {}) {
  const shouldStop = options.shouldStop || (() => false);
  let stopped = false;
  const stopNow = () => stopped || (stopped = shouldStop());
  const apply = Boolean(options.apply);
  const symbols = (options.symbols || []).map((s) => s.trim().toUpperCase()).filter(Boolean);
  const detailLimit = options.detailLimit ?? DEFAULT_DETAIL_LIMIT;
  const cusipLimit = options.cusipLimit ?? DEFAULT_CUSIP_LIMIT;
  const progress = (phase, done, total) => options.onProgress && options.onProgress({ phase, done, total });
  const startedAt = new Date();

  progress('loading', 0, 0);
  const { rows } = await pool.query(
    `SELECT ${ID} AS id, stock_symbol, company_name, exchange, isdelisted, category, cusips, sector,
       industry, currency, company_location, companysite, ceo,
       (description IS NULL OR description = '') AS no_description
     FROM ${TABLE} ${symbols.length ? 'WHERE upper(stock_symbol) = ANY($1)' : ''}
     ORDER BY ${ID}`,
    symbols.length ? [symbols] : []
  );

  let listing = null;
  try {
    listing = await loadNasdaqTraderListing();
  } catch {
    // Without the official listing, no listed stock is renamed, moved or marked delisted on
    // Yahoo's word alone (see planRow).
  }

  const ySymbols = [...new Set(rows.map((r) => toYahooSymbol(r.stock_symbol)))];
  const fetched = await fetchQuotes(ySymbols, (done, total) => progress('quotes', done, total), stopNow);
  const { quotes, failedSymbols } = fetched;
  // A batch answer can silently leave a symbol out (PARJX, a live mutual fund, was marked
  // delisted on 2026-10-08 that way). Before a live exchange-listed row is called delisted for
  // having no quote, ask Yahoo again for just those symbols, in small batches; one that fails
  // here counts as failed (status left alone).
  if (!fetched.stopped) {
    const recheck = [...new Set(rows.filter((r) => !r.isdelisted && listing
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
  // can't be written. Per the user, such a row is left completely alone (no field changes, no
  // detail/CUSIP fill) and only noted for a person. Every row of a checked symbol is loaded, so
  // this map sees all of them.
  const symbolNameKey = (symbol, name) => `${symbol}\u0000${name}`;
  const rowBySymbolName = new Map(rows.map((r) => [symbolNameKey(r.stock_symbol, r.company_name), r]));

  const items = [];
  const counts = { checked: rows.length, listed: 0, delisted: 0, unknown: 0, updated: 0, errors: 0 };
  const fieldCounts = {};
  const finalRows = [];
  progress('updating', 0, rows.length);
  for (let i = 0; i < rows.length && !quotesIncomplete; i++) {
    if (stopNow()) break;
    const row = rows[i];
    const plan = planRow(row, ctx);
    if (plan.fields.company_name !== undefined) {
      const holder = rowBySymbolName.get(symbolNameKey(row.stock_symbol, plan.fields.company_name));
      if (holder && holder.id !== row.id) {
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
    const item = { id: row.id, stock_symbol: row.stock_symbol, company_name: row.company_name, status: plan.status, reason: plan.reason, changes, notes: plan.notes };

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
    if (changes.length || plan.notes.length) items.push(item);
    finalRows.push({ row: { ...row, ...plan.fields }, plan });
    if (i % 500 === 0) progress('updating', i, rows.length);
  }

  counts.checked = finalRows.length; // fewer than rows.length if stopped

  // Slow lookups, only for rows that are trading: company details, then CUSIP (US only).
  const detailTodo = finalRows.filter(({ row, plan }) => plan.status === 'listed' && plan.live && !plan.skipped
    && (DETAIL_COLUMNS.some((c) => isBlank(row[c])) || row.no_description));
  const cusipTodo = finalRows.filter(({ row, plan }) => plan.status === 'listed' && plan.live && !plan.skipped
    && isBlank(row.cusips) && US_MARKETS.has(marketOf(row.exchange)));
  // US markets first, newest rows first.
  const byPriority = (a, b) => (US_MARKETS.has(marketOf(b.row.exchange)) - US_MARKETS.has(marketOf(a.row.exchange))) || b.row.id - a.row.id;
  detailTodo.sort(byPriority);
  // CUSIP: rows on NASDAQ Trader's listing first, oldest first. Newest-first picked the same 50
  // brand-new issuers and foreign OTC names every run (no 13G yet / no SEC CIK), so a run filled
  // 0/50 while older listed stocks fill almost always (a 2026-10-08 sample: 9/9). A new add has
  // its own lookup + retries (routes/stocks.js), so it doesn't need priority here. Rows that came
  // back "not found" in the last CUSIP_SKIP_MS are put last, so each run tries new ones.
  const onListing = (r) => Boolean(listing && listing.has(String(r.stock_symbol).toUpperCase()));
  const recentlyMissed = (r) => (Date.now() - (cusipMissedAt.get(r.id) || 0)) < CUSIP_SKIP_MS;
  cusipTodo.sort((a, b) => (recentlyMissed(a.row) - recentlyMissed(b.row))
    || (onListing(b.row) - onListing(a.row)) || a.row.id - b.row.id);

  const details = { missing: detailTodo.length, tried: 0, filled: 0, errors: 0 };
  const cusip = { missing: cusipTodo.length, tried: 0, filled: 0, conflicts: 0, errors: 0 };
  // The applying run's report also lists every row whose company details or CUSIP were filled
  // (item.filled), or whose CUSIP couldn't be written (item.cusipConflict) or whose lookup failed
  // (item.fillError: { part: 'details' | 'cusip', message }).
  const itemById = new Map(items.map((it) => [it.id, it]));
  const itemFor = ({ row, plan }) => {
    if (!itemById.has(row.id)) {
      const it = { id: row.id, stock_symbol: row.stock_symbol, company_name: row.company_name, status: plan.status, reason: plan.reason, changes: [], notes: [] };
      itemById.set(row.id, it);
      items.push(it);
    }
    return itemById.get(row.id);
  };
  if (apply && !stopped) {
    const batch = detailTodo.slice(0, detailLimit);
    for (let i = 0; i < batch.length; i++) {
      if (stopNow()) break;
      const { row } = batch[i];
      progress('details', i, batch.length);
      details.tried += 1;
      try {
        const written = await fillCompanyDetails(pool, row);
        // Only fields that were empty count as filled (COALESCE may also refresh stored values).
        const filled = written ? written.fields.filter((f) => (f === 'description' ? row.no_description : isBlank(row[f]))) : [];
        if (filled.length) {
          details.filled += 1;
          const it = itemFor(batch[i]);
          it.filled = { ...it.filled, details: filled };
        }
      } catch (err) {
        details.errors += 1;
        itemFor(batch[i]).fillError = { part: 'details', message: err.message };
      }
      await sleep(DETAIL_DELAY_MS);
    }

    const cBatch = cusipTodo.slice(0, cusipLimit);
    for (let i = 0; i < cBatch.length; i++) {
      if (stopNow()) break;
      const { row } = cBatch[i];
      progress('cusip', i, cBatch.length);
      cusip.tried += 1;
      try {
        const found = await lookupCusip(row.stock_symbol, { companyName: row.company_name, listing: listing || undefined });
        if (found.cusip) {
          const holder = await findCusipConflict(pool, found.cusip, { stockId: row.id });
          if (holder) {
            cusip.conflicts += 1;
            itemFor(cBatch[i]).cusipConflict = { cusip: found.cusip, id: holder.id, stock_symbol: holder.stock_symbol };
          } else {
            await applyStockUpdate(pool, row.id, { cusips: found.cusip });
            cusip.filled += 1;
            const it = itemFor(cBatch[i]);
            it.filled = { ...it.filled, cusip: found.cusip };
          }
        } else {
          cusipMissedAt.set(row.id, Date.now());
        }
      } catch (err) {
        cusip.errors += 1;
        itemFor(cBatch[i]).fillError = { part: 'cusip', message: err.message };
      }
      await sleep(CUSIP_DELAY_MS);
    }
  }

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
    details,
    cusip,
    items,
  };
}

module.exports = { runStockMonitor, planRow, marketOf, otcCategory, FRESH_DAYS, STALE_DAYS };
