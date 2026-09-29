// Applies every row currently in stock_update_candidates to the stocks table (via the
// same transactional diff-and-log path as PUT /api/stocks/:id, so company_name_history /
// stock_symbol_history still get written), then removes the applied rows from the
// candidate table. One transaction per candidate, so one bad row doesn't block the rest.
// Shared by scripts/apply-update-candidates.js and POST /api/removal-candidates/refresh.
const { applyStockUpdate } = require('./applyStockUpdate');

async function applyUpdateCandidates(pool, { log = () => {} } = {}) {
  const { rows: candidates } = await pool.query(
    `SELECT id, stock_id, stock_symbol, reason, suggested_company_name, suggested_exchange
     FROM stock_update_candidates ORDER BY id`
  );

  log(`Applying ${candidates.length} update candidates...`);

  let applied = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const updated = await applyStockUpdate(client, candidate.stock_id, {
        company_name: candidate.suggested_company_name,
        exchange: candidate.suggested_exchange,
      });

      if (!updated) {
        log(`SKIP ${candidate.stock_symbol}: stock no longer exists`);
        skipped++;
        await client.query('ROLLBACK');
        continue;
      }

      await client.query('DELETE FROM stock_update_candidates WHERE id = $1', [candidate.id]);
      await client.query('COMMIT');
      applied++;
    } catch (err) {
      await client.query('ROLLBACK');
      log(`SKIP ${candidate.stock_symbol}: ${err.message}`);
      skipped++;
    } finally {
      client.release();
    }
  }

  return { applied, skipped };
}

module.exports = { applyUpdateCandidates };
