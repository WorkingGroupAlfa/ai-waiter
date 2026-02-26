// createDialogState.js
import { query } from './src/db.js';

async function createDialogStateTable() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS dialog_state (
        session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
        last_upsell_code TEXT,
        last_upsell_item_name TEXT,
        last_upsell_created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    console.log('dialog_state table created!');
    process.exit(0);
  } catch (err) {
    console.error('Error creating dialog_state table:', err);
    process.exit(1);
  }
}

createDialogStateTable();
