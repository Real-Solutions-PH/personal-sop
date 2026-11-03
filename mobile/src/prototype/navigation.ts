import { type Href, router } from "expo-router"

// The tab bar's pages: opening one switches tabs rather than stacking it.
const TAB_ROOTS = new Set(["/today", "/plan", "/stats", "/me"])
export const go = (path: string) =>
  TAB_ROOTS.has(path) ? switchTab(path) : router.push(path as Href)
export const replace = (path: string) => router.replace(path as Href)
/** Open a tab: the stack becomes that tab alone. Replacing only the top
 * screen left the tab drilled in from mounted underneath (Today, open the
 * inbox, tap Today: two Todays), one more per round trip, and every one of
 * them re-rendered on each change. */
export function switchTab(path: string) {
  if (router.canDismiss()) router.dismissAll()
  router.replace(path as Href)
}
export function back(fallback = "/today") {
  if (router.canGoBack()) router.back()
  else replace(fallback)
}
