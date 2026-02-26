-- Expand restaurant_settings for controllable time/weather/upsell defaults.
-- Compatible with older PostgreSQL versions (no IF NOT EXISTS for ADD COLUMN/CONSTRAINT).

DO $$
BEGIN
  -- weather_enabled
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'restaurant_settings'
      AND column_name = 'weather_enabled'
  ) THEN
    ALTER TABLE restaurant_settings
      ADD COLUMN weather_enabled BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- dayparts
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'restaurant_settings'
      AND column_name = 'dayparts'
  ) THEN
    ALTER TABLE restaurant_settings
      ADD COLUMN dayparts JSONB NOT NULL DEFAULT
        '{"breakfast":{"start":"06:00","end":"11:00"},
          "lunch":{"start":"11:00","end":"16:00"},
          "dinner":{"start":"16:00","end":"22:00"},
          "late":{"start":"22:00","end":"06:00"}}'::jsonb;
  END IF;

  -- upsell_max_per_session
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'restaurant_settings'
      AND column_name = 'upsell_max_per_session'
  ) THEN
    ALTER TABLE restaurant_settings
      ADD COLUMN upsell_max_per_session INTEGER NOT NULL DEFAULT 3;
  END IF;

  -- upsell_min_gap_minutes
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'restaurant_settings'
      AND column_name = 'upsell_min_gap_minutes'
  ) THEN
    ALTER TABLE restaurant_settings
      ADD COLUMN upsell_min_gap_minutes INTEGER NOT NULL DEFAULT 5;
  END IF;

  -- upsell_default_epsilon
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'restaurant_settings'
      AND column_name = 'upsell_default_epsilon'
  ) THEN
    ALTER TABLE restaurant_settings
      ADD COLUMN upsell_default_epsilon DOUBLE PRECISION NOT NULL DEFAULT 0.1;
  END IF;

END $$;

-- Constraints (Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so check pg_constraint)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_settings_upsell_max_per_session_chk') THEN
    ALTER TABLE restaurant_settings
      ADD CONSTRAINT restaurant_settings_upsell_max_per_session_chk
      CHECK (upsell_max_per_session >= 0 AND upsell_max_per_session <= 20);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_settings_upsell_min_gap_minutes_chk') THEN
    ALTER TABLE restaurant_settings
      ADD CONSTRAINT restaurant_settings_upsell_min_gap_minutes_chk
      CHECK (upsell_min_gap_minutes >= 0 AND upsell_min_gap_minutes <= 180);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_settings_upsell_default_epsilon_chk') THEN
    ALTER TABLE restaurant_settings
      ADD CONSTRAINT restaurant_settings_upsell_default_epsilon_chk
      CHECK (upsell_default_epsilon >= 0 AND upsell_default_epsilon <= 1);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'restaurant_settings_weather_cache_ttl_chk') THEN
    ALTER TABLE restaurant_settings
      ADD CONSTRAINT restaurant_settings_weather_cache_ttl_chk
      CHECK (weather_cache_ttl_seconds >= 30 AND weather_cache_ttl_seconds <= 3600);
  END IF;
END $$;
