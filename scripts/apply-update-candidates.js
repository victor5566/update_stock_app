// Usage: node scripts/apply-update-candidates.js
// Applies every row currently in stock_update_candidates to the stocks table, logging
// renames to the history tables (see lib/applyUpdateCandidates.js). Run
// scripts/check-stock-status.js first to keep the list fresh. The web UI's re-check
// button does both steps in one go.
require('dotenv').config();
const pool = require('../db');
const { applyUpdateCandidates } = require('../lib/applyUpdateCandidates');

async function main() {
  const { applied, skipped } = await applyUpdateCandidates(pool, { log: console.log });
  console.log(`\nApplied ${applied} updates. Skipped ${skipped}.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
