// Usage: node scripts/import-from-excel.js <path-to-xlsx> [sheet-name]
// Reads a workbook with columns stock_symbol / company name / trading market
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
const MARKET_HEADER_ALIASES = ['trading_market', 'tradingmarket', 'market', 'exchange'];

function normalizeHeader(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

function mapMarket(raw) {
  const key = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return MARKET_MAP[key] || null;
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
      'Could not find stock_symbol / company_name / trading_market columns in the header row.',
      'Found:', columns
    );
    process.exit(1);
  }

  const bySymbol = new Map();
  const invalidRows = [];
  const unmappedMarkets = new Set();

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const rawSymbol = row.getCell(columns.symbol).value;
    const rawCompany = row.getCell(columns.company).value;
    const rawMarket = row.getCell(columns.market).value;

    const stock_symbol = String(rawSymbol || '').trim().toUpperCase();
    const company_name = String(rawCompany || '').trim();
    const trading_market = mapMarket(rawMarket);

    if (!stock_symbol || !company_name) {
      invalidRows.push(rowNumber);
      return;
    }
    if (!/^[A-Za-z.-]{1,10}$/.test(stock_symbol)) {
      invalidRows.push(rowNumber);
      return;
    }
    if (!trading_market) {
      unmappedMarkets.add(String(rawMarket));
      invalidRows.push(rowNumber);
      return;
    }

    // Later rows overwrite earlier ones for the same symbol.
    bySymbol.set(stock_symbol, { stock_symbol, company_name, trading_market });
  });

  const stocks = [...bySymbol.values()];
  console.log(`Parsed ${stocks.length} unique valid rows (${invalidRows.length} skipped as invalid).`);
  if (unmappedMarkets.size) {
    console.log('Unmapped market values (add to MARKET_MAP if needed):', [...unmappedMarkets]);
  }

  const client = await pool.connect();
  let inserted = 0;
  let skippedExisting = 0;
  try {
    await client.query('BEGIN');
    for (const stock of stocks) {
      const result = await client.query(
        `INSERT INTO stocks (stock_symbol, company_name, trading_market, source)
         VALUES ($1, $2, $3, 'excel_import')
         ON CONFLICT (stock_symbol) DO NOTHING
         RETURNING id`,
        [stock.stock_symbol, stock.company_name, stock.trading_market]
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
