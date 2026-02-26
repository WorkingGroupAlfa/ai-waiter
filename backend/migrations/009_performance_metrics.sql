-- 009_performance_metrics.sql
-- Таблица для логирования производительности NLU/DM/TTS/HTTP

CREATE TABLE IF NOT EXISTS performance_metrics (
  id BIGSERIAL PRIMARY KEY,
  metric_name TEXT NOT NULL,
  scope TEXT,
  duration_ms INTEGER NOT NULL,
  labels JSONB DEFAULT '{}'::jsonb,
  meta JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_metric_name_created_at
  ON performance_metrics (metric_name, created_at);

CREATE INDEX IF NOT EXISTS idx_performance_metrics_scope_created_at
  ON performance_metrics (scope, created_at);
