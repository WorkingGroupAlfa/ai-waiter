ALTER TABLE dialog_state
  ADD COLUMN IF NOT EXISTS last_upsell_event_id TEXT,
  ADD COLUMN IF NOT EXISTS last_upsell_position INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_upsell_strategy TEXT,
  ADD COLUMN IF NOT EXISTS last_upsell_model_version TEXT,
  ADD COLUMN IF NOT EXISTS last_upsell_reason_code TEXT,
  ADD COLUMN IF NOT EXISTS last_upsell_language TEXT,
  ADD COLUMN IF NOT EXISTS last_upsell_emotion TEXT;
