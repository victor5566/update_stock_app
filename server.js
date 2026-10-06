require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const stocksRouter = require('./routes/stocks');
const monitorRouter = require('./routes/monitor');

const PORT = process.env.PORT || 3000;
// HOST: the address to listen on (0.0.0.0 = every interface). PUBLIC_URL: the site's address as
// browsers reach it, e.g. http://172.18.10.196:3000 - handed to the frontend's JavaScript via
// /config.js as its API base. Unset = relative /api, which works from any address.
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');

const app = express();

app.use(cors());
app.use(express.json());

// Before express.static and the /<symbol> catch-all below, which would otherwise answer it.
app.get('/config.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-store');
  res.send(`window.APP_CONFIG = ${JSON.stringify({ publicUrl: PUBLIC_URL, apiBase: `${PUBLIC_URL}/api` })};\n`);
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/stocks', stocksRouter);
app.use('/api/monitor', monitorRouter);

// Per-stock detail page, e.g. /aapl or /000001.sz - falls through here only when
// express.static above found no matching file. The regex (single path segment) keeps this
// from swallowing /api/* or any other multi-segment path.
app.get(/^\/[^/]{1,150}$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'stock.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errors: ['internal server error'] });
});

app.listen(PORT, HOST, () => {
  console.log(`Stock symbol manager listening on ${HOST}:${PORT}${PUBLIC_URL ? ` - ${PUBLIC_URL}` : ` - http://localhost:${PORT}`}`);
  monitorRouter.scheduleDaily();
});
