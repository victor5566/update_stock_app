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

// GET /api/monitor/export.csv - every stock the last preview lists (the user, 2026-10-30: all the
// rows shown, not only the renamed ones), one line each: id, symbol, name, status, what would
// change, notes, and - for a rename / ticker change (item.replacedBy: old row delisted, a new row
// added; item.movedTo: the CUSIP's new ticker) - the new row's id, symbol, name and CUSIP (a
// preview's new row has no id yet; ids because symbols aren't unique). A CUSIP held by another
// live row (item.cusipConflict) goes into the notes. UTF-8 with a BOM so Excel shows accented
// names. The reports are in-process, so a server restart empties it.
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvValue = (v) => (v === null || v === undefined || v === '' ? '-' : String(v));
function monitorReportCsv(items) {
  const lines = [['id', 'symbol', 'name', 'status', 'changes', 'notes', 'new_id', 'new_symbol', 'new_name', 'cusip']];
  for (const item of items || []) {
    const changes = (item.changes || []).map((c) => `${c.field}: ${csvValue(c.from)} -> ${csvValue(c.to)}`);
    const notes = [...(item.notes || [])];
    const c = item.cusipConflict;
    if (c) notes.push(`CUSIP ${c.cusip} already on ${c.stock_symbol} (id ${c.id})`);
    if (item.error) notes.push(item.error);
    const n = item.replacedBy || item.movedTo || {};
    lines.push([item.id, item.stock_symbol, item.company_name, item.status, changes.join('; '), notes.join('; '),
      n.id, n.stock_symbol, n.company_name, n.cusip || (c && c.cusip)]);
  }
  return `﻿${lines.map((l) => l.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
router.get('/export.csv', (req, res) => {
  const report = state.reports.preview;
  const day = (report && report.finishedAt ? new Date(report.finishedAt) : new Date()).toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="monitor-preview-${day}.csv"`);
  res.send(monitorReportCsv(report && report.items));
});

module.exports = router;
module.exports.monitorReportCsv = monitorReportCsv;
