const { sanitizeText } = require('./sanitizeText');
const { TABLE, ID, SELECT_COLUMNS, writeColumn } = require('./stockTable');

const UPDATABLE = [
  'stock_symbol', 'company_name', 'exchange', 'isdelisted', 'category', 'cusips', 'sector',
  'industry', 'currency', 'company_location', 'urll', 'description', 'ceo',
];

// Updates one stock row and returns it (API shape, see lib/stockTable.js), or null if the id
// doesn't exist. `fields` values must already be trimmed/uppercased as needed - this function
// does no validation. No history is written: company_profiles has its own audit trigger.
async function applyStockUpdate(db, id, fields) {
  const setClauses = [];
  const params = [];
  for (const field of UPDATABLE) {
    if (fields[field] === undefined) continue;
    params.push(field === 'company_name' ? sanitizeText(fields[field]) : fields[field]);
    setClauses.push(`${writeColumn(field)} = $${params.length}`);
  }
  if (!setClauses.length) {
    throw new Error('applyStockUpdate: no fields to update');
  }

  setClauses.push('updated_at = now()');
  params.push(id);
  const result = await db.query(
    `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE ${ID} = $${params.length} RETURNING ${SELECT_COLUMNS}`,
    params
  );
  return result.rows[0] || null;
}

module.exports = { applyStockUpdate };
