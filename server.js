require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const stocksRouter = require('./routes/stocks');
const monitorRouter = require('./routes/monitor');

const PORT = process.env.PORT || 3000;
// HOST: the address to listen on (0.0.0.0 = every interface).
const HOST = process.env.HOST || '0.0.0.0';
// The React app (client/, create-react-app) is built into client/build by `npm run build`.
const CLIENT_BUILD = path.join(__dirname, 'client', 'build');

const app = express();

app.use(cors());
app.use(express.json());

// Liveness check for deploys (deploy/remote.sh) - doesn't touch the database.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

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
  monitorRouter.scheduleDaily();
});
