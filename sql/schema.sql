CREATE TABLE IF NOT EXISTS stocks (
  id SERIAL PRIMARY KEY,
  stock_symbol VARCHAR(50) NOT NULL UNIQUE,
  company_name VARCHAR(255) NOT NULL,
  exchange VARCHAR(255) NOT NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'yahoo', 'excel_import', 'nasdaq_trader')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy installs: trading_market (4-value enum) is being replaced by free-text exchange.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stocks' AND column_name = 'trading_market'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stocks' AND column_name = 'exchange'
  ) THEN
    ALTER TABLE stocks RENAME COLUMN trading_market TO exchange;
  END IF;
END $$;

ALTER TABLE stocks DROP CONSTRAINT IF EXISTS stocks_trading_market_check;
ALTER TABLE stocks ALTER COLUMN stock_symbol TYPE VARCHAR(50);
ALTER TABLE stocks ALTER COLUMN exchange TYPE VARCHAR(255);

ALTER TABLE stocks ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'manual';

ALTER TABLE stocks DROP CONSTRAINT IF EXISTS stocks_source_check;
ALTER TABLE stocks ADD CONSTRAINT stocks_source_check
  CHECK (source IN ('manual', 'yahoo', 'excel_import', 'nasdaq_trader'));

-- Extended company info: manually entered, or auto-filled from Yahoo Finance on add/lookup.
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS isdelisted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS category VARCHAR(255);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS cusips VARCHAR(255);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS sector VARCHAR(255);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS industry VARCHAR(255);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS currency VARCHAR(255);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS company_location VARCHAR(255);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS urll VARCHAR(255);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS description VARCHAR(10000);
ALTER TABLE stocks ADD COLUMN IF NOT EXISTS ceo VARCHAR(500);

DROP INDEX IF EXISTS idx_stocks_trading_market;
CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON stocks (exchange);

CREATE TABLE IF NOT EXISTS company_name_history (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks (id) ON DELETE CASCADE,
  stock_symbol VARCHAR(50) NOT NULL,
  old_company_name VARCHAR(255) NOT NULL,
  new_company_name VARCHAR(255) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE company_name_history ALTER COLUMN stock_symbol TYPE VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_company_name_history_stock_id ON company_name_history (stock_id);
CREATE INDEX IF NOT EXISTS idx_company_name_history_symbol ON company_name_history (stock_symbol);

CREATE TABLE IF NOT EXISTS stock_symbol_history (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks (id) ON DELETE CASCADE,
  company_name VARCHAR(255) NOT NULL,
  old_stock_symbol VARCHAR(50) NOT NULL,
  new_stock_symbol VARCHAR(50) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE stock_symbol_history ALTER COLUMN old_stock_symbol TYPE VARCHAR(50);
ALTER TABLE stock_symbol_history ALTER COLUMN new_stock_symbol TYPE VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_stock_symbol_history_stock_id ON stock_symbol_history (stock_id);

-- Populated by scripts/check-stock-status.js; each run replaces the full contents.
CREATE TABLE IF NOT EXISTS stock_update_candidates (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks (id) ON DELETE CASCADE,
  stock_symbol VARCHAR(50) NOT NULL,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('company_name_mismatch', 'exchange_mismatch')),
  current_company_name VARCHAR(255) NOT NULL,
  suggested_company_name VARCHAR(255) NOT NULL,
  current_exchange VARCHAR(255) NOT NULL,
  suggested_exchange VARCHAR(255) NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Legacy installs: market_mismatch/current_trading_market/suggested_trading_market renamed.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_update_candidates' AND column_name = 'current_trading_market'
  ) THEN
    TRUNCATE stock_update_candidates;
    ALTER TABLE stock_update_candidates RENAME COLUMN current_trading_market TO current_exchange;
    ALTER TABLE stock_update_candidates RENAME COLUMN suggested_trading_market TO suggested_exchange;
  END IF;
END $$;

ALTER TABLE stock_update_candidates ALTER COLUMN stock_symbol TYPE VARCHAR(50);
ALTER TABLE stock_update_candidates ALTER COLUMN current_exchange TYPE VARCHAR(255);
ALTER TABLE stock_update_candidates ALTER COLUMN suggested_exchange TYPE VARCHAR(255);
ALTER TABLE stock_update_candidates DROP CONSTRAINT IF EXISTS stock_update_candidates_reason_check;
ALTER TABLE stock_update_candidates ADD CONSTRAINT stock_update_candidates_reason_check
  CHECK (reason IN ('company_name_mismatch', 'exchange_mismatch'));

CREATE INDEX IF NOT EXISTS idx_stock_update_candidates_stock_id ON stock_update_candidates (stock_id);

-- Populated by scripts/check-stock-status.js; each run replaces the full contents.
CREATE TABLE IF NOT EXISTS stock_removal_candidates (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER NOT NULL REFERENCES stocks (id) ON DELETE CASCADE,
  stock_symbol VARCHAR(50) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  exchange VARCHAR(255) NOT NULL,
  reason VARCHAR(30) NOT NULL CHECK (reason IN ('not_found_on_yahoo', 'no_longer_equity')),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_removal_candidates' AND column_name = 'trading_market'
  ) THEN
    TRUNCATE stock_removal_candidates;
    ALTER TABLE stock_removal_candidates RENAME COLUMN trading_market TO exchange;
  END IF;
END $$;

ALTER TABLE stock_removal_candidates ALTER COLUMN stock_symbol TYPE VARCHAR(50);
ALTER TABLE stock_removal_candidates ALTER COLUMN exchange TYPE VARCHAR(255);
ALTER TABLE stock_removal_candidates DROP CONSTRAINT IF EXISTS stock_removal_candidates_reason_check;
ALTER TABLE stock_removal_candidates ADD CONSTRAINT stock_removal_candidates_reason_check
  CHECK (reason IN ('not_found_on_yahoo', 'no_longer_equity'));

CREATE INDEX IF NOT EXISTS idx_stock_removal_candidates_stock_id ON stock_removal_candidates (stock_id);

-- No FK to stocks(id): rows here intentionally outlive the stock they describe.
CREATE TABLE IF NOT EXISTS stock_deletion_log (
  id SERIAL PRIMARY KEY,
  stock_symbol VARCHAR(50) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  exchange VARCHAR(255) NOT NULL,
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'stock_deletion_log' AND column_name = 'trading_market'
  ) THEN
    ALTER TABLE stock_deletion_log RENAME COLUMN trading_market TO exchange;
  END IF;
END $$;

ALTER TABLE stock_deletion_log ALTER COLUMN stock_symbol TYPE VARCHAR(50);
ALTER TABLE stock_deletion_log ALTER COLUMN exchange TYPE VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_stock_deletion_log_symbol ON stock_deletion_log (stock_symbol);
