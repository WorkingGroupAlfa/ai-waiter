import fs from 'fs';
import path from 'path';
import url from 'url';
import { query } from './db.js';

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function hasMigration(name) {
  const res = await query(`SELECT 1 FROM schema_migrations WHERE name = $1 LIMIT 1`, [name]);
  return res.rows.length > 0;
}

async function markMigration(name) {
  await query(`INSERT INTO schema_migrations(name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
}

export async function runPendingMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    return { files: 0, applied: [] };
  }

  await ensureMigrationsTable();
  const applied = [];

  for (const file of files) {
    if (await hasMigration(file)) continue;

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');

    await query('BEGIN');
    try {
      await query(sql);
      await markMigration(file);
      await query('COMMIT');
      applied.push(file);
    } catch (e) {
      await query('ROLLBACK');
      throw e;
    }
  }

  return { files: files.length, applied };
}

