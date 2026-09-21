const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /api/removal-candidates
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, stock_id, stock_symbol, company_name, trading_market, reason, checked_at
       FROM stock_removal_candidates
       ORDER BY stock_symbol ASC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
