import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import HomePage from './pages/HomePage';
import StockPage from './pages/StockPage';

// Two pages: the main page with its tabs, and a per-stock detail page at /<symbol>. server.js
// serves index.html for every non-/api path, so these routes also work on a reload.
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/:symbol" element={<StockPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
