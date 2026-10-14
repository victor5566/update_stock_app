const { fetchCompanyDetails } = require('./yahoo');
const { sanitizeText } = require('./sanitizeText');
const { TABLE, ID, isBlank } = require('./stockTable');

// API field (fetchCompanyDetails) -> column.
const COLUMN = {
  sector: 'sector', industry: 'industry', currency: 'currency', company_location: 'company_location',
  urll: 'companysite', description: 'description', ceo: 'ceo',
};
const FIELDS = Object.keys(COLUMN);
// Every field is kept current. company_location and currency used to be fill-only; on 2026-10-15
// the user asked for both to be updated: the location becomes Yahoo's full postal address
// ("CA" -> "One Apple Park Way, Cupertino, CA 95014, United States"), the currency Yahoo's for
// this listing (fetchCompanyDetails keeps the direct quote's currency when its foreign-listing
// fallback supplied the profile - ULUCF would otherwise get RME.V's CAD).

// A US-listed security trades in USD whatever Yahoo's currency says (it labels some Nasdaq
// mutual funds CAD - CFHAX, CFHIX), so for a US-market row only USD is written.
const US_MARKET = /^(nasdaq|nyse|amex|otc|pnk|oem|oqx|oqb|nyq|nms|ngm|ncm|ase|bats|arca|us otc)/i;

const squash = (v) => String(v).replace(/\s+/g, ' ').trim();
// "https://www.agnc.com" and "https://agnc.com/" are the same website.
const siteKey = (v) => squash(v).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');
const sameValue = (column, a, b) => (column === 'companysite' ? siteKey(a) === siteKey(b) : squash(a) === squash(b));

// Fetches company details from Yahoo Finance and writes the ones that differ from the stored
// row: an empty column is filled, and sector / industry / currency / company_location /
// companysite / description / ceo are replaced when Yahoo now says something else (a new CEO - AAPL's - a moved
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
    if (f === 'currency' && US_MARKET.test(String(stock.exchange || '').trim()) && details[f] !== 'USD') continue;
    const value = f === 'ceo' ? squash(sanitizeText(details[f])) : sanitizeText(details[f]);
    if (isBlank(stored[column])) {
      set[column] = value;
      filled.push(column);
    } else if (replace && !sameValue(column, stored[column], value)) {
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
