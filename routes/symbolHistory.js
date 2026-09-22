const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /api/stock-symbol-history?symbol=AAPL
router.get('/', async (req, res, next) => {
  try {
    const { symbol } = req.query;
    const conditions = [];
    const params = [];

    if (symbol) {
      const upper = symbol.trim().toUpperCase();
      params.push(upper, upper);
      conditions.push(`(old_stock_symbol = $${params.length - 1} OR new_stock_symbol = $${params.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, stock_id, company_name, old_stock_symbol, new_stock_symbol, changed_at
       FROM stock_symbol_history ${where}
       ORDER BY changed_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
