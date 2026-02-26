CREATE TABLE IF NOT EXISTS restaurant_settings (
  restaurant_id TEXT PRIMARY KEY,
  lat DOUBLE PRECISION,
  lon DOUBLE PRECISION,
  timezone TEXT,
  weather_provider TEXT DEFAULT 'open-meteo',
  weather_cache_ttl_seconds INTEGER DEFAULT 600,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_settings_latlon
ON restaurant_settings(lat, lon);
