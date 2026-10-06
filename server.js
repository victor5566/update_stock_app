require('dotenv').config();
const express = require('express');
const cors = require('cors');
const stocksRouter = require('./routes/stocks');
const monitorRouter = require('./routes/monitor');

const PORT = process.env.PORT || 3000;
// HOST: the address to listen on (0.0.0.0 = every interface).
const HOST = process.env.HOST || '0.0.0.0';

// API only for now: the old frontend was removed (2026-10-06), and a new one (React + Tailwind
// CSS) is still to be built.
const app = express();

app.use(cors());
app.use(express.json());

// Liveness check for deploys (deploy/remote.sh) - doesn't touch the database.
app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/stocks', stocksRouter);
app.use('/api/monitor', monitorRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errors: ['internal server error'] });
});

app.listen(PORT, HOST, () => {
  console.log(`Stock symbol manager API listening on ${HOST}:${PORT}`);
  monitorRouter.scheduleDaily();
});
