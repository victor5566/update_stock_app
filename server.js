require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const stocksRouter = require('./routes/stocks');
const historyRouter = require('./routes/history');
const symbolHistoryRouter = require('./routes/symbolHistory');
const removalCandidatesRouter = require('./routes/removalCandidates');
const deletionLogRouter = require('./routes/deletionLog');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/stocks', stocksRouter);
app.use('/api/company-name-history', historyRouter);
app.use('/api/stock-symbol-history', symbolHistoryRouter);
app.use('/api/removal-candidates', removalCandidatesRouter);
app.use('/api/stock-deletion-log', deletionLogRouter);

// Per-stock detail page, e.g. /aapl - falls through here only when express.static above
// found no matching file. The regex (single path segment, symbol-shaped) keeps this from
// swallowing /api/* or any other multi-segment path.
app.get(/^\/[A-Za-z.-]{1,50}$/, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'stock.html'));
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ errors: ['internal server error'] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Stock symbol manager running at http://localhost:${PORT}`);
});
