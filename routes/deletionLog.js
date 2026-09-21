const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /api/stock-deletion-log
router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, stock_symbol, company_name, trading_market, deleted_at
       FROM stock_deletion_log
       ORDER BY deleted_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
