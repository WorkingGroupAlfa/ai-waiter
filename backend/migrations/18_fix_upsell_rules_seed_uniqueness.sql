BEGIN;

-- 1) Дедуп: оставляем последнюю запись для каждого "логического правила"
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        restaurant_id,
        rule_type,
        COALESCE(trigger_item_code,''),
        COALESCE(trigger_category_id,''),
        COALESCE(trigger_tag,''),
        suggested_item_code
      ORDER BY id DESC
    ) AS rn
  FROM upsell_rules
)
DELETE FROM upsell_rules u
USING ranked r
WHERE u.id = r.id
  AND r.rn > 1;

-- 2) Уникальный индекс, чтобы seed и ручные дубли не плодились
CREATE UNIQUE INDEX IF NOT EXISTS ux_upsell_rules_logical_unique
ON upsell_rules (
  restaurant_id,
  rule_type,
  COALESCE(trigger_item_code,''),
  COALESCE(trigger_category_id,''),
  COALESCE(trigger_tag,''),
  suggested_item_code
);

COMMIT;
