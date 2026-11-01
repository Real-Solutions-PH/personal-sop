import type { AppKey } from "./types"

// The deep links the home-screen widgets and controls open, resolved to app
// routes (src/app/+native-intent.tsx). Widgets name a feature or a Fern mode
// rather than a route, so a route can move without rebuilding them:
//
//   personalsop:///fern?mode=chat|dictate|talk|camera  → Fern's chat
//
// ``talk`` (Shortcuts and Back Tap) dictates like ``dictate`` and sends the
// message by itself when the person stops talking.
//   personalsop:///feature/<key>                  → that app's home

export type FernMode = "chat" | "dictate" | "talk" | "camera"

const FEATURE_ROUTES: Record<AppKey | "today", string> = {
  today: "/today",
  habits: "/habits",
  tasks: "/tasks",
  fitness: "/fitness",
  nutrition: "/nutrition",
  focus: "/focus",
  finance: "/finance",
  screen: "/screen",
  journal: "/journal",
}

const FERN_MODES: FernMode[] = ["chat", "dictate", "talk", "camera"]

/** The route for a widget link, or null when the link is not one (the
 * caller then leaves it alone). ``now`` stamps a Fern link so opening the
 * same one twice still starts the action again. */
export function widgetRoute(url: string, now = Date.now()): string | null {
  // "personalsop:///fern?…", "personalsop://fern?…" or "/fern?…".
  const rest = url.replace(/^[a-z][\w+.-]*:\/\//i, "").replace(/^\/+/, "")
  const [path, query = ""] = rest.split("?", 2)
  if (path === "fern" || path === "fern/") {
    const mode = new URLSearchParams(query).get("mode") ?? "chat"
    const launch = FERN_MODES.includes(mode as FernMode) ? mode : "chat"
    return `/capture?launch=${launch}&at=${now}`
  }
  const feature = /^feature\/([a-z]+)\/?$/.exec(path)
  if (feature) {
    const key = feature[1] as keyof typeof FEATURE_ROUTES
    return FEATURE_ROUTES[key] ?? "/today"
  }
  return null
}
