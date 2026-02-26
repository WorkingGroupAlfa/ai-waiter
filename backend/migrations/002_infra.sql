-- 002_infra.sql
-- Базовая инфраструктура: locale + events

-- 1) Добавляем preferred_locale в device_profiles
ALTER TABLE device_profiles
ADD COLUMN IF NOT EXISTS preferred_locale TEXT;

-- 2) Добавляем locale в sessions (язык/локаль сессии)
ALTER TABLE sessions
ADD COLUMN IF NOT EXISTS locale TEXT;

-- 3) Таблица событий для аналитики и логирования
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
  device_id UUID,
  event_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индекс по типу события и дате (на будущее)
CREATE INDEX IF NOT EXISTS idx_events_type_created_at
  ON events (event_type, created_at);
