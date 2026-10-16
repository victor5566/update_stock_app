const express = require('express');
const pool = require('../db');
const { runStockMonitor } = require('../lib/stockMonitor');

const router = express.Router();

// One run at a time, in the background; the UI polls GET /status. The last preview and the last
// applying run are kept separately (the UI shows them on separate pages). State is in-process, so
// a server restart forgets them (the table itself keeps every change).
const state = {
  running: false,
  apply: false,
  trigger: null, // 'manual' | 'schedule'
  startedAt: null,
  progress: null,
  reports: { preview: null, apply: null },
  lastError: null,
  nextScheduledAt: null,
  stopRequested: false,
};

function startRun({ apply, trigger }) {
  if (state.running) return false;
  Object.assign(state, { running: true, apply, trigger, startedAt: new Date().toISOString(), progress: null, lastError: null, stopRequested: false });
  runStockMonitor(pool, {
    apply,
    shouldStop: () => state.stopRequested,
    cusipLimit: Number(process.env.MONITOR_CUSIP_LIMIT) || undefined,
    onProgress: (p) => { state.progress = p; },
  })
    .then((report) => {
      state.reports = { ...state.reports, [apply ? 'apply' : 'preview']: { ...report, trigger } };
      const c = report.counts;
      console.log(`[monitor] ${apply ? 'applied' : 'preview'}${report.stopped ? ' (stopped)' : ''}: ${c.checked} checked, ${c.listed} listed, ${c.delisted} delisted, ${c.unknown} unknown, ${report.items.filter((i) => i.changes.length).length} with changes, cusip tried ${report.cusip.tried} / filled ${report.cusip.filled} / conflicts ${report.cusip.conflicts} / errors ${report.cusip.errors}, ${report.cusip.missing} still missing`);
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

// POST /api/monitor/run { apply: true|false } - false only previews (nothing is written).
router.post('/run', (req, res) => {
  const apply = Boolean(req.body && req.body.apply);
  if (!startRun({ apply, trigger: 'manual' })) {
    return res.status(409).json({ errors: ['a check is already running'] });
  }
  res.status(202).json({ started: true, apply });
});

// POST /api/monitor/stop - ask the running check to stop at its next row / batch. Changes
// already written stay; a stop while quotes are still being fetched writes nothing.
router.post('/stop', (req, res) => {
  if (!state.running) return res.status(409).json({ errors: ['no check is running'] });
  state.stopRequested = true;
  res.status(202).json({ stopping: true });
});

// GET /api/monitor/status - running state + both reports' summaries (no item lists).
router.get('/status', (req, res) => {
  const { reports, ...rest } = state;
  const summary = (r) => r && (({ items, ...s }) => ({ ...s, itemCount: items.length }))(r);
  res.json({ ...rest, reports: { preview: summary(reports.preview), apply: summary(reports.apply) } });
});

// GET /api/monitor/report?mode=preview|apply - that report's per-stock items (changes, notes and,
// for an applying run, the company details / CUSIPs filled).
router.get('/report', (req, res) => {
  const report = state.reports[req.query.mode === 'apply' ? 'apply' : 'preview'];
  res.json(report ? report.items : []);
});

// GET /api/monitor/export.csv?mode=preview|apply - the report's rows that pair an old and a new
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
  const mode = req.query.mode === 'apply' ? 'apply' : 'preview';
  const report = state.reports[mode];
  const day = (report && report.finishedAt ? new Date(report.finishedAt) : new Date()).toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="monitor-${mode}-old-new-cusip-${day}.csv"`);
  res.send(oldNewCusipCsv(report && report.items));
});

// MONITOR_DAILY_AT=HH:MM in .env runs an applying check every day at that local time.
// Unset = no schedule (the buttons and scripts/monitor-stocks.js still work).
function scheduleDaily() {
  const at = process.env.MONITOR_DAILY_AT;
  const m = at && at.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return;
  const next = new Date();
  next.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (next <= new Date()) next.setDate(next.getDate() + 1);
  state.nextScheduledAt = next.toISOString();
  setTimeout(() => {
    startRun({ apply: true, trigger: 'schedule' });
    scheduleDaily();
  }, next - Date.now()).unref();
  console.log(`[monitor] daily check scheduled for ${next.toString()}`);
}

module.exports = router;
module.exports.scheduleDaily = scheduleDaily;
module.exports.oldNewCusipCsv = oldNewCusipCsv;
