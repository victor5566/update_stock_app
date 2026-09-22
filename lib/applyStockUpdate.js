// Round-trips text through a Buffer so any invalid/unpaired UTF-16 content (occasionally
// seen in text sourced from external APIs) becomes valid UTF-8 before hitting Postgres,
// which otherwise rejects the whole INSERT with "invalid byte sequence for encoding".
function sanitizeText(str) {
  return Buffer.from(String(str), 'utf8').toString('utf8');
}

// Shared core of "update a stock and log what changed". Must run inside an existing
// transaction (the caller owns BEGIN/COMMIT/ROLLBACK and client.connect/release) so the
// update and its history rows land atomically. Returns the updated row, or null if the
// stock id doesn't exist. `fields` values must already be trimmed/uppercased as needed -
// this function does no validation, only the diff-and-log.
async function applyStockUpdate(client, id, fields) {
  const companyName = fields.company_name !== undefined ? sanitizeText(fields.company_name) : undefined;

  const setClauses = [];
  const params = [];

  if (fields.stock_symbol !== undefined) {
    params.push(fields.stock_symbol);
    setClauses.push(`stock_symbol = $${params.length}`);
  }
  if (companyName !== undefined) {
    params.push(companyName);
    setClauses.push(`company_name = $${params.length}`);
  }
  if (fields.trading_market !== undefined) {
    params.push(fields.trading_market);
    setClauses.push(`trading_market = $${params.length}`);
  }
  if (!setClauses.length) {
    throw new Error('applyStockUpdate: no fields to update');
  }

  setClauses.push('updated_at = now()');
  params.push(id);

  const before = await client.query(
    'SELECT company_name, stock_symbol FROM stocks WHERE id = $1 FOR UPDATE',
    [id]
  );
  if (!before.rows.length) return null;

  const result = await client.query(
    `UPDATE stocks SET ${setClauses.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  const updated = result.rows[0];

  if (companyName !== undefined && companyName !== before.rows[0].company_name) {
    await client.query(
      `INSERT INTO company_name_history (stock_id, stock_symbol, old_company_name, new_company_name)
       VALUES ($1, $2, $3, $4)`,
      [updated.id, updated.stock_symbol, before.rows[0].company_name, companyName]
    );
  }

  if (fields.stock_symbol !== undefined && fields.stock_symbol !== before.rows[0].stock_symbol) {
    await client.query(
      `INSERT INTO stock_symbol_history (stock_id, company_name, old_stock_symbol, new_stock_symbol)
       VALUES ($1, $2, $3, $4)`,
      [updated.id, updated.company_name, before.rows[0].stock_symbol, fields.stock_symbol]
    );
  }

  return updated;
}

module.exports = { applyStockUpdate };
