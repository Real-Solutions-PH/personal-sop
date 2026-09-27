"use client"

import { createStore } from "./store"

// One running activity app-wide (IA ruling X-2): habit timer, routine player,
// or workout. Timestamp-based so it survives app close / screen lock.
export type LiveKind = "timer" | "routine" | "workout"

export interface Live {
  kind: LiveKind
  label: string
  startedAt: string // ISO
  href: string // where the Live bar navigates
  pausedAt?: string
  pausedSec?: number // accumulated paused seconds
}

export const liveStore = createStore<{ live: Live | null }>("live", () => ({
  live: null,
}))

/** Returns false (and does nothing) if another activity is already running. */
export function startLive(live: Omit<Live, "startedAt">): boolean {
  const cur = liveStore.get().live
  if (cur && cur.href !== live.href) return false
  if (!cur)
    liveStore.set({ live: { ...live, startedAt: new Date().toISOString() } })
  return true
}

export const stopLive = () => liveStore.set({ live: null })

export function elapsedSec(l: Live, now = Date.now()): number {
  const end = l.pausedAt ? new Date(l.pausedAt).getTime() : now
  return Math.max(
    0,
    (end - new Date(l.startedAt).getTime()) / 1000 - (l.pausedSec ?? 0),
  )
}
