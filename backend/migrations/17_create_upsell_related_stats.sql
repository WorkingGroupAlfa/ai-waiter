-- 17_create_upsell_related_stats.sql

-- Auto-related (co-occurrence) statistics for upsell candidates
CREATE TABLE IF NOT EXISTS upsell_related_stats (
  restaurant_id VARCHAR(64) NOT NULL,
  a_item_code   VARCHAR(64) NOT NULL,
  b_item_code   VARCHAR(64) NOT NULL,

  -- metrics
  support           DOUBLE PRECISION NOT NULL DEFAULT 0, -- P(A,B)
  confidence        DOUBLE PRECISION NOT NULL DEFAULT 0, -- P(B|A)
  lift              DOUBLE PRECISION NOT NULL DEFAULT 0, -- confidence / P(B)
  last_30d_support  DOUBLE PRECISION NOT NULL DEFAULT 0,

  -- admin controls
  is_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  boost_weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT upsell_related_stats_pk PRIMARY KEY (restaurant_id, a_item_code, b_item_code)
);

CREATE INDEX IF NOT EXISTS idx_upsell_related_stats_restaurant_enabled
  ON upsell_related_stats (restaurant_id, is_enabled);

CREATE INDEX IF NOT EXISTS idx_upsell_related_stats_a
  ON upsell_related_stats (restaurant_id, a_item_code);

CREATE INDEX IF NOT EXISTS idx_upsell_related_stats_b
  ON upsell_related_stats (restaurant_id, b_item_code);

CREATE INDEX IF NOT EXISTS idx_upsell_related_stats_confidence
  ON upsell_related_stats (restaurant_id, confidence DESC);
