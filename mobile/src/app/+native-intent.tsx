import { widgetRoute } from "@/surfaces/links"

// Links from the home-screen widgets and controls (src/surfaces/links.ts),
// whether they start the app or reach it running. Every other link passes
// through untouched.
export function redirectSystemPath({ path }: { path: string }) {
  return widgetRoute(path) ?? path
}
