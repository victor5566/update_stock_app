require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const stocksRouter = require('./routes/stocks');
const monitorRouter = require('./routes/monitor');

const app = express();

app.use(cors());
app.use(express.json());
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Stock symbol manager running at http://localhost:${PORT}`);
  monitorRouter.scheduleDaily();
});
