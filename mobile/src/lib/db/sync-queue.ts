import { db } from "@/lib/database"

export interface SyncEntry {
  id: number
  entity_type: string
  entity_id: string
  action: "create" | "update" | "delete"
  payload: string | null
  created_at: string
  retry_count: number
}

export function enqueueSync(entry: {
  entity_type: string
  entity_id: string
  action: "create" | "update" | "delete"
  payload: string | null
}): void {
  db.runSync(
    `INSERT INTO sync_queue (entity_type, entity_id, action, payload)
     VALUES (?, ?, ?, ?)`,
    [entry.entity_type, entry.entity_id, entry.action, entry.payload],
  )
}

export function getPendingSyncEntries(): SyncEntry[] {
  return db.getAllSync<SyncEntry>(
    "SELECT * FROM sync_queue ORDER BY created_at ASC",
  )
}

export function removeSyncEntry(id: number): void {
  db.runSync("DELETE FROM sync_queue WHERE id = ?", [id])
}

export function incrementRetryCount(id: number): void {
  db.runSync(
    "UPDATE sync_queue SET retry_count = retry_count + 1 WHERE id = ?",
    [id],
  )
}

export function getSyncQueueCount(): number {
  const result = db.getFirstSync<{ count: number }>(
    "SELECT COUNT(*) as count FROM sync_queue",
  )
  return result?.count ?? 0
}

export function clearSyncQueue(): void {
  db.runSync("DELETE FROM sync_queue")
}
