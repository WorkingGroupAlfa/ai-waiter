-- 007_device_memory.sql
-- Multi-tier memory: per-device long-term memory (allergies, favorites, language, last visit)

CREATE TABLE IF NOT EXISTS device_memory (
  device_id UUID PRIMARY KEY REFERENCES device_profiles(device_id) ON DELETE CASCADE,
  allergies JSONB DEFAULT '[]'::jsonb,
  favorite_items UUID[] DEFAULT ARRAY[]::UUID[],
  disliked_items UUID[] DEFAULT ARRAY[]::UUID[],
  language_preferences JSONB DEFAULT '{}'::jsonb,
  last_visit_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
