const { fetchCompanyDetails } = require('./yahoo');
const { sanitizeText } = require('./sanitizeText');
const { TABLE, ID } = require('./stockTable');

const FIELDS = ['sector', 'industry', 'currency', 'company_location', 'urll', 'description', 'ceo'];

// Fetches best-effort company details from Yahoo Finance and writes them straight to the
// stock's row. Returns { fields } (the columns Yahoo gave a value for - COALESCE keeps the rest)
// if anything was written, false if Yahoo had no profile for this symbol (even after fetchCompanyDetails' own foreign-listing fallback - see lib/yahoo.js).
// `stock` must include `id` and `company_name`, which powers that fallback. Shared by
// scripts/fill-company-details.js (bulk backfill) and the new-stock auto-fill triggered from
// routes/stocks.js's POST handler.
async function fillCompanyDetails(pool, stock) {
  const details = await fetchCompanyDetails(stock.stock_symbol, stock.company_name);

  // Currency alone isn't "found": Yahoo returns it even for a ticker with no profile yet (a
  // brand-new listing like VYLR) - counting it made the add auto-fill log "company details
  // filled" for a row that stayed empty.
  if (FIELDS.every((f) => f === 'currency' || details[f] == null)) {
    return false;
  }

  // COALESCE: a field Yahoo returns nothing for this time keeps its stored value instead of
  // being wiped (Yahoo's per-field coverage flickers between calls). Currency is only filled
  // when the row has none: the table spans many markets, and Yahoo's value follows the
  // foreign listing when the fallback was used (ULUCF got CAD from RME.V).
  await pool.query(
    `UPDATE ${TABLE} SET sector = COALESCE($1, sector), industry = COALESCE($2, industry),
       currency = COALESCE(NULLIF(currency, ''), $3), company_location = COALESCE($4, company_location),
       companysite = COALESCE($5, companysite), description = COALESCE($6, description), ceo = COALESCE($7, ceo),
       updated_at = now()
     WHERE ${ID} = $8`,
    [details.sector, details.industry, details.currency, sanitizeText(details.company_location),
      details.urll, sanitizeText(details.description), sanitizeText(details.ceo), stock.id]
  );
  return { fields: FIELDS.filter((f) => details[f] != null).map((f) => (f === 'urll' ? 'companysite' : f)) };
}

module.exports = { fillCompanyDetails };
