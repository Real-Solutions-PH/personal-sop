import { create } from "zustand"
import { replace } from "./navigation"

/** Tab routes in bar order (the centre + button is not a page). */
export const TAB_ROUTES = ["/today", "/plan", "/stats", "/me"]

/** Direction of the last tab change: 1 = next, -1 = previous, 0 = tapped. */
export const tabDirection = create<{ dir: 0 | 1 | -1 }>(() => ({ dir: 0 }))

/** Move one tab left/right from `path`; false when there is nowhere to go. */
export function stepTab(path: string, dir: 1 | -1) {
  const i = TAB_ROUTES.indexOf(path)
  const next = i < 0 ? undefined : TAB_ROUTES[i + dir]
  if (!next) return false
  tabDirection.setState({ dir })
  replace(next)
  return true
}
