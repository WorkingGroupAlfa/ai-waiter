// src/models/performanceMetricsModel.js
import { query } from '../db.js';

/**
 * Универсальная вставка метрики.
 *
 * @param {object} params
 * @param {string} params.metricName
 * @param {string} [params.scope]
 * @param {number} params.durationMs
 * @param {object} [params.labels]
 * @param {object} [params.meta]
 */
export async function insertPerformanceMetric({
  metricName,
  scope,
  durationMs,
  labels,
  meta,
}) {
  const safeDuration = Math.max(0, Math.round(Number(durationMs) || 0));

  try {
    await query(
      `
      INSERT INTO performance_metrics (metric_name, scope, duration_ms, labels, meta)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        metricName,
        scope || null,
        safeDuration,
        labels || {},
        meta || {},
      ],
    );
  } catch (err) {
    // Никогда не роняем основной поток из-за логирования
    console.error('[PerformanceMetrics] Failed to insert metric', {
      metricName,
      scope,
      durationMs: safeDuration,
      err,
    });
  }
}
