import { type Href, router, useNavigation } from "expo-router"
import { useCallback } from "react"

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
type StackNav = { getState(): { routes: { name: string }[] } | undefined }

/** Back to a fixed parent page, wherever the stack came from: pops to it
 * when it is in this stack, else replaces this screen with it. (The
 * router's dismissTo alone only pops: with the page absent, a screen
 * opened cold, it does nothing.) */
export function useBackTo() {
  let nav: Partial<StackNav> | undefined
  try {
    // Throws outside a navigator, the same way on every render.
    // biome-ignore lint/correctness/useHookAtTopLevel: a component never moves between inside and outside a navigator
    nav = useNavigation() as unknown as Partial<StackNav> | undefined
  } catch {
    nav = undefined
  }
  return useCallback(
    (path: string) => {
      const key = path.replace(/^\//, "")
      const routes = nav?.getState?.()?.routes ?? []
      if (routes.some((r) => r.name === key || r.name === `${key}/index`))
        router.dismissTo(path as Href)
      else router.replace(path as Href)
    },
    [nav],
  )
}
