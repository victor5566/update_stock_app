const express = require('express');
const pool = require('../db');
const { applyStockUpdate } = require('../lib/applyStockUpdate');
const { isValidCusip } = require('../lib/validateCusip');
const { fillCompanyDetails } = require('../lib/fillCompanyDetails');
const { lookupCusip, findCusipConflict } = require('../lib/cusipLookup');
const { lookupStock, YahooLookupError, symbolsEquivalent } = require('../lib/yahoo');
const { getCachedListing } = require('../lib/nasdaqTrader');
const { cleanSecurityName } = require('../lib/cleanSecurityName');
const { sameCompany } = require('../lib/normalizeCompanyName');
const { EXPORT_COLUMNS, toCsv } = require('../lib/stockCsv');

const router = express.Router();

const LISTED_MARKETS = new Set(['NASDAQ', 'NYSE', 'AMEX']);

// The stock we already hold under an equivalent spelling of `symbol` ("BRK-B" for "BRK.B"),
// or null. The UNIQUE constraint only catches the exact spelling. `exceptId` skips the row
// being edited.
async function findEquivalentStock(symbol, exceptId = null) {
  const root = symbol.split(/[.-]/)[0];
  const { rows } = await pool.query(
    `SELECT id, stock_symbol FROM stocks WHERE stock_symbol = $1 OR stock_symbol LIKE $2 OR stock_symbol LIKE $3`,
    [root, `${root}.%`, `${root}-%`]
  );
  return rows.find((r) => r.id !== Number(exceptId) && symbolsEquivalent(r.stock_symbol, symbol)) || null;
}

// Fetches company details + CUSIP for a freshly manually-added stock and writes them in.
// Only called when the add didn't already specify any detail fields itself (see the POST
// handler) - the web form only ever submits stock_symbol/company_name/exchange, so this is
// what turns that bare row into a fully-populated one, the same data
// scripts/fill-company-details.js and scripts/fill-cusip.js would have produced by hand.
// The POST waits for the first pass (per the user: an add should come back with everything
// it can find, and say on screen why anything is missing) - the report below is that "why".
//
// A brand-new listing often isn't in the sources yet when it's added (VYLR: Yahoo had no
// profile at add time, a full one later the same day; SEC has no 13G yet), so whatever is
// still missing is retried after each of AUTO_FILL_RETRY_MS. In-process only - a server
// restart drops pending retries, which the fill-* scripts then catch on their next run.
const AUTO_FILL_RETRY_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000];
// The add answers after this even if a source is slow; the lookup carries on regardless.
const ADD_LOOKUP_TIMEOUT_MS = 20 * 1000;

// stock id -> the latest auto-fill report, so the detail page can say why a field is empty
// and when it's retried. In-process like the retries themselves.
const autoFillStatus = new Map();

// Report shape (sent to the UI as `autofill`):
//   details: { status: 'filled' | 'not_found' | 'error' | 'skipped', message? }
//   cusip:   { status: 'filled' | 'not_found' | 'conflict' | 'error' | 'skipped',
//              cusip?, source?, reasons? (from lookupCusip), conflict_symbol?, message? }
//   attempts, next_retry_at (ISO) | null, retries_exhausted
async function autoFillNewStock(stock, attempt = 0, todo = { details: true, cusip: true }) {
  const pass = await autoFillOnce(stock, todo);
  const previous = autoFillStatus.get(stock.id) || {};
  const report = {
    // A part that wasn't re-tried keeps its earlier result.
    details: todo.details ? pass.details : previous.details || { status: 'skipped' },
    cusip: todo.cusip ? pass.cusip : previous.cusip || { status: 'skipped' },
    attempts: attempt + 1,
    next_retry_at: null,
    retries_exhausted: false,
  };

  // Retry only what a later try could change: "not found yet" or a failed request. A CUSIP
  // conflict needs a human, not another lookup.
  const next = {
    details: ['not_found', 'error'].includes(report.details.status),
    cusip: ['not_found', 'error'].includes(report.cusip.status),
  };
  if (next.details || next.cusip) {
    if (attempt < AUTO_FILL_RETRY_MS.length) {
      report.next_retry_at = new Date(Date.now() + AUTO_FILL_RETRY_MS[attempt]).toISOString();
      setTimeout(() => retryAutoFill(stock.id, attempt + 1, next), AUTO_FILL_RETRY_MS[attempt]).unref();
    } else {
      report.retries_exhausted = true;
      console.log(`[auto-fill] ${stock.stock_symbol}: still missing ${[next.details && 'details', next.cusip && 'cusip'].filter(Boolean).join(' + ')} after ${attempt + 1} tries - left for scripts/fill-*.js`);
    }
  }
  autoFillStatus.set(stock.id, report);
  return report;
}

async function retryAutoFill(stockId, attempt, todo) {
  try {
    // Re-read: the stock may have been deleted, renamed or filled in by hand meanwhile.
    const { rows } = await pool.query('SELECT id, stock_symbol, company_name, sector, description, cusips FROM stocks WHERE id = $1', [stockId]);
    const current = rows[0];
    if (!current) {
      autoFillStatus.delete(stockId);
      return;
    }
    const stillTodo = {
      details: todo.details && current.sector == null && current.description == null,
      cusip: todo.cusip && current.cusips == null,
    };
    if (!stillTodo.details && !stillTodo.cusip) {
      autoFillStatus.delete(stockId); // filled some other way - nothing left to explain
      return;
    }
    await autoFillNewStock(current, attempt, stillTodo);
  } catch (err) {
    console.error(`[auto-fill] stock ${stockId}: retry failed - ${err.message}`);
  }
}

// One pass; resolves to { details, cusip } in the report shape above.
async function autoFillOnce(stock, todo) {
  // Raw listing names let lib/cusipLookup.js tell a preferred/note/warrant from the common.
  const listing = todo.cusip ? await getCachedListing().catch(() => null) : null;
  const [detailsResult, cusipResult] = await Promise.allSettled([
    todo.details ? fillCompanyDetails(pool, stock) : Promise.resolve(null),
    todo.cusip ? lookupCusip(stock.stock_symbol, {
      // A new add is often a new or recycled ticker, exactly where quantumonline (keyed by
      // ticker) can still show the previous issuer - the name check in lib/cusipLookup.js.
      companyName: stock.company_name,
      listing: listing || undefined,
      onSourceError: (src, err) => console.error(`[auto-fill] ${stock.stock_symbol}: ${src} lookup failed - ${err.message}`),
    }) : Promise.resolve(null),
  ]);

  let details = { status: 'skipped' };
  if (todo.details) {
    if (detailsResult.status === 'rejected') {
      details = { status: 'error', message: detailsResult.reason.message };
      console.error(`[auto-fill] ${stock.stock_symbol}: company details failed - ${details.message}`);
    } else if (detailsResult.value) {
      details = { status: 'filled' };
      console.log(`[auto-fill] ${stock.stock_symbol}: company details filled`);
    } else {
      details = { status: 'not_found' };
      console.log(`[auto-fill] ${stock.stock_symbol}: no company details on Yahoo yet`);
    }
  }

  let cusip = { status: 'skipped' };
  if (todo.cusip) {
    if (cusipResult.status === 'rejected') {
      cusip = { status: 'error', message: cusipResult.reason.message };
      console.error(`[auto-fill] ${stock.stock_symbol}: cusip lookup failed - ${cusip.message}`);
    } else {
      const { cusip: found, source, reasons } = cusipResult.value;
      const conflict = found && await findCusipConflict(pool, found, { stockId: stock.id });
      if (conflict) {
        cusip = { status: 'conflict', cusip: found, source, conflict_symbol: conflict.stock_symbol };
        console.error(`[auto-fill] ${stock.stock_symbol}: cusip ${found} (${source}) already belongs to ${conflict.stock_symbol} - not written`);
      } else if (found) {
        await pool.query('UPDATE stocks SET cusips = $1, updated_at = now() WHERE id = $2', [found, stock.id]);
        cusip = { status: 'filled', cusip: found, source };
        console.log(`[auto-fill] ${stock.stock_symbol}: cusip filled (${source})`);
      } else {
        cusip = { status: 'not_found', reasons };
        console.log(`[auto-fill] ${stock.stock_symbol}: no cusip found yet (${reasons.map((r) => `${r.source}: ${r.code}`).join('; ')})`);
      }
    }
  }
  return { details, cusip };
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

// WHERE clause for the stock list's filters (?market=&q=&source=). Shared by the list and
// its CSV export so the export is always exactly what the list shows.
function buildStockFilter({ market, q, source }) {
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

  return { where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

// GET /api/stocks/export.csv?market=OTC&q=bank - the stock list's "Export CSV" button.
// All columns (lib/stockCsv.js), UTF-8 with a BOM so Excel shows "Latécoère" correctly,
// downloaded as e.g. stocks_OTC_bank_2026-09-30.csv.
router.get('/export.csv', async (req, res, next) => {
  try {
    const { where, params } = buildStockFilter(req.query);
    const result = await pool.query(
      `SELECT ${EXPORT_COLUMNS.join(', ')} FROM stocks ${where} ORDER BY stock_symbol ASC`,
      params
    );
    const nameParts = ['stocks', req.query.market || 'all', req.query.q, new Date().toISOString().slice(0, 10)]
      .filter(Boolean)
      .map((part) => String(part).replace(/[^A-Za-z0-9.-]+/g, '_'));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nameParts.join('_')}.csv"`);
    res.send('﻿' + toCsv(result.rows));
  } catch (err) {
    next(err);
  }
});

// GET /api/stocks?market=NASDAQ&q=apple&source=manual
router.get('/', async (req, res, next) => {
  try {
    const { where, params } = buildStockFilter(req.query);
    const orderBy = req.query.source ? 'created_at DESC' : 'stock_symbol ASC';
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
    // For a stock added in this server's lifetime whose auto-fill left something empty, the
    // detail page explains why (see autoFillNewStock).
    const autofill = autoFillStatus.get(result.rows[0].id);
    res.json(autofill ? { ...result.rows[0], autofill } : result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/stocks/yahoo-lookup/AA - pre-fills the add form's company name / exchange as
// soon as a symbol is typed. Read-only: never writes to the database. Same trust rules as
// lib/checkStockStatus.js: for a symbol on NASDAQ Trader's official listing, the listing's
// exchange wins and Yahoo's name is only used if it matches the listing's (Yahoo keeps a
// recycled ticker's previous owner's name - DPU pre-filled as "DB Commodity Long ETN").
// Listed symbols Yahoo won't return (closed-end funds it calls ETFs) still pre-fill from the
// listing. Also reports an already-held equivalent spelling as `existing_symbol`.
router.get('/yahoo-lookup/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.trim().toUpperCase();
    const existing = await findEquivalentStock(symbol);
    if (existing) {
      return res.status(409).json({ errors: ['stock_symbol already exists'], existing_symbol: existing.stock_symbol });
    }

    const listing = await getCachedListing().catch((err) => {
      console.error(`[lookup] NASDAQ Trader listing unavailable: ${err.message}`);
      return null;
    });
    const listed = listing && listing.get(symbol);

    let yahoo = null;
    try {
      yahoo = await lookupStock(symbol);
    } catch (err) {
      if (!(err instanceof YahooLookupError)) throw err;
    }

    if (listed) {
      const listingName = cleanSecurityName(listed.name);
      return res.json({
        stock_symbol: symbol,
        company_name: yahoo && sameCompany(yahoo.company_name, listed.name) ? yahoo.company_name : listingName,
        exchange: LISTED_MARKETS.has(listed.exchange) ? listed.exchange : (yahoo ? yahoo.exchange : listed.exchange),
        source: 'nasdaq_trader',
      });
    }
    if (yahoo) {
      return res.json({ stock_symbol: symbol, company_name: yahoo.company_name, exchange: yahoo.exchange, source: 'yahoo' });
    }
    res.status(404).json({ errors: [`"${symbol}" not found on NASDAQ Trader or Yahoo Finance`] });
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

    const existing = await findEquivalentStock(stock_symbol);
    if (existing) {
      return res.status(409).json({ errors: ['stock_symbol already exists'], existing_symbol: existing.stock_symbol });
    }

    const columns = ['stock_symbol', 'company_name', 'exchange', 'source', ...Object.keys(detailFields)];
    const values = [stock_symbol, company_name, exchange, 'manual', ...Object.values(detailFields)];
    const placeholders = values.map((_, i) => `$${i + 1}`);

    const result = await pool.query(
      `INSERT INTO stocks (${columns.join(', ')})
       VALUES (${placeholders.join(', ')}) RETURNING *`,
      values
    );
    const inserted = result.rows[0];
    if (Object.keys(detailFields).length) {
      return res.status(201).json(inserted);
    }

    // Wait for the first lookup pass so the response carries the filled row and, for
    // anything still missing, why (`autofill`). A slow source only delays it up to
    // ADD_LOOKUP_TIMEOUT_MS; the pass then finishes (and retries) in the background.
    const filling = autoFillNewStock(inserted);
    filling.catch((err) => console.error(`[auto-fill] ${inserted.stock_symbol}: ${err.message}`));
    let timer;
    const autofill = await Promise.race([
      filling.catch(() => null),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ pending: true }), ADD_LOOKUP_TIMEOUT_MS); }),
    ]);
    clearTimeout(timer);
    const { rows } = await pool.query('SELECT * FROM stocks WHERE id = $1', [inserted.id]);
    res.status(201).json({ ...(rows[0] || inserted), autofill });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ errors: ['stock_symbol already exists'], existing_symbol: req.body.stock_symbol.trim().toUpperCase() });
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

  if (fields.stock_symbol) {
    try {
      const existing = await findEquivalentStock(fields.stock_symbol, id);
      if (existing) {
        return res.status(409).json({ errors: ['stock_symbol already exists'], existing_symbol: existing.stock_symbol });
      }
    } catch (err) {
      return next(err);
    }
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
      return res.status(409).json({ errors: ['stock_symbol already exists'], existing_symbol: fields.stock_symbol });
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
