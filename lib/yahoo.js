const YahooFinance = require('yahoo-finance2').default;

const yf = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

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

// Looks up a symbol on Yahoo Finance and maps it to our stocks schema.
// Throws YahooLookupError with a user-facing message on failure.
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

  const trading_market = EXCHANGE_TO_MARKET[quote.exchange];
  if (!trading_market) {
    throw new YahooLookupError(
      `"${symbol}" trades on an unsupported exchange (${quote.fullExchangeName || quote.exchange})`
    );
  }

  const company_name = quote.longName || quote.shortName;
  if (!company_name) {
    throw new YahooLookupError(`"${symbol}" has no company name on Yahoo Finance`);
  }

  return {
    stock_symbol: quote.symbol.toUpperCase(),
    company_name,
    trading_market,
  };
}

module.exports = { lookupStock, YahooLookupError, EXCHANGE_TO_MARKET, yf };
