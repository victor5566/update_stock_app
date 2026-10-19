require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const stocksRouter = require('./routes/stocks');
const monitorRouter = require('./routes/monitor');
const authRouter = require('./routes/auth');
const { requireAuth } = require('./lib/auth');

const PORT = process.env.PORT || 3000;
// HOST: the address to listen on (0.0.0.0 = every interface).
const HOST = process.env.HOST || '0.0.0.0';
// The React app (client/, create-react-app) is built into client/build by `npm run build`.
const CLIENT_BUILD = path.join(__dirname, 'client', 'build');

const app = express();

// Behind a reverse proxy (78.138.118.155: nginx on the VPS -> the company-profiler LXC container),
// every request comes from the proxy's address; trusting a proxy on a private / loopback address
// makes req.ip the browser's (X-Forwarded-For) - the login lockout counts failures per req.ip, so
// otherwise one person's typos would lock everyone out - and req.secure follow X-Forwarded-Proto.
// TRUST_PROXY in .env overrides it (Express's 'trust proxy' syntax, e.g. "false" or "10.0.3.1").
const TRUST_PROXY = process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal';
app.set('trust proxy', TRUST_PROXY === 'false' ? false : TRUST_PROXY);

app.use(cors());
app.use(express.json());

// Liveness check for deploys (deploy/remote.sh) - doesn't touch the database.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// Login (open), then everything else under /api needs a session (lib/auth.js).
app.use('/api/auth', authRouter);
app.use('/api', requireAuth);

app.use('/api/stocks', stocksRouter);
app.use('/api/monitor', monitorRouter);

// An unknown /api path is a 404, not the web page.
app.use('/api', (req, res) => {
  res.status(404).json({ errors: ['not found'] });
});

// The web UI: the built React app's files, and index.html for every other path, so the app's
// own routes (/, /<symbol> detail pages) also work on a reload or a direct link.
app.use(express.static(CLIENT_BUILD));
app.get('*', (req, res) => {
  res.sendFile(path.join(CLIENT_BUILD, 'index.html'), (err) => {
    if (err) res.status(503).type('text').send('The web UI is not built yet - run `npm run build`.');
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errors: ['internal server error'] });
});

app.listen(PORT, HOST, () => {
  console.log(`Stock symbol manager listening on ${HOST}:${PORT} (web UI and /api)`);
});
