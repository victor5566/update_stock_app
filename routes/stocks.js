const express = require('express');
const pool = require('../db');
const { applyStockUpdate } = require('../lib/applyStockUpdate');

const router = express.Router();

const VALID_MARKETS = ['NASDAQ', 'NYSE', 'AMEX', 'OTC'];

function validateStockInput({ stock_symbol, company_name, trading_market }, { partial = false } = {}) {
  const errors = [];

  if (!partial || stock_symbol !== undefined) {
    if (!stock_symbol || typeof stock_symbol !== 'string' || !stock_symbol.trim()) {
      errors.push('stock_symbol is required');
    } else if (!/^[A-Za-z.\-]{1,10}$/.test(stock_symbol.trim())) {
      errors.push('stock_symbol must be 1-10 letters (may include "." or "-")');
    }
  }

  if (!partial || company_name !== undefined) {
    if (!company_name || typeof company_name !== 'string' || !company_name.trim()) {
      errors.push('company_name is required');
    }
  }

  if (!partial || trading_market !== undefined) {
    if (!VALID_MARKETS.includes(trading_market)) {
      errors.push(`trading_market must be one of ${VALID_MARKETS.join(', ')}`);
    }
  }

  return errors;
}

// GET /api/stocks?market=NASDAQ&q=apple&source=manual
router.get('/', async (req, res, next) => {
  try {
    const { market, q, source } = req.query;
    const conditions = [];
    const params = [];

    if (market) {
      params.push(market);
      conditions.push(`trading_market = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(stock_symbol ILIKE $${params.length} OR company_name ILIKE $${params.length})`);
    }
    if (source) {
      params.push(source);
      conditions.push(`source = $${params.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const orderBy = source ? 'created_at DESC' : 'stock_symbol ASC';
    const result = await pool.query(
      `SELECT id, stock_symbol, company_name, trading_market, source, created_at, updated_at
       FROM stocks ${where} ORDER BY ${orderBy}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/stocks/by-symbol/AAPL
router.get('/by-symbol/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.trim().toUpperCase();
    const result = await pool.query(
      `SELECT id, stock_symbol, company_name, trading_market, created_at, updated_at
       FROM stocks WHERE stock_symbol = $1`,
      [symbol]
    );
    if (!result.rows.length) {
      return res.status(404).json({ errors: ['stock not found'] });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/stocks
router.post('/', async (req, res, next) => {
  try {
    const errors = validateStockInput(req.body);
    if (errors.length) {
      return res.status(400).json({ errors });
    }

    const stock_symbol = req.body.stock_symbol.trim().toUpperCase();
    const company_name = req.body.company_name.trim();
    const { trading_market } = req.body;

    const result = await pool.query(
      `INSERT INTO stocks (stock_symbol, company_name, trading_market, source)
       VALUES ($1, $2, $3, 'manual') RETURNING *`,
      [stock_symbol, company_name, trading_market]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ errors: ['stock_symbol already exists'] });
    }
    next(err);
  }
});

// PUT /api/stocks/:id
router.put('/:id', async (req, res, next) => {
  const { id } = req.params;
  const errors = validateStockInput(req.body, { partial: true });
  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const fields = {};
  if (req.body.stock_symbol !== undefined) fields.stock_symbol = req.body.stock_symbol.trim().toUpperCase();
  if (req.body.company_name !== undefined) fields.company_name = req.body.company_name.trim();
  if (req.body.trading_market !== undefined) fields.trading_market = req.body.trading_market;

  if (!Object.keys(fields).length) {
    return res.status(400).json({ errors: ['no fields to update'] });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const updated = await applyStockUpdate(client, id, fields);
    if (!updated) {
      await client.query('ROLLBACK');
      return res.status(404).json({ errors: ['stock not found'] });
    }

    await client.query('COMMIT');
    res.json(updated);
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ errors: ['stock_symbol already exists'] });
    }
    next(err);
  } finally {
    client.release();
  }
});

// DELETE /api/stocks/:id
router.delete('/:id', async (req, res, next) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      'DELETE FROM stocks WHERE id = $1 RETURNING stock_symbol, company_name, trading_market',
      [id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ errors: ['stock not found'] });
    }

    const deleted = result.rows[0];
    await client.query(
      `INSERT INTO stock_deletion_log (stock_symbol, company_name, trading_market)
       VALUES ($1, $2, $3)`,
      [deleted.stock_symbol, deleted.company_name, deleted.trading_market]
    );

    await client.query('COMMIT');
    res.status(204).send();
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

module.exports = router;
