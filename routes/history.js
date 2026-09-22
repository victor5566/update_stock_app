const express = require('express');
const pool = require('../db');

const router = express.Router();

// GET /api/company-name-history?symbol=AAPL
router.get('/', async (req, res, next) => {
  try {
    const { symbol } = req.query;
    const conditions = [];
    const params = [];

    if (symbol) {
      params.push(symbol.trim().toUpperCase());
      conditions.push(`stock_symbol = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT id, stock_id, stock_symbol, old_company_name, new_company_name, changed_at
       FROM company_name_history ${where}
       ORDER BY changed_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
