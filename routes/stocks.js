const express = require('express');
const pool = require('../db');
const { applyStockUpdate } = require('../lib/applyStockUpdate');
const { isValidCusip } = require('../lib/validateCusip');
const { fillCompanyDetails } = require('../lib/fillCompanyDetails');
const { lookupCusip } = require('../lib/cusipLookup');

const router = express.Router();

// Fire-and-forget: fetches company details + CUSIP for a freshly manually-added stock and
// writes them in once they arrive, without making the add request wait on any of it. Only
// called when the add didn't already specify any detail fields itself (see the POST handler)
// - the web form only ever submits stock_symbol/company_name/exchange, so this is what turns
// that bare row into a fully-populated one a few seconds later, the same data
// scripts/fill-company-details.js and scripts/fill-cusip.js would have produced by hand.
async function autoFillNewStock(stock) {
  const [detailsResult, cusipResult] = await Promise.allSettled([
    fillCompanyDetails(pool, stock),
    lookupCusip(stock.stock_symbol, {
      onSourceError: (src, err) => console.error(`[auto-fill] ${stock.stock_symbol}: ${src} lookup failed - ${err.message}`),
    }),
  ]);

  if (detailsResult.status === 'fulfilled') {
    if (detailsResult.value) console.log(`[auto-fill] ${stock.stock_symbol}: company details filled`);
  } else {
    console.error(`[auto-fill] ${stock.stock_symbol}: company details failed - ${detailsResult.reason.message}`);
  }

  if (cusipResult.status === 'fulfilled') {
    if (cusipResult.value.cusip) {
      await pool.query('UPDATE stocks SET cusips = $1, updated_at = now() WHERE id = $2', [cusipResult.value.cusip, stock.id]);
      console.log(`[auto-fill] ${stock.stock_symbol}: cusip filled (${cusipResult.value.source})`);
    }
  } else {
    console.error(`[auto-fill] ${stock.stock_symbol}: cusip lookup failed - ${cusipResult.reason.message}`);
  }
}

const DETAIL_FIELDS = [
  'category', 'cusips', 'sector', 'industry',
  'currency', 'company_location', 'urll', 'description', 'ceo',
];

function validateStockInput({ stock_symbol, company_name, exchange }, { partial = false } = {}) {
  const errors = [];

  if (!partial || stock_symbol !== undefined) {
    if (!stock_symbol || typeof stock_symbol !== 'string' || !stock_symbol.trim()) {
      errors.push('stock_symbol is required');
    } else if (!/^[A-Za-z.\-]{1,50}$/.test(stock_symbol.trim())) {
      errors.push('stock_symbol must be 1-50 letters (may include "." or "-")');
    }
  }

  if (!partial || company_name !== undefined) {
    if (!company_name || typeof company_name !== 'string' || !company_name.trim()) {
      errors.push('company_name is required');
    }
  }

  if (!partial || exchange !== undefined) {
    if (!exchange || typeof exchange !== 'string' || !exchange.trim()) {
      errors.push('exchange is required');
    }
  }

  return errors;
}

// Validates the optional extended-detail fields. Only cusips has a real format to check
// (a 9-character CUSIP with a verifiable check digit); everything else is free text.
function validateDetailFields(body) {
  const errors = [];
  if (body.cusips !== undefined && body.cusips !== null && String(body.cusips).trim() && !isValidCusip(body.cusips)) {
    errors.push('cusips must be a valid 9-character CUSIP');
  }
  return errors;
}

// Pulls the optional extended-detail fields out of a request body, trimming strings.
// Untouched (undefined) fields are omitted so partial updates don't clobber existing data.
function extractDetailFields(body) {
  const fields = {};
  for (const key of DETAIL_FIELDS) {
    if (body[key] === undefined) continue;
    const value = body[key];
    fields[key] = typeof value === 'string' ? (value.trim() || null) : value;
  }
  if (fields.cusips) fields.cusips = fields.cusips.toUpperCase();
  if (body.isdelisted !== undefined) {
    fields.isdelisted = Boolean(body.isdelisted);
  }
  return fields;
}

// GET /api/stocks?market=NASDAQ&q=apple&source=manual
router.get('/', async (req, res, next) => {
  try {
    const { market, q, source } = req.query;
    const conditions = [];
    const params = [];

    if (market) {
      params.push(market);
      conditions.push(`exchange = $${params.length}`);
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
      `SELECT id, stock_symbol, company_name, exchange, source, created_at, updated_at
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
      `SELECT * FROM stocks WHERE stock_symbol = $1`,
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

// GET /api/stocks/:id - full company detail record, for the read-only detail view.
router.get('/:id(\\d+)', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM stocks WHERE id = $1', [req.params.id]);
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
    const errors = [...validateStockInput(req.body), ...validateDetailFields(req.body)];
    if (errors.length) {
      return res.status(400).json({ errors });
    }

    const stock_symbol = req.body.stock_symbol.trim().toUpperCase();
    const company_name = req.body.company_name.trim();
    const exchange = req.body.exchange.trim();
    const detailFields = extractDetailFields(req.body);

    const columns = ['stock_symbol', 'company_name', 'exchange', 'source', ...Object.keys(detailFields)];
    const values = [stock_symbol, company_name, exchange, 'manual', ...Object.values(detailFields)];
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const result = await pool.query(
      `INSERT INTO stocks (${columns.join(', ')})
       VALUES (${placeholders.join(', ')}) RETURNING *`,
      values
    );
    const inserted = result.rows[0];
    res.status(201).json(inserted);

    if (!Object.keys(detailFields).length) {
      autoFillNewStock(inserted).catch((err) => console.error(`[auto-fill] ${inserted.stock_symbol}: ${err.message}`));
    }
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
  const errors = [...validateStockInput(req.body, { partial: true }), ...validateDetailFields(req.body)];
  if (errors.length) {
    return res.status(400).json({ errors });
  }

  const fields = { ...extractDetailFields(req.body) };
  if (req.body.stock_symbol !== undefined) fields.stock_symbol = req.body.stock_symbol.trim().toUpperCase();
  if (req.body.company_name !== undefined) fields.company_name = req.body.company_name.trim();
  if (req.body.exchange !== undefined) fields.exchange = req.body.exchange.trim();

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
      'DELETE FROM stocks WHERE id = $1 RETURNING stock_symbol, company_name, exchange',
      [id]
    );
    if (!result.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ errors: ['stock not found'] });
    }

    const deleted = result.rows[0];
    await client.query(
      `INSERT INTO stock_deletion_log (stock_symbol, company_name, exchange)
       VALUES ($1, $2, $3)`,
      [deleted.stock_symbol, deleted.company_name, deleted.exchange]
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
