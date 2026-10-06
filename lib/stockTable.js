// The app's stock table is the shared company_profiles table (schema chosen by PGSCHEMA in
// db.js). It isn't ours: its columns can't be changed, and the app may only SELECT / INSERT /
// UPDATE it - never DELETE. Two of its column names differ from what the API and frontend
// use, so reads alias them back (company_profile_id -> id, companysite -> urll) and writes
// map through WRITE_COLUMN.
const TABLE = 'company_profiles';
const ID = 'company_profile_id';

const SELECT_COLUMNS = `${ID} AS id, stock_symbol, company_name, exchange, isdelisted, category,
  cusips, sector, industry, currency, company_location, companysite AS urll, description, ceo,
  created_at, updated_at`;

// API field name -> real column, for fields whose names differ.
const WRITE_COLUMN = { urll: 'companysite' };
const writeColumn = (field) => WRITE_COLUMN[field] || field;

// The table holds empty strings as well as NULLs for "no value".
const isBlank = (value) => value == null || value === '';

// Symbols are not unique here (a recycled ticker keeps its old, delisted row next to the new
// one). When a symbol alone has to pick one row, prefer the live one, then the newest.
const PREFERRED_ORDER = `coalesce(isdelisted, false), (display_security = 'true') DESC, ${ID} DESC`;

module.exports = { TABLE, ID, SELECT_COLUMNS, writeColumn, isBlank, PREFERRED_ORDER };
