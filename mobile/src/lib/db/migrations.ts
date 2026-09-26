import type * as SQLite from "expo-sqlite"

const MIGRATIONS: string[] = [
  // Version 1: Initial schema
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    full_name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    is_superuser INTEGER NOT NULL DEFAULT 0,
    created_at TEXT,
    cached_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    owner_id TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    is_local INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (owner_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    action TEXT NOT NULL,
    payload TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    retry_count INTEGER NOT NULL DEFAULT 0
  );`,
]

export function runMigrations(db: SQLite.SQLiteDatabase): void {
  const result = db.getFirstSync<{ user_version: number }>(
    "PRAGMA user_version",
  )
  const currentVersion = result?.user_version ?? 0

  for (let i = currentVersion; i < MIGRATIONS.length; i++) {
    db.execSync(MIGRATIONS[i])
  }

  if (currentVersion < MIGRATIONS.length) {
    db.execSync(`PRAGMA user_version = ${MIGRATIONS.length}`)
  }
}
