import { requireOptionalNativeModule } from "expo"
import type { LiveState, SurfaceAction, WidgetSnapshot } from "./types"

// The local Expo module in modules/unfurl-surfaces. Absent on web, in Expo
// Go and in tests, where every call is a no-op.

interface Subscription {
  remove(): void
}
interface UnfurlSurfacesModule {
  /** Saves the snapshot where the widgets read it and reloads them; an
   * empty string removes it. */
  setSnapshot(json: string): void
  /** Starts, updates or (with null) ends the Live Activity / ongoing
   * notification. */
  setLive(json: string | null): void
  /** Returns and clears the queued taps, as a JSON array. */
  drainActions(): string
  addListener(event: "onAction", listener: () => void): Subscription
}

const native =
  requireOptionalNativeModule<UnfurlSurfacesModule>("UnfurlSurfaces")

export const surfacesAvailable = !!native

export function writeSnapshot(s: WidgetSnapshot) {
  native?.setSnapshot(JSON.stringify(s))
}
/** Signed out: the widgets fall back to their dimmed sample and the
 * lock-screen activity ends, so nothing of the account stays on show. */
export function clearSurfaces() {
  native?.setSnapshot("")
  native?.setLive(null)
}
export function writeLive(s: LiveState | null) {
  native?.setLive(s ? JSON.stringify(s) : null)
}
export function drainActions(): SurfaceAction[] {
  if (!native) return []
  try {
    const parsed: unknown = JSON.parse(native.drainActions() || "[]")
    return Array.isArray(parsed) ? parsed.filter(isAction) : []
  } catch {
    return []
  }
}
/** Calls back when native code queued a tap while the app is running. */
export function onQueuedAction(listener: () => void): () => void {
  const sub = native?.addListener("onAction", listener)
  return () => sub?.remove()
}

const TYPES = new Set([
  "done",
  "skip",
  "pause",
  "resume",
  "finishSet",
  "skipRest",
  "addRest",
  "finish",
  "checkHabit",
])
export function isAction(v: unknown): v is SurfaceAction {
  if (typeof v !== "object" || v === null) return false
  const a = v as Record<string, unknown>
  return (
    typeof a.id === "string" &&
    typeof a.type === "string" &&
    TYPES.has(a.type) &&
    typeof a.target === "string" &&
    typeof a.at === "number" &&
    (a.key === undefined || typeof a.key === "string") &&
    (a.kind === undefined ||
      a.kind === "routine" ||
      a.kind === "workout" ||
      a.kind === "timer")
  )
}
