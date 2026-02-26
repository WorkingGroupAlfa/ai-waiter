-- 008_ai_training.sql
-- Таблицы для панели AI Training (отметка неправильных ответов, синонимы)

CREATE TABLE IF NOT EXISTS ai_bad_answers (
  id UUID PRIMARY KEY,
  restaurant_id VARCHAR(64) NOT NULL,
  session_id UUID,
  device_id UUID,
  in_event_id UUID,
  out_event_id UUID,
  user_text TEXT,
  bot_reply TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_bad_answers_restaurant_created
  ON ai_bad_answers (restaurant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_synonyms (
  id UUID PRIMARY KEY,
  restaurant_id VARCHAR(64) NOT NULL,
  locale TEXT,
  phrase TEXT NOT NULL,
  canonical TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_synonyms_restaurant_phrase
  ON ai_synonyms (restaurant_id, phrase);
