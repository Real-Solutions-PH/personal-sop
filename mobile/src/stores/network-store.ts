import { create } from "zustand"
import { mmkv } from "@/lib/storage"

type SyncStatus = "idle" | "syncing" | "error"
type ConnectivityType = "wifi" | "cellular" | "none" | "unknown"

interface NetworkState {
  isConnected: boolean
  connectionType: ConnectivityType
  isWifi: boolean
  syncStatus: SyncStatus
  lastSyncAt: string | null
  pendingChangesCount: number
  syncError: string | null

  setNetworkState: (connected: boolean, type: ConnectivityType) => void
  setSyncStatus: (status: SyncStatus, error?: string) => void
  setLastSyncAt: (timestamp: string) => void
  setPendingChangesCount: (count: number) => void
}

export const useNetworkStore = create<NetworkState>()((set) => ({
  isConnected: true,
  connectionType: "unknown",
  isWifi: false,
  syncStatus: "idle",
  lastSyncAt: mmkv.getString("lastSyncAt") ?? null,
  pendingChangesCount: 0,
  syncError: null,

  setNetworkState: (connected, type) =>
    set({
      isConnected: connected,
      connectionType: type,
      isWifi: type === "wifi",
    }),

  setSyncStatus: (status, error) =>
    set({
      syncStatus: status,
      syncError: error ?? null,
    }),

  setLastSyncAt: (timestamp) => {
    mmkv.set("lastSyncAt", timestamp)
    set({ lastSyncAt: timestamp })
  },

  setPendingChangesCount: (count) => set({ pendingChangesCount: count }),
}))
