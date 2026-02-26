ALTER TABLE IF EXISTS dialog_state
  ADD COLUMN IF NOT EXISTS last_focused_order_item_id UUID,
  ADD COLUMN IF NOT EXISTS last_focused_menu_item_id UUID,
  ADD COLUMN IF NOT EXISTS last_focused_item_code TEXT,
  ADD COLUMN IF NOT EXISTS last_focused_item_name TEXT;