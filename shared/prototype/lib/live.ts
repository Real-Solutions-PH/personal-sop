"use client"
import { createStore } from "./store"
export type LiveKind = "timer" | "routine" | "workout"
export interface Live {
  kind: LiveKind
  label: string
  startedAt: string
  href: string
  pausedAt?: string
  pausedSec?: number
}
export const liveStore = createStore<{
  live: Live | null
}>("live", () => ({
  live: null,
}))
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
