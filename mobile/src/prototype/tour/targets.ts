// Where the tour points: real controls register themselves under a stable id
// (a ref callback), and the overlay measures the one its step needs. A screen
// that owns a target only spreads `ref={useTourTarget(id)}`; it never imports
// the overlay. A target inside a page that scrolls (Screen) also hands over
// the page's scroll, so the overlay can bring it into view.
import { useCallback, useContext, useSyncExternalStore } from "react"
import type { ViewInstance } from "react-native"
import { PageNudge } from "../ui"

export type TargetId =
  | "tab-fern"
  | "tab-plan"
  | "tab-stats"
  | "tab-me"
  | "today-plan"
  | "me-notifications"

export type Rect = { x: number; y: number; width: number; height: number }

type Entry = { node: ViewInstance; nudge: (dy: number) => number }
const registry = new Map<TargetId, Entry>()
const listeners = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  for (const l of listeners) l()
}

/** Ref callback for a control the tour can point at. ``enabled`` false
 * unregisters it (Today's plan only counts while it has something to tick). */
export function useTourTarget(id: TargetId, enabled = true) {
  const nudge = useContext(PageNudge)
  return useCallback(
    (node: ViewInstance | null) => {
      const cur = registry.get(id)
      if (node && enabled) {
        if (cur?.node === node && cur.nudge === nudge) return
        registry.set(id, { node, nudge })
        emit()
      } else if (cur && (!node || cur.node === node)) {
        registry.delete(id)
        emit()
      }
    },
    [id, enabled, nudge],
  )
}

export const hasTarget = (id: TargetId) => registry.has(id)

/** Re-renders when targets come and go. */
export function useTargetsVersion() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => version,
    () => version,
  )
}

/** Where the target is on screen, or null when it is not mounted or has no
 * size yet. */
export function measureTarget(id: TargetId): Promise<Rect | null> {
  const entry = registry.get(id)
  if (!entry) return Promise.resolve(null)
  return new Promise((resolve) => {
    try {
      entry.node.measureInWindow((x: number, y: number, width: number, height: number) =>
        resolve(width > 0 && height > 0 ? { x, y, width, height } : null),
      )
    } catch {
      resolve(null)
    }
  })
}

/** Scrolls the target's page by ``dy``; 0 when it could not move. */
export const nudgeTarget = (id: TargetId, dy: number) =>
  registry.get(id)?.nudge(dy) ?? 0

/** Tests only. */
export function clearTargets() {
  registry.clear()
  emit()
}
