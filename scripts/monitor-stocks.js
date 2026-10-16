// Usage: node scripts/monitor-stocks.js [--list] [SYMBOL ...]
// Preview of the stock monitor (lib/stockMonitor.js) - writes nothing. Checks the stocks that have
// no CUSIP (live, US market) against NASDAQ Trader's listing and Yahoo Finance and reports what it
// would change: listed / delisted status, name, market, OTC category, currency, renames and ticker
// changes. --list prints every change and note. (The applying --apply run was removed at the
// user's request on 2026-10-16.)
require('dotenv').config();
const pool = require('../db');
const { runStockMonitor } = require('../lib/stockMonitor');

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--apply')) {
    console.error('--apply was removed (2026-10-16): the monitor only previews now - nothing is written.');
    process.exit(2);
  }
  const list = args.includes('--list');
  const symbols = args.filter((a) => !a.startsWith('--'));

  let lastPhase = '';
  const report = await runStockMonitor(pool, {
    symbols,
    onProgress: ({ phase, done, total }) => {
      if (phase !== lastPhase || done === total) console.log(`[${phase}] ${done}/${total}`);
      lastPhase = phase;
    },
  });

  const { counts, fieldCounts, cusip } = report;
  console.log('\nPREVIEW (nothing written)');
  console.log(`Checked ${counts.checked} rows without a CUSIP: listed ${counts.listed}, delisted ${counts.delisted}, unknown ${counts.unknown}`);
  console.log(`Field changes it would make: ${JSON.stringify(fieldCounts)}`);
  if (counts.added) console.log(`New rows it would add for renamed / moved stocks: ${counts.added} (their old rows marked delisted, names kept)`);
  console.log(`CUSIP: ${cusip.missing} trading US rows without one`);
  if (!report.listingAvailable) console.log('WARNING: NASDAQ Trader listing unavailable - listed stocks were judged on Yahoo alone.');
  if (report.failedQuotes) console.log(`WARNING: ${report.failedQuotes} symbols failed on Yahoo - their status was left alone.`);

  if (list) {
    for (const item of report.items) {
      const changes = item.changes.map((c) => `${c.field}: ${c.from ?? '(empty)'} -> ${c.to}`).join('; ');
      console.log([item.stock_symbol, item.status, item.reason, changes, item.notes.join('; '), item.error || ''].filter(Boolean).join(' | '));
    }
  }
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
