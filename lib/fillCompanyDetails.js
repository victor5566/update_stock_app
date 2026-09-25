const { fetchCompanyDetails } = require('./yahoo');
const { sanitizeText } = require('./sanitizeText');

const FIELDS = ['sector', 'industry', 'currency', 'company_location', 'urll', 'description', 'ceo'];

// Fetches best-effort company details from Yahoo Finance and writes them straight to the
// stocks row - no history, since only company_name/stock_symbol changes are logged there.
// Returns true if anything was written, false if Yahoo had nothing for this symbol (even
// after fetchCompanyDetails' own foreign-listing fallback - see lib/yahoo.js). `stock` must
// include `company_name`, which powers that fallback. Shared by
// scripts/fill-company-details.js (bulk backfill) and the new-stock auto-fill triggered from
// routes/stocks.js's POST handler.
async function fillCompanyDetails(pool, stock) {
  const details = await fetchCompanyDetails(stock.stock_symbol, stock.company_name);

  if (FIELDS.every((f) => details[f] == null)) {
    return false;
  }

  await pool.query(
    `UPDATE stocks SET sector = $1, industry = $2, currency = $3, company_location = $4,
       urll = $5, description = $6, ceo = $7, updated_at = now()
     WHERE id = $8`,
    [details.sector, details.industry, details.currency, sanitizeText(details.company_location),
      details.urll, sanitizeText(details.description), sanitizeText(details.ceo), stock.id]
  );
  return true;
}

module.exports = { fillCompanyDetails };
