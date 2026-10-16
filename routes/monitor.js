const express = require('express');
const pool = require('../db');
const { runStockMonitor } = require('../lib/stockMonitor');

const router = express.Router();

// Preview only (the user, 2026-10-16): the writing "Check & Update" run and the daily schedule
// (MONITOR_DAILY_AT) were removed - nothing here writes to the table. One preview at a time, in
// the background; the UI polls GET /status. The last preview is kept in-process, so a server
// restart forgets it.
const state = {
  running: false,
  startedAt: null,
  progress: null,
  reports: { preview: null },
  lastError: null,
  stopRequested: false,
};

function startRun() {
  if (state.running) return false;
  Object.assign(state, { running: true, startedAt: new Date().toISOString(), progress: null, lastError: null, stopRequested: false });
  runStockMonitor(pool, {
    apply: false,
    shouldStop: () => state.stopRequested,
    onProgress: (p) => { state.progress = p; },
  })
    .then((report) => {
      state.reports = { preview: report };
      const c = report.counts;
      console.log(`[monitor] preview${report.stopped ? ' (stopped)' : ''}: ${c.checked} checked, ${c.listed} listed, ${c.delisted} delisted, ${c.unknown} unknown, ${report.items.filter((i) => i.changes.length).length} with changes, ${report.cusip.missing} without a CUSIP`);
    })
    .catch((err) => {
      state.lastError = err.message;
      console.error(`[monitor] failed: ${err.message}`);
    })
    .finally(() => {
      state.running = false;
      state.progress = null;
    });
  return true;
}

// POST /api/monitor/run - start a preview (nothing is written; an `apply` in the body is ignored).
router.post('/run', (req, res) => {
  if (!startRun()) {
    return res.status(409).json({ errors: ['a check is already running'] });
  }
  res.status(202).json({ started: true, apply: false });
});

// POST /api/monitor/stop - ask the running preview to stop at its next row / batch.
router.post('/stop', (req, res) => {
  if (!state.running) return res.status(409).json({ errors: ['no check is running'] });
  state.stopRequested = true;
  res.status(202).json({ stopping: true });
});

// GET /api/monitor/status - running state + the last preview's summary (no item list).
router.get('/status', (req, res) => {
  const { reports, ...rest } = state;
  const summary = (r) => r && (({ items, ...s }) => ({ ...s, itemCount: items.length }))(r);
  res.json({ ...rest, reports: { preview: summary(reports.preview) } });
});

// GET /api/monitor/report - the last preview's per-stock items (what would change, notes).
router.get('/report', (req, res) => {
  const report = state.reports.preview;
  res.json(report ? report.items : []);
});

// GET /api/monitor/export.csv - the last preview's rows that pair an old and a new
// stock (the user, 2026-10-16: only old id + symbol + name, new id + symbol + name and the CUSIP):
//   - a CUSIP found for a row but already held by another live row (BRTM found G1535G125, which
//     BRTMU holds): old = the holder, new = the row it was found for;
//   - a ticker change found through the CUSIP (MIMI -> AXNX: old row delisted, CUSIP written to
//     the new one), and a rename / ticker change seen from an old row without a CUSIP (old row
//     delisted, a new row added - its CUSIP if one was found).
// UTF-8 with a BOM so Excel shows accented names. The reports are in-process, so a server restart
// empties it.
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
function oldNewCusipCsv(items) {
  // ids too (the user, 2026-10-16) - symbols aren't unique; a preview's new row has no id yet.
  const lines = [['old_id', 'old_symbol', 'old_name', 'new_id', 'new_symbol', 'new_name', 'cusip']];
  for (const item of items || []) {
    const c = item.cusipConflict;
    if (c) lines.push([c.id, c.stock_symbol, c.company_name, item.id, item.stock_symbol, item.company_name, c.cusip]);
    const m = item.movedTo;
    if (m) lines.push([item.id, item.stock_symbol, item.company_name, m.id, m.stock_symbol, m.company_name, m.cusip]);
    const r = item.replacedBy;
    if (r) lines.push([item.id, item.stock_symbol, item.company_name, r.id, r.stock_symbol, r.company_name, r.cusip]);
  }
  return `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
router.get('/export.csv', (req, res) => {
  const report = state.reports.preview;
  const day = (report && report.finishedAt ? new Date(report.finishedAt) : new Date()).toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="monitor-preview-old-new-cusip-${day}.csv"`);
  res.send(oldNewCusipCsv(report && report.items));
});

module.exports = router;
module.exports.oldNewCusipCsv = oldNewCusipCsv;
