require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const stocksRouter = require('./routes/stocks');
const monitorRouter = require('./routes/monitor');

const PORT = process.env.PORT || 3000;
// HOST: the address to listen on (0.0.0.0 = every interface).
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const app = express();

app.use(cors());
app.use(express.json());

// Liveness check for deploys (deploy/remote.sh) - doesn't touch the database.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/stocks', stocksRouter);
app.use('/api/monitor', monitorRouter);

// Frontend: React + Tailwind CSS without a bundler. The pages load React's UMD builds, served
// here straight from node_modules (no CDN); the CSS is public/build/app.css from `npm run build`.
for (const pkg of ['react', 'react-dom']) {
  app.use(`/vendor/${pkg}`, express.static(path.join(path.dirname(require.resolve(`${pkg}/package.json`)), 'umd')));
}
app.use(express.static(PUBLIC_DIR));

// Per-stock detail page, e.g. /aapl or /000001.sz - reached only when express.static found no
// file. The regex (one path segment) keeps it off /api/* and other multi-segment paths.
app.get(/^\/[^/]{1,150}$/, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'stock.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errors: ['internal server error'] });
});

app.listen(PORT, HOST, () => {
  console.log(`Stock symbol manager listening on ${HOST}:${PORT} (web UI and /api)`);
  monitorRouter.scheduleDaily();
});
