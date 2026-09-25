const YahooFinance = require('yahoo-finance2').default;
const { companyNamesMatch } = require('./normalizeCompanyName');

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Kept only as a display normalizer for the exchange codes Yahoo returns on `quote()`;
// no longer used to reject symbols, since `exchange` is now free text, not a 4-value enum.
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

function isEmptyDetails(fields) {
  return Object.values(fields).every((v) => v == null);
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

  try {
    const fields = await fetchDetailsForSymbol(symbol);
    if (!isEmptyDetails(fields)) return fields;
  } catch (err) {
    // fall through to the alternate-listing attempt below
  }

  if (companyName) {
    const altSymbol = await findAlternateSymbol(companyName);
    if (altSymbol && altSymbol.toUpperCase() !== symbol.toUpperCase()) {
      try {
        const fields = await fetchDetailsForSymbol(altSymbol);
        if (!isEmptyDetails(fields)) return fields;
      } catch (err) {
        // give up - return empty below
      }
    }
  }

  return empty;
}

// Looks up a symbol on Yahoo Finance and maps it to our stocks schema, including best-effort
// extended company details. Throws YahooLookupError with a user-facing message on failure.
async function lookupStock(symbol) {
  let quote;
  try {
    quote = await yf.quote(symbol);
  } catch (err) {
    quote = null;
  }

  if (!quote) {
    throw new YahooLookupError(`symbol "${symbol}" not found on Yahoo Finance`);
  }

  if (quote.quoteType !== 'EQUITY') {
    throw new YahooLookupError(`"${symbol}" is a ${quote.quoteType}, not a common equity`);
  }

  const exchange = quote.fullExchangeName || EXCHANGE_TO_MARKET[quote.exchange] || quote.exchange;
  if (!exchange) {
    throw new YahooLookupError(`"${symbol}" has no exchange information on Yahoo Finance`);
  }

  const company_name = quote.longName || quote.shortName;
  if (!company_name) {
    throw new YahooLookupError(`"${symbol}" has no company name on Yahoo Finance`);
  }

  const details = await fetchCompanyDetails(symbol, company_name);

  return {
    stock_symbol: quote.symbol.toUpperCase(),
    company_name,
    exchange,
    currency: details.currency || quote.currency || null,
    sector: details.sector,
    industry: details.industry,
    company_location: details.company_location,
    urll: details.urll,
    description: details.description,
    ceo: details.ceo,
  };
}

module.exports = { lookupStock, fetchCompanyDetails, YahooLookupError, EXCHANGE_TO_MARKET, yf };
