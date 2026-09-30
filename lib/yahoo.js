const YahooFinance = require('yahoo-finance2').default;
const { companyNamesMatch } = require('./normalizeCompanyName');

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Maps Yahoo's exchange codes on `quote()` to the short market labels the stocks table uses
// (NASDAQ / NYSE / AMEX / OTC - what NASDAQ Trader and Excel imports write, and what the
// list's market filter matches on). Not a validation gate: `exchange` is free text.
const EXCHANGE_TO_MARKET = {
  NMS: 'NASDAQ',
  NGM: 'NASDAQ',
  NCM: 'NASDAQ',
  NYQ: 'NYSE',
  ASE: 'AMEX',
  PNK: 'OTC',
  OQB: 'OTC',
  OQX: 'OTC',
  OTC: 'OTC',
};

// Name-based fallback for codes not in EXCHANGE_TO_MARKET (e.g. Yahoo's newer OTC tiers
// like "OTC Markets OTCID"). Order matters: "NYSE American" must match before "NYSE".
const FULL_NAME_TO_MARKET = [
  [/^nasdaq/i, 'NASDAQ'],
  [/^nyse american/i, 'AMEX'],
  [/^nyse$/i, 'NYSE'],
  [/^(otc|other otc)/i, 'OTC'],
];

// Yahoo's own names ("NasdaqGS", "NYSE American", "OTC Markets OTCPK") are finer-grained
// than our labels; collapse them so they're treated as the same market. Anything
// unrecognized (NYSE Arca, foreign exchanges...) passes through as Yahoo names it.
function marketLabelForQuote(quote) {
  if (EXCHANGE_TO_MARKET[quote.exchange]) return EXCHANGE_TO_MARKET[quote.exchange];
  const fullName = quote.fullExchangeName;
  if (fullName) {
    const match = FULL_NAME_TO_MARKET.find(([pattern]) => pattern.test(fullName));
    if (match) return match[1];
  }
  return fullName || quote.exchange || null;
}

// Our symbols use the NASDAQ Trader / exchange convention for share classes and SPAC-style
// securities ("BRK.B", "KCA.U", "NE.W", "CELG.R"); Yahoo writes the same instruments with a
// dash and its own suffixes ("BRK-B", "KCA-UN", "NE-WT", "CELG-RI"). Querying Yahoo with our
// form finds nothing, which used to put ~150 perfectly live stocks on the removal list.
const YAHOO_SUFFIX = { U: 'UN', W: 'WT', R: 'RI' };

function toYahooSymbol(symbol) {
  const m = String(symbol).trim().toUpperCase().match(/^([A-Z0-9]+)\.([A-Z])$/);
  if (!m) return String(symbol).trim().toUpperCase();
  return `${m[1]}-${YAHOO_SUFFIX[m[2]] || m[2]}`;
}

// "BRK.B", "BRK-B" and "brk.b" name the same security - compare in Yahoo's form, so a user
// typing Yahoo's spelling can't create a duplicate of a stock we hold in exchange spelling.
function symbolsEquivalent(a, b) {
  return toYahooSymbol(a) === toYahooSymbol(b);
}

class YahooLookupError extends Error {
  constructor(message) {
    super(message);
    this.name = 'YahooLookupError';
  }
}

function findCeo(companyOfficers) {
  if (!Array.isArray(companyOfficers)) return null;
  const ceo = companyOfficers.find((o) => /\bCEO\b|Chief Executive/i.test(o.title || ''));
  return (ceo || companyOfficers[0])?.name || null;
}

// Builds a full postal-style HQ address from assetProfile's separate address fields
// ("One Apple Park Way, Cupertino, CA 95014, United States") rather than just the country -
// non-US companies often have no `state`, so that piece is only included when present.
function composeAddress(profile) {
  const cityStateZip = [profile.city, [profile.state, profile.zip].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const parts = [profile.address1, profile.address2, cityStateZip, profile.country].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

async function fetchDetailsForSymbol(symbol) {
  const summary = await yf.quoteSummary(symbol, { modules: ['assetProfile', 'price'] });
  const profile = summary.assetProfile || {};
  const price = summary.price || {};

  return {
    sector: profile.sector || null,
    industry: profile.industry || null,
    currency: price.currency || null,
    company_location: composeAddress(profile),
    urll: profile.website || null,
    description: profile.longBusinessSummary || null,
    ceo: findCeo(profile.companyOfficers),
  };
}

// "Empty" = no company profile. Currency alone doesn't count: Yahoo returns it from the
// `price` module even for a bare OTC stub (CHCRF had only "USD"), which used to count as
// found and skipped the foreign-listing fallback that has the real profile (CHER.V).
function isEmptyDetails(fields) {
  return Object.entries(fields).every(([k, v]) => k === 'currency' || v == null);
}

// Many thinly-traded US OTC tickers are actually a foreign company's secondary/cross-listing
// (e.g. a Canadian TSXV-listed miner also trading OTC Pink in the US under an unrelated-looking
// ticker) - Yahoo often has nothing under the US ticker but does have the company under its
// primary foreign listing. Searches Yahoo by company name and returns the top EQUITY match's
// symbol, but only when the matched name is the same company after normalizing away
// formatting/legal-suffix differences (lib/normalizeCompanyName.js) - never a loose guess.
async function findAlternateSymbol(companyName) {
  if (!companyName) return null;
  try {
    const { quotes } = await yf.search(companyName, { quotesCount: 5, newsCount: 0 });
    const match = (quotes || []).find(
      (q) => q.quoteType === 'EQUITY' && companyNamesMatch(q.longname || q.shortname, companyName)
    );
    return match ? match.symbol : null;
  } catch (err) {
    return null;
  }
}

// Best-effort fetch of extended company details via quoteSummary. Returns a fields object
// with nulls for anything unavailable - never throws, since these fields are optional and
// a quoteSummary failure shouldn't block a plain symbol/name/exchange lookup. When `companyName`
// is given and the direct symbol lookup comes back empty, falls back to findAlternateSymbol()
// before giving up (see its comment).
async function fetchCompanyDetails(symbol, companyName) {
  const empty = {
    sector: null,
    industry: null,
    currency: null,
    company_location: null,
    urll: null,
    description: null,
    ceo: null,
  };

  let direct = empty;
  try {
    direct = await fetchDetailsForSymbol(toYahooSymbol(symbol));
    if (!isEmptyDetails(direct)) return direct;
  } catch (err) {
    // fall through to the alternate-listing attempt below
  }

  if (companyName) {
    const altSymbol = await findAlternateSymbol(companyName);
    if (altSymbol && altSymbol.toUpperCase() !== toYahooSymbol(symbol)) {
      try {
        const fields = await fetchDetailsForSymbol(altSymbol);
        // Profile from the other listing; its currency is the foreign one (CHER.V: CAD), so
        // don't let it through (callers store USD regardless - see lib/fillCompanyDetails.js).
        if (!isEmptyDetails(fields)) return { ...fields, currency: direct.currency };
      } catch (err) {
        // give up - return what the direct lookup had
      }
    }
  }

  return direct;
}

// Looks up a symbol on Yahoo Finance and maps it to our stocks schema, including best-effort
// extended company details. Throws YahooLookupError with a user-facing message on failure.
async function lookupStock(symbol) {
  let quote;
  try {
    quote = await yf.quote(toYahooSymbol(symbol));
  } catch (err) {
    quote = null;
  }

  if (!quote) {
    throw new YahooLookupError(`symbol "${symbol}" not found on Yahoo Finance`);
  }

  if (quote.quoteType !== 'EQUITY') {
    throw new YahooLookupError(`"${symbol}" is a ${quote.quoteType}, not a common equity`);
  }

  const exchange = marketLabelForQuote(quote);
  if (!exchange) {
    throw new YahooLookupError(`"${symbol}" has no exchange information on Yahoo Finance`);
  }

  const company_name = quote.longName || quote.shortName;
  if (!company_name) {
    throw new YahooLookupError(`"${symbol}" has no company name on Yahoo Finance`);
  }

  const details = await fetchCompanyDetails(symbol, company_name);

  return {
    // Keep the symbol as the caller wrote it ("BRK.B"), not Yahoo's form ("BRK-B").
    stock_symbol: String(symbol).trim().toUpperCase(),
    company_name,
    exchange,
    currency: 'USD', // always - US-market stocks only (see lib/fillCompanyDetails.js)
    sector: details.sector,
    industry: details.industry,
    company_location: details.company_location,
    urll: details.urll,
    description: details.description,
    ceo: details.ceo,
  };
}

module.exports = {
  lookupStock, fetchCompanyDetails, marketLabelForQuote, toYahooSymbol, symbolsEquivalent, YahooLookupError, EXCHANGE_TO_MARKET, yf,
};
