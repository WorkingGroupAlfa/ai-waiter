import { runPendingMigrations } from './migrationRunner.js';

async function run() {
  try {
    const result = await runPendingMigrations();

    for (const file of result.applied) {
      console.log(`Running migration ${file}...`);
    }

    console.log('All pending migrations completed.');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

run();
