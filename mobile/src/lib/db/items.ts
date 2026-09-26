import { db } from "@/lib/database"

export interface LocalItem {
  id: string
  title: string
  description: string | null
  owner_id: string
  created_at: string | null
  updated_at: string | null
  is_local: number
}

export function getLocalItems(): LocalItem[] {
  return db.getAllSync<LocalItem>(
    "SELECT * FROM items ORDER BY created_at DESC",
  )
}

export function getLocalItemById(id: string): LocalItem | null {
  return (
    db.getFirstSync<LocalItem>("SELECT * FROM items WHERE id = ?", [id]) ?? null
  )
}

export function insertItem(item: LocalItem): void {
  db.runSync(
    `INSERT OR REPLACE INTO items (id, title, description, owner_id, created_at, updated_at, is_local)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      item.title,
      item.description,
      item.owner_id,
      item.created_at,
      item.updated_at,
      item.is_local,
    ],
  )
}

export function updateItem(
  id: string,
  data: Partial<Pick<LocalItem, "title" | "description" | "is_local">>,
): void {
  const sets: string[] = []
  const values: (string | number | null)[] = []

  if (data.title !== undefined) {
    sets.push("title = ?")
    values.push(data.title)
  }
  if (data.description !== undefined) {
    sets.push("description = ?")
    values.push(data.description)
  }
  if (data.is_local !== undefined) {
    sets.push("is_local = ?")
    values.push(data.is_local)
  }

  if (sets.length === 0) return

  sets.push("updated_at = datetime('now')")
  values.push(id)

  db.runSync(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`, values)
}

export function deleteItem(id: string): void {
  db.runSync("DELETE FROM items WHERE id = ?", [id])
}

export function upsertItemsFromServer(
  items: Array<{
    id: string
    title: string
    description?: string | null
    owner_id: string
    created_at?: string | null
  }>,
): void {
  for (const item of items) {
    db.runSync(
      `INSERT OR REPLACE INTO items (id, title, description, owner_id, created_at, is_local)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [
        item.id,
        item.title,
        item.description ?? null,
        item.owner_id,
        item.created_at ?? null,
      ],
    )
  }
}

export function getLocalItemCount(): number {
  const result = db.getFirstSync<{ count: number }>(
    "SELECT COUNT(*) as count FROM items",
  )
  return result?.count ?? 0
}

export function clearItems(): void {
  db.runSync("DELETE FROM items")
}
