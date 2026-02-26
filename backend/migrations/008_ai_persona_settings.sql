-- 008_ai_persona_settings.sql

CREATE TABLE IF NOT EXISTS ai_persona_settings (
  restaurant_id  text PRIMARY KEY,
  speech_rate    numeric(3,2)  NOT NULL DEFAULT 1.00,
  humor_level    numeric(3,2)  NOT NULL DEFAULT 0.00,
  tone           text          NOT NULL DEFAULT 'neutral',
  greeting       text          NOT NULL DEFAULT '',
  farewell       text          NOT NULL DEFAULT '',
  updated_at     timestamptz   NOT NULL DEFAULT now()
);
