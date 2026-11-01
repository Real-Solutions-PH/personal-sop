import { create } from "zustand"
import { wake } from "../wake-word"

// A Fern button on a home-screen widget or control (src/surfaces/links.ts)
// opens the chat page with ``launch`` and ``at``. Dictation goes the way a
// heard "Hey Fern" does; the camera and the keyboard are started by the
// composer on screen, which watches ``fernLaunch``.

export const fernLaunch = create<{
  pending: { kind: "camera" | "chat"; at: number } | null
}>(() => ({ pending: null }))

const started = new Set<string>()

/** Starts what the link asked for, once per link: coming back to a page
 * that a widget opened does not start it again. */
export function launchFern(mode?: string, at?: string) {
  if (!mode || !at || started.has(at)) return
  started.add(at)
  const now = Date.now()
  if (mode === "dictate") wake.setState({ pending: { at: now, rest: "" } })
  else if (mode === "camera" || mode === "chat")
    fernLaunch.setState({ pending: { kind: mode, at: now } })
}
