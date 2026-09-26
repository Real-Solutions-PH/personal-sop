import { db } from "@/lib/database"

export interface CachedUser {
  id: string
  email: string
  full_name: string | null
  is_active: boolean
  is_superuser: boolean
  created_at?: string | null
}

interface UserRow {
  id: string
  email: string
  full_name: string | null
  is_active: number
  is_superuser: number
  created_at: string | null
  cached_at: string
}

export function getCachedUser(): CachedUser | null {
  const row = db.getFirstSync<UserRow>("SELECT * FROM users LIMIT 1")
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    is_active: row.is_active === 1,
    is_superuser: row.is_superuser === 1,
    created_at: row.created_at,
  }
}

export function upsertUser(user: CachedUser): void {
  db.runSync(
    `INSERT OR REPLACE INTO users (id, email, full_name, is_active, is_superuser, created_at, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      user.id,
      user.email,
      user.full_name,
      user.is_active ? 1 : 0,
      user.is_superuser ? 1 : 0,
      user.created_at ?? null,
    ],
  )
}

export function clearUserCache(): void {
  db.runSync("DELETE FROM users")
}
