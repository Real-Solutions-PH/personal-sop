import type { StorageAdapter } from "@domain/lib/store"
import { Platform } from "react-native"
export function openPrototypeStorage(): StorageAdapter {
  if (Platform.OS === "web")
    return {
      getItem: (key) =>
        typeof localStorage === "undefined" ? null : localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
      removeItem: (key) => localStorage.removeItem(key),
    }
  const sqlite = require("expo-sqlite") as typeof import("expo-sqlite")
  const db = sqlite.openDatabaseSync("prototype.db")
  db.execSync(
    "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS prototype_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);",
  )
  return {
    getItem: (key) =>
      db.getFirstSync<{ value: string }>(
        "SELECT value FROM prototype_state WHERE key = ?",
        key,
      )?.value ?? null,
    setItem: (key, value) => {
      db.runSync(
        "INSERT INTO prototype_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        key,
        value,
      )
    },
    removeItem: (key) => {
      db.runSync("DELETE FROM prototype_state WHERE key = ?", key)
    },
  }
}
