require('dotenv').config();
const { Pool } = require('pg');

// Node v22.7.0 has a JIT bug: once code gets hot, Buffer.from(str, 'utf8') (and HTTP
// response bodies) emit Latin-1 instead of UTF-8 for chars like "é". It garbled accented
// company names in the UI and corrupted bulk writes. Every server/script path loads this
// file, so refuse to run on it here.
if (process.version === 'v22.7.0') {
  throw new Error('Node v22.7.0 corrupts UTF-8 text - upgrade Node (>= 22.8.0) before running this app');
}

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  // Tables are referenced unqualified everywhere, so a non-public schema is selected via search_path.
  ...(process.env.PGSCHEMA && { options: `-c search_path=${process.env.PGSCHEMA}` }),
});

module.exports = pool;
