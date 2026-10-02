const { fetchCompanyDetails } = require('./yahoo');
const { sanitizeText } = require('./sanitizeText');

const FIELDS = ['sector', 'industry', 'currency', 'company_location', 'urll', 'description', 'ceo'];

// Fetches best-effort company details from Yahoo Finance and writes them straight to the
// stocks row - no history, since only company_name/stock_symbol changes are logged there.
// Returns true if anything was written, false if Yahoo had no profile for this symbol (even
// after fetchCompanyDetails' own foreign-listing fallback - see lib/yahoo.js). `stock` must
// include `company_name`, which powers that fallback. Shared by
// scripts/fill-company-details.js (bulk backfill) and the new-stock auto-fill triggered from
// routes/stocks.js's POST handler.
async function fillCompanyDetails(pool, stock) {
  const details = await fetchCompanyDetails(stock.stock_symbol, stock.company_name);

  // Currency alone isn't "found": Yahoo returns it even for a ticker with no profile yet (a
  // brand-new listing like VYLR), and it's always written as USD anyway - counting it made
  // the add auto-fill log "company details filled" for a row that stayed empty.
  if (FIELDS.every((f) => f === 'currency' || details[f] == null)) {
    return false;
  }

  // COALESCE: a field Yahoo returns nothing for this time keeps its stored value instead of
  // being wiped to null (Yahoo's per-field coverage flickers between calls).
  // Currency is always USD: every stock here trades on a US market (NASDAQ/NYSE/AMEX/US OTC),
  // and Yahoo's value followed the foreign listing when the fallback was used (ULUCF got CAD
  // from RME.V) - confirmed by the user, so it's not taken from Yahoo at all.
  await pool.query(
    `UPDATE stocks SET sector = COALESCE($1, sector), industry = COALESCE($2, industry),
       currency = $3, company_location = COALESCE($4, company_location),
       urll = COALESCE($5, urll), description = COALESCE($6, description), ceo = COALESCE($7, ceo),
       updated_at = now()
     WHERE id = $8`,
    [details.sector, details.industry, 'USD', sanitizeText(details.company_location),
      details.urll, sanitizeText(details.description), sanitizeText(details.ceo), stock.id]
  );
  return true;
}

module.exports = { fillCompanyDetails };
