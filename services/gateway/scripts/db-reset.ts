// Deletes the gateway's SQLite database (and its WAL/SHM files) at DB_PATH.
// Stop the gateway first; it recreates an empty database on next start.
import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const dbPath = process.env.DB_PATH?.trim() || './data/gateway.sqlite';
if (dbPath === ':memory:') {
  console.log('DB_PATH is :memory:, nothing to delete');
  process.exit(0);
}
let removed = 0;
for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`, `${dbPath}-journal`]) {
  if (existsSync(f)) {
    rmSync(f);
    removed++;
  }
}
console.log(removed ? `deleted ${resolve(dbPath)} (${removed} file(s))` : `no database at ${resolve(dbPath)}`);
