import { queryClient } from "@/components/providers"
import { api } from "@/lib/auth"
import * as itemsDb from "@/lib/db/items"
import * as syncQueueDb from "@/lib/db/sync-queue"
import * as usersDb from "@/lib/db/users"
import { useAuthStore } from "@/stores/auth-store"
import { useNetworkStore } from "@/stores/network-store"

interface ApiItem {
  id: string
  title: string
  description?: string | null
  owner_id: string
  created_at?: string | null
}

interface ItemsResponse {
  data: ApiItem[]
  count: number
}

interface ApiUser {
  id: string
  email: string
  full_name?: string | null
  is_active: boolean
  is_superuser: boolean
}

const MAX_RETRIES = 5

export async function runSync(): Promise<void> {
  const store = useNetworkStore.getState()

  if (!store.isWifi) return
  if (store.syncStatus === "syncing") return

  store.setSyncStatus("syncing")

  try {
    await pullUserProfile()
    await pullItems()
    await pushPendingChanges()

    const now = new Date().toISOString()
    store.setLastSyncAt(now)
    store.setSyncStatus("idle")
    store.setPendingChangesCount(syncQueueDb.getSyncQueueCount())

    queryClient.invalidateQueries({ queryKey: ["items"] })
    queryClient.invalidateQueries({ queryKey: ["currentUser"] })
  } catch (error) {
    const store = useNetworkStore.getState()
    if (isAuthError(error)) {
      useAuthStore.getState().clearAuth()
    }
    store.setSyncStatus("error", String(error))
  }
}

async function pullItems(): Promise<void> {
  const { data } = await api.get<ItemsResponse>("/api/v1/items/", {
    params: { skip: 0, limit: 1000 },
  })

  const pendingIds = new Set(
    syncQueueDb
      .getPendingSyncEntries()
      .filter((e) => e.entity_type === "item")
      .map((e) => e.entity_id),
  )

  const safeItems = data.data.filter((item) => !pendingIds.has(item.id))
  itemsDb.upsertItemsFromServer(safeItems)
}

async function pullUserProfile(): Promise<void> {
  const { data } = await api.get<ApiUser>("/api/v1/users/me")
  usersDb.upsertUser({
    id: data.id,
    email: data.email,
    full_name: data.full_name ?? null,
    is_active: data.is_active,
    is_superuser: data.is_superuser,
  })
  useAuthStore.getState().setAuthenticated(data)
}

async function pushPendingChanges(): Promise<void> {
  const entries = syncQueueDb.getPendingSyncEntries()

  for (const entry of entries) {
    try {
      await pushSingleChange(entry)
      syncQueueDb.removeSyncEntry(entry.id)
    } catch {
      if (entry.retry_count >= MAX_RETRIES) {
        syncQueueDb.removeSyncEntry(entry.id)
      } else {
        syncQueueDb.incrementRetryCount(entry.id)
      }
    }
  }
}

async function pushSingleChange(entry: syncQueueDb.SyncEntry): Promise<void> {
  const payload = entry.payload ? JSON.parse(entry.payload) : null

  switch (entry.action) {
    case "create":
      await api.post("/api/v1/items/", payload)
      itemsDb.updateItem(entry.entity_id, { is_local: 0 })
      break
    case "update":
      await api.put(`/api/v1/items/${entry.entity_id}`, payload)
      break
    case "delete":
      try {
        await api.delete(`/api/v1/items/${entry.entity_id}`)
      } catch (err: unknown) {
        if (isNotFoundError(err)) return
        throw err
      }
      break
  }
}

function isAuthError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { status?: number } }).response?.status ===
      "number" &&
    (error as { response: { status: number } }).response.status === 401
  )
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof (error as { response?: { status?: number } }).response?.status ===
      "number" &&
    (error as { response: { status: number } }).response.status === 404
  )
}
