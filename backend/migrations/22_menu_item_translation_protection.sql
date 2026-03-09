BEGIN;

ALTER TABLE menu_items
ADD COLUMN IF NOT EXISTS protect_name_from_translation BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing drinks should be protected by default. Admin can uncheck manually later.
UPDATE menu_items
SET protect_name_from_translation = TRUE
WHERE lower(COALESCE(category, '')) = 'drink';

COMMIT;
