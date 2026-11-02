import { AppState } from "react-native"
import { create } from "zustand"
import { wake } from "../wake-word"

// A Fern button on a home-screen widget or control (src/surfaces/links.ts)
// opens the chat page with ``launch`` and ``at``. Dictation goes the way a
// heard "Hey Fern" does; the camera and the keyboard are started by the
// composer on screen, which watches ``fernLaunch``.

export const fernLaunch = create<{
  pending: { kind: "camera" | "chat"; at: number } | null
}>(() => ({ pending: null }))

/** A Shortcut or Back Tap asked to talk: the dictation it starts sends the
 * message by itself when the person stops talking. Taken (and cleared) by
 * the composer when that dictation ends. */
export const talkLaunch = create<{ at: number | null }>(() => ({ at: null }))

const started = new Set<string>()

/** ``fn`` now if the app is on screen, else once it comes on screen. A
 * Shortcut or Back Tap hands the app its link while iOS is still bringing
 * it forward, and a microphone or camera started then is closed at once. */
function whenActive(fn: () => void) {
  if (AppState.currentState === "active") return fn()
  const sub = AppState.addEventListener("change", (s) => {
    if (s !== "active") return
    sub.remove()
    fn()
  })
}

/** Starts what the link asked for, once per link: coming back to a page
 * that a widget opened does not start it again. */
export function launchFern(mode?: string, at?: string) {
  if (!mode || !at || started.has(at)) return
  started.add(at)
  whenActive(() => start(mode))
}

function start(mode: string) {
  const now = Date.now()
  if (mode === "dictate" || mode === "talk") {
    talkLaunch.setState({ at: mode === "talk" ? now : null })
    wake.setState({ pending: { at: now, rest: "" } })
  } else if (mode === "camera" || mode === "chat")
    fernLaunch.setState({ pending: { kind: mode, at: now } })
}
