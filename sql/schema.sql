CREATE TABLE IF NOT EXISTS stocks (
  id SERIAL PRIMARY KEY,
  stock_symbol VARCHAR(10) NOT NULL UNIQUE,
  company_name VARCHAR(255) NOT NULL,
  trading_market VARCHAR(10) NOT NULL CHECK (trading_market IN ('NASDAQ', 'NYSE', 'AMEX', 'OTC')),
  source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'yahoo', 'excel_import', 'nasdaq_trader')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stocks ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';

ALTER TABLE stocks DROP CONSTRAINT IF EXISTS stocks_source_check;
ALTER TABLE stocks ADD CONSTRAINT stocks_source_check
  CHECK (source IN ('manual', 'yahoo', 'excel_import', 'nasdaq_trader'));

CREATE INDEX IF NOT EXISTS idx_stocks_trading_market ON stocks (trading_market);

CREATE TABLE IF NOT EXISTS company_name_history (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks (id) ON DELETE CASCADE,
  stock_symbol VARCHAR(10) NOT NULL,
  old_company_name VARCHAR(255) NOT NULL,
  new_company_name VARCHAR(255) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_name_history_stock_id ON company_name_history (stock_id);
CREATE INDEX IF NOT EXISTS idx_company_name_history_symbol ON company_name_history (stock_symbol);

CREATE TABLE IF NOT EXISTS stock_symbol_history (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks (id) ON DELETE CASCADE,
  company_name VARCHAR(255) NOT NULL,
  old_stock_symbol VARCHAR(10) NOT NULL,
  new_stock_symbol VARCHAR(10) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_symbol_history_stock_id ON stock_symbol_history (stock_id);

-- Populated by scripts/check-stock-status.js; each run replaces the full contents.
CREATE TABLE IF NOT EXISTS stock_update_candidates (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks (id) ON DELETE CASCADE,
  stock_symbol VARCHAR(10) NOT NULL,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('company_name_mismatch', 'market_mismatch')),
  current_company_name VARCHAR(255) NOT NULL,
  suggested_company_name VARCHAR(255) NOT NULL,
  current_trading_market VARCHAR(10) NOT NULL,
  suggested_trading_market VARCHAR(10) NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_update_candidates_stock_id ON stock_update_candidates (stock_id);

-- Populated by scripts/check-stock-status.js; each run replaces the full contents.
CREATE TABLE IF NOT EXISTS stock_removal_candidates (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks (id) ON DELETE CASCADE,
  stock_symbol VARCHAR(10) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  trading_market VARCHAR(10) NOT NULL,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('not_found_on_yahoo', 'no_longer_equity', 'unsupported_exchange')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_removal_candidates_stock_id ON stock_removal_candidates (stock_id);

-- No FK to stocks(id): rows here intentionally outlive the stock they describe.
CREATE TABLE IF NOT EXISTS stock_deletion_log (
  id SERIAL PRIMARY KEY,
  stock_symbol VARCHAR(10) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  trading_market VARCHAR(10) NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_deletion_log_symbol ON stock_deletion_log (stock_symbol);
