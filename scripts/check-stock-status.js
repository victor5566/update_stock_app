// Usage: node scripts/check-stock-status.js
// Cross-checks every stock in the database against Yahoo Finance and rebuilds the
// stock_update_candidates / stock_removal_candidates review lists (see lib/checkStockStatus.js).
// Also triggerable from the web UI's removal-candidates section.
require('dotenv').config();
const pool = require('../db');
const { checkStockStatus } = require('../lib/checkStockStatus');

async function main() {
  const { updateCount, removalCount, failedBatches, listingAvailable } = await checkStockStatus(pool, { log: console.log });
  console.log(`\nDone. ${updateCount} update candidates, ${removalCount} removal candidates.`);
  if (failedBatches) console.log(`WARNING: ${failedBatches} Yahoo batch(es) failed - those stocks weren't checked.`);
  if (!listingAvailable) console.log('WARNING: NASDAQ Trader listing unavailable - no name/market suggestions for listed stocks.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
