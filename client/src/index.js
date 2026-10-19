import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './index.css';
import HomePage from './pages/HomePage';
import StockPage from './pages/StockPage';
import NotFoundPage from './pages/NotFoundPage';
import AuthGate from './components/AuthGate';

// Two pages: the main page with its tabs, and a per-stock detail page at /<symbol>. server.js
// serves index.html for every non-/api path, so these routes also work on a reload; any other
// path (/a/b) gets the not-found page.
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      {/* Every page needs a login (test.users, role LABEL); see components/AuthGate.jsx. */}
      <AuthGate>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/:symbol" element={<StockPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  </React.StrictMode>,
);
