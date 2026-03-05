BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS qr_table_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id VARCHAR(64) NOT NULL,
  table_id VARCHAR(64) NOT NULL,
  table_code TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (restaurant_id, table_id)
);

CREATE INDEX IF NOT EXISTS idx_qr_table_codes_restaurant_table
  ON qr_table_codes (restaurant_id, table_id);

CREATE INDEX IF NOT EXISTS idx_qr_table_codes_active
  ON qr_table_codes (is_active);

COMMIT;

