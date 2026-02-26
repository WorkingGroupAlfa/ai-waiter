-- 002_dialog_state.sql

CREATE TABLE IF NOT EXISTS dialog_state (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  last_upsell_code TEXT,
  last_upsell_item_name TEXT,
  last_upsell_created_at TIMESTAMPTZ DEFAULT NOW()
);
