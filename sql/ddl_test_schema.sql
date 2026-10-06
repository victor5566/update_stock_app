-- DDL for every table the Stock Symbol Manager app uses, created in schema "test".
-- Clean, fresh-install version of sql/schema.sql (no legacy-upgrade steps).
-- Run as a role that can create objects in schema "test" (e.g. the DBA / schema owner).
--   psql -h <db_host> -p 5432 -d waffle_test -U <admin_role> -f sql/ddl_test_schema.sql

CREATE SCHEMA IF NOT EXISTS test;

-- 1. stocks: the main table (one row per stock symbol)
CREATE TABLE IF NOT EXISTS test.stocks (
  id               SERIAL PRIMARY KEY,
  stock_symbol     VARCHAR(50)    NOT NULL UNIQUE,
  company_name     VARCHAR(255)   NOT NULL,
  exchange         VARCHAR(255)   NOT NULL,
  source           VARCHAR(20)    NOT NULL DEFAULT 'manual'
                   CONSTRAINT stocks_source_check
                   CHECK (source IN ('manual', 'yahoo', 'excel_import', 'nasdaq_trader')),
  isdelisted       BOOLEAN        NOT NULL DEFAULT false,
  category         VARCHAR(255),
  cusips           VARCHAR(255),
  sector           VARCHAR(255),
  industry         VARCHAR(255),
  currency         VARCHAR(255)   DEFAULT 'USD',
  company_location VARCHAR(255),
  urll             VARCHAR(255),
  description      VARCHAR(10000),
  ceo              VARCHAR(500),
  created_at       TIMESTAMPTZ    NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stocks_exchange ON test.stocks (exchange);

-- 2. company_name_history: append-only log of company renames
CREATE TABLE IF NOT EXISTS test.company_name_history (
  id               SERIAL PRIMARY KEY,
  stock_id         INTEGER        NOT NULL REFERENCES test.stocks (id) ON DELETE CASCADE,
  stock_symbol     VARCHAR(50)    NOT NULL,
  old_company_name VARCHAR(255)   NOT NULL,
  new_company_name VARCHAR(255)   NOT NULL,
  changed_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_name_history_stock_id ON test.company_name_history (stock_id);
CREATE INDEX IF NOT EXISTS idx_company_name_history_symbol   ON test.company_name_history (stock_symbol);

-- 3. stock_symbol_history: append-only log of symbol changes
CREATE TABLE IF NOT EXISTS test.stock_symbol_history (
  id               SERIAL PRIMARY KEY,
  stock_id         INTEGER        NOT NULL REFERENCES test.stocks (id) ON DELETE CASCADE,
  company_name     VARCHAR(255)   NOT NULL,
  old_stock_symbol VARCHAR(50)    NOT NULL,
  new_stock_symbol VARCHAR(50)    NOT NULL,
  changed_at       TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_symbol_history_stock_id ON test.stock_symbol_history (stock_id);

-- 4. stock_update_candidates: snapshot rebuilt (TRUNCATE + insert) by every status check
CREATE TABLE IF NOT EXISTS test.stock_update_candidates (
  id                     SERIAL PRIMARY KEY,
  stock_id               INTEGER      NOT NULL REFERENCES test.stocks (id) ON DELETE CASCADE,
  stock_symbol           VARCHAR(50)  NOT NULL,
  reason                 VARCHAR(30)  NOT NULL
                         CONSTRAINT stock_update_candidates_reason_check
                         CHECK (reason IN ('company_name_mismatch', 'exchange_mismatch')),
  current_company_name   VARCHAR(255) NOT NULL,
  suggested_company_name VARCHAR(255) NOT NULL,
  current_exchange       VARCHAR(255) NOT NULL,
  suggested_exchange     VARCHAR(255) NOT NULL,
  checked_at             TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_update_candidates_stock_id ON test.stock_update_candidates (stock_id);

-- 5. stock_removal_candidates: snapshot rebuilt (TRUNCATE + insert) by every status check
CREATE TABLE IF NOT EXISTS test.stock_removal_candidates (
  id           SERIAL PRIMARY KEY,
  stock_id     INTEGER      NOT NULL REFERENCES test.stocks (id) ON DELETE CASCADE,
  stock_symbol VARCHAR(50)  NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  exchange     VARCHAR(255) NOT NULL,
  reason       VARCHAR(30)  NOT NULL
               CONSTRAINT stock_removal_candidates_reason_check
               CHECK (reason IN ('not_found_on_yahoo', 'no_longer_equity')),
  checked_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_removal_candidates_stock_id ON test.stock_removal_candidates (stock_id);

-- 6. stock_deletion_log: record of deleted stocks; no FK to stocks on purpose (rows outlive the stock)
CREATE TABLE IF NOT EXISTS test.stock_deletion_log (
  id           SERIAL PRIMARY KEY,
  stock_symbol VARCHAR(50)  NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  exchange     VARCHAR(255) NOT NULL,
  deleted_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_deletion_log_symbol ON test.stock_deletion_log (stock_symbol);

-- Privileges the app's login role ("victor") needs, if the tables are created by another role.
GRANT USAGE ON SCHEMA test TO victor;
GRANT SELECT, INSERT, UPDATE, DELETE ON test.stocks TO victor;
GRANT SELECT, INSERT ON test.company_name_history, test.stock_symbol_history, test.stock_deletion_log TO victor;
GRANT SELECT, INSERT, DELETE, TRUNCATE ON test.stock_update_candidates, test.stock_removal_candidates TO victor;
GRANT USAGE, SELECT ON SEQUENCE
  test.stocks_id_seq, test.company_name_history_id_seq, test.stock_symbol_history_id_seq,
  test.stock_update_candidates_id_seq, test.stock_removal_candidates_id_seq, test.stock_deletion_log_id_seq
  TO victor;
