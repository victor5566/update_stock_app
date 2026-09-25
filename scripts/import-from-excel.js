// Usage: node scripts/import-from-excel.js <path-to-xlsx> [sheet-name]
// Reads a workbook with columns stock_symbol / company name / exchange
// (header names are matched loosely) and inserts new rows into the stocks table.
// Existing stock_symbols are left untouched (ON CONFLICT DO NOTHING).
require('dotenv').config();
const ExcelJS = require('exceljs');
const pool = require('../db');

const MARKET_MAP = {
  NASDAQ: 'NASDAQ',
  NASDAQGS: 'NASDAQ',
  NASDGS: 'NASDAQ',
  NASDAQGM: 'NASDAQ',
  NASDGM: 'NASDAQ',
  NASDAQCM: 'NASDAQ',
  NASDCM: 'NASDAQ',
  NYSE: 'NYSE',
  NYQ: 'NYSE',
  AMEX: 'AMEX',
  ASE: 'AMEX',
  NYSEAMERICAN: 'AMEX',
  NYSEMKT: 'AMEX',
  OTC: 'OTC',
  OTCPK: 'OTC',
  OTCQX: 'OTC',
  OTCQB: 'OTC',
  OTCID: 'OTC',
  OTCMKTS: 'OTC',
  PINK: 'OTC',
  PNK: 'OTC',
};

const SYMBOL_HEADER_ALIASES = ['stock_symbol', 'stocksymbol', 'symbol', 'ticker'];
const COMPANY_HEADER_ALIASES = ['company_name', 'companyname', 'company', 'name'];
const MARKET_HEADER_ALIASES = ['exchange', 'trading_market', 'tradingmarket', 'market'];

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// exchange is free text, so an unrecognized value is used as-is rather than rejected;
// MARKET_MAP just normalizes the common aliases/codes to a consistent display form.
function mapMarket(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;
  const key = trimmed.toUpperCase().replace(/[^A-Z]/g, '');
  return MARKET_MAP[key] || trimmed;
}

function findColumns(headerRow) {
  const columns = {};
  headerRow.eachCell((cell, colNumber) => {
    const normalized = normalizeHeader(cell.value);
    if (SYMBOL_HEADER_ALIASES.includes(normalized)) columns.symbol = colNumber;
    else if (COMPANY_HEADER_ALIASES.includes(normalized)) columns.company = colNumber;
    else if (MARKET_HEADER_ALIASES.includes(normalized)) columns.market = colNumber;
  });
  return columns;
}

async function main() {
  const filePath = process.argv[2];
  const sheetName = process.argv[3];

  if (!filePath) {
    console.error('Usage: node scripts/import-from-excel.js <path-to-xlsx> [sheet-name]');
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = sheetName ? workbook.getWorksheet(sheetName) : workbook.worksheets[0];

  if (!sheet) {
    console.error(`Sheet not found${sheetName ? `: ${sheetName}` : ''}`);
    process.exit(1);
  }

  const headerRow = sheet.getRow(1);
  const columns = findColumns(headerRow);

  if (!columns.symbol || !columns.company || !columns.market) {
    console.error(
      'Could not find stock_symbol / company_name / exchange columns in the header row.',
      'Found:', columns
    );
    process.exit(1);
  }

  const bySymbol = new Map();
  const invalidRows = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const rawSymbol = row.getCell(columns.symbol).value;
    const rawCompany = row.getCell(columns.company).value;
    const rawMarket = row.getCell(columns.market).value;

    const stock_symbol = String(rawSymbol || '').trim().toUpperCase();
    const company_name = String(rawCompany || '').trim();
    const exchange = mapMarket(rawMarket);

    if (!stock_symbol || !company_name) {
      invalidRows.push(rowNumber);
      return;
    }
    if (!/^[A-Za-z.-]{1,50}$/.test(stock_symbol)) {
      invalidRows.push(rowNumber);
      return;
    }
    if (!exchange) {
      invalidRows.push(rowNumber);
      return;
    }

    // Later rows overwrite earlier ones for the same symbol.
    bySymbol.set(stock_symbol, { stock_symbol, company_name, exchange });
  });

  const stocks = [...bySymbol.values()];
  console.log(`Parsed ${stocks.length} unique valid rows (${invalidRows.length} skipped as invalid).`);

  const client = await pool.connect();
  let inserted = 0;
  let skippedExisting = 0;
  try {
    await client.query('BEGIN');
    for (const stock of stocks) {
      const result = await client.query(
        `INSERT INTO stocks (stock_symbol, company_name, exchange, source)
         VALUES ($1, $2, $3, 'excel_import')
         ON CONFLICT (stock_symbol) DO NOTHING
         RETURNING id`,
        [stock.stock_symbol, stock.company_name, stock.exchange]
      );
      if (result.rows.length) inserted++;
      else skippedExisting++;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log(`Inserted ${inserted} new stocks. Skipped ${skippedExisting} already in the database.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
