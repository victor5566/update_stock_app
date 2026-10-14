const { fetchCompanyDetails } = require('./yahoo');
const { sanitizeText } = require('./sanitizeText');
const { TABLE, ID, isBlank } = require('./stockTable');

// API field (fetchCompanyDetails) -> column.
const COLUMN = {
  sector: 'sector', industry: 'industry', currency: 'currency', company_location: 'company_location',
  urll: 'companysite', description: 'description', ceo: 'ceo',
};
const FIELDS = Object.keys(COLUMN);
// Only filled when the row has none. Currency: the table spans many markets, and Yahoo's value
// follows the foreign listing when the fallback was used (ULUCF got CAD from RME.V).
// company_location used to be fill-only too (the table mostly holds short forms - "CA", "New York;
// U.S.A"); since 2026-10-15 the user wants it replaced by Yahoo's full postal address
// ("One Apple Park Way, Cupertino, CA 95014, United States"), so it is kept current like the rest.
const FILL_ONLY = new Set(['currency']);

const squash = (v) => String(v).replace(/\s+/g, ' ').trim();
// "https://www.agnc.com" and "https://agnc.com/" are the same website.
const siteKey = (v) => squash(v).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
const sameValue = (column, a, b) => (column === 'companysite' ? siteKey(a) === siteKey(b) : squash(a) === squash(b));

// Fetches company details from Yahoo Finance and writes the ones that differ from the stored
// row: an empty column is filled, and sector / industry / company_location / companysite /
// description / ceo are replaced when Yahoo now says something else (a new CEO - AAPL's - a moved
// website, a rewritten description, a full address for "CA"). A field Yahoo returns nothing for this time keeps its stored value (Yahoo's
// per-field coverage flickers between calls). Nothing is written when nothing differs, so the
// table's audit trigger only records real changes.
// Returns false if Yahoo had no profile for this symbol (even after fetchCompanyDetails' own
// foreign-listing fallback - see lib/yahoo.js), else { fields, filled, changes }: fields = the
// columns Yahoo gave a value for, filled = columns that were empty and got one, changes =
// [{ field, from, to }] for columns whose stored value was replaced.
// replace: false only fills empty columns (the monitor passes it when Yahoo's quote doesn't name
// the row's company). `stock` must include `id` and `company_name`, which powers that fallback. Shared by
// scripts/fill-company-details.js (bulk backfill), the new-stock auto-fill in routes/stocks.js
// and the stock monitor.
async function fillCompanyDetails(pool, stock, { replace = true } = {}) {
  const details = await fetchCompanyDetails(stock.stock_symbol, stock.company_name);

  // Currency alone isn't "found": Yahoo returns it even for a ticker with no profile yet (a
  // brand-new listing like VYLR) - counting it made the add auto-fill log "company details
  // filled" for a row that stayed empty.
  if (FIELDS.every((f) => f === 'currency' || details[f] == null)) {
    return false;
  }

  const columns = FIELDS.map((f) => COLUMN[f]);
  const { rows } = await pool.query(`SELECT ${columns.join(', ')} FROM ${TABLE} WHERE ${ID} = $1`, [stock.id]);
  if (!rows.length) return false;
  const stored = rows[0];

  const set = {};
  const filled = [];
  const changes = [];
  for (const f of FIELDS) {
    const column = COLUMN[f];
    if (details[f] == null || isBlank(details[f])) continue;
    const value = f === 'ceo' ? squash(sanitizeText(details[f])) : sanitizeText(details[f]);
    if (isBlank(stored[column])) {
      set[column] = value;
      filled.push(column);
    } else if (replace && !FILL_ONLY.has(f) && !sameValue(column, stored[column], value)) {
      set[column] = value;
      changes.push({ field: column, from: stored[column], to: value });
    }
  }

  const written = Object.keys(set);
  if (written.length) {
    await pool.query(
      `UPDATE ${TABLE} SET ${written.map((c, i) => `${c} = $${i + 1}`).join(', ')}, updated_at = now()
       WHERE ${ID} = $${written.length + 1}`,
      [...written.map((c) => set[c]), stock.id]
    );
  }
  return { fields: FIELDS.filter((f) => details[f] != null).map((f) => COLUMN[f]), filled, changes };
}

module.exports = { fillCompanyDetails };
