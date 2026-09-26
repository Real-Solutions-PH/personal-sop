import type * as SQLite from "expo-sqlite"
import { Platform } from "react-native"
import { runMigrations } from "@/lib/db/migrations"

const DB_NAME = "app.db"

type DB = SQLite.SQLiteDatabase

function createWebStub(): DB {
  const noop = () => undefined
  const empty = () => []
  const stub: Record<string, unknown> = {
    execSync: noop,
    runSync: () => ({ lastInsertRowId: 0, changes: 0 }),
    getFirstSync: () => null,
    getAllSync: empty,
    getEachSync: empty,
    prepareSync: () => ({ executeSync: noop, finalizeSync: noop }),
    closeSync: noop,
    execAsync: async () => undefined,
    runAsync: async () => ({ lastInsertRowId: 0, changes: 0 }),
    getFirstAsync: async () => null,
    getAllAsync: async () => [],
    getEachAsync: empty,
    withTransactionAsync: async (cb: () => Promise<void>) => cb(),
    withExclusiveTransactionAsync: async (cb: () => Promise<void>) => cb(),
  }
  return stub as unknown as DB
}

function openNative(): DB {
  const sqlite = require("expo-sqlite") as typeof import("expo-sqlite")
  return sqlite.openDatabaseSync(DB_NAME)
}

export const db: DB = Platform.OS === "web" ? createWebStub() : openNative()

export function initializeDatabase(): void {
  if (Platform.OS === "web") return
  db.execSync("PRAGMA journal_mode = WAL;")
  db.execSync("PRAGMA foreign_keys = ON;")
  runMigrations(db)
}
