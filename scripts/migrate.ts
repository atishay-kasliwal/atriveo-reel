/**
 * Creates the data directories and applies the database schema.
 *
 * Both happen automatically on first use, so this is only needed to
 * initialise a machine ahead of time or to confirm the setup is sound.
 */

import { loadEnv } from "../src/worker/env";

loadEnv();

async function main() {
  const { config } = await import("../src/lib/shared/config");
  const { storage } = await import("../src/lib/storage/local");
  const { getDb, closeDb } = await import("../src/lib/db");

  console.log(`Data directory: ${config.storage.dataDir}`);
  await storage.init();
  console.log("  created sources/ projects/ renders/ temp/");

  const db = getDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];

  console.log(`Database: ${config.storage.databasePath}`);
  for (const table of tables) {
    if (table.name.startsWith("sqlite_")) continue;
    console.log(`  ${table.name}`);
  }

  const freeBytes = await storage.freeSpaceBytes();
  console.log(`Free disk: ${(freeBytes / 1024 ** 3).toFixed(1)} GB`);

  closeDb();
  console.log("Ready.");
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
