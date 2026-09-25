// Usage: node scripts/apply-update-candidates.js
// Applies every row currently in stock_update_candidates to the stocks table (via the
// same transactional diff-and-log path as PUT /api/stocks/:id, so company_name_history /
// stock_symbol_history still get written), then removes the applied rows from the
// candidate table. Run scripts/check-stock-status.js first/after to keep the list fresh.
require('dotenv').config();
const pool = require('../db');
const { applyStockUpdate } = require('../lib/applyStockUpdate');

async function main() {
  const { rows: candidates } = await pool.query(
    `SELECT id, stock_id, stock_symbol, reason, suggested_company_name, suggested_exchange
     FROM stock_update_candidates ORDER BY id`
  );

  console.log(`Applying ${candidates.length} update candidates...`);

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
        console.log(`SKIP ${candidate.stock_symbol}: stock no longer exists`);
        skipped++;
        await client.query('ROLLBACK');
        continue;
      }

      await client.query('DELETE FROM stock_update_candidates WHERE id = $1', [candidate.id]);
      await client.query('COMMIT');
      applied++;
    } catch (err) {
      await client.query('ROLLBACK');
      console.log(`SKIP ${candidate.stock_symbol}: ${err.message}`);
      skipped++;
    } finally {
      client.release();
    }
  }

  console.log(`\nApplied ${applied} updates. Skipped ${skipped}.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
