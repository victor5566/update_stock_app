// CSV format for exporting the stocks table. Shared by scripts/export-to-csv.js (the full
// committed exports/stocks.csv) and GET /api/stocks/export.csv (the stock list's
// "Export CSV" button, which exports whatever the list is currently filtered to).
const EXPORT_COLUMNS = [
  'stock_symbol', 'company_name', 'exchange', 'isdelisted', 'category', 'cusips',
  'sector', 'industry', 'currency', 'company_location', 'urll', 'description', 'ceo',
  'source', 'created_at', 'updated_at',
];

function csvEscape(value) {
  const str = value instanceof Date ? value.toISOString() : value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toCsv(rows) {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(EXPORT_COLUMNS.map((col) => csvEscape(row[col])).join(','));
  }
  return lines.join('\n') + '\n';
}

module.exports = { EXPORT_COLUMNS, toCsv };
