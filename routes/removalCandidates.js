const express = require('express');
const pool = require('../db');
const { checkStockStatus } = require('../lib/checkStockStatus');
const { applyUpdateCandidates } = require('../lib/applyUpdateCandidates');

const router = express.Router();

// GET /api/removal-candidates
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, stock_id, stock_symbol, company_name, exchange, reason, checked_at
       FROM stock_removal_candidates
       ORDER BY stock_symbol ASC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// A full check batches every stock through Yahoo and takes ~15-30s, so it runs in
// the background: POST starts it, GET /refresh-status is polled by the UI until it's done.
// Only one run at a time (process-local state - fine for this single-process server).
let refreshState = { running: false, startedAt: null, finishedAt: null, result: null, error: null };

// POST /api/removal-candidates/refresh
router.post('/refresh', (req, res) => {
  if (refreshState.running) {
    return res.status(409).json({ errors: ['status check already running'], ...refreshState });
  }
  refreshState = { running: true, startedAt: new Date(), finishedAt: null, result: null, error: null };
  // Re-check = check everything against Yahoo, then apply name/market changes straight away
  // (logged to the history tables). Removal candidates are only listed, never auto-deleted.
  checkStockStatus(pool)
    .then(async (check) => {
      const { applied, skipped } = await applyUpdateCandidates(pool);
      const result = { ...check, applied, skipped };
      refreshState = { ...refreshState, running: false, finishedAt: new Date(), result };
    })
    .catch((err) => {
      console.error(`[status-check] ${err.message}`);
      refreshState = { ...refreshState, running: false, finishedAt: new Date(), error: err.message };
    });
  res.status(202).json(refreshState);
});

// GET /api/removal-candidates/refresh-status
router.get('/refresh-status', (req, res) => {
  res.json(refreshState);
});

module.exports = router;
