import type { DatabaseSync } from 'node:sqlite';
import { sfccV2 } from './schema/sfcc-v2';
import { deploymentImportsV3 } from './schema/deployment-imports-v3';
import { runResultsV4 } from './schema/run-results-v4';
import { coverageDrilldownV5 } from './schema/coverage-drilldown-v5';
import { recoverDetailedCoverageV6 } from './schema/recover-detailed-coverage-v6';

// Append migrations. Never edit a migration that has shipped.
const migrations = [
  `CREATE TABLE local_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collection TEXT NOT NULL,
    key TEXT NOT NULL,
    json TEXT NOT NULL CHECK(json_valid(json)),
    updated_at INTEGER NOT NULL,
    UNIQUE(collection, key)
  ) STRICT;
  CREATE INDEX local_records_collection_id ON local_records(collection, id);`,
  sfccV2,
  deploymentImportsV3,
  runResultsV4,
  coverageDrilldownV5,
  recoverDetailedCoverageV6,
];

export function migrate(db: DatabaseSync): void {
  // Read the version inside the write lock so two connections cannot race a migration.
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = Number(
      db.prepare('PRAGMA user_version').get()?.user_version,
    );
    if (version > migrations.length)
      throw new Error('Database schema is newer than this application');
    for (let index = version; index < migrations.length; index++) {
      const migration = migrations[index]!;
      if (typeof migration === 'string') db.exec(migration);
      else migration(db);
      db.exec(`PRAGMA user_version = ${index + 1}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
