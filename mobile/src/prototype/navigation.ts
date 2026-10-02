import { type Href, router } from "expo-router"
export const go = (path: string) => router.push(path as Href)
export const replace = (path: string) => router.replace(path as Href)
export function back(fallback = "/today") {
  if (router.canGoBack()) router.back()
  else replace(fallback)
}
