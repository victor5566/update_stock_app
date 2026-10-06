// Usage: node scripts/monitor-stocks.js [--apply] [--detail-limit N] [--cusip-limit N] [--list] [SYMBOL ...]
// Checks stocks against NASDAQ Trader's listing and Yahoo Finance (lib/stockMonitor.js):
// listed / delisted status, name, market, OTC category, currency, then fills missing company
// details and CUSIPs for up to --detail-limit / --cusip-limit trading rows. Never deletes.
// Preview only (nothing written) unless --apply. --list prints every change and note.
require('dotenv').config();
const pool = require('../db');
const { runStockMonitor } = require('../lib/stockMonitor');

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const list = args.includes('--list');
  const symbols = args.filter((a, i) => !a.startsWith('--') && !/^--(detail|cusip)-limit$/.test(args[i - 1] || ''));

  let lastPhase = '';
  const report = await runStockMonitor(pool, {
    apply,
    symbols,
    detailLimit: argValue('--detail-limit'),
    cusipLimit: argValue('--cusip-limit'),
    onProgress: ({ phase, done, total }) => {
      if (phase !== lastPhase || done === total) console.log(`[${phase}] ${done}/${total}`);
      lastPhase = phase;
    },
  });

  const { counts, fieldCounts, details, cusip } = report;
  console.log(`\n${apply ? 'APPLIED' : 'PREVIEW (nothing written - pass --apply to write)'}`);
  console.log(`Checked ${counts.checked}: listed ${counts.listed}, delisted ${counts.delisted}, unknown ${counts.unknown}`);
  console.log(`Field changes: ${JSON.stringify(fieldCounts)}${apply ? `; rows updated ${counts.updated}, errors ${counts.errors}` : ''}`);
  console.log(`Company details: ${details.missing} trading rows missing some; ${apply ? `tried ${details.tried}, filled ${details.filled}` : 'filled only with --apply'}`);
  console.log(`CUSIP: ${cusip.missing} trading US rows missing; ${apply ? `tried ${cusip.tried}, filled ${cusip.filled}, conflicts ${cusip.conflicts}` : 'filled only with --apply'}`);
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
